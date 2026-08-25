-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Antecipação de eclosão por temperatura
-- ───────────────────────────────────────────────────────────
-- Temperatura acima da faixa pivotal não é só risco de feminização
-- (094_alertas_quelonios.sql): também ACELERA o desenvolvimento
-- embrionário e antecipa a data de eclosão. A previsão armazenada
-- em ninhos_quelonios (117_especies_incubacao_previsao.sql) é
-- estática (só espécie + data de postura) — nunca revista pela
-- temperatura real observada nas visitas. Esta migration fecha
-- essa lacuna, reaproveitando 100% do mecanismo já existente:
-- mesma tabela de parâmetros por espécie, mesmas funções de
-- avaliação (avaliar_ninho_quelonio/avaliar_visita_ninho, já
-- disparadas a cada leitura de temperatura), mesmo motor de
-- alerta/notificação/dedup, mesmo cron agregado.
--
-- data_prevista_eclosao ORIGINAL nunca é sobrescrita (é o
-- compromisso assumido no achado do ninho, referência histórica
-- para o desvio_dias já calculado por bio_monitoramento_eclosao).
-- A previsão revista mora em colunas NOVAS.
--
-- Depende de 094, 117, 118.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Parâmetro de aceleração térmica + limiar de alerta ────
-- Editável por espécie na mesma tabela dos demais limiares de TSD.
ALTER TABLE parametros_incubacao_quelonios
  ADD COLUMN IF NOT EXISTS acelera_dias_por_grau   numeric(4,2) NOT NULL DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS antecip_alerta_dias_min int          NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS prov_antecipacao        text NOT NULL DEFAULT
    'Eclosão antecipada pela temperatura: intensificar a frequência de visitas nos dias que antecedem a nova data estimada, preparar berçário/equipe com antecedência e registrar para acompanhamento científico da temporada.';

COMMENT ON COLUMN parametros_incubacao_quelonios.acelera_dias_por_grau IS
  'Dias de incubação a menos por °C acima do pivotal (temp_pivotal), aplicado sobre a temperatura MÉDIA observada no ninho (encontro + visitas).';
COMMENT ON COLUMN parametros_incubacao_quelonios.antecip_alerta_dias_min IS
  'Antecipação estimada (dias) a partir da qual o ninho gera alerta de "possível antecipação de eclosão".';

-- ── 2. Previsão revista, armazenada no ninho ─────────────────
ALTER TABLE ninhos_quelonios
  ADD COLUMN IF NOT EXISTS temp_media_observada           numeric(4,1),
  ADD COLUMN IF NOT EXISTS data_prevista_eclosao_ajustada  date,
  ADD COLUMN IF NOT EXISTS dias_antecipacao_estimados      int;

COMMENT ON COLUMN ninhos_quelonios.temp_media_observada IS
  'Média de todas as leituras de temperatura do substrato do ninho (temperatura_c do encontro + visitas_ninho.temperatura_substrato_c). NULL com menos de 2 leituras.';
COMMENT ON COLUMN ninhos_quelonios.data_prevista_eclosao_ajustada IS
  'data_encontro + dias previstos ajustados pela temperatura média observada. NUNCA substitui data_prevista_eclosao (a previsão original é mantida como referência).';
COMMENT ON COLUMN ninhos_quelonios.dias_antecipacao_estimados IS
  'incubacao_dias_previstos − dias ajustados. Positivo = eclosão estimada antes do previsto (calor); negativo não ocorre (piso em incubacao_dias_min do catálogo).';

-- ── 3. Recalcula a previsão ajustada de um ninho ─────────────
-- Chamada pelas funções de avaliação já existentes (seção 4), a
-- cada gravação de temperatura — nunca por trigger próprio, para
-- não duplicar o disparo nem arriscar recursão.
CREATE OR REPLACE FUNCTION bio_recalcular_previsao_ajustada(p_ninho_id uuid)
RETURNS TABLE (
  dias_antecipacao_estimados     int,
  data_prevista_eclosao_ajustada date,
  temp_media_observada           numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  n   ninhos_quelonios%ROWTYPE;
  cat especies_quelonio_catalogo%ROWTYPE;
  pa  parametros_incubacao_quelonios%ROWTYPE;
  v_temp_media   numeric;
  v_n_leituras   int;
  v_dias_min     numeric;
  v_dias_ajust   numeric;
  v_data_ajust   date;
  v_dias_antecip int;
BEGIN
  SELECT * INTO n FROM ninhos_quelonios WHERE id = p_ninho_id;
  IF NOT FOUND OR n.data_encontro IS NULL OR n.incubacao_dias_previstos IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO cat FROM especies_quelonio_catalogo WHERE codigo = n.especie;

  SELECT * INTO pa FROM parametros_incubacao_quelonios
   WHERE ativo AND especie = n.especie LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO pa FROM parametros_incubacao_quelonios
     WHERE ativo AND especie IS NULL LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN; END IF;

  -- Média de todas as leituras conhecidas: a do encontro + cada visita.
  SELECT AVG(t), COUNT(*) INTO v_temp_media, v_n_leituras
    FROM (
      SELECT n.temperatura_c AS t WHERE n.temperatura_c IS NOT NULL
      UNION ALL
      SELECT temperatura_substrato_c FROM visitas_ninho
       WHERE ninho_id = n.id AND temperatura_substrato_c IS NOT NULL
    ) leituras;

  -- Menos de 2 leituras: sinal insuficiente para ajustar — zera o que houver.
  IF v_n_leituras IS NULL OR v_n_leituras < 2 THEN
    UPDATE ninhos_quelonios
       SET temp_media_observada          = ROUND(v_temp_media, 1),
           data_prevista_eclosao_ajustada = NULL,
           dias_antecipacao_estimados     = NULL
     WHERE id = n.id;
    RETURN;
  END IF;

  -- Piso: nunca abaixo do mínimo de incubação do catálogo (evita ajuste
  -- absurdo por leitura isolada de calor extremo).
  v_dias_min   := COALESCE(cat.incubacao_dias_min, n.incubacao_dias_previstos * 0.7);
  v_dias_ajust := GREATEST(
    n.incubacao_dias_previstos - pa.acelera_dias_por_grau * GREATEST(v_temp_media - pa.temp_pivotal, 0),
    v_dias_min
  );
  v_data_ajust    := n.data_encontro + ROUND(v_dias_ajust)::int;
  v_dias_antecip  := n.incubacao_dias_previstos - ROUND(v_dias_ajust)::int;

  UPDATE ninhos_quelonios
     SET temp_media_observada           = ROUND(v_temp_media, 1),
         data_prevista_eclosao_ajustada = v_data_ajust,
         dias_antecipacao_estimados     = v_dias_antecip
   WHERE id = n.id;

  RETURN QUERY SELECT v_dias_antecip, v_data_ajust, ROUND(v_temp_media, 1);
END;
$$;

-- Só chamada internamente pelas funções de avaliação (SECURITY DEFINER);
-- nenhum motivo para o cliente chamar direto.
REVOKE ALL ON FUNCTION bio_recalcular_previsao_ajustada FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 4. Avaliação de NINHO e VISITA — adiciona o alerta de antecipação
--    (corpo idêntico ao da 094, só com o bloco novo ao final)
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
  r   record;
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

  -- ── Antecipação de eclosão (temperatura média observada) ──
  SELECT * INTO r FROM bio_recalcular_previsao_ajustada(n.id);
  IF r.dias_antecipacao_estimados IS NOT NULL AND r.dias_antecipacao_estimados >= pa.antecip_alerta_dias_min THEN
    v_titulo := format('Possível antecipação de eclosão no ninho %s (~%s dia(s), %s °C médios)',
                n.numero_ninho, r.dias_antecipacao_estimados, r.temp_media_observada);
    v_msg := format('Temperatura média de %s °C (pivotal ~%s °C) projeta eclosão ~%s dia(s) antes do previsto original (%s) — nova data estimada %s.',
                r.temp_media_observada, pa.temp_pivotal, r.dias_antecipacao_estimados,
                to_char(n.data_prevista_eclosao,'DD/MM/YYYY'), to_char(r.data_prevista_eclosao_ajustada,'DD/MM/YYYY'));
    PERFORM quelonio_registrar_alerta(
      'ninho','antecipacao_eclosao','Antecipação de eclosão','media',v_titulo,v_msg,pa.prov_antecipacao,pa.referencia,
      r.dias_antecipacao_estimados,NULL,n.id,NULL,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
      'ninho:'||n.id||':antecipacao', p_notificar);
  END IF;
END;
$$;

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
  r   record;
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

  -- ── Antecipação de eclosão (temperatura média observada) ──
  IF vis.ninho_id IS NOT NULL THEN
    SELECT * INTO r FROM bio_recalcular_previsao_ajustada(vis.ninho_id);
    IF r.dias_antecipacao_estimados IS NOT NULL AND r.dias_antecipacao_estimados >= pa.antecip_alerta_dias_min THEN
      v_titulo := format('Possível antecipação de eclosão no ninho %s (~%s dia(s), %s °C médios)',
                  v_label, r.dias_antecipacao_estimados, r.temp_media_observada);
      v_msg := format('Temperatura média de %s °C (pivotal ~%s °C) projeta eclosão ~%s dia(s) antes do previsto original (%s) — nova data estimada %s.',
                  r.temp_media_observada, pa.temp_pivotal, r.dias_antecipacao_estimados,
                  to_char(n.data_prevista_eclosao,'DD/MM/YYYY'), to_char(r.data_prevista_eclosao_ajustada,'DD/MM/YYYY'));
      PERFORM quelonio_registrar_alerta(
        'ninho','antecipacao_eclosao','Antecipação de eclosão','media',v_titulo,v_msg,pa.prov_antecipacao,pa.referencia,
        r.dias_antecipacao_estimados,NULL,vis.ninho_id,vis.id,n.praia_id,n.uc_id,n.grupo_id,n.temporada_id,n.especie,
        'ninho:'||vis.ninho_id||':antecipacao', p_notificar);
    END IF;
  END IF;
END;
$$;

-- Amplia o gatilho existente para também recalcular ao editar a data do
-- achado (a previsão ajustada depende de data_encontro, não só de temp).
DROP TRIGGER IF EXISTS trg_ninho_alertas ON ninhos_quelonios;
CREATE TRIGGER trg_ninho_alertas
  AFTER INSERT OR UPDATE OF temperatura_c, umidade_pct, dist_rio_m, especie, data_encontro
  ON ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_avaliar_ninho_quelonio();

-- ═══════════════════════════════════════════════════════════
-- 5. Alerta agregado — temporada sistematicamente mais quente
--    (mesmo bloco de razão sexual/friagem, chamado pelo cron diário)
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

  -- ── 5.1 Razão sexual por praia/temporada ─────────────────
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

  -- ── 5.2 Atraso de eclosão ─────────────────────────────────
  FOR r IN
    SELECT n.id, n.numero_ninho, n.praia_id, n.uc_id, n.grupo_id, n.temporada_id, n.especie,
           (CURRENT_DATE - n.data_encontro) AS dias
      FROM ninhos_quelonios n
     WHERE n.status IN ('encontrado', 'transferido')
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

  -- ── 5.3 Friagem (frente fria) pelas visitas recentes ─────
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

  -- ── 5.4 Antecipação sistemática por praia/temporada ──────
  -- Não é o ninho isolado (já coberto na avaliação por evento): aqui é o
  -- sinal de TEMPORADA mais quente que o padrão da espécie, mesmo
  -- raciocínio da feminização de praia (5.1) — um alerta por praia+
  -- temporada, nunca repetido (dedup sem componente de data).
  FOR r IN
    SELECT n.praia_id, n.temporada_id, n.uc_id, n.grupo_id, p.nome AS praia_nome,
           COUNT(*) FILTER (WHERE n.dias_antecipacao_estimados IS NOT NULL) AS com_antecip,
           AVG(n.dias_antecipacao_estimados) FILTER (WHERE n.dias_antecipacao_estimados IS NOT NULL) AS media_antecip
      FROM ninhos_quelonios n
      LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
     WHERE n.praia_id IS NOT NULL AND n.temporada_id IS NOT NULL
       AND n.status IN ('encontrado', 'transferido')
     GROUP BY n.praia_id, n.temporada_id, n.uc_id, n.grupo_id, p.nome
  LOOP
    IF r.com_antecip >= pa.razao_min_ninhos AND r.media_antecip >= pa.antecip_alerta_dias_min THEN
      PERFORM quelonio_registrar_alerta(
        'praia','antecipacao_eclosao','Temporada quente — antecipação sistemática','alta',
        format('Antecipação sistemática na praia %s (média ~%s dias, %s ninhos)',
               COALESCE(r.praia_nome,'—'), ROUND(r.media_antecip,1), r.com_antecip),
        format('%s ninhos com antecipação média estimada de %s dia(s) — temporada mais quente que o padrão da espécie nesta praia. Reforçar ronda e preparar berçário com antecedência; registrar para o estudo científico da temporada.',
               r.com_antecip, ROUND(r.media_antecip,1)),
        pa.prov_antecipacao, pa.referencia, r.media_antecip, NULL,
        NULL, NULL, r.praia_id, r.uc_id, r.grupo_id, r.temporada_id, NULL,
        'praia:'||r.praia_id||':temporada:'||r.temporada_id||':antecipacao', true);
      v_total := v_total + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('alertas_novos', v_total, 'executado_em', now());
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. Views — colunas novas SEMPRE ao final (CREATE OR REPLACE
--    não aceita reordenar; vw_ninhos_validacao já nasceu via DROP
--    na 117, mesmo cuidado aqui)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW vw_ninhos_previsao_eclosao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.numero_atual,
  n.especie,
  n.status,
  n.temporada_id,
  n.grupo_id,
  n.data_encontro,
  n.incubacao_dias_previstos,
  n.data_prevista_eclosao,
  n.praia_id,
  n.praia_atual_id,
  pa.nome  AS praia_atual_nome,
  pa.sigla AS praia_atual_sigla,
  (n.data_prevista_eclosao - CURRENT_DATE)                       AS dias_para_eclosao,
  cat.incubacao_dias_max,
  CASE
    WHEN n.status NOT IN ('encontrado','transferido')            THEN 'inativo'
    WHEN n.data_prevista_eclosao IS NULL                         THEN 'sem_previsao'
    WHEN CURRENT_DATE > n.data_encontro
         + COALESCE(cat.incubacao_dias_max, n.incubacao_dias_previstos)
                                                                 THEN 'atrasado'
    WHEN n.data_prevista_eclosao = CURRENT_DATE                  THEN 'hoje'
    WHEN n.data_prevista_eclosao - CURRENT_DATE BETWEEN 0 AND 7  THEN 'atencao'
    ELSE 'normal'
  END                                                            AS faixa_risco,
  CASE
    WHEN n.status NOT IN ('encontrado','transferido')            THEN NULL
    WHEN n.data_prevista_eclosao IS NULL                         THEN 'Sem previsão'
    WHEN CURRENT_DATE > n.data_encontro
         + COALESCE(cat.incubacao_dias_max, n.incubacao_dias_previstos)
      THEN 'Atrasada há ' || (CURRENT_DATE - n.data_prevista_eclosao) || ' dia(s)'
    WHEN n.data_prevista_eclosao = CURRENT_DATE                  THEN 'Prevista para hoje'
    WHEN n.data_prevista_eclosao > CURRENT_DATE
      THEN 'Faltam ' || (n.data_prevista_eclosao - CURRENT_DATE) || ' dia(s)'
    ELSE 'Prevista há ' || (CURRENT_DATE - n.data_prevista_eclosao) || ' dia(s)'
  END                                                            AS situacao,
  -- Antecipação por temperatura — colunas NOVAS ao final
  n.temp_media_observada,
  n.data_prevista_eclosao_ajustada,
  n.dias_antecipacao_estimados
FROM ninhos_quelonios n
LEFT JOIN praias_monitoramento pa            ON pa.id = n.praia_atual_id
LEFT JOIN especies_quelonio_catalogo cat     ON cat.codigo = n.especie;

DROP VIEW IF EXISTS vw_ninhos_validacao;

CREATE VIEW vw_ninhos_validacao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.numero_atual,
  n.especie,
  n.data_encontro,
  n.hora_desova,
  n.status,
  n.status_validacao,
  n.motivo_rejeicao,
  n.observacoes,
  n.foto_urls,
  n.criado_em,
  n.sincronizado_em,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_Y(n.localizacao) END AS lat,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_X(n.localizacao) END AS lng,
  n.precisao_gps_m,
  n.qtd_ovos,
  n.qtd_ovos                   AS ninho_qtd_ovos,
  n.ovos_integros,
  n.ovos_descartados,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'natural'::motivo_descarte)  AS descartados_natural,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'predacao'::motivo_descarte) AS descartados_predacao,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'humana'::motivo_descarte)   AS descartados_humana,
  n.dist_rio_m,
  n.dist_rio_metodo,
  n.temperatura_c,
  n.umidade_pct,
  n.profundidade_cm,
  n.alerta_campo,
  n.temporada_id,
  tmp.nome      AS temporada_nome,
  tmp.ano_base  AS temporada_ano,
  tmp.is_atual  AS temporada_atual,
  p.id          AS praia_id,
  p.nome        AS praia_nome,
  p.codigo      AS praia_codigo,
  n.praia_atual_id,
  pa.nome         AS praia_atual_nome,
  pa.sigla        AS praia_atual_sigla,
  pa.experimental AS praia_atual_experimental,
  uc.nome       AS uc_nome,
  mon.id        AS monitor_id,
  mon.nome_completo AS monitor_nome,
  g.nome        AS grupo_nome,
  g.id          AS grupo_id,
  t.data_transferencia,
  t.qtd_ovos    AS transf_qtd_ovos,
  t.local_destino,
  e.data_nascimento,
  e.filhotes_vivos,
  e.filhotes_mortos,
  e.ovos_nao_nascidos,
  e.predacao,
  n.incubacao_dias_previstos,
  n.data_prevista_eclosao,
  (n.data_prevista_eclosao - CURRENT_DATE) AS dias_para_eclosao,
  -- Antecipação por temperatura — colunas NOVAS ao final
  n.temp_media_observada,
  n.data_prevista_eclosao_ajustada,
  n.dias_antecipacao_estimados
FROM ninhos_quelonios n
LEFT JOIN temporadas_biomonitor tmp    ON tmp.id = n.temporada_id
LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
LEFT JOIN praias_monitoramento pa      ON pa.id = n.praia_atual_id
LEFT JOIN unidades_conservacao uc      ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
LEFT JOIN grupos_biomonitor g          ON g.id = n.grupo_id
LEFT JOIN LATERAL (
  SELECT data_transferencia, qtd_ovos, local_destino
  FROM transferencias_ninho
  WHERE ninho_id = n.id
  ORDER BY data_transferencia DESC
  LIMIT 1
) t ON true
LEFT JOIN LATERAL (
  SELECT data_nascimento, filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao
  FROM eclosoes_ninho
  WHERE ninho_id = n.id
  ORDER BY data_nascimento DESC
  LIMIT 1
) e ON true;

-- ═══════════════════════════════════════════════════════════
-- 7. bio_monitoramento_eclosao — lista de ninhos em antecipação
--    (v.* na CTE já traz as colunas novas da view; só falta expor
--    a lista no jsonb de saída, mesmo padrão de 'atrasados')
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION bio_monitoramento_eclosao(
  p_temporada_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grupo_id uuid;
  v_gestor   boolean := false;
  v_result   jsonb;
BEGIN
  SELECT grupo_id INTO v_grupo_id
    FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo'
   LIMIT 1;

  SELECT EXISTS (SELECT 1 FROM usuarios
                  WHERE id = auth.uid()
                    AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
    INTO v_gestor;

  IF v_grupo_id IS NULL AND NOT v_gestor THEN RETURN NULL; END IF;

  WITH prev AS (
    SELECT v.*
      FROM vw_ninhos_previsao_eclosao v
     WHERE (p_temporada_id IS NULL OR v.temporada_id = p_temporada_id)
       AND (v_gestor OR v.grupo_id = v_grupo_id)
  ),
  incub AS (
    SELECT n.especie,
           AVG(e.data_nascimento - n.data_encontro)::numeric AS real_media,
           AVG(n.incubacao_dias_previstos)::numeric          AS prev_media,
           COUNT(*)                                          AS n_eclosoes,
           SUM(e.filhotes_vivos)                             AS vivos,
           SUM(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos) AS incubados
      FROM ninhos_quelonios n
      JOIN eclosoes_ninho e ON e.ninho_id = n.id
     WHERE (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
       AND (v_gestor OR n.grupo_id = v_grupo_id)
       AND e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
     GROUP BY n.especie
  )
  SELECT jsonb_build_object(
    'gerado_em', now(),
    'contadores', jsonb_build_object(
      'proximos_7d', (SELECT COUNT(*) FROM prev WHERE faixa_risco IN ('atencao','hoje')),
      'hoje',        (SELECT COUNT(*) FROM prev WHERE faixa_risco = 'hoje'),
      'atrasados',   (SELECT COUNT(*) FROM prev WHERE faixa_risco = 'atrasado'),
      'em_incubacao',(SELECT COUNT(*) FROM prev WHERE faixa_risco IN ('normal','atencao','hoje','atrasado')),
      'antecipados', (SELECT COUNT(*) FROM prev WHERE COALESCE(dias_antecipacao_estimados, 0) >= 3)
    ),
    'proximos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ninho_id', id, 'numero', COALESCE(numero_atual, numero_ninho),
        'especie', especie, 'praia', praia_atual_nome,
        'data_prevista', data_prevista_eclosao, 'dias', dias_para_eclosao,
        'faixa', faixa_risco, 'situacao', situacao) ORDER BY data_prevista_eclosao), '[]'::jsonb)
      FROM prev WHERE faixa_risco IN ('atencao','hoje')
    ),
    'atrasados', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ninho_id', id, 'numero', COALESCE(numero_atual, numero_ninho),
        'especie', especie, 'praia', praia_atual_nome,
        'data_prevista', data_prevista_eclosao, 'dias', dias_para_eclosao,
        'situacao', situacao) ORDER BY data_prevista_eclosao), '[]'::jsonb)
      FROM prev WHERE faixa_risco = 'atrasado'
    ),
    -- Ninhos com antecipação estimada relevante (>=3 dias) — o gatilho do
    -- ALERTA usa o limiar configurável de parametros_incubacao_quelonios
    -- (antecip_alerta_dias_min); esta lista é só leitura/relatório,
    -- com piso fixo mais baixo para dar visão cedo ao time científico.
    'antecipados', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ninho_id', id, 'numero', COALESCE(numero_atual, numero_ninho),
        'especie', especie, 'praia', praia_atual_nome,
        'data_prevista_original', data_prevista_eclosao,
        'data_prevista_ajustada', data_prevista_eclosao_ajustada,
        'dias_antecipacao', dias_antecipacao_estimados,
        'temp_media', temp_media_observada
      ) ORDER BY dias_antecipacao_estimados DESC), '[]'::jsonb)
      FROM prev
     WHERE faixa_risco IN ('normal','atencao','hoje') AND COALESCE(dias_antecipacao_estimados, 0) >= 3
    ),
    'por_especie', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'especie', especie,
        'eclosoes', n_eclosoes,
        'taxa_sucesso_pct', ROUND(100.0 * vivos / NULLIF(incubados, 0), 1),
        'incubacao_real_media', ROUND(real_media, 1),
        'incubacao_prevista_media', ROUND(prev_media, 1),
        'desvio_dias', ROUND(real_media - prev_media, 1)
      ) ORDER BY especie), '[]'::jsonb)
      FROM incub
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_monitoramento_eclosao TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════
-- 8. Backfill: recalcula a previsão ajustada dos ninhos ativos
--    já com 2+ leituras de temperatura (sem gerar notificação —
--    mesmo espírito do backfill da 094).
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.id FROM ninhos_quelonios n
     WHERE n.status IN ('encontrado','transferido')
       AND n.data_encontro IS NOT NULL AND n.incubacao_dias_previstos IS NOT NULL
  LOOP
    PERFORM bio_recalcular_previsao_ajustada(r.id);
  END LOOP;

  FOR r IN
    SELECT n.id FROM ninhos_quelonios n
     WHERE n.status IN ('encontrado','transferido')
       AND COALESCE(n.dias_antecipacao_estimados, 0) >=
           (SELECT antecip_alerta_dias_min FROM parametros_incubacao_quelonios
             WHERE ativo AND especie IS NULL LIMIT 1)
  LOOP
    PERFORM avaliar_ninho_quelonio(r.id, false);
  END LOOP;
END $$;
