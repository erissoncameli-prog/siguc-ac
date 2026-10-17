-- ============================================================
-- 360b_embargos_cod_car.sql
-- A 1ª carga mostrou que o IMAC informa o nº do CAR (coluna COD_CAR dos
-- shapefiles) — vínculo exato, que vale mesmo quando o polígono do
-- embargo e o do CAR não se sobrepõem (desenho diferente). O IBAMA não
-- informa: lá o cruzamento segue só por sobreposição.
--
-- car_embargos_busca = car_embargos_bbox + casamento por p_cods. Função
-- NOVA em vez de trocar a assinatura: DROP FUNCTION no apply_migration
-- trava pedindo confirmação (ver CLAUDE.md). A car_embargos_bbox fica sem
-- chamador — remover no SQL Editor quando possível:
--   DROP FUNCTION public.car_embargos_bbox(double precision, double precision, double precision, double precision);
-- ============================================================
ALTER TABLE public.embargos_ambientais ADD COLUMN IF NOT EXISTS cod_car text;
CREATE INDEX IF NOT EXISTS embargos_ambientais_cod_car_idx ON public.embargos_ambientais (cod_car) WHERE cod_car IS NOT NULL;
COMMENT ON COLUMN public.embargos_ambientais.cod_car IS 'Nº do CAR quando a fonte informa (IMAC informa; IBAMA não). Vínculo exato, além da sobreposição. Migration 360b.';

CREATE OR REPLACE FUNCTION public.car_embargos_busca(
  p_xmin double precision, p_ymin double precision,
  p_xmax double precision, p_ymax double precision,
  p_cods text[] DEFAULT NULL)
RETURNS TABLE (
  id bigint, fonte text, num_termo text, num_auto text, num_processo text,
  data_embargo date, situacao text, data_desembargo date, area_ha numeric,
  municipio text, descricao text, cod_car text, geojson text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT e.id, e.fonte, e.num_termo, e.num_auto, e.num_processo,
         e.data_embargo, e.situacao, e.data_desembargo, e.area_ha,
         e.municipio, left(e.descricao, 400), e.cod_car,
         ST_AsGeoJSON(CASE WHEN GeometryType(e.geom) LIKE '%POLYGON'
                           THEN ST_SimplifyPreserveTopology(e.geom, 0.00002) ELSE e.geom END, 6)
    FROM embargos_ambientais e
   WHERE e.geom && ST_MakeEnvelope(p_xmin, p_ymin, p_xmax, p_ymax, 4326)
      OR (p_cods IS NOT NULL AND e.cod_car = ANY (p_cods))
   ORDER BY e.data_embargo DESC NULLS LAST
   LIMIT 5000
$$;
REVOKE ALL ON FUNCTION public.car_embargos_busca(double precision, double precision, double precision, double precision, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.car_embargos_busca(double precision, double precision, double precision, double precision, text[]) TO authenticated;
COMMENT ON FUNCTION public.car_embargos_bbox(double precision, double precision, double precision, double precision) IS 'Substituída por car_embargos_busca (360b), que também casa pelo nº do CAR. Sem chamador — remover no SQL Editor quando possível.';
