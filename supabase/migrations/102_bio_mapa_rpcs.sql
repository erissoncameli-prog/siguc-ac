-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — RPCs para Mapa Geoespacial
-- ───────────────────────────────────────────────────────────────
-- bio_mapa_praias  → polígonos + stats por praia + histórico anual
-- bio_mapa_ninhos  → pontos GPS dos ninhos com detalhes completos
-- ═══════════════════════════════════════════════════════════════

-- ── bio_mapa_praias ──────────────────────────────────────────────
-- Retorna array JSON com dados de cada praia ativa:
--   polígono GeoJSON, ponto de acesso, métricas filtradas por
--   temporada/programa/UC e histórico anual para comparação.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bio_mapa_praias(
  p_temporada_id uuid DEFAULT NULL,
  p_programa_id  uuid DEFAULT NULL,
  p_uc_id        uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH ninhos_filtrados AS (
    SELECT n.*, e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos
    FROM ninhos_quelonios n
    LEFT JOIN eclosoes_ninho e ON e.ninho_id = n.id
    WHERE n.status_validacao != 'rejeitado'
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),
  stats AS (
    SELECT
      nf.praia_id,
      COUNT(*)                                              AS ninhos_total,
      COUNT(*) FILTER (WHERE nf.status = 'encontrado')     AS ninhos_encontrados,
      COUNT(*) FILTER (WHERE nf.status = 'transferido')    AS ninhos_transferidos,
      COUNT(*) FILTER (WHERE nf.status = 'eclodido')       AS ninhos_eclodidos,
      COUNT(*) FILTER (WHERE nf.status = 'perdido')        AS ninhos_perdidos,
      COALESCE(SUM(nf.qtd_ovos), 0)                        AS ovos_postura,
      COALESCE(SUM(nf.ovos_integros), 0)                   AS ovos_integros,
      COALESCE(SUM(nf.filhotes_vivos), 0)                  AS filhotes_vivos,
      COALESCE(SUM(nf.filhotes_mortos), 0)                 AS filhotes_mortos,
      ROUND(
        100.0 * COALESCE(SUM(nf.filhotes_vivos), 0) /
        NULLIF(COALESCE(SUM(nf.filhotes_vivos + nf.filhotes_mortos + nf.ovos_nao_nascidos), 0), 0)
      , 1)                                                  AS taxa_eclosao_pct,
      ROUND(AVG(nf.dist_rio_m)::numeric, 1)                AS dist_rio_media_m,
      ROUND(AVG(nf.temperatura_c)::numeric, 1)             AS temp_media_c,
      ROUND(AVG(nf.umidade_pct)::numeric, 1)               AS umidade_media
    FROM ninhos_filtrados nf
    GROUP BY nf.praia_id
  ),
  esp_stats AS (
    SELECT
      nf.praia_id,
      jsonb_agg(
        jsonb_build_object('especie', nf.especie, 'total', cnt)
        ORDER BY cnt DESC
      ) AS por_especie
    FROM (
      SELECT praia_id, especie, COUNT(*) AS cnt
      FROM ninhos_filtrados
      GROUP BY praia_id, especie
    ) nf
    GROUP BY nf.praia_id
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
      'ninhos_eclodidos',  COALESCE(s.ninhos_eclodidos, 0),
      'ninhos_perdidos',   COALESCE(s.ninhos_perdidos, 0),
      'ovos_postura',      COALESCE(s.ovos_postura, 0),
      'ovos_integros',     COALESCE(s.ovos_integros, 0),
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
$$;

GRANT EXECUTE ON FUNCTION bio_mapa_praias(uuid, uuid, uuid) TO authenticated;

-- ── bio_mapa_ninhos ──────────────────────────────────────────────
-- Retorna array JSON com todos os ninhos que possuem GPS,
-- filtrados por praias, temporada, espécies, status e mês.
-- Inclui: transferência, eclosão, alertas, taxa eclosão calculada.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bio_mapa_ninhos(
  p_praia_ids    uuid[]  DEFAULT NULL,
  p_temporada_id uuid    DEFAULT NULL,
  p_especies     text[]  DEFAULT NULL,
  p_statuses     text[]  DEFAULT NULL,
  p_meses        int[]   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',               n.id,
      'numero_ninho',     n.numero_ninho,
      'especie',          n.especie,
      'praia_id',         n.praia_id,
      'praia_nome',       p.nome,
      'praia_sigla',      p.sigla,
      'uc_nome',          uc.nome,
      'uc_sigla',         uc.sigla,
      'monitor_nome',     mon.nome_completo,
      'grupo_nome',       g.nome,
      'data_encontro',    n.data_encontro,
      'status',           n.status,
      'status_validacao', n.status_validacao,
      'lat',              CASE WHEN n.localizacao IS NOT NULL THEN ST_Y(n.localizacao) END,
      'lng',              CASE WHEN n.localizacao IS NOT NULL THEN ST_X(n.localizacao) END,
      'precisao_gps_m',   n.precisao_gps_m,
      'qtd_ovos',         n.qtd_ovos,
      'ovos_integros',    n.ovos_integros,
      'ovos_descartados', n.ovos_descartados,
      'dist_rio_m',       n.dist_rio_m,
      'dist_rio_metodo',  n.dist_rio_metodo,
      'temperatura_c',    n.temperatura_c,
      'umidade_pct',      n.umidade_pct,
      'profundidade_cm',  n.profundidade_cm,
      'foto_urls',        n.foto_urls,
      'observacoes',      n.observacoes,
      -- Transferência (mais recente)
      'transferencia', (
        SELECT jsonb_build_object(
          'data',          t.data_transferencia,
          'qtd_ovos',      t.qtd_ovos,
          'local_destino', t.local_destino,
          'observacoes',   t.observacoes
        )
        FROM transferencias_ninho t
        WHERE t.ninho_id = n.id
        ORDER BY t.data_transferencia DESC
        LIMIT 1
      ),
      -- Eclosão
      'eclosao', (
        SELECT jsonb_build_object(
          'data',              e.data_nascimento,
          'filhotes_vivos',    e.filhotes_vivos,
          'filhotes_mortos',   e.filhotes_mortos,
          'ovos_nao_nascidos', e.ovos_nao_nascidos,
          'predacao',          e.predacao
        )
        FROM eclosoes_ninho e
        WHERE e.ninho_id = n.id
        LIMIT 1
      ),
      -- Taxa de eclosão calculada
      'taxa_eclosao_pct', (
        SELECT ROUND(
          100.0 * e.filhotes_vivos /
          NULLIF(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos, 0)
        , 1)
        FROM eclosoes_ninho e WHERE e.ninho_id = n.id LIMIT 1
      ),
      -- Dias de incubação
      'incubacao_dias', (
        SELECT (e.data_nascimento - n.data_encontro)
        FROM eclosoes_ninho e WHERE e.ninho_id = n.id LIMIT 1
      ),
      -- Eficiência do ninho
      'eficiencia_pct', (
        SELECT CASE WHEN n.ovos_integros > 0 THEN
          ROUND(100.0 * e.filhotes_vivos / n.ovos_integros, 1)
        END
        FROM eclosoes_ninho e WHERE e.ninho_id = n.id LIMIT 1
      ),
      -- Alertas ativos
      'alertas', (
        SELECT jsonb_agg(jsonb_build_object(
          'severidade',  a.severidade,
          'titulo',      a.titulo,
          'providencia', a.providencia,
          'status',      a.status
        ) ORDER BY
          CASE a.severidade WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END
        )
        FROM alertas_quelonios a
        WHERE a.ninho_id = n.id
          AND a.status NOT IN ('descartado', 'resolvido')
      )
    )
    ORDER BY n.data_encontro DESC
  ) INTO v_result
  FROM ninhos_quelonios n
  LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
  LEFT JOIN unidades_conservacao uc      ON uc.id = n.uc_id
  LEFT JOIN monitores_biodiversidade mb  ON mb.id = n.monitor_id
  LEFT JOIN usuarios mon                 ON mon.id = mb.usuario_id
  LEFT JOIN grupos_biomonitor g          ON g.id = n.grupo_id
  WHERE n.localizacao IS NOT NULL
    AND n.status_validacao != 'rejeitado'
    AND (p_praia_ids   IS NULL OR n.praia_id = ANY(p_praia_ids))
    AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
    AND (p_especies    IS NULL OR n.especie::text = ANY(p_especies))
    AND (p_statuses    IS NULL OR n.status::text  = ANY(p_statuses))
    AND (p_meses       IS NULL OR EXTRACT(MONTH FROM n.data_encontro)::int = ANY(p_meses));

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION bio_mapa_ninhos(uuid[], uuid, text[], text[], int[]) TO authenticated;
