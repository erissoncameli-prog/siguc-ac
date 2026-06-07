-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Netflora — Inventário Florestal por IA
-- Embrapa Acre: identificação de espécies via drone + YOLOv7
-- github.com/NetFlora/Netflora (GPL 3.0)
-- ═══════════════════════════════════════════════════════════

-- ── Inventários (voos de drone) ─────────────────────────────

CREATE TABLE IF NOT EXISTS netflora_inventarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uc_id           uuid REFERENCES unidades_conservacao(id) ON DELETE SET NULL,
  uc_nome         text,                    -- cache para listagens
  nome            text NOT NULL,           -- nome descritivo do inventário
  data_voo        date NOT NULL,
  area_ha         numeric(12,2),           -- área coberta pelo voo
  altitude_m      numeric(6,1),            -- altitude de voo em metros
  sobreposicao_pct numeric(4,1),           -- sobreposição lateral/frontal (%)
  sensor          text,                    -- ex: DJI Zenmuse P1, Phantom 4 Pro
  software        text DEFAULT 'Netflora/QGIS',
  arquivo_origem  text,                    -- nome do arquivo .shp/.csv exportado
  observacao      text,
  operador_id     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'processando'
                  CHECK (status IN ('processando','concluido','erro')),
  geom            geometry(MultiPolygon, 4326),  -- polígono da área voo
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nf_inv_uc   ON netflora_inventarios (uc_id);
CREATE INDEX IF NOT EXISTS idx_nf_inv_data ON netflora_inventarios (data_voo DESC);
CREATE INDEX IF NOT EXISTS idx_nf_inv_geom ON netflora_inventarios USING GIST (geom)
  WHERE geom IS NOT NULL;

ALTER TABLE netflora_inventarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nf_inv_select" ON netflora_inventarios
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "nf_inv_write" ON netflora_inventarios
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('tecnico','gestor','super_admin') AND ativo
    )
  );

-- ── Espécies detectadas por inventário ─────────────────────

CREATE TABLE IF NOT EXISTS netflora_especies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id   uuid NOT NULL REFERENCES netflora_inventarios(id) ON DELETE CASCADE,
  especie_nome    text NOT NULL,           -- nome científico: Bertholletia excelsa
  nome_popular    text,                    -- Castanheira-do-Brasil
  familia         text,                    -- Lecythidaceae
  quantidade      integer NOT NULL DEFAULT 0,
  area_copa_m2    numeric(10,2),           -- área média de copa por indivíduo
  confianca_media numeric(5,2),            -- % média de confiança da detecção
  dap_medio_cm    numeric(6,1),            -- DAP médio estimado (cm)
  altura_media_m  numeric(5,1),            -- altura média estimada (m)
  valor_comercial boolean DEFAULT false,   -- espécie madeireira de valor
  notas           text,
  geom            geometry(MultiPoint, 4326),  -- pontos de detecção
  criado_em       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nf_esp_inv ON netflora_especies (inventario_id);
CREATE INDEX IF NOT EXISTS idx_nf_esp_sp  ON netflora_especies (especie_nome);
CREATE INDEX IF NOT EXISTS idx_nf_esp_geo ON netflora_especies USING GIST (geom)
  WHERE geom IS NOT NULL;

ALTER TABLE netflora_especies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nf_esp_select" ON netflora_especies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "nf_esp_write" ON netflora_especies
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('tecnico','gestor','super_admin') AND ativo
    )
  );

-- ── Trigger atualizado_em ───────────────────────────────────

CREATE OR REPLACE FUNCTION touch_netflora_inventario()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_nf_inv_updated
  BEFORE UPDATE ON netflora_inventarios
  FOR EACH ROW EXECUTE FUNCTION touch_netflora_inventario();

-- ── RPCs ────────────────────────────────────────────────────

-- Resumo de espécies por UC
CREATE OR REPLACE FUNCTION netflora_resumo_uc(p_uc_id uuid)
RETURNS TABLE (
  especie_nome    text,
  nome_popular    text,
  total_individuos bigint,
  media_confianca numeric,
  n_inventarios   bigint,
  valor_comercial boolean
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    e.especie_nome,
    e.nome_popular,
    SUM(e.quantidade)                    AS total_individuos,
    ROUND(AVG(e.confianca_media)::numeric, 1) AS media_confianca,
    COUNT(DISTINCT e.inventario_id)      AS n_inventarios,
    bool_or(e.valor_comercial)           AS valor_comercial
  FROM netflora_especies e
  JOIN netflora_inventarios i ON i.id = e.inventario_id
  WHERE i.uc_id = p_uc_id AND i.status = 'concluido'
  GROUP BY e.especie_nome, e.nome_popular
  ORDER BY total_individuos DESC;
$$;

-- Inventários dentro de polígono (para mapa)
CREATE OR REPLACE FUNCTION netflora_inventarios_poligono(geojson_poly text)
RETURNS TABLE (
  id uuid, nome text, uc_nome text, data_voo date,
  area_ha numeric, n_especies bigint, n_individuos bigint, status text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    i.id, i.nome, i.uc_nome, i.data_voo, i.area_ha,
    COUNT(DISTINCT e.especie_nome) AS n_especies,
    COALESCE(SUM(e.quantidade), 0) AS n_individuos,
    i.status
  FROM netflora_inventarios i
  LEFT JOIN netflora_especies e ON e.inventario_id = i.id
  WHERE i.geom IS NOT NULL
    AND ST_Intersects(i.geom, ST_GeomFromGeoJSON(geojson_poly))
  GROUP BY i.id, i.nome, i.uc_nome, i.data_voo, i.area_ha, i.status
  ORDER BY i.data_voo DESC;
$$;
