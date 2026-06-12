-- ════════════════════════════════════════════════════════════════
-- SIGUC-AC · Brigadistas — auto-atualização de foto pelo app
-- O brigadista pode atualizar a própria linha, mas um trigger
-- garante que somente foto_url seja alterada (gestores/técnicos/
-- admins continuam livres via política brigadistas_write).
-- ════════════════════════════════════════════════════════════════

CREATE POLICY "brigadistas_self_update" ON brigadistas
  FOR UPDATE
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE OR REPLACE FUNCTION brigadista_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  eh_gestao boolean;
  r brigadistas;
BEGIN
  -- Não é o próprio brigadista (gestor, admin ou service role): segue
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM OLD.usuario_id THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = auth.uid()
      AND u.perfil IN ('tecnico', 'gestor', 'super_admin')
      AND u.ativo
  ) INTO eh_gestao;
  IF eh_gestao THEN RETURN NEW; END IF;

  -- Auto-atualização: preserva tudo, aceita apenas a nova foto
  r := OLD;
  r.foto_url := NEW.foto_url;
  RETURN r;
END $$;

DROP TRIGGER IF EXISTS trg_brigadistas_self_guard ON brigadistas;
CREATE TRIGGER trg_brigadistas_self_guard
  BEFORE UPDATE ON brigadistas
  FOR EACH ROW EXECUTE FUNCTION brigadista_guard_self_update();
