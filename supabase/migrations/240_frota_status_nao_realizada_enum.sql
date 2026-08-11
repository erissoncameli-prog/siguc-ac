-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — enum: viagem não realizada
--
-- Migration SÓ do ADD VALUE, por regra do projeto: um valor novo de
-- enum só pode ser USADO depois de commitado ("unsafe use of new
-- value ... must be committed"). A lógica que usa 'nao_realizada'
-- está na 241, aplicada em seguida.
--
-- O QUE É
-- Viagem que chegou ao fim da janela prevista sem o motorista ter
-- dado check-out. Até aqui ela ficava 'aprovada' (ou 'solicitada')
-- para sempre: aparecia como "Aguardando saída" no app do motorista,
-- somava no KPI de aprovadas, ocupava a fila de aprovação do gestor e
-- não entrava em histórico nenhum. É um estado TERMINAL, como
-- 'recusada'/'cancelada' — não conta como uso do veículo em lugar
-- algum (consumo, % de conclusão, rodízio de motorista).
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'status_viagem_frota' AND e.enumlabel = 'nao_realizada'
  ) THEN
    ALTER TYPE status_viagem_frota ADD VALUE 'nao_realizada';
  END IF;
END $$;
