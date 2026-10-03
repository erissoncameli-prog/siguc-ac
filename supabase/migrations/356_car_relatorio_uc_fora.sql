-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · 356 — Relatório CAR na UC: CARs do mesmo titular FORA da UC
--
-- Pedido do usuário: no agrupamento por titular, mostrar no mapa onde
-- estão TODOS os CARs de quem tem 2+ imóveis na UC — inclusive os de
-- fora dela. Opcional na consulta (caixa desmarcada por padrão), porque
-- registra acesso a mais titulares.
--
-- Recebe a MESMA lista de códigos que car_relatorio_uc_cadastro recebeu
-- e numera os titulares do MESMO jeito (dense_rank pelo menor
-- cod_imovel do grupo) — o titular_grupo devolvido aqui casa com o da
-- relação sem o documento sair do servidor. Só titulares com 2+ imóveis
-- na lista (os que ganham mapa). CPF e CNPJ, sem teto (decisão do
-- usuário): um órgão de assentamento pode devolver milhares de linhas.
-- Uma linha de log LGPD por imóvel devolvido (origem
-- relatorio_car_uc_fora).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION car_relatorio_uc_fora(p_uc_id uuid, p_cod_imoveis text[])
RETURNS TABLE (
  titular_grupo int, cod_imovel text, nom_imovel text, nom_munici text,
  condicao_i text, ind_status text, num_area_i numeric
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

  -- Log e resposta na MESMA instrução (CTE com INSERT): a lista que
  -- vai para o log é exatamente a que volta para a tela.
  RETURN QUERY
  WITH sel AS (
    SELECT c.cod_imovel, nullif(regexp_replace(coalesce(c.cpf_cnpj, ''), '\D', '', 'g'), '') AS doc
      FROM car_dados_locais c
     WHERE c.cod_imovel = ANY (p_cod_imoveis)
  ),
  grupos AS (
    SELECT sel.doc, dense_rank() OVER (ORDER BY min(sel.cod_imovel))::int AS grupo, count(*) AS n
      FROM sel WHERE sel.doc IS NOT NULL GROUP BY sel.doc
  ),
  fora AS (
    SELECT g.grupo, c.cod_imovel, c.cpf_cnpj, c.nom_imovel, c.nom_munici, c.condicao_i, c.ind_status, c.num_area_i
      FROM grupos g
      JOIN car_dados_locais c ON regexp_replace(c.cpf_cnpj, '\D', '', 'g') = g.doc
     WHERE g.n >= 2
       AND NOT (c.cod_imovel = ANY (p_cod_imoveis))
  ),
  log AS (
    INSERT INTO lgpd_acesso_dado_terceiro (tabela, cod_imovel, cpf_cnpj, origem, uc_id)
    SELECT 'car_dados_locais', f.cod_imovel, f.cpf_cnpj, 'relatorio_car_uc_fora', p_uc_id
      FROM fora f
    RETURNING 1
  )
  SELECT f.grupo, f.cod_imovel, f.nom_imovel, f.nom_munici, f.condicao_i, f.ind_status, f.num_area_i
    FROM fora f
   ORDER BY f.grupo, f.cod_imovel;
END;
$$;

REVOKE ALL ON FUNCTION car_relatorio_uc_fora(uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION car_relatorio_uc_fora(uuid, text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION car_relatorio_uc_fora(uuid, text[]) TO authenticated;

COMMENT ON FUNCTION car_relatorio_uc_fora(uuid, text[]) IS
  'Relatório CAR na UC: CARs do mesmo CPF/CNPJ fora da UC, para titulares com 2+ imóveis na lista. titular_grupo casa com car_relatorio_uc_cadastro (mesma numeração). Documento nunca sai do servidor; uma linha de log LGPD por imóvel (origem relatorio_car_uc_fora).';

UPDATE lgpd_tratamentos
   SET observacoes = observacoes || ' Opção "CARs do mesmo titular fora da UC" (migration 356): devolve só nº/imóvel/município/situação/área dos demais CARs do mesmo documento no Acre, para titulares com 2+ imóveis na UC; log por imóvel com origem relatorio_car_uc_fora.'
 WHERE codigo = 'TRAT-013'
   AND observacoes NOT LIKE '%relatorio_car_uc_fora%';
