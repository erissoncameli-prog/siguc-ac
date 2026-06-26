-- ── 078: expõe uc_id, programa_id e monitor_responsavel_id em vw_praias_biomonitor ──
-- Necessário para que o filtro por programa e o pré-preenchimento
-- do modal de edição de praias funcionem em admin-biomonitor.html.

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
  p.uc_id,
  p.programa_id,
  p.monitor_responsavel_id,
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

  -- Ovos da postura
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
