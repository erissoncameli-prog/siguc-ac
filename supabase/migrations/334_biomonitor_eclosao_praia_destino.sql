-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Eclosão creditada à praia de DESTINO
-- ───────────────────────────────────────────────────────────
-- Regra de negócio (confirmada com o usuário), em cima da 333:
--   • NIDIFICAÇÃO / postura / contagem de "ninhos desovados" +
--     condições do sítio → praia de ORIGEM (praia_id). A tartaruga
--     desovou ali; a origem mantém o registro (rastreabilidade),
--     inclusive dos que foram transferidos.
--   • ECLOSÃO / filhotes / taxa de eclosão → praia onde o ninho
--     EFETIVAMENTE incubou e eclodiu = praia ATUAL (praia_atual_id).
--     Para ninho transferido, é o berçário/praia experimental.
--   Ou seja: a praia que transferiu um ninho NÃO recebe crédito de
--   eclosão por ele (só rastreabilidade); o berçário recebe.
--   Ninho que nunca foi transferido tem praia_atual_id = praia_id,
--   então nada muda para ele.
--
-- Isto refina a 333 (que fazia o transferido "aparecer nas duas" no
-- mapa, mas ainda somava eclosão nas duas): agora a eclosão é sempre
-- da praia de destino. Superfícies tocadas (checklist de
-- docs/biomonitor-calculos-ovos-filhotes.md): relatório oficial
-- (bio_relatorio_completo), mesa/admin (vw_praias_biomonitor), mapa
-- (bio_mapa_praias), Análise Científica (bio_analise_praias),
-- Painel de praias (bio_dashboard_praias).
--
-- Quando NÃO há filtro de praia (p_praia_id NULL) os KPIs globais
-- ficam IDÊNTICos ao de antes — as flags conta_nidif/conta_ecl são
-- ambas TRUE para todo ninho. Só a quebra "Por Praia" (e as telas por
-- praia) passam a separar nidificação × eclosão sempre.
-- ═══════════════════════════════════════════════════════════

-- ── 1. bio_relatorio_completo ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.bio_relatorio_completo(
  p_temporada_id uuid DEFAULT NULL::uuid,
  p_programa_id uuid DEFAULT NULL::uuid,
  p_uc_id uuid DEFAULT NULL::uuid,
  p_praia_id uuid DEFAULT NULL::uuid,
  p_tipo_localizacao tipo_localizacao_praia DEFAULT NULL::tipo_localizacao_praia
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      -- Praia da origem OU praia atual batem com o filtro (transferido
      -- aparece ao filtrar a de destino também)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id OR n.praia_atual_id = p_praia_id)
      AND (p_tipo_localizacao IS NULL OR p.tipo_localizacao = p_tipo_localizacao)
  ),
  base AS (
    SELECT
      n.id, n.especie, n.status, n.monitor_id, n.praia_id, n.data_encontro,
      n.qtd_ovos, n.ovos_integros, n.ovos_descartados,
      COALESCE(ov.perda_predacao, 0)   AS ovos_predados,
      COALESCE(ov.perdas_total, 0)     AS ovos_descartes_total,
      COALESCE(ov.viaveis,
        GREATEST(COALESCE(n.qtd_ovos,0) - COALESCE(ov.perdas_total,0), 0)) AS ovos_viaveis_ninho,
      COALESCE(ov.perda_alagamento, 0) AS ovos_perda_alagamento,
      COALESCE(ov.perda_erosao, 0)     AS ovos_perda_erosao,
      COALESCE(ov.perda_humana, 0)     AS ovos_perda_humana,
      n.dist_rio_m, n.temperatura_c, n.umidade_pct, n.profundidade_cm,
      COALESCE(n.uc_id, p.uc_id) AS uc_id,
      p.nome AS praia_nome, p.codigo AS praia_codigo, p.comprimento_m,
      -- Praia atual (onde incuba/eclodiu) — para creditar a eclosão
      n.praia_atual_id, pa.nome AS praia_atual_nome, pa.codigo AS praia_atual_codigo,
      COALESCE(puc.nome, uc.nome)  AS praia_atual_uc_nome,
      COALESCE(puc.sigla, uc.sigla) AS praia_atual_uc_sigla,
      uc.nome AS uc_nome, uc.sigla AS uc_sigla,
      mb.nome_completo AS monitor_nome, gb.nome AS grupo_nome,
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos, e.filhotes_anomalia, e.anomalia_tipos,
      e.predacao, e.data_nascimento,
      -- Flags de atribuição (ver cabeçalho): sob filtro de praia, o
      -- ninho conta na nidificação se a ORIGEM bate, e na eclosão se a
      -- praia ATUAL bate. Sem filtro, ambas TRUE.
      (p_praia_id IS NULL OR n.praia_id = p_praia_id)       AS conta_nidif,
      (p_praia_id IS NULL OR n.praia_atual_id = p_praia_id) AS conta_ecl,
      CASE WHEN e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
        THEN (e.data_nascimento - n.data_encontro) END AS dias_incubacao
    FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id
    LEFT JOIN vw_ninho_ovos ov         ON ov.ninho_id = n.id
    LEFT JOIN praias_monitoramento p   ON p.id = n.praia_id
    LEFT JOIN praias_monitoramento pa  ON pa.id = n.praia_atual_id
    LEFT JOIN unidades_conservacao uc  ON uc.id = COALESCE(n.uc_id, p.uc_id)
    LEFT JOIN unidades_conservacao puc ON puc.id = pa.uc_id
    LEFT JOIN monitores_biodiversidade mb ON mb.id = n.monitor_id
    LEFT JOIN grupos_biomonitor gb     ON gb.id = n.grupo_id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, filhotes_anomalia, anomalia_tipos, predacao, data_nascimento
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
  ),
  agg AS (
    SELECT
      COUNT(*) AS total_ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado') AND conta_ecl) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'eclodido' AND conta_ecl)    AS eclodidos_status,
      COUNT(*) FILTER (WHERE status = 'em_bercario' AND conta_ecl) AS em_bercario,
      COUNT(*) FILTER (WHERE status = 'soltado' AND conta_ecl)     AS soltados,
      COUNT(*) FILTER (WHERE status = 'perdido' AND conta_nidif) AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido' AND conta_nidif) AS transferidos,
      COUNT(*) FILTER (WHERE status = 'encontrado' AND conta_nidif) AS pendentes,
      COALESCE(SUM(qtd_ovos) FILTER (WHERE conta_nidif), 0) AS total_ovos_postura,
      COALESCE(SUM(ovos_integros) FILTER (WHERE conta_nidif), 0) AS total_ovos_integros,
      COALESCE(SUM(ovos_descartados) FILTER (WHERE conta_nidif), 0) AS total_ovos_descartados,
      COALESCE(SUM(ovos_predados) FILTER (WHERE conta_nidif), 0) AS total_ovos_predados,
      COALESCE(SUM(ovos_viaveis_ninho) FILTER (WHERE conta_nidif), 0) AS total_ovos_viaveis,
      COALESCE(SUM(ovos_perda_alagamento) FILTER (WHERE conta_nidif), 0) AS total_ovos_perda_alagamento,
      COALESCE(SUM(ovos_perda_erosao) FILTER (WHERE conta_nidif), 0)     AS total_ovos_perda_erosao,
      COALESCE(SUM(ovos_perda_humana) FILTER (WHERE conta_nidif), 0)     AS total_ovos_perda_humana,
      COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) AS total_filhotes_vivos,
      COALESCE(SUM(filhotes_mortos) FILTER (WHERE conta_ecl), 0) AS total_filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos) FILTER (WHERE conta_ecl), 0) AS total_ovos_nao_nascidos,
      COALESCE(SUM(filhotes_anomalia) FILTER (WHERE conta_ecl), 0) AS total_filhotes_anomalia,
      ROUND(AVG(qtd_ovos) FILTER (WHERE conta_nidif)::numeric, 1) AS media_ovos_postura,
      ROUND(AVG(dist_rio_m) FILTER (WHERE conta_nidif)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(temperatura_c) FILTER (WHERE conta_nidif)::numeric, 1) AS temp_media_c,
      ROUND(AVG(umidade_pct) FILTER (WHERE conta_nidif)::numeric, 1) AS umidade_media_pct,
      ROUND(AVG(profundidade_cm) FILTER (WHERE conta_nidif)::numeric, 1) AS profundidade_media_cm,
      ROUND(AVG(dias_incubacao) FILTER (WHERE conta_ecl)::numeric) AS incubacao_media_dias,
      COUNT(*) FILTER (WHERE predacao = 'por_pessoas' AND conta_ecl) AS predacao_pessoas,
      COUNT(*) FILTER (WHERE predacao = 'por_animais' AND conta_ecl) AS predacao_animais,
      COUNT(*) FILTER (WHERE predacao = 'nenhuma' AND conta_ecl) AS sem_predacao
    FROM base
  ),
  por_mes AS (
    SELECT to_char(date_trunc('month', data_encontro), 'YYYY-MM') AS mes,
      COUNT(*) FILTER (WHERE conta_nidif) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado') AND conta_ecl) AS eclodidos,
      COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) AS filhotes,
      ROUND(AVG(qtd_ovos) FILTER (WHERE conta_nidif)::numeric, 1) AS media_ovos
    FROM base WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro) ORDER BY date_trunc('month', data_encontro)
  ),
  por_ano AS (
    SELECT EXTRACT(YEAR FROM data_encontro)::int AS ano,
      COUNT(*) FILTER (WHERE conta_nidif) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado') AND conta_ecl) AS eclodidos,
      COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) AS filhotes,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos) FILTER (WHERE conta_ecl), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE data_encontro IS NOT NULL GROUP BY EXTRACT(YEAR FROM data_encontro) ORDER BY ano
  ),
  por_especie AS (
    SELECT especie,
      COUNT(*) FILTER (WHERE conta_nidif) AS total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado') AND conta_ecl) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido' AND conta_nidif) AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido' AND conta_nidif) AS transferidos,
      COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) AS filhotes_vivos,
      COALESCE(SUM(filhotes_mortos) FILTER (WHERE conta_ecl), 0) AS filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos) FILTER (WHERE conta_ecl), 0) AS ovos_nao_nascidos,
      COALESCE(SUM(filhotes_anomalia) FILTER (WHERE conta_ecl), 0) AS filhotes_anomalia,
      ROUND(AVG(qtd_ovos) FILTER (WHERE conta_nidif)::numeric, 1) AS media_ovos_postura,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos) FILTER (WHERE conta_ecl), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) / NULLIF(COALESCE(SUM(ovos_integros) FILTER (WHERE conta_ecl), 0), 0), 1) AS eficiencia_pct,
      ROUND(AVG(dias_incubacao) FILTER (WHERE conta_ecl)::numeric) AS incubacao_media_dias,
      ROUND(AVG(dist_rio_m) FILTER (WHERE conta_nidif)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(temperatura_c) FILTER (WHERE conta_nidif)::numeric, 1) AS temp_media_c
    FROM base GROUP BY especie ORDER BY total DESC
  ),
  -- Por praia: NIDIFICAÇÃO (origem) e ECLOSÃO (praia atual) separadas,
  -- reunidas por FULL OUTER JOIN — um berçário que só recebe aparece
  -- com ninhos_total=0 mas eclodidos/filhotes>0.
  por_praia_nidif AS (
    SELECT praia_id, praia_nome, praia_codigo, uc_nome, uc_sigla,
      MAX(comprimento_m) AS comprimento_m, COUNT(*) AS ninhos_total,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos,
      COUNT(*) FILTER (WHERE predacao IN ('por_pessoas','por_animais')) AS com_predacao
    FROM base WHERE praia_id IS NOT NULL AND conta_nidif
    GROUP BY praia_id, praia_nome, praia_codigo, uc_nome, uc_sigla
  ),
  por_praia_ecl AS (
    SELECT praia_atual_id AS praia_id,
      MAX(praia_atual_nome) AS praia_atual_nome,
      MAX(praia_atual_codigo) AS praia_atual_codigo,
      MAX(praia_atual_uc_nome) AS uc_nome, MAX(praia_atual_uc_sigla) AS uc_sigla,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE praia_atual_id IS DISTINCT FROM praia_id) AS ninhos_recebidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE praia_atual_id IS NOT NULL AND conta_ecl
    GROUP BY praia_atual_id
  ),
  por_praia AS (
    SELECT
      COALESCE(nid.praia_id, ecl.praia_id) AS praia_id,
      COALESCE(nid.praia_nome, ecl.praia_atual_nome) AS praia_nome,
      COALESCE(nid.praia_codigo, ecl.praia_atual_codigo) AS praia_codigo,
      COALESCE(nid.uc_nome, ecl.uc_nome) AS uc_nome,
      COALESCE(nid.uc_sigla, ecl.uc_sigla) AS uc_sigla,
      nid.comprimento_m,
      COALESCE(nid.ninhos_total, 0) AS ninhos_total,
      COALESCE(ecl.ninhos_recebidos, 0) AS ninhos_recebidos,
      COALESCE(ecl.eclodidos, 0) AS eclodidos,
      COALESCE(nid.perdidos, 0) AS perdidos,
      COALESCE(ecl.filhotes_vivos, 0) AS filhotes_vivos,
      ecl.taxa_eclosao_pct,
      nid.dist_rio_media_m, nid.media_ovos,
      COALESCE(nid.com_predacao, 0) AS com_predacao,
      ROUND(CASE WHEN nid.comprimento_m > 0 THEN 1000.0 * nid.ninhos_total / nid.comprimento_m END::numeric, 2) AS densidade_ninhos_km
    FROM por_praia_nidif nid
    FULL OUTER JOIN por_praia_ecl ecl ON ecl.praia_id = nid.praia_id
    ORDER BY COALESCE(nid.ninhos_total, 0) DESC, COALESCE(ecl.eclodidos, 0) DESC
  ),
  por_uc AS (
    SELECT uc_id, uc_nome, uc_sigla,
      COUNT(*) FILTER (WHERE conta_nidif) AS ninhos_total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado') AND conta_ecl) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido' AND conta_nidif) AS perdidos,
      COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos) FILTER (WHERE conta_ecl), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(AVG(qtd_ovos) FILTER (WHERE conta_nidif)::numeric, 1) AS media_ovos
    FROM base WHERE uc_id IS NOT NULL GROUP BY uc_id, uc_nome, uc_sigla ORDER BY ninhos_total DESC
  ),
  por_monitor AS (
    SELECT monitor_id, monitor_nome, grupo_nome,
      COUNT(*) FILTER (WHERE conta_nidif) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado') AND conta_ecl) AS eclodidos,
      COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos) FILTER (WHERE conta_ecl), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos) FILTER (WHERE conta_ecl), 0), 0), 1) AS taxa_eclosao_pct
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
  ),
  descartes_por_causa AS (
    SELECT COALESCE(d.causa::text, d.motivo::text, '—') AS causa, COALESCE(SUM(d.qtd),0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY COALESCE(d.causa::text, d.motivo::text, '—') ORDER BY qtd DESC
  ),
  descartes_por_etapa AS (
    SELECT COALESCE(d.etapa, '—') AS etapa, COALESCE(SUM(d.qtd),0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY d.etapa ORDER BY qtd DESC
  ),
  ninhos_destruidos_causa AS (
    SELECT COALESCE(v.causa_destruicao::text, '—') AS causa, COUNT(DISTINCT v.ninho_id) AS n
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
    WHERE v.status_ninho = 'destruido'
    GROUP BY v.causa_destruicao ORDER BY n DESC
  ),
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
    FROM base_ids bi JOIN solturas_filhotes sf ON sf.ninho_id = bi.id
  ),
  anomalia_por_tipo AS (
    SELECT t.tipo::text AS tipo, COUNT(*) AS n_eclosoes
    FROM base b, UNNEST(b.anomalia_tipos) AS t(tipo)
    WHERE b.filhotes_anomalia > 0 AND b.conta_ecl
    GROUP BY t.tipo ORDER BY n_eclosoes DESC
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
        'total_ovos_perda_alagamento', a.total_ovos_perda_alagamento,
        'total_ovos_perda_erosao', a.total_ovos_perda_erosao,
        'total_ovos_perda_humana', a.total_ovos_perda_humana,
        'total_filhotes_vivos', a.total_filhotes_vivos,
        'total_filhotes_vivos_liquido', GREATEST(a.total_filhotes_vivos - bmc.total_mortes, 0),
        'total_filhotes_mortos', a.total_filhotes_mortos,
        'total_filhotes_anomalia', a.total_filhotes_anomalia,
        'taxa_anomalia_pct', ROUND(100.0 * a.total_filhotes_anomalia / NULLIF(a.total_filhotes_vivos, 0), 1),
        'total_ovos_nao_nascidos', a.total_ovos_nao_nascidos, 'media_ovos_postura', a.media_ovos_postura,
        'dist_rio_media_m', a.dist_rio_media_m, 'temp_media_c', a.temp_media_c,
        'umidade_media_pct', a.umidade_media_pct, 'profundidade_media_cm', a.profundidade_media_cm,
        'incubacao_media_dias', a.incubacao_media_dias,
        'taxa_eclosao_pct', ROUND(100.0 * a.total_filhotes_vivos / NULLIF(a.total_filhotes_vivos + a.total_filhotes_mortos + a.total_ovos_nao_nascidos, 0), 1),
        'taxa_mortalidade_embrionaria_pct', ROUND(100.0 * (a.total_filhotes_mortos + a.total_ovos_nao_nascidos) / NULLIF(a.total_filhotes_vivos + a.total_filhotes_mortos + a.total_ovos_nao_nascidos, 0), 1),
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
    'bercario_soltos_por_especie', (SELECT jsonb_agg(row_to_json(se)) FROM soltos_especie se),
    'taxa_soltura_por_bercario',   (SELECT jsonb_agg(row_to_json(tb)) FROM taxa_soltura_bercario tb),
    'taxa_soltura_por_especie',    (SELECT jsonb_agg(row_to_json(te)) FROM taxa_soltura_especie te),
    'crescimento_por_especie',     (SELECT jsonb_agg(row_to_json(ce)) FROM crescimento_especie ce),
    'ganho_por_bercario',          (SELECT jsonb_agg(row_to_json(gb)) FROM ganho_bercario gb),
    'descartes_por_causa', (SELECT jsonb_agg(row_to_json(dc)) FROM descartes_por_causa dc),
    'descartes_por_etapa', (SELECT jsonb_agg(row_to_json(de)) FROM descartes_por_etapa de),
    'ninhos_destruidos_por_causa', (SELECT jsonb_agg(row_to_json(nd)) FROM ninhos_destruidos_causa nd),
    'anomalia_por_tipo', (SELECT jsonb_agg(row_to_json(at)) FROM anomalia_por_tipo at),
    'predacao_fases', jsonb_build_object(
      'incubacao', (SELECT row_to_json(pi) FROM pred_incub pi),
      'eclosao',   (SELECT jsonb_build_object('por_pessoas', a.predacao_pessoas, 'por_animais', a.predacao_animais) FROM agg a),
      'soltura',   (SELECT row_to_json(ps) FROM pred_solt ps)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
