-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Biometria individual no berçário
-- ───────────────────────────────────────────────────────────────
-- Hoje a biometria do berçário só existe por AMOSTRAGEM (média de
-- comprimento/peso de N filhotes, em ocorrencias_bercario). Esta
-- migration ACRESCENTA o registro POR INDIVÍDUO, opcional por lote:
-- ao dar entrada, o monitor pode gerar um número sequencial por
-- filhote (1..qtd_entrada, escopado ao lote) e depois medir cada um
-- ao longo do tempo. Não substitui nem migra a amostragem existente.
--
--   filhotes_bercario     — identidade do indivíduo (número + status)
--   biometrias_individuais — medições (comprimento/peso) por indivíduo
--
-- Depende de 087_pos_eclosao (lotes_bercario).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Status do indivíduo ────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE status_individuo_bercario AS ENUM ('ativo', 'morto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Indivíduos do lote ─────────────────────────────────────────
CREATE TABLE filhotes_bercario (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente    uuid        UNIQUE NOT NULL,
  lote_id         uuid        NOT NULL REFERENCES lotes_bercario(id) ON DELETE CASCADE,
  numero          smallint    NOT NULL CHECK (numero > 0),
  status          status_individuo_bercario NOT NULL DEFAULT 'ativo',
  data_obito      date,
  causa_obito     text,
  observacoes     text,
  monitor_id      uuid        REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  sincronizado_em timestamptz,

  UNIQUE (lote_id, numero)
);

CREATE INDEX ON filhotes_bercario (lote_id);
CREATE INDEX ON filhotes_bercario (monitor_id);

ALTER TABLE filhotes_bercario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "filhotes_bercario_insert" ON filhotes_bercario
  FOR INSERT WITH CHECK (
    monitor_id IN (SELECT mb.id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
  );

CREATE POLICY "filhotes_bercario_select" ON filhotes_bercario
  FOR SELECT USING (
    monitor_id IN (SELECT mb.id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico'))
  );

CREATE POLICY "filhotes_bercario_update" ON filhotes_bercario
  FOR UPDATE USING (
    monitor_id IN (SELECT mb.id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico'))
  );

CREATE OR REPLACE FUNCTION trg_filhotes_bercario_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_filhotes_bercario_touch
  BEFORE UPDATE ON filhotes_bercario
  FOR EACH ROW EXECUTE FUNCTION trg_filhotes_bercario_updated();

-- ── 3. Biometrias por indivíduo ───────────────────────────────────
CREATE TABLE biometrias_individuais (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente    uuid        UNIQUE NOT NULL,
  individuo_id    uuid        NOT NULL REFERENCES filhotes_bercario(id) ON DELETE CASCADE,
  data_medicao    date        NOT NULL,
  hora_medicao    time,
  comprimento_cm  numeric(5,1),
  peso_g          numeric(6,1),
  observacoes     text,
  monitor_id      uuid        REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  sincronizado_em timestamptz,

  CHECK (comprimento_cm IS NOT NULL OR peso_g IS NOT NULL)
);

CREATE INDEX ON biometrias_individuais (individuo_id, data_medicao DESC);
CREATE INDEX ON biometrias_individuais (monitor_id);

ALTER TABLE biometrias_individuais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "biometrias_individuais_insert" ON biometrias_individuais
  FOR INSERT WITH CHECK (
    monitor_id IN (SELECT mb.id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
  );

CREATE POLICY "biometrias_individuais_select" ON biometrias_individuais
  FOR SELECT USING (
    monitor_id IN (SELECT mb.id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico'))
  );

-- ── 4. View: última biometria por indivíduo (lista do app/admin) ──
CREATE OR REPLACE VIEW vw_filhotes_bercario
WITH (security_invoker = true)
AS
SELECT
  f.id,
  f.uuid_cliente,
  f.lote_id,
  f.numero,
  f.status,
  f.data_obito,
  f.causa_obito,
  f.observacoes,
  f.criado_em,
  ub.data_medicao   AS ultima_data_medicao,
  ub.comprimento_cm AS ultimo_comprimento_cm,
  ub.peso_g         AS ultimo_peso_g,
  (SELECT count(*) FROM biometrias_individuais b WHERE b.individuo_id = f.id) AS total_medicoes
FROM filhotes_bercario f
LEFT JOIN LATERAL (
  SELECT data_medicao, comprimento_cm, peso_g
  FROM biometrias_individuais
  WHERE individuo_id = f.id
  ORDER BY data_medicao DESC, hora_medicao DESC NULLS LAST, criado_em DESC
  LIMIT 1
) ub ON true;
