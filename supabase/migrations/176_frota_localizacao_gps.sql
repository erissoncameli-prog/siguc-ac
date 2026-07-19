-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — captura de localização GPS (regra do sistema)
-- Toda viagem (check-out/check-in) e todo abastecimento registram a
-- posição do aparelho no momento da ação. Captura é feita no app
-- (frota-app.html), de forma silenciosa e best-effort — sem tela
-- dedicada, sem bloquear a ação se o GPS falhar/for negado. Exibição
-- só na plataforma de mesa (frota-viagens.html/frota-abastecimentos.html
-- ), nunca no app. Molde de armazenamento igual ao de
-- registros_campo.localizacao (migration 046): geometry(Point,4326)
-- + índice GIST, extraído como lat/lng (ST_Y/ST_X) nas views (padrão
-- das migrations 047/053).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_viagens
  ADD COLUMN IF NOT EXISTS localizacao_saida   geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS localizacao_chegada  geometry(Point, 4326);

CREATE INDEX IF NOT EXISTS idx_frota_viag_loc_saida
  ON frota_viagens USING GIST (localizacao_saida) WHERE localizacao_saida IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_frota_viag_loc_chegada
  ON frota_viagens USING GIST (localizacao_chegada) WHERE localizacao_chegada IS NOT NULL;

ALTER TABLE frota_abastecimentos
  ADD COLUMN IF NOT EXISTS localizacao geometry(Point, 4326);

CREATE INDEX IF NOT EXISTS idx_frota_abast_loc
  ON frota_abastecimentos USING GIST (localizacao) WHERE localizacao IS NOT NULL;

-- ── RPCs: parâmetros opcionais p_lat/p_lng (DEFAULT NULL — payloads
-- antigos, sem GPS, continuam funcionando) ──────────────────────

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
BEGIN
  IF NOT frota_pode_operar_viagem(p_viagem_id) THEN
    RAISE EXCEPTION 'Sem permissão para iniciar esta viagem';
  END IF;

  SELECT medidor INTO v_medidor FROM frota_veiculos v
    JOIN frota_viagens fv ON fv.veiculo_id = v.id WHERE fv.id = p_viagem_id;

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

  UPDATE frota_veiculos SET status = 'em_viagem' WHERE id = v_viagem.veiculo_id;
  RETURN v_viagem;
END;
$$;

CREATE OR REPLACE FUNCTION frota_checkin_viagem(
  p_viagem_id uuid, p_medida numeric, p_combustivel_pct smallint,
  p_observacoes text, p_avarias text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL
)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem  frota_viagens;
  v_medidor medidor_uso_frota;
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
        avarias = NULLIF(p_avarias, ''),
        localizacao_chegada = CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END
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

  RETURN v_viagem;
END;
$$;

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
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL
)
RETURNS frota_abastecimentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id uuid;
  v_medidor      medidor_uso_frota;
  v_abast        frota_abastecimentos;
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

  SELECT medidor INTO v_medidor FROM frota_veiculos WHERE id = p_veiculo_id;
  IF v_medidor IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado';
  END IF;
  IF p_medida IS NULL OR p_medida < 0 THEN
    RAISE EXCEPTION 'Medida do % inválida', v_medidor;
  END IF;

  IF p_litros <= 0 OR p_valor_total <= 0 THEN
    RAISE EXCEPTION 'Litros e valor total devem ser maiores que zero';
  END IF;

  BEGIN
    INSERT INTO frota_abastecimentos (
      veiculo_id, motorista_id, viagem_id, data_hora,
      medida_no_abastecimento, litros, preco_litro, valor_total, tanque_cheio,
      posto_nome, foto_cupom_url, foto_hodometro_url, observacoes_motorista,
      status, uuid_cliente, localizacao
    ) VALUES (
      p_veiculo_id, v_motorista_id, p_viagem_id, now(),
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

  RETURN v_abast;
END;
$$;

-- Viagem avulsa (frota_abrir_viagem_direta, migration 173): já nasce
-- "em_andamento" com checkout_em preenchido — é o equivalente de um
-- check-out, então também recebe localizacao_saida.
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

-- ── Views: expõem lat/lng extraídos (padrão das migrations 047/053) ──
CREATE OR REPLACE VIEW vw_frota_viagens_detalhe AS
SELECT
  fv.*,
  frota_nome_usuario(fv.solicitante_id) AS solicitante_nome,
  s.sigla           AS setor_sigla,
  s.nome            AS setor_nome,
  v.placa           AS veiculo_placa,
  v.modelo          AS veiculo_modelo,
  v.tipo            AS veiculo_tipo,
  v.medidor         AS veiculo_medidor,
  m.nome            AS motorista_nome,
  m.usuario_id      AS motorista_usuario_id,
  CASE WHEN fv.localizacao_saida IS NOT NULL THEN ST_Y(fv.localizacao_saida) END AS lat_saida,
  CASE WHEN fv.localizacao_saida IS NOT NULL THEN ST_X(fv.localizacao_saida) END AS lng_saida,
  CASE WHEN fv.localizacao_chegada IS NOT NULL THEN ST_Y(fv.localizacao_chegada) END AS lat_chegada,
  CASE WHEN fv.localizacao_chegada IS NOT NULL THEN ST_X(fv.localizacao_chegada) END AS lng_chegada
FROM frota_viagens fv
LEFT JOIN unidades_organizacionais s ON s.id = fv.setor_solicitante_id
LEFT JOIN frota_veiculos v         ON v.id = fv.veiculo_id
LEFT JOIN frota_motoristas m       ON m.id = fv.motorista_id;

ALTER VIEW vw_frota_viagens_detalhe SET (security_invoker = true);

CREATE OR REPLACE VIEW vw_frota_abastecimentos_detalhe WITH (security_invoker = true) AS
SELECT
  a.*,
  v.placa, v.modelo, v.medidor,
  fm.nome AS motorista_nome,
  c.numero AS contrato_numero, c.fornecedor AS contrato_fornecedor,
  fr.tipo AS fonte_tipo, fr.codigo AS fonte_codigo, fr.descricao AS fonte_descricao,
  COALESCE(a.litros_ajustado, a.litros) AS litros_final,
  COALESCE(a.valor_ajustado, a.valor_total) AS valor_final,
  CASE WHEN a.localizacao IS NOT NULL THEN ST_Y(a.localizacao) END AS lat,
  CASE WHEN a.localizacao IS NOT NULL THEN ST_X(a.localizacao) END AS lng
FROM frota_abastecimentos a
JOIN frota_veiculos v ON v.id = a.veiculo_id
JOIN frota_motoristas fm ON fm.id = a.motorista_id
LEFT JOIN frota_contratos_combustivel c ON c.id = a.contrato_id
LEFT JOIN frota_fontes_recurso fr ON fr.id = c.fonte_recurso_id;
