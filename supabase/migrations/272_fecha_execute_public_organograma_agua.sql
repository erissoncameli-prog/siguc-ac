-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Fecha EXECUTE de PUBLIC em funções do organograma
-- (262/265/266/267/269, já em produção) e da Água (270)
--
-- Achado ao rodar get_advisors após a 270: `REVOKE EXECUTE ... FROM
-- anon` NÃO fecha a função para chamada anônima. O Supabase concede
-- EXECUTE a PUBLIC por padrão para toda função nova em `public`
-- (ALTER DEFAULT PRIVILEGES, dois donos: postgres e supabase_admin).
-- PUBLIC é um grant à parte de `anon` — Postgres sempre soma os dois
-- (has_function_privilege = privilégio direto DA role OR de PUBLIC).
-- Revogar só de `anon` deixa a função chamável mesmo assim, através
-- do grant de PUBLIC. Mesmo erro já visto e corrigido antes neste
-- projeto (seg_fix_revoke_public, 261b) — desta vez alcançou 14
-- funções porque as migrations 262-270 usaram só `FROM anon`.
--
-- Risco medido, não catastrófico: as 14 funções abaixo já checam
-- `pode_editar()`/`is_super_admin()`/`auth.uid()` internamente, e
-- para `anon` isso é sempre NULL → nega. Nenhuma vazava dado nem
-- permitia escrita anônima. Mas é superfície que não deveria existir
-- (regra do projeto: fechar acesso anônimo, mesmo padrão da 179/196/
-- 197 no Frota) e uma segunda camada que faltava.
--
-- Regra para toda função nova daqui em diante: `REVOKE EXECUTE ON
-- FUNCTION ... FROM PUBLIC, anon, authenticated;` sempre com PUBLIC
-- explícito, nunca só `FROM anon`.
-- ═══════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION usuario_unidades(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION minhas_unidades() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION unidade_ancestrais(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unidade_descendentes(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION alcance_por_lotacao(uuid, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION credenciamento_vigente(uuid, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION teto_do_perfil(perfil_usuario) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION nivel_efetivo_calc(uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vw_impacto_lotacao(text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION trilha_auditoria_verificar() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION agua_reauth_valida(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_atualizar_coleta(uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_excluir_coleta(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_atualizar_ponto(uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_atualizar_laboratorio(uuid, jsonb, text) FROM PUBLIC;
