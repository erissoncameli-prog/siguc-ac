-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — inspeção acoplada ao check-out/check-in
-- (Fase 5 do plano em docs/frota-analise-e-plano.md)
--
-- Ver a decisão de projeto no cabeçalho da 203: a inspeção NÃO é uma
-- chamada separada. Ela entra como parâmetro opcional do check-out e
-- do check-in para que, no app offline-first, viagem e checklist
-- sejam UM item de fila e UMA transação — ou grava os dois, ou não
-- grava nenhum. Duas chamadas separadas criariam dependência de ordem
-- na fila, que não é garantida depois de um erro isolado.
--
-- p_inspecao: { "itens": [...], "observacoes": "..." }
--   itens: [{item_id, item_nome, ordem, conforme, critico, observacao, foto_url}]
-- NULL ou ausente = sem checklist (viagens antigas e clientes que
-- ainda não atualizaram seguem funcionando exatamente como antes).
--
-- A inspeção é gravada DEPOIS do UPDATE da viagem, de propósito: se o
-- check-out for recusado (status errado, medidor menor que o último),
-- a transação inteira volta atrás e não sobra inspeção órfã.
--
-- DROP antes de CREATE (lição da 178 — a lista de parâmetros muda) e
-- reaplicação dos REVOKE/GRANT das 196/197, que o DROP zera. O corpo
-- parte do que está em produção HOJE (198 + 201), não do original —
-- lição da 181.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS frota_checkout_viagem(uuid, numeric, smallint, numeric, numeric, uuid);

CREATE FUNCTION frota_checkout_viagem(
  p_viagem_id uuid,
  p_medida numeric,
  p_combustivel_pct smallint,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_uuid_cliente uuid DEFAULT NULL,
  p_inspecao jsonb DEFAULT NULL
)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem  frota_viagens;
  v_medidor medidor_uso_frota;
  v_ultima  numeric;
BEGIN
  IF NOT frota_pode_operar_viagem(p_viagem_id) THEN
    RAISE EXCEPTION 'Sem permissão para iniciar esta viagem';
  END IF;

  IF p_uuid_cliente IS NOT NULL THEN
    SELECT * INTO v_viagem FROM frota_viagens
      WHERE id = p_viagem_id AND checkout_uuid_cliente = p_uuid_cliente;
    IF FOUND THEN
      RETURN v_viagem;
    END IF;
  END IF;

  SELECT v.medidor, CASE WHEN v.medidor = 'hodometro' THEN v.hodometro_km ELSE v.horimetro_horas END
    INTO v_medidor, v_ultima
    FROM frota_veiculos v JOIN frota_viagens fv ON fv.veiculo_id = v.id WHERE fv.id = p_viagem_id;

  IF p_medida < v_ultima THEN
    RAISE EXCEPTION 'Leitura informada (%) é menor que a última registrada para este veículo (%). Confira o % antes de continuar.',
      p_medida, v_ultima, CASE WHEN v_medidor = 'hodometro' THEN 'hodômetro' ELSE 'horímetro' END;
  END IF;

  UPDATE frota_viagens
    SET status = 'em_andamento', checkout_em = now(),
        km_saida   = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
        horas_saida = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
        combustivel_saida_pct = p_combustivel_pct,
        localizacao_saida = CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END,
        checkout_uuid_cliente = COALESCE(p_uuid_cliente, checkout_uuid_cliente)
    WHERE id = p_viagem_id AND status = 'aprovada'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou não está aprovada';
  END IF;

  UPDATE frota_veiculos
    SET status = 'em_viagem',
        hodometro_km    = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE horimetro_horas END
    WHERE id = v_viagem.veiculo_id;

  -- Checklist de saída, na mesma transação (migration 203).
  IF p_inspecao IS NOT NULL THEN
    PERFORM frota_registrar_inspecao(
      p_viagem_id, 'saida'::momento_inspecao_frota,
      p_inspecao->'itens', p_inspecao->>'observacoes');
  END IF;

  IF v_viagem.solicitante_id IS NOT NULL THEN
    PERFORM frota_notificar(v_viagem.solicitante_id, 'Sua viagem começou',
      format('Destino: %s.', v_viagem.destino),
      jsonb_build_object('modulo','frota','subtipo','viagem_iniciada','viagem_id',v_viagem.id,'para','solicitante'));
  END IF;

  RETURN v_viagem;
END;
$$;


DROP FUNCTION IF EXISTS frota_checkin_viagem(uuid, numeric, smallint, text, text, numeric, numeric, uuid);

CREATE FUNCTION frota_checkin_viagem(
  p_viagem_id uuid,
  p_medida numeric,
  p_combustivel_pct smallint,
  p_observacoes text,
  p_avarias text,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_uuid_cliente uuid DEFAULT NULL,
  p_inspecao jsonb DEFAULT NULL
)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem            frota_viagens;
  v_medidor           medidor_uso_frota;
  v_motorista_usuario uuid;
  v_saida             numeric;
BEGIN
  IF NOT frota_pode_operar_viagem(p_viagem_id) THEN
    RAISE EXCEPTION 'Sem permissão para concluir esta viagem';
  END IF;

  IF p_uuid_cliente IS NOT NULL THEN
    SELECT * INTO v_viagem FROM frota_viagens
      WHERE id = p_viagem_id AND checkin_uuid_cliente = p_uuid_cliente;
    IF FOUND THEN
      RETURN v_viagem;
    END IF;
  END IF;

  SELECT v.medidor, CASE WHEN v.medidor = 'hodometro' THEN fv.km_saida ELSE fv.horas_saida END
    INTO v_medidor, v_saida
    FROM frota_veiculos v JOIN frota_viagens fv ON fv.veiculo_id = v.id WHERE fv.id = p_viagem_id;

  IF v_saida IS NOT NULL AND p_medida < v_saida THEN
    RAISE EXCEPTION 'Leitura na chegada (%) é menor que a leitura na saída desta viagem (%). Confira o % antes de continuar.',
      p_medida, v_saida, CASE WHEN v_medidor = 'hodometro' THEN 'hodômetro' ELSE 'horímetro' END;
  END IF;

  UPDATE frota_viagens
    SET status = 'concluida', checkin_em = now(),
        km_chegada    = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
        horas_chegada = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
        combustivel_chegada_pct = p_combustivel_pct,
        observacoes_checkin = p_observacoes,
        avarias = NULLIF(p_avarias, ''),
        localizacao_chegada = CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END,
        checkin_uuid_cliente = COALESCE(p_uuid_cliente, checkin_uuid_cliente)
    WHERE id = p_viagem_id AND status = 'em_andamento'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou não está em andamento';
  END IF;

  -- Cast explícito preservado (regressão corrigida pela 181).
  UPDATE frota_veiculos
    SET status = (CASE WHEN v_viagem.avarias IS NOT NULL THEN 'em_manutencao' ELSE 'disponivel' END)::status_veiculo_frota,
        hodometro_km    = CASE WHEN v_medidor = 'hodometro' AND p_medida > hodometro_km THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' AND p_medida > horimetro_horas THEN p_medida ELSE horimetro_horas END
    WHERE id = v_viagem.veiculo_id;

  -- Checklist de chegada, na mesma transação (migration 203).
  IF p_inspecao IS NOT NULL THEN
    PERFORM frota_registrar_inspecao(
      p_viagem_id, 'chegada'::momento_inspecao_frota,
      p_inspecao->'itens', p_inspecao->>'observacoes');
  END IF;

  SELECT usuario_id INTO v_motorista_usuario FROM frota_motoristas WHERE id = v_viagem.motorista_id;
  PERFORM frota_checar_manutencao_veiculo(v_viagem.veiculo_id, v_motorista_usuario);

  IF v_viagem.solicitante_id IS NOT NULL THEN
    PERFORM frota_notificar(v_viagem.solicitante_id, 'Sua viagem foi concluída',
      format('Destino: %s.', v_viagem.destino),
      jsonb_build_object('modulo','frota','subtipo','viagem_concluida','viagem_id',v_viagem.id,'para','solicitante'));
  END IF;

  RETURN v_viagem;
END;
$$;


REVOKE EXECUTE ON FUNCTION frota_checkout_viagem(uuid, numeric, smallint, numeric, numeric, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_checkout_viagem(uuid, numeric, smallint, numeric, numeric, uuid, jsonb)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION frota_checkin_viagem(uuid, numeric, smallint, text, text, numeric, numeric, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_checkin_viagem(uuid, numeric, smallint, text, text, numeric, numeric, uuid, jsonb)
  TO authenticated, service_role;
