-- 016_focos_sinaflor.sql
-- Focos de calor históricos + Autorizações de Supressão Vegetal (SINAFLOR)
-- Lei 12.651/2012: classificação de desmatamento por conformidade legal

-- ─── FOCOS DE CALOR ──────────────────────────────────────────────────────────
-- Importar via CSV BDQueimadas ou FIRMS archive
-- Colunas obrigatórias: lat, lon, data_hora, satelite, fonte
-- Opcionais: municipio, bioma

CREATE TABLE IF NOT EXISTS focos_calor (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lat       DOUBLE PRECISION NOT NULL,
  lon       DOUBLE PRECISION NOT NULL,
  data_hora TIMESTAMPTZ NOT NULL,
  satelite  TEXT,
  municipio TEXT,
  bioma     TEXT,
  fonte     TEXT DEFAULT 'FIRMS',
  ano       INT  GENERATED ALWAYS AS (EXTRACT(YEAR FROM data_hora)::INT) STORED,
  geom      GEOMETRY(Point, 4326)
              GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED
);

CREATE INDEX IF NOT EXISTS focos_calor_geom_idx ON focos_calor USING GIST (geom);
CREATE INDEX IF NOT EXISTS focos_calor_ano_idx  ON focos_calor (ano);
CREATE INDEX IF NOT EXISTS focos_calor_dt_idx   ON focos_calor (data_hora DESC);

ALTER TABLE focos_calor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "focos leitura publica"
  ON focos_calor FOR SELECT USING (true);

-- ─── SINAFLOR / ASV ──────────────────────────────────────────────────────────
-- Autorizações de Supressão de Vegetação emitidas pelo IBAMA/SEMA-AC
-- Importar via planilha exportada do SINAFLOR
-- Arts. 26-27 CF: toda supressão pós-2008 exige ASV vigente

CREATE TABLE IF NOT EXISTS sinaflor_asv (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  num_asv          TEXT,
  cod_imovel       TEXT,          -- cod_imovel do CAR (se disponível)
  cpf_cnpj         TEXT,          -- documento do proprietário
  municipio        TEXT,
  area_ha          DOUBLE PRECISION,
  data_emissao     DATE,
  data_validade    DATE,
  tipo_supressao   TEXT,          -- corte_raso | exploracao_seletiva | limpeza_area
  status           TEXT DEFAULT 'vigente', -- vigente | vencida | cancelada | suspensa
  observacao       TEXT,
  geom             GEOMETRY(MultiPolygon, 4326),
  criado_em        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sinaflor_asv_cod_idx  ON sinaflor_asv (cod_imovel);
CREATE INDEX IF NOT EXISTS sinaflor_asv_cpf_idx  ON sinaflor_asv (cpf_cnpj);
CREATE INDEX IF NOT EXISTS sinaflor_asv_dt_idx   ON sinaflor_asv (data_emissao);
CREATE INDEX IF NOT EXISTS sinaflor_asv_geom_idx ON sinaflor_asv USING GIST (geom)
  WHERE geom IS NOT NULL;

ALTER TABLE sinaflor_asv ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asv leitura tecnico"
  ON sinaflor_asv FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM usuarios
      WHERE id = auth.uid()
        AND perfil IN ('tecnico','gestor','super_admin')
    )
  );

CREATE POLICY "asv escrita gestor"
  ON sinaflor_asv FOR ALL USING (
    EXISTS (
      SELECT 1 FROM usuarios
      WHERE id = auth.uid()
        AND perfil IN ('gestor','super_admin')
    )
  );

-- ─── RPCs ────────────────────────────────────────────────────────────────────

-- Contagem de focos por ano dentro de um polígono GeoJSON
CREATE OR REPLACE FUNCTION focos_por_ano(geojson_poly TEXT)
RETURNS TABLE (ano INT, total BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT ano, COUNT(*) AS total
  FROM focos_calor
  WHERE ST_Within(geom, ST_GeomFromGeoJSON(geojson_poly))
  GROUP BY ano
  ORDER BY ano;
$$;

-- Pontos individuais de focos dentro de polígono (cap 500 para mapa)
CREATE OR REPLACE FUNCTION focos_pontos_poligono(geojson_poly TEXT, limite INT DEFAULT 500)
RETURNS TABLE (
  id BIGINT, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
  data_hora TIMESTAMPTZ, satelite TEXT, municipio TEXT, fonte TEXT, ano INT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id, lat, lon, data_hora, satelite, municipio, fonte, ano
  FROM focos_calor
  WHERE ST_Within(geom, ST_GeomFromGeoJSON(geojson_poly))
  ORDER BY data_hora DESC
  LIMIT limite;
$$;

-- ASVs vigentes para um imóvel em um determinado ano
CREATE OR REPLACE FUNCTION asv_por_imovel(p_cod_imovel TEXT, p_cpf_cnpj TEXT DEFAULT NULL)
RETURNS TABLE (
  num_asv TEXT, area_ha DOUBLE PRECISION,
  data_emissao DATE, data_validade DATE,
  tipo_supressao TEXT, status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT num_asv, area_ha, data_emissao, data_validade, tipo_supressao, status
  FROM sinaflor_asv
  WHERE cod_imovel = p_cod_imovel
     OR (p_cpf_cnpj IS NOT NULL AND cpf_cnpj = p_cpf_cnpj)
  ORDER BY data_emissao;
$$;
