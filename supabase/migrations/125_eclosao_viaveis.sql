-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Painel Eclosão reflete ovos viáveis
-- Reusa vw_ninho_ovos (mig. 124): adiciona ovos viáveis/perdidos por
-- espécie e totais ao RPC bio_monitoramento_eclosao. Depende de 124.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bio_monitoramento_eclosao(
  p_temporada_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
       AND (v_gestor OR v.grupo_id = v_grupo_id)
  ),
  ovos AS (  -- ovos viáveis/perdidos por espécie (base canônica)
    SELECT n.especie,
           SUM(ov.viaveis)       AS viaveis,
           SUM(ov.perdas_total)  AS perdidos,
           SUM(ov.postura)       AS postura
      FROM ninhos_quelonios n
      JOIN vw_ninho_ovos ov ON ov.ninho_id = n.id
     WHERE (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
       AND (v_gestor OR n.grupo_id = v_grupo_id)
     GROUP BY n.especie
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
      'em_incubacao',(SELECT COUNT(*) FROM prev WHERE faixa_risco IN ('normal','atencao','hoje','atrasado'))
    ),
    'ovos', jsonb_build_object(
      'postura',  (SELECT COALESCE(SUM(postura),0)  FROM ovos),
      'viaveis',  (SELECT COALESCE(SUM(viaveis),0)  FROM ovos),
      'perdidos', (SELECT COALESCE(SUM(perdidos),0) FROM ovos)
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
    'por_especie', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'especie', especie,
        'eclosoes', n_eclosoes,
        'taxa_sucesso_pct', ROUND(100.0 * vivos / NULLIF(incubados, 0), 1),
        'incubacao_real_media', ROUND(real_media, 1),
        'incubacao_prevista_media', ROUND(prev_media, 1),
        'desvio_dias', ROUND(real_media - prev_media, 1),
        'ovos_viaveis',  (SELECT o.viaveis  FROM ovos o WHERE o.especie = i.especie),
        'ovos_perdidos', (SELECT o.perdidos FROM ovos o WHERE o.especie = i.especie)
      ) ORDER BY especie), '[]'::jsonb)
      FROM incub i
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_monitoramento_eclosao TO authenticated, service_role;
