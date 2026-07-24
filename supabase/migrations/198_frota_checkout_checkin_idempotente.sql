-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — check-out e check-in idempotentes
-- (Fase 2 do plano em docs/frota-analise-e-plano.md)
--
-- PROBLEMA (pílula envenenada na fila offline)
-- frota_abrir_viagem_direta (173) e frota_registrar_abastecimento
-- (175) são idempotentes por uuid_cliente; check-out e check-in não
-- eram. As duas transicionam por status:
--   WHERE id = p_viagem_id AND status = 'aprovada'
--
-- Em campo, com sinal fraco: o motorista faz check-out, a RPC COMMITA
-- no servidor, mas a resposta se perde. O cliente cai no catch, acha
-- que foi falha de rede e enfileira a ação. No próximo sync o reenvio
-- encontra a viagem já em 'em_andamento', a RPC levanta exceção, e o
-- motor de sync devolve a ação para 'pendente' — para sempre. A cada
-- 45s o app reenvia, avisa "1 pendência não pôde ser enviada" e o
-- pontinho de alerta no Config nunca apaga.
--
-- SOLUÇÃO
-- Mesmo molde da 173: o cliente gera um uuid_cliente por AÇÃO e o
-- servidor registra qual ação produziu cada transição. Reenviar a
-- mesma ação devolve a viagem como está, sem erro e sem repetir
-- efeito. São duas colunas porque check-out e check-in são duas ações
-- distintas sobre a MESMA viagem (o uuid_cliente que já existe em
-- frota_viagens identifica a viagem criada por viagem direta, não a
-- ação).
--
-- Ordem das checagens dentro das RPCs: primeiro a permissão (para o
-- retorno idempotente não virar oráculo de uuid alheio), depois a
-- idempotência, depois o resto — que segue idêntico ao que está em
-- produção hoje, incluindo o cast ::status_veiculo_frota e a chamada
-- a frota_checar_manutencao_veiculo que a migration 181 restaurou.
--
-- DROP antes de CREATE (lição da 178): a lista de parâmetros muda, e
-- CREATE OR REPLACE criaria um overload novo em vez de substituir —
-- o que deixaria o banco com "could not choose best candidate
-- function". Como DROP zera as permissões, os REVOKE/GRANT das
-- migrations 196/197 são reaplicados ao final.
-- ═══════════════════════════════════════════════════════════

-- ── Colunas + unicidade ────────────────────────────────────────
ALTER TABLE frota_viagens
  ADD COLUMN IF NOT EXISTS checkout_uuid_cliente uuid,
  ADD COLUMN IF NOT EXISTS checkin_uuid_cliente  uuid;

COMMENT ON COLUMN frota_viagens.checkout_uuid_cliente IS
  'uuid gerado pelo app para a AÇÃO de check-out; torna o reenvio da fila offline idempotente';
COMMENT ON COLUMN frota_viagens.checkin_uuid_cliente IS
  'uuid gerado pelo app para a AÇÃO de check-in; torna o reenvio da fila offline idempotente';

CREATE UNIQUE INDEX IF NOT EXISTS uq_frota_viagem_checkout_uuid
  ON frota_viagens (checkout_uuid_cliente) WHERE checkout_uuid_cliente IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_frota_viagem_checkin_uuid
  ON frota_viagens (checkin_uuid_cliente)  WHERE checkin_uuid_cliente IS NOT NULL;


-- ── Check-out ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS frota_checkout_viagem(uuid, numeric, smallint, numeric, numeric);

CREATE FUNCTION frota_checkout_viagem(
  p_viagem_id uuid,
  p_medida numeric,
  p_combustivel_pct smallint,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_uuid_cliente uuid DEFAULT NULL
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

  -- Idempotência: esta mesma ação já foi aplicada? Devolve a viagem
  -- como está, sem erro (é um reenvio da fila offline, não um novo
  -- check-out). Escopo preso a p_viagem_id, que a permissão acima já
  -- validou.
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

  IF v_viagem.solicitante_id IS NOT NULL THEN
    PERFORM frota_notificar(v_viagem.solicitante_id, 'Sua viagem começou',
      format('Destino: %s.', v_viagem.destino),
      jsonb_build_object('modulo','frota','subtipo','viagem_iniciada','viagem_id',v_viagem.id,'para','solicitante'));
  END IF;

  RETURN v_viagem;
END;
$$;


-- ── Check-in ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS frota_checkin_viagem(uuid, numeric, smallint, text, text, numeric, numeric);

CREATE FUNCTION frota_checkin_viagem(
  p_viagem_id uuid,
  p_medida numeric,
  p_combustivel_pct smallint,
  p_observacoes text,
  p_avarias text,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_uuid_cliente uuid DEFAULT NULL
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

  -- Cast explícito preservado (regressão corrigida pela 181): sem ele
  -- o CASE devolve text e o UPDATE falha com "column status is of type
  -- status_veiculo_frota but expression is of type text".
  UPDATE frota_veiculos
    SET status = (CASE WHEN v_viagem.avarias IS NOT NULL THEN 'em_manutencao' ELSE 'disponivel' END)::status_veiculo_frota,
        hodometro_km    = CASE WHEN v_medidor = 'hodometro' AND p_medida > hodometro_km THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' AND p_medida > horimetro_horas THEN p_medida ELSE horimetro_horas END
    WHERE id = v_viagem.veiculo_id;

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


-- ── Permissões (DROP zerou o que as migrations 196/197 fixaram) ─
REVOKE EXECUTE ON FUNCTION frota_checkout_viagem(uuid, numeric, smallint, numeric, numeric, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_checkout_viagem(uuid, numeric, smallint, numeric, numeric, uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION frota_checkin_viagem(uuid, numeric, smallint, text, text, numeric, numeric, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_checkin_viagem(uuid, numeric, smallint, text, text, numeric, numeric, uuid)
  TO authenticated, service_role;
