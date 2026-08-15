-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Corrige revogação incompleta da 261
--
-- A migration 261 revogou EXECUTE de `anon`/`authenticated` pelo NOME
-- do papel, mas o Postgres concede EXECUTE a PUBLIC por padrão na
-- criação de toda função — e PUBLIC inclui `anon` implicitamente.
-- Achado ao rodar mcp__Supabase__get_advisors logo após aplicar a 261:
-- `perfil_atualizar_foto` ainda aparecia como SECURITY DEFINER
-- executável por `anon`. Mesmo achado já documentado no CLAUDE.md a
-- propósito do ALTER DEFAULT PRIVILEGES do projeto — revogar do papel
-- pelo nome não fecha nada; é preciso revogar de PUBLIC.
--
-- O arquivo 261 já foi corrigido para nascer certo em bases novas;
-- esta migration é só o reparo do que já estava em produção.
-- ═══════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION perfil_atualizar_foto(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION perfil_atualizar_foto(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION usuarios_travar_campos_sensiveis() FROM PUBLIC;
