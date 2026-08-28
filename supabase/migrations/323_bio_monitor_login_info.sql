-- 323_bio_monitor_login_info.sql
--
-- Por que existe: a tela de gestão de monitores (pages/admin-biomonitor.html)
-- só mostrava "Com login" / "Sem login" — nunca QUAL e-mail autentica de fato.
-- Isso deixou passar, em silêncio, o caso real que motivou esta migration:
-- um monitor cujo cadastro mostra um e-mail (monitores_biodiversidade.email)
-- enquanto a conta vinculada (usuario_id -> auth.users) tem OUTRO. A pessoa
-- entra no app com o e-mail que a tela mostra, o login funciona (a conta
-- existe, é a de mesa dela), mas bio_monitor_atual() não acha monitor para
-- aquele auth.uid() e o app responde "não vinculado a nenhum grupo".
--
-- auth.users não é legível pelo cliente, então a única forma de mostrar o
-- e-mail real na tela é uma função SECURITY DEFINER com whitelist de colunas
-- (mesma disciplina de agua_publico_coletas, migration 297): nunca expõe
-- senha, metadata ou qualquer outra coluna de auth.users.
--
-- Só devolve dado para quem já administra o módulo (pode_editar('biomonitor')),
-- que é exatamente quem pode gerar login e ver o cadastro completo do monitor.

CREATE OR REPLACE FUNCTION public.bio_monitores_login_info()
RETURNS TABLE (
  monitor_id     uuid,
  email_login    text,
  ultimo_acesso  timestamptz,
  email_cadastro text,
  divergente     boolean,
  conta_de_mesa  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT pode_editar('biomonitor') THEN
    RETURN;   -- sem permissão: lista vazia, nunca erro (a tela degrada sozinha)
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    au.email::text,
    au.last_sign_in_at,
    m.email::text,
    -- divergência que produz o "não vinculado a nenhum grupo" no app
    (m.email IS NOT NULL AND au.email IS NOT NULL
       AND lower(btrim(m.email)) <> lower(au.email))            AS divergente,
    -- a mesma conta também é usuário de mesa? (identidade única, ok)
    (u.id IS NOT NULL)                                          AS conta_de_mesa
  FROM monitores_biodiversidade m
  JOIN auth.users au ON au.id = m.usuario_id
  LEFT JOIN usuarios u ON u.id = m.usuario_id;
END;
$$;

-- ALTER DEFAULT PRIVILEGES do projeto concede EXECUTE a anon por NOME em toda
-- função nova — revogar pelo papel, não confiar em REVOKE FROM PUBLIC.
REVOKE ALL     ON FUNCTION public.bio_monitores_login_info() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bio_monitores_login_info() FROM anon;
GRANT  EXECUTE ON FUNCTION public.bio_monitores_login_info() TO authenticated;
