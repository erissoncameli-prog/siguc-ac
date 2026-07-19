-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — motorista deve ver só o(s) veículo(s) dele
-- no abastecimento avulso, com espaço pro gestor liberar outros
-- carros sem precisar trocar o "padrão".
--
-- frota_veiculos.motorista_padrao_id (migration 163) já guarda o
-- vínculo 1:1 veículo → motorista dono. Gabriel já está configurado
-- como padrão do Saveiro CD NXT1030 — não precisa de seed aqui.
-- Faltava:
-- 1) A RPC frota_veiculos_ativos_abastecimento (183) ainda ignorava
--    motorista_padrao_id e devolvia a frota toda pra qualquer
--    motorista sem viagem em andamento.
-- 2) Não existe hoje como liberar um motorista pra usar um veículo
--    que não é o padrão dele (ex.: pegar emprestado o carro de
--    outro setor) — motorista_padrao_id é 1 veículo ↔ 1 motorista
--    só. frota_veiculo_motoristas cobre liberações extras, N:N,
--    sem mexer no padrão.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS frota_veiculo_motoristas (
  veiculo_id    uuid NOT NULL REFERENCES frota_veiculos(id) ON DELETE CASCADE,
  motorista_id  uuid NOT NULL REFERENCES frota_motoristas(id) ON DELETE CASCADE,
  concedido_por uuid REFERENCES usuarios(id),
  concedido_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (veiculo_id, motorista_id)
);

CREATE INDEX IF NOT EXISTS idx_frota_veic_mot_motorista ON frota_veiculo_motoristas (motorista_id);

ALTER TABLE frota_veiculo_motoristas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_veic_mot_select ON frota_veiculo_motoristas;
CREATE POLICY frota_veic_mot_select ON frota_veiculo_motoristas
  FOR SELECT USING (
    pode_ver('frota')
    OR EXISTS (SELECT 1 FROM frota_motoristas fm WHERE fm.id = motorista_id AND fm.usuario_id = auth.uid())
  );

DROP POLICY IF EXISTS frota_veic_mot_write ON frota_veiculo_motoristas;
CREATE POLICY frota_veic_mot_write ON frota_veiculo_motoristas
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

-- ── RPC: veículos que o motorista chamador pode usar no
-- abastecimento avulso (sem viagem em andamento) ────────────────
-- Regra: veículo(s) onde ele é motorista_padrao_id, OU onde foi
-- liberado explicitamente (frota_veiculo_motoristas). Se ele não
-- tem NENHUM veículo nos dois casos (motorista recém-cadastrado,
-- gestor ainda não configurou nada), cai no comportamento anterior
-- — mostra a frota ativa toda, pra não bloquear ninguém.
CREATE OR REPLACE FUNCTION frota_veiculos_ativos_abastecimento()
RETURNS TABLE (id uuid, placa text, modelo text, medidor medidor_uso_frota)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id uuid;
BEGIN
  SELECT fm.id INTO v_motorista_id
    FROM frota_motoristas fm WHERE fm.usuario_id = auth.uid() AND fm.ativo AND fm.status = 'ativo';

  IF v_motorista_id IS NULL AND NOT pode_ver('frota') THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  IF v_motorista_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM frota_veiculos WHERE motorista_padrao_id = v_motorista_id
    UNION ALL
    SELECT 1 FROM frota_veiculo_motoristas WHERE motorista_id = v_motorista_id
  ) THEN
    RETURN QUERY
      SELECT v.id, v.placa, v.modelo, v.medidor
      FROM frota_veiculos v
      WHERE v.ativo AND v.status NOT IN ('em_manutencao', 'baixado')
        AND (
          v.motorista_padrao_id = v_motorista_id
          OR EXISTS (SELECT 1 FROM frota_veiculo_motoristas x WHERE x.veiculo_id = v.id AND x.motorista_id = v_motorista_id)
        )
      ORDER BY v.placa;
  ELSE
    RETURN QUERY
      SELECT v.id, v.placa, v.modelo, v.medidor
      FROM frota_veiculos v
      WHERE v.ativo AND v.status NOT IN ('em_manutencao', 'baixado')
      ORDER BY v.placa;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION frota_veiculos_ativos_abastecimento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_veiculos_ativos_abastecimento() TO authenticated;
