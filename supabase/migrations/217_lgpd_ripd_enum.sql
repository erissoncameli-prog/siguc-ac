-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 4 (2/2) — RIPD dos dois tratamentos de alto
-- risco que ainda não tinham (Art. 38 da LGPD)
--
-- O ROPA (migration 211) já tinha marcado 5 tratamentos como
-- alto_risco. Quatro deles (TRAT-005, 006, 009, 011 — geolocalização
-- de brigadista, monitor e motorista) compartilham a mesma natureza
-- de risco (trabalhador identificado + coordenada), então um RIPD só
-- cobre os quatro. O quinto (TRAT-013 — base do CAR) é risco de
-- natureza diferente (volume + titular de terceiro que nunca
-- interagiu com o órgão) e tem RIPD próprio.
--
-- POR QUE REUSAR lgpd_documentos EM VEZ DE TABELA NOVA
-- Um RIPD é, na prática, um texto estruturado com data de vigência —
-- exatamente o que lgpd_documentos + lgpd_documento_versoes já
-- resolvem (versionamento, hash de integridade, histórico). Criar uma
-- tabela de "registro de risco" à parte duplicaria isso. A diferença
-- para Política/Termo/Aviso é só de tratamento: RIPD não pede aceite
-- (exige_aceite=false — ninguém "aceita" uma autoavaliação de risco) e
-- não é público (publico=false — é documento de governança interna,
-- não de transparência ao titular, que já é servida pela Política).
-- Aparece listado em Configurações → Privacidade junto dos demais.
-- ═══════════════════════════════════════════════════════════

ALTER TYPE lgpd_tipo_documento ADD VALUE IF NOT EXISTS 'ripd_geolocalizacao';
ALTER TYPE lgpd_tipo_documento ADD VALUE IF NOT EXISTS 'ripd_car';
