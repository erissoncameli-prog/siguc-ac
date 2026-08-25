-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — unifica cálculos de ovos/filhotes entre
-- páginas e relatórios (auditoria completa, ver
-- docs/biomonitor-calculos-ovos-filhotes.md)
-- ───────────────────────────────────────────────────────────────
-- Mapeamento criterioso encontrou seis problemas reais, não só
-- "campo faltando na tela":
--
-- 1. BUG CONFIRMADO: vw_descartes_ovos nunca ganhou a coluna `causa`
--    (existe em descartes_ovos desde a 123, nunca propagada pela
--    view). relatorios-biomonitor.html já fazia
--    `.select('motivo,causa,qtd')` contra essa view — erro 42703
--    (coluna não existe), a chamada falha inteira, e a seção
--    "Descarte de ovos por causa" do relatório ficava SEMPRE
--    zerada, em silêncio. Esta é a causa raiz mais provável do que
--    o usuário viu.
-- 2. bio_relatorio_completo recalculava "ovos viáveis" com uma
--    fórmula própria (soma agregada) em vez de reusar a view
--    canônica vw_ninho_ovos (124) — mesma regra, implementação
--    duplicada, sem a quebra por causa fina (alagamento/erosão/
--    humana) que a view canônica já tem.
-- 3. bio_analise_detalhada.perdas somava direto de visitas_ninho,
--    ignorando descartes lançados em outra etapa (registro/eclosão)
--    e deleções em cascata — pode divergir do total canônico.
-- 4. bio_analise_praias contava "eclodidos" só por
--    status='eclodido', diferente de todo o resto do sistema
--    (que já inclui em_bercario/soltado desde a 146).
-- 5. bio_dados_aba recalculava mortalidade de berçário na mão,
--    sem o piso "nunca menor que o confirmado na soltura" que
--    vw_lotes_bercario_mortalidade (133) já garante — 3 fórmulas
--    coexistindo (app, relatório, tela de berçário).
-- 6. Cálculos que só existem em bio_analise_detalhada (Análise
--    Científica) e nunca chegam a bio_relatorio_completo (a RPC
--    usada por relatorios-biomonitor.html e pelos PDFs): taxa de
--    mortalidade embrionária, descartes por etapa, ninhos
--    destruídos por causa, predação por fase (incubação/eclosão/
--    soltura). E o campo total_filhotes_vivos_liquido já existe no
--    JSON desde a 133/150 mas nenhuma tela o exibe.
--
-- Esta migration reconcilia as 5 fontes de dado (postura, eclosão,
-- descartes/visitas, berçário individual, berçário agregado) em UM
-- ponto por consumidor, sem inventar tabela nova. Aditiva/CREATE OR
-- REPLACE em cima de assinaturas já existentes — nenhuma quebra de
-- contrato para quem já consome essas RPCs/views.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Fix do bug: vw_descartes_ovos ganha `causa` ────────────────
CREATE OR REPLACE VIEW vw_descartes_ovos
WITH (security_invoker = true)
AS
SELECT
  d.id,
  d.ninho_id,
  d.qtd,
  d.motivo,
  d.etapa,
  d.data_descarte,
  n.especie,
  n.grupo_id,
  n.temporada_id,
  n.praia_id,
  pp.nome  AS praia_nome,
  n.praia_atual_id,
  pa.nome  AS praia_atual_nome,
  uc.nome  AS uc_nome,
  mon.nome_completo AS monitor_nome,
  d.causa
FROM descartes_ovos d
-- ⚠ `causa` fica ao FINAL da lista (CREATE OR REPLACE VIEW não aceita
-- reordenar colunas de view existente — erro 42P16, achado ao aplicar).
JOIN ninhos_quelonios n            ON n.id = d.ninho_id
LEFT JOIN praias_monitoramento pp  ON pp.id = n.praia_id
LEFT JOIN praias_monitoramento pa  ON pa.id = n.praia_atual_id
LEFT JOIN unidades_conservacao uc  ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = d.monitor_id;

-- ── 2. vw_ninhos_validacao — quebra fina de perdas + 3 taxas por ninho ──
-- Aditivo (CREATE OR REPLACE VIEW só aceita coluna nova ao final).
-- Fonte única do que o PDF por ninho (biomonitor-relatorio-ninho.js) e
-- a tela de validação exibem — as mesmas 3 taxas do relatório
-- agregado (taxa_eclosao_pct/taxa_fertilidade_pct/eficiencia_ninho_pct),
-- agora também no nível do ninho individual, sem reimplementar a
-- fórmula em JS.
CREATE OR REPLACE VIEW vw_ninhos_validacao
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
  -- Fonte canônica de ovos viáveis/perdidos (mesma do mapa e dos painéis)
  ov.viaveis      AS ovos_viaveis,
  ov.perdas_total AS ovos_perdidos_total,
  e.foto_urls     AS eclosao_foto_urls,
  -- NOVO — quebra fina de perda (alagamento/erosão/humana; predação já
  -- vem como descartados_predacao acima, mesmo número)
  ov.perda_alagamento AS ovos_perda_alagamento,
  ov.perda_erosao     AS ovos_perda_erosao,
  ov.perda_humana     AS ovos_perda_humana,
  -- NOVO — as mesmas 3 taxas científicas do relatório agregado,
  -- calculadas por ninho individual (mesma fórmula de
  -- bio_relatorio_completo, nunca outra)
  ROUND(100.0 * COALESCE(e.filhotes_vivos, 0) /
    NULLIF(COALESCE(e.filhotes_vivos, 0) + COALESCE(e.filhotes_mortos, 0) + COALESCE(e.ovos_nao_nascidos, 0), 0)
  , 1) AS taxa_eclosao_pct,
  ROUND(100.0 * COALESCE(n.ovos_integros, 0) / NULLIF(n.qtd_ovos, 0), 1) AS taxa_fertilidade_pct,
  ROUND(100.0 * COALESCE(e.filhotes_vivos, 0) / NULLIF(n.ovos_integros, 0), 1) AS eficiencia_ninho_pct
FROM ninhos_quelonios n
LEFT JOIN temporadas_biomonitor tmp    ON tmp.id = n.temporada_id
LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
LEFT JOIN praias_monitoramento pa      ON pa.id = n.praia_atual_id
LEFT JOIN unidades_conservacao uc      ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
LEFT JOIN grupos_biomonitor g          ON g.id = n.grupo_id
LEFT JOIN vw_ninho_ovos ov             ON ov.ninho_id = n.id
LEFT JOIN LATERAL (
  SELECT data_transferencia, qtd_ovos, local_destino
  FROM transferencias_ninho
  WHERE ninho_id = n.id
  ORDER BY data_transferencia DESC
  LIMIT 1
) t ON true
LEFT JOIN LATERAL (
  SELECT data_nascimento, filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao, foto_urls
  FROM eclosoes_ninho
  WHERE ninho_id = n.id
  ORDER BY data_nascimento DESC
  LIMIT 1
) e ON true;

-- ── 3. bio_analise_praias — "eclodidos" padronizado (D4) ──────────
CREATE OR REPLACE FUNCTION bio_analise_praias(
  p_temporada_id uuid DEFAULT NULL,
  p_programa_id  uuid DEFAULT NULL,
  p_uc_id        uuid DEFAULT NULL,
  p_praia_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result  jsonb;
  v_ini     date;
  v_fim     date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  IF p_temporada_id IS NOT NULL THEN
    SELECT data_inicio, data_fim INTO v_ini, v_fim
      FROM temporadas_biomonitor WHERE id = p_temporada_id;
  END IF;

  WITH praias_base AS (
    SELECT p.*
    FROM praias_monitoramento p
    WHERE (p_programa_id IS NULL OR p.programa_id = p_programa_id)
      AND (p_uc_id IS NULL OR p.uc_id = p_uc_id)
      AND (p_praia_id IS NULL OR p.id = p_praia_id)
  ),

  ninhos_praia AS (
    SELECT
      n.praia_id,
      COUNT(*)                                            AS ninhos_total,
      COUNT(*) FILTER (WHERE n.status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE n.status = 'perdido')        AS perdidos,
      COALESCE(SUM(e.filhotes_vivos), 0)                  AS filhotes_vivos,
      COALESCE(SUM(e.filhotes_mortos), 0)                 AS filhotes_mortos,
      COALESCE(SUM(e.ovos_nao_nascidos), 0)               AS ovos_nao_nascidos
    FROM ninhos_quelonios n
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
    WHERE (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
    GROUP BY n.praia_id
  ),

  praias AS (
    SELECT
      pb.id, pb.nome, pb.codigo, pb.municipio, pb.comunidade, pb.rio,
      pb.tipo_localizacao, pb.ativa, pb.experimental,
      pb.comprimento_m, pb.area_ha,
      pb.periodo_inicio, pb.periodo_fim,
      (pb.area_geom IS NOT NULL)  AS tem_poligono,
      uc.nome AS uc_nome, uc.sigla AS uc_sigla,
      COALESCE(np.ninhos_total, 0)      AS ninhos_total,
      COALESCE(np.eclodidos, 0)         AS eclodidos,
      COALESCE(np.perdidos, 0)          AS perdidos,
      COALESCE(np.filhotes_vivos, 0)    AS filhotes_vivos,
      ROUND(
        100.0 * COALESCE(np.filhotes_vivos, 0) /
        NULLIF(COALESCE(np.filhotes_vivos, 0) + COALESCE(np.filhotes_mortos, 0) + COALESCE(np.ovos_nao_nascidos, 0), 0)
      , 1)                               AS taxa_eclosao_pct,
      CASE WHEN pb.comprimento_m > 0
        THEN ROUND((1000.0 * COALESCE(np.ninhos_total, 0) / pb.comprimento_m)::numeric, 2) END AS densidade_ninhos_km,
      CASE WHEN pb.area_ha > 0
        THEN ROUND((COALESCE(np.ninhos_total, 0) / pb.area_ha)::numeric, 2) END               AS densidade_ninhos_ha
    FROM praias_base pb
    LEFT JOIN unidades_conservacao uc ON uc.id = pb.uc_id
    LEFT JOIN ninhos_praia np ON np.praia_id = pb.id
  ),

  resumo AS (
    SELECT
      COUNT(*)                                                   AS total_praias,
      COUNT(*) FILTER (WHERE ativa)                              AS praias_ativas,
      COUNT(*) FILTER (WHERE experimental)                       AS praias_experimentais,
      COALESCE(SUM(comprimento_m), 0)                            AS comprimento_total_m,
      COALESCE(SUM(area_ha), 0)                                  AS area_total_ha,
      COUNT(*) FILTER (WHERE ninhos_total > 0)                   AS praias_com_ninhos,
      COUNT(*) FILTER (WHERE ninhos_total = 0)                   AS praias_sem_ninhos,
      SUM(ninhos_total)                                          AS ninhos_total_rede
    FROM praias
  ),

  por_tipo AS (
    SELECT COALESCE(tipo_localizacao::text, '—') AS tipo, COUNT(*) AS n,
      COALESCE(SUM(ninhos_total), 0) AS ninhos
    FROM praias GROUP BY tipo_localizacao ORDER BY n DESC
  ),

  alertas AS (
    SELECT
      COUNT(*) FILTER (WHERE comprimento_m IS NULL OR area_ha IS NULL)         AS sem_dimensoes,
      COUNT(*) FILTER (WHERE NOT tem_poligono)                                 AS sem_poligono,
      COUNT(*) FILTER (WHERE periodo_inicio IS NULL OR periodo_fim IS NULL)    AS sem_periodo,
      COUNT(*) FILTER (
        WHERE v_ini IS NOT NULL AND periodo_inicio IS NOT NULL
          AND (periodo_fim < v_ini OR periodo_inicio > v_fim)
      )                                                                        AS periodo_desalinhado
    FROM praias
  ),

  praias_alerta_dim AS (
    SELECT nome FROM praias WHERE comprimento_m IS NULL OR area_ha IS NULL ORDER BY nome
  ),
  praias_alerta_periodo AS (
    SELECT nome FROM praias
    WHERE v_ini IS NOT NULL AND periodo_inicio IS NOT NULL
      AND (periodo_fim < v_ini OR periodo_inicio > v_fim)
    ORDER BY nome
  ),
  praias_sem_ninho AS (
    SELECT nome FROM praias WHERE ninhos_total = 0 ORDER BY nome
  )

  SELECT jsonb_build_object(
    'resumo', (SELECT row_to_json(r) FROM resumo r),
    'por_tipo', (SELECT jsonb_agg(row_to_json(t)) FROM por_tipo t),
    'praias', (SELECT jsonb_agg(row_to_json(p) ORDER BY p.ninhos_total DESC) FROM praias p),
    'alertas', jsonb_build_object(
      'contagens', (SELECT row_to_json(a) FROM alertas a),
      'praias_sem_dimensoes', (SELECT jsonb_agg(nome) FROM praias_alerta_dim),
      'praias_periodo_desalinhado', (SELECT jsonb_agg(nome) FROM praias_alerta_periodo),
      'praias_sem_ninho', (SELECT jsonb_agg(nome) FROM praias_sem_ninho)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── 4. bio_analise_detalhada — perdas via descartes_ovos (D2) ─────
-- Reproduz fielmente 153, só troca a fonte de `perdas_v` (antes somava
-- direto de visitas_ninho.ovos_perdidos_*/ovos_predados_n — ignorava
-- descartes lançados fora da etapa "visita" e deleções em cascata).
-- Agora soma de descartes_ovos.causa (a mesma tabela que alimenta
-- vw_ninho_ovos/vw_descartes_ovos), respeitando qualquer etapa.
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
      COUNT(*) FILTER (WHERE e.predacao = 'por_pessoas') AS pred_pessoas,
      COUNT(*) FILTER (WHERE e.predacao = 'por_animais') AS pred_animais,
      COUNT(*) FILTER (WHERE e.predacao = 'nenhuma')     AS sem_pred
    FROM eclosoes_ninho e JOIN base_ids bi ON bi.id = e.ninho_id
  ),
  -- NOVO (era visitas_ninho direto — D2): soma de descartes_ovos por
  -- causa fina, qualquer etapa (registro/visita/eclosão) — mesma base
  -- de vw_ninho_ovos/vw_descartes_ovos, nunca diverge dela.
  perdas_v AS (
    SELECT
      COALESCE(SUM(d.qtd) FILTER (WHERE d.causa = 'alagamento'), 0) AS alagamento,
      COALESCE(SUM(d.qtd) FILTER (WHERE d.causa = 'erosao'), 0)     AS erosao,
      COALESCE(SUM(d.qtd) FILTER (WHERE d.causa = 'humana'), 0)     AS humana,
      COALESCE(SUM(d.qtd) FILTER (WHERE d.causa = 'predacao'), 0)   AS predacao
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
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
        'predacao_pessoas', ec.pred_pessoas, 'predacao_animais', ec.pred_animais, 'sem_predacao', ec.sem_pred
      ) FROM ecl ec
    ),
    'perdas', (
      SELECT jsonb_build_object(
        'ovos_alagamento', pv.alagamento, 'ovos_erosao', pv.erosao,
        'ovos_humana', pv.humana, 'ovos_predacao', pv.predacao,
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

-- ── 5. bio_dados_aba — mortalidade de berçário via view canônica (D3) ──
-- Reproduz fielmente 146 (v3), só troca o lateral `lm` (recálculo
-- próprio, sem o piso "nunca menor que a soltura confirmada") por
-- vw_lotes_bercario_mortalidade (133) — a mesma fonte que
-- bio_relatorio_completo já usa desde a 133/150.
CREATE OR REPLACE FUNCTION bio_dados_aba(
  p_temporada_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mon_id   uuid;
  v_grupo_id uuid;
  v_result   jsonb;
BEGIN
  SELECT id, grupo_id INTO v_mon_id, v_grupo_id
    FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo'
   LIMIT 1;

  IF v_mon_id IS NULL THEN RETURN NULL; END IF;

  WITH base AS (
    SELECT
      n.id,
      n.especie,
      n.status,
      n.monitor_id,
      n.data_encontro,
      n.qtd_ovos,
      n.ovos_integros,
      n.ovos_descartados,
      n.dist_rio_m,
      n.temperatura_c,
      n.umidade_pct,
      n.profundidade_cm,
      p.nome AS praia_nome,
      e.filhotes_vivos,
      e.filhotes_mortos,
      e.ovos_nao_nascidos,
      e.predacao,
      e.data_nascimento,
      CASE
        WHEN e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
        THEN (e.data_nascimento - n.data_encontro)
      END AS dias_incubacao
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao, data_nascimento
      FROM eclosoes_ninho
      WHERE ninho_id = n.id ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  agg AS (
    SELECT
      COUNT(*)                                               AS total_ninhos,
      COUNT(*) FILTER (WHERE monitor_id = v_mon_id)         AS meus_ninhos,
      COUNT(*) FILTER (WHERE status = 'encontrado')         AS encontrados,
      COUNT(*) FILTER (WHERE status = 'transferido')        AS transferidos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'eclodido')           AS eclodidos_status,
      COUNT(*) FILTER (WHERE status = 'em_bercario')        AS em_bercario,
      COUNT(*) FILTER (WHERE status = 'soltado')            AS soltados,
      COUNT(*) FILTER (WHERE status = 'perdido')            AS perdidos,
      COALESCE(SUM(filhotes_vivos),  0)                     AS filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0)                     AS filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0)                   AS ovos_nao_nascidos,
      COALESCE(SUM(qtd_ovos), 0)                            AS total_ovos_postura,
      COALESCE(SUM(ovos_integros), 0)                       AS total_ovos_integros,
      COALESCE(SUM(ovos_descartados), 0)                    AS total_ovos_descartados,
      COUNT(*) FILTER (WHERE predacao = 'por_pessoas')      AS predacao_pessoas,
      COUNT(*) FILTER (WHERE predacao = 'por_animais')      AS predacao_animais,
      COUNT(*) FILTER (WHERE predacao = 'nenhuma')          AS sem_predacao,
      ROUND(AVG(dist_rio_m)::numeric, 1)                    AS dist_rio_media_m,
      ROUND(AVG(temperatura_c)::numeric, 1)                 AS temp_media_c,
      ROUND(AVG(umidade_pct)::numeric, 1)                   AS umidade_media_pct,
      ROUND(AVG(profundidade_cm)::numeric, 1)               AS profundidade_media_cm,
      ROUND(AVG(dias_incubacao)::numeric)                   AS incubacao_media_dias
    FROM base
  ),

  por_especie AS (
    SELECT
      especie,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                     AS filhotes_vivos,
      ROUND(
        100.0 * COALESCE(SUM(filhotes_vivos), 0) /
        NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0)
      , 1)                                                  AS taxa_eclosao
    FROM base
    GROUP BY especie
    ORDER BY total DESC
  ),

  por_mes AS (
    SELECT
      to_char(date_trunc('month', data_encontro), 'YYYY-MM') AS mes,
      COUNT(*)                                               AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                      AS filhotes
    FROM base
    WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro)
    ORDER BY date_trunc('month', data_encontro)
  ),

  top_praias AS (
    SELECT praia_nome, COUNT(*) AS total
    FROM base
    WHERE praia_nome IS NOT NULL
    GROUP BY praia_nome
    ORDER BY total DESC
    LIMIT 6
  ),

  -- Mortalidade agora lida de vw_lotes_bercario_mortalidade (133) —
  -- mesma fonte canônica de bio_relatorio_completo e de
  -- biomonitor-bercarios.html, com o piso "nunca menor que a soltura
  -- confirmada" que o cálculo ad hoc anterior não tinha.
  berc_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE l.status IN ('ativo','soltado')) AS total_lotes,
      COALESCE(SUM(l.qtd_entrada), 0)                         AS total_entrada,
      COALESCE(SUM(ls.soltado), 0)                            AS total_soltado,
      COALESCE(SUM(vlm.mortes), 0)                            AS total_mortalidade
    FROM lotes_bercario l
    LEFT JOIN vw_lotes_bercario_mortalidade vlm ON vlm.lote_id = l.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
  ),

  solturas_agg AS (
    SELECT
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario
    FROM solturas_filhotes sf
    LEFT JOIN ninhos_quelonios n ON n.id = sf.ninho_id
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
    GROUP BY ob.tipo
    ORDER BY total DESC
  ),

  biometria_serie AS (
    SELECT
      data,
      ROUND(AVG(comp)::numeric, 1) AS comp_medio,
      ROUND(AVG(peso)::numeric, 1) AS peso_medio
    FROM (
      SELECT
        to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
        ob.comprimento_medio_cm AS comp,
        ob.peso_medio_g AS peso
      FROM ocorrencias_bercario ob
      JOIN lotes_bercario l ON l.id = ob.lote_id
      WHERE ob.tipo = 'biometria'
        AND l.grupo_id = v_grupo_id
        AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)

      UNION ALL

      SELECT
        to_char(bi.data_medicao, 'YYYY-MM-DD') AS data,
        bi.comprimento_cm AS comp,
        bi.peso_g AS peso
      FROM biometrias_individuais bi
      JOIN filhotes_bercario fb ON fb.id = bi.individuo_id
      JOIN lotes_bercario l ON l.id = fb.lote_id
      WHERE l.grupo_id = v_grupo_id
        AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
    ) todas
    WHERE comp IS NOT NULL OR peso IS NOT NULL
    GROUP BY data
    ORDER BY data
    LIMIT 30
  )

  SELECT jsonb_build_object(
    'meus_ninhos',              a.meus_ninhos,
    'grupo_ninhos',             a.total_ninhos,
    'eclodidos',                a.eclodidos,
    'pendentes',                a.encontrados,
    'filhotes_vivos',           a.filhotes_vivos,
    'filhotes_mortos',          a.filhotes_mortos,
    'ovos_nao_nascidos',        a.ovos_nao_nascidos,
    'total_ovos_postura',       a.total_ovos_postura,
    'total_ovos_integros',      a.total_ovos_integros,
    'total_ovos_descartados',   a.total_ovos_descartados,
    'dist_rio_media_m',         a.dist_rio_media_m,
    'temp_media_c',             a.temp_media_c,
    'umidade_media_pct',        a.umidade_media_pct,
    'profundidade_media_cm',    a.profundidade_media_cm,

    'taxa_eclosao_pct',
      ROUND(100.0 * a.filhotes_vivos /
        NULLIF(a.filhotes_vivos + a.filhotes_mortos + a.ovos_nao_nascidos, 0), 1),

    'taxa_sucesso_nidificacao_pct',
      ROUND(100.0 * a.eclodidos / NULLIF(a.total_ninhos, 0), 1),

    'taxa_fertilidade_pct',
      ROUND(100.0 * a.total_ovos_integros / NULLIF(a.total_ovos_postura, 0), 1),

    'eficiencia_ninho_pct',
      ROUND(100.0 * a.filhotes_vivos / NULLIF(a.total_ovos_integros, 0), 1),

    'taxa_predacao_pct',
      ROUND(100.0 * a.perdidos / NULLIF(a.total_ninhos, 0), 1),

    'taxa_transferencia_pct',
      ROUND(100.0 * a.transferidos / NULLIF(a.total_ninhos, 0), 1),

    'incubacao_media_dias',     a.incubacao_media_dias,

    'por_status', jsonb_build_object(
      'encontrado',  a.encontrados,
      'transferido', a.transferidos,
      'eclodido',    a.eclodidos_status,
      'em_bercario', a.em_bercario,
      'soltado',     a.soltados,
      'perdido',     a.perdidos
    ),
    'predacao_breakdown', jsonb_build_object(
      'por_animais', a.predacao_animais,
      'por_pessoas', a.predacao_pessoas,
      'nenhuma',     a.sem_predacao
    ),
    'desfecho_ovos', jsonb_build_object(
      'filhotes_vivos',    a.filhotes_vivos,
      'filhotes_mortos',   a.filhotes_mortos,
      'ovos_nao_nascidos', a.ovos_nao_nascidos,
      'ovos_descartados',  a.total_ovos_descartados
    ),
    'por_especie', (SELECT jsonb_agg(row_to_json(pe)) FROM por_especie pe),
    'por_mes',     (SELECT jsonb_agg(row_to_json(pm)) FROM por_mes pm),
    'top_praias',  (SELECT jsonb_agg(row_to_json(tp)) FROM top_praias tp),

    'bercario_total_lotes',     ba.total_lotes,
    'bercario_total_entrada',   ba.total_entrada,
    'bercario_total_soltado',   ba.total_soltado,
    'bercario_mortalidade',     ba.total_mortalidade,

    'taxa_sobrevivencia_bercario_pct',
      ROUND(100.0 * ba.total_soltado / NULLIF(ba.total_entrada, 0), 1),

    'taxa_mortalidade_bercario_pct',
      ROUND(100.0 * ba.total_mortalidade / NULLIF(ba.total_entrada, 0), 1),

    'solturas_direto_rio',      sa.direto_rio,
    'solturas_via_bercario',    sa.via_bercario,

    'ocorrencias_tipos', (SELECT jsonb_agg(row_to_json(ot)) FROM oc_tipos ot),
    'biometria_serie',   (SELECT jsonb_agg(row_to_json(bs)) FROM biometria_serie bs)

  ) INTO v_result
  FROM agg a, berc_agg ba, solturas_agg sa;

  RETURN v_result;
END;
$$;

-- ── 6. bio_relatorio_completo — unifica com vw_ninho_ovos + campos novos ──
-- (D1 + itens 1/2/3/4/5 do diagnóstico: perdas por causa fina,
-- taxa_mortalidade_embrionaria_pct, descartes por etapa, predação por
-- fase, ninhos destruídos por causa. total_filhotes_vivos_liquido já
-- existia — mantido, só passa a ser exibido pela UI.)
CREATE OR REPLACE FUNCTION bio_relatorio_completo(
  p_temporada_id     uuid DEFAULT NULL,
  p_programa_id      uuid DEFAULT NULL,
  p_uc_id            uuid DEFAULT NULL,
  p_praia_id         uuid DEFAULT NULL,
  p_tipo_localizacao tipo_localizacao_praia DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  WITH base_ids AS (
    SELECT n.id
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p  ON p.id = n.praia_id
    LEFT JOIN grupos_biomonitor gb    ON gb.id = n.grupo_id
    WHERE
      (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_programa_id IS NULL OR gb.programa_id = p_programa_id)
      AND (p_uc_id IS NULL OR COALESCE(n.uc_id, p.uc_id) = p_uc_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
      AND (p_tipo_localizacao IS NULL OR p.tipo_localizacao = p_tipo_localizacao)
  ),
  base AS (
    SELECT
      n.id, n.especie, n.status, n.monitor_id, n.praia_id, n.data_encontro,
      n.qtd_ovos, n.ovos_integros, n.ovos_descartados,
      -- Fonte canônica única (era: 2 subselects próprios recalculando a
      -- mesma soma que vw_ninho_ovos já faz — D1)
      COALESCE(ov.perda_predacao, 0)   AS ovos_predados,
      COALESCE(ov.perdas_total, 0)     AS ovos_descartes_total,
      COALESCE(ov.viaveis,
        GREATEST(COALESCE(n.qtd_ovos,0) - COALESCE(ov.perdas_total,0), 0)) AS ovos_viaveis_ninho,
      COALESCE(ov.perda_alagamento, 0) AS ovos_perda_alagamento,
      COALESCE(ov.perda_erosao, 0)     AS ovos_perda_erosao,
      COALESCE(ov.perda_humana, 0)     AS ovos_perda_humana,
      n.dist_rio_m, n.temperatura_c, n.umidade_pct, n.profundidade_cm,
      COALESCE(n.uc_id, p.uc_id) AS uc_id,
      p.nome AS praia_nome, p.codigo AS praia_codigo, p.comprimento_m,
      uc.nome AS uc_nome, uc.sigla AS uc_sigla,
      mb.nome_completo AS monitor_nome, gb.nome AS grupo_nome,
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos, e.predacao, e.data_nascimento,
      CASE WHEN e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
        THEN (e.data_nascimento - n.data_encontro) END AS dias_incubacao
    FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id
    LEFT JOIN vw_ninho_ovos ov         ON ov.ninho_id = n.id
    LEFT JOIN praias_monitoramento p   ON p.id = n.praia_id
    LEFT JOIN unidades_conservacao uc  ON uc.id = COALESCE(n.uc_id, p.uc_id)
    LEFT JOIN monitores_biodiversidade mb ON mb.id = n.monitor_id
    LEFT JOIN grupos_biomonitor gb     ON gb.id = n.grupo_id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao, data_nascimento
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
  ),
  agg AS (
    SELECT
      COUNT(*) AS total_ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'eclodido')    AS eclodidos_status,
      COUNT(*) FILTER (WHERE status = 'em_bercario') AS em_bercario,
      COUNT(*) FILTER (WHERE status = 'soltado')     AS soltados,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido') AS transferidos,
      COUNT(*) FILTER (WHERE status = 'encontrado') AS pendentes,
      COALESCE(SUM(qtd_ovos), 0) AS total_ovos_postura,
      COALESCE(SUM(ovos_integros), 0) AS total_ovos_integros,
      COALESCE(SUM(ovos_descartados), 0) AS total_ovos_descartados,
      COALESCE(SUM(ovos_predados), 0) AS total_ovos_predados,
      COALESCE(SUM(ovos_viaveis_ninho), 0) AS total_ovos_viaveis,
      COALESCE(SUM(ovos_perda_alagamento), 0) AS total_ovos_perda_alagamento,
      COALESCE(SUM(ovos_perda_erosao), 0)     AS total_ovos_perda_erosao,
      COALESCE(SUM(ovos_perda_humana), 0)     AS total_ovos_perda_humana,
      COALESCE(SUM(filhotes_vivos), 0) AS total_filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0) AS total_filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0) AS total_ovos_nao_nascidos,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos_postura,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(temperatura_c)::numeric, 1) AS temp_media_c,
      ROUND(AVG(umidade_pct)::numeric, 1) AS umidade_media_pct,
      ROUND(AVG(profundidade_cm)::numeric, 1) AS profundidade_media_cm,
      ROUND(AVG(dias_incubacao)::numeric) AS incubacao_media_dias,
      COUNT(*) FILTER (WHERE predacao = 'por_pessoas') AS predacao_pessoas,
      COUNT(*) FILTER (WHERE predacao = 'por_animais') AS predacao_animais,
      COUNT(*) FILTER (WHERE predacao = 'nenhuma') AS sem_predacao
    FROM base
  ),
  por_mes AS (
    SELECT to_char(date_trunc('month', data_encontro), 'YYYY-MM') AS mes,
      COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes, ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos
    FROM base WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro) ORDER BY date_trunc('month', data_encontro)
  ),
  por_ano AS (
    SELECT EXTRACT(YEAR FROM data_encontro)::int AS ano, COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE data_encontro IS NOT NULL GROUP BY EXTRACT(YEAR FROM data_encontro) ORDER BY ano
  ),
  por_especie AS (
    SELECT especie, COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido') AS transferidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0) AS filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0) AS ovos_nao_nascidos,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos_postura,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(ovos_integros), 0), 0), 1) AS eficiencia_pct,
      ROUND(AVG(dias_incubacao)::numeric) AS incubacao_media_dias,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(temperatura_c)::numeric, 1) AS temp_media_c
    FROM base GROUP BY especie ORDER BY total DESC
  ),
  por_praia AS (
    SELECT praia_id, praia_nome, praia_codigo, uc_nome, uc_sigla,
      MAX(comprimento_m) AS comprimento_m, COUNT(*) AS ninhos_total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos,
      COUNT(*) FILTER (WHERE predacao IN ('por_pessoas','por_animais')) AS com_predacao,
      ROUND(CASE WHEN MAX(comprimento_m) > 0 THEN 1000.0 * COUNT(*) / MAX(comprimento_m) END::numeric, 2) AS densidade_ninhos_km
    FROM base WHERE praia_id IS NOT NULL
    GROUP BY praia_id, praia_nome, praia_codigo, uc_nome, uc_sigla ORDER BY ninhos_total DESC
  ),
  por_uc AS (
    SELECT uc_id, uc_nome, uc_sigla, COUNT(*) AS ninhos_total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos
    FROM base WHERE uc_id IS NOT NULL GROUP BY uc_id, uc_nome, uc_sigla ORDER BY ninhos_total DESC
  ),
  por_monitor AS (
    SELECT monitor_id, monitor_nome, grupo_nome, COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE monitor_id IS NOT NULL GROUP BY monitor_id, monitor_nome, grupo_nome ORDER BY ninhos DESC LIMIT 25
  ),
  berc_agg AS (
    SELECT COUNT(*) FILTER (WHERE l.status IN ('ativo','soltado')) AS total_lotes,
      COALESCE(SUM(l.qtd_entrada), 0) AS total_entrada,
      COALESCE(SUM(ls.soltado), 0) AS total_soltado
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
  ),
  berc_mortes_canon AS (
    SELECT COALESCE(SUM(vlm.mortes), 0) AS total_mortes
    FROM vw_lotes_bercario_mortalidade vlm
    JOIN base_ids bi ON bi.id = vlm.ninho_id
  ),
  solturas_agg AS (
    SELECT COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true), 0) AS via_bercario
    FROM base_ids bi JOIN solturas_filhotes sf ON sf.ninho_id = bi.id
  ),
  soltos_especie AS (
    SELECT n.especie,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada), 0)                                        AS total
    FROM base_ids bi
    JOIN solturas_filhotes sf ON sf.ninho_id = bi.id
    JOIN ninhos_quelonios n   ON n.id = bi.id
    GROUP BY n.especie
    ORDER BY total DESC
  ),
  lote_berc AS (
    SELECT l.id, l.bercario_id, l.bercario_nome, n.especie,
      COALESCE(l.qtd_entrada, 0) AS entrada,
      COALESCE(ls.soltado, 0)    AS soltos
    FROM base_ids bi
    JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ninhos_quelonios n ON n.id = bi.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
  ),
  taxa_soltura_bercario AS (
    SELECT bercario_nome,
      (array_agg(especie) FILTER (WHERE especie IS NOT NULL))[1] AS especie,
      SUM(entrada) AS entrada, SUM(soltos) AS soltos,
      ROUND(100.0 * SUM(soltos) / NULLIF(SUM(entrada), 0), 1) AS taxa_pct
    FROM lote_berc GROUP BY bercario_id, bercario_nome HAVING SUM(entrada) > 0 ORDER BY bercario_nome
  ),
  taxa_soltura_especie AS (
    SELECT especie, SUM(entrada) AS entrada, SUM(soltos) AS soltos,
      ROUND(100.0 * SUM(soltos) / NULLIF(SUM(entrada), 0), 1) AS taxa_pct
    FROM lote_berc WHERE especie IS NOT NULL GROUP BY especie HAVING SUM(entrada) > 0 ORDER BY especie
  ),
  crescimento_especie AS (
    SELECT especie, data,
      ROUND(AVG(comp)::numeric, 1) AS comp_medio,
      ROUND(AVG(peso)::numeric, 1) AS peso_medio
    FROM (
      SELECT n.especie AS especie, to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
        ob.comprimento_medio_cm AS comp, ob.peso_medio_g AS peso
      FROM base_ids bi
      JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN ninhos_quelonios n ON n.id = bi.id
      JOIN ocorrencias_bercario ob ON ob.lote_id = l.id
      WHERE ob.tipo = 'biometria'

      UNION ALL

      SELECT n.especie, to_char(b.data_medicao, 'YYYY-MM-DD') AS data,
        b.comprimento_cm AS comp, b.peso_g AS peso
      FROM base_ids bi
      JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN ninhos_quelonios n ON n.id = bi.id
      JOIN filhotes_bercario fb ON fb.lote_id = l.id
      JOIN biometrias_individuais b ON b.individuo_id = fb.id
    ) t
    WHERE comp IS NOT NULL OR peso IS NOT NULL
    GROUP BY especie, data
    ORDER BY especie, data
  ),
  comp_ind AS (
    SELECT b.individuo_id,
      (array_agg(b.comprimento_cm ORDER BY b.data_medicao,      b.hora_medicao))[1] AS ini,
      (array_agg(b.comprimento_cm ORDER BY b.data_medicao DESC, b.hora_medicao DESC))[1] AS fim
    FROM biometrias_individuais b
    JOIN filhotes_bercario fb ON fb.id = b.individuo_id
    JOIN lotes_bercario l ON l.id = fb.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    WHERE b.comprimento_cm IS NOT NULL
    GROUP BY b.individuo_id HAVING COUNT(*) >= 2
  ),
  peso_ind AS (
    SELECT b.individuo_id,
      (array_agg(b.peso_g ORDER BY b.data_medicao,      b.hora_medicao))[1] AS ini,
      (array_agg(b.peso_g ORDER BY b.data_medicao DESC, b.hora_medicao DESC))[1] AS fim
    FROM biometrias_individuais b
    JOIN filhotes_bercario fb ON fb.id = b.individuo_id
    JOIN lotes_bercario l ON l.id = fb.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    WHERE b.peso_g IS NOT NULL
    GROUP BY b.individuo_id HAVING COUNT(*) >= 2
  ),
  ganho_bercario AS (
    SELECT l.bercario_nome,
      (array_agg(n.especie) FILTER (WHERE n.especie IS NOT NULL))[1] AS especie,
      ROUND(AVG(ci.fim - ci.ini)::numeric, 1) AS delta_comp,
      ROUND(AVG(pi.fim - pi.ini)::numeric, 1) AS delta_peso,
      COUNT(DISTINCT ci.individuo_id)         AS n_comp,
      COUNT(DISTINCT pi.individuo_id)         AS n_peso
    FROM base_ids bi
    JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ninhos_quelonios n ON n.id = bi.id
    JOIN filhotes_bercario fb ON fb.lote_id = l.id
    LEFT JOIN comp_ind ci ON ci.individuo_id = fb.id
    LEFT JOIN peso_ind pi ON pi.individuo_id = fb.id
    WHERE ci.individuo_id IS NOT NULL OR pi.individuo_id IS NOT NULL
    GROUP BY l.bercario_id, l.bercario_nome
    ORDER BY l.bercario_nome
  ),
  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ocorrencias_bercario ob ON ob.lote_id = l.id GROUP BY ob.tipo ORDER BY total DESC
  ),
  biometria_serie AS (
    SELECT data,
      ROUND(AVG(comp)::numeric, 1) AS comp_medio,
      ROUND(AVG(peso)::numeric, 1) AS peso_medio,
      SUM(n) AS n_amostrados
    FROM (
      SELECT to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
        ob.comprimento_medio_cm AS comp, ob.peso_medio_g AS peso,
        COALESCE(ob.n_amostrados, 0) AS n
      FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN ocorrencias_bercario ob ON ob.lote_id = l.id
      WHERE ob.tipo = 'biometria'

      UNION ALL

      SELECT to_char(b.data_medicao, 'YYYY-MM-DD') AS data,
        b.comprimento_cm AS comp, b.peso_g AS peso, 1 AS n
      FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN filhotes_bercario fb ON fb.lote_id = l.id
      JOIN biometrias_individuais b ON b.individuo_id = fb.id
    ) todas
    WHERE comp IS NOT NULL OR peso IS NOT NULL
    GROUP BY data ORDER BY data LIMIT 60
  ),
  -- NOVO: descartes por causa/etapa (mesma base de vw_descartes_ovos,
  -- agora dentro do filtro completo do relatório — temporada/programa/
  -- uc/praia/localização, que a query direta do cliente não cobria)
  descartes_por_causa AS (
    SELECT COALESCE(d.causa::text, d.motivo::text, '—') AS causa, COALESCE(SUM(d.qtd),0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY COALESCE(d.causa::text, d.motivo::text, '—') ORDER BY qtd DESC
  ),
  descartes_por_etapa AS (
    SELECT COALESCE(d.etapa, '—') AS etapa, COALESCE(SUM(d.qtd),0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY d.etapa ORDER BY qtd DESC
  ),
  -- NOVO: ninhos destruídos por causa (visitas_ninho.status_ninho='destruido')
  ninhos_destruidos_causa AS (
    SELECT COALESCE(v.causa_destruicao::text, '—') AS causa, COUNT(DISTINCT v.ninho_id) AS n
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
    WHERE v.status_ninho = 'destruido'
    GROUP BY v.causa_destruicao ORDER BY n DESC
  ),
  -- NOVO: predação por fase (incubação/soltura — eclosão já está em agg)
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
    FROM base_ids bi JOIN solturas_filhotes sf ON sf.ninho_id = bi.id
  )
  SELECT jsonb_build_object(
    'kpis', (
      SELECT jsonb_build_object(
        'total_ninhos', a.total_ninhos, 'eclodidos', a.eclodidos, 'perdidos', a.perdidos,
        'eclodidos_status', a.eclodidos_status, 'em_bercario', a.em_bercario, 'soltados', a.soltados,
        'transferidos', a.transferidos, 'pendentes', a.pendentes,
        'total_ovos_postura', a.total_ovos_postura, 'total_ovos_integros', a.total_ovos_integros,
        'total_ovos_descartados', a.total_ovos_descartados,
        'total_ovos_predados', a.total_ovos_predados, 'total_ovos_viaveis', a.total_ovos_viaveis,
        'total_ovos_perda_alagamento', a.total_ovos_perda_alagamento,
        'total_ovos_perda_erosao', a.total_ovos_perda_erosao,
        'total_ovos_perda_humana', a.total_ovos_perda_humana,
        'total_filhotes_vivos', a.total_filhotes_vivos,
        'total_filhotes_vivos_liquido', GREATEST(a.total_filhotes_vivos - bmc.total_mortes, 0),
        'total_filhotes_mortos', a.total_filhotes_mortos,
        'total_ovos_nao_nascidos', a.total_ovos_nao_nascidos, 'media_ovos_postura', a.media_ovos_postura,
        'dist_rio_media_m', a.dist_rio_media_m, 'temp_media_c', a.temp_media_c,
        'umidade_media_pct', a.umidade_media_pct, 'profundidade_media_cm', a.profundidade_media_cm,
        'incubacao_media_dias', a.incubacao_media_dias,
        'taxa_eclosao_pct', ROUND(100.0 * a.total_filhotes_vivos / NULLIF(a.total_filhotes_vivos + a.total_filhotes_mortos + a.total_ovos_nao_nascidos, 0), 1),
        'taxa_mortalidade_embrionaria_pct', ROUND(100.0 * (a.total_filhotes_mortos + a.total_ovos_nao_nascidos) / NULLIF(a.total_filhotes_vivos + a.total_filhotes_mortos + a.total_ovos_nao_nascidos, 0), 1),
        'taxa_sucesso_nidificacao_pct', ROUND(100.0 * a.eclodidos / NULLIF(a.total_ninhos, 0), 1),
        'taxa_fertilidade_pct', ROUND(100.0 * a.total_ovos_integros / NULLIF(a.total_ovos_postura, 0), 1),
        'eficiencia_ninho_pct', ROUND(100.0 * a.total_filhotes_vivos / NULLIF(a.total_ovos_integros, 0), 1),
        'taxa_predacao_pct', ROUND(100.0 * a.perdidos / NULLIF(a.total_ninhos, 0), 1),
        'taxa_transferencia_pct', ROUND(100.0 * a.transferidos / NULLIF(a.total_ninhos, 0), 1),
        'bercario_total_lotes', ba.total_lotes, 'bercario_total_entrada', ba.total_entrada,
        'bercario_total_soltado', ba.total_soltado, 'bercario_mortalidade', bmc.total_mortes,
        'taxa_sobrevivencia_bercario_pct', ROUND(100.0 * ba.total_soltado / NULLIF(ba.total_entrada, 0), 1),
        'taxa_mortalidade_bercario_pct', ROUND(100.0 * bmc.total_mortes / NULLIF(ba.total_entrada, 0), 1),
        'solturas_direto_rio', sa.direto_rio, 'solturas_via_bercario', sa.via_bercario,
        'predacao_pessoas', a.predacao_pessoas, 'predacao_animais', a.predacao_animais, 'sem_predacao', a.sem_predacao
      ) FROM agg a, berc_agg ba, berc_mortes_canon bmc, solturas_agg sa
    ),
    'por_mes', (SELECT jsonb_agg(row_to_json(pm)) FROM por_mes pm),
    'por_ano', (SELECT jsonb_agg(row_to_json(pa)) FROM por_ano pa),
    'por_especie', (SELECT jsonb_agg(row_to_json(pe)) FROM por_especie pe),
    'por_praia', (SELECT jsonb_agg(row_to_json(pp)) FROM por_praia pp),
    'por_uc', (SELECT jsonb_agg(row_to_json(pu)) FROM por_uc pu),
    'por_monitor', (SELECT jsonb_agg(row_to_json(pmon)) FROM por_monitor pmon),
    'biometria_serie', (SELECT jsonb_agg(row_to_json(bs)) FROM biometria_serie bs),
    'ocorrencias_tipos', (SELECT jsonb_agg(row_to_json(ot)) FROM oc_tipos ot),
    'bercario_soltos_por_especie', (SELECT jsonb_agg(row_to_json(se)) FROM soltos_especie se),
    'taxa_soltura_por_bercario',   (SELECT jsonb_agg(row_to_json(tb)) FROM taxa_soltura_bercario tb),
    'taxa_soltura_por_especie',    (SELECT jsonb_agg(row_to_json(te)) FROM taxa_soltura_especie te),
    'crescimento_por_especie',     (SELECT jsonb_agg(row_to_json(ce)) FROM crescimento_especie ce),
    'ganho_por_bercario',          (SELECT jsonb_agg(row_to_json(gb)) FROM ganho_bercario gb),
    -- NOVO
    'descartes_por_causa', (SELECT jsonb_agg(row_to_json(dc)) FROM descartes_por_causa dc),
    'descartes_por_etapa', (SELECT jsonb_agg(row_to_json(de)) FROM descartes_por_etapa de),
    'ninhos_destruidos_por_causa', (SELECT jsonb_agg(row_to_json(nd)) FROM ninhos_destruidos_causa nd),
    'predacao_fases', jsonb_build_object(
      'incubacao', (SELECT row_to_json(pi) FROM pred_incub pi),
      'eclosao',   (SELECT jsonb_build_object('por_pessoas', a.predacao_pessoas, 'por_animais', a.predacao_animais) FROM agg a),
      'soltura',   (SELECT row_to_json(ps) FROM pred_solt ps)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION bio_relatorio_completo TO authenticated;
GRANT EXECUTE ON FUNCTION bio_analise_detalhada TO authenticated;
GRANT EXECUTE ON FUNCTION bio_analise_praias TO authenticated;
GRANT EXECUTE ON FUNCTION bio_dados_aba TO authenticated;
REVOKE EXECUTE ON FUNCTION bio_relatorio_completo FROM anon;
REVOKE EXECUTE ON FUNCTION bio_analise_detalhada FROM anon;
REVOKE EXECUTE ON FUNCTION bio_analise_praias FROM anon;
REVOKE EXECUTE ON FUNCTION bio_dados_aba FROM anon;
