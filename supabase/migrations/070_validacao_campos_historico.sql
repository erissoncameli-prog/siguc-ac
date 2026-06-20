-- ════════════════════════════════════════════════════════════════
-- 070 — Validação de campo: campos completos + histórico do brigadista
-- ════════════════════════════════════════════════════════════════
-- 1) Expõe na view de validação os campos de área (método/medida/validada)
--    que faltavam para o validador conferir tudo. Os demais campos
--    ausentes no modal (origem_acionamento, hora_inicio/fim, duracao_horas,
--    municipio) já existiam na view — falta só exibi-los no front.
-- 2) Registra no histórico ("idas e vindas") a correção feita pelo
--    brigadista: data/hora + quais campos foram alterados. O lado do
--    gestor já é gravado pela RPC validar_registro_campo.
-- ════════════════════════════════════════════════════════════════

-- ── 1. View com os campos de área ────────────────────────────────
DROP VIEW IF EXISTS vw_registros_validacao;
CREATE OR REPLACE VIEW vw_registros_validacao AS
SELECT
  rc.id, rc.uuid_cliente, rc.codigo_ocorrencia,
  rc.natureza, rc.atividade,
  rc.equipe, rc.equipe_id, eq.nome AS equipe_nome, rc.duracao_horas,
  rc.hora_inicio, rc.hora_fim,
  rc.origem_acionamento,
  rc.status_validacao, rc.motivo_rejeicao, rc.historico, rc.fotos_urls,
  rc.data_hora_evento, rc.criado_em, rc.sincronizado_em, rc.validado_em,
  rc.descricao, rc.area_estimada_ha, rc.pessoas_alcancadas, rc.precisao_gps_m,
  -- Detalhe de área (faltava no modal de validação)
  rc.area_metodo, rc.area_medida_ha, rc.area_validada_ha,
  rc.alerta_cigma, rc.integrada_cbmac, rc.alerta_id, rc.ocorrencia_id,
  rc.uc_id, rc.brigada_id, rc.brigadista_id,
  COALESCE(rc.regional, br.regional, uc.regional) AS regional,
  rc.municipio,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_Y(rc.localizacao) END AS lat,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_X(rc.localizacao) END AS lng,
  b.nome_completo AS brigadista_nome,
  br.nome AS brigada_nome,
  uc.nome AS uc_nome,
  uv.nome_completo AS validado_por_nome,
  COALESCE(f.n_fauna, 0) AS n_fauna,
  COALESCE(f.n_fauna_pendente, 0) AS n_fauna_pendente,
  COALESCE(f.n_fauna_resgatada, 0) AS n_fauna_resgatada
FROM registros_campo rc
LEFT JOIN brigadistas b ON b.id = rc.brigadista_id
LEFT JOIN brigadas br ON br.id = rc.brigada_id
LEFT JOIN equipes_brigada eq ON eq.id = rc.equipe_id
LEFT JOIN unidades_conservacao uc ON uc.id = rc.uc_id
LEFT JOIN usuarios uv ON uv.id = rc.validado_por
LEFT JOIN (
  SELECT registro_campo_id,
    COUNT(*) AS n_fauna,
    COUNT(*) FILTER (WHERE NOT identificacao_confirmada) AS n_fauna_pendente,
    COALESCE(SUM(quantidade) FILTER (WHERE tipo_evento = 'resgate'), 0) AS n_fauna_resgatada
  FROM registro_fauna
  GROUP BY registro_campo_id
) f ON f.registro_campo_id = rc.id;

-- ── 2. Histórico da correção do brigadista ───────────────────────
-- Dispara só na transição de reenvio (requer_correcao/rejeitado →
-- aguardando), que só acontece quando o brigadista corrige e reenvia.
-- Compara valores antigos × novos e anota os campos alterados.
CREATE OR REPLACE FUNCTION fn_log_correcao_brigadista()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _campos text[] := '{}';
  _nome   text;
BEGIN
  IF NEW.status_validacao = 'aguardando'
     AND OLD.status_validacao IN ('requer_correcao', 'rejeitado') THEN

    IF NEW.atividade          IS DISTINCT FROM OLD.atividade          THEN _campos := array_append(_campos, 'Atividade'); END IF;
    IF NEW.origem_acionamento IS DISTINCT FROM OLD.origem_acionamento THEN _campos := array_append(_campos, 'Acionada por'); END IF;
    IF NEW.hora_inicio        IS DISTINCT FROM OLD.hora_inicio        THEN _campos := array_append(_campos, 'Hora início'); END IF;
    IF NEW.hora_fim           IS DISTINCT FROM OLD.hora_fim           THEN _campos := array_append(_campos, 'Hora término'); END IF;
    IF NEW.duracao_horas      IS DISTINCT FROM OLD.duracao_horas      THEN _campos := array_append(_campos, 'Duração'); END IF;
    IF NEW.area_estimada_ha   IS DISTINCT FROM OLD.area_estimada_ha   THEN _campos := array_append(_campos, 'Área'); END IF;
    IF NEW.pessoas_alcancadas IS DISTINCT FROM OLD.pessoas_alcancadas THEN _campos := array_append(_campos, 'Pessoas alcançadas'); END IF;
    IF NEW.descricao          IS DISTINCT FROM OLD.descricao          THEN _campos := array_append(_campos, 'Descrição'); END IF;
    IF NEW.integrada_cbmac    IS DISTINCT FROM OLD.integrada_cbmac    THEN _campos := array_append(_campos, 'Apoio CBMAC'); END IF;

    SELECT nome_completo INTO _nome FROM brigadistas WHERE id = NEW.brigadista_id;

    NEW.historico := COALESCE(OLD.historico, '[]'::jsonb) || jsonb_build_object(
      'data',         to_char(now() AT TIME ZONE 'America/Rio_Branco', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'usuario_nome', COALESCE(_nome, 'Brigadista'),
      'perfil',       'brigadista',
      'acao',         'corrigido',
      'campos',       to_jsonb(_campos),
      'obs',          ''
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rc_log_correcao ON registros_campo;
CREATE TRIGGER trg_rc_log_correcao
  BEFORE UPDATE ON registros_campo
  FOR EACH ROW EXECUTE FUNCTION fn_log_correcao_brigadista();
