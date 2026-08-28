-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Soltura de berçário travava em loop no reenvio
-- ───────────────────────────────────────────────────────────────
-- Mesma classe de bug já corrigida em 147 (filhotes_bercario), agora em
-- solturas_filhotes: trg_soltura_bercario_bloquear_duplicada (143) é
-- BEFORE INSERT e barra se o lote-alvo já está 'soltado' — mas o
-- Postgres dispara esse trigger em TODA linha de um
-- `INSERT ... ON CONFLICT (uuid_cliente) DO UPDATE`, mesmo quando a
-- linha vai só colidir e virar UPDATE (reenvio de uma soltura que já
-- tinha sido confirmada no servidor, mas cuja resposta não chegou ao
-- app de campo). Resultado: a MESMA soltura que já tinha sido aceita
-- (e por isso já marcou o lote como 'soltado' via trg_soltura_
-- atualizar_status_lote) passava a ser rejeitada em todo reenvio,
-- deixando o registro preso pra sempre na fila de sincronização —
-- mesmo berçário nunca mais aceitava nem sua própria soltura confirmar.
--
-- Fix: exclui a própria linha (mesmo uuid_cliente) da checagem — só é
-- duplicata de verdade se for OUTRA soltura (uuid_cliente diferente)
-- tentando soltar um lote que já está soltado.
--
-- Também faltava política de UPDATE em solturas_filhotes (só tinha
-- INSERT/SELECT desde 087) — sem ela, o upsert de reenvio que cai no
-- caminho de UPDATE por conflito é silenciosamente bloqueado pelo RLS
-- (0 linhas afetadas), mesmo com o trigger já corrigido. Mesma causa
-- raiz que 151 já corrigiu para lotes_bercario.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_soltura_bercario_bloquear_duplicada()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  status_atual status_lote_bercario;
BEGIN
  IF NEW.via_bercario AND NEW.lote_bercario_id IS NOT NULL THEN
    SELECT status INTO status_atual FROM lotes_bercario WHERE id = NEW.lote_bercario_id;
    IF status_atual = 'soltado' AND NOT EXISTS (
      SELECT 1 FROM solturas_filhotes
      WHERE lote_bercario_id = NEW.lote_bercario_id
        AND uuid_cliente = NEW.uuid_cliente
    ) THEN
      RAISE EXCEPTION 'Este berçário já foi solto anteriormente.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE POLICY "solturas_filhotes_update" ON solturas_filhotes
  FOR UPDATE USING (
    grupo_id IN (
      SELECT mb.grupo_id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico')
    )
  )
  WITH CHECK (
    grupo_id IN (
      SELECT mb.grupo_id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico')
    )
  );
