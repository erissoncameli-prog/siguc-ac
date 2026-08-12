-- 245_usuarios_restringir_leitura_APLICAR_APOS_DEPLOY.sql
-- ─────────────────────────────────────────────────────────────
-- ACHADO DE SEGURANÇA (pentest) — parte 2 de 2 (RESTRITIVA).
--
-- ⚠️  NÃO APLICAR JUNTO COM A 244. Esta migration muda o comportamento
--     em produção NO ATO (a RLS é instantânea) e QUEBRA a busca de
--     passageiro para solicitantes não-staff (motorista/visualizador,
--     brigadista) enquanto o frontend antigo — que faz
--     `.from('usuarios').ilike(...)` — ainda estiver no ar ou em cache
--     de PWA. Mesma regra das migrations 200 e 210:
--     aplicar SOMENTE DEPOIS que o deploy do frontend com a chamada à
--     RPC `usuarios_diretorio_buscar` (migration 244) estiver em
--     produção e o cache do service worker do Frota virado (sw v81+).
--
-- O QUE MUDA:
--   Antes: `USING (auth.uid() IS NOT NULL)` — todo autenticado lê a
--          tabela `usuarios` inteira.
--   Depois: leitura direta só de si mesmo OU se o chamador for STAFF
--           interno da SEMA. As telas de mesa que listam pessoal
--           (usuarios.html, estrutura-organizacional, painel-gestor,
--           pesquisas, frota-veiculos, configuracoes→privacidade) são
--           todas de perfil staff, então continuam funcionando. Quem
--           NÃO é staff (motorista=visualizador, brigadista, pesquisador
--           externo, validadores) passa a só se enxergar — e a busca de
--           passageiro deles vai pela RPC da 244.
--
-- STAFF = perfis internos da secretaria. Motorista de campo é
-- 'visualizador' (ver gerar-login-motorista) e por isso visualizador
-- fica FORA do staff — senão o furo continuaria aberto para eles.
--
-- CHECKLIST DE TESTE ANTES DE APLICAR (com o deploy já no ar):
--   [ ] Solicitar viagem como usuário comum → busca de passageiro
--       retorna nomes/telefones (via RPC).
--   [ ] Login mesa como gestor/tecnico → pages/usuarios.html lista todos.
--   [ ] estrutura-organizacional, painel-gestor, pesquisas, frota-veiculos
--       carregam as listas de pessoas.
--   [ ] Login de motorista no frota-app → segue normal (só self + RPC).
-- ─────────────────────────────────────────────────────────────

-- Helper SECURITY DEFINER: descobre se o chamador é staff interno SEM
-- reconsultar `usuarios` sob RLS. Sem isto, uma policy de SELECT em
-- `usuarios` que consulta `usuarios` cai em "infinite recursion detected
-- in policy" (mesma armadilha da migration 050 / is_chefe_brigada). O
-- dono da função ignora a RLS da tabela, quebrando o ciclo.
CREATE OR REPLACE FUNCTION public.usuario_atual_eh_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios s
    WHERE s.id = auth.uid()
      AND s.ativo
      AND s.perfil = ANY (ARRAY[
        'super_admin', 'gestor', 'tecnico', 'financeiro', 'secretario',
        'diretor', 'chefe_departamento', 'gestor_uc', 'assistente_admin',
        'biologo'
      ]::perfil_usuario[])
  );
$function$;

REVOKE ALL ON FUNCTION public.usuario_atual_eh_staff() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.usuario_atual_eh_staff() TO authenticated;

DROP POLICY IF EXISTS usuarios_auth_select ON public.usuarios;

CREATE POLICY usuarios_select_self_or_staff ON public.usuarios
  FOR SELECT
  USING (
    id = auth.uid()
    OR public.usuario_atual_eh_staff()
  );

COMMENT ON POLICY usuarios_select_self_or_staff ON public.usuarios IS
  'Pentest 2025: fecha a leitura ampla de usuarios. Self sempre; staff '
  'interno lê o diretório (telas de mesa). Nao-staff (motorista/'
  'brigadista/externo) só se enxerga; busca de passageiro via RPC '
  'usuarios_diretorio_buscar (migration 244).';
