-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — motorista vinculado (opcional) + equipamentos
-- do veículo (Starlink, guincho, reboque).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_veiculos
  ADD COLUMN IF NOT EXISTS motorista_padrao_id uuid REFERENCES frota_motoristas(id),
  ADD COLUMN IF NOT EXISTS tem_starlink boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tem_guincho  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tem_reboque  boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_frota_veic_motorista_padrao ON frota_veiculos (motorista_padrao_id);
