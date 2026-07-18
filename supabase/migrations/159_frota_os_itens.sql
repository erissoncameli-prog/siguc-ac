-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — itens/peças da Ordem de Serviço + custo total
-- custo (mão de obra) + soma dos itens (peças) = custo total.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_ordens_servico RENAME COLUMN custo TO custo_mao_obra;

CREATE TABLE IF NOT EXISTS frota_os_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id          uuid NOT NULL REFERENCES frota_ordens_servico(id) ON DELETE CASCADE,
  descricao      text NOT NULL,
  quantidade     numeric(10,2) NOT NULL DEFAULT 1,
  valor_unitario numeric(12,2) NOT NULL DEFAULT 0,
  subtotal       numeric(14,2) GENERATED ALWAYS AS (quantidade * valor_unitario) STORED,
  criado_em      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frota_os_itens_os ON frota_os_itens (os_id);

ALTER TABLE frota_os_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_os_itens_select ON frota_os_itens;
CREATE POLICY frota_os_itens_select ON frota_os_itens
  FOR SELECT USING (pode_ver('frota'));
DROP POLICY IF EXISTS frota_os_itens_write ON frota_os_itens;
CREATE POLICY frota_os_itens_write ON frota_os_itens
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

-- View com custo de peças agregado e total (mão de obra + peças)
CREATE OR REPLACE VIEW vw_frota_os_detalhe AS
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
