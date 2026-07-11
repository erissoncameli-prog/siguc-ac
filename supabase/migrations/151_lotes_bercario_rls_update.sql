-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — lotes_bercario nunca teve política de UPDATE
-- ───────────────────────────────────────────────────────────────
-- Causa raiz definitiva do "soltar berçário não muda o status": a
-- tabela lotes_bercario (087_pos_eclosao.sql) só ganhou políticas de
-- INSERT e SELECT. Com RLS habilitado e nenhuma política de UPDATE,
-- todo UPDATE contra essa tabela é silenciosamente bloqueado (afeta
-- 0 linhas, sem erro) — tanto o upsert que o app faz ao soltar
-- quanto o trigger trg_soltura_atualizar_status_lote (145), que roda
-- como SECURITY INVOKER (privilégios de quem chamou, sujeito ao
-- mesmo RLS). As correções anteriores pareciam funcionar porque
-- foram validadas com acesso administrativo (que ignora RLS) — na
-- prática nunca funcionaram para o usuário real.
--
-- Fix: política de UPDATE por grupo (berçário é compartilhado pela
-- equipe, mesmo padrão já usado no SELECT desde 135) + trigger vira
-- SECURITY DEFINER como defesa extra, independente de RLS.
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "lotes_bercario_update" ON lotes_bercario
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

CREATE OR REPLACE FUNCTION trg_soltura_atualizar_status_lote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- Repara os lotes presos em 'ativo' por esse bug (têm soltura
-- registrada mas nunca conseguiram atualizar o próprio status).
UPDATE lotes_bercario l
   SET status = 'soltado'
  FROM solturas_filhotes s
 WHERE s.lote_bercario_id = l.id
   AND s.via_bercario
   AND l.status = 'ativo';
