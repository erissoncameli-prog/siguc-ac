-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 296 — fonte_id único SEM cláusula WHERE
-- Entrega 2 (Ingestão) do Dashboard de Alertas Ambientais.
--
-- Achado testando o upsert de verdade: a migration 293 criou um
-- índice único PARCIAL (`WHERE fonte_id IS NOT NULL`, copiando o
-- padrão do índice antigo, não-único). PostgREST monta
-- `INSERT ... ON CONFLICT (fonte_id) DO UPDATE` a partir de
-- `on_conflict=fonte_id` — sem repetir nenhuma cláusula WHERE. Um
-- índice único PARCIAL só serve de árbitro de conflito quando o
-- INSERT também declara a mesma condição WHERE; um `ON CONFLICT
-- (fonte_id)` puro não casa com ele, e o Postgres responde "there
-- is no unique or exclusion constraint matching the ON CONFLICT
-- specification" — erro real visto ao testar o backfill do DETER.
--
-- A cláusula WHERE nunca foi necessária: um índice único comum (sem
-- WHERE) já trata cada NULL como distinto dos demais no Postgres —
-- o mesmo efeito prático da versão parcial, sem a armadilha.
-- ═══════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_alertas_fonte_id;

CREATE UNIQUE INDEX idx_alertas_fonte_id ON alertas_ambientais (fonte_id);
