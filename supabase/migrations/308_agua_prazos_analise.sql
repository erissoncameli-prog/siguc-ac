-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — prazo de preservação da amostra
-- Entrega 3 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md,
-- §4.5 do desenho original: "só possível porque o PDF é lido".
--
-- O QUE ESTA MIGRATION CRIA
-- `agua_prazos_analise`: prazo de preservação por parâmetro (tempo
-- máximo entre COLETA e ANÁLISE recomendado pelo Standard Methods for
-- the Examination of Water and Wastewater, mesma norma que o laudo do
-- QUILAB cita). Em TABELA, não em código — mesmo motivo de
-- `agua_limites_conama` e `agua_laudo_templates`: prazo é parâmetro
-- de referência normativa, não lógica; cadastrar um parâmetro novo
-- (ou corrigir um prazo) é INSERT/UPDATE, nunca migração de código.
--
-- `agua_coletas.data_recebimento_laboratorio`: o laudo do QUILAB
-- imprime essa data ("Recebimento no laboratório: DD/MM/AAAA"), mas o
-- schema (migration 248) nunca teve onde guardá-la — só existia
-- coleta e resultado, não o intervalo entre os dois. Sem essa coluna,
-- a checagem de prazo simplesmente não tem o segundo lado da conta.
--
-- ESTE LAUDO NÃO IMPRIME DATA DA ANÁLISE EM SI (só coleta e
-- recebimento) — decisão adotada: usar RECEBIMENTO como proxy do
-- início da análise. É uma aproximação FAVORÁVEL ao laboratório (a
-- análise em si só pode ocorrer depois do recebimento, nunca antes),
-- então um alerta disparado por essa conta é um piso do atraso real,
-- nunca um alarme inflado.
--
-- ALERTA INFORMATIVO, NUNCA BLOQUEIA — mesmo espírito de toda a malha
-- (agua_avaliar_coleta, migration 302): estourar o prazo não significa
-- "resultado errado", significa "resultado com validade analítica
-- comprometida", e isso tem de ficar REGISTRADO na coleta para uma
-- fiscalização futura encontrar, não descoberto numa auditoria anos
-- depois. Nunca impede salvar, nem na mesa nem no app.
--
-- POR QUE UMA FUNÇÃO SEPARADA, NÃO DENTRO DE agua_avaliar_coleta
-- `agua_avaliar_coleta` recebe VALORES medidos (jsonb) e compara com
-- histórico — muda de assunto para "quanto tempo levou para chegar ao
-- laboratório" misturaria duas perguntas diferentes na mesma função.
-- `agua_prazo_preservacao_alertas` tem assinatura própria (datas +
-- lista de parâmetros presentes na amostra) e é chamada só onde faz
-- sentido: no lançamento do laudo, quando as duas datas existem.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agua_prazos_analise (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parametro     text NOT NULL UNIQUE,
  prazo_horas   numeric(6,1) NOT NULL CHECK (prazo_horas > 0),
  refrigeracao_exigida boolean NOT NULL DEFAULT false,
  observacao    text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_agua_prazos_updated ON agua_prazos_analise;
CREATE TRIGGER trg_agua_prazos_updated BEFORE UPDATE ON agua_prazos_analise
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE agua_prazos_analise ENABLE ROW LEVEL SECURITY;

CREATE POLICY agua_prazos_select ON agua_prazos_analise
  FOR SELECT TO authenticated USING (pode_ver('agua'));
CREATE POLICY agua_prazos_insert ON agua_prazos_analise
  FOR INSERT TO authenticated WITH CHECK (pode_editar('agua'));
CREATE POLICY agua_prazos_update ON agua_prazos_analise
  FOR UPDATE TO authenticated USING (pode_editar('agua')) WITH CHECK (pode_editar('agua'));
CREATE POLICY agua_prazos_delete ON agua_prazos_analise
  FOR DELETE TO authenticated USING (pode_editar('agua'));

REVOKE ALL ON agua_prazos_analise FROM anon;

-- Prazos do Standard Methods 24ª ED (a mesma norma citada no laudo do
-- QUILAB), para os parâmetros que este módulo já mede. Refrigeração
-- exigida = amostra tem de chegar gelada; informativo aqui (não há
-- como o laudo provar temperatura de transporte), mas registrado
-- porque é o mesmo dado que justifica o prazo mais curto.
INSERT INTO agua_prazos_analise (parametro, prazo_horas, refrigeracao_exigida, observacao) VALUES
  ('coliformes_termotolerantes', 24,  true,  'Standard Methods 9060 — amostra refrigerada, análise em até 24h da coleta.'),
  ('coliformes_totais',          24,  true,  'Standard Methods 9060 — mesmo prazo dos termotolerantes.'),
  ('escherichia_coli',           24,  true,  'Standard Methods 9060 — mesmo prazo dos demais indicadores microbiológicos.'),
  ('od',                          0.5,false, 'Oxigênio dissolvido: medição in situ ou imediata — método Winkler não tolera espera relevante.'),
  ('dbo',                        48,  true,  'Standard Methods 5210 — refrigerado, análise em até 48h.'),
  ('ph',                          2,  false, 'Standard Methods 4500-H — muda com CO2 atmosférico; análise o quanto antes.'),
  ('nitrogenio_amoniacal',       28,  true,  'Standard Methods 4500-NH3 — refrigerado ou acidificado, 28 dias com preservação; 28h sem preservação (conservador aqui).'),
  ('nitrogenio_total',           28,  true,  'Mesma preservação do nitrogênio amoniacal.'),
  ('nitratos',                   48,  true,  'Standard Methods 4500-NO3 — refrigerado, 48h.'),
  ('fosforo_total',              28,  true,  'Standard Methods 4500-P — refrigerado ou acidificado, mesmo prazo do nitrogênio.'),
  ('ortofosfato_dissolvido',     48,  true,  'Amostra filtrada e refrigerada — análise em até 48h.'),
  ('turbidez',                   48,  false, 'Standard Methods 2130 — 48h, ao abrigo de luz.'),
  ('condutividade_eletrica',     28,  false, 'Standard Methods 2510 — estável por semanas refrigerada; prazo conservador.'),
  ('cloreto',                   720,  false, 'Standard Methods 4500-Cl — amostra estável, até 30 dias.'),
  ('alcalinidade_total',         14,  true,  'Standard Methods 2320 — refrigerado, 14h recomendado.'),
  ('carbono_organico_total',     28,  true,  'Standard Methods 5310 — refrigerado/acidificado, 28h.'),
  ('solidos_dissolvidos_totais',168,  true,  'Standard Methods 2540 — refrigerado, 7 dias.'),
  ('solidos_suspensao_totais',  168,  true,  'Standard Methods 2540 — mesmo prazo dos sólidos dissolvidos.')
ON CONFLICT (parametro) DO NOTHING;

-- ── Data de recebimento no laboratório ─────────────────────────
ALTER TABLE agua_coletas
  ADD COLUMN IF NOT EXISTS data_recebimento_laboratorio date;

COMMENT ON COLUMN agua_coletas.data_recebimento_laboratorio IS
  'Data em que a amostra chegou ao laboratório (o laudo imprime isso separado da data da coleta). Usada como proxy do início da análise para o alerta de prazo de preservação — este laudo não imprime data de análise em si, e recebimento é aproximação FAVORÁVEL (a análise só pode ocorrer depois).';

-- ── Recria a view enumerando as colunas (armadilha da 260/304) ──
CREATE OR REPLACE VIEW vw_agua_coletas_detalhe
WITH (security_invoker = true) AS
SELECT
  c.id, c.ponto_id, c.campanha_id, c.laboratorio_id, c.data_coleta, c.hora_coleta,
  c.coletor_id, c.coletor_nome, c.localizacao, c.foto_url, c.laudo_url,
  c.temp_ar, c.temp_amostra, c.ph, c.od, c.turbidez, c.condutividade_eletrica,
  c.dbo, c.nitrogenio_total, c.nitrogenio_amoniacal, c.nitratos, c.fosforo_total,
  c.ortofosfato_dissolvido, c.solidos_dissolvidos_totais, c.solidos_suspensao_totais,
  c.coliformes_termotolerantes, c.coliformes_totais, c.escherichia_coli,
  c.alcalinidade_total, c.carbono_organico_total, c.cloreto,
  c.condutividade_especifica, c.descarga_liquida, c.censurados, c.status,
  c.quarentena_motivo, c.observacoes, c.linha_origem_planilha, c.criado_por,
  c.criado_em, c.atualizado_em,
  p.codigo_ana, p.nome AS ponto_nome, p.municipio AS ponto_municipio,
  p.rio AS ponto_rio, p.bacia AS ponto_bacia, p.classe_enquadramento, p.uc_id,
  ST_Y(p.geom) AS ponto_lat, ST_X(p.geom) AS ponto_lng,
  ca.ano AS campanha_ano, ca.ordem AS campanha_ordem,
  l.nome AS laboratorio_nome,
  ST_Y(c.localizacao) AS lat, ST_X(c.localizacao) AS lng,
  CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
       THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END AS delta_temperatura,
  (c.temp_ar IS NULL OR c.temp_amostra IS NULL) AS delta_temperatura_neutro,
  agua_od_saturacao(c.od, c.temp_amostra) AS od_saturacao,
  CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
       THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
       ELSE NULL::numeric END AS solidos_totais,
  agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
    c.nitrogenio_total, c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
         ELSE NULL::numeric END
  ) AS iqa,
  agua_iqa_faixa(agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
    c.nitrogenio_total, c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
         ELSE NULL::numeric END
  )) AS iqa_faixa,
  agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total) AS conama_violacoes,
  CASE WHEN agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total) IS NULL THEN NULL::boolean
       ELSE cardinality(agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total)) = 0
  END AS conama_conforme,
  c.codigo_amostra,
  c.excluido_em, c.excluido_por, c.exclusao_justificativa,
  CASE WHEN c.localizacao IS NULL THEN NULL::numeric
       ELSE ST_Distance(c.localizacao::geography, p.geom::geography)::numeric END AS distancia_ponto_metros,
  agua_gps_faixa(CASE WHEN c.localizacao IS NULL THEN NULL::numeric
       ELSE ST_Distance(c.localizacao::geography, p.geom::geography)::numeric END) AS gps_confirmacao,
  c.origem_dados,
  -- ── Acrescentado nesta migration (Entrega 3) — só no fim é permitido ──
  c.data_recebimento_laboratorio
FROM agua_coletas c
JOIN agua_pontos_coleta p ON p.id = c.ponto_id
JOIN agua_campanhas ca ON ca.id = c.campanha_id
LEFT JOIN agua_laboratorios l ON l.id = c.laboratorio_id
WHERE c.excluido_em IS NULL;

-- ── agua_atualizar_coleta ganha data_recebimento_laboratorio na whitelist ──
-- Mesma mudança cirúrgica da 306 (corpo muda, assinatura intacta).
CREATE OR REPLACE FUNCTION agua_atualizar_coleta(p_id uuid, p_campos jsonb, p_justificativa text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_permitidas text[] := ARRAY[
    'observacoes','data_coleta','hora_coleta','status','quarentena_motivo',
    'laboratorio_id','laudo_url',
    'temp_ar','temp_amostra','ph','od','turbidez','condutividade_eletrica',
    'dbo','nitrogenio_total','nitrogenio_amoniacal','nitratos','fosforo_total',
    'ortofosfato_dissolvido','solidos_dissolvidos_totais','solidos_suspensao_totais',
    'coliformes_termotolerantes','coliformes_totais','escherichia_coli',
    'alcalinidade_total','carbono_organico_total','cloreto',
    'condutividade_especifica','descarga_liquida',
    'origem_dados','data_recebimento_laboratorio'
  ];
  v_col text;
BEGIN
  IF NOT pode_editar('agua') THEN
    RAISE EXCEPTION 'Sem permissão para editar dados de Qualidade da Água.';
  END IF;
  IF NOT agua_reauth_valida(5) THEN
    RAISE EXCEPTION 'REAUTH_NECESSARIA';
  END IF;
  IF char_length(btrim(COALESCE(p_justificativa,''))) < 20 THEN
    RAISE EXCEPTION 'Justificativa precisa de pelo menos 20 caracteres.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agua_coletas WHERE id = p_id AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'Coleta não encontrada.';
  END IF;

  FOR v_col IN SELECT jsonb_object_keys(p_campos) LOOP
    IF NOT (v_col = ANY(v_permitidas)) THEN
      RAISE EXCEPTION 'Campo não permitido: %', v_col;
    END IF;
  END LOOP;

  PERFORM set_config('app.justificativa', p_justificativa, true);

  UPDATE agua_coletas t SET (
    observacoes, data_coleta, hora_coleta, status, quarentena_motivo,
    laboratorio_id, laudo_url,
    temp_ar, temp_amostra, ph, od, turbidez, condutividade_eletrica,
    dbo, nitrogenio_total, nitrogenio_amoniacal, nitratos, fosforo_total,
    ortofosfato_dissolvido, solidos_dissolvidos_totais, solidos_suspensao_totais,
    coliformes_termotolerantes, coliformes_totais, escherichia_coli,
    alcalinidade_total, carbono_organico_total, cloreto,
    condutividade_especifica, descarga_liquida,
    origem_dados, data_recebimento_laboratorio
  ) = (
    SELECT
      observacoes, data_coleta, hora_coleta, status, quarentena_motivo,
      laboratorio_id, laudo_url,
      temp_ar, temp_amostra, ph, od, turbidez, condutividade_eletrica,
      dbo, nitrogenio_total, nitrogenio_amoniacal, nitratos, fosforo_total,
      ortofosfato_dissolvido, solidos_dissolvidos_totais, solidos_suspensao_totais,
      coliformes_termotolerantes, coliformes_totais, escherichia_coli,
      alcalinidade_total, carbono_organico_total, cloreto,
      condutividade_especifica, descarga_liquida,
      origem_dados, data_recebimento_laboratorio
    FROM jsonb_populate_record(t, p_campos)
  )
  WHERE t.id = p_id;
END;
$$;

-- ── A função do alerta ─────────────────────────────────────────
-- p_parametros: lista dos parâmetros que TÊM valor nesta amostra
-- (só faz sentido avisar sobre o que foi de fato medido). Devolve
-- lista vazia sem nenhuma das duas datas — nunca inventa alerta por
-- falta de dado. STABLE, não SECURITY DEFINER: só lê a tabela de
-- referência (RLS de pode_ver já autoriza) e faz conta com datas.
CREATE OR REPLACE FUNCTION agua_prazo_preservacao_alertas(
  p_data_coleta      date,
  p_data_recebimento date,
  p_parametros        text[]
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_out    jsonb := '[]'::jsonb;
  v_horas  numeric;
  v_prazo  record;
BEGIN
  IF p_data_coleta IS NULL OR p_data_recebimento IS NULL OR p_parametros IS NULL THEN
    RETURN v_out;
  END IF;

  -- Recebimento antes da coleta é erro de digitação, não prazo —
  -- fica para a malha de coerência já existente notar (fora do escopo
  -- desta função: aqui só se avalia prazo, nunca se aceita intervalo
  -- negativo como "zero horas").
  IF p_data_recebimento < p_data_coleta THEN
    RETURN v_out;
  END IF;

  v_horas := EXTRACT(EPOCH FROM (p_data_recebimento::timestamp - p_data_coleta::timestamp)) / 3600;

  FOR v_prazo IN
    SELECT parametro, prazo_horas, refrigeracao_exigida
    FROM agua_prazos_analise
    WHERE parametro = ANY(p_parametros)
      AND prazo_horas < v_horas
  LOOP
    v_out := v_out || jsonb_build_object(
      'parametro', v_prazo.parametro,
      'tipo', 'prazo',
      'nivel', 'informar',
      'mensagem', format(
        'Recebida no laboratório %s h após a coleta — acima do prazo de preservação (%s h)%s. Resultado com validade analítica comprometida.',
        agua_num_br(round(v_horas,1)),
        agua_num_br(v_prazo.prazo_horas),
        CASE WHEN v_prazo.refrigeracao_exigida THEN ', mesmo com refrigeração' ELSE '' END),
      'horas_decorridas', round(v_horas, 1),
      'prazo_horas', v_prazo.prazo_horas
    );
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION agua_prazo_preservacao_alertas(date, date, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_prazo_preservacao_alertas(date, date, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION agua_prazo_preservacao_alertas(date, date, text[]) TO authenticated;
