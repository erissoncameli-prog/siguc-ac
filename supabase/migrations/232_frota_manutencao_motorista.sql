-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — manutenção visível para o motorista (aba
-- Histórico do app)
--
-- Hoje frota_ordens_servico/frota_os_itens só liberam SELECT pra quem
-- tem pode_ver('frota') — o motorista nunca via a manutenção real do
-- veículo, só o comunicado de defeito que ele mesmo reportou
-- (frota_comunicados_manutencao, já liberado desde a 193).
--
-- Em vez de abrir RLS direto nas tabelas de custo/oficina (dado de
-- gestão), duas RPCs SECURITY DEFINER, seguindo o padrão de
-- frota_veiculos_ativos_abastecimento (184):
--
-- 1) frota_manutencoes_motorista() — lista unificada de "casos de
--    manutenção" dos veículos do motorista chamador (motorista_padrao_id
--    ∪ frota_veiculo_motoristas), juntando:
--      a) toda frota_ordens_servico do veículo (gerada pela mesa, com
--         ou sem comunicado de origem) — decisão de produto: motorista
--         vê tudo que foi feito no veículo que ele usa, não só o que
--         ele reportou;
--      b) comunicados ainda sem OS (aguardando a mesa validar).
--    SEM custo/oficina/codigo_fornecedor — decisão de produto: o
--    motorista vê o que foi feito, não quanto custou.
--
-- 2) frota_manutencao_itens(p_os_id) — peças/serviços da OS, também
--    sem valor_unitario/subtotal, só descrição/quantidade/marca.
--
-- Motorista sem nenhum veículo vinculado (padrão nem liberado) recebe
-- lista vazia — ao contrário da 184, aqui NÃO cai no fallback "mostra
-- a frota toda", pra não vazar manutenção de veículo que ele nunca
-- usou.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_manutencoes_motorista()
RETURNS TABLE (
  item_id        uuid,
  origem         text,           -- 'os' | 'comunicado'
  veiculo_id     uuid,
  placa          text,
  modelo         text,
  tipo           text,           -- 'preventiva' | 'corretiva' | 'comunicado'
  status         text,           -- 'aguardando_analise'|'aberta'|'em_andamento'|'concluida'|'cancelada'|'descartada'
  descricao      text,
  codigo         text,
  data_referencia timestamptz,   -- data de abertura da OS, ou de criação do comunicado — pra ordenar a lista
  data_conclusao date,
  os_id          uuid,
  comunicado_id  uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id uuid;
BEGIN
  SELECT fm.id INTO v_motorista_id
    FROM frota_motoristas fm WHERE fm.usuario_id = auth.uid() AND fm.ativo AND fm.status = 'ativo';
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  RETURN QUERY
  WITH veiculos_motorista AS (
    SELECT id FROM frota_veiculos WHERE motorista_padrao_id = v_motorista_id
    UNION
    SELECT veiculo_id FROM frota_veiculo_motoristas WHERE motorista_id = v_motorista_id
  )
  SELECT
    os.id, 'os', os.veiculo_id, v.placa, v.modelo,
    os.tipo::text, os.status::text, os.descricao, os.codigo,
    os.data_abertura::timestamptz, os.data_conclusao, os.id, c.id
  FROM frota_ordens_servico os
  JOIN frota_veiculos v ON v.id = os.veiculo_id
  LEFT JOIN frota_comunicados_manutencao c ON c.os_id = os.id
  WHERE os.veiculo_id IN (SELECT id FROM veiculos_motorista)

  UNION ALL

  SELECT
    c.id, 'comunicado', c.veiculo_id, v.placa, v.modelo,
    'comunicado', CASE WHEN c.status = 'descartado' THEN 'descartada' ELSE 'aguardando_analise' END,
    c.descricao, NULL,
    c.criado_em, NULL, NULL, c.id
  FROM frota_comunicados_manutencao c
  JOIN frota_veiculos v ON v.id = c.veiculo_id
  WHERE c.veiculo_id IN (SELECT id FROM veiculos_motorista)
    AND c.os_id IS NULL

  ORDER BY 11 DESC NULLS LAST, 10 DESC;
END;
$$;

REVOKE ALL ON FUNCTION frota_manutencoes_motorista() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_manutencoes_motorista() TO authenticated;

-- ── Itens/peças de uma OS, sem valor (o motorista vê o que foi
-- trocado, não quanto custou) — checa que a OS pertence a um veículo
-- do motorista chamador antes de devolver qualquer linha.
CREATE OR REPLACE FUNCTION frota_manutencao_itens(p_os_id uuid)
RETURNS TABLE (descricao text, quantidade numeric, marca text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id uuid;
BEGIN
  SELECT fm.id INTO v_motorista_id
    FROM frota_motoristas fm WHERE fm.usuario_id = auth.uid() AND fm.ativo AND fm.status = 'ativo';
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM frota_ordens_servico os
    WHERE os.id = p_os_id
      AND os.veiculo_id IN (
        SELECT id FROM frota_veiculos WHERE motorista_padrao_id = v_motorista_id
        UNION
        SELECT veiculo_id FROM frota_veiculo_motoristas WHERE motorista_id = v_motorista_id
      )
  ) THEN
    RAISE EXCEPTION 'Ordem de serviço não encontrada';
  END IF;

  RETURN QUERY
  SELECT i.descricao, i.quantidade, i.marca
  FROM frota_os_itens i
  WHERE i.os_id = p_os_id
  ORDER BY i.criado_em;
END;
$$;

REVOKE ALL ON FUNCTION frota_manutencao_itens(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_manutencao_itens(uuid) TO authenticated;
