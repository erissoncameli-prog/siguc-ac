-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Registros de Campo — política UPDATE para brigadistas
-- Permite que o próprio brigadista (ativo) atualize registros
-- seus ainda aguardando validação (necessário para o upsert
-- do sync offline: ON CONFLICT DO UPDATE aciona UPDATE RLS).
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "rc_brigadista_update_own" ON registros_campo
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM brigadistas b
      WHERE b.id          = registros_campo.brigadista_id
        AND b.usuario_id  = auth.uid()
        AND b.status      = 'ativo'
    )
    AND status_validacao = 'aguardando'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM brigadistas b
      WHERE b.id          = registros_campo.brigadista_id
        AND b.usuario_id  = auth.uid()
        AND b.status      = 'ativo'
    )
    AND status_validacao = 'aguardando'
  );
