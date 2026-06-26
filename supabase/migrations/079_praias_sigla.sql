-- ── 079: sigla curta em praias_monitoramento ──────────────────
-- Campo usado para compor o número automático do ninho:
-- {sigla}-{sigla_especie}-{seq}  →  ex: AQ-TR-001

ALTER TABLE praias_monitoramento
  ADD COLUMN IF NOT EXISTS sigla varchar(10);
