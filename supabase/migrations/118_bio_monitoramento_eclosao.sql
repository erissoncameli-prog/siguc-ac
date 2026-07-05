-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Painel de eclosão + dashboard por praia
-- ───────────────────────────────────────────────────────────
-- Consome a previsão de eclosão (mig. 117) nos painéis gerenciais:
--  · bio_monitoramento_eclosao(temporada): próximos/hoje/atrasados,
--    taxa de sucesso e incubação real por espécie, previsto × real.
--  · bio_dashboard_praias(filtros): um cartão por praia com os
--    indicadores da proposta (seção 4), filtrável por temporada,
--    espécie, praia, comunidade, UC, município e período.
--
-- Acesso: gestor/tecnico/super_admin/biologo veem tudo; monitor
-- vê apenas o próprio grupo (mesmo padrão de bio_dados_aba).
-- Depende de 117, 086 (visitas), 074 (eclosões).
-- ═══════════════════════════════════════════════════════════

-- ── 1. Painel de eclosão ─────────────────────────────────────
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
  incub AS (  -- incubação REAL (data_nascimento - data_encontro) por espécie
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
      'em_incubacao',(SELECT COUNT(*) FROM prev WHERE faixa_risco IN ('normal','atencao','hoje','atrasado'))
    ),
    -- Listas (limitadas para o painel)
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
    -- Por espécie: taxa de sucesso, incubação real, previsto × real
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

-- ── 2. Dashboard por praia (cartões filtráveis) ──────────────
CREATE OR REPLACE FUNCTION bio_dashboard_praias(
  p_temporada_id uuid            DEFAULT NULL,
  p_especie      especie_quelonio DEFAULT NULL,
  p_praia_id     uuid            DEFAULT NULL,
  p_comunidade   text            DEFAULT NULL,
  p_uc_id        uuid            DEFAULT NULL,
  p_municipio    text            DEFAULT NULL,
  p_data_inicio  date            DEFAULT NULL,
  p_data_fim     date            DEFAULT NULL
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
   WHERE usuario_id = auth.uid() AND status = 'ativo' LIMIT 1;

  SELECT EXISTS (SELECT 1 FROM usuarios
                  WHERE id = auth.uid()
                    AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
    INTO v_gestor;

  IF v_grupo_id IS NULL AND NOT v_gestor THEN RETURN NULL; END IF;

  WITH base AS (
    SELECT
      n.id, n.praia_id, n.especie, n.status,
      n.qtd_ovos, n.data_prevista_eclosao,
      -- eclosão
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos, e.predacao,
      (e.ninho_id IS NOT NULL)                                   AS eclodiu,
      (e.ninho_id IS NOT NULL AND COALESCE(e.filhotes_vivos,0) = 0) AS falha_eclosao,
      (e.predacao IS NOT NULL AND e.predacao <> 'nenhuma')       AS predado_ecl,
      -- visitas: alagamento / predação de ovos
      COALESCE(vis.alagado, false)                               AS inundado,
      COALESCE(vis.predado, false)                               AS predado_vis
    FROM ninhos_quelonios n
    JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN LATERAL (
      SELECT ninho_id, filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
    LEFT JOIN LATERAL (
      SELECT
        bool_or(status_ninho = 'alagado' OR sinal_alagamento)        AS alagado,
        bool_or(status_ninho IN ('parcial_predado','destruido')
                OR predacao_incubacao <> 'nenhuma')                  AS predado
      FROM visitas_ninho WHERE ninho_id = n.id
    ) vis ON true
    WHERE (v_gestor OR n.grupo_id = v_grupo_id)
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_especie     IS NULL OR n.especie      = p_especie)
      AND (p_praia_id    IS NULL OR n.praia_id     = p_praia_id)
      AND (p_comunidade  IS NULL OR p.comunidade   = p_comunidade)
      AND (p_uc_id       IS NULL OR n.uc_id        = p_uc_id)
      AND (p_municipio   IS NULL OR p.municipio    = p_municipio)
      AND (p_data_inicio IS NULL OR n.data_encontro >= p_data_inicio)
      AND (p_data_fim    IS NULL OR n.data_encontro <= p_data_fim)
  ),
  agg AS (
    SELECT
      b.praia_id,
      COUNT(*)                                                            AS total,
      COUNT(*) FILTER (WHERE b.status IN ('encontrado','transferido'))    AS ativos,
      COUNT(*) FILTER (WHERE b.status = 'transferido')                    AS transferidos,
      COUNT(*) FILTER (WHERE b.eclodiu)                                   AS eclodidos,
      COUNT(*) FILTER (WHERE b.status = 'perdido')                        AS perdidos,
      COUNT(*) FILTER (WHERE b.predado_ecl OR b.predado_vis)              AS predados,
      COUNT(*) FILTER (WHERE b.inundado)                                  AS inundados,
      COUNT(*) FILTER (WHERE b.falha_eclosao)                             AS falha_eclosao,
      COUNT(*) FILTER (WHERE b.status IN ('encontrado','transferido')
                         AND b.data_prevista_eclosao
                             BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)   AS proximos_eclosao,
      COALESCE(SUM(b.filhotes_vivos), 0)                                  AS filhotes_produzidos,
      COALESCE(SUM(b.qtd_ovos), 0)                                        AS ovos_monitorados,
      ROUND(100.0 * COALESCE(SUM(b.filhotes_vivos),0) /
        NULLIF(COALESCE(SUM(b.filhotes_vivos + b.filhotes_mortos + b.ovos_nao_nascidos),0),0),1)
                                                                          AS sucesso_pct
    FROM base b
    GROUP BY b.praia_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'praia_id', p.id, 'praia', p.nome, 'sigla', p.sigla,
    'comunidade', p.comunidade, 'municipio', p.municipio,
    'uc_nome', uc.nome, 'experimental', p.experimental,
    'total', a.total, 'ativos', a.ativos, 'transferidos', a.transferidos,
    'eclodidos', a.eclodidos, 'perdidos', a.perdidos, 'predados', a.predados,
    'inundados', a.inundados, 'falha_eclosao', a.falha_eclosao,
    'proximos_eclosao', a.proximos_eclosao, 'sucesso_pct', a.sucesso_pct,
    'filhotes_produzidos', a.filhotes_produzidos, 'ovos_monitorados', a.ovos_monitorados
  ) ORDER BY p.nome), '[]'::jsonb)
  INTO v_result
  FROM agg a
  JOIN praias_monitoramento p ON p.id = a.praia_id
  LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_dashboard_praias TO authenticated, service_role;
