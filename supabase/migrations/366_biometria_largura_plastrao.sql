-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — largura do plastrão na biometria
-- individual do filhote (complementa a 142).
-- Medida INDEPENDENTE da largura da carapaça: o plastrão é a placa
-- ventral, mais estreita que a carapaça (que inclui os marginais).
-- Nunca copiar uma na outra — a razão plastrão/carapaça seria 1
-- por construção. Protocolo: medida na MAIOR largura do plastrão.
-- comprimento_cm segue com o nome de sempre, mas é o comprimento
-- da CARAPAÇA (só o rótulo de tela mudou).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE biometrias_individuais
  ADD COLUMN IF NOT EXISTS largura_plastrao_cm numeric(5,1);

COMMENT ON COLUMN biometrias_individuais.comprimento_cm IS
  'Comprimento da carapaça (cm). Nome de coluna mantido por compatibilidade.';
COMMENT ON COLUMN biometrias_individuais.largura_plastrao_cm IS
  'Largura do plastrão (cm), na maior largura. Medida independente da largura da carapaça — nunca derivada dela.';

ALTER TABLE biometrias_individuais
  DROP CONSTRAINT biometrias_individuais_check;

ALTER TABLE biometrias_individuais
  ADD CONSTRAINT biometrias_individuais_check CHECK (
    comprimento_cm IS NOT NULL OR peso_g IS NOT NULL
    OR largura_carapaca_cm IS NOT NULL OR comprimento_plastrao_cm IS NOT NULL
    OR largura_plastrao_cm IS NOT NULL
  );

-- Recriada a partir do pg_get_viewdef() de produção; coluna nova AO FINAL.
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
  f.doente,
  f.anomalia,
  ub.largura_plastrao_cm     AS ultimo_largura_plastrao_cm
FROM filhotes_bercario f
LEFT JOIN LATERAL (
  SELECT data_medicao, comprimento_cm, largura_carapaca_cm,
         comprimento_plastrao_cm, largura_plastrao_cm, peso_g
  FROM biometrias_individuais
  WHERE individuo_id = f.id
  ORDER BY data_medicao DESC, hora_medicao DESC NULLS LAST, criado_em DESC
  LIMIT 1
) ub ON true;
