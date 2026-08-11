-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — encerrar viagem que nunca saiu
-- (usa o valor de enum criado na 240, já commitado)
--
-- PROBLEMA
-- Viagem cuja janela prevista terminou sem check-out ficava
-- 'aprovada' (ou 'solicitada') para sempre: "Aguardando saída" no
-- app do motorista, KPI de aprovadas inflado na mesa, fila de
-- aprovação do gestor entupida com solicitação de data vencida e
-- nenhum histórico — o solicitante não tinha onde ver que a viagem
-- dele morreu. A vw_frota_viagens_vencidas (201) cobre só o caso
-- inverso: a que SAIU e não fez check-in.
--
-- REGRA
-- Corte pelo RETORNO previsto, nunca pela saída: sair duas horas
-- atrasado é rotina; o que caracteriza "não realizada" é a janela
-- inteira ter fechado sem o veículo se mover.
--
-- DUAS VELOCIDADES, DE PROPÓSITO
--  · EXIBIÇÃO — `status_efetivo` na view deriva na hora
--    (data_retorno_prevista < now()). A viagem cai em "passadas"
--    no minuto seguinte ao vencimento, sem esperar cron.
--  · GRAVAÇÃO — o cron horário só materializa depois de 12h de
--    carência, para o check-out feito offline em campo (que pode
--    chegar ao servidor horas depois) encontrar a viagem ainda
--    aberta. Mesmo cuidado da 198 com a pílula envenenada da fila.
-- REGRA PARA QUEM FOR MEXER NAS TELAS: exibição lê `status_efetivo`;
-- `status` é o registro, não o que se mostra.
--
-- CHECK-OUT TARDIO REABRE. Se mesmo assim o motorista der check-out
-- (saiu com atraso, ou a fila offline sincronizou depois), a viagem
-- volta para 'em_andamento' e segue o fluxo normal — nada se perde e
-- a fila nunca trava. O único caso que ainda falha é o slot do
-- veículo/motorista já ter sido dado a outra viagem no período; aí a
-- mensagem diz o que fazer (abrir viagem avulsa).
--
-- 'nao_realizada' é TERMINAL e não conta como uso em lugar nenhum
-- (consumo, % de conclusão, rodízio de motorista — este último já
-- olhava só 'concluida').
-- ═══════════════════════════════════════════════════════════

-- ── 1. Registro do encerramento ────────────────────────────────
ALTER TABLE frota_viagens
  ADD COLUMN IF NOT EXISTS nao_realizada_em      timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_nao_realizacao text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_frota_viagem_motivo_nao_realizacao') THEN
    ALTER TABLE frota_viagens ADD CONSTRAINT chk_frota_viagem_motivo_nao_realizacao
      CHECK (motivo_nao_realizacao IS NULL OR motivo_nao_realizacao IN ('sem_aprovacao','sem_inicio'));
  END IF;
END $$;

COMMENT ON COLUMN frota_viagens.motivo_nao_realizacao IS
  'sem_aprovacao = venceu ainda solicitada; sem_inicio = venceu aprovada, sem check-out';


-- ── 2. Não aprovar viagem cuja janela já fechou ────────────────
-- Trigger em vez de guarda dentro das RPCs: cobre frota_aprovar_viagem,
-- frota_aprovar_viagem_multipla e qualquer caminho futuro, sem recriar
-- funções grandes (e sem repetir o erro da 181, de recriar uma RPC a
-- partir de um corpo antigo).
CREATE OR REPLACE FUNCTION frota_barrar_aprovacao_vencida()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aprovada' AND OLD.status = 'solicitada'
     AND NEW.data_retorno_prevista < now() THEN
    RAISE EXCEPTION 'Não é possível aprovar uma viagem cujo retorno previsto (%) já passou. Peça ao solicitante uma nova solicitação com datas atualizadas.',
      to_char(NEW.data_retorno_prevista, 'DD/MM/YYYY HH24:MI');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frota_viagem_aprovacao_vencida ON frota_viagens;
CREATE TRIGGER trg_frota_viagem_aprovacao_vencida
  BEFORE UPDATE ON frota_viagens
  FOR EACH ROW EXECUTE FUNCTION frota_barrar_aprovacao_vencida();


-- ── 3. Encerramento automático (pg_cron) ───────────────────────
-- Carência de 12h: ver "duas velocidades" no cabeçalho.
CREATE OR REPLACE FUNCTION frota_encerrar_viagens_nao_realizadas(
  p_carencia interval DEFAULT interval '12 hours'
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v        record;
  g        record;
  v_motivo text;
  v_alvo   uuid;
  v_total  int := 0;
BEGIN
  FOR v IN
    SELECT * FROM frota_viagens
     WHERE status IN ('solicitada','aprovada')
       AND data_retorno_prevista < now() - p_carencia
     ORDER BY data_retorno_prevista
  LOOP
    v_motivo := CASE WHEN v.status = 'solicitada' THEN 'sem_aprovacao' ELSE 'sem_inicio' END;

    UPDATE frota_viagens
       SET status = 'nao_realizada',
           nao_realizada_em = now(),
           motivo_nao_realizacao = v_motivo
     WHERE id = v.id AND status = v.status;

    IF NOT FOUND THEN CONTINUE; END IF;
    v_total := v_total + 1;

    -- Só avisa sobre viagem recente. Na primeira execução existe um
    -- passivo de meses (8 viagens, a mais antiga de 22 dias, na base
    -- de produção) — encerrar é certo, mas notificar todo mundo sobre
    -- viagem de um mês atrás é barulho que ninguém pode mais resolver.
    CONTINUE WHEN v.data_retorno_prevista < now() - interval '7 days';

    -- O solicitante sempre precisa saber: a viagem dele não vai
    -- acontecer e ninguém avisou até aqui.
    PERFORM frota_notificar(v.solicitante_id,
      'Viagem encerrada sem realização',
      format('%s (saída prevista %s) foi encerrada automaticamente: %s. Solicite novamente se ainda precisar do deslocamento.',
        v.destino, to_char(v.data_saida_prevista, 'DD/MM HH24:MI'),
        CASE WHEN v_motivo = 'sem_aprovacao' THEN 'a solicitação não foi aprovada dentro do prazo'
             ELSE 'a viagem não foi iniciada pelo motorista' END),
      jsonb_build_object('modulo','frota','subtipo','viagem_nao_realizada',
        'viagem_id', v.id, 'motivo', v_motivo, 'para','solicitante'));

    -- Motorista e gestão só no caso 'sem_inicio': aí houve veículo e
    -- motorista reservados que ficaram parados. Solicitação sem
    -- resposta já é cobrada da gestão pelo SLA da migration 207 —
    -- avisar de novo aqui seria barulho em cima do mesmo fato.
    IF v_motivo = 'sem_inicio' THEN
      SELECT usuario_id INTO v_alvo FROM frota_motoristas WHERE id = v.motorista_id;
      PERFORM frota_notificar(v_alvo,
        'Viagem encerrada sem realização',
        format('%s (saída prevista %s) foi encerrada: não houve check-out.',
          v.destino, to_char(v.data_saida_prevista, 'DD/MM HH24:MI')),
        jsonb_build_object('modulo','frota','subtipo','viagem_nao_realizada',
          'viagem_id', v.id, 'motivo', v_motivo, 'para','motorista'));

      FOR g IN SELECT id FROM usuarios WHERE ativo AND nivel_efetivo(id, 'frota') = 'editar' LOOP
        PERFORM frota_notificar(g.id,
          'Viagem aprovada não foi realizada',
          format('%s — saída prevista %s, veículo e motorista escalados, sem check-out.',
            v.destino, to_char(v.data_saida_prevista, 'DD/MM HH24:MI')),
          jsonb_build_object('modulo','frota','subtipo','viagem_nao_realizada',
            'viagem_id', v.id, 'motivo', v_motivo, 'para','chefe'));
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION frota_encerrar_viagens_nao_realizadas(interval) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION frota_encerrar_viagens_nao_realizadas(interval) TO service_role;

-- Trigger só roda por trigger (achado do advisor na 179).
REVOKE EXECUTE ON FUNCTION frota_barrar_aprovacao_vencida() FROM PUBLIC, anon, authenticated;

-- De hora em hora, fora dos minutos já usados pelos outros crons do
-- módulo (205 = 09:10, 207 = */3h no minuto 0, 208 = */5min).
SELECT cron.unschedule('frota-viagens-nao-realizadas')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frota-viagens-nao-realizadas');

SELECT cron.schedule('frota-viagens-nao-realizadas', '20 * * * *',
  $cron$SELECT frota_encerrar_viagens_nao_realizadas();$cron$);


-- ── 4. Check-out tardio reabre a viagem ────────────────────────
-- Base: corpo da 204 (o mais recente — lição da 181). Muda só o
-- WHERE do UPDATE, a limpeza das marcas de encerramento e a
-- tradução do exclusion_violation em mensagem acionável.
CREATE OR REPLACE FUNCTION frota_checkout_viagem(
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

  BEGIN
    UPDATE frota_viagens
      SET status = 'em_andamento', checkout_em = now(),
          km_saida   = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
          horas_saida = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
          combustivel_saida_pct = p_combustivel_pct,
          localizacao_saida = CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END,
          checkout_uuid_cliente = COALESCE(p_uuid_cliente, checkout_uuid_cliente),
          -- Reabertura: a viagem aconteceu, então o encerramento
          -- automático foi um palpite errado e some do registro.
          nao_realizada_em = NULL,
          motivo_nao_realizacao = NULL
      WHERE id = p_viagem_id AND status IN ('aprovada','nao_realizada')
      RETURNING * INTO v_viagem;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Esta viagem foi encerrada por atraso e o veículo/motorista já está escalado em outra viagem deste período. Registre o deslocamento como viagem avulsa.';
  END;

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

REVOKE EXECUTE ON FUNCTION frota_checkout_viagem(uuid, numeric, smallint, numeric, numeric, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_checkout_viagem(uuid, numeric, smallint, numeric, numeric, uuid, jsonb)
  TO authenticated, service_role;


-- ── 5. View: status_efetivo (a verdade da tela) ────────────────
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
      WHERE p.viagem_id = fv.id AND p.necessidade_especifica IS NOT NULL) AS passageiros_necessidades,
    fv.nao_realizada_em,
    -- Derivado SEM carência: a tela não espera o cron.
    CASE
      WHEN fv.status IN ('solicitada','aprovada') AND fv.data_retorno_prevista < now()
        THEN 'nao_realizada'::status_viagem_frota
      ELSE fv.status
    END AS status_efetivo,
    COALESCE(fv.motivo_nao_realizacao,
      CASE
        WHEN fv.status = 'solicitada' AND fv.data_retorno_prevista < now() THEN 'sem_aprovacao'
        WHEN fv.status = 'aprovada'   AND fv.data_retorno_prevista < now() THEN 'sem_inicio'
      END) AS motivo_nao_realizacao
   FROM frota_viagens fv
     LEFT JOIN usuarios u ON u.id = fv.solicitante_id
     LEFT JOIN unidades_organizacionais s ON s.id = fv.setor_solicitante_id
     LEFT JOIN frota_veiculos v ON v.id = fv.veiculo_id
     LEFT JOIN unidades_organizacionais sv ON sv.id = v.setor_id
     LEFT JOIN frota_motoristas m ON m.id = fv.motorista_id;
