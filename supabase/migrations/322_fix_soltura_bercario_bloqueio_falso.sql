-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — corrige falso-positivo no bloqueio de
-- soltura duplicada (achado analisando o fluxo do ninho PRB-TR-2026-001)
-- ───────────────────────────────────────────────────────────────
-- Bug real, reproduzido simulando o INSERT que o app faz: a soltura em
-- bloco do berçário ("Soltar berçário") NUNCA conseguia gravar o
-- registro em `solturas_filhotes` — o trigger
-- `trg_soltura_bercario_bloquear_duplicada` (migration 143) barrava
-- com "Este berçário já foi solto anteriormente" na PRIMEIRA tentativa.
--
-- Causa: o trigger decide "já foi solto?" checando
-- `lotes_bercario.status = 'soltado'`. Mas esse campo tem DOIS
-- escritores independentes:
--   1) o app grava `lotes_bercario.status='soltado'` direto, via
--      upsert do próprio sync do lote (bioSyncLotes) — sem depender
--      da soltura;
--   2) o trigger `trg_soltura_atualizar_status_lote` (também da 143)
--      grava o mesmo campo, mas só DEPOIS que a soltura é inserida.
-- Na sincronização (js/biomonitor-sync.js, bioSyncTudo), a categoria
-- "lotes" roda ANTES da categoria "solturas" — então o status do lote
-- sempre chega ao servidor primeiro, e quando a soltura de verdade é
-- enviada logo em seguida, o trigger vê o lote já "soltado" e bloqueia
-- a única tentativa real, como se fosse repetição. O erro fica só na
-- fila local do dispositivo — nenhuma tela mostra isso. Resultado
-- observado em produção: `lotes_bercario`/`filhotes_bercario`
-- corretamente soltos, `solturas_filhotes` vazia, e
-- `ninhos_quelonios.status` preso em 'em_bercario' para sempre (essa
-- transição só acontece via trigger disparado pelo INSERT em
-- `solturas_filhotes`, que nunca chegava a existir).
--
-- Fix: o bloqueio de duplicata passa a checar a EXISTÊNCIA de um
-- registro em `solturas_filhotes` para o lote — a fonte de verdade
-- real — em vez do status derivado, que dois caminhos escrevem sem
-- ordem garantida entre si.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_soltura_bercario_bloquear_duplicada()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.via_bercario AND NEW.lote_bercario_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM solturas_filhotes
      WHERE lote_bercario_id = NEW.lote_bercario_id AND via_bercario
    ) THEN
      RAISE EXCEPTION 'Este berçário já foi solto anteriormente.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
