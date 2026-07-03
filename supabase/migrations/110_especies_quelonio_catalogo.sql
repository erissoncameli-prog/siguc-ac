-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Catálogo editável de espécies de quelônio
-- Não altera o enum especie_quelonio nem ninhos_quelonios.especie
-- (histórico preservado). Esta tabela só controla o que aparece
-- para seleção no app (chips em biomonitor.html) e permite ao
-- biólogo/gestor ajustar nome exibido e ativar/desativar espécies
-- sem depender de migration a cada mudança.
-- Depende de 074_biomonitor_quelonios (enum especie_quelonio).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE especies_quelonio_catalogo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          especie_quelonio NOT NULL UNIQUE,
  nome_popular    text NOT NULL,
  nome_cientifico text,
  sigla_placa     text,
  ativo           boolean NOT NULL DEFAULT true,
  ordem           int NOT NULL DEFAULT 99,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);

CREATE INDEX idx_esp_quel_ativo ON especies_quelonio_catalogo (ativo);

ALTER TABLE especies_quelonio_catalogo ENABLE ROW LEVEL SECURITY;

-- Catálogo é lido por todos autenticados (tela de registro de ninho)
CREATE POLICY "esp_quel_select" ON especies_quelonio_catalogo
  FOR SELECT USING (true);

-- Apenas biologo, gestor, super_admin escrevem (mesmo padrão de especies_fauna)
CREATE POLICY "esp_quel_write" ON especies_quelonio_catalogo
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('biologo','gestor','super_admin')
        AND u.ativo
    )
  );

CREATE TRIGGER trg_esp_quel_updated
  BEFORE UPDATE ON especies_quelonio_catalogo
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Seed com os valores atuais do enum especie_quelonio.
-- 'cupido' (Podocnemis cayennensis) não ocorre no Acre/Amazônia
-- ocidental — cadastrada já inativa como exemplo do caso que
-- motivou este catálogo (espécie fora da distribuição regional).
INSERT INTO especies_quelonio_catalogo (codigo, nome_popular, nome_cientifico, sigla_placa, ordem, ativo) VALUES
('tracaja',             'Tracajá',                     'Podocnemis unifilis',        'TR', 1, true),
('tartaruga',           'Tartaruga-da-amazônia',       'Podocnemis expansa',         'TA', 2, true),
('cabecudo',            'Cabeçudo',                    'Podocnemis sextuberculata',  'R',  3, true),
('pitiU',               'Pitiú',                       'Podocnemis erythrocephala',  'C',  4, true),
('mucua',               'Muçuã',                       'Kinosternon scorpioides',    'MU', 5, true),
('jabuti_pe_elefante',  'Jabuti-pé-de-elefante',       'Chelonoidis denticulatus',   'JE', 6, true),
('jabuti_piranga',      'Jabuti-piranga',               'Chelonoidis carbonarius',    'JP', 7, true),
('cupido',              'Cupido',                      'Podocnemis cayennensis',     'CU', 8, false),
('outro',               'Outro',                       NULL,                         'OU', 99, true)
ON CONFLICT (codigo) DO NOTHING;
