-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — largura da carapaça e comprimento do
-- plastrão na biometria individual do filhote (132).
-- Acrescenta as duas medidas, relaxa o CHECK (hoje só aceitava
-- comprimento OU peso) para aceitar qualquer uma das 4 medidas, e
-- repõe a última medição de cada uma na vw_filhotes_bercario.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE biometrias_individuais
  ADD COLUMN largura_carapaca_cm     numeric(5,1),
  ADD COLUMN comprimento_plastrao_cm numeric(5,1);

ALTER TABLE biometrias_individuais
  DROP CONSTRAINT biometrias_individuais_check;

ALTER TABLE biometrias_individuais
  ADD CONSTRAINT biometrias_individuais_check CHECK (
    comprimento_cm IS NOT NULL OR peso_g IS NOT NULL
    OR largura_carapaca_cm IS NOT NULL OR comprimento_plastrao_cm IS NOT NULL
  );

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
  ub.comprimento_plastrao_cm AS ultimo_comprimento_plastrao_cm
FROM filhotes_bercario f
LEFT JOIN LATERAL (
  SELECT data_medicao, comprimento_cm, largura_carapaca_cm, comprimento_plastrao_cm, peso_g
  FROM biometrias_individuais
  WHERE individuo_id = f.id
  ORDER BY data_medicao DESC, hora_medicao DESC NULLS LAST, criado_em DESC
  LIMIT 1
) ub ON true;
