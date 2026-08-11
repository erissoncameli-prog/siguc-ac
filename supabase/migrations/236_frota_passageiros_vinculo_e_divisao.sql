-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — passageiro vinculado a usuário do sistema +
-- distribuição por veículo na viagem dividida
--
-- Continuação da migration 235. Duas lacunas registradas lá:
--
-- 1) VÍNCULO COM A BASE DE USUÁRIOS
-- Ao digitar o nome na solicitação, buscar entre os usuários do
-- sistema (nome, telefone já cadastrados). `frota_viagem_passageiros`
-- ganha `usuario_id` NULLABLE — metadado opcional, não muda em nada
-- quem não está no sistema (visitante/terceiro segue como nome
-- livre). O telefone NÃO é copiado para a linha: é resolvido AO VIVO
-- via join na view, mesmo padrão de solicitante_nome/motorista_nome,
-- para não descolar se a pessoa trocar de telefone depois.
--
-- Achado ao desenhar isto: a policy de SELECT de `usuarios` em
-- produção hoje é `usuarios_auth_select` (auth.uid() IS NOT NULL) —
-- qualquer autenticado já lê nome/telefone/cargo de qualquer colega.
-- Essa policy NÃO está em nenhuma migration deste repositório (drift:
-- foi aplicada fora do controle de versão) e diverge do que a
-- migration 001 e o ROPA (TRAT-001) descrevem. Não é alterada aqui —
-- é anterior a esta entrega e mexer nela é decisão maior, registrada
-- como pendência no CLAUDE.md — mas é o motivo de a busca de
-- passageiro NÃO precisar de RPC privilegiada: uma consulta filtrada
-- comum já respeita a RLS de verdade em vigor.
--
-- 2) DIVISÃO EM VÁRIOS VEÍCULOS DISTRIBUI OS NOMES, NÃO SÓ O NÚMERO
-- `frota_aprovar_viagem_multipla` (172→186→196→201) já recebia
-- `passageiros` (contagem) por alocação. Cada alocação do jsonb passa
-- a aceitar também `passageiro_ids` (uuid[], opcional) — quem for
-- listado é REAPONTADO (UPDATE viagem_id) para a viagem-filha daquela
-- alocação. Quem não aparecer em nenhuma lista fica na primeira
-- alocação, que é a própria viagem-mãe (id não muda) — sem caso
-- especial no código, e é o que já resolve "ficar no histórico da
-- viagem": a linha de frota_viagem_passageiros não é recriada, só
-- migra de dono, e a RLS de frota_viagem_passageiros (migration 235)
-- delega para a policy da própria frota_viagens — o motorista da
-- viagem-filha só vê os nomes que foram apontados para o veículo dele.
-- Assinatura da RPC não muda (ainda `jsonb`), então CREATE OR REPLACE
-- basta — não é o caso do DROP FUNCTION da 178/224.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Vínculo com usuário do sistema ──────────────────────────
ALTER TABLE frota_viagem_passageiros
  ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);

CREATE INDEX IF NOT EXISTS idx_frota_viag_pax_usuario
  ON frota_viagem_passageiros (usuario_id) WHERE usuario_id IS NOT NULL;

CREATE OR REPLACE FUNCTION frota_solicitar_viagem(
  p_setor_id      uuid,
  p_cidade_origem text,
  p_cidade_destino text,
  p_destino       text,
  p_uc_destino_id uuid,
  p_finalidade    text,
  p_passageiros   smallint,
  p_saida         timestamptz,
  p_retorno       timestamptz,
  p_lista_pax     jsonb DEFAULT '[]'::jsonb
)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_viagem frota_viagens;
  v_item   jsonb;
  v_ordem  smallint := 0;
  v_nome   text;
  v_nec    text;
  v_usuario_id uuid;
BEGIN
  IF p_retorno <= p_saida THEN
    RAISE EXCEPTION 'O retorno deve ser depois da saída';
  END IF;

  INSERT INTO frota_viagens (
    solicitante_id, setor_solicitante_id, cidade_origem, cidade_destino,
    destino, uc_destino_id, finalidade, passageiros,
    data_saida_prevista, data_retorno_prevista
  ) VALUES (
    auth.uid(), p_setor_id, p_cidade_origem, p_cidade_destino,
    p_destino, p_uc_destino_id, p_finalidade, p_passageiros,
    p_saida, p_retorno
  ) RETURNING * INTO v_viagem;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_lista_pax, '[]'::jsonb))
  LOOP
    v_nome := btrim(COALESCE(v_item->>'nome', ''));
    CONTINUE WHEN length(v_nome) < 2;
    v_ordem := v_ordem + 1;
    v_nec := NULLIF(btrim(COALESCE(v_item->>'necessidade_especifica', '')), '');
    -- usuario_id é só um atalho de preenchimento (nome/telefone
    -- prontos); não é validado contra nada além de ser um uuid válido
    -- — não amplia visibilidade nenhuma, é o próprio solicitante quem
    -- está registrando o dado, como qualquer outro campo do formulário.
    BEGIN
      v_usuario_id := NULLIF(v_item->>'usuario_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_usuario_id := NULL;
    END;

    INSERT INTO frota_viagem_passageiros (viagem_id, ordem, nome, sexo, necessidade_especifica, usuario_id)
    VALUES (
      v_viagem.id, v_ordem, left(v_nome, 120),
      CASE WHEN NULLIF(v_item->>'sexo','') IS NULL THEN NULL
           ELSE (v_item->>'sexo')::sexo_participante END,
      left(v_nec, 200), v_usuario_id
    );
  END LOOP;

  RETURN v_viagem;
END;
$$;

-- ── 2. View: usuario_id + telefone resolvido ao vivo ───────────
CREATE OR REPLACE VIEW vw_frota_viagens_detalhe WITH (security_invoker = true) AS
 SELECT fv.id,
    fv.solicitante_id,
    fv.setor_solicitante_id,
    fv.destino,
    fv.uc_destino_id,
    fv.finalidade,
    fv.passageiros,
    fv.data_saida_prevista,
    fv.data_retorno_prevista,
    fv.status,
    fv.veiculo_id,
    fv.motorista_id,
    fv.aprovado_por,
    fv.aprovado_em,
    fv.motivo_recusa,
    fv.km_saida,
    fv.horas_saida,
    fv.combustivel_saida_pct,
    fv.checkout_em,
    fv.km_chegada,
    fv.horas_chegada,
    fv.combustivel_chegada_pct,
    fv.checkin_em,
    fv.observacoes_checkin,
    fv.avarias,
    fv.cancelado_por,
    fv.cancelado_em,
    fv.motivo_cancelamento,
    fv.criado_em,
    fv.atualizado_em,
    fv.aberta_direto,
    fv.viagem_pai_id,
    fv.uuid_cliente,
    fv.localizacao_saida,
    fv.localizacao_chegada,
    fv.lista_passageiros,
    fv.dedicado_liberado,
    fv.dedicado_liberado_por,
    fv.dedicado_liberado_em,
    fv.dedicado_liberado_justificativa,
    fv.cidade_origem,
    fv.cidade_destino,
    frota_nome_usuario(fv.solicitante_id) AS solicitante_nome,
    u.telefone AS solicitante_telefone,
    s.sigla AS setor_sigla,
    s.nome AS setor_nome,
    v.placa AS veiculo_placa,
    v.modelo AS veiculo_modelo,
    v.tipo AS veiculo_tipo,
    v.medidor AS veiculo_medidor,
    v.dedicado_setor AS veiculo_dedicado,
    v.hodometro_km AS veiculo_hodometro_km,
    v.horimetro_horas AS veiculo_horimetro_horas,
    sv.sigla AS veiculo_setor_sigla,
    m.nome AS motorista_nome,
    m.usuario_id AS motorista_usuario_id,
    frota_nome_usuario(fv.dedicado_liberado_por) AS dedicado_liberado_por_nome,
    fv.cidade_destino IS NOT NULL AND frota_norm_cidade(fv.cidade_destino) <> frota_norm_cidade(fv.cidade_origem) AS intermunicipal,
        CASE
            WHEN fv.localizacao_saida IS NOT NULL THEN st_y(fv.localizacao_saida)
            ELSE NULL::double precision
        END AS lat_saida,
        CASE
            WHEN fv.localizacao_saida IS NOT NULL THEN st_x(fv.localizacao_saida)
            ELSE NULL::double precision
        END AS lng_saida,
        CASE
            WHEN fv.localizacao_chegada IS NOT NULL THEN st_y(fv.localizacao_chegada)
            ELSE NULL::double precision
        END AS lat_chegada,
        CASE
            WHEN fv.localizacao_chegada IS NOT NULL THEN st_x(fv.localizacao_chegada)
            ELSE NULL::double precision
        END AS lng_chegada,
    m.telefone AS motorista_telefone,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'sexo', p.sexo,
               'necessidade_especifica', p.necessidade_especifica,
               'usuario_id', p.usuario_id,
               'telefone', pu.telefone) ORDER BY p.ordem, p.criado_em)
        FROM frota_viagem_passageiros p
        LEFT JOIN usuarios pu ON pu.id = p.usuario_id
       WHERE p.viagem_id = fv.id
    ), '[]'::jsonb) AS passageiros_lista,
    (SELECT count(*) FROM frota_viagem_passageiros p
      WHERE p.viagem_id = fv.id AND p.necessidade_especifica IS NOT NULL) AS passageiros_necessidades
   FROM frota_viagens fv
     LEFT JOIN usuarios u ON u.id = fv.solicitante_id
     LEFT JOIN unidades_organizacionais s ON s.id = fv.setor_solicitante_id
     LEFT JOIN frota_veiculos v ON v.id = fv.veiculo_id
     LEFT JOIN unidades_organizacionais sv ON sv.id = v.setor_id
     LEFT JOIN frota_motoristas m ON m.id = fv.motorista_id;

-- ── 3. Aprovação múltipla reaponta os passageiros escolhidos ───
CREATE OR REPLACE FUNCTION frota_aprovar_viagem_multipla(
  p_viagem_id uuid, p_alocacoes jsonb,
  p_liberar_dedicado boolean DEFAULT false, p_justificativa text DEFAULT NULL
)
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
  v_passageiro_ids uuid[];
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
    -- Nomes explicitamente alocados nesta linha (opcional — viagens
    -- sem lista estruturada continuam funcionando só com o número).
    SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[])
      INTO v_passageiro_ids
      FROM jsonb_array_elements_text(COALESCE(v_alocacao->'passageiro_ids', '[]'::jsonb)) AS x;

    IF v_veiculo_id IS NULL OR v_motorista_id IS NULL OR v_passageiros IS NULL OR v_passageiros < 1 THEN
      RAISE EXCEPTION 'Cada alocação precisa de veículo, motorista e nº de passageiros válidos';
    END IF;

    IF NOT frota_motorista_apto(v_motorista_id) THEN
      RAISE EXCEPTION 'Motorista inapto: habilitação vencida ou inativo';
    END IF;

    PERFORM frota_checar_motorista_livre(v_motorista_id);

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

    -- Reaponta os passageiros escolhidos pra esta alocação. Pra
    -- v_primeira, v_filha.id = p_viagem_id: UPDATE vira no-op quando o
    -- passageiro já estava aqui, sem precisar de caso especial. Quem
    -- não é citado em NENHUMA alocação simplesmente não é tocado e
    -- fica na viagem-mãe (primeira alocação) — comportamento padrão
    -- coerente com "não remanejado = fica onde já estava".
    IF array_length(v_passageiro_ids, 1) > 0 THEN
      UPDATE frota_viagem_passageiros
         SET viagem_id = v_filha.id
       WHERE viagem_id = p_viagem_id AND id = ANY(v_passageiro_ids);
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

-- CREATE OR REPLACE preserva GRANT/REVOKE, mas reafirmado por
-- garantia (mesmo cuidado da 201).
REVOKE EXECUTE ON FUNCTION frota_aprovar_viagem_multipla(uuid, jsonb, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_aprovar_viagem_multipla(uuid, jsonb, boolean, text) TO authenticated, service_role;

COMMENT ON COLUMN frota_viagem_passageiros.usuario_id IS
  'Vínculo opcional com usuarios — preenchido quando o passageiro é escolhido pela busca (autocomplete) em vez de digitado livre. Não amplia visibilidade: quem lê a linha já podia ler o nome.';
