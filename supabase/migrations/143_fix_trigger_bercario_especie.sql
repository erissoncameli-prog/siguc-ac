-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Corrige tipo na trava de espécie do berçário
-- ───────────────────────────────────────────────────────────────
-- A função trg_lotes_bercario_valida_especie (136, reescrita na 138)
-- declarava v_especie_nova/v_especie_existente como TEXT e comparava
-- com ninhos_quelonios.especie (enum especie_quelonio) via
-- IS DISTINCT FROM. O Postgres não tem operador enum = text, então
-- TODA entrada de lote com berçário selecionado falhava no sync com:
--   "operator does not exist: especie_quelonio = text"
-- O lote caía na fila de erro e os filhotes individuais do lote
-- ficavam presos como pendentes (aguardam o server_id do lote).
--
-- Correção: variáveis tipadas como especie_quelonio. Lógica idêntica
-- à da 138 (trava por bercario_id + temporada_id).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_lotes_bercario_valida_especie()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_especie_nova      especie_quelonio;
  v_especie_existente especie_quelonio;
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
