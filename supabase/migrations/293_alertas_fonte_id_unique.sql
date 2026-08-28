-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 293 — fonte_id único em alertas_ambientais
-- Entrega 2 (Ingestão) do Dashboard de Alertas Ambientais.
--
-- A ingestão atual faz um SELECT count(*) por linha antes de
-- cada INSERT para não duplicar (FIRMS/BDQUEIMADAS/DETER, todos
-- em supabase/functions/monitorar-alertas). Funciona para o
-- volume diário, mas o backfill retroativo do DETER (30.903
-- feições para o Acre, 2016-2026) faria 30 mil idas e vindas
-- extras só para checar duplicata. Com UNIQUE + INSERT ...
-- ON CONFLICT (fonte_id) DO NOTHING, dedup vira responsabilidade
-- do índice, sem round-trip nenhum.
--
-- Substitui idx_alertas_fonte_id (não-único) — mesma coluna,
-- mesma condição WHERE fonte_id IS NOT NULL (múltiplos NULL
-- continuam permitidos por um índice único parcial). Confirmado
-- antes de aplicar: 2578/2578 alertas com fonte_id preenchido e
-- distinto — sem colisão para a constraint travar.
-- ═══════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_alertas_fonte_id;

CREATE UNIQUE INDEX idx_alertas_fonte_id ON alertas_ambientais (fonte_id) WHERE fonte_id IS NOT NULL;
