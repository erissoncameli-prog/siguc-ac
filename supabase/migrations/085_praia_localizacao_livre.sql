-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Localização livre de praias
-- ───────────────────────────────────────────────────────────
-- Permite cadastrar praias fora de Unidades de Conservação,
-- mantendo o vínculo com UC quando aplicável.
--
-- Mudanças:
--   • Novo enum tipo_localizacao_praia
--   • praias_monitoramento.uc_id passa a ser nullable
--   • Novo campo tipo_localizacao (obrigatório, default dentro_uc)
--   • Novo campo localizacao_referencia (texto livre para fora de UC)
--   • Check garante consistência: dentro_uc exige uc_id
--   • Recria vw_praias_biomonitor expondo novos campos
-- ═══════════════════════════════════════════════════════════

-- ── 1. Enum de tipo de localização ───────────────────────────

CREATE TYPE tipo_localizacao_praia AS ENUM (
  'dentro_uc',
  'terra_indigena',
  'area_municipal',
  'margem_livre',
  'outro'
);

-- ── 2. Novos campos na tabela ─────────────────────────────────

ALTER TABLE praias_monitoramento
  ADD COLUMN tipo_localizacao     tipo_localizacao_praia NOT NULL DEFAULT 'dentro_uc',
  ADD COLUMN localizacao_referencia text;

-- ── 3. uc_id deixa de ser obrigatório ────────────────────────

ALTER TABLE praias_monitoramento
  ALTER COLUMN uc_id DROP NOT NULL;

-- ── 4. Constraint de consistência ────────────────────────────
-- dentro_uc → uc_id obrigatório
-- qualquer outro tipo → uc_id pode ser NULL

ALTER TABLE praias_monitoramento
  ADD CONSTRAINT chk_praia_localizacao CHECK (
    tipo_localizacao = 'dentro_uc' AND uc_id IS NOT NULL
    OR
    tipo_localizacao <> 'dentro_uc'
  );

-- ── 5. Recria vw_praias_biomonitor ───────────────────────────

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
  p.tipo_localizacao,
  p.localizacao_referencia,
  -- Rótulo de área unificado para exibição
  CASE
    WHEN p.tipo_localizacao = 'dentro_uc' THEN COALESCE(uc.nome, '—')
    ELSE COALESCE(p.localizacao_referencia,
      CASE p.tipo_localizacao
        WHEN 'terra_indigena'  THEN 'Terra Indígena'
        WHEN 'area_municipal'  THEN 'Área Municipal'
        WHEN 'margem_livre'    THEN 'Margem Livre'
        ELSE 'Outro'
      END)
  END AS area_display,
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
  p.sigla,
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
