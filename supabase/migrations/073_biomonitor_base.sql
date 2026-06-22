-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Base
-- Tabelas: programas_biomonitoramento, grupos_biomonitor,
--          monitores_biodiversidade, praias_monitoramento,
--          temporadas_biomonitor
-- Separado do módulo Brigadas; RLS independente.
-- ═══════════════════════════════════════════════════════════

-- ── Enums ────────────────────────────────────────────────────

CREATE TYPE tipo_programa_bio AS ENUM (
  'quelonios', 'aves', 'flora', 'fauna_terrestre', 'peixes', 'outro'
);

CREATE TYPE status_temporada_bio AS ENUM (
  'planejada', 'em_andamento', 'encerrada', 'arquivada'
);

CREATE TYPE funcao_monitor AS ENUM (
  'coordenador', 'monitor', 'auxiliar'
);

CREATE TYPE status_monitor AS ENUM (
  'ativo', 'afastado', 'encerrado'
);

-- ── Programas de Biomonitoramento ────────────────────────────

CREATE TABLE programas_biomonitoramento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          tipo_programa_bio NOT NULL,
  nome          text NOT NULL,
  descricao     text,
  orgao_parceiro text,          -- ICMBio, IBAMA, etc.
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

ALTER TABLE programas_biomonitoramento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prog_bio_select" ON programas_biomonitoramento
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "prog_bio_write" ON programas_biomonitoramento
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

CREATE TRIGGER trg_prog_bio_updated
  BEFORE UPDATE ON programas_biomonitoramento
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Grupos de Monitoramento (equivalente às Brigadas) ─────────

CREATE TABLE grupos_biomonitor (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programa_id         uuid NOT NULL REFERENCES programas_biomonitoramento(id),
  uc_id               uuid NOT NULL REFERENCES unidades_conservacao(id),
  nome                text NOT NULL,

  -- Temporada de atuação do grupo
  temporada_inicio    date,
  temporada_fim       date,

  -- Responsável técnico do SIGUC
  coordenador_nome    text,
  coordenador_contato text,

  observacoes         text,
  ativo               boolean NOT NULL DEFAULT true,
  criado_por          uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em           timestamptz DEFAULT now(),
  atualizado_em       timestamptz DEFAULT now()
);

CREATE INDEX idx_grupos_bio_uc      ON grupos_biomonitor (uc_id);
CREATE INDEX idx_grupos_bio_prog    ON grupos_biomonitor (programa_id);
CREATE INDEX idx_grupos_bio_ativo   ON grupos_biomonitor (uc_id) WHERE ativo = true;

ALTER TABLE grupos_biomonitor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grupos_bio_select" ON grupos_biomonitor
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "grupos_bio_write" ON grupos_biomonitor
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

CREATE TRIGGER trg_grupos_bio_updated
  BEFORE UPDATE ON grupos_biomonitor
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Monitores de Biodiversidade ───────────────────────────────

CREATE TABLE monitores_biodiversidade (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id               uuid NOT NULL REFERENCES grupos_biomonitor(id) ON DELETE CASCADE,

  -- Vínculo com Auth (login Supabase)
  usuario_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Dados pessoais
  nome_completo          text NOT NULL,
  cpf                    varchar(14) NOT NULL,
  rg                     varchar(30),
  data_nascimento        date,
  sexo                   varchar(1) CHECK (sexo IN ('M','F','O')),

  -- Contato
  telefone               varchar(20),
  email                  text,
  municipio_residencia   text,
  comunidade             text,          -- comunidade ribeirinha de origem

  -- Função e situação
  funcao                 funcao_monitor NOT NULL DEFAULT 'monitor',
  status                 status_monitor NOT NULL DEFAULT 'ativo',

  -- Período
  data_inicio            date NOT NULL,
  data_fim               date,

  -- App de campo
  foto_url               text,          -- avatar no app
  deve_trocar_senha      boolean NOT NULL DEFAULT true,

  observacoes            text,
  criado_em              timestamptz DEFAULT now(),
  atualizado_em          timestamptz DEFAULT now(),

  UNIQUE (grupo_id, cpf)
);

CREATE INDEX idx_mon_bio_grupo    ON monitores_biodiversidade (grupo_id);
CREATE INDEX idx_mon_bio_usuario  ON monitores_biodiversidade (usuario_id);
CREATE INDEX idx_mon_bio_status   ON monitores_biodiversidade (grupo_id) WHERE status = 'ativo';

ALTER TABLE monitores_biodiversidade ENABLE ROW LEVEL SECURITY;

-- Monitor vê apenas o próprio registro; gestores veem tudo
CREATE POLICY "mon_bio_select" ON monitores_biodiversidade
  FOR SELECT TO authenticated USING (
    usuario_id = auth.uid()
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

CREATE POLICY "mon_bio_write" ON monitores_biodiversidade
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

-- Monitor pode atualizar foto e info pessoal próprios
CREATE POLICY "mon_bio_self_update" ON monitores_biodiversidade
  FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE TRIGGER trg_mon_bio_updated
  BEFORE UPDATE ON monitores_biodiversidade
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Praias de Monitoramento ───────────────────────────────────

CREATE TABLE praias_monitoramento (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificação
  codigo                   text UNIQUE NOT NULL,   -- AC-RESEX-2025-001
  nome                     text NOT NULL,
  comunidade               text,
  municipio                text,

  -- Localização administrativa
  uc_id                    uuid NOT NULL REFERENCES unidades_conservacao(id),
  programa_id              uuid NOT NULL REFERENCES programas_biomonitoramento(id),

  -- Geometria (PostGIS)
  ponto_acesso             geometry(Point, 4326),       -- GPS de entrada/referência
  area_geom                geometry(MultiPolygon, 4326), -- contorno da faixa de areia
  comprimento_m            numeric(10,2),                -- calculado via trigger
  area_ha                  numeric(10,4),                -- calculado via trigger

  -- Responsável no campo
  monitor_responsavel_id   uuid REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,

  -- Período de monitoramento ativo
  periodo_inicio           date,
  periodo_fim              date,

  ativa                    boolean NOT NULL DEFAULT true,
  observacoes              text,
  criado_por               uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em                timestamptz DEFAULT now(),
  atualizado_em            timestamptz DEFAULT now()
);

CREATE INDEX idx_praias_uc       ON praias_monitoramento (uc_id);
CREATE INDEX idx_praias_prog     ON praias_monitoramento (programa_id);
CREATE INDEX idx_praias_ativa    ON praias_monitoramento (uc_id) WHERE ativa = true;
CREATE INDEX idx_praias_geom_pt  ON praias_monitoramento USING GIST (ponto_acesso)
  WHERE ponto_acesso IS NOT NULL;
CREATE INDEX idx_praias_geom_pol ON praias_monitoramento USING GIST (area_geom)
  WHERE area_geom IS NOT NULL;

ALTER TABLE praias_monitoramento ENABLE ROW LEVEL SECURITY;

-- Todos autenticados leem; gestores/técnicos escrevem; monitores do app leem
CREATE POLICY "praias_select" ON praias_monitoramento
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "praias_write" ON praias_monitoramento
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

-- Trigger que recalcula comprimento_m e area_ha a partir da geometria
CREATE OR REPLACE FUNCTION trg_praias_calcular_metricas()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.area_geom IS NOT NULL THEN
    -- Comprimento: maior dimensão do bounding box em metros (aproximação para praias lineares)
    NEW.comprimento_m := ROUND(
      GREATEST(
        ST_Distance(
          ST_Transform(ST_SetSRID(ST_MakePoint(ST_XMin(ST_Envelope(NEW.area_geom)), ST_YMin(ST_Envelope(NEW.area_geom))), 4326), 32720),
          ST_Transform(ST_SetSRID(ST_MakePoint(ST_XMax(ST_Envelope(NEW.area_geom)), ST_YMax(ST_Envelope(NEW.area_geom))), 32720), 32720)
        )
      )::numeric, 2);
    -- Área em hectares
    NEW.area_ha := ROUND(
      (ST_Area(ST_Transform(NEW.area_geom, 32720)) / 10000.0)::numeric, 4);
    -- Ponto de acesso = centroide se não informado
    IF NEW.ponto_acesso IS NULL THEN
      NEW.ponto_acesso := ST_Centroid(NEW.area_geom);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_praias_metricas
  BEFORE INSERT OR UPDATE OF area_geom ON praias_monitoramento
  FOR EACH ROW EXECUTE FUNCTION trg_praias_calcular_metricas();

CREATE TRIGGER trg_praias_updated
  BEFORE UPDATE ON praias_monitoramento
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Temporadas de Monitoramento ───────────────────────────────

CREATE TABLE temporadas_biomonitor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programa_id   uuid NOT NULL REFERENCES programas_biomonitoramento(id),
  nome          text NOT NULL,           -- "Quelônios 2025"
  ano_base      smallint NOT NULL,
  data_inicio   date NOT NULL,
  data_fim      date NOT NULL,
  status        status_temporada_bio NOT NULL DEFAULT 'planejada',

  -- UCs participantes (array para facilitar filtros)
  uc_ids        uuid[],

  observacoes   text,
  criado_por    uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),

  UNIQUE (programa_id, ano_base)
);

CREATE INDEX idx_temp_bio_prog   ON temporadas_biomonitor (programa_id);
CREATE INDEX idx_temp_bio_status ON temporadas_biomonitor (status);

ALTER TABLE temporadas_biomonitor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "temp_bio_select" ON temporadas_biomonitor
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "temp_bio_write" ON temporadas_biomonitor
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

CREATE TRIGGER trg_temp_bio_updated
  BEFORE UPDATE ON temporadas_biomonitor
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Sessões e Log de Auditoria (monitores) ───────────────────

CREATE TABLE monitor_bio_sessoes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id      uuid        NOT NULL REFERENCES monitores_biodiversidade(id) ON DELETE CASCADE,
  usuario_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  login_em        timestamptz NOT NULL DEFAULT now(),
  ultimo_ping_em  timestamptz NOT NULL DEFAULT now(),
  logout_em       timestamptz,
  dispositivo     text,
  app_versao      text,
  localizacao     geometry(Point, 4326),
  status          text        NOT NULL DEFAULT 'ativa'
                  CHECK (status IN ('ativa','encerrada','expirada')),
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mbsess_monitor   ON monitor_bio_sessoes (monitor_id);
CREATE INDEX idx_mbsess_status    ON monitor_bio_sessoes (status);
CREATE INDEX idx_mbsess_login_em  ON monitor_bio_sessoes (login_em DESC);

ALTER TABLE monitor_bio_sessoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mbsess_select" ON monitor_bio_sessoes FOR SELECT TO authenticated USING (
  usuario_id = auth.uid()
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor','tecnico','super_admin'))
);
CREATE POLICY "mbsess_insert" ON monitor_bio_sessoes FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid());
CREATE POLICY "mbsess_update" ON monitor_bio_sessoes FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid());

-- ── RPC: obter dados do monitor autenticado ──────────────────

CREATE OR REPLACE FUNCTION bio_monitor_atual()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec record;
BEGIN
  SELECT
    m.id,
    m.nome_completo,
    m.funcao,
    m.status,
    m.foto_url,
    m.deve_trocar_senha,
    m.grupo_id,
    g.nome                AS grupo_nome,
    g.programa_id,
    p.tipo                AS programa_tipo,
    p.nome                AS programa_nome,
    uc.id                 AS uc_id,
    uc.nome               AS uc_nome,
    uc.sigla              AS uc_sigla
  INTO v_rec
  FROM monitores_biodiversidade m
  JOIN grupos_biomonitor g    ON g.id = m.grupo_id
  JOIN programas_biomonitoramento p ON p.id = g.programa_id
  JOIN unidades_conservacao uc ON uc.id = g.uc_id
  WHERE m.usuario_id = auth.uid()
    AND m.status = 'ativo'
  LIMIT 1;

  IF v_rec IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_rec);
END;
$$;
GRANT EXECUTE ON FUNCTION bio_monitor_atual TO authenticated;

-- ── RPC: iniciar sessão do monitor ───────────────────────────

CREATE OR REPLACE FUNCTION bio_monitor_iniciar_sessao(
  p_dispositivo text  DEFAULT NULL,
  p_app_versao  text  DEFAULT NULL,
  p_lat         float DEFAULT NULL,
  p_lng         float DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mon_id  uuid;
  v_sess_id uuid;
BEGIN
  SELECT id INTO v_mon_id
    FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo';

  IF v_mon_id IS NULL THEN
    RAISE EXCEPTION 'Monitor ativo não encontrado para este usuário';
  END IF;

  -- Expira sessões abertas sem ping há mais de 4h
  UPDATE monitor_bio_sessoes
     SET status = 'expirada', logout_em = now()
   WHERE monitor_id = v_mon_id
     AND status = 'ativa'
     AND ultimo_ping_em < now() - interval '4 hours';

  INSERT INTO monitor_bio_sessoes
    (monitor_id, usuario_id, dispositivo, app_versao, localizacao)
  VALUES (
    v_mon_id, auth.uid(), p_dispositivo, p_app_versao,
    CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)
         ELSE NULL END
  )
  RETURNING id INTO v_sess_id;

  RETURN v_sess_id;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_monitor_iniciar_sessao TO authenticated;

-- ── View: grupos com resumo ───────────────────────────────────

CREATE OR REPLACE VIEW vw_grupos_biomonitor AS
SELECT
  g.id,
  g.nome,
  g.ativo,
  g.temporada_inicio,
  g.temporada_fim,
  g.coordenador_nome,
  p.tipo        AS programa_tipo,
  p.nome        AS programa_nome,
  uc.nome       AS uc_nome,
  uc.sigla      AS uc_sigla,
  COUNT(m.id) FILTER (WHERE m.status = 'ativo')  AS monitores_ativos,
  COUNT(m.id)                                     AS monitores_total,
  g.criado_em,
  g.atualizado_em
FROM grupos_biomonitor g
JOIN programas_biomonitoramento p ON p.id = g.programa_id
JOIN unidades_conservacao uc ON uc.id = g.uc_id
LEFT JOIN monitores_biodiversidade m ON m.grupo_id = g.id
GROUP BY g.id, p.id, uc.id;

-- ── Seed: programa Quelônios ──────────────────────────────────

INSERT INTO programas_biomonitoramento (tipo, nome, descricao, orgao_parceiro)
VALUES (
  'quelonios',
  'Monitoramento de Quelônios',
  'Proteção e monitoramento de ninhos de tartarugas aquáticas em praias fluviais',
  'ICMBio'
)
ON CONFLICT DO NOTHING;
