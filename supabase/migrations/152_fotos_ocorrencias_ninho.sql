-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — foto_urls de transferência/eclosão nas views
-- ───────────────────────────────────────────────────────────────
-- O botão "Fotos" da tela de validação só mostrava as fotos da
-- postura (ninhos_quelonios.foto_urls). As fotos de visitas já
-- vêm direto da tabela (visitas_ninho, sem view); faltava expor
-- foto_urls de transferências (via vw_transferencias_praia) e de
-- eclosão (via vw_ninhos_validacao) para montar a galeria completa
-- de fotos por ocorrência do ninho.
-- Aditivo: CREATE OR REPLACE só inclui colunas novas ao final,
-- preservando as colunas acrescentadas pela 081 (janela_horas etc.)
-- que não estavam no arquivo original da 080.
-- eclosao_foto_urls tem alias próprio para não colidir com
-- n.foto_urls (fotos da postura), já presente em vw_ninhos_validacao.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_transferencias_praia
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.ninho_id,
  n.numero_ninho,
  t.numero_atual,
  n.especie,
  n.data_encontro,
  n.hora_desova,
  t.data_transferencia,
  t.hora_transferencia,
  t.qtd_ovos,
  t.motivo,
  t.local_destino,
  t.observacoes,
  po.id   AS praia_origem_id,
  po.nome AS praia_origem_nome,
  pd.id   AS praia_destino_id,
  pd.nome AS praia_destino_nome,
  pd.experimental AS destino_experimental,
  mon.nome_completo AS monitor_nome,
  round(EXTRACT(epoch FROM t.data_transferencia + COALESCE(t.hora_transferencia, '06:00:00'::time)
    - (n.data_encontro + COALESCE(n.hora_desova, '06:00:00'::time))) / 3600.0, 1) AS janela_horas,
  t.criado_em,
  t.foto_urls
FROM transferencias_ninho t
JOIN ninhos_quelonios n          ON n.id = t.ninho_id
LEFT JOIN praias_monitoramento po  ON po.id = n.praia_id
LEFT JOIN praias_monitoramento pd  ON pd.id = t.praia_destino_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = t.monitor_id;

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
  ov.perdas_total AS ovos_perdidos_total,
  e.foto_urls     AS eclosao_foto_urls
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
  SELECT data_nascimento, filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao, foto_urls
  FROM eclosoes_ninho
  WHERE ninho_id = n.id
  ORDER BY data_nascimento DESC
  LIMIT 1
) e ON true;
