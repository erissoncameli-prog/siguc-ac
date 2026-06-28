-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Grupo fora de UC
-- ───────────────────────────────────────────────────────────
-- O monitoramento de quelônios também ocorre fora de Unidades de
-- Conservação (rios, terras indígenas, áreas comunitárias). O
-- grupo deixa de exigir UC e ganha um campo livre para descrever
-- a área quando não for uma UC.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE grupos_biomonitor ALTER COLUMN uc_id DROP NOT NULL;
ALTER TABLE grupos_biomonitor ADD COLUMN IF NOT EXISTS local_descricao text;
