-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — corrige RLS bypass em 3 views + 2 funções
-- Achado pela revisão automática (e verificação própria ao investigar
-- o mesmo padrão): views sem security_invoker=true rodam com o
-- privilégio do dono (postgres), ignorando a RLS das tabelas de
-- origem — qualquer usuário autenticado, mesmo sem pode_ver('frota'),
-- conseguia consultar vw_frota_viagens_detalhe/vw_frota_manutencoes_
-- pendentes/vw_frota_os_detalhe direto pela API e ver dados de todo
-- mundo. Também revoga EXECUTE público de duas funções SECURITY
-- DEFINER que nunca deveriam ser chamadas diretamente pelo cliente
-- (só internamente, por outras funções SECURITY DEFINER já validadas
-- — o dono de todas é a mesma role, então as chamadas internas via
-- PERFORM continuam funcionando normalmente).
-- ═══════════════════════════════════════════════════════════

ALTER VIEW vw_frota_viagens_detalhe        SET (security_invoker = true);
ALTER VIEW vw_frota_manutencoes_pendentes  SET (security_invoker = true);
ALTER VIEW vw_frota_os_detalhe             SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION frota_notificar(uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION frota_checar_manutencao_veiculo(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
