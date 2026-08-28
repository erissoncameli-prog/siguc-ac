-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 294 — corrige o recorte do Acre para alerta com polígono
-- Entrega 2 (Ingestão) do Dashboard de Alertas Ambientais.
--
-- Achado ao desenhar a ingestão do DETER: `trg_alertas_ambientais_no_acre`
-- (migration 239, geo_descartar_fora_do_acre) e `trg_alertas_resolver_campos`
-- (migration 291) são as DUAS triggers BEFORE INSERT de alertas_ambientais.
-- Postgres as executa em ORDEM ALFABÉTICA pelo nome — "no_acre" vem antes
-- de "resolver_campos". A função de descarte tinha
-- `IF NEW.geom IS NULL THEN RETURN NEW END IF` (fail-open, certo para o
-- formato antigo, em que geom sempre vinha preenchido pelo cliente).
--
-- Com a 291, um alerta DETER passou a chegar com `poligono` preenchido e
-- `geom` NULL (só a trigger seguinte deriva o centroide). Resultado: a
-- garantia dura "todo alerta fora do Acre é descartado, para qualquer
-- rota de ingestão" (promessa textual da 239) ficava, na prática,
-- pulada para esse formato — o insert passava batido pelo recorte e só
-- ganhava geom/uc_id depois, sem nunca ter sido barrado.
--
-- Corrige a FUNÇÃO (não a ordem de nomes das triggers, que é implícita
-- e frágil): quando geom é nulo, cai para o centroide de `poligono`
-- antes de decidir. Continua fail-open (RETURN NEW) só quando NENHUM
-- dos dois existir — nunca deve travar a ingestão por falta de
-- geometria.
--
-- Validado com dois INSERTs de teste (revertidos): polígono dentro do
-- Acre passou com geom derivado; polígono em pleno Amazonas (~Manaus)
-- foi descartado silenciosamente, como esperado.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.geo_descartar_fora_do_acre()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_lat DOUBLE PRECISION;
  v_lon DOUBLE PRECISION;
  v_ref geometry;
BEGIN
  IF TG_TABLE_NAME = 'focos_calor' THEN
    v_lat := NEW.lat; v_lon := NEW.lon;
  ELSE
    v_ref := COALESCE(NEW.geom::geometry, ST_Centroid(NEW.poligono));
    IF v_ref IS NULL THEN RETURN NEW; END IF;
    v_lat := ST_Y(v_ref); v_lon := ST_X(v_ref);
  END IF;

  IF v_lat IS NULL OR v_lon IS NULL THEN RETURN NEW; END IF;
  IF geo_ponto_no_acre(v_lat, v_lon) THEN RETURN NEW; END IF;
  RETURN NULL;
END;
$function$;
