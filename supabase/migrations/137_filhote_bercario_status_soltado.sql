-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Filhote individual pode ser "soltado"
-- ───────────────────────────────────────────────────────────────
-- status_individuo_bercario só tinha 'ativo'/'morto' (132). Na soltura
-- de um lote, o app marcava o LOTE e o NINHO como soltados, mas nunca
-- os filhotes individuais rastreados daquele lote — eles ficavam
-- "ativos" pra sempre, inflando qualquer contagem/relatório por
-- indivíduo mesmo depois de devolvidos à natureza.
--
-- Acrescenta o valor 'soltado' ao enum. Não é usado nesta mesma
-- migration (ALTER TYPE ... ADD VALUE não pode ser referenciado na
-- mesma transação em que foi criado) — só em código de aplicação
-- (INSERT/UPDATE feitos pelo app) a partir de agora.
-- ═══════════════════════════════════════════════════════════════

ALTER TYPE status_individuo_bercario ADD VALUE IF NOT EXISTS 'soltado';
