-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — grupo_id garantido no ninho + "eclodidos"
-- contam os status pós-eclosão nos painéis
-- ───────────────────────────────────────────────────────────────
-- Corrige duas causas de KPIs/gráficos zerados na aba Dados do app
-- e nos relatórios web:
--
-- 1. grupo_id nulo em ninhos_quelonios. Não havia trigger derivando
--    o grupo do monitor (como a 135 faz para lotes/filhotes/
--    biometrias), e o sync do app reenvia grupo_id do registro local
--    — se o aparelho tem um ninho antigo sem grupo, o upsert apaga o
--    grupo no servidor. Como bio_dados_aba/bio_ovos_resumo/
--    bio_monitoramento_eclosao escopam por grupo_id, o ninho some de
--    todos os agregados (filhotes vivos zerados etc.).
--    → trigger BEFORE INSERT OR UPDATE deriva de monitor_id quando
--      nulo + backfill dos existentes.
--
-- 2. "Eclodido" é status transitório: o fluxo (109) avança o ninho
--    para em_bercario e depois soltado, mas os painéis contavam
--    eclodidos por status = 'eclodido' — um ninho que eclodiu e foi
--    ao berçário desaparecia das contagens, da taxa de sucesso de
--    nidificação e das roscas de status (que nem tinham as fatias).
--    → "eclodidos" agregado = status IN (eclodido, em_bercario,
--      soltado); as roscas ganham as contagens puras por status.
--
-- De quebra: bio_relatorio_completo ganha a biometria individual
-- (132) na série biométrica (paridade com a 139 do app) e perde o
-- fan-out lote×solturas em berc_agg; vw_praias_biomonitor perde o
-- fan-out ninho×transferências×eclosões nas somas de ovos/filhotes.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. grupo_id derivado do monitor em ninhos_quelonios ─────────
CREATE OR REPLACE FUNCTION trg_ninhos_derivar_grupo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.grupo_id IS NULL AND NEW.monitor_id IS NOT NULL THEN
    SELECT grupo_id INTO NEW.grupo_id
    FROM monitores_biodiversidade WHERE id = NEW.monitor_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Nome começa com trg_ninhos_g* → dispara antes de trg_ninhos_temporada
-- (ordem alfabética), que depende de grupo_id/data_encontro.
DROP TRIGGER IF EXISTS trg_ninhos_grupo ON ninhos_quelonios;
CREATE TRIGGER trg_ninhos_grupo
  BEFORE INSERT OR UPDATE ON ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_ninhos_derivar_grupo();

-- Backfill dos ninhos que já perderam o grupo
UPDATE ninhos_quelonios n
SET grupo_id = m.grupo_id
FROM monitores_biodiversidade m
WHERE m.id = n.monitor_id AND n.grupo_id IS NULL;

-- ── 2. bio_dados_aba v3 (aba Dados do app) ──────────────────────
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
      n.id,
      n.especie,
      n.status,
      n.monitor_id,
      n.data_encontro,
      n.qtd_ovos,
      n.ovos_integros,
      n.ovos_descartados,
      n.dist_rio_m,
      n.temperatura_c,
      n.umidade_pct,
      n.profundidade_cm,
      p.nome AS praia_nome,
      e.filhotes_vivos,
      e.filhotes_mortos,
      e.ovos_nao_nascidos,
      e.predacao,
      e.data_nascimento,
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

  -- ── Agregados gerais ──────────────────────────────────────
  agg AS (
    SELECT
      COUNT(*)                                               AS total_ninhos,
      COUNT(*) FILTER (WHERE monitor_id = v_mon_id)         AS meus_ninhos,
      COUNT(*) FILTER (WHERE status = 'encontrado')         AS encontrados,
      COUNT(*) FILTER (WHERE status = 'transferido')        AS transferidos,
      -- Pós-eclosão agregado (KPI/taxas) + contagens puras (rosca)
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

  -- ── Por espécie ───────────────────────────────────────────
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

  -- ── Por mês ───────────────────────────────────────────────
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

  -- ── Top praias ────────────────────────────────────────────
  top_praias AS (
    SELECT praia_nome, COUNT(*) AS total
    FROM base
    WHERE praia_nome IS NOT NULL
    GROUP BY praia_nome
    ORDER BY total DESC
    LIMIT 6
  ),

  -- ── Berçário: agregados (escopo direto por lotes_bercario) ──
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

  -- ── Solturas: via rio direto vs via berçário ──────────────
  solturas_agg AS (
    SELECT
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario
    FROM solturas_filhotes sf
    LEFT JOIN ninhos_quelonios n ON n.id = sf.ninho_id
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  -- ── Ocorrências no berçário por tipo ──────────────────────
  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
    GROUP BY ob.tipo
    ORDER BY total DESC
  ),

  -- ── Série biométrica (agregada por lote + individual) ─────
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

    -- ── KPIs básicos ──────────────────────────────────────
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

    -- ── Taxas científicas ─────────────────────────────────
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

    -- ── Distribuições (para gráficos) ─────────────────────
    -- Contagens puras por status (rosca com todas as fatias)
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

    -- ── Berçário ──────────────────────────────────────────
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

    'ocorrencias_tipos', (SELECT jsonb_agg(row_to_json(ot)) FROM oc_tipos ot),
    'biometria_serie',   (SELECT jsonb_agg(row_to_json(bs)) FROM biometria_serie bs)

  ) INTO v_result
  FROM agg a, berc_agg ba, solturas_agg sa;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION bio_dados_aba TO authenticated;

-- ── 3. bio_relatorio_completo (relatórios web) ──────────────────
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
  -- Sem fan-out: solturas agregadas por lote via LATERAL (antes o
  -- LEFT JOIN multiplicava qtd_entrada quando um lote tinha 2+ solturas)
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
  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ocorrencias_bercario ob ON ob.lote_id = l.id GROUP BY ob.tipo ORDER BY total DESC
  ),
  -- Une amostragem agregada por lote e biometria individual por
  -- filhote (132) — paridade com bio_dados_aba (139)
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
    'ocorrencias_tipos', (SELECT jsonb_agg(row_to_json(ot)) FROM oc_tipos ot)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION bio_relatorio_completo TO authenticated;

-- ── 4. vw_praias_biomonitor: eclodidos pós-eclosão + sem fan-out ──
-- Antes: LEFT JOIN com transferencias_ninho e eclosoes_ninho no mesmo
-- nível — um ninho com 2+ transferências (ou eclosões) multiplicava as
-- somas de ovos/filhotes da praia. Somas de eclosão/transferência agora
-- vêm de subconsultas dedicadas.
CREATE OR REPLACE VIEW vw_praias_biomonitor AS
SELECT
  p.id, p.codigo, p.nome, p.comunidade, p.municipio, p.uc_id,
  p.tipo_localizacao, p.localizacao_referencia,
  CASE
    WHEN p.tipo_localizacao = 'dentro_uc' THEN COALESCE(uc.nome, '—')
    ELSE COALESCE(p.localizacao_referencia,
      CASE p.tipo_localizacao
        WHEN 'terra_indigena' THEN 'Terra Indígena'
        WHEN 'area_municipal' THEN 'Área Municipal'
        WHEN 'margem_livre'   THEN 'Margem Livre'
        ELSE 'Outro'
      END)
  END AS area_display,
  p.programa_id, p.monitor_responsavel_id, p.experimental,
  p.comprimento_m, p.area_ha, p.periodo_inicio, p.periodo_fim, p.ativa,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN st_y(p.ponto_acesso) END AS lat,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN st_x(p.ponto_acesso) END AS lng,
  st_asgeojson(p.ponto_acesso) AS ponto_geojson,
  st_asgeojson(p.area_geom)    AS area_geojson,
  p.sigla,
  m.nome_completo AS monitor_responsavel,
  uc.nome  AS uc_nome,
  uc.sigla AS uc_sigla,
  prog.nome AS programa_nome,
  count(DISTINCT n.id) AS ninhos_total,
  count(DISTINCT n.id) FILTER (WHERE n.status = 'encontrado')  AS ninhos_encontrados,
  count(DISTINCT n.id) FILTER (WHERE n.status = 'transferido') AS ninhos_transferidos,
  count(DISTINCT n.id) FILTER (WHERE n.status IN ('eclodido','em_bercario','soltado')) AS ninhos_eclodidos,
  count(DISTINCT n.id) FILTER (WHERE n.status = 'perdido')     AS ninhos_perdidos,
  (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_id = p.id AND x.praia_atual_id = p.id)               AS ninhos_proprios,
  (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_id = p.id AND x.praia_atual_id IS DISTINCT FROM p.id) AS ninhos_enviados,
  (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_atual_id = p.id AND x.praia_id IS DISTINCT FROM p.id) AS ninhos_recebidos,
  (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_atual_id = p.id)                                      AS ninhos_incubando_aqui,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'tracaja'::especie_quelonio)   AS ninhos_tracaja,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'tartaruga'::especie_quelonio) AS ninhos_tartaruga,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'cabecudo'::especie_quelonio)  AS ninhos_cabecudo,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'pitiU'::especie_quelonio)     AS ninhos_pitiu,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'cupido'::especie_quelonio)    AS ninhos_cupido,
  count(DISTINCT n.id) FILTER (WHERE n.status_validacao = 'pendente'::status_validacao_bio) AS ninhos_pendentes_validacao,
  COALESCE(sum(n.qtd_ovos), 0)         AS ovos_postura_total,
  COALESCE(sum(n.ovos_integros), 0)    AS ovos_integros_total,
  COALESCE(sum(n.ovos_descartados), 0) AS ovos_descartados_total,
  round(avg(n.dist_rio_m), 1)          AS dist_rio_media_m,
  (SELECT COALESCE(sum(t.qtd_ovos), 0)
     FROM transferencias_ninho t JOIN ninhos_quelonios x ON x.id = t.ninho_id
    WHERE x.praia_id = p.id) AS ovos_transferidos,
  (SELECT COALESCE(sum(e.filhotes_vivos), 0)
     FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id) AS filhotes_vivos,
  (SELECT COALESCE(sum(e.filhotes_mortos), 0)
     FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id) AS filhotes_mortos,
  (SELECT COALESCE(sum(e.ovos_nao_nascidos), 0)
     FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id) AS ovos_nao_nascidos,
  (SELECT round(100.0 * COALESCE(sum(e.filhotes_vivos), 0)
          / NULLIF(COALESCE(sum(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0), 0), 1)
     FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id) AS taxa_eclosao_pct,
  (SELECT count(*) FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id AND e.predacao = 'por_pessoas'::predacao_ninho) AS predacao_pessoas,
  (SELECT count(*) FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id AND e.predacao = 'por_animais'::predacao_ninho) AS predacao_animais,
  (SELECT COALESCE(sum(ov.viaveis), 0::numeric)
     FROM vw_ninho_ovos ov JOIN ninhos_quelonios x ON x.id = ov.ninho_id
    WHERE x.praia_id = p.id) AS ovos_viaveis_total,
  (SELECT COALESCE(sum(ov.perdas_total), 0::numeric)
     FROM vw_ninho_ovos ov JOIN ninhos_quelonios x ON x.id = ov.ninho_id
    WHERE x.praia_id = p.id) AS ovos_perdidos_total,
  p.rio
FROM praias_monitoramento p
LEFT JOIN monitores_biodiversidade mb ON mb.id = p.monitor_responsavel_id
LEFT JOIN usuarios m                  ON m.id = mb.usuario_id
LEFT JOIN unidades_conservacao uc     ON uc.id = p.uc_id
LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
LEFT JOIN ninhos_quelonios n          ON n.praia_id = p.id
GROUP BY p.id, m.nome_completo, uc.id, prog.id, mb.id;
