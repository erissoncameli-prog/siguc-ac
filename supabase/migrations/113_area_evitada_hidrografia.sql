-- ════════════════════════════════════════════════════════════════
-- 113 — Incêndio Evitado (Fase 2): hidrografia como aceiro
--
-- Rios e corpos d'água são barreiras naturais: o fogo não atravessa.
-- O cliente busca a hidrografia local (OpenStreetMap/Overpass, sem
-- chave) num raio ao redor do ponto e envia a geometria; o motor:
--   1. bufferiza os cursos d'água (linha vira faixa de aceiro);
--   2. subtrai essa barreira + os polígonos d'água da cápsula;
--   3. mantém apenas a PEÇA que contém a ignição (o fogo fica do lado
--      onde começou — não pula o rio).
--
-- Tudo client-fetch (como vento/elevação): nenhum dado hospedado. Sem
-- hidrografia → comportamento idêntico à 112 (degradação segura).
--
-- Aditivo: recria sugerir_area_evitada com p_hidro (GeoJSON) e
-- p_hidro_buffer_m (largura do aceiro, default 20 m).
-- ════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS sugerir_area_evitada(uuid, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION sugerir_area_evitada(
  p_registro_id     uuid,
  p_vento_dir_graus numeric DEFAULT NULL,
  p_vento_kmh       numeric DEFAULT NULL,
  p_slope_pct       numeric DEFAULT NULL,
  p_aspect_graus    numeric DEFAULT NULL,
  p_hidro           jsonb   DEFAULT NULL,   -- GeoJSON (Geometry/GeometryCollection) de rios+água
  p_hidro_buffer_m  numeric DEFAULT 20      -- largura do aceiro aplicada aos cursos d'água
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _perfil     text;
  _seed       geometry;
  _evento     timestamptz;
  _mes        int;
  _lon        numeric;
  _srid       int;
  _seed_m     geometry;
  _base       geometry;
  _head       geometry;
  _geom_m     geometry;
  _geom_out   geometry;
  _hidro      geometry;
  _barreira   geometry;
  _cortado    geometry;
  _area_p75   numeric;
  _n_clust    int;
  _raio       numeric;
  _lb         numeric;
  _bear_w     numeric;
  _bear_u     numeric;
  _wx numeric := 0; _wy numeric := 0;
  _sx numeric := 0; _sy numeric := 0;
  _dx numeric; _dy numeric; _dmag numeric;
  _slope_f    numeric;
  _area_ha    numeric;
  _area_ha_pre numeric;
  _tem_vento  boolean;
  _tem_slope  boolean;
  _aniso      boolean;
  _usou_hidro boolean := false;
  _n_hidro    int := 0;
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
  _srid := CASE WHEN _lon >= -72 THEN 31979 ELSE 31978 END;

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

  -- Vento → vetor a favor do vento
  _tem_vento := (p_vento_dir_graus IS NOT NULL AND p_vento_kmh IS NOT NULL AND p_vento_kmh >= 3);
  IF _tem_vento THEN
    _lb     := LEAST(1 + 0.06 * p_vento_kmh, 3.0);
    _bear_w := (p_vento_dir_graus + 180) * pi() / 180.0;
    _wx := _raio * (_lb - 1) * sin(_bear_w);
    _wy := _raio * (_lb - 1) * cos(_bear_w);
  END IF;

  -- Relevo → vetor morro acima
  _tem_slope := (p_slope_pct IS NOT NULL AND p_aspect_graus IS NOT NULL AND p_slope_pct >= 3);
  IF _tem_slope THEN
    _slope_f := LEAST(0.03 * p_slope_pct, 1.5);
    _bear_u  := (p_aspect_graus + 180) * pi() / 180.0;
    _sx := _raio * _slope_f * sin(_bear_u);
    _sy := _raio * _slope_f * cos(_bear_u);
  END IF;

  -- Resultante (vento + relevo)
  _dx := _wx + _sx; _dy := _wy + _sy;
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

  _area_ha_pre := round((ST_Area(_geom_m) / 10000.0)::numeric, 2);

  -- ── Hidrografia como aceiro ─────────────────────────────────────
  IF p_hidro IS NOT NULL THEN
    BEGIN
      _hidro := ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(p_hidro::text), 4326), _srid);
    EXCEPTION WHEN others THEN
      _hidro := NULL;   -- GeoJSON inválido → ignora, não quebra a sugestão
    END;

    IF _hidro IS NOT NULL AND NOT ST_IsEmpty(_hidro) THEN
      -- Linha (curso d'água) vira faixa; polígono (lago/rio largo) entra direto.
      _barreira := ST_Buffer(_hidro, GREATEST(COALESCE(p_hidro_buffer_m, 20), 1));
      _cortado  := ST_Difference(_geom_m, _barreira);
      IF _cortado IS NOT NULL AND NOT ST_IsEmpty(_cortado) THEN
        _geom_m     := _cortado;
        _usou_hidro := true;
        _n_hidro    := ST_NumGeometries(_hidro);
      END IF;
    END IF;
  END IF;

  -- Peça única a manter: prioriza a que contém a ignição (fogo não pula
  -- o rio); em empate/ausência, a maior. Compatível com a coluna Polygon.
  SELECT d.geom INTO _geom_out
    FROM (SELECT (ST_Dump(ST_CollectionExtract(_geom_m, 3))).geom AS geom) d
   ORDER BY (ST_Intersects(d.geom, _seed_m))::int DESC, ST_Area(d.geom) DESC
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
      'modelo',          'empirico_v3_hidro',
      'raio_m',          round(_raio),
      'fonte_raio',      CASE WHEN _area_p75 IS NOT NULL
                              THEN 'focos_calor (percentil 75 do tamanho de clusters, mesmo mês, raio 20 km)'
                              ELSE 'fallback (histórico de focos insuficiente)' END,
      'n_clusters',      COALESCE(_n_clust, 0),
      'mes_referencia',  _mes,
      'vento_dir',       p_vento_dir_graus,
      'vento_kmh',       p_vento_kmh,
      'usou_vento',      _tem_vento,
      'slope_pct',       p_slope_pct,
      'aspecto',         p_aspect_graus,
      'usou_relevo',     _tem_slope,
      'usou_hidro',      _usou_hidro,
      'n_hidro',         _n_hidro,
      'area_pre_hidro',  _area_ha_pre,
      'anisotropico',    _aniso,
      'srid',            _srid,
      'gerado_em',       to_char(now() AT TIME ZONE 'America/Rio_Branco', 'YYYY-MM-DD"T"HH24:MI:SS')
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sugerir_area_evitada(uuid, numeric, numeric, numeric, numeric, jsonb, numeric) TO authenticated;
