-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — Veículos dedicados: bloqueio + liberação por viagem
-- Veículo com dedicado_setor=true (uso exclusivo do setor de lotação)
-- deixa de entrar no pool geral de disponibilidade. Só pode ser alocado
-- a uma viagem específica se a gestão de frota (pode_editar('frota'))
-- liberar explicitamente na aprovação — liberação registrada (quem/quando/
-- justificativa). Defesa em 2 camadas (app/mesa + servidor), no mesmo
-- espírito da "trava de veículo no abastecimento".
-- ═══════════════════════════════════════════════════════════

-- 1) Disponibilidade: exclui dedicados por padrão; param p_incluir_dedicados
--    reinclui (usado quando a gestão libera). Assinatura muda (nova coluna
--    de retorno + novo parâmetro) → DROP antes de recriar (lição 178/181).
DROP FUNCTION IF EXISTS frota_veiculos_disponiveis(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS frota_veiculos_disponiveis(timestamptz, timestamptz, boolean);
CREATE FUNCTION frota_veiculos_disponiveis(
  p_inicio timestamptz, p_fim timestamptz, p_incluir_dedicados boolean DEFAULT false)
RETURNS TABLE(id uuid, placa text, modelo text, tipo tipo_veiculo_frota,
              capacidade_passageiros smallint, setor_id uuid, dedicado_setor boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT v.id, v.placa, v.modelo, v.tipo, v.capacidade_passageiros, v.setor_id, v.dedicado_setor
  FROM frota_veiculos v
  WHERE v.ativo AND v.status = 'disponivel'
    AND (p_incluir_dedicados OR NOT v.dedicado_setor)
    AND NOT EXISTS (
      SELECT 1 FROM frota_viagens fv
      WHERE fv.veiculo_id = v.id
        AND fv.status IN ('aprovada','em_andamento')
        AND tstzrange(fv.data_saida_prevista, fv.data_retorno_prevista, '[]')
            && tstzrange(p_inicio, p_fim, '[]')
    )
  ORDER BY v.placa;
$$;

-- 2) Auditoria da liberação (por viagem). fv.* na view já expõe.
ALTER TABLE frota_viagens
  ADD COLUMN IF NOT EXISTS dedicado_liberado              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dedicado_liberado_por          uuid REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS dedicado_liberado_em           timestamptz,
  ADD COLUMN IF NOT EXISTS dedicado_liberado_justificativa text;

-- 3) View de detalhe (recria a partir da 184, que usa fv.*): acrescenta
--    se o veículo é dedicado, a sigla do setor de lotação do veículo e o
--    nome de quem liberou (exibição na mesa).
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
  sv.sigla          AS veiculo_setor_sigla,
  m.nome            AS motorista_nome,
  m.usuario_id      AS motorista_usuario_id,
  frota_nome_usuario(fv.dedicado_liberado_por) AS dedicado_liberado_por_nome,
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

-- 4) Aprovação simples: bloqueia veículo dedicado sem liberação; grava a
--    liberação. Recria a partir da 162 (mais recente). Assinatura muda
--    (novos params) → DROP antes.
DROP FUNCTION IF EXISTS frota_aprovar_viagem(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS frota_aprovar_viagem(uuid, uuid, uuid, boolean, text);
CREATE FUNCTION frota_aprovar_viagem(
  p_viagem_id uuid, p_veiculo_id uuid, p_motorista_id uuid,
  p_liberar_dedicado boolean DEFAULT false, p_justificativa text DEFAULT NULL)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem frota_viagens;
  v_motorista_usuario uuid;
  v_dedicado boolean;
  v_setor text;
  v_libera boolean;
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

  -- Veículo dedicado ao setor: só entra com liberação explícita da gestão.
  SELECT v.dedicado_setor, s.sigla INTO v_dedicado, v_setor
    FROM frota_veiculos v LEFT JOIN unidades_organizacionais s ON s.id = v.setor_id
    WHERE v.id = p_veiculo_id;
  IF v_dedicado AND NOT COALESCE(p_liberar_dedicado, false) THEN
    RAISE EXCEPTION 'Veículo dedicado ao setor %; requer liberação da gestão de frota', COALESCE(v_setor, 'de lotação');
  END IF;
  v_libera := v_dedicado AND COALESCE(p_liberar_dedicado, false);

  BEGIN
    UPDATE frota_viagens
      SET status = 'aprovada', veiculo_id = p_veiculo_id, motorista_id = p_motorista_id,
          aprovado_por = auth.uid(), aprovado_em = now(),
          dedicado_liberado = v_libera,
          dedicado_liberado_por = CASE WHEN v_libera THEN auth.uid() END,
          dedicado_liberado_em = CASE WHEN v_libera THEN now() END,
          dedicado_liberado_justificativa = CASE WHEN v_libera THEN NULLIF(btrim(p_justificativa), '') END
      WHERE id = p_viagem_id AND status = 'solicitada'
      RETURNING * INTO v_viagem;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Veículo ou motorista já alocado em outra viagem neste período';
  END;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou já processada';
  END IF;

  SELECT usuario_id INTO v_motorista_usuario FROM frota_motoristas WHERE id = p_motorista_id;
  PERFORM frota_notificar(v_motorista_usuario, 'Viagem aprovada — você foi escalado',
    format('Destino: %s. Saída prevista %s.', v_viagem.destino, to_char(v_viagem.data_saida_prevista,'DD/MM HH24:MI')),
    jsonb_build_object('modulo','frota','subtipo','viagem_aprovada','viagem_id',v_viagem.id,'para','motorista'));
  PERFORM frota_notificar(v_viagem.solicitante_id, 'Sua viagem foi aprovada',
    format('Destino: %s. Saída prevista %s.', v_viagem.destino, to_char(v_viagem.data_saida_prevista,'DD/MM HH24:MI')),
    jsonb_build_object('modulo','frota','subtipo','viagem_aprovada','viagem_id',v_viagem.id,'para','solicitante'));

  RETURN v_viagem;
END;
$$;

-- 5) Aprovação múltipla: mesma trava por alocação. Recria a partir da 172.
--    Assinatura muda (novos params) → DROP antes.
DROP FUNCTION IF EXISTS frota_aprovar_viagem_multipla(uuid, jsonb);
DROP FUNCTION IF EXISTS frota_aprovar_viagem_multipla(uuid, jsonb, boolean, text);
CREATE FUNCTION frota_aprovar_viagem_multipla(
  p_viagem_id uuid, p_alocacoes jsonb,
  p_liberar_dedicado boolean DEFAULT false, p_justificativa text DEFAULT NULL)
RETURNS SETOF frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem      frota_viagens;
  v_alocacao    jsonb;
  v_soma        int := 0;
  v_primeira    boolean := true;
  v_veiculo_id  uuid;
  v_motorista_id uuid;
  v_passageiros smallint;
  v_filha       frota_viagens;
  v_dedicado    boolean;
  v_libera      boolean;
  v_justif      text;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar viagens';
  END IF;

  SELECT * INTO v_viagem FROM frota_viagens WHERE id = p_viagem_id AND status = 'solicitada';
  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou já processada';
  END IF;

  IF jsonb_array_length(p_alocacoes) < 1 THEN
    RAISE EXCEPTION 'Informe ao menos uma alocação de veículo';
  END IF;

  v_justif := NULLIF(btrim(p_justificativa), '');

  FOR v_alocacao IN SELECT * FROM jsonb_array_elements(p_alocacoes) LOOP
    v_soma := v_soma + COALESCE((v_alocacao->>'passageiros')::int, 0);
  END LOOP;

  IF v_soma <> COALESCE(v_viagem.passageiros, v_soma) THEN
    RAISE EXCEPTION 'A soma dos passageiros alocados (%) não bate com o total solicitado (%)', v_soma, v_viagem.passageiros;
  END IF;

  FOR v_alocacao IN SELECT * FROM jsonb_array_elements(p_alocacoes) LOOP
    v_veiculo_id   := (v_alocacao->>'veiculo_id')::uuid;
    v_motorista_id := (v_alocacao->>'motorista_id')::uuid;
    v_passageiros  := (v_alocacao->>'passageiros')::smallint;

    IF v_veiculo_id IS NULL OR v_motorista_id IS NULL OR v_passageiros IS NULL OR v_passageiros < 1 THEN
      RAISE EXCEPTION 'Cada alocação precisa de veículo, motorista e nº de passageiros válidos';
    END IF;

    IF NOT frota_motorista_apto(v_motorista_id) THEN
      RAISE EXCEPTION 'Motorista inapto: habilitação vencida ou inativo';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM frota_veiculos WHERE id = v_veiculo_id AND ativo AND status <> 'baixado') THEN
      RAISE EXCEPTION 'Veículo indisponível';
    END IF;

    SELECT dedicado_setor INTO v_dedicado FROM frota_veiculos WHERE id = v_veiculo_id;
    IF v_dedicado AND NOT COALESCE(p_liberar_dedicado, false) THEN
      RAISE EXCEPTION 'Há veículo dedicado ao setor na alocação; requer liberação da gestão de frota';
    END IF;
    v_libera := v_dedicado AND COALESCE(p_liberar_dedicado, false);

    IF v_primeira THEN
      BEGIN
        UPDATE frota_viagens
          SET status = 'aprovada', veiculo_id = v_veiculo_id, motorista_id = v_motorista_id,
              passageiros = v_passageiros, aprovado_por = auth.uid(), aprovado_em = now(),
              dedicado_liberado = v_libera,
              dedicado_liberado_por = CASE WHEN v_libera THEN auth.uid() END,
              dedicado_liberado_em = CASE WHEN v_libera THEN now() END,
              dedicado_liberado_justificativa = CASE WHEN v_libera THEN v_justif END
          WHERE id = p_viagem_id AND status = 'solicitada'
          RETURNING * INTO v_filha;
      EXCEPTION WHEN exclusion_violation THEN
        RAISE EXCEPTION 'Veículo ou motorista já alocado em outra viagem neste período';
      END;
      v_primeira := false;
    ELSE
      BEGIN
        INSERT INTO frota_viagens (
          solicitante_id, setor_solicitante_id, destino, uc_destino_id, finalidade, passageiros,
          data_saida_prevista, data_retorno_prevista, status, veiculo_id, motorista_id,
          aprovado_por, aprovado_em, viagem_pai_id,
          dedicado_liberado, dedicado_liberado_por, dedicado_liberado_em, dedicado_liberado_justificativa
        ) VALUES (
          v_viagem.solicitante_id, v_viagem.setor_solicitante_id, v_viagem.destino, v_viagem.uc_destino_id,
          v_viagem.finalidade, v_passageiros, v_viagem.data_saida_prevista, v_viagem.data_retorno_prevista,
          'aprovada', v_veiculo_id, v_motorista_id, auth.uid(), now(), p_viagem_id,
          v_libera,
          CASE WHEN v_libera THEN auth.uid() END,
          CASE WHEN v_libera THEN now() END,
          CASE WHEN v_libera THEN v_justif END
        ) RETURNING * INTO v_filha;
      EXCEPTION WHEN exclusion_violation THEN
        RAISE EXCEPTION 'Veículo ou motorista já alocado em outra viagem neste período';
      END;
    END IF;

    PERFORM frota_notificar(
      m.usuario_id,
      'Viagem aprovada',
      format('Você foi escalado para %s (%s passageiro(s)).', v_viagem.destino, v_passageiros),
      jsonb_build_object('modulo','frota','subtipo','viagem_aprovada','viagem_id',v_filha.id)
    ) FROM frota_motoristas m WHERE m.id = v_motorista_id AND m.usuario_id IS NOT NULL;

    RETURN NEXT v_filha;
  END LOOP;

  RETURN;
END;
$$;

-- 6) Viagem direta (autosserviço do motorista): veículo dedicado é bloqueado
--    de forma dura — não há etapa de liberação nesse fluxo, precisa passar
--    pela aprovação da gestão. Mesma assinatura da 176 → CREATE OR REPLACE.
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

  SELECT medidor, status, dedicado_setor INTO v_medidor, v_status, v_dedicado
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

  UPDATE frota_veiculos SET status = 'em_viagem' WHERE id = p_veiculo_id;

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
