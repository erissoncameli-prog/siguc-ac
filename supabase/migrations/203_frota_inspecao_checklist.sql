-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — checklist de inspeção (DVIR)
-- (Fase 5 do plano em docs/frota-analise-e-plano.md)
--
-- POR QUE
-- Hoje a avaria só é capturada NO CHECK-IN, em texto livre: o sistema
-- descobre o problema depois da viagem. O padrão do setor (Fleetio,
-- Samsara) é o inverso — o motorista passa por uma lista de itens
-- ANTES de liberar o veículo, e item reprovado vira pendência de
-- manutenção sozinho.
--
-- A boa notícia é que o funil de destino já existe desde as migrations
-- 193/194: comunicado de defeito → validação da gestão → OS. Esta
-- migration não cria um caminho paralelo; ela adiciona a etapa que
-- faltava na SAÍDA, alimentando exatamente esse mesmo funil.
--
-- DECISÃO DE PROJETO — inspeção junto com o check-out, não separada
-- A inspeção poderia ser uma RPC própria, chamada antes do check-out.
-- Seria errado: no app o check-out é offline-first, então a fila
-- teria DOIS itens com dependência de ordem entre eles (inspeção
-- precisa existir antes do check-out), e a fila não garante ordem
-- depois de um erro isolado. Pior: dava para acabar com inspeção
-- registrada e viagem não iniciada, ou o contrário.
-- Por isso a inspeção entra como parâmetro OPCIONAL de
-- frota_checkout_viagem / frota_checkin_viagem: uma transação, um
-- item na fila, idempotente pelo mesmo uuid_cliente que a 198 já
-- introduziu. Ou grava tudo, ou não grava nada.
--
-- O catálogo é configurável pela gestão (frota_checklist_itens),
-- inclusive por tipo de veículo — o que se confere numa embarcação
-- não é o que se confere num carro.
-- ═══════════════════════════════════════════════════════════

CREATE TYPE momento_inspecao_frota AS ENUM ('saida', 'chegada');

-- ── Catálogo de itens ──────────────────────────────────────────
CREATE TABLE frota_checklist_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem          smallint NOT NULL DEFAULT 100,
  item           text NOT NULL,
  descricao      text,
  -- NULL/vazio = vale para todo tipo de veículo.
  tipos_veiculo  tipo_veiculo_frota[],
  na_saida       boolean NOT NULL DEFAULT true,
  na_chegada     boolean NOT NULL DEFAULT false,
  -- Item crítico: reprovado, a gestão é avisada com destaque.
  critico        boolean NOT NULL DEFAULT false,
  ativo          boolean NOT NULL DEFAULT true,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_checklist_momento CHECK (na_saida OR na_chegada)
);

CREATE INDEX idx_frota_checklist_ativo ON frota_checklist_itens (ativo, ordem);

CREATE TRIGGER trg_frota_checklist_touch
  BEFORE UPDATE ON frota_checklist_itens
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE frota_checklist_itens ENABLE ROW LEVEL SECURITY;

-- Todo autenticado LÊ (o motorista precisa do catálogo no app, e ele
-- não tem pode_ver('frota') garantido); só a gestão escreve.
CREATE POLICY frota_checklist_select ON frota_checklist_itens FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY frota_checklist_write ON frota_checklist_itens FOR ALL
  USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));


-- ── Inspeção realizada ─────────────────────────────────────────
CREATE TABLE frota_inspecoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viagem_id     uuid NOT NULL REFERENCES frota_viagens(id),
  veiculo_id    uuid NOT NULL REFERENCES frota_veiculos(id),
  motorista_id  uuid REFERENCES frota_motoristas(id),
  momento       momento_inspecao_frota NOT NULL,
  data_hora     timestamptz NOT NULL DEFAULT now(),
  observacoes   text,
  -- Comunicado de defeito gerado pelos itens não conformes (se houve).
  comunicado_id uuid REFERENCES frota_comunicados_manutencao(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (viagem_id, momento)
);

CREATE INDEX idx_frota_insp_viagem   ON frota_inspecoes (viagem_id);
CREATE INDEX idx_frota_insp_veiculo  ON frota_inspecoes (veiculo_id);
CREATE INDEX idx_frota_insp_data     ON frota_inspecoes (data_hora);

ALTER TABLE frota_inspecoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY frota_insp_select ON frota_inspecoes FOR SELECT
  USING (
    pode_ver('frota')
    OR EXISTS (SELECT 1 FROM frota_motoristas fm
                WHERE fm.id = frota_inspecoes.motorista_id AND fm.usuario_id = auth.uid())
  );
-- Escrita só pela RPC (SECURITY DEFINER). Sem política de INSERT/UPDATE
-- de propósito: ninguém grava inspeção direto pelo PostgREST.


-- ── Itens conferidos ───────────────────────────────────────────
CREATE TABLE frota_inspecao_itens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspecao_id uuid NOT NULL REFERENCES frota_inspecoes(id) ON DELETE CASCADE,
  -- Referência solta: o item pode ser desativado/renomeado depois sem
  -- reescrever o histórico.
  item_id     uuid REFERENCES frota_checklist_itens(id),
  -- Nome no momento da conferência (o catálogo muda; o registro não).
  item_nome   text NOT NULL,
  ordem       smallint NOT NULL DEFAULT 100,
  conforme    boolean NOT NULL,
  critico     boolean NOT NULL DEFAULT false,
  observacao  text,
  foto_url    text
);

CREATE INDEX idx_frota_insp_itens_insp ON frota_inspecao_itens (inspecao_id);

ALTER TABLE frota_inspecao_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY frota_insp_itens_select ON frota_inspecao_itens FOR SELECT
  USING (EXISTS (SELECT 1 FROM frota_inspecoes i WHERE i.id = frota_inspecao_itens.inspecao_id));


-- ── Registro da inspeção (helper interno) ──────────────────────
-- Chamado DENTRO de frota_checkout_viagem / frota_checkin_viagem, na
-- mesma transação. Não é exposto ao cliente: inspeção sem viagem não
-- faz sentido, e o ponto de entrada é sempre o check-out/check-in.
--
-- p_itens: [{item_id, item_nome, ordem, conforme, critico, observacao, foto_url}]
CREATE OR REPLACE FUNCTION frota_registrar_inspecao(
  p_viagem_id uuid,
  p_momento momento_inspecao_frota,
  p_itens jsonb,
  p_observacoes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem      frota_viagens;
  v_insp_id     uuid;
  v_item        jsonb;
  v_nao_conf    text[] := '{}';
  v_criticos    int := 0;
  v_fotos       text[] := '{}';
  v_comunicado  frota_comunicados_manutencao;
  v_placa       text;
  v_mot_nome    text;
  r             record;
BEGIN
  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_viagem FROM frota_viagens WHERE id = p_viagem_id;
  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada para a inspeção';
  END IF;

  -- Reenvio da mesma inspeção (fila offline): devolve a que já existe.
  SELECT id INTO v_insp_id FROM frota_inspecoes
   WHERE viagem_id = p_viagem_id AND momento = p_momento;
  IF v_insp_id IS NOT NULL THEN
    RETURN v_insp_id;
  END IF;

  INSERT INTO frota_inspecoes (viagem_id, veiculo_id, motorista_id, momento, observacoes)
  VALUES (p_viagem_id, v_viagem.veiculo_id, v_viagem.motorista_id, p_momento, NULLIF(btrim(p_observacoes), ''))
  RETURNING id INTO v_insp_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    INSERT INTO frota_inspecao_itens (
      inspecao_id, item_id, item_nome, ordem, conforme, critico, observacao, foto_url
    ) VALUES (
      v_insp_id,
      NULLIF(v_item->>'item_id','')::uuid,
      COALESCE(NULLIF(btrim(v_item->>'item_nome'),''), 'Item'),
      COALESCE((v_item->>'ordem')::smallint, 100),
      COALESCE((v_item->>'conforme')::boolean, true),
      COALESCE((v_item->>'critico')::boolean, false),
      NULLIF(btrim(v_item->>'observacao'),''),
      NULLIF(btrim(v_item->>'foto_url'),'')
    );

    IF NOT COALESCE((v_item->>'conforme')::boolean, true) THEN
      v_nao_conf := v_nao_conf || (
        COALESCE(NULLIF(btrim(v_item->>'item_nome'),''), 'Item')
        || CASE WHEN NULLIF(btrim(v_item->>'observacao'),'') IS NOT NULL
                THEN ' (' || btrim(v_item->>'observacao') || ')' ELSE '' END
      );
      IF COALESCE((v_item->>'critico')::boolean, false) THEN
        v_criticos := v_criticos + 1;
      END IF;
      IF NULLIF(btrim(v_item->>'foto_url'),'') IS NOT NULL THEN
        v_fotos := v_fotos || btrim(v_item->>'foto_url');
      END IF;
    END IF;
  END LOOP;

  -- Nada reprovado: acabou.
  IF array_length(v_nao_conf, 1) IS NULL THEN
    RETURN v_insp_id;
  END IF;

  -- Reprovou: entra no MESMO funil do comunicado de defeito (193/194),
  -- para a gestão validar e abrir a OS na mesa. Um comunicado por
  -- inspeção, agregando os itens — não um por item, senão a mesa
  -- recebe uma enxurrada.
  SELECT placa INTO v_placa FROM frota_veiculos WHERE id = v_viagem.veiculo_id;
  SELECT nome INTO v_mot_nome FROM frota_motoristas WHERE id = v_viagem.motorista_id;

  INSERT INTO frota_comunicados_manutencao (veiculo_id, motorista_id, viagem_id, descricao, fotos_urls)
  VALUES (
    v_viagem.veiculo_id, v_viagem.motorista_id, p_viagem_id,
    format('Checklist de %s reprovou %s item(ns): %s',
      CASE WHEN p_momento = 'saida' THEN 'saída' ELSE 'chegada' END,
      array_length(v_nao_conf, 1),
      array_to_string(v_nao_conf, '; ')),
    NULLIF(v_fotos, '{}')
  )
  RETURNING * INTO v_comunicado;

  UPDATE frota_inspecoes SET comunicado_id = v_comunicado.id WHERE id = v_insp_id;

  FOR r IN SELECT id FROM usuarios WHERE ativo AND nivel_efetivo(id, 'frota') = 'editar' LOOP
    PERFORM frota_notificar(
      r.id,
      CASE WHEN v_criticos > 0 THEN 'Checklist reprovou item CRÍTICO' ELSE 'Checklist com item reprovado' END,
      format('%s — %s (%s): %s',
        COALESCE(v_mot_nome,'Motorista'), COALESCE(v_placa,'veículo'),
        CASE WHEN p_momento = 'saida' THEN 'saída' ELSE 'chegada' END,
        array_to_string(v_nao_conf, '; ')),
      jsonb_build_object('modulo','frota','subtipo','defeito',
        'comunicado_id', v_comunicado.id, 'inspecao_id', v_insp_id, 'para','chefe')
    );
  END LOOP;

  RETURN v_insp_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION frota_registrar_inspecao(uuid, momento_inspecao_frota, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION frota_registrar_inspecao(uuid, momento_inspecao_frota, jsonb, text)
  TO service_role;


-- ── View de leitura (mesa e app) ───────────────────────────────
DROP VIEW IF EXISTS vw_frota_inspecoes;
CREATE VIEW vw_frota_inspecoes WITH (security_invoker = true) AS
SELECT
  i.id, i.viagem_id, i.veiculo_id, i.motorista_id, i.momento, i.data_hora,
  i.observacoes, i.comunicado_id, i.criado_em,
  ve.placa  AS veiculo_placa,
  ve.modelo AS veiculo_modelo,
  m.nome    AS motorista_nome,
  v.destino AS viagem_destino,
  (SELECT count(*) FROM frota_inspecao_itens it WHERE it.inspecao_id = i.id) AS total_itens,
  (SELECT count(*) FROM frota_inspecao_itens it WHERE it.inspecao_id = i.id AND NOT it.conforme) AS itens_reprovados,
  (SELECT count(*) FROM frota_inspecao_itens it WHERE it.inspecao_id = i.id AND NOT it.conforme AND it.critico) AS criticos_reprovados
FROM frota_inspecoes i
LEFT JOIN frota_veiculos   ve ON ve.id = i.veiculo_id
LEFT JOIN frota_motoristas m  ON m.id  = i.motorista_id
LEFT JOIN frota_viagens    v  ON v.id  = i.viagem_id;


-- ── Catálogo inicial ───────────────────────────────────────────
-- Ponto de partida editável pela gestão em frota-inspecoes.html.
-- Itens sem tipos_veiculo valem para todos; os de embarcação e moto
-- ficam restritos ao respectivo tipo.
INSERT INTO frota_checklist_itens (ordem, item, descricao, tipos_veiculo, na_saida, na_chegada, critico) VALUES
  (10, 'Documento do veículo (CRLV)', 'CRLV no veículo e dentro da validade', NULL, true, false, true),
  (20, 'Pneus e estepe', 'Calibragem, sulco e estepe presente', ARRAY['carro','caminhonete','van','onibus','caminhao','motocicleta','quadriciclo']::tipo_veiculo_frota[], true, false, true),
  (30, 'Freios', 'Pedal firme, sem ruído anormal', ARRAY['carro','caminhonete','van','onibus','caminhao','motocicleta','quadriciclo']::tipo_veiculo_frota[], true, false, true),
  (40, 'Luzes e setas', 'Faróis, lanternas, freio e setas funcionando', ARRAY['carro','caminhonete','van','onibus','caminhao','motocicleta','quadriciclo']::tipo_veiculo_frota[], true, false, true),
  (50, 'Nível de óleo', NULL, NULL, true, false, false),
  (60, 'Água do radiador', NULL, ARRAY['carro','caminhonete','van','onibus','caminhao']::tipo_veiculo_frota[], true, false, false),
  (70, 'Extintor de incêndio', 'Presente, lacrado e na validade', ARRAY['carro','caminhonete','van','onibus','caminhao','embarcacao']::tipo_veiculo_frota[], true, false, true),
  (80, 'Triângulo, macaco e chave de roda', NULL, ARRAY['carro','caminhonete','van','onibus','caminhao']::tipo_veiculo_frota[], true, false, false),
  (90, 'Cintos de segurança', NULL, ARRAY['carro','caminhonete','van','onibus','caminhao']::tipo_veiculo_frota[], true, false, true),
  (100, 'Retrovisores e para-brisa', 'Sem trinca que atrapalhe a visão', ARRAY['carro','caminhonete','van','onibus','caminhao']::tipo_veiculo_frota[], true, false, false),
  (110, 'Buzina e limpador de para-brisa', NULL, ARRAY['carro','caminhonete','van','onibus','caminhao']::tipo_veiculo_frota[], true, false, false),
  (120, 'Colete salva-vidas', 'Um por ocupante, em bom estado', ARRAY['embarcacao']::tipo_veiculo_frota[], true, false, true),
  (130, 'Casco e motor de popa', 'Sem infiltração; motor fixado e funcionando', ARRAY['embarcacao']::tipo_veiculo_frota[], true, false, true),
  (140, 'Remo e âncora', NULL, ARRAY['embarcacao']::tipo_veiculo_frota[], true, false, false),
  (150, 'Capacete', 'Do condutor e do passageiro, com viseira íntegra', ARRAY['motocicleta']::tipo_veiculo_frota[], true, false, true),
  (160, 'Combustível suficiente para o trecho', NULL, NULL, true, false, false),
  (170, 'Limpeza e condições internas', NULL, NULL, true, true, false),
  (180, 'Avarias externas (lataria/pintura)', 'Confira e registre riscos, amassados ou quebras', NULL, true, true, false);
