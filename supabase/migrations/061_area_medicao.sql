-- 061_area_medicao.sql
-- Medição de área no app de campo das brigadas.
-- Além da estimativa visual (area_estimada_ha, mantida), o brigadista
-- pode MEDIR a área por GPS — tocando nos vértices (cantos) ou
-- caminhando o perímetro. Guardamos o método, a área medida e o
-- polígono, para rastreabilidade e validação pelo DEUC.
-- Tudo aditivo e compatível com registros antigos.

ALTER TABLE registros_campo
  ADD COLUMN IF NOT EXISTS area_metodo    text
    CHECK (area_metodo IN ('estimativa', 'vertices', 'perimetro')),
  ADD COLUMN IF NOT EXISTS area_medida_ha numeric(10,2),
  ADD COLUMN IF NOT EXISTS perimetro_geom geometry(Polygon, 4326);

COMMENT ON COLUMN registros_campo.area_metodo    IS
  'Como a área foi obtida: estimativa (visual) | vertices (GPS nos cantos) | perimetro (GPS caminhando em volta)';
COMMENT ON COLUMN registros_campo.area_medida_ha IS
  'Área calculada a partir de perimetro_geom (ha). Fonte da verdade = servidor (trigger abaixo).';
COMMENT ON COLUMN registros_campo.perimetro_geom IS
  'Polígono medido por GPS no campo (SRID 4326).';

CREATE INDEX IF NOT EXISTS idx_registros_campo_perimetro_geom
  ON registros_campo USING GIST (perimetro_geom)
  WHERE perimetro_geom IS NOT NULL;

-- Recalcula a área medida (ha) a partir do polígono. O cliente envia o
-- valor só para feedback imediato (offline); o servidor é a fonte da
-- verdade — mesmo padrão de calcular_area_projeto() (008).
CREATE OR REPLACE FUNCTION calcular_area_medida_registro_campo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.perimetro_geom IS NOT NULL THEN
    -- ST_Area com geografia retorna m², divide por 10000 para ha
    NEW.area_medida_ha := ROUND(
      (ST_Area(NEW.perimetro_geom::geography) / 10000.0)::numeric, 2
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calcular_area_medida_registro_campo_trigger ON registros_campo;
CREATE TRIGGER calcular_area_medida_registro_campo_trigger
  BEFORE INSERT OR UPDATE OF perimetro_geom ON registros_campo
  FOR EACH ROW EXECUTE FUNCTION calcular_area_medida_registro_campo();
