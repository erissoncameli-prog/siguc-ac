-- 063_registro_geojson.sql
-- Helper para o mapa de validação: devolve as geometrias do registro
-- como GeoJSON (ponto do app, polígono do app e polígono validado) +
-- as áreas. Mesma checagem de perfil da validação.

CREATE OR REPLACE FUNCTION registro_geojson(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_perfil text;
  v_result jsonb;
BEGIN
  SELECT u.perfil INTO v_perfil
    FROM usuarios u WHERE u.id = auth.uid() AND u.ativo;

  IF v_perfil IS NULL OR v_perfil NOT IN ('tecnico', 'gestor', 'super_admin', 'biologo') THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  SELECT jsonb_build_object(
           'ponto',              CASE WHEN localizacao IS NOT NULL
                                   THEN ST_AsGeoJSON(localizacao)::jsonb END,
           'perimetro',          CASE WHEN perimetro_geom IS NOT NULL
                                   THEN ST_AsGeoJSON(perimetro_geom)::jsonb END,
           'perimetro_validado', CASE WHEN perimetro_geom_validado IS NOT NULL
                                   THEN ST_AsGeoJSON(perimetro_geom_validado)::jsonb END,
           'area_estimada_ha',   area_estimada_ha,
           'area_medida_ha',     area_medida_ha,
           'area_validada_ha',   area_validada_ha
         )
    INTO v_result
    FROM registros_campo
   WHERE id = p_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION registro_geojson TO authenticated;
