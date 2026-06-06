-- ── 017_focos_calor.sql ─────────────────────────────────────────────────
-- Focos de calor históricos do Acre — INPE/FIRMS (MODIS + VIIRS)
-- Importação: julho-outubro de cada ano (pico de queimadas no Acre)
-- Cobertura: MODIS 2001-2024, VIIRS SNPP 2012-2024

CREATE TABLE IF NOT EXISTS focos_calor_ac (
  id         BIGSERIAL    PRIMARY KEY,
  lat        NUMERIC(9,5) NOT NULL,
  lon        NUMERIC(9,5) NOT NULL,
  acq_date   DATE         NOT NULL,
  ano        SMALLINT     NOT NULL,
  mes        SMALLINT     NOT NULL,
  satellite  TEXT,
  source     TEXT,        -- 'MODIS' | 'VIIRS_SNPP'
  confidence TEXT,        -- MODIS: 0-100 | VIIRS: l/n/h
  frp        NUMERIC,     -- Fire Radiative Power em MW
  daynight   CHAR(1)      -- 'D' = dia, 'N' = noite
);

-- Índices para consulta rápida por bbox e ano
CREATE INDEX IF NOT EXISTS idx_focos_lat  ON focos_calor_ac (lat);
CREATE INDEX IF NOT EXISTS idx_focos_lon  ON focos_calor_ac (lon);
CREATE INDEX IF NOT EXISTS idx_focos_ano  ON focos_calor_ac (ano);
CREATE INDEX IF NOT EXISTS idx_focos_date ON focos_calor_ac (acq_date);

-- Constraint para evitar duplicatas na reimportação
ALTER TABLE focos_calor_ac
  ADD CONSTRAINT uq_foco UNIQUE (lat, lon, acq_date, source);

-- RLS: leitura pública para usuários autenticados
ALTER TABLE focos_calor_ac ENABLE ROW LEVEL SECURITY;

CREATE POLICY "focos_select" ON focos_calor_ac
  FOR SELECT TO authenticated USING (true);

-- Apenas super_admin pode escrever (import via script server-side)
CREATE POLICY "focos_write" ON focos_calor_ac
  FOR ALL TO authenticated
  USING (
    (SELECT perfil FROM usuarios WHERE id = auth.uid()) = 'super_admin'
  );
