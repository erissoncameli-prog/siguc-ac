-- Índice transitório da 292c só existia para acelerar o backfill
-- em lotes (953 mil linhas classificadas em produção). Com o
-- backfill concluído (0 linhas com dentro_acre NULL), o índice já
-- não indexa nada e fica sem uso — dropado por higiene. Numa base
-- nova, sem histórico grande esperando classificação, também não
-- faz falta: focos_calor_ac_classificar_lote() continua funcionando
-- sem ele, só mais devagar se algum dia houver um backfill grande
-- de novo (nesse caso, recriar o índice antes é o caminho).
DROP INDEX IF EXISTS idx_focos_ac_pendente;
