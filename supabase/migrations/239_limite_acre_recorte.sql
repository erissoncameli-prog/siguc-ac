-- ── 239_limite_acre_recorte.sql ────────────────────────────────────────
-- Recorte geográfico pelo limite do Acre — corrige alertas e focos de
-- calor exibidos fora do estado no Mapa das UCs.
--
-- CAUSA: as duas ingestões pedem os dados por BOUNDING BOX retangular:
--   supabase/functions/ingest-focos      → ACRE_BBOX '-74.05,-11.25,-66.55,-7.05'
--   supabase/functions/monitorar-alertas → ACRE_BBOX '-73.8,-11.14,-66.6,-7.12'
-- Um retângulo em volta do Acre engloba pedaços do Amazonas, de
-- Rondônia, de Ucayali (Peru) e de Pando (Bolívia). Medido antes desta
-- migration: 113 de 362 focos FIRMS (31%) e 503 de 1.733 alertas DETER
-- (29%) estavam fora do estado. O BDQueimadas, única fonte que já
-- filtrava de verdade (estado = 'ACRE'), estava 100% correto — prova de
-- que o problema é o bbox, não a fonte.
--
-- DEFESA EM 2 CAMADAS, mesmo padrão da trava de veículo do Frota
-- (migration 180 + app):
--   1. cliente — js/mapa-recorte.js recorta antes de desenhar, e é o
--      que corrige a tela sem esperar o próximo cron;
--   2. banco — esta migration: o limite vira dado (limite_acre), a
--      pergunta vira função (geo_ponto_no_acre) e o INSERT fora do
--      Acre é descartado por trigger, independente de redeploy das
--      Edge Functions.
--
-- ⚠ CARGA DA GEOMETRIA — PASSO SEPARADO, POR pg_net
-- O polígono do IBGE tem 988 vértices (~21 KB). Em vez de embutir esse
-- literal aqui, o limite é carregado do MESMO arquivo que o cliente usa
-- (data/acre_estado.geojson, servido em produção), garantindo que banco
-- e navegador usem exatamente a mesma divisa. pg_net é assíncrono: a
-- requisição só sai depois do COMMIT, então a carga NÃO cabe dentro
-- desta transação. Depois de aplicar esta migration, rodar:
--
--   SELECT net.http_get('https://siguc-ac.vercel.app/data/acre_estado.geojson');
--   -- aguardar alguns segundos e então:
--   SELECT limite_acre_carregar();
--
-- FAIL-OPEN por segurança: enquanto limite_acre estiver vazia,
-- geo_ponto_no_acre() devolve TRUE e as triggers não descartam nada —
-- um banco novo se comporta como antes desta migration, nunca
-- rejeitando toda a ingestão por falta do polígono.
-- ────────────────────────────────────────────────────────────────────

-- ── Limite do estado (singleton) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS limite_acre (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  geom          geometry(MultiPolygon, 4326) NOT NULL,
  fonte         TEXT NOT NULL DEFAULT 'IBGE Malhas — UF 12 (Acre)',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_limite_acre_geom ON limite_acre USING GIST (geom);

ALTER TABLE limite_acre ENABLE ROW LEVEL SECURITY;

-- Leitura para qualquer autenticado (é dado público de referência).
-- Sem policy de escrita: o limite só muda por migration/carga.
DROP POLICY IF EXISTS limite_acre_select ON limite_acre;
CREATE POLICY limite_acre_select ON limite_acre
  FOR SELECT TO authenticated USING (true);

-- ── Carga do polígono a partir da resposta do pg_net ────────────────

-- Lê a resposta mais recente e bem-sucedida do arquivo público e grava
-- o limite. Idempotente: rodar de novo apenas atualiza a geometria.
CREATE OR REPLACE FUNCTION limite_acre_carregar()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_conteudo TEXT;
  v_geom     geometry;
BEGIN
  SELECT r.content INTO v_conteudo
    FROM net._http_response r
   WHERE r.status_code = 200
     AND r.content LIKE '%FeatureCollection%'
     AND r.content LIKE '%codarea%'
   ORDER BY r.id DESC
   LIMIT 1;

  IF v_conteudo IS NULL THEN
    RETURN 'nenhuma resposta pg_net encontrada — rode o net.http_get e aguarde';
  END IF;

  SELECT ST_Multi(ST_SetSRID(ST_Union(ST_GeomFromGeoJSON(f->>'geometry')), 4326))
    INTO v_geom
    FROM jsonb_array_elements((v_conteudo::jsonb)->'features') f;

  IF v_geom IS NULL OR ST_IsEmpty(v_geom) THEN
    RETURN 'geometria vazia — arquivo inesperado';
  END IF;

  INSERT INTO limite_acre (id, geom) VALUES (1, v_geom)
  ON CONFLICT (id) DO UPDATE
    SET geom = EXCLUDED.geom, atualizado_em = now();

  RETURN 'limite carregado: ' || ST_NPoints(v_geom) || ' vértices, área '
         || round((ST_Area(v_geom::geography) / 1e10)::numeric, 2) || ' milhões de ha';
END;
$$;

REVOKE ALL ON FUNCTION limite_acre_carregar() FROM PUBLIC, anon, authenticated;

-- ── A pergunta, em um lugar só ──────────────────────────────────────

-- FAIL-OPEN quando limite_acre está vazia (ver cabeçalho).
--
-- SECURITY DEFINER de propósito: a trigger abaixo roda com o papel de
-- quem insere, e se esse papel não enxergar limite_acre pela RLS a
-- função cairia no fail-open e deixaria passar ponto de fora. DEFINER
-- garante que a trava sempre veja a divisa. Em troca, o EXECUTE fica
-- só com service_role — nenhum código de cliente chama esta função, e
-- expô-la em /rest/v1/rpc só aumentaria superfície (é o que o advisor
-- authenticated_security_definer_function_executable aponta).
CREATE OR REPLACE FUNCTION geo_ponto_no_acre(p_lat DOUBLE PRECISION, p_lon DOUBLE PRECISION)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_lat IS NULL OR p_lon IS NULL THEN FALSE
    WHEN NOT EXISTS (SELECT 1 FROM limite_acre WHERE id = 1) THEN TRUE
    ELSE EXISTS (
      SELECT 1 FROM limite_acre
      WHERE id = 1
        AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326))
    )
  END;
$$;

REVOKE ALL ON FUNCTION geo_ponto_no_acre(DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION geo_ponto_no_acre(DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

-- ── Trava na origem ─────────────────────────────────────────────────

-- BEFORE INSERT que DESCARTA (RETURN NULL) a linha fora do Acre. Fica
-- no banco, e não só na Edge Function, porque assim nenhuma rota de
-- ingestão — atual ou futura — consegue gravar ponto de outro estado
-- ou de outro país. Linha sem coordenada passa: quem valida presença
-- de geometria é cada fluxo, não este gatilho.
CREATE OR REPLACE FUNCTION geo_descartar_fora_do_acre()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_lat DOUBLE PRECISION;
  v_lon DOUBLE PRECISION;
BEGIN
  IF TG_TABLE_NAME = 'focos_calor' THEN
    v_lat := NEW.lat; v_lon := NEW.lon;
  ELSE
    IF NEW.geom IS NULL THEN RETURN NEW; END IF;
    v_lat := ST_Y(NEW.geom::geometry); v_lon := ST_X(NEW.geom::geometry);
  END IF;

  IF v_lat IS NULL OR v_lon IS NULL THEN RETURN NEW; END IF;
  IF geo_ponto_no_acre(v_lat, v_lon) THEN RETURN NEW; END IF;
  RETURN NULL;  -- fora do Acre: linha descartada silenciosamente
END;
$$;

-- Só deve rodar via trigger, nunca chamada direta pelo cliente —
-- mesmo cuidado da migration 179.
REVOKE ALL ON FUNCTION geo_descartar_fora_do_acre() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_focos_calor_no_acre ON focos_calor;
CREATE TRIGGER trg_focos_calor_no_acre
  BEFORE INSERT ON focos_calor
  FOR EACH ROW EXECUTE FUNCTION geo_descartar_fora_do_acre();

DROP TRIGGER IF EXISTS trg_alertas_ambientais_no_acre ON alertas_ambientais;
CREATE TRIGGER trg_alertas_ambientais_no_acre
  BEFORE INSERT ON alertas_ambientais
  FOR EACH ROW EXECUTE FUNCTION geo_descartar_fora_do_acre();

-- ── Limpeza do que já foi gravado ───────────────────────────────────

-- Roda só se o limite já estiver carregado; num banco novo (tabela
-- vazia) não há o que limpar mesmo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM limite_acre WHERE id = 1) THEN
    RAISE NOTICE 'limite_acre vazia — limpeza adiada; rodar limite_acre_limpar_fora() após a carga';
    RETURN;
  END IF;

  -- Alertas: desativados, não apagados — 'ativo' já é o mecanismo de
  -- exclusão da tabela e mantém o histórico auditável.
  UPDATE alertas_ambientais a
     SET ativo = FALSE
    FROM limite_acre l
   WHERE l.id = 1
     AND a.ativo
     AND a.geom IS NOT NULL
     AND NOT ST_Contains(l.geom, a.geom::geometry);

  -- Focos: apagados. A tabela é uma janela móvel — a própria
  -- ingest-focos apaga e reinsere os últimos dias a cada execução.
  DELETE FROM focos_calor f
   USING limite_acre l
   WHERE l.id = 1
     AND NOT ST_Contains(l.geom, ST_SetSRID(ST_MakePoint(f.lon, f.lat), 4326));
END $$;

-- Mesma limpeza, chamável depois da carga do polígono (ver cabeçalho).
CREATE OR REPLACE FUNCTION limite_acre_limpar_fora()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alertas INT := 0;
  v_focos   INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM limite_acre WHERE id = 1) THEN
    RETURN 'limite_acre vazia — carregue o polígono antes';
  END IF;

  UPDATE alertas_ambientais a
     SET ativo = FALSE
    FROM limite_acre l
   WHERE l.id = 1 AND a.ativo AND a.geom IS NOT NULL
     AND NOT ST_Contains(l.geom, a.geom::geometry);
  GET DIAGNOSTICS v_alertas = ROW_COUNT;

  DELETE FROM focos_calor f
   USING limite_acre l
   WHERE l.id = 1
     AND NOT ST_Contains(l.geom, ST_SetSRID(ST_MakePoint(f.lon, f.lat), 4326));
  GET DIAGNOSTICS v_focos = ROW_COUNT;

  RETURN v_alertas || ' alerta(s) desativado(s), ' || v_focos || ' foco(s) apagado(s)';
END;
$$;

REVOKE ALL ON FUNCTION limite_acre_limpar_fora() FROM PUBLIC, anon, authenticated;

-- NÃO toca em focos_calor_ac (953 mil linhas, série histórica
-- 2001-2024 importada por script). Apagar ~30% de um arquivo histórico
-- é irreversível e não foi pedido; a linha do tempo do mapa recorta
-- esses pontos no cliente (_tlRenderAno, pages/mapa.html).
