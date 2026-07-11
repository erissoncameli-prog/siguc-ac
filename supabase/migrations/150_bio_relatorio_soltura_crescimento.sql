-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — relatório web: soltura + crescimento por espécie
-- ───────────────────────────────────────────────────────────────
-- Espelha na página web (painel + detalhado) os mesmos blocos que a
-- aba Dados do app ganhou na 148, agora em bio_relatorio_completo e
-- respeitando os filtros do relatório (temporada/programa/UC/praia/
-- localização) via base_ids:
--   • bercario_soltos_por_especie
--   • taxa_soltura_por_bercario / _por_especie
--   • crescimento_por_especie (comp/peso; une biometria agregada por
--     lote e individual por filhote)
--   • ganho_por_bercario (Δ por indivíduo; só biometria individual)
-- Mantém intactas todas as chaves já retornadas.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bio_relatorio_completo(
  p_temporada_id     uuid DEFAULT NULL,
  p_programa_id      uuid DEFAULT NULL,
  p_uc_id            uuid DEFAULT NULL,
  p_praia_id         uuid DEFAULT NULL,
  p_tipo_localizacao tipo_localizacao_praia DEFAULT NULL
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
    LEFT JOIN praias_monitoramento p  ON p.id = n.praia_id
    LEFT JOIN grupos_biomonitor gb    ON gb.id = n.grupo_id
    WHERE
      (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_programa_id IS NULL OR gb.programa_id = p_programa_id)
      AND (p_uc_id IS NULL OR COALESCE(n.uc_id, p.uc_id) = p_uc_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
      AND (p_tipo_localizacao IS NULL OR p.tipo_localizacao = p_tipo_localizacao)
  ),
  base AS (
    SELECT
      n.id, n.especie, n.status, n.monitor_id, n.praia_id, n.data_encontro,
      n.qtd_ovos, n.ovos_integros, n.ovos_descartados,
      (SELECT COALESCE(SUM(d.qtd),0) FROM descartes_ovos d WHERE d.ninho_id = n.id AND d.motivo = 'predacao') AS ovos_predados,
      (SELECT COALESCE(SUM(d.qtd),0) FROM descartes_ovos d WHERE d.ninho_id = n.id)                          AS ovos_descartes_total,
      n.dist_rio_m, n.temperatura_c, n.umidade_pct, n.profundidade_cm,
      COALESCE(n.uc_id, p.uc_id) AS uc_id,
      p.nome AS praia_nome, p.codigo AS praia_codigo, p.comprimento_m,
      uc.nome AS uc_nome, uc.sigla AS uc_sigla,
      mb.nome_completo AS monitor_nome, gb.nome AS grupo_nome,
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos, e.predacao, e.data_nascimento,
      CASE WHEN e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
        THEN (e.data_nascimento - n.data_encontro) END AS dias_incubacao
    FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id
    LEFT JOIN praias_monitoramento p   ON p.id = n.praia_id
    LEFT JOIN unidades_conservacao uc  ON uc.id = COALESCE(n.uc_id, p.uc_id)
    LEFT JOIN monitores_biodiversidade mb ON mb.id = n.monitor_id
    LEFT JOIN grupos_biomonitor gb     ON gb.id = n.grupo_id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao, data_nascimento
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
  ),
  agg AS (
    SELECT
      COUNT(*) AS total_ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'eclodido')    AS eclodidos_status,
      COUNT(*) FILTER (WHERE status = 'em_bercario') AS em_bercario,
      COUNT(*) FILTER (WHERE status = 'soltado')     AS soltados,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido') AS transferidos,
      COUNT(*) FILTER (WHERE status = 'encontrado') AS pendentes,
      COALESCE(SUM(qtd_ovos), 0) AS total_ovos_postura,
      COALESCE(SUM(ovos_integros), 0) AS total_ovos_integros,
      COALESCE(SUM(ovos_descartados), 0) AS total_ovos_descartados,
      COALESCE(SUM(ovos_predados), 0) AS total_ovos_predados,
      GREATEST(COALESCE(SUM(qtd_ovos),0) - COALESCE(SUM(ovos_descartes_total),0), 0) AS total_ovos_viaveis,
      COALESCE(SUM(filhotes_vivos), 0) AS total_filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0) AS total_filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0) AS total_ovos_nao_nascidos,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos_postura,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(temperatura_c)::numeric, 1) AS temp_media_c,
      ROUND(AVG(umidade_pct)::numeric, 1) AS umidade_media_pct,
      ROUND(AVG(profundidade_cm)::numeric, 1) AS profundidade_media_cm,
      ROUND(AVG(dias_incubacao)::numeric) AS incubacao_media_dias,
      COUNT(*) FILTER (WHERE predacao = 'por_pessoas') AS predacao_pessoas,
      COUNT(*) FILTER (WHERE predacao = 'por_animais') AS predacao_animais,
      COUNT(*) FILTER (WHERE predacao = 'nenhuma') AS sem_predacao
    FROM base
  ),
  por_mes AS (
    SELECT to_char(date_trunc('month', data_encontro), 'YYYY-MM') AS mes,
      COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes, ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos
    FROM base WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro) ORDER BY date_trunc('month', data_encontro)
  ),
  por_ano AS (
    SELECT EXTRACT(YEAR FROM data_encontro)::int AS ano, COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE data_encontro IS NOT NULL GROUP BY EXTRACT(YEAR FROM data_encontro) ORDER BY ano
  ),
  por_especie AS (
    SELECT especie, COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido') AS transferidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0) AS filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0) AS ovos_nao_nascidos,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos_postura,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(ovos_integros), 0), 0), 1) AS eficiencia_pct,
      ROUND(AVG(dias_incubacao)::numeric) AS incubacao_media_dias,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(temperatura_c)::numeric, 1) AS temp_media_c
    FROM base GROUP BY especie ORDER BY total DESC
  ),
  por_praia AS (
    SELECT praia_id, praia_nome, praia_codigo, uc_nome, uc_sigla,
      MAX(comprimento_m) AS comprimento_m, COUNT(*) AS ninhos_total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos,
      COUNT(*) FILTER (WHERE predacao IN ('por_pessoas','por_animais')) AS com_predacao,
      ROUND(CASE WHEN MAX(comprimento_m) > 0 THEN 1000.0 * COUNT(*) / MAX(comprimento_m) END::numeric, 2) AS densidade_ninhos_km
    FROM base WHERE praia_id IS NOT NULL
    GROUP BY praia_id, praia_nome, praia_codigo, uc_nome, uc_sigla ORDER BY ninhos_total DESC
  ),
  por_uc AS (
    SELECT uc_id, uc_nome, uc_sigla, COUNT(*) AS ninhos_total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos
    FROM base WHERE uc_id IS NOT NULL GROUP BY uc_id, uc_nome, uc_sigla ORDER BY ninhos_total DESC
  ),
  por_monitor AS (
    SELECT monitor_id, monitor_nome, grupo_nome, COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE monitor_id IS NOT NULL GROUP BY monitor_id, monitor_nome, grupo_nome ORDER BY ninhos DESC LIMIT 25
  ),
  berc_agg AS (
    SELECT COUNT(*) FILTER (WHERE l.status IN ('ativo','soltado')) AS total_lotes,
      COALESCE(SUM(l.qtd_entrada), 0) AS total_entrada,
      COALESCE(SUM(ls.soltado), 0) AS total_soltado
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
  ),
  berc_mortes_canon AS (
    SELECT COALESCE(SUM(vlm.mortes), 0) AS total_mortes
    FROM vw_lotes_bercario_mortalidade vlm
    JOIN base_ids bi ON bi.id = vlm.ninho_id
  ),
  solturas_agg AS (
    SELECT COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true), 0) AS via_bercario
    FROM base_ids bi JOIN solturas_filhotes sf ON sf.ninho_id = bi.id
  ),

  -- ── NOVO: soltos por espécie ──────────────────────────────────
  soltos_especie AS (
    SELECT n.especie,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada), 0)                                        AS total
    FROM base_ids bi
    JOIN solturas_filhotes sf ON sf.ninho_id = bi.id
    JOIN ninhos_quelonios n   ON n.id = bi.id
    GROUP BY n.especie
    ORDER BY total DESC
  ),

  -- ── NOVO: base por lote para taxa de soltura ──────────────────
  lote_berc AS (
    SELECT l.id, l.bercario_id, l.bercario_nome, n.especie,
      COALESCE(l.qtd_entrada, 0) AS entrada,
      COALESCE(ls.soltado, 0)    AS soltos
    FROM base_ids bi
    JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ninhos_quelonios n ON n.id = bi.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
  ),
  taxa_soltura_bercario AS (
    SELECT bercario_nome,
      (array_agg(especie) FILTER (WHERE especie IS NOT NULL))[1] AS especie,
      SUM(entrada) AS entrada, SUM(soltos) AS soltos,
      ROUND(100.0 * SUM(soltos) / NULLIF(SUM(entrada), 0), 1) AS taxa_pct
    FROM lote_berc GROUP BY bercario_id, bercario_nome HAVING SUM(entrada) > 0 ORDER BY bercario_nome
  ),
  taxa_soltura_especie AS (
    SELECT especie, SUM(entrada) AS entrada, SUM(soltos) AS soltos,
      ROUND(100.0 * SUM(soltos) / NULLIF(SUM(entrada), 0), 1) AS taxa_pct
    FROM lote_berc WHERE especie IS NOT NULL GROUP BY especie HAVING SUM(entrada) > 0 ORDER BY especie
  ),

  -- ── NOVO: crescimento por espécie (agregada + individual) ─────
  crescimento_especie AS (
    SELECT especie, data,
      ROUND(AVG(comp)::numeric, 1) AS comp_medio,
      ROUND(AVG(peso)::numeric, 1) AS peso_medio
    FROM (
      SELECT n.especie AS especie, to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
        ob.comprimento_medio_cm AS comp, ob.peso_medio_g AS peso
      FROM base_ids bi
      JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN ninhos_quelonios n ON n.id = bi.id
      JOIN ocorrencias_bercario ob ON ob.lote_id = l.id
      WHERE ob.tipo = 'biometria'

      UNION ALL

      SELECT n.especie, to_char(b.data_medicao, 'YYYY-MM-DD') AS data,
        b.comprimento_cm AS comp, b.peso_g AS peso
      FROM base_ids bi
      JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN ninhos_quelonios n ON n.id = bi.id
      JOIN filhotes_bercario fb ON fb.lote_id = l.id
      JOIN biometrias_individuais b ON b.individuo_id = fb.id
    ) t
    WHERE comp IS NOT NULL OR peso IS NOT NULL
    GROUP BY especie, data
    ORDER BY especie, data
  ),

  -- ── NOVO: ganho por berçário (Δ por indivíduo) ────────────────
  comp_ind AS (
    SELECT b.individuo_id,
      (array_agg(b.comprimento_cm ORDER BY b.data_medicao,      b.hora_medicao))[1] AS ini,
      (array_agg(b.comprimento_cm ORDER BY b.data_medicao DESC, b.hora_medicao DESC))[1] AS fim
    FROM biometrias_individuais b
    JOIN filhotes_bercario fb ON fb.id = b.individuo_id
    JOIN lotes_bercario l ON l.id = fb.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    WHERE b.comprimento_cm IS NOT NULL
    GROUP BY b.individuo_id HAVING COUNT(*) >= 2
  ),
  peso_ind AS (
    SELECT b.individuo_id,
      (array_agg(b.peso_g ORDER BY b.data_medicao,      b.hora_medicao))[1] AS ini,
      (array_agg(b.peso_g ORDER BY b.data_medicao DESC, b.hora_medicao DESC))[1] AS fim
    FROM biometrias_individuais b
    JOIN filhotes_bercario fb ON fb.id = b.individuo_id
    JOIN lotes_bercario l ON l.id = fb.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    WHERE b.peso_g IS NOT NULL
    GROUP BY b.individuo_id HAVING COUNT(*) >= 2
  ),
  ganho_bercario AS (
    SELECT l.bercario_nome,
      (array_agg(n.especie) FILTER (WHERE n.especie IS NOT NULL))[1] AS especie,
      ROUND(AVG(ci.fim - ci.ini)::numeric, 1) AS delta_comp,
      ROUND(AVG(pi.fim - pi.ini)::numeric, 1) AS delta_peso,
      COUNT(DISTINCT ci.individuo_id)         AS n_comp,
      COUNT(DISTINCT pi.individuo_id)         AS n_peso
    FROM base_ids bi
    JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ninhos_quelonios n ON n.id = bi.id
    JOIN filhotes_bercario fb ON fb.lote_id = l.id
    LEFT JOIN comp_ind ci ON ci.individuo_id = fb.id
    LEFT JOIN peso_ind pi ON pi.individuo_id = fb.id
    WHERE ci.individuo_id IS NOT NULL OR pi.individuo_id IS NOT NULL
    GROUP BY l.bercario_id, l.bercario_nome
    ORDER BY l.bercario_nome
  ),

  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ocorrencias_bercario ob ON ob.lote_id = l.id GROUP BY ob.tipo ORDER BY total DESC
  ),
  biometria_serie AS (
    SELECT data,
      ROUND(AVG(comp)::numeric, 1) AS comp_medio,
      ROUND(AVG(peso)::numeric, 1) AS peso_medio,
      SUM(n) AS n_amostrados
    FROM (
      SELECT to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
        ob.comprimento_medio_cm AS comp, ob.peso_medio_g AS peso,
        COALESCE(ob.n_amostrados, 0) AS n
      FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN ocorrencias_bercario ob ON ob.lote_id = l.id
      WHERE ob.tipo = 'biometria'

      UNION ALL

      SELECT to_char(b.data_medicao, 'YYYY-MM-DD') AS data,
        b.comprimento_cm AS comp, b.peso_g AS peso, 1 AS n
      FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN filhotes_bercario fb ON fb.lote_id = l.id
      JOIN biometrias_individuais b ON b.individuo_id = fb.id
    ) todas
    WHERE comp IS NOT NULL OR peso IS NOT NULL
    GROUP BY data ORDER BY data LIMIT 60
  )
  SELECT jsonb_build_object(
    'kpis', (
      SELECT jsonb_build_object(
        'total_ninhos', a.total_ninhos, 'eclodidos', a.eclodidos, 'perdidos', a.perdidos,
        'eclodidos_status', a.eclodidos_status, 'em_bercario', a.em_bercario, 'soltados', a.soltados,
        'transferidos', a.transferidos, 'pendentes', a.pendentes,
        'total_ovos_postura', a.total_ovos_postura, 'total_ovos_integros', a.total_ovos_integros,
        'total_ovos_descartados', a.total_ovos_descartados,
        'total_ovos_predados', a.total_ovos_predados, 'total_ovos_viaveis', a.total_ovos_viaveis,
        'total_filhotes_vivos', a.total_filhotes_vivos,
        'total_filhotes_vivos_liquido', GREATEST(a.total_filhotes_vivos - bmc.total_mortes, 0),
        'total_filhotes_mortos', a.total_filhotes_mortos,
        'total_ovos_nao_nascidos', a.total_ovos_nao_nascidos, 'media_ovos_postura', a.media_ovos_postura,
        'dist_rio_media_m', a.dist_rio_media_m, 'temp_media_c', a.temp_media_c,
        'umidade_media_pct', a.umidade_media_pct, 'profundidade_media_cm', a.profundidade_media_cm,
        'incubacao_media_dias', a.incubacao_media_dias,
        'taxa_eclosao_pct', ROUND(100.0 * a.total_filhotes_vivos / NULLIF(a.total_filhotes_vivos + a.total_filhotes_mortos + a.total_ovos_nao_nascidos, 0), 1),
        'taxa_sucesso_nidificacao_pct', ROUND(100.0 * a.eclodidos / NULLIF(a.total_ninhos, 0), 1),
        'taxa_fertilidade_pct', ROUND(100.0 * a.total_ovos_integros / NULLIF(a.total_ovos_postura, 0), 1),
        'eficiencia_ninho_pct', ROUND(100.0 * a.total_filhotes_vivos / NULLIF(a.total_ovos_integros, 0), 1),
        'taxa_predacao_pct', ROUND(100.0 * a.perdidos / NULLIF(a.total_ninhos, 0), 1),
        'taxa_transferencia_pct', ROUND(100.0 * a.transferidos / NULLIF(a.total_ninhos, 0), 1),
        'bercario_total_lotes', ba.total_lotes, 'bercario_total_entrada', ba.total_entrada,
        'bercario_total_soltado', ba.total_soltado, 'bercario_mortalidade', bmc.total_mortes,
        'taxa_sobrevivencia_bercario_pct', ROUND(100.0 * ba.total_soltado / NULLIF(ba.total_entrada, 0), 1),
        'taxa_mortalidade_bercario_pct', ROUND(100.0 * bmc.total_mortes / NULLIF(ba.total_entrada, 0), 1),
        'solturas_direto_rio', sa.direto_rio, 'solturas_via_bercario', sa.via_bercario,
        'predacao_pessoas', a.predacao_pessoas, 'predacao_animais', a.predacao_animais, 'sem_predacao', a.sem_predacao
      ) FROM agg a, berc_agg ba, berc_mortes_canon bmc, solturas_agg sa
    ),
    'por_mes', (SELECT jsonb_agg(row_to_json(pm)) FROM por_mes pm),
    'por_ano', (SELECT jsonb_agg(row_to_json(pa)) FROM por_ano pa),
    'por_especie', (SELECT jsonb_agg(row_to_json(pe)) FROM por_especie pe),
    'por_praia', (SELECT jsonb_agg(row_to_json(pp)) FROM por_praia pp),
    'por_uc', (SELECT jsonb_agg(row_to_json(pu)) FROM por_uc pu),
    'por_monitor', (SELECT jsonb_agg(row_to_json(pmon)) FROM por_monitor pmon),
    'biometria_serie', (SELECT jsonb_agg(row_to_json(bs)) FROM biometria_serie bs),
    'ocorrencias_tipos', (SELECT jsonb_agg(row_to_json(ot)) FROM oc_tipos ot),

    -- ── NOVO ──────────────────────────────────────────────
    'bercario_soltos_por_especie', (SELECT jsonb_agg(row_to_json(se)) FROM soltos_especie se),
    'taxa_soltura_por_bercario',   (SELECT jsonb_agg(row_to_json(tb)) FROM taxa_soltura_bercario tb),
    'taxa_soltura_por_especie',    (SELECT jsonb_agg(row_to_json(te)) FROM taxa_soltura_especie te),
    'crescimento_por_especie',     (SELECT jsonb_agg(row_to_json(ce)) FROM crescimento_especie ce),
    'ganho_por_bercario',          (SELECT jsonb_agg(row_to_json(gb)) FROM ganho_bercario gb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION bio_relatorio_completo TO authenticated;
