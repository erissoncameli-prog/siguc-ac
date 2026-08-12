-- 244_usuarios_diretorio_rpc.sql
-- ─────────────────────────────────────────────────────────────
-- ACHADO DE SEGURANÇA (pentest) — parte 1 de 2 (ADITIVA, aplicável já).
--
-- A policy `usuarios_auth_select` usa `USING (auth.uid() IS NOT NULL)`:
-- QUALQUER autenticado lê a tabela `usuarios` inteira (nome, e-mail,
-- telefone, cargo, perfil, ultimo_login, bloqueado_ate...). Como o
-- motorista do Frota é criado com `perfil='visualizador'` e o brigadista
-- com `perfil='brigadista'`, um usuário de app de campo consegue extrair
-- o diretório inteiro do pessoal da SEMA (lista pronta de alvo de
-- phishing, mapa de quem é super_admin, etc.) e, via `.select('*')`,
-- também campos internos de segurança.
--
-- A ÚNICA leitura ampla feita por um usuário NÃO-staff é a busca de
-- passageiro (`fpBuscarUsuarios`, js/frota-passageiros.js) — qualquer
-- solicitante procura um nome e recebe o telefone. Esta RPC substitui
-- aquele `.from('usuarios')` direto por um caminho controlado, de campos
-- mínimos, que continua funcionando mesmo depois de a policy da tabela
-- ser restringida (migration 245, aplicar DEPOIS do deploy do frontend).
--
-- Mesma lição das migrations 216/221 (CAR): quando o acesso do cliente
-- precisa ser limitado a colunas/linhas específicas, o caminho é uma
-- função SECURITY DEFINER, não afrouxar a RLS.
-- ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.usuarios_diretorio_buscar(text);

CREATE OR REPLACE FUNCTION public.usuarios_diretorio_buscar(p_termo text)
RETURNS TABLE (id uuid, nome_completo text, telefone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Só responde a partir de 2 caracteres (evita enumeração trivial) e
  -- devolve no máximo 8 linhas de usuários ativos. Nunca expõe e-mail,
  -- perfil ou campos internos — só o necessário para preencher um
  -- passageiro. p_termo é PARÂMETRO (bind), não há injeção; `%`/`_` do
  -- usuário só afetam o casamento do ILIKE.
  SELECT u.id, u.nome_completo, u.telefone
  FROM public.usuarios u
  WHERE u.ativo
    AND length(btrim(p_termo)) >= 2
    AND u.nome_completo ILIKE '%' || btrim(p_termo) || '%'
  ORDER BY u.nome_completo
  LIMIT 8;
$function$;

REVOKE ALL ON FUNCTION public.usuarios_diretorio_buscar(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.usuarios_diretorio_buscar(text) TO authenticated;

COMMENT ON FUNCTION public.usuarios_diretorio_buscar(text) IS
  'Busca de diretório para preenchimento de passageiro (Frota). Campos '
  'mínimos (id/nome/telefone), ativos, >=2 chars, máx 8. Substitui a '
  'leitura direta de usuarios por um solicitante qualquer. Pentest 2025.';
