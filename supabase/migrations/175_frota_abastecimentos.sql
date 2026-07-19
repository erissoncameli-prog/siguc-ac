-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — abastecimento (2/3): registro central.
-- Separação de responsabilidades: o MOTORISTA registra o evento
-- físico do abastecimento (app, offline-first) — nunca vê nem
-- escolhe contrato/fonte. A GESTÃO (pode_editar('frota')) valida
-- e vincula o registro a um contrato de combustível (mesa,
-- pages/frota-abastecimentos.html). Contrato é só classificação
-- na v1 — sem controle de saldo/bloqueio (valor_global é
-- referência, ver migration 174).
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_abastecimento_frota') THEN
    CREATE TYPE status_abastecimento_frota AS ENUM ('pendente','validado','rejeitado');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS frota_abastecimentos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                   text,

  veiculo_id               uuid NOT NULL REFERENCES frota_veiculos(id),
  motorista_id             uuid NOT NULL REFERENCES frota_motoristas(id),
  viagem_id                uuid REFERENCES frota_viagens(id),

  data_hora                timestamptz NOT NULL DEFAULT now(),
  medida_no_abastecimento  numeric(10,1) NOT NULL,
  litros                   numeric(10,2) NOT NULL,
  preco_litro              numeric(10,3) NOT NULL,
  valor_total              numeric(12,2) NOT NULL,
  tanque_cheio             boolean NOT NULL DEFAULT true,
  posto_nome               text,
  foto_cupom_url           text,
  foto_hodometro_url       text,
  observacoes_motorista    text,

  status                   status_abastecimento_frota NOT NULL DEFAULT 'pendente',
  contrato_id              uuid REFERENCES frota_contratos_combustivel(id),
  litros_ajustado          numeric(10,2),
  valor_ajustado           numeric(12,2),
  validado_por             uuid REFERENCES usuarios(id),
  validado_em              timestamptz,
  motivo_rejeicao          text,

  uuid_cliente             uuid,

  criado_em                timestamptz DEFAULT now(),
  atualizado_em             timestamptz DEFAULT now(),

  CONSTRAINT chk_frota_abast_litros CHECK (litros > 0),
  CONSTRAINT chk_frota_abast_valor CHECK (valor_total > 0)
);

CREATE INDEX IF NOT EXISTS idx_frota_abast_veiculo   ON frota_abastecimentos (veiculo_id);
CREATE INDEX IF NOT EXISTS idx_frota_abast_motorista ON frota_abastecimentos (motorista_id);
CREATE INDEX IF NOT EXISTS idx_frota_abast_status    ON frota_abastecimentos (status);
CREATE INDEX IF NOT EXISTS idx_frota_abast_contrato  ON frota_abastecimentos (contrato_id);
CREATE INDEX IF NOT EXISTS idx_frota_abast_data      ON frota_abastecimentos (data_hora);

CREATE UNIQUE INDEX IF NOT EXISTS uq_frota_abast_uuid_cliente
  ON frota_abastecimentos (uuid_cliente) WHERE uuid_cliente IS NOT NULL;

DROP TRIGGER IF EXISTS trg_frota_abast_updated ON frota_abastecimentos;
CREATE TRIGGER trg_frota_abast_updated BEFORE UPDATE ON frota_abastecimentos
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Código sequencial ABAST-AAAA-NNNN (molde da migration 168) ──
CREATE TABLE IF NOT EXISTS frota_abast_contador (
  ano    int PRIMARY KEY,
  ultimo int NOT NULL DEFAULT 0
);
ALTER TABLE frota_abast_contador ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso só via função SECURITY DEFINER abaixo.

CREATE OR REPLACE FUNCTION frota_gerar_codigo_abastecimento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ano int;
  v_num int;
BEGIN
  IF NEW.codigo IS NOT NULL THEN RETURN NEW; END IF;
  v_ano := EXTRACT(YEAR FROM COALESCE(NEW.data_hora, now()))::int;
  INSERT INTO frota_abast_contador (ano, ultimo) VALUES (v_ano, 1)
    ON CONFLICT (ano) DO UPDATE SET ultimo = frota_abast_contador.ultimo + 1
    RETURNING ultimo INTO v_num;
  NEW.codigo := 'ABAST-' || v_ano || '-' || lpad(v_num::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frota_abast_codigo ON frota_abastecimentos;
CREATE TRIGGER trg_frota_abast_codigo BEFORE INSERT ON frota_abastecimentos
  FOR EACH ROW EXECUTE FUNCTION frota_gerar_codigo_abastecimento();

-- ── RLS ──────────────────────────────────────────────────────
-- SELECT: motorista dono do registro, ou quem edita 'frota'.
-- INSERT/UPDATE diretos: bloqueados para o motorista — tudo passa
-- pelas RPCs abaixo. UPDATE direto (correção manual) só p/ gestão.
ALTER TABLE frota_abastecimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_abast_select ON frota_abastecimentos;
CREATE POLICY frota_abast_select ON frota_abastecimentos
  FOR SELECT USING (
    pode_ver('frota')
    OR EXISTS (SELECT 1 FROM frota_motoristas fm WHERE fm.id = motorista_id AND fm.usuario_id = auth.uid())
  );

DROP POLICY IF EXISTS frota_abast_update ON frota_abastecimentos;
CREATE POLICY frota_abast_update ON frota_abastecimentos
  FOR UPDATE USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

-- ════════════════════════════════════════════════════════════
-- RPCs (SECURITY DEFINER, padrão das migrations 155/173)
-- ════════════════════════════════════════════════════════════

-- Registro pelo motorista: idempotente por uuid_cliente (mesmo molde
-- da 173, para casar com a fila offline). Nunca aceita contrato/status
-- do cliente — sempre nasce 'pendente' e sem contrato_id.
CREATE OR REPLACE FUNCTION frota_registrar_abastecimento(
  p_veiculo_id uuid,
  p_medida numeric,
  p_litros numeric,
  p_preco_litro numeric,
  p_valor_total numeric,
  p_tanque_cheio boolean,
  p_viagem_id uuid DEFAULT NULL,
  p_posto_nome text DEFAULT NULL,
  p_foto_cupom_url text DEFAULT NULL,
  p_foto_hodometro_url text DEFAULT NULL,
  p_observacoes text DEFAULT NULL,
  p_uuid_cliente uuid DEFAULT NULL
)
RETURNS frota_abastecimentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id uuid;
  v_medidor      medidor_uso_frota;
  v_abast        frota_abastecimentos;
BEGIN
  IF p_uuid_cliente IS NOT NULL THEN
    SELECT * INTO v_abast FROM frota_abastecimentos
      WHERE uuid_cliente = p_uuid_cliente
        AND motorista_id IN (SELECT id FROM frota_motoristas WHERE usuario_id = auth.uid());
    IF FOUND THEN
      RETURN v_abast;
    END IF;
  END IF;

  SELECT id INTO v_motorista_id
    FROM frota_motoristas WHERE usuario_id = auth.uid() AND ativo AND status = 'ativo';
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  SELECT medidor INTO v_medidor FROM frota_veiculos WHERE id = p_veiculo_id;
  IF v_medidor IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado';
  END IF;
  IF p_medida IS NULL OR p_medida < 0 THEN
    RAISE EXCEPTION 'Medida do % inválida', v_medidor;
  END IF;

  IF p_litros <= 0 OR p_valor_total <= 0 THEN
    RAISE EXCEPTION 'Litros e valor total devem ser maiores que zero';
  END IF;

  BEGIN
    INSERT INTO frota_abastecimentos (
      veiculo_id, motorista_id, viagem_id, data_hora,
      medida_no_abastecimento, litros, preco_litro, valor_total, tanque_cheio,
      posto_nome, foto_cupom_url, foto_hodometro_url, observacoes_motorista,
      status, uuid_cliente
    ) VALUES (
      p_veiculo_id, v_motorista_id, p_viagem_id, now(),
      p_medida, p_litros, p_preco_litro, p_valor_total, COALESCE(p_tanque_cheio, true),
      p_posto_nome, p_foto_cupom_url, p_foto_hodometro_url, p_observacoes,
      'pendente', p_uuid_cliente
    ) RETURNING * INTO v_abast;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_abast FROM frota_abastecimentos WHERE uuid_cliente = p_uuid_cliente;
    IF FOUND THEN
      RETURN v_abast;
    END IF;
    RAISE;
  END;

  RETURN v_abast;
END;
$$;

-- Validação pela gestão: exige contrato_id e pode_editar('frota').
-- Ajustes de litros/valor são opcionais e não apagam o informado pelo
-- motorista (litros/preco_litro/valor_total permanecem intactos).
CREATE OR REPLACE FUNCTION frota_validar_abastecimento(
  p_id uuid, p_contrato_id uuid,
  p_litros_ajust numeric DEFAULT NULL, p_valor_ajust numeric DEFAULT NULL
)
RETURNS frota_abastecimentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_abast frota_abastecimentos;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para validar abastecimentos';
  END IF;
  IF p_contrato_id IS NULL THEN
    RAISE EXCEPTION 'Contrato é obrigatório para validar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM frota_contratos_combustivel WHERE id = p_contrato_id) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
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

CREATE OR REPLACE FUNCTION frota_rejeitar_abastecimento(p_id uuid, p_motivo text)
RETURNS frota_abastecimentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_abast frota_abastecimentos;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para rejeitar abastecimentos';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Motivo da rejeição é obrigatório';
  END IF;

  UPDATE frota_abastecimentos
    SET status = 'rejeitado', motivo_rejeicao = p_motivo,
        validado_por = auth.uid(), validado_em = now()
    WHERE id = p_id AND status = 'pendente'
    RETURNING * INTO v_abast;

  IF v_abast IS NULL THEN
    RAISE EXCEPTION 'Abastecimento não encontrado ou já processado';
  END IF;
  RETURN v_abast;
END;
$$;

-- ── View detalhada (SECURITY INVOKER, padrão 165) ──────────────
CREATE OR REPLACE VIEW vw_frota_abastecimentos_detalhe WITH (security_invoker = true) AS
SELECT
  a.*,
  v.placa, v.modelo, v.medidor,
  fm.nome AS motorista_nome,
  c.numero AS contrato_numero, c.fornecedor AS contrato_fornecedor,
  fr.tipo AS fonte_tipo, fr.codigo AS fonte_codigo, fr.descricao AS fonte_descricao,
  COALESCE(a.litros_ajustado, a.litros) AS litros_final,
  COALESCE(a.valor_ajustado, a.valor_total) AS valor_final
FROM frota_abastecimentos a
JOIN frota_veiculos v ON v.id = a.veiculo_id
JOIN frota_motoristas fm ON fm.id = a.motorista_id
LEFT JOIN frota_contratos_combustivel c ON c.id = a.contrato_id
LEFT JOIN frota_fontes_recurso fr ON fr.id = c.fonte_recurso_id;

-- ── Bucket de fotos (cupom/hodômetro do abastecimento) ────────
-- Motorista faz upload das suas próprias fotos (pasta pelo id do
-- motorista); gestão lê tudo via pode_ver.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('frota-abastecimentos', 'frota-abastecimentos', true, 5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS frota_abast_fotos_read ON storage.objects;
CREATE POLICY frota_abast_fotos_read ON storage.objects
  FOR SELECT USING (bucket_id = 'frota-abastecimentos');

DROP POLICY IF EXISTS frota_abast_fotos_insert ON storage.objects;
CREATE POLICY frota_abast_fotos_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'frota-abastecimentos'
    AND (
      pode_editar('frota')
      OR EXISTS (SELECT 1 FROM frota_motoristas fm WHERE fm.usuario_id = auth.uid() AND fm.ativo)
    )
  );

DROP POLICY IF EXISTS frota_abast_fotos_update ON storage.objects;
CREATE POLICY frota_abast_fotos_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'frota-abastecimentos' AND pode_editar('frota'));

DROP POLICY IF EXISTS frota_abast_fotos_delete ON storage.objects;
CREATE POLICY frota_abast_fotos_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'frota-abastecimentos' AND pode_editar('frota'));
