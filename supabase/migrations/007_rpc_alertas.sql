-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · RPC auxiliar para alertas ambientais
-- Encontra qual UC contém um ponto geográfico
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION encontrar_uc_por_ponto(p_lat numeric, p_lng numeric)
RETURNS TABLE (id uuid, nome text, codigo text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id, nome, codigo
  FROM unidades_conservacao
  WHERE ativo = true
    AND geom IS NOT NULL
    AND ST_Within(
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
      geom
    )
  LIMIT 1;
$$;
