-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — RPC de edição do gabarito de laudo
-- Entrega 3 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md.
--
-- `agua_laudo_templates` (migration 304) nasceu só com RLS direta
-- (pode_editar('agua') para INSERT/UPDATE) — sem RPC, porque a
-- Entrega 2 cadastrou o template do QUILAB via migration (305), não
-- pela mesa. Esta entrega dá a UPDATE o mesmo tratamento que
-- `agua_atualizar_ponto`/`agua_atualizar_laboratorio` já têm
-- (migration 270): reautenticação + justificativa — mesmo padrão,
-- pela mesma razão. Alterar o gabarito muda o que o parser PROPÕE
-- para todo lançamento de laudo daquele laboratório dali em diante;
-- é uma mudança de comportamento do sistema, não um cadastro comum.
-- INSERT continua direto (RLS de sempre) — criar um template novo
-- não teve reauth em nenhum cadastro análogo deste módulo.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION agua_atualizar_laudo_template(p_id uuid, p_campos jsonb, p_justificativa text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_permitidas text[] := ARRAY[
    'laboratorio_id','versao','ativo','ancora_texto','campos_identidade','campos'
  ];
  v_col text;
BEGIN
  IF NOT pode_editar('agua') THEN
    RAISE EXCEPTION 'Sem permissão para editar Qualidade da Água.';
  END IF;
  IF NOT agua_reauth_valida(5) THEN
    RAISE EXCEPTION 'REAUTH_NECESSARIA';
  END IF;
  IF char_length(btrim(COALESCE(p_justificativa,''))) < 20 THEN
    RAISE EXCEPTION 'Justificativa precisa de pelo menos 20 caracteres.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agua_laudo_templates WHERE id = p_id) THEN
    RAISE EXCEPTION 'Gabarito não encontrado.';
  END IF;

  FOR v_col IN SELECT jsonb_object_keys(p_campos) LOOP
    IF NOT (v_col = ANY(v_permitidas)) THEN
      RAISE EXCEPTION 'Campo não permitido: %', v_col;
    END IF;
  END LOOP;

  PERFORM set_config('app.justificativa', p_justificativa, true);

  UPDATE agua_laudo_templates t SET (
    laboratorio_id, versao, ativo, ancora_texto, campos_identidade, campos
  ) = (
    SELECT laboratorio_id, versao, ativo, ancora_texto, campos_identidade, campos
    FROM jsonb_populate_record(t, p_campos)
  )
  WHERE t.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION agua_atualizar_laudo_template(uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_atualizar_laudo_template(uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION agua_atualizar_laudo_template(uuid, jsonb, text) TO authenticated;
