-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — CPF do motorista (usado para gerar login no
-- App Frota quando não há e-mail, mesmo padrão dos brigadistas)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_motoristas ADD COLUMN IF NOT EXISTS cpf text;
