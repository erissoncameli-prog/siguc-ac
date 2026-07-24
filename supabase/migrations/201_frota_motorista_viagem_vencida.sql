-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — não escalar motorista que ainda não voltou
-- (Fase 4 do plano em docs/frota-analise-e-plano.md)
--
-- PROBLEMA
-- As constraints de exclusão (uq_frota_viagem_motorista_periodo e
-- ..._veiculo_periodo) impedem sobreposição usando o período
-- PREVISTO da viagem. Enquanto a viagem corre dentro do previsto,
-- isso basta. O buraco aparece quando a viagem atrasa: passado o
-- retorno previsto sem check-in, o período dela não sobrepõe mais
-- nada, e o motorista volta a parecer livre.
--
-- O veículo não corre esse risco porque frota_aprovar_viagem exige
-- `status = 'disponivel'`, e durante a viagem ele fica 'em_viagem'.
-- O motorista não tem guarda equivalente: frota_motorista_apto só
-- olha CNH e situação cadastral. Resultado: dava para escalar para
-- uma nova viagem alguém que ainda está na estrada.
--
-- REGRA
-- Bloquear a aprovação quando o motorista tem viagem 'em_andamento'
-- JÁ VENCIDA (retorno previsto no passado). Deliberadamente não é
-- "qualquer viagem em andamento": escalar hoje um motorista que está
-- em viagem dentro do prazo, para uma viagem do mês que vem, é
-- legítimo — e nesse caso a constraint de exclusão já resolve
-- sobreposição. O bloqueio vale exatamente para o estado que a
-- constraint não consegue enxergar.
--
-- A mensagem diz QUAL viagem está pendente, senão o gestor recebe um
-- "não pode" sem saber o que fazer a respeito.
--
-- Também expõe vw_frota_viagens_vencidas para a mesa e o app
-- listarem o que está pendente de check-in — o bloqueio sozinho
-- resolveria pela metade, deixando o gestor travado sem um lugar
-- para agir.
-- ═══════════════════════════════════════════════════════════

-- Viagem em andamento e vencida de um motorista (NULL se não há).
CREATE OR REPLACE FUNCTION frota_viagem_vencida_do_motorista(p_motorista uuid)
RETURNS frota_viagens
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM frota_viagens
   WHERE motorista_id = p_motorista
     AND status = 'em_andamento'
     AND data_retorno_prevista < now()
   ORDER BY data_retorno_prevista
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION frota_viagem_vencida_do_motorista(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION frota_viagem_vencida_do_motorista(uuid) TO service_role;

-- Guarda reaproveitada pelas duas RPCs de aprovação.
CREATE OR REPLACE FUNCTION frota_checar_motorista_livre(p_motorista uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v frota_viagens;
BEGIN
  v := frota_viagem_vencida_do_motorista(p_motorista);
  IF v.id IS NOT NULL THEN
    RAISE EXCEPTION 'Motorista ainda está em viagem: % (retorno previsto em %, sem check-in). Conclua ou cancele essa viagem antes de escalá-lo de novo.',
      v.destino, to_char(v.data_retorno_prevista, 'DD/MM/YYYY HH24:MI');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION frota_checar_motorista_livre(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION frota_checar_motorista_livre(uuid) TO service_role;

-- Viagens vencidas sem check-in (mesa e app do gestor).
-- SECURITY INVOKER, padrão da migration 165: quem consulta só vê o
-- que o RLS de frota_viagens já deixa ver.
DROP VIEW IF EXISTS vw_frota_viagens_vencidas;
CREATE VIEW vw_frota_viagens_vencidas WITH (security_invoker = true) AS
SELECT
  v.id, v.destino, v.finalidade, v.cidade_origem, v.cidade_destino,
  v.data_saida_prevista, v.data_retorno_prevista, v.checkout_em,
  v.veiculo_id, v.motorista_id, v.solicitante_id,
  ve.placa  AS veiculo_placa,
  ve.modelo AS veiculo_modelo,
  m.nome     AS motorista_nome,
  m.telefone AS motorista_telefone,
  EXTRACT(EPOCH FROM (now() - v.data_retorno_prevista)) / 3600 AS horas_atraso
FROM frota_viagens v
LEFT JOIN frota_veiculos   ve ON ve.id = v.veiculo_id
LEFT JOIN frota_motoristas m  ON m.id  = v.motorista_id
WHERE v.status = 'em_andamento'
  AND v.data_retorno_prevista < now();


-- ── Aprovação simples ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION frota_aprovar_viagem(
  p_viagem_id uuid, p_veiculo_id uuid, p_motorista_id uuid,
  p_liberar_dedicado boolean DEFAULT false, p_justificativa text DEFAULT NULL
)
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

  PERFORM frota_checar_motorista_livre(p_motorista_id);

  IF NOT EXISTS (SELECT 1 FROM frota_veiculos WHERE id = p_veiculo_id AND ativo AND status = 'disponivel') THEN
    RAISE EXCEPTION 'Veículo indisponível (em viagem, manutenção, cedido ou baixado)';
  END IF;

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


-- ── Aprovação múltipla (mesma guarda, por alocação) ────────────
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


-- CREATE OR REPLACE preserva as permissões, mas as duas RPCs já
-- estavam fechadas pelas migrations 196/197 — reafirmado por garantia.
REVOKE EXECUTE ON FUNCTION frota_aprovar_viagem(uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_aprovar_viagem(uuid, uuid, uuid, boolean, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION frota_aprovar_viagem_multipla(uuid, jsonb, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_aprovar_viagem_multipla(uuid, jsonb, boolean, text) TO authenticated, service_role;
