-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — endurecimento das RPCs (Fase 1 do plano em
-- docs/frota-analise-e-plano.md)
--
-- A anon key é pública (vai no config.js, para o navegador), então
-- qualquer pessoa pode chamar /rest/v1/rpc/<função> com ela. Toda
-- função SECURITY DEFINER com EXECUTE concedido a PUBLIC/anon é, na
-- prática, um endpoint aberto que roda com privilégios de dono e
-- ignora o RLS das tabelas que lê.
--
-- Quatro correções, todas apontadas pelo advisor de segurança do
-- Supabase e pela auditoria de ponta a ponta do módulo:
--   1. Guarda de sessão + REVOKE de anon nas 3 RPCs de leitura que
--      não checavam auth.uid()
--   2. REVOKE das 7 funções de trigger ainda expostas como RPC
--      (mesmo padrão das migrations 165 e 179, que fecharam 4)
--   3. search_path fixo nas 3 funções frota_* que estavam mutáveis
--   4. Filtro de dono no fallback de idempotência do abastecimento
--
-- Nenhuma mudança de comportamento para usuário autenticado.
-- ═══════════════════════════════════════════════════════════


-- ── 1. RPCs SECURITY DEFINER sem guarda de sessão ──────────────
--
-- frota_nome_usuario: lia nome_completo de QUALQUER usuário pelo id,
-- contornando o RLS de `usuarios`. Não pode ser revogada de
-- `authenticated` porque as views SECURITY INVOKER
-- vw_frota_viagens_detalhe e vw_frota_comunicados_manutencao
-- dependem dela para resolver nomes — é exatamente para isso que ela
-- existe. Fecha-se então para PUBLIC/anon e acrescenta-se a guarda.
--
-- Nota: a guarda usa auth.uid(), que é nulo em chamadas por
-- service_role (chave de serviço, sem JWT de usuário). Nenhum ponto
-- do sistema chama estas funções por service_role hoje; se algum dia
-- chamar, a função devolve nulo/vazio em vez de erro.

CREATE OR REPLACE FUNCTION frota_nome_usuario(p_usuario_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT nome_completo FROM usuarios
  WHERE id = p_usuario_id
    AND auth.uid() IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION frota_nome_usuario(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_nome_usuario(uuid) TO authenticated, service_role;

-- frota_veiculos_disponiveis: era a mais exposta das três — não exige
-- nenhum id para ser chamada (só duas datas), e devolvia a frota
-- inteira do órgão (placa, modelo, setor) para não autenticados.
-- Continua liberada para `authenticated`: é usada por
-- frota-solicitar.html, frota-viagens.html, frota-app.html e
-- internamente por frota_sugerir_alocacao.

CREATE OR REPLACE FUNCTION frota_veiculos_disponiveis(
  p_inicio timestamptz,
  p_fim timestamptz,
  p_incluir_dedicados boolean DEFAULT false
)
RETURNS TABLE(id uuid, placa text, modelo text, tipo tipo_veiculo_frota,
              capacidade_passageiros smallint, setor_id uuid, dedicado_setor boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT v.id, v.placa, v.modelo, v.tipo, v.capacidade_passageiros, v.setor_id, v.dedicado_setor
  FROM frota_veiculos v
  WHERE auth.uid() IS NOT NULL
    AND v.ativo AND v.status = 'disponivel'
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

REVOKE EXECUTE ON FUNCTION frota_veiculos_disponiveis(timestamptz, timestamptz, boolean)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_veiculos_disponiveis(timestamptz, timestamptz, boolean)
  TO authenticated, service_role;

-- frota_motorista_apto: oráculo de situação de habilitação (CNH
-- vencida / motorista inativo) para qualquer id. Diferente das duas
-- acima, NÃO é chamada por nenhuma tela nem por nenhuma view — só por
-- frota_aprovar_viagem, frota_aprovar_viagem_multipla,
-- frota_sugerir_motorista_escala e frota_abrir_viagem_direta, todas
-- SECURITY DEFINER (a checagem de EXECUTE nas chamadas internas é
-- feita como o dono, postgres). Pode ser fechada por completo, sem
-- alterar o corpo.

REVOKE EXECUTE ON FUNCTION frota_motorista_apto(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION frota_motorista_apto(uuid) TO service_role;


-- ── 2. Funções de trigger ainda expostas como RPC ──────────────
-- Mesmo padrão da migration 179 (que fechou frota_gerar_codigo_abastecimento
-- e frota_marcar_atualizador_config_gps) e da 165. Estas sete ficaram
-- de fora. O Postgres recusa executar função de trigger fora de um
-- trigger, então o risco concreto é baixo — mas frota_push_dispatch
-- faz net.http_post e lê o push_secret, e nenhuma delas tem motivo
-- para estar no catálogo público do PostgREST.

REVOKE EXECUTE ON FUNCTION frota_ajustar_saldo_contrato()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION frota_gerar_codigo_os()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION frota_inicializar_saldo_contrato()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION frota_normaliza_placa()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION frota_notificar_viagem_solicitada() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION frota_os_sync_veiculo()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION frota_push_dispatch()               FROM PUBLIC, anon, authenticated;


-- ── 3. search_path fixo ────────────────────────────────────────
-- As três funções frota_* que o advisor aponta como "role mutable
-- search_path". ALTER FUNCTION em vez de CREATE OR REPLACE: fixa o
-- search_path sem tocar no corpo, que continua o que já está em
-- produção (lição da migration 181 — não recriar corpo sem
-- necessidade).

ALTER FUNCTION frota_normaliza_placa()            SET search_path = public;
ALTER FUNCTION frota_os_sync_veiculo()            SET search_path = public;
ALTER FUNCTION frota_inicializar_saldo_contrato() SET search_path = public;


-- ── 4. Filtro de dono no fallback de idempotência ──────────────
-- Em frota_registrar_abastecimento, o caminho feliz da idempotência
-- filtra pelo motorista do chamador, mas o handler
-- `EXCEPTION WHEN unique_violation` refazia o SELECT sem esse filtro
-- e devolvia a linha — ou seja, em colisão de uuid_cliente retornaria
-- o abastecimento de outro motorista. Só alcançável por colisão de
-- UUID v4 (praticamente impossível), mas é um RETURN de registro
-- alheio. Usa v_motorista_id, que já está resolvido nesse ponto.
--
-- Lista de parâmetros idêntica à que está em produção → CREATE OR
-- REPLACE substitui de fato (lição da migration 178: lista diferente
-- criaria um overload novo em vez de substituir).

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
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_data_hora timestamptz DEFAULT NULL
)
RETURNS frota_abastecimentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id  uuid;
  v_medidor       medidor_uso_frota;
  v_ultima        numeric;
  v_abast         frota_abastecimentos;
  v_veiculo_ativo uuid;
  v_data_hora     timestamptz := COALESCE(p_data_hora, now());
  v_ultimo_abast  timestamptz;
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

  -- Trava de veículo (migration 180): abastecimento tem que ser no
  -- veículo da viagem em andamento, quando houver.
  SELECT veiculo_id INTO v_veiculo_ativo
    FROM frota_viagens
    WHERE motorista_id = v_motorista_id AND status = 'em_andamento'
    ORDER BY checkout_em DESC NULLS LAST
    LIMIT 1;
  IF v_veiculo_ativo IS NOT NULL AND v_veiculo_ativo <> p_veiculo_id THEN
    RAISE EXCEPTION 'Você está com uma viagem em andamento em outro veículo — o abastecimento tem que ser registrado nele';
  END IF;

  SELECT medidor, CASE WHEN medidor = 'hodometro' THEN hodometro_km ELSE horimetro_horas END
    INTO v_medidor, v_ultima
    FROM frota_veiculos WHERE id = p_veiculo_id;
  IF v_medidor IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado';
  END IF;
  IF p_medida IS NULL OR p_medida < 0 THEN
    RAISE EXCEPTION 'Medida do % inválida', v_medidor;
  END IF;
  IF p_medida < v_ultima THEN
    RAISE EXCEPTION 'Leitura informada (%) é menor que a última registrada para este veículo (%). Confira o % antes de continuar.',
      p_medida, v_ultima, CASE WHEN v_medidor = 'hodometro' THEN 'hodômetro' ELSE 'horímetro' END;
  END IF;

  IF p_litros <= 0 OR p_valor_total <= 0 THEN
    RAISE EXCEPTION 'Litros e valor total devem ser maiores que zero';
  END IF;

  -- Janela mínima de 120 minutos entre abastecimentos do mesmo
  -- veículo — usa a hora real do evento (v_data_hora), não a de
  -- sincronização, para valer também em registros feitos offline.
  -- Abastecimentos rejeitados pela gestão não contam pra trava.
  SELECT MAX(data_hora) INTO v_ultimo_abast
    FROM frota_abastecimentos
    WHERE veiculo_id = p_veiculo_id AND status <> 'rejeitado';
  IF v_ultimo_abast IS NOT NULL AND v_data_hora - v_ultimo_abast < interval '120 minutes' THEN
    RAISE EXCEPTION 'Já existe abastecimento registrado para este veículo há menos de 120 minutos (%). Aguarde antes de registrar outro.',
      to_char(v_ultimo_abast, 'DD/MM/YYYY HH24:MI');
  END IF;

  BEGIN
    INSERT INTO frota_abastecimentos (
      veiculo_id, motorista_id, viagem_id, data_hora,
      medida_no_abastecimento, litros, preco_litro, valor_total, tanque_cheio,
      posto_nome, foto_cupom_url, foto_hodometro_url, observacoes_motorista,
      status, uuid_cliente, localizacao
    ) VALUES (
      p_veiculo_id, v_motorista_id, p_viagem_id, v_data_hora,
      p_medida, p_litros, p_preco_litro, p_valor_total, COALESCE(p_tanque_cheio, true),
      p_posto_nome, p_foto_cupom_url, p_foto_hodometro_url, p_observacoes,
      'pendente', p_uuid_cliente,
      CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END
    ) RETURNING * INTO v_abast;
  EXCEPTION WHEN unique_violation THEN
    -- Só devolve a linha existente se ela for DESTE motorista (antes
    -- devolvia a de qualquer um que tivesse o mesmo uuid_cliente).
    SELECT * INTO v_abast FROM frota_abastecimentos
      WHERE uuid_cliente = p_uuid_cliente AND motorista_id = v_motorista_id;
    IF FOUND THEN
      RETURN v_abast;
    END IF;
    RAISE;
  END;

  UPDATE frota_veiculos
    SET hodometro_km    = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE horimetro_horas END
    WHERE id = p_veiculo_id;

  RETURN v_abast;
END;
$$;
