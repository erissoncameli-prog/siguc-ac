-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — corrige o índice de uuid_cliente
--
-- A 257 criou um ÍNDICE PARCIAL (`WHERE uuid_cliente IS NOT NULL`)
-- para permitir múltiplas linhas com uuid_cliente NULL (coletas
-- lançadas pela mesa, sem app de campo). Problema: o Postgres só
-- infere um índice parcial como alvo de `ON CONFLICT (coluna)` quando
-- a cláusula ON CONFLICT repete o MESMO predicado — o que o upsert do
-- PostgREST/supabase-js (`.upsert(payload, {onConflict:'uuid_cliente'})`)
-- não faz. Resultado: "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" em toda sincronização.
--
-- Não precisava de índice parcial: UNIQUE padrão do Postgres já trata
-- múltiplos NULL como não-conflitantes (semântica SQL padrão) — é
-- exatamente o comportamento que o índice parcial tentava emular à
-- toa. Corrigido para um UNIQUE CONSTRAINT normal, que o upsert por
-- `onConflict:'uuid_cliente'` já encontra sem predicado nenhum.
-- ═══════════════════════════════════════════════════════════

DROP INDEX IF EXISTS uq_agua_coletas_uuid_cliente;
ALTER TABLE agua_coletas ADD CONSTRAINT uq_agua_coletas_uuid_cliente UNIQUE (uuid_cliente);
