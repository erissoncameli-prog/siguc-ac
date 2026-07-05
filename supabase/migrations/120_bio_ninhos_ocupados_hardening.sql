-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Hardening de bio_ninhos_ocupados
-- ───────────────────────────────────────────────────────────
-- bio_ninhos_ocupados (mig. 119) é SECURITY DEFINER e, por
-- desenho, NÃO tem gate de perfil: um monitor precisa enxergar a
-- ocupação de um berçário de OUTRO grupo ao transferir. Isso faz
-- a função contornar a RLS. Para não deixá-la acessível ao papel
-- `anon` (usuário não autenticado), revogamos o EXECUTE de
-- PUBLIC/anon e mantemos apenas authenticated + service_role.
--
-- As demais RPCs desta entrega (bio_monitoramento_eclosao,
-- bio_dashboard_praias) já têm gate interno e retornam NULL para
-- quem não é monitor/gestor, então não precisam deste reforço.
-- Depende de 119.
-- ═══════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION bio_ninhos_ocupados(uuid, uuid, especie_quelonio) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bio_ninhos_ocupados(uuid, uuid, especie_quelonio) FROM anon;
GRANT  EXECUTE ON FUNCTION bio_ninhos_ocupados(uuid, uuid, especie_quelonio) TO authenticated, service_role;
