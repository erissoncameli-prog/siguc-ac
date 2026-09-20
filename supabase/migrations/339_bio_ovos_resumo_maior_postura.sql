-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — KPI "ninho com mais ovos" (Aba Dados)
-- ───────────────────────────────────────────────────────────────
-- Pedido do usuário: destacar o ninho de maior postura junto dos
-- outros KPIs de ovos (Ovos/postura, viáveis, perdidos), que já vêm
-- de bio_ovos_resumo(). Mudança CIRÚRGICA no corpo — assinatura
-- intacta (mesmos 3 parâmetros), então CREATE OR REPLACE é seguro
-- aqui (RETURNS jsonb, não RETURNS TABLE — não há coluna pra
-- reordenar, mesmo cuidado documentado em vários pontos do projeto
-- só se aplica a TABLE/VIEW).
--
-- "Número de ovos" = n.qtd_ovos (== ov.postura de vw_ninho_ovos),
-- o mesmo campo canônico que já alimenta viáveis/perdas — nunca um
-- 2º número (postura estimada vs. confirmada já é UM campo só desde
-- a 322_biomonitor_postura_estimada).
--
-- Praia mostrada é a ATUAL (praia_atual_id, onde o ninho incuba
-- agora), mesmo fallback de bioNinhoCardInner no cliente — um ninho
-- transferido exibido pela praia de origem confundiria quem só olha
-- o KPI, sem abrir o card.
--
-- Desempate por ninho mais antigo (data_encontro) quando duas posturas
-- empatam no máximo — decisão arbitrária mas determinística, nunca
-- "qualquer um que o banco devolver primeiro".
--
-- Sem postura > 0 no recorte (nenhum ninho, ou só zeros): a
-- subconsulta não devolve linha e o campo fica NULL — o cliente já
-- trata "sem dado" mostrando "—" (mesmo padrão de _bioSetText).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bio_ovos_resumo(
  p_temporada_id uuid            DEFAULT NULL,
  p_especie      especie_quelonio DEFAULT NULL,
  p_praia_id     uuid            DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_grupo uuid; v_gestor boolean := false; v jsonb; v_maior jsonb;
BEGIN
  SELECT grupo_id INTO v_grupo FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo' LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
    AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo) INTO v_gestor;
  IF v_grupo IS NULL AND NOT v_gestor THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'postura',          COALESCE(SUM(ov.postura), 0),
    'viaveis',          COALESCE(SUM(ov.viaveis), 0),
    'perdidos',         COALESCE(SUM(ov.perdas_total), 0),
    'perdas_predacao',  COALESCE(SUM(ov.perda_predacao), 0),
    'perdas_alagamento',COALESCE(SUM(ov.perda_alagamento), 0),
    'perdas_erosao',    COALESCE(SUM(ov.perda_erosao), 0),
    'perdas_humana',    COALESCE(SUM(ov.perda_humana), 0)
  ) INTO v
  FROM ninhos_quelonios n
  JOIN vw_ninho_ovos ov ON ov.ninho_id = n.id
  WHERE (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
    AND (p_especie  IS NULL OR n.especie  = p_especie)
    AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
    AND (v_gestor OR n.grupo_id = v_grupo);

  SELECT jsonb_build_object(
    'numero',  COALESCE(n.numero_atual, n.numero_ninho),
    'postura', ov.postura,
    'praia',   p.nome
  ) INTO v_maior
  FROM ninhos_quelonios n
  JOIN vw_ninho_ovos ov ON ov.ninho_id = n.id
  LEFT JOIN praias_monitoramento p ON p.id = COALESCE(n.praia_atual_id, n.praia_id)
  WHERE (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
    AND (p_especie  IS NULL OR n.especie  = p_especie)
    AND (p_praia_id IS NULL OR n.praia_id = p_praia_id)
    AND (v_gestor OR n.grupo_id = v_grupo)
    AND ov.postura > 0
  ORDER BY ov.postura DESC, n.data_encontro ASC
  LIMIT 1;

  v := v || jsonb_build_object('ninho_maior_postura', v_maior);
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_ovos_resumo TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION bio_ovos_resumo FROM anon;
