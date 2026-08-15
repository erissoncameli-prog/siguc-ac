-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Fecha superfície: RPCs de super_admin expostas a `authenticated`
--
-- Achado do advisor de segurança depois da migration 269: duas funções
-- SECURITY DEFINER que já se protegem internamente
-- (`RAISE EXCEPTION` se não `is_super_admin()`) tinham `REVOKE ... FROM
-- anon` mas NÃO de `authenticated` — qualquer usuário logado conseguia
-- CHAMAR a RPC via PostgREST (recebendo o erro, sem vazar dado), mas a
-- superfície ficava exposta sem necessidade. Defesa em profundidade:
-- ninguém que não seja super_admin deveria nem alcançar a função.
-- ═══════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION vw_impacto_lotacao(text)        FROM authenticated;
REVOKE EXECUTE ON FUNCTION trilha_auditoria_verificar()    FROM authenticated;
