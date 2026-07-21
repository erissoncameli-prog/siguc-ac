-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — bloqueio de validação com saldo negativo
-- (regra configurável, mesmo padrão de frota_config_gps/177).
-- Linha única (singleton), editável só por quem edita 'frota';
-- leitura liberada a qualquer autenticado (a mesa precisa ler o
-- valor para decidir se bloqueia no front antes de chamar a RPC).
-- Fail-safe: nasce DESLIGADO — não bloqueia nada até o gestor
-- decidir ativar. Só afeta contratos com saldo controlado
-- (saldo_atual preenchido); contratos sem valor_global nunca
-- bloqueiam. Sem exceção pela tela: se bloqueado e saldo
-- insuficiente, a validação é recusada até o gestor ajustar o
-- contrato (valor_global/saldo_atual) no cadastro.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS frota_config_saldo (
  id                       smallint PRIMARY KEY DEFAULT 1,
  bloquear_saldo_negativo  boolean NOT NULL DEFAULT false,
  atualizado_por           uuid REFERENCES usuarios(id),
  atualizado_em            timestamptz DEFAULT now(),
  CONSTRAINT chk_frota_config_saldo_singleton CHECK (id = 1)
);

INSERT INTO frota_config_saldo (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION frota_marcar_atualizador_config_saldo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.atualizado_por := auth.uid();
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frota_config_saldo_atualizador ON frota_config_saldo;
CREATE TRIGGER trg_frota_config_saldo_atualizador BEFORE UPDATE ON frota_config_saldo
  FOR EACH ROW EXECUTE FUNCTION frota_marcar_atualizador_config_saldo();

ALTER TABLE frota_config_saldo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_config_saldo_select ON frota_config_saldo;
CREATE POLICY frota_config_saldo_select ON frota_config_saldo
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.ativo)
  );

DROP POLICY IF EXISTS frota_config_saldo_update ON frota_config_saldo;
CREATE POLICY frota_config_saldo_update ON frota_config_saldo
  FOR UPDATE USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

-- Sem INSERT/DELETE via API: linha única já semeada acima; RLS não
-- libera essas operações para ninguém (nem pode_editar).
REVOKE EXECUTE ON FUNCTION frota_marcar_atualizador_config_saldo() FROM PUBLIC, authenticated, anon;

-- ── Trava no banco (2ª camada — autoridade real) ───────────────
-- Recria frota_validar_abastecimento (migration 175) acrescentando
-- a checagem de saldo antes de gravar. Mesma assinatura, sem DROP.
CREATE OR REPLACE FUNCTION frota_validar_abastecimento(
  p_id uuid, p_contrato_id uuid,
  p_litros_ajust numeric DEFAULT NULL, p_valor_ajust numeric DEFAULT NULL
)
RETURNS frota_abastecimentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_abast     frota_abastecimentos;
  v_bloquear  boolean;
  v_saldo     numeric;
  v_valor_deb numeric;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para validar abastecimentos';
  END IF;
  IF p_contrato_id IS NULL THEN
    RAISE EXCEPTION 'Contrato é obrigatório para validar';
  END IF;

  SELECT * INTO v_abast FROM frota_abastecimentos WHERE id = p_id;
  IF v_abast IS NULL THEN
    RAISE EXCEPTION 'Abastecimento não encontrado ou já validado';
  END IF;

  SELECT saldo_atual INTO v_saldo
    FROM frota_contratos_combustivel WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  SELECT bloquear_saldo_negativo INTO v_bloquear FROM frota_config_saldo WHERE id = 1;
  IF v_bloquear AND v_saldo IS NOT NULL THEN
    v_valor_deb := COALESCE(p_valor_ajust, v_abast.valor_total);
    IF (v_saldo - v_valor_deb) < 0 THEN
      RAISE EXCEPTION 'Saldo insuficiente no contrato (saldo atual R$ %, este abastecimento debita R$ %). Ajuste o contrato antes de validar.',
        to_char(v_saldo, 'FM999G999G990D00'), to_char(v_valor_deb, 'FM999G999G990D00');
    END IF;
  END IF;

  UPDATE frota_abastecimentos
    SET status = 'validado', contrato_id = p_contrato_id,
        litros_ajustado = p_litros_ajust, valor_ajustado = p_valor_ajust,
        validado_por = auth.uid(), validado_em = now(), motivo_rejeicao = NULL
    WHERE id = p_id AND status IN ('pendente','rejeitado')
    RETURNING * INTO v_abast;

  IF v_abast IS NULL THEN
    RAISE EXCEPTION 'Abastecimento não encontrado ou já validado';
  END IF;
  RETURN v_abast;
END;
$$;
