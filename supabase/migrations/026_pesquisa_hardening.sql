-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 026 — Hardening do fluxo de pesquisa
-- Fase 3 do diagnóstico:
--   A8  Minimiza PII exposta por token público (remove e-mail)
--   M6  Restringe tipo e tamanho de documentos no banco
-- ═══════════════════════════════════════════════════════════

-- ─── A8. Acompanhamento por token sem expor e-mail ───────────
-- O e-mail do pesquisador não precisa voltar para quem possui o
-- token; o restante (status, etapa, histórico) é mantido.

CREATE OR REPLACE FUNCTION buscar_pesquisa_por_token(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'id',                       p.id,
    'numero_processo',          p.numero_processo,
    'titulo',                   p.titulo,
    'tipo',                     p.tipo,
    'etapa',                    p.etapa,
    'pesquisador_nome',         p.pesquisador_nome,
    'uc_nome',                  uc.nome,
    'data_inicio_prevista',     p.data_inicio_prevista,
    'data_fim_prevista',        p.data_fim_prevista,
    'aap_numero',               p.aap_numero,
    'aap_validade',             p.aap_validade,
    'complementacao_solicitada',p.complementacao_solicitada,
    'complementacao_motivo',    p.complementacao_motivo,
    'complementacao_prazo',     p.complementacao_prazo,
    'inadimplente',             p.inadimplente,
    'criado_em',                p.criado_em,
    'historico', (
      SELECT jsonb_agg(jsonb_build_object(
        'etapa_nova',   h.etapa_nova,
        'observacao',   h.observacao,
        'criado_em',    h.criado_em
      ) ORDER BY h.criado_em)
      FROM pesquisa_historico h WHERE h.pesquisa_id = p.id
    ),
    'documentos', (
      SELECT jsonb_agg(jsonb_build_object(
        'id',           d.id,
        'tipo',         d.tipo,
        'nome_original',d.nome_original,
        'criado_em',    d.criado_em
      ) ORDER BY d.criado_em)
      FROM pesquisa_documentos d WHERE d.pesquisa_id = p.id
    )
  )
  FROM pesquisas p
  LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id
  WHERE p.token_publico = p_token
  LIMIT 1;
$$;

-- ─── M6. Constraints de documentos ───────────────────────────
-- NOT VALID: aplica-se a novos registros sem reprocessar os antigos.

ALTER TABLE pesquisa_documentos DROP CONSTRAINT IF EXISTS pesq_docs_tamanho_chk;
ALTER TABLE pesquisa_documentos
  ADD CONSTRAINT pesq_docs_tamanho_chk
  CHECK (tamanho_bytes IS NULL OR (tamanho_bytes > 0 AND tamanho_bytes <= 20971520))
  NOT VALID;

ALTER TABLE pesquisa_documentos DROP CONSTRAINT IF EXISTS pesq_docs_mime_chk;
ALTER TABLE pesquisa_documentos
  ADD CONSTRAINT pesq_docs_mime_chk
  CHECK (mime_type IS NULL OR mime_type IN (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'application/zip',
    'application/x-zip-compressed'
  ))
  NOT VALID;
