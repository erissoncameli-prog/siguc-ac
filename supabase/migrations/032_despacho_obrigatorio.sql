-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 032 — Despacho obrigatório + validação
-- Adiciona guard de observação não-vazia em todas as funções
-- de transição de etapa. Garante rastreabilidade total.
-- ═══════════════════════════════════════════════════════════

-- ── Helper: valida despacho e retorna texto normalizado ───────

CREATE OR REPLACE FUNCTION _validar_despacho(p_obs text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_obs IS NULL OR trim(p_obs) = '' THEN
    RAISE EXCEPTION 'Despacho obrigatório: informe a justificativa da transição.';
  END IF;
  IF length(trim(p_obs)) < 10 THEN
    RAISE EXCEPTION 'Despacho muito curto: mínimo 10 caracteres.';
  END IF;
  RETURN trim(p_obs);
END;
$$;

-- ── Recriar funções com validação de despacho ─────────────────

-- 1. despachar_triagem
CREATE OR REPLACE FUNCTION despachar_triagem(
  p_pesquisa_id  uuid,
  p_resultado    resultado_triagem,
  p_observacao   text,
  p_analista_id  uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel        nivel_hierarquico;
  v_cargo_uc     uuid;
  v_pesquisa_uc  uuid;
  v_etapa        etapa_pesquisa;
  v_email        text;
  v_numero       text;
  v_obs          text;
BEGIN
  v_obs := _validar_despacho(p_observacao);

  IF NOT _is_super_admin() THEN
    SELECT c.nivel, c.uc_id INTO v_nivel, v_cargo_uc
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;
  END IF;

  SELECT uc_id, etapa, pesquisador_email, numero_processo
  INTO v_pesquisa_uc, v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT _is_super_admin() AND NOT (
    (v_nivel IN ('gestor_uc','analista_uc') AND v_cargo_uc = v_pesquisa_uc)
    OR v_nivel IN ('chefe_deuc','chefe_debio')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para realizar triagem desta pesquisa.';
  END IF;

  IF v_etapa != 'submetida' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa "Submetida".';
  END IF;

  IF p_resultado = 'aprovada' THEN
    UPDATE pesquisas SET
      etapa               = 'analise_tecnica',
      triagem_resultado   = 'aprovada',
      triagem_responsavel = auth.uid(),
      triagem_em          = now(),
      triagem_observacao  = v_obs,
      analista_id         = COALESCE(p_analista_id, analista_id)
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'submetida', 'analise_tecnica', auth.uid(), v_obs);

  ELSIF p_resultado = 'exigencia' THEN
    UPDATE pesquisas SET
      triagem_resultado         = 'exigencia',
      triagem_responsavel       = auth.uid(),
      triagem_em                = now(),
      triagem_observacao        = v_obs,
      complementacao_solicitada = true,
      complementacao_motivo     = v_obs
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'submetida', 'submetida', auth.uid(), 'Exigência: ' || v_obs);

  ELSIF p_resultado = 'rejeitada' THEN
    UPDATE pesquisas SET
      etapa               = 'arquivada',
      triagem_resultado   = 'rejeitada',
      triagem_responsavel = auth.uid(),
      triagem_em          = now(),
      triagem_observacao  = v_obs
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'submetida', 'arquivada', auth.uid(), 'Rejeitada: ' || v_obs);
  END IF;

  IF v_email IS NOT NULL THEN
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    VALUES (p_pesquisa_id,
      CASE p_resultado
        WHEN 'aprovada'  THEN 'triagem_aprovada'
        WHEN 'exigencia' THEN 'triagem_exigencia'
        WHEN 'rejeitada' THEN 'triagem_rejeitada'
      END, v_email,
      '[SIGUC] ' || v_numero || ' — ' || CASE p_resultado
        WHEN 'aprovada'  THEN 'Pesquisa aceita para análise técnica'
        WHEN 'exigencia' THEN 'Documentação complementar necessária'
        WHEN 'rejeitada' THEN 'Pesquisa não aceita'
      END);
  END IF;
END;
$$;

-- 2. despachar_analise_tecnica
CREATE OR REPLACE FUNCTION despachar_analise_tecnica(
  p_pesquisa_id  uuid,
  p_favoravel    boolean,
  p_observacao   text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel  nivel_hierarquico;
  v_etapa  etapa_pesquisa;
  v_obs    text;
BEGIN
  v_obs := _validar_despacho(p_observacao);

  IF NOT _is_super_admin() THEN
    SELECT c.nivel INTO v_nivel
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;
  END IF;

  SELECT etapa INTO v_etapa FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT _is_super_admin() AND NOT (
    EXISTS (SELECT 1 FROM pesquisas WHERE id = p_pesquisa_id AND analista_id = auth.uid())
    OR v_nivel IN ('chefe_deuc','chefe_debio')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para emitir análise técnica desta pesquisa.';
  END IF;

  IF v_etapa != 'analise_tecnica' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa "Análise Técnica".';
  END IF;

  IF p_favoravel THEN
    UPDATE pesquisas SET etapa = 'parecer_juridico' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_tecnica', 'parecer_juridico', auth.uid(), v_obs);
  ELSE
    UPDATE pesquisas SET etapa = 'triagem', triagem_resultado = 'pendente' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_tecnica', 'triagem', auth.uid(), 'Devolvido: ' || v_obs);
  END IF;
END;
$$;

-- 3. despachar_parecer_dima
CREATE OR REPLACE FUNCTION despachar_parecer_dima(
  p_pesquisa_id uuid,
  p_encaminhar  boolean,
  p_observacao  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel  nivel_hierarquico;
  v_etapa  etapa_pesquisa;
  v_email  text;
  v_numero text;
  v_obs    text;
BEGIN
  v_obs := _validar_despacho(p_observacao);

  IF NOT _is_super_admin() THEN
    SELECT c.nivel INTO v_nivel
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;
    IF v_nivel != 'diretor' THEN
      RAISE EXCEPTION 'Apenas o Diretor da DIMA pode emitir o Parecer DIMA.';
    END IF;
  END IF;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF v_etapa != 'parecer_juridico' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa "Parecer DIMA".';
  END IF;

  IF p_encaminhar THEN
    UPDATE pesquisas SET etapa = 'aap_emissao' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'parecer_juridico', 'aap_emissao', auth.uid(), v_obs);
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    SELECT p_pesquisa_id, 'aviso_secretario', u.email,
           '[SIGUC] ' || v_numero || ' — Aguarda autorização'
    FROM cargos_atuais ca
    JOIN cargos c ON c.id = ca.cargo_id
    JOIN usuarios u ON u.id = ca.responsavel_atual_id
    WHERE c.nivel = 'secretario' LIMIT 1;
  ELSE
    UPDATE pesquisas SET etapa = 'analise_tecnica' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'parecer_juridico', 'analise_tecnica', auth.uid(), 'Diligência DIMA: ' || v_obs);
  END IF;
END;
$$;

-- 4. despachar_autorizacao_secretario
CREATE OR REPLACE FUNCTION despachar_autorizacao_secretario(
  p_pesquisa_id uuid,
  p_autorizado  boolean,
  p_observacao  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel  nivel_hierarquico;
  v_etapa  etapa_pesquisa;
  v_email  text;
  v_numero text;
  v_obs    text;
BEGIN
  v_obs := _validar_despacho(p_observacao);

  IF NOT _is_super_admin() THEN
    SELECT c.nivel INTO v_nivel
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;
    IF v_nivel != 'secretario' THEN
      RAISE EXCEPTION 'Apenas o Secretário de Estado pode autorizar a pesquisa.';
    END IF;
  END IF;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF v_etapa != 'aap_emissao' THEN
    RAISE EXCEPTION 'Pesquisa não está aguardando autorização do Secretário.';
  END IF;

  IF p_autorizado THEN
    UPDATE pesquisas SET
      etapa            = 'aap_assinatura',
      aap_assinado_por = auth.uid(),
      aap_assinado_em  = now()
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'aap_emissao', 'aap_assinatura', auth.uid(), v_obs);
  ELSE
    UPDATE pesquisas SET etapa = 'arquivada' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'aap_emissao', 'arquivada', auth.uid(), 'Negado: ' || v_obs);
    IF v_email IS NOT NULL THEN
      INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
      VALUES (p_pesquisa_id, 'autorizacao_negada', v_email,
              '[SIGUC] ' || v_numero || ' — Pesquisa não autorizada');
    END IF;
  END IF;
END;
$$;

-- 5. despachar_entrega_aap
CREATE OR REPLACE FUNCTION despachar_entrega_aap(
  p_pesquisa_id     uuid,
  p_data_inicio_real date DEFAULT NULL,
  p_observacao      text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel    nivel_hierarquico;
  v_cargo_uc uuid;
  v_pesq_uc  uuid;
  v_etapa    etapa_pesquisa;
  v_obs      text;
BEGIN
  v_obs := _validar_despacho(p_observacao);

  IF NOT _is_super_admin() THEN
    SELECT c.nivel, c.uc_id INTO v_nivel, v_cargo_uc
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;
  END IF;

  SELECT etapa, uc_id INTO v_etapa, v_pesq_uc
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT _is_super_admin() AND NOT (
    (v_nivel IN ('gestor_uc','analista_uc') AND v_cargo_uc = v_pesq_uc)
    OR v_nivel IN ('chefe_deuc','chefe_debio')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para registrar entrega da AAP.';
  END IF;

  IF v_etapa != 'aap_publicada' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa "AAP Publicada".';
  END IF;

  UPDATE pesquisas SET
    etapa            = 'em_campo',
    data_inicio_real = COALESCE(p_data_inicio_real, data_inicio_real)
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'aap_publicada', 'em_campo', auth.uid(), v_obs);
END;
$$;

-- 6. despachar_fase_simples
CREATE OR REPLACE FUNCTION despachar_fase_simples(
  p_pesquisa_id uuid,
  p_nova_etapa  etapa_pesquisa,
  p_observacao  text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel    nivel_hierarquico;
  v_cargo_uc uuid;
  v_pesq_uc  uuid;
  v_etapa    etapa_pesquisa;
  v_obs      text;
BEGIN
  v_obs := _validar_despacho(p_observacao);

  IF NOT _is_super_admin() THEN
    SELECT c.nivel, c.uc_id INTO v_nivel, v_cargo_uc
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;
  END IF;

  SELECT etapa, uc_id INTO v_etapa, v_pesq_uc
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT _is_super_admin() AND NOT (
    (v_nivel IN ('gestor_uc','analista_uc') AND v_cargo_uc = v_pesq_uc)
    OR v_nivel IN ('chefe_deuc','chefe_debio','diretor')
    OR EXISTS (SELECT 1 FROM pesquisas WHERE id = p_pesquisa_id AND analista_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Sem permissão para avançar esta etapa.';
  END IF;

  UPDATE pesquisas SET etapa = p_nova_etapa WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, v_etapa, p_nova_etapa, auth.uid(), v_obs);
END;
$$;

-- 7. despachar_avaliar_relatorio
CREATE OR REPLACE FUNCTION despachar_avaliar_relatorio(
  p_pesquisa_id uuid,
  p_aprovado    boolean,
  p_observacao  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel  nivel_hierarquico;
  v_etapa  etapa_pesquisa;
  v_email  text;
  v_numero text;
  v_obs    text;
BEGIN
  v_obs := _validar_despacho(p_observacao);

  IF NOT _is_super_admin() THEN
    SELECT c.nivel INTO v_nivel
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;
  END IF;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT _is_super_admin() AND NOT (
    EXISTS (SELECT 1 FROM pesquisas WHERE id = p_pesquisa_id AND analista_id = auth.uid())
    OR v_nivel IN ('chefe_deuc','chefe_debio')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para avaliar relatório desta pesquisa.';
  END IF;

  IF v_etapa != 'analise_relatorio' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa de Avaliação de Relatórios.';
  END IF;

  IF p_aprovado THEN
    UPDATE pesquisas SET
      relatorio_avaliado_em  = now(),
      relatorio_avaliado_por = auth.uid()
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_relatorio', 'analise_relatorio', auth.uid(),
            'Avaliação aprovada. Aguarda homologação. ' || v_obs);
  ELSE
    UPDATE pesquisas SET
      etapa                  = 'relatorio_final',
      relatorio_avaliado_em  = NULL,
      relatorio_avaliado_por = NULL
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_relatorio', 'relatorio_final', auth.uid(), 'Exigência: ' || v_obs);
    IF v_email IS NOT NULL THEN
      INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
      VALUES (p_pesquisa_id, 'relatorio_exigencia', v_email,
              '[SIGUC] ' || v_numero || ' — Complementação do relatório necessária');
    END IF;
  END IF;
END;
$$;

-- 8. despachar_homologar_relatorio
CREATE OR REPLACE FUNCTION despachar_homologar_relatorio(
  p_pesquisa_id uuid,
  p_aprovado    boolean,
  p_observacao  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel       nivel_hierarquico;
  v_etapa       etapa_pesquisa;
  v_avaliado_em timestamptz;
  v_email       text;
  v_numero      text;
  v_obs         text;
BEGIN
  v_obs := _validar_despacho(p_observacao);

  IF NOT _is_super_admin() THEN
    SELECT c.nivel INTO v_nivel
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;
    IF v_nivel NOT IN ('chefe_deuc','chefe_debio') THEN
      RAISE EXCEPTION 'Apenas o Chefe do DEUC pode homologar a avaliação de relatórios.';
    END IF;
  END IF;

  SELECT etapa, relatorio_avaliado_em, pesquisador_email, numero_processo
  INTO v_etapa, v_avaliado_em, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF v_etapa != 'analise_relatorio' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa de Avaliação de Relatórios.';
  END IF;

  IF v_avaliado_em IS NULL THEN
    RAISE EXCEPTION 'O analista ainda não avaliou o relatório.';
  END IF;

  IF p_aprovado THEN
    UPDATE pesquisas SET
      etapa                    = 'encerrada',
      relatorio_homologado_em  = now(),
      relatorio_homologado_por = auth.uid()
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_relatorio', 'encerrada', auth.uid(), 'Homologado: ' || v_obs);
  ELSE
    UPDATE pesquisas SET
      etapa                  = 'relatorio_final',
      relatorio_avaliado_em  = NULL,
      relatorio_avaliado_por = NULL
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_relatorio', 'relatorio_final', auth.uid(), 'Não homologado: ' || v_obs);
    IF v_email IS NOT NULL THEN
      INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
      VALUES (p_pesquisa_id, 'relatorio_exigencia', v_email,
              '[SIGUC] ' || v_numero || ' — Complementação do relatório necessária');
    END IF;
  END IF;
END;
$$;

-- 9. despachar_encerramento
CREATE OR REPLACE FUNCTION despachar_encerramento(
  p_pesquisa_id   uuid,
  p_data_fim_real date DEFAULT NULL,
  p_observacao    text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel  nivel_hierarquico;
  v_etapa  etapa_pesquisa;
  v_email  text;
  v_numero text;
  v_obs    text;
BEGIN
  v_obs := _validar_despacho(p_observacao);

  IF NOT _is_super_admin() THEN
    SELECT c.nivel INTO v_nivel
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;
    IF v_nivel NOT IN ('chefe_deuc','chefe_debio') THEN
      RAISE EXCEPTION 'Apenas o Chefe do DEUC pode encerrar o processo.';
    END IF;
  END IF;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF v_etapa != 'encerrada' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa "Encerrada".';
  END IF;

  UPDATE pesquisas SET
    etapa        = 'arquivada',
    data_fim_real = COALESCE(p_data_fim_real, data_fim_real, current_date)
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'encerrada', 'arquivada', auth.uid(), v_obs);

  IF v_email IS NOT NULL THEN
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    VALUES (p_pesquisa_id, 'encerrada', v_email,
            '[SIGUC] ' || v_numero || ' — Pesquisa encerrada');
  END IF;
END;
$$;
