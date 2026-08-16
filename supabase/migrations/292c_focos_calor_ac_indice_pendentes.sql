-- Sem isso, cada chamada de focos_calor_ac_classificar_lote()
-- varre as 953 mil linhas procurando as poucas ainda com
-- dentro_acre NULL — o índice parcial da 292 só cobre o NOT
-- NULL. Este índice encolhe conforme o backfill avança e some
-- sozinho quando não sobrar nenhuma linha pendente.
CREATE INDEX idx_focos_ac_pendente ON focos_calor_ac ((true)) WHERE dentro_acre IS NULL;
