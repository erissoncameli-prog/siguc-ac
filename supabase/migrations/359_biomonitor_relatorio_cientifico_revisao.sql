-- SIGUC-AC · Biomonitor — 359: revisão do Relatório Científico da Temporada
-- (pages/analise-cientifica-biomonitor.html, js/biomonitor-analise.js).
--
-- Conferência feita contra a temporada 2026/2027 em produção (568 ninhos):
--
-- 1. "Perdas & predação" dizia 0 ovos predados com 26 ovos perdidos no
--    registro (12 predação, 3 humana, 11 natural). `perdas_v` lia só
--    `descartes_ovos.causa`, que o registro do ninho não preenche (ele
--    preenche `motivo`). Mesmo defeito que a 349 corrigiu no Painel —
--    agora lê a fonte única `vw_ninho_ovos` (causa efetiva), nunca refaz
--    a soma. Ganha `ovos_natural` (perda natural sem causa fina).
--
-- 2. Taxas de eclosão no padrão da literatura (Miller 1999, usado pelo
--    PQA/ICMBio). As chaves antigas `taxa_eclosao_pct` e
--    `taxa_mortalidade_embrionaria_pct` NÃO mudam de valor (outras telas
--    as leem com esse significado — regra "nome de campo igual"). Entram
--    chaves NOVAS, com o significado no nome:
--      ovos_incubados        = Σ por ninho aberto de MAIOR(viáveis,
--                              vivos+mortos+não nascidos) — viáveis vem de
--                              vw_ninho_ovos; o MAIOR protege de cadastro
--                              em que a contagem da abertura passa a postura
--      taxa_sucesso_eclosao_pct    = (vivos + mortos) ÷ ovos incubados
--      taxa_emergencia_pct         = vivos ÷ ovos incubados
--      taxa_ovos_nao_eclodidos_pct = não nascidos ÷ ovos incubados
--                                    (proxy de mortalidade embrionária)
--      taxa_mortalidade_filhote_ninho_pct = mortos ÷ (vivos + mortos)
--    Denominador = ovos INCUBADOS, não a postura: ovo descartado no
--    registro (quebrado, predado antes da transferência) não é falha de
--    incubação. O relatório diz isso na metodologia.
--
-- 3. bio_analise_complementar (nova): o que o relatório passa a mostrar e
--    não existia em RPC nenhuma — datas reais dos eventos (fases pela
--    biologia, não por terços do calendário), funil da coorte, eclosão
--    por espécie e por praia de PROTEÇÃO (destino da transferência, com
--    m² por ninho), distribuição da postura, tempo até a transferência,
--    calendário de eclosão previsto e completude dos dados.
--    Mesmo recorte e mesma guarda das irmãs 131/132/133 (auth.uid()).
--    Agregados apenas; nenhuma linha de ninho sai da função.

-- ── 1+2. bio_analise_detalhada ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.bio_analise_detalhada(p_temporada_id uuid DEFAULT NULL::uuid, p_programa_id uuid DEFAULT NULL::uuid, p_uc_id uuid DEFAULT NULL::uuid, p_praia_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  WITH base_ids AS (
    SELECT n.id
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN grupos_biomonitor gb   ON gb.id = n.grupo_id
    WHERE
      (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_programa_id IS NULL OR gb.programa_id = p_programa_id)
      AND (p_uc_id IS NULL OR COALESCE(n.uc_id, p.uc_id) = p_uc_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
  ),
  ovos AS (
    SELECT
      COALESCE(SUM(n.qtd_ovos), 0)        AS total_postura,
      COALESCE(SUM(n.ovos_integros), 0)   AS total_integros,
      COALESCE(SUM(n.ovos_descartados), 0) AS total_descartados,
      COUNT(*) FILTER (WHERE n.qtd_ovos IS NOT NULL) AS n_posturas,
      ROUND(AVG(n.qtd_ovos)::numeric, 1)  AS media_postura
    FROM ninhos_quelonios n JOIN base_ids bi ON bi.id = n.id
  ),
  descartes_causa AS (
    SELECT COALESCE(d.causa::text, d.motivo::text, '—') AS causa,
           COALESCE(SUM(d.qtd), 0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY COALESCE(d.causa::text, d.motivo::text, '—')
    ORDER BY qtd DESC
  ),
  descartes_etapa AS (
    SELECT COALESCE(d.etapa, '—') AS etapa, COALESCE(SUM(d.qtd), 0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY d.etapa ORDER BY qtd DESC
  ),
  ecl AS (
    SELECT
      COALESCE(SUM(e.filhotes_vivos), 0)     AS vivos,
      COALESCE(SUM(e.filhotes_mortos), 0)    AS mortos,
      COALESCE(SUM(e.ovos_nao_nascidos), 0)  AS nao_nasc,
      COALESCE(SUM(e.filhotes_anomalia), 0)  AS anomalia,
      COUNT(*) FILTER (WHERE e.predacao = 'por_pessoas') AS pred_pessoas,
      COUNT(*) FILTER (WHERE e.predacao = 'por_animais') AS pred_animais,
      COUNT(*) FILTER (WHERE e.predacao = 'nenhuma')     AS sem_pred
    FROM eclosoes_ninho e JOIN base_ids bi ON bi.id = e.ninho_id
  ),
  -- Ovos incubados por ninho aberto (padrão da literatura — ver cabeçalho)
  ecl_ninho AS (
    SELECT e.ninho_id,
      SUM(COALESCE(e.filhotes_vivos, 0))    AS vivos,
      SUM(COALESCE(e.filhotes_mortos, 0))   AS mortos,
      SUM(COALESCE(e.ovos_nao_nascidos, 0)) AS nao_nasc
    FROM eclosoes_ninho e JOIN base_ids bi ON bi.id = e.ninho_id
    GROUP BY e.ninho_id
  ),
  incubados AS (
    SELECT COALESCE(SUM(GREATEST(COALESCE(o.viaveis, 0), en.vivos + en.mortos + en.nao_nasc)), 0) AS n
    FROM ecl_ninho en
    LEFT JOIN vw_ninho_ovos o ON o.ninho_id = en.ninho_id
  ),
  anomalia_por_tipo AS (
    SELECT t.tipo::text AS tipo, COUNT(*) AS n_eclosoes
    FROM eclosoes_ninho e
    JOIN base_ids bi ON bi.id = e.ninho_id
    CROSS JOIN UNNEST(e.anomalia_tipos) AS t(tipo)
    WHERE e.filhotes_anomalia > 0
    GROUP BY t.tipo ORDER BY n_eclosoes DESC
  ),
  -- Fonte única das perdas por causa (vw_ninho_ovos, migrations 124/349)
  perdas_v AS (
    SELECT
      COALESCE(SUM(o.perda_alagamento), 0) AS alagamento,
      COALESCE(SUM(o.perda_erosao), 0)     AS erosao,
      COALESCE(SUM(o.perda_humana), 0)     AS humana,
      COALESCE(SUM(o.perda_predacao), 0)   AS predacao,
      COALESCE(SUM(o.perda_natural), 0)    AS perda_nat
    FROM vw_ninho_ovos o JOIN base_ids bi ON bi.id = o.ninho_id
  ),
  ninhos_destr AS (
    SELECT COALESCE(v.causa_destruicao::text, '—') AS causa, COUNT(DISTINCT v.ninho_id) AS n
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
    WHERE v.status_ninho = 'destruido'
    GROUP BY v.causa_destruicao ORDER BY n DESC
  ),
  ninhos_perdidos AS (
    SELECT COUNT(*) AS n FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id WHERE n.status = 'perdido'
  ),
  pred_incub AS (
    SELECT
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'por_animais')  AS animais,
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'por_pessoas')  AS pessoas,
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'desconhecida') AS desconhecida
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
  ),
  pred_solt AS (
    SELECT
      COUNT(*) FILTER (WHERE sf.predacao_soltura)     AS com,
      COUNT(*) FILTER (WHERE NOT sf.predacao_soltura) AS sem
    FROM solturas_filhotes sf JOIN base_ids bi ON bi.id = sf.ninho_id
  ),
  incub AS (
    SELECT
      n.numero_ninho, n.especie,
      (e.data_nascimento - n.data_encontro)                       AS dias_obs,
      CASE WHEN n.data_prevista_eclosao IS NOT NULL
        THEN (n.data_prevista_eclosao - n.data_encontro) END      AS dias_prev
    FROM ninhos_quelonios n JOIN base_ids bi ON bi.id = n.id
    JOIN eclosoes_ninho e ON e.ninho_id = n.id
    WHERE n.data_encontro IS NOT NULL AND e.data_nascimento IS NOT NULL
  ),
  berc AS (
    SELECT
      l.id AS lote_id, l.bercario_nome, n.especie,
      l.data_entrada, l.qtd_entrada,
      sf.data_soltura, sf.qtd_soltada, sf.mortalidade,
      CASE WHEN sf.data_soltura IS NOT NULL
        THEN (sf.data_soltura - l.data_entrada) END AS dias
    FROM lotes_bercario l
    JOIN base_ids bi ON bi.id = l.ninho_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN LATERAL (
      SELECT data_soltura, qtd_soltada, mortalidade
      FROM solturas_filhotes
      WHERE lote_bercario_id = l.id AND via_bercario = true
      ORDER BY data_soltura DESC LIMIT 1
    ) sf ON true
  ),
  bio_serie AS (
    SELECT
      l.id AS lote_id, l.bercario_nome, n.especie,
      ob.data_ocorrencia AS data,
      CASE WHEN e.data_nascimento IS NOT NULL
        THEN (ob.data_ocorrencia - e.data_nascimento) END AS idade_dias,
      ob.comprimento_medio_cm AS comp,
      ob.peso_medio_g         AS peso,
      ob.n_amostrados
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN eclosoes_ninho e ON e.ninho_id = l.ninho_id
    WHERE ob.tipo = 'biometria' AND ob.comprimento_medio_cm IS NOT NULL

    UNION ALL

    SELECT
      l.id AS lote_id, l.bercario_nome, n.especie,
      b.data_medicao AS data,
      CASE WHEN e.data_nascimento IS NOT NULL
        THEN (b.data_medicao - e.data_nascimento) END AS idade_dias,
      b.comprimento_cm AS comp,
      b.peso_g         AS peso,
      1 AS n_amostrados
    FROM biometrias_individuais b
    JOIN filhotes_bercario fb ON fb.id = b.individuo_id
    JOIN lotes_bercario l     ON l.id = fb.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN eclosoes_ninho e ON e.ninho_id = l.ninho_id
    WHERE b.comprimento_cm IS NOT NULL
  ),
  bio_taxa AS (
    SELECT
      s.lote_id, mn.bercario_nome, mn.especie,
      (mx.data - mn.data) AS dias,
      ROUND(((mx.comp - mn.comp) * 10.0 / NULLIF(mx.data - mn.data, 0))::numeric, 2) AS mm_dia,
      ROUND(((mx.peso - mn.peso) / NULLIF(mx.data - mn.data, 0))::numeric, 2)         AS g_dia,
      mn.comp AS comp_ini, mx.comp AS comp_fim
    FROM (SELECT DISTINCT lote_id FROM bio_serie) s
    JOIN LATERAL (SELECT data, comp, peso, bercario_nome, especie FROM bio_serie WHERE lote_id = s.lote_id ORDER BY data ASC  LIMIT 1) mn ON true
    JOIN LATERAL (SELECT data, comp, peso FROM bio_serie WHERE lote_id = s.lote_id ORDER BY data DESC LIMIT 1) mx ON true
    WHERE (mx.data - mn.data) > 0
  ),
  tam_soltura AS (
    SELECT DISTINCT ON (lote_id)
      lote_id, bercario_nome, especie, comp AS comp_ultimo, idade_dias AS idade_ultimo, data
    FROM bio_serie ORDER BY lote_id, data DESC
  )
  SELECT jsonb_build_object(
    'ovos', (
      SELECT jsonb_build_object(
        'total_postura', o.total_postura,
        'total_integros', o.total_integros,
        'total_descartados', o.total_descartados,
        'media_postura', o.media_postura,
        'n_posturas', o.n_posturas,
        'taxa_fertilidade_pct', ROUND(100.0 * o.total_integros / NULLIF(o.total_postura, 0), 1),
        'taxa_descarte_pct',    ROUND(100.0 * o.total_descartados / NULLIF(o.total_postura, 0), 1),
        'descartes_por_causa', (SELECT jsonb_agg(row_to_json(dc)) FROM descartes_causa dc),
        'descartes_por_etapa', (SELECT jsonb_agg(row_to_json(de)) FROM descartes_etapa de)
      ) FROM ovos o
    ),
    'eclosao', (
      SELECT jsonb_build_object(
        'vivos', ec.vivos, 'mortos', ec.mortos, 'nao_nascidos', ec.nao_nasc,
        'taxa_eclosao_pct', ROUND(100.0 * ec.vivos / NULLIF(ec.vivos + ec.mortos + ec.nao_nasc, 0), 1),
        'taxa_mortalidade_embrionaria_pct', ROUND(100.0 * (ec.mortos + ec.nao_nasc) / NULLIF(ec.vivos + ec.mortos + ec.nao_nasc, 0), 1),
        'predacao_pessoas', ec.pred_pessoas, 'predacao_animais', ec.pred_animais, 'sem_predacao', ec.sem_pred,
        'filhotes_anomalia', ec.anomalia,
        'taxa_anomalia_pct', ROUND(100.0 * ec.anomalia / NULLIF(ec.vivos, 0), 1),
        'anomalia_por_tipo', (SELECT jsonb_agg(row_to_json(at)) FROM anomalia_por_tipo at),
        'ninhos_abertos', (SELECT COUNT(*) FROM ecl_ninho),
        'ovos_incubados', (SELECT n FROM incubados),
        'taxa_sucesso_eclosao_pct', ROUND(100.0 * (ec.vivos + ec.mortos) / NULLIF((SELECT n FROM incubados), 0), 1),
        'taxa_emergencia_pct', ROUND(100.0 * ec.vivos / NULLIF((SELECT n FROM incubados), 0), 1),
        'taxa_ovos_nao_eclodidos_pct', ROUND(100.0 * ec.nao_nasc / NULLIF((SELECT n FROM incubados), 0), 1),
        'taxa_mortalidade_filhote_ninho_pct', ROUND(100.0 * ec.mortos / NULLIF(ec.vivos + ec.mortos, 0), 1)
      ) FROM ecl ec
    ),
    'perdas', (
      SELECT jsonb_build_object(
        'ovos_alagamento', pv.alagamento, 'ovos_erosao', pv.erosao,
        'ovos_humana', pv.humana, 'ovos_predacao', pv.predacao,
        'ovos_natural', pv.perda_nat,
        'ninhos_perdidos', (SELECT n FROM ninhos_perdidos),
        'ninhos_por_causa', (SELECT jsonb_agg(row_to_json(nd)) FROM ninhos_destr nd)
      ) FROM perdas_v pv
    ),
    'predacao_fases', jsonb_build_object(
      'incubacao', (SELECT row_to_json(pi) FROM pred_incub pi),
      'eclosao',   (SELECT jsonb_build_object('por_pessoas', pred_pessoas, 'por_animais', pred_animais) FROM ecl),
      'soltura',   (SELECT row_to_json(ps) FROM pred_solt ps)
    ),
    'incubacao', jsonb_build_object(
      'n',            (SELECT COUNT(*) FROM incub),
      'media_dias',   (SELECT ROUND(AVG(dias_obs)::numeric, 1) FROM incub),
      'min_dias',     (SELECT MIN(dias_obs) FROM incub),
      'max_dias',     (SELECT MAX(dias_obs) FROM incub),
      'media_prevista_dias', (SELECT ROUND(AVG(dias_prev)::numeric, 1) FROM incub WHERE dias_prev IS NOT NULL),
      'desvio_medio_dias',   (SELECT ROUND(AVG(dias_obs - dias_prev)::numeric, 1) FROM incub WHERE dias_prev IS NOT NULL),
      'serie', (SELECT jsonb_agg(row_to_json(i)) FROM (SELECT numero_ninho, especie, dias_obs, dias_prev FROM incub ORDER BY dias_obs LIMIT 60) i)
    ),
    'bercario_tempo', jsonb_build_object(
      'n',          (SELECT COUNT(*) FROM berc WHERE dias IS NOT NULL),
      'media_dias', (SELECT ROUND(AVG(dias)::numeric, 1) FROM berc WHERE dias IS NOT NULL),
      'min_dias',   (SELECT MIN(dias) FROM berc WHERE dias IS NOT NULL),
      'max_dias',   (SELECT MAX(dias) FROM berc WHERE dias IS NOT NULL),
      'por_lote', (SELECT jsonb_agg(row_to_json(b)) FROM (
        SELECT bercario_nome, especie, data_entrada, data_soltura, dias, qtd_entrada, qtd_soltada, mortalidade
        FROM berc ORDER BY data_entrada DESC LIMIT 60) b)
    ),
    'crescimento', jsonb_build_object(
      'n_biometrias', (SELECT COUNT(*) FROM bio_serie),
      'serie',        (SELECT jsonb_agg(row_to_json(s)) FROM (
        SELECT bercario_nome, especie, data, idade_dias, comp, peso, n_amostrados
        FROM bio_serie ORDER BY data LIMIT 200) s),
      'taxa_por_lote',(SELECT jsonb_agg(row_to_json(tx)) FROM (
        SELECT bercario_nome, especie, dias, mm_dia, g_dia, comp_ini, comp_fim
        FROM bio_taxa LIMIT 60) tx),
      'tamanho_soltura', (SELECT jsonb_agg(row_to_json(ts)) FROM (
        SELECT bercario_nome, especie, comp_ultimo, idade_ultimo, data
        FROM tam_soltura LIMIT 60) ts)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- ── 3. bio_analise_complementar ────────────────────────────────
CREATE OR REPLACE FUNCTION public.bio_analise_complementar(
  p_temporada_id uuid DEFAULT NULL,
  p_programa_id  uuid DEFAULT NULL,
  p_uc_id        uuid DEFAULT NULL,
  p_praia_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  WITH base AS (
    SELECT n.*
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN grupos_biomonitor gb   ON gb.id = n.grupo_id
    WHERE
      (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_programa_id IS NULL OR gb.programa_id = p_programa_id)
      AND (p_uc_id IS NULL OR COALESCE(n.uc_id, p.uc_id) = p_uc_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
  ),
  ovo AS (
    SELECT b.id, b.especie, b.praia_atual_id, b.status, COALESCE(o.viaveis, 0) AS viaveis
    FROM base b LEFT JOIN vw_ninho_ovos o ON o.ninho_id = b.id
  ),
  ecl_ninho AS (
    SELECT e.ninho_id,
      MIN(e.data_nascimento)                AS data_nasc,
      SUM(COALESCE(e.filhotes_vivos, 0))    AS vivos,
      SUM(COALESCE(e.filhotes_mortos, 0))   AS mortos,
      SUM(COALESCE(e.ovos_nao_nascidos, 0)) AS nao_nasc
    FROM eclosoes_ninho e JOIN base b ON b.id = e.ninho_id
    GROUP BY e.ninho_id
  ),
  aberto AS (
    SELECT o.id, o.especie, o.praia_atual_id, en.vivos, en.mortos, en.nao_nasc,
      GREATEST(o.viaveis, en.vivos + en.mortos + en.nao_nasc) AS incubados
    FROM ovo o JOIN ecl_ninho en ON en.ninho_id = o.id
  ),
  soltura AS (
    SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltos,
           MIN(sf.data_soltura) AS ini, MAX(sf.data_soltura) AS fim
    FROM solturas_filhotes sf JOIN base b ON b.id = sf.ninho_id
  ),
  transf AS (
    SELECT DISTINCT ON (t.ninho_id) t.ninho_id,
      (t.data_transferencia - b.data_encontro) AS dias,
      (t.hora_transferencia IS NOT NULL)       AS com_hora
    FROM transferencias_ninho t JOIN base b ON b.id = t.ninho_id
    WHERE t.data_transferencia IS NOT NULL AND b.data_encontro IS NOT NULL
    ORDER BY t.ninho_id, t.data_transferencia, t.criado_em
  ),
  pendentes AS (
    SELECT b.id, b.especie,
      COALESCE(b.data_prevista_eclosao_ajustada, b.data_prevista_eclosao) AS prev,
      (b.data_prevista_eclosao_ajustada IS NOT NULL) AS ajustada
    FROM base b
    WHERE b.status IN ('encontrado', 'transferido')
      AND NOT EXISTS (SELECT 1 FROM ecl_ninho en WHERE en.ninho_id = b.id)
  ),
  visitas AS (
    SELECT v.ninho_id, v.temperatura_substrato_c
    FROM visitas_ninho v JOIN base b ON b.id = v.ninho_id
  ),
  praias_usadas AS (
    SELECT DISTINCT x.pid FROM (
      SELECT praia_id AS pid FROM base UNION ALL SELECT praia_atual_id FROM base
    ) x WHERE x.pid IS NOT NULL
  ),
  protecao AS (
    SELECT pm.id, pm.nome, pm.area_ha, pm.comprimento_m,
      COUNT(o.id)                                                  AS ninhos,
      COUNT(o.id) FILTER (WHERE b.praia_id IS DISTINCT FROM pm.id) AS recebidos
    FROM praias_monitoramento pm
    JOIN ovo o  ON o.praia_atual_id = pm.id
    JOIN base b ON b.id = o.id
    GROUP BY pm.id
    HAVING COUNT(o.id) FILTER (WHERE b.praia_id IS DISTINCT FROM pm.id) > 0
  )
  SELECT jsonb_build_object(
    'eventos', jsonb_build_object(
      'ninhos',          (SELECT COUNT(*) FROM base),
      'postura_ini',     (SELECT MIN(data_encontro) FROM base),
      'postura_fim',     (SELECT MAX(data_encontro) FROM base),
      'eclosao_ini',     (SELECT MIN(data_nasc) FROM ecl_ninho),
      'eclosao_fim',     (SELECT MAX(data_nasc) FROM ecl_ninho),
      'ninhos_abertos',  (SELECT COUNT(*) FROM ecl_ninho),
      'ninhos_pendentes',(SELECT COUNT(*) FROM pendentes),
      'ninhos_perdidos', (SELECT COUNT(*) FROM base WHERE status = 'perdido'),
      'previsao_ini',    (SELECT MIN(prev) FROM pendentes),
      'previsao_fim',    (SELECT MAX(prev) FROM pendentes),
      'soltura_ini',     (SELECT ini FROM soltura),
      'soltura_fim',     (SELECT fim FROM soltura)
    ),
    'funil', jsonb_build_object(
      'postura',   (SELECT COALESCE(SUM(qtd_ovos), 0) FROM base),
      'viaveis',   (SELECT COALESCE(SUM(viaveis), 0) FROM ovo),
      'em_incubacao', (SELECT COALESCE(SUM(o.viaveis), 0) FROM ovo o WHERE o.id IN (SELECT id FROM pendentes)),
      'incubados_abertos', (SELECT COALESCE(SUM(incubados), 0) FROM aberto),
      'eclodidos', (SELECT COALESCE(SUM(vivos + mortos), 0) FROM aberto),
      'emergidos', (SELECT COALESCE(SUM(vivos), 0) FROM aberto),
      'soltos',    (SELECT soltos FROM soltura)
    ),
    'eclosao_especie', (SELECT jsonb_agg(row_to_json(x) ORDER BY x.incubados DESC) FROM (
      SELECT especie, COUNT(*) AS ninhos, SUM(incubados) AS incubados,
             SUM(vivos) AS vivos, SUM(mortos) AS mortos, SUM(nao_nasc) AS nao_nasc
      FROM aberto GROUP BY especie) x),
    'protecao', (SELECT jsonb_agg(row_to_json(x) ORDER BY x.ninhos DESC) FROM (
      SELECT pr.id, pr.nome, pr.ninhos, pr.recebidos,
        ROUND((pr.area_ha * 10000)::numeric, 0) AS area_m2,
        CASE WHEN pr.area_ha > 0 AND pr.ninhos > 0
          THEN ROUND((pr.area_ha * 10000 / pr.ninhos)::numeric, 1) END AS m2_por_ninho,
        (SELECT COUNT(*) FROM aberto a WHERE a.praia_atual_id = pr.id)                 AS abertos,
        (SELECT COALESCE(SUM(incubados), 0) FROM aberto a WHERE a.praia_atual_id = pr.id) AS incubados,
        (SELECT COALESCE(SUM(vivos), 0)     FROM aberto a WHERE a.praia_atual_id = pr.id) AS vivos,
        (SELECT COALESCE(SUM(mortos), 0)    FROM aberto a WHERE a.praia_atual_id = pr.id) AS mortos,
        (SELECT COALESCE(SUM(nao_nasc), 0)  FROM aberto a WHERE a.praia_atual_id = pr.id) AS nao_nasc
      FROM protecao pr) x),
    'postura', (SELECT jsonb_agg(row_to_json(x) ORDER BY x.especie, x.qtd) FROM (
      SELECT especie, qtd_ovos AS qtd, COUNT(*) AS n
      FROM base WHERE qtd_ovos IS NOT NULL
      GROUP BY especie, qtd_ovos) x),
    'transferencia', jsonb_build_object(
      'n',          (SELECT COUNT(*) FROM transf),
      'com_hora',   (SELECT COUNT(*) FROM transf WHERE com_hora),
      'mesmo_dia',  (SELECT COUNT(*) FROM transf WHERE dias = 0),
      'um_dia',     (SELECT COUNT(*) FROM transf WHERE dias = 1),
      'dois_tres',  (SELECT COUNT(*) FROM transf WHERE dias BETWEEN 2 AND 3),
      'quatro_mais',(SELECT COUNT(*) FROM transf WHERE dias >= 4),
      'negativo',   (SELECT COUNT(*) FROM transf WHERE dias < 0)
    ),
    'calendario', (SELECT jsonb_agg(row_to_json(x) ORDER BY x.semana) FROM (
      SELECT date_trunc('week', prev)::date AS semana, especie,
             COUNT(*) AS ninhos, COUNT(*) FILTER (WHERE ajustada) AS ajustados
      FROM pendentes WHERE prev IS NOT NULL
      GROUP BY 1, 2) x),
    'completude', jsonb_build_object(
      'ninhos',            (SELECT COUNT(*) FROM base),
      'validados',         (SELECT COUNT(*) FROM base WHERE status_validacao = 'validado'),
      'gps_campo',         (SELECT COUNT(*) FROM base WHERE localizacao IS NOT NULL AND NOT COALESCE(localizacao_estimada, false)),
      'gps_estimado',      (SELECT COUNT(*) FROM base WHERE COALESCE(localizacao_estimada, false)),
      'sem_localizacao',   (SELECT COUNT(*) FROM base WHERE localizacao IS NULL),
      'com_hora_desova',   (SELECT COUNT(*) FROM base WHERE hora_desova IS NOT NULL),
      'com_temp_encontro', (SELECT COUNT(*) FROM base WHERE temperatura_c IS NOT NULL),
      'ovos_contados',     (SELECT COUNT(*) FROM base WHERE qtd_ovos IS NOT NULL AND qtd_ovos_estimado_original IS NULL),
      'visitas',           (SELECT COUNT(*) FROM visitas),
      'ninhos_com_visita', (SELECT COUNT(DISTINCT ninho_id) FROM visitas),
      'visitas_com_temp',  (SELECT COUNT(*) FROM visitas WHERE temperatura_substrato_c IS NOT NULL),
      'transferidos',      (SELECT COUNT(*) FROM transf),
      'transf_com_hora',   (SELECT COUNT(*) FROM transf WHERE com_hora),
      'ninhos_abertos',    (SELECT COUNT(*) FROM ecl_ninho),
      'praias_usadas',     (SELECT COUNT(*) FROM praias_usadas),
      'praias_sem_poligono', (SELECT COUNT(*) FROM praias_usadas pu
                                JOIN praias_monitoramento pm ON pm.id = pu.pid
                               WHERE pm.area_geom IS NULL)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- O ALTER DEFAULT PRIVILEGES do projeto concede EXECUTE a anon por nome:
-- revogar explicitamente (lição da 165/297/299).
REVOKE ALL ON FUNCTION public.bio_analise_complementar(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bio_analise_complementar(uuid, uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.bio_analise_complementar(uuid, uuid, uuid, uuid) TO authenticated;
