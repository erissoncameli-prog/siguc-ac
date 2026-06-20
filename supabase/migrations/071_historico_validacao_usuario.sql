-- ════════════════════════════════════════════════════════════════
-- 071 — Histórico de validação: registra o nome do usuário + campos
-- ════════════════════════════════════════════════════════════════
-- O histórico ("idas e vindas") era gravado por DOIS triggers:
--   • tr_historico_validacao (066): {tipo, de, em, usuario_id, motivo}
--     — sem usuario_nome, então a tela mostrava "—" para quem agiu.
--   • trg_rc_log_correcao (070): entrada própria do brigadista, que
--     ACABAVA SOBRESCREVENDO a entrada do 066 (partia de OLD.historico).
--
-- Consolidamos num único gravador: fn_historico_validacao passa a
-- registrar usuario_nome + perfil (gestor/técnico/… ou brigadista) e,
-- na correção do brigadista, a lista de campos alterados. O trigger
-- duplicado do 070 é removido.
-- ════════════════════════════════════════════════════════════════

DROP TRIGGER  IF EXISTS trg_rc_log_correcao ON registros_campo;
DROP FUNCTION IF EXISTS fn_log_correcao_brigadista();

CREATE OR REPLACE FUNCTION fn_historico_validacao()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _entrada JSONB;
  _nome    text;
  _perfil  text;
  _campos  text[] := '{}';
BEGIN
  IF OLD.status_validacao IS DISTINCT FROM NEW.status_validacao THEN
    -- Quem realizou a ação: interno (usuarios) ou brigadista
    SELECT u.nome_completo, u.perfil::text INTO _nome, _perfil
    FROM usuarios u WHERE u.id = auth.uid();
    IF _nome IS NULL THEN
      SELECT b.nome_completo INTO _nome
      FROM brigadistas b WHERE b.usuario_id = auth.uid() LIMIT 1;
      IF _nome IS NOT NULL THEN _perfil := 'brigadista'; END IF;
    END IF;

    _entrada := jsonb_build_object(
      'tipo',         NEW.status_validacao::text,
      'de',           OLD.status_validacao::text,
      'em',           to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'usuario_id',   COALESCE(auth.uid()::text, 'sistema'),
      'usuario_nome', _nome,
      'perfil',       _perfil
    );

    -- Brigadista corrigindo (requer_correcao/rejeitado → aguardando)
    IF OLD.status_validacao IN ('requer_correcao', 'rejeitado')
       AND NEW.status_validacao = 'aguardando' THEN
      IF NEW.atividade          IS DISTINCT FROM OLD.atividade          THEN _campos := array_append(_campos, 'Atividade'); END IF;
      IF NEW.origem_acionamento IS DISTINCT FROM OLD.origem_acionamento THEN _campos := array_append(_campos, 'Acionada por'); END IF;
      IF NEW.hora_inicio        IS DISTINCT FROM OLD.hora_inicio        THEN _campos := array_append(_campos, 'Hora início'); END IF;
      IF NEW.hora_fim           IS DISTINCT FROM OLD.hora_fim           THEN _campos := array_append(_campos, 'Hora término'); END IF;
      IF NEW.duracao_horas      IS DISTINCT FROM OLD.duracao_horas      THEN _campos := array_append(_campos, 'Duração'); END IF;
      IF NEW.area_estimada_ha   IS DISTINCT FROM OLD.area_estimada_ha   THEN _campos := array_append(_campos, 'Área'); END IF;
      IF NEW.pessoas_alcancadas IS DISTINCT FROM OLD.pessoas_alcancadas THEN _campos := array_append(_campos, 'Pessoas alcançadas'); END IF;
      IF NEW.descricao          IS DISTINCT FROM OLD.descricao          THEN _campos := array_append(_campos, 'Descrição'); END IF;
      IF NEW.integrada_cbmac    IS DISTINCT FROM OLD.integrada_cbmac    THEN _campos := array_append(_campos, 'Apoio CBMAC'); END IF;

      _entrada := _entrada || jsonb_build_object(
        'acao',   'correcao_enviada',
        'campos', to_jsonb(_campos)
      );
      NEW.motivo_rejeicao := NULL;
      NEW.validado_em     := NULL;
      NEW.validado_por    := NULL;
    END IF;

    -- Gestor validando
    IF NEW.status_validacao = 'validado' THEN
      NEW.validado_em  := now();
      NEW.validado_por := auth.uid();
    END IF;

    -- Gestor rejeitando ou pedindo correção: anota o motivo
    IF NEW.status_validacao IN ('rejeitado', 'requer_correcao') THEN
      _entrada := _entrada || jsonb_build_object('motivo', NEW.motivo_rejeicao);
    END IF;

    NEW.historico := COALESCE(OLD.historico, '[]'::jsonb) || jsonb_build_array(_entrada);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_historico_validacao ON registros_campo;
CREATE TRIGGER tr_historico_validacao
  BEFORE UPDATE ON registros_campo
  FOR EACH ROW EXECUTE FUNCTION fn_historico_validacao();
