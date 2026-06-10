-- ── Função SECURITY DEFINER para checar chefe sem recursão RLS ──
CREATE OR REPLACE FUNCTION is_chefe_brigada(p_usuario_id uuid, p_brigada_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM brigadistas
    WHERE usuario_id = p_usuario_id
      AND funcao     = 'chefe_brigada'
      AND brigada_id = p_brigada_id
      AND status     = 'ativo'
  );
$$;

-- ── Recria política sem auto-referência ─────────────────────────
DROP POLICY IF EXISTS "brigadistas_select" ON brigadistas;

CREATE POLICY "brigadistas_select" ON brigadistas
  FOR SELECT TO authenticated USING (
    usuario_id = auth.uid()
    OR is_chefe_brigada(auth.uid(), brigada_id)
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('tecnico','gestor','super_admin','biologo')
        AND u.ativo
    )
  );
