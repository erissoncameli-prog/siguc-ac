-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — RPC bio_analise_cientifica
-- ───────────────────────────────────────────────────────────
-- Complemento científico ao bio_relatorio_completo (091).
-- Acrescenta as dimensões que faltavam para o Dossiê Científico
-- da Temporada:
--   1) Fase da temporada (início/meio/fim) — recorte por terços
--      da janela [data_inicio, data_fim] da temporada-alvo, mais
--      a fase corrente derivada de p_ref_date;
--   2) Fase × ano  — mesma leitura de fase comparada entre anos
--      (base para tendência interanual quando o histórico crescer);
--   3) Temperatura de substrato — histograma com faixas ancoradas
--      na temperatura pivotal (TSD) para leitura qualitativa de
--      razão sexual da coorte (eixo de mudanças climáticas);
--   4) Sinais climáticos — alagamento de ninhos e série mensal.
-- Não altera nenhuma função/objeto existente.
-- Depende de: 074 (ninhos/eclosões), 086 (visitas_ninho),
--             temporadas_biomonitor (073).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bio_analise_cientifica(
  p_temporada_id uuid DEFAULT NULL,
  p_programa_id  uuid DEFAULT NULL,
  p_uc_id        uuid DEFAULT NULL,
  p_praia_id     uuid DEFAULT NULL,
  p_ref_date     date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result   jsonb;
  v_ref      date := COALESCE(p_ref_date, current_date);
  v_temp_id  uuid;
  v_ini      date;
  v_fim      date;
  v_span     int;
  v_t1       date;   -- fronteira início→meio
  v_t2       date;   -- fronteira meio→fim
  v_temp_row record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  -- ── Resolve a temporada-alvo ─────────────────────────────────
  -- Filtro explícito tem prioridade; senão usa a temporada corrente
  -- (is_atual) ou a mais recente do programa filtrado.
  IF p_temporada_id IS NOT NULL THEN
    v_temp_id := p_temporada_id;
  ELSE
    SELECT id INTO v_temp_id
      FROM temporadas_biomonitor
     WHERE (p_programa_id IS NULL OR programa_id = p_programa_id)
     ORDER BY is_atual DESC NULLS LAST, ano_base DESC
     LIMIT 1;
  END IF;

  SELECT id, nome, ano_base, data_inicio, data_fim, status
    INTO v_temp_row
    FROM temporadas_biomonitor
   WHERE id = v_temp_id;

  v_ini := v_temp_row.data_inicio;
  v_fim := v_temp_row.data_fim;

  -- Fronteiras dos terços (guardando janelas degeneradas)
  IF v_ini IS NOT NULL AND v_fim IS NOT NULL AND v_fim >= v_ini THEN
    v_span := (v_fim - v_ini);
    v_t1   := v_ini + (v_span / 3);
    v_t2   := v_ini + (2 * v_span / 3);
  END IF;

  -- ── IDs base (mesma semântica de filtros da 091) ─────────────
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

  base AS (
    SELECT
      n.id,
      n.especie,
      n.status,
      n.data_encontro,
      n.qtd_ovos,
      n.temperatura_c,
      EXTRACT(YEAR FROM n.data_encontro)::int AS ano,
      e.filhotes_vivos,
      e.filhotes_mortos,
      e.ovos_nao_nascidos,
      -- Classifica a fase pela data de encontro (postura) dentro da
      -- janela da temporada-alvo. Fora da janela cai em 'inicio'/'fim'.
      CASE
        WHEN v_t1 IS NULL THEN NULL
        WHEN n.data_encontro < v_t1 THEN 'inicio'
        WHEN n.data_encontro < v_t2 THEN 'meio'
        ELSE 'fim'
      END AS fase
    FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
  ),

  -- ── Leituras de temperatura de substrato (ninho + visitas) ────
  temps AS (
    SELECT n.especie, n.temperatura_c AS t
    FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id
    WHERE n.temperatura_c IS NOT NULL
    UNION ALL
    SELECT n.especie, v.temperatura_substrato_c AS t
    FROM visitas_ninho v
    JOIN base_ids bi ON bi.id = v.ninho_id
    JOIN ninhos_quelonios n ON n.id = v.ninho_id
    WHERE v.temperatura_substrato_c IS NOT NULL
  ),

  -- ── Agregado por fase ─────────────────────────────────────────
  fases AS (
    SELECT
      f.fase,
      COUNT(b.id)                                            AS ninhos,
      COUNT(b.id) FILTER (WHERE b.status = 'eclodido')       AS eclodidos,
      COUNT(b.id) FILTER (WHERE b.status = 'perdido')        AS perdidos,
      COALESCE(SUM(b.filhotes_vivos), 0)                     AS filhotes_vivos,
      ROUND(AVG(b.qtd_ovos)::numeric, 1)                     AS media_ovos,
      ROUND(AVG(b.temperatura_c)::numeric, 1)                AS temp_substrato_media,
      ROUND(
        100.0 * COALESCE(SUM(b.filhotes_vivos), 0) /
        NULLIF(COALESCE(SUM(b.filhotes_vivos + b.filhotes_mortos + b.ovos_nao_nascidos), 0), 0)
      , 1)                                                   AS taxa_eclosao_pct
    FROM (VALUES ('inicio'), ('meio'), ('fim')) AS f(fase)
    LEFT JOIN base b ON b.fase = f.fase
    GROUP BY f.fase
  ),

  -- ── Fase × ano (tendência interanual por fase) ────────────────
  fase_ano AS (
    SELECT
      b.ano,
      b.fase,
      COUNT(*)                                               AS ninhos,
      COALESCE(SUM(b.filhotes_vivos), 0)                     AS filhotes_vivos,
      ROUND(
        100.0 * COALESCE(SUM(b.filhotes_vivos), 0) /
        NULLIF(COALESCE(SUM(b.filhotes_vivos + b.filhotes_mortos + b.ovos_nao_nascidos), 0), 0)
      , 1)                                                   AS taxa_eclosao_pct
    FROM base b
    WHERE b.fase IS NOT NULL AND b.ano IS NOT NULL
    GROUP BY b.ano, b.fase
    ORDER BY b.ano, b.fase
  ),

  -- ── Histograma de temperatura ancorado na pivotal (TSD) ───────
  -- Faixas: frio (♂), morno, transicional em torno da pivotal,
  -- quente (♀). Rótulos genéricos; a leitura de razão sexual por
  -- espécie é feita no cliente com a pivotal específica.
  temp_hist AS (
    SELECT faixa, ordem, lo, hi,
      (SELECT COUNT(*) FROM temps t
        WHERE t.t >= b.lo AND (b.hi IS NULL OR t.t < b.hi)) AS n
    FROM (VALUES
      ('< 28 °C',        1, 0.0,  28.0),
      ('28–30 °C',       2, 28.0, 30.0),
      ('30–32 °C',       3, 30.0, 32.0),
      ('32–33 °C',       4, 32.0, 33.0),
      ('33–34 °C',       5, 33.0, 34.0),
      ('≥ 34 °C',        6, 34.0, NULL)
    ) AS b(faixa, ordem, lo, hi)
    ORDER BY ordem
  ),

  temp_especie AS (
    SELECT especie,
      COUNT(*)                          AS n,
      ROUND(AVG(t)::numeric, 1)         AS temp_media,
      ROUND(MIN(t)::numeric, 1)         AS temp_min,
      ROUND(MAX(t)::numeric, 1)         AS temp_max
    FROM temps
    GROUP BY especie
    ORDER BY n DESC
  ),

  -- ── Sinais climáticos: alagamento ─────────────────────────────
  alag AS (
    SELECT
      COUNT(DISTINCT v.ninho_id) FILTER (WHERE v.sinal_alagamento)      AS ninhos_alagados,
      COUNT(*) FILTER (WHERE v.sinal_alagamento)                        AS visitas_alagamento,
      COALESCE(SUM(v.ovos_perdidos_alagamento), 0)                      AS ovos_perdidos_alagamento
    FROM visitas_ninho v
    JOIN base_ids bi ON bi.id = v.ninho_id
  ),

  clima_mes AS (
    SELECT
      to_char(date_trunc('month', b.data_encontro), 'YYYY-MM') AS mes,
      COUNT(*)                                                 AS ninhos,
      ROUND(AVG(b.temperatura_c)::numeric, 1)                  AS temp_media
    FROM base b
    WHERE b.data_encontro IS NOT NULL
    GROUP BY date_trunc('month', b.data_encontro)
    ORDER BY date_trunc('month', b.data_encontro)
  )

  SELECT jsonb_build_object(
    'temporada', CASE WHEN v_temp_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',             v_temp_row.id,
      'nome',           v_temp_row.nome,
      'ano_base',       v_temp_row.ano_base,
      'data_inicio',    v_ini,
      'data_fim',       v_fim,
      'status',         v_temp_row.status,
      'ref_date',       v_ref,
      'dias_totais',    CASE WHEN v_span IS NOT NULL THEN v_span + 1 END,
      'dias_decorridos',CASE WHEN v_ini IS NOT NULL
                          THEN GREATEST(0, LEAST((v_fim - v_ini) + 1, (v_ref - v_ini) + 1)) END,
      'pct_decorrido',  CASE WHEN v_span IS NOT NULL AND v_span >= 0
                          THEN ROUND(100.0 * GREATEST(0, LEAST(v_span, (v_ref - v_ini))) /
                                     NULLIF(v_span, 0), 0) END,
      'fase_atual',     CASE
                          WHEN v_t1 IS NULL THEN NULL
                          WHEN v_ref < v_ini THEN 'pre'
                          WHEN v_ref > v_fim THEN 'encerrada'
                          WHEN v_ref < v_t1  THEN 'inicio'
                          WHEN v_ref < v_t2  THEN 'meio'
                          ELSE 'fim'
                        END,
      'fronteira_meio', v_t1,
      'fronteira_fim',  v_t2
    ) END,
    'fases',          (SELECT jsonb_agg(row_to_json(f) ORDER BY
                          CASE f.fase WHEN 'inicio' THEN 1 WHEN 'meio' THEN 2 ELSE 3 END)
                        FROM fases f),
    'fase_ano',       (SELECT jsonb_agg(row_to_json(fa)) FROM fase_ano fa),
    'temperatura', jsonb_build_object(
      'n_amostras',   (SELECT COUNT(*) FROM temps),
      'media',        (SELECT ROUND(AVG(t)::numeric, 1) FROM temps),
      'min',          (SELECT ROUND(MIN(t)::numeric, 1) FROM temps),
      'max',          (SELECT ROUND(MAX(t)::numeric, 1) FROM temps),
      'histograma',   (SELECT jsonb_agg(row_to_json(th) ORDER BY th.ordem) FROM temp_hist th),
      'por_especie',  (SELECT jsonb_agg(row_to_json(te)) FROM temp_especie te)
    ),
    'clima', jsonb_build_object(
      'ninhos_alagados',          (SELECT ninhos_alagados FROM alag),
      'visitas_alagamento',       (SELECT visitas_alagamento FROM alag),
      'ovos_perdidos_alagamento', (SELECT ovos_perdidos_alagamento FROM alag),
      'serie_mensal',             (SELECT jsonb_agg(row_to_json(cm)) FROM clima_mes cm)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION bio_analise_cientifica TO authenticated;
