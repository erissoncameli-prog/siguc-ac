-- 018_camadas_mapa.sql
-- Camadas personalizadas do mapa (Shapefile / GeoJSON importados pelos gestores)

CREATE TABLE IF NOT EXISTS public.camadas_mapa (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  cor           TEXT NOT NULL DEFAULT '#16a34a',
  geojson       JSONB,
  visivel       BOOLEAN NOT NULL DEFAULT TRUE,
  ordem         INT NOT NULL DEFAULT 0,
  feature_colors JSONB DEFAULT '{}'::JSONB,
  style_config  JSONB DEFAULT '{}'::JSONB,
  uploaded_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.camadas_mapa ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer autenticado
CREATE POLICY "camadas_mapa_select" ON public.camadas_mapa
  FOR SELECT TO authenticated USING (TRUE);

-- Inserção/atualização/exclusão: super_admin e gestor
CREATE POLICY "camadas_mapa_insert" ON public.camadas_mapa
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid()
        AND perfil IN ('super_admin','gestor')
    )
  );

CREATE POLICY "camadas_mapa_update" ON public.camadas_mapa
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid()
        AND perfil IN ('super_admin','gestor')
    )
  );

CREATE POLICY "camadas_mapa_delete" ON public.camadas_mapa
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid()
        AND perfil IN ('super_admin','gestor')
    )
  );

-- Trigger de atualização
CREATE TRIGGER camadas_mapa_touch
  BEFORE UPDATE ON public.camadas_mapa
  FOR EACH ROW EXECUTE FUNCTION public.touch_atualizado_em();
