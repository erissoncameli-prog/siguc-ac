-- ════════════════════════════════════════════════════════════════
-- 111 — Incêndio Evitado: sugestão automática da área + impacto de fauna
--
-- Até aqui (072) a "área evitada" era 100% desenhada à mão pelo técnico
-- na tela de Validação de Campo. Esta migration adiciona um MOTOR
-- EMPÍRICO que SUGERE o polígono a partir do ponto/perímetro da
-- ocorrência, para o técnico revisar e confirmar (nunca substitui a
-- decisão humana — só pré-preenche).
--
-- Modelo empírico v1 (tudo em PostGIS, sem raster novo):
--   1. Geometria-semente = perímetro validado > perímetro do app > ponto
--   2. Raio de propagação R estimado a partir do TAMANHO TÍPICO de
--      queimadas reais da região/mês (clusteriza focos_calor históricos
--      num raio de 20 km com ST_ClusterDBSCAN e pega o percentil 75 da
--      área dos clusters). Ancora o número em fogo observado, não em chute.
--   3. Buffer anisotrópico: cápsula alongada na direção do vento do dia
--      (vento vem do cliente via Open-Meteo; sem vento → círculo).
--   4. Se a semente é polígono, desconta a área já queimada (não conta 2x).
--
-- Guarda método (manual|sugerido|sugerido_ajustado) e a memória de
-- cálculo em areas_incendio_evitado, para auditoria.
--
-- Impacto de fauna: observado (registro_fauna real) + estimado (faixa
-- por densidade de referência × hectares), com fonte citada e editável
-- pelo DEBIO.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Colunas de rastreabilidade em areas_incendio_evitado ──────
ALTER TABLE areas_incendio_evitado
  ADD COLUMN IF NOT EXISTS metodo          text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS memoria_calculo jsonb,
  ADD COLUMN IF NOT EXISTS raio_estimado_m numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'aie_metodo_chk'
  ) THEN
    ALTER TABLE areas_incendio_evitado
      ADD CONSTRAINT aie_metodo_chk
      CHECK (metodo IN ('manual','sugerido','sugerido_ajustado'));
  END IF;
END $$;

COMMENT ON COLUMN areas_incendio_evitado.metodo IS
  'Origem do polígono: manual (desenho livre) | sugerido (aceito do motor) | sugerido_ajustado (motor + edição humana)';
COMMENT ON COLUMN areas_incendio_evitado.memoria_calculo IS
  'Parâmetros usados pelo motor de sugestão (raio, vento, fonte dos focos) — auditoria.';

-- ── 2. listar_areas_evitadas: passa a devolver metodo ────────────
DROP FUNCTION IF EXISTS listar_areas_evitadas(uuid);
CREATE OR REPLACE FUNCTION listar_areas_evitadas(p_registro_id uuid)
RETURNS TABLE (
  id              uuid,
  geom            json,
  area_ha         decimal,
  descricao       text,
  metodo          text,
  criado_em       timestamptz,
  criado_por_nome text
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    a.id,
    ST_AsGeoJSON(a.geom)::json AS geom,
    a.area_ha,
    a.descricao,
    a.metodo,
    a.criado_em,
    u.nome_completo            AS criado_por_nome
  FROM areas_incendio_evitado a
  LEFT JOIN usuarios u ON u.id = a.criado_por
  WHERE a.registro_id = p_registro_id
  ORDER BY a.criado_em;
$$;
GRANT EXECUTE ON FUNCTION listar_areas_evitadas(uuid) TO authenticated;

-- ── 3. salvar_area_evitada: aceita metodo e memória de cálculo ───
DROP FUNCTION IF EXISTS salvar_area_evitada(uuid, jsonb, text, uuid);
CREATE OR REPLACE FUNCTION salvar_area_evitada(
  p_registro_id uuid,
  p_geom        jsonb,
  p_descricao   text  DEFAULT NULL,
  p_id          uuid  DEFAULT NULL,
  p_metodo      text  DEFAULT 'manual',
  p_memoria     jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _perfil  text;
  _geom    geometry;
  _area_ha decimal;
  _metodo  text;
  _raio    numeric;
  _ret     uuid;
BEGIN
  SELECT perfil INTO _perfil FROM usuarios WHERE id = auth.uid();
  IF _perfil NOT IN ('tecnico','gestor','super_admin','biologo') THEN
    RAISE EXCEPTION 'Sem permissão para registrar área evitada';
  END IF;

  _metodo := COALESCE(NULLIF(p_metodo, ''), 'manual');
  IF _metodo NOT IN ('manual','sugerido','sugerido_ajustado') THEN
    _metodo := 'manual';
  END IF;

  _geom    := ST_SetSRID(ST_GeomFromGeoJSON(p_geom::text), 4326);
  _area_ha := round((ST_Area(_geom::geography) / 10000)::numeric, 4);
  _raio    := NULLIF((p_memoria->>'raio_m'), '')::numeric;

  IF p_id IS NULL THEN
    INSERT INTO areas_incendio_evitado
      (registro_id, geom, area_ha, descricao, metodo, memoria_calculo, raio_estimado_m, criado_por)
    VALUES
      (p_registro_id, _geom, _area_ha, p_descricao, _metodo, p_memoria, _raio, auth.uid())
    RETURNING id INTO _ret;
  ELSE
    UPDATE areas_incendio_evitado
       SET geom = _geom, area_ha = _area_ha,
           descricao = p_descricao,
           metodo = _metodo,
           memoria_calculo = COALESCE(p_memoria, memoria_calculo),
           raio_estimado_m = COALESCE(_raio, raio_estimado_m),
           atualizado_em = now()
     WHERE id = p_id AND registro_id = p_registro_id
    RETURNING id INTO _ret;
  END IF;

  RETURN _ret;
END;
$$;
GRANT EXECUTE ON FUNCTION salvar_area_evitada(uuid, jsonb, text, uuid, text, jsonb) TO authenticated;

-- ── 4. Motor de sugestão da área evitada ─────────────────────────
-- Retorna: { geom (GeoJSON), area_ha, raio_m, memoria }  ou  { erro }
CREATE OR REPLACE FUNCTION sugerir_area_evitada(
  p_registro_id     uuid,
  p_vento_dir_graus numeric DEFAULT NULL,  -- direção DE ONDE o vento sopra (meteorológica)
  p_vento_kmh       numeric DEFAULT NULL
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
  _bearing   numeric;
  _desloc    numeric;
  _area_ha   numeric;
  _tem_vento boolean;
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
  -- Acre cruza dois fusos UTM (SIRGAS 2000). Escolhe o mais próximo.
  _srid := CASE WHEN _lon >= -72 THEN 31979 ELSE 31978 END;  -- 19S / 18S

  -- ── Raio de propagação R a partir do tamanho típico de queimadas ──
  -- Clusteriza focos históricos (raio 20 km, mesmo mês) e pega o
  -- percentil 75 da área dos clusters. Converte área → raio equivalente.
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
    _raio := 800;  -- fallback quando o histórico é insuficiente
  END IF;
  _raio := GREATEST(300, LEAST(_raio, 4000));  -- limites operacionais

  -- ── Geometria em metros (projeção UTM local) ──────────────────
  _seed_m := ST_Transform(_seed, _srid);
  _base   := ST_Buffer(_seed_m, _raio);

  _tem_vento := (p_vento_dir_graus IS NOT NULL
                 AND p_vento_kmh IS NOT NULL
                 AND p_vento_kmh >= 3);

  IF _tem_vento THEN
    -- Razão comprimento/largura cresce com o vento (limitada a 3:1).
    _lb      := LEAST(1 + 0.06 * p_vento_kmh, 3.0);
    _desloc  := _raio * (_lb - 1);
    -- Fogo avança na direção PARA ONDE o vento sopra = dir + 180.
    _bearing := (p_vento_dir_graus + 180) * pi() / 180.0;
    _head := ST_Buffer(
               ST_Translate(_seed_m,
                 _desloc * sin(_bearing),   -- x = leste
                 _desloc * cos(_bearing)),  -- y = norte
               _raio);
    -- Cápsula alongada a favor do vento (fecho convexo das duas pontas).
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
      'modelo',         'empirico_v1',
      'raio_m',         round(_raio),
      'fonte_raio',     CASE WHEN _area_p75 IS NOT NULL
                             THEN 'focos_calor (percentil 75 do tamanho de clusters, mesmo mês, raio 20 km)'
                             ELSE 'fallback (histórico de focos insuficiente)' END,
      'n_clusters',     COALESCE(_n_clust, 0),
      'mes_referencia', _mes,
      'vento_dir',      p_vento_dir_graus,
      'vento_kmh',      p_vento_kmh,
      'anisotropico',   _tem_vento,
      'srid',           _srid,
      'gerado_em',      to_char(now() AT TIME ZONE 'America/Rio_Branco', 'YYYY-MM-DD"T"HH24:MI:SS')
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sugerir_area_evitada(uuid, numeric, numeric) TO authenticated;

-- ── 5. Densidade de fauna de referência (editável pelo DEBIO) ────
-- Indivíduos por hectare, por grupo taxonômico. Ordem de grandeza da
-- literatura de fauna amazônica de terra firme; serve para uma FAIXA
-- estimada, não um número exato. O DEBIO ajusta conforme a UC.
CREATE TABLE IF NOT EXISTS densidade_fauna_bioma (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bioma         text NOT NULL DEFAULT 'amazonia',
  grupo         classe_fauna NOT NULL,
  dens_min      numeric NOT NULL,   -- indivíduos/ha (limite inferior)
  dens_max      numeric NOT NULL,   -- indivíduos/ha (limite superior)
  fonte         text,
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE (bioma, grupo)
);

ALTER TABLE densidade_fauna_bioma ENABLE ROW LEVEL SECURITY;

CREATE POLICY "densidade_fauna_select" ON densidade_fauna_bioma
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "densidade_fauna_write" ON densidade_fauna_bioma
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('biologo','gestor','super_admin')
        AND u.ativo
    )
  );

-- Seed conservador (só vertebrados terrestres; peixe/invertebrado ficam
-- de fora da estimativa por hectare de área florestal).
INSERT INTO densidade_fauna_bioma (bioma, grupo, dens_min, dens_max, fonte) VALUES
  ('amazonia', 'ave',      3.0, 12.0, 'Referência: densidade de comunidade de aves em floresta amazônica de terra firme (ordem de grandeza — ajustar por especialista DEBIO)'),
  ('amazonia', 'mamifero', 0.5,  3.0, 'Referência: mamíferos de médio/grande porte + pequenos mamíferos, floresta amazônica (ordem de grandeza — ajustar por especialista DEBIO)'),
  ('amazonia', 'reptil',   1.0,  6.0, 'Referência: herpetofauna (répteis) amazônica (ordem de grandeza — ajustar por especialista DEBIO)'),
  ('amazonia', 'anfibio',  2.0, 15.0, 'Referência: anfíbios de serapilheira amazônicos (ordem de grandeza — ajustar por especialista DEBIO)')
ON CONFLICT (bioma, grupo) DO NOTHING;

-- ── 6. Impacto de fauna (observado + estimado) ───────────────────
CREATE OR REPLACE FUNCTION impacto_fauna_evitado(
  p_registro_id uuid,
  p_area_ha     numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _obs     jsonb;
  _est     jsonb;
  _area    numeric;
  _tmin    numeric;
  _tmax    numeric;
BEGIN
  -- Observado: fauna efetivamente registrada na ocorrência.
  SELECT jsonb_build_object(
           'total_individuos', COALESCE(SUM(quantidade), 0),
           'n_especies',       COUNT(DISTINCT COALESCE(nome_cientifico, nome_popular)),
           'n_ameacadas',      COALESCE(SUM(quantidade) FILTER (WHERE ameacada), 0),
           'n_resgatados',     COALESCE(SUM(quantidade) FILTER (WHERE tipo_evento = 'resgate'), 0),
           'por_classe',       COALESCE(jsonb_object_agg(classe, q) FILTER (WHERE classe IS NOT NULL), '{}'::jsonb)
         )
    INTO _obs
    FROM (
      SELECT classe, tipo_evento, ameacada, nome_cientifico, nome_popular, quantidade,
             SUM(quantidade) OVER (PARTITION BY classe) AS q
        FROM registro_fauna
       WHERE registro_campo_id = p_registro_id
    ) s;

  IF _obs IS NULL THEN
    _obs := jsonb_build_object('total_individuos', 0, 'n_especies', 0,
                               'n_ameacadas', 0, 'n_resgatados', 0, 'por_classe', '{}'::jsonb);
  END IF;

  -- Estimado: faixa por densidade de referência × área evitada.
  _area := COALESCE(p_area_ha, 0);

  SELECT jsonb_agg(jsonb_build_object(
           'grupo',   grupo,
           'ind_min', round(dens_min * _area),
           'ind_max', round(dens_max * _area)
         ) ORDER BY grupo),
         COALESCE(SUM(round(dens_min * _area)), 0),
         COALESCE(SUM(round(dens_max * _area)), 0)
    INTO _est, _tmin, _tmax
    FROM densidade_fauna_bioma
   WHERE bioma = 'amazonia';

  RETURN jsonb_build_object(
    'observado', _obs,
    'estimado', jsonb_build_object(
      'area_ha',   _area,
      'por_grupo', COALESCE(_est, '[]'::jsonb),
      'total_min', _tmin,
      'total_max', _tmax,
      'fonte',     'Estimativa por densidade de referência (fauna amazônica de terra firme). Faixa de ordem de grandeza — não é contagem. Ajustável pelo DEBIO em densidade_fauna_bioma.'
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION impacto_fauna_evitado(uuid, numeric) TO authenticated;
