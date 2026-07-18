-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota (Setor de Transporte) — Fase 1: cadastros
-- Veículos, motoristas/condutores e documentos com vencimento.
-- Lotação por setor = unidades_organizacionais (003). Veículos
-- podem ser dedicados ao setor. Embarcações (barcos/voadeiras)
-- usam horímetro em vez de hodômetro.
-- ═══════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_veiculo_frota') THEN
    CREATE TYPE tipo_veiculo_frota AS ENUM
      ('carro','caminhonete','van','onibus','caminhao','motocicleta',
       'quadriciclo','embarcacao','outro');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medidor_uso_frota') THEN
    CREATE TYPE medidor_uso_frota AS ENUM ('hodometro','horimetro');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'combustivel_frota') THEN
    CREATE TYPE combustivel_frota AS ENUM
      ('gasolina','etanol','flex','diesel','eletrico','hibrido');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_veiculo_frota') THEN
    CREATE TYPE status_veiculo_frota AS ENUM
      ('disponivel','em_viagem','em_manutencao','cedido','baixado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vinculo_motorista_frota') THEN
    CREATE TYPE vinculo_motorista_frota AS ENUM ('servidor','terceirizado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_motorista_frota') THEN
    CREATE TYPE status_motorista_frota AS ENUM ('ativo','ferias','afastado','inativo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_documento_veiculo') THEN
    CREATE TYPE tipo_documento_veiculo AS ENUM
      ('crlv','licenciamento','seguro','ipva','vistoria','tacografo','outro');
  END IF;
END $$;

-- ── Veículos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS frota_veiculos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placa                  text NOT NULL UNIQUE,        -- embarcações: nº de inscrição
  renavam                text,
  chassi                 text,
  marca                  text,
  modelo                 text NOT NULL,
  ano_fabricacao         smallint,
  ano_modelo             smallint,
  cor                    text,
  tipo                   tipo_veiculo_frota NOT NULL DEFAULT 'carro',
  combustivel            combustivel_frota,
  medidor                medidor_uso_frota NOT NULL DEFAULT 'hodometro',
  hodometro_km           numeric(10,1) NOT NULL DEFAULT 0,
  horimetro_horas        numeric(10,1) NOT NULL DEFAULT 0,
  capacidade_passageiros smallint,
  setor_id               uuid REFERENCES unidades_organizacionais(id),
  dedicado_setor         boolean NOT NULL DEFAULT false, -- uso exclusivo do setor de lotação
  status                 status_veiculo_frota NOT NULL DEFAULT 'disponivel',
  foto_url               text,
  observacoes            text,
  ativo                  boolean NOT NULL DEFAULT true,
  criado_em              timestamptz DEFAULT now(),
  atualizado_em          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frota_veic_setor  ON frota_veiculos (setor_id);
CREATE INDEX IF NOT EXISTS idx_frota_veic_status ON frota_veiculos (status) WHERE ativo;

-- Normaliza a placa (maiúscula, sem separadores) no insert/update
CREATE OR REPLACE FUNCTION frota_normaliza_placa()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.placa := upper(regexp_replace(NEW.placa, '[^A-Za-z0-9]', '', 'g'));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_frota_veic_placa ON frota_veiculos;
CREATE TRIGGER trg_frota_veic_placa BEFORE INSERT OR UPDATE OF placa ON frota_veiculos
  FOR EACH ROW EXECUTE FUNCTION frota_normaliza_placa();

DROP TRIGGER IF EXISTS trg_frota_veic_updated ON frota_veiculos;
CREATE TRIGGER trg_frota_veic_updated BEFORE UPDATE ON frota_veiculos
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Motoristas / condutores ─────────────────────────────────
CREATE TABLE IF NOT EXISTS frota_motoristas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                  text NOT NULL,
  usuario_id            uuid REFERENCES usuarios(id),   -- servidor com login (opcional)
  vinculo               vinculo_motorista_frota NOT NULL DEFAULT 'servidor',
  matricula             text,
  telefone              text,
  cnh_numero            text,
  cnh_categoria         text,                            -- A, B, AB, C, D, E…
  cnh_validade          date,
  habilitacao_fluvial   text,                            -- arrais/motonauta (embarcações)
  habilitacao_fluvial_validade date,
  portaria_autorizacao  text,                            -- portaria que autoriza condução
  setor_id              uuid REFERENCES unidades_organizacionais(id),
  status                status_motorista_frota NOT NULL DEFAULT 'ativo',
  foto_url              text,
  observacoes           text,
  ativo                 boolean NOT NULL DEFAULT true,
  criado_em             timestamptz DEFAULT now(),
  atualizado_em         timestamptz DEFAULT now()
);

-- 1 usuário ↔ 1 motorista (nulos livres p/ terceirizados sem login)
CREATE UNIQUE INDEX IF NOT EXISTS idx_frota_mot_usuario
  ON frota_motoristas (usuario_id) WHERE usuario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_frota_mot_setor ON frota_motoristas (setor_id);
CREATE INDEX IF NOT EXISTS idx_frota_mot_cnh   ON frota_motoristas (cnh_validade) WHERE ativo;

DROP TRIGGER IF EXISTS trg_frota_mot_updated ON frota_motoristas;
CREATE TRIGGER trg_frota_mot_updated BEFORE UPDATE ON frota_motoristas
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Apto a dirigir? Usado pela Fase 2 (viagens) para bloquear alocação.
-- CNH vencida bloqueia; CNH ausente não (barqueiros usam hab. fluvial).
CREATE OR REPLACE FUNCTION frota_motorista_apto(p_motorista uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM frota_motoristas m
    WHERE m.id = p_motorista AND m.ativo AND m.status = 'ativo'
      AND (m.cnh_validade IS NULL OR m.cnh_validade >= current_date)
      AND (m.habilitacao_fluvial_validade IS NULL
           OR m.habilitacao_fluvial_validade >= current_date)
  );
$$;

-- ── Documentos do veículo (com vencimento) ──────────────────
CREATE TABLE IF NOT EXISTS frota_veiculo_documentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id      uuid NOT NULL REFERENCES frota_veiculos(id) ON DELETE CASCADE,
  tipo            tipo_documento_veiculo NOT NULL DEFAULT 'outro',
  numero          text,
  descricao       text,
  data_vencimento date,
  arquivo_url     text,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frota_doc_veic ON frota_veiculo_documentos (veiculo_id);
CREATE INDEX IF NOT EXISTS idx_frota_doc_venc ON frota_veiculo_documentos (data_vencimento);

DROP TRIGGER IF EXISTS trg_frota_doc_updated ON frota_veiculo_documentos;
CREATE TRIGGER trg_frota_doc_updated BEFORE UPDATE ON frota_veiculo_documentos
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── RLS (via catálogo de módulos 056/057 — chave 'frota') ───
ALTER TABLE frota_veiculos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE frota_motoristas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE frota_veiculo_documentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_veic_select ON frota_veiculos;
CREATE POLICY frota_veic_select ON frota_veiculos
  FOR SELECT USING (pode_ver('frota'));
DROP POLICY IF EXISTS frota_veic_write ON frota_veiculos;
CREATE POLICY frota_veic_write ON frota_veiculos
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

DROP POLICY IF EXISTS frota_mot_select ON frota_motoristas;
CREATE POLICY frota_mot_select ON frota_motoristas
  FOR SELECT USING (pode_ver('frota'));
DROP POLICY IF EXISTS frota_mot_write ON frota_motoristas;
CREATE POLICY frota_mot_write ON frota_motoristas
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

DROP POLICY IF EXISTS frota_doc_select ON frota_veiculo_documentos;
CREATE POLICY frota_doc_select ON frota_veiculo_documentos
  FOR SELECT USING (pode_ver('frota'));
DROP POLICY IF EXISTS frota_doc_write ON frota_veiculo_documentos;
CREATE POLICY frota_doc_write ON frota_veiculo_documentos
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

-- ── Catálogo de módulos + permissões padrão ─────────────────
INSERT INTO modulos (chave, nome, grupo, icone, rota, ordem, respeita_escopo_uc) VALUES
  ('frota', 'Frota — Transporte', 'Frota', 'frota-veiculos', '../pages/frota-veiculos.html', 10, false)
ON CONFLICT (chave) DO NOTHING;

INSERT INTO grupo_permissoes_padrao (perfil, grupo, nivel) VALUES
  ('super_admin',        'Frota', 'editar'),
  ('secretario',         'Frota', 'visualizar'),
  ('diretor',            'Frota', 'editar'),
  ('chefe_departamento', 'Frota', 'editar'),
  ('gestor',             'Frota', 'editar'),
  ('gestor_uc',          'Frota', 'visualizar'),
  ('tecnico',            'Frota', 'visualizar'),
  ('assistente_admin',   'Frota', 'editar'),
  ('financeiro',         'Frota', 'visualizar'),
  ('visualizador',       'Frota', 'sem_acesso'),
  ('pesquisador_externo','Frota', 'sem_acesso'),
  ('brigadista',         'Frota', 'sem_acesso'),
  ('validador_brigada',  'Frota', 'sem_acesso'),
  ('validador_fauna',    'Frota', 'sem_acesso')
ON CONFLICT (perfil, grupo) DO NOTHING;
