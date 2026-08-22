-- 306_rh_estacoes_medicoes.sql
--
-- Fase C do DERHQA — plataformas de coleta HIDROMETEOROLÓGICAS
-- (nível de rio, chuva, vazão). Ver docs/recursos-hidricos/plano.md.
--
-- DUAS TABELAS, de propósito:
--   rh_estacoes  — o INVENTÁRIO (onde está, quem opera, o que mede)
--   rh_medicoes  — a SÉRIE (uma linha por leitura)
-- Não misturar com `agua_pontos_coleta`: ponto de coleta é onde a SEMA
-- amostra para o IQA (campanha semestral, laudo de laboratório);
-- estação é infraestrutura de monitoramento contínuo, quase sempre de
-- terceiro (ANA/CPRM), com série própria. O vínculo entre as duas
-- existe e é opcional (`rh_estacoes.ponto_coleta_id`) — algumas
-- estações da ANA ficam no mesmo rio/lugar de um ponto de coleta.
--
-- COTAS (atenção/alerta/inundação) são o vocabulário real do
-- monitoramento de cheia: são níveis de referência CADASTRADOS por
-- estação, não calculados. Ficam aqui porque é o que transforma "o rio
-- está em 812 cm" em "o rio passou da cota de alerta" — a leitura que
-- o relatório diário e a notificação precisam fazer.
--
-- ORIGEM da medição é gravada em cada linha (telemetria/convencional/
-- importacao/manual): dado telemétrico bruto e dado digitado à mão não
-- podem ser indistinguíveis depois — mesma disciplina de
-- `agua_coletas.status` (completo × quarentena).

-- ── Enums ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE rh_tipo_estacao AS ENUM (
    'fluviometrica',        -- nível/vazão do rio
    'pluviometrica',        -- chuva
    'fluviopluviometrica',  -- as duas (o caso mais comum na telemetria da ANA)
    'climatologica',
    'qualidade_agua'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rh_situacao_estacao AS ENUM ('operante', 'intermitente', 'desativada', 'planejada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rh_origem_medicao AS ENUM ('telemetria', 'convencional', 'importacao', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Inventário ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rh_estacoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_ana        text UNIQUE,          -- código da estação no HidroWeb (8 dígitos)
  codigo_operadora  text,                 -- código interno de quem opera (estado, Defesa Civil...)
  nome              text NOT NULL,
  tipo              rh_tipo_estacao NOT NULL DEFAULT 'fluviopluviometrica',
  situacao          rh_situacao_estacao NOT NULL DEFAULT 'operante',
  telemetrica       boolean NOT NULL DEFAULT false,
  operadora         text,                 -- ANA, CPRM, SEMA-AC, Defesa Civil...
  responsavel       text,                 -- quem mantém, quando difere de quem opera
  rio               text,
  bacia             text,                 -- mesmo vocabulário de agua_pontos_coleta.bacia
  municipio         text,
  geom              geometry(Point, 4326),
  altitude_m        numeric(8,2),
  area_drenagem_km2 numeric(12,2),
  -- Cotas de referência (cm), cadastradas — nunca derivadas.
  cota_atencao_cm   integer,
  cota_alerta_cm    integer,
  cota_inundacao_cm integer,
  serie_inicio      date,
  serie_fim         date,
  link_fonte        text,
  ponto_coleta_id   uuid REFERENCES agua_pontos_coleta(id) ON DELETE SET NULL,
  observacoes       text,
  ativo             boolean NOT NULL DEFAULT true,
  criado_por        uuid REFERENCES usuarios(id),
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN rh_estacoes.cota_alerta_cm IS
  'Nível de referência em cm cadastrado pela operadora — não é calculado a partir da série.';

CREATE INDEX IF NOT EXISTS rh_estacoes_geom_idx ON rh_estacoes USING GIST (geom);
CREATE INDEX IF NOT EXISTS rh_estacoes_bacia_idx ON rh_estacoes (bacia);
CREATE INDEX IF NOT EXISTS rh_estacoes_rio_idx   ON rh_estacoes (rio);

DROP TRIGGER IF EXISTS trg_rh_estacoes_touch ON rh_estacoes;
CREATE TRIGGER trg_rh_estacoes_touch BEFORE UPDATE ON rh_estacoes
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Série de medições ────────────────────────────────────────────
-- Uma linha por leitura. `nivel_cm`/`chuva_mm`/`vazao_m3s` são
-- opcionais porque a mesma estação pode reportar só parte deles (e a
-- telemetria falha por sensor, não por estação).
CREATE TABLE IF NOT EXISTS rh_medicoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estacao_id  uuid NOT NULL REFERENCES rh_estacoes(id) ON DELETE CASCADE,
  data_hora   timestamptz NOT NULL,
  nivel_cm    numeric(10,2),
  chuva_mm    numeric(10,2),
  vazao_m3s   numeric(12,3),
  origem      rh_origem_medicao NOT NULL DEFAULT 'importacao',
  bruto       jsonb,             -- payload cru da fonte, para auditoria
  criado_por  uuid REFERENCES usuarios(id),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  -- Idempotência da ingestão: reprocessar a mesma janela nunca duplica.
  -- CONSTRAINT normal (não índice parcial) — lição da 257b: índice
  -- UNIQUE parcial não é alvo válido de ON CONFLICT do PostgREST.
  CONSTRAINT rh_medicoes_unica UNIQUE (estacao_id, data_hora, origem)
);

CREATE INDEX IF NOT EXISTS rh_medicoes_estacao_data_idx
  ON rh_medicoes (estacao_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS rh_medicoes_data_idx ON rh_medicoes (data_hora DESC);

-- ── RLS ──────────────────────────────────────────────────────────
-- Mesmo módulo do Painel das Bacias ('bacias'): é a mesma leitura de
-- rede hidrográfica, e criar chave nova só para esta tela inflaria o
-- catálogo sem ninguém para administrar a diferença.
ALTER TABLE rh_estacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rh_medicoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rh_estacoes_select ON rh_estacoes;
CREATE POLICY rh_estacoes_select ON rh_estacoes FOR SELECT
  TO authenticated USING (pode_ver('bacias'));
DROP POLICY IF EXISTS rh_estacoes_write ON rh_estacoes;
CREATE POLICY rh_estacoes_write ON rh_estacoes FOR ALL
  TO authenticated USING (pode_editar('bacias')) WITH CHECK (pode_editar('bacias'));

DROP POLICY IF EXISTS rh_medicoes_select ON rh_medicoes;
CREATE POLICY rh_medicoes_select ON rh_medicoes FOR SELECT
  TO authenticated USING (pode_ver('bacias'));
DROP POLICY IF EXISTS rh_medicoes_write ON rh_medicoes;
CREATE POLICY rh_medicoes_write ON rh_medicoes FOR ALL
  TO authenticated USING (pode_editar('bacias')) WITH CHECK (pode_editar('bacias'));

-- ── View de detalhe: estado ATUAL de cada estação ────────────────
-- SECURITY INVOKER (padrão 165): a RLS de quem consulta continua
-- valendo. lat/lng extraídos como as outras views do projeto.
DROP VIEW IF EXISTS vw_rh_estacoes_detalhe;
CREATE VIEW vw_rh_estacoes_detalhe
WITH (security_invoker = true) AS
WITH ultima AS (
  SELECT DISTINCT ON (estacao_id)
         estacao_id, data_hora, nivel_cm, chuva_mm, vazao_m3s, origem
    FROM rh_medicoes
   ORDER BY estacao_id, data_hora DESC
),
anterior24 AS (
  -- Leitura mais recente com pelo menos 20h de defasagem: base da
  -- variação "nas últimas 24h" sem exigir leitura exatamente em -24h
  -- (telemetria falha, estação convencional lê 1×/dia).
  SELECT DISTINCT ON (m.estacao_id)
         m.estacao_id, m.data_hora, m.nivel_cm
    FROM rh_medicoes m
    JOIN ultima u ON u.estacao_id = m.estacao_id
   WHERE m.nivel_cm IS NOT NULL
     AND m.data_hora <= u.data_hora - interval '20 hours'
   ORDER BY m.estacao_id, m.data_hora DESC
),
chuva AS (
  SELECT m.estacao_id,
         SUM(m.chuva_mm) FILTER (WHERE m.data_hora >= now() - interval '24 hours') AS chuva_24h,
         SUM(m.chuva_mm) FILTER (WHERE m.data_hora >= now() - interval '7 days')   AS chuva_7d
    FROM rh_medicoes m
   WHERE m.chuva_mm IS NOT NULL AND m.data_hora >= now() - interval '7 days'
   GROUP BY m.estacao_id
)
SELECT e.id, e.codigo_ana, e.codigo_operadora, e.nome, e.tipo, e.situacao,
       e.telemetrica, e.operadora, e.responsavel, e.rio, e.bacia, e.municipio,
       e.altitude_m, e.area_drenagem_km2,
       e.cota_atencao_cm, e.cota_alerta_cm, e.cota_inundacao_cm,
       e.serie_inicio, e.serie_fim, e.link_fonte, e.ponto_coleta_id,
       e.observacoes, e.ativo, e.criado_em, e.atualizado_em,
       ST_Y(e.geom) AS lat,
       ST_X(e.geom) AS lng,
       u.data_hora  AS ultima_leitura,
       u.nivel_cm   AS nivel_atual_cm,
       u.vazao_m3s  AS vazao_atual_m3s,
       u.origem     AS ultima_origem,
       a.nivel_cm   AS nivel_24h_cm,
       (u.nivel_cm - a.nivel_cm) AS variacao_24h_cm,
       c.chuva_24h, c.chuva_7d,
       -- Situação da cota: derivada, nunca gravada. NULL quando a
       -- estação não tem cota cadastrada — que NÃO é o mesmo que
       -- "normal" (mesma distinção de conama_violacoes NULL na Água).
       CASE
         WHEN u.nivel_cm IS NULL THEN NULL
         WHEN e.cota_inundacao_cm IS NOT NULL AND u.nivel_cm >= e.cota_inundacao_cm THEN 'inundacao'
         WHEN e.cota_alerta_cm    IS NOT NULL AND u.nivel_cm >= e.cota_alerta_cm    THEN 'alerta'
         WHEN e.cota_atencao_cm   IS NOT NULL AND u.nivel_cm >= e.cota_atencao_cm   THEN 'atencao'
         WHEN e.cota_atencao_cm IS NULL AND e.cota_alerta_cm IS NULL AND e.cota_inundacao_cm IS NULL THEN NULL
         ELSE 'normal'
       END AS situacao_cota
  FROM rh_estacoes e
  LEFT JOIN ultima     u ON u.estacao_id = e.id
  LEFT JOIN anterior24 a ON a.estacao_id = e.id
  LEFT JOIN chuva      c ON c.estacao_id = e.id;

-- As RPCs (relatório diário, ingestão em lote, aviso de cota) vivem na
-- 306b — aplicadas em migrations separadas de propósito: DDL de tabela
-- e função grande num arquivo só dificulta reaplicar/corrigir uma sem
-- a outra (lição da 181, em que recriar uma RPC grande perdeu correção
-- feita numa migration anterior).
