-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água (IQA) — cadastro base
-- Fase 0 do plano em docs/qualidade-agua/plano.md
--
-- O QUE ESTA MIGRATION CRIA
-- As quatro tabelas de cadastro do módulo: pontos de coleta,
-- campanhas, laboratórios e a coleta em si. Nenhuma tela ainda — a
-- mesa é a Fase 2 e o app de campo a Fase 3.
--
-- POR QUE MÓDULO IRMÃO, E NÃO PARTE DO BIOMONITOR
-- Decisão registrada no plano: `grupos_biomonitor` exige `uc_id NOT
-- NULL` e a maioria dos pontos de coleta fica FORA de UC (são
-- estações da rede da ANA, em sedes municipais). Aninhar obrigaria a
-- inventar uma UC para cada ponto.
--
-- POR QUE CAMPO E LABORATÓRIO NA MESMA LINHA
-- A relação é sempre 1:1 — uma coleta gera um laudo. Tabela separada
-- obrigaria JOIN no caso comum (ver a série histórica: uma linha por
-- coleta, com as duas metades juntas) e criaria o estado inválido
-- "laudo sem coleta". O que distingue as duas metades é o `status`:
-- `aguardando_lab` enquanto as colunas de laboratório estiverem
-- nulas, `completo` quando o laudo chegar.
--
-- VALOR CENSURADO (`<1`) — decisão 3 do plano
-- O laboratório reporta "<1 NMP/100 mL" quando o resultado está
-- abaixo do limite de detecção. A coluna numérica guarda METADE do
-- limite (o padrão adotado), para que o valor entre no cálculo; a
-- coluna `censurados` guarda de qual limite ele veio, para que o
-- laudo continue reproduzível. Sem isso, `0,5` no banco vira um
-- resultado medido que ninguém consegue reconciliar com o papel.
-- É jsonb e não 15 pares de colunas de propósito: é PROVENIÊNCIA de
-- um valor específico, não campo consultado — mesmo critério de
-- `biomonitor_equipamentos.especificacoes` (migration 228).
--
-- MÓDULO `agua` NASCE INATIVO
-- A linha em `modulos` entra com `ativo = false`: `nivel_efetivo`
-- (migration 057) devolve `sem_acesso` para módulo inativo, então
-- durante as Fases 0 e 1 só super_admin alcança estas tabelas — que
-- é exatamente o desejado numa fase sem tela. Ativar é UPDATE de uma
-- linha, na entrega que criar `pages/agua-pontos.html`. Registrar
-- agora (e não depois) é o que permite escrever a RLS definitiva
-- desde já, sem uma segunda migration reescrevendo as policies.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Enums ──────────────────────────────────────────────────
-- Classe de enquadramento da CONAMA 357/2005 para água doce. Decidido
-- (plano, decisão 2): Classe 2 é o padrão de todos os pontos, mas o
-- campo existe porque enquadramento é ato do órgão gestor e pode
-- diferir por trecho de rio.
DO $$ BEGIN
  CREATE TYPE classe_enquadramento_agua AS ENUM
    ('especial','classe_1','classe_2','classe_3','classe_4');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `quarentena` NÃO é descarte — é o estado de quem precisa de
-- conferência humana (pH 16,36 e afins, achado 4 do plano). A Fase 1
-- migra as 450 linhas históricas e usa este status em vez de apagar.
DO $$ BEGIN
  CREATE TYPE status_coleta_agua AS ENUM
    ('aguardando_lab','completo','quarentena');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ordem_campanha_agua AS ENUM ('primeira','segunda');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Laboratórios ───────────────────────────────────────────
-- O serviço é terceirizado e muda de contrato em contrato. Saber quem
-- produziu qual resultado é o que permite responder "esta série mudou
-- de patamar ou mudou de laboratório?" — pergunta que a série
-- histórica não consegue responder hoje.
CREATE TABLE IF NOT EXISTS agua_laboratorios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                text NOT NULL CHECK (length(btrim(nome)) >= 2),
  cnpj                text CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
  responsavel_tecnico text,
  registro_conselho   text,   -- CRQ/CRBio do responsável técnico
  acreditacao         text,   -- nº da acreditação ISO/IEC 17025, quando houver
  email               text,
  telefone            text,
  observacoes         text,
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agua_lab_nome
  ON agua_laboratorios (lower(btrim(nome)));

-- ── 3. Pontos de coleta ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS agua_pontos_coleta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Código da estação na rede da ANA. É a identidade estável do
  -- ponto: nome de município e de rio aparecem grafados de quatro
  -- maneiras na série histórica (achado 1 do plano).
  codigo_ana    text NOT NULL UNIQUE CHECK (codigo_ana ~ '^[0-9]{6,10}$'),
  -- Grafias erradas do MESMO código encontradas na planilha
  -- (13433800/13488000 por 13438000; 1360100 por 13601000). Existe
  -- para a Fase 1 conseguir casar as 450 linhas com o ponto certo sem
  -- criar estação duplicada — e para que o erro fique documentado no
  -- lugar onde alguém vai procurá-lo.
  codigos_alias text[] NOT NULL DEFAULT '{}',
  nome          text NOT NULL,
  municipio     text NOT NULL,
  rio           text NOT NULL,
  -- Bacia hidrográfica. Nulo é resposta válida: preencher por
  -- suposição vale menos que a lacuna (ver cabeçalho da 250).
  bacia         text,
  geom          geometry(Point, 4326) NOT NULL,
  altitude_m    numeric(6,1),
  uc_id         uuid REFERENCES unidades_conservacao(id) ON DELETE SET NULL,
  classe_enquadramento classe_enquadramento_agua NOT NULL DEFAULT 'classe_2',
  -- `false` = coordenada herdada da planilha, ainda não conferida em
  -- campo. Uma delas estava trocada por outro município a 400 km
  -- (achado 3); marcar o que não foi conferido é mais barato que
  -- descobrir isso de novo daqui a três anos.
  coordenada_conferida boolean NOT NULL DEFAULT false,
  coordenada_observacao text,
  ativo         boolean NOT NULL DEFAULT true,
  observacoes   text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agua_pontos_geom ON agua_pontos_coleta USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_agua_pontos_municipio ON agua_pontos_coleta (municipio);
-- Busca pelo código errado que veio da planilha, sem varrer a tabela.
CREATE INDEX IF NOT EXISTS idx_agua_pontos_alias ON agua_pontos_coleta USING GIN (codigos_alias);

COMMENT ON COLUMN agua_pontos_coleta.codigos_alias IS
  'Grafias erradas do mesmo código encontradas na série histórica. Não são estações — são erros de digitação preservados para conciliação.';
COMMENT ON COLUMN agua_pontos_coleta.coordenada_conferida IS
  'false = coordenada veio da planilha e não foi conferida em campo.';

-- ── 4. Campanhas ──────────────────────────────────────────────
-- Duas por ano, em períodos de certificação distintos (cheia e seca).
CREATE TABLE IF NOT EXISTS agua_campanhas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ano           smallint NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  ordem         ordem_campanha_agua NOT NULL,
  periodo       text,          -- "Primeiro"/"Segundo" período de certificação
  data_inicio   date,
  data_fim      date,
  observacoes   text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agua_campanha UNIQUE (ano, ordem),
  CONSTRAINT ck_agua_campanha_datas CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio)
);

-- ── 5. Coletas ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agua_coletas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ponto_id       uuid NOT NULL REFERENCES agua_pontos_coleta(id) ON DELETE RESTRICT,
  campanha_id    uuid NOT NULL REFERENCES agua_campanhas(id) ON DELETE RESTRICT,
  laboratorio_id uuid REFERENCES agua_laboratorios(id) ON DELETE SET NULL,

  data_coleta    date NOT NULL,
  hora_coleta    time,

  -- Quem coletou. `usuarios` por enquanto; a Fase 3 cria o cadastro
  -- de coletores de campo (com vínculo opcional ao usuário de mesa,
  -- no molde de `brigadistas.usuario_id`) e passa a apontar para ele.
  coletor_id     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  coletor_nome   text,          -- quem coletou antes de haver cadastro

  -- Posição do APARELHO no momento da coleta (Fase 3). Não substitui
  -- `agua_pontos_coleta.geom`, que é a estação: a diferença entre as
  -- duas é justamente o que se quer poder auditar.
  localizacao    geometry(Point, 4326),
  foto_url       text,
  laudo_url      text,          -- PDF do laboratório, bucket privado (Fase 2)

  -- ── Parâmetros de campo (medidos na margem, com sonda) ──
  temp_ar             numeric(5,2),
  temp_amostra        numeric(5,2),
  ph                  numeric(5,2),
  od                  numeric(7,3),   -- mg/L
  turbidez            numeric(10,4),  -- UNT
  condutividade_eletrica numeric(10,3),

  -- ── Parâmetros de laboratório (nulos até o laudo chegar) ──
  dbo                        numeric(10,3),
  nitrogenio_total           numeric(10,4),
  nitrogenio_amoniacal       numeric(10,4),
  nitratos                   numeric(10,4),
  fosforo_total              numeric(10,4),
  ortofosfato_dissolvido     numeric(10,4),
  solidos_dissolvidos_totais numeric(12,4),
  solidos_suspensao_totais   numeric(12,4),
  coliformes_termotolerantes numeric(14,2),  -- NMP/100 mL
  coliformes_totais          numeric(14,2),
  escherichia_coli           numeric(14,2),
  alcalinidade_total         numeric(10,3),
  carbono_organico_total     numeric(10,3),
  cloreto                    numeric(10,3),
  condutividade_especifica   numeric(10,3),
  descarga_liquida           numeric(12,3),

  -- Proveniência de valor censurado: {"coliformes_termotolerantes": 1}
  -- significa "o laudo dizia <1; a coluna guarda 0,5". Ver cabeçalho.
  censurados     jsonb NOT NULL DEFAULT '{}'::jsonb,

  status             status_coleta_agua NOT NULL DEFAULT 'aguardando_lab',
  quarentena_motivo  text,
  observacoes        text,

  -- Nº da linha na planilha original, para conferência com o arquivo
  -- físico depois da migração da Fase 1.
  linha_origem_planilha integer,

  criado_por     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_agua_censurados_objeto CHECK (jsonb_typeof(censurados) = 'object'),
  CONSTRAINT ck_agua_quarentena_motivo CHECK (status <> 'quarentena' OR quarentena_motivo IS NOT NULL)
);

-- SEM unique (ponto, campanha) de propósito: a Fase 1 migra dado
-- histórico que pode ter repetição, e a regra do plano é POR EM
-- QUARENTENA, não descartar. Uma unique aqui transformaria conferência
-- humana em erro de importação.
CREATE INDEX IF NOT EXISTS idx_agua_coletas_ponto_campanha ON agua_coletas (ponto_id, campanha_id);
CREATE INDEX IF NOT EXISTS idx_agua_coletas_data ON agua_coletas (data_coleta DESC);
CREATE INDEX IF NOT EXISTS idx_agua_coletas_status ON agua_coletas (status) WHERE status <> 'completo';
CREATE INDEX IF NOT EXISTS idx_agua_coletas_localizacao ON agua_coletas USING GIST (localizacao);

COMMENT ON COLUMN agua_coletas.censurados IS
  'Parâmetros reportados abaixo do limite de detecção: {parametro: limite}. A coluna numérica guarda metade do limite (decisão 3 do plano).';
COMMENT ON COLUMN agua_coletas.od IS 'Oxigênio dissolvido em mg/L. A saturação (%) é DERIVADA na view, não gravada.';

-- ── 6. Triggers de atualizado_em ──────────────────────────────
DROP TRIGGER IF EXISTS trg_agua_lab_updated ON agua_laboratorios;
CREATE TRIGGER trg_agua_lab_updated BEFORE UPDATE ON agua_laboratorios
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

DROP TRIGGER IF EXISTS trg_agua_pontos_updated ON agua_pontos_coleta;
CREATE TRIGGER trg_agua_pontos_updated BEFORE UPDATE ON agua_pontos_coleta
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

DROP TRIGGER IF EXISTS trg_agua_campanhas_updated ON agua_campanhas;
CREATE TRIGGER trg_agua_campanhas_updated BEFORE UPDATE ON agua_campanhas
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

DROP TRIGGER IF EXISTS trg_agua_coletas_updated ON agua_coletas;
CREATE TRIGGER trg_agua_coletas_updated BEFORE UPDATE ON agua_coletas
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── 7. Módulo no catálogo de permissões ───────────────────────
-- ativo = false até a Fase 2 entregar a página (ver cabeçalho).
INSERT INTO modulos (chave, nome, grupo, icone, rota, ordem, respeita_escopo_uc, ativo)
VALUES ('agua', 'Qualidade da Água', 'Gestão', 'monitoramento',
        '../pages/agua-pontos.html', 35, false, false)
ON CONFLICT (chave) DO NOTHING;

-- ── 8. RLS ────────────────────────────────────────────────────
-- Padrão do módulo Frota (migration 158): pode_ver/pode_editar sobre
-- a chave do módulo, sem policy escrita à mão por perfil. Enquanto
-- `modulos.agua.ativo = false`, isso resolve para super_admin apenas.
ALTER TABLE agua_laboratorios   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agua_pontos_coleta  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agua_campanhas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agua_coletas        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agua_lab_select ON agua_laboratorios;
CREATE POLICY agua_lab_select ON agua_laboratorios
  FOR SELECT USING (pode_ver('agua'));
DROP POLICY IF EXISTS agua_lab_write ON agua_laboratorios;
CREATE POLICY agua_lab_write ON agua_laboratorios
  FOR ALL USING (pode_editar('agua')) WITH CHECK (pode_editar('agua'));

DROP POLICY IF EXISTS agua_pontos_select ON agua_pontos_coleta;
CREATE POLICY agua_pontos_select ON agua_pontos_coleta
  FOR SELECT USING (pode_ver('agua'));
DROP POLICY IF EXISTS agua_pontos_write ON agua_pontos_coleta;
CREATE POLICY agua_pontos_write ON agua_pontos_coleta
  FOR ALL USING (pode_editar('agua')) WITH CHECK (pode_editar('agua'));

DROP POLICY IF EXISTS agua_campanhas_select ON agua_campanhas;
CREATE POLICY agua_campanhas_select ON agua_campanhas
  FOR SELECT USING (pode_ver('agua'));
DROP POLICY IF EXISTS agua_campanhas_write ON agua_campanhas;
CREATE POLICY agua_campanhas_write ON agua_campanhas
  FOR ALL USING (pode_editar('agua')) WITH CHECK (pode_editar('agua'));

DROP POLICY IF EXISTS agua_coletas_select ON agua_coletas;
CREATE POLICY agua_coletas_select ON agua_coletas
  FOR SELECT USING (pode_ver('agua'));
DROP POLICY IF EXISTS agua_coletas_write ON agua_coletas;
CREATE POLICY agua_coletas_write ON agua_coletas
  FOR ALL USING (pode_editar('agua')) WITH CHECK (pode_editar('agua'));
