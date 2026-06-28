-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Alertas científicos de incubação
-- ───────────────────────────────────────────────────────────
-- Interpreta os dados já capturados (ninhos_quelonios e
-- visitas_ninho) à luz da biologia térmica dos quelônios
-- amazônicos e gera alertas + notificações na inbox do gestor
-- quando temperatura, umidade, alagamento, predação ou a razão
-- sexual da praia saem da faixa ideal para o clima do Acre.
--
-- Base científica (limiares-semente, editáveis em tabela):
--  · Determinação sexual pela temperatura (TSD) — sem cromossomo
--    sexual; acima do pivotal → fêmeas, abaixo → machos.
--  · Podocnemis expansa: pivotal ~32,7 °C (mais alto já registrado
--    em quelônios); sobrevivência por frio em torno de 28 °C.
--  · Podocnemis unifilis (tracajá): pivotal ~32 °C (manejo de
--    referência Embrapa/Xingu como bioindicador climático).
--  · Estação de desova no Acre coincide com a vazante (jun–out):
--    pico de calor/dessecação, friagens (frentes frias) e pulso
--    de inundação dos rios — todos modelados como alertas.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Novo tipo de notificação (inbox do Painel do Gestor) ──
ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'alerta_quelonios';

-- ── 2. Enums de apoio ────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE escopo_alerta_quelonio AS ENUM ('ninho','visita','praia','temporada','sazonal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE status_alerta_quelonio AS ENUM ('aberto','ciente','resolvido','descartado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════
-- 3. Parâmetros de incubação (limiares editáveis por espécie)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS parametros_incubacao_quelonios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  especie             especie_quelonio,            -- NULL = padrão (todas as espécies)
  nome_referencia     text NOT NULL,

  -- Temperatura do substrato (°C) — bandas de TSD/viabilidade
  temp_letal_min      numeric(4,1) NOT NULL DEFAULT 28.0,  -- < : letal por frio / desenvolvimento parado
  temp_macho_max      numeric(4,1) NOT NULL DEFAULT 31.0,  -- letal_min–macho_max : predomínio de machos
  temp_pivotal        numeric(4,1) NOT NULL DEFAULT 32.0,  -- razão sexual 1:1
  temp_femea_min      numeric(4,1) NOT NULL DEFAULT 33.0,  -- > : predomínio de fêmeas
  temp_critico_max    numeric(4,1) NOT NULL DEFAULT 36.0,  -- > : feminização total + mortalidade (letal ~38)

  -- Umidade do substrato (%)
  umidade_min_pct     numeric(4,1) NOT NULL DEFAULT 6.0,   -- < : dessecação dos ovos
  umidade_max_pct     numeric(4,1) NOT NULL DEFAULT 90.0,  -- > : saturação / hipóxia / fungos

  -- Proximidade do rio / alagamento
  dist_rio_min_m      numeric(6,1) NOT NULL DEFAULT 10.0,  -- < : risco de alagamento do ninho

  -- Incubação
  incubacao_dias_max  int NOT NULL DEFAULT 75,             -- > sem eclosão : atraso / inviabilidade

  -- Friagem (frente fria) — temperatura do ar
  friagem_temp_ar_min numeric(4,1) NOT NULL DEFAULT 20.0,

  -- Razão sexual agregada da praia (fração de ninhos "tendência fêmea")
  razao_femea_max_pct numeric(4,1) NOT NULL DEFAULT 70.0,  -- > : alerta de feminização da praia
  razao_min_ninhos    int NOT NULL DEFAULT 5,              -- mínimo de ninhos para avaliar a praia

  -- Providências (texto que acompanha cada alerta)
  prov_frio           text NOT NULL DEFAULT 'Verificar friagem; cobrir o ninho à noite para conservar calor; acompanhar diariamente a temperatura.',
  prov_calor_mod      text NOT NULL DEFAULT 'Sombrear o ninho (cobertura vegetal/sombrite) e reforçar as visitas — temperatura puxando a razão sexual para fêmeas.',
  prov_calor_extremo  text NOT NULL DEFAULT 'Ação urgente: sombreamento + umedecer o substrato; em caso extremo, transferir os ovos para local sombreado/berçário. Risco de mortalidade embrionária.',
  prov_seco           text NOT NULL DEFAULT 'Irrigação leve do substrato e sombreamento para evitar dessecação dos ovos.',
  prov_encharcado     text NOT NULL DEFAULT 'Drenar/desobstruir o entorno; verificar alagamento e fungos; avaliar transferência se a saturação persistir.',
  prov_alagamento     text NOT NULL DEFAULT 'Transferência imediata dos ovos para cota mais alta — risco de afogamento total do ninho.',
  prov_predacao       text NOT NULL DEFAULT 'Reforçar a vigilância/cercamento do ninho; registrar a perda e avaliar transferência dos ovos restantes.',
  prov_feminizacao    text NOT NULL DEFAULT 'Praia com forte viés térmico para fêmeas (sinal de aquecimento): avaliar manejo de sombreamento/realocação para equilibrar a razão sexual.',
  prov_friagem        text NOT NULL DEFAULT 'Frente fria (friagem) detectada: proteger os ninhos do resfriamento; acompanhar mortalidade e possível atraso de desenvolvimento.',
  prov_atraso         text NOT NULL DEFAULT 'Incubação além do período esperado sem eclosão: inspecionar o ninho — possível inviabilidade ou desenvolvimento retardado por frio.',

  referencia          text,
  ativo               boolean NOT NULL DEFAULT true,
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

-- Uma única linha por espécie e uma única linha-padrão (especie IS NULL).
-- NULLS NOT DISTINCT (PG15+) trata o NULL da linha-padrão como único.
CREATE UNIQUE INDEX IF NOT EXISTS uq_param_especie
  ON parametros_incubacao_quelonios (especie) NULLS NOT DISTINCT;

ALTER TABLE parametros_incubacao_quelonios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "param_inc_select" ON parametros_incubacao_quelonios
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "param_inc_write" ON parametros_incubacao_quelonios
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('gestor','super_admin') AND ativo)
  );

CREATE TRIGGER trg_param_inc_updated
  BEFORE UPDATE ON parametros_incubacao_quelonios
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Seeds: padrão geral + ajustes específicos por espécie
INSERT INTO parametros_incubacao_quelonios (especie, nome_referencia, referencia)
VALUES (NULL, 'Padrão — quelônios amazônicos (Podocnemis spp.)',
        'Faixas gerais de TSD/viabilidade para Podocnemis; pivotal ~32 °C, letalidade por frio ~28 °C.')
ON CONFLICT DO NOTHING;

INSERT INTO parametros_incubacao_quelonios
  (especie, nome_referencia, temp_pivotal, temp_femea_min, temp_critico_max, referencia)
VALUES
  ('tartaruga', 'Tartaruga-da-amazônia (Podocnemis expansa)', 32.7, 33.5, 36.5,
   'Pivotal ~32,7 °C (mais alto registrado em quelônios); sobrevivência por frio ~28 °C.'),
  ('tracaja', 'Tracajá (Podocnemis unifilis)', 32.0, 33.0, 36.0,
   'Pivotal ~32 °C; bioindicador climático (manejo Embrapa/Xingu).')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- 4. Tabela de alertas gerados
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS alertas_quelonios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escopo          escopo_alerta_quelonio NOT NULL,
  parametro       text NOT NULL,   -- temp_substrato | umidade | alagamento | dist_rio | predacao | razao_sexual | friagem | atraso_eclosao
  faixa           text NOT NULL,   -- rótulo da banda científica
  severidade      severidade_ocorrencia NOT NULL,
  titulo          text NOT NULL,
  mensagem        text NOT NULL,
  providencia     text NOT NULL,
  referencia      text,
  valor_num       numeric,
  valor_texto     text,

  -- Vínculos
  ninho_id        uuid REFERENCES ninhos_quelonios(id) ON DELETE CASCADE,
  visita_id       uuid REFERENCES visitas_ninho(id) ON DELETE CASCADE,
  praia_id        uuid REFERENCES praias_monitoramento(id) ON DELETE SET NULL,
  uc_id           uuid REFERENCES unidades_conservacao(id) ON DELETE SET NULL,
  grupo_id        uuid REFERENCES grupos_biomonitor(id) ON DELETE SET NULL,
  temporada_id    uuid REFERENCES temporadas_biomonitor(id) ON DELETE SET NULL,
  especie         especie_quelonio,

  -- Tratamento
  status          status_alerta_quelonio NOT NULL DEFAULT 'aberto',
  resolvido_por   uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  resolvido_em    timestamptz,
  observacao      text,

  dedup_key       text UNIQUE NOT NULL,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alq_ninho   ON alertas_quelonios (ninho_id);
CREATE INDEX IF NOT EXISTS idx_alq_visita  ON alertas_quelonios (visita_id);
CREATE INDEX IF NOT EXISTS idx_alq_grupo   ON alertas_quelonios (grupo_id);
CREATE INDEX IF NOT EXISTS idx_alq_status  ON alertas_quelonios (status);
CREATE INDEX IF NOT EXISTS idx_alq_sev     ON alertas_quelonios (severidade);
CREATE INDEX IF NOT EXISTS idx_alq_criado  ON alertas_quelonios (criado_em DESC);

ALTER TABLE alertas_quelonios ENABLE ROW LEVEL SECURITY;

-- Monitor vê alertas do próprio grupo; gestor/técnico/super_admin veem todos
CREATE POLICY "alq_select" ON alertas_quelonios
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM monitores_biodiversidade m
      WHERE m.usuario_id = auth.uid() AND m.grupo_id = alertas_quelonios.grupo_id
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.perfil IN ('gestor','super_admin','tecnico') AND u.ativo
    )
  );

-- Tratamento (ciente/resolver) por gestor/técnico/super_admin
CREATE POLICY "alq_update" ON alertas_quelonios
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.perfil IN ('gestor','super_admin','tecnico') AND u.ativo)
  );

-- ═══════════════════════════════════════════════════════════
-- 5. Helper: emite notificações na inbox do Painel do Gestor
--    Destinatários: coordenador do grupo + gestores/super_admins
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION quelonio_emitir_notificacoes(p_alerta_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a              alertas_quelonios%ROWTYPE;
  v_dest         uuid;
  v_sla          int;
  v_titulo       text;
  v_msg          text;
  v_notif_id     uuid;
BEGIN
  SELECT * INTO a FROM alertas_quelonios WHERE id = p_alerta_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_sla   := CASE a.severidade WHEN 'critica' THEN 24 WHEN 'alta' THEN 48 ELSE 72 END;
  v_titulo := a.titulo;
  v_msg := a.mensagem || E'\n\nProvidência: ' || a.providencia
           || COALESCE(E'\nReferência: ' || a.referencia, '');

  FOR v_dest IN
    SELECT DISTINCT uid FROM (
      -- coordenador(es) do grupo com login
      SELECT m.usuario_id AS uid
        FROM monitores_biodiversidade m
       WHERE m.grupo_id = a.grupo_id
         AND m.funcao = 'coordenador'
         AND m.usuario_id IS NOT NULL
      UNION
      -- gestores e super_admins ativos
      SELECT u.id FROM usuarios u
       WHERE u.perfil IN ('gestor','super_admin') AND u.ativo
    ) r
    WHERE uid IS NOT NULL
  LOOP
    INSERT INTO notificacoes (
      tipo, status, titulo, mensagem,
      destinatario_id, uc_id, sla_horas, sla_prazo, meta
    ) VALUES (
      'alerta_quelonios', 'enviada', v_titulo, v_msg,
      v_dest, a.uc_id, v_sla, now() + make_interval(hours => v_sla),
      jsonb_build_object(
        'origem', 'biomonitor_quelonios',
        'alerta_id', a.id,
        'ninho_id', a.ninho_id,
        'parametro', a.parametro,
        'severidade', a.severidade
      )
    )
    RETURNING id INTO v_notif_id;

    INSERT INTO notificacoes_historico
      (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
    VALUES
      (v_notif_id, NULL, 'enviada', v_dest, 'Gerada pelo Biomonitor de Quelônios.');
  END LOOP;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. Helper: registra um alerta (idempotente) e notifica
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION quelonio_registrar_alerta(
  p_escopo       escopo_alerta_quelonio,
  p_parametro    text,
  p_faixa        text,
  p_severidade   severidade_ocorrencia,
  p_titulo       text,
  p_mensagem     text,
  p_providencia  text,
  p_referencia   text,
  p_valor_num    numeric,
  p_valor_texto  text,
  p_ninho_id     uuid,
  p_visita_id    uuid,
  p_praia_id     uuid,
  p_uc_id        uuid,
  p_grupo_id     uuid,
  p_temporada_id uuid,
  p_especie      especie_quelonio,
  p_dedup_key    text,
  p_notificar    boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO alertas_quelonios (
    escopo, parametro, faixa, severidade, titulo, mensagem, providencia,
    referencia, valor_num, valor_texto, ninho_id, visita_id, praia_id,
    uc_id, grupo_id, temporada_id, especie, dedup_key
  ) VALUES (
    p_escopo, p_parametro, p_faixa, p_severidade, p_titulo, p_mensagem, p_providencia,
    p_referencia, p_valor_num, p_valor_texto, p_ninho_id, p_visita_id, p_praia_id,
    p_uc_id, p_grupo_id, p_temporada_id, p_especie, p_dedup_key
  )
  ON CONFLICT (dedup_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL AND p_notificar AND p_severidade IN ('alta','critica') THEN
    PERFORM quelonio_emitir_notificacoes(v_id);
  END IF;

  RETURN v_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 7. Avaliação de um NINHO (no encontro/sync)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION avaliar_ninho_quelonio(
  p_ninho_id  uuid,
  p_notificar boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  n   ninhos_quelonios%ROWTYPE;
  pa  parametros_incubacao_quelonios%ROWTYPE;
  t   numeric;
  u   numeric;
  v_faixa text; v_sev severidade_ocorrencia; v_prov text; v_titulo text; v_msg text;
BEGIN
  SELECT * INTO n FROM ninhos_quelonios WHERE id = p_ninho_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO pa FROM parametros_incubacao_quelonios
   WHERE ativo AND especie = n.especie LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO pa FROM parametros_incubacao_quelonios
     WHERE ativo AND especie IS NULL LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN; END IF;

  -- ── Temperatura do substrato ──────────────────────────────
  t := n.temperatura_c;
  IF t IS NOT NULL THEN
    v_faixa := NULL;
    IF t < pa.temp_letal_min THEN
      v_faixa := 'Letal por frio'; v_sev := 'critica'; v_prov := pa.prov_frio;
    ELSIF t >= pa.temp_critico_max THEN
      v_faixa := 'Calor extremo'; v_sev := 'critica'; v_prov := pa.prov_calor_extremo;
    ELSIF t >= pa.temp_femea_min THEN
      v_faixa := 'Feminização'; v_sev := 'media'; v_prov := pa.prov_calor_mod;
    END IF;  -- faixa pivotal/machos = ideal, sem alerta

    IF v_faixa IS NOT NULL THEN
      v_titulo := format('Temperatura %s no ninho %s (%s °C)',
                  lower(v_faixa), n.numero_ninho, t);
      v_msg := format('Ninho %s: substrato a %s °C — faixa "%s" (pivotal ~%s °C, ideal %s–%s °C).',
                  n.numero_ninho, t, v_faixa, pa.temp_pivotal, pa.temp_macho_max, pa.temp_femea_min);
      PERFORM quelonio_registrar_alerta(
        'ninho','temp_substrato',v_faixa,v_sev,v_titulo,v_msg,v_prov,pa.referencia,
        t,NULL,n.id,NULL,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
        'ninho:'||n.id||':temp:'||v_faixa, p_notificar);
    END IF;
  END IF;

  -- ── Umidade do substrato (%) ──────────────────────────────
  u := n.umidade_pct;
  IF u IS NOT NULL THEN
    IF u < pa.umidade_min_pct THEN
      v_titulo := format('Substrato seco no ninho %s (%s%%)', n.numero_ninho, u);
      v_msg := format('Umidade do substrato em %s%% (mínimo ideal %s%%) — risco de dessecação dos ovos.', u, pa.umidade_min_pct);
      PERFORM quelonio_registrar_alerta(
        'ninho','umidade','Substrato seco','alta',v_titulo,v_msg,pa.prov_seco,pa.referencia,
        u,NULL,n.id,NULL,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
        'ninho:'||n.id||':umid:seco', p_notificar);
    ELSIF u > pa.umidade_max_pct THEN
      v_titulo := format('Substrato encharcado no ninho %s (%s%%)', n.numero_ninho, u);
      v_msg := format('Umidade do substrato em %s%% (máximo ideal %s%%) — risco de hipóxia/fungos.', u, pa.umidade_max_pct);
      PERFORM quelonio_registrar_alerta(
        'ninho','umidade','Substrato encharcado','alta',v_titulo,v_msg,pa.prov_encharcado,pa.referencia,
        u,NULL,n.id,NULL,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
        'ninho:'||n.id||':umid:encharcado', p_notificar);
    END IF;
  END IF;

  -- ── Distância ao rio (risco de alagamento) ────────────────
  IF n.dist_rio_m IS NOT NULL AND n.dist_rio_m < pa.dist_rio_min_m THEN
    v_titulo := format('Ninho %s muito próximo do rio (%s m)', n.numero_ninho, n.dist_rio_m);
    v_msg := format('Ninho a %s m do rio (mínimo seguro %s m) — risco de alagamento.', n.dist_rio_m, pa.dist_rio_min_m);
    PERFORM quelonio_registrar_alerta(
      'ninho','dist_rio','Risco de alagamento','alta',v_titulo,v_msg,pa.prov_alagamento,pa.referencia,
      n.dist_rio_m,NULL,n.id,NULL,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
      'ninho:'||n.id||':dist_rio', p_notificar);
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 8. Avaliação de uma VISITA (acompanhamento da incubação)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION avaliar_visita_ninho(
  p_visita_id uuid,
  p_notificar boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  vis visitas_ninho%ROWTYPE;
  n   ninhos_quelonios%ROWTYPE;
  pa  parametros_incubacao_quelonios%ROWTYPE;
  t   numeric;
  v_faixa text; v_sev severidade_ocorrencia; v_prov text; v_titulo text; v_msg text;
  v_label text;
BEGIN
  SELECT * INTO vis FROM visitas_ninho WHERE id = p_visita_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF vis.ninho_id IS NOT NULL THEN
    SELECT * INTO n FROM ninhos_quelonios WHERE id = vis.ninho_id;
  END IF;
  v_label := COALESCE(n.numero_ninho, 'sem nº');

  SELECT * INTO pa FROM parametros_incubacao_quelonios
   WHERE ativo AND especie = n.especie LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO pa FROM parametros_incubacao_quelonios
     WHERE ativo AND especie IS NULL LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN; END IF;

  -- ── Temperatura do substrato na visita ────────────────────
  t := vis.temperatura_substrato_c;
  IF t IS NOT NULL THEN
    v_faixa := NULL;
    IF t < pa.temp_letal_min THEN
      v_faixa := 'Letal por frio'; v_sev := 'critica'; v_prov := pa.prov_frio;
    ELSIF t >= pa.temp_critico_max THEN
      v_faixa := 'Calor extremo'; v_sev := 'critica'; v_prov := pa.prov_calor_extremo;
    ELSIF t >= pa.temp_femea_min THEN
      v_faixa := 'Feminização'; v_sev := 'media'; v_prov := pa.prov_calor_mod;
    END IF;
    IF v_faixa IS NOT NULL THEN
      v_titulo := format('Temperatura %s na visita ao ninho %s (%s °C)', lower(v_faixa), v_label, t);
      v_msg := format('Visita de %s ao ninho %s: substrato a %s °C — faixa "%s" (pivotal ~%s °C).',
                  to_char(vis.data_visita,'DD/MM'), v_label, t, v_faixa, pa.temp_pivotal);
      PERFORM quelonio_registrar_alerta(
        'visita','temp_substrato',v_faixa,v_sev,v_titulo,v_msg,v_prov,pa.referencia,
        t,NULL,vis.ninho_id,vis.id,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
        'visita:'||vis.id||':temp', p_notificar);
    END IF;
  END IF;

  -- ── Umidade qualitativa do substrato ──────────────────────
  IF vis.umidade = 'seco' THEN
    v_titulo := format('Substrato seco na visita ao ninho %s', v_label);
    v_msg := format('Visita de %s: substrato classificado como SECO — risco de dessecação dos ovos.', to_char(vis.data_visita,'DD/MM'));
    PERFORM quelonio_registrar_alerta(
      'visita','umidade','Substrato seco','alta',v_titulo,v_msg,pa.prov_seco,pa.referencia,
      NULL,'seco',vis.ninho_id,vis.id,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
      'visita:'||vis.id||':umid', p_notificar);
  ELSIF vis.umidade = 'encharcado' THEN
    v_titulo := format('Substrato encharcado na visita ao ninho %s', v_label);
    v_msg := format('Visita de %s: substrato ENCHARCADO — risco de hipóxia/afogamento e fungos.', to_char(vis.data_visita,'DD/MM'));
    PERFORM quelonio_registrar_alerta(
      'visita','umidade','Substrato encharcado','alta',v_titulo,v_msg,pa.prov_encharcado,pa.referencia,
      NULL,'encharcado',vis.ninho_id,vis.id,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
      'visita:'||vis.id||':umid', p_notificar);
  END IF;

  -- ── Alagamento ────────────────────────────────────────────
  IF vis.sinal_alagamento OR vis.status_ninho = 'alagado' THEN
    v_titulo := format('Sinal de alagamento no ninho %s', v_label);
    v_msg := format('Visita de %s: sinal de alagamento detectado — ninho em risco de afogamento.', to_char(vis.data_visita,'DD/MM'));
    PERFORM quelonio_registrar_alerta(
      'visita','alagamento','Alagamento','critica',v_titulo,v_msg,pa.prov_alagamento,pa.referencia,
      NULL,NULL,vis.ninho_id,vis.id,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
      'visita:'||vis.id||':alag', p_notificar);
  END IF;

  -- ── Predação / perturbação durante a incubação ────────────
  IF vis.predacao_incubacao IN ('por_animais','por_pessoas')
     OR vis.status_ninho IN ('parcial_predado','destruido','perturbado') THEN
    v_sev := CASE WHEN vis.status_ninho = 'destruido' THEN 'critica' ELSE 'alta' END;
    v_titulo := format('Predação/perturbação no ninho %s', v_label);
    v_msg := format('Visita de %s: ninho "%s"%s.', to_char(vis.data_visita,'DD/MM'), vis.status_ninho,
              CASE WHEN vis.ovos_predados_n IS NOT NULL THEN format(' (%s ovos predados)', vis.ovos_predados_n) ELSE '' END);
    PERFORM quelonio_registrar_alerta(
      'visita','predacao','Predação/perturbação',v_sev,v_titulo,v_msg,pa.prov_predacao,pa.referencia,
      vis.ovos_predados_n,vis.status_ninho::text,vis.ninho_id,vis.id,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
      'visita:'||vis.id||':predacao', p_notificar);
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 9. Triggers de avaliação automática (no sync/insert/update)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_avaliar_ninho_quelonio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM avaliar_ninho_quelonio(NEW.id, true);
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_ninho_alertas ON ninhos_quelonios;
CREATE TRIGGER trg_ninho_alertas
  AFTER INSERT OR UPDATE OF temperatura_c, umidade_pct, dist_rio_m, especie
  ON ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_avaliar_ninho_quelonio();

CREATE OR REPLACE FUNCTION trg_avaliar_visita_ninho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM avaliar_visita_ninho(NEW.id, true);
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_visita_alertas ON visitas_ninho;
CREATE TRIGGER trg_visita_alertas
  AFTER INSERT OR UPDATE OF temperatura_substrato_c, umidade, sinal_alagamento, predacao_incubacao, status_ninho
  ON visitas_ninho
  FOR EACH ROW EXECUTE FUNCTION trg_avaliar_visita_ninho();

-- ═══════════════════════════════════════════════════════════
-- 10. Alertas agregados / sazonais (chamado pelo cron diário)
--     · Razão sexual da praia (feminização — sinal climático)
--     · Atraso de eclosão
--     · Friagem (frente fria pelas visitas)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION quelonio_avaliar_agregados()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pa  parametros_incubacao_quelonios%ROWTYPE;
  r   record;
  v_pct numeric;
  v_total int := 0;
BEGIN
  SELECT * INTO pa FROM parametros_incubacao_quelonios WHERE ativo AND especie IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro','sem parâmetro padrão'); END IF;

  -- ── 10.1 Razão sexual por praia/temporada ────────────────
  FOR r IN
    SELECT n.praia_id, n.temporada_id, n.uc_id, n.grupo_id,
           p.nome AS praia_nome,
           COUNT(*) FILTER (WHERE n.temperatura_c IS NOT NULL) AS com_temp,
           COUNT(*) FILTER (WHERE n.temperatura_c >= pa.temp_femea_min) AS femeas
      FROM ninhos_quelonios n
      LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
     WHERE n.praia_id IS NOT NULL AND n.temporada_id IS NOT NULL
     GROUP BY n.praia_id, n.temporada_id, n.uc_id, n.grupo_id, p.nome
  LOOP
    IF r.com_temp >= pa.razao_min_ninhos THEN
      v_pct := ROUND(100.0 * r.femeas / r.com_temp, 1);
      IF v_pct > pa.razao_femea_max_pct THEN
        PERFORM quelonio_registrar_alerta(
          'praia','razao_sexual','Feminização da praia','alta',
          format('Feminização na praia %s (%s%% tendência fêmea)', COALESCE(r.praia_nome,'—'), v_pct),
          format('%s de %s ninhos com temperatura acima de %s °C — forte viés para fêmeas (sinal de aquecimento).',
                 r.femeas, r.com_temp, pa.temp_femea_min),
          pa.prov_feminizacao, pa.referencia, v_pct, NULL,
          NULL, NULL, r.praia_id, r.uc_id, r.grupo_id, r.temporada_id, NULL,
          'praia:'||r.praia_id||':temporada:'||r.temporada_id||':razao_sexual', true);
        v_total := v_total + 1;
      END IF;
    END IF;
  END LOOP;

  -- ── 10.2 Atraso de eclosão ───────────────────────────────
  FOR r IN
    SELECT n.id, n.numero_ninho, n.praia_id, n.uc_id, n.grupo_id, n.temporada_id, n.especie,
           (CURRENT_DATE - n.data_encontro) AS dias
      FROM ninhos_quelonios n
     WHERE n.status IN ('encontrado','transferido')
       AND (CURRENT_DATE - n.data_encontro) > pa.incubacao_dias_max
       AND NOT EXISTS (SELECT 1 FROM eclosoes_ninho e WHERE e.ninho_id = n.id)
  LOOP
    PERFORM quelonio_registrar_alerta(
      'ninho','atraso_eclosao','Atraso de eclosão','media',
      format('Atraso de eclosão no ninho %s (%s dias)', r.numero_ninho, r.dias),
      format('Ninho com %s dias de incubação sem eclosão (esperado até %s dias).', r.dias, pa.incubacao_dias_max),
      pa.prov_atraso, pa.referencia, r.dias, NULL,
      r.id, NULL, r.praia_id, r.uc_id, r.grupo_id, r.temporada_id, r.especie,
      'ninho:'||r.id||':atraso', true);
    v_total := v_total + 1;
  END LOOP;

  -- ── 10.3 Friagem (frente fria) pelas visitas recentes ────
  FOR r IN
    SELECT n.praia_id, n.uc_id, n.grupo_id,
           p.nome AS praia_nome,
           COUNT(*) AS visitas_frias,
           MIN(v.temperatura_ar_c) AS temp_min
      FROM visitas_ninho v
      JOIN ninhos_quelonios n ON n.id = v.ninho_id
      LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
     WHERE v.data_visita >= CURRENT_DATE - 4
       AND v.temperatura_ar_c IS NOT NULL
       AND v.temperatura_ar_c < pa.friagem_temp_ar_min
       AND n.praia_id IS NOT NULL
     GROUP BY n.praia_id, n.uc_id, n.grupo_id, p.nome
    HAVING COUNT(*) >= 2
  LOOP
    PERFORM quelonio_registrar_alerta(
      'sazonal','friagem','Friagem','alta',
      format('Friagem na praia %s (mín. %s °C)', COALESCE(r.praia_nome,'—'), r.temp_min),
      format('%s visitas com ar abaixo de %s °C nos últimos dias — frente fria sobre os ninhos.',
             r.visitas_frias, pa.friagem_temp_ar_min),
      pa.prov_friagem, pa.referencia, r.temp_min, NULL,
      NULL, NULL, r.praia_id, r.uc_id, r.grupo_id, NULL, NULL,
      'praia:'||r.praia_id||':friagem:'||to_char(CURRENT_DATE,'IYYY-IW'), true);
    v_total := v_total + 1;
  END LOOP;

  RETURN jsonb_build_object('alertas_novos', v_total, 'executado_em', now());
END;
$$;
GRANT EXECUTE ON FUNCTION quelonio_avaliar_agregados TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════
-- 11. View para a UI (alertas abertos com nomes)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW vw_alertas_quelonios
WITH (security_invoker = true)
AS
SELECT
  a.*,
  n.numero_ninho,
  p.nome  AS praia_nome,
  uc.nome AS uc_nome,
  g.nome  AS grupo_nome,
  ur.nome_completo AS resolvido_por_nome
FROM alertas_quelonios a
LEFT JOIN ninhos_quelonios n        ON n.id = a.ninho_id
LEFT JOIN praias_monitoramento p    ON p.id = a.praia_id
LEFT JOIN unidades_conservacao uc   ON uc.id = a.uc_id
LEFT JOIN grupos_biomonitor g       ON g.id = a.grupo_id
LEFT JOIN usuarios ur               ON ur.id = a.resolvido_por;

-- ═══════════════════════════════════════════════════════════
-- 12. RPC: tratar (ciente/resolver/descartar) um alerta
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION quelonio_tratar_alerta(
  p_alerta_id  uuid,
  p_status     status_alerta_quelonio,
  p_observacao text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios u
                  WHERE u.id = auth.uid() AND u.perfil IN ('gestor','super_admin','tecnico') AND u.ativo) THEN
    RAISE EXCEPTION 'Sem permissão para tratar alertas.';
  END IF;

  UPDATE alertas_quelonios
     SET status        = p_status,
         observacao    = COALESCE(p_observacao, observacao),
         resolvido_por = CASE WHEN p_status IN ('resolvido','descartado') THEN auth.uid() ELSE resolvido_por END,
         resolvido_em  = CASE WHEN p_status IN ('resolvido','descartado') THEN now() ELSE resolvido_em END
   WHERE id = p_alerta_id;
END;
$$;
GRANT EXECUTE ON FUNCTION quelonio_tratar_alerta TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 13. Backfill: avalia ninhos/visitas existentes SEM notificar
--     (só cria as linhas de alerta para já aparecerem na UI)
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM ninhos_quelonios
            WHERE temperatura_c IS NOT NULL OR umidade_pct IS NOT NULL OR dist_rio_m IS NOT NULL
  LOOP
    PERFORM avaliar_ninho_quelonio(r.id, false);
  END LOOP;

  FOR r IN SELECT id FROM visitas_ninho
  LOOP
    PERFORM avaliar_visita_ninho(r.id, false);
  END LOOP;
END $$;
