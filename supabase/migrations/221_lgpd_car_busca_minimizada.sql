-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD — fecha o risco residual da busca do CAR
-- (registrado como "conhecido e não fechado" no RIPD, migration 218)
--
-- O QUE O RIPD TINHA REGISTRADO
-- "A busca por nome/CPF/CNPJ ainda faz leitura direta da tabela: os
-- resultados da lista NÃO exibem CPF/CNPJ na tela, mas a linha
-- completa trafega até o navegador do servidor que fez a busca."
--
-- ACHADO AO INVESTIGAR PARA FECHAR ISSO — é mais sério do que estava
-- registrado. `_consultaCARLocal` (pages/mapa.html) devolvia a linha
-- bruta (`local: r`, com `cpf_cnpj`) dentro de cada resultado. Ao
-- confirmar itens selecionados da busca (`confirmarConsultaCAR`), essa
-- linha bruta é usada para PRÉ-POPULAR `_carDadosLocais` — o mesmo
-- cache que `_buscarDadosLocais` consulta ANTES de chamar
-- `car_consultar_local` (a RPC de log da migration 216). Resultado
-- prático: um imóvel encontrado por busca e depois aberto no mapa
-- tinha o nome/CPF do proprietário exibido no painel de detalhe SEM
-- passar pela RPC — ou seja, sem log. A busca não só trafegava o
-- CPF sem necessidade, como também furava o log da 216 para o
-- caminho mais comum de uso (buscar → selecionar → abrir).
--
-- A CORREÇÃO É MINIMIZAÇÃO, NÃO SÓ LOG (Art. 6º, III da LGPD)
-- Em vez de criar uma RPC que faz a mesma busca E loga cada resultado
-- (o que geraria dezenas de linhas de log por uma busca de nome
-- comum, sem relação com "alguém viu o dado de alguém"), a correção
-- certa é a busca NUNCA devolver `cpf_cnpj` para o cliente. O CPF não
-- é necessário para identificar QUAL resultado escolher — só o nome e
-- o imóvel são. O log continua existindo só onde faz sentido: no
-- momento em que a identidade é de fato revelada (abrir o detalhe de
-- UM imóvel específico), que é exatamente o que car_consultar_local
-- já cobria — a correção do lado do cliente (próxima entrega) garante
-- que esse caminho deixa de ser furado pelo cache pré-populado.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION car_buscar_local(p_tipo text, p_termo text)
RETURNS TABLE (
  cod_imovel text, nom_imovel text, nome_compl text,
  nom_munici text, num_area_i numeric, condicao_i text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT pode_ver('mapa') THEN
    RAISE EXCEPTION 'Sem permissão para consultar dados do CAR';
  END IF;

  IF p_tipo IN ('cpf', 'cnpj') THEN
    RETURN QUERY
      SELECT c.cod_imovel, c.nom_imovel, c.nome_compl, c.nom_munici, c.num_area_i, c.condicao_i
        FROM car_dados_locais c
       WHERE c.cpf_cnpj = p_termo OR c.cpf_cnpj ILIKE '%' || p_termo || '%'
       LIMIT 500;
  ELSE
    RETURN QUERY
      SELECT c.cod_imovel, c.nom_imovel, c.nome_compl, c.nom_munici, c.num_area_i, c.condicao_i
        FROM car_dados_locais c
       WHERE c.nom_imovel ILIKE '%' || p_termo || '%' OR c.nome_compl ILIKE '%' || p_termo || '%'
       LIMIT 500;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION car_buscar_local(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_buscar_local(text, text) TO authenticated;

COMMENT ON FUNCTION car_buscar_local IS
  'Busca de imóvel do CAR por nome/CPF/CNPJ (pages/mapa.html, _consultaCARLocal) sem devolver cpf_cnpj — minimização (Art. 6º, III). Complementa car_consultar_local (migration 216), que segue sendo o único ponto que revela e loga a identidade completa de UM imóvel específico.';
