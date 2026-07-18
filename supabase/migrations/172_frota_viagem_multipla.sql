-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — alocação de múltiplos veículos por viagem
-- Quando o nº de passageiros não cabe num único veículo disponível,
-- a aprovação passa a poder dividir a viagem em N "viagens filhas"
-- (viagem_pai_id), cada uma com seu próprio veículo/motorista/parcela
-- de passageiros. A viagem original vira a 1ª alocação (mantém o id
-- que o solicitante já acompanha) e as demais são linhas novas — assim
-- check-in/check-out, notificações e o app do motorista continuam
-- operando sobre viagens individuais normais, sem mudar de modelo.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_viagens ADD COLUMN IF NOT EXISTS viagem_pai_id uuid REFERENCES frota_viagens(id);

-- Guarda contra falso-positivo: a viagem filha (e a "direta" da 171) já
-- nasce aprovada/em andamento, não deve gerar o aviso de "nova
-- solicitação" endereçado ao setor de transporte.
CREATE OR REPLACE FUNCTION frota_notificar_viagem_solicitada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_solicitante text;
  r record;
BEGIN
  IF NEW.status <> 'solicitada' THEN RETURN NEW; END IF;
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

CREATE INDEX IF NOT EXISTS idx_frota_viag_pai ON frota_viagens (viagem_pai_id);

-- View de detalhe (padrão da 171: lista explícita de colunas +
-- security_invoker preservado).
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
  fv.aberta_direto,
  fv.viagem_pai_id
FROM frota_viagens fv
  LEFT JOIN unidades_organizacionais s ON s.id = fv.setor_solicitante_id
  LEFT JOIN frota_veiculos v ON v.id = fv.veiculo_id
  LEFT JOIN frota_motoristas m ON m.id = fv.motorista_id;

-- RLS de INSERT (158) só permite ao solicitante criar a própria viagem
-- 'solicitada'; as viagens filhas são criadas pela RPC abaixo, que roda
-- SECURITY DEFINER e por isso não passa pela policy — nada a ajustar ali.

-- Sugestão de divisão entre veículos disponíveis (guloso: maior
-- capacidade primeiro). Só orienta a tela de aprovação — o gestor pode
-- ajustar livremente antes de confirmar.
CREATE OR REPLACE FUNCTION frota_sugerir_alocacao(p_viagem_id uuid)
RETURNS TABLE(veiculo_id uuid, placa text, modelo text, capacidade_passageiros smallint, passageiros_sugeridos smallint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem   frota_viagens;
  v_restante smallint;
  r          record;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar viagens';
  END IF;

  SELECT * INTO v_viagem FROM frota_viagens WHERE id = p_viagem_id;
  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada';
  END IF;

  v_restante := GREATEST(COALESCE(v_viagem.passageiros, 1), 1);

  FOR r IN
    SELECT d.id, d.placa, d.modelo, COALESCE(d.capacidade_passageiros, 4)::smallint AS cap
    FROM frota_veiculos_disponiveis(v_viagem.data_saida_prevista, v_viagem.data_retorno_prevista) d
    ORDER BY COALESCE(d.capacidade_passageiros, 4) DESC, d.placa
  LOOP
    EXIT WHEN v_restante <= 0;
    veiculo_id := r.id;
    placa := r.placa;
    modelo := r.modelo;
    capacidade_passageiros := r.cap;
    passageiros_sugeridos := LEAST(r.cap, v_restante);
    v_restante := v_restante - passageiros_sugeridos;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Aprova dividindo entre múltiplos veículos. p_alocacoes:
-- jsonb array [{"veiculo_id":"...", "motorista_id":"...", "passageiros": n}, ...]
-- A 1ª alocação vira a própria viagem (mesmo id); as demais viram
-- viagens filhas (viagem_pai_id = p_viagem_id), copiando destino,
-- finalidade, UC e período da mãe.
CREATE OR REPLACE FUNCTION frota_aprovar_viagem_multipla(p_viagem_id uuid, p_alocacoes jsonb)
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

    IF v_primeira THEN
      BEGIN
        UPDATE frota_viagens
          SET status = 'aprovada', veiculo_id = v_veiculo_id, motorista_id = v_motorista_id,
              passageiros = v_passageiros, aprovado_por = auth.uid(), aprovado_em = now()
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
          aprovado_por, aprovado_em, viagem_pai_id
        ) VALUES (
          v_viagem.solicitante_id, v_viagem.setor_solicitante_id, v_viagem.destino, v_viagem.uc_destino_id,
          v_viagem.finalidade, v_passageiros, v_viagem.data_saida_prevista, v_viagem.data_retorno_prevista,
          'aprovada', v_veiculo_id, v_motorista_id, auth.uid(), now(), p_viagem_id
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
