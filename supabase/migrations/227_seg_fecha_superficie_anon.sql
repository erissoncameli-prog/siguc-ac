-- 227_seg_fecha_superficie_anon.sql
-- Segurança — fecha a superfície executável por `anon` fora do módulo Frota.
--
-- A Fase 1 do plano do Frota (migrations 196/197) já tinha feito exatamente
-- isto para as funções `frota_*`, e registrou em docs/frota-analise-e-plano.md
-- §8 que "a mesma classe de defeito, módulos diferentes" continuava aberta. É o
-- que esta migration fecha: o advisor do Supabase acusa 125 funções
-- SECURITY DEFINER executáveis por `anon`, e a anon key é pública (vai no
-- frontend), então "executável por anon" = executável por qualquer pessoa na
-- internet, sem login.
--
-- Entre as expostas havia RPCs de AÇÃO, não só de leitura: `zerar_registros_campo`,
-- `promover_registro_a_ocorrencia`, `gestor_vincular_brigada`, `marcar_inadimplencia`,
-- `regularizar_pesquisador`, `avancar_etapa_pesquisa`, os 10 `despachar_*`,
-- `ativar_temporada` / `encerrar_temporada`, `salvar_area_evitada` /
-- `excluir_area_evitada` e as 4 sobrecargas mortas de `submeter_pesquisa_publica`
-- (nenhuma usada pelo frontend — a submissão real passou a exigir conta de
-- pesquisador e usa `submeter_pesquisa_autenticada`).
--
-- ── O que continua aberto para `anon`, e por quê ────────────────────────────
-- Levantado cruzando cada função com quem a chama no frontend. Só ficam as 8
-- que sustentam um fluxo genuinamente sem login:
--   verificar_bloqueio, registrar_tentativa_acesso  → tela de login (index.html),
--       chamadas ANTES de existir sessão
--   verificar_pesquisador_duplicado                 → cadastro-pesquisador.html
--   buscar_pesquisa_por_token, anexar_documento_publico
--                                                   → pesquisa-status.html
--       (acompanhamento por token, sem conta)
--   buscar_aap_por_token                            → validar-aap.html
--       (validação pública da autorização por QR)
--   dof_volume_por_produto, focos_por_ano           → /api/dof-proxy e
--       /api/focos-proxy, que rodam com a anon key. São agregados
--       (produto/ano/volume, ano/contagem) sem dado pessoal.
-- `dof_dentro_uc` e `dof_sem_asv` NÃO entram nessa lista mesmo sendo chamadas
-- pelos mesmos proxies: as duas devolvem `nome_emitente`. O proxy passou a
-- exigir o JWT do chamador nessas duas ações (api/dof-proxy.js, mesma entrega).
--
-- ── Funções de trigger ──────────────────────────────────────────────────────
-- Perdem EXECUTE de `anon` E de `authenticated`: só devem rodar via trigger,
-- nunca por chamada direta do cliente. Mesmo padrão das migrations 165 e 179.
--
-- `authenticated` mantém EXECUTE nas demais RPCs — elas têm guarda interna e
-- são o modo normal de operação do sistema. O aviso correspondente do advisor
-- (`authenticated_security_definer_function_executable`) é informativo.
--
-- Funções pertencentes a extensões (PostGIS etc.) são preservadas: não são
-- nossas e revogá-las quebraria a extensão.
--
-- ⚠️ ARMADILHA (esta migration nasceu errada e foi corrigida pela 228 no banco
-- de produção; o arquivo abaixo já está certo, para não repetir o erro em base
-- nova). O Postgres concede EXECUTE a `PUBLIC` por padrão em toda função nova.
-- `REVOKE ... FROM anon` remove só o grant nominal e deixa o de PUBLIC de pé —
-- `has_function_privilege('anon', …)` continua true e nada muda de fato. Só
-- `REVOKE ... FROM PUBLIC` fecha. E como PUBLIC também é o que dava acesso a
-- `authenticated` em parte das funções, é preciso RECONCEDER explicitamente a
-- `authenticated` e `service_role` no mesmo passo, senão a revogação derruba o
-- sistema inteiro junto. É exatamente a ACL que as 196/197 deixaram nas funções
-- `frota_*`: {postgres=X, authenticated=X, service_role=X}, sem `=X` de PUBLIC.
-- Vale para qualquer REVOKE de função neste projeto.

-- ── 1. Policy de importação esquecida em focos_calor_ac ─────────────────────
-- `focos_import_tmp` é INSERT para `anon` com WITH CHECK (true): qualquer
-- pessoa com a anon key podia inserir linhas ilimitadas na base de focos de
-- calor — envenenamento de dado e crescimento de armazenamento, sem login. O
-- nome ("tmp") indica sobra de uma importação manual; nenhum código do
-- repositório insere nessa tabela (api/focos-proxy.js só lê, via RPC).
DROP POLICY IF EXISTS focos_import_tmp ON public.focos_calor_ac;

-- ── 2. REVOKE em massa ──────────────────────────────────────────────────────
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
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.prorettype = 'pg_catalog.trigger'::regtype AS eh_trigger
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef                       -- só SECURITY DEFINER
       -- nunca mexer em função de extensão (PostGIS, pg_net, btree_gist…)
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_proc'::regclass
                AND d.objid   = p.oid
                AND d.deptype = 'e')
  LOOP
    IF r.eh_trigger THEN
      -- Função de trigger não precisa de EXECUTE para disparar pelo trigger:
      -- o privilégio só governa a chamada direta, que nunca deve acontecer.
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
                     r.proname, r.args);
      v_trigger := v_trigger + 1;
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
                     r.proname, r.args);
      -- PUBLIC era o que sustentava o acesso de parte destas funções:
      -- reconceder é obrigatório, não cosmético.
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
                     r.proname, r.args);
      IF r.proname = ANY (v_permitidas) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', r.proname, r.args);
      ELSE
        v_anon := v_anon + 1;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'REVOKE anon em % RPCs; REVOKE anon+authenticated em % funções de trigger',
               v_anon, v_trigger;
END $$;
