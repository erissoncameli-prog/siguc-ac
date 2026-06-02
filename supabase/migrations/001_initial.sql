-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Schema inicial
-- Sistema de Gestão de Unidades de Conservação — Acre / SEMA
-- ═══════════════════════════════════════════════════════════

-- Extensões
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ──────────────────────────────────────────────────

CREATE TYPE perfil_usuario AS ENUM (
  'super_admin', 'gestor', 'tecnico', 'financeiro', 'visualizador'
);

CREATE TYPE categoria_uc AS ENUM (
  'PI', 'REBIO', 'ESEC', 'MONA', 'RVS',
  'FLONA', 'RESEX', 'RDS', 'RPPN', 'APA', 'ARIE'
);

CREATE TYPE grupo_uc AS ENUM ('protecao_integral', 'uso_sustentavel');

CREATE TYPE esfera_uc AS ENUM ('federal', 'estadual', 'municipal', 'privada');

CREATE TYPE status_uc AS ENUM (
  'criada', 'regularizada', 'em_regularizacao', 'decreto_suspenso', 'em_revisao'
);

CREATE TYPE severidade_ocorrencia AS ENUM ('critica', 'alta', 'media', 'baixa');

CREATE TYPE tipo_ocorrencia AS ENUM (
  'incendio', 'desmatamento', 'invasao', 'caca_pesca_ilegal',
  'mineracao_ilegal', 'contaminacao', 'especie_invasora', 'outro'
);

CREATE TYPE status_ocorrencia AS ENUM (
  'aberta', 'em_atendimento', 'resolvida', 'arquivada'
);

CREATE TYPE tipo_documento AS ENUM (
  'plano_manejo', 'decreto_criacao', 'ata_reuniao', 'relatorio_tecnico',
  'contrato', 'mapeamento', 'outro'
);

-- ── Usuários ────────────────────────────────────────────────

CREATE TABLE usuarios (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_completo   text NOT NULL,
  email           text NOT NULL UNIQUE,
  perfil          perfil_usuario NOT NULL DEFAULT 'visualizador',
  uc_id           uuid,       -- UC de atuação principal (NULL = acesso a todas)
  cargo           text,
  telefone        varchar(20),
  ativo           boolean NOT NULL DEFAULT true,
  deve_trocar_senha boolean NOT NULL DEFAULT false,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);

-- ── Unidades de Conservação ─────────────────────────────────

CREATE TABLE unidades_conservacao (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              varchar(20) NOT NULL UNIQUE,   -- ex: UC-001
  nome                text NOT NULL,
  sigla               varchar(30),
  categoria           categoria_uc NOT NULL,
  grupo               grupo_uc NOT NULL,
  esfera              esfera_uc NOT NULL DEFAULT 'estadual',
  status              status_uc NOT NULL DEFAULT 'criada',

  -- Localização
  municipios          text[],
  regiao              text,

  -- Métricas físicas
  area_ha             numeric(14,4),
  perimetro_km        numeric(10,3),

  -- Ato de criação
  ato_criacao         text,          -- ex: Decreto nº 12.345
  data_criacao        date,
  data_regularizacao  date,

  -- Gestão
  gestor_id           uuid REFERENCES usuarios(id),
  email_contato       text,
  telefone_contato    varchar(20),
  sede_municipio      text,
  populacao_estimada  integer,       -- comunidades residentes/entorno

  -- Plano de manejo
  tem_plano_manejo    boolean DEFAULT false,
  plano_manejo_ano    integer,

  -- Geometria PostGIS (SRID 4326 = WGS84)
  geom                geometry(MultiPolygon, 4326),
  centroide           geometry(Point, 4326),
  zona_amortecimento  geometry(MultiPolygon, 4326),

  observacoes         text,
  foto_capa_url       text,
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz DEFAULT now(),
  atualizado_em       timestamptz DEFAULT now()
);

-- FK circular: usuarios.uc_id → unidades_conservacao.id
ALTER TABLE usuarios ADD CONSTRAINT fk_usuarios_uc
  FOREIGN KEY (uc_id) REFERENCES unidades_conservacao(id);

-- ── Monitoramento ────────────────────────────────────────────

CREATE TABLE monitoramento_indicadores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  descricao   text,
  unidade     text,          -- ex: 'ha', '%', 'nº indivíduos'
  categoria   text,          -- ex: 'biodiversidade', 'pressao', 'governanca'
  ativo       boolean NOT NULL DEFAULT true
);

CREATE TABLE monitoramento_registros (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uc_id           uuid NOT NULL REFERENCES unidades_conservacao(id) ON DELETE CASCADE,
  indicador_id    uuid REFERENCES monitoramento_indicadores(id),
  nome_indicador  text,      -- livre se não vinculado à tabela
  valor           numeric,
  unidade         text,
  metodologia     text,
  data_referencia date NOT NULL,
  responsavel_id  uuid REFERENCES usuarios(id),
  observacoes     text,
  anexo_url       text,
  localizacao     geometry(Point, 4326),
  criado_em       timestamptz DEFAULT now()
);

-- ── Ocorrências ──────────────────────────────────────────────

CREATE TABLE ocorrencias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uc_id           uuid NOT NULL REFERENCES unidades_conservacao(id) ON DELETE CASCADE,
  tipo            tipo_ocorrencia NOT NULL,
  severidade      severidade_ocorrencia NOT NULL DEFAULT 'media',
  status          status_ocorrencia NOT NULL DEFAULT 'aberta',
  titulo          text NOT NULL,
  descricao       text,
  localizacao     geometry(Point, 4326),
  area_afetada_ha numeric(12,4),
  data_ocorrencia date NOT NULL,
  data_resolucao  date,
  responsavel_id  uuid REFERENCES usuarios(id),
  fotos_urls      text[],
  boletim_url     text,
  historico       jsonb DEFAULT '[]',   -- array de {data, usuario, acao, obs}
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);

-- ── Documentos ───────────────────────────────────────────────

CREATE TABLE documentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uc_id           uuid REFERENCES unidades_conservacao(id) ON DELETE SET NULL,
  tipo            tipo_documento NOT NULL DEFAULT 'outro',
  titulo          text NOT NULL,
  descricao       text,
  arquivo_url     text NOT NULL,
  arquivo_nome    text,
  tamanho_bytes   bigint,
  data_documento  date,
  autor_id        uuid REFERENCES usuarios(id),
  publico         boolean NOT NULL DEFAULT false,
  criado_em       timestamptz DEFAULT now()
);

-- ── Equipes / Servidores ─────────────────────────────────────

CREATE TABLE equipe_servidores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uc_id           uuid NOT NULL REFERENCES unidades_conservacao(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  cargo           text,
  matricula       varchar(30),
  tipo_vinculo    text,     -- 'efetivo', 'comissionado', 'terceirizado', 'voluntario'
  data_entrada    date,
  data_saida      date,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz DEFAULT now()
);

-- ── Índices PostGIS ──────────────────────────────────────────

CREATE INDEX idx_uc_geom        ON unidades_conservacao USING GIST (geom);
CREATE INDEX idx_uc_centroide   ON unidades_conservacao USING GIST (centroide);
CREATE INDEX idx_uc_za          ON unidades_conservacao USING GIST (zona_amortecimento);
CREATE INDEX idx_ocorr_loc      ON ocorrencias USING GIST (localizacao);
CREATE INDEX idx_monit_loc      ON monitoramento_registros USING GIST (localizacao);
CREATE INDEX idx_ocorr_uc       ON ocorrencias (uc_id);
CREATE INDEX idx_monit_uc       ON monitoramento_registros (uc_id);
CREATE INDEX idx_docs_uc        ON documentos (uc_id);

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE usuarios                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades_conservacao     ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoramento_indicadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoramento_registros  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocorrencias              ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipe_servidores        ENABLE ROW LEVEL SECURITY;

-- Usuários: cada um vê apenas seu próprio perfil; admins veem tudo
CREATE POLICY "usuarios_self_select" ON usuarios
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "usuarios_admin_all" ON usuarios
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('super_admin', 'gestor') AND u.ativo)
  );

-- UCs: todos autenticados visualizam; gestores/admins modificam
CREATE POLICY "uc_auth_select" ON unidades_conservacao
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "uc_admin_all" ON unidades_conservacao
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('super_admin', 'gestor') AND u.ativo)
  );

-- Indicadores de monitoramento: todos veem
CREATE POLICY "indicadores_select" ON monitoramento_indicadores
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "indicadores_admin" ON monitoramento_indicadores
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil = 'super_admin' AND u.ativo)
  );

-- Registros de monitoramento: auth vê; técnicos/gestores/admins modificam
CREATE POLICY "monit_select" ON monitoramento_registros
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "monit_modify" ON monitoramento_registros
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('super_admin', 'gestor', 'tecnico') AND u.ativo)
  );

-- Ocorrências
CREATE POLICY "ocorr_select" ON ocorrencias
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "ocorr_modify" ON ocorrencias
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('super_admin', 'gestor', 'tecnico') AND u.ativo)
  );

-- Documentos: públicos visíveis para todos; privados só para auth
CREATE POLICY "docs_select" ON documentos
  FOR SELECT USING (publico = true OR auth.uid() IS NOT NULL);

CREATE POLICY "docs_modify" ON documentos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('super_admin', 'gestor', 'tecnico') AND u.ativo)
  );

-- Equipe: auth vê; gestores/admins modificam
CREATE POLICY "equipe_select" ON equipe_servidores
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "equipe_modify" ON equipe_servidores
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('super_admin', 'gestor') AND u.ativo)
  );

-- ── Função: criar usuário ────────────────────────────────────

CREATE OR REPLACE FUNCTION criar_usuario(
  p_email        text,
  p_senha        text,
  p_nome         text,
  p_perfil       perfil_usuario DEFAULT 'visualizador',
  p_uc_id        uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid;
BEGIN
  -- Criar no auth.users via supabase admin (requer service_role)
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES (
    gen_random_uuid(), p_email,
    crypt(p_senha, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nome', p_nome),
    'authenticated', 'authenticated'
  ) RETURNING id INTO v_uid;

  INSERT INTO usuarios (id, email, nome_completo, perfil, uc_id, deve_trocar_senha)
  VALUES (v_uid, p_email, p_nome, p_perfil, p_uc_id, true);

  RETURN v_uid;
END;
$$;

-- ── Trigger: atualizar atualizado_em ────────────────────────

CREATE OR REPLACE FUNCTION touch_atualizado_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_uc_updated     BEFORE UPDATE ON unidades_conservacao     FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();
CREATE TRIGGER trg_ocorr_updated  BEFORE UPDATE ON ocorrencias               FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();
CREATE TRIGGER trg_user_updated   BEFORE UPDATE ON usuarios                  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();
