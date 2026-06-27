-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — vw_ninhos_validacao: praia_atual
-- ───────────────────────────────────────────────────────────
-- A migration 080 adicionou praia_atual_id em ninhos_quelonios
-- para rastrear onde o ninho está incubando agora (pode diferir
-- de praia_id, que é a praia de origem/desova).
-- A view não foi atualizada na época; isso faz o filtro por praia
-- no app ignorar ninhos recebidos por transferência.
-- Também corrige: qtd_ovos (077 acidentalmente aliasou ninho_qtd_ovos)
--                 hora_desova (adicionada em 081, ausente na view)
-- ═══════════════════════════════════════════════════════════

DROP VIEW IF EXISTS vw_ninhos_validacao;

CREATE VIEW vw_ninhos_validacao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
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
  -- Ovos e distância
  n.qtd_ovos,
  n.ovos_integros,
  n.ovos_descartados,
  n.dist_rio_m,
  n.dist_rio_metodo,
  -- Condições do ninho
  n.temperatura_c,
  n.umidade_pct,
  n.profundidade_cm,
  -- Praia de origem (onde o ovo foi posto)
  p.id          AS praia_id,
  p.nome        AS praia_nome,
  p.codigo      AS praia_codigo,
  -- Praia atual (onde está incubando; difere após transferência)
  n.praia_atual_id,
  pa.nome       AS praia_atual_nome,
  -- Demais dados relacionais
  uc.nome       AS uc_nome,
  mon.id        AS monitor_id,
  mon.nome_completo AS monitor_nome,
  g.nome        AS grupo_nome,
  g.id          AS grupo_id,
  -- Transferência (última)
  t.data_transferencia,
  t.qtd_ovos    AS transf_qtd_ovos,
  t.local_destino,
  -- Eclosão
  e.data_nascimento,
  e.filhotes_vivos,
  e.filhotes_mortos,
  e.ovos_nao_nascidos,
  e.predacao
FROM ninhos_quelonios n
LEFT JOIN praias_monitoramento p        ON p.id  = n.praia_id
LEFT JOIN praias_monitoramento pa       ON pa.id = n.praia_atual_id
LEFT JOIN unidades_conservacao uc       ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon  ON mon.id = n.monitor_id
LEFT JOIN grupos_biomonitor g           ON g.id  = n.grupo_id
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
