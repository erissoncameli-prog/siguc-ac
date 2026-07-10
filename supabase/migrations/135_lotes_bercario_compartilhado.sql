-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Berçário compartilhado entre a equipe
-- ───────────────────────────────────────────────────────────────
-- Dois problemas relatados de campo, mesma causa raiz (RLS por
-- monitor_id em vez de grupo_id — um berçário físico é usado por
-- TODA a equipe, não só por quem cadastrou o lote):
--
--   1. Um monitor não enxergava lotes que outro monitor da mesma
--      equipe deu entrada no MESMO berçário (lotes_bercario_select
--      só liberava monitor_id = dono da linha).
--   2. A numeração individual dos filhotes (filhotes_bercario.numero)
--      é gerada pelo app sempre 1..qtd por LOTE — dois lotes no
--      mesmo berçário sempre colidem (filhote #1, #2… se repete).
--
-- Corrige as duas:
--   • grupo_id em lotes_bercario / filhotes_bercario /
--     biometrias_individuais, preenchido por trigger a partir do
--     monitor (nunca confia no valor enviado pelo cliente) — mesmo
--     padrão de compartilhamento por equipe já usado em
--     ninhos_quelonios/transferencias_ninho/eclosoes_ninho (074).
--   • numero de filhotes_bercario passa a ser autoridade do SERVIDOR,
--     único por bercario_id (não por lote_id), calculado com lock
--     de transação para não colidir mesmo com dois aparelhos
--     sincronizando ao mesmo tempo. Renumera os dados já existentes.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. lotes_bercario: grupo_id ───────────────────────────────────
ALTER TABLE lotes_bercario ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES grupos_biomonitor(id) ON DELETE SET NULL;

UPDATE lotes_bercario l
SET grupo_id = m.grupo_id
FROM monitores_biodiversidade m
WHERE m.id = l.monitor_id AND l.grupo_id IS NULL;

CREATE OR REPLACE FUNCTION trg_lotes_bercario_derivar_grupo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT grupo_id INTO NEW.grupo_id FROM monitores_biodiversidade WHERE id = NEW.monitor_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lotes_bercario_grupo
  BEFORE INSERT OR UPDATE OF monitor_id ON lotes_bercario
  FOR EACH ROW EXECUTE FUNCTION trg_lotes_bercario_derivar_grupo();

DROP POLICY IF EXISTS "lotes_bercario_select" ON lotes_bercario;
CREATE POLICY "lotes_bercario_select" ON lotes_bercario
  FOR SELECT USING (
    grupo_id IN (SELECT mb.grupo_id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico'))
  );

CREATE INDEX IF NOT EXISTS idx_lotes_bercario_grupo ON lotes_bercario (grupo_id);

-- ── 2. filhotes_bercario: grupo_id + bercario_id (denormalizado) ──
ALTER TABLE filhotes_bercario ADD COLUMN IF NOT EXISTS grupo_id    uuid REFERENCES grupos_biomonitor(id) ON DELETE SET NULL;
ALTER TABLE filhotes_bercario ADD COLUMN IF NOT EXISTS bercario_id uuid REFERENCES bercarios(id)         ON DELETE SET NULL;

UPDATE filhotes_bercario f
SET grupo_id    = m.grupo_id,
    bercario_id = l.bercario_id
FROM monitores_biodiversidade m, lotes_bercario l
WHERE m.id = f.monitor_id AND l.id = f.lote_id
  AND (f.grupo_id IS NULL OR f.bercario_id IS NULL);

-- ── 3. Renumera filhotes já cadastrados: único por bercario_id,
--    não mais por lote_id (ordem cronológica de criação preservada).
--    Precisa acontecer com a constraint ANTIGA já removida e a NOVA
--    ainda não criada — "ADD CONSTRAINT ... UNIQUE" valida o dado
--    existente na hora (mesmo DEFERRABLE só adia a checagem em DML
--    futuro, não a validação inicial do índice), então renumerar
--    antes de criar a constraint nova é obrigatório, não só estético.
ALTER TABLE filhotes_bercario DROP CONSTRAINT IF EXISTS filhotes_bercario_lote_id_numero_key;

WITH ordenados AS (
  SELECT id, row_number() OVER (PARTITION BY bercario_id ORDER BY criado_em, numero) AS novo_numero
  FROM filhotes_bercario
  WHERE bercario_id IS NOT NULL
)
UPDATE filhotes_bercario f
SET numero = o.novo_numero
FROM ordenados o
WHERE f.id = o.id AND f.numero IS DISTINCT FROM o.novo_numero;

ALTER TABLE filhotes_bercario
  ADD CONSTRAINT filhotes_bercario_bercario_numero_key UNIQUE (bercario_id, numero) DEFERRABLE INITIALLY DEFERRED;

-- ── 4. Trigger: numero e bercario_id passam a ser autoridade do
--    servidor no INSERT (o valor mandado pelo app é só um rascunho
--    local de ordem de captura, não o rótulo final). Lock de
--    transação por bercario_id serializa sincronizações concorrentes
--    de aparelhos diferentes — sem isso, dois upserts simultâneos
--    poderiam calcular o mesmo "próximo número" e colidir de novo.
CREATE OR REPLACE FUNCTION trg_filhotes_bercario_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bercario_id uuid;
BEGIN
  SELECT grupo_id INTO NEW.grupo_id FROM monitores_biodiversidade WHERE id = NEW.monitor_id;

  SELECT bercario_id INTO v_bercario_id FROM lotes_bercario WHERE id = NEW.lote_id;
  NEW.bercario_id := v_bercario_id;

  IF v_bercario_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_bercario_id::text));
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM filhotes_bercario WHERE bercario_id = v_bercario_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_filhotes_bercario_numeracao
  BEFORE INSERT ON filhotes_bercario
  FOR EACH ROW EXECUTE FUNCTION trg_filhotes_bercario_before_insert();

DROP POLICY IF EXISTS "filhotes_bercario_select" ON filhotes_bercario;
CREATE POLICY "filhotes_bercario_select" ON filhotes_bercario
  FOR SELECT USING (
    grupo_id IN (SELECT mb.grupo_id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico'))
  );

CREATE INDEX IF NOT EXISTS idx_filhotes_bercario_grupo    ON filhotes_bercario (grupo_id);
CREATE INDEX IF NOT EXISTS idx_filhotes_bercario_bercario ON filhotes_bercario (bercario_id);

-- ── 5. biometrias_individuais: mesma regra de equipe ──────────────
ALTER TABLE biometrias_individuais ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES grupos_biomonitor(id) ON DELETE SET NULL;

UPDATE biometrias_individuais b
SET grupo_id = m.grupo_id
FROM monitores_biodiversidade m
WHERE m.id = b.monitor_id AND b.grupo_id IS NULL;

CREATE OR REPLACE FUNCTION trg_biometrias_ind_derivar_grupo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT grupo_id INTO NEW.grupo_id FROM monitores_biodiversidade WHERE id = NEW.monitor_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_biometrias_ind_grupo
  BEFORE INSERT OR UPDATE OF monitor_id ON biometrias_individuais
  FOR EACH ROW EXECUTE FUNCTION trg_biometrias_ind_derivar_grupo();

DROP POLICY IF EXISTS "biometrias_individuais_select" ON biometrias_individuais;
CREATE POLICY "biometrias_individuais_select" ON biometrias_individuais
  FOR SELECT USING (
    grupo_id IN (SELECT mb.grupo_id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico'))
  );

CREATE INDEX IF NOT EXISTS idx_biometrias_ind_grupo ON biometrias_individuais (grupo_id);

-- ── 6. View: agora reflete o numero renumerado (security_invoker já
--    aplica a RLS nova automaticamente; recriada só por clareza).
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
