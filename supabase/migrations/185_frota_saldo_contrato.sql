-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — abastecimento (3/3): saldo do contrato.
-- valor_global deixa de ser só referência: quando informado,
-- saldo_atual é debitado automaticamente a cada abastecimento
-- validado (e recomposto se rejeitado/reclassificado/editado/
-- excluído). Contratos sem valor_global continuam sem controle
-- de saldo (saldo_atual permanece null).
-- Também expõe o combustível do veículo na view de detalhe, para
-- a mesa poder separar os totais por tipo de combustível em vez
-- de somar tudo junto.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_contratos_combustivel
  ADD COLUMN IF NOT EXISTS saldo_atual numeric(14,2);

-- Inicializa/realinha saldo_atual quando valor_global é definido
-- (só no cadastro ou quando ainda não havia valor_global antes —
-- não reseta saldo já em consumo por uma edição posterior do
-- valor_global; ajuste de saldo por aditivo é feito manualmente).
CREATE OR REPLACE FUNCTION frota_inicializar_saldo_contrato()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.valor_global IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.valor_global IS NULL) THEN
    NEW.saldo_atual := NEW.valor_global;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frota_contrato_saldo_init ON frota_contratos_combustivel;
CREATE TRIGGER trg_frota_contrato_saldo_init
  BEFORE INSERT OR UPDATE ON frota_contratos_combustivel
  FOR EACH ROW EXECUTE FUNCTION frota_inicializar_saldo_contrato();

-- Mantém o saldo do contrato sincronizado com os abastecimentos
-- validados, para qualquer caminho de escrita (RPC de validação,
-- correção manual pela mesa, rejeição após validado, exclusão).
CREATE OR REPLACE FUNCTION frota_ajustar_saldo_contrato()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old_valor numeric;
  v_new_valor numeric;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'validado' AND OLD.contrato_id IS NOT NULL THEN
    v_old_valor := COALESCE(OLD.valor_ajustado, OLD.valor_total);
    UPDATE frota_contratos_combustivel
      SET saldo_atual = saldo_atual + v_old_valor
      WHERE id = OLD.contrato_id AND saldo_atual IS NOT NULL;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status = 'validado' AND NEW.contrato_id IS NOT NULL THEN
    v_new_valor := COALESCE(NEW.valor_ajustado, NEW.valor_total);
    UPDATE frota_contratos_combustivel
      SET saldo_atual = saldo_atual - v_new_valor
      WHERE id = NEW.contrato_id AND saldo_atual IS NOT NULL;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_frota_abast_saldo ON frota_abastecimentos;
CREATE TRIGGER trg_frota_abast_saldo
  AFTER INSERT OR UPDATE OR DELETE ON frota_abastecimentos
  FOR EACH ROW EXECUTE FUNCTION frota_ajustar_saldo_contrato();

-- ── View detalhada: adiciona combustível do veículo ────────────
-- (DROP + CREATE porque CREATE OR REPLACE não permite inserir
-- coluna no meio da lista de saída de uma view existente).
DROP VIEW IF EXISTS vw_frota_abastecimentos_detalhe;

CREATE VIEW vw_frota_abastecimentos_detalhe WITH (security_invoker = true) AS
SELECT
  a.*,
  v.placa, v.modelo, v.medidor,
  fm.nome AS motorista_nome,
  c.numero AS contrato_numero, c.fornecedor AS contrato_fornecedor,
  fr.tipo AS fonte_tipo, fr.codigo AS fonte_codigo, fr.descricao AS fonte_descricao,
  COALESCE(a.litros_ajustado, a.litros) AS litros_final,
  COALESCE(a.valor_ajustado, a.valor_total) AS valor_final,
  v.combustivel
FROM frota_abastecimentos a
JOIN frota_veiculos v ON v.id = a.veiculo_id
JOIN frota_motoristas fm ON fm.id = a.motorista_id
LEFT JOIN frota_contratos_combustivel c ON c.id = a.contrato_id
LEFT JOIN frota_fontes_recurso fr ON fr.id = c.fonte_recurso_id;
