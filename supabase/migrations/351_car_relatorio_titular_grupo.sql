-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · 351 — Relatório "CAR na UC": agrupamento de titular
--
-- Pedido do usuário: filtrar quem tem mais de um CAR pelo CPF/CNPJ.
-- O cliente só recebe o documento MASCARADO (migration 350), e a
-- máscara não serve para agrupar: dois CPFs diferentes podem ter os
-- mesmos 6 dígitos do meio. Mandar o número (ou um hash dele) ao
-- navegador desfaria a proteção — o espaço de CPF é pequeno o bastante
-- para qualquer hash fixo ser revertido por força bruta.
--
-- Solução (aceita pelo usuário, 30/09/2026): o BANCO agrupa.
--   • titular_grupo: número 1..N válido só dentro desta chamada,
--     numerado pela ordem do menor cod_imovel do grupo — nunca pela
--     ordem do documento, que vazaria a posição relativa dos CPFs.
--   • titular_cars_estado: quantos CARs o mesmo documento tem no Acre
--     inteiro (só uma contagem).
--   • titular_tipo_doc: 'cpf' | 'cnpj' | null — o cliente só aplica a
--     regra de fracionamento a pessoa física (um CNPJ de órgão, como o
--     do INCRA nos assentamentos, chega a 4.030 imóveis e não é isso).
--
-- A assinatura de entrada não muda, mas o RETURNS TABLE sim: CREATE OR
-- REPLACE não aceita trocar o tipo de retorno (regra do projeto: DROP
-- FUNCTION antes).
-- ═══════════════════════════════════════════════════════════

-- Contagem estadual por documento: índice pela forma só-dígitos.
CREATE INDEX IF NOT EXISTS idx_car_dados_locais_doc_digitos
  ON car_dados_locais ((regexp_replace(cpf_cnpj, '\D', '', 'g')));

DROP FUNCTION IF EXISTS car_relatorio_uc_cadastro(uuid, text[]);

CREATE FUNCTION car_relatorio_uc_cadastro(p_uc_id uuid, p_cod_imoveis text[])
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
  IF coalesce(array_length(p_cod_imoveis, 1), 0) > 5000 THEN
    RAISE EXCEPTION 'Máximo de 5000 imóveis por chamada';
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
    SELECT doc, dense_rank() OVER (ORDER BY min(cod_imovel))::int AS grupo
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

REVOKE EXECUTE ON FUNCTION car_relatorio_uc_cadastro(uuid, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_relatorio_uc_cadastro(uuid, text[]) TO authenticated;

COMMENT ON FUNCTION car_relatorio_uc_cadastro(uuid, text[]) IS
  'Relatório CAR na UC: atributos da planilha SICAR local, CPF/CNPJ mascarado no servidor, um log LGPD por imóvel, e agrupamento de titular feito no banco (titular_grupo válido só nesta chamada + contagem estadual) — o documento nunca sai do servidor, nem como hash.';
