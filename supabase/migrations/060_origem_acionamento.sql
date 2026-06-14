-- ════════════════════════════════════════════════════════════════
-- 060 — Origem do acionamento (como a brigada soube da ocorrência)
-- ════════════════════════════════════════════════════════════════
-- Denúncia anônima/193, informação de populares, ronda da brigada, outro.

DO $$ BEGIN
  CREATE TYPE origem_acionamento AS ENUM (
    'denuncia_193', 'informacao_populares', 'ronda_brigada', 'outro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE registros_campo
  ADD COLUMN IF NOT EXISTS origem_acionamento origem_acionamento;

-- Expor o novo campo na view de validação/relatórios
DROP VIEW IF EXISTS vw_registros_validacao;
CREATE OR REPLACE VIEW vw_registros_validacao AS
SELECT
  rc.id, rc.uuid_cliente, rc.natureza, rc.atividade,
  rc.equipe, rc.equipe_id, eq.nome AS equipe_nome, rc.duracao_horas,
  rc.origem_acionamento,
  rc.status_validacao, rc.motivo_rejeicao, rc.historico, rc.fotos_urls,
  rc.data_hora_evento, rc.criado_em, rc.sincronizado_em, rc.validado_em,
  rc.descricao, rc.area_estimada_ha, rc.pessoas_alcancadas, rc.precisao_gps_m,
  rc.alerta_cigma, rc.integrada_cbmac, rc.alerta_id, rc.ocorrencia_id,
  rc.uc_id, rc.brigada_id, rc.brigadista_id,
  COALESCE(rc.regional, br.regional, uc.regional) AS regional,
  rc.municipio,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_Y(rc.localizacao) END AS lat,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_X(rc.localizacao) END AS lng,
  b.nome_completo AS brigadista_nome,
  br.nome AS brigada_nome,
  uc.nome AS uc_nome,
  uv.nome_completo AS validado_por_nome,
  COALESCE(f.n_fauna, 0) AS n_fauna,
  COALESCE(f.n_fauna_pendente, 0) AS n_fauna_pendente,
  COALESCE(f.n_fauna_resgatada, 0) AS n_fauna_resgatada
FROM registros_campo rc
LEFT JOIN brigadistas b ON b.id = rc.brigadista_id
LEFT JOIN brigadas br ON br.id = rc.brigada_id
LEFT JOIN equipes_brigada eq ON eq.id = rc.equipe_id
LEFT JOIN unidades_conservacao uc ON uc.id = rc.uc_id
LEFT JOIN usuarios uv ON uv.id = rc.validado_por
LEFT JOIN (
  SELECT registro_campo_id,
    COUNT(*) AS n_fauna,
    COUNT(*) FILTER (WHERE NOT identificacao_confirmada) AS n_fauna_pendente,
    COALESCE(SUM(quantidade) FILTER (WHERE tipo_evento = 'resgate'), 0) AS n_fauna_resgatada
  FROM registro_fauna
  GROUP BY registro_campo_id
) f ON f.registro_campo_id = rc.id;
