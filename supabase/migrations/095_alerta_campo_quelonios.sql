-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Rastreabilidade do alerta de campo
-- ───────────────────────────────────────────────────────────
-- Guarda o snapshot do alerta científico que o app de campo
-- exibiu e o monitor reconheceu ao registrar o ninho/visita
-- (faixas fora do padrão + severidade + momento). Permite ao
-- gestor ver que a orientação foi apresentada em campo.
-- Formato (jsonb):
--   { "severidade_max": "critica",
--     "faixas": [{ "p": "temp", "f": "Calor extremo", "s": "critica" }],
--     "reconhecido_em": "2026-06-28T12:00:00Z" }
-- ═══════════════════════════════════════════════════════════

ALTER TABLE ninhos_quelonios ADD COLUMN IF NOT EXISTS alerta_campo jsonb;
ALTER TABLE visitas_ninho    ADD COLUMN IF NOT EXISTS alerta_campo jsonb;

-- ── Recria vw_ninhos_validacao incluindo alerta_campo ────────
DROP VIEW IF EXISTS vw_ninhos_validacao;

CREATE VIEW vw_ninhos_validacao
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
  -- Quebra de descartados por causa (eventos de registro)
  (SELECT COALESCE(SUM(qtd),0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'natural')   AS descartados_natural,
  (SELECT COALESCE(SUM(qtd),0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'predacao')  AS descartados_predacao,
  (SELECT COALESCE(SUM(qtd),0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'humana')    AS descartados_humana,
  n.dist_rio_m,
  n.dist_rio_metodo,
  n.temperatura_c,
  n.umidade_pct,
  n.profundidade_cm,
  n.alerta_campo,
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
  e.predacao
FROM ninhos_quelonios n
LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
LEFT JOIN praias_monitoramento pa      ON pa.id = n.praia_atual_id
LEFT JOIN unidades_conservacao uc      ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
LEFT JOIN grupos_biomonitor g          ON g.id = n.grupo_id
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
