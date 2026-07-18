-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — corrige RLS de INSERT em frota_viagens
-- A policy original só checava solicitante_id/usuário ativo, sem
-- restringir status/alocação — qualquer usuário autenticado podia
-- inserir a viagem já 'aprovada' com veículo e motorista de sua
-- escolha, pulando a aprovação do setor de transporte por completo.
-- Força o estado inicial seguro: só 'solicitada', sem nenhum campo
-- de alocação/aprovação/execução preenchido. Toda transição continua
-- só possível via as RPCs SECURITY DEFINER (frota_aprovar_viagem etc).
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS frota_viag_insert ON frota_viagens;
CREATE POLICY frota_viag_insert ON frota_viagens
  FOR INSERT WITH CHECK (
    solicitante_id = auth.uid()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.ativo)
    AND status = 'solicitada'
    AND veiculo_id IS NULL
    AND motorista_id IS NULL
    AND aprovado_por IS NULL
    AND aprovado_em IS NULL
    AND motivo_recusa IS NULL
    AND checkout_em IS NULL
    AND km_saida IS NULL
    AND horas_saida IS NULL
    AND combustivel_saida_pct IS NULL
    AND checkin_em IS NULL
    AND km_chegada IS NULL
    AND horas_chegada IS NULL
    AND combustivel_chegada_pct IS NULL
    AND observacoes_checkin IS NULL
    AND avarias IS NULL
    AND cancelado_por IS NULL
    AND cancelado_em IS NULL
    AND motivo_cancelamento IS NULL
  );
