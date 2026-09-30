-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · 351c — car_relatorio_uc_cadastro aceita até 10.000 imóveis
--
-- O agrupamento de titular (351) numera os grupos DENTRO de uma
-- chamada, então a lista do relatório tem de ir inteira numa chamada
-- só — em lotes, cada lote teria o seu "Titular 1" e o mesmo CPF
-- ganharia números diferentes. O teto de 5.000 da 350 cortaria uma UC
-- grande; medido: 3.000 imóveis em 1,5 s (timeout do authenticated é
-- 8 s). O cliente recusa acima de 10.000 com mensagem, nunca em lotes.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION car_relatorio_uc_cadastro(p_uc_id uuid, p_cod_imoveis text[])
RETURNS TABLE (
  cod_imovel text, nom_imovel text, nome_compl text, cpf_cnpj_mascarado text,
  num_area_i numeric, num_modulo numeric, nom_munici text, ind_status text,
  condicao_i text, nome_class text, tipo_docum text, nome_docum text,
  dat_criaca date,
  titular_grupo int, titular_cars_estado int, titular_tipo_doc text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT pode_ver('monitoramento') THEN
    RAISE EXCEPTION 'Sem permissão para gerar o relatório de CAR';
  END IF;
  IF p_uc_id IS NULL OR NOT EXISTS (SELECT 1 FROM unidades_conservacao WHERE id = p_uc_id) THEN
    RAISE EXCEPTION 'UC inválida';
  END IF;
  IF coalesce(array_length(p_cod_imoveis, 1), 0) > 10000 THEN
    RAISE EXCEPTION 'Máximo de 10000 imóveis por chamada';
  END IF;

  INSERT INTO lgpd_acesso_dado_terceiro (tabela, cod_imovel, cpf_cnpj, origem, uc_id)
  SELECT 'car_dados_locais', c.cod_imovel, c.cpf_cnpj, 'relatorio_car_uc', p_uc_id
    FROM car_dados_locais c
   WHERE c.cod_imovel = ANY (p_cod_imoveis);

  RETURN QUERY
  WITH sel AS (
    SELECT c.*, nullif(regexp_replace(coalesce(c.cpf_cnpj, ''), '\D', '', 'g'), '') AS doc
      FROM car_dados_locais c
     WHERE c.cod_imovel = ANY (p_cod_imoveis)
  ),
  grupos AS (
    SELECT doc, dense_rank() OVER (ORDER BY min(sel.cod_imovel))::int AS grupo
      FROM sel WHERE doc IS NOT NULL GROUP BY doc
  ),
  estado AS (
    SELECT regexp_replace(c.cpf_cnpj, '\D', '', 'g') AS doc, count(*)::int AS n
      FROM car_dados_locais c
     WHERE regexp_replace(c.cpf_cnpj, '\D', '', 'g') IN (SELECT doc FROM grupos)
     GROUP BY 1
  )
  SELECT s.cod_imovel, s.nom_imovel, s.nome_compl, car_mascarar_documento(s.cpf_cnpj),
         s.num_area_i, s.num_modulo, s.nom_munici, s.ind_status,
         s.condicao_i, s.nome_class, s.tipo_docum, s.nome_docum, s.dat_criaca,
         g.grupo, e.n,
         CASE length(s.doc) WHEN 11 THEN 'cpf' WHEN 14 THEN 'cnpj' END
    FROM sel s
    LEFT JOIN grupos g ON g.doc = s.doc
    LEFT JOIN estado e ON e.doc = s.doc;
END;
$$;

