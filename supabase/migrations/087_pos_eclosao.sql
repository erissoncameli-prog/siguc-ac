-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Pós-eclosão: berçário e soltura
-- ───────────────────────────────────────────────────────────
-- Cobre os dois caminhos após a eclosão:
--   • Rio direto → solturas_filhotes (imediato)
--   • Berçário → lotes_bercario → solturas_filhotes (posterior)
-- ═══════════════════════════════════════════════════════════

-- ── 1. Enums ──────────────────────────────────────────────────

CREATE TYPE status_lote_bercario AS ENUM (
  'ativo',
  'soltado',
  'cancelado'
);

-- ── 2. Lotes em berçário ──────────────────────────────────────
-- Grupo de filhotes de um ninho levado para berçário após eclosão.
-- bercario_nome = texto livre (ex.: "Berçário 1", "Tanque B")

CREATE TABLE lotes_bercario (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente  uuid        UNIQUE NOT NULL,
  ninho_id      uuid        REFERENCES ninhos_quelonios(id)      ON DELETE SET NULL,
  bercario_nome text        NOT NULL,
  data_entrada  date        NOT NULL,
  hora_entrada  time,
  qtd_entrada   smallint    NOT NULL CHECK (qtd_entrada > 0),
  status        status_lote_bercario NOT NULL DEFAULT 'ativo',
  observacoes   text,
  monitor_id    uuid        REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  sincronizado_em timestamptz
);

ALTER TABLE lotes_bercario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lotes_bercario_insert" ON lotes_bercario
  FOR INSERT WITH CHECK (
    monitor_id IN (
      SELECT mb.id FROM monitores_biodiversidade mb
      WHERE mb.usuario_id = auth.uid()
    )
  );

CREATE POLICY "lotes_bercario_select" ON lotes_bercario
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

CREATE INDEX ON lotes_bercario (ninho_id);
CREATE INDEX ON lotes_bercario (monitor_id, status);

-- ── 3. Solturas de filhotes ───────────────────────────────────
-- Evento de soltura — funciona para ambos os caminhos.
-- via_bercario = false → soltura direta após eclosão
-- via_bercario = true  → saída do berçário (lote_bercario_id preenchido)

CREATE TABLE solturas_filhotes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente      uuid        UNIQUE NOT NULL,
  ninho_id          uuid        REFERENCES ninhos_quelonios(id)      ON DELETE SET NULL,
  lote_bercario_id  uuid        REFERENCES lotes_bercario(id)        ON DELETE SET NULL,
  via_bercario      boolean     NOT NULL DEFAULT false,
  data_soltura      date        NOT NULL,
  hora_soltura      time,
  qtd_soltada       smallint    NOT NULL CHECK (qtd_soltada >= 0),
  mortalidade       smallint    NOT NULL DEFAULT 0 CHECK (mortalidade >= 0),
  ponto_soltura     geometry(Point, 4326),
  local_descricao   text,
  predacao_soltura  boolean     NOT NULL DEFAULT false,
  observacoes       text,
  monitor_id        uuid        REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  sincronizado_em   timestamptz
);

ALTER TABLE solturas_filhotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "solturas_filhotes_insert" ON solturas_filhotes
  FOR INSERT WITH CHECK (
    monitor_id IN (
      SELECT mb.id FROM monitores_biodiversidade mb
      WHERE mb.usuario_id = auth.uid()
    )
  );

CREATE POLICY "solturas_filhotes_select" ON solturas_filhotes
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

CREATE INDEX ON solturas_filhotes (ninho_id);
CREATE INDEX ON solturas_filhotes (lote_bercario_id);
CREATE INDEX ON solturas_filhotes (monitor_id);
