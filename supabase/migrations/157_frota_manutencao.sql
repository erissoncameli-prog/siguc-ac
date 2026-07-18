-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — Fase 3: manutenção preventiva e corretiva
-- Plano por veículo (item + intervalo por km/horas e/ou por meses,
-- o que vencer primeiro) e Ordem de Serviço. Abrir OS põe o veículo
-- em manutenção (some da agenda); concluir libera e atualiza o plano.
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_manutencao_frota') THEN
    CREATE TYPE tipo_manutencao_frota AS ENUM ('preventiva','corretiva');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_os_frota') THEN
    CREATE TYPE status_os_frota AS ENUM ('aberta','em_andamento','concluida','cancelada');
  END IF;
END $$;

-- ── Planos preventivos (por veículo) ────────────────────────
CREATE TABLE IF NOT EXISTS frota_planos_manutencao (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id           uuid NOT NULL REFERENCES frota_veiculos(id) ON DELETE CASCADE,
  item                 text NOT NULL,              -- 'Troca de óleo', 'Revisão 10.000km'...
  intervalo_km         numeric(10,1),               -- km/horas (conforme medidor do veículo)
  intervalo_meses      smallint,
  ultima_execucao_km   numeric(10,1),
  ultima_execucao_data date,
  ativo                boolean NOT NULL DEFAULT true,
  observacoes          text,
  criado_em            timestamptz DEFAULT now(),
  atualizado_em        timestamptz DEFAULT now(),
  CONSTRAINT chk_frota_plano_intervalo CHECK (intervalo_km IS NOT NULL OR intervalo_meses IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_frota_plano_veiculo ON frota_planos_manutencao (veiculo_id);

DROP TRIGGER IF EXISTS trg_frota_plano_updated ON frota_planos_manutencao;
CREATE TRIGGER trg_frota_plano_updated BEFORE UPDATE ON frota_planos_manutencao
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Ordens de Serviço ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS frota_ordens_servico (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id     uuid NOT NULL REFERENCES frota_veiculos(id),
  plano_id       uuid REFERENCES frota_planos_manutencao(id),
  tipo           tipo_manutencao_frota NOT NULL DEFAULT 'corretiva',
  descricao      text NOT NULL,
  oficina        text,
  status         status_os_frota NOT NULL DEFAULT 'aberta',
  km_veiculo     numeric(10,1),          -- hodômetro/horímetro no momento
  custo          numeric(12,2),
  data_abertura  date NOT NULL DEFAULT current_date,
  data_conclusao date,
  aberto_por     uuid REFERENCES usuarios(id),
  concluido_por  uuid REFERENCES usuarios(id),
  observacoes    text,
  criado_em      timestamptz DEFAULT now(),
  atualizado_em  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frota_os_veiculo ON frota_ordens_servico (veiculo_id);
CREATE INDEX IF NOT EXISTS idx_frota_os_status  ON frota_ordens_servico (status);

DROP TRIGGER IF EXISTS trg_frota_os_updated ON frota_ordens_servico;
CREATE TRIGGER trg_frota_os_updated BEFORE UPDATE ON frota_ordens_servico
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Abrir/reabrir OS põe o veículo em manutenção; concluir libera (se não
-- houver outra OS aberta) e atualiza o plano vinculado.
CREATE OR REPLACE FUNCTION frota_os_sync_veiculo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('aberta','em_andamento') THEN
      UPDATE frota_veiculos SET status = 'em_manutencao'
        WHERE id = NEW.veiculo_id AND status <> 'baixado';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'concluida' AND OLD.status <> 'concluida' THEN
    IF NEW.plano_id IS NOT NULL THEN
      UPDATE frota_planos_manutencao
        SET ultima_execucao_km   = COALESCE(NEW.km_veiculo, ultima_execucao_km),
            ultima_execucao_data = COALESCE(NEW.data_conclusao, current_date)
        WHERE id = NEW.plano_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM frota_ordens_servico
      WHERE veiculo_id = NEW.veiculo_id AND status IN ('aberta','em_andamento') AND id <> NEW.id
    ) THEN
      UPDATE frota_veiculos SET status = 'disponivel'
        WHERE id = NEW.veiculo_id AND status = 'em_manutencao';
    END IF;
  ELSIF NEW.status IN ('aberta','em_andamento') AND OLD.status NOT IN ('aberta','em_andamento') THEN
    UPDATE frota_veiculos SET status = 'em_manutencao'
      WHERE id = NEW.veiculo_id AND status <> 'baixado';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_frota_os_sync_insert ON frota_ordens_servico;
CREATE TRIGGER trg_frota_os_sync_insert AFTER INSERT ON frota_ordens_servico
  FOR EACH ROW EXECUTE FUNCTION frota_os_sync_veiculo();

DROP TRIGGER IF EXISTS trg_frota_os_sync_update ON frota_ordens_servico;
CREATE TRIGGER trg_frota_os_sync_update AFTER UPDATE OF status ON frota_ordens_servico
  FOR EACH ROW EXECUTE FUNCTION frota_os_sync_veiculo();

-- ── View: pendências de manutenção (o que vence primeiro) ──
CREATE OR REPLACE VIEW vw_frota_manutencoes_pendentes AS
SELECT
  p.*,
  v.placa, v.modelo, v.tipo AS veiculo_tipo, v.medidor,
  v.hodometro_km, v.horimetro_horas,
  (CASE WHEN v.medidor = 'hodometro' THEN v.hodometro_km ELSE v.horimetro_horas END) AS uso_atual,
  CASE WHEN p.intervalo_km IS NOT NULL THEN
    (COALESCE(p.ultima_execucao_km,0) + p.intervalo_km)
      - (CASE WHEN v.medidor = 'hodometro' THEN v.hodometro_km ELSE v.horimetro_horas END)
  END AS restante_uso,
  CASE WHEN p.intervalo_meses IS NOT NULL THEN
    (COALESCE(p.ultima_execucao_data, p.criado_em::date) + (p.intervalo_meses || ' months')::interval)::date
      - current_date
  END AS restante_dias
FROM frota_planos_manutencao p
JOIN frota_veiculos v ON v.id = p.veiculo_id
WHERE p.ativo AND v.ativo;

-- ── RLS (chave 'frota' — mesmo time do cadastro de veículos) ─
ALTER TABLE frota_planos_manutencao ENABLE ROW LEVEL SECURITY;
ALTER TABLE frota_ordens_servico    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_plano_select ON frota_planos_manutencao;
CREATE POLICY frota_plano_select ON frota_planos_manutencao
  FOR SELECT USING (pode_ver('frota'));
DROP POLICY IF EXISTS frota_plano_write ON frota_planos_manutencao;
CREATE POLICY frota_plano_write ON frota_planos_manutencao
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

DROP POLICY IF EXISTS frota_os_select ON frota_ordens_servico;
CREATE POLICY frota_os_select ON frota_ordens_servico
  FOR SELECT USING (pode_ver('frota'));
DROP POLICY IF EXISTS frota_os_write ON frota_ordens_servico;
CREATE POLICY frota_os_write ON frota_ordens_servico
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));
