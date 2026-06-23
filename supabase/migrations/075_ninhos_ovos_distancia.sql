-- ── 075: campos de ovos e distância ao rio em ninhos_quelonios ──
-- Adiciona informações registradas no campo: contagem de ovos íntegros/
-- descartados e distância do ninho ao rio (medida com GPS ou estimada).
-- Atualiza vw_ninhos_validacao para incluir esses campos.

ALTER TABLE ninhos_quelonios
  ADD COLUMN IF NOT EXISTS qtd_ovos          smallint CHECK (qtd_ovos >= 0),
  ADD COLUMN IF NOT EXISTS ovos_integros     smallint CHECK (ovos_integros >= 0),
  ADD COLUMN IF NOT EXISTS ovos_descartados  smallint CHECK (ovos_descartados >= 0),
  ADD COLUMN IF NOT EXISTS dist_rio_m        numeric(8,1) CHECK (dist_rio_m >= 0),
  ADD COLUMN IF NOT EXISTS dist_rio_metodo   text CHECK (dist_rio_metodo IN ('gps_traker','estimativa'));

-- ── Atualiza view de validação ────────────────────────────────
CREATE OR REPLACE VIEW vw_ninhos_validacao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.especie,
  n.data_encontro,
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
  -- Ovos e distância (registrados no campo)
  n.qtd_ovos                                                        AS ninho_qtd_ovos,
  n.ovos_integros,
  n.ovos_descartados,
  n.dist_rio_m,
  n.dist_rio_metodo,
  -- Dados relacionais
  p.nome        AS praia_nome,
  p.codigo      AS praia_codigo,
  uc.nome       AS uc_nome,
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
LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
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
