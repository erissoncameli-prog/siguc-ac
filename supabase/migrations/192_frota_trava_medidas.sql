-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — trava de medidor (hodômetro/horímetro) e janela
-- mínima entre abastecimentos
--
-- Problema: nenhuma das 4 RPCs que recebem leitura de medidor
-- (checkout, checkin, viagem direta, abastecimento) validava a
-- medida contra a última leitura conhecida do veículo — dava pra
-- registrar hodômetro/horímetro menor que o já gravado por erro de
-- digitação. Além disso frota_veiculos.hodometro_km/horimetro_horas
-- só era atualizado no check-in, então nem servia de referência
-- confiável entre viagens e abastecimentos.
--
-- Também não havia trava de tempo entre abastecimentos do mesmo
-- veículo, e o abastecimento não guardava a hora real do evento —
-- data_hora vinha de now() no INSERT, então um registro feito offline
-- e sincronizado horas depois aparecia com o horário da sincronização,
-- não do abastecimento em si.
--
-- Esta migration:
-- 1) trava dura (RAISE EXCEPTION) nas 4 RPCs: medida não pode ser
--    menor que a última leitura conhecida (checkout/direta/
--    abastecimento comparam com frota_veiculos; checkin compara com
--    a saída da própria viagem, mais rígido);
-- 2) as 4 RPCs passam a atualizar frota_veiculos.hodometro_km/
--    horimetro_horas (antes só o checkin fazia isso), mantendo a
--    referência sempre atual;
-- 3) frota_registrar_abastecimento ganha p_data_hora (hora real do
--    evento, capturada no app — DEFAULT NULL cai pra now(), payloads
--    antigos continuam funcionando);
-- 4) trava de 120 minutos entre abastecimentos do mesmo veículo,
--    usando essa hora real (abastecimentos rejeitados não contam).
-- ═══════════════════════════════════════════════════════════

-- 1) Checkout (saída) ────────────────────────────────────────
-- Mesma assinatura da 176 — CREATE OR REPLACE é seguro.
CREATE OR REPLACE FUNCTION frota_checkout_viagem(
  p_viagem_id uuid, p_medida numeric, p_combustivel_pct smallint,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL
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
          THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END
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

  RETURN v_viagem;
END;
$$;

-- 2) Checkin (chegada) ───────────────────────────────────────
-- Mesma assinatura da 181 — mantém o cast ::status_veiculo_frota e a
-- chamada a frota_checar_manutencao_veiculo que a 181 já corrigiu.
CREATE OR REPLACE FUNCTION frota_checkin_viagem(
  p_viagem_id uuid, p_medida numeric, p_combustivel_pct smallint,
  p_observacoes text, p_avarias text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL
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
          THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END
    WHERE id = p_viagem_id AND status = 'em_andamento'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou não está em andamento';
  END IF;

  UPDATE frota_veiculos
    SET status = (CASE WHEN v_viagem.avarias IS NOT NULL THEN 'em_manutencao' ELSE 'disponivel' END)::status_veiculo_frota,
        hodometro_km    = CASE WHEN v_medidor = 'hodometro' AND p_medida > hodometro_km THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' AND p_medida > horimetro_horas THEN p_medida ELSE horimetro_horas END
    WHERE id = v_viagem.veiculo_id;

  SELECT usuario_id INTO v_motorista_usuario FROM frota_motoristas WHERE id = v_viagem.motorista_id;
  PERFORM frota_checar_manutencao_veiculo(v_viagem.veiculo_id, v_motorista_usuario);

  RETURN v_viagem;
END;
$$;

-- 3) Viagem direta (autosserviço) ────────────────────────────
-- Mesma assinatura da 186 — mantém a trava de veículo dedicado.
CREATE OR REPLACE FUNCTION frota_abrir_viagem_direta(
  p_veiculo_id uuid, p_destino text, p_finalidade text,
  p_medida numeric, p_combustivel_pct smallint, p_uuid_cliente uuid DEFAULT NULL,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL
)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id   uuid;
  v_motorista_nome text;
  v_medidor        medidor_uso_frota;
  v_status         status_veiculo_frota;
  v_dedicado       boolean;
  v_ultima         numeric;
  v_viagem         frota_viagens;
  v_saida          timestamptz := now();
  r                record;
BEGIN
  IF p_uuid_cliente IS NOT NULL THEN
    SELECT * INTO v_viagem FROM frota_viagens
      WHERE uuid_cliente = p_uuid_cliente AND solicitante_id = auth.uid();
    IF FOUND THEN
      RETURN v_viagem;
    END IF;
  END IF;

  SELECT id, nome INTO v_motorista_id, v_motorista_nome
    FROM frota_motoristas WHERE usuario_id = auth.uid() AND ativo AND status = 'ativo';
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;
  IF NOT frota_motorista_apto(v_motorista_id) THEN
    RAISE EXCEPTION 'Motorista inapto: habilitação vencida';
  END IF;

  SELECT medidor, status, dedicado_setor, CASE WHEN medidor = 'hodometro' THEN hodometro_km ELSE horimetro_horas END
    INTO v_medidor, v_status, v_dedicado, v_ultima
    FROM frota_veiculos WHERE id = p_veiculo_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado';
  END IF;
  IF v_status <> 'disponivel' THEN
    RAISE EXCEPTION 'Veículo indisponível (status atual: %)', v_status;
  END IF;
  IF v_dedicado THEN
    RAISE EXCEPTION 'Veículo dedicado ao setor não pode ser aberto em viagem direta — requer liberação da gestão de frota';
  END IF;
  IF p_medida < v_ultima THEN
    RAISE EXCEPTION 'Leitura informada (%) é menor que a última registrada para este veículo (%). Confira o % antes de continuar.',
      p_medida, v_ultima, CASE WHEN v_medidor = 'hodometro' THEN 'hodômetro' ELSE 'horímetro' END;
  END IF;

  BEGIN
    INSERT INTO frota_viagens (
      solicitante_id, destino, finalidade, data_saida_prevista, data_retorno_prevista,
      status, veiculo_id, motorista_id, aprovado_por, aprovado_em,
      km_saida, horas_saida, combustivel_saida_pct, checkout_em, aberta_direto, uuid_cliente,
      localizacao_saida
    ) VALUES (
      auth.uid(), p_destino, p_finalidade, v_saida, v_saida + interval '1 hour',
      'em_andamento', p_veiculo_id, v_motorista_id, auth.uid(), now(),
      CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
      CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
      p_combustivel_pct, now(), true, p_uuid_cliente,
      CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END
    ) RETURNING * INTO v_viagem;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_viagem FROM frota_viagens
        WHERE uuid_cliente = p_uuid_cliente AND solicitante_id = auth.uid();
      IF FOUND THEN
        RETURN v_viagem;
      END IF;
      RAISE;
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'Você já tem uma viagem aprovada ou em andamento neste período';
  END;

  UPDATE frota_veiculos
    SET status = 'em_viagem',
        hodometro_km    = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE horimetro_horas END
    WHERE id = p_veiculo_id;

  FOR r IN SELECT id FROM usuarios WHERE ativo AND nivel_efetivo(id, 'frota') = 'editar' LOOP
    PERFORM frota_notificar(
      r.id,
      'Viagem aberta sem agendamento',
      format('%s abriu uma viagem direta para %s.', v_motorista_nome, p_destino),
      jsonb_build_object('modulo','frota','subtipo','viagem_direta','viagem_id',v_viagem.id,'para','chefe')
    );
  END LOOP;

  RETURN v_viagem;
END;
$$;

-- 4) Abastecimento ───────────────────────────────────────────
-- Ganha p_data_hora (parâmetro novo) — precisa do DROP explícito da
-- assinatura antiga da 176/180, senão CREATE OR REPLACE cria um
-- overload ambíguo em vez de substituir (mesmo cuidado da 173/176).
DROP FUNCTION IF EXISTS frota_registrar_abastecimento(uuid, numeric, numeric, numeric, numeric, boolean, uuid, text, text, text, text, uuid, numeric, numeric);
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
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL,
  p_data_hora timestamptz DEFAULT NULL
)
RETURNS frota_abastecimentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id  uuid;
  v_medidor       medidor_uso_frota;
  v_ultima        numeric;
  v_abast         frota_abastecimentos;
  v_veiculo_ativo uuid;
  v_data_hora     timestamptz := COALESCE(p_data_hora, now());
  v_ultimo_abast  timestamptz;
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

  -- Trava de veículo (migration 180): abastecimento tem que ser no
  -- veículo da viagem em andamento, quando houver.
  SELECT veiculo_id INTO v_veiculo_ativo
    FROM frota_viagens
    WHERE motorista_id = v_motorista_id AND status = 'em_andamento'
    ORDER BY checkout_em DESC NULLS LAST
    LIMIT 1;
  IF v_veiculo_ativo IS NOT NULL AND v_veiculo_ativo <> p_veiculo_id THEN
    RAISE EXCEPTION 'Você está com uma viagem em andamento em outro veículo — o abastecimento tem que ser registrado nele';
  END IF;

  SELECT medidor, CASE WHEN medidor = 'hodometro' THEN hodometro_km ELSE horimetro_horas END
    INTO v_medidor, v_ultima
    FROM frota_veiculos WHERE id = p_veiculo_id;
  IF v_medidor IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado';
  END IF;
  IF p_medida IS NULL OR p_medida < 0 THEN
    RAISE EXCEPTION 'Medida do % inválida', v_medidor;
  END IF;
  IF p_medida < v_ultima THEN
    RAISE EXCEPTION 'Leitura informada (%) é menor que a última registrada para este veículo (%). Confira o % antes de continuar.',
      p_medida, v_ultima, CASE WHEN v_medidor = 'hodometro' THEN 'hodômetro' ELSE 'horímetro' END;
  END IF;

  IF p_litros <= 0 OR p_valor_total <= 0 THEN
    RAISE EXCEPTION 'Litros e valor total devem ser maiores que zero';
  END IF;

  -- Janela mínima de 120 minutos entre abastecimentos do mesmo
  -- veículo — usa a hora real do evento (v_data_hora), não a de
  -- sincronização, para valer também em registros feitos offline.
  -- Abastecimentos rejeitados pela gestão não contam pra trava.
  SELECT MAX(data_hora) INTO v_ultimo_abast
    FROM frota_abastecimentos
    WHERE veiculo_id = p_veiculo_id AND status <> 'rejeitado';
  IF v_ultimo_abast IS NOT NULL AND v_data_hora - v_ultimo_abast < interval '120 minutes' THEN
    RAISE EXCEPTION 'Já existe abastecimento registrado para este veículo há menos de 120 minutos (%). Aguarde antes de registrar outro.',
      to_char(v_ultimo_abast, 'DD/MM/YYYY HH24:MI');
  END IF;

  BEGIN
    INSERT INTO frota_abastecimentos (
      veiculo_id, motorista_id, viagem_id, data_hora,
      medida_no_abastecimento, litros, preco_litro, valor_total, tanque_cheio,
      posto_nome, foto_cupom_url, foto_hodometro_url, observacoes_motorista,
      status, uuid_cliente, localizacao
    ) VALUES (
      p_veiculo_id, v_motorista_id, p_viagem_id, v_data_hora,
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

  UPDATE frota_veiculos
    SET hodometro_km    = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE horimetro_horas END
    WHERE id = p_veiculo_id;

  RETURN v_abast;
END;
$$;

-- 5) Expor a última leitura ao cliente ───────────────────────
-- O app precisa saber a última leitura do veículo pra avisar o
-- motorista ANTES de mandar pro servidor (a trava dura acima é quem
-- garante de verdade — isto aqui é só pra dar feedback rápido na tela).

-- vw_frota_viagens_detalhe (última recriação: 187) ganha as duas
-- colunas do veículo. DROP VIEW + CREATE, como a 187 já fazia.
DROP VIEW IF EXISTS vw_frota_viagens_detalhe;
CREATE VIEW vw_frota_viagens_detalhe WITH (security_invoker = true) AS
SELECT
  fv.*,
  frota_nome_usuario(fv.solicitante_id) AS solicitante_nome,
  u.telefone        AS solicitante_telefone,
  s.sigla           AS setor_sigla,
  s.nome            AS setor_nome,
  v.placa           AS veiculo_placa,
  v.modelo          AS veiculo_modelo,
  v.tipo            AS veiculo_tipo,
  v.medidor         AS veiculo_medidor,
  v.dedicado_setor  AS veiculo_dedicado,
  v.hodometro_km    AS veiculo_hodometro_km,
  v.horimetro_horas AS veiculo_horimetro_horas,
  sv.sigla          AS veiculo_setor_sigla,
  m.nome            AS motorista_nome,
  m.usuario_id      AS motorista_usuario_id,
  frota_nome_usuario(fv.dedicado_liberado_por) AS dedicado_liberado_por_nome,
  (fv.cidade_destino IS NOT NULL
   AND frota_norm_cidade(fv.cidade_destino) <> frota_norm_cidade(fv.cidade_origem))
                    AS intermunicipal,
  CASE WHEN fv.localizacao_saida IS NOT NULL THEN ST_Y(fv.localizacao_saida) END AS lat_saida,
  CASE WHEN fv.localizacao_saida IS NOT NULL THEN ST_X(fv.localizacao_saida) END AS lng_saida,
  CASE WHEN fv.localizacao_chegada IS NOT NULL THEN ST_Y(fv.localizacao_chegada) END AS lat_chegada,
  CASE WHEN fv.localizacao_chegada IS NOT NULL THEN ST_X(fv.localizacao_chegada) END AS lng_chegada
FROM frota_viagens fv
LEFT JOIN usuarios u                  ON u.id = fv.solicitante_id
LEFT JOIN unidades_organizacionais s  ON s.id = fv.setor_solicitante_id
LEFT JOIN frota_veiculos v            ON v.id = fv.veiculo_id
LEFT JOIN unidades_organizacionais sv ON sv.id = v.setor_id
LEFT JOIN frota_motoristas m          ON m.id = fv.motorista_id;

-- frota_veiculos_ativos_abastecimento (184) ganha as mesmas duas
-- colunas — RETURNS TABLE muda, então precisa do DROP explícito
-- (mesmo motivo das funções acima).
DROP FUNCTION IF EXISTS frota_veiculos_ativos_abastecimento();
CREATE OR REPLACE FUNCTION frota_veiculos_ativos_abastecimento()
RETURNS TABLE (id uuid, placa text, modelo text, medidor medidor_uso_frota, hodometro_km numeric, horimetro_horas numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id uuid;
BEGIN
  SELECT fm.id INTO v_motorista_id
    FROM frota_motoristas fm WHERE fm.usuario_id = auth.uid() AND fm.ativo AND fm.status = 'ativo';

  IF v_motorista_id IS NULL AND NOT pode_ver('frota') THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  IF v_motorista_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM frota_veiculos WHERE motorista_padrao_id = v_motorista_id
    UNION ALL
    SELECT 1 FROM frota_veiculo_motoristas WHERE motorista_id = v_motorista_id
  ) THEN
    RETURN QUERY
      SELECT v.id, v.placa, v.modelo, v.medidor, v.hodometro_km, v.horimetro_horas
      FROM frota_veiculos v
      WHERE v.ativo AND v.status NOT IN ('em_manutencao', 'baixado')
        AND (
          v.motorista_padrao_id = v_motorista_id
          OR EXISTS (SELECT 1 FROM frota_veiculo_motoristas x WHERE x.veiculo_id = v.id AND x.motorista_id = v_motorista_id)
        )
      ORDER BY v.placa;
  ELSE
    RETURN QUERY
      SELECT v.id, v.placa, v.modelo, v.medidor, v.hodometro_km, v.horimetro_horas
      FROM frota_veiculos v
      WHERE v.ativo AND v.status NOT IN ('em_manutencao', 'baixado')
      ORDER BY v.placa;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION frota_veiculos_ativos_abastecimento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_veiculos_ativos_abastecimento() TO authenticated;
