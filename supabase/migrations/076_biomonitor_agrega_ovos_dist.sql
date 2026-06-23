-- 076: agrega campos de ovos na postura e distância ao rio
-- nas views e RPCs de biomonitoramento.

-- ── vw_praias_biomonitor — recria com novos agregados ────────
DROP VIEW IF EXISTS vw_praias_biomonitor;

CREATE VIEW vw_praias_biomonitor
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.codigo,
  p.nome,
  p.comunidade,
  p.municipio,
  p.comprimento_m,
  p.area_ha,
  p.periodo_inicio,
  p.periodo_fim,
  p.ativa,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_Y(p.ponto_acesso) END AS lat,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_X(p.ponto_acesso) END AS lng,
  m.nome_completo   AS monitor_responsavel,
  uc.nome           AS uc_nome,
  uc.sigla          AS uc_sigla,
  prog.nome         AS programa_nome,

  -- Ninhos por status
  COUNT(DISTINCT n.id)                                                AS ninhos_total,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'encontrado')         AS ninhos_encontrados,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'transferido')        AS ninhos_transferidos,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'eclodido')           AS ninhos_eclodidos,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'perdido')            AS ninhos_perdidos,

  -- Por espécie
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'tracaja')           AS ninhos_tracaja,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'tartaruga')         AS ninhos_tartaruga,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'cabecudo')          AS ninhos_cabecudo,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'pitiU')             AS ninhos_pitiu,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'cupido')            AS ninhos_cupido,

  -- Validação
  COUNT(DISTINCT n.id) FILTER (WHERE n.status_validacao = 'pendente') AS ninhos_pendentes_validacao,

  -- Ovos da postura (registrados no encontro)
  COALESCE(SUM(n.qtd_ovos), 0)                                        AS ovos_postura_total,
  COALESCE(SUM(n.ovos_integros), 0)                                   AS ovos_integros_total,
  COALESCE(SUM(n.ovos_descartados), 0)                                AS ovos_descartados_total,
  ROUND(AVG(n.dist_rio_m)::numeric, 1)                                AS dist_rio_media_m,

  -- Ovos transferidos e eclosão
  COALESCE(SUM(t.qtd_ovos), 0)                                        AS ovos_transferidos,
  COALESCE(SUM(e.filhotes_vivos), 0)                                  AS filhotes_vivos,
  COALESCE(SUM(e.filhotes_mortos), 0)                                 AS filhotes_mortos,
  COALESCE(SUM(e.ovos_nao_nascidos), 0)                               AS ovos_nao_nascidos,
  ROUND(
    100.0 * COALESCE(SUM(e.filhotes_vivos), 0) /
    NULLIF(COALESCE(SUM(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0), 0)
  , 1)                                                                AS taxa_eclosao_pct,

  -- Predação
  COUNT(*) FILTER (WHERE e.predacao = 'por_pessoas')                  AS predacao_pessoas,
  COUNT(*) FILTER (WHERE e.predacao = 'por_animais')                  AS predacao_animais

FROM praias_monitoramento p
LEFT JOIN monitores_biodiversidade mb ON mb.id = p.monitor_responsavel_id
LEFT JOIN usuarios m   ON m.id = mb.usuario_id
LEFT JOIN unidades_conservacao uc   ON uc.id = p.uc_id
LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
LEFT JOIN ninhos_quelonios n        ON n.praia_id = p.id
LEFT JOIN transferencias_ninho t    ON t.ninho_id = n.id
LEFT JOIN eclosoes_ninho e          ON e.ninho_id = n.id
GROUP BY p.id, m.nome_completo, uc.id, prog.id, mb.id;

-- ── bio_meus_dados — adiciona agregados de ovos e distância ──
CREATE OR REPLACE FUNCTION bio_meus_dados(
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

  SELECT jsonb_build_object(
    'meus_ninhos',           COUNT(*)         FILTER (WHERE n.monitor_id = v_mon_id),
    'grupo_ninhos',          COUNT(*),
    'eclodidos',             COUNT(*)         FILTER (WHERE n.status = 'eclodido'),
    'pendentes',             COUNT(*)         FILTER (WHERE n.status = 'encontrado'),
    'filhotes_vivos',        COALESCE(SUM(e.filhotes_vivos), 0),
    'filhotes_mortos',       COALESCE(SUM(e.filhotes_mortos), 0),
    'ovos_nao_nascidos',     COALESCE(SUM(e.ovos_nao_nascidos), 0),
    'taxa_eclosao_pct',      ROUND(100.0 * COALESCE(SUM(e.filhotes_vivos),0) /
                               NULLIF(COALESCE(SUM(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos),0), 0), 1),
    -- novos: postura
    'total_ovos_postura',    COALESCE(SUM(n.qtd_ovos), 0),
    'total_ovos_integros',   COALESCE(SUM(n.ovos_integros), 0),
    'total_ovos_descartados',COALESCE(SUM(n.ovos_descartados), 0),
    'dist_rio_media_m',      ROUND(AVG(n.dist_rio_m)::numeric, 1)
  ) INTO v_result
  FROM ninhos_quelonios n
  LEFT JOIN eclosoes_ninho e ON e.ninho_id = n.id
  WHERE n.grupo_id = v_grupo_id
    AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id);

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_meus_dados TO authenticated;
