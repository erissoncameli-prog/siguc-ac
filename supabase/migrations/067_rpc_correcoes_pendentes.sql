-- 067_rpc_correcoes_pendentes.sql
-- RPC que retorna TODOS os registros do brigadista logado que precisam
-- de correção ou foram rejeitados, independente de estado local no app.
-- Usado pelo poll para reconstituir registros apagados da fila local.

CREATE OR REPLACE FUNCTION app_correcoes_pendentes()
RETURNS TABLE (
  uuid_cliente       UUID,
  natureza           TEXT,
  atividade          TEXT,
  hora_inicio        TIME,
  hora_fim           TIME,
  duracao_horas      NUMERIC,
  area_estimada_ha   NUMERIC,
  pessoas_alcancadas INTEGER,
  descricao          TEXT,
  origem_acionamento TEXT,
  integrada_cbmac    BOOLEAN,
  data_hora_evento   TIMESTAMPTZ,
  sincronizado_em    TIMESTAMPTZ,
  status_validacao   status_validacao,
  motivo_rejeicao    TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _brigadista_id UUID;
BEGIN
  SELECT id INTO _brigadista_id
  FROM brigadistas
  WHERE usuario_id = auth.uid() AND status = 'ativo'
  LIMIT 1;

  IF _brigadista_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    rc.uuid_cliente,
    rc.natureza::TEXT,
    rc.atividade::TEXT,
    rc.hora_inicio,
    rc.hora_fim,
    rc.duracao_horas,
    rc.area_estimada_ha,
    rc.pessoas_alcancadas,
    rc.descricao,
    rc.origem_acionamento::TEXT,
    rc.integrada_cbmac,
    rc.data_hora_evento,
    rc.sincronizado_em,
    rc.status_validacao,
    rc.motivo_rejeicao
  FROM registros_campo rc
  WHERE rc.brigadista_id  = _brigadista_id
    AND rc.status_validacao IN ('requer_correcao', 'rejeitado')
  ORDER BY rc.data_hora_evento DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION app_correcoes_pendentes() TO authenticated;
