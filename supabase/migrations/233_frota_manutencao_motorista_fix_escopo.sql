-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — corrige escopo de veículos em
-- frota_manutencoes_motorista() (232)
--
-- Bug encontrado em produção: motorista reportou defeito (comunicado)
-- de um veículo que NÃO é seu motorista_padrao_id nem está em
-- frota_veiculo_motoristas (ele só estava USANDO o veículo numa
-- viagem pontual). A mesa validou e virou OS ("Trocar pneus"), mas a
-- OS sumiu da lista dele — a 232 só olhava padrão∪liberado, que é o
-- escopo certo pra "que veículo posso abastecer agora" (184) mas
-- estreito demais pra "manutenção do que eu já usei/reportei".
--
-- Escopo agora soma 4 fontes: motorista_padrao_id, frota_veiculo_
-- motoristas, veículos de qualquer viagem que ele já dirigiu
-- (frota_viagens.motorista_id) e veículos de qualquer comunicado que
-- ele mesmo reportou (frota_comunicados_manutencao.motorista_id) —
-- essa última cobre o caso que quebrou: mesmo que o veículo saia do
-- escopo de vínculo formal depois, o comunicado que ele abriu (e a OS
-- que nasceu dele) continuam visíveis pra ele.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_manutencoes_motorista()
RETURNS TABLE (
  item_id        uuid,
  origem         text,
  veiculo_id     uuid,
  placa          text,
  modelo         text,
  tipo           text,
  status         text,
  descricao      text,
  codigo         text,
  data_referencia timestamptz,
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
    UNION
    SELECT veiculo_id FROM frota_viagens WHERE motorista_id = v_motorista_id AND veiculo_id IS NOT NULL
    UNION
    SELECT veiculo_id FROM frota_comunicados_manutencao WHERE motorista_id = v_motorista_id
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

-- Assinatura não muda, mas GRANT/REVOKE já estavam corretos na 232 —
-- CREATE OR REPLACE preserva. Sem alteração em frota_manutencao_itens
-- (233 não mexe nela).
