-- ============================================================
-- 361b_prodes_taxa_coletar_nomes.sql
-- Corrige prodes_taxa_coletar (361): a variável de laço se chamava `r`,
-- o mesmo apelido de net._http_response na consulta — o PL/pgSQL lia o
-- apelido como o record ainda vazio e a função falhava em TODA chamada
-- ("record r is not assigned yet"). Achado pelo teste logo após aplicar.
-- O arquivo 361 já está corrigido para bases novas.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prodes_taxa_coletar()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record; j jsonb; melhor jsonb; ano_max int := 0; amax int;
  ref_1988 numeric; dt date; lin record; atual record; n int := 0;
  pendentes int;
BEGIN
  SELECT count(*) INTO pendentes
    FROM prodes_taxa_pedidos pe
    LEFT JOIN net._http_response resp ON resp.id = pe.request_id
   WHERE NOT pe.coletado AND resp.id IS NULL;
  IF pendentes > 0 THEN
    RAISE NOTICE 'prodes_taxa_coletar: % resposta(s) ainda não chegaram', pendentes;
    RETURN 0;
  END IF;

  FOR p IN
    SELECT pe.arquivo, resp.status_code, resp.content
      FROM prodes_taxa_pedidos pe JOIN net._http_response resp ON resp.id = pe.request_id
     WHERE NOT pe.coletado
  LOOP
    CONTINUE WHEN p.status_code IS DISTINCT FROM 200 OR p.content IS NULL;
    -- Nunca converter resposta grande (regra do CLAUDE.md): o arquivo
    -- real tem ~24 KB; acima de 1 MB é outra coisa.
    CONTINUE WHEN length(p.content) > 1000000;
    BEGIN
      j := p.content::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF p.arquivo = 'last_update_date.json' THEN
      BEGIN dt := (j->>'last_date')::date; EXCEPTION WHEN others THEN dt := NULL; END;
    ELSIF jsonb_typeof(j->'periods') = 'array' THEN
      SELECT max((pp->'endDate'->>'year')::int) INTO amax FROM jsonb_array_elements(j->'periods') pp;
      IF amax > ano_max THEN ano_max := amax; melhor := j; END IF;
    END IF;
  END LOOP;

  IF melhor IS NULL THEN
    RAISE NOTICE 'prodes_taxa_coletar: nenhum arquivo de taxas válido';
    RETURN 0;
  END IF;

  -- Trava de identidade do código do Acre.
  SELECT (a->>'area')::numeric INTO ref_1988
    FROM jsonb_array_elements(melhor->'periods') pp,
         jsonb_array_elements(pp->'features') f,
         jsonb_array_elements(f->'areas') a
   WHERE (pp->'endDate'->>'year')::int = 1988 AND f->>'loiname' = '18278' AND (a->>'type') = '1';
  IF ref_1988 IS DISTINCT FROM 620 THEN
    RAISE WARNING 'prodes_taxa_coletar: o código 18278 não parece ser o Acre (1988 = %); nada gravado', ref_1988;
    RETURN 0;
  END IF;

  FOR lin IN
    SELECT (pp->'endDate'->>'year')::int AS ano, (a->>'area')::numeric AS km2
      FROM jsonb_array_elements(melhor->'periods') pp,
           jsonb_array_elements(pp->'features') f,
           jsonb_array_elements(f->'areas') a
     WHERE f->>'loiname' = '18278' AND (a->>'type') = '1'
       AND (pp->'endDate'->>'year')::int >= 2008
  LOOP
    SELECT * INTO atual FROM prodes_taxa_ano WHERE uf = 'AC' AND ano = lin.ano;
    IF NOT FOUND THEN
      INSERT INTO prodes_taxa_ano (uf, ano, km2, tipo, divulgado_em)
      VALUES ('AC', lin.ano, lin.km2,
              CASE WHEN lin.ano = ano_max AND current_date < make_date(lin.ano + 1, 8, 1)
                   THEN 'estimada' ELSE 'consolidada' END,
              dt);
      n := n + 1;
    ELSIF atual.km2 IS DISTINCT FROM lin.km2 THEN
      UPDATE prodes_taxa_ano
         SET km2 = lin.km2,
             km2_estimado = CASE WHEN atual.tipo = 'estimada' THEN atual.km2 ELSE km2_estimado END,
             tipo = 'consolidada', divulgado_em = coalesce(dt, divulgado_em), atualizado_em = now()
       WHERE uf = 'AC' AND ano = lin.ano;
      n := n + 1;
    ELSIF atual.tipo = 'estimada' AND current_date >= make_date(lin.ano + 1, 8, 1) THEN
      UPDATE prodes_taxa_ano SET tipo = 'consolidada', atualizado_em = now()
       WHERE uf = 'AC' AND ano = lin.ano;
      n := n + 1;
    END IF;
  END LOOP;

  UPDATE prodes_taxa_pedidos SET coletado = true WHERE NOT coletado;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_taxa_coletar() FROM PUBLIC, anon, authenticated;
