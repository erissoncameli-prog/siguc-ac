-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 036 — Melhorias auth do pesquisador
-- Auto-confirmar e-mail + detecção de duplicatas
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Auto-confirmar e-mail em novos cadastros ─────────
-- Desabilita a necessidade de confirmação de e-mail para todos
-- os novos usuários (tanto pesquisadores quanto internos se
-- adicionados via portal). Usuários internos são criados pelo
-- admin e nunca passam por este fluxo de confirmação.

CREATE OR REPLACE FUNCTION auth.auto_confirm_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth
AS $$
BEGIN
  NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_auto_confirm
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION auth.auto_confirm_email();

-- ─── 2. Verificar duplicata de pesquisador (anon acessível) ─
-- Usada no cadastro antes do signUp para evitar contas duplicadas.

CREATE OR REPLACE FUNCTION verificar_pesquisador_duplicado(
  p_email text,
  p_cpf   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existente pesquisadores%ROWTYPE;
  v_cpf_norm  text;
BEGIN
  -- Checar por e-mail (case-insensitive)
  SELECT * INTO v_existente
    FROM pesquisadores
   WHERE lower(email) = lower(p_email)
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'existe', true, 'motivo', 'email', 'nome', v_existente.nome_completo
    );
  END IF;

  -- Checar por CPF (somente dígitos)
  IF p_cpf IS NOT NULL THEN
    v_cpf_norm := regexp_replace(p_cpf, '\D', '', 'g');
    IF length(v_cpf_norm) = 11 THEN
      SELECT * INTO v_existente
        FROM pesquisadores
       WHERE regexp_replace(cpf, '\D', '', 'g') = v_cpf_norm
       LIMIT 1;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'existe', true, 'motivo', 'cpf', 'nome', v_existente.nome_completo
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('existe', false);
END;
$$;

GRANT EXECUTE ON FUNCTION verificar_pesquisador_duplicado TO anon, authenticated;
