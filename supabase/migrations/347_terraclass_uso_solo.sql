-- ═══════════════════════════════════════════════════════════════════
-- 347 — Uso do solo das áreas desmatadas (TerraClass) + contorno do
--       recorte para o minimapa do Painel de Fogo e Desmatamento
-- ═══════════════════════════════════════════════════════════════════
-- O PRODES diz QUANTO foi desmatado; o TerraClass (INPE/Embrapa) diz O
-- QUE aquilo virou — pastagem, vegetação secundária (capoeira), lavoura,
-- área urbana, mineração… É a fonte que qualifica o desmatado com o
-- MESMO recorte do PRODES (o MapBiomas é outra metodologia e conta a
-- capoeira como floresta; os dois nunca são somados).
--
-- Fonte: WFS do próprio TerraClass (www.terraclass.gov.br/geoserver),
-- camada TerraClass:tc_transicoes_ac_amz_v6 — 234.567 polígonos do Acre,
-- cada um com o código IBGE do município (cd_geocmu), a classe em
-- 2008, 2010 … 2024 e a área (area_km). Os polígonos já vêm recortados
-- pelo município, então a soma por município NÃO precisa de junção
-- espacial: é agregação de atributo. Acre = soma dos 22.
--
-- Legenda: códigos e nomes conferidos contra a legenda OFICIAL do raster
-- TerraClass Amazônia 2024 (GetLegendGraphic do mesmo servidor), nunca
-- deduzidos.
--
-- ⚠️ Carga em 2 passos (pg_net é assíncrono) e UMA resposta por chamada
-- (regra da casa desde os reinícios de 23–24/09/2026): pede-se 1
-- município por vez, sem geometria (só atributos, 1–5 MB por município).
-- ═══════════════════════════════════════════════════════════════════

-- ── Legenda oficial ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.terraclass_classes (
  codigo smallint PRIMARY KEY,
  nome   text NOT NULL,
  cor    text NOT NULL,               -- cor oficial do TerraClass (referência)
  grupo  text NOT NULL                -- agrupamento usado no painel
);
INSERT INTO public.terraclass_classes(codigo, nome, cor, grupo) VALUES
  (1,  'Vegetação natural florestal primária',        '#005500', 'floresta'),
  (2,  'Vegetação natural florestal secundária',      '#0FC80F', 'secundaria'),
  (9,  'Silvicultura',                                '#A8A800', 'agricultura'),
  (10, 'Pastagem arbustiva/arbórea',                  '#E6A04B', 'pastagem'),
  (11, 'Pastagem herbácea',                           '#FFEC87', 'pastagem'),
  (12, 'Cultura agrícola perene',                     '#FF8828', 'agricultura'),
  (13, 'Cultura agrícola semiperene',                 '#996400', 'agricultura'),
  (14, 'Cultura agrícola temporária de 1 ciclo',      '#FFE300', 'agricultura'),
  (15, 'Cultura agrícola temporária de mais de 1 ciclo', '#FFFF00', 'agricultura'),
  (16, 'Mineração',                                   '#AD89CD', 'outros_usos'),
  (17, 'Urbanizada',                                  '#FFA8C0', 'urbano'),
  (20, 'Outros usos',                                 '#E1E1E1', 'outros_usos'),
  (22, 'Desflorestamento no ano',                     '#FF0000', 'desmat_ano'),
  (23, 'Corpo d''água',                               '#0000FF', 'agua'),
  (25, 'Não observado',                               '#FFFFFF', 'nao_observado'),
  (51, 'Natural não florestal',                       '#B4D79E', 'natural_nao_florestal')
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, cor = EXCLUDED.cor, grupo = EXCLUDED.grupo;

-- ── Área por município × ano × classe ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.terraclass_mun (
  ano       smallint NOT NULL,
  cd_ibge   text     NOT NULL REFERENCES public.municipios_acre(cd_ibge) ON DELETE CASCADE,
  classe    smallint NOT NULL,
  poligonos integer  NOT NULL,
  area_ha   numeric  NOT NULL,
  PRIMARY KEY (ano, cd_ibge, classe)
);
CREATE TABLE IF NOT EXISTS public.terraclass_pedidos (
  cd_ibge       text PRIMARY KEY,
  request_id    bigint NOT NULL,
  solicitado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.terraclass_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terraclass_mun     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terraclass_pedidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS terraclass_classes_select ON public.terraclass_classes;
CREATE POLICY terraclass_classes_select ON public.terraclass_classes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS terraclass_mun_select ON public.terraclass_mun;
CREATE POLICY terraclass_mun_select ON public.terraclass_mun FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
REVOKE ALL ON public.terraclass_classes, public.terraclass_mun FROM anon;
REVOKE ALL ON public.terraclass_pedidos FROM anon, authenticated;

-- ── Pedido: p_n municípios por vez (padrão: todos os que faltam) ────
CREATE OR REPLACE FUNCTION public.terraclass_solicitar(p_n int DEFAULT 22, p_refazer boolean DEFAULT false)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT m.cd_ibge FROM municipios_acre m
     WHERE NOT EXISTS (SELECT 1 FROM terraclass_pedidos p WHERE p.cd_ibge = m.cd_ibge)
       AND (p_refazer OR NOT EXISTS (SELECT 1 FROM terraclass_mun t WHERE t.cd_ibge = m.cd_ibge))
     ORDER BY m.cd_ibge
     LIMIT greatest(p_n, 1)
  LOOP
    INSERT INTO terraclass_pedidos(cd_ibge, request_id)
    VALUES (r.cd_ibge, net.http_get(
      url := 'https://www.terraclass.gov.br/geoserver/ows?service=WFS&version=1.1.0&request=GetFeature'
          || '&typeName=TerraClass:tc_transicoes_ac_amz_v6'
          || '&propertyName=classe_2008,classe_2010,classe_2012,classe_2014,classe_2016,classe_2018,classe_2020,classe_2022,classe_2024,area_km'
          || '&maxFeatures=200000&outputFormat=application/json'
          || '&CQL_FILTER=cd_geocmu=%27' || r.cd_ibge || '%27',
      timeout_milliseconds := 180000));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.terraclass_solicitar(int, boolean) FROM PUBLIC, anon, authenticated;

-- ── Coleta: UMA resposta por chamada ────────────────────────────────
-- Só grava se a resposta trouxer TODAS as feições do município
-- (numberReturned = totalFeatures); senão, nada é gravado e o pedido
-- sai da fila para ser refeito — nunca meio município.
CREATE OR REPLACE FUNCTION public.terraclass_coletar(p_max int DEFAULT 1)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; resp record; j jsonb; msg text := ''; n int;
BEGIN
  FOR p IN SELECT tp.* FROM terraclass_pedidos tp
            WHERE EXISTS (SELECT 1 FROM net._http_response r WHERE r.id = tp.request_id)
            ORDER BY tp.cd_ibge LIMIT greatest(p_max, 1) LOOP
    SELECT status_code, content INTO resp FROM net._http_response WHERE id = p.request_id;
    DELETE FROM terraclass_pedidos WHERE cd_ibge = p.cd_ibge;
    IF resp.status_code IS DISTINCT FROM 200 THEN
      msg := msg || p.cd_ibge || ': HTTP ' || coalesce(resp.status_code::text, 'falha') || '; ';
      CONTINUE;
    END IF;
    j := resp.content::jsonb;
    IF (j->>'numberReturned')::int IS DISTINCT FROM (j->>'totalFeatures')::int OR (j->>'totalFeatures')::int = 0 THEN
      msg := msg || p.cd_ibge || ': resposta incompleta (' || coalesce(j->>'numberReturned','?') || '/' || coalesce(j->>'totalFeatures','?') || '); ';
      CONTINUE;
    END IF;

    DELETE FROM terraclass_mun WHERE cd_ibge = p.cd_ibge;
    INSERT INTO terraclass_mun(ano, cd_ibge, classe, poligonos, area_ha)
    SELECT a.ano, p.cd_ibge, (f->'properties'->>('classe_' || a.ano))::smallint,
           count(*), round(sum((f->'properties'->>'area_km')::numeric) * 100, 2)
      FROM jsonb_array_elements(j->'features') f
     CROSS JOIN (VALUES (2008),(2010),(2012),(2014),(2016),(2018),(2020),(2022),(2024)) a(ano)
     WHERE f->'properties'->>('classe_' || a.ano) IS NOT NULL
     GROUP BY 1, 3;
    GET DIAGNOSTICS n = ROW_COUNT;
    msg := msg || p.cd_ibge || ': ' || n || ' linhas; ';
  END LOOP;
  RETURN coalesce(nullif(msg, ''), 'nada pendente');
END $$;
REVOKE ALL ON FUNCTION public.terraclass_coletar(int) FROM PUBLIC, anon, authenticated;

-- ── Contorno do recorte para o minimapa (SVG no painel) ─────────────
-- SECURITY INVOKER: devolve só o que a RLS de cada tabela já libera.
-- Geometria simplificada (~400 m) — é desenho de referência, não medida.
CREATE OR REPLACE FUNCTION public.painel_recorte_geo(p_escopo text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_acre jsonb; v_alvo jsonb; v_mun jsonb;
BEGIN
  SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.004), 4)::jsonb INTO v_acre FROM limite_acre LIMIT 1;

  -- municípios sempre como pano de fundo (linhas finas)
  SELECT jsonb_agg(jsonb_build_object('cd', cd_ibge, 'nome', nome,
           'g', ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.006), 4)::jsonb))
    INTO v_mun FROM municipios_acre;

  IF p_escopo LIKE 'mun:%' THEN
    SELECT jsonb_agg(ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.003), 4)::jsonb)
      INTO v_alvo FROM municipios_acre WHERE cd_ibge = substr(p_escopo, 5);
  ELSIF p_escopo = 'ucs' THEN
    SELECT jsonb_agg(ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.003), 4)::jsonb)
      INTO v_alvo FROM unidades_conservacao WHERE ativo AND geom IS NOT NULL;
  ELSIF p_escopo LIKE 'esf:%' THEN
    SELECT jsonb_agg(ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.003), 4)::jsonb)
      INTO v_alvo FROM unidades_conservacao WHERE ativo AND geom IS NOT NULL AND esfera::text = substr(p_escopo, 5);
  ELSIF p_escopo ~ '^[0-9a-f-]{36}$' THEN
    SELECT jsonb_agg(ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.002), 4)::jsonb)
      INTO v_alvo FROM unidades_conservacao WHERE id = p_escopo::uuid AND geom IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('acre', v_acre, 'municipios', coalesce(v_mun, '[]'::jsonb), 'alvo', coalesce(v_alvo, '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.painel_recorte_geo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.painel_recorte_geo(text) TO authenticated;

-- ── Crons: o TerraClass sai a cada 2 anos; conferir 1×/mês basta ────
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('terraclass-solicitar', 'terraclass-coletar');
SELECT cron.schedule('terraclass-solicitar', '0 12 4 * *', $$SELECT public.terraclass_solicitar(22, true)$$);
SELECT cron.schedule('terraclass-coletar', '*/5 12,13,14 4 * *', $$SELECT public.terraclass_coletar(1)$$);
