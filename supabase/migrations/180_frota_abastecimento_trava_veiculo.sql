-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — trava de veículo no abastecimento (defesa em
-- 2 camadas). O app já trava o seletor de veículo quando detecta que
-- o motorista tem uma viagem em andamento (ver frota-app.html,
-- fmVeiculoAtivoDoMotorista); esta migration adiciona a mesma trava
-- no servidor, para que nem cache desatualizado nem qualquer chamada
-- fora do fluxo normal da tela consigam gravar um abastecimento com
-- veículo diferente do que o motorista está de fato usando.
-- Mesma assinatura de parâmetros da 176 — CREATE OR REPLACE é seguro
-- aqui (só muda o corpo, não a lista de parâmetros).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_registrar_abastecimento(
  p_veiculo_id uuid,
  p_medida numeric,
  p_litros numeric,
  p_preco_litro numeric,
  p_valor_total numeric,
  p_tanque_cheio boolean,
  p_viagem_id uuid DEFAULT NULL,
  p_posto_nome text DEFAULT NULL,
  p_foto_cupom_url text DEFAULT NULL,
  p_foto_hodometro_url text DEFAULT NULL,
  p_observacoes text DEFAULT NULL,
  p_uuid_cliente uuid DEFAULT NULL,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL
)
RETURNS frota_abastecimentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id  uuid;
  v_medidor       medidor_uso_frota;
  v_abast         frota_abastecimentos;
  v_veiculo_ativo uuid;
BEGIN
  IF p_uuid_cliente IS NOT NULL THEN
    SELECT * INTO v_abast FROM frota_abastecimentos
      WHERE uuid_cliente = p_uuid_cliente
        AND motorista_id IN (SELECT id FROM frota_motoristas WHERE usuario_id = auth.uid());
    IF FOUND THEN
      RETURN v_abast;
    END IF;
  END IF;

  SELECT id INTO v_motorista_id
    FROM frota_motoristas WHERE usuario_id = auth.uid() AND ativo AND status = 'ativo';
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  -- Trava de veículo: se o motorista tem uma viagem em andamento, o
  -- abastecimento só pode ser gravado no veículo dessa viagem — evita
  -- lançar litros/valor no veículo errado por seleção equivocada na
  -- tela (cache desatualizada, mais de uma aba aberta, etc.).
  SELECT veiculo_id INTO v_veiculo_ativo
    FROM frota_viagens
    WHERE motorista_id = v_motorista_id AND status = 'em_andamento'
    ORDER BY checkout_em DESC NULLS LAST
    LIMIT 1;
  IF v_veiculo_ativo IS NOT NULL AND v_veiculo_ativo <> p_veiculo_id THEN
    RAISE EXCEPTION 'Você está com uma viagem em andamento em outro veículo — o abastecimento tem que ser registrado nele';
  END IF;

  SELECT medidor INTO v_medidor FROM frota_veiculos WHERE id = p_veiculo_id;
  IF v_medidor IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado';
  END IF;
  IF p_medida IS NULL OR p_medida < 0 THEN
    RAISE EXCEPTION 'Medida do % inválida', v_medidor;
  END IF;

  IF p_litros <= 0 OR p_valor_total <= 0 THEN
    RAISE EXCEPTION 'Litros e valor total devem ser maiores que zero';
  END IF;

  BEGIN
    INSERT INTO frota_abastecimentos (
      veiculo_id, motorista_id, viagem_id, data_hora,
      medida_no_abastecimento, litros, preco_litro, valor_total, tanque_cheio,
      posto_nome, foto_cupom_url, foto_hodometro_url, observacoes_motorista,
      status, uuid_cliente, localizacao
    ) VALUES (
      p_veiculo_id, v_motorista_id, p_viagem_id, now(),
      p_medida, p_litros, p_preco_litro, p_valor_total, COALESCE(p_tanque_cheio, true),
      p_posto_nome, p_foto_cupom_url, p_foto_hodometro_url, p_observacoes,
      'pendente', p_uuid_cliente,
      CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END
    ) RETURNING * INTO v_abast;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_abast FROM frota_abastecimentos WHERE uuid_cliente = p_uuid_cliente;
    IF FOUND THEN
      RETURN v_abast;
    END IF;
    RAISE;
  END;

  RETURN v_abast;
END;
$$;
