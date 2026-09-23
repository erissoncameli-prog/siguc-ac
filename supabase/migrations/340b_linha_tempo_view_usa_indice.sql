-- ============================================================
-- 340b_linha_tempo_view_usa_indice.sql
-- Achado medindo a 340 em produção: vw_focos_linha_tempo expunha
-- `h.ano::int`, e o filtro `ano = 2026` virava `(ano)::integer = 2026`
-- — o planner não usa idx_focos_ano através do cast e varria as 953
-- mil linhas de focos_calor_ac a cada ano (3,9 s por clique no slider).
-- A coluna volta a ser smallint (o tipo da tabela) e o ramo do FIRMS
-- é que se converte. Mudar tipo de coluna de view exige DROP (CREATE
-- OR REPLACE rejeita); nada depende da view além da própria função de
-- resumo, que lê pelo nome.
-- ============================================================
DROP VIEW IF EXISTS public.vw_focos_linha_tempo;
CREATE VIEW public.vw_focos_linha_tempo
WITH (security_invoker = true) AS
SELECT h.ano                  AS ano,
       h.lat::float8          AS lat,
       h.lon::float8          AS lon,
       h.source               AS source,
       h.frp::float8          AS frp,
       h.acq_date             AS acq_date,
       'serie_historica'::text AS origem
  FROM public.focos_calor_ac h
 WHERE h.dentro_acre
UNION ALL
SELECT extract(year FROM f.data_hora AT TIME ZONE 'America/Rio_Branco')::smallint,
       f.lat::float8,
       f.lon::float8,
       CASE f.satelite WHEN 'N' THEN 'VIIRS_SNPP' ELSE 'MODIS' END,
       f.frp::float8,
       (f.data_hora AT TIME ZONE 'America/Rio_Branco')::date,
       'firms_diario'::text
  FROM public.focos_calor f
 WHERE f.fonte = 'FIRMS'
   AND f.satelite IN ('N', 'Terra', 'Aqua')
   AND extract(year FROM f.data_hora AT TIME ZONE 'America/Rio_Branco')
       > (SELECT max(ano) FROM public.focos_calor_ac);

COMMENT ON VIEW public.vw_focos_linha_tempo IS
  'Focos da linha do tempo do Mapa das UCs: série histórica (dentro_acre) + FIRMS diário (VIIRS S-NPP/MODIS) nos anos que a série não cobre. Migrations 340/340b.';

GRANT SELECT ON public.vw_focos_linha_tempo TO authenticated;
REVOKE ALL ON public.vw_focos_linha_tempo FROM anon;
