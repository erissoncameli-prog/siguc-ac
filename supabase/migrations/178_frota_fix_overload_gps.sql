-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — corrige overload duplicado criado pela 176.
-- CREATE OR REPLACE FUNCTION com uma lista de parâmetros diferente
-- (p_lat/p_lng adicionados) não substitui a função existente — cria
-- uma segunda função (overload). Isso deixou frota_checkout_viagem,
-- frota_checkin_viagem, frota_abrir_viagem_direta e
-- frota_registrar_abastecimento com duas assinaturas cada (com e sem
-- p_lat/p_lng), ambíguas para qualquer chamada sem esses dois
-- parâmetros ("could not choose best candidate function") — mesmo
-- problema que a migration 173 preveniu ao fazer DROP FUNCTION antes
-- de recriar frota_abrir_viagem_direta. A 176 já foi corrigida no
-- arquivo (DROP FUNCTION antes de cada CREATE OR REPLACE) para
-- ambientes novos; esta migration limpa o overload que já tinha sido
-- criado no banco antes da correção.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS frota_checkout_viagem(uuid, numeric, smallint);
DROP FUNCTION IF EXISTS frota_checkin_viagem(uuid, numeric, smallint, text, text);
DROP FUNCTION IF EXISTS frota_abrir_viagem_direta(uuid, text, text, numeric, smallint, uuid);
DROP FUNCTION IF EXISTS frota_registrar_abastecimento(uuid, numeric, numeric, numeric, numeric, boolean, uuid, text, text, text, text, uuid);
