-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — veículo em manutenção não pode ser alocado
-- frota_aprovar_viagem só bloqueava 'baixado'; agora exige
-- status='disponivel' explicitamente (em_manutencao/cedido/em_viagem
-- ficam de fora). frota_checkout_viagem passa a reconferir o status
-- no momento do check-out, para o caso de o veículo ter entrado em
-- manutenção depois de aprovado mas antes de sair.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_aprovar_viagem(p_viagem_id uuid, p_veiculo_id uuid, p_motorista_id uuid)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem frota_viagens;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar viagens';
  END IF;

  IF NOT frota_motorista_apto(p_motorista_id) THEN
    RAISE EXCEPTION 'Motorista inapto: habilitação vencida ou inativo';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM frota_veiculos WHERE id = p_veiculo_id AND ativo AND status = 'disponivel') THEN
    RAISE EXCEPTION 'Veículo indisponível (em viagem, manutenção, cedido ou baixado)';
  END IF;

  BEGIN
    UPDATE frota_viagens
      SET status = 'aprovada', veiculo_id = p_veiculo_id, motorista_id = p_motorista_id,
          aprovado_por = auth.uid(), aprovado_em = now()
      WHERE id = p_viagem_id AND status = 'solicitada'
      RETURNING * INTO v_viagem;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Veículo ou motorista já alocado em outra viagem neste período';
  END;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou já processada';
  END IF;
  RETURN v_viagem;
END;
$$;

CREATE OR REPLACE FUNCTION frota_checkout_viagem(p_viagem_id uuid, p_medida numeric, p_combustivel_pct smallint)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem  frota_viagens;
  v_medidor medidor_uso_frota;
  v_status  status_veiculo_frota;
BEGIN
  IF NOT frota_pode_operar_viagem(p_viagem_id) THEN
    RAISE EXCEPTION 'Sem permissão para iniciar esta viagem';
  END IF;

  SELECT v.medidor, v.status INTO v_medidor, v_status FROM frota_veiculos v
    JOIN frota_viagens fv ON fv.veiculo_id = v.id WHERE fv.id = p_viagem_id;

  IF v_status <> 'disponivel' THEN
    RAISE EXCEPTION 'Veículo indisponível para iniciar viagem (status atual: %)', v_status;
  END IF;

  UPDATE frota_viagens
    SET status = 'em_andamento', checkout_em = now(),
        km_saida   = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
        horas_saida = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
        combustivel_saida_pct = p_combustivel_pct
    WHERE id = p_viagem_id AND status = 'aprovada'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou não está aprovada';
  END IF;

  UPDATE frota_veiculos SET status = 'em_viagem' WHERE id = v_viagem.veiculo_id;
  RETURN v_viagem;
END;
$$;
