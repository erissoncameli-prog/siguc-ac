-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Estrutura Organizacional SEMA-AC
-- Módulo A: unidades, cargos, ocupações e delegações
-- ═══════════════════════════════════════════════════════════

-- Extensões
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Enums ──────────────────────────────────────────────────

CREATE TYPE tipo_unidade_org AS ENUM (
  'secretaria', 'diretoria', 'departamento', 'coordenacao', 'setor'
);

CREATE TYPE tipo_cargo AS ENUM (
  'cargo_efetivo', 'cargo_comissionado', 'funcao_gratificada'
);

CREATE TYPE nivel_hierarquico AS ENUM (
  'secretario', 'diretor', 'coordenador', 'chefe_deuc',
  'gestor_uc', 'analista_uc', 'pesquisador_externo'
);

-- ── Unidades Organizacionais ────────────────────────────────

CREATE TABLE unidades_organizacionais (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sigla         varchar(20) NOT NULL UNIQUE,
  nome          text NOT NULL,
  tipo          tipo_unidade_org NOT NULL,
  pai_id        uuid REFERENCES unidades_organizacionais(id),
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

-- ── Cargos ─────────────────────────────────────────────────

CREATE TABLE cargos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_org_id uuid NOT NULL REFERENCES unidades_organizacionais(id),
  denominacao    text NOT NULL,
  tipo           tipo_cargo NOT NULL,
  nivel          nivel_hierarquico NOT NULL,
  simbolo        varchar(20),
  uc_id          uuid REFERENCES unidades_conservacao(id),
  descricao      text,
  ativo          boolean NOT NULL DEFAULT true,
  criado_em      timestamptz DEFAULT now(),
  atualizado_em  timestamptz DEFAULT now()
);

-- ── Ocupações de Cargo ──────────────────────────────────────
-- Separa CARGO (permanente) de OCUPANTE (substituível por portaria)

CREATE TABLE cargo_ocupacoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_id      uuid NOT NULL REFERENCES cargos(id) ON DELETE CASCADE,
  usuario_id    uuid NOT NULL REFERENCES usuarios(id),
  portaria      text,
  data_inicio   date NOT NULL,
  data_fim      date,
  observacoes   text,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),

  -- Garante que um cargo só tem um ocupante vigente por vez
  CONSTRAINT uq_cargo_vigente EXCLUDE USING gist (
    cargo_id WITH =,
    daterange(data_inicio, COALESCE(data_fim, '9999-12-31'), '[)') WITH &&
  )
);

-- ── Delegações Temporárias ─────────────────────────────────

CREATE TABLE delegacoes_temporarias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_id      uuid NOT NULL REFERENCES cargos(id) ON DELETE CASCADE,
  delegante_id  uuid NOT NULL REFERENCES usuarios(id),
  delegado_id   uuid NOT NULL REFERENCES usuarios(id),
  portaria      text,
  data_inicio   date NOT NULL,
  data_fim      date NOT NULL,
  motivo        text,
  ativa         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

-- ── Índices ─────────────────────────────────────────────────

CREATE INDEX idx_unid_org_pai      ON unidades_organizacionais (pai_id);
CREATE INDEX idx_cargos_unid       ON cargos (unidade_org_id);
CREATE INDEX idx_cargos_uc         ON cargos (uc_id);
CREATE INDEX idx_ocupacoes_cargo   ON cargo_ocupacoes (cargo_id);
CREATE INDEX idx_ocupacoes_usuario ON cargo_ocupacoes (usuario_id);
CREATE INDEX idx_ocupacoes_vigente ON cargo_ocupacoes (cargo_id) WHERE data_fim IS NULL;
CREATE INDEX idx_delegacoes_ativa  ON delegacoes_temporarias (cargo_id) WHERE ativa = true;

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE unidades_organizacionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargos                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_ocupacoes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegacoes_temporarias   ENABLE ROW LEVEL SECURITY;

-- Unidades organizacionais: todos autenticados visualizam; só super_admin altera
CREATE POLICY "unid_org_select" ON unidades_organizacionais
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "unid_org_admin" ON unidades_organizacionais
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil = 'super_admin' AND u.ativo)
  );

-- Cargos: todos autenticados visualizam; só super_admin altera
CREATE POLICY "cargos_select" ON cargos
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "cargos_admin" ON cargos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil = 'super_admin' AND u.ativo)
  );

-- Ocupações: super_admin tudo; gestor INSERT/UPDATE; demais SELECT
CREATE POLICY "ocupacoes_select" ON cargo_ocupacoes
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "ocupacoes_admin" ON cargo_ocupacoes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil = 'super_admin' AND u.ativo)
  );

CREATE POLICY "ocupacoes_gestor_insert" ON cargo_ocupacoes
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil = 'gestor' AND u.ativo)
  );

CREATE POLICY "ocupacoes_gestor_update" ON cargo_ocupacoes
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil = 'gestor' AND u.ativo)
  );

-- Delegações: super_admin tudo; gestor INSERT/UPDATE; demais SELECT
CREATE POLICY "delegacoes_select" ON delegacoes_temporarias
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "delegacoes_admin" ON delegacoes_temporarias
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil = 'super_admin' AND u.ativo)
  );

CREATE POLICY "delegacoes_gestor_insert" ON delegacoes_temporarias
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil = 'gestor' AND u.ativo)
  );

CREATE POLICY "delegacoes_gestor_update" ON delegacoes_temporarias
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil = 'gestor' AND u.ativo)
  );

-- ── View: cargos_atuais ──────────────────────────────────────

CREATE OR REPLACE VIEW cargos_atuais AS
SELECT
  c.id                            AS cargo_id,
  c.denominacao,
  c.tipo                          AS tipo_cargo,
  c.nivel,
  c.simbolo,
  uo.sigla                        AS unidade_sigla,
  uo.nome                         AS unidade_nome,
  c.uc_id,

  -- Titular
  oc.usuario_id                   AS titular_id,
  ut.nome_completo                AS titular_nome,
  ut.email                        AS titular_email,
  oc.portaria                     AS portaria_nomeacao,
  oc.data_inicio                  AS titular_desde,

  -- Delegação ativa (substituto vigente hoje)
  dt.delegado_id                  AS substituto_id,
  us.nome_completo                AS substituto_nome,
  dt.data_inicio                  AS delegacao_inicio,
  dt.data_fim                     AS delegacao_fim,
  dt.motivo                       AS delegacao_motivo,

  -- Quem está efetivamente no cargo hoje
  CASE
    WHEN dt.id IS NOT NULL THEN dt.delegado_id
    ELSE oc.usuario_id
  END                             AS responsavel_atual_id,

  CASE
    WHEN dt.id IS NOT NULL THEN us.nome_completo
    ELSE ut.nome_completo
  END                             AS responsavel_atual_nome

FROM cargos c
JOIN unidades_organizacionais uo ON uo.id = c.unidade_org_id
LEFT JOIN cargo_ocupacoes oc
  ON oc.cargo_id = c.id
  AND oc.data_inicio <= current_date
  AND (oc.data_fim IS NULL OR oc.data_fim >= current_date)
LEFT JOIN usuarios ut ON ut.id = oc.usuario_id
LEFT JOIN delegacoes_temporarias dt
  ON dt.cargo_id = c.id
  AND dt.ativa = true
  AND dt.data_inicio <= current_date
  AND dt.data_fim >= current_date
LEFT JOIN usuarios us ON us.id = dt.delegado_id
WHERE c.ativo = true;

-- ── Triggers: touch_atualizado_em ───────────────────────────

CREATE TRIGGER trg_unid_org_updated
  BEFORE UPDATE ON unidades_organizacionais
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

CREATE TRIGGER trg_cargos_updated
  BEFORE UPDATE ON cargos
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

CREATE TRIGGER trg_ocupacoes_updated
  BEFORE UPDATE ON cargo_ocupacoes
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

CREATE TRIGGER trg_delegacoes_updated
  BEFORE UPDATE ON delegacoes_temporarias
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Seed: Estrutura inicial SEMA-AC ─────────────────────────

INSERT INTO unidades_organizacionais (sigla, nome, tipo) VALUES
  ('SECRETARIA', 'Secretaria de Estado do Meio Ambiente', 'secretaria');

INSERT INTO unidades_organizacionais (sigla, nome, tipo, pai_id)
SELECT 'DIMA', 'Diretoria de Meio Ambiente', 'diretoria', id
FROM unidades_organizacionais WHERE sigla = 'SECRETARIA';

INSERT INTO unidades_organizacionais (sigla, nome, tipo, pai_id)
SELECT sigla, nome, 'departamento',
       (SELECT id FROM unidades_organizacionais WHERE sigla = 'DIMA')
FROM (VALUES
  ('DEUC',     'Departamento de Unidades de Conservação'),
  ('CIGMA',    'Coordenação de Informação e Gestão do Meio Ambiente'),
  ('JURIDICO', 'Assessoria Jurídica DIMA')
) AS t(sigla, nome);

INSERT INTO cargos (unidade_org_id, denominacao, tipo, nivel, simbolo)
SELECT id, 'Secretário de Estado do Meio Ambiente', 'cargo_comissionado', 'secretario', 'SDS'
FROM unidades_organizacionais WHERE sigla = 'SECRETARIA';

INSERT INTO cargos (unidade_org_id, denominacao, tipo, nivel, simbolo)
SELECT id, 'Diretor de Meio Ambiente', 'cargo_comissionado', 'diretor', 'DAS-3'
FROM unidades_organizacionais WHERE sigla = 'DIMA';

INSERT INTO cargos (unidade_org_id, denominacao, tipo, nivel, simbolo)
SELECT id, 'Chefe do Departamento de UCs', 'cargo_comissionado', 'chefe_deuc', 'DAS-2'
FROM unidades_organizacionais WHERE sigla = 'DEUC';

-- ── Seed: Ocupações iniciais ─────────────────────────────────
-- Registrar após criar os usuários no painel de Usuários.
-- Substituir <uuid_leonardo> e <uuid_erisson> pelos IDs gerados.
--
-- INSERT INTO cargo_ocupacoes (cargo_id, usuario_id, portaria, data_inicio)
-- SELECT c.id, '<uuid_leonardo>', 'Portaria nº __/____', '____-__-__'
-- FROM cargos c
-- JOIN unidades_organizacionais uo ON uo.id = c.unidade_org_id
-- WHERE uo.sigla = 'SECRETARIA' AND c.nivel = 'secretario';
--
-- INSERT INTO cargo_ocupacoes (cargo_id, usuario_id, portaria, data_inicio)
-- SELECT c.id, '<uuid_erisson>', 'Portaria nº __/____', '____-__-__'
-- FROM cargos c
-- JOIN unidades_organizacionais uo ON uo.id = c.unidade_org_id
-- WHERE uo.sigla = 'DIMA' AND c.nivel = 'diretor';
