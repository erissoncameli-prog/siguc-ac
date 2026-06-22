-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Módulo Quelônios
-- Tabelas: ninhos_quelonios, transferencias_ninho,
--          eclosoes_ninho + View vw_praias_biomonitor
-- Depende de 073_biomonitor_base.
-- ═══════════════════════════════════════════════════════════

-- ── Enums específicos de quelônios ───────────────────────────

CREATE TYPE especie_quelonio AS ENUM (
  'tracaja',      -- Podocnemis unifilis (TR)
  'tartaruga',    -- Podocnemis expansa  (TA)
  'cabecudo',     -- Podocnemis sextuberculata (R)
  'pitiU',        -- Podocnemis erythrocephala (C)
  'cupido',       -- Podocnemis cayennensis
  'jabuti_pe_elefante', -- Chelonoidis denticulatus
  'jabuti_piranga',     -- Chelonoidis carbonarius
  'mucua',        -- Kinosternon scorpioides
  'outro'
);

CREATE TYPE status_ninho AS ENUM (
  'encontrado',   -- apenas registrado
  'transferido',  -- ovos transferidos para local mais seguro
  'eclodido',     -- eclosão registrada
  'perdido'       -- predação total / ninho destruído antes da eclosão
);

CREATE TYPE status_validacao_bio AS ENUM (
  'pendente', 'validado', 'rejeitado', 'em_correcao'
);

CREATE TYPE predacao_ninho AS ENUM (
  'nenhuma', 'por_pessoas', 'por_animais'
);

-- ── Ninhos de Quelônios ───────────────────────────────────────

CREATE TABLE ninhos_quelonios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Idempotência offline: o app gera este UUID antes de ter sinal
  uuid_cliente    uuid UNIQUE NOT NULL,

  -- Identificação física
  numero_ninho    text NOT NULL,   -- código na placa (ex: "P01-2025-047")

  -- Localização
  praia_id        uuid REFERENCES praias_monitoramento(id) ON DELETE SET NULL,
  uc_id           uuid REFERENCES unidades_conservacao(id),
  municipio       text,

  -- Espécie
  especie         especie_quelonio NOT NULL,

  -- GPS capturado pelo app
  localizacao     geometry(Point, 4326),
  precisao_gps_m  numeric(8,1),

  -- Data de encontro
  data_encontro   date NOT NULL,

  -- Temporada (derivada da data_encontro; pode ser preenchida no sync)
  temporada_id    uuid REFERENCES temporadas_biomonitor(id) ON DELETE SET NULL,

  -- Fotos da postura
  foto_urls       text[],

  -- Status do ciclo
  status          status_ninho NOT NULL DEFAULT 'encontrado',

  -- Validação pelo DEBIO/biólogo
  status_validacao  status_validacao_bio NOT NULL DEFAULT 'pendente',
  motivo_rejeicao   text,
  validado_por      uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  validado_em       timestamptz,

  -- Observações gerais
  observacoes     text,

  -- Quem registrou
  monitor_id      uuid REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  grupo_id        uuid REFERENCES grupos_biomonitor(id) ON DELETE SET NULL,

  -- Controle de sync
  sincronizado_em timestamptz,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now(),

  UNIQUE (praia_id, numero_ninho, data_encontro)
);

CREATE INDEX idx_ninhos_praia      ON ninhos_quelonios (praia_id);
CREATE INDEX idx_ninhos_uc         ON ninhos_quelonios (uc_id);
CREATE INDEX idx_ninhos_monitor    ON ninhos_quelonios (monitor_id);
CREATE INDEX idx_ninhos_grupo      ON ninhos_quelonios (grupo_id);
CREATE INDEX idx_ninhos_temp       ON ninhos_quelonios (temporada_id);
CREATE INDEX idx_ninhos_status     ON ninhos_quelonios (status);
CREATE INDEX idx_ninhos_validacao  ON ninhos_quelonios (status_validacao);
CREATE INDEX idx_ninhos_data       ON ninhos_quelonios (data_encontro DESC);
CREATE INDEX idx_ninhos_geom       ON ninhos_quelonios USING GIST (localizacao)
  WHERE localizacao IS NOT NULL;

ALTER TABLE ninhos_quelonios ENABLE ROW LEVEL SECURITY;

-- Monitor vê apenas ninhos do próprio grupo; gestores veem tudo
CREATE POLICY "ninhos_select" ON ninhos_quelonios
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM monitores_biodiversidade m
      WHERE m.usuario_id = auth.uid() AND m.grupo_id = ninhos_quelonios.grupo_id
    )
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
  );

-- Monitor pode inserir seus próprios ninhos
CREATE POLICY "ninhos_insert" ON ninhos_quelonios
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM monitores_biodiversidade m
      WHERE m.usuario_id = auth.uid() AND m.id = ninhos_quelonios.monitor_id
    )
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

-- Monitor pode atualizar seus próprios ninhos (transferência e eclosão)
CREATE POLICY "ninhos_monitor_update" ON ninhos_quelonios
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM monitores_biodiversidade m
      WHERE m.usuario_id = auth.uid() AND m.id = ninhos_quelonios.monitor_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM monitores_biodiversidade m
      WHERE m.usuario_id = auth.uid() AND m.id = ninhos_quelonios.monitor_id
    )
  );

-- Gestores e biólogos podem atualizar qualquer ninho (validação)
CREATE POLICY "ninhos_gestor_update" ON ninhos_quelonios
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
  );

CREATE TRIGGER trg_ninhos_updated
  BEFORE UPDATE ON ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Trigger: deriva temporada_id automaticamente pela data_encontro
CREATE OR REPLACE FUNCTION trg_ninhos_derivar_temporada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prog_id uuid;
  v_temp_id uuid;
BEGIN
  -- obtém programa via grupo
  SELECT g.programa_id INTO v_prog_id
    FROM grupos_biomonitor g
   WHERE g.id = NEW.grupo_id;

  IF v_prog_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_temp_id
    FROM temporadas_biomonitor
   WHERE programa_id = v_prog_id
     AND NEW.data_encontro BETWEEN data_inicio AND data_fim
   LIMIT 1;

  NEW.temporada_id := v_temp_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ninhos_temporada
  BEFORE INSERT OR UPDATE OF data_encontro, grupo_id ON ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_ninhos_derivar_temporada();

-- ── Transferências de Ninho ───────────────────────────────────

CREATE TABLE transferencias_ninho (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente        uuid UNIQUE NOT NULL,

  ninho_id            uuid NOT NULL REFERENCES ninhos_quelonios(id) ON DELETE CASCADE,

  data_transferencia  date NOT NULL,
  qtd_ovos            smallint NOT NULL CHECK (qtd_ovos >= 0),
  local_destino       text,             -- descrição do local de transferência
  localizacao_destino geometry(Point, 4326),

  observacoes         text,
  monitor_id          uuid REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,

  sincronizado_em     timestamptz,
  criado_em           timestamptz DEFAULT now(),
  atualizado_em       timestamptz DEFAULT now()
);

CREATE INDEX idx_transf_ninho   ON transferencias_ninho (ninho_id);
CREATE INDEX idx_transf_monitor ON transferencias_ninho (monitor_id);

ALTER TABLE transferencias_ninho ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transf_select" ON transferencias_ninho
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM ninhos_quelonios n
      JOIN monitores_biodiversidade m ON m.grupo_id = n.grupo_id
      WHERE n.id = transferencias_ninho.ninho_id AND m.usuario_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
  );

CREATE POLICY "transf_insert" ON transferencias_ninho
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM monitores_biodiversidade m
      WHERE m.usuario_id = auth.uid() AND m.id = transferencias_ninho.monitor_id
    )
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

CREATE POLICY "transf_update" ON transferencias_ninho
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM monitores_biodiversidade m WHERE m.usuario_id = auth.uid() AND m.id = transferencias_ninho.monitor_id)
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
  );

CREATE TRIGGER trg_transf_updated
  BEFORE UPDATE ON transferencias_ninho
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Trigger: atualiza status do ninho ao registrar transferência
CREATE OR REPLACE FUNCTION trg_transf_atualizar_status_ninho()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE ninhos_quelonios
     SET status = 'transferido', atualizado_em = now()
   WHERE id = NEW.ninho_id
     AND status = 'encontrado';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transf_status
  AFTER INSERT ON transferencias_ninho
  FOR EACH ROW EXECUTE FUNCTION trg_transf_atualizar_status_ninho();

-- ── Eclosões de Ninho ─────────────────────────────────────────

CREATE TABLE eclosoes_ninho (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente        uuid UNIQUE NOT NULL,

  ninho_id            uuid NOT NULL REFERENCES ninhos_quelonios(id) ON DELETE CASCADE,

  data_nascimento     date NOT NULL,
  filhotes_vivos      smallint NOT NULL DEFAULT 0 CHECK (filhotes_vivos >= 0),
  filhotes_mortos     smallint NOT NULL DEFAULT 0 CHECK (filhotes_mortos >= 0),
  ovos_nao_nascidos   smallint NOT NULL DEFAULT 0 CHECK (ovos_nao_nascidos >= 0),
  predacao            predacao_ninho NOT NULL DEFAULT 'nenhuma',

  foto_urls           text[],
  observacoes         text,
  monitor_id          uuid REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,

  sincronizado_em     timestamptz,
  criado_em           timestamptz DEFAULT now(),
  atualizado_em       timestamptz DEFAULT now(),

  -- Evita registrar duas eclosões para o mesmo ninho
  UNIQUE (ninho_id)
);

CREATE INDEX idx_eclosao_ninho   ON eclosoes_ninho (ninho_id);
CREATE INDEX idx_eclosao_monitor ON eclosoes_ninho (monitor_id);
CREATE INDEX idx_eclosao_data    ON eclosoes_ninho (data_nascimento DESC);

ALTER TABLE eclosoes_ninho ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eclosao_select" ON eclosoes_ninho
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM ninhos_quelonios n
      JOIN monitores_biodiversidade m ON m.grupo_id = n.grupo_id
      WHERE n.id = eclosoes_ninho.ninho_id AND m.usuario_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
  );

CREATE POLICY "eclosao_insert" ON eclosoes_ninho
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM monitores_biodiversidade m
      WHERE m.usuario_id = auth.uid() AND m.id = eclosoes_ninho.monitor_id
    )
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

CREATE POLICY "eclosao_update" ON eclosoes_ninho
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM monitores_biodiversidade m WHERE m.usuario_id = auth.uid() AND m.id = eclosoes_ninho.monitor_id)
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
  );

CREATE TRIGGER trg_eclosao_updated
  BEFORE UPDATE ON eclosoes_ninho
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Trigger: marca ninho como 'eclodido' ao registrar eclosão
CREATE OR REPLACE FUNCTION trg_eclosao_atualizar_status_ninho()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE ninhos_quelonios
     SET status = 'eclodido', atualizado_em = now()
   WHERE id = NEW.ninho_id
     AND status IN ('encontrado','transferido');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_eclosao_status
  AFTER INSERT ON eclosoes_ninho
  FOR EACH ROW EXECUTE FUNCTION trg_eclosao_atualizar_status_ninho();

-- ── View principal: praias com estatísticas ───────────────────

CREATE OR REPLACE VIEW vw_praias_biomonitor
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.codigo,
  p.nome,
  p.comunidade,
  p.municipio,
  p.comprimento_m,
  p.area_ha,
  p.periodo_inicio,
  p.periodo_fim,
  p.ativa,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_Y(p.ponto_acesso) END AS lat,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_X(p.ponto_acesso) END AS lng,
  m.nome_completo   AS monitor_responsavel,
  uc.nome           AS uc_nome,
  uc.sigla          AS uc_sigla,
  prog.nome         AS programa_nome,

  -- Ninhos por status
  COUNT(DISTINCT n.id)                                               AS ninhos_total,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'encontrado')        AS ninhos_encontrados,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'transferido')       AS ninhos_transferidos,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'eclodido')          AS ninhos_eclodidos,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'perdido')           AS ninhos_perdidos,

  -- Por espécie
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'tracaja')          AS ninhos_tracaja,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'tartaruga')        AS ninhos_tartaruga,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'cabecudo')         AS ninhos_cabecudo,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'pitiU')            AS ninhos_pitiu,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'cupido')           AS ninhos_cupido,

  -- Validação
  COUNT(DISTINCT n.id) FILTER (WHERE n.status_validacao = 'pendente') AS ninhos_pendentes_validacao,

  -- Ovos e eclosão
  COALESCE(SUM(t.qtd_ovos), 0)                                      AS ovos_transferidos,
  COALESCE(SUM(e.filhotes_vivos), 0)                                 AS filhotes_vivos,
  COALESCE(SUM(e.filhotes_mortos), 0)                                AS filhotes_mortos,
  COALESCE(SUM(e.ovos_nao_nascidos), 0)                              AS ovos_nao_nascidos,
  ROUND(
    100.0 * COALESCE(SUM(e.filhotes_vivos), 0) /
    NULLIF(COALESCE(SUM(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0), 0)
  , 1)                                                               AS taxa_eclosao_pct,

  -- Predação
  COUNT(*) FILTER (WHERE e.predacao = 'por_pessoas')                 AS predacao_pessoas,
  COUNT(*) FILTER (WHERE e.predacao = 'por_animais')                 AS predacao_animais

FROM praias_monitoramento p
LEFT JOIN monitores_biodiversidade mb ON mb.id = p.monitor_responsavel_id
LEFT JOIN usuarios m   ON m.id = mb.usuario_id
LEFT JOIN unidades_conservacao uc   ON uc.id = p.uc_id
LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
LEFT JOIN ninhos_quelonios n        ON n.praia_id = p.id
LEFT JOIN transferencias_ninho t    ON t.ninho_id = n.id
LEFT JOIN eclosoes_ninho e          ON e.ninho_id = n.id
GROUP BY p.id, m.nome_completo, uc.id, prog.id, mb.id;

-- ── RPC: estatísticas da temporada para o monitor ─────────────

CREATE OR REPLACE FUNCTION bio_meus_dados(
  p_temporada_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mon_id  uuid;
  v_grupo_id uuid;
  v_result  jsonb;
BEGIN
  SELECT id, grupo_id INTO v_mon_id, v_grupo_id
    FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo'
   LIMIT 1;

  IF v_mon_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'meus_ninhos',         COUNT(*)                                          FILTER (WHERE n.monitor_id = v_mon_id),
    'grupo_ninhos',        COUNT(*),
    'eclodidos',           COUNT(*) FILTER (WHERE n.status = 'eclodido'),
    'pendentes',           COUNT(*) FILTER (WHERE n.status = 'encontrado'),
    'filhotes_vivos',      COALESCE(SUM(e.filhotes_vivos), 0),
    'filhotes_mortos',     COALESCE(SUM(e.filhotes_mortos), 0),
    'ovos_nao_nascidos',   COALESCE(SUM(e.ovos_nao_nascidos), 0),
    'taxa_eclosao_pct',    ROUND(100.0 * COALESCE(SUM(e.filhotes_vivos),0) /
                             NULLIF(COALESCE(SUM(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos),0), 0), 1)
  ) INTO v_result
  FROM ninhos_quelonios n
  LEFT JOIN eclosoes_ninho e ON e.ninho_id = n.id
  WHERE n.grupo_id = v_grupo_id
    AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id);

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_meus_dados TO authenticated;

-- ── View de validação (para admin) ───────────────────────────

CREATE OR REPLACE VIEW vw_ninhos_validacao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.especie,
  n.data_encontro,
  n.status,
  n.status_validacao,
  n.motivo_rejeicao,
  n.observacoes,
  n.foto_urls,
  n.criado_em,
  n.sincronizado_em,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_Y(n.localizacao) END AS lat,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_X(n.localizacao) END AS lng,
  n.precisao_gps_m,
  p.nome        AS praia_nome,
  p.codigo      AS praia_codigo,
  uc.nome       AS uc_nome,
  mon.nome_completo AS monitor_nome,
  g.nome        AS grupo_nome,
  t.data_transferencia,
  t.qtd_ovos,
  t.local_destino,
  e.data_nascimento,
  e.filhotes_vivos,
  e.filhotes_mortos,
  e.ovos_nao_nascidos,
  e.predacao
FROM ninhos_quelonios n
LEFT JOIN praias_monitoramento p   ON p.id = n.praia_id
LEFT JOIN unidades_conservacao uc  ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
LEFT JOIN grupos_biomonitor g      ON g.id = n.grupo_id
LEFT JOIN transferencias_ninho t   ON t.ninho_id = n.id
LEFT JOIN eclosoes_ninho e         ON e.ninho_id = n.id;
