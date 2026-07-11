-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Repara numeração de filhotes já corrompida
-- ───────────────────────────────────────────────────────────────
-- Mesmo bug de 145 (trigger sobrescrevia numero com MAX+1 em todo
-- INSERT, mesmo tardio), mas pelo caminho de SOLTAR o berçário: ao
-- soltar, todos os filhotes ativos do lote voltam a status_sync=
-- 'pendente' para propagar o novo status — se algum deles nunca
-- tinha de fato sincronizado antes (preso silenciosamente, sem
-- erro visível), essa foi a primeira vez que ele virou um INSERT de
-- verdade, e saiu com um número fora de ordem (achado: berçário com
-- 30 filhotes de 2 lotes intercalados, numerados de 11 a 59).
--
-- Reaplica a mesma estratégia de reparo já usada em 135/138: renumera
-- por (bercario_id, temporada_id) na ordem real de criação
-- (criado_em) — é a melhor aproximação disponível da ordem em que os
-- filhotes entraram no berçário, já que o número "pretendido" do app
-- não fica registrado em lugar nenhum além do próprio numero (que é
-- exatamente o que foi corrompido). Idempotente: berçários já
-- corretos não mudam.
-- ═══════════════════════════════════════════════════════════════

WITH ordenados AS (
  SELECT id, row_number() OVER (PARTITION BY bercario_id, temporada_id ORDER BY criado_em, numero, id) AS novo_numero
  FROM filhotes_bercario
  WHERE bercario_id IS NOT NULL
)
UPDATE filhotes_bercario f
SET numero = o.novo_numero
FROM ordenados o
WHERE f.id = o.id AND f.numero IS DISTINCT FROM o.novo_numero;
