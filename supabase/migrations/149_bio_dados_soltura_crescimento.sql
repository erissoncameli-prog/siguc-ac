-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — aba Dados: soltura + crescimento por espécie
-- ───────────────────────────────────────────────────────────────
-- Estende bio_dados_aba (146) com 5 blocos novos para a aba Berçário,
-- todos escopados por grupo/temporada como o resto e SEMPRE com a
-- espécie distinta:
--
--  • bercario_soltos_por_especie: filhotes soltos por espécie, separando
--    direto no rio × via berçário (barra empilhada).
--  • taxa_soltura_por_bercario / _por_especie: soltos via berçário ÷
--    entrada, nos dois recortes (o berçário abriga uma espécie por
--    temporada, então cada barra de berçário já é de uma espécie).
--  • crescimento_por_especie: comprimento e peso médios por data de
--    medição, uma série por espécie (curva de crescimento).
--  • ganho_por_bercario: Δ comprimento e Δ peso calculados POR INDIVÍDUO
--    (última − primeira medição do mesmo filhote) e então a média por
--    berçário — evita o viés de comparar médias de conjuntos diferentes
--    quando entram filhotes novos.
--
-- Espécie do lote vem do ninho (lote.ninho_id → ninhos_quelonios.especie).
-- Mantém intactas todas as chaves já retornadas pela 146.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bio_dados_aba(
  p_temporada_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mon_id   uuid;
  v_grupo_id uuid;
  v_result   jsonb;
BEGIN
  SELECT id, grupo_id INTO v_mon_id, v_grupo_id
    FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo'
   LIMIT 1;

  IF v_mon_id IS NULL THEN RETURN NULL; END IF;

  WITH base AS (
    SELECT
      n.id, n.especie, n.status, n.monitor_id, n.data_encontro,
      n.qtd_ovos, n.ovos_integros, n.ovos_descartados,
      n.dist_rio_m, n.temperatura_c, n.umidade_pct, n.profundidade_cm,
      p.nome AS praia_nome,
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos, e.predacao, e.data_nascimento,
      CASE
        WHEN e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
        THEN (e.data_nascimento - n.data_encontro)
      END AS dias_incubacao
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao, data_nascimento
      FROM eclosoes_ninho
      WHERE ninho_id = n.id ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  agg AS (
    SELECT
      COUNT(*)                                               AS total_ninhos,
      COUNT(*) FILTER (WHERE monitor_id = v_mon_id)         AS meus_ninhos,
      COUNT(*) FILTER (WHERE status = 'encontrado')         AS encontrados,
      COUNT(*) FILTER (WHERE status = 'transferido')        AS transferidos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'eclodido')           AS eclodidos_status,
      COUNT(*) FILTER (WHERE status = 'em_bercario')        AS em_bercario,
      COUNT(*) FILTER (WHERE status = 'soltado')            AS soltados,
      COUNT(*) FILTER (WHERE status = 'perdido')            AS perdidos,
      COALESCE(SUM(filhotes_vivos),  0)                     AS filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0)                     AS filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0)                   AS ovos_nao_nascidos,
      COALESCE(SUM(qtd_ovos), 0)                            AS total_ovos_postura,
      COALESCE(SUM(ovos_integros), 0)                       AS total_ovos_integros,
      COALESCE(SUM(ovos_descartados), 0)                    AS total_ovos_descartados,
      COUNT(*) FILTER (WHERE predacao = 'por_pessoas')      AS predacao_pessoas,
      COUNT(*) FILTER (WHERE predacao = 'por_animais')      AS predacao_animais,
      COUNT(*) FILTER (WHERE predacao = 'nenhuma')          AS sem_predacao,
      ROUND(AVG(dist_rio_m)::numeric, 1)                    AS dist_rio_media_m,
      ROUND(AVG(temperatura_c)::numeric, 1)                 AS temp_media_c,
      ROUND(AVG(umidade_pct)::numeric, 1)                   AS umidade_media_pct,
      ROUND(AVG(profundidade_cm)::numeric, 1)               AS profundidade_media_cm,
      ROUND(AVG(dias_incubacao)::numeric)                   AS incubacao_media_dias
    FROM base
  ),

  por_especie AS (
    SELECT
      especie,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                     AS filhotes_vivos,
      ROUND(
        100.0 * COALESCE(SUM(filhotes_vivos), 0) /
        NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0)
      , 1)                                                  AS taxa_eclosao
    FROM base
    GROUP BY especie
    ORDER BY total DESC
  ),

  por_mes AS (
    SELECT
      to_char(date_trunc('month', data_encontro), 'YYYY-MM') AS mes,
      COUNT(*)                                               AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                      AS filhotes
    FROM base
    WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro)
    ORDER BY date_trunc('month', data_encontro)
  ),

  top_praias AS (
    SELECT praia_nome, COUNT(*) AS total
    FROM base
    WHERE praia_nome IS NOT NULL
    GROUP BY praia_nome
    ORDER BY total DESC
    LIMIT 6
  ),

  berc_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE l.status IN ('ativo','soltado')) AS total_lotes,
      COALESCE(SUM(l.qtd_entrada), 0)                         AS total_entrada,
      COALESCE(SUM(ls.soltado), 0)                            AS total_soltado,
      COALESCE(SUM(lm.mortes), 0)                             AS total_mortalidade
    FROM lotes_bercario l
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM filhotes_bercario fb WHERE fb.lote_id = l.id)
          THEN (SELECT count(*) FROM filhotes_bercario fb WHERE fb.lote_id = l.id AND fb.status = 'morto')
        ELSE (SELECT COALESCE(SUM(ob.qtd_afetados), 0) FROM ocorrencias_bercario ob WHERE ob.lote_id = l.id AND ob.tipo = 'mortalidade')
      END AS mortes
    ) lm ON true
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
  ),

  solturas_agg AS (
    SELECT
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario
    FROM solturas_filhotes sf
    LEFT JOIN ninhos_quelonios n ON n.id = sf.ninho_id
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  -- ── NOVO: soltos por espécie (direto rio × via berçário) ──────
  soltos_especie AS (
    SELECT
      n.especie,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada), 0)                                        AS total
    FROM solturas_filhotes sf
    JOIN ninhos_quelonios n ON n.id = sf.ninho_id
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
    GROUP BY n.especie
    ORDER BY total DESC
  ),

  -- ── NOVO: base por lote para taxa de soltura ──────────────────
  lote_berc AS (
    SELECT
      l.id, l.bercario_id, l.bercario_nome, n.especie,
      COALESCE(l.qtd_entrada, 0) AS entrada,
      COALESCE(ls.soltado, 0)    AS soltos
    FROM lotes_bercario l
    LEFT JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
  ),

  taxa_soltura_bercario AS (
    SELECT
      bercario_nome,
      (array_agg(especie) FILTER (WHERE especie IS NOT NULL))[1] AS especie,
      SUM(entrada) AS entrada,
      SUM(soltos)  AS soltos,
      ROUND(100.0 * SUM(soltos) / NULLIF(SUM(entrada), 0), 1) AS taxa_pct
    FROM lote_berc
    GROUP BY bercario_id, bercario_nome
    HAVING SUM(entrada) > 0
    ORDER BY bercario_nome
  ),

  taxa_soltura_especie AS (
    SELECT
      especie,
      SUM(entrada) AS entrada,
      SUM(soltos)  AS soltos,
      ROUND(100.0 * SUM(soltos) / NULLIF(SUM(entrada), 0), 1) AS taxa_pct
    FROM lote_berc
    WHERE especie IS NOT NULL
    GROUP BY especie
    HAVING SUM(entrada) > 0
    ORDER BY especie
  ),

  -- ── NOVO: curva de crescimento por espécie (média por data) ───
  crescimento_especie AS (
    SELECT
      n.especie,
      to_char(bi.data_medicao, 'YYYY-MM-DD')        AS data,
      ROUND(AVG(bi.comprimento_cm)::numeric, 1)     AS comp_medio,
      ROUND(AVG(bi.peso_g)::numeric, 1)             AS peso_medio,
      COUNT(*)                                      AS n_medicoes
    FROM biometrias_individuais bi
    JOIN filhotes_bercario fb ON fb.id = bi.individuo_id
    JOIN lotes_bercario l ON l.id = fb.lote_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    WHERE bi.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
      AND (bi.comprimento_cm IS NOT NULL OR bi.peso_g IS NOT NULL)
    GROUP BY n.especie, bi.data_medicao
    ORDER BY n.especie, bi.data_medicao
  ),

  -- ── NOVO: ganho por indivíduo (1ª × última medição por métrica) ─
  comp_ind AS (
    SELECT
      bi.individuo_id,
      (array_agg(bi.comprimento_cm ORDER BY bi.data_medicao,      bi.hora_medicao))[1] AS ini,
      (array_agg(bi.comprimento_cm ORDER BY bi.data_medicao DESC, bi.hora_medicao DESC))[1] AS fim
    FROM biometrias_individuais bi
    WHERE bi.grupo_id = v_grupo_id AND bi.comprimento_cm IS NOT NULL
    GROUP BY bi.individuo_id
    HAVING COUNT(*) >= 2
  ),
  peso_ind AS (
    SELECT
      bi.individuo_id,
      (array_agg(bi.peso_g ORDER BY bi.data_medicao,      bi.hora_medicao))[1] AS ini,
      (array_agg(bi.peso_g ORDER BY bi.data_medicao DESC, bi.hora_medicao DESC))[1] AS fim
    FROM biometrias_individuais bi
    WHERE bi.grupo_id = v_grupo_id AND bi.peso_g IS NOT NULL
    GROUP BY bi.individuo_id
    HAVING COUNT(*) >= 2
  ),
  ganho_bercario AS (
    SELECT
      l.bercario_nome,
      (array_agg(n.especie) FILTER (WHERE n.especie IS NOT NULL))[1] AS especie,
      ROUND(AVG(ci.fim - ci.ini)::numeric, 1) AS delta_comp,
      ROUND(AVG(pi.fim - pi.ini)::numeric, 1) AS delta_peso,
      COUNT(DISTINCT ci.individuo_id)         AS n_comp,
      COUNT(DISTINCT pi.individuo_id)         AS n_peso
    FROM filhotes_bercario fb
    JOIN lotes_bercario l ON l.id = fb.lote_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN comp_ind ci ON ci.individuo_id = fb.id
    LEFT JOIN peso_ind pi ON pi.individuo_id = fb.id
    WHERE fb.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
      AND (ci.individuo_id IS NOT NULL OR pi.individuo_id IS NOT NULL)
    GROUP BY l.bercario_id, l.bercario_nome
    ORDER BY l.bercario_nome
  ),

  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
    GROUP BY ob.tipo
    ORDER BY total DESC
  ),

  biometria_serie AS (
    SELECT
      data,
      ROUND(AVG(comp)::numeric, 1) AS comp_medio,
      ROUND(AVG(peso)::numeric, 1) AS peso_medio
    FROM (
      SELECT
        to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
        ob.comprimento_medio_cm AS comp,
        ob.peso_medio_g AS peso
      FROM ocorrencias_bercario ob
      JOIN lotes_bercario l ON l.id = ob.lote_id
      WHERE ob.tipo = 'biometria'
        AND l.grupo_id = v_grupo_id
        AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)

      UNION ALL

      SELECT
        to_char(bi.data_medicao, 'YYYY-MM-DD') AS data,
        bi.comprimento_cm AS comp,
        bi.peso_g AS peso
      FROM biometrias_individuais bi
      JOIN filhotes_bercario fb ON fb.id = bi.individuo_id
      JOIN lotes_bercario l ON l.id = fb.lote_id
      WHERE l.grupo_id = v_grupo_id
        AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
    ) todas
    WHERE comp IS NOT NULL OR peso IS NOT NULL
    GROUP BY data
    ORDER BY data
    LIMIT 30
  )

  SELECT jsonb_build_object(
    'meus_ninhos',              a.meus_ninhos,
    'grupo_ninhos',             a.total_ninhos,
    'eclodidos',                a.eclodidos,
    'pendentes',                a.encontrados,
    'filhotes_vivos',           a.filhotes_vivos,
    'filhotes_mortos',          a.filhotes_mortos,
    'ovos_nao_nascidos',        a.ovos_nao_nascidos,
    'total_ovos_postura',       a.total_ovos_postura,
    'total_ovos_integros',      a.total_ovos_integros,
    'total_ovos_descartados',   a.total_ovos_descartados,
    'dist_rio_media_m',         a.dist_rio_media_m,
    'temp_media_c',             a.temp_media_c,
    'umidade_media_pct',        a.umidade_media_pct,
    'profundidade_media_cm',    a.profundidade_media_cm,

    'taxa_eclosao_pct',
      ROUND(100.0 * a.filhotes_vivos /
        NULLIF(a.filhotes_vivos + a.filhotes_mortos + a.ovos_nao_nascidos, 0), 1),
    'taxa_sucesso_nidificacao_pct',
      ROUND(100.0 * a.eclodidos / NULLIF(a.total_ninhos, 0), 1),
    'taxa_fertilidade_pct',
      ROUND(100.0 * a.total_ovos_integros / NULLIF(a.total_ovos_postura, 0), 1),
    'eficiencia_ninho_pct',
      ROUND(100.0 * a.filhotes_vivos / NULLIF(a.total_ovos_integros, 0), 1),
    'taxa_predacao_pct',
      ROUND(100.0 * a.perdidos / NULLIF(a.total_ninhos, 0), 1),
    'taxa_transferencia_pct',
      ROUND(100.0 * a.transferidos / NULLIF(a.total_ninhos, 0), 1),
    'incubacao_media_dias',     a.incubacao_media_dias,

    'por_status', jsonb_build_object(
      'encontrado',  a.encontrados,
      'transferido', a.transferidos,
      'eclodido',    a.eclodidos_status,
      'em_bercario', a.em_bercario,
      'soltado',     a.soltados,
      'perdido',     a.perdidos
    ),
    'predacao_breakdown', jsonb_build_object(
      'por_animais', a.predacao_animais,
      'por_pessoas', a.predacao_pessoas,
      'nenhuma',     a.sem_predacao
    ),
    'desfecho_ovos', jsonb_build_object(
      'filhotes_vivos',    a.filhotes_vivos,
      'filhotes_mortos',   a.filhotes_mortos,
      'ovos_nao_nascidos', a.ovos_nao_nascidos,
      'ovos_descartados',  a.total_ovos_descartados
    ),
    'por_especie', (SELECT jsonb_agg(row_to_json(pe)) FROM por_especie pe),
    'por_mes',     (SELECT jsonb_agg(row_to_json(pm)) FROM por_mes pm),
    'top_praias',  (SELECT jsonb_agg(row_to_json(tp)) FROM top_praias tp),

    'bercario_total_lotes',     ba.total_lotes,
    'bercario_total_entrada',   ba.total_entrada,
    'bercario_total_soltado',   ba.total_soltado,
    'bercario_mortalidade',     ba.total_mortalidade,

    'taxa_sobrevivencia_bercario_pct',
      ROUND(100.0 * ba.total_soltado / NULLIF(ba.total_entrada, 0), 1),
    'taxa_mortalidade_bercario_pct',
      ROUND(100.0 * ba.total_mortalidade / NULLIF(ba.total_entrada, 0), 1),

    'solturas_direto_rio',      sa.direto_rio,
    'solturas_via_bercario',    sa.via_bercario,

    -- ── NOVO ──────────────────────────────────────────────
    'bercario_soltos_por_especie', (SELECT jsonb_agg(row_to_json(se)) FROM soltos_especie se),
    'taxa_soltura_por_bercario',   (SELECT jsonb_agg(row_to_json(tb)) FROM taxa_soltura_bercario tb),
    'taxa_soltura_por_especie',    (SELECT jsonb_agg(row_to_json(te)) FROM taxa_soltura_especie te),
    'crescimento_por_especie',     (SELECT jsonb_agg(row_to_json(ce)) FROM crescimento_especie ce),
    'ganho_por_bercario',          (SELECT jsonb_agg(row_to_json(gb)) FROM ganho_bercario gb),

    'ocorrencias_tipos', (SELECT jsonb_agg(row_to_json(ot)) FROM oc_tipos ot),
    'biometria_serie',   (SELECT jsonb_agg(row_to_json(bs)) FROM biometria_serie bs)

  ) INTO v_result
  FROM agg a, berc_agg ba, solturas_agg sa;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION bio_dados_aba TO authenticated;
