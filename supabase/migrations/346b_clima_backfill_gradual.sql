-- ═══════════════════════════════════════════════════════════════════
-- 346b — Clima: carga GRADUAL, dentro da cota gratuita do Open-Meteo
-- ═══════════════════════════════════════════════════════════════════
-- Achado ao aplicar a 346: o Open-Meteo conta 1 "chamada" a cada 14 dias
-- de dado pedido. A série 2001→hoje de UM município (~9.400 dias) vale
-- ~670 chamadas; a cota gratuita é 600/min, 5.000/h e 10.000/dia. Os 22
-- pedidos de uma vez devolveram 17 × HTTP 429 — só 5 municípios
-- entraram. Pedir tudo junto é impossível, então:
--
--  - clima_solicitar_faltantes(p_n): pede os p_n municípios que mais
--    precisam — primeiro quem não tem dado nenhum (série inteira), depois
--    quem está desatualizado (> 36 dias), e aí só do último dia gravado
--    menos 30 (o ERA5 revisa os dias recentes) até hoje−6. Nunca pede de
--    novo o que já está pedido.
--  - Cron a cada 2 h (12 municípios/dia ≈ 8.000 chamadas no pior caso,
--    abaixo das 10.000/dia): a série completa leva ~2 dias; depois a
--    renovação mensal custa ~3 chamadas por município.
--  - A linha do ESTADO ('AC') só existe para o ano em que os 22
--    municípios têm dado — média de meio estado não é o Acre.
--  - O cron mensal que pedia os 22 de uma vez (346) sai; o ENSO fica
--    mensal, sozinho (um arquivo pequeno).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.clima_solicitar_faltantes(p_n int DEFAULT 1) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0; v_ate date := current_date - 6; v_desde date;
BEGIN
  FOR r IN
    SELECT m.cd_ibge, ST_Y(ST_PointOnSurface(m.geom)) lat, ST_X(ST_PointOnSurface(m.geom)) lon,
           (SELECT max(dia) FROM clima_mun_dia d WHERE d.cd_ibge = m.cd_ibge) ultimo
      FROM municipios_acre m
     WHERE NOT EXISTS (SELECT 1 FROM clima_pedidos p WHERE p.chave = m.cd_ibge)
     ORDER BY 4 NULLS FIRST, m.cd_ibge
  LOOP
    EXIT WHEN n >= greatest(p_n, 1);
    IF r.ultimo IS NULL THEN
      v_desde := DATE '2001-01-01';
    ELSIF r.ultimo < current_date - 36 THEN
      v_desde := r.ultimo - 30;
    ELSE
      CONTINUE;   -- em dia
    END IF;
    INSERT INTO clima_pedidos(chave, request_id)
    VALUES (r.cd_ibge, net.http_get(
      url := format('https://archive-api.open-meteo.com/v1/archive?latitude=%s&longitude=%s&start_date=%s&end_date=%s'
                    '&daily=precipitation_sum,temperature_2m_max,relative_humidity_2m_min&timezone=America%%2FRio_Branco',
                    round(r.lat::numeric, 4), round(r.lon::numeric, 4), v_desde, v_ate),
      timeout_milliseconds := 60000));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.clima_solicitar_faltantes(int) FROM PUBLIC, anon, authenticated;

-- Estado só com os 22 municípios no ano (reescreve a função da 346).
CREATE OR REPLACE FUNCTION public.clima_resumo_atualizar() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; v_total int;
BEGIN
  SELECT count(*) INTO v_total FROM municipios_acre;
  DELETE FROM clima_mun_ano;

  WITH d AS (
    SELECT cd_ibge, dia, chuva_mm, tmax_c, umid_min,
           extract(year FROM dia)::smallint ano,
           extract(month FROM dia) BETWEEN 6 AND 9 AS na_seca,
           coalesce(chuva_mm, 0) < 1 AS seco
      FROM clima_mun_dia
  ),
  ilhas AS (
    SELECT cd_ibge, ano, count(*) tam
      FROM (SELECT cd_ibge, ano, dia,
                   dia - (row_number() OVER (PARTITION BY cd_ibge, ano ORDER BY dia))::int grp
              FROM d WHERE na_seca AND seco) x
     GROUP BY cd_ibge, ano, grp
  ),
  seq AS (SELECT cd_ibge, ano, max(tam) maior FROM ilhas GROUP BY cd_ibge, ano),
  ano_mun AS (
    SELECT d.cd_ibge, d.ano,
           CASE WHEN count(*) >= 365 THEN sum(chuva_mm) END chuva_ano,
           sum(chuva_mm) FILTER (WHERE na_seca) chuva_seca,
           count(*) FILTER (WHERE na_seca AND seco) dias_secos,
           avg(tmax_c) FILTER (WHERE na_seca) tmax_seca,
           avg(umid_min) FILTER (WHERE na_seca) umid_seca,
           count(*) FILTER (WHERE na_seca) dias_na_seca
      FROM d GROUP BY d.cd_ibge, d.ano
  )
  INSERT INTO clima_mun_ano(ano, cd_ibge, chuva_ano_mm, chuva_seca_mm, dias_secos, maior_seq_seca,
                            tmax_seca_c, umid_min_seca, dias_na_seca)
  SELECT a.ano, a.cd_ibge, round(a.chuva_ano, 1), round(a.chuva_seca, 1), a.dias_secos,
         coalesce(s.maior, 0), round(a.tmax_seca, 2), round(a.umid_seca, 1), a.dias_na_seca
    FROM ano_mun a LEFT JOIN seq s USING (cd_ibge, ano)
   WHERE a.dias_na_seca > 0 OR a.chuva_ano IS NOT NULL;

  INSERT INTO clima_mun_ano(ano, cd_ibge, chuva_ano_mm, chuva_seca_mm, dias_secos, maior_seq_seca,
                            tmax_seca_c, umid_min_seca, dias_na_seca)
  SELECT c.ano, 'AC',
         round(sum(c.chuva_ano_mm * m.area_ha) / nullif(sum(m.area_ha) FILTER (WHERE c.chuva_ano_mm IS NOT NULL), 0), 1),
         round(sum(c.chuva_seca_mm * m.area_ha) / sum(m.area_ha), 1),
         round(sum(c.dias_secos * m.area_ha) / sum(m.area_ha), 1),
         round(sum(c.maior_seq_seca * m.area_ha) / sum(m.area_ha), 1),
         round(sum(c.tmax_seca_c * m.area_ha) / sum(m.area_ha), 2),
         round(sum(c.umid_min_seca * m.area_ha) / sum(m.area_ha), 1),
         min(c.dias_na_seca)
    FROM clima_mun_ano c JOIN municipios_acre m USING (cd_ibge)
   GROUP BY c.ano
  HAVING count(*) = v_total;

  SELECT count(*) INTO n FROM clima_mun_ano;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.clima_resumo_atualizar() FROM PUBLIC, anon, authenticated;

SELECT public.clima_resumo_atualizar();

SELECT cron.unschedule(jobname) FROM cron.job
 WHERE jobname IN ('clima-solicitar', 'clima-coletar', 'enso-solicitar');
SELECT cron.schedule('clima-solicitar', '7 */2 * * *', $$SELECT public.clima_solicitar_faltantes(1)$$);
SELECT cron.schedule('clima-coletar',   '*/10 * * * *', $$SELECT public.clima_coletar(1)$$);
SELECT cron.schedule('enso-solicitar',  '0 11 3 * *',   $$SELECT public.enso_solicitar()$$);
