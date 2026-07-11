-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Filhote individual: marcar como doente
-- ───────────────────────────────────────────────────────────────
-- Visualização por cor na numeração dos filhotes (app + web):
--   vermelho = óbito, verde = vivo, lilás = doente.
-- Como a ocorrência de doença (ocorrencias_bercario) é por LOTE, não
-- identifica o indivíduo afetado — este campo permite ao monitor
-- marcar/desmarcar manualmente qual filhote específico está doente.
--
-- View recriada com TODAS as colunas atuais (id..comprimento_plastrao,
-- na ordem de 142_biometria_carapaca_plastrao.sql) + doente no final —
-- CREATE OR REPLACE VIEW não aceita remover/reordenar colunas.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE filhotes_bercario ADD COLUMN IF NOT EXISTS doente boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW vw_filhotes_bercario
WITH (security_invoker = true)
AS
SELECT
  f.id,
  f.uuid_cliente,
  f.lote_id,
  f.numero,
  f.status,
  f.data_obito,
  f.causa_obito,
  f.observacoes,
  f.criado_em,
  ub.data_medicao   AS ultima_data_medicao,
  ub.comprimento_cm AS ultimo_comprimento_cm,
  ub.peso_g         AS ultimo_peso_g,
  (SELECT count(*) FROM biometrias_individuais b WHERE b.individuo_id = f.id) AS total_medicoes,
  ub.largura_carapaca_cm     AS ultimo_largura_carapaca_cm,
  ub.comprimento_plastrao_cm AS ultimo_comprimento_plastrao_cm,
  f.doente
FROM filhotes_bercario f
LEFT JOIN LATERAL (
  SELECT data_medicao, comprimento_cm, largura_carapaca_cm, comprimento_plastrao_cm, peso_g
  FROM biometrias_individuais
  WHERE individuo_id = f.id
  ORDER BY data_medicao DESC, hora_medicao DESC NULLS LAST, criado_em DESC
  LIMIT 1
) ub ON true;
