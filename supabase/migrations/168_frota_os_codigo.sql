-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — código sequencial da OS + código do fornecedor
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS frota_os_contador (
  ano    int PRIMARY KEY,
  ultimo int NOT NULL DEFAULT 0
);
ALTER TABLE frota_os_contador ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso só via função SECURITY DEFINER abaixo (mesmo
-- padrão de frota_push_config na migration 164).

CREATE OR REPLACE FUNCTION frota_gerar_codigo_os()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ano int;
  v_num int;
BEGIN
  IF NEW.codigo IS NOT NULL THEN RETURN NEW; END IF;
  v_ano := EXTRACT(YEAR FROM COALESCE(NEW.data_abertura, CURRENT_DATE))::int;
  INSERT INTO frota_os_contador (ano, ultimo) VALUES (v_ano, 1)
    ON CONFLICT (ano) DO UPDATE SET ultimo = frota_os_contador.ultimo + 1
    RETURNING ultimo INTO v_num;
  NEW.codigo := 'OS-' || v_ano || '-' || lpad(v_num::text, 4, '0');
  RETURN NEW;
END;
$$;

ALTER TABLE frota_ordens_servico ADD COLUMN IF NOT EXISTS codigo text;
ALTER TABLE frota_ordens_servico ADD COLUMN IF NOT EXISTS codigo_fornecedor text;

DROP TRIGGER IF EXISTS trg_frota_os_codigo ON frota_ordens_servico;
CREATE TRIGGER trg_frota_os_codigo BEFORE INSERT ON frota_ordens_servico
  FOR EACH ROW EXECUTE FUNCTION frota_gerar_codigo_os();

-- Backfill de OS já existentes sem código (ordem cronológica)
DO $$
DECLARE
  r record;
  v_num int;
  v_ano int;
BEGIN
  FOR r IN SELECT id, data_abertura FROM frota_ordens_servico WHERE codigo IS NULL ORDER BY data_abertura, criado_em LOOP
    v_ano := EXTRACT(YEAR FROM COALESCE(r.data_abertura, CURRENT_DATE))::int;
    INSERT INTO frota_os_contador (ano, ultimo) VALUES (v_ano, 1)
      ON CONFLICT (ano) DO UPDATE SET ultimo = frota_os_contador.ultimo + 1
      RETURNING ultimo INTO v_num;
    UPDATE frota_ordens_servico SET codigo = 'OS-' || v_ano || '-' || lpad(v_num::text,4,'0') WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE frota_ordens_servico ALTER COLUMN codigo SET NOT NULL;
ALTER TABLE frota_ordens_servico ADD CONSTRAINT frota_os_codigo_unique UNIQUE (codigo);

-- Recria a view para incluir codigo/codigo_fornecedor no os.* — CREATE OR
-- REPLACE não permite inserir colunas no meio da lista, então DROP+CREATE.
-- Preserva security_invoker=true (migration 165).
DROP VIEW IF EXISTS vw_frota_os_detalhe;
CREATE VIEW vw_frota_os_detalhe WITH (security_invoker = true) AS
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
