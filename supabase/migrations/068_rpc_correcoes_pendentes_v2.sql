-- 068_rpc_correcoes_pendentes_v2.sql
-- Adiciona brigadista_id, brigada_id, equipe_id, uc_id, regional, municipio
-- ao retorno de app_correcoes_pendentes() para que o app possa reconstruir
-- registros completos (com os FK obrigatórios para RLS de INSERT no UPSERT).

DROP FUNCTION IF EXISTS app_correcoes_pendentes();

CREATE FUNCTION app_correcoes_pendentes()
RETURNS TABLE (
  uuid_cliente       UUID,
  brigadista_id      UUID,
  brigada_id         UUID,
  equipe_id          UUID,
  uc_id              UUID,
  regional           TEXT,
  municipio          TEXT,
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
    rc.brigadista_id,
    rc.brigada_id,
    rc.equipe_id,
    rc.uc_id,
    rc.regional::TEXT,
    rc.municipio,
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
