-- 109: Novos status de ninho pós-eclosão
-- 'soltado'    → filhotes liberados direto no rio
-- 'em_bercario' → filhotes encaminhados a berçário (soltura via aba Berçário)
-- Garante que o app não exiba botão "Soltar" nesses ninhos, evitando duplicatas.

ALTER TYPE status_ninho ADD VALUE IF NOT EXISTS 'soltado'     AFTER 'eclodido';
ALTER TYPE status_ninho ADD VALUE IF NOT EXISTS 'em_bercario' AFTER 'eclodido';

-- Trigger: ao inserir soltura direta (sem lote), atualiza ninho para 'soltado'
CREATE OR REPLACE FUNCTION trg_soltura_atualizar_status_ninho()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.via_bercario THEN
    UPDATE ninhos_quelonios
       SET status = 'soltado', atualizado_em = now()
     WHERE uuid_cliente = NEW.ninho_uuid
       AND status = 'eclodido';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_soltura_status ON solturas_quelonios;
CREATE TRIGGER trg_soltura_status
  AFTER INSERT ON solturas_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_soltura_atualizar_status_ninho();

-- Trigger: ao inserir lote em berçário, atualiza ninho para 'em_bercario'
CREATE OR REPLACE FUNCTION trg_lote_atualizar_status_ninho()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ninhos_quelonios
     SET status = 'em_bercario', atualizado_em = now()
   WHERE uuid_cliente = NEW.ninho_uuid
     AND status = 'eclodido';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lote_status ON lotes_bercario;
CREATE TRIGGER trg_lote_status
  AFTER INSERT ON lotes_bercario
  FOR EACH ROW EXECUTE FUNCTION trg_lote_atualizar_status_ninho();

-- Trigger: ao inserir soltura via berçário (via_bercario = true),
-- avança o ninho de 'em_bercario' para 'soltado'
CREATE OR REPLACE FUNCTION trg_soltura_bercario_atualizar_status_ninho()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.via_bercario THEN
    UPDATE ninhos_quelonios
       SET status = 'soltado', atualizado_em = now()
     WHERE uuid_cliente = NEW.ninho_uuid
       AND status = 'em_bercario';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_soltura_bercario_status ON solturas_quelonios;
CREATE TRIGGER trg_soltura_bercario_status
  AFTER INSERT ON solturas_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_soltura_bercario_atualizar_status_ninho();
