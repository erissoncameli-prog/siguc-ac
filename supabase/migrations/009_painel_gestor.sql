-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 009 — Painel do Gestor
-- Inbox de notificações com fluxo de status, SLA e escalamento
-- ═══════════════════════════════════════════════════════════

-- ─── Enums ───────────────────────────────────────────────────

CREATE TYPE status_notificacao AS ENUM (
  'gerada',
  'enviada',
  'visualizada',
  'em_analise',
  'encaminhada',
  'resolvida'
);

CREATE TYPE tipo_notificacao AS ENUM (
  'alerta_ambiental',
  'ocorrencia',
  'documento_pendente',
  'sla_vencendo',
  'escalamento',
  'sistema'
);

-- ─── Tabela principal ─────────────────────────────────────────

CREATE TABLE notificacoes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo             tipo_notificacao  NOT NULL,
  status           status_notificacao NOT NULL DEFAULT 'gerada',
  titulo           text        NOT NULL,
  mensagem         text        NOT NULL,
  destinatario_id  uuid        REFERENCES usuarios(id) ON DELETE CASCADE,
  remetente_id     uuid        REFERENCES usuarios(id),
  uc_id            uuid        REFERENCES unidades_conservacao(id),
  alerta_id        uuid        REFERENCES alertas_ambientais(id),
  ocorrencia_id    uuid        REFERENCES ocorrencias(id),
  sla_horas        int         NOT NULL DEFAULT 48,
  sla_prazo        timestamptz,
  escalado_para    uuid        REFERENCES usuarios(id),
  escalado_em      timestamptz,
  resolvido_em     timestamptz,
  meta             jsonb       NOT NULL DEFAULT '{}',
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

-- ─── Histórico de transições ──────────────────────────────────

CREATE TABLE notificacoes_historico (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacao_id   uuid        NOT NULL REFERENCES notificacoes(id) ON DELETE CASCADE,
  status_anterior  status_notificacao,
  status_novo      status_notificacao NOT NULL,
  usuario_id       uuid        REFERENCES usuarios(id),
  observacao       text,
  criado_em        timestamptz NOT NULL DEFAULT now()
);

-- ─── Índices ──────────────────────────────────────────────────

CREATE INDEX notificacoes_destinatario_idx ON notificacoes(destinatario_id);
CREATE INDEX notificacoes_status_idx       ON notificacoes(status);
CREATE INDEX notificacoes_sla_prazo_idx    ON notificacoes(sla_prazo) WHERE status <> 'resolvida';
CREATE INDEX notif_hist_notif_idx          ON notificacoes_historico(notificacao_id);

-- ─── Trigger atualizado_em ────────────────────────────────────

CREATE TRIGGER touch_notificacoes
  BEFORE UPDATE ON notificacoes
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ─── RLS ─────────────────────────────────────────────────────

ALTER TABLE notificacoes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes_historico ENABLE ROW LEVEL SECURITY;

-- Destinatário vê as próprias; gestor/super_admin veem todas
CREATE POLICY "notif_select" ON notificacoes FOR SELECT USING (
  destinatario_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
      AND u.perfil IN ('gestor','super_admin')
  )
);

CREATE POLICY "notif_insert" ON notificacoes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
            AND u.perfil IN ('gestor','super_admin'))
);

CREATE POLICY "notif_update" ON notificacoes FOR UPDATE USING (
  destinatario_id = auth.uid()
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
               AND u.perfil IN ('gestor','super_admin'))
);

-- Histórico: leitura para quem pode ver a notificação
CREATE POLICY "notif_hist_select" ON notificacoes_historico FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM notificacoes n WHERE n.id = notificacao_id
      AND (n.destinatario_id = auth.uid()
           OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                        AND u.perfil IN ('gestor','super_admin')))
  )
);

CREATE POLICY "notif_hist_insert" ON notificacoes_historico FOR INSERT WITH CHECK (
  usuario_id = auth.uid()
);

-- ─── Função: avançar status com registro de histórico ─────────

CREATE OR REPLACE FUNCTION avancar_notificacao(
  p_notificacao_id  uuid,
  p_novo_status     status_notificacao,
  p_observacao      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status_anterior status_notificacao;
BEGIN
  SELECT status INTO v_status_anterior
  FROM notificacoes WHERE id = p_notificacao_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificação não encontrada: %', p_notificacao_id;
  END IF;

  UPDATE notificacoes
  SET status       = p_novo_status,
      resolvido_em = CASE WHEN p_novo_status = 'resolvida' THEN now() ELSE resolvido_em END
  WHERE id = p_notificacao_id;

  INSERT INTO notificacoes_historico (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
  VALUES (p_notificacao_id, v_status_anterior, p_novo_status, auth.uid(), p_observacao);
END;
$$;

-- ─── Função: escalar notificação ──────────────────────────────

CREATE OR REPLACE FUNCTION escalar_notificacao(
  p_notificacao_id  uuid,
  p_usuario_destino uuid,
  p_observacao      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status_anterior status_notificacao;
BEGIN
  SELECT status INTO v_status_anterior
  FROM notificacoes WHERE id = p_notificacao_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificação não encontrada: %', p_notificacao_id;
  END IF;

  UPDATE notificacoes
  SET status        = 'encaminhada',
      escalado_para = p_usuario_destino,
      escalado_em   = now()
  WHERE id = p_notificacao_id;

  INSERT INTO notificacoes_historico (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
  VALUES (p_notificacao_id, v_status_anterior, 'encaminhada', auth.uid(), p_observacao);
END;
$$;

-- ─── View: notificações pendentes com SLA ─────────────────────

CREATE OR REPLACE VIEW v_notificacoes_pendentes AS
SELECT
  n.*,
  u_dest.nome_completo    AS destinatario_nome,
  u_dest.perfil           AS destinatario_perfil,
  u_rem.nome_completo     AS remetente_nome,
  uc.nome                 AS uc_nome,
  CASE
    WHEN n.sla_prazo IS NULL THEN NULL
    WHEN n.sla_prazo < now() THEN 'vencido'
    WHEN n.sla_prazo < now() + interval '6 hours' THEN 'critico'
    WHEN n.sla_prazo < now() + interval '24 hours' THEN 'atencao'
    ELSE 'ok'
  END AS sla_status,
  EXTRACT(EPOCH FROM (n.sla_prazo - now())) / 3600 AS sla_horas_restantes
FROM notificacoes n
LEFT JOIN usuarios u_dest ON u_dest.id = n.destinatario_id
LEFT JOIN usuarios u_rem  ON u_rem.id  = n.remetente_id
LEFT JOIN unidades_conservacao uc ON uc.id = n.uc_id
WHERE n.status <> 'resolvida';

-- ─── Dados de exemplo ─────────────────────────────────────────

-- Será populado automaticamente pelo sistema de alertas
-- (trigger em alertas_ambientais cria notificação para o gestor da UC)
