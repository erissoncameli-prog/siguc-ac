-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — marca do item da OS (texto livre, sem vínculo)
-- + registro manual de multas (consulta assistida ao Detran-AC)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_os_itens ADD COLUMN IF NOT EXISTS marca text;

-- Recria a view preservando security_invoker=true (migration 165)
CREATE OR REPLACE VIEW vw_frota_os_detalhe WITH (security_invoker = true) AS
SELECT
  os.*,
  COALESCE(i.total_pecas, 0)                     AS custo_pecas,
  COALESCE(os.custo_mao_obra, 0) + COALESCE(i.total_pecas, 0) AS custo_total,
  v.placa, v.modelo
FROM frota_ordens_servico os
LEFT JOIN (
  SELECT os_id, SUM(subtotal) AS total_pecas FROM frota_os_itens GROUP BY os_id
) i ON i.os_id = os.id
LEFT JOIN frota_veiculos v ON v.id = os.veiculo_id;

-- ── Multas (registro manual — consulta assistida ao Detran-AC) ─
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_multa_frota') THEN
    CREATE TYPE status_multa_frota AS ENUM ('pendente','paga','recorrida','cancelada');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS frota_multas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id     uuid NOT NULL REFERENCES frota_veiculos(id) ON DELETE CASCADE,
  data_infracao  date NOT NULL,
  descricao      text NOT NULL,
  orgao_autuador text,
  valor          numeric(12,2),
  pontos         smallint,
  status         status_multa_frota NOT NULL DEFAULT 'pendente',
  vencimento     date,
  observacoes    text,
  registrado_por uuid REFERENCES usuarios(id),
  criado_em      timestamptz DEFAULT now(),
  atualizado_em  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frota_multas_veiculo ON frota_multas (veiculo_id);

ALTER TABLE frota_multas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_multas_select ON frota_multas;
CREATE POLICY frota_multas_select ON frota_multas
  FOR SELECT USING (pode_ver('frota'));
DROP POLICY IF EXISTS frota_multas_write ON frota_multas;
CREATE POLICY frota_multas_write ON frota_multas
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

DROP TRIGGER IF EXISTS trg_frota_multas_updated ON frota_multas;
CREATE TRIGGER trg_frota_multas_updated BEFORE UPDATE ON frota_multas
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();
