-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Corrige regressão introduzida pela 263
--
-- A 263 pôs 'biomonitor' no grupo 'Gestão' e só gravou padrão de
-- MÓDULO para tecnico/gestor/super_admin. `nivel_efetivo()` cai para o
-- padrão de GRUPO quando não há override de módulo (migration 057,
-- passo 3) — e o grupo 'Gestão' concede 'visualizar' a
-- financeiro/secretario/visualizador e 'editar' a
-- assistente_admin/chefe_departamento/diretor/gestor_uc. A policy antiga
-- (`perfil = ANY(tecnico,gestor,super_admin)`) não dava NADA a esses
-- perfis. Achado ao conferir com `nivel_efetivo()` logo após aplicar —
-- não foi visível só lendo a migration.
--
-- Correção: padrão de MÓDULO explícito 'sem_acesso' para todo perfil que
-- a policy antiga excluía. Nível de módulo tem precedência sobre nível
-- de grupo (passo 2 antes do passo 3), então isso neutraliza o fallback
-- e reproduz o comportamento anterior à 263, exatamente.
-- ═══════════════════════════════════════════════════════════

INSERT INTO perfil_permissoes_padrao (perfil, modulo_id, nivel)
SELECT p.perfil, m.id, 'sem_acesso'
FROM modulos m
CROSS JOIN unnest(enum_range(NULL::perfil_usuario)) AS p(perfil)
WHERE m.chave = 'biomonitor'
  AND p.perfil NOT IN ('tecnico', 'gestor', 'super_admin')
ON CONFLICT (perfil, modulo_id) DO UPDATE SET nivel = 'sem_acesso';
