-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — reaproveita o inbox de notificações (009)
-- Detalhe (viagem solicitada/aprovada/recusada, manutenção
-- próxima/vencida) vai em meta jsonb — sem novas colunas na tabela.
-- ═══════════════════════════════════════════════════════════

ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'frota';
