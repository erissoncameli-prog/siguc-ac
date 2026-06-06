-- 020_camadas_mapa_colunas.sql
-- Adiciona colunas ausentes na tabela camadas_mapa

ALTER TABLE public.camadas_mapa
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();
