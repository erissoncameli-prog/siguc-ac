-- ════════════════════════════════════════════════════════════════
-- 116 — Incêndio Evitado: cápsula real no lugar do convex-hull
--
-- O convex-hull (114) alisava o contorno e apagava o efeito dos recortes
-- de hidrografia/combustível — o resultado virava um "balão" liso. Aqui a
-- forma anisotrópica (vento+relevo) passa a ser uma CÁPSULA (buffer de uma
-- linha do ponto ao vetor resultante), unida à base. Assim os recortes de
-- barreira/combustível moldam o polígono de verdade.
--
-- Só muda o bloco de forma; recortes e seleção da peça de ignição idênticos.
-- Assinatura inalterada (8 args) → CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sugerir_area_evitada(
  p_registro_id     uuid,
  p_vento_dir_graus numeric DEFAULT NULL,
  p_vento_kmh       numeric DEFAULT NULL,
  p_slope_pct       numeric DEFAULT NULL,
  p_aspect_graus    numeric DEFAULT NULL,
  p_hidro           jsonb   DEFAULT NULL,
  p_hidro_buffer_m  numeric DEFAULT 20,
  p_combustivel     jsonb   DEFAULT NULL
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
  _centro     geometry;
  _base       geometry;
  _geom_m     geometry;
  _geom_out   geometry;
  _hidro      geometry;
  _comb       geometry;
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
  _area_ha_pre  numeric;
  _area_ha_hidro numeric;
  _tem_vento  boolean;
  _tem_slope  boolean;
  _aniso      boolean;
  _usou_hidro boolean := false;
  _usou_comb  boolean := false;
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
  _centro := ST_Centroid(_seed_m);
  _base   := ST_Buffer(_seed_m, _raio);

  _tem_vento := (p_vento_dir_graus IS NOT NULL AND p_vento_kmh IS NOT NULL AND p_vento_kmh >= 3);
  IF _tem_vento THEN
    _lb     := LEAST(1 + 0.06 * p_vento_kmh, 3.0);
    _bear_w := (p_vento_dir_graus + 180) * pi() / 180.0;
    _wx := _raio * (_lb - 1) * sin(_bear_w);
    _wy := _raio * (_lb - 1) * cos(_bear_w);
  END IF;

  _tem_slope := (p_slope_pct IS NOT NULL AND p_aspect_graus IS NOT NULL AND p_slope_pct >= 3);
  IF _tem_slope THEN
    _slope_f := LEAST(0.03 * p_slope_pct, 1.5);
    _bear_u  := (p_aspect_graus + 180) * pi() / 180.0;
    _sx := _raio * _slope_f * sin(_bear_u);
    _sy := _raio * _slope_f * cos(_bear_u);
  END IF;

  _dx := _wx + _sx; _dy := _wy + _sy;
  _dmag := sqrt(_dx * _dx + _dy * _dy);
  _aniso := (_dmag >= 1);

  -- Cápsula: buffer da linha centro → ponta do vetor resultante, unida à
  -- base. Sem convex-hull, para os recortes moldarem o contorno.
  IF _aniso THEN
    _geom_m := ST_Union(
      _base,
      ST_Buffer(ST_MakeLine(_centro, ST_Translate(_centro, _dx, _dy)), _raio)
    );
  ELSE
    _geom_m := _base;
  END IF;

  IF ST_GeometryType(_seed_m) IN ('ST_Polygon','ST_MultiPolygon') THEN
    _geom_m := ST_Difference(_geom_m, _seed_m);
  END IF;

  _area_ha_pre := round((ST_Area(_geom_m) / 10000.0)::numeric, 2);

  -- Barreiras (hidrografia + estradas/ramais): buffer e subtração.
  IF p_hidro IS NOT NULL THEN
    BEGIN
      _hidro := ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(p_hidro::text), 4326), _srid);
    EXCEPTION WHEN others THEN _hidro := NULL;
    END;
    IF _hidro IS NOT NULL AND NOT ST_IsEmpty(_hidro) THEN
      _barreira := ST_Buffer(_hidro, GREATEST(COALESCE(p_hidro_buffer_m, 20), 1));
      _cortado  := ST_Difference(_geom_m, _barreira);
      IF _cortado IS NOT NULL AND NOT ST_IsEmpty(_cortado) THEN
        _geom_m     := _cortado;
        _usou_hidro := true;
        _n_hidro    := ST_NumGeometries(_hidro);
      END IF;
    END IF;
  END IF;

  _area_ha_hidro := round((ST_Area(_geom_m) / 10000.0)::numeric, 2);

  -- Combustível (MapBiomas): subtrai o que não queima.
  IF p_combustivel IS NOT NULL THEN
    BEGIN
      _comb := ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(p_combustivel::text), 4326), _srid);
    EXCEPTION WHEN others THEN _comb := NULL;
    END;
    IF _comb IS NOT NULL AND NOT ST_IsEmpty(_comb) THEN
      _comb    := ST_MakeValid(_comb);
      _cortado := ST_Difference(_geom_m, _comb);
      IF _cortado IS NOT NULL AND NOT ST_IsEmpty(_cortado) THEN
        _geom_m    := _cortado;
        _usou_comb := true;
      END IF;
    END IF;
  END IF;

  -- Peça única: prioriza a que contém a ignição; em empate, a maior.
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
      'modelo',            'empirico_v5_capsula',
      'raio_m',            round(_raio),
      'fonte_raio',        CASE WHEN _area_p75 IS NOT NULL
                                THEN 'focos_calor (percentil 75 do tamanho de clusters, mesmo mês, raio 20 km)'
                                ELSE 'fallback (histórico de focos insuficiente)' END,
      'raio_fallback',     (_area_p75 IS NULL),
      'n_clusters',        COALESCE(_n_clust, 0),
      'mes_referencia',    _mes,
      'vento_dir',         p_vento_dir_graus,
      'vento_kmh',         p_vento_kmh,
      'usou_vento',        _tem_vento,
      'slope_pct',         p_slope_pct,
      'aspecto',           p_aspect_graus,
      'usou_relevo',       _tem_slope,
      'usou_hidro',        _usou_hidro,
      'n_hidro',           _n_hidro,
      'usou_combustivel',  _usou_comb,
      'area_pre_hidro',    _area_ha_pre,
      'area_pre_comb',     _area_ha_hidro,
      'anisotropico',      _aniso,
      'srid',              _srid,
      'gerado_em',         to_char(now() AT TIME ZONE 'America/Rio_Branco', 'YYYY-MM-DD"T"HH24:MI:SS')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION sugerir_area_evitada(uuid, numeric, numeric, numeric, numeric, jsonb, numeric, jsonb) TO authenticated;
