-- 246_verificar_pesquisador_sem_nome.sql
-- ─────────────────────────────────────────────────────────────
-- ACHADO DE SEGURANÇA (pentest #3): `verificar_pesquisador_duplicado`
-- (SECURITY DEFINER, executável por anon — o portal público
-- pesquisa-publica.html/cadastro-pesquisador.html precisa dela sem
-- login) devolvia o NOME COMPLETO de quem já existe. Isso a transforma
-- num oráculo CPF→nome / e-mail→nome consultável ANONIMAMENTE: um
-- atacante manda um CPF e recebe o nome do titular. Enumeração de PII
-- (a migration 042 já tinha tentado fechar isso revogando anon, mas o
-- GRANT anon voltou como drift — e a checagem pública legitimamente
-- precisa de anon, então a correção certa é parar de vazar o nome, não
-- tirar o anon).
--
-- Correção: a função passa a devolver só {existe, motivo}. Sem nome.
-- O frontend já é defensivo (`dup.nome ? ...`), então some o parêntese
-- com o nome e o resto do fluxo (login/vínculo) segue igual.
--
-- Retorno jsonb inalterado em forma → CREATE OR REPLACE basta (sem
-- mudança de assinatura, sem overload novo). Grants preservados.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.verificar_pesquisador_duplicado(
  p_email text,
  p_cpf   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existe   boolean;
  v_cpf_norm text;
BEGIN
  SELECT true INTO v_existe
    FROM pesquisadores
   WHERE lower(email) = lower(p_email)
   LIMIT 1;
  IF v_existe THEN
    -- Não revela o nome: só confirma existência e o motivo.
    RETURN jsonb_build_object('existe', true, 'motivo', 'email');
  END IF;

  IF p_cpf IS NOT NULL THEN
    v_cpf_norm := regexp_replace(p_cpf, '\D', '', 'g');
    IF length(v_cpf_norm) = 11 THEN
      SELECT true INTO v_existe
        FROM pesquisadores
       WHERE regexp_replace(cpf, '\D', '', 'g') = v_cpf_norm
       LIMIT 1;
      IF v_existe THEN
        RETURN jsonb_build_object('existe', true, 'motivo', 'cpf');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('existe', false);
END;
$function$;
