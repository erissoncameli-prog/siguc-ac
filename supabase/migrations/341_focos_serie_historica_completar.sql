-- ============================================================
-- 341_focos_serie_historica_completar.sql
-- Completa a série histórica de focos (focos_calor_ac) com os anos que
-- faltam, direto do banco, e deixa o ano seguinte entrar sozinho.
--
-- Contexto (340): a série parava em 2024 — carga única feita por
-- scripts/importar_focos_calor.py — e o registro diário (focos_calor)
-- só começou em 03/07/2026. 2025 ficava sem foco nenhum no sistema.
--
-- Medido antes de escrever (23/09/2026), do banco via pg_net: a API do
-- FIRMS responde, e o arquivo "SP" (processamento padrão, o MESMO
-- produto da série) já cobre até 30/06/2026 — MODIS_SP e
-- VIIRS_SNPP_SP. O proxy das sessões de desenvolvimento bloqueia o
-- FIRMS; o banco não.
--
-- O que a série É, e esta importação repete exatamente:
--  - produtos MODIS_SP ('MODIS') e VIIRS_SNPP_SP ('VIIRS_SNPP');
--  - TEMPORADA DE FOGO, não o ano inteiro: janelas de 5 dias começando
--    de 1º/jul a 31/out (a última cobre até 4/nov) — o script usava
--    MESES_FOGO = [7,8,9,10]. Todos os anos 2001–2024 vão de ~01/07 a
--    ~04/11. Jan–jun NUNCA fez parte da série: não é "vão" a completar.
--  - mesmo bbox (-74,-11,-66,-7), só type = 0 (fogo em vegetação),
--    lat/lon arredondados em 5 casas, e a mesma chave única uq_foco
--    (lat, lon, acq_date, source) — reimportar é idempotente.
--  - dentro_acre / uc_id preenchidos na hora, pelas MESMAS funções da
--    239/292 (geo_ponto_no_acre, encontrar_uc_por_ponto). `geom` é
--    coluna GERADA (292) — não entra no INSERT (corrigido na 341b; este
--    arquivo já está certo para banco novo).
--
-- Chave do FIRMS: a mesma que já está em
-- supabase/functions/ingest-focos/index.ts e em
-- scripts/importar_focos_calor.py (pública no repositório —
-- recomendado rotacionar; quando rotacionar, trocar AQUI e lá).
--
-- Três passos assíncronos (pg_net só envia depois do COMMIT):
--   1. focos_serie_verificar()   → pede a disponibilidade ao FIRMS
--   2. focos_serie_solicitar()   → se o SP cobre a temporada inteira
--      do próximo ano que falta, enfileira as 54 requisições
--      (27 janelas × 2 produtos)
--   3. focos_serie_coletar()     → lê as respostas e insere
-- Ano PARCIAL nunca entra: a série só ganha um ano quando o SP cobre
-- até 4/nov dele — senão max(ano) avançaria com meia temporada e o
-- ano nunca mais seria completado.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.focos_serie_pedidos (
  request_id    bigint PRIMARY KEY,
  tipo          text NOT NULL,          -- disponibilidade | janela
  ano           int,
  produto       text,                   -- MODIS_SP | VIIRS_SNPP_SP
  inicio        date,
  solicitado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.focos_serie_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.focos_serie_pedidos FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._focos_firms_chave()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT '66690c20b8bf3f13bb21f8706e3a75d5'::text $$;
REVOKE ALL ON FUNCTION public._focos_firms_chave() FROM PUBLIC, anon, authenticated;

-- Passo 1
CREATE OR REPLACE FUNCTION public.focos_serie_verificar()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE rid bigint;
BEGIN
  SELECT net.http_get(
    'https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/'
      || _focos_firms_chave() || '/ALL',
    timeout_milliseconds := 60000) INTO rid;
  INSERT INTO focos_serie_pedidos (request_id, tipo) VALUES (rid, 'disponibilidade');
  RETURN rid;
END;
$$;
REVOKE ALL ON FUNCTION public.focos_serie_verificar() FROM PUBLIC, anon, authenticated;

-- Passo 2. p_ano NULL = próximo ano depois do último da série.
CREATE OR REPLACE FUNCTION public.focos_serie_solicitar(p_ano int DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ano int := coalesce(p_ano, (SELECT max(ano) FROM focos_calor_ac) + 1);
  v_fim date := make_date(v_ano, 11, 4);
  v_disp text; v_modis date; v_viirs date;
  d date; prod text; rid bigint; n int := 0;
BEGIN
  -- Já tem janela em voo para este ano: não duplica.
  IF EXISTS (SELECT 1 FROM focos_serie_pedidos WHERE tipo = 'janela' AND ano = v_ano) THEN
    RETURN 0;
  END IF;

  SELECT r.content INTO v_disp
    FROM focos_serie_pedidos p JOIN net._http_response r ON r.id = p.request_id
   WHERE p.tipo = 'disponibilidade' AND r.status_code = 200
   ORDER BY p.solicitado_em DESC LIMIT 1;
  IF v_disp IS NULL THEN
    RAISE NOTICE 'focos_serie_solicitar: sem resposta de disponibilidade — rode focos_serie_verificar() antes';
    RETURN 0;
  END IF;

  SELECT split_part(l, ',', 3)::date INTO v_modis
    FROM regexp_split_to_table(v_disp, E'\n') l WHERE split_part(l, ',', 1) = 'MODIS_SP';
  SELECT split_part(l, ',', 3)::date INTO v_viirs
    FROM regexp_split_to_table(v_disp, E'\n') l WHERE split_part(l, ',', 1) = 'VIIRS_SNPP_SP';
  IF v_modis IS NULL OR v_viirs IS NULL OR least(v_modis, v_viirs) < v_fim THEN
    RAISE NOTICE 'focos_serie_solicitar: SP de % ainda não cobre a temporada (MODIS até %, VIIRS até %)',
      v_ano, v_modis, v_viirs;
    RETURN 0;
  END IF;

  -- Mesmas janelas do script original: dias 1, 6, …, 31 de jul a out
  -- (27 por ano; a de 31/out cobre até 4/nov).
  FOREACH prod IN ARRAY ARRAY['MODIS_SP', 'VIIRS_SNPP_SP'] LOOP
    FOR d IN
      SELECT make_date(v_ano, m, dd)
        FROM generate_series(7, 10) m, unnest(ARRAY[1, 6, 11, 16, 21, 26, 31]) dd
       WHERE dd <= extract(day FROM (make_date(v_ano, m, 1) + interval '1 month' - interval '1 day'))
       ORDER BY 1
    LOOP
      SELECT net.http_get(
        'https://firms.modaps.eosdis.nasa.gov/api/area/csv/' || _focos_firms_chave()
          || '/' || prod || '/-74,-11,-66,-7/5/' || to_char(d, 'YYYY-MM-DD'),
        timeout_milliseconds := 120000) INTO rid;
      INSERT INTO focos_serie_pedidos (request_id, tipo, ano, produto, inicio)
      VALUES (rid, 'janela', v_ano, prod, d);
      n := n + 1;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.focos_serie_solicitar(int) FROM PUBLIC, anon, authenticated;

-- Passo 3. Janela sem resposta ainda fica na fila; resposta de erro
-- (timeout, 5xx, limite de requisição) é reenviada pelo mesmo
-- endereço — o próximo coletar() lê de novo. Só sai da fila a janela
-- que foi lida e inserida.
CREATE OR REPLACE FUNCTION public.focos_serie_coletar()
RETURNS TABLE (janelas_ok int, janelas_pendentes int, janelas_reenviadas int, linhas_lidas int, linhas_inseridas int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p record; cab text[]; i_lat int; i_lon int; i_dt int; i_sat int; i_conf int;
  i_frp int; i_dn int; i_tipo int; v_lidas int; v_ins int; rid bigint;
BEGIN
  janelas_ok := 0; janelas_pendentes := 0; janelas_reenviadas := 0;
  linhas_lidas := 0; linhas_inseridas := 0;

  FOR p IN
    SELECT pe.request_id, pe.ano, pe.produto, pe.inicio, r.status_code, r.content,
           (r.id IS NULL) AS sem_resposta
      FROM focos_serie_pedidos pe
      LEFT JOIN net._http_response r ON r.id = pe.request_id
     WHERE pe.tipo = 'janela'
  LOOP
    IF p.sem_resposta THEN
      janelas_pendentes := janelas_pendentes + 1;
      CONTINUE;
    END IF;

    IF p.status_code IS DISTINCT FROM 200 OR p.content IS NULL
       OR left(ltrim(p.content), 8) <> 'latitude' THEN
      -- Erro/timeout/limite de requisição: reenvia a MESMA janela.
      SELECT net.http_get(
        'https://firms.modaps.eosdis.nasa.gov/api/area/csv/' || _focos_firms_chave()
          || '/' || p.produto || '/-74,-11,-66,-7/5/' || to_char(p.inicio, 'YYYY-MM-DD'),
        timeout_milliseconds := 120000) INTO rid;
      UPDATE focos_serie_pedidos SET request_id = rid, solicitado_em = now()
       WHERE request_id = p.request_id;
      janelas_reenviadas := janelas_reenviadas + 1;
      CONTINUE;
    END IF;

    cab := string_to_array(split_part(p.content, E'\n', 1), ',');
    i_lat  := array_position(cab, 'latitude');
    i_lon  := array_position(cab, 'longitude');
    i_dt   := array_position(cab, 'acq_date');
    i_sat  := array_position(cab, 'satellite');
    i_conf := array_position(cab, 'confidence');
    i_frp  := array_position(cab, 'frp');
    i_dn   := array_position(cab, 'daynight');
    i_tipo := array_position(cab, 'type');

    WITH linhas AS (
      SELECT string_to_array(l, ',') c
        FROM regexp_split_to_table(p.content, E'\n') WITH ORDINALITY t(l, n)
       WHERE n > 1 AND btrim(l) <> ''
    ), normal AS (
      SELECT round(c[i_lat]::numeric, 5)  AS lat,
             round(c[i_lon]::numeric, 5)  AS lon,
             c[i_dt]::date                AS acq_date,
             c[i_sat]                     AS satellite,
             CASE WHEN p.produto LIKE 'MODIS%' THEN 'MODIS' ELSE 'VIIRS_SNPP' END AS source,
             c[i_conf]                    AS confidence,
             nullif(c[i_frp], '')::numeric AS frp,
             nullif(left(c[i_dn], 1), '') AS daynight
        FROM linhas
       WHERE i_tipo IS NULL OR c[i_tipo] = '0'
    ), ins AS (
      INSERT INTO focos_calor_ac (lat, lon, acq_date, ano, mes, satellite, source,
                                  confidence, frp, daynight, dentro_acre, uc_id)
      SELECT n.lat, n.lon, n.acq_date,
             extract(year FROM n.acq_date), extract(month FROM n.acq_date),
             n.satellite, n.source, n.confidence, n.frp, n.daynight,
             geo_ponto_no_acre(n.lat::float8, n.lon::float8),
             (SELECT id FROM encontrar_uc_por_ponto(n.lat, n.lon) LIMIT 1)
        FROM normal n
      ON CONFLICT (lat, lon, acq_date, source) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM normal), (SELECT count(*) FROM ins) INTO v_lidas, v_ins;

    linhas_lidas := linhas_lidas + v_lidas;
    linhas_inseridas := linhas_inseridas + v_ins;
    janelas_ok := janelas_ok + 1;
    DELETE FROM focos_serie_pedidos WHERE request_id = p.request_id;
  END LOOP;

  -- Série mudou: o resumo da linha do tempo acompanha na hora.
  IF linhas_inseridas > 0 THEN PERFORM focos_resumo_ano_atualizar(); END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.focos_serie_coletar() FROM PUBLIC, anon, authenticated;

-- Agendamento mensal (dia 5, UTC): o SP sai com ~3 meses de atraso,
-- então a temporada de um ano completa por volta de fev do seguinte.
-- Enquanto não cobrir, solicitar() devolve 0 e nada muda.
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('focos-serie-verificar', 'focos-serie-solicitar', 'focos-serie-coletar');
SELECT cron.schedule('focos-serie-verificar', '0 11 5 * *',  $$SELECT public.focos_serie_verificar()$$);
SELECT cron.schedule('focos-serie-solicitar', '10 11 5 * *', $$SELECT public.focos_serie_solicitar()$$);
SELECT cron.schedule('focos-serie-coletar',   '*/30 11-13 5 * *', $$SELECT public.focos_serie_coletar()$$);

-- ── vw_focos_linha_tempo: diário na MESMA temporada da série ──
-- Sem isto o ano corrente contaria nov/dez (fora da temporada que a
-- série sempre usou) e deixaria de ser comparável aos anteriores.
-- Mesmas colunas e tipos da 340b — CREATE OR REPLACE aceita.
CREATE OR REPLACE VIEW public.vw_focos_linha_tempo
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
   AND to_char(f.data_hora AT TIME ZONE 'America/Rio_Branco', 'MM-DD') BETWEEN '07-01' AND '11-04'
   AND extract(year FROM f.data_hora AT TIME ZONE 'America/Rio_Branco')
       > (SELECT max(ano) FROM public.focos_calor_ac);
