-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 290 — Geometria real das 21 UCs
-- Entrega 1 (Base) do Dashboard de Alertas Ambientais.
--
-- unidades_conservacao.geom/centroide existem desde a 001, mas
-- nunca foram preenchidas — por isso encontrar_uc_por_ponto()
-- sempre devolvia vazio e 100% dos alertas ficavam sem UC.
-- O polígono só existia em data/uc_acre.geojson, lido pelo
-- navegador. Carregamos pelo MESMO caminho da migration 239
-- (limite_acre): pg_net busca o arquivo servido em produção,
-- banco e navegador nunca discordam do polígono.
--
-- Casamento UC do banco ↔ feature do GeoJSON: os nomes NÃO
-- batem literalmente (ex.: banco "Parque Estadual Chandless" ×
-- geojson "PARES Chandles"; banco "Floresta Estadual do
-- Antimary" × geojson "FLOES Antimary"), e um dos nomes do
-- GeoJSON traz um ligature (ﬂ) que arriscaria comparação de
-- texto. Casamos por (sigla, posição no ranking de área dentro
-- da sigla) — verificado manualmente contra as 21 linhas antes
-- de escrever esta migration: ranking por área é 1:1 e
-- inambíguo em todos os grupos de sigla (APA, ARIE, FLOES,
-- FLONA, RESEX têm mais de uma UC; os demais são triviais).
--
-- Aplicada em produção com sucesso: 21/21 UCs casadas
-- corretamente (conferido por comparação de área geom × oficial,
-- 19/21 com desvio < 0,1%). Depois de aplicar, rodar em passo
-- separado (pg_net é assíncrono):
--   SELECT net.http_get('https://siguc-ac.vercel.app/data/uc_acre.geojson');
--   -- aguardar a resposta chegar em net._http_response --
--   SELECT uc_geometrias_carregar();
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.uc_geometrias_carregar()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $function$
DECLARE
  v_conteudo    TEXT;
  v_atualizadas INT := 0;
BEGIN
  SELECT r.content INTO v_conteudo
    FROM net._http_response r
   WHERE r.status_code = 200
     AND r.content LIKE '%FeatureCollection%'
     AND r.content LIKE '%nome_full%'   -- marcador único de data/uc_acre.geojson
   ORDER BY r.id DESC
   LIMIT 1;

  IF v_conteudo IS NULL THEN
    RETURN 'nenhuma resposta pg_net encontrada — rode o net.http_get do uc_acre.geojson e aguarde';
  END IF;

  WITH features AS (
    SELECT
      f->'properties'->>'sigla' AS sigla,
      (f->'properties'->>'area_ha')::numeric AS area_ha,
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326)) AS geom
    FROM jsonb_array_elements((v_conteudo::jsonb)->'features') f
  ),
  rankeadas AS (
    SELECT sigla, geom,
           row_number() OVER (PARTITION BY sigla ORDER BY area_ha) AS rk
    FROM features
  ),
  uc_rank AS (
    SELECT id, sigla,
           row_number() OVER (PARTITION BY sigla ORDER BY area_ha) AS rk
    FROM unidades_conservacao
  )
  UPDATE unidades_conservacao u
     SET geom = r.geom,
         centroide = ST_Centroid(r.geom),
         atualizado_em = now()
    FROM rankeadas r
    JOIN uc_rank k ON k.sigla = r.sigla AND k.rk = r.rk
   WHERE u.id = k.id;

  GET DIAGNOSTICS v_atualizadas = ROW_COUNT;

  IF v_atualizadas <> 21 THEN
    RAISE WARNING 'esperava atualizar 21 UCs, atualizou %', v_atualizadas;
  END IF;

  RETURN v_atualizadas || ' UC(s) com geometria carregada';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.uc_geometrias_carregar() FROM PUBLIC, anon, authenticated;
