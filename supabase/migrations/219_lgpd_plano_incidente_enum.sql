-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 5 (1/2) — enum do Plano de Resposta a
-- Incidente (Art. 48 da LGPD)
--
-- Valor de enum isolado numa migration própria, na frente do resto,
-- pelo mesmo motivo da 217: um valor novo de ENUM só pode ser
-- referenciado depois de commitado — usá-lo na mesma transação em que
-- foi criado falha com "unsafe use of new value ... must be committed
-- before they can be used" (erro real, visto ao aplicar a 217/218).
-- ═══════════════════════════════════════════════════════════

ALTER TYPE lgpd_tipo_documento ADD VALUE IF NOT EXISTS 'plano_incidente';
