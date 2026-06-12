-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Gestores no app Brigadas de campo
-- Permite que usuários gestor/super_admin entrem no app e
-- escolham a brigada à qual se vincular: a função cria (ou
-- atualiza) a ficha em brigadistas com funcao 'gestor', e todo
-- o restante (RLS de registros_campo, auditoria de sessões,
-- sync offline) passa a funcionar sem alteração.
-- ═══════════════════════════════════════════════════════════

-- Função institucional na brigada (não é vaga operacional)
ALTER TYPE funcao_brigadista ADD VALUE IF NOT EXISTS 'gestor';

-- Fichas criadas automaticamente para gestores não têm CPF
ALTER TABLE brigadistas ALTER COLUMN cpf DROP NOT NULL;

-- Vincula o gestor autenticado à brigada escolhida no app
CREATE OR REPLACE FUNCTION gestor_vincular_brigada(p_brigada_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_usuario usuarios%ROWTYPE;
  v_brig    brigadistas%ROWTYPE;
BEGIN
  SELECT * INTO v_usuario
    FROM usuarios
   WHERE id = auth.uid()
     AND ativo
     AND perfil IN ('gestor', 'super_admin');

  IF v_usuario.id IS NULL THEN
    RAISE EXCEPTION 'Apenas gestores ativos podem escolher a brigada';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM brigadas WHERE id = p_brigada_id AND ativa) THEN
    RAISE EXCEPTION 'Brigada não encontrada ou inativa';
  END IF;

  SELECT * INTO v_brig FROM brigadistas WHERE usuario_id = v_usuario.id LIMIT 1;

  IF v_brig.id IS NULL THEN
    INSERT INTO brigadistas
      (brigada_id, nome_completo, cpf, email, funcao, status, data_inicio, usuario_id)
    VALUES
      (p_brigada_id, v_usuario.nome_completo, NULL, v_usuario.email,
       'gestor', 'ativo', current_date, v_usuario.id)
    RETURNING * INTO v_brig;
  ELSE
    UPDATE brigadistas
       SET brigada_id = p_brigada_id, status = 'ativo'
     WHERE id = v_brig.id
    RETURNING * INTO v_brig;
  END IF;

  RETURN jsonb_build_object(
    'id',            v_brig.id,
    'nome_completo', v_brig.nome_completo,
    'cpf',           v_brig.cpf,
    'brigada_id',    v_brig.brigada_id,
    'funcao',        v_brig.funcao,
    'foto_url',      v_brig.foto_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION gestor_vincular_brigada TO authenticated;
