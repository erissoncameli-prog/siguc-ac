-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Eclosão à praia de destino (parte 2)
-- ───────────────────────────────────────────────────────────
-- Continuação da 334 (bio_relatorio_completo). Aplica a MESMA regra —
-- nidificação/contagem pela ORIGEM (praia_id), eclosão/filhotes/taxa
-- pela praia ATUAL onde o ninho eclodiu (praia_atual_id) — às demais
-- superfícies do checklist de ovos/filhotes:
--   • mapa da mesa      → bio_mapa_praias (refina a 333)
--   • mesa/admin        → vw_praias_biomonitor
--   • Análise Científica→ bio_analise_praias
--   • Painel de praias  → bio_dashboard_praias
-- Praia que só recebe (berçário) passa a ter taxa/filhotes; praia que
-- transferiu mantém a contagem de desova (rastreabilidade) mas não
-- ganha crédito de eclosão pelos ninhos que enviou.
-- ═══════════════════════════════════════════════════════════

-- ── 1. bio_mapa_praias (refina a 333) ─────────────────────────
CREATE OR REPLACE FUNCTION public.bio_mapa_praias(
  p_temporada_id uuid DEFAULT NULL::uuid,
  p_programa_id uuid DEFAULT NULL::uuid,
  p_uc_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH ninhos_filtrados AS (
    SELECT
      n.id, n.praia_id, n.praia_atual_id, n.status, n.especie,
      n.qtd_ovos, n.ovos_integros, n.dist_rio_m, n.temperatura_c, n.umidade_pct,
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos,
      (SELECT COALESCE(SUM(d.qtd),0) FROM descartes_ovos d WHERE d.ninho_id = n.id)                          AS descartes_total,
      (SELECT COALESCE(SUM(d.qtd),0) FROM descartes_ovos d WHERE d.ninho_id = n.id AND d.motivo = 'predacao') AS predados_total
    FROM ninhos_quelonios n
    LEFT JOIN eclosoes_ninho e ON e.ninho_id = n.id
    WHERE n.status_validacao != 'rejeitado'
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),
  -- Cada ninho na origem (nidificação) e na praia atual (quando difere).
  -- recebido = está aqui vindo de outra praia; conta_ecl = esta é a praia
  -- onde ele incuba/eclode (recebe crédito de eclosão).
  ninhos_atrib AS (
    SELECT praia_id AS praia_ref, false AS recebido, true AS conta_ecl,
           id, status, especie, qtd_ovos, ovos_integros, descartes_total, predados_total,
           filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, dist_rio_m, temperatura_c, umidade_pct
      FROM ninhos_filtrados
     WHERE praia_atual_id IS NOT DISTINCT FROM praia_id OR praia_atual_id IS NULL
    UNION ALL
    -- Ninho transferido: linha de ORIGEM (nidificação, sem eclosão)
    SELECT praia_id AS praia_ref, false AS recebido, false AS conta_ecl,
           id, status, especie, qtd_ovos, ovos_integros, descartes_total, predados_total,
           filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, dist_rio_m, temperatura_c, umidade_pct
      FROM ninhos_filtrados
     WHERE praia_atual_id IS DISTINCT FROM praia_id AND praia_atual_id IS NOT NULL
    UNION ALL
    -- Ninho transferido: linha de DESTINO (recebido, com eclosão)
    SELECT praia_atual_id AS praia_ref, true AS recebido, true AS conta_ecl,
           id, status, especie, qtd_ovos, ovos_integros, descartes_total, predados_total,
           filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, dist_rio_m, temperatura_c, umidade_pct
      FROM ninhos_filtrados
     WHERE praia_atual_id IS DISTINCT FROM praia_id AND praia_atual_id IS NOT NULL
  ),
  stats AS (
    SELECT
      nf.praia_ref                                                       AS praia_id,
      COUNT(*)                                                           AS ninhos_total,
      COUNT(*) FILTER (WHERE nf.status = 'encontrado'  AND NOT nf.recebido) AS ninhos_encontrados,
      COUNT(*) FILTER (WHERE nf.status = 'transferido' AND NOT nf.recebido) AS ninhos_transferidos,
      COUNT(*) FILTER (WHERE nf.status IN ('eclodido','em_bercario','soltado') AND nf.conta_ecl) AS ninhos_eclodidos,
      COUNT(*) FILTER (WHERE nf.status = 'perdido'     AND NOT nf.recebido) AS ninhos_perdidos,
      COUNT(*) FILTER (WHERE nf.recebido)                                AS ninhos_recebidos,
      COALESCE(SUM(nf.qtd_ovos)      FILTER (WHERE NOT nf.recebido), 0)  AS ovos_postura,
      COALESCE(SUM(nf.ovos_integros) FILTER (WHERE NOT nf.recebido), 0)  AS ovos_integros,
      COALESCE(SUM(nf.predados_total) FILTER (WHERE NOT nf.recebido), 0) AS ovos_predados,
      GREATEST(COALESCE(SUM(nf.qtd_ovos) FILTER (WHERE NOT nf.recebido), 0) - COALESCE(SUM(nf.descartes_total) FILTER (WHERE NOT nf.recebido), 0), 0) AS ovos_viaveis,
      COALESCE(SUM(nf.filhotes_vivos)  FILTER (WHERE nf.conta_ecl), 0)   AS filhotes_vivos,
      COALESCE(SUM(nf.filhotes_mortos) FILTER (WHERE nf.conta_ecl), 0)   AS filhotes_mortos,
      ROUND(
        100.0 * COALESCE(SUM(nf.filhotes_vivos) FILTER (WHERE nf.conta_ecl), 0) /
        NULLIF(COALESCE(SUM(nf.filhotes_vivos + nf.filhotes_mortos + nf.ovos_nao_nascidos) FILTER (WHERE nf.conta_ecl), 0), 0)
      , 1)                                                               AS taxa_eclosao_pct,
      ROUND(AVG(nf.dist_rio_m)   FILTER (WHERE NOT nf.recebido)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(nf.temperatura_c) FILTER (WHERE NOT nf.recebido)::numeric, 1) AS temp_media_c,
      ROUND(AVG(nf.umidade_pct)  FILTER (WHERE NOT nf.recebido)::numeric, 1) AS umidade_media
    FROM ninhos_atrib nf
    GROUP BY nf.praia_ref
  ),
  esp_stats AS (
    SELECT
      nf.praia_ref AS praia_id,
      jsonb_agg(
        jsonb_build_object('especie', nf.especie, 'total', cnt)
        ORDER BY cnt DESC
      ) AS por_especie
    FROM (
      SELECT praia_ref, especie, COUNT(*) AS cnt
      FROM ninhos_atrib
      GROUP BY praia_ref, especie
    ) nf
    GROUP BY nf.praia_ref
  ),
  hist_stats AS (
    SELECT
      h.praia_id,
      jsonb_agg(
        jsonb_build_object('ano', h.ano, 'ninhos', h.cnt, 'filhotes', h.fil)
        ORDER BY h.ano
      ) AS historico_anual
    FROM (
      SELECT
        n.praia_id,
        EXTRACT(YEAR FROM n.data_encontro)::int  AS ano,
        COUNT(*)                                  AS cnt,
        COALESCE(SUM(e.filhotes_vivos), 0)        AS fil
      FROM ninhos_quelonios n
      LEFT JOIN eclosoes_ninho e ON e.ninho_id = n.id
      WHERE n.status_validacao != 'rejeitado'
      GROUP BY n.praia_id, EXTRACT(YEAR FROM n.data_encontro)
    ) h
    GROUP BY h.praia_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',                p.id,
      'codigo',            p.codigo,
      'nome',              p.nome,
      'sigla',             p.sigla,
      'comunidade',        p.comunidade,
      'municipio',         p.municipio,
      'uc_id',             p.uc_id,
      'uc_nome',           uc.nome,
      'uc_sigla',          uc.sigla,
      'programa_id',       p.programa_id,
      'programa_nome',     prog.nome,
      'comprimento_m',     p.comprimento_m,
      'area_ha',           p.area_ha,
      'lat',               CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_Y(p.ponto_acesso) END,
      'lng',               CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_X(p.ponto_acesso) END,
      'area_geojson',      CASE WHEN p.area_geom IS NOT NULL THEN ST_AsGeoJSON(p.area_geom)::jsonb END,
      'experimental',      p.experimental,
      'ninhos_total',      COALESCE(s.ninhos_total, 0),
      'ninhos_encontrados', COALESCE(s.ninhos_encontrados, 0),
      'ninhos_transferidos', COALESCE(s.ninhos_transferidos, 0),
      'ninhos_recebidos',  COALESCE(s.ninhos_recebidos, 0),
      'ninhos_eclodidos',  COALESCE(s.ninhos_eclodidos, 0),
      'ninhos_perdidos',   COALESCE(s.ninhos_perdidos, 0),
      'ovos_postura',      COALESCE(s.ovos_postura, 0),
      'ovos_integros',     COALESCE(s.ovos_integros, 0),
      'ovos_predados',     COALESCE(s.ovos_predados, 0),
      'ovos_viaveis',      COALESCE(s.ovos_viaveis, 0),
      'filhotes_vivos',    COALESCE(s.filhotes_vivos, 0),
      'filhotes_mortos',   COALESCE(s.filhotes_mortos, 0),
      'taxa_eclosao_pct',  s.taxa_eclosao_pct,
      'dist_rio_media_m',  s.dist_rio_media_m,
      'temp_media_c',      s.temp_media_c,
      'umidade_media',     s.umidade_media,
      'por_especie',       COALESCE(es.por_especie, '[]'::jsonb),
      'historico_anual',   COALESCE(h.historico_anual, '[]'::jsonb)
    )
    ORDER BY p.nome
  ) INTO v_result
  FROM praias_monitoramento p
  LEFT JOIN unidades_conservacao uc     ON uc.id = p.uc_id
  LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
  LEFT JOIN stats     s   ON s.praia_id  = p.id
  LEFT JOIN esp_stats es  ON es.praia_id = p.id
  LEFT JOIN hist_stats h  ON h.praia_id  = p.id
  WHERE p.ativa = true
    AND (p_programa_id IS NULL OR p.programa_id = p_programa_id)
    AND (p_uc_id IS NULL OR p.uc_id = p_uc_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ── 2. bio_analise_praias ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bio_analise_praias(
  p_temporada_id uuid DEFAULT NULL::uuid,
  p_programa_id uuid DEFAULT NULL::uuid,
  p_uc_id uuid DEFAULT NULL::uuid,
  p_praia_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result  jsonb;
  v_ini     date;
  v_fim     date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  IF p_temporada_id IS NOT NULL THEN
    SELECT data_inicio, data_fim INTO v_ini, v_fim
      FROM temporadas_biomonitor WHERE id = p_temporada_id;
  END IF;

  WITH praias_base AS (
    SELECT p.*
    FROM praias_monitoramento p
    WHERE (p_programa_id IS NULL OR p.programa_id = p_programa_id)
      AND (p_uc_id IS NULL OR p.uc_id = p_uc_id)
      AND (p_praia_id IS NULL OR p.id = p_praia_id)
  ),
  -- Nidificação por ORIGEM (praia_id)
  nidif_praia AS (
    SELECT n.praia_id,
      COUNT(*)                                    AS ninhos_total,
      COUNT(*) FILTER (WHERE n.status = 'perdido') AS perdidos
    FROM ninhos_quelonios n
    WHERE (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id OR n.praia_atual_id = p_praia_id)
    GROUP BY n.praia_id
  ),
  -- Eclosão pela praia ATUAL (onde eclodiu)
  ecl_praia AS (
    SELECT n.praia_atual_id AS praia_id,
      COUNT(*) FILTER (WHERE n.status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE n.praia_atual_id IS DISTINCT FROM n.praia_id)      AS recebidos,
      COALESCE(SUM(e.filhotes_vivos), 0)          AS filhotes_vivos,
      COALESCE(SUM(e.filhotes_mortos), 0)         AS filhotes_mortos,
      COALESCE(SUM(e.ovos_nao_nascidos), 0)       AS ovos_nao_nascidos
    FROM ninhos_quelonios n
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
    WHERE (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id OR n.praia_atual_id = p_praia_id)
      AND n.praia_atual_id IS NOT NULL
    GROUP BY n.praia_atual_id
  ),
  praias AS (
    SELECT
      pb.id, pb.nome, pb.codigo, pb.municipio, pb.comunidade, pb.rio,
      pb.tipo_localizacao, pb.ativa, pb.experimental,
      pb.comprimento_m, pb.area_ha,
      pb.periodo_inicio, pb.periodo_fim,
      (pb.area_geom IS NOT NULL)  AS tem_poligono,
      uc.nome AS uc_nome, uc.sigla AS uc_sigla,
      COALESCE(nd.ninhos_total, 0)      AS ninhos_total,
      COALESCE(ec.recebidos, 0)         AS ninhos_recebidos,
      COALESCE(ec.eclodidos, 0)         AS eclodidos,
      COALESCE(nd.perdidos, 0)          AS perdidos,
      COALESCE(ec.filhotes_vivos, 0)    AS filhotes_vivos,
      ROUND(
        100.0 * COALESCE(ec.filhotes_vivos, 0) /
        NULLIF(COALESCE(ec.filhotes_vivos, 0) + COALESCE(ec.filhotes_mortos, 0) + COALESCE(ec.ovos_nao_nascidos, 0), 0)
      , 1)                               AS taxa_eclosao_pct,
      CASE WHEN pb.comprimento_m > 0
        THEN ROUND((1000.0 * COALESCE(nd.ninhos_total, 0) / pb.comprimento_m)::numeric, 2) END AS densidade_ninhos_km,
      CASE WHEN pb.area_ha > 0
        THEN ROUND((COALESCE(nd.ninhos_total, 0) / pb.area_ha)::numeric, 2) END               AS densidade_ninhos_ha
    FROM praias_base pb
    LEFT JOIN unidades_conservacao uc ON uc.id = pb.uc_id
    LEFT JOIN nidif_praia nd ON nd.praia_id = pb.id
    LEFT JOIN ecl_praia   ec ON ec.praia_id = pb.id
  ),
  resumo AS (
    SELECT
      COUNT(*)                                                   AS total_praias,
      COUNT(*) FILTER (WHERE ativa)                              AS praias_ativas,
      COUNT(*) FILTER (WHERE experimental)                       AS praias_experimentais,
      COALESCE(SUM(comprimento_m), 0)                            AS comprimento_total_m,
      COALESCE(SUM(area_ha), 0)                                  AS area_total_ha,
      COUNT(*) FILTER (WHERE ninhos_total > 0)                   AS praias_com_ninhos,
      COUNT(*) FILTER (WHERE ninhos_total = 0)                   AS praias_sem_ninhos,
      SUM(ninhos_total)                                          AS ninhos_total_rede
    FROM praias
  ),
  por_tipo AS (
    SELECT COALESCE(tipo_localizacao::text, '—') AS tipo, COUNT(*) AS n,
      COALESCE(SUM(ninhos_total), 0) AS ninhos
    FROM praias GROUP BY tipo_localizacao ORDER BY n DESC
  ),
  alertas AS (
    SELECT
      COUNT(*) FILTER (WHERE comprimento_m IS NULL OR area_ha IS NULL)         AS sem_dimensoes,
      COUNT(*) FILTER (WHERE NOT tem_poligono)                                 AS sem_poligono,
      COUNT(*) FILTER (WHERE periodo_inicio IS NULL OR periodo_fim IS NULL)    AS sem_periodo,
      COUNT(*) FILTER (
        WHERE v_ini IS NOT NULL AND periodo_inicio IS NOT NULL
          AND (periodo_fim < v_ini OR periodo_inicio > v_fim)
      )                                                                        AS periodo_desalinhado
    FROM praias
  ),
  praias_alerta_dim AS (
    SELECT nome FROM praias WHERE comprimento_m IS NULL OR area_ha IS NULL ORDER BY nome
  ),
  praias_alerta_periodo AS (
    SELECT nome FROM praias
    WHERE v_ini IS NOT NULL AND periodo_inicio IS NOT NULL
      AND (periodo_fim < v_ini OR periodo_inicio > v_fim)
    ORDER BY nome
  ),
  praias_sem_ninho AS (
    SELECT nome FROM praias WHERE ninhos_total = 0 AND ninhos_recebidos = 0 ORDER BY nome
  )
  SELECT jsonb_build_object(
    'resumo', (SELECT row_to_json(r) FROM resumo r),
    'por_tipo', (SELECT jsonb_agg(row_to_json(t)) FROM por_tipo t),
    'praias', (SELECT jsonb_agg(row_to_json(p) ORDER BY p.ninhos_total DESC) FROM praias p),
    'alertas', jsonb_build_object(
      'contagens', (SELECT row_to_json(a) FROM alertas a),
      'praias_sem_dimensoes', (SELECT jsonb_agg(nome) FROM praias_alerta_dim),
      'praias_periodo_desalinhado', (SELECT jsonb_agg(nome) FROM praias_alerta_periodo),
      'praias_sem_ninho', (SELECT jsonb_agg(nome) FROM praias_sem_ninho)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- ── 3. bio_dashboard_praias ───────────────────────────────────
-- Nidificação/ovos por ORIGEM; eclosão (eclodidos/filhotes/sucesso_pct)
-- pela praia ATUAL. As duas metades reunidas por praia.
CREATE OR REPLACE FUNCTION public.bio_dashboard_praias(
  p_temporada_id uuid DEFAULT NULL::uuid,
  p_especie especie_quelonio DEFAULT NULL::especie_quelonio,
  p_praia_id uuid DEFAULT NULL::uuid,
  p_comunidade text DEFAULT NULL::text,
  p_uc_id uuid DEFAULT NULL::uuid,
  p_municipio text DEFAULT NULL::text,
  p_data_inicio date DEFAULT NULL::date,
  p_data_fim date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo_id uuid;
  v_gestor   boolean := false;
  v_result   jsonb;
BEGIN
  SELECT grupo_id INTO v_grupo_id
    FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo' LIMIT 1;

  SELECT EXISTS (SELECT 1 FROM usuarios
                  WHERE id = auth.uid()
                    AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
    INTO v_gestor;

  IF v_grupo_id IS NULL AND NOT v_gestor THEN RETURN NULL; END IF;

  WITH base AS (
    SELECT
      n.id, n.praia_id, n.praia_atual_id, n.especie, n.status,
      n.qtd_ovos, n.data_prevista_eclosao,
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos, e.predacao,
      (e.ninho_id IS NOT NULL)                                   AS eclodiu,
      (e.ninho_id IS NOT NULL AND COALESCE(e.filhotes_vivos,0) = 0) AS falha_eclosao,
      (e.predacao IS NOT NULL AND e.predacao <> 'nenhuma')       AS predado_ecl,
      COALESCE(vis.alagado, false)                               AS inundado,
      COALESCE(vis.predado, false)                               AS predado_vis,
      ov.viaveis, ov.perdas_total,
      ov.perda_predacao, ov.perda_alagamento, ov.perda_erosao, ov.perda_humana
    FROM ninhos_quelonios n
    JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN vw_ninho_ovos ov ON ov.ninho_id = n.id
    LEFT JOIN LATERAL (
      SELECT ninho_id, filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
    LEFT JOIN LATERAL (
      SELECT
        bool_or(status_ninho = 'alagado' OR sinal_alagamento)        AS alagado,
        bool_or(status_ninho IN ('parcial_predado','destruido')
                OR predacao_incubacao <> 'nenhuma')                  AS predado
      FROM visitas_ninho WHERE ninho_id = n.id
    ) vis ON true
    WHERE (v_gestor OR n.grupo_id = v_grupo_id)
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_especie     IS NULL OR n.especie      = p_especie)
      AND (p_praia_id    IS NULL OR n.praia_id = p_praia_id OR n.praia_atual_id = p_praia_id)
      AND (p_comunidade  IS NULL OR p.comunidade   = p_comunidade)
      AND (p_uc_id       IS NULL OR n.uc_id        = p_uc_id)
      AND (p_municipio   IS NULL OR p.municipio    = p_municipio)
      AND (p_data_inicio IS NULL OR n.data_encontro >= p_data_inicio)
      AND (p_data_fim    IS NULL OR n.data_encontro <= p_data_fim)
  ),
  -- Nidificação por origem (contagem, ovos, incidências de sítio)
  nidif AS (
    SELECT
      b.praia_id,
      COUNT(*)                                                            AS total,
      COUNT(*) FILTER (WHERE b.status IN ('encontrado','transferido'))    AS ativos,
      COUNT(*) FILTER (WHERE b.status = 'transferido')                    AS transferidos,
      COUNT(*) FILTER (WHERE b.status = 'perdido')                        AS perdidos,
      COUNT(*) FILTER (WHERE b.inundado)                                  AS inundados,
      COUNT(*) FILTER (WHERE b.status IN ('encontrado','transferido')
                         AND b.data_prevista_eclosao
                             BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)   AS proximos_eclosao,
      COALESCE(SUM(b.qtd_ovos), 0)                                        AS ovos_monitorados,
      COALESCE(SUM(b.viaveis), 0)                                         AS ovos_viaveis,
      COALESCE(SUM(b.perdas_total), 0)                                    AS ovos_perdidos,
      COALESCE(SUM(b.perda_predacao), 0)                                  AS perdas_predacao,
      COALESCE(SUM(b.perda_alagamento), 0)                               AS perdas_alagamento,
      COALESCE(SUM(b.perda_erosao), 0)                                    AS perdas_erosao,
      COALESCE(SUM(b.perda_humana), 0)                                    AS perdas_humana
    FROM base b
    GROUP BY b.praia_id
  ),
  -- Eclosão pela praia atual (onde o ninho eclodiu)
  ecl AS (
    SELECT
      b.praia_atual_id AS praia_id,
      COUNT(*) FILTER (WHERE b.praia_atual_id IS DISTINCT FROM b.praia_id) AS recebidos,
      COUNT(*) FILTER (WHERE b.eclodiu)                                   AS eclodidos,
      COUNT(*) FILTER (WHERE b.predado_ecl OR b.predado_vis)              AS predados,
      COUNT(*) FILTER (WHERE b.falha_eclosao)                             AS falha_eclosao,
      COALESCE(SUM(b.filhotes_vivos), 0)                                  AS filhotes_produzidos,
      ROUND(100.0 * COALESCE(SUM(b.filhotes_vivos),0) /
        NULLIF(COALESCE(SUM(b.filhotes_vivos + b.filhotes_mortos + b.ovos_nao_nascidos),0),0),1) AS sucesso_pct
    FROM base b
    WHERE b.praia_atual_id IS NOT NULL
    GROUP BY b.praia_atual_id
  ),
  praias_ref AS (
    SELECT praia_id FROM nidif
    UNION
    SELECT praia_id FROM ecl
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'praia_id', p.id, 'praia', p.nome, 'sigla', p.sigla,
    'comunidade', p.comunidade, 'municipio', p.municipio,
    'uc_id', p.uc_id, 'uc_nome', uc.nome, 'experimental', p.experimental,
    'total', COALESCE(nd.total, 0), 'ativos', COALESCE(nd.ativos, 0),
    'transferidos', COALESCE(nd.transferidos, 0),
    'recebidos', COALESCE(ec.recebidos, 0),
    'eclodidos', COALESCE(ec.eclodidos, 0), 'perdidos', COALESCE(nd.perdidos, 0),
    'predados', COALESCE(ec.predados, 0),
    'inundados', COALESCE(nd.inundados, 0), 'falha_eclosao', COALESCE(ec.falha_eclosao, 0),
    'proximos_eclosao', COALESCE(nd.proximos_eclosao, 0), 'sucesso_pct', ec.sucesso_pct,
    'filhotes_produzidos', COALESCE(ec.filhotes_produzidos, 0), 'ovos_monitorados', COALESCE(nd.ovos_monitorados, 0),
    'ovos_viaveis', COALESCE(nd.ovos_viaveis, 0), 'ovos_perdidos', COALESCE(nd.ovos_perdidos, 0),
    'perdas_predacao', COALESCE(nd.perdas_predacao, 0), 'perdas_alagamento', COALESCE(nd.perdas_alagamento, 0),
    'perdas_erosao', COALESCE(nd.perdas_erosao, 0), 'perdas_humana', COALESCE(nd.perdas_humana, 0)
  ) ORDER BY p.nome), '[]'::jsonb)
  INTO v_result
  FROM praias_ref pr
  JOIN praias_monitoramento p ON p.id = pr.praia_id
  LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id
  LEFT JOIN nidif nd ON nd.praia_id = pr.praia_id
  LEFT JOIN ecl   ec ON ec.praia_id = pr.praia_id;

  RETURN v_result;
END;
$function$;

-- ── 4. vw_praias_biomonitor ───────────────────────────────────
-- Eclosão (filhotes/taxa/anomalia/predação na eclosão + ninhos_eclodidos)
-- passa a agregar pela praia ATUAL (x.praia_atual_id = p.id), onde o
-- ninho eclodiu; nidificação/ovos/dist_rio seguem pela origem (n via
-- LEFT JOIN por praia_id). ninhos_recebidos/incubando_aqui já existiam.
-- CREATE OR REPLACE preserva ordem/nome das colunas; security_invoker
-- é reaplicado (o replace derruba o reloption — lição da 322).
CREATE OR REPLACE VIEW vw_praias_biomonitor AS
SELECT p.id,
    p.codigo,
    p.nome,
    p.comunidade,
    p.municipio,
    p.uc_id,
    p.tipo_localizacao,
    p.localizacao_referencia,
        CASE
            WHEN p.tipo_localizacao = 'dentro_uc'::tipo_localizacao_praia THEN COALESCE(uc.nome, '—'::text)
            ELSE COALESCE(p.localizacao_referencia,
            CASE p.tipo_localizacao
                WHEN 'terra_indigena'::tipo_localizacao_praia THEN 'Terra Indígena'::text
                WHEN 'area_municipal'::tipo_localizacao_praia THEN 'Área Municipal'::text
                WHEN 'margem_livre'::tipo_localizacao_praia THEN 'Margem Livre'::text
                ELSE 'Outro'::text
            END)
        END AS area_display,
    p.programa_id,
    p.grupo_id,
    g.nome AS grupo_nome,
    p.monitor_responsavel_id,
    p.experimental,
    p.comprimento_m,
    p.area_ha,
    round(COALESCE(p.area_ha, 0::numeric) * 10000::numeric, 2) AS area_m2,
    p.periodo_inicio,
    p.periodo_fim,
    p.ativa,
        CASE
            WHEN p.ponto_acesso IS NOT NULL THEN st_y(p.ponto_acesso)
            ELSE NULL::double precision
        END AS lat,
        CASE
            WHEN p.ponto_acesso IS NOT NULL THEN st_x(p.ponto_acesso)
            ELSE NULL::double precision
        END AS lng,
    st_asgeojson(p.ponto_acesso) AS ponto_geojson,
    st_asgeojson(p.area_geom) AS area_geojson,
    p.sigla,
    m.nome_completo AS monitor_responsavel,
    uc.nome AS uc_nome,
    uc.sigla AS uc_sigla,
    prog.nome AS programa_nome,
    count(DISTINCT n.id) AS ninhos_total,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'encontrado'::status_ninho) AS ninhos_encontrados,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'transferido'::status_ninho) AS ninhos_transferidos,
    ( SELECT count(*) AS count
           FROM ninhos_quelonios x
          WHERE x.praia_atual_id = p.id AND x.status = ANY (ARRAY['eclodido'::status_ninho, 'em_bercario'::status_ninho, 'soltado'::status_ninho])) AS ninhos_eclodidos,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'perdido'::status_ninho) AS ninhos_perdidos,
    ( SELECT count(*) AS count
           FROM ninhos_quelonios x
          WHERE x.praia_id = p.id AND x.praia_atual_id = p.id) AS ninhos_proprios,
    ( SELECT count(*) AS count
           FROM ninhos_quelonios x
          WHERE x.praia_id = p.id AND x.praia_atual_id IS DISTINCT FROM p.id) AS ninhos_enviados,
    ( SELECT count(*) AS count
           FROM ninhos_quelonios x
          WHERE x.praia_atual_id = p.id AND x.praia_id IS DISTINCT FROM p.id) AS ninhos_recebidos,
    ( SELECT count(*) AS count
           FROM ninhos_quelonios x
          WHERE x.praia_atual_id = p.id) AS ninhos_incubando_aqui,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'tracaja'::especie_quelonio) AS ninhos_tracaja,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'tartaruga'::especie_quelonio) AS ninhos_tartaruga,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'cabecudo'::especie_quelonio) AS ninhos_cabecudo,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'pitiU'::especie_quelonio) AS ninhos_pitiu,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'cupido'::especie_quelonio) AS ninhos_cupido,
    count(DISTINCT n.id) FILTER (WHERE n.status_validacao = 'pendente'::status_validacao_bio) AS ninhos_pendentes_validacao,
    COALESCE(sum(n.qtd_ovos), 0::bigint) AS ovos_postura_total,
    COALESCE(sum(n.ovos_integros), 0::bigint) AS ovos_integros_total,
    COALESCE(sum(n.ovos_descartados), 0::bigint) AS ovos_descartados_total,
    round(avg(n.dist_rio_m), 1) AS dist_rio_media_m,
    ( SELECT COALESCE(sum(t.qtd_ovos), 0::bigint) AS "coalesce"
           FROM transferencias_ninho t
             JOIN ninhos_quelonios x ON x.id = t.ninho_id
          WHERE x.praia_id = p.id) AS ovos_transferidos,
    ( SELECT COALESCE(sum(e.filhotes_vivos), 0::bigint) AS "coalesce"
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_atual_id = p.id) AS filhotes_vivos,
    ( SELECT COALESCE(sum(e.filhotes_mortos), 0::bigint) AS "coalesce"
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_atual_id = p.id) AS filhotes_mortos,
    ( SELECT COALESCE(sum(e.ovos_nao_nascidos), 0::bigint) AS "coalesce"
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_atual_id = p.id) AS ovos_nao_nascidos,
    ( SELECT round(100.0 * COALESCE(sum(e.filhotes_vivos), 0::bigint)::numeric / NULLIF(COALESCE(sum(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0::bigint), 0)::numeric, 1) AS round
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_atual_id = p.id) AS taxa_eclosao_pct,
    ( SELECT count(*) AS count
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_atual_id = p.id AND e.predacao = 'por_pessoas'::predacao_ninho) AS predacao_pessoas,
    ( SELECT count(*) AS count
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_atual_id = p.id AND e.predacao = 'por_animais'::predacao_ninho) AS predacao_animais,
    ( SELECT COALESCE(sum(ov.viaveis), 0::numeric) AS "coalesce"
           FROM vw_ninho_ovos ov
             JOIN ninhos_quelonios x ON x.id = ov.ninho_id
          WHERE x.praia_id = p.id) AS ovos_viaveis_total,
    ( SELECT COALESCE(sum(ov.perdas_total), 0::numeric) AS "coalesce"
           FROM vw_ninho_ovos ov
             JOIN ninhos_quelonios x ON x.id = ov.ninho_id
          WHERE x.praia_id = p.id) AS ovos_perdidos_total,
    p.rio,
    ( SELECT COALESCE(sum(e.filhotes_anomalia), 0::bigint) AS "coalesce"
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_atual_id = p.id) AS filhotes_anomalia,
    count(DISTINCT n.id) FILTER (WHERE n.contagem_ovos_metodo = 'estimado'::metodo_contagem_ovos) AS ninhos_postura_estimada,
    count(DISTINCT n.id) FILTER (WHERE n.contagem_ovos_metodo = 'confirmado_eclosao'::metodo_contagem_ovos) AS ninhos_postura_confirmada,
    p.observacoes
   FROM praias_monitoramento p
     LEFT JOIN monitores_biodiversidade mb ON mb.id = p.monitor_responsavel_id
     LEFT JOIN usuarios m ON m.id = mb.usuario_id
     LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id
     LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
     LEFT JOIN grupos_biomonitor g ON g.id = p.grupo_id
     LEFT JOIN ninhos_quelonios n ON n.praia_id = p.id
  GROUP BY p.id, m.nome_completo, uc.id, prog.id, mb.id, g.id;

ALTER VIEW vw_praias_biomonitor SET (security_invoker = true);
