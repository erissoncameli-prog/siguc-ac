-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — abastecimento: backfill do saldo_atual.
-- A migration 185 adicionou saldo_atual via ADD COLUMN, mas o
-- trigger de inicialização (trg_frota_contrato_saldo_init) só
-- seta o valor em INSERT ou quando valor_global passa de NULL
-- para preenchido — contratos já existentes na época (com
-- valor_global já preenchido) ficaram com saldo_atual NULL, e o
-- trigger de débito (frota_ajustar_saldo_contrato) nunca desconta
-- quando saldo_atual IS NULL (guarda proposital para contratos
-- sem controle de saldo). Resultado: contratos antigos nunca
-- tiveram o saldo inicializado, mesmo com abastecimentos já
-- validados contra eles.
-- Esta migration só faz o backfill pontual — não altera a lógica
-- dos triggers (que já está correta para linhas novas).
-- ═══════════════════════════════════════════════════════════

UPDATE frota_contratos_combustivel c
SET saldo_atual = c.valor_global - COALESCE((
  SELECT SUM(COALESCE(a.valor_ajustado, a.valor_total))
  FROM frota_abastecimentos a
  WHERE a.contrato_id = c.id AND a.status = 'validado'
), 0)
WHERE c.saldo_atual IS NULL
  AND c.valor_global IS NOT NULL;
