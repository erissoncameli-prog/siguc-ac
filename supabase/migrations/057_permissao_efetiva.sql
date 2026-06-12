-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Permissão efetiva (função + view) + RLS do catálogo
-- Fase 1. Fonte única de verdade consumida por RLS e frontend.
-- ═══════════════════════════════════════════════════════════

-- ── Helper: usuário corrente é super_admin? (bypassa RLS) ────
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = auth.uid() AND u.perfil = 'super_admin' AND u.ativo
  );
$$;

-- ── Função central: nível efetivo de um usuário em um módulo ─
-- Resolução: super_admin > override do usuário > padrão perfil/módulo
--            > padrão perfil/grupo > sem_acesso
CREATE OR REPLACE FUNCTION nivel_efetivo(p_usuario uuid, p_modulo_chave text)
RETURNS nivel_acesso
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_perfil   perfil_usuario;
  v_ativo    boolean;
  v_modulo   uuid;
  v_grupo    text;
  v_nivel    nivel_acesso;
BEGIN
  SELECT perfil, ativo INTO v_perfil, v_ativo FROM usuarios WHERE id = p_usuario;
  IF v_perfil IS NULL OR v_ativo IS NOT TRUE THEN
    RETURN 'sem_acesso';
  END IF;

  IF v_perfil = 'super_admin' THEN
    RETURN 'editar';
  END IF;

  SELECT id, grupo INTO v_modulo, v_grupo FROM modulos WHERE chave = p_modulo_chave AND ativo;
  IF v_modulo IS NULL THEN
    RETURN 'sem_acesso';
  END IF;

  -- 1) Override individual
  SELECT nivel INTO v_nivel FROM usuario_permissoes
   WHERE usuario_id = p_usuario AND modulo_id = v_modulo;
  IF FOUND THEN RETURN v_nivel; END IF;

  -- 2) Padrão do perfil para o módulo
  SELECT nivel INTO v_nivel FROM perfil_permissoes_padrao
   WHERE perfil = v_perfil AND modulo_id = v_modulo;
  IF FOUND THEN RETURN v_nivel; END IF;

  -- 3) Padrão do perfil para o grupo
  SELECT nivel INTO v_nivel FROM grupo_permissoes_padrao
   WHERE perfil = v_perfil AND grupo = v_grupo;
  IF FOUND THEN RETURN v_nivel; END IF;

  RETURN 'sem_acesso';
END;
$$;

-- ── Atalhos booleanos para uso em RLS de outras tabelas ─────
CREATE OR REPLACE FUNCTION pode_ver(p_modulo_chave text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT nivel_efetivo(auth.uid(), p_modulo_chave) IN ('visualizar','editar');
$$;

CREATE OR REPLACE FUNCTION pode_editar(p_modulo_chave text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT nivel_efetivo(auth.uid(), p_modulo_chave) = 'editar';
$$;

-- ── VIEW: permissões do usuário corrente (para o frontend) ──
CREATE OR REPLACE VIEW minhas_permissoes AS
SELECT
  m.chave,
  m.nome,
  m.grupo,
  m.icone,
  m.rota,
  m.ordem,
  m.respeita_escopo_uc,
  nivel_efetivo(auth.uid(), m.chave) AS nivel
FROM modulos m
WHERE m.ativo;

-- ════════════════════════════════════════════════════════════
-- RLS das tabelas do catálogo
-- ════════════════════════════════════════════════════════════
ALTER TABLE modulos                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_permissoes_padrao   ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfil_permissoes_padrao  ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_permissoes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_ucs_extras        ENABLE ROW LEVEL SECURITY;

-- modulos: todos autenticados leem; super_admin altera
DROP POLICY IF EXISTS modulos_select ON modulos;
CREATE POLICY modulos_select ON modulos
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS modulos_admin ON modulos;
CREATE POLICY modulos_admin ON modulos
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- padrões (grupo e módulo): leitura autenticada; super_admin altera
DROP POLICY IF EXISTS grupo_pad_select ON grupo_permissoes_padrao;
CREATE POLICY grupo_pad_select ON grupo_permissoes_padrao
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS grupo_pad_admin ON grupo_permissoes_padrao;
CREATE POLICY grupo_pad_admin ON grupo_permissoes_padrao
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS perfil_pad_select ON perfil_permissoes_padrao;
CREATE POLICY perfil_pad_select ON perfil_permissoes_padrao
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS perfil_pad_admin ON perfil_permissoes_padrao;
CREATE POLICY perfil_pad_admin ON perfil_permissoes_padrao
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- overrides por usuário: cada um lê o seu; super_admin lê/altera tudo
DROP POLICY IF EXISTS usuario_perm_self ON usuario_permissoes;
CREATE POLICY usuario_perm_self ON usuario_permissoes
  FOR SELECT USING (usuario_id = auth.uid() OR is_super_admin());
DROP POLICY IF EXISTS usuario_perm_admin ON usuario_permissoes;
CREATE POLICY usuario_perm_admin ON usuario_permissoes
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- UCs extras: cada um lê o seu; super_admin lê/altera tudo
DROP POLICY IF EXISTS ucs_extras_self ON usuario_ucs_extras;
CREATE POLICY ucs_extras_self ON usuario_ucs_extras
  FOR SELECT USING (usuario_id = auth.uid() OR is_super_admin());
DROP POLICY IF EXISTS ucs_extras_admin ON usuario_ucs_extras;
CREATE POLICY ucs_extras_admin ON usuario_ucs_extras
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
