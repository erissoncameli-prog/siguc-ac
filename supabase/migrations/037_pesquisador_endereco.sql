-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 037 — Endereço do pesquisador
-- ═══════════════════════════════════════════════════════════

ALTER TABLE pesquisadores
  ADD COLUMN IF NOT EXISTS cep         text,
  ADD COLUMN IF NOT EXISTS logradouro  text,
  ADD COLUMN IF NOT EXISTS numero      text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro      text,
  ADD COLUMN IF NOT EXISTS municipio   text,
  ADD COLUMN IF NOT EXISTS uf          char(2) DEFAULT 'AC',
  ADD COLUMN IF NOT EXISTS pais        text    DEFAULT 'Brasil';
