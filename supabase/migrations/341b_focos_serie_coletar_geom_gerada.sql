-- ============================================================
-- 341b_focos_serie_coletar_geom_gerada.sql
-- focos_calor_ac.geom é coluna GERADA (migration 292, aplicada em
-- produção mas ausente do repositório) — a 341 tentava gravar nela e o
-- INSERT falhava com 428C9. Achado no teste de paridade, antes de
-- gravar qualquer linha: a janela 11–15/08/2024 reimportada casou
-- 1.214/1.214 (MODIS) e 4.230/4.230 (VIIRS) com o que a série já tinha.
-- Mesma assinatura: CREATE OR REPLACE basta.
-- ============================================================
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
