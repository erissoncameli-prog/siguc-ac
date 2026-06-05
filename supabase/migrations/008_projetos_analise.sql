-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 008 — Projetos de Análise de Campo
-- Vincula alertas ambientais a projetos de verificação
-- ═══════════════════════════════════════════════════════════

-- Enums
CREATE TYPE tipo_projeto  AS ENUM ('verificacao_campo','sobrevoo','analise_imagem','fiscalizacao','outro');
CREATE TYPE status_projeto AS ENUM ('rascunho','em_analise','concluido','arquivado');

-- Tabela principal
CREATE TABLE projetos_analise (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vínculo com alerta (opcional — projeto pode ser independente)
  alerta_id           uuid REFERENCES alertas_ambientais(id) ON DELETE SET NULL,

  -- Vínculo com UC
  uc_id               uuid REFERENCES unidades_conservacao(id) ON DELETE SET NULL,
  uc_nome             text,                          -- cache para exibição rápida

  -- Dados do projeto
  titulo              text NOT NULL,
  tipo                tipo_projeto NOT NULL DEFAULT 'verificacao_campo',
  status              status_projeto NOT NULL DEFAULT 'rascunho',
  observacoes         text,

  -- Geometria delimitada pelo técnico (polígono no mapa)
  geom                geometry(Polygon, 4326),
  area_calculada_ha   numeric(12,4),                -- calculado ao salvar

  -- Responsável
  responsavel_id      uuid REFERENCES usuarios(id) ON DELETE SET NULL,

  -- Auditoria
  criado_por          uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_projetos_alerta   ON projetos_analise (alerta_id) WHERE alerta_id IS NOT NULL;
CREATE INDEX idx_projetos_uc       ON projetos_analise (uc_id)     WHERE uc_id IS NOT NULL;
CREATE INDEX idx_projetos_status   ON projetos_analise (status);
CREATE INDEX idx_projetos_geom     ON projetos_analise USING GIST (geom) WHERE geom IS NOT NULL;

-- Trigger atualizado_em
CREATE TRIGGER touch_projetos_analise
  BEFORE UPDATE ON projetos_analise
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- RLS
ALTER TABLE projetos_analise ENABLE ROW LEVEL SECURITY;

-- Leitura: todos os usuários autenticados
CREATE POLICY "projetos_leitura" ON projetos_analise
  FOR SELECT TO authenticated USING (true);

-- Inserção: qualquer autenticado
CREATE POLICY "projetos_insercao" ON projetos_analise
  FOR INSERT TO authenticated WITH CHECK (true);

-- Atualização: criador ou super_admin/gestor
CREATE POLICY "projetos_atualizacao" ON projetos_analise
  FOR UPDATE TO authenticated USING (
    criado_por = auth.uid()
    OR EXISTS (
      SELECT 1 FROM usuarios
      WHERE id = auth.uid()
        AND perfil IN ('super_admin','gestor')
    )
  );

-- Exclusão: apenas super_admin
CREATE POLICY "projetos_exclusao" ON projetos_analise
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios
      WHERE id = auth.uid() AND perfil = 'super_admin'
    )
  );

-- Função: calcular área em ha a partir da geometria
CREATE OR REPLACE FUNCTION calcular_area_projeto()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.geom IS NOT NULL THEN
    -- ST_Area com geografia retorna m², divide por 10000 para ha
    NEW.area_calculada_ha := ROUND(
      (ST_Area(NEW.geom::geography) / 10000.0)::numeric, 4
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER calcular_area_projeto_trigger
  BEFORE INSERT OR UPDATE OF geom ON projetos_analise
  FOR EACH ROW EXECUTE FUNCTION calcular_area_projeto();
