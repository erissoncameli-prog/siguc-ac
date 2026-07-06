-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Ovos viáveis/perdas como base dos painéis
-- ───────────────────────────────────────────────────────────────
-- Fonte canônica única de "ovos viáveis" e "perdas por causa" por
-- ninho, para os painéis pararem de falar em postura e passarem a
-- refletir a mesma base do mapa. Reutilizada pelos RPCs/views.
--
--   viaveis = postura − Σ descartes (registro + visita + eclosão)
--   perdas por causa fina (predacao/alagamento/erosao/humana);
--   'natural' legado sem causa entra só em perdas_total.
--
-- Esta migration cria a view canônica e atualiza o painel Praias
-- (bio_dashboard_praias). Os demais painéis (Dados, Eclosão,
-- Relatórios, vw_praias_biomonitor) são atualizados nas próximas.
-- Depende de 123 (causa em descartes_ovos).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. View canônica por ninho ───────────────────────────────────
CREATE OR REPLACE VIEW vw_ninho_ovos
WITH (security_invoker = true)
AS
SELECT
  n.id                                                    AS ninho_id,
  COALESCE(n.qtd_ovos, 0)                                 AS postura,
  COALESCE(dd.total, 0)                                   AS perdas_total,
  GREATEST(COALESCE(n.qtd_ovos, 0) - COALESCE(dd.total, 0), 0) AS viaveis,
  COALESCE(dd.predacao, 0)                                AS perda_predacao,
  COALESCE(dd.alagamento, 0)                              AS perda_alagamento,
  COALESCE(dd.erosao, 0)                                  AS perda_erosao,
  COALESCE(dd.humana, 0)                                  AS perda_humana,
  COALESCE(dd.registro, 0)                                AS perda_registro
FROM ninhos_quelonios n
LEFT JOIN LATERAL (
  SELECT
    SUM(qtd)                                     AS total,
    SUM(qtd) FILTER (WHERE causa = 'predacao')   AS predacao,
    SUM(qtd) FILTER (WHERE causa = 'alagamento') AS alagamento,
    SUM(qtd) FILTER (WHERE causa = 'erosao')     AS erosao,
    SUM(qtd) FILTER (WHERE causa = 'humana')     AS humana,
    SUM(qtd) FILTER (WHERE etapa = 'registro')   AS registro
  FROM descartes_ovos WHERE ninho_id = n.id
) dd ON true;

-- ── 2. Painel Praias: viáveis + perdas por causa (em nº de ovos) ──
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
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos, e.predacao,
      (e.ninho_id IS NOT NULL)                                   AS eclodiu,
      (e.ninho_id IS NOT NULL AND COALESCE(e.filhotes_vivos,0) = 0) AS falha_eclosao,
      (e.predacao IS NOT NULL AND e.predacao <> 'nenhuma')       AS predado_ecl,
      COALESCE(vis.alagado, false)                               AS inundado,
      COALESCE(vis.predado, false)                               AS predado_vis,
      -- Ovos (base canônica)
      ov.viaveis, ov.perdas_total,
      ov.perda_predacao, ov.perda_alagamento, ov.perda_erosao, ov.perda_humana
    FROM ninhos_quelonios n
    JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN vw_ninho_ovos ov ON ov.ninho_id = n.id
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
      COALESCE(SUM(b.viaveis), 0)                                         AS ovos_viaveis,
      COALESCE(SUM(b.perdas_total), 0)                                    AS ovos_perdidos,
      COALESCE(SUM(b.perda_predacao), 0)                                  AS perdas_predacao,
      COALESCE(SUM(b.perda_alagamento), 0)                               AS perdas_alagamento,
      COALESCE(SUM(b.perda_erosao), 0)                                    AS perdas_erosao,
      COALESCE(SUM(b.perda_humana), 0)                                    AS perdas_humana,
      ROUND(100.0 * COALESCE(SUM(b.filhotes_vivos),0) /
        NULLIF(COALESCE(SUM(b.filhotes_vivos + b.filhotes_mortos + b.ovos_nao_nascidos),0),0),1)
                                                                          AS sucesso_pct
    FROM base b
    GROUP BY b.praia_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'praia_id', p.id, 'praia', p.nome, 'sigla', p.sigla,
    'comunidade', p.comunidade, 'municipio', p.municipio,
    'uc_id', p.uc_id, 'uc_nome', uc.nome, 'experimental', p.experimental,
    'total', a.total, 'ativos', a.ativos, 'transferidos', a.transferidos,
    'eclodidos', a.eclodidos, 'perdidos', a.perdidos, 'predados', a.predados,
    'inundados', a.inundados, 'falha_eclosao', a.falha_eclosao,
    'proximos_eclosao', a.proximos_eclosao, 'sucesso_pct', a.sucesso_pct,
    'filhotes_produzidos', a.filhotes_produzidos, 'ovos_monitorados', a.ovos_monitorados,
    'ovos_viaveis', a.ovos_viaveis, 'ovos_perdidos', a.ovos_perdidos,
    'perdas_predacao', a.perdas_predacao, 'perdas_alagamento', a.perdas_alagamento,
    'perdas_erosao', a.perdas_erosao, 'perdas_humana', a.perdas_humana
  ) ORDER BY p.nome), '[]'::jsonb)
  INTO v_result
  FROM agg a
  JOIN praias_monitoramento p ON p.id = a.praia_id
  LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_dashboard_praias TO authenticated, service_role;
