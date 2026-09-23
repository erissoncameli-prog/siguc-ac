-- ============================================================
-- 342_painel_fogo_desmatamento_por_uc.sql
-- Base do Painel de Fogo e Desmatamento (pages/painel-fogo-desmatamento.html):
-- histórico de focos e de desmatamento PRODES recortado por UC.
--
-- O que já existia (340/341): totais por ANO no nível do ESTADO. O que
-- faltava para filtrar por UC:
--  1. FOGO — focos_calor_ac já tem uc_id (292). O registro diário
--     (focos_calor) não tinha: ganha a coluna, preenchida por trigger
--     com a MESMA função da série (encontrar_uc_por_ponto) e backfill.
--     vw_focos_linha_tempo ganha uc_id AO FINAL (CREATE OR REPLACE só
--     aceita acrescentar no fim). focos_uc_mes guarda o agregado
--     ano × mês × UC, recalculado junto com focos_resumo_ano — o painel
--     lê ~3 mil linhas prontas, nunca as 950 mil.
--  2. DESMATAMENTO — o PRODES não traz UC. O pedido ao WFS do INPE
--     (340) passa a trazer a GEOMETRIA, e a coleta cruza cada polígono
--     com as 21 UCs no próprio banco (ST_Intersection, área geodésica).
--     Medido antes de escrever, 2024: área calculada 41.144 ha × 41.135
--     ha do INPE (0,02%); RESEX Chico Mendes 4.305 ha, a maior.
--     Geometria vem em SIRGAS 2000 (EPSG:4674) — diferença para WGS84 é
--     submétrica, irrelevante para área em hectares; tratada como 4326.
--     Polígono inválido do INPE passa por ST_MakeValid (achado: sem
--     isso o GEOS aborta com TopologyException).
--     Sobreposição entre UCs medida: ≤ 40 ha no total (borda entre
--     florestas estaduais, ruído de digitalização) — "área em UCs" é a
--     soma por UC, sem união, e a diferença é desprezível.
--
-- Janelas diferentes, declaradas na tela: fogo = temporada 1º/jul a
-- 4/nov de cada ano (341); PRODES = ano-PRODES (ago do ano anterior a
-- jul do ano). Não são o mesmo recorte de tempo e o painel nunca os
-- soma num número só.
-- ============================================================

-- ── 1. Fogo: UC no registro diário ──────────────────────────
ALTER TABLE public.focos_calor ADD COLUMN IF NOT EXISTS uc_id uuid;

CREATE OR REPLACE FUNCTION public.focos_calor_definir_uc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.uc_id := (SELECT id FROM encontrar_uc_por_ponto(NEW.lat::numeric, NEW.lon::numeric) LIMIT 1);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.focos_calor_definir_uc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_focos_calor_uc ON public.focos_calor;
CREATE TRIGGER trg_focos_calor_uc
  BEFORE INSERT OR UPDATE OF lat, lon ON public.focos_calor
  FOR EACH ROW EXECUTE FUNCTION public.focos_calor_definir_uc();

UPDATE public.focos_calor f
   SET uc_id = (SELECT id FROM encontrar_uc_por_ponto(f.lat::numeric, f.lon::numeric) LIMIT 1)
 WHERE f.uc_id IS NULL;

-- Mesmas colunas da 341, uc_id acrescentada ao FINAL.
CREATE OR REPLACE VIEW public.vw_focos_linha_tempo
WITH (security_invoker = true) AS
SELECT h.ano                  AS ano,
       h.lat::float8          AS lat,
       h.lon::float8          AS lon,
       h.source               AS source,
       h.frp::float8          AS frp,
       h.acq_date             AS acq_date,
       'serie_historica'::text AS origem,
       h.uc_id                AS uc_id
  FROM public.focos_calor_ac h
 WHERE h.dentro_acre
UNION ALL
SELECT extract(year FROM f.data_hora AT TIME ZONE 'America/Rio_Branco')::smallint,
       f.lat::float8,
       f.lon::float8,
       CASE f.satelite WHEN 'N' THEN 'VIIRS_SNPP' ELSE 'MODIS' END,
       f.frp::float8,
       (f.data_hora AT TIME ZONE 'America/Rio_Branco')::date,
       'firms_diario'::text,
       f.uc_id
  FROM public.focos_calor f
 WHERE f.fonte = 'FIRMS'
   AND f.satelite IN ('N', 'Terra', 'Aqua')
   AND to_char(f.data_hora AT TIME ZONE 'America/Rio_Branco', 'MM-DD') BETWEEN '07-01' AND '11-04'
   AND extract(year FROM f.data_hora AT TIME ZONE 'America/Rio_Branco')
       > (SELECT max(ano) FROM public.focos_calor_ac);

-- Agregado ano × mês × UC (uc_id NULL = fora de UC).
CREATE TABLE IF NOT EXISTS public.focos_uc_mes (
  ano    int  NOT NULL,
  mes    int  NOT NULL,
  uc_id  uuid,
  origem text NOT NULL,
  focos  int  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focos_uc_mes_ano ON public.focos_uc_mes (ano);
ALTER TABLE public.focos_uc_mes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS focos_uc_mes_select ON public.focos_uc_mes;
CREATE POLICY focos_uc_mes_select ON public.focos_uc_mes
  FOR SELECT TO authenticated USING (pode_ver('mapa'));
REVOKE ALL ON public.focos_uc_mes FROM anon;

-- Mesmo nome e assinatura da 340: o cron diário já agendado passa a
-- recalcular os dois agregados, sem job novo.
CREATE OR REPLACE FUNCTION public.focos_resumo_ano_atualizar()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  DELETE FROM focos_resumo_ano WHERE true;
  INSERT INTO focos_resumo_ano (ano, focos, origem, periodo_ini, periodo_fim)
  SELECT ano, count(*), min(origem), min(acq_date), max(acq_date)
    FROM vw_focos_linha_tempo
   GROUP BY ano;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM focos_uc_mes WHERE true;
  INSERT INTO focos_uc_mes (ano, mes, uc_id, origem, focos)
  SELECT ano, extract(month FROM acq_date)::int, uc_id, min(origem), count(*)
    FROM vw_focos_linha_tempo
   GROUP BY ano, extract(month FROM acq_date), uc_id;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.focos_resumo_ano_atualizar() FROM PUBLIC, anon, authenticated;

SELECT public.focos_resumo_ano_atualizar();

-- ── 2. Desmatamento PRODES por UC ───────────────────────────
CREATE TABLE IF NOT EXISTS public.prodes_uc_ano (
  ano           int     NOT NULL,
  uc_id         uuid    NOT NULL REFERENCES public.unidades_conservacao(id) ON DELETE CASCADE,
  poligonos     int     NOT NULL,
  area_ha       numeric NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ano, uc_id)
);
ALTER TABLE public.prodes_uc_ano ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prodes_uc_ano_select ON public.prodes_uc_ano;
CREATE POLICY prodes_uc_ano_select ON public.prodes_uc_ano
  FOR SELECT TO authenticated USING (pode_ver('mapa'));
REVOKE ALL ON public.prodes_uc_ano FROM anon;

-- Mesma assinatura da 340; só o propertyName ganha a geometria.
CREATE OR REPLACE FUNCTION public.prodes_resumo_solicitar(
  p_ano_ini int DEFAULT extract(year FROM now())::int - 1,
  p_ano_fim int DEFAULT extract(year FROM now())::int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE a int; rid bigint; n int := 0;
BEGIN
  FOR a IN GREATEST(p_ano_ini, 2008) .. LEAST(p_ano_fim, extract(year FROM now())::int) LOOP
    SELECT net.http_get(
      'https://terrabrasilis.dpi.inpe.br/geoserver/prodes-amazon-nb/ows'
      || '?service=WFS&version=1.0.0&request=GetFeature'
      || '&typeName=prodes-amazon-nb:yearly_deforestation_biome'
      || '&outputFormat=application/json&propertyName=year,area_km,geom'
      || '&CQL_FILTER=year=' || a || '%20AND%20state=%27AC%27',
      timeout_milliseconds := 180000) INTO rid;
    INSERT INTO prodes_resumo_pedidos (ano, request_id) VALUES (a, rid)
      ON CONFLICT (ano) DO UPDATE SET request_id = EXCLUDED.request_id, solicitado_em = now();
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_resumo_solicitar(int, int) FROM PUBLIC, anon, authenticated;

-- Mesma assinatura da 340. Total do estado continua vindo da área
-- DECLARADA pelo INPE (area_km) — é o número oficial; a área por UC é
-- a interseção calculada aqui (não há número oficial por UC).
CREATE OR REPLACE FUNCTION public.prodes_resumo_coletar()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p record; j jsonb; nfeat int; area numeric; n int := 0;
BEGIN
  FOR p IN
    SELECT pe.ano, r.status_code, r.content
      FROM prodes_resumo_pedidos pe
      JOIN net._http_response r ON r.id = pe.request_id
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

          -- Por UC, só quando a resposta trouxe geometria.
          IF (j->'features'->0->'geometry') IS NOT NULL
             AND jsonb_typeof(j->'features'->0->'geometry') = 'object' THEN
            DELETE FROM prodes_uc_ano WHERE ano = p.ano;
            INSERT INTO prodes_uc_ano (ano, uc_id, poligonos, area_ha)
            SELECT p.ano, u.id, count(*),
                   round((sum(ST_Area(ST_Intersection(g.geom, u.geom)::geography)) / 10000)::numeric, 1)
              FROM (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'), 4326)) AS geom
                      FROM jsonb_array_elements(j->'features') f
                     WHERE jsonb_typeof(f->'geometry') = 'object') g
              JOIN (SELECT id, ST_MakeValid(geom) AS geom FROM unidades_conservacao
                     WHERE geom IS NOT NULL) u
                ON ST_Intersects(g.geom, u.geom)
             GROUP BY u.id;
          END IF;
          n := n + 1;
        END IF;
        DELETE FROM prodes_resumo_pedidos WHERE ano = p.ano;
      EXCEPTION WHEN others THEN
        -- Fica na fila (não apaga o pedido): o próximo coletar() tenta de
        -- novo enquanto a resposta existir no pg_net.
        RAISE WARNING 'prodes_resumo_coletar: falha em %: %', p.ano, SQLERRM;
      END;
    ELSE
      DELETE FROM prodes_resumo_pedidos WHERE ano = p.ano;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_resumo_coletar() FROM PUBLIC, anon, authenticated;

-- ── 3. Nomes das UCs para o painel ──────────────────────────
-- unidades_conservacao já é legível por autenticado (017_uc_public_read);
-- o painel lê só id/nome/sigla/categoria/grupo — sem view nova.
