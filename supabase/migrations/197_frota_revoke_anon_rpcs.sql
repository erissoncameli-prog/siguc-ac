-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — fecha o resto da superfície anônima
-- (complemento da 196; ainda Fase 1 de docs/frota-analise-e-plano.md)
--
-- A 196 tratou as 3 RPCs de LEITURA que vazavam dado sem nenhuma
-- guarda. Sobraram 16 RPCs de AÇÃO (aprovar, recusar, check-out,
-- check-in, abastecer, validar, reportar defeito…) que continuavam
-- com EXECUTE para PUBLIC/anon.
--
-- Diferente das 3 anteriores, estas NÃO vazam nada: todas já têm
-- guarda interna — `pode_editar('frota')`, `frota_pode_operar_viagem`,
-- ou a exigência de motorista ativo vinculado a auth.uid() — de modo
-- que uma chamada anônima falha com erro de negócio. O problema é
-- outro: sem sessão nenhuma, qualquer pessoa com a anon key (que é
-- pública) consegue INVOCAR as 16 e usar as mensagens de erro como
-- oráculo (existe esta viagem? este uuid já foi usado?), além de
-- gastar recurso do banco. Não há caminho legítimo em que o app
-- chame qualquer uma delas sem estar autenticado.
--
-- Defesa em profundidade: a guarda interna continua sendo a regra de
-- negócio; o REVOKE tira a função do catálogo público do PostgREST
-- para quem não tem sessão. `authenticated` e `service_role` seguem
-- com EXECUTE — nenhuma tela muda de comportamento.
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'frota%'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.assinatura);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated, service_role', r.assinatura);
  END LOOP;
END $$;
