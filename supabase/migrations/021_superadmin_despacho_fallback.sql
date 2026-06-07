-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 021 — Fallback super_admin nos despachos
-- Permite que usuários super_admin operem o fluxo de pesquisa
-- mesmo sem cargo formal cadastrado na estrutura organizacional.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. minha_posicao(): retorna posição sintética para super_admin ───

CREATE OR REPLACE FUNCTION minha_posicao()
RETURNS TABLE(nivel nivel_hierarquico, uc_id uuid, unidade_sigla text)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  -- Cargo formal tem prioridade
  RETURN QUERY
    SELECT c.nivel, c.uc_id, uo.sigla
    FROM cargos_atuais ca
    JOIN cargos c  ON c.id  = ca.cargo_id
    JOIN unidades_organizacionais uo ON uo.id = c.unidade_org_id
    WHERE ca.responsavel_atual_id = auth.uid()
    LIMIT 1;

  -- Fallback: super_admin sem cargo → age como secretario
  IF NOT FOUND THEN
    RETURN QUERY
      SELECT
        'secretario'::nivel_hierarquico,
        NULL::uuid,
        'SEMA'::text
      FROM usuarios
      WHERE id = auth.uid() AND perfil = 'super_admin'
      LIMIT 1;
  END IF;
END;
$$;

-- ─── 2. Helper interno: verificar se usuário é super_admin ───────────

CREATE OR REPLACE FUNCTION _is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND perfil = 'super_admin');
$$;

-- ─── 3. Patch despachar_triagem ──────────────────────────────────────

CREATE OR REPLACE FUNCTION despachar_triagem(
  p_pesquisa_id  uuid,
  p_resultado    resultado_triagem,
  p_observacao   text,
  p_analista_id  uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel        nivel_hierarquico;
  v_cargo_uc     uuid;
  v_pesquisa_uc  uuid;
  v_etapa        etapa_pesquisa;
  v_email        text;
  v_numero       text;
BEGIN
  SELECT c.nivel, c.uc_id INTO v_nivel, v_cargo_uc
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT uc_id, etapa, pesquisador_email, numero_processo
  INTO v_pesquisa_uc, v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (
    _is_super_admin()
    OR (v_nivel IN ('gestor_uc','analista_uc') AND v_cargo_uc = v_pesquisa_uc)
    OR v_nivel IN ('chefe_deuc','chefe_debio','secretario')
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
      triagem_observacao  = p_observacao,
      analista_id         = COALESCE(p_analista_id, analista_id)
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'submetida', 'analise_tecnica', auth.uid(), p_observacao);

  ELSIF p_resultado = 'exigencia' THEN
    UPDATE pesquisas SET
      triagem_resultado         = 'exigencia',
      triagem_responsavel       = auth.uid(),
      triagem_em                = now(),
      triagem_observacao        = p_observacao,
      complementacao_solicitada = true,
      complementacao_motivo     = p_observacao
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'submetida', 'submetida', auth.uid(), 'Exigência: ' || p_observacao);

  ELSIF p_resultado = 'rejeitada' THEN
    UPDATE pesquisas SET
      etapa               = 'arquivada',
      triagem_resultado   = 'rejeitada',
      triagem_responsavel = auth.uid(),
      triagem_em          = now(),
      triagem_observacao  = p_observacao
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'submetida', 'arquivada', auth.uid(), 'Rejeitada: ' || p_observacao);
  END IF;

  IF v_email IS NOT NULL THEN
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    VALUES (
      p_pesquisa_id,
      CASE p_resultado
        WHEN 'aprovada'  THEN 'triagem_aprovada'
        WHEN 'exigencia' THEN 'triagem_exigencia'
        WHEN 'rejeitada' THEN 'triagem_rejeitada'
      END,
      v_email,
      '[SIGUC] ' || COALESCE(v_numero,'') || ' — ' || CASE p_resultado
        WHEN 'aprovada'  THEN 'Pesquisa aceita para análise técnica'
        WHEN 'exigencia' THEN 'Documentação complementar necessária'
        WHEN 'rejeitada' THEN 'Pesquisa não aceita'
      END
    );
  END IF;
END;
$$;

-- ─── 4. Patch despachar_analise_tecnica ──────────────────────────────

CREATE OR REPLACE FUNCTION despachar_analise_tecnica(
  p_pesquisa_id  uuid,
  p_favoravel    boolean,
  p_observacao   text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel   nivel_hierarquico;
  v_etapa   etapa_pesquisa;
BEGIN
  SELECT c.nivel INTO v_nivel
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa INTO v_etapa FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (
    _is_super_admin()
    OR EXISTS (SELECT 1 FROM pesquisas WHERE id = p_pesquisa_id AND analista_id = auth.uid())
    OR v_nivel IN ('chefe_deuc','chefe_debio','secretario')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para emitir análise técnica desta pesquisa.';
  END IF;

  IF v_etapa != 'analise_tecnica' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa "Análise Técnica".';
  END IF;

  IF p_favoravel THEN
    UPDATE pesquisas SET etapa = 'parecer_juridico' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_tecnica', 'parecer_juridico', auth.uid(), p_observacao);
  ELSE
    UPDATE pesquisas SET etapa = 'triagem', triagem_resultado = 'pendente' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_tecnica', 'triagem', auth.uid(), 'Devolvido para triagem: ' || p_observacao);
  END IF;
END;
$$;

-- ─── 5. Patch despachar_parecer_dima ────────────────────────────────

CREATE OR REPLACE FUNCTION despachar_parecer_dima(
  p_pesquisa_id uuid,
  p_encaminhar  boolean,
  p_observacao  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel  nivel_hierarquico;
  v_etapa  etapa_pesquisa;
  v_email  text;
  v_numero text;
BEGIN
  SELECT c.nivel INTO v_nivel
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (_is_super_admin() OR v_nivel IN ('diretor','secretario')) THEN
    RAISE EXCEPTION 'Apenas o Diretor da DIMA pode emitir o Parecer DIMA.';
  END IF;

  IF v_etapa != 'parecer_juridico' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa "Parecer DIMA".';
  END IF;

  IF p_encaminhar THEN
    UPDATE pesquisas SET etapa = 'aap_emissao' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'parecer_juridico', 'aap_emissao', auth.uid(), p_observacao);
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    SELECT p_pesquisa_id, 'aviso_secretario', u.email,
           '[SIGUC] ' || COALESCE(v_numero,'') || ' — Aguarda autorização'
    FROM cargos_atuais ca
    JOIN cargos c ON c.id = ca.cargo_id
    JOIN usuarios u ON u.id = ca.responsavel_atual_id
    WHERE c.nivel = 'secretario'
    LIMIT 1;
  ELSE
    UPDATE pesquisas SET etapa = 'analise_tecnica' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'parecer_juridico', 'analise_tecnica', auth.uid(), 'Diligência DIMA: ' || p_observacao);
  END IF;
END;
$$;

-- ─── 6. Patch despachar_autorizacao_secretario ───────────────────────

CREATE OR REPLACE FUNCTION despachar_autorizacao_secretario(
  p_pesquisa_id uuid,
  p_autorizado  boolean,
  p_observacao  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel  nivel_hierarquico;
  v_etapa  etapa_pesquisa;
  v_email  text;
  v_numero text;
BEGIN
  SELECT c.nivel INTO v_nivel
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (_is_super_admin() OR v_nivel = 'secretario') THEN
    RAISE EXCEPTION 'Apenas o Secretário de Estado pode autorizar a pesquisa.';
  END IF;

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
    VALUES (p_pesquisa_id, 'aap_emissao', 'aap_assinatura', auth.uid(), p_observacao);
  ELSE
    UPDATE pesquisas SET etapa = 'arquivada' WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'aap_emissao', 'arquivada', auth.uid(), 'Negado: ' || p_observacao);
    IF v_email IS NOT NULL THEN
      INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
      VALUES (p_pesquisa_id, 'autorizacao_negada', v_email,
              '[SIGUC] ' || COALESCE(v_numero,'') || ' — Pesquisa não autorizada');
    END IF;
  END IF;
END;
$$;

-- ─── 7. Patch despachar_emissao_aap ─────────────────────────────────

CREATE OR REPLACE FUNCTION despachar_emissao_aap(
  p_pesquisa_id    uuid,
  p_validade_dias  int DEFAULT 365,
  p_condicionantes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel    nivel_hierarquico;
  v_etapa    etapa_pesquisa;
  v_seq      int;
  v_ano      text;
  v_aap_num  text;
  v_token    text;
  v_email    text;
  v_numero   text;
BEGIN
  SELECT c.nivel INTO v_nivel
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (_is_super_admin() OR v_nivel IN ('chefe_deuc','chefe_debio','secretario')) THEN
    RAISE EXCEPTION 'Apenas o Chefe do DEUC pode emitir a AAP.';
  END IF;

  IF v_etapa != 'aap_assinatura' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa de Emissão da AAP.';
  END IF;

  v_ano     := to_char(now(), 'YYYY');
  v_seq     := nextval('seq_pesquisa_processo');
  v_aap_num := format('AAP/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));
  v_token   := replace(replace(encode(gen_random_bytes(18), 'base64'), '+', 'A'), '/', 'B');
  v_token   := replace(v_token, '=', '');

  UPDATE pesquisas SET
    etapa          = 'aap_publicada',
    aap_numero     = v_aap_num,
    aap_emitida_em = now(),
    aap_validade   = (now() + (p_validade_dias || ' days')::interval)::date,
    aap_qr_token   = v_token
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'aap_assinatura', 'aap_publicada', auth.uid(),
          'AAP emitida: ' || v_aap_num ||
          CASE WHEN p_condicionantes IS NOT NULL THEN ' | Condicionantes: ' || p_condicionantes ELSE '' END);

  IF v_email IS NOT NULL THEN
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    VALUES (p_pesquisa_id, 'aap_emitida', v_email, '[SIGUC] AAP emitida — ' || v_aap_num);
  END IF;

  RETURN jsonb_build_object('aap_numero', v_aap_num, 'aap_qr_token', v_token);
END;
$$;

-- ─── 8. Patch despachar_entrega_aap ─────────────────────────────────

CREATE OR REPLACE FUNCTION despachar_entrega_aap(
  p_pesquisa_id      uuid,
  p_data_inicio_real date DEFAULT NULL,
  p_observacao       text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel    nivel_hierarquico;
  v_cargo_uc uuid;
  v_pesq_uc  uuid;
  v_etapa    etapa_pesquisa;
BEGIN
  SELECT c.nivel, c.uc_id INTO v_nivel, v_cargo_uc
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, uc_id INTO v_etapa, v_pesq_uc
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (
    _is_super_admin()
    OR (v_nivel IN ('gestor_uc','analista_uc') AND v_cargo_uc = v_pesq_uc)
    OR v_nivel IN ('chefe_deuc','chefe_debio','secretario')
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
  VALUES (p_pesquisa_id, 'aap_publicada', 'em_campo', auth.uid(),
          COALESCE(p_observacao, 'AAP entregue ao pesquisador. Pesquisa iniciada em campo.'));
END;
$$;

-- ─── 9. Patch despachar_fase_simples ────────────────────────────────

CREATE OR REPLACE FUNCTION despachar_fase_simples(
  p_pesquisa_id uuid,
  p_nova_etapa  etapa_pesquisa,
  p_observacao  text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel    nivel_hierarquico;
  v_cargo_uc uuid;
  v_pesq_uc  uuid;
  v_etapa    etapa_pesquisa;
BEGIN
  SELECT c.nivel, c.uc_id INTO v_nivel, v_cargo_uc
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, uc_id INTO v_etapa, v_pesq_uc
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (
    _is_super_admin()
    OR (v_nivel IN ('gestor_uc','analista_uc') AND v_cargo_uc = v_pesq_uc)
    OR v_nivel IN ('chefe_deuc','chefe_debio','diretor','secretario')
    OR EXISTS (SELECT 1 FROM pesquisas WHERE id = p_pesquisa_id AND analista_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Sem permissão para avançar esta etapa.';
  END IF;

  UPDATE pesquisas SET etapa = p_nova_etapa WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, v_etapa, p_nova_etapa, auth.uid(), p_observacao);
END;
$$;

-- ─── 10. Patch despachar_avaliar_relatorio ───────────────────────────

CREATE OR REPLACE FUNCTION despachar_avaliar_relatorio(
  p_pesquisa_id uuid,
  p_aprovado    boolean,
  p_observacao  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel  nivel_hierarquico;
  v_etapa  etapa_pesquisa;
  v_email  text;
  v_numero text;
BEGIN
  SELECT c.nivel INTO v_nivel
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (
    _is_super_admin()
    OR EXISTS (SELECT 1 FROM pesquisas WHERE id = p_pesquisa_id AND analista_id = auth.uid())
    OR v_nivel IN ('chefe_deuc','chefe_debio','secretario')
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
            'Avaliação aprovada. Aguarda homologação. ' || COALESCE(p_observacao,''));
  ELSE
    UPDATE pesquisas SET
      etapa                  = 'relatorio_final',
      relatorio_avaliado_em  = NULL,
      relatorio_avaliado_por = NULL
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_relatorio', 'relatorio_final', auth.uid(),
            'Exigência: ' || p_observacao);
    IF v_email IS NOT NULL THEN
      INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
      VALUES (p_pesquisa_id, 'relatorio_exigencia', v_email,
              '[SIGUC] ' || COALESCE(v_numero,'') || ' — Complementação necessária');
    END IF;
  END IF;
END;
$$;

-- ─── 11. Patch despachar_homologar_relatorio ────────────────────────

CREATE OR REPLACE FUNCTION despachar_homologar_relatorio(
  p_pesquisa_id uuid,
  p_aprovado    boolean,
  p_observacao  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel       nivel_hierarquico;
  v_etapa       etapa_pesquisa;
  v_avaliado_em timestamptz;
  v_email       text;
  v_numero      text;
BEGIN
  SELECT c.nivel INTO v_nivel
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, relatorio_avaliado_em, pesquisador_email, numero_processo
  INTO v_etapa, v_avaliado_em, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (_is_super_admin() OR v_nivel IN ('chefe_deuc','chefe_debio','secretario')) THEN
    RAISE EXCEPTION 'Apenas o Chefe do DEUC pode homologar a avaliação de relatórios.';
  END IF;

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
    VALUES (p_pesquisa_id, 'analise_relatorio', 'encerrada', auth.uid(),
            'Homologado. ' || COALESCE(p_observacao,''));
  ELSE
    UPDATE pesquisas SET
      etapa                  = 'relatorio_final',
      relatorio_avaliado_em  = NULL,
      relatorio_avaliado_por = NULL
    WHERE id = p_pesquisa_id;
    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'analise_relatorio', 'relatorio_final', auth.uid(),
            'Não homologado: ' || p_observacao);
    IF v_email IS NOT NULL THEN
      INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
      VALUES (p_pesquisa_id, 'relatorio_exigencia', v_email,
              '[SIGUC] ' || COALESCE(v_numero,'') || ' — Complementação necessária');
    END IF;
  END IF;
END;
$$;

-- ─── 12. Patch despachar_encerramento ───────────────────────────────

CREATE OR REPLACE FUNCTION despachar_encerramento(
  p_pesquisa_id    uuid,
  p_data_fim_real  date DEFAULT NULL,
  p_observacao     text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel  nivel_hierarquico;
  v_etapa  etapa_pesquisa;
  v_email  text;
  v_numero text;
BEGIN
  SELECT c.nivel INTO v_nivel
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (_is_super_admin() OR v_nivel IN ('chefe_deuc','chefe_debio','secretario')) THEN
    RAISE EXCEPTION 'Apenas o Chefe do DEUC pode encerrar o processo.';
  END IF;

  IF v_etapa != 'encerrada' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa "Encerrada".';
  END IF;

  UPDATE pesquisas SET
    etapa         = 'arquivada',
    data_fim_real = COALESCE(p_data_fim_real, data_fim_real, current_date)
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'encerrada', 'arquivada', auth.uid(),
          COALESCE(p_observacao, 'Processo encerrado e arquivado.'));

  IF v_email IS NOT NULL THEN
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    VALUES (p_pesquisa_id, 'encerrada', v_email,
            '[SIGUC] ' || COALESCE(v_numero,'') || ' — Pesquisa encerrada');
  END IF;
END;
$$;

-- ─── 13. Patch marcar_inadimplencia: adicionar super_admin ───────────

CREATE OR REPLACE FUNCTION marcar_inadimplencia(
  p_pesquisa_id uuid,
  p_motivo      text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT (
    _is_super_admin()
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
               AND perfil IN ('gestor','super_admin','financeiro'))
    OR EXISTS (
      SELECT 1 FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
      WHERE ca.responsavel_atual_id = auth.uid()
        AND c.nivel IN ('chefe_deuc','chefe_debio','diretor','secretario')
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para marcar inadimplência.';
  END IF;

  UPDATE pesquisas
  SET inadimplente         = true,
      inadimplencia_motivo = p_motivo,
      inadimplencia_em     = now()
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  SELECT p_pesquisa_id, etapa, etapa, auth.uid(),
         '⚠ Inadimplente. Motivo: ' || p_motivo
  FROM pesquisas WHERE id = p_pesquisa_id;
END;
$$;
