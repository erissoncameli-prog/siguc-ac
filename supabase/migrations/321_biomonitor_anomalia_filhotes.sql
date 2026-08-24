-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Anomalias congênitas em filhotes
-- ───────────────────────────────────────────────────────────────
-- Pedido do usuário: registrar, no evento de eclosão, filhotes que
-- nasceram vivos mas com deformidade/anomalia visível (casco, membro
-- ausente, corpo deformado, albinismo). Segue o mesmo padrão de
-- decisões já tomadas no módulo:
--
-- 1. `filhotes_anomalia` é SUBCONJUNTO de `filhotes_vivos` (CHECK
--    <=), não uma 4ª categoria somada ao total — um filhote deformado
--    ainda é um filhote vivo, entra no fluxo normal de berçário/
--    soltura. Mesma lógica de "com predação" não ser um bucket à
--    parte do total de ninhos.
-- 2. `anomalia_tipos` é catálogo FECHADO (enum), múltipla escolha por
--    eclosão — mesmo espírito de `causa_perda_ovo`: sem catálogo
--    fechado, "3 anomalias" nunca vira estatística útil (cruzamento
--    com temperatura de incubação, indicador clássico de estresse
--    térmico na literatura de TSD).
-- 3. `filhotes_bercario.anomalia` é flag INDEPENDENTE de `doente`
--    (migration 144) — anomalia é congênita (conhecida desde a
--    eclosão), doente é adoecimento durante o cuidado; sinais
--    diferentes, follow-up diferente. Toggle direto (sem passar por
--    ocorrência), pois não há "quando/causa" a registrar — a
--    anomalia já é conhecida no nascimento.
-- 4. Segue a REGRA DO SISTEMA registrada em
--    docs/biomonitor-calculos-ovos-filhotes.md: cálculo novo nasce em
--    TODAS as superfícies na mesma entrega — app (bio_dados_aba),
--    mesa/admin (vw_praias_biomonitor), relatório web
--    (bio_relatorio_completo), PDF por ninho + validação
--    (vw_ninhos_validacao), Análise Científica (bio_analise_detalhada).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Catálogo fechado de tipos de anomalia ──────────────────────
CREATE TYPE anomalia_filhote_tipo AS ENUM ('casco', 'membro', 'corpo', 'albinismo', 'outro');

-- ── 2. eclosoes_ninho: contador (subconjunto de vivos) + tipos ────
ALTER TABLE eclosoes_ninho
  ADD COLUMN IF NOT EXISTS filhotes_anomalia smallint NOT NULL DEFAULT 0 CHECK (filhotes_anomalia >= 0),
  ADD COLUMN IF NOT EXISTS anomalia_tipos anomalia_filhote_tipo[];

ALTER TABLE eclosoes_ninho
  ADD CONSTRAINT eclosoes_anomalia_leq_vivos CHECK (filhotes_anomalia <= filhotes_vivos);

COMMENT ON COLUMN eclosoes_ninho.filhotes_anomalia IS
  'Subconjunto de filhotes_vivos: quantos nasceram vivos mas com deformidade/anomalia visível.';
COMMENT ON COLUMN eclosoes_ninho.anomalia_tipos IS
  'Tipos de anomalia observados nesta eclosão (catálogo fechado), múltipla escolha.';

-- ── 3. filhotes_bercario: flag individual, independente de doente ─
ALTER TABLE filhotes_bercario ADD COLUMN IF NOT EXISTS anomalia boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN filhotes_bercario.anomalia IS
  'Filhote nasceu com deformidade/anomalia visível (congênita) — independente de doente, que é adoecimento durante o cuidado em berçário.';

-- ── 4. vw_filhotes_bercario — anomalia ao final (aditivo) ─────────
CREATE OR REPLACE VIEW vw_filhotes_bercario
WITH (security_invoker = true)
AS
SELECT
  f.id,
  f.uuid_cliente,
  f.lote_id,
  f.numero,
  f.status,
  f.data_obito,
  f.causa_obito,
  f.observacoes,
  f.criado_em,
  ub.data_medicao   AS ultima_data_medicao,
  ub.comprimento_cm AS ultimo_comprimento_cm,
  ub.peso_g         AS ultimo_peso_g,
  (SELECT count(*) FROM biometrias_individuais b WHERE b.individuo_id = f.id) AS total_medicoes,
  ub.largura_carapaca_cm     AS ultimo_largura_carapaca_cm,
  ub.comprimento_plastrao_cm AS ultimo_comprimento_plastrao_cm,
  f.doente,
  f.anomalia
FROM filhotes_bercario f
LEFT JOIN LATERAL (
  SELECT data_medicao, comprimento_cm, largura_carapaca_cm, comprimento_plastrao_cm, peso_g
  FROM biometrias_individuais
  WHERE individuo_id = f.id
  ORDER BY data_medicao DESC, hora_medicao DESC NULLS LAST, criado_em DESC
  LIMIT 1
) ub ON true;

-- ── 5. vw_ninhos_validacao — anomalia ao final (aditivo) ──────────
CREATE OR REPLACE VIEW vw_ninhos_validacao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.numero_atual,
  n.especie,
  n.data_encontro,
  n.hora_desova,
  n.status,
  n.status_validacao,
  n.motivo_rejeicao,
  n.observacoes,
  n.foto_urls,
  n.criado_em,
  n.sincronizado_em,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_Y(n.localizacao) END AS lat,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_X(n.localizacao) END AS lng,
  n.precisao_gps_m,
  n.qtd_ovos,
  n.qtd_ovos                   AS ninho_qtd_ovos,
  n.ovos_integros,
  n.ovos_descartados,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'natural'::motivo_descarte)  AS descartados_natural,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'predacao'::motivo_descarte) AS descartados_predacao,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'humana'::motivo_descarte)   AS descartados_humana,
  n.dist_rio_m,
  n.dist_rio_metodo,
  n.temperatura_c,
  n.umidade_pct,
  n.profundidade_cm,
  n.alerta_campo,
  n.temporada_id,
  tmp.nome      AS temporada_nome,
  tmp.ano_base  AS temporada_ano,
  tmp.is_atual  AS temporada_atual,
  p.id          AS praia_id,
  p.nome        AS praia_nome,
  p.codigo      AS praia_codigo,
  n.praia_atual_id,
  pa.nome         AS praia_atual_nome,
  pa.sigla        AS praia_atual_sigla,
  pa.experimental AS praia_atual_experimental,
  uc.nome       AS uc_nome,
  mon.id        AS monitor_id,
  mon.nome_completo AS monitor_nome,
  g.nome        AS grupo_nome,
  g.id          AS grupo_id,
  t.data_transferencia,
  t.qtd_ovos    AS transf_qtd_ovos,
  t.local_destino,
  e.data_nascimento,
  e.filhotes_vivos,
  e.filhotes_mortos,
  e.ovos_nao_nascidos,
  e.predacao,
  n.incubacao_dias_previstos,
  n.data_prevista_eclosao,
  (n.data_prevista_eclosao - CURRENT_DATE) AS dias_para_eclosao,
  ov.viaveis      AS ovos_viaveis,
  ov.perdas_total AS ovos_perdidos_total,
  e.foto_urls     AS eclosao_foto_urls,
  ov.perda_alagamento AS ovos_perda_alagamento,
  ov.perda_erosao     AS ovos_perda_erosao,
  ov.perda_humana     AS ovos_perda_humana,
  ROUND(100.0 * COALESCE(e.filhotes_vivos, 0) /
    NULLIF(COALESCE(e.filhotes_vivos, 0) + COALESCE(e.filhotes_mortos, 0) + COALESCE(e.ovos_nao_nascidos, 0), 0)
  , 1) AS taxa_eclosao_pct,
  ROUND(100.0 * COALESCE(n.ovos_integros, 0) / NULLIF(n.qtd_ovos, 0), 1) AS taxa_fertilidade_pct,
  ROUND(100.0 * COALESCE(e.filhotes_vivos, 0) / NULLIF(n.ovos_integros, 0), 1) AS eficiencia_ninho_pct,
  -- NOVO — anomalia congênita (subconjunto de filhotes_vivos)
  e.filhotes_anomalia AS filhotes_anomalia,
  e.anomalia_tipos     AS anomalia_tipos
FROM ninhos_quelonios n
LEFT JOIN temporadas_biomonitor tmp    ON tmp.id = n.temporada_id
LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
LEFT JOIN praias_monitoramento pa      ON pa.id = n.praia_atual_id
LEFT JOIN unidades_conservacao uc      ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
LEFT JOIN grupos_biomonitor g          ON g.id = n.grupo_id
LEFT JOIN vw_ninho_ovos ov             ON ov.ninho_id = n.id
LEFT JOIN LATERAL (
  SELECT data_transferencia, qtd_ovos, local_destino
  FROM transferencias_ninho
  WHERE ninho_id = n.id
  ORDER BY data_transferencia DESC
  LIMIT 1
) t ON true
LEFT JOIN LATERAL (
  SELECT data_nascimento, filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao, foto_urls,
    filhotes_anomalia, anomalia_tipos
  FROM eclosoes_ninho
  WHERE ninho_id = n.id
  ORDER BY data_nascimento DESC
  LIMIT 1
) e ON true;

-- ── 6. vw_praias_biomonitor — total de anomalias por praia (aditivo) ──
-- ⚠️ ACHADO ao aplicar: a view em produção tinha DRIFT em relação ao
-- repositório — colunas grupo_id/grupo_nome/area_m2 existem em
-- produção mas nunca foram commitadas em nenhuma migration (mesma
-- classe de drift já documentada no CLAUDE.md para outras policies).
-- Pior: a correção de fan-out + "eclodidos inclui em_bercario/soltado"
-- da migration 146 NUNCA chegou a esta view em produção — o drift
-- sobrescreveu com uma versão anterior (JOIN direto com
-- transferencias_ninho/eclosoes_ninho, multiplicando somas quando um
-- ninho tem 2+ transferências ou eclosões; ninhos_eclodidos só
-- contava status='eclodido'). Corrigido aqui junto, reconstruído a
-- partir do pg_get_viewdef() real de produção (não do arquivo local
-- desatualizado), preservando grupo_id/grupo_nome/area_m2 na mesma
-- posição e só acrescentando filhotes_anomalia ao final.
CREATE OR REPLACE VIEW vw_praias_biomonitor AS
SELECT
  p.id, p.codigo, p.nome, p.comunidade, p.municipio, p.uc_id,
  p.tipo_localizacao, p.localizacao_referencia,
  CASE
    WHEN p.tipo_localizacao = 'dentro_uc' THEN COALESCE(uc.nome, '—')
    ELSE COALESCE(p.localizacao_referencia,
      CASE p.tipo_localizacao
        WHEN 'terra_indigena' THEN 'Terra Indígena'
        WHEN 'area_municipal' THEN 'Área Municipal'
        WHEN 'margem_livre'   THEN 'Margem Livre'
        ELSE 'Outro'
      END)
  END AS area_display,
  p.programa_id,
  p.grupo_id,
  g.nome AS grupo_nome,
  p.monitor_responsavel_id, p.experimental,
  p.comprimento_m, p.area_ha,
  round(COALESCE(p.area_ha, 0) * 10000, 2) AS area_m2,
  p.periodo_inicio, p.periodo_fim, p.ativa,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN st_y(p.ponto_acesso) END AS lat,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN st_x(p.ponto_acesso) END AS lng,
  st_asgeojson(p.ponto_acesso) AS ponto_geojson,
  st_asgeojson(p.area_geom)    AS area_geojson,
  p.sigla,
  m.nome_completo AS monitor_responsavel,
  uc.nome  AS uc_nome,
  uc.sigla AS uc_sigla,
  prog.nome AS programa_nome,
  count(DISTINCT n.id) AS ninhos_total,
  count(DISTINCT n.id) FILTER (WHERE n.status = 'encontrado')  AS ninhos_encontrados,
  count(DISTINCT n.id) FILTER (WHERE n.status = 'transferido') AS ninhos_transferidos,
  count(DISTINCT n.id) FILTER (WHERE n.status IN ('eclodido','em_bercario','soltado')) AS ninhos_eclodidos,
  count(DISTINCT n.id) FILTER (WHERE n.status = 'perdido')     AS ninhos_perdidos,
  (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_id = p.id AND x.praia_atual_id = p.id)               AS ninhos_proprios,
  (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_id = p.id AND x.praia_atual_id IS DISTINCT FROM p.id) AS ninhos_enviados,
  (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_atual_id = p.id AND x.praia_id IS DISTINCT FROM p.id) AS ninhos_recebidos,
  (SELECT count(*) FROM ninhos_quelonios x WHERE x.praia_atual_id = p.id)                                      AS ninhos_incubando_aqui,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'tracaja'::especie_quelonio)   AS ninhos_tracaja,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'tartaruga'::especie_quelonio) AS ninhos_tartaruga,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'cabecudo'::especie_quelonio)  AS ninhos_cabecudo,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'pitiU'::especie_quelonio)     AS ninhos_pitiu,
  count(DISTINCT n.id) FILTER (WHERE n.especie = 'cupido'::especie_quelonio)    AS ninhos_cupido,
  count(DISTINCT n.id) FILTER (WHERE n.status_validacao = 'pendente'::status_validacao_bio) AS ninhos_pendentes_validacao,
  COALESCE(sum(n.qtd_ovos), 0)         AS ovos_postura_total,
  COALESCE(sum(n.ovos_integros), 0)    AS ovos_integros_total,
  COALESCE(sum(n.ovos_descartados), 0) AS ovos_descartados_total,
  round(avg(n.dist_rio_m), 1)          AS dist_rio_media_m,
  (SELECT COALESCE(sum(t.qtd_ovos), 0)
     FROM transferencias_ninho t JOIN ninhos_quelonios x ON x.id = t.ninho_id
    WHERE x.praia_id = p.id) AS ovos_transferidos,
  (SELECT COALESCE(sum(e.filhotes_vivos), 0)
     FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id) AS filhotes_vivos,
  (SELECT COALESCE(sum(e.filhotes_mortos), 0)
     FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id) AS filhotes_mortos,
  (SELECT COALESCE(sum(e.ovos_nao_nascidos), 0)
     FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id) AS ovos_nao_nascidos,
  (SELECT round(100.0 * COALESCE(sum(e.filhotes_vivos), 0)
          / NULLIF(COALESCE(sum(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0), 0), 1)
     FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id) AS taxa_eclosao_pct,
  (SELECT count(*) FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id AND e.predacao = 'por_pessoas'::predacao_ninho) AS predacao_pessoas,
  (SELECT count(*) FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id AND e.predacao = 'por_animais'::predacao_ninho) AS predacao_animais,
  (SELECT COALESCE(sum(ov.viaveis), 0::numeric)
     FROM vw_ninho_ovos ov JOIN ninhos_quelonios x ON x.id = ov.ninho_id
    WHERE x.praia_id = p.id) AS ovos_viaveis_total,
  (SELECT COALESCE(sum(ov.perdas_total), 0::numeric)
     FROM vw_ninho_ovos ov JOIN ninhos_quelonios x ON x.id = ov.ninho_id
    WHERE x.praia_id = p.id) AS ovos_perdidos_total,
  p.rio,
  -- NOVO — total de filhotes com anomalia congênita (subconjunto de filhotes_vivos)
  (SELECT COALESCE(sum(e.filhotes_anomalia), 0)
     FROM eclosoes_ninho e JOIN ninhos_quelonios x ON x.id = e.ninho_id
    WHERE x.praia_id = p.id) AS filhotes_anomalia
FROM praias_monitoramento p
LEFT JOIN monitores_biodiversidade mb ON mb.id = p.monitor_responsavel_id
LEFT JOIN usuarios m                  ON m.id = mb.usuario_id
LEFT JOIN unidades_conservacao uc     ON uc.id = p.uc_id
LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
LEFT JOIN grupos_biomonitor g         ON g.id = p.grupo_id
LEFT JOIN ninhos_quelonios n          ON n.praia_id = p.id
GROUP BY p.id, m.nome_completo, uc.id, prog.id, mb.id, g.id;

-- ── 7. bio_dados_aba — anomalia no agregado do app (aba Dados) ────
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
      e.filhotes_anomalia,
      e.predacao,
      e.data_nascimento,
      CASE
        WHEN e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
        THEN (e.data_nascimento - n.data_encontro)
      END AS dias_incubacao
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, filhotes_anomalia, predacao, data_nascimento
      FROM eclosoes_ninho
      WHERE ninho_id = n.id ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  agg AS (
    SELECT
      COUNT(*)                                               AS total_ninhos,
      COUNT(*) FILTER (WHERE monitor_id = v_mon_id)         AS meus_ninhos,
      COUNT(*) FILTER (WHERE status = 'encontrado')         AS encontrados,
      COUNT(*) FILTER (WHERE status = 'transferido')        AS transferidos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'eclodido')           AS eclodidos_status,
      COUNT(*) FILTER (WHERE status = 'em_bercario')        AS em_bercario,
      COUNT(*) FILTER (WHERE status = 'soltado')            AS soltados,
      COUNT(*) FILTER (WHERE status = 'perdido')            AS perdidos,
      COALESCE(SUM(filhotes_vivos),  0)                     AS filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0)                     AS filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0)                   AS ovos_nao_nascidos,
      COALESCE(SUM(filhotes_anomalia), 0)                   AS filhotes_anomalia,
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

  por_especie AS (
    SELECT
      especie,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                     AS filhotes_vivos,
      ROUND(
        100.0 * COALESCE(SUM(filhotes_vivos), 0) /
        NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0)
      , 1)                                                  AS taxa_eclosao
    FROM base
    GROUP BY especie
    ORDER BY total DESC
  ),

  por_mes AS (
    SELECT
      to_char(date_trunc('month', data_encontro), 'YYYY-MM') AS mes,
      COUNT(*)                                               AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                      AS filhotes
    FROM base
    WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro)
    ORDER BY date_trunc('month', data_encontro)
  ),

  top_praias AS (
    SELECT praia_nome, COUNT(*) AS total
    FROM base
    WHERE praia_nome IS NOT NULL
    GROUP BY praia_nome
    ORDER BY total DESC
    LIMIT 6
  ),

  berc_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE l.status IN ('ativo','soltado')) AS total_lotes,
      COALESCE(SUM(l.qtd_entrada), 0)                         AS total_entrada,
      COALESCE(SUM(ls.soltado), 0)                            AS total_soltado,
      COALESCE(SUM(vlm.mortes), 0)                            AS total_mortalidade
    FROM lotes_bercario l
    LEFT JOIN vw_lotes_bercario_mortalidade vlm ON vlm.lote_id = l.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
  ),

  solturas_agg AS (
    SELECT
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario
    FROM solturas_filhotes sf
    LEFT JOIN ninhos_quelonios n ON n.id = sf.ninho_id
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
    GROUP BY ob.tipo
    ORDER BY total DESC
  ),

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
    'meus_ninhos',              a.meus_ninhos,
    'grupo_ninhos',             a.total_ninhos,
    'eclodidos',                a.eclodidos,
    'pendentes',                a.encontrados,
    'filhotes_vivos',           a.filhotes_vivos,
    'filhotes_mortos',          a.filhotes_mortos,
    'ovos_nao_nascidos',        a.ovos_nao_nascidos,
    'filhotes_anomalia',        a.filhotes_anomalia,
    'taxa_anomalia_pct',        ROUND(100.0 * a.filhotes_anomalia / NULLIF(a.filhotes_vivos, 0), 1),
    'total_ovos_postura',       a.total_ovos_postura,
    'total_ovos_integros',      a.total_ovos_integros,
    'total_ovos_descartados',   a.total_ovos_descartados,
    'dist_rio_media_m',         a.dist_rio_media_m,
    'temp_media_c',             a.temp_media_c,
    'umidade_media_pct',        a.umidade_media_pct,
    'profundidade_media_cm',    a.profundidade_media_cm,

    'taxa_eclosao_pct',
      ROUND(100.0 * a.filhotes_vivos /
        NULLIF(a.filhotes_vivos + a.filhotes_mortos + a.ovos_nao_nascidos, 0), 1),

    'taxa_sucesso_nidificacao_pct',
      ROUND(100.0 * a.eclodidos / NULLIF(a.total_ninhos, 0), 1),

    'taxa_fertilidade_pct',
      ROUND(100.0 * a.total_ovos_integros / NULLIF(a.total_ovos_postura, 0), 1),

    'eficiencia_ninho_pct',
      ROUND(100.0 * a.filhotes_vivos / NULLIF(a.total_ovos_integros, 0), 1),

    'taxa_predacao_pct',
      ROUND(100.0 * a.perdidos / NULLIF(a.total_ninhos, 0), 1),

    'taxa_transferencia_pct',
      ROUND(100.0 * a.transferidos / NULLIF(a.total_ninhos, 0), 1),

    'incubacao_media_dias',     a.incubacao_media_dias,

    'por_status', jsonb_build_object(
      'encontrado',  a.encontrados,
      'transferido', a.transferidos,
      'eclodido',    a.eclodidos_status,
      'em_bercario', a.em_bercario,
      'soltado',     a.soltados,
      'perdido',     a.perdidos
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

    'bercario_total_lotes',     ba.total_lotes,
    'bercario_total_entrada',   ba.total_entrada,
    'bercario_total_soltado',   ba.total_soltado,
    'bercario_mortalidade',     ba.total_mortalidade,

    'taxa_sobrevivencia_bercario_pct',
      ROUND(100.0 * ba.total_soltado / NULLIF(ba.total_entrada, 0), 1),

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

-- ── 8. bio_relatorio_completo — anomalia no relatório oficial ─────
CREATE OR REPLACE FUNCTION bio_relatorio_completo(
  p_temporada_id     uuid DEFAULT NULL,
  p_programa_id      uuid DEFAULT NULL,
  p_uc_id            uuid DEFAULT NULL,
  p_praia_id         uuid DEFAULT NULL,
  p_tipo_localizacao tipo_localizacao_praia DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  WITH base_ids AS (
    SELECT n.id
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p  ON p.id = n.praia_id
    LEFT JOIN grupos_biomonitor gb    ON gb.id = n.grupo_id
    WHERE
      (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_programa_id IS NULL OR gb.programa_id = p_programa_id)
      AND (p_uc_id IS NULL OR COALESCE(n.uc_id, p.uc_id) = p_uc_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
      AND (p_tipo_localizacao IS NULL OR p.tipo_localizacao = p_tipo_localizacao)
  ),
  base AS (
    SELECT
      n.id, n.especie, n.status, n.monitor_id, n.praia_id, n.data_encontro,
      n.qtd_ovos, n.ovos_integros, n.ovos_descartados,
      COALESCE(ov.perda_predacao, 0)   AS ovos_predados,
      COALESCE(ov.perdas_total, 0)     AS ovos_descartes_total,
      COALESCE(ov.viaveis,
        GREATEST(COALESCE(n.qtd_ovos,0) - COALESCE(ov.perdas_total,0), 0)) AS ovos_viaveis_ninho,
      COALESCE(ov.perda_alagamento, 0) AS ovos_perda_alagamento,
      COALESCE(ov.perda_erosao, 0)     AS ovos_perda_erosao,
      COALESCE(ov.perda_humana, 0)     AS ovos_perda_humana,
      n.dist_rio_m, n.temperatura_c, n.umidade_pct, n.profundidade_cm,
      COALESCE(n.uc_id, p.uc_id) AS uc_id,
      p.nome AS praia_nome, p.codigo AS praia_codigo, p.comprimento_m,
      uc.nome AS uc_nome, uc.sigla AS uc_sigla,
      mb.nome_completo AS monitor_nome, gb.nome AS grupo_nome,
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos, e.filhotes_anomalia, e.anomalia_tipos,
      e.predacao, e.data_nascimento,
      CASE WHEN e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
        THEN (e.data_nascimento - n.data_encontro) END AS dias_incubacao
    FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id
    LEFT JOIN vw_ninho_ovos ov         ON ov.ninho_id = n.id
    LEFT JOIN praias_monitoramento p   ON p.id = n.praia_id
    LEFT JOIN unidades_conservacao uc  ON uc.id = COALESCE(n.uc_id, p.uc_id)
    LEFT JOIN monitores_biodiversidade mb ON mb.id = n.monitor_id
    LEFT JOIN grupos_biomonitor gb     ON gb.id = n.grupo_id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, filhotes_anomalia, anomalia_tipos, predacao, data_nascimento
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
  ),
  agg AS (
    SELECT
      COUNT(*) AS total_ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'eclodido')    AS eclodidos_status,
      COUNT(*) FILTER (WHERE status = 'em_bercario') AS em_bercario,
      COUNT(*) FILTER (WHERE status = 'soltado')     AS soltados,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido') AS transferidos,
      COUNT(*) FILTER (WHERE status = 'encontrado') AS pendentes,
      COALESCE(SUM(qtd_ovos), 0) AS total_ovos_postura,
      COALESCE(SUM(ovos_integros), 0) AS total_ovos_integros,
      COALESCE(SUM(ovos_descartados), 0) AS total_ovos_descartados,
      COALESCE(SUM(ovos_predados), 0) AS total_ovos_predados,
      COALESCE(SUM(ovos_viaveis_ninho), 0) AS total_ovos_viaveis,
      COALESCE(SUM(ovos_perda_alagamento), 0) AS total_ovos_perda_alagamento,
      COALESCE(SUM(ovos_perda_erosao), 0)     AS total_ovos_perda_erosao,
      COALESCE(SUM(ovos_perda_humana), 0)     AS total_ovos_perda_humana,
      COALESCE(SUM(filhotes_vivos), 0) AS total_filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0) AS total_filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0) AS total_ovos_nao_nascidos,
      COALESCE(SUM(filhotes_anomalia), 0) AS total_filhotes_anomalia,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos_postura,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(temperatura_c)::numeric, 1) AS temp_media_c,
      ROUND(AVG(umidade_pct)::numeric, 1) AS umidade_media_pct,
      ROUND(AVG(profundidade_cm)::numeric, 1) AS profundidade_media_cm,
      ROUND(AVG(dias_incubacao)::numeric) AS incubacao_media_dias,
      COUNT(*) FILTER (WHERE predacao = 'por_pessoas') AS predacao_pessoas,
      COUNT(*) FILTER (WHERE predacao = 'por_animais') AS predacao_animais,
      COUNT(*) FILTER (WHERE predacao = 'nenhuma') AS sem_predacao
    FROM base
  ),
  por_mes AS (
    SELECT to_char(date_trunc('month', data_encontro), 'YYYY-MM') AS mes,
      COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes, ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos
    FROM base WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro) ORDER BY date_trunc('month', data_encontro)
  ),
  por_ano AS (
    SELECT EXTRACT(YEAR FROM data_encontro)::int AS ano, COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE data_encontro IS NOT NULL GROUP BY EXTRACT(YEAR FROM data_encontro) ORDER BY ano
  ),
  por_especie AS (
    SELECT especie, COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido') AS transferidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0) AS filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0) AS ovos_nao_nascidos,
      COALESCE(SUM(filhotes_anomalia), 0) AS filhotes_anomalia,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos_postura,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(ovos_integros), 0), 0), 1) AS eficiencia_pct,
      ROUND(AVG(dias_incubacao)::numeric) AS incubacao_media_dias,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(temperatura_c)::numeric, 1) AS temp_media_c
    FROM base GROUP BY especie ORDER BY total DESC
  ),
  por_praia AS (
    SELECT praia_id, praia_nome, praia_codigo, uc_nome, uc_sigla,
      MAX(comprimento_m) AS comprimento_m, COUNT(*) AS ninhos_total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(AVG(dist_rio_m)::numeric, 1) AS dist_rio_media_m,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos,
      COUNT(*) FILTER (WHERE predacao IN ('por_pessoas','por_animais')) AS com_predacao,
      ROUND(CASE WHEN MAX(comprimento_m) > 0 THEN 1000.0 * COUNT(*) / MAX(comprimento_m) END::numeric, 2) AS densidade_ninhos_km
    FROM base WHERE praia_id IS NOT NULL
    GROUP BY praia_id, praia_nome, praia_codigo, uc_nome, uc_sigla ORDER BY ninhos_total DESC
  ),
  por_uc AS (
    SELECT uc_id, uc_nome, uc_sigla, COUNT(*) AS ninhos_total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos
    FROM base WHERE uc_id IS NOT NULL GROUP BY uc_id, uc_nome, uc_sigla ORDER BY ninhos_total DESC
  ),
  por_monitor AS (
    SELECT monitor_id, monitor_nome, grupo_nome, COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE monitor_id IS NOT NULL GROUP BY monitor_id, monitor_nome, grupo_nome ORDER BY ninhos DESC LIMIT 25
  ),
  berc_agg AS (
    SELECT COUNT(*) FILTER (WHERE l.status IN ('ativo','soltado')) AS total_lotes,
      COALESCE(SUM(l.qtd_entrada), 0) AS total_entrada,
      COALESCE(SUM(ls.soltado), 0) AS total_soltado
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
  ),
  berc_mortes_canon AS (
    SELECT COALESCE(SUM(vlm.mortes), 0) AS total_mortes
    FROM vw_lotes_bercario_mortalidade vlm
    JOIN base_ids bi ON bi.id = vlm.ninho_id
  ),
  solturas_agg AS (
    SELECT COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true), 0) AS via_bercario
    FROM base_ids bi JOIN solturas_filhotes sf ON sf.ninho_id = bi.id
  ),
  soltos_especie AS (
    SELECT n.especie,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada), 0)                                        AS total
    FROM base_ids bi
    JOIN solturas_filhotes sf ON sf.ninho_id = bi.id
    JOIN ninhos_quelonios n   ON n.id = bi.id
    GROUP BY n.especie
    ORDER BY total DESC
  ),
  lote_berc AS (
    SELECT l.id, l.bercario_id, l.bercario_nome, n.especie,
      COALESCE(l.qtd_entrada, 0) AS entrada,
      COALESCE(ls.soltado, 0)    AS soltos
    FROM base_ids bi
    JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ninhos_quelonios n ON n.id = bi.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
  ),
  taxa_soltura_bercario AS (
    SELECT bercario_nome,
      (array_agg(especie) FILTER (WHERE especie IS NOT NULL))[1] AS especie,
      SUM(entrada) AS entrada, SUM(soltos) AS soltos,
      ROUND(100.0 * SUM(soltos) / NULLIF(SUM(entrada), 0), 1) AS taxa_pct
    FROM lote_berc GROUP BY bercario_id, bercario_nome HAVING SUM(entrada) > 0 ORDER BY bercario_nome
  ),
  taxa_soltura_especie AS (
    SELECT especie, SUM(entrada) AS entrada, SUM(soltos) AS soltos,
      ROUND(100.0 * SUM(soltos) / NULLIF(SUM(entrada), 0), 1) AS taxa_pct
    FROM lote_berc WHERE especie IS NOT NULL GROUP BY especie HAVING SUM(entrada) > 0 ORDER BY especie
  ),
  crescimento_especie AS (
    SELECT especie, data,
      ROUND(AVG(comp)::numeric, 1) AS comp_medio,
      ROUND(AVG(peso)::numeric, 1) AS peso_medio
    FROM (
      SELECT n.especie AS especie, to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
        ob.comprimento_medio_cm AS comp, ob.peso_medio_g AS peso
      FROM base_ids bi
      JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN ninhos_quelonios n ON n.id = bi.id
      JOIN ocorrencias_bercario ob ON ob.lote_id = l.id
      WHERE ob.tipo = 'biometria'

      UNION ALL

      SELECT n.especie, to_char(b.data_medicao, 'YYYY-MM-DD') AS data,
        b.comprimento_cm AS comp, b.peso_g AS peso
      FROM base_ids bi
      JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN ninhos_quelonios n ON n.id = bi.id
      JOIN filhotes_bercario fb ON fb.lote_id = l.id
      JOIN biometrias_individuais b ON b.individuo_id = fb.id
    ) t
    WHERE comp IS NOT NULL OR peso IS NOT NULL
    GROUP BY especie, data
    ORDER BY especie, data
  ),
  comp_ind AS (
    SELECT b.individuo_id,
      (array_agg(b.comprimento_cm ORDER BY b.data_medicao,      b.hora_medicao))[1] AS ini,
      (array_agg(b.comprimento_cm ORDER BY b.data_medicao DESC, b.hora_medicao DESC))[1] AS fim
    FROM biometrias_individuais b
    JOIN filhotes_bercario fb ON fb.id = b.individuo_id
    JOIN lotes_bercario l ON l.id = fb.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    WHERE b.comprimento_cm IS NOT NULL
    GROUP BY b.individuo_id HAVING COUNT(*) >= 2
  ),
  peso_ind AS (
    SELECT b.individuo_id,
      (array_agg(b.peso_g ORDER BY b.data_medicao,      b.hora_medicao))[1] AS ini,
      (array_agg(b.peso_g ORDER BY b.data_medicao DESC, b.hora_medicao DESC))[1] AS fim
    FROM biometrias_individuais b
    JOIN filhotes_bercario fb ON fb.id = b.individuo_id
    JOIN lotes_bercario l ON l.id = fb.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    WHERE b.peso_g IS NOT NULL
    GROUP BY b.individuo_id HAVING COUNT(*) >= 2
  ),
  ganho_bercario AS (
    SELECT l.bercario_nome,
      (array_agg(n.especie) FILTER (WHERE n.especie IS NOT NULL))[1] AS especie,
      ROUND(AVG(ci.fim - ci.ini)::numeric, 1) AS delta_comp,
      ROUND(AVG(pi.fim - pi.ini)::numeric, 1) AS delta_peso,
      COUNT(DISTINCT ci.individuo_id)         AS n_comp,
      COUNT(DISTINCT pi.individuo_id)         AS n_peso
    FROM base_ids bi
    JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ninhos_quelonios n ON n.id = bi.id
    JOIN filhotes_bercario fb ON fb.lote_id = l.id
    LEFT JOIN comp_ind ci ON ci.individuo_id = fb.id
    LEFT JOIN peso_ind pi ON pi.individuo_id = fb.id
    WHERE ci.individuo_id IS NOT NULL OR pi.individuo_id IS NOT NULL
    GROUP BY l.bercario_id, l.bercario_nome
    ORDER BY l.bercario_nome
  ),
  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ocorrencias_bercario ob ON ob.lote_id = l.id GROUP BY ob.tipo ORDER BY total DESC
  ),
  biometria_serie AS (
    SELECT data,
      ROUND(AVG(comp)::numeric, 1) AS comp_medio,
      ROUND(AVG(peso)::numeric, 1) AS peso_medio,
      SUM(n) AS n_amostrados
    FROM (
      SELECT to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
        ob.comprimento_medio_cm AS comp, ob.peso_medio_g AS peso,
        COALESCE(ob.n_amostrados, 0) AS n
      FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN ocorrencias_bercario ob ON ob.lote_id = l.id
      WHERE ob.tipo = 'biometria'

      UNION ALL

      SELECT to_char(b.data_medicao, 'YYYY-MM-DD') AS data,
        b.comprimento_cm AS comp, b.peso_g AS peso, 1 AS n
      FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
      JOIN filhotes_bercario fb ON fb.lote_id = l.id
      JOIN biometrias_individuais b ON b.individuo_id = fb.id
    ) todas
    WHERE comp IS NOT NULL OR peso IS NOT NULL
    GROUP BY data ORDER BY data LIMIT 60
  ),
  descartes_por_causa AS (
    SELECT COALESCE(d.causa::text, d.motivo::text, '—') AS causa, COALESCE(SUM(d.qtd),0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY COALESCE(d.causa::text, d.motivo::text, '—') ORDER BY qtd DESC
  ),
  descartes_por_etapa AS (
    SELECT COALESCE(d.etapa, '—') AS etapa, COALESCE(SUM(d.qtd),0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY d.etapa ORDER BY qtd DESC
  ),
  ninhos_destruidos_causa AS (
    SELECT COALESCE(v.causa_destruicao::text, '—') AS causa, COUNT(DISTINCT v.ninho_id) AS n
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
    WHERE v.status_ninho = 'destruido'
    GROUP BY v.causa_destruicao ORDER BY n DESC
  ),
  pred_incub AS (
    SELECT
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'por_animais')  AS animais,
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'por_pessoas')  AS pessoas,
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'desconhecida') AS desconhecida
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
  ),
  pred_solt AS (
    SELECT
      COUNT(*) FILTER (WHERE sf.predacao_soltura)     AS com,
      COUNT(*) FILTER (WHERE NOT sf.predacao_soltura) AS sem
    FROM base_ids bi JOIN solturas_filhotes sf ON sf.ninho_id = bi.id
  ),
  -- NOVO: quebra dos tipos de anomalia (unnest do array por ninho)
  anomalia_por_tipo AS (
    SELECT t.tipo::text AS tipo, COUNT(*) AS n_eclosoes
    FROM base b, UNNEST(b.anomalia_tipos) AS t(tipo)
    WHERE b.filhotes_anomalia > 0
    GROUP BY t.tipo ORDER BY n_eclosoes DESC
  )
  SELECT jsonb_build_object(
    'kpis', (
      SELECT jsonb_build_object(
        'total_ninhos', a.total_ninhos, 'eclodidos', a.eclodidos, 'perdidos', a.perdidos,
        'eclodidos_status', a.eclodidos_status, 'em_bercario', a.em_bercario, 'soltados', a.soltados,
        'transferidos', a.transferidos, 'pendentes', a.pendentes,
        'total_ovos_postura', a.total_ovos_postura, 'total_ovos_integros', a.total_ovos_integros,
        'total_ovos_descartados', a.total_ovos_descartados,
        'total_ovos_predados', a.total_ovos_predados, 'total_ovos_viaveis', a.total_ovos_viaveis,
        'total_ovos_perda_alagamento', a.total_ovos_perda_alagamento,
        'total_ovos_perda_erosao', a.total_ovos_perda_erosao,
        'total_ovos_perda_humana', a.total_ovos_perda_humana,
        'total_filhotes_vivos', a.total_filhotes_vivos,
        'total_filhotes_vivos_liquido', GREATEST(a.total_filhotes_vivos - bmc.total_mortes, 0),
        'total_filhotes_mortos', a.total_filhotes_mortos,
        'total_filhotes_anomalia', a.total_filhotes_anomalia,
        'taxa_anomalia_pct', ROUND(100.0 * a.total_filhotes_anomalia / NULLIF(a.total_filhotes_vivos, 0), 1),
        'total_ovos_nao_nascidos', a.total_ovos_nao_nascidos, 'media_ovos_postura', a.media_ovos_postura,
        'dist_rio_media_m', a.dist_rio_media_m, 'temp_media_c', a.temp_media_c,
        'umidade_media_pct', a.umidade_media_pct, 'profundidade_media_cm', a.profundidade_media_cm,
        'incubacao_media_dias', a.incubacao_media_dias,
        'taxa_eclosao_pct', ROUND(100.0 * a.total_filhotes_vivos / NULLIF(a.total_filhotes_vivos + a.total_filhotes_mortos + a.total_ovos_nao_nascidos, 0), 1),
        'taxa_mortalidade_embrionaria_pct', ROUND(100.0 * (a.total_filhotes_mortos + a.total_ovos_nao_nascidos) / NULLIF(a.total_filhotes_vivos + a.total_filhotes_mortos + a.total_ovos_nao_nascidos, 0), 1),
        'taxa_sucesso_nidificacao_pct', ROUND(100.0 * a.eclodidos / NULLIF(a.total_ninhos, 0), 1),
        'taxa_fertilidade_pct', ROUND(100.0 * a.total_ovos_integros / NULLIF(a.total_ovos_postura, 0), 1),
        'eficiencia_ninho_pct', ROUND(100.0 * a.total_filhotes_vivos / NULLIF(a.total_ovos_integros, 0), 1),
        'taxa_predacao_pct', ROUND(100.0 * a.perdidos / NULLIF(a.total_ninhos, 0), 1),
        'taxa_transferencia_pct', ROUND(100.0 * a.transferidos / NULLIF(a.total_ninhos, 0), 1),
        'bercario_total_lotes', ba.total_lotes, 'bercario_total_entrada', ba.total_entrada,
        'bercario_total_soltado', ba.total_soltado, 'bercario_mortalidade', bmc.total_mortes,
        'taxa_sobrevivencia_bercario_pct', ROUND(100.0 * ba.total_soltado / NULLIF(ba.total_entrada, 0), 1),
        'taxa_mortalidade_bercario_pct', ROUND(100.0 * bmc.total_mortes / NULLIF(ba.total_entrada, 0), 1),
        'solturas_direto_rio', sa.direto_rio, 'solturas_via_bercario', sa.via_bercario,
        'predacao_pessoas', a.predacao_pessoas, 'predacao_animais', a.predacao_animais, 'sem_predacao', a.sem_predacao
      ) FROM agg a, berc_agg ba, berc_mortes_canon bmc, solturas_agg sa
    ),
    'por_mes', (SELECT jsonb_agg(row_to_json(pm)) FROM por_mes pm),
    'por_ano', (SELECT jsonb_agg(row_to_json(pa)) FROM por_ano pa),
    'por_especie', (SELECT jsonb_agg(row_to_json(pe)) FROM por_especie pe),
    'por_praia', (SELECT jsonb_agg(row_to_json(pp)) FROM por_praia pp),
    'por_uc', (SELECT jsonb_agg(row_to_json(pu)) FROM por_uc pu),
    'por_monitor', (SELECT jsonb_agg(row_to_json(pmon)) FROM por_monitor pmon),
    'biometria_serie', (SELECT jsonb_agg(row_to_json(bs)) FROM biometria_serie bs),
    'ocorrencias_tipos', (SELECT jsonb_agg(row_to_json(ot)) FROM oc_tipos ot),
    'bercario_soltos_por_especie', (SELECT jsonb_agg(row_to_json(se)) FROM soltos_especie se),
    'taxa_soltura_por_bercario',   (SELECT jsonb_agg(row_to_json(tb)) FROM taxa_soltura_bercario tb),
    'taxa_soltura_por_especie',    (SELECT jsonb_agg(row_to_json(te)) FROM taxa_soltura_especie te),
    'crescimento_por_especie',     (SELECT jsonb_agg(row_to_json(ce)) FROM crescimento_especie ce),
    'ganho_por_bercario',          (SELECT jsonb_agg(row_to_json(gb)) FROM ganho_bercario gb),
    'descartes_por_causa', (SELECT jsonb_agg(row_to_json(dc)) FROM descartes_por_causa dc),
    'descartes_por_etapa', (SELECT jsonb_agg(row_to_json(de)) FROM descartes_por_etapa de),
    'ninhos_destruidos_por_causa', (SELECT jsonb_agg(row_to_json(nd)) FROM ninhos_destruidos_causa nd),
    'anomalia_por_tipo', (SELECT jsonb_agg(row_to_json(at)) FROM anomalia_por_tipo at),
    'predacao_fases', jsonb_build_object(
      'incubacao', (SELECT row_to_json(pi) FROM pred_incub pi),
      'eclosao',   (SELECT jsonb_build_object('por_pessoas', a.predacao_pessoas, 'por_animais', a.predacao_animais) FROM agg a),
      'soltura',   (SELECT row_to_json(ps) FROM pred_solt ps)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ── 9. bio_analise_detalhada — anomalia na Análise Científica ─────
CREATE OR REPLACE FUNCTION public.bio_analise_detalhada(p_temporada_id uuid DEFAULT NULL::uuid, p_programa_id uuid DEFAULT NULL::uuid, p_uc_id uuid DEFAULT NULL::uuid, p_praia_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  WITH base_ids AS (
    SELECT n.id
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN grupos_biomonitor gb   ON gb.id = n.grupo_id
    WHERE
      (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_programa_id IS NULL OR gb.programa_id = p_programa_id)
      AND (p_uc_id IS NULL OR COALESCE(n.uc_id, p.uc_id) = p_uc_id)
      AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
  ),
  ovos AS (
    SELECT
      COALESCE(SUM(n.qtd_ovos), 0)        AS total_postura,
      COALESCE(SUM(n.ovos_integros), 0)   AS total_integros,
      COALESCE(SUM(n.ovos_descartados), 0) AS total_descartados,
      COUNT(*) FILTER (WHERE n.qtd_ovos IS NOT NULL) AS n_posturas,
      ROUND(AVG(n.qtd_ovos)::numeric, 1)  AS media_postura
    FROM ninhos_quelonios n JOIN base_ids bi ON bi.id = n.id
  ),
  descartes_causa AS (
    SELECT COALESCE(d.causa::text, d.motivo::text, '—') AS causa,
           COALESCE(SUM(d.qtd), 0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY COALESCE(d.causa::text, d.motivo::text, '—')
    ORDER BY qtd DESC
  ),
  descartes_etapa AS (
    SELECT COALESCE(d.etapa, '—') AS etapa, COALESCE(SUM(d.qtd), 0) AS qtd
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
    GROUP BY d.etapa ORDER BY qtd DESC
  ),
  ecl AS (
    SELECT
      COALESCE(SUM(e.filhotes_vivos), 0)     AS vivos,
      COALESCE(SUM(e.filhotes_mortos), 0)    AS mortos,
      COALESCE(SUM(e.ovos_nao_nascidos), 0)  AS nao_nasc,
      COALESCE(SUM(e.filhotes_anomalia), 0)  AS anomalia,
      COUNT(*) FILTER (WHERE e.predacao = 'por_pessoas') AS pred_pessoas,
      COUNT(*) FILTER (WHERE e.predacao = 'por_animais') AS pred_animais,
      COUNT(*) FILTER (WHERE e.predacao = 'nenhuma')     AS sem_pred
    FROM eclosoes_ninho e JOIN base_ids bi ON bi.id = e.ninho_id
  ),
  anomalia_por_tipo AS (
    SELECT t.tipo::text AS tipo, COUNT(*) AS n_eclosoes
    FROM eclosoes_ninho e
    JOIN base_ids bi ON bi.id = e.ninho_id
    CROSS JOIN UNNEST(e.anomalia_tipos) AS t(tipo)
    WHERE e.filhotes_anomalia > 0
    GROUP BY t.tipo ORDER BY n_eclosoes DESC
  ),
  perdas_v AS (
    SELECT
      COALESCE(SUM(d.qtd) FILTER (WHERE d.causa = 'alagamento'), 0) AS alagamento,
      COALESCE(SUM(d.qtd) FILTER (WHERE d.causa = 'erosao'), 0)     AS erosao,
      COALESCE(SUM(d.qtd) FILTER (WHERE d.causa = 'humana'), 0)     AS humana,
      COALESCE(SUM(d.qtd) FILTER (WHERE d.causa = 'predacao'), 0)   AS predacao
    FROM descartes_ovos d JOIN base_ids bi ON bi.id = d.ninho_id
  ),
  ninhos_destr AS (
    SELECT COALESCE(v.causa_destruicao::text, '—') AS causa, COUNT(DISTINCT v.ninho_id) AS n
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
    WHERE v.status_ninho = 'destruido'
    GROUP BY v.causa_destruicao ORDER BY n DESC
  ),
  ninhos_perdidos AS (
    SELECT COUNT(*) AS n FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id WHERE n.status = 'perdido'
  ),
  pred_incub AS (
    SELECT
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'por_animais')  AS animais,
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'por_pessoas')  AS pessoas,
      COUNT(*) FILTER (WHERE v.predacao_incubacao = 'desconhecida') AS desconhecida
    FROM visitas_ninho v JOIN base_ids bi ON bi.id = v.ninho_id
  ),
  pred_solt AS (
    SELECT
      COUNT(*) FILTER (WHERE sf.predacao_soltura)     AS com,
      COUNT(*) FILTER (WHERE NOT sf.predacao_soltura) AS sem
    FROM solturas_filhotes sf JOIN base_ids bi ON bi.id = sf.ninho_id
  ),
  incub AS (
    SELECT
      n.numero_ninho, n.especie,
      (e.data_nascimento - n.data_encontro)                       AS dias_obs,
      CASE WHEN n.data_prevista_eclosao IS NOT NULL
        THEN (n.data_prevista_eclosao - n.data_encontro) END      AS dias_prev
    FROM ninhos_quelonios n JOIN base_ids bi ON bi.id = n.id
    JOIN eclosoes_ninho e ON e.ninho_id = n.id
    WHERE n.data_encontro IS NOT NULL AND e.data_nascimento IS NOT NULL
  ),
  berc AS (
    SELECT
      l.id AS lote_id, l.bercario_nome, n.especie,
      l.data_entrada, l.qtd_entrada,
      sf.data_soltura, sf.qtd_soltada, sf.mortalidade,
      CASE WHEN sf.data_soltura IS NOT NULL
        THEN (sf.data_soltura - l.data_entrada) END AS dias
    FROM lotes_bercario l
    JOIN base_ids bi ON bi.id = l.ninho_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN LATERAL (
      SELECT data_soltura, qtd_soltada, mortalidade
      FROM solturas_filhotes
      WHERE lote_bercario_id = l.id AND via_bercario = true
      ORDER BY data_soltura DESC LIMIT 1
    ) sf ON true
  ),
  bio_serie AS (
    SELECT
      l.id AS lote_id, l.bercario_nome, n.especie,
      ob.data_ocorrencia AS data,
      CASE WHEN e.data_nascimento IS NOT NULL
        THEN (ob.data_ocorrencia - e.data_nascimento) END AS idade_dias,
      ob.comprimento_medio_cm AS comp,
      ob.peso_medio_g         AS peso,
      ob.n_amostrados
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN eclosoes_ninho e ON e.ninho_id = l.ninho_id
    WHERE ob.tipo = 'biometria' AND ob.comprimento_medio_cm IS NOT NULL

    UNION ALL

    SELECT
      l.id AS lote_id, l.bercario_nome, n.especie,
      b.data_medicao AS data,
      CASE WHEN e.data_nascimento IS NOT NULL
        THEN (b.data_medicao - e.data_nascimento) END AS idade_dias,
      b.comprimento_cm AS comp,
      b.peso_g         AS peso,
      1 AS n_amostrados
    FROM biometrias_individuais b
    JOIN filhotes_bercario fb ON fb.id = b.individuo_id
    JOIN lotes_bercario l     ON l.id = fb.lote_id
    JOIN base_ids bi ON bi.id = l.ninho_id
    JOIN ninhos_quelonios n ON n.id = l.ninho_id
    LEFT JOIN eclosoes_ninho e ON e.ninho_id = l.ninho_id
    WHERE b.comprimento_cm IS NOT NULL
  ),
  bio_taxa AS (
    SELECT
      s.lote_id, mn.bercario_nome, mn.especie,
      (mx.data - mn.data) AS dias,
      ROUND(((mx.comp - mn.comp) * 10.0 / NULLIF(mx.data - mn.data, 0))::numeric, 2) AS mm_dia,
      ROUND(((mx.peso - mn.peso) / NULLIF(mx.data - mn.data, 0))::numeric, 2)         AS g_dia,
      mn.comp AS comp_ini, mx.comp AS comp_fim
    FROM (SELECT DISTINCT lote_id FROM bio_serie) s
    JOIN LATERAL (SELECT data, comp, peso, bercario_nome, especie FROM bio_serie WHERE lote_id = s.lote_id ORDER BY data ASC  LIMIT 1) mn ON true
    JOIN LATERAL (SELECT data, comp, peso FROM bio_serie WHERE lote_id = s.lote_id ORDER BY data DESC LIMIT 1) mx ON true
    WHERE (mx.data - mn.data) > 0
  ),
  tam_soltura AS (
    SELECT DISTINCT ON (lote_id)
      lote_id, bercario_nome, especie, comp AS comp_ultimo, idade_dias AS idade_ultimo, data
    FROM bio_serie ORDER BY lote_id, data DESC
  )
  SELECT jsonb_build_object(
    'ovos', (
      SELECT jsonb_build_object(
        'total_postura', o.total_postura,
        'total_integros', o.total_integros,
        'total_descartados', o.total_descartados,
        'media_postura', o.media_postura,
        'n_posturas', o.n_posturas,
        'taxa_fertilidade_pct', ROUND(100.0 * o.total_integros / NULLIF(o.total_postura, 0), 1),
        'taxa_descarte_pct',    ROUND(100.0 * o.total_descartados / NULLIF(o.total_postura, 0), 1),
        'descartes_por_causa', (SELECT jsonb_agg(row_to_json(dc)) FROM descartes_causa dc),
        'descartes_por_etapa', (SELECT jsonb_agg(row_to_json(de)) FROM descartes_etapa de)
      ) FROM ovos o
    ),
    'eclosao', (
      SELECT jsonb_build_object(
        'vivos', ec.vivos, 'mortos', ec.mortos, 'nao_nascidos', ec.nao_nasc,
        'taxa_eclosao_pct', ROUND(100.0 * ec.vivos / NULLIF(ec.vivos + ec.mortos + ec.nao_nasc, 0), 1),
        'taxa_mortalidade_embrionaria_pct', ROUND(100.0 * (ec.mortos + ec.nao_nasc) / NULLIF(ec.vivos + ec.mortos + ec.nao_nasc, 0), 1),
        'predacao_pessoas', ec.pred_pessoas, 'predacao_animais', ec.pred_animais, 'sem_predacao', ec.sem_pred,
        'filhotes_anomalia', ec.anomalia,
        'taxa_anomalia_pct', ROUND(100.0 * ec.anomalia / NULLIF(ec.vivos, 0), 1),
        'anomalia_por_tipo', (SELECT jsonb_agg(row_to_json(at)) FROM anomalia_por_tipo at)
      ) FROM ecl ec
    ),
    'perdas', (
      SELECT jsonb_build_object(
        'ovos_alagamento', pv.alagamento, 'ovos_erosao', pv.erosao,
        'ovos_humana', pv.humana, 'ovos_predacao', pv.predacao,
        'ninhos_perdidos', (SELECT n FROM ninhos_perdidos),
        'ninhos_por_causa', (SELECT jsonb_agg(row_to_json(nd)) FROM ninhos_destr nd)
      ) FROM perdas_v pv
    ),
    'predacao_fases', jsonb_build_object(
      'incubacao', (SELECT row_to_json(pi) FROM pred_incub pi),
      'eclosao',   (SELECT jsonb_build_object('por_pessoas', pred_pessoas, 'por_animais', pred_animais) FROM ecl),
      'soltura',   (SELECT row_to_json(ps) FROM pred_solt ps)
    ),
    'incubacao', jsonb_build_object(
      'n',            (SELECT COUNT(*) FROM incub),
      'media_dias',   (SELECT ROUND(AVG(dias_obs)::numeric, 1) FROM incub),
      'min_dias',     (SELECT MIN(dias_obs) FROM incub),
      'max_dias',     (SELECT MAX(dias_obs) FROM incub),
      'media_prevista_dias', (SELECT ROUND(AVG(dias_prev)::numeric, 1) FROM incub WHERE dias_prev IS NOT NULL),
      'desvio_medio_dias',   (SELECT ROUND(AVG(dias_obs - dias_prev)::numeric, 1) FROM incub WHERE dias_prev IS NOT NULL),
      'serie', (SELECT jsonb_agg(row_to_json(i)) FROM (SELECT numero_ninho, especie, dias_obs, dias_prev FROM incub ORDER BY dias_obs LIMIT 60) i)
    ),
    'bercario_tempo', jsonb_build_object(
      'n',          (SELECT COUNT(*) FROM berc WHERE dias IS NOT NULL),
      'media_dias', (SELECT ROUND(AVG(dias)::numeric, 1) FROM berc WHERE dias IS NOT NULL),
      'min_dias',   (SELECT MIN(dias) FROM berc WHERE dias IS NOT NULL),
      'max_dias',   (SELECT MAX(dias) FROM berc WHERE dias IS NOT NULL),
      'por_lote', (SELECT jsonb_agg(row_to_json(b)) FROM (
        SELECT bercario_nome, especie, data_entrada, data_soltura, dias, qtd_entrada, qtd_soltada, mortalidade
        FROM berc ORDER BY data_entrada DESC LIMIT 60) b)
    ),
    'crescimento', jsonb_build_object(
      'n_biometrias', (SELECT COUNT(*) FROM bio_serie),
      'serie',        (SELECT jsonb_agg(row_to_json(s)) FROM (
        SELECT bercario_nome, especie, data, idade_dias, comp, peso, n_amostrados
        FROM bio_serie ORDER BY data LIMIT 200) s),
      'taxa_por_lote',(SELECT jsonb_agg(row_to_json(tx)) FROM (
        SELECT bercario_nome, especie, dias, mm_dia, g_dia, comp_ini, comp_fim
        FROM bio_taxa LIMIT 60) tx),
      'tamanho_soltura', (SELECT jsonb_agg(row_to_json(ts)) FROM (
        SELECT bercario_nome, especie, comp_ultimo, idade_ultimo, data
        FROM tam_soltura LIMIT 60) ts)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
