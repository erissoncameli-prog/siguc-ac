-- Migração 061: permite que técnicos também editem registro_fauna na validação
-- Antes: apenas biologo, gestor, super_admin. Agora inclui tecnico.

DROP POLICY IF EXISTS "rf_update" ON registro_fauna;

CREATE POLICY "rf_update" ON registro_fauna
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('biologo','tecnico','gestor','super_admin')
        AND u.ativo
    )
  );
