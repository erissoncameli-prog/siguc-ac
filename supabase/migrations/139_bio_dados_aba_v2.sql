-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — RPC bio_dados_aba v2 (aba Dados → Berçário)
-- ───────────────────────────────────────────────────────────
-- A RPC (090) não foi tocada desde antes das mudanças recentes no
-- berçário (132 em diante) e ficou desatualizada em 3 pontos:
--
--   1. Mortalidade do berçário some daqui pra frente: o KPI "Mortos"
--      e a taxa de mortalidade somavam solturas_filhotes.mortalidade,
--      mas a soltura em bloco (137) passou a gravar sempre 0 ali — a
--      mortalidade real agora é rastreada por filhote individual
--      (status='morto') ou por ocorrência de mortalidade agregada.
--      Troca para o mesmo cálculo canônico já usado no app
--      (bioMortesCanonicasDoLote): individual se o lote tiver
--      filhotes rastreados, senão soma de ocorrências.
--   2. "Biometria ao Longo do Tempo" só lia ocorrencias_bercario tipo
--      biometria (amostragem agregada por lote) — a biometria
--      sequencial por filhote (132) grava em biometrias_individuais
--      e nunca aparecia no gráfico. Une as duas fontes.
--   3. "Ocorrências no Berçário" e "Biometria ao Longo do Tempo"
--      ignoravam o seletor de temporada da aba Dados. Com
--      lotes_bercario.temporada_id (138) dá pra filtrar direto por
--      lote, sem precisar passar por ninhos_quelonios.
--
-- Como consequência dos itens acima, berc_agg/oc_tipos/biometria_serie
-- passam a escopar direto por lotes_bercario.grupo_id/temporada_id
-- (135/138) em vez de join com ninhos_quelonios — mais simples e não
-- perde lote sem ninho vinculado.
-- ═══════════════════════════════════════════════════════════

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
      -- Período de incubação em dias
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

  -- ── Agregados gerais ──────────────────────────────────────
  agg AS (
    SELECT
      COUNT(*)                                               AS total_ninhos,
      COUNT(*) FILTER (WHERE monitor_id = v_mon_id)         AS meus_ninhos,
      COUNT(*) FILTER (WHERE status = 'encontrado')         AS encontrados,
      COUNT(*) FILTER (WHERE status = 'transferido')        AS transferidos,
      COUNT(*) FILTER (WHERE status = 'eclodido')           AS eclodidos,
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

  -- ── Por espécie ───────────────────────────────────────────
  por_especie AS (
    SELECT
      especie,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE status = 'eclodido')          AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                     AS filhotes_vivos,
      ROUND(
        100.0 * COALESCE(SUM(filhotes_vivos), 0) /
        NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0)
      , 1)                                                  AS taxa_eclosao
    FROM base
    GROUP BY especie
    ORDER BY total DESC
  ),

  -- ── Por mês ───────────────────────────────────────────────
  por_mes AS (
    SELECT
      to_char(date_trunc('month', data_encontro), 'YYYY-MM') AS mes,
      COUNT(*)                                               AS ninhos,
      COUNT(*) FILTER (WHERE status = 'eclodido')           AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                      AS filhotes
    FROM base
    WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro)
    ORDER BY date_trunc('month', data_encontro)
  ),

  -- ── Top praias ────────────────────────────────────────────
  top_praias AS (
    SELECT praia_nome, COUNT(*) AS total
    FROM base
    WHERE praia_nome IS NOT NULL
    GROUP BY praia_nome
    ORDER BY total DESC
    LIMIT 6
  ),

  -- ── Berçário: agregados (escopo direto por lotes_bercario,
  --    sem depender de ninho vinculado) ──────────────────────
  berc_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE l.status IN ('ativo','soltado')) AS total_lotes,
      COALESCE(SUM(l.qtd_entrada), 0)                         AS total_entrada,
      COALESCE(SUM(ls.soltado), 0)                            AS total_soltado,
      COALESCE(SUM(lm.mortes), 0)                             AS total_mortalidade
    FROM lotes_bercario l
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
    -- Mortalidade canônica por lote: se há filhotes individuais
    -- rastreados, conta os 'morto'; senão, soma ocorrências de
    -- mortalidade agregadas — mesma regra do app (bioMortesCanonicasDoLote).
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM filhotes_bercario fb WHERE fb.lote_id = l.id)
          THEN (SELECT count(*) FROM filhotes_bercario fb WHERE fb.lote_id = l.id AND fb.status = 'morto')
        ELSE (SELECT COALESCE(SUM(ob.qtd_afetados), 0) FROM ocorrencias_bercario ob WHERE ob.lote_id = l.id AND ob.tipo = 'mortalidade')
      END AS mortes
    ) lm ON true
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
  ),

  -- ── Solturas: via rio direto vs via berçário ──────────────
  solturas_agg AS (
    SELECT
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario
    FROM solturas_filhotes sf
    LEFT JOIN ninhos_quelonios n ON n.id = sf.ninho_id
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  -- ── Ocorrências no berçário por tipo (escopo direto por lote) ──
  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
    GROUP BY ob.tipo
    ORDER BY total DESC
  ),

  -- ── Série biométrica (comprimento e peso médio por data) ──
  -- Une as duas formas de registrar biometria no berçário: amostragem
  -- agregada por lote (ocorrencias_bercario) e medição individual por
  -- filhote (biometrias_individuais, 132) — a segunda nunca aparecia
  -- no gráfico antes desta correção.
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

    -- ── KPIs básicos ──────────────────────────────────────
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

    -- ── Taxas científicas ─────────────────────────────────
    -- 1. Taxa de Eclosão: filhotes vivos / (vivos+mortos+não nascidos)
    'taxa_eclosao_pct',
      ROUND(100.0 * a.filhotes_vivos /
        NULLIF(a.filhotes_vivos + a.filhotes_mortos + a.ovos_nao_nascidos, 0), 1),

    -- 2. Taxa de Sucesso de Nidificação: ninhos eclodidos / total
    'taxa_sucesso_nidificacao_pct',
      ROUND(100.0 * a.eclodidos / NULLIF(a.total_ninhos, 0), 1),

    -- 3. Taxa de Fertilidade: ovos íntegros / ovos totais
    'taxa_fertilidade_pct',
      ROUND(100.0 * a.total_ovos_integros / NULLIF(a.total_ovos_postura, 0), 1),

    -- 4. Eficiência do Ninho: filhotes vivos / ovos íntegros
    'eficiencia_ninho_pct',
      ROUND(100.0 * a.filhotes_vivos / NULLIF(a.total_ovos_integros, 0), 1),

    -- 5. Taxa de Predação: ninhos perdidos / total
    'taxa_predacao_pct',
      ROUND(100.0 * a.perdidos / NULLIF(a.total_ninhos, 0), 1),

    -- 6. Taxa de Transferência: transferidos / total
    'taxa_transferencia_pct',
      ROUND(100.0 * a.transferidos / NULLIF(a.total_ninhos, 0), 1),

    -- 7. Período de incubação médio
    'incubacao_media_dias',     a.incubacao_media_dias,

    -- ── Distribuições (para gráficos) ─────────────────────
    'por_status', jsonb_build_object(
      'encontrado', a.encontrados,
      'transferido', a.transferidos,
      'eclodido',   a.eclodidos,
      'perdido',    a.perdidos
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

    -- ── Berçário ──────────────────────────────────────────
    'bercario_total_lotes',     ba.total_lotes,
    'bercario_total_entrada',   ba.total_entrada,
    'bercario_total_soltado',   ba.total_soltado,
    'bercario_mortalidade',     ba.total_mortalidade,

    -- 8. Taxa de Sobrevivência em Berçário
    'taxa_sobrevivencia_bercario_pct',
      ROUND(100.0 * ba.total_soltado / NULLIF(ba.total_entrada, 0), 1),

    -- 9. Taxa de Mortalidade em Berçário
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

GRANT EXECUTE ON FUNCTION bio_dados_aba TO authenticated;
