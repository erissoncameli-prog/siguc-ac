-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 024 — Numeração, notificações e limpeza
-- Fase 1 do diagnóstico:
--   A5/M1  Sequências distintas para nº de processo e nº de AAP
--   A5     numero_processo gerado ao aprovar a triagem
--   M4     gestor_uc atribuído + notificação no painel ao submeter
--   A2     Remove o fluxo de AAP morto da migration 013
-- ═══════════════════════════════════════════════════════════

-- ─── M1. Sequências distintas ────────────────────────────────
-- Inicializadas a partir da sequência compartilhada atual para
-- não colidir com números já emitidos.

CREATE SEQUENCE IF NOT EXISTS seq_numero_processo;
CREATE SEQUENCE IF NOT EXISTS seq_aap_numero;

DO $$
DECLARE v_atual bigint;
BEGIN
  SELECT last_value INTO v_atual FROM seq_pesquisa_processo;
  PERFORM setval('seq_numero_processo', GREATEST(v_atual, 1));
  PERFORM setval('seq_aap_numero',      GREATEST(v_atual, 1));
END $$;

-- ─── A5. Submissão pública usa a sequência de processo ───────
-- Também atribui gestor_uc da UC (quando houver) e gera uma
-- notificação de triagem no painel (M4).

CREATE OR REPLACE FUNCTION submeter_pesquisa_publica(
  p_titulo                text,
  p_resumo                text,
  p_tipo                  tipo_pesquisa,
  p_uc_id                 uuid DEFAULT NULL,
  p_data_inicio_prevista  date DEFAULT NULL,
  p_data_fim_prevista     date DEFAULT NULL,
  p_area_ha               numeric DEFAULT NULL,
  p_pesquisador_nome      text DEFAULT NULL,
  p_pesquisador_cpf       text DEFAULT NULL,
  p_pesquisador_email     text DEFAULT NULL,
  p_pesquisador_inst      text DEFAULT NULL,
  p_sisbio_numero         text DEFAULT NULL,
  p_sisgen_numero         text DEFAULT NULL,
  p_coleta_biologica      boolean DEFAULT false,
  p_pesquisa_humanos      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id            uuid;
  v_token         text;
  v_seq           bigint;
  v_ano           text;
  v_numero        text;
  v_gestor        uuid;
BEGIN
  v_token := encode(gen_random_bytes(18), 'base64');
  v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', '');

  v_ano    := to_char(now(), 'YYYY');
  v_seq    := nextval('seq_numero_processo');
  v_numero := format('PESQ/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));

  -- Gestor da UC (se cadastrado) para receber a pesquisa
  IF p_uc_id IS NOT NULL THEN
    SELECT ca.responsavel_atual_id INTO v_gestor
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE c.nivel = 'gestor_uc' AND c.uc_id = p_uc_id
    LIMIT 1;
  END IF;

  INSERT INTO pesquisas (
    numero_processo, titulo, resumo, tipo,
    uc_id, data_inicio_prevista, data_fim_prevista, area_pesquisa_ha,
    pesquisador_nome, pesquisador_cpf, pesquisador_email, pesquisador_instituicao,
    sisbio_numero, sisbio_status,
    sisgen_numero, sisgen_status,
    coleta_biologica, pesquisa_humanos,
    origem, token_publico, etapa, gestor_uc_id
  )
  VALUES (
    v_numero, p_titulo, p_resumo, p_tipo,
    p_uc_id, p_data_inicio_prevista, p_data_fim_prevista, p_area_ha,
    p_pesquisador_nome, p_pesquisador_cpf, p_pesquisador_email, p_pesquisador_inst,
    nullif(p_sisbio_numero,''), CASE WHEN nullif(p_sisbio_numero,'') IS NOT NULL THEN 'pendente'::vinculo_sisbio ELSE 'nao_requerido'::vinculo_sisbio END,
    nullif(p_sisgen_numero,''), CASE WHEN nullif(p_sisgen_numero,'') IS NOT NULL THEN 'pendente'::vinculo_sisbio ELSE 'nao_requerido'::vinculo_sisbio END,
    p_coleta_biologica, p_pesquisa_humanos,
    'portal', v_token, 'submetida', v_gestor
  )
  RETURNING id INTO v_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (v_id, NULL, 'submetida', NULL, 'Submetida pelo pesquisador via portal público.');

  -- E-mail de confirmação (drenado pela edge function)
  INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
  VALUES (v_id, 'submissao', p_pesquisador_email,
          '[SIGUC] Pesquisa ' || v_numero || ' recebida — SEMA/AC');

  -- M4: notificação de triagem no painel do gestor
  IF v_gestor IS NOT NULL THEN
    INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, uc_id, sla_horas, sla_prazo, meta)
    VALUES ('sistema', 'enviada',
            'Nova pesquisa aguarda triagem: ' || p_titulo,
            'Uma nova pesquisa foi submetida pelo portal público e aguarda sua triagem.',
            v_gestor, p_uc_id, 48, now() + interval '48 hours',
            jsonb_build_object('pesquisa_id', v_id, 'etapa', 'submetida'));
  END IF;

  RETURN jsonb_build_object(
    'id',              v_id,
    'numero_processo', v_numero,
    'token_publico',   v_token
  );
END;
$$;

-- ─── A5/M4. Triagem: garante numero_processo e gestor/analista ─
-- Mantém a lógica de despacho da 015 e acrescenta a geração do
-- número de processo (caso ainda nulo) e atribuição de gestor_uc
-- para que as notificações de etapa do painel realmente disparem.

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
  v_gestor       uuid;
BEGIN
  SELECT c.nivel, c.uc_id INTO v_nivel, v_cargo_uc
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT uc_id, etapa, pesquisador_email, numero_processo
  INTO v_pesquisa_uc, v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (
    (v_nivel IN ('gestor_uc','analista_uc') AND v_cargo_uc = v_pesquisa_uc)
    OR v_nivel IN ('chefe_deuc','chefe_debio')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para realizar triagem desta pesquisa.';
  END IF;

  IF v_etapa != 'submetida' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa "Submetida".';
  END IF;

  IF p_resultado = 'aprovada' THEN
    -- Garante número de processo (pesquisas internas podem não ter)
    IF v_numero IS NULL THEN
      v_numero := format('PESQ/SEMA-AC/%s/%s',
                         to_char(now(),'YYYY'),
                         lpad(nextval('seq_numero_processo')::text, 4, '0'));
    END IF;

    -- Gestor padrão da UC para as notificações de etapa
    SELECT ca.responsavel_atual_id INTO v_gestor
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE c.nivel = 'gestor_uc' AND c.uc_id = v_pesquisa_uc LIMIT 1;

    UPDATE pesquisas SET
      etapa               = 'analise_tecnica',
      numero_processo     = v_numero,
      triagem_resultado   = 'aprovada',
      triagem_responsavel = auth.uid(),
      triagem_em          = now(),
      triagem_observacao  = p_observacao,
      analista_id         = COALESCE(p_analista_id, analista_id),
      gestor_uc_id        = COALESCE(gestor_uc_id, v_gestor)
    WHERE id = p_pesquisa_id;

    INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
    VALUES (p_pesquisa_id, 'submetida', 'analise_tecnica', auth.uid(), p_observacao);

  ELSIF p_resultado = 'exigencia' THEN
    UPDATE pesquisas SET
      triagem_resultado          = 'exigencia',
      triagem_responsavel        = auth.uid(),
      triagem_em                 = now(),
      triagem_observacao         = p_observacao,
      complementacao_solicitada  = true,
      complementacao_motivo      = p_observacao
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

-- ─── A2. Remove o fluxo de AAP morto (migration 013) ─────────
-- O frontend usa exclusivamente as funções despachar_* (015).
-- emitir_aap/assinar_aap/publicar_aap nunca eram chamadas e
-- conflitavam semanticamente com o fluxo hierárquico real.

DROP FUNCTION IF EXISTS emitir_aap(uuid, int);
DROP FUNCTION IF EXISTS assinar_aap(uuid);
DROP FUNCTION IF EXISTS publicar_aap(uuid);
