-- 313b_limite_acre_bbox_revoke_authenticated.sql
--
-- limite_acre_bbox() (313) só é chamada hoje pela Edge Function
-- ingest-purpleair, que usa a service_role key (bypassa GRANT/REVOKE
-- por completo). Não existe nenhum consumidor de mesa ainda — GRANT a
-- `authenticated` era só "por via das dúvidas" e o advisor de
-- segurança apontou certo: SECURITY DEFINER executável sem uso real é
-- superfície que não precisa existir. Fecha; reabrir é um GRANT
-- simples no dia em que uma tela de mesa precisar da bbox do Acre.
REVOKE EXECUTE ON FUNCTION limite_acre_bbox() FROM authenticated;
