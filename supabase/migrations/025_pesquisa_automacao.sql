-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 025 — Automação e governança do fluxo
-- Fase 2 do diagnóstico:
--   A4  Emissão de AAP exige SISBIO/SISGEN validados
--   M1  Emissão de AAP usa a sequência própria de AAP
--   M2  Relatórios (parcial/final) criados ao entrar em campo
--   A6  RPC de regularização auditada
--   M3  Verificação automática de prazos vencidos (cron)
-- ═══════════════════════════════════════════════════════════

-- ─── A4 + M1. Emissão da AAP ─────────────────────────────────
-- Mantém a assinatura usada pelo frontend e acrescenta:
--   • sequência própria seq_aap_numero
--   • trava se SISBIO/SISGEN informado não estiver "validado"

CREATE OR REPLACE FUNCTION despachar_emissao_aap(
  p_pesquisa_id    uuid,
  p_validade_dias  int DEFAULT 365,
  p_condicionantes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nivel        nivel_hierarquico;
  v_etapa        etapa_pesquisa;
  v_seq          bigint;
  v_ano          text;
  v_aap_num      text;
  v_token        text;
  v_email        text;
  v_numero       text;
  v_sisbio_num   text;
  v_sisbio_st    vinculo_sisbio;
  v_sisgen_num   text;
  v_sisgen_st    vinculo_sisbio;
BEGIN
  SELECT c.nivel INTO v_nivel
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, pesquisador_email, numero_processo,
         sisbio_numero, sisbio_status, sisgen_numero, sisgen_status
  INTO v_etapa, v_email, v_numero,
       v_sisbio_num, v_sisbio_st, v_sisgen_num, v_sisgen_st
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF v_nivel NOT IN ('chefe_deuc','chefe_debio') THEN
    RAISE EXCEPTION 'Apenas o Chefe do DEUC pode emitir a AAP.';
  END IF;

  IF v_etapa != 'aap_assinatura' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa de Emissão da AAP.';
  END IF;

  -- A4: integração obrigatória quando o número foi informado
  IF v_sisbio_num IS NOT NULL AND v_sisbio_st <> 'validado' THEN
    RAISE EXCEPTION 'SISBIO informado ainda não foi validado. Valide o registro antes de emitir a AAP.';
  END IF;
  IF v_sisgen_num IS NOT NULL AND v_sisgen_st <> 'validado' THEN
    RAISE EXCEPTION 'SISGEN informado ainda não foi validado. Valide o registro antes de emitir a AAP.';
  END IF;

  v_ano    := to_char(now(), 'YYYY');
  v_seq    := nextval('seq_aap_numero');
  v_aap_num := format('AAP/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));
  v_token  := replace(replace(encode(gen_random_bytes(18), 'base64'), '+', 'A'), '/', 'B');
  v_token  := replace(v_token, '=', '');

  UPDATE pesquisas SET
    etapa           = 'aap_publicada',
    aap_numero      = v_aap_num,
    aap_emitida_em  = now(),
    aap_validade    = (now() + (p_validade_dias || ' days')::interval)::date,
    aap_qr_token    = v_token
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'aap_assinatura', 'aap_publicada', auth.uid(),
          'AAP emitida: ' || v_aap_num ||
          CASE WHEN p_condicionantes IS NOT NULL THEN ' | Condicionantes: ' || p_condicionantes ELSE '' END);

  IF v_email IS NOT NULL THEN
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    VALUES (p_pesquisa_id, 'aap_emitida', v_email,
            '[SIGUC] AAP emitida — ' || v_aap_num);
  END IF;

  RETURN jsonb_build_object('aap_numero', v_aap_num, 'aap_qr_token', v_token);
END;
$$;

-- ─── M2. Entrega da AAP cria os relatórios esperados ─────────
-- Ao iniciar em campo, gera os registros de relatório parcial
-- (semestral) e final com prazos, permitindo cobrança e SLA.

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
  v_inicio   date;
  v_fim      date;
BEGIN
  SELECT c.nivel, c.uc_id INTO v_nivel, v_cargo_uc
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, uc_id, COALESCE(p_data_inicio_real, data_inicio_real, current_date), data_fim_prevista
  INTO v_etapa, v_pesq_uc, v_inicio, v_fim
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT (
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
    data_inicio_real = v_inicio
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'aap_publicada', 'em_campo', auth.uid(),
          COALESCE(p_observacao, 'AAP entregue ao pesquisador. Pesquisa iniciada em campo.'));

  -- M2: cria relatórios esperados (apenas se ainda não existirem)
  IF NOT EXISTS (SELECT 1 FROM pesquisa_relatorios WHERE pesquisa_id = p_pesquisa_id AND tipo = 'parcial') THEN
    INSERT INTO pesquisa_relatorios (pesquisa_id, tipo, status, periodo_ref, prazo)
    VALUES (p_pesquisa_id, 'parcial', 'pendente',
            '1º relatório semestral',
            v_inicio + interval '6 months');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pesquisa_relatorios WHERE pesquisa_id = p_pesquisa_id AND tipo = 'final') THEN
    INSERT INTO pesquisa_relatorios (pesquisa_id, tipo, status, periodo_ref, prazo)
    VALUES (p_pesquisa_id, 'final', 'pendente',
            'Relatório final',
            COALESCE(v_fim, v_inicio + interval '12 months'));
  END IF;
END;
$$;

-- ─── A6. Regularização auditada ──────────────────────────────
-- Substitui o UPDATE direto que o frontend fazia (sem auditoria).

CREATE OR REPLACE FUNCTION regularizar_pesquisador(
  p_pesquisa_id uuid,
  p_observacao  text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_perm boolean;
BEGIN
  v_perm := EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
                      AND perfil IN ('gestor','super_admin','financeiro'))
         OR EXISTS (SELECT 1 FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
                      WHERE ca.responsavel_atual_id = auth.uid()
                        AND c.nivel IN ('chefe_deuc','chefe_debio','diretor','secretario'));
  IF NOT v_perm THEN
    RAISE EXCEPTION 'Sem permissão para regularizar pesquisador.';
  END IF;

  UPDATE pesquisas SET
    inadimplente         = false,
    inadimplencia_motivo = NULL,
    inadimplencia_em     = NULL
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  SELECT p_pesquisa_id, etapa, etapa, auth.uid(),
         '✔ Pesquisador regularizado.' || COALESCE(' ' || p_observacao, '')
  FROM pesquisas WHERE id = p_pesquisa_id;
END;
$$;

-- ─── M3. Verificação automática de prazos vencidos ───────────
-- Marca inadimplência por relatório ou complementação vencidos.
-- Idempotente: só marca quem ainda não está inadimplente.

CREATE OR REPLACE FUNCTION verificar_prazos_pesquisa()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_marcados int := 0;
  v_tmp      int;
BEGIN
  -- Relatórios pendentes vencidos
  WITH alvo AS (
    SELECT DISTINCT r.pesquisa_id, r.tipo
    FROM pesquisa_relatorios r
    JOIN pesquisas p ON p.id = r.pesquisa_id
    WHERE r.status = 'pendente'
      AND r.prazo < current_date
      AND p.inadimplente = false
      AND p.etapa NOT IN ('encerrada','arquivada')
  ),
  upd AS (
    UPDATE pesquisas p SET
      inadimplente         = true,
      inadimplencia_motivo = 'Relatório ' || a.tipo || ' vencido em ' ||
                             to_char((SELECT min(prazo) FROM pesquisa_relatorios
                                      WHERE pesquisa_id = p.id AND status='pendente'),'DD/MM/YYYY'),
      inadimplencia_em     = now()
    FROM alvo a
    WHERE p.id = a.pesquisa_id
    RETURNING p.id
  )
  SELECT count(*) INTO v_tmp FROM upd;
  v_marcados := v_marcados + COALESCE(v_tmp,0);

  -- Complementação vencida
  WITH upd2 AS (
    UPDATE pesquisas SET
      inadimplente         = true,
      inadimplencia_motivo = 'Complementação não atendida no prazo (' ||
                             to_char(complementacao_prazo,'DD/MM/YYYY') || ')',
      inadimplencia_em     = now()
    WHERE complementacao_solicitada = true
      AND complementacao_prazo < current_date
      AND inadimplente = false
      AND etapa NOT IN ('encerrada','arquivada')
    RETURNING id
  )
  SELECT count(*) INTO v_tmp FROM upd2;
  v_marcados := v_marcados + COALESCE(v_tmp,0);

  -- Histórico das novas inadimplências (marcadas nos últimos segundos)
  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  SELECT id, etapa, etapa, NULL, '⚠ Inadimplência automática: ' || inadimplencia_motivo
  FROM pesquisas
  WHERE inadimplente = true AND inadimplencia_em > now() - interval '5 seconds';

  RETURN jsonb_build_object('marcados', v_marcados, 'executado_em', now());
END;
$$;

-- Agendamento diário (06h BRT = 09h UTC) se pg_cron estiver disponível.
-- Caso contrário, chame verificar_prazos_pesquisa() por cron externo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'verificar_prazos_pesquisa',
      '0 9 * * *',
      $cron$SELECT verificar_prazos_pesquisa();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponível — agende verificar_prazos_pesquisa() externamente.';
END $$;
