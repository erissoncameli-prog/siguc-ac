-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 010 — Integração Projeto ↔ Notificação
-- + Correção de RLS: gestor vê apenas as próprias notificações
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Vínculos bidirecionais ────────────────────────────────

-- Notificação sabe qual projeto foi criado em resposta a ela
ALTER TABLE notificacoes
  ADD COLUMN projeto_id uuid REFERENCES projetos_analise(id) ON DELETE SET NULL;

CREATE INDEX notificacoes_projeto_idx ON notificacoes(projeto_id) WHERE projeto_id IS NOT NULL;

-- Projeto sabe qual notificação o originou
ALTER TABLE projetos_analise
  ADD COLUMN notificacao_id uuid REFERENCES notificacoes(id) ON DELETE SET NULL;

CREATE INDEX projetos_notificacao_idx ON projetos_analise(notificacao_id) WHERE notificacao_id IS NOT NULL;

-- ─── 2. Trigger: avanço de projeto sincroniza notificação ─────

CREATE OR REPLACE FUNCTION sincronizar_notificacao_por_projeto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notif_id   uuid;
  v_novo_status status_notificacao;
  v_obs        text;
BEGIN
  -- Só age se o status mudou e há notificação vinculada
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT notificacao_id INTO v_notif_id
  FROM projetos_analise WHERE id = NEW.id;

  IF v_notif_id IS NULL THEN RETURN NEW; END IF;

  CASE NEW.status
    WHEN 'em_analise' THEN
      v_novo_status := 'em_analise';
      v_obs := 'Projeto de análise iniciado: ' || NEW.titulo;
    WHEN 'concluido' THEN
      v_novo_status := 'resolvida';
      v_obs := 'Projeto de análise concluído: ' || NEW.titulo;
    WHEN 'arquivado' THEN
      v_novo_status := 'resolvida';
      v_obs := 'Projeto de análise arquivado: ' || NEW.titulo;
    ELSE
      RETURN NEW; -- rascunho não sincroniza
  END CASE;

  -- Só avança se a notificação ainda não está resolvida
  UPDATE notificacoes
  SET status       = v_novo_status,
      resolvido_em = CASE WHEN v_novo_status = 'resolvida' THEN now() ELSE resolvido_em END
  WHERE id = v_notif_id AND status <> 'resolvida';

  IF FOUND THEN
    INSERT INTO notificacoes_historico
      (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
    SELECT
      v_notif_id,
      status,          -- status anterior já foi sobrescrito, buscamos do histórico
      v_novo_status,
      NEW.responsavel_id,
      v_obs
    FROM (SELECT lag(status) OVER (ORDER BY criado_em DESC) AS status
          FROM notificacoes_historico
          WHERE notificacao_id = v_notif_id
          LIMIT 1) sub;

    -- Fallback se não houver histórico anterior
    INSERT INTO notificacoes_historico
      (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
    SELECT v_notif_id, NULL, v_novo_status, NEW.responsavel_id, v_obs
    WHERE NOT EXISTS (
      SELECT 1 FROM notificacoes_historico
      WHERE notificacao_id = v_notif_id
        AND status_novo = v_novo_status
        AND criado_em > now() - interval '5 seconds'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_notificacao_por_projeto
  AFTER UPDATE OF status ON projetos_analise
  FOR EACH ROW EXECUTE FUNCTION sincronizar_notificacao_por_projeto();

-- ─── 3. Corrigir RLS — gestor vê apenas as próprias ──────────

-- Remove policies antigas permissivas
DROP POLICY IF EXISTS "notif_select" ON notificacoes;
DROP POLICY IF EXISTS "notif_insert" ON notificacoes;
DROP POLICY IF EXISTS "notif_update" ON notificacoes;

-- SELECT: cada um vê apenas onde é destinatário; super_admin vê tudo
CREATE POLICY "notif_select" ON notificacoes FOR SELECT USING (
  destinatario_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = auth.uid() AND u.perfil = 'super_admin'
  )
);

-- INSERT: gestor e super_admin podem criar notificações para outros
CREATE POLICY "notif_insert" ON notificacoes FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = auth.uid()
      AND u.perfil IN ('gestor', 'super_admin')
  )
);

-- UPDATE: apenas o destinatário ou super_admin alteram
CREATE POLICY "notif_update" ON notificacoes FOR UPDATE USING (
  destinatario_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = auth.uid() AND u.perfil = 'super_admin'
  )
);

-- ─── 4. Atualizar view com dados do projeto vinculado ─────────

DROP VIEW IF EXISTS v_notificacoes_pendentes;

CREATE OR REPLACE VIEW v_notificacoes_pendentes AS
SELECT
  n.*,
  u_dest.nome_completo          AS destinatario_nome,
  u_dest.perfil                 AS destinatario_perfil,
  u_rem.nome_completo           AS remetente_nome,
  uc.nome                       AS uc_nome,
  -- Projeto vinculado
  p.id                          AS projeto_id,
  p.titulo                      AS projeto_titulo,
  p.status                      AS projeto_status,
  p.tipo                        AS projeto_tipo,
  -- SLA calculado
  CASE
    WHEN n.sla_prazo IS NULL        THEN NULL
    WHEN n.sla_prazo < now()        THEN 'vencido'
    WHEN n.sla_prazo < now() + interval '6 hours'  THEN 'critico'
    WHEN n.sla_prazo < now() + interval '24 hours' THEN 'atencao'
    ELSE 'ok'
  END                           AS sla_status,
  EXTRACT(EPOCH FROM (n.sla_prazo - now())) / 3600 AS sla_horas_restantes
FROM notificacoes n
LEFT JOIN usuarios u_dest            ON u_dest.id = n.destinatario_id
LEFT JOIN usuarios u_rem             ON u_rem.id  = n.remetente_id
LEFT JOIN unidades_conservacao uc    ON uc.id     = n.uc_id
LEFT JOIN projetos_analise p         ON p.id      = n.projeto_id
WHERE n.status <> 'resolvida';

-- ─── 5. Função: criar projeto a partir de notificação ─────────
-- Usada pelo frontend; retorna o id do projeto criado.

CREATE OR REPLACE FUNCTION criar_projeto_de_notificacao(
  p_notificacao_id uuid,
  p_titulo         text,
  p_tipo           tipo_projeto DEFAULT 'verificacao_campo',
  p_observacoes    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notif      notificacoes%ROWTYPE;
  v_projeto_id uuid;
BEGIN
  SELECT * INTO v_notif FROM notificacoes WHERE id = p_notificacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificação não encontrada: %', p_notificacao_id;
  END IF;

  IF v_notif.projeto_id IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe um projeto vinculado a esta notificação: %', v_notif.projeto_id;
  END IF;

  -- Cria o projeto
  INSERT INTO projetos_analise
    (titulo, tipo, status, alerta_id, uc_id, observacoes, notificacao_id, responsavel_id, criado_por)
  VALUES
    (p_titulo, p_tipo, 'rascunho', v_notif.alerta_id, v_notif.uc_id,
     p_observacoes, p_notificacao_id, auth.uid(), auth.uid())
  RETURNING id INTO v_projeto_id;

  -- Vincula projeto à notificação e avança status
  UPDATE notificacoes
  SET projeto_id = v_projeto_id,
      status     = 'em_analise'
  WHERE id = p_notificacao_id;

  INSERT INTO notificacoes_historico
    (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
  VALUES
    (p_notificacao_id, v_notif.status, 'em_analise', auth.uid(),
     'Projeto de análise criado: ' || p_titulo);

  RETURN v_projeto_id;
END;
$$;
