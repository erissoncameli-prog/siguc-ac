-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Enum tipo_notificacao — novo valor 'biomonitor'
--
-- Usado pelas notificações de prazo de cautela vencendo/vencido e
-- de ocorrência de equipamento (migration 230), mesmo padrão do
-- 'frota' (migration 161).
--
-- Migration isolada por regra do projeto: valor novo de enum só
-- pode ser usado depois de commitado.
-- ═══════════════════════════════════════════════════════════

ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'biomonitor';
