-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Correção do cálculo de comprimento_m
-- ───────────────────────────────────────────────────────────────
-- Bug em trg_praias_calcular_metricas (073_biomonitor_base.sql):
-- o segundo canto do bounding box era criado em graus (4326) mas
-- rotulado como ST_SetSRID(..., 32720) e em seguida "transformado"
-- 32720→32720 (no-op). Resultado: a distância calculada era, na
-- prática, a coordenada norte (northing) UTM da praia (~8,9 milhões
-- de metros), e não uma dimensão real. Toda praia mostrava ~8,9–9,2
-- milhões de metros.
--
-- Correção: comprimento_m passa a ser a MAIOR EXTENSÃO do polígono
-- (maior distância entre dois pontos), via ST_LongestLine sobre a
-- geometria projetada em UTM 20S (EPSG:32720) → resultado em metros.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_praias_calcular_metricas()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.area_geom IS NOT NULL THEN
    -- Comprimento: maior extensão da praia (maior distância entre dois
    -- pontos do contorno), projetado em UTM 20S para sair em metros.
    NEW.comprimento_m := ROUND(
      ST_Length(
        ST_LongestLine(
          ST_Transform(NEW.area_geom, 32720),
          ST_Transform(NEW.area_geom, 32720)
        )
      )::numeric, 2);
    -- Área em hectares
    NEW.area_ha := ROUND(
      (ST_Area(ST_Transform(NEW.area_geom, 32720)) / 10000.0)::numeric, 4);
    -- Ponto de acesso = centroide se não informado
    IF NEW.ponto_acesso IS NULL THEN
      NEW.ponto_acesso := ST_Centroid(NEW.area_geom);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Recalcula as praias já cadastradas com o valor correto.
UPDATE praias_monitoramento
SET comprimento_m = ROUND(
  ST_Length(
    ST_LongestLine(
      ST_Transform(area_geom, 32720),
      ST_Transform(area_geom, 32720)
    )
  )::numeric, 2)
WHERE area_geom IS NOT NULL;
