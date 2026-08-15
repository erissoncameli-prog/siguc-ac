-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — revoga EXECUTE público da função de
-- trigger que só deveria ser chamada pelo BEFORE INSERT (nunca
-- diretamente pelo cliente), achado pelo advisor de segurança do
-- Supabase logo após a migration 273. Mesmo padrão da migration 179
-- (Frota) para frota_gerar_codigo_abastecimento.
-- ═══════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION agua_gerar_codigo_amostra()
  FROM PUBLIC, anon, authenticated;
