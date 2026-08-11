-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Fecha de novo a superfície anônima — regressão da 232
-- + 2 RPCs de notificação que nunca foram fechadas
--
-- Achado ao analisar o advisor de segurança do Supabase (1 erro,
-- 168 avisos). O erro em si (`RLS Disabled in Public` em
-- public.spatial_ref_sys) NÃO é corrigível daqui: a tabela é do
-- PostGIS, pertence a supabase_admin, e `postgres` não é membro —
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` devolve
-- "42501: must be owner of table spatial_ref_sys", e `REVOKE` dos
-- privilégios de escrita de anon/authenticated também não pega
-- (postgres não pode revogar concessão que não fez). Fica como
-- pendência de suporte, documentada no CLAUDE.md.
--
-- Esta migration trata o que É nosso, nos avisos:
--
-- ── 1. Regressão do invariante das 196/197 ─────────────────
-- O CLAUDE.md registra "zero função frota_* SECURITY DEFINER
-- executável por anon" desde a 197. Em produção havia 3:
--   frota_manutencoes_motorista(), frota_manutencao_itens(uuid)
--   e frota_trg_resolver_tarefa().
--
-- CAUSA — vale para toda migration futura deste projeto:
-- `REVOKE ALL ON FUNCTION ... FROM PUBLIC` NÃO BASTA no Supabase.
-- A plataforma tem `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
-- ALL ON FUNCTIONS TO anon, authenticated, service_role`, então toda
-- função nasce com um GRANT **explícito** para anon — revogar de
-- PUBLIC não encosta nele. A 232 usou só `FROM PUBLIC` (e por isso
-- as duas RPCs de manutenção ficaram abertas); a 197 acertou com
-- `FROM PUBLIC, anon`, e a 179 com `FROM PUBLIC, anon, authenticated`.
-- Molde correto: sempre nomear anon (e authenticated, se for função
-- de trigger).
--
-- As duas RPCs de manutenção têm guarda interna (exigem motorista
-- ativo vinculado a auth.uid(), que é NULL para anon), então não
-- vazavam dado — é o mesmo caso da 197: oráculo de erro e consumo de
-- banco por quem tem a anon key, que é pública.
--
-- ── 2. Função de trigger chamável pelo cliente ─────────────
-- frota_trg_resolver_tarefa() é a única função SECURITY DEFINER que
-- retorna trigger ainda com EXECUTE para anon E authenticated —
-- exatamente a classe que as migrations 165 e 179 já fecharam duas
-- vezes. Chamá-la fora de um trigger falha ("trigger functions can
-- only be called as triggers"), mas ela não tem por que estar no
-- catálogo do PostgREST. ⚠ Ela NÃO tem migration no repositório
-- (existe só em produção — drift, como a policy usuarios_auth_select
-- já registrada no CLAUDE.md); por isso o REVOKE é feito em laço
-- sobre o que existe no banco, e não por nome fixo, senão esta
-- migration quebraria numa base criada do zero.
--
-- ── 3. avancar_notificacao / escalar_notificacao ───────────
-- SECURITY DEFINER, sem NENHUMA guarda (não checam auth.uid() nem
-- pode_editar) e com EXECUTE para anon: quem tiver o uuid de uma
-- notificação pode marcá-la 'resolvida' ou encaminhá-la sem sessão —
-- notificacoes_historico.usuario_id é nullable, então a chamada
-- anônima completa em vez de abortar. Todas as telas que as chamam
-- (painel-gestor.html, frota-tarefas.html, frota-app.html) exigem
-- login, então tirar anon não muda comportamento nenhum.
-- ⚠ Isto fecha só o acesso anônimo. A ausência de checagem de
-- permissão para usuário AUTENTICADO continua — qualquer perfil
-- logado pode avançar/escalar qualquer notificação. Corrigir isso é
-- mudança de regra de negócio do Módulo C (Painel do Gestor), não
-- de GRANT, e fica registrada aqui como pendência.
-- ═══════════════════════════════════════════════════════════

-- ── 1+2. Frota: fecha anon em tudo que é SECURITY DEFINER, e fecha
-- também authenticated no que é função de trigger.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS assinatura,
           (t.typname = 'trigger') AS eh_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type t      ON t.oid = p.prorettype
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (
        (p.proname LIKE 'frota%' AND has_function_privilege('anon', p.oid, 'EXECUTE'))
        OR (t.typname = 'trigger'
            AND (has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
      )
  LOOP
    IF r.eh_trigger THEN
      -- Só o trigger a executa, no contexto do dono da tabela.
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
                     r.assinatura);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.assinatura);
      EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated, service_role',
                     r.assinatura);
    END IF;
  END LOOP;
END $$;

-- ── 3. Notificações: tira anon, mantém as telas logadas funcionando.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('avancar_notificacao', 'escalar_notificacao')
      AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.assinatura);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated, service_role',
                   r.assinatura);
  END LOOP;
END $$;
