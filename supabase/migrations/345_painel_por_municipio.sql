-- ============================================================
-- 345_painel_por_municipio.sql
-- Painel de Fogo e Desmatamento — recorte por MUNICÍPIO.
--
-- Mesmo desenho das UCs (342/343/344): o município vira um atributo de
-- cada foco (gravado uma vez, por trigger nos novos e por carga ano a
-- ano nos antigos), e os agregados diários só agrupam por ele. PRODES e
-- a base de cobertura são cruzados com o limite de cada município na
-- chegada, como já é feito com as UCs — nenhum polígono do PRODES é
-- guardado (o banco tem 852 MB; guardar a série inteira custaria mais
-- que tudo o que existe hoje).
--
-- Limites: MESMO arquivo que o mapa desenha (data/municipios_acre.geojson,
-- servido em produção), para banco e tela nunca discordarem da divisa —
-- mesma regra do limite do Acre (239). Carga em dois passos (pg_net só
-- envia depois do COMMIT):
--   SELECT municipios_acre_solicitar();  →  SELECT municipios_acre_carregar();
-- Cada município é guardado também SUBDIVIDIDO (municipios_acre_sub):
-- ponto-em-polígono e interseção contra pedaços de ≤256 vértices, nunca
-- contra o contorno inteiro — é o que mantém os cruzamentos em segundos.
--
-- ⚠️ Carga das respostas do pg_net SEMPRE uma por chamada (p_max) — ver a
-- nota da 344 no CLAUDE.md: parsear várias respostas grandes de uma vez
-- derrubou o banco de produção.
-- ============================================================

-- ── 1. Municípios ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.municipios_acre (
  cd_ibge       text PRIMARY KEY,
  nome          text NOT NULL,
  geom          geometry(MultiPolygon, 4326) NOT NULL,
  area_ha       numeric NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.municipios_acre_sub (
  cd_ibge text NOT NULL REFERENCES public.municipios_acre(cd_ibge) ON DELETE CASCADE,
  geom    geometry(Polygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS municipios_acre_sub_geom ON public.municipios_acre_sub USING gist (geom);

ALTER TABLE public.municipios_acre     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.municipios_acre_sub ENABLE ROW LEVEL SECURITY;
-- Dado público de referência (como limite_acre): leitura para autenticado.
DROP POLICY IF EXISTS municipios_acre_select ON public.municipios_acre;
CREATE POLICY municipios_acre_select ON public.municipios_acre FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS municipios_acre_sub_select ON public.municipios_acre_sub;
CREATE POLICY municipios_acre_sub_select ON public.municipios_acre_sub FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.municipios_acre, public.municipios_acre_sub FROM anon;

CREATE TABLE IF NOT EXISTS public.municipios_acre_pedido (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  request_id bigint NOT NULL,
  solicitado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.municipios_acre_pedido ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.municipios_acre_pedido FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.municipios_acre_solicitar()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid bigint;
BEGIN
  SELECT net.http_get('https://siguc-ac.vercel.app/data/municipios_acre.geojson',
                      timeout_milliseconds := 60000) INTO rid;
  INSERT INTO municipios_acre_pedido (id, request_id) VALUES (1, rid)
  ON CONFLICT (id) DO UPDATE SET request_id = EXCLUDED.request_id, solicitado_em = now();
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.municipios_acre_solicitar() FROM PUBLIC, anon, authenticated;

-- Não apaga nada se a resposta não trouxer os 22 municípios: um arquivo
-- quebrado nunca pode esvaziar a referência (fail-safe).
CREATE OR REPLACE FUNCTION public.municipios_acre_carregar()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $$
DECLARE j jsonb; n int;
BEGIN
  SELECT r.content::jsonb INTO j
    FROM municipios_acre_pedido p JOIN net._http_response r ON r.id = p.request_id
   WHERE r.status_code = 200;
  IF j IS NULL OR jsonb_array_length(j->'features') <> 22 THEN
    RAISE EXCEPTION 'municipios_acre_carregar: resposta ausente ou sem os 22 municípios';
  END IF;
  DELETE FROM municipios_acre_sub WHERE true;
  INSERT INTO municipios_acre (cd_ibge, nome, geom, area_ha)
  SELECT f->'properties'->>'codibge', f->'properties'->>'nome', g,
         round((ST_Area(g::geography) / 10000)::numeric)
    FROM jsonb_array_elements(j->'features') f,
         LATERAL (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
                    ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'), 4326)), 3)) AS g) x
  ON CONFLICT (cd_ibge) DO UPDATE
    SET nome = EXCLUDED.nome, geom = EXCLUDED.geom, area_ha = EXCLUDED.area_ha, atualizado_em = now();
  INSERT INTO municipios_acre_sub (cd_ibge, geom)
  SELECT cd_ibge, ST_Subdivide(geom, 256) FROM municipios_acre;
  SELECT count(*) INTO n FROM municipios_acre;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.municipios_acre_carregar() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.municipio_do_ponto(p_lat double precision, p_lon double precision)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cd_ibge FROM municipios_acre_sub
   WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326))
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.municipio_do_ponto(double precision, double precision) FROM PUBLIC, anon, authenticated;

-- ── 2. Município em cada foco ────────────────────────────────
ALTER TABLE public.focos_calor_ac ADD COLUMN IF NOT EXISTS cd_mun text;
ALTER TABLE public.focos_calor    ADD COLUMN IF NOT EXISTS cd_mun text;
ALTER TABLE public.focos_bdq_ref  ADD COLUMN IF NOT EXISTS cd_mun text;
CREATE INDEX IF NOT EXISTS focos_bdq_ref_ano_mun ON public.focos_bdq_ref (ano) WHERE cd_mun IS NULL;

CREATE OR REPLACE FUNCTION public.focos_definir_municipio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cd_mun IS NULL AND NEW.lat IS NOT NULL AND NEW.lon IS NOT NULL THEN
    NEW.cd_mun := municipio_do_ponto(NEW.lat::double precision, NEW.lon::double precision);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.focos_definir_municipio() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_focos_calor_ac_mun ON public.focos_calor_ac;
CREATE TRIGGER trg_focos_calor_ac_mun BEFORE INSERT ON public.focos_calor_ac
  FOR EACH ROW EXECUTE FUNCTION public.focos_definir_municipio();
DROP TRIGGER IF EXISTS trg_focos_calor_mun ON public.focos_calor;
CREATE TRIGGER trg_focos_calor_mun BEFORE INSERT ON public.focos_calor
  FOR EACH ROW EXECUTE FUNCTION public.focos_definir_municipio();
DROP TRIGGER IF EXISTS trg_focos_bdq_ref_mun ON public.focos_bdq_ref;
CREATE TRIGGER trg_focos_bdq_ref_mun BEFORE INSERT ON public.focos_bdq_ref
  FOR EACH ROW EXECUTE FUNCTION public.focos_definir_municipio();

-- Carga dos antigos, UM ano por chamada (junção espacial em lote, com o
-- índice GIST dos pontos da série histórica).
CREATE OR REPLACE FUNCTION public.focos_municipio_preencher(p_ano int)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; k int;
BEGIN
  UPDATE focos_calor_ac f SET cd_mun = s.cd_ibge
    FROM municipios_acre_sub s
   WHERE f.ano = p_ano AND f.dentro_acre AND f.cd_mun IS NULL AND ST_Intersects(f.geom, s.geom);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE focos_bdq_ref f SET cd_mun = s.cd_ibge
    FROM municipios_acre_sub s
   WHERE f.ano = p_ano AND f.cd_mun IS NULL
     AND ST_Intersects(ST_SetSRID(ST_MakePoint(f.lon, f.lat), 4326), s.geom);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE focos_calor f SET cd_mun = s.cd_ibge
    FROM municipios_acre_sub s
   WHERE extract(year FROM f.data_hora) = p_ano AND f.cd_mun IS NULL
     AND ST_Intersects(ST_SetSRID(ST_MakePoint(f.lon, f.lat), 4326), s.geom);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.focos_municipio_preencher(int) FROM PUBLIC, anon, authenticated;

-- A view da linha do tempo ganha o município AO FINAL (CREATE OR REPLACE
-- VIEW só aceita acrescentar coluna no fim — 42P16).
CREATE OR REPLACE VIEW public.vw_focos_linha_tempo AS
 SELECT h.ano,
    (h.lat)::double precision AS lat,
    (h.lon)::double precision AS lon,
    h.source,
    (h.frp)::double precision AS frp,
    h.acq_date,
    'serie_historica'::text AS origem,
    h.uc_id,
    h.cd_mun
   FROM focos_calor_ac h
  WHERE h.dentro_acre
UNION ALL
 SELECT (EXTRACT(year FROM (f.data_hora AT TIME ZONE 'America/Rio_Branco'::text)))::smallint AS ano,
    f.lat,
    f.lon,
        CASE f.satelite
            WHEN 'N'::text THEN 'VIIRS_SNPP'::text
            ELSE 'MODIS'::text
        END AS source,
    (f.frp)::double precision AS frp,
    ((f.data_hora AT TIME ZONE 'America/Rio_Branco'::text))::date AS acq_date,
    'firms_diario'::text AS origem,
    f.uc_id,
    f.cd_mun
   FROM focos_calor f
  WHERE ((f.fonte = 'FIRMS'::text) AND (f.satelite = ANY (ARRAY['N'::text, 'Terra'::text, 'Aqua'::text])) AND ((to_char((f.data_hora AT TIME ZONE 'America/Rio_Branco'::text), 'MM-DD'::text) >= '07-01'::text) AND (to_char((f.data_hora AT TIME ZONE 'America/Rio_Branco'::text), 'MM-DD'::text) <= '11-04'::text)) AND (EXTRACT(year FROM (f.data_hora AT TIME ZONE 'America/Rio_Branco'::text)) > (( SELECT max(focos_calor_ac.ano) AS max
           FROM focos_calor_ac))::numeric));

-- ── 3. Agregados por município (espelho de focos_uc_mes / focos_bdq_uc_mes) ──
CREATE TABLE IF NOT EXISTS public.focos_mun_mes (
  ano     smallint NOT NULL,
  mes     smallint NOT NULL,
  cd_ibge text,          -- NULL = ponto sem município (borda)
  origem  text NOT NULL,
  focos   integer NOT NULL
);
CREATE TABLE IF NOT EXISTS public.focos_bdq_mun_mes (
  ano     smallint NOT NULL,
  mes     smallint NOT NULL,
  cd_ibge text,
  focos   integer NOT NULL
);
CREATE TABLE IF NOT EXISTS public.prodes_mun_ano (
  ano           int NOT NULL,
  cd_ibge       text NOT NULL REFERENCES public.municipios_acre(cd_ibge) ON DELETE CASCADE,
  poligonos     int NOT NULL,
  area_ha       numeric NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ano, cd_ibge)
);
ALTER TABLE public.focos_mun_mes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focos_bdq_mun_mes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prodes_mun_ano    ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS focos_mun_mes_select ON public.focos_mun_mes;
CREATE POLICY focos_mun_mes_select ON public.focos_mun_mes FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
DROP POLICY IF EXISTS focos_bdq_mun_mes_select ON public.focos_bdq_mun_mes;
CREATE POLICY focos_bdq_mun_mes_select ON public.focos_bdq_mun_mes FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
DROP POLICY IF EXISTS prodes_mun_ano_select ON public.prodes_mun_ano;
CREATE POLICY prodes_mun_ano_select ON public.prodes_mun_ano FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
REVOKE ALL ON public.focos_mun_mes, public.focos_bdq_mun_mes, public.prodes_mun_ano FROM anon;

-- Agregados de focos por município a partir do que já está nos pontos.
-- Chamada pelo cron diário (junto de focos_resumo_ano_atualizar) e ao
-- final da carga inicial.
CREATE OR REPLACE FUNCTION public.focos_mun_atualizar()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM focos_mun_mes WHERE true;
  INSERT INTO focos_mun_mes (ano, mes, cd_ibge, origem, focos)
  SELECT ano, extract(month FROM acq_date)::int, cd_mun, min(origem), count(*)
    FROM vw_focos_linha_tempo
   GROUP BY ano, extract(month FROM acq_date), cd_mun;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM focos_bdq_mun_mes WHERE true;
  INSERT INTO focos_bdq_mun_mes (ano, mes, cd_ibge, focos)
  SELECT ano, extract(month FROM data_hora AT TIME ZONE 'UTC')::smallint, cd_mun, count(*)
    FROM focos_bdq_ref GROUP BY 1, 2, 3;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.focos_mun_atualizar() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'focos-mun-atualizar';
SELECT cron.schedule('focos-mun-atualizar', '50 9 * * *', $$SELECT public.focos_mun_atualizar()$$);

-- ── 4. PRODES anual por município (mesma coleta, mesma resposta) ──
-- Mesma assinatura da 342c: só acrescenta o cruzamento com os municípios.
CREATE OR REPLACE FUNCTION public.prodes_resumo_coletar(p_max int DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p record; j jsonb; nfeat int; area numeric; n int := 0;
BEGIN
  FOR p IN
    SELECT pe.ano, r.status_code, r.content
      FROM prodes_resumo_pedidos pe
      JOIN net._http_response r ON r.id = pe.request_id
     ORDER BY pe.ano
     LIMIT p_max
  LOOP
    IF p.status_code = 200 THEN
      BEGIN
        j := p.content::jsonb;
        SELECT count(*), coalesce(sum((f->'properties'->>'area_km')::numeric), 0) * 100
          INTO nfeat, area
          FROM jsonb_array_elements(j->'features') f;
        -- 0 feições = ano ainda não publicado: nunca grava zero.
        IF nfeat > 0 THEN
          INSERT INTO prodes_resumo_ano (ano, poligonos, area_ha, atualizado_em)
          VALUES (p.ano, nfeat, round(area), now())
          ON CONFLICT (ano) DO UPDATE
            SET poligonos = EXCLUDED.poligonos, area_ha = EXCLUDED.area_ha,
                atualizado_em = now();

          IF (j->'features'->0->'geometry') IS NOT NULL
             AND jsonb_typeof(j->'features'->0->'geometry') = 'object' THEN
            CREATE TEMP TABLE IF NOT EXISTS _pr_feat (geom geometry) ON COMMIT DROP;
            TRUNCATE _pr_feat;
            INSERT INTO _pr_feat
            SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'), 4326))
              FROM jsonb_array_elements(j->'features') f
             WHERE jsonb_typeof(f->'geometry') = 'object';

            DELETE FROM prodes_uc_ano WHERE ano = p.ano;
            INSERT INTO prodes_uc_ano (ano, uc_id, poligonos, area_ha)
            SELECT p.ano, u.id, count(*),
                   round((sum(ST_Area(ST_Intersection(g.geom, u.geom)::geography)) / 10000)::numeric, 1)
              FROM _pr_feat g
              JOIN (SELECT id, ST_MakeValid(geom) AS geom FROM unidades_conservacao
                     WHERE geom IS NOT NULL) u
                ON ST_Intersects(g.geom, u.geom)
             GROUP BY u.id;

            DELETE FROM prodes_mun_ano WHERE ano = p.ano;
            INSERT INTO prodes_mun_ano (ano, cd_ibge, poligonos, area_ha)
            SELECT p.ano, s.cd_ibge, count(DISTINCT g.ctid),
                   round((sum(ST_Area(ST_Intersection(g.geom, s.geom)::geography)) / 10000)::numeric, 1)
              FROM _pr_feat g
              JOIN municipios_acre_sub s ON ST_Intersects(g.geom, s.geom)
             GROUP BY s.cd_ibge;
          END IF;
          n := n + 1;
        END IF;
        DELETE FROM prodes_resumo_pedidos WHERE ano = p.ano;
      EXCEPTION WHEN others THEN
        RAISE WARNING 'prodes_resumo_coletar: falha em %: %', p.ano, SQLERRM;
      END;
    ELSE
      DELETE FROM prodes_resumo_pedidos WHERE ano = p.ano;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_resumo_coletar(int) FROM PUBLIC, anon, authenticated;

-- ── 5. Cobertura (344) por município ─────────────────────────
ALTER TABLE public.prodes_cobertura ADD COLUMN IF NOT EXISTS cd_ibge text
  REFERENCES public.municipios_acre(cd_ibge) ON DELETE CASCADE;
DROP INDEX IF EXISTS public.prodes_cobertura_unq;
CREATE UNIQUE INDEX prodes_cobertura_unq ON public.prodes_cobertura
  (classe, ano, coalesce(uc_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(cd_ibge, ''));
COMMENT ON COLUMN public.prodes_cobertura.cd_ibge IS
  'Município (IBGE). Linha do ESTADO = uc_id NULL e cd_ibge NULL.';
ALTER TABLE public.prodes_cobertura_pedidos ADD COLUMN IF NOT EXISTS cd_ibge text;

CREATE OR REPLACE FUNCTION public.prodes_cobertura_areas()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n int;
BEGIN
  DELETE FROM prodes_cobertura WHERE classe = 'area_total';
  INSERT INTO prodes_cobertura (classe, ano, uc_id, area_ha)
  SELECT 'area_total', 0, NULL, round((ST_Area(geom::geography) / 10000)::numeric)
    FROM limite_acre WHERE geom IS NOT NULL LIMIT 1;
  INSERT INTO prodes_cobertura (classe, ano, uc_id, area_ha)
  SELECT 'area_total', 0, id, round((ST_Area(ST_MakeValid(geom)::geography) / 10000)::numeric, 1)
    FROM unidades_conservacao WHERE ativo AND geom IS NOT NULL;
  INSERT INTO prodes_cobertura (classe, ano, cd_ibge, area_ha)
  SELECT 'area_total', 0, cd_ibge, area_ha FROM municipios_acre;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_cobertura_areas() FROM PUBLIC, anon, authenticated;

-- Lista de parâmetros muda → DROP antes (lição da 178/224).
DROP FUNCTION IF EXISTS public.prodes_cobertura_solicitar(text[], boolean);
CREATE FUNCTION public.prodes_cobertura_solicitar(
  p_classes text[] DEFAULT ARRAY['d2007','residuo','nao_floresta','hidrografia'],
  p_por_uc  boolean DEFAULT true,
  p_por_mun boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE c text; u record; rid bigint; n int := 0;
  base text := 'https://terrabrasilis.dpi.inpe.br/geoserver/prodes-amazon-nb/ows'
            || '?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json';
BEGIN
  FOREACH c IN ARRAY p_classes LOOP
    SELECT net.http_get(base || '&typeName=prodes-amazon-nb:' || _prodes_cobertura_camada(c)
        || '&propertyName=year,area_km' || CASE WHEN c = 'd2007' THEN '' ELSE ',geom' END
        || '&CQL_FILTER=state=%27AC%27', timeout_milliseconds := 180000) INTO rid;
    INSERT INTO prodes_cobertura_pedidos (chave, classe, uc_id, request_id)
    VALUES (c || ':estado', c, NULL, rid)
    ON CONFLICT (chave) DO UPDATE SET request_id = EXCLUDED.request_id, solicitado_em = now();
    n := n + 1;

    IF c = 'd2007' THEN
      FOR u IN
        SELECT 'uc' AS nivel, id::text AS chave, id AS uc_id, NULL::text AS cd_ibge,
               ST_XMin(b) x1, ST_YMin(b) y1, ST_XMax(b) x2, ST_YMax(b) y2
          FROM (SELECT id, ST_Envelope(geom) b FROM unidades_conservacao
                 WHERE ativo AND geom IS NOT NULL AND p_por_uc) e
        UNION ALL
        SELECT 'mun', cd_ibge, NULL, cd_ibge,
               ST_XMin(b), ST_YMin(b), ST_XMax(b), ST_YMax(b)
          FROM (SELECT cd_ibge, ST_Envelope(geom) b FROM municipios_acre WHERE p_por_mun) m
      LOOP
        SELECT net.http_get(base || '&typeName=prodes-amazon-nb:' || _prodes_cobertura_camada(c)
            || '&propertyName=year,area_km,geom'
            || '&CQL_FILTER=state=%27AC%27%20AND%20BBOX(geom,'
            || u.x1 || ',' || u.y1 || ',' || u.x2 || ',' || u.y2 || ')',
            timeout_milliseconds := 180000) INTO rid;
        INSERT INTO prodes_cobertura_pedidos (chave, classe, uc_id, cd_ibge, request_id)
        VALUES (c || ':' || CASE WHEN u.nivel = 'mun' THEN 'mun:' ELSE '' END || u.chave,
                c, u.uc_id, u.cd_ibge, rid)
        ON CONFLICT (chave) DO UPDATE SET request_id = EXCLUDED.request_id, solicitado_em = now();
        n := n + 1;
      END LOOP;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_cobertura_solicitar(text[], boolean, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prodes_cobertura_coletar(p_max int DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p record; j jsonb; nfeat int; n int := 0;
BEGIN
  FOR p IN
    SELECT pe.chave, pe.classe, pe.uc_id, pe.cd_ibge, r.status_code, r.content
      FROM prodes_cobertura_pedidos pe
      JOIN net._http_response r ON r.id = pe.request_id
     ORDER BY (pe.uc_id IS NOT NULL OR pe.cd_ibge IS NOT NULL), pe.chave
     LIMIT p_max
  LOOP
    IF p.status_code = 200 THEN
      BEGIN
        j := p.content::jsonb;
        nfeat := jsonb_array_length(j->'features');

        CREATE TEMP TABLE IF NOT EXISTS _pc_feat (ano smallint, area_km numeric, geom geometry) ON COMMIT DROP;
        TRUNCATE _pc_feat;
        INSERT INTO _pc_feat
        SELECT round((f->'properties'->>'year')::numeric)::smallint,
               (f->'properties'->>'area_km')::numeric,
               CASE WHEN jsonb_typeof(f->'geometry') = 'object'
                    THEN ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'), 4326)) END
          FROM jsonb_array_elements(j->'features') f;

        IF p.uc_id IS NULL AND p.cd_ibge IS NULL THEN
          -- Estado: 0 feições em d2007 seria resposta quebrada, nunca "zero".
          IF nfeat > 0 OR p.classe <> 'd2007' THEN
            DELETE FROM prodes_cobertura WHERE classe = p.classe AND uc_id IS NULL AND cd_ibge IS NULL;
            INSERT INTO prodes_cobertura (classe, ano, uc_id, poligonos, area_ha)
            SELECT p.classe, coalesce(ano, 2007), NULL, count(*), round(sum(area_km) * 100, 1)
              FROM _pc_feat GROUP BY coalesce(ano, 2007);
          END IF;
          -- Classes pequenas vêm com geometria: já cruza com UCs e municípios.
          IF p.classe <> 'd2007' AND EXISTS (SELECT 1 FROM _pc_feat WHERE geom IS NOT NULL) THEN
            DELETE FROM prodes_cobertura WHERE classe = p.classe AND uc_id IS NOT NULL;
            INSERT INTO prodes_cobertura (classe, ano, uc_id, poligonos, area_ha)
            SELECT p.classe, coalesce(g.ano, 2007), s.id, count(DISTINCT g.ctid),
                   round((sum(ST_Area(ST_Intersection(g.geom, s.geom)::geography)) / 10000)::numeric, 1)
              FROM _pc_feat g
              JOIN (SELECT id, ST_Subdivide(ST_MakeValid(geom), 256) AS geom
                      FROM unidades_conservacao WHERE ativo AND geom IS NOT NULL) s
                ON ST_Intersects(g.geom, s.geom)
             GROUP BY coalesce(g.ano, 2007), s.id;

            DELETE FROM prodes_cobertura WHERE classe = p.classe AND cd_ibge IS NOT NULL;
            INSERT INTO prodes_cobertura (classe, ano, cd_ibge, poligonos, area_ha)
            SELECT p.classe, coalesce(g.ano, 2007), s.cd_ibge, count(DISTINCT g.ctid),
                   round((sum(ST_Area(ST_Intersection(g.geom, s.geom)::geography)) / 10000)::numeric, 1)
              FROM _pc_feat g
              JOIN municipios_acre_sub s ON ST_Intersects(g.geom, s.geom)
             GROUP BY coalesce(g.ano, 2007), s.cd_ibge;
          END IF;
        ELSIF p.uc_id IS NOT NULL THEN
          -- Uma UC (d2007 recortado pelo retângulo dela): cruza só com ela.
          DELETE FROM prodes_cobertura WHERE classe = p.classe AND uc_id = p.uc_id;
          INSERT INTO prodes_cobertura (classe, ano, uc_id, poligonos, area_ha)
          SELECT p.classe, 2007, p.uc_id, count(DISTINCT g.ctid),
                 coalesce(round((sum(ST_Area(ST_Intersection(g.geom, s.geom)::geography)) / 10000)::numeric, 1), 0)
            FROM _pc_feat g
            JOIN (SELECT ST_Subdivide(ST_MakeValid(geom), 256) AS geom
                    FROM unidades_conservacao WHERE id = p.uc_id) s
              ON ST_Intersects(g.geom, s.geom);
        ELSE
          -- Um município (d2007 recortado pelo retângulo dele).
          DELETE FROM prodes_cobertura WHERE classe = p.classe AND cd_ibge = p.cd_ibge;
          INSERT INTO prodes_cobertura (classe, ano, cd_ibge, poligonos, area_ha)
          SELECT p.classe, 2007, p.cd_ibge, count(DISTINCT g.ctid),
                 coalesce(round((sum(ST_Area(ST_Intersection(g.geom, s.geom)::geography)) / 10000)::numeric, 1), 0)
            FROM _pc_feat g
            JOIN municipios_acre_sub s ON s.cd_ibge = p.cd_ibge AND ST_Intersects(g.geom, s.geom);
        END IF;

        DELETE FROM prodes_cobertura_pedidos WHERE chave = p.chave;
        n := n + 1;
      EXCEPTION WHEN others THEN
        RAISE WARNING 'prodes_cobertura_coletar: falha em %: %', p.chave, SQLERRM;
      END;
    ELSE
      DELETE FROM prodes_cobertura_pedidos WHERE chave = p.chave;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_cobertura_coletar(int) FROM PUBLIC, anon, authenticated;

-- Cron do resíduo (344) continua válido: a chamada posicional (ARRAY, false)
-- cai no novo 3º parâmetro com o padrão (true) — resíduo com geometria
-- já é cruzado com UCs e municípios na mesma resposta.

-- Carga (fora da migration, passo a passo — ver cabeçalho):
--   SELECT municipios_acre_solicitar();  → aguardar → SELECT municipios_acre_carregar();
--   SELECT prodes_cobertura_areas();
--   SELECT focos_municipio_preencher(a);   -- um ano por chamada, 2001…ano atual
--   SELECT focos_mun_atualizar();
--   SELECT prodes_resumo_solicitar(2008, 2025); → prodes_resumo_coletar(1) ×18
--   SELECT prodes_cobertura_solicitar(ARRAY['d2007','residuo','nao_floresta','hidrografia'], false, true);
--     → prodes_cobertura_coletar(1) repetido até 0
