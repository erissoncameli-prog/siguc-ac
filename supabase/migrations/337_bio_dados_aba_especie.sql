-- 337_bio_dados_aba_especie.sql
-- Filtro por ESPÉCIE na aba Dados do app Biomonitor (todas as sub-abas).
--
-- Situação: só a sub-aba Praias filtrava por espécie (bio_dashboard_praias
-- já tinha p_especie; bio_ovos_resumo também). As sub-abas Taxas, Ninhos,
-- Eclosão e Berçário — que saem de bio_dados_aba e bio_monitoramento_eclosao
-- — ignoravam espécie. Esta migration adiciona p_especie às duas.
--
-- ⚠️ Mudança de assinatura (uuid) -> (uuid, especie_quelonio): CREATE OR
-- REPLACE criaria overload em vez de substituir (lição 178/224/173), então
-- DROP FUNCTION explícito antes. p_especie DEFAULT NULL preserva 100% o
-- comportamento antigo (cliente em cache de PWA continua chamando só com
-- p_temporada_id). Berçário (lotes/solturas/ocorrências/biometria) é
-- filtrável por espécie via lotes_bercario.ninho_id -> ninhos_quelonios.especie
-- (LEFT JOIN + predicado só ativo quando p_especie não é nulo).
--
-- Grants: ALTER DEFAULT PRIVILEGES do projeto concede EXECUTE a anon por NOME
-- em toda função nova — REVOKE anon explícito, mesmas regras 165/249/299.

DROP FUNCTION IF EXISTS public.bio_dados_aba(uuid);

CREATE OR REPLACE FUNCTION public.bio_dados_aba(
  p_temporada_id uuid DEFAULT NULL::uuid,
  p_especie      especie_quelonio DEFAULT NULL::especie_quelonio
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      n.contagem_ovos_metodo,
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
      AND (p_especie IS NULL OR n.especie = p_especie)
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
      ROUND(AVG(dias_incubacao)::numeric)                   AS incubacao_media_dias,
      COUNT(*) FILTER (WHERE contagem_ovos_metodo = 'estimado')                                          AS postura_estimada_total,
      COUNT(*) FILTER (WHERE contagem_ovos_metodo = 'estimado' AND status IN ('eclodido','em_bercario','soltado','transferido')) AS postura_estimada_pendente_confirmacao,
      COUNT(*) FILTER (WHERE contagem_ovos_metodo = 'confirmado_eclosao')                                 AS postura_confirmada_total
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
    LEFT JOIN ninhos_quelonios nb ON nb.id = l.ninho_id
    LEFT JOIN vw_lotes_bercario_mortalidade vlm ON vlm.lote_id = l.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
      AND (p_especie IS NULL OR nb.especie = p_especie)
  ),

  solturas_agg AS (
    SELECT
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario
    FROM solturas_filhotes sf
    LEFT JOIN ninhos_quelonios n ON n.id = sf.ninho_id
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
      AND (p_especie IS NULL OR n.especie = p_especie)
  ),

  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    LEFT JOIN ninhos_quelonios nb ON nb.id = l.ninho_id
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
      AND (p_especie IS NULL OR nb.especie = p_especie)
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
      LEFT JOIN ninhos_quelonios nb ON nb.id = l.ninho_id
      WHERE ob.tipo = 'biometria'
        AND l.grupo_id = v_grupo_id
        AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
        AND (p_especie IS NULL OR nb.especie = p_especie)

      UNION ALL

      SELECT
        to_char(bi.data_medicao, 'YYYY-MM-DD') AS data,
        bi.comprimento_cm AS comp,
        bi.peso_g AS peso
      FROM biometrias_individuais bi
      JOIN filhotes_bercario fb ON fb.id = bi.individuo_id
      JOIN lotes_bercario l ON l.id = fb.lote_id
      LEFT JOIN ninhos_quelonios nb ON nb.id = l.ninho_id
      WHERE l.grupo_id = v_grupo_id
        AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
        AND (p_especie IS NULL OR nb.especie = p_especie)
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

    'postura_estimada_total',               a.postura_estimada_total,
    'postura_estimada_pendente_confirmacao', a.postura_estimada_pendente_confirmacao,
    'postura_confirmada_total',              a.postura_confirmada_total,

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
$function$;

REVOKE ALL ON FUNCTION public.bio_dados_aba(uuid, especie_quelonio) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bio_dados_aba(uuid, especie_quelonio) TO authenticated;


DROP FUNCTION IF EXISTS public.bio_monitoramento_eclosao(uuid);

CREATE OR REPLACE FUNCTION public.bio_monitoramento_eclosao(
  p_temporada_id uuid DEFAULT NULL::uuid,
  p_especie      especie_quelonio DEFAULT NULL::especie_quelonio
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo_id uuid;
  v_gestor   boolean := false;
  v_result   jsonb;
BEGIN
  SELECT grupo_id INTO v_grupo_id
    FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo'
   LIMIT 1;

  SELECT EXISTS (SELECT 1 FROM usuarios
                  WHERE id = auth.uid()
                    AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
    INTO v_gestor;

  IF v_grupo_id IS NULL AND NOT v_gestor THEN RETURN NULL; END IF;

  WITH prev AS (
    SELECT v.*
      FROM vw_ninhos_previsao_eclosao v
     WHERE (p_temporada_id IS NULL OR v.temporada_id = p_temporada_id)
       AND (p_especie IS NULL OR v.especie = p_especie)
       AND (v_gestor OR v.grupo_id = v_grupo_id)
  ),
  incub AS (
    SELECT n.especie,
           AVG(e.data_nascimento - n.data_encontro)::numeric AS real_media,
           AVG(n.incubacao_dias_previstos)::numeric          AS prev_media,
           COUNT(*)                                          AS n_eclosoes,
           SUM(e.filhotes_vivos)                             AS vivos,
           SUM(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos) AS incubados
      FROM ninhos_quelonios n
      JOIN eclosoes_ninho e ON e.ninho_id = n.id
     WHERE (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
       AND (p_especie IS NULL OR n.especie = p_especie)
       AND (v_gestor OR n.grupo_id = v_grupo_id)
       AND e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
     GROUP BY n.especie
  )
  SELECT jsonb_build_object(
    'gerado_em', now(),
    'contadores', jsonb_build_object(
      'proximos_7d', (SELECT COUNT(*) FROM prev WHERE faixa_risco IN ('atencao','hoje')),
      'hoje',        (SELECT COUNT(*) FROM prev WHERE faixa_risco = 'hoje'),
      'atrasados',   (SELECT COUNT(*) FROM prev WHERE faixa_risco = 'atrasado'),
      'em_incubacao',(SELECT COUNT(*) FROM prev WHERE faixa_risco IN ('normal','atencao','hoje','atrasado')),
      'antecipados', (SELECT COUNT(*) FROM prev WHERE COALESCE(dias_antecipacao_estimados, 0) >= 3)
    ),
    'proximos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ninho_id', id, 'numero', COALESCE(numero_atual, numero_ninho),
        'especie', especie, 'praia', praia_atual_nome,
        'data_prevista', data_prevista_eclosao, 'dias', dias_para_eclosao,
        'faixa', faixa_risco, 'situacao', situacao) ORDER BY data_prevista_eclosao), '[]'::jsonb)
      FROM prev WHERE faixa_risco IN ('atencao','hoje')
    ),
    'atrasados', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ninho_id', id, 'numero', COALESCE(numero_atual, numero_ninho),
        'especie', especie, 'praia', praia_atual_nome,
        'data_prevista', data_prevista_eclosao, 'dias', dias_para_eclosao,
        'situacao', situacao) ORDER BY data_prevista_eclosao), '[]'::jsonb)
      FROM prev WHERE faixa_risco = 'atrasado'
    ),
    -- Ninhos com antecipação estimada relevante (>=3 dias) — o gatilho do
    -- ALERTA usa o limiar configurável de parametros_incubacao_quelonios
    -- (antecip_alerta_dias_min); esta lista é só leitura/relatório,
    -- com piso fixo mais baixo para dar visão cedo ao time científico.
    'antecipados', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ninho_id', id, 'numero', COALESCE(numero_atual, numero_ninho),
        'especie', especie, 'praia', praia_atual_nome,
        'data_prevista_original', data_prevista_eclosao,
        'data_prevista_ajustada', data_prevista_eclosao_ajustada,
        'dias_antecipacao', dias_antecipacao_estimados,
        'temp_media', temp_media_observada
      ) ORDER BY dias_antecipacao_estimados DESC), '[]'::jsonb)
      FROM prev
     WHERE faixa_risco IN ('normal','atencao','hoje') AND COALESCE(dias_antecipacao_estimados, 0) >= 3
    ),
    'por_especie', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'especie', especie,
        'eclosoes', n_eclosoes,
        'taxa_sucesso_pct', ROUND(100.0 * vivos / NULLIF(incubados, 0), 1),
        'incubacao_real_media', ROUND(real_media, 1),
        'incubacao_prevista_media', ROUND(prev_media, 1),
        'desvio_dias', ROUND(real_media - prev_media, 1)
      ) ORDER BY especie), '[]'::jsonb)
      FROM incub
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.bio_monitoramento_eclosao(uuid, especie_quelonio) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bio_monitoramento_eclosao(uuid, especie_quelonio) TO authenticated;
