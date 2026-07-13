-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Alertas: nome da temporada + selo no
-- alerta de mortalidade de berçário
-- ───────────────────────────────────────────────────────────────
-- alertas_quelonios.temporada_id já existe e já é preenchido pela
-- maioria dos geradores de alerta (via n.temporada_id do ninho).
-- Faltavam dois pontos para a aba Alertas do admin filtrar por
-- temporada:
--  1) vw_alertas_quelonios não expunha o NOME da temporada (só o id
--     cru vindo de a.*), então a UI não tinha rótulo para mostrar.
--  2) O alerta "berçário com maior mortalidade" (10.4) não gravava
--     temporada_id, mesmo já filtrando pela temporada atual — ficava
--     órfão para fins de filtro por temporada.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. View com nome/ano da temporada ────────────────────────────
CREATE OR REPLACE VIEW vw_alertas_quelonios
WITH (security_invoker = true)
AS
SELECT
  a.*,
  n.numero_ninho,
  p.nome  AS praia_nome,
  uc.nome AS uc_nome,
  g.nome  AS grupo_nome,
  ur.nome_completo AS resolvido_por_nome,
  t.nome     AS temporada_nome,
  t.ano_base AS temporada_ano
FROM alertas_quelonios a
LEFT JOIN ninhos_quelonios n        ON n.id = a.ninho_id
LEFT JOIN praias_monitoramento p    ON p.id = a.praia_id
LEFT JOIN unidades_conservacao uc   ON uc.id = a.uc_id
LEFT JOIN grupos_biomonitor g       ON g.id = a.grupo_id
LEFT JOIN usuarios ur               ON ur.id = a.resolvido_por
LEFT JOIN temporadas_biomonitor t   ON t.id = a.temporada_id;

-- ── 2. Alerta de mortalidade do berçário passa a gravar temporada_id
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
      NULL, NULL, r.praia_id, r.uc_id, r.grupo_id, NULL, NULL,
      'praia:'||r.praia_id||':friagem:'||to_char(CURRENT_DATE,'IYYY-IW'), true);
    v_total := v_total + 1;
  END LOOP;

  -- ── 10.4 Berçário com maior TAXA de mortalidade (temporada atual) ──
  FOR r IN
    SELECT vlm.bercario_id, vlm.bercario_nome, vlm.bercario_uc_id, t.id AS temporada_id,
           SUM(vlm.qtd_entrada) AS entrada, SUM(vlm.mortes) AS mortes,
           ROUND(100.0 * SUM(vlm.mortes) / NULLIF(SUM(vlm.qtd_entrada), 0), 1) AS taxa_pct
      FROM vw_lotes_bercario_mortalidade vlm
      JOIN temporadas_biomonitor t ON t.id = vlm.temporada_id AND t.is_atual
     WHERE vlm.bercario_id IS NOT NULL
     GROUP BY vlm.bercario_id, vlm.bercario_nome, vlm.bercario_uc_id, t.id
    HAVING SUM(vlm.qtd_entrada) >= 10  -- piso mínimo: não comparar berçário com poucos filhotes
    ORDER BY (SUM(vlm.mortes)::numeric / NULLIF(SUM(vlm.qtd_entrada), 0)) DESC
    LIMIT 1
  LOOP
    IF r.taxa_pct > 5 THEN  -- abaixo disso não é destaque, é ruído
      v_sev := CASE WHEN r.taxa_pct >= 30 THEN 'critica' WHEN r.taxa_pct >= 15 THEN 'alta' ELSE 'media' END;

      INSERT INTO alertas_quelonios (
        escopo, parametro, faixa, severidade, titulo, mensagem, providencia,
        valor_num, bercario_id, uc_id, temporada_id, dedup_key
      ) VALUES (
        'bercario', 'mortalidade_bercario', 'Maior mortalidade', v_sev,
        format('Berçário %s com maior mortalidade da temporada (%s%%)', COALESCE(r.bercario_nome,'—'), r.taxa_pct),
        format('%s de %s filhotes não sobreviveram neste berçário na temporada atual — a maior taxa entre os berçários monitorados (mínimo de 10 entradas para comparação).', r.mortes, r.entrada),
        'Verificar condições do berçário (qualidade da água, alimentação, densidade, doenças) e comparar o manejo com os demais berçários.',
        r.taxa_pct, r.bercario_id, r.bercario_uc_id, r.temporada_id,
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
