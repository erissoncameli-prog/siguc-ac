-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — auto-resolver "Minhas Tarefas" quando a ação
-- real acontece
--
-- "Minhas Tarefas" (frota-tarefas.html mesa + frota-app.html) não é
-- uma tabela própria: é a `notificacoes` genérica (009) filtrada por
-- tipo='frota'. Toda notificação de pendência (viagem solicitada,
-- abastecimento pendente/SLA atrasado, defeito reportado) SÓ saía da
-- lista se um humano clicasse manualmente em "Concluir"
-- (avancar_notificacao) em frota-tarefas.html — nenhuma das RPCs que
-- de fato decidem o item (frota_aprovar_viagem, frota_recusar_viagem,
-- frota_validar_abastecimento, frota_rejeitar_abastecimento) nem o
-- UPDATE direto de frota-manutencao.html ao tratar um comunicado de
-- defeito tocavam `notificacoes`. Resultado relatado: abastecimento
-- já validado continua aparecendo como tarefa pendente.
--
-- Em vez de caçar e editar cada RPC (frágil — qualquer fluxo novo
-- reintroduz o bug), a solução é um TRIGGER genérico nas 3 tabelas
-- que originam tarefa de decisão (frota_viagens, frota_abastecimentos,
-- frota_comunicados_manutencao): toda vez que o status da linha muda,
-- resolve automaticamente qualquer notificação `tipo='frota'` ainda
-- não resolvida cujo `meta` referencie aquele id — cobre o id gravado
-- sob QUALQUER chave (viagem_id, comunicado_id, ref_id da 207/SLA),
-- sem precisar mapear subtipo por subtipo.
-- ═══════════════════════════════════════════════════════════

-- ── Resolver genérico: toda notificação de frota que referencia o id ──
CREATE OR REPLACE FUNCTION frota_resolver_notificacoes_tarefa(p_ref_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF p_ref_id IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT id, status FROM notificacoes
     WHERE tipo = 'frota' AND status <> 'resolvida'
       AND EXISTS (
         SELECT 1 FROM jsonb_each_text(meta) kv WHERE kv.value = p_ref_id::text
       )
     FOR UPDATE
  LOOP
    UPDATE notificacoes SET status = 'resolvida', resolvido_em = now() WHERE id = r.id;
    INSERT INTO notificacoes_historico (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
    VALUES (r.id, r.status, 'resolvida', auth.uid(), 'Resolvida automaticamente — item decidido');
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION frota_resolver_notificacoes_tarefa(uuid) FROM PUBLIC, anon, authenticated;

-- ── Triggers: qualquer mudança de status na origem resolve a tarefa ──
CREATE OR REPLACE FUNCTION frota_trg_resolver_tarefa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM frota_resolver_notificacoes_tarefa(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frota_viagens_resolver_tarefa ON frota_viagens;
CREATE TRIGGER trg_frota_viagens_resolver_tarefa
  AFTER UPDATE OF status ON frota_viagens
  FOR EACH ROW EXECUTE FUNCTION frota_trg_resolver_tarefa();

DROP TRIGGER IF EXISTS trg_frota_abastecimentos_resolver_tarefa ON frota_abastecimentos;
CREATE TRIGGER trg_frota_abastecimentos_resolver_tarefa
  AFTER UPDATE OF status ON frota_abastecimentos
  FOR EACH ROW EXECUTE FUNCTION frota_trg_resolver_tarefa();

DROP TRIGGER IF EXISTS trg_frota_comunicados_resolver_tarefa ON frota_comunicados_manutencao;
CREATE TRIGGER trg_frota_comunicados_resolver_tarefa
  AFTER UPDATE OF status ON frota_comunicados_manutencao
  FOR EACH ROW EXECUTE FUNCTION frota_trg_resolver_tarefa();

-- ── Backfill: tarefas já órfãs (item decidido, notificação parada) ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM frota_viagens WHERE status <> 'solicitada' LOOP
    PERFORM frota_resolver_notificacoes_tarefa(r.id);
  END LOOP;
  FOR r IN SELECT id FROM frota_abastecimentos WHERE status <> 'pendente' LOOP
    PERFORM frota_resolver_notificacoes_tarefa(r.id);
  END LOOP;
  FOR r IN SELECT id FROM frota_comunicados_manutencao WHERE status <> 'pendente' LOOP
    PERFORM frota_resolver_notificacoes_tarefa(r.id);
  END LOOP;
END $$;
