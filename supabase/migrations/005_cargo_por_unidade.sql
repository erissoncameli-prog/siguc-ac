-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Cargo automático por unidade organizacional
-- Cada unidade gera e mantém um cargo de chefia vinculado
-- ═══════════════════════════════════════════════════════════

-- ── Helpers internos ────────────────────────────────────────

CREATE OR REPLACE FUNCTION _prefixo_cargo(p_tipo tipo_unidade_org)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tipo
    WHEN 'secretaria'   THEN 'Secretário(a) de'
    WHEN 'diretoria'    THEN 'Diretor(a) de'
    WHEN 'departamento' THEN 'Chefe do'
    WHEN 'coordenacao'  THEN 'Coordenador(a) de'
    WHEN 'divisao'      THEN 'Chefe da'
    WHEN 'nucleo'       THEN 'Gestor(a) do'
    WHEN 'setor'        THEN 'Chefe do Setor'
    ELSE 'Responsável por'
  END
$$;

CREATE OR REPLACE FUNCTION _nivel_cargo(p_tipo tipo_unidade_org)
RETURNS nivel_hierarquico LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tipo
    WHEN 'secretaria'   THEN 'secretario'::nivel_hierarquico
    WHEN 'diretoria'    THEN 'diretor'::nivel_hierarquico
    WHEN 'departamento' THEN 'chefe_deuc'::nivel_hierarquico
    WHEN 'coordenacao'  THEN 'coordenador'::nivel_hierarquico
    WHEN 'divisao'      THEN 'coordenador'::nivel_hierarquico
    WHEN 'nucleo'       THEN 'gestor_uc'::nivel_hierarquico
    WHEN 'setor'        THEN 'analista_uc'::nivel_hierarquico
    ELSE                     'analista_uc'::nivel_hierarquico
  END
$$;

-- ── Trigger: criar cargo ao inserir unidade ──────────────────

CREATE OR REPLACE FUNCTION trg_criar_cargo_unidade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO cargos (unidade_org_id, denominacao, tipo, nivel, ativo)
  VALUES (
    NEW.id,
    _prefixo_cargo(NEW.tipo) || ' ' || NEW.nome,
    'cargo_comissionado',
    _nivel_cargo(NEW.tipo),
    NEW.ativo
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_unid_criar_cargo
  AFTER INSERT ON unidades_organizacionais
  FOR EACH ROW EXECUTE FUNCTION trg_criar_cargo_unidade();

-- ── Trigger: sincronizar cargo ao atualizar unidade ──────────

CREATE OR REPLACE FUNCTION trg_sincronizar_cargo_unidade()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Nome, tipo ou vínculo pai mudou → atualiza cargo
  IF NEW.nome <> OLD.nome OR NEW.tipo <> OLD.tipo THEN
    UPDATE cargos
    SET denominacao = _prefixo_cargo(NEW.tipo) || ' ' || NEW.nome,
        nivel       = _nivel_cargo(NEW.tipo)
    WHERE unidade_org_id = NEW.id;
  END IF;

  -- Unidade desativada → desativa cargo; reativada → reativa cargo
  IF NEW.ativo <> OLD.ativo THEN
    UPDATE cargos SET ativo = NEW.ativo WHERE unidade_org_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_unid_sincronizar_cargo
  AFTER UPDATE ON unidades_organizacionais
  FOR EACH ROW EXECUTE FUNCTION trg_sincronizar_cargo_unidade();

-- ── Backfill: criar cargos para unidades sem cargo ───────────

INSERT INTO cargos (unidade_org_id, denominacao, tipo, nivel, ativo)
SELECT
  u.id,
  _prefixo_cargo(u.tipo) || ' ' || u.nome,
  'cargo_comissionado',
  _nivel_cargo(u.tipo),
  u.ativo
FROM unidades_organizacionais u
WHERE u.ativo = true
  AND NOT EXISTS (
    SELECT 1 FROM cargos c WHERE c.unidade_org_id = u.id
  );
