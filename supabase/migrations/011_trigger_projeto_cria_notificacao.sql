-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 011 — Trigger: projeto criado → notificação automática
-- Projetos criados sem notificacao_id geram notificação para o responsável
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION notificar_novo_projeto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notif_id   uuid;
  v_destinatario uuid;
  v_titulo     text;
  v_mensagem   text;
  v_uc_label   text;
BEGIN
  -- Só age em projetos criados sem notificação já vinculada
  IF NEW.notificacao_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Destinatário = responsável; fallback = quem criou
  v_destinatario := COALESCE(NEW.responsavel_id, NEW.criado_por);
  IF v_destinatario IS NULL THEN
    RETURN NEW;
  END IF;

  v_uc_label := COALESCE(NEW.uc_nome, 'UC não informada');

  v_titulo := 'Novo projeto: ' || NEW.titulo;

  v_mensagem := format(
    'Projeto de análise "%s" criado na %s. Tipo: %s. Acompanhe o andamento e atualize o status conforme a equipe avançar.',
    NEW.titulo,
    v_uc_label,
    NEW.tipo::text
  );

  -- Cria a notificação
  INSERT INTO notificacoes (
    tipo, status, titulo, mensagem,
    destinatario_id, remetente_id,
    uc_id, sla_horas, sla_prazo, meta
  )
  VALUES (
    'sistema', 'enviada', v_titulo, v_mensagem,
    v_destinatario, v_destinatario,
    NEW.uc_id, 72, now() + interval '72 hours',
    jsonb_build_object('origem', 'projeto_mapa', 'projeto_id', NEW.id)
  )
  RETURNING id INTO v_notif_id;

  -- Registra histórico inicial
  INSERT INTO notificacoes_historico (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
  VALUES (v_notif_id, NULL, 'enviada', v_destinatario, 'Gerada automaticamente ao criar projeto no mapa.');

  -- Vincula notificação ao projeto
  NEW.notificacao_id := v_notif_id;

  RETURN NEW;
END;
$$;

-- BEFORE INSERT para poder escrever NEW.notificacao_id
CREATE TRIGGER trigger_projeto_cria_notificacao
  BEFORE INSERT ON projetos_analise
  FOR EACH ROW EXECUTE FUNCTION notificar_novo_projeto();

-- ─── Backfill: projetos existentes sem notificação ────────────

DO $$
DECLARE
  r            RECORD;
  v_notif_id   uuid;
  v_destinatario uuid;
  v_uc_label   text;
  v_titulo     text;
  v_mensagem   text;
BEGIN
  FOR r IN
    SELECT * FROM projetos_analise
    WHERE notificacao_id IS NULL
      AND status <> 'arquivado'
    ORDER BY criado_em
  LOOP
    v_destinatario := COALESCE(r.responsavel_id, r.criado_por);
    IF v_destinatario IS NULL THEN CONTINUE; END IF;

    v_uc_label := COALESCE(r.uc_nome, 'UC não informada');
    v_titulo   := 'Projeto existente: ' || r.titulo;
    v_mensagem := format(
      'Projeto de análise "%s" criado na %s (migrado para o painel). Tipo: %s. Status atual: %s.',
      r.titulo, v_uc_label, r.tipo::text, r.status::text
    );

    INSERT INTO notificacoes (
      tipo, status, titulo, mensagem,
      destinatario_id, remetente_id,
      uc_id, sla_horas, sla_prazo, projeto_id, meta
    )
    VALUES (
      'sistema',
      CASE r.status
        WHEN 'concluido' THEN 'resolvida'
        WHEN 'em_analise' THEN 'em_analise'
        ELSE 'enviada'
      END,
      v_titulo, v_mensagem,
      v_destinatario, v_destinatario,
      r.uc_id, 72,
      CASE WHEN r.status IN ('concluido','arquivado') THEN NULL
           ELSE r.criado_em + interval '72 hours' END,
      r.id,
      jsonb_build_object('origem', 'backfill_011', 'projeto_id', r.id)
    )
    RETURNING id INTO v_notif_id;

    INSERT INTO notificacoes_historico (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
    VALUES (v_notif_id, NULL,
      CASE r.status WHEN 'concluido' THEN 'resolvida' WHEN 'em_analise' THEN 'em_analise' ELSE 'enviada' END,
      v_destinatario, 'Migrado pelo backfill da migration 011.');

    -- Vincula nos dois sentidos
    UPDATE projetos_analise SET notificacao_id = v_notif_id WHERE id = r.id;
    UPDATE notificacoes SET projeto_id = r.id WHERE id = v_notif_id;
  END LOOP;
END;
$$;
