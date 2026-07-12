-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — RPC bio_analise_praias
-- ───────────────────────────────────────────────────────────
-- Camada analítica sobre a REDE de monitoramento (as praias em
-- si), complementar a bio_relatorio_completo/131/132 — aquelas
-- descrevem os ninhos; esta caracteriza o esforço amostral:
--   • resumo     — total de praias, km e ha monitorados, contagem
--                   por tipo de localização e por status;
--   • praias     — uma linha por praia com características físicas
--                   (comprimento, área, rio, UC, tipo, período) +
--                   ninhos/eclosão/filhotes e densidade dupla
--                   (ninhos/km e ninhos/ha);
--   • alertas    — praias sem comprimento/área/polígono cadastrado,
--                   sem período de monitoramento, com período fora
--                   da janela da temporada-alvo, ou sem nenhum ninho
--                   registrado (cobertura zero).
-- Função nova e isolada (não altera 091/131/132). SECURITY DEFINER.
-- Filtros aplicados à PRAIA (programa/uc/praia); ninhos contados
-- dentro do filtro de temporada quando informado.
-- Depende de: 078 (praias_monitoramento), 074 (ninhos/eclosões),
--             073 (temporadas_biomonitor).
-- ═══════════════════════════════════════════════════════════

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
      COUNT(*) FILTER (WHERE n.status = 'eclodido')       AS eclodidos,
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

GRANT EXECUTE ON FUNCTION bio_analise_praias TO authenticated;
