-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — notificações (viagens + manutenção preventiva)
-- Reaproveita a tabela `notificacoes` (009). meta jsonb carrega o
-- detalhe: {modulo:'frota', subtipo:'...', viagem_id|plano_id|...}.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_notificar(p_destinatario uuid, p_titulo text, p_mensagem text, p_meta jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_destinatario IS NULL THEN RETURN; END IF;
  INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, meta)
  VALUES ('frota', 'gerada', p_titulo, p_mensagem, p_destinatario, p_meta);
END;
$$;

-- ── Viagem solicitada → avisa quem edita 'frota' (setor de transporte) ─
CREATE OR REPLACE FUNCTION frota_notificar_viagem_solicitada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_solicitante text;
  r record;
BEGIN
  SELECT nome_completo INTO v_solicitante FROM usuarios WHERE id = NEW.solicitante_id;
  FOR r IN SELECT id FROM usuarios WHERE ativo AND nivel_efetivo(id, 'frota') = 'editar' LOOP
    PERFORM frota_notificar(
      r.id,
      'Nova solicitação de viagem',
      format('%s solicitou viagem para %s (saída prevista %s).',
        COALESCE(v_solicitante,'Um servidor'), NEW.destino, to_char(NEW.data_saida_prevista, 'DD/MM HH24:MI')),
      jsonb_build_object('modulo','frota','subtipo','viagem_solicitada','viagem_id',NEW.id,'para','chefe')
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frota_viagem_solicitada ON frota_viagens;
CREATE TRIGGER trg_frota_viagem_solicitada AFTER INSERT ON frota_viagens
  FOR EACH ROW EXECUTE FUNCTION frota_notificar_viagem_solicitada();

-- ── Aprovar/recusar → avisa motorista/solicitante ───────────────
CREATE OR REPLACE FUNCTION frota_aprovar_viagem(p_viagem_id uuid, p_veiculo_id uuid, p_motorista_id uuid)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem frota_viagens;
  v_motorista_usuario uuid;
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

CREATE OR REPLACE FUNCTION frota_recusar_viagem(p_viagem_id uuid, p_motivo text)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem frota_viagens;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para recusar viagens';
  END IF;

  UPDATE frota_viagens
    SET status = 'recusada', motivo_recusa = p_motivo, aprovado_por = auth.uid(), aprovado_em = now()
    WHERE id = p_viagem_id AND status = 'solicitada'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou já processada';
  END IF;

  PERFORM frota_notificar(v_viagem.solicitante_id, 'Sua solicitação de viagem foi recusada',
    format('Destino: %s. Motivo: %s', v_viagem.destino, COALESCE(p_motivo,'não informado')),
    jsonb_build_object('modulo','frota','subtipo','viagem_recusada','viagem_id',v_viagem.id,'para','solicitante'));

  RETURN v_viagem;
END;
$$;

-- ── Manutenção preventiva próxima/vencida (a partir do diário de bordo) ─
CREATE OR REPLACE FUNCTION frota_checar_manutencao_veiculo(p_veiculo_id uuid, p_motorista_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p record;
  v_situacao text;
  v_detalhe text;
  v_ja_notificado boolean;
  r record;
BEGIN
  FOR p IN SELECT * FROM vw_frota_manutencoes_pendentes WHERE veiculo_id = p_veiculo_id LOOP
    v_situacao := CASE
      WHEN (p.restante_uso IS NOT NULL AND p.restante_uso <= 0)
        OR (p.restante_dias IS NOT NULL AND p.restante_dias <= 0) THEN 'vencido'
      WHEN (p.restante_uso IS NOT NULL AND p.intervalo_km IS NOT NULL AND p.restante_uso > 0 AND p.restante_uso <= p.intervalo_km * 0.1)
        OR (p.restante_dias IS NOT NULL AND p.restante_dias > 0 AND p.restante_dias <= 15) THEN 'proximo'
      ELSE 'ok'
    END;

    IF v_situacao = 'ok' THEN CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM notificacoes
      WHERE tipo = 'frota' AND status <> 'resolvida'
        AND meta->>'subtipo' = 'manutencao' AND meta->>'plano_id' = p.id::text
    ) INTO v_ja_notificado;
    IF v_ja_notificado THEN CONTINUE; END IF;

    v_detalhe := CASE
      WHEN v_situacao = 'vencido' AND p.restante_uso IS NOT NULL AND p.restante_uso <= 0
        THEN format('%s %s atrasado', abs(p.restante_uso), CASE WHEN p.medidor='horimetro' THEN 'h' ELSE 'km' END)
      WHEN v_situacao = 'vencido'
        THEN format('%s dia(s) atrasado', abs(p.restante_dias))
      WHEN p.restante_uso IS NOT NULL
        THEN format('faltam %s %s', p.restante_uso, CASE WHEN p.medidor='horimetro' THEN 'h' ELSE 'km' END)
      ELSE format('faltam %s dia(s)', p.restante_dias)
    END;

    PERFORM frota_notificar(
      p_motorista_usuario_id,
      format('Manutenção %s: %s', CASE WHEN v_situacao='vencido' THEN 'vencida' ELSE 'próxima' END, p.item),
      format('%s (%s) — %s', p.item, p.placa, v_detalhe),
      jsonb_build_object('modulo','frota','subtipo','manutencao','plano_id',p.id,'veiculo_id',p.veiculo_id,'para','motorista')
    );

    FOR r IN SELECT id FROM usuarios WHERE ativo AND nivel_efetivo(id,'frota') = 'editar' LOOP
      PERFORM frota_notificar(
        r.id,
        format('Manutenção %s: %s', CASE WHEN v_situacao='vencido' THEN 'vencida' ELSE 'próxima' END, p.item),
        format('%s (%s) — %s', p.item, p.placa, v_detalhe),
        jsonb_build_object('modulo','frota','subtipo','manutencao','plano_id',p.id,'veiculo_id',p.veiculo_id,'para','chefe')
      );
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION frota_checkin_viagem(
  p_viagem_id uuid, p_medida numeric, p_combustivel_pct smallint,
  p_observacoes text, p_avarias text
)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem  frota_viagens;
  v_medidor medidor_uso_frota;
  v_motorista_usuario uuid;
BEGIN
  IF NOT frota_pode_operar_viagem(p_viagem_id) THEN
    RAISE EXCEPTION 'Sem permissão para concluir esta viagem';
  END IF;

  SELECT medidor INTO v_medidor FROM frota_veiculos v
    JOIN frota_viagens fv ON fv.veiculo_id = v.id WHERE fv.id = p_viagem_id;

  UPDATE frota_viagens
    SET status = 'concluida', checkin_em = now(),
        km_chegada    = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
        horas_chegada = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
        combustivel_chegada_pct = p_combustivel_pct,
        observacoes_checkin = p_observacoes,
        avarias = NULLIF(p_avarias, '')
    WHERE id = p_viagem_id AND status = 'em_andamento'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou não está em andamento';
  END IF;

  UPDATE frota_veiculos
    SET status = CASE WHEN v_viagem.avarias IS NOT NULL THEN 'em_manutencao' ELSE 'disponivel' END,
        hodometro_km    = CASE WHEN v_medidor = 'hodometro' AND p_medida > hodometro_km THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' AND p_medida > horimetro_horas THEN p_medida ELSE horimetro_horas END
    WHERE id = v_viagem.veiculo_id;

  SELECT usuario_id INTO v_motorista_usuario FROM frota_motoristas WHERE id = v_viagem.motorista_id;
  PERFORM frota_checar_manutencao_veiculo(v_viagem.veiculo_id, v_motorista_usuario);

  RETURN v_viagem;
END;
$$;

-- ── OS concluída (com plano vinculado) resolve notificações abertas ─
CREATE OR REPLACE FUNCTION frota_os_sync_veiculo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('aberta','em_andamento') THEN
      UPDATE frota_veiculos SET status = 'em_manutencao'
        WHERE id = NEW.veiculo_id AND status <> 'baixado';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'concluida' AND OLD.status <> 'concluida' THEN
    IF NEW.plano_id IS NOT NULL THEN
      UPDATE frota_planos_manutencao
        SET ultima_execucao_km   = COALESCE(NEW.km_veiculo, ultima_execucao_km),
            ultima_execucao_data = COALESCE(NEW.data_conclusao, current_date)
        WHERE id = NEW.plano_id;

      UPDATE notificacoes
        SET status = 'resolvida', resolvido_em = now()
        WHERE tipo = 'frota' AND status <> 'resolvida'
          AND meta->>'subtipo' = 'manutencao' AND meta->>'plano_id' = NEW.plano_id::text;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM frota_ordens_servico
      WHERE veiculo_id = NEW.veiculo_id AND status IN ('aberta','em_andamento') AND id <> NEW.id
    ) THEN
      UPDATE frota_veiculos SET status = 'disponivel'
        WHERE id = NEW.veiculo_id AND status = 'em_manutencao';
    END IF;
  ELSIF NEW.status IN ('aberta','em_andamento') AND OLD.status NOT IN ('aberta','em_andamento') THEN
    UPDATE frota_veiculos SET status = 'em_manutencao'
      WHERE id = NEW.veiculo_id AND status <> 'baixado';
  END IF;
  RETURN NEW;
END $$;
