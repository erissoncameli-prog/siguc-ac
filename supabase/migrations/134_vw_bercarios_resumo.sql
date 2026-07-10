-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Resumo consolidado por berçário
-- ───────────────────────────────────────────────────────────────
-- Suporta a página de acompanhamento pages/biomonitor-bercarios.html:
-- ocupação atual (vivos/capacidade), lotes por status, mortalidade
-- histórica canônica (vw_lotes_bercario_mortalidade) e alertas em
-- aberto, tudo em 1 SELECT por berçário — evita N+1 queries no client.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_bercarios_resumo
WITH (security_invoker = true)
AS
SELECT
  b.id,
  b.nome,
  b.tipo,
  b.capacidade_max,
  b.localizacao_descricao,
  b.uc_id,
  uc.nome  AS uc_nome,
  uc.sigla AS uc_sigla,
  b.responsavel_id,
  mb.nome_completo AS responsavel_nome,
  b.status,
  b.observacoes,
  b.criado_em,
  COALESCE(l.lotes_ativos, 0)     AS lotes_ativos,
  COALESCE(l.vivos_atual, 0)      AS filhotes_vivos_atual,
  COALESCE(l.entrada_ativos, 0)   AS filhotes_entrada_ativos,
  COALESCE(l.lotes_soltados, 0)   AS lotes_soltados,
  COALESCE(l.lotes_cancelados, 0) AS lotes_cancelados,
  COALESCE(l.entrada_total, 0)    AS total_entrada_historico,
  COALESCE(l.mortes_total, 0)     AS total_mortes_historico,
  ROUND(100.0 * COALESCE(l.mortes_total, 0) / NULLIF(l.entrada_total, 0), 1) AS taxa_mortalidade_pct,
  COALESCE(al.alertas_abertos, 0) AS alertas_abertos,
  al.maior_severidade
FROM bercarios b
LEFT JOIN unidades_conservacao uc     ON uc.id = b.uc_id
LEFT JOIN monitores_biodiversidade mb ON mb.id = b.responsavel_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE lb.status = 'ativo')     AS lotes_ativos,
    COUNT(*) FILTER (WHERE lb.status = 'soltado')   AS lotes_soltados,
    COUNT(*) FILTER (WHERE lb.status = 'cancelado') AS lotes_cancelados,
    COALESCE(SUM(vlm.vivos_atual)   FILTER (WHERE lb.status = 'ativo'), 0) AS vivos_atual,
    COALESCE(SUM(lb.qtd_entrada)    FILTER (WHERE lb.status = 'ativo'), 0) AS entrada_ativos,
    COALESCE(SUM(vlm.qtd_entrada), 0) AS entrada_total,
    COALESCE(SUM(vlm.mortes), 0)      AS mortes_total
  FROM lotes_bercario lb
  LEFT JOIN vw_lotes_bercario_mortalidade vlm ON vlm.lote_id = lb.id
  WHERE lb.bercario_id = b.id
) l ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS alertas_abertos,
    (ARRAY_AGG(aq.severidade ORDER BY
      CASE aq.severidade WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END
    ))[1] AS maior_severidade
  FROM alertas_quelonios aq
  WHERE aq.bercario_id = b.id AND aq.status IN ('aberto', 'ciente')
) al ON true;
