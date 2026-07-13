-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Mapa por temporada
-- ───────────────────────────────────────────────────────────────
-- vw_praias_biomonitor agrega TODOS os ninhos históricos de cada
-- praia (praia é permanente). Isso é correto para o cadastro/lista
-- de praias, mas no Mapa mistura temporadas — não dá pra olhar só
-- o ciclo selecionado.
--
-- Cria vw_praias_biomonitor_temporada: mesma base, mas quebrada por
-- (praia, temporada) — uma linha por praia em cada temporada em que
-- teve ninho. O admin usa esta view quando uma temporada específica
-- está selecionada no Mapa; com "Todas as temporadas" continua
-- usando vw_praias_biomonitor (todo o histórico), sem custo extra.
-- Fiel à definição vigente de vw_praias_biomonitor (141_praia_rio).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_praias_biomonitor_temporada
WITH (security_invoker = true)
AS
SELECT p.id,
    n.temporada_id,
    t.nome     AS temporada_nome,
    t.ano_base AS temporada_ano,
    t.is_atual AS temporada_atual,
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
    p.monitor_responsavel_id,
    p.experimental,
    p.comprimento_m,
    p.area_ha,
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
    (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_id = p.id AND x.praia_atual_id = p.id AND x.temporada_id IS NOT DISTINCT FROM n.temporada_id) AS ninhos_proprios,
    (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_id = p.id AND x.praia_atual_id IS DISTINCT FROM p.id AND x.temporada_id IS NOT DISTINCT FROM n.temporada_id) AS ninhos_enviados,
    (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_atual_id = p.id AND x.praia_id IS DISTINCT FROM p.id AND x.temporada_id IS NOT DISTINCT FROM n.temporada_id) AS ninhos_recebidos,
    (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_atual_id = p.id AND x.temporada_id IS NOT DISTINCT FROM n.temporada_id) AS ninhos_incubando_aqui,
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
    COALESCE(sum(tr.qtd_ovos), 0::bigint) AS ovos_transferidos,
    COALESCE(sum(e.filhotes_vivos), 0::bigint) AS filhotes_vivos,
    COALESCE(sum(e.filhotes_mortos), 0::bigint) AS filhotes_mortos,
    COALESCE(sum(e.ovos_nao_nascidos), 0::bigint) AS ovos_nao_nascidos,
    round(100.0 * COALESCE(sum(e.filhotes_vivos), 0::bigint)::numeric / NULLIF(COALESCE(sum(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0::bigint), 0)::numeric, 1) AS taxa_eclosao_pct,
    count(*) FILTER (WHERE e.predacao = 'por_pessoas'::predacao_ninho) AS predacao_pessoas,
    count(*) FILTER (WHERE e.predacao = 'por_animais'::predacao_ninho) AS predacao_animais,
    (SELECT COALESCE(SUM(ov.viaveis),0) FROM vw_ninho_ovos ov JOIN ninhos_quelonios x ON x.id = ov.ninho_id WHERE x.praia_id = p.id AND x.temporada_id IS NOT DISTINCT FROM n.temporada_id) AS ovos_viaveis_total,
    (SELECT COALESCE(SUM(ov.perdas_total),0) FROM vw_ninho_ovos ov JOIN ninhos_quelonios x ON x.id = ov.ninho_id WHERE x.praia_id = p.id AND x.temporada_id IS NOT DISTINCT FROM n.temporada_id) AS ovos_perdidos_total,
    p.rio
   FROM praias_monitoramento p
     LEFT JOIN monitores_biodiversidade mb ON mb.id = p.monitor_responsavel_id
     LEFT JOIN usuarios m ON m.id = mb.usuario_id
     LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id
     LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
     LEFT JOIN ninhos_quelonios n ON n.praia_id = p.id
     LEFT JOIN temporadas_biomonitor t ON t.id = n.temporada_id
     LEFT JOIN transferencias_ninho tr ON tr.ninho_id = n.id
     LEFT JOIN eclosoes_ninho e ON e.ninho_id = n.id
  GROUP BY p.id, n.temporada_id, t.nome, t.ano_base, t.is_atual, m.nome_completo, uc.id, prog.id, mb.id;
