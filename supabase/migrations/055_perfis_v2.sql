-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Perfis v2 — novos perfis + origem do perfil
-- Fase 1 do modelo RBAC + overrides (ver docs/.../perfis-v2)
-- ATENÇÃO: ALTER TYPE ... ADD VALUE não pode ser USADO na mesma
-- transação. Por isso este arquivo SÓ adiciona valores e a coluna;
-- o uso dos novos perfis (seeds) fica na migration 056.
-- ═══════════════════════════════════════════════════════════

-- ── Novos perfis de usuário ─────────────────────────────────
-- Mantém os 5 legados (super_admin, gestor, tecnico, financeiro, visualizador).
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'secretario';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'diretor';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'chefe_departamento';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'gestor_uc';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'assistente_admin';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'pesquisador_externo';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'brigadista';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'validador_brigada';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'validador_fauna';

-- ── Novo nível hierárquico (para derivação futura via cargo) ──
ALTER TYPE nivel_hierarquico ADD VALUE IF NOT EXISTS 'assistente_administrativo';

-- ── Origem do perfil: manual x derivado do cargo ────────────
-- 'manual' (default): super_admin define o perfil à mão.
-- 'cargo': trigger de derivação (migration futura) assume o controle.
-- Permite ligar a derivação pessoa a pessoa, sem big bang.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'origem_perfil'
  ) THEN
    CREATE TYPE origem_perfil AS ENUM ('manual', 'cargo');
  END IF;
END $$;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perfil_origem origem_perfil NOT NULL DEFAULT 'manual';
