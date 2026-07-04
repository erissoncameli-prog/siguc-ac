-- ════════════════════════════════════════════════════════════════
-- 115 — Áreas evitadas no mapa de UCs (aba Brigadas Comunitárias)
--
-- listar_areas_evitadas (072) é por registro. Para desenhar a camada no
-- mapa, precisamos dos POLÍGONOS filtrados por UC e por intervalo de
-- data do evento. Junta areas_incendio_evitado → registros_campo (uc_id,
-- data_hora_evento, brigada_id) e devolve GeoJSON + metadados.
--
-- Datas comparadas no fuso de Rio Branco (mesmo critério de exibição do
-- app). Parâmetros NULL = sem aquele filtro.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION areas_evitadas_mapa(
  p_uc_id    uuid DEFAULT NULL,
  p_data_ini date DEFAULT NULL,
  p_data_fim date DEFAULT NULL
) RETURNS TABLE (
  id               uuid,
  geom             json,
  area_ha          numeric,
  uc_nome          text,
  brigada_nome     text,
  data_hora_evento timestamptz,
  metodo           text,
  descricao        text
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    a.id,
    ST_AsGeoJSON(a.geom)::json AS geom,
    a.area_ha,
    uc.nome  AS uc_nome,
    br.nome  AS brigada_nome,
    rc.data_hora_evento,
    a.metodo,
    a.descricao
  FROM areas_incendio_evitado a
  JOIN registros_campo rc ON rc.id = a.registro_id
  LEFT JOIN unidades_conservacao uc ON uc.id = rc.uc_id
  LEFT JOIN brigadas             br ON br.id = rc.brigada_id
  WHERE (p_uc_id IS NULL OR rc.uc_id = p_uc_id)
    AND (p_data_ini IS NULL OR (rc.data_hora_evento AT TIME ZONE 'America/Rio_Branco')::date >= p_data_ini)
    AND (p_data_fim IS NULL OR (rc.data_hora_evento AT TIME ZONE 'America/Rio_Branco')::date <= p_data_fim)
  ORDER BY rc.data_hora_evento DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION areas_evitadas_mapa(uuid, date, date) TO authenticated;
