-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — RPC bio_analise_detalhada
-- ───────────────────────────────────────────────────────────
-- Camada analítica adicional para o Relatório Científico:
--   • ovos           — postura, fertilidade, viabilidade, descartes
--                       por causa e etapa;
--   • eclosao        — desfecho dos ovos, taxa de mortalidade
--                       embrionária, predação na eclosão;
--   • perdas         — ovos perdidos por causa (alagamento/erosão/
--                       humana/predação) nas visitas + ninhos
--                       destruídos por causa;
--   • predacao_fases — predação nas 3 fases (incubação/eclosão/soltura);
--   • incubacao      — tempo de incubação observado × previsto;
--   • bercario_tempo — permanência em berçário (entrada→soltura);
--   • crescimento    — biometria: curva por tempo e por idade, taxa de
--                       crescimento por lote e tamanho na soltura.
-- Função nova e isolada (não altera 091/131). SECURITY DEFINER,
-- mesma semântica de filtros das demais.
-- Depende de: 074, 086 (visitas), 087 (lotes/solturas),
--             089 (ocorrencias_bercario), 093 (descartes_ovos).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bio_analise_detalhada(
  p_temporada_id uuid DEFAULT NULL,
  p_programa_id  uuid DEFAULT NULL,
  p_uc_id        uuid DEFAULT NULL,
  p_praia_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  WITH base_ids AS (
    SELECT n.id
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN grupos_biomonitor gb   ON gb.id = n.grupo_id
    WHERE
      (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_programa_id IS NULL OR gb.programa_id = p_programa_id)
      AND (p_uc_id IS NULL OR COALESCE(n.uc_id, p.uc_id) = p_uc_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
  ),

  -- ── Biologia dos ovos ─────────────────────────────────────────
  ovos AS (
    SELECT
      COALESCE(SUM(n.qtd_ovos), 0)        AS total_postura,
      COALESCE(SUM(n.ovos_integros), 0)   AS total_integros,
      COALESCE(SUM(n.ovos_descartados), 0) AS total_descartados,
      COUNT(*) FILTER (WHERE n.qtd_ovos IS NOT NULL) AS n_posturas,
      ROUND(AVG(n.qtd_ovos)::numeric, 1)  AS media_postura
    FROM ninhos_quelonios n JOIN base_ids bi ON bi.id = n.id
  ),
  descartes_causa AS (
    SELECT COALESCE(d.causa::text, d.motivo::text, '—') AS causa,
           COALESCE(SUM(d.qtd), 0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY COALESCE(d.causa::text, d.motivo::text, '—')
    ORDER BY qtd DESC
  ),
  descartes_etapa AS (
    SELECT COALESCE(d.etapa, '—') AS etapa, COALESCE(SUM(d.qtd), 0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY d.etapa ORDER BY qtd DESC
  ),

  -- ── Eclosão (desfecho dos ovos) ───────────────────────────────
  ecl AS (
    SELECT
      COALESCE(SUM(e.filhotes_vivos), 0)     AS vivos,
      COALESCE(SUM(e.filhotes_mortos), 0)    AS mortos,
      COALESCE(SUM(e.ovos_nao_nascidos), 0)  AS nao_nasc,
      COUNT(*) FILTER (WHERE e.predacao = 'por_pessoas') AS pred_pessoas,
      COUNT(*) FILTER (WHERE e.predacao = 'por_animais') AS pred_animais,
      COUNT(*) FILTER (WHERE e.predacao = 'nenhuma')     AS sem_pred
    FROM eclosoes_ninho e JOIN base_ids bi ON bi.id = e.ninho_id
  ),

  -- ── Perdas de ovos nas visitas (por causa) ────────────────────
  perdas_v AS (
    SELECT
      COALESCE(SUM(v.ovos_perdidos_alagamento), 0) AS alagamento,
      COALESCE(SUM(v.ovos_perdidos_erosao), 0)     AS erosao,
      COALESCE(SUM(v.ovos_perdidos_humana), 0)     AS humana,
      COALESCE(SUM(v.ovos_predados_n), 0)          AS predacao
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
  ),
  ninhos_destr AS (
    SELECT COALESCE(v.causa_destruicao::text, '—') AS causa, COUNT(DISTINCT v.ninho_id) AS n
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
    WHERE v.status_ninho = 'destruido'
    GROUP BY v.causa_destruicao ORDER BY n DESC
  ),
  ninhos_perdidos AS (
    SELECT COUNT(*) AS n FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id WHERE n.status = 'perdido'
  ),

  -- ── Predação nas 3 fases ──────────────────────────────────────
  pred_incub AS (
    SELECT
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'por_animais')  AS animais,
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'por_pessoas')  AS pessoas,
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'desconhecida') AS desconhecida
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
  ),
  pred_solt AS (
    SELECT
      COUNT(*) FILTER (WHERE sf.predacao_soltura)     AS com,
      COUNT(*) FILTER (WHERE NOT sf.predacao_soltura) AS sem
    FROM solturas_filhotes sf JOIN base_ids bi ON bi.id = sf.ninho_id
  ),

  -- ── Incubação: observado × previsto ───────────────────────────
  incub AS (
    SELECT
      n.numero_ninho, n.especie,
      (e.data_nascimento - n.data_encontro)                       AS dias_obs,
      CASE WHEN n.data_prevista_eclosao IS NOT NULL
        THEN (n.data_prevista_eclosao - n.data_encontro) END      AS dias_prev
    FROM ninhos_quelonios n JOIN base_ids bi ON bi.id = n.id
    JOIN eclosoes_ninho e ON e.ninho_id = n.id
    WHERE n.data_encontro IS NOT NULL AND e.data_nascimento IS NOT NULL
  ),

  -- ── Tempo em berçário (entrada → soltura) ─────────────────────
  berc AS (
    SELECT
      l.id AS lote_id, l.bercario_nome, n.especie,
      l.data_entrada, l.qtd_entrada,
      sf.data_soltura, sf.qtd_soltada, sf.mortalidade,
      CASE WHEN sf.data_soltura IS NOT NULL
        THEN (sf.data_soltura - l.data_entrada) END AS dias
    FROM lotes_bercario l
    JOIN base_ids bi ON bi.id = l.ninho_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN LATERAL (
      SELECT data_soltura, qtd_soltada, mortalidade
      FROM solturas_filhotes
      WHERE lote_bercario_id = l.id AND via_bercario = true
      ORDER BY data_soltura DESC LIMIT 1
    ) sf ON true
  ),

  -- ── Crescimento em berçário (biometria) ───────────────────────
  bio_serie AS (
    SELECT
      l.id AS lote_id, l.bercario_nome, n.especie,
      ob.data_ocorrencia AS data,
      CASE WHEN e.data_nascimento IS NOT NULL
        THEN (ob.data_ocorrencia - e.data_nascimento) END AS idade_dias,
      ob.comprimento_medio_cm AS comp,
      ob.peso_medio_g         AS peso,
      ob.n_amostrados
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN eclosoes_ninho e ON e.ninho_id = l.ninho_id
    WHERE ob.tipo = 'biometria' AND ob.comprimento_medio_cm IS NOT NULL
  ),
  bio_taxa AS (
    SELECT
      s.lote_id, mn.bercario_nome, mn.especie,
      (mx.data - mn.data) AS dias,
      ROUND(((mx.comp - mn.comp) * 10.0 / NULLIF(mx.data - mn.data, 0))::numeric, 2) AS mm_dia,
      ROUND(((mx.peso - mn.peso) / NULLIF(mx.data - mn.data, 0))::numeric, 2)         AS g_dia,
      mn.comp AS comp_ini, mx.comp AS comp_fim
    FROM (SELECT DISTINCT lote_id FROM bio_serie) s
    JOIN LATERAL (SELECT data, comp, peso, bercario_nome, especie FROM bio_serie WHERE lote_id = s.lote_id ORDER BY data ASC  LIMIT 1) mn ON true
    JOIN LATERAL (SELECT data, comp, peso FROM bio_serie WHERE lote_id = s.lote_id ORDER BY data DESC LIMIT 1) mx ON true
    WHERE (mx.data - mn.data) > 0
  ),
  tam_soltura AS (
    SELECT DISTINCT ON (lote_id)
      lote_id, bercario_nome, especie, comp AS comp_ultimo, idade_dias AS idade_ultimo, data
    FROM bio_serie ORDER BY lote_id, data DESC
  )

  SELECT jsonb_build_object(
    'ovos', (
      SELECT jsonb_build_object(
        'total_postura', o.total_postura,
        'total_integros', o.total_integros,
        'total_descartados', o.total_descartados,
        'media_postura', o.media_postura,
        'n_posturas', o.n_posturas,
        'taxa_fertilidade_pct', ROUND(100.0 * o.total_integros / NULLIF(o.total_postura, 0), 1),
        'taxa_descarte_pct',    ROUND(100.0 * o.total_descartados / NULLIF(o.total_postura, 0), 1),
        'descartes_por_causa', (SELECT jsonb_agg(row_to_json(dc)) FROM descartes_causa dc),
        'descartes_por_etapa', (SELECT jsonb_agg(row_to_json(de)) FROM descartes_etapa de)
      ) FROM ovos o
    ),
    'eclosao', (
      SELECT jsonb_build_object(
        'vivos', ec.vivos, 'mortos', ec.mortos, 'nao_nascidos', ec.nao_nasc,
        'taxa_eclosao_pct', ROUND(100.0 * ec.vivos / NULLIF(ec.vivos + ec.mortos + ec.nao_nasc, 0), 1),
        'taxa_mortalidade_embrionaria_pct', ROUND(100.0 * (ec.mortos + ec.nao_nasc) / NULLIF(ec.vivos + ec.mortos + ec.nao_nasc, 0), 1),
        'predacao_pessoas', ec.pred_pessoas, 'predacao_animais', ec.pred_animais, 'sem_predacao', ec.sem_pred
      ) FROM ecl ec
    ),
    'perdas', (
      SELECT jsonb_build_object(
        'ovos_alagamento', pv.alagamento, 'ovos_erosao', pv.erosao,
        'ovos_humana', pv.humana, 'ovos_predacao', pv.predacao,
        'ninhos_perdidos', (SELECT n FROM ninhos_perdidos),
        'ninhos_por_causa', (SELECT jsonb_agg(row_to_json(nd)) FROM ninhos_destr nd)
      ) FROM perdas_v pv
    ),
    'predacao_fases', jsonb_build_object(
      'incubacao', (SELECT row_to_json(pi) FROM pred_incub pi),
      'eclosao',   (SELECT jsonb_build_object('por_pessoas', pred_pessoas, 'por_animais', pred_animais) FROM ecl),
      'soltura',   (SELECT row_to_json(ps) FROM pred_solt ps)
    ),
    'incubacao', jsonb_build_object(
      'n',            (SELECT COUNT(*) FROM incub),
      'media_dias',   (SELECT ROUND(AVG(dias_obs)::numeric, 1) FROM incub),
      'min_dias',     (SELECT MIN(dias_obs) FROM incub),
      'max_dias',     (SELECT MAX(dias_obs) FROM incub),
      'media_prevista_dias', (SELECT ROUND(AVG(dias_prev)::numeric, 1) FROM incub WHERE dias_prev IS NOT NULL),
      'desvio_medio_dias',   (SELECT ROUND(AVG(dias_obs - dias_prev)::numeric, 1) FROM incub WHERE dias_prev IS NOT NULL),
      'serie', (SELECT jsonb_agg(row_to_json(i)) FROM (SELECT numero_ninho, especie, dias_obs, dias_prev FROM incub ORDER BY dias_obs LIMIT 60) i)
    ),
    'bercario_tempo', jsonb_build_object(
      'n',          (SELECT COUNT(*) FROM berc WHERE dias IS NOT NULL),
      'media_dias', (SELECT ROUND(AVG(dias)::numeric, 1) FROM berc WHERE dias IS NOT NULL),
      'min_dias',   (SELECT MIN(dias) FROM berc WHERE dias IS NOT NULL),
      'max_dias',   (SELECT MAX(dias) FROM berc WHERE dias IS NOT NULL),
      'por_lote', (SELECT jsonb_agg(row_to_json(b)) FROM (
        SELECT bercario_nome, especie, data_entrada, data_soltura, dias, qtd_entrada, qtd_soltada, mortalidade
        FROM berc ORDER BY data_entrada DESC LIMIT 60) b)
    ),
    'crescimento', jsonb_build_object(
      'n_biometrias', (SELECT COUNT(*) FROM bio_serie),
      'serie',        (SELECT jsonb_agg(row_to_json(s)) FROM (
        SELECT bercario_nome, especie, data, idade_dias, comp, peso, n_amostrados
        FROM bio_serie ORDER BY data LIMIT 200) s),
      'taxa_por_lote',(SELECT jsonb_agg(row_to_json(tx)) FROM (
        SELECT bercario_nome, especie, dias, mm_dia, g_dia, comp_ini, comp_fim
        FROM bio_taxa LIMIT 60) tx),
      'tamanho_soltura', (SELECT jsonb_agg(row_to_json(ts)) FROM (
        SELECT bercario_nome, especie, comp_ultimo, idade_ultimo, data
        FROM tam_soltura LIMIT 60) ts)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION bio_analise_detalhada TO authenticated;
