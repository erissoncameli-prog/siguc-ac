-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — ovos_viaveis em vw_ninhos_validacao
-- ───────────────────────────────────────────────────────────────
-- O card de validação (admin) e o card "Ninhos abertos" (app de
-- campo) recalculavam "ovos viáveis" cada um à sua maneira (ou nem
-- exibiam). A fórmula canônica (postura − Σ descartes) já existe em
-- vw_ninho_ovos (mig. 124), usada pelo mapa e pelos painéis. Esta
-- migration só ACRESCENTA essa mesma fonte à vw_ninhos_validacao,
-- para os dois lugares pararem de duplicar a conta em JS.
-- Aditivo: CREATE OR REPLACE só inclui colunas novas ao final: não
-- remove nem reordena nada (consumido pelo card do app).
-- Depende de 117 (definição vigente) e 124 (vw_ninho_ovos).
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
  -- Fonte canônica de ovos viáveis/perdidos (mesma do mapa e dos painéis)
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
