-- ============================================================
-- 342d_prodes_cron_um_ano_por_vez.sql
-- Medido depois da 342c: com geometria, 2 anos pequenos (2008–2009)
-- levaram 45 s; um ano grande (até 16 MB) chega perto de 1 min. Dois
-- anos numa chamada só poderiam estourar o statement_timeout de 2 min.
-- O cron semanal passa a coletar UM ano por vez, em duas rodadas
-- (o solicitar pede só ano anterior + corrente).
-- ============================================================
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prodes-resumo-coletar';
SELECT cron.schedule('prodes-resumo-coletar', '20,40 10 * * 0',
  $$SELECT public.prodes_resumo_coletar(1)$$);
