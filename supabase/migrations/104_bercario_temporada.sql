-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Berçário acompanha a Temporada
-- ───────────────────────────────────────────────────────────────
-- Os lotes de berçário (lotes_bercario) são o registro de cada ciclo,
-- mas não carregavam temporada — diferente dos ninhos, que já têm
-- temporada_id. Sem isso não dá para fechar "berçário por ano".
--
-- Adiciona temporada_id em lotes_bercario, derivado automaticamente do
-- ninho de origem (ou da temporada atual do programa). Tudo aditivo;
-- nada é apagado.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE lotes_bercario
  ADD COLUMN IF NOT EXISTS temporada_id uuid REFERENCES temporadas_biomonitor(id);

CREATE INDEX IF NOT EXISTS idx_lotes_bercario_temporada
  ON lotes_bercario (temporada_id);

-- ── Deriva a temporada do lote (em cascata) ──────────────────────
-- Prioridade: temporada já informada → temporada do ninho de origem →
-- temporada atual do programa (via ninho → praia → programa) → por data.
CREATE OR REPLACE FUNCTION trg_lotes_bercario_derivar_temporada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prog uuid;
  v_temp uuid;
BEGIN
  -- 1) Respeita a temporada já informada
  IF NEW.temporada_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2) Temporada do ninho de origem
  IF NEW.ninho_id IS NOT NULL THEN
    SELECT temporada_id INTO v_temp FROM ninhos_quelonios WHERE id = NEW.ninho_id;
  END IF;

  -- 3) Senão, temporada atual do programa (ninho → praia → programa)
  IF v_temp IS NULL AND NEW.ninho_id IS NOT NULL THEN
    SELECT p.programa_id INTO v_prog
      FROM ninhos_quelonios n
      JOIN praias_monitoramento p ON p.id = n.praia_id
     WHERE n.id = NEW.ninho_id;
    IF v_prog IS NOT NULL THEN
      SELECT id INTO v_temp FROM temporadas_biomonitor
       WHERE programa_id = v_prog AND is_atual LIMIT 1;
      -- 4) Senão, por data de entrada
      IF v_temp IS NULL THEN
        SELECT id INTO v_temp FROM temporadas_biomonitor
         WHERE programa_id = v_prog
           AND NEW.data_entrada BETWEEN data_inicio AND data_fim
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  NEW.temporada_id := v_temp;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lotes_bercario_temporada ON lotes_bercario;
CREATE TRIGGER trg_lotes_bercario_temporada
  BEFORE INSERT ON lotes_bercario
  FOR EACH ROW EXECUTE FUNCTION trg_lotes_bercario_derivar_temporada();

-- ── Backfill dos lotes já existentes ─────────────────────────────
UPDATE lotes_bercario l
   SET temporada_id = n.temporada_id
  FROM ninhos_quelonios n
 WHERE n.id = l.ninho_id
   AND l.temporada_id IS NULL
   AND n.temporada_id IS NOT NULL;
