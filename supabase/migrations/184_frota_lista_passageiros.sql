-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — lista de passageiros + telefone do
-- solicitante visível ao motorista.
-- Passageiros: texto livre (um nome por linha), sem vínculo com
-- cadastro — motorista só precisa saber quem embarca.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_viagens ADD COLUMN IF NOT EXISTS lista_passageiros text;

-- CREATE OR REPLACE basta aqui: fv.* ganha lista_passageiros no fim
-- da lista (coluna nova é sempre a última), e a coluna adicionada
-- agora (solicitante_telefone) também vai ao fim do SELECT.
CREATE OR REPLACE VIEW vw_frota_viagens_detalhe WITH (security_invoker = true) AS
SELECT
  fv.*,
  frota_nome_usuario(fv.solicitante_id) AS solicitante_nome,
  u.telefone        AS solicitante_telefone,
  s.sigla           AS setor_sigla,
  s.nome            AS setor_nome,
  v.placa           AS veiculo_placa,
  v.modelo          AS veiculo_modelo,
  v.tipo            AS veiculo_tipo,
  v.medidor         AS veiculo_medidor,
  m.nome            AS motorista_nome,
  m.usuario_id      AS motorista_usuario_id,
  CASE WHEN fv.localizacao_saida IS NOT NULL THEN ST_Y(fv.localizacao_saida) END AS lat_saida,
  CASE WHEN fv.localizacao_saida IS NOT NULL THEN ST_X(fv.localizacao_saida) END AS lng_saida,
  CASE WHEN fv.localizacao_chegada IS NOT NULL THEN ST_Y(fv.localizacao_chegada) END AS lat_chegada,
  CASE WHEN fv.localizacao_chegada IS NOT NULL THEN ST_X(fv.localizacao_chegada) END AS lng_chegada
FROM frota_viagens fv
LEFT JOIN usuarios u               ON u.id = fv.solicitante_id
LEFT JOIN unidades_organizacionais s ON s.id = fv.setor_solicitante_id
LEFT JOIN frota_veiculos v         ON v.id = fv.veiculo_id
LEFT JOIN frota_motoristas m       ON m.id = fv.motorista_id;
