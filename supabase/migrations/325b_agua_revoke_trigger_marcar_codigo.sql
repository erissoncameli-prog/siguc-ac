-- Achado pelo advisor de segurança logo após a 325: a função de
-- trigger agua_marcar_codigo_reservado_usado() nasceu chamável direto
-- via RPC (o ALTER DEFAULT PRIVILEGES do projeto concede EXECUTE a
-- anon/authenticated por NOME em toda função nova) — mesmo padrão já
-- corrigido em frota_gerar_codigo_abastecimento/
-- frota_marcar_atualizador_config_gps (migration 179). Ela só deve
-- rodar via trigger, nunca chamada direto pelo cliente.
REVOKE ALL ON FUNCTION agua_marcar_codigo_reservado_usado() FROM PUBLIC, anon, authenticated;
