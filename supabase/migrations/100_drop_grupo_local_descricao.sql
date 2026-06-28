-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Limpeza: remove grupo.local_descricao
-- ───────────────────────────────────────────────────────────
-- Coluna depreciada na migration 099 (substituída por
-- tipo_localizacao + localizacao_referencia). O web novo já está
-- em produção e não a referencia mais. Remoção segura.
-- (Não confundir com solturas_filhotes.local_descricao, que é outra
-- tabela e permanece.)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE grupos_biomonitor DROP COLUMN IF EXISTS local_descricao;
