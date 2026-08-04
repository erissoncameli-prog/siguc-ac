-- 229_seg_search_path_funcoes.sql
-- Segurança — fixa o `search_path` das 46 funções que ainda o tinham mutável
-- (aviso `function_search_path_mutable` do advisor). Pendência registrada em
-- docs/frota-analise-e-plano.md §8 item 1 ("~46 funções de outros módulos com
-- search_path mutável"); a Fase 1 já tinha feito isso nas três funções
-- `frota_*` afetadas.
--
-- Por que importa: sem `search_path` fixo, o Postgres resolve nomes não
-- qualificados usando o `search_path` de QUEM CHAMA — e `pg_temp` entra
-- implicitamente NA FRENTE. Num SECURITY DEFINER isso é escalada de
-- privilégio: basta criar `pg_temp.usuarios` (qualquer usuário pode criar
-- tabela temporária) para que um `SELECT ... FROM usuarios` dentro da função
-- passe a ler a tabela falsa, com os privilégios do dono da função.
--
-- Fixar em `public, pg_temp` — nesta ordem — resolve: os objetos reais em
-- `public` são encontrados primeiro e `pg_temp` deixa de poder sombreá-los.
-- (As funções mais novas do projeto usam `SET search_path TO 'public'`; a
-- diferença é só que aqui `pg_temp` fica explicitamente por último, em vez de
-- implicitamente inacessível — mesmo efeito de segurança, sem surpresa se
-- alguma função de fato precisar de tabela temporária.)
--
-- Só `ALTER FUNCTION`: nenhum corpo de função é recriado, então não há risco
-- de repetir o erro da 181 (recriar a partir de uma versão antiga) nem o da
-- 178/224 (sobrecarga duplicada por mudança de assinatura).
--
-- Conferido antes de aplicar: das 46, nenhuma referencia os schemas
-- `extensions`, `net`, `cron` ou `storage`. Cinco referenciam `auth.` — sempre
-- qualificado (`auth.uid()`), que independe de search_path.

DO $$
DECLARE
  r     record;
  v_n   int := 0;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
                        WHERE c LIKE 'search_path=%')
       -- funções de extensão (PostGIS, pg_net…) não são nossas
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass
                          AND d.objid   = p.oid
                          AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
                   r.proname, r.args);
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'search_path fixado em % funções', v_n;
END $$;

-- ── Verificação ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_sobrando text[];
BEGIN
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname), '{}') INTO v_sobrando
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
                      WHERE c LIKE 'search_path=%')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e');
  IF array_length(v_sobrando, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'ainda sem search_path fixo: %', v_sobrando;
  END IF;
  RAISE NOTICE 'OK — nenhuma função nossa com search_path mutável';
END $$;
