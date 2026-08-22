-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — correção de formatação da 308
-- (mesmo padrão de correção das 257b/302b: aplicada como migration
-- separada para manter o rastro de auditoria, mesmo que o arquivo
-- 308 no repositório já tenha nascido com este texto corrigido)
--
-- `agua_prazo_preservacao_alertas` usava `to_char(...,'FM999990.0')`
-- (ponto decimal) — inconsistente com o resto do sistema, que usa
-- vírgula em toda mensagem de alerta (`agua_num_br()`, migration
-- 302b). Troca pontual, mesma função, mesmo comportamento.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION agua_prazo_preservacao_alertas(
  p_data_coleta      date,
  p_data_recebimento date,
  p_parametros        text[]
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_out    jsonb := '[]'::jsonb;
  v_horas  numeric;
  v_prazo  record;
BEGIN
  IF p_data_coleta IS NULL OR p_data_recebimento IS NULL OR p_parametros IS NULL THEN
    RETURN v_out;
  END IF;

  IF p_data_recebimento < p_data_coleta THEN
    RETURN v_out;
  END IF;

  v_horas := EXTRACT(EPOCH FROM (p_data_recebimento::timestamp - p_data_coleta::timestamp)) / 3600;

  FOR v_prazo IN
    SELECT parametro, prazo_horas, refrigeracao_exigida
    FROM agua_prazos_analise
    WHERE parametro = ANY(p_parametros)
      AND prazo_horas < v_horas
  LOOP
    v_out := v_out || jsonb_build_object(
      'parametro', v_prazo.parametro,
      'tipo', 'prazo',
      'nivel', 'informar',
      'mensagem', format(
        'Recebida no laboratório %s h após a coleta — acima do prazo de preservação (%s h)%s. Resultado com validade analítica comprometida.',
        agua_num_br(round(v_horas,1)),
        agua_num_br(v_prazo.prazo_horas),
        CASE WHEN v_prazo.refrigeracao_exigida THEN ', mesmo com refrigeração' ELSE '' END),
      'horas_decorridas', round(v_horas, 1),
      'prazo_horas', v_prazo.prazo_horas
    );
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION agua_prazo_preservacao_alertas(date, date, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_prazo_preservacao_alertas(date, date, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION agua_prazo_preservacao_alertas(date, date, text[]) TO authenticated;
