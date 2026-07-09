-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Mortalidade no berçário: baixa + alerta
-- ───────────────────────────────────────────────────────────────
-- Hoje uma morte de filhote no berçário podia ser registrada em 3
-- lugares que não se falam: ocorrencias_bercario (mortalidade),
-- filhotes_bercario.status='morto' (individual) e
-- solturas_filhotes.mortalidade — só o último alimentava o KPI da
-- temporada, e mesmo assim como campo digitado do zero pelo monitor.
--
-- Esta migration cria uma fonte canônica única por lote
-- (vw_lotes_bercario_mortalidade: individual se rastreado, senão
-- ocorrências agregadas, nunca menor que o que já foi dado baixa na
-- soltura) e a usa em dois lugares:
--   1) bio_relatorio_completo — abate a mortalidade de berçário do
--      total de filhotes vivos da temporada (total_filhotes_vivos_liquido)
--      e corrige bercario_mortalidade/taxa_mortalidade_bercario_pct
--      para não depender só do que o monitor lembrou de somar na soltura.
--   2) quelonio_avaliar_agregados — novo bloco que compara berçários
--      físicos entre si (mesma temporada) e alerta o de MAIOR TAXA de
--      mortalidade (com piso mínimo de entradas), reusando o mesmo
--      pipeline de alertas/notificação já usado para ninho/visita/praia.
--
-- Depende de 087 (lotes_bercario/bercarios), 089 (ocorrencias_bercario),
-- 094 (alertas_quelonios/quelonio_avaliar_agregados), 108 (bio_relatorio_completo),
-- 132 (filhotes_bercario).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Escopo de alerta + vínculo com berçário físico ─────────────
ALTER TYPE escopo_alerta_quelonio ADD VALUE IF NOT EXISTS 'bercario';

ALTER TABLE alertas_quelonios
  ADD COLUMN IF NOT EXISTS bercario_id uuid REFERENCES bercarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alq_bercario ON alertas_quelonios (bercario_id);

-- ── 2. View canônica: mortes por lote (individual > ocorrência > soltura) ──
CREATE OR REPLACE VIEW vw_lotes_bercario_mortalidade
WITH (security_invoker = true)
AS
SELECT
  l.id             AS lote_id,
  l.ninho_id,
  l.bercario_id,
  b.nome           AS bercario_nome,
  b.uc_id          AS bercario_uc_id,
  n.temporada_id,
  l.qtd_entrada,
  m.mortes,
  GREATEST(l.qtd_entrada - m.mortes, 0) AS vivos_atual
FROM lotes_bercario l
LEFT JOIN bercarios b        ON b.id = l.bercario_id
LEFT JOIN ninhos_quelonios n ON n.id = l.ninho_id
LEFT JOIN LATERAL (
  SELECT GREATEST(
    -- Fonte primária: individual (se o lote tem filhotes rastreados) ou
    -- ocorrência agregada de mortalidade (fluxo tradicional por amostragem).
    CASE WHEN EXISTS (SELECT 1 FROM filhotes_bercario f WHERE f.lote_id = l.id)
      THEN (SELECT COUNT(*) FROM filhotes_bercario f WHERE f.lote_id = l.id AND f.status = 'morto')
      ELSE COALESCE((SELECT SUM(ob.qtd_afetados) FROM ocorrencias_bercario ob
                       WHERE ob.lote_id = l.id AND ob.tipo = 'mortalidade'), 0)
    END,
    -- Nunca fica abaixo do que já foi confirmado na soltura (dado histórico
    -- que não tinha ocorrência/individual por trás).
    COALESCE((SELECT SUM(sf.mortalidade) FROM solturas_filhotes sf
                WHERE sf.lote_bercario_id = l.id), 0)
  ) AS mortes
) m ON true;

-- ── 3. bio_relatorio_completo — abate a mortalidade de berçário ───
DROP FUNCTION IF EXISTS public.bio_relatorio_completo(uuid, uuid, uuid, uuid, tipo_localizacao_praia);

CREATE OR REPLACE FUNCTION public.bio_relatorio_completo(
  p_temporada_id uuid DEFAULT NULL::uuid,
  p_programa_id uuid DEFAULT NULL::uuid,
  p_uc_id uuid DEFAULT NULL::uuid,
  p_praia_id uuid DEFAULT NULL::uuid,
  p_tipo_localizacao tipo_localizacao_praia DEFAULT NULL::tipo_localizacao_praia
)
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
      (SELECT COALESCE(SUM(d.qtd),0) FROM descartes_ovos d WHERE d.ninho_id = n.id AND d.motivo = 'predacao') AS ovos_predados,
      (SELECT COALESCE(SUM(d.qtd),0) FROM descartes_ovos d WHERE d.ninho_id = n.id)                          AS ovos_descartes_total,
      n.dist_rio_m, n.temperatura_c, n.umidade_pct, n.profundidade_cm,
      COALESCE(n.uc_id, p.uc_id) AS uc_id,
      p.nome AS praia_nome, p.codigo AS praia_codigo, p.comprimento_m,
      uc.nome AS uc_nome, uc.sigla AS uc_sigla,
      mb.nome_completo AS monitor_nome, gb.nome AS grupo_nome,
      e.filhotes_vivos, e.filhotes_mortos, e.ovos_nao_nascidos, e.predacao, e.data_nascimento,
      CASE WHEN e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
        THEN (e.data_nascimento - n.data_encontro) END AS dias_incubacao
    FROM ninhos_quelonios n
    JOIN base_ids bi ON bi.id = n.id
    LEFT JOIN praias_monitoramento p   ON p.id = n.praia_id
    LEFT JOIN unidades_conservacao uc  ON uc.id = COALESCE(n.uc_id, p.uc_id)
    LEFT JOIN monitores_biodiversidade mb ON mb.id = n.monitor_id
    LEFT JOIN grupos_biomonitor gb     ON gb.id = n.grupo_id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao, data_nascimento
      FROM eclosoes_ninho WHERE ninho_id = n.id
      ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
  ),
  agg AS (
    SELECT
      COUNT(*) AS total_ninhos,
      COUNT(*) FILTER (WHERE status = 'eclodido') AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido') AS transferidos,
      COUNT(*) FILTER (WHERE status = 'encontrado') AS pendentes,
      COALESCE(SUM(qtd_ovos), 0) AS total_ovos_postura,
      COALESCE(SUM(ovos_integros), 0) AS total_ovos_integros,
      COALESCE(SUM(ovos_descartados), 0) AS total_ovos_descartados,
      COALESCE(SUM(ovos_predados), 0) AS total_ovos_predados,
      GREATEST(COALESCE(SUM(qtd_ovos),0) - COALESCE(SUM(ovos_descartes_total),0), 0) AS total_ovos_viaveis,
      COALESCE(SUM(filhotes_vivos), 0) AS total_filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0) AS total_filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0) AS total_ovos_nao_nascidos,
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
      COUNT(*) AS ninhos, COUNT(*) FILTER (WHERE status = 'eclodido') AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes, ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos
    FROM base WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro) ORDER BY date_trunc('month', data_encontro)
  ),
  por_ano AS (
    SELECT EXTRACT(YEAR FROM data_encontro)::int AS ano, COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status = 'eclodido') AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE data_encontro IS NOT NULL GROUP BY EXTRACT(YEAR FROM data_encontro) ORDER BY ano
  ),
  por_especie AS (
    SELECT especie, COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'eclodido') AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COUNT(*) FILTER (WHERE status = 'transferido') AS transferidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0) AS filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0) AS ovos_nao_nascidos,
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
      COUNT(*) FILTER (WHERE status = 'eclodido') AS eclodidos,
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
      COUNT(*) FILTER (WHERE status = 'eclodido') AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'perdido') AS perdidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct,
      ROUND(AVG(qtd_ovos)::numeric, 1) AS media_ovos
    FROM base WHERE uc_id IS NOT NULL GROUP BY uc_id, uc_nome, uc_sigla ORDER BY ninhos_total DESC
  ),
  por_monitor AS (
    SELECT monitor_id, monitor_nome, grupo_nome, COUNT(*) AS ninhos,
      COUNT(*) FILTER (WHERE status = 'eclodido') AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0) AS filhotes_vivos,
      ROUND(100.0 * COALESCE(SUM(filhotes_vivos), 0) / NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0), 1) AS taxa_eclosao_pct
    FROM base WHERE monitor_id IS NOT NULL GROUP BY monitor_id, monitor_nome, grupo_nome ORDER BY ninhos DESC LIMIT 25
  ),
  berc_agg AS (
    SELECT COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('ativo','soltado')) AS total_lotes,
      COALESCE(SUM(l.qtd_entrada), 0) AS total_entrada,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true), 0) AS total_soltado
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    LEFT JOIN solturas_filhotes sf ON sf.lote_bercario_id = l.id
  ),
  -- Mortalidade de berçário canônica (individual > ocorrência, nunca menor
  -- que a já confirmada na soltura) — substitui o antigo SUM(solturas.mortalidade).
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
  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ocorrencias_bercario ob ON ob.lote_id = l.id GROUP BY ob.tipo ORDER BY total DESC
  ),
  biometria_serie AS (
    SELECT to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
      ROUND(AVG(ob.comprimento_medio_cm)::numeric, 1) AS comp_medio,
      ROUND(AVG(ob.peso_medio_g)::numeric, 1) AS peso_medio,
      SUM(COALESCE(ob.n_amostrados, 0)) AS n_amostrados
    FROM base_ids bi JOIN lotes_bercario l ON l.ninho_id = bi.id
    JOIN ocorrencias_bercario ob ON ob.lote_id = l.id
    WHERE ob.tipo = 'biometria' AND ob.comprimento_medio_cm IS NOT NULL
    GROUP BY ob.data_ocorrencia ORDER BY ob.data_ocorrencia LIMIT 60
  )
  SELECT jsonb_build_object(
    'kpis', (
      SELECT jsonb_build_object(
        'total_ninhos', a.total_ninhos, 'eclodidos', a.eclodidos, 'perdidos', a.perdidos,
        'transferidos', a.transferidos, 'pendentes', a.pendentes,
        'total_ovos_postura', a.total_ovos_postura, 'total_ovos_integros', a.total_ovos_integros,
        'total_ovos_descartados', a.total_ovos_descartados,
        'total_ovos_predados', a.total_ovos_predados, 'total_ovos_viaveis', a.total_ovos_viaveis,
        'total_filhotes_vivos', a.total_filhotes_vivos,
        'total_filhotes_vivos_liquido', GREATEST(a.total_filhotes_vivos - bmc.total_mortes, 0),
        'total_filhotes_mortos', a.total_filhotes_mortos,
        'total_ovos_nao_nascidos', a.total_ovos_nao_nascidos, 'media_ovos_postura', a.media_ovos_postura,
        'dist_rio_media_m', a.dist_rio_media_m, 'temp_media_c', a.temp_media_c,
        'umidade_media_pct', a.umidade_media_pct, 'profundidade_media_cm', a.profundidade_media_cm,
        'incubacao_media_dias', a.incubacao_media_dias,
        'taxa_eclosao_pct', ROUND(100.0 * a.total_filhotes_vivos / NULLIF(a.total_filhotes_vivos + a.total_filhotes_mortos + a.total_ovos_nao_nascidos, 0), 1),
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
    'ocorrencias_tipos', (SELECT jsonb_agg(row_to_json(ot)) FROM oc_tipos ot)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- ── 4. quelonio_avaliar_agregados — + ranking de mortalidade por berçário ──
CREATE OR REPLACE FUNCTION quelonio_avaliar_agregados()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pa  parametros_incubacao_quelonios%ROWTYPE;
  r   record;
  v_pct numeric;
  v_total int := 0;
  v_sev severidade_ocorrencia;
  v_alerta_id uuid;
BEGIN
  SELECT * INTO pa FROM parametros_incubacao_quelonios WHERE ativo AND especie IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro','sem parâmetro padrão'); END IF;

  -- ── 10.1 Razão sexual por praia/temporada ────────────────
  FOR r IN
    SELECT n.praia_id, n.temporada_id, n.uc_id, n.grupo_id,
           p.nome AS praia_nome,
           COUNT(*) FILTER (WHERE n.temperatura_c IS NOT NULL) AS com_temp,
           COUNT(*) FILTER (WHERE n.temperatura_c >= pa.temp_femea_min) AS femeas
      FROM ninhos_quelonios n
      LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
     WHERE n.praia_id IS NOT NULL AND n.temporada_id IS NOT NULL
     GROUP BY n.praia_id, n.temporada_id, n.uc_id, n.grupo_id, p.nome
  LOOP
    IF r.com_temp >= pa.razao_min_ninhos THEN
      v_pct := ROUND(100.0 * r.femeas / r.com_temp, 1);
      IF v_pct > pa.razao_femea_max_pct THEN
        PERFORM quelonio_registrar_alerta(
          'praia','razao_sexual','Feminização da praia','alta',
          format('Feminização na praia %s (%s%% tendência fêmea)', COALESCE(r.praia_nome,'—'), v_pct),
          format('%s de %s ninhos com temperatura acima de %s °C — forte viés para fêmeas (sinal de aquecimento).',
                 r.femeas, r.com_temp, pa.temp_femea_min),
          pa.prov_feminizacao, pa.referencia, v_pct, NULL,
          NULL, NULL, r.praia_id, r.uc_id, r.grupo_id, r.temporada_id, NULL,
          'praia:'||r.praia_id||':temporada:'||r.temporada_id||':razao_sexual', true);
        v_total := v_total + 1;
      END IF;
    END IF;
  END LOOP;

  -- ── 10.2 Atraso de eclosão ───────────────────────────────
  FOR r IN
    SELECT n.id, n.numero_ninho, n.praia_id, n.uc_id, n.grupo_id, n.temporada_id, n.especie,
           (CURRENT_DATE - n.data_encontro) AS dias
      FROM ninhos_quelonios n
     WHERE n.status IN ('encontrado','transferido')
       AND (CURRENT_DATE - n.data_encontro) > pa.incubacao_dias_max
       AND NOT EXISTS (SELECT 1 FROM eclosoes_ninho e WHERE e.ninho_id = n.id)
  LOOP
    PERFORM quelonio_registrar_alerta(
      'ninho','atraso_eclosao','Atraso de eclosão','media',
      format('Atraso de eclosão no ninho %s (%s dias)', r.numero_ninho, r.dias),
      format('Ninho com %s dias de incubação sem eclosão (esperado até %s dias).', r.dias, pa.incubacao_dias_max),
      pa.prov_atraso, pa.referencia, r.dias, NULL,
      r.id, NULL, r.praia_id, r.uc_id, r.grupo_id, r.temporada_id, r.especie,
      'ninho:'||r.id||':atraso', true);
    v_total := v_total + 1;
  END LOOP;

  -- ── 10.3 Friagem (frente fria) pelas visitas recentes ────
  FOR r IN
    SELECT n.praia_id, n.uc_id, n.grupo_id,
           p.nome AS praia_nome,
           COUNT(*) AS visitas_frias,
           MIN(v.temperatura_ar_c) AS temp_min
      FROM visitas_ninho v
      JOIN ninhos_quelonios n ON n.id = v.ninho_id
      LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
     WHERE v.data_visita >= CURRENT_DATE - 4
       AND v.temperatura_ar_c IS NOT NULL
       AND v.temperatura_ar_c < pa.friagem_temp_ar_min
       AND n.praia_id IS NOT NULL
     GROUP BY n.praia_id, n.uc_id, n.grupo_id, p.nome
    HAVING COUNT(*) >= 2
  LOOP
    PERFORM quelonio_registrar_alerta(
      'sazonal','friagem','Friagem','alta',
      format('Friagem na praia %s (mín. %s °C)', COALESCE(r.praia_nome,'—'), r.temp_min),
      format('%s visitas com ar abaixo de %s °C nos últimos dias — frente fria sobre os ninhos.',
             r.visitas_frias, pa.friagem_temp_ar_min),
      pa.prov_friagem, pa.referencia, r.temp_min, NULL,
      NULL, NULL, r.praia_id, r.uc_id, NULL, NULL,
      'praia:'||r.praia_id||':friagem:'||to_char(CURRENT_DATE,'IYYY-IW'), true);
    v_total := v_total + 1;
  END LOOP;

  -- ── 10.4 Berçário com maior TAXA de mortalidade (temporada atual) ──
  FOR r IN
    SELECT vlm.bercario_id, vlm.bercario_nome, vlm.bercario_uc_id,
           SUM(vlm.qtd_entrada) AS entrada, SUM(vlm.mortes) AS mortes,
           ROUND(100.0 * SUM(vlm.mortes) / NULLIF(SUM(vlm.qtd_entrada), 0), 1) AS taxa_pct
      FROM vw_lotes_bercario_mortalidade vlm
      JOIN temporadas_biomonitor t ON t.id = vlm.temporada_id AND t.is_atual
     WHERE vlm.bercario_id IS NOT NULL
     GROUP BY vlm.bercario_id, vlm.bercario_nome, vlm.bercario_uc_id
    HAVING SUM(vlm.qtd_entrada) >= 10  -- piso mínimo: não comparar berçário com poucos filhotes
    ORDER BY (SUM(vlm.mortes)::numeric / NULLIF(SUM(vlm.qtd_entrada), 0)) DESC
    LIMIT 1
  LOOP
    IF r.taxa_pct > 5 THEN  -- abaixo disso não é destaque, é ruído
      v_sev := CASE WHEN r.taxa_pct >= 30 THEN 'critica' WHEN r.taxa_pct >= 15 THEN 'alta' ELSE 'media' END;

      INSERT INTO alertas_quelonios (
        escopo, parametro, faixa, severidade, titulo, mensagem, providencia,
        valor_num, bercario_id, uc_id, dedup_key
      ) VALUES (
        'bercario', 'mortalidade_bercario', 'Maior mortalidade', v_sev,
        format('Berçário %s com maior mortalidade da temporada (%s%%)', COALESCE(r.bercario_nome,'—'), r.taxa_pct),
        format('%s de %s filhotes não sobreviveram neste berçário na temporada atual — a maior taxa entre os berçários monitorados (mínimo de 10 entradas para comparação).', r.mortes, r.entrada),
        'Verificar condições do berçário (qualidade da água, alimentação, densidade, doenças) e comparar o manejo com os demais berçários.',
        r.taxa_pct, r.bercario_id, r.bercario_uc_id,
        'bercario:'||r.bercario_id||':mortalidade:'||to_char(CURRENT_DATE,'IYYY')
      )
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id INTO v_alerta_id;

      IF v_alerta_id IS NOT NULL THEN
        IF v_sev IN ('alta','critica') THEN PERFORM quelonio_emitir_notificacoes(v_alerta_id); END IF;
        v_total := v_total + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('alertas_novos', v_total, 'executado_em', now());
END;
$$;
GRANT EXECUTE ON FUNCTION quelonio_avaliar_agregados TO authenticated, service_role;
