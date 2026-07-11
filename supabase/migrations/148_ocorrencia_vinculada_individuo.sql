-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Ocorrência vinculada ao filhote individual
-- ───────────────────────────────────────────────────────────────
-- Marcar um filhote como doente ou registrar seu óbito agora abre o
-- formulário de "Nova Ocorrência" (tipo travado em doença/mortalidade,
-- captura data/hora/causa de verdade) em vez de só trocar um status.
-- ocorrencias_bercario era só por lote — acrescenta individuo_id
-- opcional para saber qual filhote específico gerou a ocorrência.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ocorrencias_bercario
  ADD COLUMN IF NOT EXISTS individuo_id uuid REFERENCES filhotes_bercario(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ocorrencias_bercario_individuo ON ocorrencias_bercario (individuo_id);
