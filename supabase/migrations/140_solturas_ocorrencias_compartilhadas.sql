-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Soltura e ocorrências de berçário
-- compartilhadas entre a equipe
-- ───────────────────────────────────────────────────────────────
-- Mesma causa raiz já corrigida em lotes_bercario/filhotes_bercario/
-- biometrias_individuais (135): RLS por monitor_id em vez de
-- grupo_id. Um berçário físico é usado por TODA a equipe, então a
-- soltura e as ocorrências (alimentação/mortalidade/biometria/etc)
-- registradas por um monitor precisam ser visíveis para os colegas
-- do mesmo grupo — hoje só quem digitou o registro enxerga, o que
-- torna o "histórico desde a entrada até a soltura" incompleto para
-- o resto da equipe.
--
-- Acrescenta grupo_id (mesmo padrão: trigger deriva do monitor,
-- nunca confia no valor do cliente) e amplia o SELECT por grupo_id
-- em solturas_filhotes e ocorrencias_bercario.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. solturas_filhotes: grupo_id ────────────────────────────────
ALTER TABLE solturas_filhotes ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES grupos_biomonitor(id) ON DELETE SET NULL;

UPDATE solturas_filhotes s
SET grupo_id = m.grupo_id
FROM monitores_biodiversidade m
WHERE m.id = s.monitor_id AND s.grupo_id IS NULL;

CREATE OR REPLACE FUNCTION trg_solturas_filhotes_derivar_grupo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT grupo_id INTO NEW.grupo_id FROM monitores_biodiversidade WHERE id = NEW.monitor_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_solturas_filhotes_grupo
  BEFORE INSERT OR UPDATE OF monitor_id ON solturas_filhotes
  FOR EACH ROW EXECUTE FUNCTION trg_solturas_filhotes_derivar_grupo();

DROP POLICY IF EXISTS "solturas_filhotes_select" ON solturas_filhotes;
CREATE POLICY "solturas_filhotes_select" ON solturas_filhotes
  FOR SELECT USING (
    grupo_id IN (SELECT mb.grupo_id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico'))
  );

CREATE INDEX IF NOT EXISTS idx_solturas_filhotes_grupo ON solturas_filhotes (grupo_id);

-- ── 2. ocorrencias_bercario: grupo_id ─────────────────────────────
ALTER TABLE ocorrencias_bercario ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES grupos_biomonitor(id) ON DELETE SET NULL;

UPDATE ocorrencias_bercario o
SET grupo_id = m.grupo_id
FROM monitores_biodiversidade m
WHERE m.id = o.monitor_id AND o.grupo_id IS NULL;

CREATE OR REPLACE FUNCTION trg_ocorrencias_bercario_derivar_grupo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT grupo_id INTO NEW.grupo_id FROM monitores_biodiversidade WHERE id = NEW.monitor_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ocorrencias_bercario_grupo
  BEFORE INSERT OR UPDATE OF monitor_id ON ocorrencias_bercario
  FOR EACH ROW EXECUTE FUNCTION trg_ocorrencias_bercario_derivar_grupo();

DROP POLICY IF EXISTS "ocorrencias_bercario_select" ON ocorrencias_bercario;
CREATE POLICY "ocorrencias_bercario_select" ON ocorrencias_bercario
  FOR SELECT USING (
    grupo_id IN (SELECT mb.grupo_id FROM monitores_biodiversidade mb WHERE mb.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor', 'super_admin', 'tecnico'))
  );

CREATE INDEX IF NOT EXISTS idx_ocorrencias_bercario_grupo ON ocorrencias_bercario (grupo_id);
