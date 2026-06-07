-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 023 — Correções críticas do fluxo de pesquisa
-- Fase 0 do diagnóstico do fluxo de pesquisas:
--   C1/C2  Corrige INSERT ... SELECT com contagem de colunas errada
--   C4     Gate de permissão em avancar_etapa_pesquisa
--   C5     RLS de INSERT/UPDATE deixa de ser WITH CHECK (true)
--   A1     Bloqueio efetivo de inadimplência (trigger centralizado)
--   +      RPC de anexo público por token (substitui INSERT direto do anon)
-- ═══════════════════════════════════════════════════════════

-- ─── C1. marcar_inadimplencia: faltava pesquisa_id no SELECT ──
-- A versão anterior listava 5 colunas e fornecia 4 valores → erro em runtime.

CREATE OR REPLACE FUNCTION marcar_inadimplencia(
  p_pesquisa_id uuid,
  p_motivo      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
                   AND perfil IN ('gestor','super_admin','financeiro')) THEN
    RAISE EXCEPTION 'Sem permissão para marcar inadimplência.';
  END IF;

  UPDATE pesquisas
  SET inadimplente        = true,
      inadimplencia_motivo = p_motivo,
      inadimplencia_em    = now()
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  SELECT p_pesquisa_id, etapa, etapa, auth.uid(),
         '⚠ Pesquisador marcado como inadimplente. Motivo: ' || p_motivo
  FROM pesquisas WHERE id = p_pesquisa_id;
END;
$$;

-- ─── C2. solicitar_complementacao: mesmo bug ─────────────────

CREATE OR REPLACE FUNCTION solicitar_complementacao(
  p_pesquisa_id uuid,
  p_motivo      text,
  p_prazo_dias  int DEFAULT 15
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email text;
  v_num   text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
                   AND perfil IN ('tecnico','gestor','super_admin')) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT pesquisador_email, numero_processo INTO v_email, v_num
  FROM pesquisas WHERE id = p_pesquisa_id;

  UPDATE pesquisas SET
    complementacao_solicitada = true,
    complementacao_motivo     = p_motivo,
    complementacao_prazo      = (now() + (p_prazo_dias || ' days')::interval)::date
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
  VALUES (p_pesquisa_id, 'complementacao', v_email,
          '[SIGUC] Documentação complementar solicitada — ' || v_num);

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  SELECT p_pesquisa_id, etapa, etapa, auth.uid(), 'Complementação solicitada: ' || p_motivo
  FROM pesquisas WHERE id = p_pesquisa_id;
END;
$$;

-- ─── C4. avancar_etapa_pesquisa: gate de permissão ───────────
-- Função SECURITY DEFINER (bypassa RLS); sem checagem, qualquer
-- usuário autenticado podia mover qualquer pesquisa de etapa.

CREATE OR REPLACE FUNCTION avancar_etapa_pesquisa(
  p_pesquisa_id  uuid,
  p_nova_etapa   etapa_pesquisa,
  p_observacao   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_etapa_anterior etapa_pesquisa;
  v_inadimplente   boolean;
BEGIN
  -- Apenas usuários internos com cargo ativo podem avançar etapas.
  IF NOT EXISTS (
    SELECT 1 FROM cargos_atuais ca
    JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid()
      AND c.nivel IN ('analista_uc','gestor_uc','chefe_deuc','chefe_debio','diretor','secretario','coordenador')
  ) AND NOT EXISTS (
    SELECT 1 FROM usuarios WHERE id = auth.uid() AND perfil IN ('gestor','super_admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para avançar a etapa desta pesquisa.';
  END IF;

  SELECT etapa, inadimplente INTO v_etapa_anterior, v_inadimplente
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesquisa não encontrada: %', p_pesquisa_id;
  END IF;

  IF v_inadimplente AND p_nova_etapa NOT IN ('encerrada','arquivada') THEN
    RAISE EXCEPTION 'Pesquisador inadimplente. Regularize pendências antes de avançar.';
  END IF;

  UPDATE pesquisas SET etapa = p_nova_etapa WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, v_etapa_anterior, p_nova_etapa, auth.uid(), p_observacao);
END;
$$;

-- ─── A1. Bloqueio efetivo de inadimplência (trigger central) ──
-- Em vez de replicar a regra em cada despachar_*, um trigger
-- BEFORE UPDATE garante que nenhuma transição de etapa ocorra
-- com pesquisador inadimplente (exceto encerrar/arquivar).

CREATE OR REPLACE FUNCTION bloquear_avanco_inadimplente()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.inadimplente
     AND NEW.etapa IS DISTINCT FROM OLD.etapa
     AND NEW.etapa NOT IN ('encerrada','arquivada')
     -- permite a própria atualização que regulariza o pesquisador
     AND NEW.inadimplente THEN
    RAISE EXCEPTION 'Pesquisador inadimplente. Regularize as pendências antes de avançar a etapa.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloqueio_inadimplencia ON pesquisas;
CREATE TRIGGER trg_bloqueio_inadimplencia
  BEFORE UPDATE OF etapa ON pesquisas
  FOR EACH ROW EXECUTE FUNCTION bloquear_avanco_inadimplente();

-- ─── C5. RLS: fim do WITH CHECK (true) ───────────────────────
-- pesquisa_documentos: INSERT só para autor/interno autenticado.
-- O envio público passa a usar a RPC anexar_documento_publico
-- (SECURITY DEFINER), que valida o token e roda como owner.

DROP POLICY IF EXISTS "pesq_docs_insert" ON pesquisa_documentos;
CREATE POLICY "pesq_docs_insert" ON pesquisa_documentos FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id AND (
      p.pesquisador_id = auth.uid()
      OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                   AND u.perfil IN ('tecnico','gestor','super_admin'))
    )
  )
);

-- pesquisa_emails: escrita só para internos. As funções
-- SECURITY DEFINER e a edge function (service_role) ignoram RLS.

DROP POLICY IF EXISTS "pesq_emails_insert" ON pesquisa_emails;
DROP POLICY IF EXISTS "pesq_emails_update" ON pesquisa_emails;

CREATE POLICY "pesq_emails_insert" ON pesquisa_emails FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
            AND u.perfil IN ('tecnico','gestor','super_admin'))
);
CREATE POLICY "pesq_emails_update" ON pesquisa_emails FOR UPDATE USING (
  EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
            AND u.perfil IN ('gestor','super_admin'))
);

-- ─── RPC: anexo de documento pelo portal público (por token) ──
-- Substitui o INSERT direto do anon em pesquisa_documentos e o
-- UPDATE direto em pesquisas (que o RLS bloqueava silenciosamente).

CREATE OR REPLACE FUNCTION anexar_documento_publico(
  p_token        text,
  p_tipo         tipo_documento_pesquisa,
  p_nome         text,
  p_storage_path text,
  p_tamanho      bigint DEFAULT NULL,
  p_mime         text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pesq   pesquisas%ROWTYPE;
  v_doc_id uuid;
BEGIN
  SELECT * INTO v_pesq FROM pesquisas WHERE token_publico = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesquisa não encontrada para o token informado.';
  END IF;

  -- Pesquisador só pode anexar tipos compatíveis com o portal
  IF p_tipo NOT IN ('complementar','outro','relatorio_parcial','relatorio_final',
                    'proposta','sisbio','conep','formulario') THEN
    RAISE EXCEPTION 'Tipo de documento não permitido pelo portal.';
  END IF;

  -- Limite de tamanho defensivo (20 MB)
  IF p_tamanho IS NOT NULL AND p_tamanho > 20971520 THEN
    RAISE EXCEPTION 'Arquivo excede o limite de 20 MB.';
  END IF;

  INSERT INTO pesquisa_documentos (
    pesquisa_id, tipo, nome_original, storage_path, tamanho_bytes, mime_type, enviado_por, observacao
  )
  VALUES (
    v_pesq.id, p_tipo, p_nome, p_storage_path, p_tamanho, p_mime, 'pesquisador',
    CASE WHEN p_tipo = 'complementar'
         THEN 'Enviado em atendimento à solicitação de complementação.'
         ELSE NULL END
  )
  RETURNING id INTO v_doc_id;

  IF p_tipo = 'complementar' AND v_pesq.complementacao_solicitada THEN
    UPDATE pesquisas SET complementacao_solicitada = false WHERE id = v_pesq.id;

    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (v_pesq.id, v_pesq.etapa, v_pesq.etapa, NULL,
            'Documentação complementar enviada pelo pesquisador via portal.');
  END IF;

  RETURN jsonb_build_object('id', v_doc_id);
END;
$$;

GRANT EXECUTE ON FUNCTION anexar_documento_publico(text, tipo_documento_pesquisa, text, text, bigint, text)
  TO anon, authenticated;
