-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — viagem avulsa (aberta_direto) idempotente
-- Diferente de check-out/check-in (que só transicionam se a viagem
-- ainda estiver no status esperado), frota_abrir_viagem_direta faz
-- INSERT de uma linha nova a cada chamada. No sync offline, se a
-- resposta se perde (timeout) DEPOIS do INSERT ter gravado, o cliente
-- remarca a ação como pendente e reenvia — criando uma viagem
-- duplicada (ou ficando presa em erro de exclusion_violation quando o
-- período ainda sobrepõe). A correção: uma chave de deduplicação
-- gerada no cliente (uuid_cliente); a RPC, ao reencontrá-la, devolve a
-- viagem já criada em vez de inserir de novo.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_viagens ADD COLUMN IF NOT EXISTS uuid_cliente uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_frota_viagem_uuid_cliente
  ON frota_viagens (uuid_cliente) WHERE uuid_cliente IS NOT NULL;

-- Remove a assinatura antiga de 5 args: como a nova tem p_uuid_cliente
-- com DEFAULT, uma chamada sem a chave (payloads antigos na fila offline)
-- resolve para a nova função. Manter as duas criaria overload ambíguo
-- ("could not choose best candidate function") para chamadas de 5 args.
DROP FUNCTION IF EXISTS frota_abrir_viagem_direta(uuid, text, text, numeric, smallint);

-- Recria a RPC com o parâmetro opcional p_uuid_cliente (DEFAULT NULL —
-- payloads antigos, sem a chave, continuam funcionando de forma não
-- idempotente, como antes). Mesmo corpo da 171, com o curto-circuito
-- de deduplicação no início.
CREATE OR REPLACE FUNCTION frota_abrir_viagem_direta(
  p_veiculo_id uuid, p_destino text, p_finalidade text,
  p_medida numeric, p_combustivel_pct smallint, p_uuid_cliente uuid DEFAULT NULL
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
  -- Curto-circuito idempotente: ação já aplicada num envio anterior.
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
      km_saida, horas_saida, combustivel_saida_pct, checkout_em, aberta_direto, uuid_cliente
    ) VALUES (
      auth.uid(), p_destino, p_finalidade, v_saida, v_saida + interval '1 hour',
      'em_andamento', p_veiculo_id, v_motorista_id, auth.uid(), now(),
      CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
      CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
      p_combustivel_pct, now(), true, p_uuid_cliente
    ) RETURNING * INTO v_viagem;
  EXCEPTION
    WHEN unique_violation THEN
      -- Corrida entre dois envios da mesma ação: a outra transação já
      -- gravou esta viagem. Devolve a linha existente (idempotência).
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
