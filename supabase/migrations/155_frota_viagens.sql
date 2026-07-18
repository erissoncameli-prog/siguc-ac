-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota (Setor de Transporte) — Fase 2: viagens
-- Solicitação → aprovação (setor de transporte) → check-out →
-- check-in (diário de bordo digital). Conflito de agenda de
-- veículo/motorista bloqueado no banco (EXCLUDE/gist).
-- Toda mudança de estado passa por RPC SECURITY DEFINER — sem
-- UPDATE direto de solicitante/motorista via RLS.
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_viagem_frota') THEN
    CREATE TYPE status_viagem_frota AS ENUM
      ('solicitada','aprovada','recusada','em_andamento','concluida','cancelada');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS frota_viagens (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitante_id        uuid NOT NULL REFERENCES usuarios(id),
  setor_solicitante_id  uuid REFERENCES unidades_organizacionais(id),
  destino               text NOT NULL,
  uc_destino_id         uuid REFERENCES unidades_conservacao(id),
  finalidade            text NOT NULL,
  passageiros           smallint,
  data_saida_prevista   timestamptz NOT NULL,
  data_retorno_prevista timestamptz NOT NULL,
  status                status_viagem_frota NOT NULL DEFAULT 'solicitada',

  veiculo_id            uuid REFERENCES frota_veiculos(id),
  motorista_id          uuid REFERENCES frota_motoristas(id),
  aprovado_por          uuid REFERENCES usuarios(id),
  aprovado_em           timestamptz,
  motivo_recusa         text,

  km_saida              numeric(10,1),
  horas_saida           numeric(10,1),
  combustivel_saida_pct smallint,
  checkout_em           timestamptz,

  km_chegada            numeric(10,1),
  horas_chegada         numeric(10,1),
  combustivel_chegada_pct smallint,
  checkin_em            timestamptz,
  observacoes_checkin   text,
  avarias               text,

  cancelado_por         uuid REFERENCES usuarios(id),
  cancelado_em          timestamptz,
  motivo_cancelamento   text,

  criado_em             timestamptz DEFAULT now(),
  atualizado_em         timestamptz DEFAULT now(),

  CONSTRAINT chk_frota_viagem_periodo CHECK (data_retorno_prevista > data_saida_prevista),

  -- Conflito de agenda: mesmo veículo/motorista não pode ter duas viagens
  -- aprovadas/em andamento com período sobreposto.
  CONSTRAINT uq_frota_viagem_veiculo_periodo EXCLUDE USING gist (
    veiculo_id WITH =,
    tstzrange(data_saida_prevista, data_retorno_prevista, '[]') WITH &&
  ) WHERE (status IN ('aprovada','em_andamento') AND veiculo_id IS NOT NULL),

  CONSTRAINT uq_frota_viagem_motorista_periodo EXCLUDE USING gist (
    motorista_id WITH =,
    tstzrange(data_saida_prevista, data_retorno_prevista, '[]') WITH &&
  ) WHERE (status IN ('aprovada','em_andamento') AND motorista_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_frota_viag_solicitante ON frota_viagens (solicitante_id);
CREATE INDEX IF NOT EXISTS idx_frota_viag_veiculo      ON frota_viagens (veiculo_id);
CREATE INDEX IF NOT EXISTS idx_frota_viag_motorista     ON frota_viagens (motorista_id);
CREATE INDEX IF NOT EXISTS idx_frota_viag_status        ON frota_viagens (status);
CREATE INDEX IF NOT EXISTS idx_frota_viag_periodo       ON frota_viagens (data_saida_prevista);

DROP TRIGGER IF EXISTS trg_frota_viag_updated ON frota_viagens;
CREATE TRIGGER trg_frota_viag_updated BEFORE UPDATE ON frota_viagens
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── RLS ──────────────────────────────────────────────────────
-- Leitura: dono da solicitação, motorista escalado, ou quem edita 'frota'.
-- Escrita direta: só quem edita 'frota' (cadastro/correção manual).
-- Toda transição de estado (aprovar/recusar/cancelar/checkout/checkin)
-- passa pelas RPCs abaixo, que fazem sua própria checagem de permissão.
ALTER TABLE frota_viagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_viag_select ON frota_viagens;
CREATE POLICY frota_viag_select ON frota_viagens
  FOR SELECT USING (
    solicitante_id = auth.uid()
    OR pode_ver('frota')
    OR EXISTS (SELECT 1 FROM frota_motoristas fm WHERE fm.id = motorista_id AND fm.usuario_id = auth.uid())
  );

DROP POLICY IF EXISTS frota_viag_insert ON frota_viagens;
CREATE POLICY frota_viag_insert ON frota_viagens
  FOR INSERT WITH CHECK (
    solicitante_id = auth.uid()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.ativo)
  );

DROP POLICY IF EXISTS frota_viag_update ON frota_viagens;
CREATE POLICY frota_viag_update ON frota_viagens
  FOR UPDATE USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

-- ════════════════════════════════════════════════════════════
-- RPCs de transição de estado (SECURITY DEFINER)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_aprovar_viagem(p_viagem_id uuid, p_veiculo_id uuid, p_motorista_id uuid)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem frota_viagens;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar viagens';
  END IF;

  IF NOT frota_motorista_apto(p_motorista_id) THEN
    RAISE EXCEPTION 'Motorista inapto: habilitação vencida ou inativo';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM frota_veiculos WHERE id = p_veiculo_id AND ativo AND status <> 'baixado') THEN
    RAISE EXCEPTION 'Veículo indisponível';
  END IF;

  BEGIN
    UPDATE frota_viagens
      SET status = 'aprovada', veiculo_id = p_veiculo_id, motorista_id = p_motorista_id,
          aprovado_por = auth.uid(), aprovado_em = now()
      WHERE id = p_viagem_id AND status = 'solicitada'
      RETURNING * INTO v_viagem;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Veículo ou motorista já alocado em outra viagem neste período';
  END;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou já processada';
  END IF;
  RETURN v_viagem;
END;
$$;

CREATE OR REPLACE FUNCTION frota_recusar_viagem(p_viagem_id uuid, p_motivo text)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem frota_viagens;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para recusar viagens';
  END IF;

  UPDATE frota_viagens
    SET status = 'recusada', motivo_recusa = p_motivo, aprovado_por = auth.uid(), aprovado_em = now()
    WHERE id = p_viagem_id AND status = 'solicitada'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou já processada';
  END IF;
  RETURN v_viagem;
END;
$$;

CREATE OR REPLACE FUNCTION frota_cancelar_viagem(p_viagem_id uuid, p_motivo text)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem frota_viagens;
BEGIN
  UPDATE frota_viagens
    SET status = 'cancelada', cancelado_por = auth.uid(), cancelado_em = now(), motivo_cancelamento = p_motivo
    WHERE id = p_viagem_id AND status IN ('solicitada','aprovada')
      AND (solicitante_id = auth.uid() OR pode_editar('frota'))
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada, sem permissão ou já em andamento/concluída';
  END IF;
  RETURN v_viagem;
END;
$$;

-- Confere se o usuário corrente pode operar (checkout/checkin) a viagem:
-- quem edita 'frota', ou o motorista escalado logando com o próprio usuário.
CREATE OR REPLACE FUNCTION frota_pode_operar_viagem(p_viagem_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pode_editar('frota') OR EXISTS (
    SELECT 1 FROM frota_viagens v
    JOIN frota_motoristas fm ON fm.id = v.motorista_id
    WHERE v.id = p_viagem_id AND fm.usuario_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION frota_checkout_viagem(p_viagem_id uuid, p_medida numeric, p_combustivel_pct smallint)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem  frota_viagens;
  v_medidor medidor_uso_frota;
BEGIN
  IF NOT frota_pode_operar_viagem(p_viagem_id) THEN
    RAISE EXCEPTION 'Sem permissão para iniciar esta viagem';
  END IF;

  SELECT medidor INTO v_medidor FROM frota_veiculos v
    JOIN frota_viagens fv ON fv.veiculo_id = v.id WHERE fv.id = p_viagem_id;

  UPDATE frota_viagens
    SET status = 'em_andamento', checkout_em = now(),
        km_saida   = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
        horas_saida = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
        combustivel_saida_pct = p_combustivel_pct
    WHERE id = p_viagem_id AND status = 'aprovada'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou não está aprovada';
  END IF;

  UPDATE frota_veiculos SET status = 'em_viagem' WHERE id = v_viagem.veiculo_id;
  RETURN v_viagem;
END;
$$;

CREATE OR REPLACE FUNCTION frota_checkin_viagem(
  p_viagem_id uuid, p_medida numeric, p_combustivel_pct smallint,
  p_observacoes text, p_avarias text
)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem  frota_viagens;
  v_medidor medidor_uso_frota;
BEGIN
  IF NOT frota_pode_operar_viagem(p_viagem_id) THEN
    RAISE EXCEPTION 'Sem permissão para concluir esta viagem';
  END IF;

  SELECT medidor INTO v_medidor FROM frota_veiculos v
    JOIN frota_viagens fv ON fv.veiculo_id = v.id WHERE fv.id = p_viagem_id;

  UPDATE frota_viagens
    SET status = 'concluida', checkin_em = now(),
        km_chegada    = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
        horas_chegada = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
        combustivel_chegada_pct = p_combustivel_pct,
        observacoes_checkin = p_observacoes,
        avarias = NULLIF(p_avarias, '')
    WHERE id = p_viagem_id AND status = 'em_andamento'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou não está em andamento';
  END IF;

  UPDATE frota_veiculos
    SET status = CASE WHEN v_viagem.avarias IS NOT NULL THEN 'em_manutencao' ELSE 'disponivel' END,
        hodometro_km    = CASE WHEN v_medidor = 'hodometro' AND p_medida > hodometro_km THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' AND p_medida > horimetro_horas THEN p_medida ELSE horimetro_horas END
    WHERE id = v_viagem.veiculo_id;

  RETURN v_viagem;
END;
$$;

-- Nome do solicitante via função (não join direto): a RLS de `usuarios`
-- só libera auto-leitura ou perfil super_admin/gestor — um INNER JOIN
-- faria a viagem inteira sumir da view para quem aprova (ex.:
-- assistente_admin) sem ver o solicitante. A função expõe só o nome,
-- e só é alcançável por quem já enxerga a linha de frota_viagens (RLS
-- da própria tabela) — mesmo padrão de exposição mínima usado em
-- is_super_admin()/RPCs de AAP.
CREATE OR REPLACE FUNCTION frota_nome_usuario(p_usuario_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT nome_completo FROM usuarios WHERE id = p_usuario_id;
$$;

-- ── VIEW de detalhe (join p/ telas de agenda/app do motorista) ─
CREATE OR REPLACE VIEW vw_frota_viagens_detalhe AS
SELECT
  fv.*,
  frota_nome_usuario(fv.solicitante_id) AS solicitante_nome,
  s.sigla           AS setor_sigla,
  s.nome            AS setor_nome,
  v.placa           AS veiculo_placa,
  v.modelo          AS veiculo_modelo,
  v.tipo            AS veiculo_tipo,
  v.medidor         AS veiculo_medidor,
  m.nome            AS motorista_nome,
  m.usuario_id      AS motorista_usuario_id
FROM frota_viagens fv
LEFT JOIN unidades_organizacionais s ON s.id = fv.setor_solicitante_id
LEFT JOIN frota_veiculos v         ON v.id = fv.veiculo_id
LEFT JOIN frota_motoristas m       ON m.id = fv.motorista_id;

-- Sem entrada própria no catálogo `modulos` para estas 3 telas — mesmo
-- padrão do "App de Campo" das Brigadas: acesso não é RBAC por módulo,
-- e sim pela própria RLS de frota_viagens (solicitante vê o que pediu;
-- motorista vê o que lhe foi escalado) ou, no caso da agenda de
-- aprovação, pela chave 'frota' já usada em frota-veiculos.html (mesmo
-- time do setor de transporte). Registrar uma chave separada aqui sem
-- que o código de fato a consulte daria a falsa impressão, no painel de
-- permissões, de que dá para revogar acesso por usuário nessas telas.
