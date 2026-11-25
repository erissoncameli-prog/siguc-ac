-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Solicitação ao IMAC de cancelamento/retificação de CAR
-- que incide em Unidade de Conservação (Gestão › Relatórios › CAR na UC)
--
-- Decisões do usuário (25/11/2026):
--   • destinatário: IMAC (Instituto de Meio Ambiente do Acre);
--   • assina: o(a) gestor(a) da UC — nenhuma UC tem gestor_id
--     cadastrado hoje, então o nome de quem assina é gravado no pedido
--     (assinante_nome/cargo), com o usuário logado como sugestão;
--   • acompanhamento no sistema (esta tabela + histórico);
--   • a fundamentação jurídica é MINUTA até o Jurídico validar.
--
-- O que é FATO vs. o que é TEXTO
--   Os números (área, %, zonas, situação no SICAR, datas, agravantes)
--   são calculados pela tela (js/car-uc-relatorio.js — o mesmo cálculo
--   do relatório) e CONGELADOS em `snapshot` no momento da emissão: o
--   SICAR muda, o dossiê precisa provar o que se viu naquele dia. O
--   texto jurídico vem de `car_fundamentacao_modelos` (versionado,
--   hash gerado, nunca editado no lugar) e o texto FINAL, já
--   preenchido, fica gravado no pedido (`fundamentacao_texto`).
--
-- Escrita só por RPC (SECURITY DEFINER, sem policy de escrita).
-- O PDF fica no bucket privado `car-dossies`, sem UPDATE/DELETE: é
-- prova. O SHA-256 do arquivo fica no pedido.
-- ═══════════════════════════════════════════════════════════

-- ── Modelos de fundamentação (versionados) ──────────────────────────
CREATE TABLE IF NOT EXISTS car_fundamentacao_modelos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave         text NOT NULL CHECK (chave IN ('cancelamento_protecao_integral', 'retificacao_uso_sustentavel', 'retificacao_perimetro')),
  versao        integer NOT NULL,
  titulo        text NOT NULL,
  texto         text NOT NULL,
  hash_sha256   text GENERATED ALWAYS AS (encode(sha256(texto::bytea), 'hex')) STORED,
  situacao      text NOT NULL DEFAULT 'minuta' CHECK (situacao IN ('minuta', 'validado')),
  parecer_juridico text,
  validado_por  uuid REFERENCES auth.users(id),
  validado_em   timestamptz,
  criado_por    uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chave, versao)
);
ALTER TABLE car_fundamentacao_modelos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS car_fund_modelos_select ON car_fundamentacao_modelos;
CREATE POLICY car_fund_modelos_select ON car_fundamentacao_modelos
  FOR SELECT TO authenticated USING (pode_ver('monitoramento'));

COMMENT ON TABLE car_fundamentacao_modelos IS
  'Modelos da fundamentação jurídica do pedido ao IMAC (migration 368). Editar = nova versão (car_modelo_salvar_versao); validar = car_modelo_validar (Jurídico). Placeholders {{...}} preenchidos por js/car-uc-cancelamento.js.';

-- ── Pedidos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS car_solicitacoes_contador (
  ano    integer PRIMARY KEY,
  ultimo integer NOT NULL DEFAULT 0
);
ALTER TABLE car_solicitacoes_contador ENABLE ROW LEVEL SECURITY;  -- sem policy: só as RPCs

CREATE TABLE IF NOT EXISTS car_solicitacoes_imac (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo             text NOT NULL UNIQUE,
  uc_id                 uuid NOT NULL REFERENCES unidades_conservacao(id),
  cod_imovel            text NOT NULL,
  tipo_pedido           text NOT NULL CHECK (tipo_pedido IN ('cancelamento', 'retificacao_uso_sustentavel', 'retificacao_perimetro')),
  status                text NOT NULL DEFAULT 'emitido'
                        CHECK (status IN ('emitido', 'enviado_imac', 'declarante_notificado', 'deferido', 'indeferido', 'retificado', 'arquivado')),
  destinatario          text NOT NULL DEFAULT 'IMAC — Instituto de Meio Ambiente do Acre',
  modelo_id             uuid NOT NULL REFERENCES car_fundamentacao_modelos(id),
  modelo_versao         integer NOT NULL,
  modelo_situacao       text NOT NULL,
  fundamentacao_texto   text NOT NULL,
  snapshot              jsonb NOT NULL,
  assinante_nome        text NOT NULL,
  assinante_cargo       text NOT NULL,
  pdf_path              text,
  pdf_sha256            text,
  numero_oficio         text,
  numero_processo       text,
  situacao_sicar_emissao text,
  situacao_sicar_atual  text,
  sicar_conferido_em    timestamptz,
  emitido_por           uuid NOT NULL REFERENCES auth.users(id),
  emitido_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS car_solicitacoes_imac_uc_idx ON car_solicitacoes_imac (uc_id, emitido_em DESC);
-- Um pedido aberto por imóvel e UC: reemitir sem fechar o anterior
-- criaria dois processos para o mesmo fato.
CREATE UNIQUE INDEX IF NOT EXISTS car_solicitacoes_imac_aberto_uq ON car_solicitacoes_imac (uc_id, cod_imovel)
  WHERE status IN ('emitido', 'enviado_imac', 'declarante_notificado');
ALTER TABLE car_solicitacoes_imac ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS car_solicitacoes_imac_select ON car_solicitacoes_imac;
CREATE POLICY car_solicitacoes_imac_select ON car_solicitacoes_imac
  FOR SELECT TO authenticated USING (pode_ver('monitoramento'));

CREATE TABLE IF NOT EXISTS car_solicitacoes_imac_historico (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES car_solicitacoes_imac(id) ON DELETE CASCADE,
  status_de     text,
  status_para   text NOT NULL,
  observacao    text,
  documento_ref text,
  por           uuid REFERENCES auth.users(id),
  em            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS car_sol_hist_idx ON car_solicitacoes_imac_historico (solicitacao_id, em);
ALTER TABLE car_solicitacoes_imac_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS car_sol_hist_select ON car_solicitacoes_imac_historico;
CREATE POLICY car_sol_hist_select ON car_solicitacoes_imac_historico
  FOR SELECT TO authenticated USING (pode_ver('monitoramento'));

-- Trilha de auditoria genérica (migration 269).
CREATE OR REPLACE TRIGGER trg_trilha_car_solicitacoes_imac
  AFTER INSERT OR UPDATE OR DELETE ON car_solicitacoes_imac
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('id');
CREATE OR REPLACE TRIGGER trg_trilha_car_fundamentacao_modelos
  AFTER INSERT OR UPDATE OR DELETE ON car_fundamentacao_modelos
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('id');

-- Leitura com nomes (SECURITY INVOKER: a RLS das tabelas vale).
CREATE OR REPLACE VIEW vw_car_solicitacoes_imac WITH (security_invoker = true) AS
SELECT s.*, uc.nome AS uc_nome, uc.sigla AS uc_sigla,
       u.nome_completo AS emitido_por_nome,
       (SELECT max(h.em) FROM car_solicitacoes_imac_historico h WHERE h.solicitacao_id = s.id) AS ultimo_evento_em
  FROM car_solicitacoes_imac s
  JOIN unidades_conservacao uc ON uc.id = s.uc_id
  LEFT JOIN usuarios u ON u.id = s.emitido_por;

CREATE OR REPLACE VIEW vw_car_solicitacoes_imac_historico WITH (security_invoker = true) AS
SELECT h.*, u.nome_completo AS por_nome
  FROM car_solicitacoes_imac_historico h
  LEFT JOIN usuarios u ON u.id = h.por;

-- ── RPC: emitir ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION car_solicitacao_emitir(
  p_uc_id uuid, p_cod_imovel text, p_tipo text, p_modelo_id uuid,
  p_fundamentacao text, p_snapshot jsonb, p_assinante_nome text, p_assinante_cargo text
) RETURNS TABLE (id uuid, protocolo text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uc     unidades_conservacao%ROWTYPE;
  v_mod    car_fundamentacao_modelos%ROWTYPE;
  v_ano    integer := extract(year FROM now() AT TIME ZONE 'America/Rio_Branco')::int;
  v_n      integer;
  v_prot   text;
  v_id     uuid;
  v_chave  text;
BEGIN
  IF NOT pode_editar('monitoramento') THEN
    RAISE EXCEPTION 'Sem permissão para emitir solicitação ao IMAC';
  END IF;
  SELECT * INTO v_uc FROM unidades_conservacao WHERE unidades_conservacao.id = p_uc_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'UC inválida'; END IF;
  -- Mesma regra do cliente (carucDossieTipo): categorias que admitem
  -- propriedade privada não geram pedido nenhum.
  IF upper(coalesce(v_uc.sigla, '')) IN ('APA', 'ARIE', 'RPPN', 'MONA', 'RVS') THEN
    RAISE EXCEPTION 'A categoria % admite propriedade privada: não cabe pedir cancelamento nem retificação por sobreposição', v_uc.sigla;
  END IF;
  IF coalesce(trim(p_cod_imovel), '') = '' THEN RAISE EXCEPTION 'Nº do CAR obrigatório'; END IF;
  v_chave := CASE p_tipo WHEN 'cancelamento' THEN 'cancelamento_protecao_integral'
                         WHEN 'retificacao_uso_sustentavel' THEN 'retificacao_uso_sustentavel'
                         WHEN 'retificacao_perimetro' THEN 'retificacao_perimetro' END;
  IF v_chave IS NULL THEN RAISE EXCEPTION 'Tipo de pedido inválido'; END IF;
  SELECT * INTO v_mod FROM car_fundamentacao_modelos m WHERE m.id = p_modelo_id;
  IF NOT FOUND OR v_mod.chave <> v_chave THEN RAISE EXCEPTION 'Modelo de fundamentação não corresponde ao tipo do pedido'; END IF;
  IF v_mod.versao <> (SELECT max(m2.versao) FROM car_fundamentacao_modelos m2 WHERE m2.chave = v_chave) THEN
    RAISE EXCEPTION 'O modelo foi atualizado — recarregue a página e gere de novo';
  END IF;
  IF length(coalesce(p_fundamentacao, '')) < 200 THEN RAISE EXCEPTION 'Fundamentação vazia'; END IF;
  IF p_snapshot IS NULL OR NOT (p_snapshot ? 'area_uc_ha') OR NOT (p_snapshot ? 'pct_uc') THEN
    RAISE EXCEPTION 'Dados do dossiê incompletos';
  END IF;
  IF length(trim(coalesce(p_assinante_nome, ''))) < 3 OR length(trim(coalesce(p_assinante_cargo, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe nome e cargo de quem assina';
  END IF;
  IF EXISTS (SELECT 1 FROM car_solicitacoes_imac s WHERE s.uc_id = p_uc_id AND s.cod_imovel = p_cod_imovel
              AND s.status IN ('emitido', 'enviado_imac', 'declarante_notificado')) THEN
    RAISE EXCEPTION 'Já existe pedido em andamento para este CAR nesta UC';
  END IF;

  INSERT INTO car_solicitacoes_contador AS c (ano, ultimo) VALUES (v_ano, 1)
    ON CONFLICT (ano) DO UPDATE SET ultimo = c.ultimo + 1
    RETURNING c.ultimo INTO v_n;
  v_prot := 'SOLCAR-' || v_ano || '-' || lpad(v_n::text, 4, '0');

  INSERT INTO car_solicitacoes_imac (protocolo, uc_id, cod_imovel, tipo_pedido, modelo_id, modelo_versao,
    modelo_situacao, fundamentacao_texto, snapshot, assinante_nome, assinante_cargo,
    situacao_sicar_emissao, situacao_sicar_atual, sicar_conferido_em, emitido_por)
  VALUES (v_prot, p_uc_id, trim(p_cod_imovel), p_tipo, v_mod.id, v_mod.versao, v_mod.situacao,
    p_fundamentacao, p_snapshot, trim(p_assinante_nome), trim(p_assinante_cargo),
    p_snapshot->>'status_sicar', p_snapshot->>'status_sicar', now(), auth.uid())
  RETURNING car_solicitacoes_imac.id INTO v_id;

  INSERT INTO car_solicitacoes_imac_historico (solicitacao_id, status_de, status_para, observacao, por)
  VALUES (v_id, NULL, 'emitido', 'Dossiê emitido (modelo v' || v_mod.versao || ', ' || v_mod.situacao || ')', auth.uid());

  -- LGPD: o dossiê mostra o titular do imóvel (mascarado).
  INSERT INTO lgpd_acesso_dado_terceiro (tabela, cod_imovel, cpf_cnpj, origem, uc_id)
  SELECT 'car_dados_locais', c.cod_imovel, c.cpf_cnpj, 'dossie_car_imac', p_uc_id
    FROM car_dados_locais c WHERE c.cod_imovel = trim(p_cod_imovel);

  RETURN QUERY SELECT v_id, v_prot;
END;
$$;
REVOKE EXECUTE ON FUNCTION car_solicitacao_emitir(uuid, text, text, uuid, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_solicitacao_emitir(uuid, text, text, uuid, text, jsonb, text, text) TO authenticated;

-- ── RPC: registrar o PDF (depois do upload) ─────────────────────────
CREATE OR REPLACE FUNCTION car_solicitacao_registrar_pdf(p_id uuid, p_path text, p_sha256 text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT pode_editar('monitoramento') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Hash inválido'; END IF;
  IF p_path IS NULL OR p_path NOT LIKE '%/' || p_id::text || '.pdf' THEN RAISE EXCEPTION 'Caminho do PDF inválido'; END IF;
  UPDATE car_solicitacoes_imac SET pdf_path = p_path, pdf_sha256 = p_sha256, atualizado_em = now()
   WHERE id = p_id AND pdf_path IS NULL;   -- uma vez só: o dossiê é prova
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente ou PDF já registrado'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION car_solicitacao_registrar_pdf(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_solicitacao_registrar_pdf(uuid, text, text) TO authenticated;

-- ── RPC: mudar status ───────────────────────────────────────────────
-- emitido → enviado_imac → declarante_notificado → deferido|indeferido|retificado
-- (enviado_imac pode ir direto ao resultado); qualquer aberto → arquivado.
CREATE OR REPLACE FUNCTION car_solicitacao_mudar_status(
  p_id uuid, p_status text, p_observacao text, p_documento_ref text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s car_solicitacoes_imac%ROWTYPE;
  v_ok boolean;
BEGIN
  IF NOT pode_editar('monitoramento') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO v_s FROM car_solicitacoes_imac WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente'; END IF;
  v_ok := (v_s.status = 'emitido' AND p_status IN ('enviado_imac', 'arquivado'))
       OR (v_s.status = 'enviado_imac' AND p_status IN ('declarante_notificado', 'deferido', 'indeferido', 'retificado', 'arquivado'))
       OR (v_s.status = 'declarante_notificado' AND p_status IN ('deferido', 'indeferido', 'retificado', 'arquivado'));
  IF NOT v_ok THEN RAISE EXCEPTION 'Mudança de "%" para "%" não é permitida', v_s.status, p_status; END IF;
  IF p_status IN ('deferido', 'indeferido', 'retificado', 'arquivado') AND length(trim(coalesce(p_observacao, ''))) < 10 THEN
    RAISE EXCEPTION 'Descreva a decisão (mínimo 10 caracteres)';
  END IF;
  IF p_status = 'enviado_imac' AND length(trim(coalesce(p_documento_ref, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o nº do ofício ou do processo do envio';
  END IF;

  UPDATE car_solicitacoes_imac SET status = p_status, atualizado_em = now(),
    numero_oficio = CASE WHEN p_status = 'enviado_imac' THEN trim(p_documento_ref) ELSE numero_oficio END,
    numero_processo = CASE WHEN p_status <> 'enviado_imac' AND nullif(trim(coalesce(p_documento_ref, '')), '') IS NOT NULL
                           THEN trim(p_documento_ref) ELSE numero_processo END
   WHERE id = p_id;
  INSERT INTO car_solicitacoes_imac_historico (solicitacao_id, status_de, status_para, observacao, documento_ref, por)
  VALUES (p_id, v_s.status, p_status, nullif(trim(coalesce(p_observacao, '')), ''), nullif(trim(coalesce(p_documento_ref, '')), ''), auth.uid());

  IF v_s.emitido_por <> auth.uid() THEN
    INSERT INTO notificacoes (tipo, titulo, mensagem, destinatario_id, remetente_id, uc_id, meta)
    VALUES ('sistema', 'Pedido ao IMAC ' || v_s.protocolo || ': ' || replace(p_status, '_', ' '),
      'CAR ' || v_s.cod_imovel || ' — situação do pedido atualizada.', v_s.emitido_por, auth.uid(), v_s.uc_id,
      jsonb_build_object('modulo', 'car_imac', 'subtipo', 'status', 'solicitacao_id', p_id, 'ref', 'car_imac_' || p_id || '_' || p_status));
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION car_solicitacao_mudar_status(uuid, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_solicitacao_mudar_status(uuid, text, text, text) TO authenticated;

-- ── RPC: conferência no SICAR (o cliente consulta o WFS ao vivo) ───
CREATE OR REPLACE FUNCTION car_solicitacao_conferir_sicar(p_id uuid, p_situacao text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s car_solicitacoes_imac%ROWTYPE;
BEGIN
  IF NOT pode_ver('monitoramento') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO v_s FROM car_solicitacoes_imac WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente'; END IF;
  UPDATE car_solicitacoes_imac SET situacao_sicar_atual = left(p_situacao, 80), sicar_conferido_em = now() WHERE id = p_id;
  -- Cancelado no SICAR com o pedido ainda aberto: avisa quem emitiu
  -- (o status do pedido NÃO muda sozinho — quem registra a decisão é a gestão).
  IF p_situacao ILIKE 'cancel%' AND coalesce(v_s.situacao_sicar_atual, '') NOT ILIKE 'cancel%'
     AND v_s.status IN ('emitido', 'enviado_imac', 'declarante_notificado') THEN
    INSERT INTO notificacoes (tipo, titulo, mensagem, destinatario_id, uc_id, meta)
    VALUES ('sistema', 'CAR ' || v_s.cod_imovel || ' aparece cancelado no SICAR',
      'O pedido ' || v_s.protocolo || ' segue aberto no sistema. Registre a decisão do IMAC em Relatórios › Solicitações ao IMAC.',
      v_s.emitido_por, v_s.uc_id,
      jsonb_build_object('modulo', 'car_imac', 'subtipo', 'sicar_cancelado', 'solicitacao_id', p_id, 'ref', 'car_imac_cancel_' || p_id));
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION car_solicitacao_conferir_sicar(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_solicitacao_conferir_sicar(uuid, text) TO authenticated;

-- ── RPCs: modelos ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION car_modelo_salvar_versao(p_chave text, p_titulo text, p_texto text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_v integer;
BEGIN
  IF NOT pode_editar('monitoramento') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF length(coalesce(p_texto, '')) < 200 THEN RAISE EXCEPTION 'Texto curto demais'; END IF;
  SELECT coalesce(max(versao), 0) + 1 INTO v_v FROM car_fundamentacao_modelos WHERE chave = p_chave;
  INSERT INTO car_fundamentacao_modelos (chave, versao, titulo, texto)
  VALUES (p_chave, v_v, coalesce(nullif(trim(p_titulo), ''), p_chave), p_texto)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION car_modelo_salvar_versao(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_modelo_salvar_versao(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION car_modelo_validar(p_id uuid, p_parecer text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m car_fundamentacao_modelos%ROWTYPE;
BEGIN
  IF NOT pode_editar('monitoramento') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF length(trim(coalesce(p_parecer, ''))) < 10 THEN RAISE EXCEPTION 'Informe o parecer/nota do Jurídico (mínimo 10 caracteres)'; END IF;
  SELECT * INTO v_m FROM car_fundamentacao_modelos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Modelo inexistente'; END IF;
  IF v_m.versao <> (SELECT max(versao) FROM car_fundamentacao_modelos WHERE chave = v_m.chave) THEN
    RAISE EXCEPTION 'Só a versão mais recente pode ser validada';
  END IF;
  IF position('[CONFERIR' IN v_m.texto) > 0 THEN
    RAISE EXCEPTION 'O texto ainda tem marcas [CONFERIR …]: o Jurídico precisa resolvê-las (salvar nova versão) antes de validar';
  END IF;
  UPDATE car_fundamentacao_modelos SET situacao = 'validado', parecer_juridico = trim(p_parecer),
    validado_por = auth.uid(), validado_em = now() WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION car_modelo_validar(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_modelo_validar(uuid, text) TO authenticated;

-- ── Bucket privado do dossiê (sem UPDATE/DELETE: é prova) ───────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('car-dossies', 'car-dossies', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS car_dossies_read ON storage.objects;
CREATE POLICY car_dossies_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'car-dossies' AND pode_ver('monitoramento'));
DROP POLICY IF EXISTS car_dossies_insert ON storage.objects;
CREATE POLICY car_dossies_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'car-dossies' AND pode_editar('monitoramento'));

-- ── Minutas iniciais (v1, situacao = minuta) ───────────────────────
-- Placeholders preenchidos pela tela: {{uc_nome}} {{uc_categoria}}
-- {{uc_ato_criacao}} {{uc_data_criacao}} {{dispositivo_snuc}}
-- {{cod_imovel}} {{tipo_imovel}} {{municipio}} {{area_total_ha}}
-- {{area_uc_ha}} {{pct_uc}} {{data_inscricao}} {{frase_inscricao}}
-- {{frase_agravantes}} {{situacao_sicar}}.
-- [CONFERIR …] marca o que o Jurídico precisa confirmar; a validação
-- é recusada enquanto houver uma.
INSERT INTO car_fundamentacao_modelos (chave, versao, titulo, texto, criado_por)
SELECT * FROM (VALUES
('cancelamento_protecao_integral', 1, 'Cancelamento — UC de proteção integral',
$t$## Dos fatos
A inscrição {{cod_imovel}} ({{tipo_imovel}}, município de {{municipio}}), com situação "{{situacao_sicar}}" no SICAR, declara como imóvel rural área de {{area_total_ha}} ha, dos quais {{area_uc_ha}} ha ({{pct_uc}} do imóvel) estão no interior da {{uc_nome}}, conforme a interseção geométrica e os mapas deste dossiê. {{frase_inscricao}} {{frase_agravantes}}

## Da unidade de conservação
A {{uc_nome}} foi criada por {{uc_ato_criacao}}, em {{uc_data_criacao}}, na categoria {{uc_categoria}}, do grupo de Proteção Integral da Lei nº 9.985/2000 (SNUC), que admite apenas o uso indireto dos seus recursos naturais (art. 7º, § 1º). Nessa categoria a posse e o domínio são públicos, e as áreas particulares incluídas em seus limites devem ser desapropriadas ({{dispositivo_snuc}}). São proibidas, na unidade, quaisquer alterações, atividades ou modalidades de utilização em desacordo com os seus objetivos, o seu plano de manejo e os seus regulamentos (art. 28).

A Constituição Federal incumbe ao Poder Público definir espaços territoriais especialmente protegidos, vedada qualquer utilização que comprometa a integridade dos atributos que justificam sua proteção (art. 225, § 1º, III).

## Do Cadastro Ambiental Rural
O CAR é registro público eletrônico, de natureza declaratória, obrigatório para os imóveis rurais (Lei nº 12.651/2012, art. 29), e o cadastramento não é considerado título para fins de reconhecimento do direito de propriedade ou posse (art. 29, § 2º). As informações declaradas são de responsabilidade do declarante e, detectadas pendências ou inconsistências, o órgão competente deve notificar o requerente para que preste informações complementares ou promova a correção (Decreto nº 7.830/2012 [CONFERIR artigos 6º e 7º]; Instrução Normativa MMA nº 2/2014 [CONFERIR artigos sobre análise, notificação e cancelamento da inscrição]).

A declaração de posse ou propriedade particular sobre área de posse e domínio públicos, no interior de unidade de proteção integral, é incompatível com o regime jurídico da unidade e constitui inconsistência que impede a manutenção da inscrição.

## Do devido processo
A Administração deve anular os próprios atos quando eivados de vício (Lei nº 9.784/1999, art. 53; Súmula 473 do STF), com motivação (art. 50) e assegurados ao interessado o contraditório e a ampla defesa (Constituição Federal, art. 5º, LV; Lei nº 9.784/1999, arts. 2º e 26). [CONFERIR legislação estadual do CAR/PRA do Acre aplicável.]

## Do pedido
Diante do exposto, a Secretaria de Estado do Meio Ambiente, por meio da gestão da {{uc_nome}}, solicita ao Instituto de Meio Ambiente do Acre – IMAC:
1. a análise da inscrição {{cod_imovel}} à luz da sobreposição demonstrada neste dossiê;
2. a notificação do declarante para, querendo, manifestar-se no prazo legal, assegurados o contraditório e a ampla defesa;
3. ao final, o cancelamento administrativo da inscrição no SICAR, por incidir em unidade de conservação de posse e domínio públicos, com a comunicação do resultado a esta Secretaria.$t$),
('retificacao_uso_sustentavel', 1, 'Retificação — imóvel particular em UC de uso sustentável de domínio público',
$t$## Dos fatos
A inscrição {{cod_imovel}}, registrada como {{tipo_imovel}} (município de {{municipio}}), com situação "{{situacao_sicar}}" no SICAR, declara área de {{area_total_ha}} ha, dos quais {{area_uc_ha}} ha ({{pct_uc}} do imóvel) estão no interior da {{uc_nome}}, conforme a interseção geométrica e os mapas deste dossiê. {{frase_inscricao}} {{frase_agravantes}}

## Da unidade de conservação
A {{uc_nome}} foi criada por {{uc_ato_criacao}}, em {{uc_data_criacao}}, na categoria {{uc_categoria}}, do grupo de Uso Sustentável da Lei nº 9.985/2000 (SNUC). Nessa categoria a posse e o domínio são públicos, e as áreas particulares incluídas em seus limites devem ser desapropriadas ({{dispositivo_snuc}}). A permanência e o uso por populações tradicionais, quando admitidos pela categoria, são regulados por contrato com o órgão gestor (art. 23) [CONFERIR para Floresta Nacional/Estadual: art. 17, § 2º]. São proibidas quaisquer alterações, atividades ou modalidades de utilização em desacordo com os objetivos da unidade, o seu plano de manejo e os seus regulamentos (art. 28).

## Do Cadastro Ambiental Rural
O CAR é registro público eletrônico, de natureza declaratória (Lei nº 12.651/2012, art. 29), e não é título para fins de reconhecimento do direito de propriedade ou posse (art. 29, § 2º). Para os povos e comunidades tradicionais que ocupam a unidade, o cadastro adequado é o de território de povos e comunidades tradicionais (PCT), e não o de imóvel rural particular [CONFERIR fundamento: Lei nº 12.651/2012, art. 3º, parágrafo único; IN MMA nº 2/2014]. Detectadas pendências ou inconsistências, o órgão competente deve notificar o requerente para que promova a correção (Decreto nº 7.830/2012 [CONFERIR artigo 7º]).

A inscrição como imóvel rural particular de área de domínio público, no interior de unidade de uso sustentável, é inconsistente com o regime jurídico da unidade, ressalvado o direito do ocupante tradicional ao cadastro na modalidade própria e à regularização do uso junto ao órgão gestor.

## Do devido processo
A correção ou a anulação do ato observará a motivação (Lei nº 9.784/1999, art. 50), o contraditório e a ampla defesa (Constituição Federal, art. 5º, LV; Lei nº 9.784/1999, arts. 2º e 26) e o dever de autotutela (art. 53). [CONFERIR legislação estadual do CAR/PRA do Acre aplicável.]

## Do pedido
Diante do exposto, a Secretaria de Estado do Meio Ambiente, por meio da gestão da {{uc_nome}}, solicita ao Instituto de Meio Ambiente do Acre – IMAC:
1. a análise da inscrição {{cod_imovel}} à luz da sobreposição demonstrada neste dossiê;
2. a notificação do declarante para retificar a inscrição, (a) adequando-a ao cadastro de povos e comunidades tradicionais, se integrante da população beneficiária da unidade, ou (b) excluindo do perímetro declarado a área sobreposta à unidade;
3. não atendida a notificação no prazo legal, o cancelamento administrativo da inscrição, com a comunicação do resultado a esta Secretaria.$t$),
('retificacao_perimetro', 1, 'Retificação de perímetro — sobreposição parcial com a UC',
$t$## Dos fatos
A inscrição {{cod_imovel}} ({{tipo_imovel}}, município de {{municipio}}), com situação "{{situacao_sicar}}" no SICAR, declara área de {{area_total_ha}} ha, dos quais {{area_uc_ha}} ha ({{pct_uc}} do imóvel) incidem no interior da {{uc_nome}}, conforme a interseção geométrica e os mapas deste dossiê. {{frase_inscricao}} {{frase_agravantes}}

## Da unidade de conservação
A {{uc_nome}} foi criada por {{uc_ato_criacao}}, em {{uc_data_criacao}}, na categoria {{uc_categoria}} da Lei nº 9.985/2000 (SNUC), de posse e domínio públicos, devendo ser desapropriadas as áreas particulares incluídas em seus limites ({{dispositivo_snuc}}). São proibidas quaisquer alterações, atividades ou modalidades de utilização em desacordo com os objetivos da unidade, o seu plano de manejo e os seus regulamentos (art. 28). A Constituição Federal veda qualquer utilização de espaço especialmente protegido que comprometa os atributos que justificam sua proteção (art. 225, § 1º, III).

## Do Cadastro Ambiental Rural
O CAR é registro público eletrônico, de natureza declaratória, que exige planta georreferenciada do perímetro do imóvel (Lei nº 12.651/2012, art. 29, § 1º [CONFERIR inciso]) e não é título de propriedade ou posse (art. 29, § 2º). A parte do perímetro declarado que incide na unidade constitui inconsistência a ser corrigida pelo declarante, mediante notificação do órgão competente (Decreto nº 7.830/2012 [CONFERIR artigo 7º]). Incidências pequenas podem decorrer de imprecisão do levantamento na divisa, o que reforça a via da retificação antes de qualquer medida extrema.

## Do devido processo
A correção observará a motivação (Lei nº 9.784/1999, art. 50), o contraditório e a ampla defesa (Constituição Federal, art. 5º, LV; Lei nº 9.784/1999, arts. 2º e 26). [CONFERIR legislação estadual do CAR/PRA do Acre aplicável.]

## Do pedido
Diante do exposto, a Secretaria de Estado do Meio Ambiente, por meio da gestão da {{uc_nome}}, solicita ao Instituto de Meio Ambiente do Acre – IMAC:
1. a análise da inscrição {{cod_imovel}} à luz da sobreposição demonstrada neste dossiê;
2. a notificação do declarante para retificar o perímetro declarado, excluindo a área de {{area_uc_ha}} ha sobreposta à unidade de conservação;
3. não atendida a notificação no prazo legal, a adoção das medidas cabíveis, inclusive o cancelamento administrativo da inscrição, com a comunicação do resultado a esta Secretaria.$t$)
) AS v(chave, versao, titulo, texto), LATERAL (SELECT NULL::uuid) n(criado_por)
WHERE NOT EXISTS (SELECT 1 FROM car_fundamentacao_modelos m WHERE m.chave = v.chave);

COMMENT ON TABLE car_solicitacoes_imac IS
  'Pedidos ao IMAC de cancelamento/retificação de CAR que incide em UC (migration 368). Escrita só por car_solicitacao_* (SECURITY DEFINER). snapshot = números congelados na emissão; PDF em car-dossies (sem UPDATE/DELETE) com SHA-256.';

-- ROPA (TRAT-013 — CAR).
UPDATE lgpd_tratamentos
   SET observacoes = observacoes || ' Dossiê ao IMAC (migration 368): pedido de cancelamento/retificação de CAR que incide em UC; o PDF leva nº do CAR, titular com CPF/CNPJ mascarado e mapas; snapshot e PDF guardados como prova (bucket privado car-dossies, sem nome nem documento no snapshot); log por emissão com origem dossie_car_imac.'
 WHERE codigo = 'TRAT-013'
   AND observacoes NOT LIKE '%dossie_car_imac%';
