-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — viagem aberta direto pelo motorista, sem
-- passar pelo fluxo solicitar→aprovar. Fica marcada (aberta_direto)
-- para o setor de transporte identificar depois, e notifica quem
-- tem permissão de editar em frota (visibilidade, já que pulou a
-- aprovação prévia).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_viagens ADD COLUMN IF NOT EXISTS aberta_direto boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION frota_abrir_viagem_direta(
  p_veiculo_id uuid, p_destino text, p_finalidade text,
  p_medida numeric, p_combustivel_pct smallint
)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id   uuid;
  v_motorista_nome text;
  v_medidor        medidor_uso_frota;
  v_status         status_veiculo_frota;
  v_viagem         frota_viagens;
  v_saida          timestamptz := now();
  r                record;
BEGIN
  SELECT id, nome INTO v_motorista_id, v_motorista_nome
    FROM frota_motoristas WHERE usuario_id = auth.uid() AND ativo AND status = 'ativo';
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;
  IF NOT frota_motorista_apto(v_motorista_id) THEN
    RAISE EXCEPTION 'Motorista inapto: habilitação vencida';
  END IF;

  SELECT medidor, status INTO v_medidor, v_status FROM frota_veiculos WHERE id = p_veiculo_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado';
  END IF;
  IF v_status <> 'disponivel' THEN
    RAISE EXCEPTION 'Veículo indisponível (status atual: %)', v_status;
  END IF;

  BEGIN
    INSERT INTO frota_viagens (
      solicitante_id, destino, finalidade, data_saida_prevista, data_retorno_prevista,
      status, veiculo_id, motorista_id, aprovado_por, aprovado_em,
      km_saida, horas_saida, combustivel_saida_pct, checkout_em, aberta_direto
    ) VALUES (
      auth.uid(), p_destino, p_finalidade, v_saida, v_saida + interval '1 hour',
      'em_andamento', p_veiculo_id, v_motorista_id, auth.uid(), now(),
      CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
      CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
      p_combustivel_pct, now(), true
    ) RETURNING * INTO v_viagem;
  EXCEPTION WHEN exclusion_violation THEN
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

-- Expõe aberta_direto na view de detalhe (coluna nova ao final da
-- lista — CREATE OR REPLACE VIEW aceita, preserva security_invoker).
CREATE OR REPLACE VIEW vw_frota_viagens_detalhe WITH (security_invoker = true) AS
SELECT
  fv.id, fv.solicitante_id, fv.setor_solicitante_id, fv.destino, fv.uc_destino_id,
  fv.finalidade, fv.passageiros, fv.data_saida_prevista, fv.data_retorno_prevista,
  fv.status, fv.veiculo_id, fv.motorista_id, fv.aprovado_por, fv.aprovado_em,
  fv.motivo_recusa, fv.km_saida, fv.horas_saida, fv.combustivel_saida_pct, fv.checkout_em,
  fv.km_chegada, fv.horas_chegada, fv.combustivel_chegada_pct, fv.checkin_em,
  fv.observacoes_checkin, fv.avarias, fv.cancelado_por, fv.cancelado_em,
  fv.motivo_cancelamento, fv.criado_em, fv.atualizado_em,
  frota_nome_usuario(fv.solicitante_id) AS solicitante_nome,
  s.sigla AS setor_sigla, s.nome AS setor_nome,
  v.placa AS veiculo_placa, v.modelo AS veiculo_modelo, v.tipo AS veiculo_tipo, v.medidor AS veiculo_medidor,
  m.nome AS motorista_nome, m.usuario_id AS motorista_usuario_id,
  fv.aberta_direto
FROM frota_viagens fv
  LEFT JOIN unidades_organizacionais s ON s.id = fv.setor_solicitante_id
  LEFT JOIN frota_veiculos v ON v.id = fv.veiculo_id
  LEFT JOIN frota_motoristas m ON m.id = fv.motorista_id;
