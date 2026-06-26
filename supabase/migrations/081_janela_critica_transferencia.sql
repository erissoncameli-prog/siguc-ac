-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Janela crítica de translocação
-- ───────────────────────────────────────────────────────────
-- Quelônios (Podocnemis): o ovo só pode ser remanejado com
-- segurança nas primeiras horas após a desova — depois disso o
-- disco embrionário adere à casca e a rotação rompe as membranas.
-- Registramos a hora da desova e a hora do reenterro para medir
-- essa janela e sinalizar (semáforo) no app.
-- Depende de 080_transferencia_entre_praias.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE ninhos_quelonios
  ADD COLUMN IF NOT EXISTS hora_desova time;

COMMENT ON COLUMN ninhos_quelonios.hora_desova IS
  'Hora estimada/observada da desova. Base para a janela crítica de transferência.';

ALTER TABLE transferencias_ninho
  ADD COLUMN IF NOT EXISTS hora_transferencia time;

COMMENT ON COLUMN transferencias_ninho.hora_transferencia IS
  'Hora do reenterro no destino. Com hora_desova define a janela de translocação.';

-- ── vw_transferencias_praia — recria (base 080) + janela_horas ──
DROP VIEW IF EXISTS vw_transferencias_praia;

CREATE VIEW vw_transferencias_praia
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.ninho_id,
  n.numero_ninho,
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
  -- Janela entre desova e reenterro, em horas (06:00 como hora-âncora
  -- quando a hora exata não foi registrada)
  ROUND((EXTRACT(EPOCH FROM (
    (t.data_transferencia + COALESCE(t.hora_transferencia, time '06:00'))
    - (n.data_encontro    + COALESCE(n.hora_desova,        time '06:00'))
  )) / 3600.0)::numeric, 1) AS janela_horas,
  t.criado_em
FROM transferencias_ninho t
JOIN ninhos_quelonios n          ON n.id = t.ninho_id
LEFT JOIN praias_monitoramento po  ON po.id = n.praia_id
LEFT JOIN praias_monitoramento pd  ON pd.id = t.praia_destino_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = t.monitor_id;
