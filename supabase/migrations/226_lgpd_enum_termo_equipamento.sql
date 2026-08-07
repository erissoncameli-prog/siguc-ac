-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Enum lgpd_tipo_documento — novo valor 'termo_equipamento'
--
-- Termo de responsabilidade assinado pelo monitor do Biomonitor ao
-- receber equipamento em cautela (migration 227). Reaproveita o
-- padrão de documento versionado + aceite já usado por
-- politica_privacidade/termo_uso/aviso_campo (migration 212).
--
-- Migration isolada por regra do projeto: um valor novo de enum só
-- pode ser usado depois de commitado — usar na mesma transação que
-- o cria dá "unsafe use of new value ... must be committed" (erro
-- real visto nas migrations 217/219, documentado no CLAUDE.md).
-- ═══════════════════════════════════════════════════════════

ALTER TYPE lgpd_tipo_documento ADD VALUE IF NOT EXISTS 'termo_equipamento';
