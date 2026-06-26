-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Geometria GeoJSON na view de praias
-- ───────────────────────────────────────────────────────────
-- Expõe o contorno (area_geom) e o ponto de acesso como GeoJSON
-- para (a) pré-carregar o polígono no modal de edição e (b)
-- desenhar as praias no mapa dedicado do Biomonitor.
-- Recria vw_praias_biomonitor (base 080) + area_geojson/ponto_geojson.
-- ═══════════════════════════════════════════════════════════

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
  p.experimental,
  p.comprimento_m,
  p.area_ha,
  p.periodo_inicio,
  p.periodo_fim,
  p.ativa,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_Y(p.ponto_acesso) END AS lat,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_X(p.ponto_acesso) END AS lng,
  ST_AsGeoJSON(p.ponto_acesso) AS ponto_geojson,
  ST_AsGeoJSON(p.area_geom)    AS area_geojson,
  m.nome_completo   AS monitor_responsavel,
  uc.nome           AS uc_nome,
  uc.sigla          AS uc_sigla,
  prog.nome         AS programa_nome,
  COUNT(DISTINCT n.id)                                                AS ninhos_total,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'encontrado')         AS ninhos_encontrados,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'transferido')        AS ninhos_transferidos,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'eclodido')           AS ninhos_eclodidos,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'perdido')            AS ninhos_perdidos,
  (SELECT COUNT(*) FROM ninhos_quelonios x
     WHERE x.praia_id = p.id AND x.praia_atual_id = p.id)             AS ninhos_proprios,
  (SELECT COUNT(*) FROM ninhos_quelonios x
     WHERE x.praia_id = p.id AND x.praia_atual_id IS DISTINCT FROM p.id) AS ninhos_enviados,
  (SELECT COUNT(*) FROM ninhos_quelonios x
     WHERE x.praia_atual_id = p.id AND x.praia_id IS DISTINCT FROM p.id) AS ninhos_recebidos,
  (SELECT COUNT(*) FROM ninhos_quelonios x
     WHERE x.praia_atual_id = p.id)                                   AS ninhos_incubando_aqui,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'tracaja')           AS ninhos_tracaja,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'tartaruga')         AS ninhos_tartaruga,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'cabecudo')          AS ninhos_cabecudo,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'pitiU')             AS ninhos_pitiu,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'cupido')            AS ninhos_cupido,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status_validacao = 'pendente') AS ninhos_pendentes_validacao,
  COALESCE(SUM(n.qtd_ovos), 0)                                        AS ovos_postura_total,
  COALESCE(SUM(n.ovos_integros), 0)                                   AS ovos_integros_total,
  COALESCE(SUM(n.ovos_descartados), 0)                                AS ovos_descartados_total,
  ROUND(AVG(n.dist_rio_m)::numeric, 1)                                AS dist_rio_media_m,
  COALESCE(SUM(t.qtd_ovos), 0)                                        AS ovos_transferidos,
  COALESCE(SUM(e.filhotes_vivos), 0)                                  AS filhotes_vivos,
  COALESCE(SUM(e.filhotes_mortos), 0)                                 AS filhotes_mortos,
  COALESCE(SUM(e.ovos_nao_nascidos), 0)                               AS ovos_nao_nascidos,
  ROUND(
    100.0 * COALESCE(SUM(e.filhotes_vivos), 0) /
    NULLIF(COALESCE(SUM(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0), 0)
  , 1)                                                                AS taxa_eclosao_pct,
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
