-- 066_fluxo_correcao.sql
-- Fluxo de correção de registros de campo
-- • Brigadista pode corrigir registros marcados como requer_correcao
-- • Historico automático de mudanças de status_validacao
-- • Notificação via polling (brigada app lê status de seus próprios registros)

-- ──────────────────────────────────────────────────────────────────
-- 1. Política RLS: brigadista pode atualizar quando requer_correcao
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "rc_brigadista_update_own" ON registros_campo;

CREATE POLICY "rc_brigadista_update_own" ON registros_campo
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM brigadistas b
      WHERE  b.id          = registros_campo.brigadista_id
        AND  b.usuario_id  = auth.uid()
        AND  b.status      = 'ativo'
    )
    AND status_validacao IN ('aguardando', 'requer_correcao')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM brigadistas b
      WHERE  b.id          = registros_campo.brigadista_id
        AND  b.usuario_id  = auth.uid()
        AND  b.status      = 'ativo'
    )
    -- Brigadista só pode devolver o registro como aguardando
    AND status_validacao = 'aguardando'
  );

-- ──────────────────────────────────────────────────────────────────
-- 2. Trigger: registra mudanças de status_validacao em historico
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_historico_validacao()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _entrada JSONB;
BEGIN
  IF OLD.status_validacao IS DISTINCT FROM NEW.status_validacao THEN
    _entrada := jsonb_build_object(
      'tipo',       NEW.status_validacao::text,
      'de',         OLD.status_validacao::text,
      'em',         to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'usuario_id', COALESCE(auth.uid()::text, 'sistema')
    );

    -- Brigadista corrigindo (requer_correcao → aguardando)
    IF OLD.status_validacao = 'requer_correcao' AND NEW.status_validacao = 'aguardando' THEN
      _entrada := _entrada || jsonb_build_object(
        'acao', 'correcao_enviada',
        'snapshot_antes', jsonb_build_object(
          'natureza',           OLD.natureza::text,
          'atividade',          OLD.atividade::text,
          'hora_inicio',        to_char(OLD.hora_inicio, 'HH24:MI'),
          'hora_fim',           to_char(OLD.hora_fim, 'HH24:MI'),
          'duracao_horas',      OLD.duracao_horas,
          'area_estimada_ha',   OLD.area_estimada_ha,
          'pessoas_alcancadas', OLD.pessoas_alcancadas,
          'descricao',          OLD.descricao,
          'origem_acionamento', OLD.origem_acionamento::text,
          'integrada_cbmac',    OLD.integrada_cbmac
        )
      );
      -- Limpa o motivo e reseta datas de validação
      NEW.motivo_rejeicao := NULL;
      NEW.validado_em     := NULL;
      NEW.validado_por    := NULL;
    END IF;

    -- Gestor validando (→ validado)
    IF NEW.status_validacao = 'validado' THEN
      NEW.validado_em  := now();
      NEW.validado_por := auth.uid();
    END IF;

    -- Gestor rejeitando (→ rejeitado) ou pedindo correção (→ requer_correcao)
    IF NEW.status_validacao IN ('rejeitado', 'requer_correcao') THEN
      _entrada := _entrada || jsonb_build_object(
        'motivo', NEW.motivo_rejeicao
      );
    END IF;

    NEW.historico := OLD.historico || jsonb_build_array(_entrada);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_historico_validacao ON registros_campo;
CREATE TRIGGER tr_historico_validacao
  BEFORE UPDATE ON registros_campo
  FOR EACH ROW EXECUTE FUNCTION fn_historico_validacao();

-- ──────────────────────────────────────────────────────────────────
-- 3. RPC: brigada app busca status_validacao dos próprios registros
--    SECURITY DEFINER → brigadista só vê seus próprios registros
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_status_validacao(uuids UUID[])
RETURNS TABLE (
  uuid_cliente     UUID,
  status_validacao status_validacao,
  motivo_rejeicao  TEXT
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
  SELECT rc.uuid_cliente, rc.status_validacao, rc.motivo_rejeicao
  FROM   registros_campo rc
  WHERE  rc.uuid_cliente   = ANY(uuids)
    AND  rc.brigadista_id  = _brigadista_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_status_validacao(UUID[]) TO authenticated;
