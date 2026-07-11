-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — grupo_id direto em praias_monitoramento
-- ───────────────────────────────────────────────────────────────
-- Até aqui o vínculo praia → grupo de monitoramento era indireto
-- (praia.monitor_responsavel_id → monitores_biodiversidade.grupo_id),
-- um campo opcional: praia sem responsável definido ficava sem
-- grupo, e trocar o responsável mudava o grupo da praia em silêncio.
-- Isso não é confiável para métricas oficiais "por grupo" (nº de
-- praias, área, extensão monitorada).
--
-- Passa a existir um vínculo explícito e estável: praias_monitoramento
-- .grupo_id, preenchido no cadastro/edição da praia. Backfill a partir
-- do monitor responsável atual para não perder o que já existe.
--
-- Também expõe area_m2 (além de area_ha já existente) em
-- vw_praias_biomonitor, e agrega nº de praias / área / extensão por
-- grupo em vw_grupos_biomonitor.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Coluna + backfill ──────────────────────────────────────
ALTER TABLE praias_monitoramento
  ADD COLUMN grupo_id uuid REFERENCES grupos_biomonitor(id) ON DELETE SET NULL;

UPDATE praias_monitoramento p
   SET grupo_id = mb.grupo_id
  FROM monitores_biodiversidade mb
 WHERE mb.id = p.monitor_responsavel_id
   AND p.grupo_id IS NULL;

CREATE INDEX idx_praias_grupo ON praias_monitoramento (grupo_id);

-- ── 2. vw_praias_biomonitor — adiciona grupo_id/grupo_nome/area_m2 ─
-- Fiel à definição de 141_praia_rio.sql, só acrescenta os 3 campos.
DROP VIEW IF EXISTS vw_praias_biomonitor;

CREATE VIEW vw_praias_biomonitor
WITH (security_invoker = true)
AS
SELECT p.id,
    p.codigo,
    p.nome,
    p.comunidade,
    p.municipio,
    p.uc_id,
    p.tipo_localizacao,
    p.localizacao_referencia,
    CASE
        WHEN p.tipo_localizacao = 'dentro_uc'::tipo_localizacao_praia THEN COALESCE(uc.nome, '—'::text)
        ELSE COALESCE(p.localizacao_referencia,
          CASE p.tipo_localizacao
            WHEN 'terra_indigena'::tipo_localizacao_praia THEN 'Terra Indígena'::text
            WHEN 'area_municipal'::tipo_localizacao_praia THEN 'Área Municipal'::text
            WHEN 'margem_livre'::tipo_localizacao_praia THEN 'Margem Livre'::text
            ELSE 'Outro'::text
          END)
    END AS area_display,
    p.programa_id,
    p.grupo_id,
    g.nome AS grupo_nome,
    p.monitor_responsavel_id,
    p.experimental,
    p.comprimento_m,
    p.area_ha,
    ROUND(COALESCE(p.area_ha, 0) * 10000, 2) AS area_m2,
    p.periodo_inicio,
    p.periodo_fim,
    p.ativa,
    CASE WHEN p.ponto_acesso IS NOT NULL THEN st_y(p.ponto_acesso) END AS lat,
    CASE WHEN p.ponto_acesso IS NOT NULL THEN st_x(p.ponto_acesso) END AS lng,
    st_asgeojson(p.ponto_acesso) AS ponto_geojson,
    st_asgeojson(p.area_geom) AS area_geojson,
    p.sigla,
    m.nome_completo AS monitor_responsavel,
    uc.nome AS uc_nome,
    uc.sigla AS uc_sigla,
    prog.nome AS programa_nome,
    count(DISTINCT n.id) AS ninhos_total,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'encontrado'::status_ninho) AS ninhos_encontrados,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'transferido'::status_ninho) AS ninhos_transferidos,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'eclodido'::status_ninho) AS ninhos_eclodidos,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'perdido'::status_ninho) AS ninhos_perdidos,
    (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_id = p.id AND x.praia_atual_id = p.id) AS ninhos_proprios,
    (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_id = p.id AND x.praia_atual_id IS DISTINCT FROM p.id) AS ninhos_enviados,
    (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_atual_id = p.id AND x.praia_id IS DISTINCT FROM p.id) AS ninhos_recebidos,
    (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_atual_id = p.id) AS ninhos_incubando_aqui,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'tracaja'::especie_quelonio) AS ninhos_tracaja,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'tartaruga'::especie_quelonio) AS ninhos_tartaruga,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'cabecudo'::especie_quelonio) AS ninhos_cabecudo,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'pitiU'::especie_quelonio) AS ninhos_pitiu,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'cupido'::especie_quelonio) AS ninhos_cupido,
    count(DISTINCT n.id) FILTER (WHERE n.status_validacao = 'pendente'::status_validacao_bio) AS ninhos_pendentes_validacao,
    COALESCE(sum(n.qtd_ovos), 0::bigint) AS ovos_postura_total,
    COALESCE(sum(n.ovos_integros), 0::bigint) AS ovos_integros_total,
    COALESCE(sum(n.ovos_descartados), 0::bigint) AS ovos_descartados_total,
    round(avg(n.dist_rio_m), 1) AS dist_rio_media_m,
    COALESCE(sum(t.qtd_ovos), 0::bigint) AS ovos_transferidos,
    COALESCE(sum(e.filhotes_vivos), 0::bigint) AS filhotes_vivos,
    COALESCE(sum(e.filhotes_mortos), 0::bigint) AS filhotes_mortos,
    COALESCE(sum(e.ovos_nao_nascidos), 0::bigint) AS ovos_nao_nascidos,
    round(100.0 * COALESCE(sum(e.filhotes_vivos), 0::bigint)::numeric / NULLIF(COALESCE(sum(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0::bigint), 0)::numeric, 1) AS taxa_eclosao_pct,
    count(*) FILTER (WHERE e.predacao = 'por_pessoas'::predacao_ninho) AS predacao_pessoas,
    count(*) FILTER (WHERE e.predacao = 'por_animais'::predacao_ninho) AS predacao_animais,
    (SELECT COALESCE(SUM(ov.viaveis),0) FROM vw_ninho_ovos ov JOIN ninhos_quelonios x ON x.id = ov.ninho_id WHERE x.praia_id = p.id) AS ovos_viaveis_total,
    (SELECT COALESCE(SUM(ov.perdas_total),0) FROM vw_ninho_ovos ov JOIN ninhos_quelonios x ON x.id = ov.ninho_id WHERE x.praia_id = p.id) AS ovos_perdidos_total,
    p.rio
   FROM praias_monitoramento p
     LEFT JOIN monitores_biodiversidade mb ON mb.id = p.monitor_responsavel_id
     LEFT JOIN usuarios m ON m.id = mb.usuario_id
     LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id
     LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
     LEFT JOIN grupos_biomonitor g ON g.id = p.grupo_id
     LEFT JOIN ninhos_quelonios n ON n.praia_id = p.id
     LEFT JOIN transferencias_ninho t ON t.ninho_id = n.id
     LEFT JOIN eclosoes_ninho e ON e.ninho_id = n.id
  GROUP BY p.id, m.nome_completo, uc.id, prog.id, mb.id, g.id;

-- ── 3. vw_grupos_biomonitor — nº de praias / área / extensão ────
-- Extensão monitorada = soma do comprimento_m das praias ativas do
-- grupo (mesmo critério já usado em "ninhos/km" nos relatórios). É
-- uma aproximação: mede a faixa de praia monitorada, não o curso
-- real do rio (que exigiria uma base de hidrografia própria).
--
-- Aproveita para corrigir dois problemas pré-existentes (073):
--   • JOIN com unidades_conservacao era INNER, então grupos fora de
--     UC (ex. tipo_localizacao = margem_livre, uc_id NULL — ver 099)
--     sumiam inteiramente da view. Vira LEFT JOIN.
--   • View não tinha WITH (security_invoker = true) — rodava com o
--     privilégio de quem criou a view, não do usuário chamador,
--     ignorando RLS de grupos_biomonitor/monitores_biodiversidade/
--     praias_monitoramento. vw_praias_biomonitor já usa esse padrão.
DROP VIEW IF EXISTS vw_grupos_biomonitor;

CREATE VIEW vw_grupos_biomonitor
WITH (security_invoker = true)
AS
SELECT
  g.id,
  g.nome,
  g.ativo,
  g.temporada_inicio,
  g.temporada_fim,
  g.coordenador_nome,
  p.tipo        AS programa_tipo,
  p.nome        AS programa_nome,
  uc.nome       AS uc_nome,
  uc.sigla      AS uc_sigla,
  COUNT(m.id) FILTER (WHERE m.status = 'ativo')  AS monitores_ativos,
  COUNT(m.id)                                     AS monitores_total,
  g.criado_em,
  g.atualizado_em,
  COUNT(DISTINCT pr.id)                                            AS praias_total,
  COUNT(DISTINCT pr.id) FILTER (WHERE pr.ativa)                    AS praias_ativas,
  ROUND(COALESCE(SUM(pr.area_ha) FILTER (WHERE pr.ativa), 0), 4)   AS area_ha_total,
  ROUND(COALESCE(SUM(pr.area_ha) FILTER (WHERE pr.ativa), 0) * 10000, 2) AS area_m2_total,
  ROUND(COALESCE(SUM(pr.comprimento_m) FILTER (WHERE pr.ativa), 0), 2)  AS extensao_m_total,
  ROUND(COALESCE(SUM(pr.comprimento_m) FILTER (WHERE pr.ativa), 0) / 1000.0, 3) AS extensao_km_total
FROM grupos_biomonitor g
JOIN programas_biomonitoramento p ON p.id = g.programa_id
LEFT JOIN unidades_conservacao uc ON uc.id = g.uc_id
LEFT JOIN monitores_biodiversidade m ON m.grupo_id = g.id
LEFT JOIN praias_monitoramento pr ON pr.grupo_id = g.id
GROUP BY g.id, p.id, uc.id;
