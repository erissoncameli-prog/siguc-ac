-- 075: campos de ovos e distância ao rio em ninhos_quelonios
-- Adicionados conforme necessidade de campo: contagem de ovos na postura
-- e distância medida (GPS tracker ou estimativa) do ninho ao rio.

ALTER TABLE ninhos_quelonios
  ADD COLUMN IF NOT EXISTS qtd_ovos          smallint CHECK (qtd_ovos >= 0),
  ADD COLUMN IF NOT EXISTS ovos_integros     smallint CHECK (ovos_integros >= 0),
  ADD COLUMN IF NOT EXISTS ovos_descartados  smallint CHECK (ovos_descartados >= 0),
  ADD COLUMN IF NOT EXISTS dist_rio_m        numeric(7,1) CHECK (dist_rio_m >= 0),
  ADD COLUMN IF NOT EXISTS dist_rio_metodo   text CHECK (dist_rio_metodo IN ('tracker','estimativa'));

-- Atualiza a view vw_ninhos_validacao para expor os novos campos
DROP VIEW IF EXISTS vw_ninhos_validacao;

CREATE VIEW vw_ninhos_validacao WITH (security_invoker = true) AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.especie,
  n.data_encontro,
  n.localizacao,
  ST_Y(n.localizacao::geometry) AS lat,
  ST_X(n.localizacao::geometry) AS lng,
  n.precisao_gps_m,
  n.qtd_ovos,
  n.ovos_integros,
  n.ovos_descartados,
  n.dist_rio_m,
  n.dist_rio_metodo,
  n.foto_urls,
  n.status,
  n.status_validacao,
  n.motivo_rejeicao,
  n.validado_por,
  n.validado_em,
  n.observacoes,
  n.criado_em,
  n.atualizado_em,
  p.id   AS praia_id,
  p.nome AS praia_nome,
  p.codigo AS praia_codigo,
  m.id   AS monitor_id,
  m.nome_completo AS monitor_nome,
  g.id   AS grupo_id,
  g.nome AS grupo_nome,
  t.data_transferencia,
  t.local_destino AS transferencia_local,
  e.data_nascimento,
  e.filhotes_vivos,
  e.filhotes_mortos,
  e.ovos_nao_nascidos
FROM ninhos_quelonios n
LEFT JOIN praias_monitoramento       p ON p.id = n.praia_id
LEFT JOIN monitores_biodiversidade m ON m.id = n.monitor_id
LEFT JOIN grupos_biomonitor        g ON g.id = n.grupo_id
LEFT JOIN transferencias_ninho     t ON t.ninho_id = n.id
LEFT JOIN eclosoes_ninho           e ON e.ninho_id = n.id;
