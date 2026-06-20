-- ════════════════════════════════════════════════════════════════
-- 069 — Código legível da ocorrência (registros_campo)
-- ════════════════════════════════════════════════════════════════
-- Cada registro de campo passa a ter um código humano-legível, do qual
-- se lê dia/mês/ano, brigada, regional e a sequência. Formato:
--
--     JUR-03-200626-007
--      │   │    │      └─ sequência (3 díg.), por brigada por ano
--      │   │    └──────── data DDMMAA da ocorrência (fuso do Acre)
--      │   └───────────── código curto e estável da brigada (2 díg.)
--      └───────────────── regional (BAC|PUR|JUR|TEN|AAC)
--
-- Decisões de confiabilidade:
-- • O código é atribuído NO SERVIDOR (trigger BEFORE INSERT), nunca no
--   app offline — única fonte segura para a sequência.
-- • A sequência vem de um contador atômico (ocorrencia_seq) via
--   INSERT … ON CONFLICT DO UPDATE RETURNING.
-- • O sync usa upsert por uuid_cliente; correções reenviam o mesmo
--   uuid_cliente. O trigger só gera quando a linha é REALMENTE nova
--   (uuid_cliente ainda não existe), então correções preservam o código
--   e não consomem números da sequência.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Código curto e estável da brigada ─────────────────────────
ALTER TABLE brigadas
  ADD COLUMN IF NOT EXISTS codigo smallint;

-- Backfill: numera por regional, na ordem de criação
WITH n AS (
  SELECT id,
         row_number() OVER (PARTITION BY regional ORDER BY criado_em, id) AS c
  FROM brigadas
  WHERE codigo IS NULL
)
UPDATE brigadas b SET codigo = n.c
FROM n WHERE n.id = b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brigadas_codigo_regional
  ON brigadas (regional, codigo) WHERE codigo IS NOT NULL;

-- Auto-atribui o código às brigadas novas (depois da regional ser
-- herdada da UC — garantido pelo nome do trigger, que ordena após
-- trg_brigada_herda_regional).
CREATE OR REPLACE FUNCTION fn_brigada_codigo()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF NEW.codigo IS NULL THEN
    SELECT COALESCE(MAX(codigo), 0) + 1 INTO NEW.codigo
    FROM brigadas
    WHERE regional IS NOT DISTINCT FROM NEW.regional;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brigada_zcodigo ON brigadas;
CREATE TRIGGER trg_brigada_zcodigo
  BEFORE INSERT ON brigadas
  FOR EACH ROW EXECUTE FUNCTION fn_brigada_codigo();

-- ── 2. Sigla de 3 letras da regional ─────────────────────────────
CREATE OR REPLACE FUNCTION fn_regional_codigo(r regional_ac)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public AS $$
  SELECT CASE r
    WHEN 'baixo_acre'      THEN 'BAC'
    WHEN 'purus'           THEN 'PUR'
    WHEN 'jurua'           THEN 'JUR'
    WHEN 'tarauaca_envira' THEN 'TEN'
    WHEN 'alto_acre'       THEN 'AAC'
    ELSE 'XXX'
  END;
$$;

-- ── 3. Coluna do código + contador de sequência ──────────────────
ALTER TABLE registros_campo
  ADD COLUMN IF NOT EXISTS codigo_ocorrencia text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rc_codigo_ocorrencia
  ON registros_campo (codigo_ocorrencia) WHERE codigo_ocorrencia IS NOT NULL;

-- Contador atômico: 1 linha por (brigada, ano). ultimo_seq = último nº usado.
CREATE TABLE IF NOT EXISTS ocorrencia_seq (
  brigada_id uuid    NOT NULL REFERENCES brigadas(id) ON DELETE CASCADE,
  ano        smallint NOT NULL,
  ultimo_seq integer NOT NULL DEFAULT 0,
  PRIMARY KEY (brigada_id, ano)
);

ALTER TABLE ocorrencia_seq ENABLE ROW LEVEL SECURITY;
-- Sem políticas: só o trigger (SECURITY DEFINER do owner) acessa.

-- ── 4. Geração do código (BEFORE INSERT) ─────────────────────────
CREATE OR REPLACE FUNCTION fn_registro_codigo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _reg   regional_ac;
  _bcod  smallint;
  _ano   smallint;
  _seq   integer;
  _data  date;
BEGIN
  -- Só gera para linha realmente nova (não em correções reenviadas, que
  -- reusam o uuid_cliente) e quando há brigada para escopar a sequência.
  IF NEW.codigo_ocorrencia IS NOT NULL
     OR NEW.brigada_id IS NULL
     OR EXISTS (SELECT 1 FROM registros_campo WHERE uuid_cliente = NEW.uuid_cliente) THEN
    RETURN NEW;
  END IF;

  SELECT codigo, COALESCE(NEW.regional, regional)
    INTO _bcod, _reg
  FROM brigadas WHERE id = NEW.brigada_id;

  -- Data/ano no fuso do Acre (UTC-5)
  _data := (NEW.data_hora_evento AT TIME ZONE 'America/Rio_Branco')::date;
  _ano  := EXTRACT(YEAR FROM _data);

  INSERT INTO ocorrencia_seq (brigada_id, ano, ultimo_seq)
  VALUES (NEW.brigada_id, _ano, 1)
  ON CONFLICT (brigada_id, ano)
    DO UPDATE SET ultimo_seq = ocorrencia_seq.ultimo_seq + 1
  RETURNING ultimo_seq INTO _seq;

  NEW.codigo_ocorrencia :=
       fn_regional_codigo(_reg)
    || '-' || lpad(COALESCE(_bcod, 0)::text, 2, '0')
    || '-' || to_char(_data, 'DDMMYY')
    || '-' || lpad(_seq::text, 3, '0');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registro_zcodigo ON registros_campo;
CREATE TRIGGER trg_registro_zcodigo
  BEFORE INSERT ON registros_campo
  FOR EACH ROW EXECUTE FUNCTION fn_registro_codigo();

-- ── 5. Backfill dos registros já existentes ──────────────────────
-- Numera cronologicamente por brigada/ano (fuso do Acre).
WITH base AS (
  SELECT rc.id,
         (rc.data_hora_evento AT TIME ZONE 'America/Rio_Branco')::date          AS dloc,
         EXTRACT(YEAR FROM rc.data_hora_evento AT TIME ZONE 'America/Rio_Branco')::int AS ano,
         COALESCE(rc.regional, br.regional)                                      AS reg,
         br.codigo                                                               AS bcod,
         row_number() OVER (
           PARTITION BY rc.brigada_id,
                        EXTRACT(YEAR FROM rc.data_hora_evento AT TIME ZONE 'America/Rio_Branco')
           ORDER BY rc.data_hora_evento, rc.criado_em, rc.id
         ) AS seq
  FROM registros_campo rc
  JOIN brigadas br ON br.id = rc.brigada_id
  WHERE rc.codigo_ocorrencia IS NULL
    AND rc.brigada_id IS NOT NULL
)
UPDATE registros_campo rc
SET codigo_ocorrencia =
       fn_regional_codigo(base.reg)
    || '-' || lpad(COALESCE(base.bcod, 0)::text, 2, '0')
    || '-' || to_char(base.dloc, 'DDMMYY')
    || '-' || lpad(base.seq::text, 3, '0')
FROM base
WHERE base.id = rc.id;

-- Semeia o contador com o último nº usado por brigada/ano (sequência densa)
INSERT INTO ocorrencia_seq (brigada_id, ano, ultimo_seq)
SELECT rc.brigada_id,
       EXTRACT(YEAR FROM rc.data_hora_evento AT TIME ZONE 'America/Rio_Branco')::int,
       COUNT(*)
FROM registros_campo rc
WHERE rc.codigo_ocorrencia IS NOT NULL
  AND rc.brigada_id IS NOT NULL
GROUP BY rc.brigada_id,
         EXTRACT(YEAR FROM rc.data_hora_evento AT TIME ZONE 'America/Rio_Branco')
ON CONFLICT (brigada_id, ano)
  DO UPDATE SET ultimo_seq = GREATEST(ocorrencia_seq.ultimo_seq, EXCLUDED.ultimo_seq);

-- ── 6. View de validação/relatórios expõe o código ───────────────
DROP VIEW IF EXISTS vw_registros_validacao;
CREATE OR REPLACE VIEW vw_registros_validacao AS
SELECT
  rc.id, rc.uuid_cliente, rc.codigo_ocorrencia,
  rc.natureza, rc.atividade,
  rc.equipe, rc.equipe_id, eq.nome AS equipe_nome, rc.duracao_horas,
  rc.hora_inicio, rc.hora_fim,
  rc.origem_acionamento,
  rc.status_validacao, rc.motivo_rejeicao, rc.historico, rc.fotos_urls,
  rc.data_hora_evento, rc.criado_em, rc.sincronizado_em, rc.validado_em,
  rc.descricao, rc.area_estimada_ha, rc.pessoas_alcancadas, rc.precisao_gps_m,
  rc.alerta_cigma, rc.integrada_cbmac, rc.alerta_id, rc.ocorrencia_id,
  rc.uc_id, rc.brigada_id, rc.brigadista_id,
  COALESCE(rc.regional, br.regional, uc.regional) AS regional,
  rc.municipio,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_Y(rc.localizacao) END AS lat,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_X(rc.localizacao) END AS lng,
  b.nome_completo AS brigadista_nome,
  br.nome AS brigada_nome,
  uc.nome AS uc_nome,
  uv.nome_completo AS validado_por_nome,
  COALESCE(f.n_fauna, 0) AS n_fauna,
  COALESCE(f.n_fauna_pendente, 0) AS n_fauna_pendente,
  COALESCE(f.n_fauna_resgatada, 0) AS n_fauna_resgatada
FROM registros_campo rc
LEFT JOIN brigadistas b ON b.id = rc.brigadista_id
LEFT JOIN brigadas br ON br.id = rc.brigada_id
LEFT JOIN equipes_brigada eq ON eq.id = rc.equipe_id
LEFT JOIN unidades_conservacao uc ON uc.id = rc.uc_id
LEFT JOIN usuarios uv ON uv.id = rc.validado_por
LEFT JOIN (
  SELECT registro_campo_id,
    COUNT(*) AS n_fauna,
    COUNT(*) FILTER (WHERE NOT identificacao_confirmada) AS n_fauna_pendente,
    COALESCE(SUM(quantidade) FILTER (WHERE tipo_evento = 'resgate'), 0) AS n_fauna_resgatada
  FROM registro_fauna
  GROUP BY registro_campo_id
) f ON f.registro_campo_id = rc.id;

-- ── 7. RPCs do app passam a devolver o código ────────────────────
-- app_status_validacao: usado no poll para refletir status no app.
-- DROP necessário: muda o tipo de retorno (nova coluna codigo_ocorrencia).
DROP FUNCTION IF EXISTS app_status_validacao(UUID[]);

CREATE OR REPLACE FUNCTION app_status_validacao(uuids UUID[])
RETURNS TABLE (
  uuid_cliente      UUID,
  status_validacao  status_validacao,
  motivo_rejeicao   TEXT,
  codigo_ocorrencia TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _brigadista_id UUID;
BEGIN
  SELECT id INTO _brigadista_id
  FROM brigadistas
  WHERE usuario_id = auth.uid() AND status = 'ativo'
  LIMIT 1;

  IF _brigadista_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rc.uuid_cliente, rc.status_validacao, rc.motivo_rejeicao, rc.codigo_ocorrencia
  FROM   registros_campo rc
  WHERE  rc.uuid_cliente   = ANY(uuids)
    AND  rc.brigadista_id  = _brigadista_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_status_validacao(UUID[]) TO authenticated;

-- app_correcoes_pendentes: skeleton reconstruído carrega o código.
DROP FUNCTION IF EXISTS app_correcoes_pendentes();

CREATE FUNCTION app_correcoes_pendentes()
RETURNS TABLE (
  uuid_cliente       UUID,
  codigo_ocorrencia  TEXT,
  brigadista_id      UUID,
  brigada_id         UUID,
  uc_id              UUID,
  regional           regional_ac,
  equipe_id          UUID,
  natureza           TEXT,
  atividade          TEXT,
  hora_inicio        TIME,
  hora_fim           TIME,
  duracao_horas      NUMERIC,
  area_estimada_ha   NUMERIC,
  pessoas_alcancadas INTEGER,
  descricao          TEXT,
  origem_acionamento TEXT,
  integrada_cbmac    BOOLEAN,
  data_hora_evento   TIMESTAMPTZ,
  sincronizado_em    TIMESTAMPTZ,
  status_validacao   status_validacao,
  motivo_rejeicao    TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _brigadista_id UUID;
BEGIN
  SELECT id INTO _brigadista_id
  FROM brigadistas
  WHERE usuario_id = auth.uid() AND status = 'ativo'
  LIMIT 1;

  IF _brigadista_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    rc.uuid_cliente,
    rc.codigo_ocorrencia,
    rc.brigadista_id,
    rc.brigada_id,
    rc.uc_id,
    rc.regional,
    rc.equipe_id,
    rc.natureza::TEXT,
    rc.atividade::TEXT,
    rc.hora_inicio,
    rc.hora_fim,
    rc.duracao_horas,
    rc.area_estimada_ha,
    rc.pessoas_alcancadas,
    rc.descricao,
    rc.origem_acionamento::TEXT,
    rc.integrada_cbmac,
    rc.data_hora_evento,
    rc.sincronizado_em,
    rc.status_validacao,
    rc.motivo_rejeicao
  FROM registros_campo rc
  WHERE rc.brigadista_id  = _brigadista_id
    AND rc.status_validacao IN ('requer_correcao', 'rejeitado')
  ORDER BY rc.data_hora_evento DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION app_correcoes_pendentes() TO authenticated;
