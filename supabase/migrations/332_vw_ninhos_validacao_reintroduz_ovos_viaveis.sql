-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — reintroduz ovos_viaveis/ovos_perdidos_total
--                          em vw_ninhos_validacao (regressão de drift)
-- ───────────────────────────────────────────────────────────────
-- BUG REAL (produção): a aba "Ninhos abertos" do app não mostrava os
-- ninhos de várias praias (Belém, Balseiro etc.). Causa medida pelos
-- logs do Postgres — a consulta do app quebrava com:
--   ERROR: column vw_ninhos_validacao.ovos_viaveis does not exist
-- O app faz `if (error) throw error` e cai no caminho OFFLINE (cache
-- local, limitado), então praias sem cache local apareciam ZERADAS.
--
-- A migration 131 (vw_ninhos_validacao_ovos_viaveis) já tinha
-- ACRESCENTADO ov.viaveis/ov.perdas_total à view. Mas a 322
-- (antecipacao_eclosao) recriou a view via DROP VIEW partindo de uma
-- base ANTERIOR à 131 — perdeu as duas colunas em produção (mesma
-- classe de drift documentada em vw_praias_biomonitor, mig. 321).
-- As colunas novas da 322 (temp_media_observada,
-- data_prevista_eclosao_ajustada, dias_antecipacao_estimados,
-- contagem_ovos_metodo, qtd_ovos_estimado_original, postura_corrigida_em)
-- ficaram; ovos_viaveis/ovos_perdidos_total sumiram.
--
-- Esta migration reconstrói a view a partir da definição REAL de
-- produção (pg_get_viewdef, não do arquivo local — regra do projeto),
-- ACRESCENTANDO as duas colunas AO FINAL. CREATE OR REPLACE aceita só
-- acrescentar colunas ao final; nada é reordenado nem removido.
-- Fórmula canônica: vw_ninho_ovos (mig. 124), a mesma do mapa/painéis.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_ninhos_validacao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.numero_atual,
  n.especie,
  n.data_encontro,
  n.hora_desova,
  n.status,
  n.status_validacao,
  n.motivo_rejeicao,
  n.observacoes,
  n.foto_urls,
  n.criado_em,
  n.sincronizado_em,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_Y(n.localizacao) END AS lat,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_X(n.localizacao) END AS lng,
  n.precisao_gps_m,
  n.qtd_ovos,
  n.qtd_ovos                   AS ninho_qtd_ovos,
  n.ovos_integros,
  n.ovos_descartados,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'natural'::motivo_descarte)  AS descartados_natural,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'predacao'::motivo_descarte) AS descartados_predacao,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'humana'::motivo_descarte)   AS descartados_humana,
  n.dist_rio_m,
  n.dist_rio_metodo,
  n.temperatura_c,
  n.umidade_pct,
  n.profundidade_cm,
  n.alerta_campo,
  n.temporada_id,
  tmp.nome      AS temporada_nome,
  tmp.ano_base  AS temporada_ano,
  tmp.is_atual  AS temporada_atual,
  p.id          AS praia_id,
  p.nome        AS praia_nome,
  p.codigo      AS praia_codigo,
  n.praia_atual_id,
  pa.nome         AS praia_atual_nome,
  pa.sigla        AS praia_atual_sigla,
  pa.experimental AS praia_atual_experimental,
  uc.nome       AS uc_nome,
  mon.id        AS monitor_id,
  mon.nome_completo AS monitor_nome,
  g.nome        AS grupo_nome,
  g.id          AS grupo_id,
  t.data_transferencia,
  t.qtd_ovos    AS transf_qtd_ovos,
  t.local_destino,
  e.data_nascimento,
  e.filhotes_vivos,
  e.filhotes_mortos,
  e.ovos_nao_nascidos,
  e.predacao,
  n.incubacao_dias_previstos,
  n.data_prevista_eclosao,
  (n.data_prevista_eclosao - CURRENT_DATE) AS dias_para_eclosao,
  n.temp_media_observada,
  n.data_prevista_eclosao_ajustada,
  n.dias_antecipacao_estimados,
  n.contagem_ovos_metodo,
  n.qtd_ovos_estimado_original,
  n.postura_corrigida_em,
  -- Colunas reintroduzidas AO FINAL (fonte canônica: vw_ninho_ovos)
  ov.viaveis      AS ovos_viaveis,
  ov.perdas_total AS ovos_perdidos_total
FROM ninhos_quelonios n
LEFT JOIN temporadas_biomonitor tmp    ON tmp.id = n.temporada_id
LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
LEFT JOIN praias_monitoramento pa      ON pa.id = n.praia_atual_id
LEFT JOIN unidades_conservacao uc      ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
LEFT JOIN grupos_biomonitor g          ON g.id = n.grupo_id
LEFT JOIN vw_ninho_ovos ov             ON ov.ninho_id = n.id
LEFT JOIN LATERAL (
  SELECT data_transferencia, qtd_ovos, local_destino
  FROM transferencias_ninho
  WHERE ninho_id = n.id
  ORDER BY data_transferencia DESC
  LIMIT 1
) t ON true
LEFT JOIN LATERAL (
  SELECT data_nascimento, filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao
  FROM eclosoes_ninho
  WHERE ninho_id = n.id
  ORDER BY data_nascimento DESC
  LIMIT 1
) e ON true;
