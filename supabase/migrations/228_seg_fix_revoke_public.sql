-- 228_seg_fix_revoke_public.sql
-- Corrige a 227 no banco de produção.
--
-- A 227 foi aplicada e NÃO produziu efeito: revogou EXECUTE de `anon`, mas o
-- privilégio real vinha do grant que o Postgres dá a `PUBLIC` por padrão em
-- toda função. Depois da 227, a ACL de `zerar_registros_campo` era
-- {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- — sem o `anon=X`, mas com o `=X` de PUBLIC intacto, e portanto
-- `has_function_privilege('anon', …)` seguia true nas 122 funções.
--
-- Mesma família de erro que a 178 (recriar função sem DROP) e a 224 (mudar
-- assinatura sem DROP): a instrução roda, o banco não reclama, e a intenção
-- não se realiza. A verificação depois de aplicar é o que pega — por isso ela
-- vem junto no fim desta migration, com EXCEPTION se a asserção falhar.
--
-- O arquivo da 227 já foi corrigido no repositório para nascer certo em base
-- nova; esta migration existe porque produção já tinha rodado a versão errada.
--
-- Regra geral do projeto, a partir daqui: REVOKE em função é sempre
-- `FROM PUBLIC` (e reconcedendo a `authenticated`/`service_role` no mesmo
-- passo), nunca só `FROM anon`.

DO $$
DECLARE
  r          record;
  v_permitidas constant text[] := ARRAY[
    'verificar_bloqueio',
    'registrar_tentativa_acesso',
    'verificar_pesquisador_duplicado',
    'buscar_pesquisa_por_token',
    'anexar_documento_publico',
    'buscar_aap_por_token',
    'dof_volume_por_produto',
    'focos_por_ano'
  ];
  v_anon     int := 0;
  v_trigger  int := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.prorettype = 'pg_catalog.trigger'::regtype AS eh_trigger
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_proc'::regclass
                AND d.objid   = p.oid
                AND d.deptype = 'e')
  LOOP
    IF r.eh_trigger THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
                     r.proname, r.args);
      v_trigger := v_trigger + 1;
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
                     r.proname, r.args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
                     r.proname, r.args);
      IF r.proname = ANY (v_permitidas) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', r.proname, r.args);
      ELSE
        v_anon := v_anon + 1;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'anon fechado em % RPCs; % funções de trigger sem EXECUTE de cliente',
               v_anon, v_trigger;
END $$;

-- ── Verificação: falha a migration se a intenção não se realizou ────────────
DO $$
DECLARE
  v_anon_sobrando   text[];
  v_trigger_sobrando text[];
  v_auth_perdido    text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT p.proname ORDER BY p.proname), '{}')
    INTO v_anon_sobrando
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname <> ALL (ARRAY['verificar_bloqueio','registrar_tentativa_acesso',
         'verificar_pesquisador_duplicado','buscar_pesquisa_por_token',
         'anexar_documento_publico','buscar_aap_por_token',
         'dof_volume_por_produto','focos_por_ano'])
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e');

  SELECT coalesce(array_agg(DISTINCT p.proname ORDER BY p.proname), '{}')
    INTO v_trigger_sobrando
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND p.prorettype = 'pg_catalog.trigger'::regtype
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e');

  -- a rede de segurança que importa: nenhuma RPC de uso normal pode ter
  -- perdido o acesso de quem está logado
  SELECT coalesce(array_agg(DISTINCT p.proname ORDER BY p.proname), '{}')
    INTO v_auth_perdido
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND p.prorettype <> 'pg_catalog.trigger'::regtype
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e');

  IF array_length(v_anon_sobrando, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'anon ainda executa: %', v_anon_sobrando;
  END IF;
  IF array_length(v_trigger_sobrando, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'função de trigger ainda exposta: %', v_trigger_sobrando;
  END IF;
  IF array_length(v_auth_perdido, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated perdeu acesso: %', v_auth_perdido;
  END IF;

  RAISE NOTICE 'OK — superfície anônima fechada, authenticated intacto';
END $$;
