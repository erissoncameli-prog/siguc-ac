-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Brigadas de Prevenção e Combate a Incêndios
-- Tabelas: brigadas, brigadistas, atividades_brigada,
--          equipamentos_brigada · View: brigadas_resumo
-- ═══════════════════════════════════════════════════════════

-- ── Enums ──────────────────────────────────────────────────

CREATE TYPE tipo_brigada AS ENUM (
  'preventiva', 'combate', 'mista'
);

CREATE TYPE fonte_recurso_brigada AS ENUM (
  'prevfogo', 'estadual', 'municipal', 'funbio', 'outro'
);

CREATE TYPE funcao_brigadista AS ENUM (
  'chefe_brigada', 'brigadista', 'motorista', 'apoio_administrativo', 'cozinheiro'
);

CREATE TYPE status_brigadista AS ENUM (
  'ativo', 'afastado', 'encerrado', 'suspenso'
);

CREATE TYPE tipo_atividade_brigada AS ENUM (
  'patrulha', 'combate_incendio', 'aceiro', 'treinamento',
  'reuniao', 'manutencao_equipamento', 'monitoramento', 'outro'
);

-- ── Brigadas ────────────────────────────────────────────────

CREATE TABLE brigadas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uc_id               uuid NOT NULL REFERENCES unidades_conservacao(id),
  nome                text NOT NULL,
  tipo                tipo_brigada NOT NULL DEFAULT 'mista',
  fonte_recurso       fonte_recurso_brigada NOT NULL DEFAULT 'prevfogo',

  -- Temporada / contrato
  temporada_inicio    date,
  temporada_fim       date,
  numero_contrato     text,

  -- Capacidade
  vagas_previstas     smallint,

  -- Coordenador
  coordenador_nome    text,
  coordenador_contato text,

  observacoes         text,
  ativa               boolean NOT NULL DEFAULT true,
  criado_por          uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em           timestamptz DEFAULT now(),
  atualizado_em       timestamptz DEFAULT now()
);

-- ── Brigadistas ─────────────────────────────────────────────

CREATE TABLE brigadistas (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brigada_id             uuid NOT NULL REFERENCES brigadas(id) ON DELETE CASCADE,

  -- Dados pessoais
  nome_completo          text NOT NULL,
  cpf                    varchar(14) NOT NULL,
  rg                     varchar(30),
  data_nascimento        date,
  sexo                   varchar(1) CHECK (sexo IN ('M', 'F', 'O')),

  -- Contato
  telefone               varchar(20),
  email                  text,
  municipio_residencia   text,

  -- Função e vínculo
  funcao                 funcao_brigadista NOT NULL DEFAULT 'brigadista',
  status                 status_brigadista NOT NULL DEFAULT 'ativo',
  fonte_recurso          fonte_recurso_brigada NOT NULL DEFAULT 'prevfogo',

  -- Período de atuação
  data_inicio            date NOT NULL,
  data_fim               date,

  -- Formação / habilitação
  treinamento_basico     boolean NOT NULL DEFAULT false,
  carga_horaria_formacao smallint,
  data_ultima_formacao   date,
  cnh                    varchar(5),

  observacoes            text,
  criado_em              timestamptz DEFAULT now(),
  atualizado_em          timestamptz DEFAULT now(),

  UNIQUE (brigada_id, cpf)
);

-- ── Atividades de Campo ─────────────────────────────────────

CREATE TABLE atividades_brigada (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brigada_id      uuid NOT NULL REFERENCES brigadas(id) ON DELETE CASCADE,
  uc_id           uuid REFERENCES unidades_conservacao(id),
  -- vinculação opcional ao módulo de ocorrências
  ocorrencia_id   uuid REFERENCES ocorrencias(id) ON DELETE SET NULL,

  tipo            tipo_atividade_brigada NOT NULL,
  data_inicio     timestamptz NOT NULL,
  data_fim        timestamptz,

  -- Localização
  localidade      text,
  geom            geometry(Point, 4326),

  -- Equipe
  num_brigadistas smallint,

  -- Resultado
  area_afetada_ha numeric(10,2),
  descricao       text NOT NULL,
  resultado       text,

  responsavel_id  uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);

-- ── Equipamentos da Brigada ─────────────────────────────────

CREATE TABLE equipamentos_brigada (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brigada_id      uuid NOT NULL REFERENCES brigadas(id) ON DELETE CASCADE,

  descricao       text NOT NULL,
  quantidade      smallint NOT NULL DEFAULT 1,
  condicao        text NOT NULL DEFAULT 'bom'
                  CHECK (condicao IN ('bom', 'regular', 'ruim', 'inoperante')),
  numero_serie    text,
  data_aquisicao  date,
  valor_aquisicao numeric(12,2),

  observacoes     text,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);

-- ── Índices ─────────────────────────────────────────────────

CREATE INDEX idx_brigadas_uc        ON brigadas (uc_id);
CREATE INDEX idx_brigadas_ativa     ON brigadas (uc_id) WHERE ativa = true;
CREATE INDEX idx_brigadistas_brig   ON brigadistas (brigada_id);
CREATE INDEX idx_brigadistas_cpf    ON brigadistas (cpf);
CREATE INDEX idx_brigadistas_ativo  ON brigadistas (brigada_id) WHERE status = 'ativo';
CREATE INDEX idx_ativ_brigada       ON atividades_brigada (brigada_id);
CREATE INDEX idx_ativ_data          ON atividades_brigada (data_inicio DESC);
CREATE INDEX idx_ativ_ocorrencia    ON atividades_brigada (ocorrencia_id)
  WHERE ocorrencia_id IS NOT NULL;
CREATE INDEX idx_ativ_geom          ON atividades_brigada USING GIST (geom)
  WHERE geom IS NOT NULL;
CREATE INDEX idx_equip_brigada      ON equipamentos_brigada (brigada_id);

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE brigadas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE brigadistas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE atividades_brigada   ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipamentos_brigada ENABLE ROW LEVEL SECURITY;

-- Leitura: todos autenticados
-- Escrita: tecnico, gestor, super_admin

CREATE POLICY "brigadas_select" ON brigadas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "brigadas_write" ON brigadas
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('tecnico', 'gestor', 'super_admin') AND ativo
    )
  );

CREATE POLICY "brigadistas_select" ON brigadistas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "brigadistas_write" ON brigadistas
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('tecnico', 'gestor', 'super_admin') AND ativo
    )
  );

CREATE POLICY "atividades_brigada_select" ON atividades_brigada
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "atividades_brigada_write" ON atividades_brigada
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('tecnico', 'gestor', 'super_admin') AND ativo
    )
  );

CREATE POLICY "equipamentos_brigada_select" ON equipamentos_brigada
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "equipamentos_brigada_write" ON equipamentos_brigada
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('tecnico', 'gestor', 'super_admin') AND ativo
    )
  );

-- ── Triggers: touch_atualizado_em ───────────────────────────

CREATE TRIGGER trg_brigadas_updated
  BEFORE UPDATE ON brigadas
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

CREATE TRIGGER trg_brigadistas_updated
  BEFORE UPDATE ON brigadistas
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

CREATE TRIGGER trg_ativ_brigada_updated
  BEFORE UPDATE ON atividades_brigada
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

CREATE TRIGGER trg_equip_brigada_updated
  BEFORE UPDATE ON equipamentos_brigada
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── View: brigadas_resumo ────────────────────────────────────

CREATE OR REPLACE VIEW brigadas_resumo AS
SELECT
  b.id,
  b.nome,
  b.tipo,
  b.fonte_recurso,
  b.temporada_inicio,
  b.temporada_fim,
  b.vagas_previstas,
  b.coordenador_nome,
  b.ativa,
  uc.nome                                                       AS uc_nome,
  uc.sigla                                                      AS uc_sigla,
  uc.municipios                                                 AS uc_municipios,
  COUNT(br.id) FILTER (WHERE br.status = 'ativo')               AS brigadistas_ativos,
  COUNT(br.id)                                                  AS brigadistas_total,
  MAX(ab.data_inicio)                                           AS ultima_atividade,
  b.criado_em,
  b.atualizado_em
FROM brigadas b
JOIN unidades_conservacao uc ON uc.id = b.uc_id
LEFT JOIN brigadistas br ON br.brigada_id = b.id
LEFT JOIN atividades_brigada ab ON ab.brigada_id = b.id
GROUP BY b.id, uc.id;
