-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Catálogo de atividades de campo
-- Substitui o enum atividade_campo por uma tabela gerenciável.
-- Cada atividade tem um array de naturezas vinculadas.
-- Super_admin pode cadastrar novas atividades via admin.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE atividades_campo_catalogo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,          -- valor salvo em registros_campo.atividade
  label         text NOT NULL,                 -- rótulo exibido no app
  naturezas     natureza_registro[] NOT NULL,  -- array: pode aparecer em mais de uma natureza
  icone         text,                          -- emoji opcional
  ordem         smallint NOT NULL DEFAULT 99,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE INDEX idx_ativ_cat_natureza ON atividades_campo_catalogo USING GIN (naturezas);
CREATE INDEX idx_ativ_cat_ativo    ON atividades_campo_catalogo (ativo) WHERE ativo = true;

ALTER TABLE atividades_campo_catalogo ENABLE ROW LEVEL SECURITY;

-- Todos autenticados e brigadistas (anon com token) leem
CREATE POLICY "ativ_cat_select" ON atividades_campo_catalogo
  FOR SELECT USING (true);

-- Apenas super_admin e gestor escrevem
CREATE POLICY "ativ_cat_write" ON atividades_campo_catalogo
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('super_admin', 'gestor')
        AND u.ativo
    )
  );

CREATE TRIGGER trg_ativ_cat_updated
  BEFORE UPDATE ON atividades_campo_catalogo
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Seed: atividades iniciais com vínculos por natureza ──────

INSERT INTO atividades_campo_catalogo (slug, label, icone, naturezas, ordem) VALUES
  ('fogo',               'Combate a fogo',       '🔥', ARRAY['combate']::natureza_registro[],                                        1),
  ('limpeza',            'Limpeza / aceiro',      '🌿', ARRAY['prevencao','combate']::natureza_registro[],                            2),
  ('queima_controlada',  'Queima controlada',     '🔆', ARRAY['prevencao']::natureza_registro[],                                     3),
  ('plantio',            'Plantio',               '🌱', ARRAY['prevencao']::natureza_registro[],                                     4),
  ('educacao_ambiental', 'Educação ambiental',    '📚', ARRAY['prevencao','monitoramento']::natureza_registro[],                      5),
  ('reconhecimento',     'Reconhecimento',        '🔭', ARRAY['prevencao','monitoramento']::natureza_registro[],                      6),
  ('primeiros_socorros', 'Primeiros socorros',    '🩹', ARRAY['combate','monitoramento']::natureza_registro[],                        7),
  ('fiscalizacao',       'Fiscalização',          '🚔', ARRAY['monitoramento','prevencao']::natureza_registro[],                      8),
  ('avaliacao_dano',     'Avaliação de dano',     '📋', ARRAY['combate','monitoramento']::natureza_registro[],                        9),
  ('outro',              'Outro',                 '📌', ARRAY['prevencao','combate','monitoramento']::natureza_registro[],            99);
