-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Berçário respeita a temporada
-- ───────────────────────────────────────────────────────────────
-- Berçário é uma estrutura FÍSICA, reaproveitada ano após ano. Mas a
-- numeração de filhotes (135) e a trava de espécie única (136)
-- escopavam só por bercario_id, sem noção de temporada — então:
--   • a numeração nunca reiniciava: a temporada seguinte no mesmo
--     tanque continuaria de onde a anterior parou (#147 em vez de #1);
--   • um lote esquecido "ativo" ao fim de uma temporada travava a
--     espécie da temporada nova para sempre, mesmo com o tanque na
--     prática já vazio.
--
-- Acrescenta temporada_id em lotes_bercario/filhotes_bercario (mesmo
-- padrão client-melhor-esforço + servidor-autoridade já usado em
-- ninhos_quelonios: o app manda um palpite, o trigger recalcula a
-- partir do ninho) e escopa numeração + trava de espécie por
-- (bercario_id, temporada_id) em vez de só bercario_id.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. temporada_id em lotes_bercario ──────────────────────────
ALTER TABLE lotes_bercario ADD COLUMN IF NOT EXISTS temporada_id uuid REFERENCES temporadas_biomonitor(id) ON DELETE SET NULL;

UPDATE lotes_bercario l
SET temporada_id = n.temporada_id
FROM ninhos_quelonios n
WHERE n.id = l.ninho_id AND l.temporada_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_lotes_bercario_temporada ON lotes_bercario (bercario_id, temporada_id);

-- ── 2. temporada_id em filhotes_bercario (denormalizado do lote) ──
ALTER TABLE filhotes_bercario ADD COLUMN IF NOT EXISTS temporada_id uuid REFERENCES temporadas_biomonitor(id) ON DELETE SET NULL;

UPDATE filhotes_bercario f
SET temporada_id = l.temporada_id
FROM lotes_bercario l
WHERE l.id = f.lote_id AND f.temporada_id IS NULL;

-- ── 3. Renumera filhotes já cadastrados: único por
--    (bercario_id, temporada_id), não mais só por bercario_id ────
ALTER TABLE filhotes_bercario DROP CONSTRAINT IF EXISTS filhotes_bercario_bercario_numero_key;

WITH ordenados AS (
  SELECT id, row_number() OVER (PARTITION BY bercario_id, temporada_id ORDER BY criado_em, numero) AS novo_numero
  FROM filhotes_bercario
  WHERE bercario_id IS NOT NULL
)
UPDATE filhotes_bercario f
SET numero = o.novo_numero
FROM ordenados o
WHERE f.id = o.id AND f.numero IS DISTINCT FROM o.novo_numero;

ALTER TABLE filhotes_bercario
  ADD CONSTRAINT filhotes_bercario_bercario_temporada_numero_key UNIQUE (bercario_id, temporada_id, numero) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_filhotes_bercario_temporada ON filhotes_bercario (bercario_id, temporada_id);

-- ── 4. Numeração (135) escopada por (bercario_id, temporada_id) ──
CREATE OR REPLACE FUNCTION trg_filhotes_bercario_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bercario_id  uuid;
  v_temporada_id uuid;
BEGIN
  SELECT grupo_id INTO NEW.grupo_id FROM monitores_biodiversidade WHERE id = NEW.monitor_id;

  SELECT bercario_id, temporada_id INTO v_bercario_id, v_temporada_id
  FROM lotes_bercario WHERE id = NEW.lote_id;
  NEW.bercario_id  := v_bercario_id;
  NEW.temporada_id := v_temporada_id;

  IF v_bercario_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_bercario_id::text || ':' || COALESCE(v_temporada_id::text, '')));
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM filhotes_bercario
    WHERE bercario_id = v_bercario_id
      AND temporada_id IS NOT DISTINCT FROM v_temporada_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 5. Trava de espécie (136): só considera conflito lote ativo da
--    MESMA temporada; deriva temporada_id do ninho no mesmo passo
--    (evita depender de ordem entre triggers BEFORE INSERT distintos
--    na mesma tabela — a ordem de execução é alfabética por nome).
CREATE OR REPLACE FUNCTION trg_lotes_bercario_valida_especie()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_especie_nova      text;
  v_especie_existente text;
BEGIN
  SELECT temporada_id INTO NEW.temporada_id FROM ninhos_quelonios WHERE id = NEW.ninho_id;

  IF NEW.bercario_id IS NULL THEN RETURN NEW; END IF;

  SELECT especie INTO v_especie_nova FROM ninhos_quelonios WHERE id = NEW.ninho_id;
  IF v_especie_nova IS NULL THEN RETURN NEW; END IF;

  SELECT n.especie INTO v_especie_existente
  FROM lotes_bercario l
  JOIN ninhos_quelonios n ON n.id = l.ninho_id
  WHERE l.bercario_id = NEW.bercario_id
    AND l.status = 'ativo'
    AND l.temporada_id IS NOT DISTINCT FROM NEW.temporada_id
    AND n.especie IS DISTINCT FROM v_especie_nova
  LIMIT 1;

  IF v_especie_existente IS NOT NULL THEN
    RAISE EXCEPTION 'Berçário já está em uso com a espécie "%" — não é possível misturar com "%". Solte os filhotes dessa espécie primeiro ou escolha outro berçário.',
      v_especie_existente, v_especie_nova
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
