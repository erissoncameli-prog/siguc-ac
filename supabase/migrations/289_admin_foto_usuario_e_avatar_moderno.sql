-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Foto de perfil — cadastro pelo admin + moldura/menu únicos
--
-- Contexto: a migration 261 já resolve METADE da sincronização — a
-- pessoa trocando a PRÓPRIA foto pelo modal "Meu Perfil" (js/perfil.js)
-- já propaga para brigadistas/frota_motoristas/monitores_biodiversidade
-- via `perfil_atualizar_foto()`. Duas lacunas ficavam:
--
--   a) O CADASTRO/EDIÇÃO de usuário pela administração
--      (pages/usuarios.html, perfil super_admin/gestor) não tinha
--      NENHUM campo de foto — só a própria pessoa podia definir a dela.
--   b) Os 3 apps de campo trocavam a própria foto gravando DIRETO na
--      tabela e no bucket próprios (brigadistas/frota_motoristas/
--      monitores_biodiversidade) — nunca chamavam a RPC de propagação,
--      então a troca ficava presa naquele app só, sem voltar para
--      `usuarios` nem para os outros dois apps.
--
-- (b) não pede migration — é troca de client-side (upload passa a ir
-- para o bucket `avatares/<uid>/…` e chamar `perfil_atualizar_foto`,
-- em vez do bucket/tabela próprios). Esta migration cobre só (a): uma
-- RPC de admin, com o MESMO fan-out, e a permissão de Storage para
-- escrever na pasta de OUTRA pessoa (a auto-escrita já existe desde a
-- 261; só o admin escrevendo no lugar de outro é novo).
--
-- Fan-out compartilhado: extraído para `_perfil_propagar_foto()` em vez
-- de duplicar as 4 UPDATEs em duas funções — mesma lição de
-- js/frota-consumo.js, agora do lado do banco.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Fan-out único, reaproveitado pelas duas RPCs ─────────────
CREATE OR REPLACE FUNCTION _perfil_propagar_foto(p_usuario_id uuid, p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE usuarios SET foto_url = p_url, atualizado_em = now() WHERE id = p_usuario_id;
  UPDATE brigadistas              SET foto_url = p_url WHERE usuario_id = p_usuario_id;
  UPDATE frota_motoristas         SET foto_url = p_url WHERE usuario_id = p_usuario_id;
  UPDATE monitores_biodiversidade SET foto_url = p_url WHERE usuario_id = p_usuario_id;
END;
$$;

-- Função interna: sem GRANT a ninguém além do dono. Só é chamada de
-- dentro de outra função SECURITY DEFINER (que roda como o dono, e o
-- dono sempre pode executar a própria função — não precisa de GRANT
-- explícito para isso).
REVOKE ALL ON FUNCTION _perfil_propagar_foto(uuid, text) FROM PUBLIC, authenticated, anon;

-- perfil_atualizar_foto (261) passa a chamar o fan-out único, sem
-- duplicar as 3 UPDATEs — comportamento e validação continuam iguais.
CREATE OR REPLACE FUNCTION perfil_atualizar_foto(p_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão não autenticada';
  END IF;

  IF p_url IS NOT NULL
     AND p_url !~ ('/storage/v1/object/(public/)?avatares/' || v_uid::text || '/') THEN
    RAISE EXCEPTION 'Endereço de foto inválido para este usuário';
  END IF;

  PERFORM _perfil_propagar_foto(v_uid, p_url);
  RETURN p_url;
END;
$$;

REVOKE EXECUTE ON FUNCTION perfil_atualizar_foto(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION perfil_atualizar_foto(text) TO authenticated;

-- ── 2. RPC de admin — cadastro/edição de OUTRA pessoa ───────────
-- Mesmo espírito da trava de veículo do Frota (migration 180): a tela
-- não manda perfil/uid fora do que pode, e o banco garante que não
-- adianta tentar. Só super_admin/gestor ativos (mesmo alcance de
-- `usuarios_admin_all`, migration 001, e do gate client-side de
-- pages/usuarios.html).
CREATE OR REPLACE FUNCTION admin_atualizar_foto_usuario(p_usuario_id uuid, p_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
BEGIN
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Sessão não autenticada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = v_admin AND u.ativo AND u.perfil IN ('super_admin', 'gestor')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para definir a foto de outro usuário';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_usuario_id) THEN
    RAISE EXCEPTION 'Usuário não encontrado';
  END IF;

  -- Mesma validação de endereço da 261, mas contra a pasta do ALVO,
  -- não de quem chama — o admin sobe o arquivo em avatares/<alvo>/…
  IF p_url IS NOT NULL
     AND p_url !~ ('/storage/v1/object/(public/)?avatares/' || p_usuario_id::text || '/') THEN
    RAISE EXCEPTION 'Endereço de foto inválido para este usuário';
  END IF;

  PERFORM _perfil_propagar_foto(p_usuario_id, p_url);
  RETURN p_url;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_atualizar_foto_usuario(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_atualizar_foto_usuario(uuid, text) TO authenticated;

-- ── 3. Storage — admin escreve na pasta de outra pessoa ─────────
-- As policies avatares_insert/update/delete (261) restringem à PRÓPRIA
-- pasta — correto para o self-service, mas bloqueia o admin subindo a
-- foto de outra pessoa no cadastro. Policies ADITIVAS (RLS é OR entre
-- policies permissivas do mesmo comando): não afrouxa nada, só abre
-- uma segunda porta para quem já é super_admin/gestor.
CREATE OR REPLACE FUNCTION _eh_admin_usuarios()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = auth.uid() AND u.ativo AND u.perfil IN ('super_admin', 'gestor')
  );
$$;
REVOKE ALL ON FUNCTION _eh_admin_usuarios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION _eh_admin_usuarios() TO authenticated;

DROP POLICY IF EXISTS avatares_insert_admin ON storage.objects;
CREATE POLICY avatares_insert_admin ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatares' AND _eh_admin_usuarios());

DROP POLICY IF EXISTS avatares_update_admin ON storage.objects;
CREATE POLICY avatares_update_admin ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatares' AND _eh_admin_usuarios());

DROP POLICY IF EXISTS avatares_delete_admin ON storage.objects;
CREATE POLICY avatares_delete_admin ON storage.objects
  FOR DELETE USING (bucket_id = 'avatares' AND _eh_admin_usuarios());
