-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Berçário não mistura espécies
-- ───────────────────────────────────────────────────────────────
-- Regra de campo: um berçário recebe filhotes de UMA espécie por vez.
-- Assim que recebe a primeira espécie, fica "travado" nela enquanto
-- houver lote ATIVO ali; quando todos os lotes daquela espécie forem
-- soltos (nenhum lote ativo remanescente), libera para qualquer
-- espécie de novo.
--
-- O app já bloqueia isso no seletor de berçário (client-side, usando
-- o cache local dos lotes da equipe). Esta migration é a autoridade
-- final no servidor — cobre o caso raro de dois aparelhos, ambos
-- offline, darem entrada de espécies diferentes no mesmo berçário
-- antes de sincronizar: o segundo a sincronizar cai na fila de erro.
--
-- lotes_bercario não guarda a espécie diretamente — vem do ninho
-- (ninho_id → ninhos_quelonios.especie).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_lotes_bercario_valida_especie()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_especie_nova      text;
  v_especie_existente text;
BEGIN
  IF NEW.bercario_id IS NULL THEN RETURN NEW; END IF;

  SELECT especie INTO v_especie_nova FROM ninhos_quelonios WHERE id = NEW.ninho_id;
  IF v_especie_nova IS NULL THEN RETURN NEW; END IF;

  SELECT n.especie INTO v_especie_existente
  FROM lotes_bercario l
  JOIN ninhos_quelonios n ON n.id = l.ninho_id
  WHERE l.bercario_id = NEW.bercario_id
    AND l.status = 'ativo'
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

CREATE TRIGGER trg_lotes_bercario_especie
  BEFORE INSERT ON lotes_bercario
  FOR EACH ROW EXECUTE FUNCTION trg_lotes_bercario_valida_especie();
