-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Alertas Ambientais
-- Módulo B: focos de calor, desmatamento e degradação
-- ═══════════════════════════════════════════════════════════

-- ── Enums ──────────────────────────────────────────────────

CREATE TYPE fonte_alerta AS ENUM ('FIRMS', 'DETER', 'BDQUEIMADAS', 'PRODES');
CREATE TYPE tipo_alerta  AS ENUM ('queimada', 'desmatamento', 'degradacao');

-- ── Tabela principal ────────────────────────────────────────

CREATE TABLE alertas_ambientais (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte           fonte_alerta NOT NULL,
  tipo            tipo_alerta NOT NULL,
  severidade      severidade_ocorrencia NOT NULL DEFAULT 'media',

  -- UC afetada (pode ser NULL se alerta não cair em nenhuma UC cadastrada)
  uc_id           uuid REFERENCES unidades_conservacao(id) ON DELETE SET NULL,
  uc_nome         text,             -- cache para listagens rápidas

  -- Localização e área
  area_ha         numeric(12,4),
  geom            geometry(Point, 4326),

  -- Metadados da fonte
  fonte_id        text,             -- ID único na fonte (evita duplicatas)
  data_referencia date NOT NULL,    -- data do evento na fonte
  data_deteccao   timestamptz NOT NULL DEFAULT now(),

  -- Notificação
  notificado_em   timestamptz,
  emails_enviados text[],

  -- Dados brutos para análises futuras
  raw_data        jsonb,

  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz DEFAULT now()
);

-- ── Índices ─────────────────────────────────────────────────

CREATE INDEX idx_alertas_uc       ON alertas_ambientais (uc_id);
CREATE INDEX idx_alertas_data     ON alertas_ambientais (data_referencia DESC);
CREATE INDEX idx_alertas_fonte    ON alertas_ambientais (fonte);
CREATE INDEX idx_alertas_fonte_id ON alertas_ambientais (fonte_id) WHERE fonte_id IS NOT NULL;
CREATE INDEX idx_alertas_geom     ON alertas_ambientais USING GIST (geom);
CREATE INDEX idx_alertas_sev      ON alertas_ambientais (severidade);

-- ── RLS ─────────────────────────────────────────────────────

ALTER TABLE alertas_ambientais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alertas_select" ON alertas_ambientais
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "alertas_admin" ON alertas_ambientais
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('super_admin', 'gestor')
        AND u.ativo
    )
  );
