-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — RPC bio_ovos_resumo (viáveis/perdas)
-- Resumo canônico de ovos viáveis e perdas por causa, escopado ao
-- chamador, para os painéis (aba Dados) sem recriar RPCs grandes.
-- Reusa vw_ninho_ovos (mig. 124). Depende de 123/124.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bio_ovos_resumo(
  p_temporada_id uuid            DEFAULT NULL,
  p_especie      especie_quelonio DEFAULT NULL,
  p_praia_id     uuid            DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_grupo uuid; v_gestor boolean := false; v jsonb;
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

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_ovos_resumo TO authenticated, service_role;
