-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — resolve o nome do coletor na view
--
-- ACHADO (não suposição — conferido contra produção antes de mexer,
-- lição repetida deste projeto): `agua_coletas.coletor_nome` é uma
-- coluna de TEXTO LIVRE que nunca foi preenchida por ninguém. Das 453
-- coletas em produção: 450 (série histórica, migration 253) não têm
-- nem `coletor_id` nem `coletor_nome`; as 3 coletas feitas pelo app de
-- campo (Fase 3) têm `coletor_id` preenchido (é `auth.uid()`, migration
-- 248) mas `coletor_nome` = NULL. `vw_agua_coletas_detalhe`
-- (migration 249) sempre expôs `c.coletor_nome` cru — nunca resolveu
-- o nome a partir do `coletor_id` via `usuarios`, então TODO lugar que
-- lê `coletor_nome` (modal de detalhe da coleta, ficha em PDF, e agora
-- a etiqueta do frasco) mostra "—" ou fica em branco para qualquer
-- coleta feita pelo app, desde que a Fase 3 existe.
--
-- CORREÇÃO: `coletor_nome` passa a ser `COALESCE(c.coletor_nome,
-- u.nome_completo)` — texto livre da coluna antiga tem prioridade
-- (preserva qualquer valor que um dia tenha sido digitado à mão, ainda
-- que hoje não exista nenhum), com fallback pro nome resolvido via
-- `usuarios.id = coletor_id`. Nunca o contrário (nunca sobrescrever um
-- texto já gravado).
--
-- SEGURANÇA: a view é `security_invoker = true` (roda com a RLS de
-- quem consulta) — o JOIN novo com `usuarios` não abre nada que não
-- estivesse aberto: a policy `usuarios_auth_select` já libera qualquer
-- autenticado a ler nome/telefone/cargo de qualquer colega (mesmo
-- ponto já registrado no CLAUDE.md, seção de passageiros do Frota).
--
-- Recriada a partir do `pg_get_viewdef()` REAL de produção, não do
-- arquivo de migration 249 local — mesma cautela de sempre neste
-- projeto (achado de drift em `vw_praias_biomonitor`, migration 321):
-- conferir o schema real antes de `CREATE OR REPLACE VIEW` numa view
-- antiga. Conferido: só a expressão de `coletor_nome` muda e um JOIN
-- é acrescentado — a LISTA e ORDEM das colunas de saída são idênticas
-- às de produção, então `CREATE OR REPLACE VIEW` é seguro aqui.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_agua_coletas_detalhe
WITH (security_invoker = true) AS
SELECT
  c.id, c.ponto_id, c.campanha_id, c.laboratorio_id, c.data_coleta, c.hora_coleta,
  c.coletor_id, COALESCE(c.coletor_nome, u.nome_completo) AS coletor_nome,
  c.localizacao, c.foto_url, c.laudo_url,
  c.temp_ar, c.temp_amostra, c.ph, c.od, c.turbidez, c.condutividade_eletrica,
  c.dbo, c.nitrogenio_total, c.nitrogenio_amoniacal, c.nitratos, c.fosforo_total,
  c.ortofosfato_dissolvido, c.solidos_dissolvidos_totais, c.solidos_suspensao_totais,
  c.coliformes_termotolerantes, c.coliformes_totais, c.escherichia_coli,
  c.alcalinidade_total, c.carbono_organico_total, c.cloreto,
  c.condutividade_especifica, c.descarga_liquida, c.censurados,
  c.status, c.quarentena_motivo, c.observacoes, c.linha_origem_planilha,
  c.criado_por, c.criado_em, c.atualizado_em,

  p.codigo_ana, p.nome AS ponto_nome, p.municipio AS ponto_municipio,
  p.rio AS ponto_rio, p.bacia AS ponto_bacia, p.classe_enquadramento, p.uc_id,
  ST_Y(p.geom) AS ponto_lat, ST_X(p.geom) AS ponto_lng,
  ca.ano AS campanha_ano, ca.ordem AS campanha_ordem,
  l.nome AS laboratorio_nome,
  ST_Y(c.localizacao) AS lat, ST_X(c.localizacao) AS lng,
  CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
       THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END AS delta_temperatura,
  (c.temp_ar IS NULL OR c.temp_amostra IS NULL) AS delta_temperatura_neutro,
  agua_od_saturacao(c.od, c.temp_amostra) AS od_saturacao,
  CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
       THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
       ELSE NULL::numeric END AS solidos_totais,
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
  agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total) AS conama_violacoes,
  CASE
    WHEN agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total) IS NULL THEN NULL::boolean
    ELSE cardinality(agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total)) = 0
  END AS conama_conforme,
  c.codigo_amostra, c.excluido_em, c.excluido_por, c.exclusao_justificativa,
  CASE WHEN c.localizacao IS NULL THEN NULL::numeric
       ELSE ST_Distance(c.localizacao::geography, p.geom::geography)::numeric END AS distancia_ponto_metros,
  agua_gps_faixa(
    CASE WHEN c.localizacao IS NULL THEN NULL::numeric
         ELSE ST_Distance(c.localizacao::geography, p.geom::geography)::numeric END
  ) AS gps_confirmacao,
  c.origem_dados, c.data_recebimento_laboratorio,
  c.equipamento_id, eq.nome AS equipamento_nome

FROM agua_coletas c
JOIN agua_pontos_coleta p ON p.id = c.ponto_id
JOIN agua_campanhas ca ON ca.id = c.campanha_id
LEFT JOIN agua_laboratorios l ON l.id = c.laboratorio_id
LEFT JOIN agua_equipamentos eq ON eq.id = c.equipamento_id
LEFT JOIN usuarios u ON u.id = c.coletor_id
WHERE c.excluido_em IS NULL;

COMMENT ON VIEW vw_agua_coletas_detalhe IS
  'View de detalhe de agua_coletas com dados derivados (IQA, CONAMA, GPS, etc.). coletor_nome resolve via usuarios.id=coletor_id quando a coluna de texto livre está vazia (migration 326) — antes ficava sempre NULL para toda coleta do app de campo.';
