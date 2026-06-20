-- 068_correcoes_pendentes_ids.sql
-- Corrige erro 42501 ao reenviar correção de registro "Restaurado do servidor".
--
-- Registros reconstruídos pela fila zerada vinham SEM brigadista_id. No reenvio,
-- o upsert (INSERT ... ON CONFLICT DO UPDATE) avalia o WITH CHECK da política de
-- INSERT (rc_brigadista_insert) sobre a linha-candidata; com brigadista_id NULL a
-- checagem falha → "new row violates row-level security policy".
--
-- A RPC passa a devolver brigadista_id/brigada_id/uc_id/regional/equipe_id para
-- que o skeleton reconstruído carregue esses campos e satisfaça a RLS.

DROP FUNCTION IF EXISTS app_correcoes_pendentes();

CREATE FUNCTION app_correcoes_pendentes()
RETURNS TABLE (
  uuid_cliente       UUID,
  brigadista_id      UUID,
  brigada_id         UUID,
  uc_id              UUID,
  regional           regional_ac,
  equipe_id          UUID,
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
    rc.uc_id,
    rc.regional,
    rc.equipe_id,
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
