-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Brigadas v2 — parte 1: novos enums
-- ALTER TYPE não pode ser usado no mesmo tx em que é criado;
-- este arquivo só adiciona os valores ao enum perfil_usuario
-- e cria o enum regional_ac. O restante vai em 044.
-- ═══════════════════════════════════════════════════════════

ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'brigadista';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'biologo';

CREATE TYPE regional_ac AS ENUM (
  'baixo_acre', 'purus', 'jurua', 'tarauaca_envira', 'alto_acre'
);
