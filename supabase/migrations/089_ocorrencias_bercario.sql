-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Ocorrências em berçário
-- ═══════════════════════════════════════════════════════════
-- Registra eventos durante a permanência do lote no berçário:
-- alimentação, biometria, mortalidade, doença, tratamento, observação.
-- ═══════════════════════════════════════════════════════════

CREATE TYPE tipo_ocorrencia_bercario AS ENUM (
  'alimentacao',
  'biometria',
  'mortalidade',
  'doenca',
  'tratamento',
  'observacao'
);

CREATE TABLE ocorrencias_bercario (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente          uuid        UNIQUE NOT NULL,
  lote_id               uuid        REFERENCES lotes_bercario(id) ON DELETE CASCADE,
  tipo                  tipo_ocorrencia_bercario NOT NULL,
  data_ocorrencia       date        NOT NULL,
  hora_ocorrencia       time,
  -- biometria
  comprimento_medio_cm  numeric(5,1),
  peso_medio_g          numeric(6,1),
  n_amostrados          smallint,
  -- mortalidade / doença
  qtd_afetados          smallint    NOT NULL DEFAULT 0 CHECK (qtd_afetados >= 0),
  causa                 text,
  -- geral
  descricao             text,
  monitor_id            uuid        REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  sincronizado_em       timestamptz
);

ALTER TABLE ocorrencias_bercario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ocorrencias_bercario_insert" ON ocorrencias_bercario
  FOR INSERT WITH CHECK (
    monitor_id IN (
      SELECT mb.id FROM monitores_biodiversidade mb
      WHERE mb.usuario_id = auth.uid()
    )
  );

CREATE POLICY "ocorrencias_bercario_select" ON ocorrencias_bercario
  FOR SELECT USING (
    monitor_id IN (
      SELECT mb.id FROM monitores_biodiversidade mb
      WHERE mb.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('gestor', 'super_admin', 'tecnico')
    )
  );

CREATE INDEX ON ocorrencias_bercario (lote_id, data_ocorrencia DESC);
CREATE INDEX ON ocorrencias_bercario (monitor_id);
