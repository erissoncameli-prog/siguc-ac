-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — passageiros da viagem como registros
-- estruturados (nome, sexo, necessidade específica)
--
-- O QUE MUDA
-- A migration 184 criou `frota_viagens.lista_passageiros text` —
-- texto livre, "um nome por linha". Serve para o motorista saber quem
-- embarca, mas não responde as duas perguntas que a gestão precisa
-- fazer ANTES de escalar o veículo: quem exige acessibilidade e qual
-- a composição do grupo. Passa a existir uma linha por passageiro.
--
-- POR QUE TABELA FILHA, E NÃO jsonb NA VIAGEM
-- É o padrão que o módulo já usa para lista de itens de um pai
-- (frota_os_itens/159, frota_inspecao_itens/203,
-- biomonitor_cautela_itens/227) e é o que permite (a) consultar
-- "quantas viagens exigiram acessibilidade" sem desmontar jsonb e
-- (b) purgar SÓ a coluna sensível na retenção, sem reescrever a
-- linha da viagem.
--
-- POR QUE UMA RPC PARA SOLICITAR
-- Hoje as duas superfícies (frota-solicitar.html e frota-app.html)
-- fazem `.insert()` direto em frota_viagens, sob a policy endurecida
-- da 158. Com tabela filha isso vira duas chamadas: se a segunda
-- falhar, sobra viagem com contagem de passageiros e sem os nomes.
-- `frota_solicitar_viagem` resolve numa transação só.
-- ATENÇÃO — a função é SECURITY **INVOKER**, de propósito: roda com o
-- RLS do chamador, então a policy da 158 continua sendo quem autoriza
-- o INSERT. Não é mais uma função privilegiada na superfície do
-- módulo (o oposto do que as migrations 196/197 tiveram que limpar).
--
-- SEXO — reaproveita o enum `sexo_participante` (migration 084:
-- masculino|feminino|outro|nao_informado). Enum novo exigiria
-- migration própria só para o ADD VALUE (regra do projeto); aqui não
-- precisa, o vocabulário já existe e é o mesmo do resto do sistema.
--
-- LGPD — "necessidade específica" é dado de saúde/deficiência
-- (Art. 5º, II). Entra no ROPA como tratamento próprio (TRAT-017),
-- com base legal do Art. 11, II, "b" — não como consentimento, na
-- mesma linha da decisão registrada na 211. A coluna é purgada 90
-- dias depois da viagem (job no fim deste arquivo): o nome de quem
-- viajou em veículo oficial é prestação de contas e fica os 5 anos
-- do TRAT-011; a condição de saúde não tem por que ficar.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Tabela ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS frota_viagem_passageiros (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viagem_id  uuid NOT NULL REFERENCES frota_viagens(id) ON DELETE CASCADE,
  ordem      smallint NOT NULL DEFAULT 1,
  nome       text NOT NULL CHECK (length(btrim(nome)) >= 2),
  sexo       sexo_participante,
  -- NULL = nenhuma necessidade. Texto curto e livre de propósito: a
  -- lista de sugestões vive no cliente (fixa, no código) e não num
  -- catálogo global como frota_sugestoes — catálogo aprendido
  -- espalharia dado pessoal de um solicitante para todos os outros.
  necessidade_especifica text CHECK (necessidade_especifica IS NULL
                                     OR length(btrim(necessidade_especifica)) BETWEEN 2 AND 200),
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frota_viag_pax_viagem ON frota_viagem_passageiros (viagem_id);
CREATE INDEX IF NOT EXISTS idx_frota_viag_pax_necessidade
  ON frota_viagem_passageiros (viagem_id) WHERE necessidade_especifica IS NOT NULL;

-- ── 2. RLS ────────────────────────────────────────────────────
-- Visibilidade espelha a da viagem: a subconsulta em frota_viagens
-- roda sob a RLS dela (frota_viag_select), que já resolve solicitante
-- dono, motorista escalado e pode_ver('frota'). Sem duplicar regra.
ALTER TABLE frota_viagem_passageiros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_viag_pax_select ON frota_viagem_passageiros;
CREATE POLICY frota_viag_pax_select ON frota_viagem_passageiros
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM frota_viagens v WHERE v.id = viagem_id)
  );

-- Escrita: o solicitante mexe na própria lista enquanto a viagem não
-- foi decidida; depois disso só a gestão de frota corrige.
DROP POLICY IF EXISTS frota_viag_pax_write ON frota_viagem_passageiros;
CREATE POLICY frota_viag_pax_write ON frota_viagem_passageiros
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM frota_viagens v
       WHERE v.id = viagem_id
         AND ((v.solicitante_id = auth.uid() AND v.status = 'solicitada') OR pode_editar('frota'))
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM frota_viagens v
       WHERE v.id = viagem_id
         AND ((v.solicitante_id = auth.uid() AND v.status = 'solicitada') OR pode_editar('frota'))
    )
  );

-- ── 3. RPC de solicitação (viagem + passageiros, atômica) ─────
-- SECURITY INVOKER: nenhuma permissão nova: quem não passa na policy
-- da 158 continua não conseguindo inserir. O ganho é só transacional.
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

    INSERT INTO frota_viagem_passageiros (viagem_id, ordem, nome, sexo, necessidade_especifica)
    VALUES (
      v_viagem.id, v_ordem, left(v_nome, 120),
      CASE WHEN NULLIF(v_item->>'sexo','') IS NULL THEN NULL
           ELSE (v_item->>'sexo')::sexo_participante END,
      left(v_nec, 200)
    );
  END LOOP;

  RETURN v_viagem;
END;
$$;

REVOKE EXECUTE ON FUNCTION frota_solicitar_viagem(uuid, text, text, text, uuid, text, smallint, timestamptz, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION frota_solicitar_viagem(uuid, text, text, text, uuid, text, smallint, timestamptz, timestamptz, jsonb) TO authenticated;

-- ── 4. View de detalhe ────────────────────────────────────────
-- Os passageiros vão agregados na própria view para as telas não
-- caírem em N+1 (lista do gestor, card do motorista, detalhe do
-- solicitante — todas já leem daqui).
-- Definição integral partindo da 202 (a mais recente), NÃO da 184 —
-- lição da migration 181. Colunas novas no fim, então CREATE OR
-- REPLACE basta.
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
               'necessidade_especifica', p.necessidade_especifica) ORDER BY p.ordem, p.criado_em)
        FROM frota_viagem_passageiros p WHERE p.viagem_id = fv.id
    ), '[]'::jsonb) AS passageiros_lista,
    (SELECT count(*) FROM frota_viagem_passageiros p
      WHERE p.viagem_id = fv.id AND p.necessidade_especifica IS NOT NULL) AS passageiros_necessidades
   FROM frota_viagens fv
     LEFT JOIN usuarios u ON u.id = fv.solicitante_id
     LEFT JOIN unidades_organizacionais s ON s.id = fv.setor_solicitante_id
     LEFT JOIN frota_veiculos v ON v.id = fv.veiculo_id
     LEFT JOIN unidades_organizacionais sv ON sv.id = v.setor_id
     LEFT JOIN frota_motoristas m ON m.id = fv.motorista_id;

-- ── 5. Backfill do texto livre da 184 ─────────────────────────
-- Uma linha por nome, preservando a ordem em que foram digitados.
-- A coluna `lista_passageiros` NÃO é apagada: fica como histórico do
-- que foi de fato digitado, e as telas caem nela quando a viagem
-- antiga não tem linhas estruturadas.
INSERT INTO frota_viagem_passageiros (viagem_id, ordem, nome)
SELECT fv.id, linha.ord::smallint, btrim(linha.nome)
  FROM frota_viagens fv
  CROSS JOIN LATERAL unnest(string_to_array(fv.lista_passageiros, E'\n'))
       WITH ORDINALITY AS linha(nome, ord)
 WHERE fv.lista_passageiros IS NOT NULL
   AND length(btrim(linha.nome)) >= 2
   AND NOT EXISTS (SELECT 1 FROM frota_viagem_passageiros p WHERE p.viagem_id = fv.id);

-- ── 6. Retenção do dado sensível ──────────────────────────────
-- Só a coluna da necessidade é zerada, 90 dias depois do retorno
-- previsto. A viagem e os nomes seguem o prazo do TRAT-011.
CREATE OR REPLACE FUNCTION frota_purgar_necessidade_passageiros()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE frota_viagem_passageiros p
     SET necessidade_especifica = NULL
    FROM frota_viagens v
   WHERE v.id = p.viagem_id
     AND p.necessidade_especifica IS NOT NULL
     AND COALESCE(v.checkin_em, v.data_retorno_prevista) < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Só o cron chama (mesmo cuidado da 179/220).
REVOKE EXECUTE ON FUNCTION frota_purgar_necessidade_passageiros() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('frota-purga-necessidade-passageiros')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frota-purga-necessidade-passageiros');

SELECT cron.schedule('frota-purga-necessidade-passageiros', '20 9 * * *',
  $cron$SELECT frota_purgar_necessidade_passageiros();$cron$);

-- ── 7. ROPA (Art. 37) ─────────────────────────────────────────
-- Tratamento próprio, e não uma linha nova no TRAT-011: aquele é
-- sobre geolocalização de trabalhador (alto risco, RIPD próprio);
-- este é sobre terceiros que embarcam, com dado sensível e prazo de
-- retenção diferente. Misturar os dois tornaria os dois ilegíveis.
INSERT INTO lgpd_tratamentos
  (codigo, nome, modulo, finalidade, base_legal, base_legal_detalhe,
   categorias_titulares, categorias_dados, dado_sensivel, dado_de_menor,
   origem, origem_detalhe, tabelas, retencao_meses, retencao_criterio,
   compartilhamento, transferencia_internacional, alto_risco, observacoes)
VALUES
('TRAT-017', 'Lista de passageiros de viagem oficial', 'frota',
 'Identificar quem embarca no veículo oficial e adequar o veículo e o embarque a passageiro com necessidade específica de acessibilidade.',
 'politica_publica',
 'Art. 7º, III para o nome e o sexo. Para a necessidade específica — dado de saúde, Art. 5º, II — a hipótese é a do Art. 11, II, "b" (tratamento necessário à execução de política pública pela administração), somada ao dever de acessibilidade da Lei 13.146/2015 (Estatuto da Pessoa com Deficiência).',
 ARRAY['servidores públicos','colaboradores','terceiros que embarcam em veículo oficial'],
 ARRAY['nome','sexo','necessidade específica de acessibilidade'],
 true, false, 'coleta_terceiro',
 'Informado pelo solicitante da viagem ao preencher o formulário, não pelo próprio passageiro. A tela orienta a informar só o necessário e a dar ciência ao passageiro.',
 ARRAY['frota_viagem_passageiros'],
 60, 'O nome segue o prazo da viagem (cinco anos, prestação de contas ao controle externo — TRAT-011). A necessidade específica é apagada 90 dias após o retorno, por job diário (frota_purgar_necessidade_passageiros): ela é operacional, serve para aquela viagem e não integra a prestação de contas.',
 'Não há compartilhamento externo. Dentro do sistema, a lista é visível ao solicitante, ao motorista escalado e à gestão da frota — a mesma visibilidade da viagem.',
 false, false,
 'Dado sensível por conter informação de saúde/deficiência. Mitigações: campo opcional, texto curto e limitado a 200 caracteres, sem catálogo global de sugestões (o que espalharia o dado entre solicitantes), purga automática em 90 dias e RLS espelhada na da viagem.')
ON CONFLICT (codigo) DO NOTHING;

COMMENT ON TABLE frota_viagem_passageiros IS
  'Passageiros de uma viagem (nome, sexo, necessidade específica). Substitui o texto livre frota_viagens.lista_passageiros (migration 184), que fica como histórico. Dado sensível: ver TRAT-017 no ROPA.';
