-- 304_bacias_ativar_modulo.sql
--
-- Fase B (Bacias Hidrográficas) ganhou a primeira tela
-- (pages/rh-bacias.html), então o módulo criado inativo pela 303
-- passa a valer para os perfis do catálogo — mesmo passo que a 256 deu
-- para 'agua' quando a mesa da Qualidade da Água nasceu.
--
-- `exige_lotacao` continua FALSE (diferente de 'agua', que está TRUE
-- desde a 281): o painel de bacias é leitura agregada do que a própria
-- SEMA publica no painel público da água — não tem laudo, nem CPF, nem
-- ação de escrita. Restringir ao DERHQA aqui esconderia da diretoria e
-- dos outros departamentos uma visão que é institucional. Se algum dia
-- a tela ganhar edição de cadastro de bacia, reavaliar.
--
-- `grupo` segue 'Gestão' pelo mesmo motivo da 303: é a chave de
-- fallback de permissão (nivel_catalogo_perfil → grupo_permissoes_padrao),
-- não um rótulo de menu.

UPDATE modulos
   SET ativo = true,
       rota  = '../pages/rh-bacias.html',
       atualizado_em = now()
 WHERE chave = 'bacias';

DO $$
DECLARE v_ativo boolean;
BEGIN
  SELECT ativo INTO v_ativo FROM modulos WHERE chave = 'bacias';
  IF v_ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Módulo bacias não ficou ativo — verifique se a migration 303 foi aplicada';
  END IF;
END $$;
