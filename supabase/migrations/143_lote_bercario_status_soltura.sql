-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — lotes_bercario.status nunca virava 'soltado'
--
-- Bug: só o app de campo atualizava lotes_bercario.status ao soltar
--   (via upsert no sync), e um bug no cliente fazia essa atualização
--   nunca ser marcada como pendente de envio — o status ficava
--   'ativo' pra sempre no servidor. Resultado: o filtro "Soltos" do
--   app nunca encontrava nada (o pull sempre trazia 'ativo' e
--   sobrescrevia o valor local), e o berçário podia ser solto de
--   novo, pois continuava elegível como lote ativo.
--
-- Fix: trigger de servidor — igual já existe para ninhos_quelonios
--   (mig. 128) — garante que o status do lote reflita a soltura
--   independente do que o cliente enviar. Bloqueia também soltura
--   duplicada do mesmo lote (dois monitores em campo, por exemplo).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_soltura_bercario_bloquear_duplicada()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  status_atual status_lote_bercario;
BEGIN
  IF NEW.via_bercario AND NEW.lote_bercario_id IS NOT NULL THEN
    SELECT status INTO status_atual FROM lotes_bercario WHERE id = NEW.lote_bercario_id;
    IF status_atual = 'soltado' THEN
      RAISE EXCEPTION 'Este berçário já foi solto anteriormente.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_soltura_bercario_bloquear_duplicada
  BEFORE INSERT ON solturas_filhotes
  FOR EACH ROW EXECUTE FUNCTION trg_soltura_bercario_bloquear_duplicada();

CREATE OR REPLACE FUNCTION trg_soltura_atualizar_status_lote()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.via_bercario AND NEW.lote_bercario_id IS NOT NULL THEN
    UPDATE lotes_bercario
       SET status = 'soltado'
     WHERE id = NEW.lote_bercario_id
       AND status = 'ativo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_soltura_atualizar_status_lote
  AFTER INSERT ON solturas_filhotes
  FOR EACH ROW EXECUTE FUNCTION trg_soltura_atualizar_status_lote();

-- Corrige o histórico: lotes que já têm soltura registrada mas
-- ficaram com status 'ativo' por causa do bug acima.
UPDATE lotes_bercario l
   SET status = 'soltado'
  FROM solturas_filhotes s
 WHERE s.lote_bercario_id = l.id
   AND s.via_bercario
   AND l.status = 'ativo';
