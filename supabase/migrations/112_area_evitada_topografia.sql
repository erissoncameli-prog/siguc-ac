-- ════════════════════════════════════════════════════════════════
-- 112 — Incêndio Evitado (Fase 2): topografia no motor de sugestão
--
-- A Fase 1 (111) já alonga a área sugerida a favor do vento. Aqui
-- entra a TOPOGRAFIA: o fogo corre mais rápido e mais longe MORRO
-- ACIMA. O cliente amostra a elevação ao redor do ponto (API pública
-- de elevação, sem chave) e envia declividade (%) e aspecto (rumo de
-- descida) — mesmo padrão do vento.
--
-- Modelo: vento e declividade viram VETORES de espalhamento (em metros,
-- na projeção UTM local) e são SOMADOS. A cabeça da cápsula é deslocada
-- pelo vetor resultante — combinando as duas forças numa direção só.
--   • vento  → vetor a favor do vento, magnitude ∝ velocidade
--   • relevo → vetor morro acima (aspecto + 180°), magnitude ∝ declive
-- Sem vento e sem declive → círculo isotrópico (degradação segura).
--
-- Aditivo: recria sugerir_area_evitada com 2 parâmetros novos (com
-- default NULL), mantendo tudo o que a 111 fazia.
-- ════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS sugerir_area_evitada(uuid, numeric, numeric);

CREATE OR REPLACE FUNCTION sugerir_area_evitada(
  p_registro_id     uuid,
  p_vento_dir_graus numeric DEFAULT NULL,  -- direção DE ONDE o vento sopra (meteorológica)
  p_vento_kmh       numeric DEFAULT NULL,
  p_slope_pct       numeric DEFAULT NULL,  -- declividade média ao redor (%)
  p_aspect_graus    numeric DEFAULT NULL   -- aspecto: rumo de DESCIDA (bússola, 0=N)
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _perfil    text;
  _seed      geometry;
  _evento    timestamptz;
  _mes       int;
  _lon       numeric;
  _srid      int;
  _seed_m    geometry;
  _base      geometry;
  _head      geometry;
  _geom_m    geometry;
  _geom_out  geometry;
  _area_p75  numeric;
  _n_clust   int;
  _raio      numeric;
  _lb        numeric;
  _bear_w    numeric;   -- rumo a favor do vento (rad)
  _bear_u    numeric;   -- rumo morro acima (rad)
  _wx        numeric := 0;  -- vetor vento (m)
  _wy        numeric := 0;
  _sx        numeric := 0;  -- vetor relevo (m)
  _sy        numeric := 0;
  _dx        numeric;
  _dy        numeric;
  _dmag      numeric;
  _slope_f   numeric;
  _area_ha   numeric;
  _tem_vento boolean;
  _tem_slope boolean;
  _aniso     boolean;
BEGIN
  SELECT perfil INTO _perfil FROM usuarios WHERE id = auth.uid();
  IF _perfil NOT IN ('tecnico','gestor','super_admin','biologo') THEN
    RAISE EXCEPTION 'Sem permissão para sugerir área evitada';
  END IF;

  SELECT COALESCE(perimetro_geom_validado, perimetro_geom, localizacao),
         COALESCE(data_hora_evento, data_inicio::timestamptz, criado_em)
    INTO _seed, _evento
    FROM registros_campo
   WHERE id = p_registro_id;

  IF _seed IS NULL THEN
    RETURN jsonb_build_object('erro', 'sem_geometria',
      'msg', 'Registro sem ponto GPS nem perímetro — não há de onde partir.');
  END IF;

  _mes := EXTRACT(MONTH FROM _evento)::int;
  _lon := ST_X(ST_Centroid(_seed));
  _srid := CASE WHEN _lon >= -72 THEN 31979 ELSE 31978 END;  -- 19S / 18S

  -- Raio de propagação R pelo tamanho típico de queimadas reais da região/mês.
  WITH viz AS (
    SELECT ST_Transform(f.geom, _srid) AS g
      FROM focos_calor f
     WHERE ST_DWithin(f.geom::geography, _seed::geography, 20000)
       AND EXTRACT(MONTH FROM f.data_hora)::int = _mes
  ),
  cl AS (
    SELECT ST_ClusterDBSCAN(g, eps := 1000, minpoints := 3) OVER () AS cid, g
      FROM viz
  ),
  ar AS (
    SELECT ST_Area(ST_ConvexHull(ST_Collect(g))) AS a
      FROM cl
     WHERE cid IS NOT NULL
     GROUP BY cid
    HAVING COUNT(*) >= 3
  )
  SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY a), COUNT(*)
    INTO _area_p75, _n_clust
    FROM ar;

  IF _area_p75 IS NOT NULL AND _area_p75 > 0 THEN
    _raio := sqrt(_area_p75 / pi());
  ELSE
    _raio := 800;
  END IF;
  _raio := GREATEST(300, LEAST(_raio, 4000));

  _seed_m := ST_Transform(_seed, _srid);
  _base   := ST_Buffer(_seed_m, _raio);

  -- ── Vento → vetor a favor do vento ──────────────────────────────
  _tem_vento := (p_vento_dir_graus IS NOT NULL
                 AND p_vento_kmh IS NOT NULL
                 AND p_vento_kmh >= 3);
  IF _tem_vento THEN
    _lb     := LEAST(1 + 0.06 * p_vento_kmh, 3.0);   -- razão L/B ∝ vento (cap 3:1)
    _bear_w := (p_vento_dir_graus + 180) * pi() / 180.0;  -- fogo vai p/ onde o vento sopra
    _wx := _raio * (_lb - 1) * sin(_bear_w);
    _wy := _raio * (_lb - 1) * cos(_bear_w);
  END IF;

  -- ── Relevo → vetor morro acima ──────────────────────────────────
  _tem_slope := (p_slope_pct IS NOT NULL
                 AND p_aspect_graus IS NOT NULL
                 AND p_slope_pct >= 3);   -- < 3% ≈ plano, ignora
  IF _tem_slope THEN
    _slope_f := LEAST(0.03 * p_slope_pct, 1.5);       -- fator declive (cap 1.5·R)
    _bear_u  := (p_aspect_graus + 180) * pi() / 180.0; -- morro acima = aspecto + 180
    _sx := _raio * _slope_f * sin(_bear_u);
    _sy := _raio * _slope_f * cos(_bear_u);
  END IF;

  -- ── Resultante (vento + relevo) ─────────────────────────────────
  _dx   := _wx + _sx;
  _dy   := _wy + _sy;
  _dmag := sqrt(_dx * _dx + _dy * _dy);
  _aniso := (_dmag >= 1);

  IF _aniso THEN
    _head   := ST_Buffer(ST_Translate(_seed_m, _dx, _dy), _raio);
    _geom_m := ST_ConvexHull(ST_Union(_base, _head));
  ELSE
    _geom_m := _base;
  END IF;

  -- Desconta a área já queimada (só quando a semente é polígono).
  IF ST_GeometryType(_seed_m) IN ('ST_Polygon','ST_MultiPolygon') THEN
    _geom_m := ST_Difference(_geom_m, _seed_m);
  END IF;

  -- Garante um único polígono (o maior), compatível com a coluna Polygon.
  SELECT d.geom INTO _geom_out
    FROM (SELECT (ST_Dump(ST_CollectionExtract(_geom_m, 3))).geom AS geom) d
   ORDER BY ST_Area(d.geom) DESC
   LIMIT 1;

  IF _geom_out IS NULL THEN
    _geom_out := _geom_m;
  END IF;

  _area_ha  := round((ST_Area(_geom_out) / 10000.0)::numeric, 2);
  _geom_out := ST_Transform(_geom_out, 4326);

  RETURN jsonb_build_object(
    'geom',    ST_AsGeoJSON(_geom_out)::json,
    'area_ha', _area_ha,
    'raio_m',  round(_raio),
    'memoria', jsonb_build_object(
      'modelo',         'empirico_v2_topo',
      'raio_m',         round(_raio),
      'fonte_raio',     CASE WHEN _area_p75 IS NOT NULL
                             THEN 'focos_calor (percentil 75 do tamanho de clusters, mesmo mês, raio 20 km)'
                             ELSE 'fallback (histórico de focos insuficiente)' END,
      'n_clusters',     COALESCE(_n_clust, 0),
      'mes_referencia', _mes,
      'vento_dir',      p_vento_dir_graus,
      'vento_kmh',      p_vento_kmh,
      'usou_vento',     _tem_vento,
      'slope_pct',      p_slope_pct,
      'aspecto',        p_aspect_graus,
      'usou_relevo',    _tem_slope,
      'anisotropico',   _aniso,
      'srid',           _srid,
      'gerado_em',      to_char(now() AT TIME ZONE 'America/Rio_Branco', 'YYYY-MM-DD"T"HH24:MI:SS')
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sugerir_area_evitada(uuid, numeric, numeric, numeric, numeric) TO authenticated;
