-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — codigo_amostra na view de detalhe
-- Fase 3 do plano em docs/qualidade-agua/plano.md (app-agua/).
--
-- A migration 257 adicionou `uuid_cliente`/`codigo_amostra` a
-- `agua_coletas`, mas `vw_agua_coletas_detalhe` (migration 249) usa
-- `c.*` para trazer as colunas da coleta — e `SELECT *` numa view é
-- expandido para a lista de colunas NO MOMENTO EM QUE A VIEW É
-- CRIADA, não a cada consulta. Colunas adicionadas depois na tabela
-- base não aparecem na view até ela ser recriada. Achado ao validar a
-- Fase 3: `pages/agua-laudos.html` (que lê da view) nunca veria o
-- código da amostra que o coletor escreveu no app.
--
-- POR QUE NÃO BASTA REPETIR `c.*` — `CREATE OR REPLACE VIEW` só aceita
-- ACRESCENTAR coluna ao FINAL da lista de saída, nunca inserir no meio
-- nem reordenar as existentes. Se `c.*` fosse reexpandido agora, as
-- duas colunas novas cairiam ENTRE `atualizado_em` e `codigo_ana`
-- (posição delas na tabela base) — deslocando todas as colunas
-- seguintes e quebrando o CREATE OR REPLACE. Por isso a lista de
-- `agua_coletas` é enumerada explicitamente aqui (mesma ordem da
-- migration 248), e só `codigo_amostra` é acrescentado, no fim de
-- tudo. `uuid_cliente` fica de fora de propósito: é chave de
-- idempotência do app de campo, sem uso na mesa.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_agua_coletas_detalhe
WITH (security_invoker = true) AS
SELECT
  c.id, c.ponto_id, c.campanha_id, c.laboratorio_id, c.data_coleta, c.hora_coleta,
  c.coletor_id, c.coletor_nome, c.localizacao, c.foto_url, c.laudo_url,
  c.temp_ar, c.temp_amostra, c.ph, c.od, c.turbidez, c.condutividade_eletrica,
  c.dbo, c.nitrogenio_total, c.nitrogenio_amoniacal, c.nitratos, c.fosforo_total,
  c.ortofosfato_dissolvido, c.solidos_dissolvidos_totais, c.solidos_suspensao_totais,
  c.coliformes_termotolerantes, c.coliformes_totais, c.escherichia_coli,
  c.alcalinidade_total, c.carbono_organico_total, c.cloreto,
  c.condutividade_especifica, c.descarga_liquida, c.censurados,
  c.status, c.quarentena_motivo, c.observacoes, c.linha_origem_planilha,
  c.criado_por, c.criado_em, c.atualizado_em,

  p.codigo_ana,
  p.nome            AS ponto_nome,
  p.municipio       AS ponto_municipio,
  p.rio             AS ponto_rio,
  p.bacia           AS ponto_bacia,
  p.classe_enquadramento,
  p.uc_id,
  ST_Y(p.geom)      AS ponto_lat,
  ST_X(p.geom)      AS ponto_lng,

  ca.ano            AS campanha_ano,
  ca.ordem          AS campanha_ordem,

  l.nome            AS laboratorio_nome,

  -- Coordenada do aparelho no momento da coleta (padrão 047/053).
  ST_Y(c.localizacao) AS lat,
  ST_X(c.localizacao) AS lng,

  -- ── Derivados ──
  -- ΔT sai da view, não do banco: a referência decidida é `Temp Ar`,
  -- mas se a SEMA adotar ponto de controle a montante no futuro é
  -- troca de view, não migração de dados (plano, seção do ΔT).
  CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
       THEN abs(c.temp_amostra - c.temp_ar) END AS delta_temperatura,
  -- Marca as coletas que caíram no q neutro. Um gráfico que cruze
  -- essa fronteira de método precisa poder avisar.
  (c.temp_ar IS NULL OR c.temp_amostra IS NULL) AS delta_temperatura_neutro,

  agua_od_saturacao(c.od, c.temp_amostra) AS od_saturacao,

  CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL
         OR c.solidos_suspensao_totais IS NOT NULL
       THEN COALESCE(c.solidos_dissolvidos_totais, 0) + COALESCE(c.solidos_suspensao_totais, 0)
  END AS solidos_totais,

  agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra),
    c.coliformes_termotolerantes,
    c.ph,
    c.dbo,
    c.nitrogenio_total,
    c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL
           OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais, 0) + COALESCE(c.solidos_suspensao_totais, 0)
    END
  ) AS iqa,

  agua_iqa_faixa(agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra),
    c.coliformes_termotolerantes, c.ph, c.dbo, c.nitrogenio_total, c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL
           OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais, 0) + COALESCE(c.solidos_suspensao_totais, 0)
    END
  )) AS iqa_faixa,

  -- Conformidade legal é leitura SEPARADA do índice: um rio pode ter
  -- IQA "Boa" e violar o limite de turbidez. As duas aparecem lado a
  -- lado — o índice para a série histórica, a conformidade para o
  -- papel de fiscalização.
  agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez,
                        c.coliformes_termotolerantes, c.ph, c.fosforo_total) AS conama_violacoes,
  CASE
    WHEN agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez,
                               c.coliformes_termotolerantes, c.ph, c.fosforo_total) IS NULL THEN NULL
    ELSE cardinality(agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez,
                                           c.coliformes_termotolerantes, c.ph, c.fosforo_total)) = 0
  END AS conama_conforme,

  -- ── Acrescentado nesta migration (Fase 3) — só no fim é permitido ──
  c.codigo_amostra

FROM agua_coletas c
JOIN agua_pontos_coleta p ON p.id = c.ponto_id
JOIN agua_campanhas    ca ON ca.id = c.campanha_id
LEFT JOIN agua_laboratorios l ON l.id = c.laboratorio_id;
