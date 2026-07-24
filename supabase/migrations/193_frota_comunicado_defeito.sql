-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — comunicado de defeito (motorista) → validação
-- da gestão → Ordem de Serviço corretiva
--
-- Hoje o único jeito de um defeito virar manutenção era indireto: no
-- check-in, se o motorista preenchia "Avarias" o veículo ia para
-- em_manutencao sozinho, mas sem descrição estruturada, sem aparecer
-- como pendência pra gestão validar e sem virar OS nenhuma. Isso
-- continua existindo (é do fim de uma viagem específica) — o que
-- falta é o motorista poder reportar um defeito A QUALQUER MOMENTO
-- (parado, no meio de uma viagem, etc.) e isso cair como pendência
-- pra gestão decidir: vira OS corretiva (dados que só a gestão sabe —
-- oficina, custo) ou é descartado (falso alarme).
--
-- Decisão de produto (registrada aqui, igual ao abastecimento): o
-- motorista só REPORTA (app). Abrir a Ordem de Serviço de verdade
-- (formulário grande: oficina, peças, custo) continua só na mesa
-- (frota-manutencao.html) — o app apenas mostra os comunicados
-- pendentes e permite descartar. Se "abrir OS" for adicionado ao app
-- no futuro, replicar na mesa também, como os demais pares do módulo.
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_comunicado_manutencao') THEN
    CREATE TYPE status_comunicado_manutencao AS ENUM ('pendente','validado','descartado');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS frota_comunicados_manutencao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id      uuid NOT NULL REFERENCES frota_veiculos(id),
  motorista_id    uuid NOT NULL REFERENCES frota_motoristas(id),
  viagem_id       uuid REFERENCES frota_viagens(id),
  descricao       text NOT NULL,
  status          status_comunicado_manutencao NOT NULL DEFAULT 'pendente',
  os_id           uuid REFERENCES frota_ordens_servico(id),
  validado_por    uuid REFERENCES usuarios(id),
  validado_em     timestamptz,
  motivo_descarte text,
  uuid_cliente    uuid UNIQUE,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frota_comunicado_veiculo ON frota_comunicados_manutencao (veiculo_id);
CREATE INDEX IF NOT EXISTS idx_frota_comunicado_status  ON frota_comunicados_manutencao (status);
CREATE INDEX IF NOT EXISTS idx_frota_comunicado_mot     ON frota_comunicados_manutencao (motorista_id);

DROP TRIGGER IF EXISTS trg_frota_comunicado_updated ON frota_comunicados_manutencao;
CREATE TRIGGER trg_frota_comunicado_updated BEFORE UPDATE ON frota_comunicados_manutencao
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE frota_comunicados_manutencao ENABLE ROW LEVEL SECURITY;

-- Leitura: quem edita/vê 'frota' (gestão), ou o próprio motorista que
-- reportou (pra ele acompanhar o status na aba Dados/Histórico, se
-- algum dia quiser mostrar). Sem policy de INSERT — só a RPC
-- SECURITY DEFINER abaixo grava, mesmo padrão de frota_abastecimentos.
DROP POLICY IF EXISTS frota_comunicado_select ON frota_comunicados_manutencao;
CREATE POLICY frota_comunicado_select ON frota_comunicados_manutencao
  FOR SELECT USING (
    pode_ver('frota')
    OR EXISTS (SELECT 1 FROM frota_motoristas fm WHERE fm.id = motorista_id AND fm.usuario_id = auth.uid())
  );

DROP POLICY IF EXISTS frota_comunicado_write ON frota_comunicados_manutencao;
CREATE POLICY frota_comunicado_write ON frota_comunicados_manutencao
  FOR UPDATE USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

-- ── RPC: motorista reporta um defeito ────────────────────────
-- Idempotente por uuid_cliente (mesmo molde de frota_registrar_abastecimento),
-- pra funcionar enfileirado offline sem duplicar ao reenviar.
CREATE OR REPLACE FUNCTION frota_reportar_defeito(
  p_veiculo_id uuid,
  p_descricao text,
  p_viagem_id uuid DEFAULT NULL,
  p_uuid_cliente uuid DEFAULT NULL
)
RETURNS frota_comunicados_manutencao
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id uuid;
  v_motorista_nome text;
  v_placa        text;
  v_comunicado   frota_comunicados_manutencao;
  r              record;
BEGIN
  IF p_uuid_cliente IS NOT NULL THEN
    SELECT * INTO v_comunicado FROM frota_comunicados_manutencao WHERE uuid_cliente = p_uuid_cliente;
    IF FOUND THEN
      RETURN v_comunicado;
    END IF;
  END IF;

  SELECT id, nome INTO v_motorista_id, v_motorista_nome
    FROM frota_motoristas WHERE usuario_id = auth.uid() AND ativo AND status = 'ativo';
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  IF NULLIF(TRIM(p_descricao), '') IS NULL THEN
    RAISE EXCEPTION 'Descreva o defeito antes de enviar';
  END IF;

  SELECT placa INTO v_placa FROM frota_veiculos WHERE id = p_veiculo_id;
  IF v_placa IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado';
  END IF;

  BEGIN
    INSERT INTO frota_comunicados_manutencao (veiculo_id, motorista_id, viagem_id, descricao, uuid_cliente)
    VALUES (p_veiculo_id, v_motorista_id, p_viagem_id, TRIM(p_descricao), p_uuid_cliente)
    RETURNING * INTO v_comunicado;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_comunicado FROM frota_comunicados_manutencao WHERE uuid_cliente = p_uuid_cliente;
    IF FOUND THEN
      RETURN v_comunicado;
    END IF;
    RAISE;
  END;

  FOR r IN SELECT id FROM usuarios WHERE ativo AND nivel_efetivo(id, 'frota') = 'editar' LOOP
    PERFORM frota_notificar(
      r.id,
      'Defeito reportado',
      format('%s reportou um defeito no veículo %s.', v_motorista_nome, v_placa),
      jsonb_build_object('modulo','frota','subtipo','defeito','comunicado_id',v_comunicado.id,'para','chefe')
    );
  END LOOP;

  RETURN v_comunicado;
END;
$$;

REVOKE ALL ON FUNCTION frota_reportar_defeito(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_reportar_defeito(uuid, text, uuid, uuid) TO authenticated;

-- ── View para a gestão (mesa + app) ──────────────────────────
CREATE OR REPLACE VIEW vw_frota_comunicados_manutencao WITH (security_invoker = true) AS
SELECT
  c.*,
  v.placa AS veiculo_placa, v.modelo AS veiculo_modelo,
  m.nome  AS motorista_nome,
  frota_nome_usuario(c.validado_por) AS validado_por_nome
FROM frota_comunicados_manutencao c
JOIN frota_veiculos v    ON v.id = c.veiculo_id
JOIN frota_motoristas m  ON m.id = c.motorista_id;
