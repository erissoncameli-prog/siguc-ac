-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Default de praia_atual_id no ninho
-- ───────────────────────────────────────────────────────────
-- Todo ninho novo nasce incubando na própria praia de origem.
-- Sem isto, ninhos inseridos pelo app (que não envia praia_atual_id)
-- ficariam com praia_atual_id NULL e não contariam em
-- "ninhos_incubando_aqui". A transferência depois atualiza o campo.
-- Depende de 080_transferencia_entre_praias.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_ninhos_default_praia_atual()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.praia_atual_id IS NULL THEN
    NEW.praia_atual_id := NEW.praia_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ninhos_praia_atual ON ninhos_quelonios;
CREATE TRIGGER trg_ninhos_praia_atual
  BEFORE INSERT ON ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_ninhos_default_praia_atual();
