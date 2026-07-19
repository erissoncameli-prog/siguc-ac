-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — abastecimento (1/3): fontes de recurso e
-- contratos de combustível. Cadastro de mesa (só quem edita
-- 'frota'); usados pela gestão para classificar o abastecimento
-- registrado pelo motorista na validação (ver migration 175).
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fonte_recurso_frota') THEN
    CREATE TYPE fonte_recurso_frota AS ENUM ('orcamentaria','nao_orcamentaria');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS frota_fontes_recurso (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          fonte_recurso_frota NOT NULL,
  codigo        text NOT NULL,
  descricao     text NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  CONSTRAINT uq_frota_fonte_codigo UNIQUE (codigo)
);

DROP TRIGGER IF EXISTS trg_frota_fonte_updated ON frota_fontes_recurso;
CREATE TRIGGER trg_frota_fonte_updated BEFORE UPDATE ON frota_fontes_recurso
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE frota_fontes_recurso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_fontes_select ON frota_fontes_recurso;
CREATE POLICY frota_fontes_select ON frota_fontes_recurso
  FOR SELECT USING (pode_ver('frota'));

DROP POLICY IF EXISTS frota_fontes_all ON frota_fontes_recurso;
CREATE POLICY frota_fontes_all ON frota_fontes_recurso
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

CREATE TABLE IF NOT EXISTS frota_contratos_combustivel (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           text NOT NULL,
  fornecedor       text NOT NULL,
  fonte_recurso_id uuid NOT NULL REFERENCES frota_fontes_recurso(id),
  vigencia_inicio  date NOT NULL,
  vigencia_fim     date NOT NULL,
  valor_global     numeric(14,2), -- só referência (sem controle de saldo na v1)
  ativo            boolean NOT NULL DEFAULT true,
  observacoes      text,
  criado_em        timestamptz DEFAULT now(),
  atualizado_em    timestamptz DEFAULT now(),
  CONSTRAINT uq_frota_contrato_numero UNIQUE (numero),
  CONSTRAINT chk_frota_contrato_vigencia CHECK (vigencia_fim >= vigencia_inicio)
);

CREATE INDEX IF NOT EXISTS idx_frota_contrato_fonte ON frota_contratos_combustivel (fonte_recurso_id);

DROP TRIGGER IF EXISTS trg_frota_contrato_updated ON frota_contratos_combustivel;
CREATE TRIGGER trg_frota_contrato_updated BEFORE UPDATE ON frota_contratos_combustivel
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE frota_contratos_combustivel ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_contratos_select ON frota_contratos_combustivel;
CREATE POLICY frota_contratos_select ON frota_contratos_combustivel
  FOR SELECT USING (pode_ver('frota'));

DROP POLICY IF EXISTS frota_contratos_all ON frota_contratos_combustivel;
CREATE POLICY frota_contratos_all ON frota_contratos_combustivel
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));
