-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Corrige 2 travas de sincronização
-- (diagnosticadas pela fila resiliente: mig. anterior de sync)
--
-- Bug 1 — Visitas: predacao_incubacao era NOT NULL DEFAULT 'nenhuma';
--   o app envia null explícito (sem predação) e o DEFAULT só vale quando
--   a coluna é OMITIDA → "null value ... violates not-null constraint".
--   Torna anulável (null = sem predação, igual a 'nenhuma' nos gates).
--
-- Bug 2 — Berçário/Soltura: os triggers de status (mig. 109)
--   referenciavam NEW.ninho_uuid, mas lotes_bercario/solturas_filhotes
--   têm ninho_id (FK → ninhos_quelonios.id) → "record new has no field
--   ninho_uuid". Corrige para id = NEW.ninho_id.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE visitas_ninho ALTER COLUMN predacao_incubacao DROP NOT NULL;

CREATE OR REPLACE FUNCTION trg_lote_atualizar_status_ninho()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ninhos_quelonios
     SET status = 'em_bercario', atualizado_em = now()
   WHERE id = NEW.ninho_id
     AND status = 'eclodido';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_soltura_atualizar_status_ninho()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.via_bercario THEN
    UPDATE ninhos_quelonios
       SET status = 'soltado', atualizado_em = now()
     WHERE id = NEW.ninho_id
       AND status = 'eclodido';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_soltura_bercario_atualizar_status_ninho()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.via_bercario THEN
    UPDATE ninhos_quelonios
       SET status = 'soltado', atualizado_em = now()
     WHERE id = NEW.ninho_id
       AND status = 'em_bercario';
  END IF;
  RETURN NEW;
END;
$$;
