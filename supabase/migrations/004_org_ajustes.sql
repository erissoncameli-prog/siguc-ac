-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Ajustes Estrutura Organizacional
-- Divisões, núcleos de UCs e trigger automático
-- ═══════════════════════════════════════════════════════════

-- ── Novos valores no enum tipo_unidade_org ──────────────────

ALTER TYPE tipo_unidade_org ADD VALUE IF NOT EXISTS 'divisao' AFTER 'departamento';
ALTER TYPE tipo_unidade_org ADD VALUE IF NOT EXISTS 'nucleo'  AFTER 'divisao';

-- ── Coluna de vínculo UC → nó organizacional ────────────────

ALTER TABLE unidades_conservacao
  ADD COLUMN IF NOT EXISTS unidade_org_id uuid REFERENCES unidades_organizacionais(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_uc_unidade_org ON unidades_conservacao (unidade_org_id);

-- ── CIGMA: mover para SECRETARIA e atualizar nome completo ──

UPDATE unidades_organizacionais
SET pai_id = (SELECT id FROM unidades_organizacionais WHERE sigla = 'SECRETARIA'),
    nome   = 'Centro Integrado de Inteligência, Geoprocessamento e Monitoramento Ambiental'
WHERE sigla = 'CIGMA';

-- ── Novos departamentos sob DIMA ─────────────────────────────

INSERT INTO unidades_organizacionais (sigla, nome, tipo, pai_id)
SELECT sigla, sigla, 'departamento',
       (SELECT id FROM unidades_organizacionais WHERE sigla = 'DIMA')
FROM (VALUES
  ('DEBIO'),
  ('DEFLOR'),
  ('DERHQA'),
  ('DESIL')
) AS t(sigla)
ON CONFLICT (sigla) DO NOTHING;

-- ── Divisão de UCs dentro do DEUC ───────────────────────────

INSERT INTO unidades_organizacionais (sigla, nome, tipo, pai_id)
SELECT 'DUC', 'Divisão de Unidades de Conservação', 'divisao',
       (SELECT id FROM unidades_organizacionais WHERE sigla = 'DEUC')
ON CONFLICT (sigla) DO NOTHING;

-- ── Trigger: núcleo automático para UCs estaduais ───────────

CREATE OR REPLACE FUNCTION criar_nucleo_uc()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_duc_id  uuid;
  v_nuc_id  uuid;
BEGIN
  -- Só age em UCs estaduais
  IF NEW.esfera <> 'estadual' THEN RETURN NEW; END IF;

  SELECT id INTO v_duc_id
  FROM unidades_organizacionais
  WHERE sigla = 'DUC' AND ativo = true
  LIMIT 1;

  IF v_duc_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO unidades_organizacionais (sigla, nome, tipo, pai_id)
  VALUES (NEW.codigo, 'Núcleo ' || NEW.nome, 'nucleo', v_duc_id)
  ON CONFLICT (sigla) DO UPDATE SET nome = EXCLUDED.nome
  RETURNING id INTO v_nuc_id;

  NEW.unidade_org_id := v_nuc_id;
  RETURN NEW;
END;
$$;

-- Atualiza nome do núcleo quando UC é renomeada
CREATE OR REPLACE FUNCTION atualizar_nucleo_uc()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.esfera = 'estadual' AND (NEW.nome <> OLD.nome OR NEW.esfera <> OLD.esfera) THEN
    UPDATE unidades_organizacionais
    SET nome = 'Núcleo ' || NEW.nome
    WHERE sigla = NEW.codigo AND tipo = 'nucleo';
  END IF;

  -- Se esfera mudou de estadual para outra, desativa o núcleo
  IF OLD.esfera = 'estadual' AND NEW.esfera <> 'estadual' AND NEW.unidade_org_id IS NOT NULL THEN
    UPDATE unidades_organizacionais SET ativo = false WHERE id = NEW.unidade_org_id;
    NEW.unidade_org_id := NULL;
  END IF;

  -- Se esfera mudou para estadual, cria o núcleo
  IF OLD.esfera <> 'estadual' AND NEW.esfera = 'estadual' THEN
    DECLARE
      v_duc_id uuid;
      v_nuc_id uuid;
    BEGIN
      SELECT id INTO v_duc_id FROM unidades_organizacionais WHERE sigla = 'DUC' AND ativo = true LIMIT 1;
      IF v_duc_id IS NOT NULL THEN
        INSERT INTO unidades_organizacionais (sigla, nome, tipo, pai_id)
        VALUES (NEW.codigo, 'Núcleo ' || NEW.nome, 'nucleo', v_duc_id)
        ON CONFLICT (sigla) DO UPDATE SET nome = EXCLUDED.nome, ativo = true
        RETURNING id INTO v_nuc_id;
        NEW.unidade_org_id := v_nuc_id;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_uc_criar_nucleo
  BEFORE INSERT ON unidades_conservacao
  FOR EACH ROW EXECUTE FUNCTION criar_nucleo_uc();

CREATE TRIGGER trg_uc_atualizar_nucleo
  BEFORE UPDATE ON unidades_conservacao
  FOR EACH ROW EXECUTE FUNCTION atualizar_nucleo_uc();

-- ── Backfill: UCs estaduais já existentes ───────────────────

DO $$
DECLARE
  uc       record;
  v_duc_id uuid;
  v_nuc_id uuid;
BEGIN
  SELECT id INTO v_duc_id FROM unidades_organizacionais WHERE sigla = 'DUC' LIMIT 1;
  IF v_duc_id IS NULL THEN RETURN; END IF;

  FOR uc IN
    SELECT id, codigo, nome FROM unidades_conservacao
    WHERE esfera = 'estadual' AND unidade_org_id IS NULL AND ativo = true
  LOOP
    INSERT INTO unidades_organizacionais (sigla, nome, tipo, pai_id)
    VALUES (uc.codigo, 'Núcleo ' || uc.nome, 'nucleo', v_duc_id)
    ON CONFLICT (sigla) DO UPDATE SET nome = EXCLUDED.nome
    RETURNING id INTO v_nuc_id;

    UPDATE unidades_conservacao SET unidade_org_id = v_nuc_id WHERE id = uc.id;
  END LOOP;
END;
$$;
