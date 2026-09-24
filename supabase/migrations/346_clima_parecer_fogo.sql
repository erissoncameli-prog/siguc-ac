-- ═══════════════════════════════════════════════════════════════════
-- 346 — Clima por município + ENSO, para o parecer do Painel de Fogo
--       e Desmatamento (texto explicativo sem API paga)
-- ═══════════════════════════════════════════════════════════════════
-- O parecer escrito do painel (js/painel-fogo-desmatamento.js,
-- pfdParecer) explica subida/queda de focos com fatos medidos, nunca
-- com texto inventado. Os fatores de clima vêm daqui:
--
--  - Chuva, temperatura máxima e umidade mínima DIÁRIAS por município,
--    da reanálise ERA5 (Open-Meteo, archive-api — gratuito, sem chave),
--    no ponto interno do município (ST_PointOnSurface). Uma reanálise
--    de ~25 km num ponto não é a média do município inteiro: a tela diz
--    isso. Guardado por DIA (idempotente: reimportar só regrava) e
--    resumido por ANO em clima_mun_ano — é o que a tela lê.
--  - Estação SECA = jun–set (a do Acre; o pico do fogo, ago–set, vem no
--    fim dela). "Dia sem chuva" = < 1 mm. Maior sequência seca contada
--    dentro da estação.
--  - Linha do ESTADO (cd_ibge = 'AC') = média dos municípios ponderada
--    pela área — um número por ano, comparável com os focos do Acre.
--  - ENSO: índice ONI (NOAA PSL), mensal. El Niño forte (2015/16,
--    2023/24) está associado a seca na Amazônia sul-ocidental.
--
-- ⚠️ Regra da casa (incidentes de 23–24/09/2026): pg_net guarda cada
-- resposta em net._http_response; converter várias para JSON de uma vez
-- já derrubou o banco. clima_coletar(p_max) processa UMA resposta por
-- chamada, e o cron chama em sequência.
-- ═══════════════════════════════════════════════════════════════════

-- ── Tabelas ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clima_mun_dia (
  cd_ibge   text     NOT NULL REFERENCES public.municipios_acre(cd_ibge) ON DELETE CASCADE,
  dia       date     NOT NULL,
  chuva_mm  numeric,
  tmax_c    numeric,
  umid_min  numeric,
  PRIMARY KEY (cd_ibge, dia)
);

CREATE TABLE IF NOT EXISTS public.clima_mun_ano (
  ano              smallint NOT NULL,
  cd_ibge          text     NOT NULL,            -- 'AC' = estado (média ponderada pela área)
  chuva_ano_mm     numeric,                      -- NULL se o ano não está completo
  chuva_seca_mm    numeric,                      -- jun–set
  dias_secos       numeric,                      -- dias < 1 mm em jun–set
  maior_seq_seca   numeric,                      -- maior sequência de dias < 1 mm em jun–set
  tmax_seca_c      numeric,                      -- média da máxima diária em jun–set
  umid_min_seca    numeric,                      -- média da umidade mínima diária em jun–set
  dias_na_seca     smallint NOT NULL,            -- quantos dias de jun–set existem no dado (122 = completo)
  PRIMARY KEY (ano, cd_ibge)
);

CREATE TABLE IF NOT EXISTS public.clima_enso (
  ano  smallint NOT NULL,
  mes  smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  oni  numeric  NOT NULL,
  PRIMARY KEY (ano, mes)
);

CREATE TABLE IF NOT EXISTS public.clima_pedidos (
  chave        text PRIMARY KEY,                 -- cd_ibge ou 'enso'
  request_id   bigint NOT NULL,
  solicitado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clima_mun_dia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clima_mun_ano ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clima_enso    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clima_pedidos ENABLE ROW LEVEL SECURITY;

-- Dado público de referência, lido pelo painel (mesma regra de 345).
DROP POLICY IF EXISTS clima_mun_ano_select ON public.clima_mun_ano;
CREATE POLICY clima_mun_ano_select ON public.clima_mun_ano FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
DROP POLICY IF EXISTS clima_enso_select ON public.clima_enso;
CREATE POLICY clima_enso_select ON public.clima_enso FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
DROP POLICY IF EXISTS clima_mun_dia_select ON public.clima_mun_dia;
CREATE POLICY clima_mun_dia_select ON public.clima_mun_dia FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
REVOKE ALL ON public.clima_mun_dia, public.clima_mun_ano, public.clima_enso FROM anon;
REVOKE ALL ON public.clima_pedidos FROM anon, authenticated;

-- ── Pedido (pg_net é assíncrono: a resposta só existe depois do COMMIT)
CREATE OR REPLACE FUNCTION public.clima_solicitar(
  p_desde date DEFAULT '2001-01-01',
  p_ate   date DEFAULT (current_date - 6)       -- o ERA5 sai com ~5 dias de atraso
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT cd_ibge, ST_Y(ST_PointOnSurface(geom)) lat, ST_X(ST_PointOnSurface(geom)) lon
      FROM municipios_acre ORDER BY cd_ibge
  LOOP
    INSERT INTO clima_pedidos(chave, request_id)
    VALUES (r.cd_ibge, net.http_get(
      url := format('https://archive-api.open-meteo.com/v1/archive?latitude=%s&longitude=%s&start_date=%s&end_date=%s'
                    '&daily=precipitation_sum,temperature_2m_max,relative_humidity_2m_min&timezone=America%%2FRio_Branco',
                    round(r.lat::numeric, 4), round(r.lon::numeric, 4), p_desde, p_ate),
      timeout_milliseconds := 60000))
    ON CONFLICT (chave) DO UPDATE SET request_id = EXCLUDED.request_id, solicitado_em = now();
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.clima_solicitar(date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enso_solicitar() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid bigint;
BEGIN
  rid := net.http_get(url := 'https://psl.noaa.gov/data/correlation/oni.data', timeout_milliseconds := 30000);
  INSERT INTO clima_pedidos(chave, request_id) VALUES ('enso', rid)
  ON CONFLICT (chave) DO UPDATE SET request_id = EXCLUDED.request_id, solicitado_em = now();
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.enso_solicitar() FROM PUBLIC, anon, authenticated;

-- ── Resumo anual (lê clima_mun_dia, reescreve clima_mun_ano) ────────
CREATE OR REPLACE FUNCTION public.clima_resumo_atualizar() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM clima_mun_ano;

  WITH d AS (
    SELECT cd_ibge, dia, chuva_mm, tmax_c, umid_min,
           extract(year FROM dia)::smallint ano,
           extract(month FROM dia) BETWEEN 6 AND 9 AS na_seca,
           coalesce(chuva_mm, 0) < 1 AS seco
      FROM clima_mun_dia
  ),
  -- sequências secas (ilhas de dias < 1 mm) dentro de jun–set
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

  -- Estado: média dos municípios ponderada pela área (só municípios com o ano).
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
   GROUP BY c.ano;

  SELECT count(*) INTO n FROM clima_mun_ano;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.clima_resumo_atualizar() FROM PUBLIC, anon, authenticated;

-- ── Coleta: UMA resposta por chamada ────────────────────────────────
CREATE OR REPLACE FUNCTION public.clima_coletar(p_max int DEFAULT 1) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p record; resp record; j jsonb; n int; feitos int := 0; msg text := '';
  linha text; partes text[]; i int; v numeric;
BEGIN
  -- Só pega pedido cuja resposta já chegou: um pedido ainda em voo não
  -- pode travar a fila dos outros.
  FOR p IN SELECT cp.* FROM clima_pedidos cp
            WHERE EXISTS (SELECT 1 FROM net._http_response r WHERE r.id = cp.request_id)
            ORDER BY (cp.chave = 'enso') DESC, cp.chave LIMIT greatest(p_max, 1) LOOP
    SELECT status_code, content INTO resp FROM net._http_response WHERE id = p.request_id;
    IF resp.status_code IS DISTINCT FROM 200 THEN
      -- Descarta o pedido sem gravar nada (nunca zero): o cron mensal pede de novo.
      msg := msg || p.chave || ': HTTP ' || resp.status_code || '; ';
      DELETE FROM clima_pedidos WHERE chave = p.chave;
      CONTINUE;
    END IF;

    IF p.chave = 'enso' THEN
      -- oni.data: 1ª linha "ano_ini ano_fim", depois "ano v1..v12"; -99.90 = sem dado.
      FOR linha IN SELECT unnest(string_to_array(resp.content, E'\n')) LOOP
        partes := regexp_split_to_array(btrim(linha), '\s+');
        IF array_length(partes, 1) = 13 AND partes[1] ~ '^\d{4}$' THEN
          FOR i IN 1..12 LOOP
            v := partes[i + 1]::numeric;
            IF v > -90 THEN
              INSERT INTO clima_enso(ano, mes, oni) VALUES (partes[1]::smallint, i, v)
              ON CONFLICT (ano, mes) DO UPDATE SET oni = EXCLUDED.oni;
            END IF;
          END LOOP;
        END IF;
      END LOOP;
      msg := msg || 'enso: ok; ';
    ELSE
      j := resp.content::jsonb;
      INSERT INTO clima_mun_dia(cd_ibge, dia, chuva_mm, tmax_c, umid_min)
      SELECT p.chave, t.dia::date,
             nullif(j->'daily'->'precipitation_sum'->>(t.i::int - 1), '')::numeric,
             nullif(j->'daily'->'temperature_2m_max'->>(t.i::int - 1), '')::numeric,
             nullif(j->'daily'->'relative_humidity_2m_min'->>(t.i::int - 1), '')::numeric
        FROM jsonb_array_elements_text(j->'daily'->'time') WITH ORDINALITY AS t(dia, i)
      ON CONFLICT (cd_ibge, dia) DO UPDATE
        SET chuva_mm = EXCLUDED.chuva_mm, tmax_c = EXCLUDED.tmax_c, umid_min = EXCLUDED.umid_min;
      GET DIAGNOSTICS n = ROW_COUNT;
      msg := msg || p.chave || ': ' || n || ' dias; ';
    END IF;
    DELETE FROM clima_pedidos WHERE chave = p.chave;
    feitos := feitos + 1;
  END LOOP;

  -- Última resposta processada → refaz o resumo anual.
  IF feitos > 0 AND NOT EXISTS (SELECT 1 FROM clima_pedidos WHERE chave <> 'enso') THEN
    PERFORM clima_resumo_atualizar();
    msg := msg || 'resumo atualizado';
  END IF;
  RETURN coalesce(nullif(msg, ''), 'nada pendente');
END $$;
REVOKE ALL ON FUNCTION public.clima_coletar(int) FROM PUBLIC, anon, authenticated;

-- ── Crons: dia 3 de cada mês renova os últimos ~13 meses + ENSO ──────
-- Coleta a cada 2 min (uma resposta por vez, 23 pedidos → ~46 min).
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('clima-solicitar', 'clima-coletar');
SELECT cron.schedule('clima-solicitar', '0 11 3 * *',
  $$SELECT public.enso_solicitar(); SELECT public.clima_solicitar((date_trunc('year', current_date) - interval '1 year')::date)$$);
SELECT cron.schedule('clima-coletar', '*/2 11,12 3 * *', $$SELECT public.clima_coletar(1)$$);
