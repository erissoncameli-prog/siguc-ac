-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — revoga EXECUTE público de 2 funções que só
-- deveriam ser chamadas por trigger (nunca diretamente pelo
-- cliente), achado pelo advisor de segurança do Supabase após as
-- migrations 175/177 (mesmo padrão já corrigido pela migration 165
-- para frota_notificar/frota_checar_manutencao_veiculo).
-- ═══════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION frota_gerar_codigo_abastecimento()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION frota_marcar_atualizador_config_gps()
  FROM PUBLIC, anon, authenticated;
