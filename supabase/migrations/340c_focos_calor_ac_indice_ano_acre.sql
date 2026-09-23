-- ============================================================
-- 340c_focos_calor_ac_indice_ano_acre.sql
-- Mesmo com o cast corrigido (340b), um ano com muitos focos (2024:
-- 96 mil linhas, metade fora do Acre) caía em seq scan de toda a
-- focos_calor_ac para achar 1.000 linhas dentro_acre — 2,2 s por
-- clique no slider. Índice PARCIAL: só as linhas que a linha do
-- tempo lê (dentro_acre), por ano.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_focos_calor_ac_ano_acre
  ON public.focos_calor_ac (ano) WHERE dentro_acre;
