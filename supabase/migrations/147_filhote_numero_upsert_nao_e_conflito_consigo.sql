-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — 145 renumerava TODO upsert, não só INSERT
-- ───────────────────────────────────────────────────────────────
-- Bug na correção anterior (145): o Postgres dispara o trigger
-- BEFORE INSERT em TODA linha de um `INSERT ... ON CONFLICT (uuid_
-- cliente) DO UPDATE`, mesmo quando a linha vai colidir e virar
-- UPDATE (não INSERT de verdade). O trigger checava "já existe
-- alguém com esse numero?" sem excluir a PRÓPRIA linha (mesmo
-- uuid_cliente) — então todo re-envio de um filhote já confirmado
-- (marcar doente, soltar berçário, registrar óbito — qualquer coisa
-- que force um novo upsert) encontrava "sim, esse número já está
-- em uso" (por ele mesmo!) e reatribuía MAX+1, sobrescrevendo o
-- valor correto ANTES do UPDATE. Reproduzido agora: marcar o filhote
-- #47 como doente virou #111.
--
-- Fix: exclui a própria linha (uuid_cliente igual ao de NEW) da
-- checagem de conflito — só é conflito de verdade se for OUTRO
-- filhote com o mesmo número.
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
        AND uuid_cliente IS DISTINCT FROM NEW.uuid_cliente
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
