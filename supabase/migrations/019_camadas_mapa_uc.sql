-- 019_camadas_mapa_uc.sql
-- Adiciona referência à Unidade de Conservação em camadas_mapa

ALTER TABLE public.camadas_mapa
  ADD COLUMN IF NOT EXISTS uc_id UUID REFERENCES public.unidades_conservacao(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_camadas_mapa_uc ON public.camadas_mapa(uc_id);
