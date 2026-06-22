-- 073_rpc_poligonos_mapa.sql
-- RPCs para exibir polígonos de brigadas no mapa global de UCs.
-- Usadas pelo painel "Brigadas Comunitárias" em pages/mapa.html.

-- ──────────────────────────────────────────────────────────────────
-- rpc_queimadas_mapa
-- Retorna polígonos validados de registros de combate a incêndio.
-- Prioriza perimetro_geom_validado (corrigido pelo técnico) sobre
-- perimetro_geom (capturado no campo pelo brigadista).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_queimadas_mapa()
RETURNS TABLE (
  id           uuid,
  geom         geometry(Polygon, 4326),
  area_ha      double precision,
  brigada_nome text,
  uc_nome      text,
  uc_sigla     text,
  data_evento  date,
  atividade    text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rc.id,
    CASE
      WHEN rc.perimetro_geom_validado IS NOT NULL THEN rc.perimetro_geom_validado
      ELSE rc.perimetro_geom
    END AS geom,
    COALESCE(rc.area_validada_ha, rc.area_medida_ha, rc.area_estimada_ha) AS area_ha,
    b.nome   AS brigada_nome,
    uc.nome  AS uc_nome,
    uc.sigla AS uc_sigla,
    rc.data_inicio::date AS data_evento,
    rc.atividade
  FROM registros_campo rc
  LEFT JOIN brigadas              b  ON b.id  = rc.brigada_id
  LEFT JOIN unidades_conservacao  uc ON uc.id = rc.uc_id
  WHERE rc.natureza         = 'combate'
    AND rc.status_validacao = 'validado'
    AND (rc.perimetro_geom_validado IS NOT NULL OR rc.perimetro_geom IS NOT NULL)
    AND auth.uid() IS NOT NULL
  ORDER BY rc.data_inicio DESC
  LIMIT 500;
$$;

-- ──────────────────────────────────────────────────────────────────
-- rpc_evitados_mapa
-- Retorna todos os polígonos de áreas de incêndio evitado com
-- informações da brigada e UC do registro vinculado.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_evitados_mapa()
RETURNS TABLE (
  id           uuid,
  geom         geometry(Polygon, 4326),
  area_ha      double precision,
  descricao    text,
  brigada_nome text,
  uc_nome      text,
  uc_sigla     text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    aie.id,
    aie.geom,
    aie.area_ha,
    aie.descricao,
    b.nome   AS brigada_nome,
    uc.nome  AS uc_nome,
    uc.sigla AS uc_sigla
  FROM areas_incendio_evitado aie
  JOIN registros_campo        rc ON rc.id = aie.registro_id
  LEFT JOIN brigadas              b  ON b.id  = rc.brigada_id
  LEFT JOIN unidades_conservacao  uc ON uc.id = rc.uc_id
  WHERE aie.geom IS NOT NULL
    AND auth.uid() IS NOT NULL
  ORDER BY aie.criado_em DESC
  LIMIT 1000;
$$;
