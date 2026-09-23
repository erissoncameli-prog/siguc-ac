-- ============================================================
-- 340_linha_tempo_focos_prodes.sql
-- Linha do tempo do Mapa das UCs (pages/mapa.html, modo "Anos"):
-- 2025 e 2026 apareciam vazios.
--
-- Diagnóstico (medido em produção, 23/09/2026):
--  1. Os pontos de foco vinham só de focos_calor_ac — carga ÚNICA
--     (scripts/importar_focos_calor.py), série 2001–2024. Nada
--     acrescenta ano novo a ela.
--  2. O número "focos de calor" do painel e os números do PRODES
--     eram constantes escritas no código (TL_FOCOS_ANO /
--     TL_PRODES_ANO), paradas em 2024. E o de focos contava a linha
--     BRUTA da tabela, com o bbox retangular da importação: 2024
--     mostrava 96.749 focos, dos quais só 47.805 são do Acre
--     (dentro_acre, que bate 100% com geo_ponto_no_acre()).
--  3. focos_calor (ingest-focos, diário desde 03/07/2026) já tinha
--     focos de 2026, mas o modo Anos nunca a consultava.
--
-- O que esta migration faz:
--  - vw_focos_linha_tempo: DEFINIÇÃO ÚNICA de "foco da linha do
--    tempo". Série histórica (só dentro_acre) + o registro diário do
--    FIRMS nos anos que a série não cobre. Do diário entram só os
--    MESMOS sensores da série (VIIRS S-NPP = 'N' e MODIS Terra/Aqua):
--    NOAA-20 e BDQueimadas ficam fora — somar sensor novo, ou a mesma
--    detecção vinda de duas fontes, faria o ano recente parecer pior
--    que o histórico sem o fogo ter mudado. O recorte do Acre no
--    diário já é garantido pelo trigger da 239.
--  - focos_resumo_ano: total por ano, lido da view (o GROUP BY sobre
--    953 mil linhas custa ~1,4 s — não pode rodar a cada abertura da
--    linha do tempo). Recalculado por pg_cron diário, depois do
--    ingest-focos (09:15 UTC).
--  - prodes_resumo_ano: polígonos e área do PRODES no Acre, por ano,
--    lidos do WFS do TerraBrasilis — a MESMA camada
--    (prodes-amazon-nb:yearly_deforestation_biome) que a linha do
--    tempo já desenha. Conferido: 2024 pelo WFS = 5.699 polígonos e
--    41.135 ha, idêntico à constante antiga. pg_net é assíncrono, então
--    são dois passos (solicitar → coletar), no molde da 239. Ano ainda
--    não publicado pelo INPE (vem 0 feições) NUNCA grava zero — fica
--    sem linha, e a tela diz "ainda não publicado".
--
-- ⚠ O vão de 2025 inteiro e jan–jun/2026 de focos NÃO é resolvido
-- aqui: nenhuma tabela tem esse período. Completar exige nova carga
-- da série histórica (FIRMS archive) — passo separado.
-- ============================================================

-- ── 1. Focos: definição única ───────────────────────────────
CREATE OR REPLACE VIEW public.vw_focos_linha_tempo
WITH (security_invoker = true) AS
SELECT h.ano::int            AS ano,
       h.lat::float8          AS lat,
       h.lon::float8          AS lon,
       h.source               AS source,
       h.frp::float8          AS frp,
       h.acq_date             AS acq_date,
       'serie_historica'::text AS origem
  FROM public.focos_calor_ac h
 WHERE h.dentro_acre
UNION ALL
SELECT extract(year FROM f.data_hora AT TIME ZONE 'America/Rio_Branco')::int,
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
  'Focos da linha do tempo do Mapa das UCs: série histórica (dentro_acre) + FIRMS diário (VIIRS S-NPP/MODIS) nos anos que a série não cobre. Migration 340.';

GRANT SELECT ON public.vw_focos_linha_tempo TO authenticated;
REVOKE ALL ON public.vw_focos_linha_tempo FROM anon;

CREATE TABLE IF NOT EXISTS public.focos_resumo_ano (
  ano           int PRIMARY KEY,
  focos         int  NOT NULL,
  origem        text NOT NULL,       -- serie_historica | firms_diario
  periodo_ini   date NOT NULL,
  periodo_fim   date NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.focos_resumo_ano ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS focos_resumo_ano_select ON public.focos_resumo_ano;
CREATE POLICY focos_resumo_ano_select ON public.focos_resumo_ano
  FOR SELECT TO authenticated USING (pode_ver('mapa'));
REVOKE ALL ON public.focos_resumo_ano FROM anon;

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
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.focos_resumo_ano_atualizar() FROM PUBLIC, anon, authenticated;

SELECT public.focos_resumo_ano_atualizar();

-- ── 2. PRODES: resumo anual do Acre ─────────────────────────
CREATE TABLE IF NOT EXISTS public.prodes_resumo_ano (
  ano           int PRIMARY KEY,
  poligonos     int     NOT NULL,
  area_ha       numeric NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prodes_resumo_ano ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prodes_resumo_ano_select ON public.prodes_resumo_ano;
CREATE POLICY prodes_resumo_ano_select ON public.prodes_resumo_ano
  FOR SELECT TO authenticated USING (pode_ver('mapa'));
REVOKE ALL ON public.prodes_resumo_ano FROM anon;

-- Pedidos pg_net em voo (só as funções abaixo tocam; RLS sem policy).
CREATE TABLE IF NOT EXISTS public.prodes_resumo_pedidos (
  ano           int PRIMARY KEY,
  request_id    bigint NOT NULL,
  solicitado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prodes_resumo_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prodes_resumo_pedidos FROM anon, authenticated;

-- Ponto de partida = as constantes que estavam no código (2008–2024,
-- 2024 conferido contra o WFS) + 2025 medido no WFS nesta entrega.
-- O cron abaixo sobrescreve com o que o INPE publicar.
INSERT INTO public.prodes_resumo_ano (ano, poligonos, area_ha) VALUES
  (2008,2701,28873),(2009,1725,16162),(2010,2671,26537),(2011,3049,29579),
  (2012,2573,27054),(2013,2265,20024),(2014,3759,34859),(2015,2100,22300),
  (2016,4655,36631),(2017,2224,24573),(2018,4558,42659),(2019,5842,70694),
  (2020,5510,66081),(2021,6934,89243),(2022,10643,100586),(2023,5877,46295),
  (2024,5699,41135),(2025,5096,27546)
ON CONFLICT (ano) DO NOTHING;

CREATE OR REPLACE FUNCTION public.prodes_resumo_solicitar(
  p_ano_ini int DEFAULT extract(year FROM now())::int - 1,
  p_ano_fim int DEFAULT extract(year FROM now())::int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a int; rid bigint; n int := 0;
BEGIN
  FOR a IN GREATEST(p_ano_ini, 2008) .. LEAST(p_ano_fim, extract(year FROM now())::int) LOOP
    SELECT net.http_get(
      'https://terrabrasilis.dpi.inpe.br/geoserver/prodes-amazon-nb/ows'
      || '?service=WFS&version=1.0.0&request=GetFeature'
      || '&typeName=prodes-amazon-nb:yearly_deforestation_biome'
      || '&outputFormat=application/json&propertyName=year,area_km'
      || '&CQL_FILTER=year=' || a || '%20AND%20state=%27AC%27',
      timeout_milliseconds := 120000) INTO rid;
    INSERT INTO prodes_resumo_pedidos (ano, request_id) VALUES (a, rid)
      ON CONFLICT (ano) DO UPDATE SET request_id = EXCLUDED.request_id, solicitado_em = now();
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_resumo_solicitar(int, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prodes_resumo_coletar()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
          n := n + 1;
        END IF;
      EXCEPTION WHEN others THEN
        RAISE WARNING 'prodes_resumo_coletar: resposta inválida para %: %', p.ano, SQLERRM;
      END;
    END IF;
    DELETE FROM prodes_resumo_pedidos WHERE ano = p.ano;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_resumo_coletar() FROM PUBLIC, anon, authenticated;

-- ── 3. Agendamento ──────────────────────────────────────────
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('focos-resumo-ano', 'prodes-resumo-solicitar', 'prodes-resumo-coletar');
SELECT cron.schedule('focos-resumo-ano', '45 9 * * *',
  $$SELECT public.focos_resumo_ano_atualizar()$$);
-- PRODES sai uma vez por ano (preliminar ~nov, consolidado depois):
-- semanal basta, e só os 2 anos mais recentes mudam.
SELECT cron.schedule('prodes-resumo-solicitar', '0 10 * * 0',
  $$SELECT public.prodes_resumo_solicitar()$$);
SELECT cron.schedule('prodes-resumo-coletar', '20 10 * * 0',
  $$SELECT public.prodes_resumo_coletar()$$);
