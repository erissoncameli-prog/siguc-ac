-- 226_seg_views_security_invoker.sql
-- Segurança — as 4 views SECURITY DEFINER que o advisor do Supabase marca
-- como ERROR (e que o e-mail de 03/08/2026 cobrou) passam a SECURITY INVOKER.
--
-- Contexto: uma view sem `security_invoker` roda com os privilégios do DONO
-- (postgres) e portanto IGNORA a RLS das tabelas de base. Como toda view em
-- `public` é exposta pelo PostgREST, isso significa que qualquer pessoa com a
-- anon key — que é pública, está no frontend — lia o conteúdo inteiro dessas
-- views SEM LOGIN. Confirmado em produção com `SET ROLE anon`:
--   vw_registros_validacao → 2 registros de campo (nome do brigadista, GPS)
--   brigadas_resumo        → 5 brigadas / 56 brigadistas
--   cargos_atuais          → nome e e-mail dos titulares de cargo
--   minhas_permissoes      → catálogo de módulos do sistema
--
-- É a mesma classe de defeito que a 165 (Frota) já tinha corrigido, e que a
-- Fase 1 do plano do Frota (196/197) deixou registrada como pendente para os
-- demais módulos — ver docs/frota-analise-e-plano.md §8, item 1.
--
-- ⚠️ Verificação de regressão executada ANTES de aplicar, com `SET ROLE
-- authenticated` e JWT real de cada perfil. Contagens antes → depois:
--   tecnico          2 registros / 5 brigadas / 56 brigadistas → idêntico
--   chefe_brigada    2 registros / 5 brigadas / 56 → 14 brigadistas
--   visualizador     2 / 5 / 56 → 0 / 5 / 0
--   ANON             2 / 5 / 56 → 0 / 0 / 0   ← o objetivo
-- As duas mudanças em usuário logado NÃO são regressão: `chefe_brigada` e
-- `visualizador` têm `nivel_efetivo = sem_acesso` nos módulos brigadas,
-- admin-brigadas, validacao-campo e relatorios-brigadas, ou seja, o sistema de
-- permissões já não abre para eles nenhuma das páginas que leem essas views
-- (brigadas.html, admin-brigadas.html, validacao-campo.html,
-- relatorios-brigadas.html). A RLS passa a concordar com a permissão do módulo
-- em vez de contradizê-la.
--
-- Nenhuma policy foi alterada — só a propriedade da view.

ALTER VIEW public.cargos_atuais          SET (security_invoker = on);
ALTER VIEW public.brigadas_resumo        SET (security_invoker = on);
ALTER VIEW public.vw_registros_validacao SET (security_invoker = on);
ALTER VIEW public.minhas_permissoes      SET (security_invoker = on);

COMMENT ON VIEW public.cargos_atuais IS
  'Cargos ativos com titular e delegação vigente. SECURITY INVOKER (226) — respeita a RLS de cargos/cargo_ocupacoes/usuarios.';
COMMENT ON VIEW public.brigadas_resumo IS
  'Brigadas com contagem de brigadistas e última atividade. SECURITY INVOKER (226) — a contagem passa a refletir os brigadistas que o leitor pode ver.';
COMMENT ON VIEW public.vw_registros_validacao IS
  'Registros de campo enriquecidos para validação e relatórios. SECURITY INVOKER (226) — respeita a RLS de registros_campo.';
COMMENT ON VIEW public.minhas_permissoes IS
  'Nível de acesso do usuário corrente por módulo. SECURITY INVOKER (226).';
