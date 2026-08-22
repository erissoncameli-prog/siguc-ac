-- 307b_rh_checar_cotas_revoke_authenticated.sql
--
-- Achado pelo advisor de segurança do Supabase depois de aplicar a
-- 306b: rh_checar_cotas() é SECURITY DEFINER (cria notificação para
-- terceiros) e só deveria rodar via pg_cron (dono `postgres`, que não
-- precisa de GRANT nenhum), nunca chamada direta por um usuário
-- autenticado via /rest/v1/rpc/rh_checar_cotas — mesmo padrão de
-- biomonitor_checar_cautelas_vencidas e
-- credenciamento_checar_vencimentos.

REVOKE EXECUTE ON FUNCTION rh_checar_cotas() FROM authenticated;
