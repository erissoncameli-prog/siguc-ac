-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Filhote sincronizado tarde perdia o número
-- ───────────────────────────────────────────────────────────────
-- Bug: trg_filhotes_bercario_before_insert (135/138) SEMPRE
--   sobrescrevia NEW.numero com MAX(numero)+1 no INSERT, descartando
--   o número local — sob a premissa de que o valor do app é só um
--   "rascunho". Isso funciona bem quando os N filhotes de um lote
--   sincronizam em sequência, mas quebra quando um filhote específico
--   fica preso em status_sync='pendente' (ex.: por causa do lote
--   ainda não ter confirmado no servidor no momento do push) e só
--   sincroniza de verdade bem depois — nesse caso ele é um INSERT
--   "tardio", e o trigger dá a ele o PRÓXIMO número livre da hora
--   (ex.: filhote #1, preso por 1h, sincroniza depois de outros 108
--   já confirmados e vira #111) em vez de manter o número que o
--   monitor já anotou/etiquetou fisicamente no campo.
--
-- Fix: só cai no MAX+1 quando o número que o app mandou já está
--   ocupado (ou não foi informado) — senão preserva o número local,
--   que é o que está na etiqueta física do filhote.
-- ═══════════════════════════════════════════════════════════════

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

    IF NEW.numero IS NULL OR EXISTS (
      SELECT 1 FROM filhotes_bercario
      WHERE bercario_id = v_bercario_id
        AND temporada_id IS NOT DISTINCT FROM v_temporada_id
        AND numero = NEW.numero
    ) THEN
      SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
      FROM filhotes_bercario
      WHERE bercario_id = v_bercario_id
        AND temporada_id IS NOT DISTINCT FROM v_temporada_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
