-- ============================================================
-- 344_prodes_cobertura_acumulada.sql
-- Painel de Fogo e Desmatamento — "quanto já foi desmatado × quanto
-- resta", no Acre inteiro e por UC.
--
-- A série anual (prodes_resumo_ano / prodes_uc_ano, 342) começa em 2008.
-- Somar só ela diria que o Acre perdeu 750 mil ha — o real é ~2,7 mi ha,
-- porque o PRODES entrega o desmatamento ANTERIOR a 2008 numa camada
-- própria (accumulated_deforestation_2007). O saldo só fecha com as
-- quatro camadas de base do mesmo serviço:
--   d2007         desmatado acumulado até 2007
--   residuo       desmatamento antigo detectado tarde (r2010…r2025),
--                 contado no ano em que foi detectado — como o INPE faz
--   nao_floresta  vegetação natural não florestal (nunca foi floresta)
--   hidrografia   rios/lagos mapeados pelo PRODES
-- + area_total (limite do estado / polígono da UC).
-- Floresta que resta = area_total − desmatado − não floresta − rios.
-- Não existe camada de "floresta" no serviço: é subtração, e a tela diz.
--
-- uc_id NULL = estado inteiro, com a área DECLARADA pelo INPE (area_km),
-- para bater com o número oficial. Por UC = interseção calculada aqui.
-- Cada UC é subdividida (ST_Subdivide) antes de cruzar: a RESEX Chico
-- Mendes tem milhares de vértices e milhares de polígonos de 2007 por
-- cima — sem isso o cruzamento passa do statement_timeout.
--
-- Carga em dois passos (pg_net só envia depois do COMMIT), um pedido
-- por coleta — mesmo cuidado da 342c:
--   SELECT prodes_cobertura_solicitar();   -- enfileira
--   SELECT prodes_cobertura_coletar(1);    -- repetir até devolver 0
-- ============================================================

CREATE TABLE IF NOT EXISTS public.prodes_cobertura (
  classe        text NOT NULL CHECK (classe IN ('area_total','d2007','residuo','nao_floresta','hidrografia')),
  ano           smallint NOT NULL,   -- residuo: ano da detecção; demais: 2007; area_total: 0
  uc_id         uuid REFERENCES public.unidades_conservacao(id) ON DELETE CASCADE,  -- NULL = estado
  poligonos     integer,
  area_ha       numeric NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prodes_cobertura_unq
  ON public.prodes_cobertura (classe, ano, coalesce(uc_id, '00000000-0000-0000-0000-000000000000'::uuid));
COMMENT ON TABLE public.prodes_cobertura IS
  'Base do saldo desmatado × remanescente (PRODES): acumulado até 2007, resíduo, não floresta, hidrografia e área total, por estado (uc_id NULL) e por UC.';

ALTER TABLE public.prodes_cobertura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prodes_cobertura_select ON public.prodes_cobertura;
CREATE POLICY prodes_cobertura_select ON public.prodes_cobertura
  FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
REVOKE ALL ON public.prodes_cobertura FROM anon;

-- Fila interna (só funções SECURITY DEFINER mexem; sem policy de propósito)
CREATE TABLE IF NOT EXISTS public.prodes_cobertura_pedidos (
  chave         text PRIMARY KEY,
  classe        text NOT NULL,
  uc_id         uuid,
  request_id    bigint NOT NULL,
  solicitado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prodes_cobertura_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prodes_cobertura_pedidos FROM anon, authenticated;

-- Área total: limite do estado e polígono de cada UC.
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
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_cobertura_areas() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._prodes_cobertura_camada(p_classe text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_classe
    WHEN 'd2007'        THEN 'accumulated_deforestation_2007_biome'
    WHEN 'residuo'      THEN 'residual_biome'
    WHEN 'nao_floresta' THEN 'no_forest_biome'
    WHEN 'hidrografia'  THEN 'hydrography_biome' END
$$;
REVOKE ALL ON FUNCTION public._prodes_cobertura_camada(text) FROM PUBLIC, anon, authenticated;

-- Enfileira as requisições. Estado inteiro: uma por classe (com geometria,
-- exceto d2007, que é grande e vem por UC). Por UC: d2007 recortado pelo
-- retângulo de cada UC.
CREATE OR REPLACE FUNCTION public.prodes_cobertura_solicitar(
  p_classes text[] DEFAULT ARRAY['d2007','residuo','nao_floresta','hidrografia'],
  p_por_uc  boolean DEFAULT true)
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

    IF c = 'd2007' AND p_por_uc THEN
      FOR u IN
        SELECT id, ST_XMin(b) x1, ST_YMin(b) y1, ST_XMax(b) x2, ST_YMax(b) y2
          FROM (SELECT id, ST_Envelope(geom) b FROM unidades_conservacao
                 WHERE ativo AND geom IS NOT NULL) e
      LOOP
        SELECT net.http_get(base || '&typeName=prodes-amazon-nb:' || _prodes_cobertura_camada(c)
            || '&propertyName=year,area_km,geom'
            || '&CQL_FILTER=state=%27AC%27%20AND%20BBOX(geom,'
            || u.x1 || ',' || u.y1 || ',' || u.x2 || ',' || u.y2 || ')',
            timeout_milliseconds := 180000) INTO rid;
        INSERT INTO prodes_cobertura_pedidos (chave, classe, uc_id, request_id)
        VALUES (c || ':' || u.id, c, u.id, rid)
        ON CONFLICT (chave) DO UPDATE SET request_id = EXCLUDED.request_id, solicitado_em = now();
        n := n + 1;
      END LOOP;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_cobertura_solicitar(text[], boolean) FROM PUBLIC, anon, authenticated;

-- Processa até p_max respostas prontas. Falha deixa o pedido na fila
-- (lição da 342b: apagar antes de gravar perdia o dado em silêncio).
CREATE OR REPLACE FUNCTION public.prodes_cobertura_coletar(p_max int DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p record; j jsonb; nfeat int; n int := 0;
BEGIN
  FOR p IN
    SELECT pe.chave, pe.classe, pe.uc_id, r.status_code, r.content
      FROM prodes_cobertura_pedidos pe
      JOIN net._http_response r ON r.id = pe.request_id
     ORDER BY pe.uc_id NULLS FIRST, pe.chave
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

        IF p.uc_id IS NULL THEN
          -- Estado: 0 feições em d2007 seria resposta quebrada, nunca "zero".
          IF nfeat > 0 OR p.classe <> 'd2007' THEN
            DELETE FROM prodes_cobertura WHERE classe = p.classe AND uc_id IS NULL;
            INSERT INTO prodes_cobertura (classe, ano, uc_id, poligonos, area_ha)
            SELECT p.classe, coalesce(ano, 2007), NULL, count(*), round(sum(area_km) * 100, 1)
              FROM _pc_feat GROUP BY coalesce(ano, 2007);
          END IF;
          -- Classes pequenas vêm com geometria: já cruza com todas as UCs.
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
          END IF;
        ELSE
          -- Uma UC (d2007 recortado pelo retângulo dela): cruza só com ela.
          DELETE FROM prodes_cobertura WHERE classe = p.classe AND uc_id = p.uc_id;
          INSERT INTO prodes_cobertura (classe, ano, uc_id, poligonos, area_ha)
          SELECT p.classe, 2007, p.uc_id, count(DISTINCT g.ctid),
                 coalesce(round((sum(ST_Area(ST_Intersection(g.geom, s.geom)::geography)) / 10000)::numeric, 1), 0)
            FROM _pc_feat g
            JOIN (SELECT ST_Subdivide(ST_MakeValid(geom), 256) AS geom
                    FROM unidades_conservacao WHERE id = p.uc_id) s
              ON ST_Intersects(g.geom, s.geom);
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

SELECT public.prodes_cobertura_areas();

-- O resíduo cresce todo ano (r2026 aparece com o PRODES 2026); as outras
-- três camadas são fixas desde 2007. Mensal basta: dia 2, depois da
-- janela do prodes_resumo (domingos).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('prodes-cobertura-solicitar','prodes-cobertura-coletar');
SELECT cron.schedule('prodes-cobertura-solicitar', '0 11 2 * *',
  $$SELECT public.prodes_cobertura_solicitar(ARRAY['residuo'], false)$$);
SELECT cron.schedule('prodes-cobertura-coletar', '20 11 2 * *',
  $$SELECT public.prodes_cobertura_coletar(1)$$);
