-- ═══════════════════════════════════════════════════════════
-- 129: Corrige zerar_registros_campo() — pg-safeupdate exige WHERE
-- O DELETE FROM registros_campo; (sem WHERE) era bloqueado pela
-- extensão pg-safeupdate do Supabase com o erro
-- "DELETE requires a WHERE clause", fazendo o botão da Zona de
-- Perigo falhar silenciosamente. Adiciona um WHERE neutro.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION zerar_registros_campo()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil        text;
  v_qtd_registros bigint;
  v_qtd_fauna     bigint;
  v_fotos_paths   text[];
BEGIN
  SELECT perfil INTO v_perfil
  FROM usuarios
  WHERE id = auth.uid() AND ativo;

  IF v_perfil NOT IN ('super_admin') THEN
    RAISE EXCEPTION 'Acesso negado — apenas super_admin pode zerar registros de campo';
  END IF;

  -- Coletar paths de fotos (registros + fauna) antes de deletar
  SELECT array_agg(path ORDER BY path) INTO v_fotos_paths
  FROM (
    SELECT unnest(fotos_urls) AS path
    FROM   registros_campo
    WHERE  fotos_urls IS NOT NULL AND array_length(fotos_urls, 1) > 0

    UNION ALL

    SELECT unnest(fotos_urls) AS path
    FROM   registro_fauna
    WHERE  fotos_urls IS NOT NULL AND array_length(fotos_urls, 1) > 0
  ) t
  WHERE path IS NOT NULL AND path <> '';

  -- Contagens antes de deletar
  SELECT count(*) INTO v_qtd_fauna    FROM registro_fauna;
  SELECT count(*) INTO v_qtd_registros FROM registros_campo;

  -- Deleta (ON DELETE CASCADE cuida de registro_fauna, registro_participantes
  -- e areas_incendio_evitado). WHERE id IS NOT NULL satisfaz o pg-safeupdate.
  DELETE FROM registros_campo WHERE id IS NOT NULL;

  RETURN jsonb_build_object(
    'registros_deletados', v_qtd_registros,
    'fauna_deletada',      v_qtd_fauna,
    'fotos_paths',         coalesce(to_jsonb(v_fotos_paths), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION zerar_registros_campo() TO authenticated;
