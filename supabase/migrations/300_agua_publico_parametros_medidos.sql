-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — parâmetros medidos no painel público
--
-- Pedido do usuário: clicar num ponto do mapa (painel de mesa e
-- público) abre um popup de detalhe da coleta mais recente, com
-- opção de exportar a ficha em PDF. Sem os ~21 parâmetros medidos
-- (pH, turbidez, OD...), o popup só repetiria IQA/CONAMA que o mapa
-- já mostra — sem valor nenhum a mais.
--
-- DECISÃO (confirmada com o usuário antes de codar): os parâmetros
-- medidos são DADO AMBIENTAL, mesma categoria do que já é público
-- (IQA, faixa, conformidade CONAMA) — não dado pessoal. Continuam de
-- fora, sem mudança nenhuma: coletor_id/coletor_nome/criado_por,
-- localizacao/lat/lng do aparelho/gps_confirmacao, foto_url/laudo_url/
-- observacoes/quarentena_motivo, linha_origem_planilha, laboratorio_id,
-- hora_coleta, codigo_amostra. `agua_publico_coletas()` continua
-- SECURITY DEFINER com lista EXPLÍCITA de colunas — cresce a lista,
-- não vira `SELECT *` nem passa a ler a view interna.
--
-- classe_enquadramento entra junto (contexto necessário para o popup
-- explicar "Classe 2" ao lado da conformidade CONAMA — mesmo texto
-- que a tela de mesa já mostra em vw_agua_coletas_detalhe).
-- CREATE OR REPLACE não aceita mudar a lista de colunas do RETURNS
-- TABLE (mesma lição da 178/224/173) — DROP explícito antes.
DROP FUNCTION IF EXISTS agua_publico_coletas();

CREATE FUNCTION agua_publico_coletas()
RETURNS TABLE (
  ponto_id        uuid,
  ponto_nome      text,
  codigo_ana      text,
  ponto_municipio text,
  ponto_rio       text,
  ponto_bacia     text,
  classe_enquadramento classe_enquadramento_agua,
  campanha_id     uuid,
  campanha_ano    int,
  campanha_ordem  ordem_campanha_agua,
  data_coleta     date,
  status          status_coleta_agua,
  iqa             numeric,
  iqa_faixa       text,
  conama_violacoes text[],
  temp_ar                     numeric,
  temp_amostra                numeric,
  ph                          numeric,
  od                          numeric,
  turbidez                    numeric,
  condutividade_eletrica      numeric,
  dbo                         numeric,
  nitrogenio_total            numeric,
  nitrogenio_amoniacal        numeric,
  nitratos                    numeric,
  fosforo_total               numeric,
  ortofosfato_dissolvido      numeric,
  solidos_dissolvidos_totais  numeric,
  solidos_suspensao_totais    numeric,
  coliformes_termotolerantes  numeric,
  coliformes_totais           numeric,
  escherichia_coli            numeric,
  alcalinidade_total          numeric,
  carbono_organico_total      numeric,
  cloreto                     numeric,
  condutividade_especifica    numeric,
  descarga_liquida            numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id, p.nome, p.codigo_ana, p.municipio, p.rio, p.bacia, p.classe_enquadramento,
    c.campanha_id, ca.ano, ca.ordem,
    c.data_coleta, c.status,
    agua_calcular_iqa(
      agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
      c.nitrogenio_total, c.fosforo_total,
      CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
           THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
      c.turbidez,
      CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
           THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
           ELSE NULL::numeric END
    ) AS iqa,
    agua_iqa_faixa(agua_calcular_iqa(
      agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
      c.nitrogenio_total, c.fosforo_total,
      CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
           THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
      c.turbidez,
      CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
           THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
           ELSE NULL::numeric END
    )) AS iqa_faixa,
    agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez,
                           c.coliformes_termotolerantes, c.ph, c.fosforo_total) AS conama_violacoes,
    c.temp_ar, c.temp_amostra, c.ph, c.od, c.turbidez, c.condutividade_eletrica,
    c.dbo, c.nitrogenio_total, c.nitrogenio_amoniacal, c.nitratos, c.fosforo_total,
    c.ortofosfato_dissolvido, c.solidos_dissolvidos_totais, c.solidos_suspensao_totais,
    c.coliformes_termotolerantes, c.coliformes_totais, c.escherichia_coli,
    c.alcalinidade_total, c.carbono_organico_total, c.cloreto,
    c.condutividade_especifica, c.descarga_liquida
  FROM agua_coletas c
  JOIN agua_pontos_coleta p ON p.id = c.ponto_id
  JOIN agua_campanhas    ca ON ca.id = c.campanha_id
  WHERE c.excluido_em IS NULL AND p.ativo = true
  ORDER BY c.data_coleta;
$$;

COMMENT ON FUNCTION agua_publico_coletas() IS
  'Painel público da Qualidade da Água (pages/agua-publico.html, sem login). Ganhou os ~21 parâmetros medidos + classe de enquadramento (migration 300, dado ambiental) para o popup de detalhe do ponto no mapa — segue sem coletor/GPS do aparelho/foto/laudo/observações/hora/código da amostra (ausência de coluna, nunca WHERE escondendo). IQA e CONAMA calculados pelas MESMAS funções da view interna, nunca reimplementados.';

REVOKE ALL ON FUNCTION agua_publico_coletas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agua_publico_coletas() TO anon, authenticated;
