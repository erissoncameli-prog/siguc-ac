-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · registro_fauna — política DELETE para brigadistas
-- Sem essa política, o upsert de fauna (delete+reinsert) falha
-- silenciosamente no Supabase RLS ao tentar re-sincronizar.
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "rf_delete" ON registro_fauna
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM registros_campo rc
      JOIN brigadistas b ON b.id = rc.brigadista_id
      WHERE rc.id = registro_fauna.registro_campo_id
        AND b.usuario_id = auth.uid()
        AND b.status = 'ativo'
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('biologo','gestor','super_admin')
        AND u.ativo
    )
  );
