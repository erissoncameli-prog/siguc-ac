-- ============================================================
-- 360_embargos_ambientais.sql
-- Embargos ambientais no Acre, para cruzar com o CAR por SOBREPOSIÇÃO
-- (relatório "CAR na UC" e relatório do imóvel aberto pelo Mapa).
--
-- Fontes (mesmas do Selo Verde AC, CSR/UFMG — conferido em 17/10/2026):
--  - IBAMA: termos de embargo, dados abertos (CSV nacional de ~210 MB,
--    atualizado quase todo dia), com o polígono embargado em WKT. NÃO traz
--    o nº do CAR — por isso o cruzamento é geométrico.
--  - IMAC: embargos administrativos estaduais, 1 ZIP por ano (2023→),
--    em imac.ac.gov.br/fiscalizacao-autuacoes/.
--  - ICMBio: previsto na coluna `fonte`, sem carga — o arquivo público
--    não foi localizado (ver CLAUDE.md).
--
-- Carga FORA do banco: scripts/embargos_carga.py no workflow
-- .github/workflows/embargos.yml (mesmo padrão do TerraClass por UC, 348).
-- O CSV do IBAMA é grande demais para pg_net (regra dura do CLAUDE.md:
-- resposta grande pelo pg_net já reiniciou a produção 3 vezes) e os ZIPs
-- do IMAC são binários (o pg_net corta no primeiro byte nulo).
--
-- LGPD (minimização): NÃO se guarda nome nem CPF/CNPJ do embargado nem o
-- nome do imóvel — o cruzamento é espacial, não precisa deles. O dado das
-- fontes é público; mesmo assim não há por que copiá-lo.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.embargos_ambientais (
  id               bigserial PRIMARY KEY,
  fonte            text NOT NULL CHECK (fonte IN ('ibama', 'imac', 'icmbio')),
  chave            text NOT NULL,              -- id do registro na fonte (dedup da recarga)
  num_termo        text,
  num_auto         text,
  num_processo     text,
  data_embargo     date,
  situacao         text NOT NULL DEFAULT 'vigente'
                     CHECK (situacao IN ('vigente', 'desembargado', 'cancelado', 'desconhecida')),
  data_desembargo  date,
  area_ha          numeric,
  municipio        text,
  descricao        text,
  geom             geometry(Geometry, 4326),   -- polígono; ponto quando a fonte só tem coordenada
  carregado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fonte, chave)
);

CREATE INDEX IF NOT EXISTS embargos_ambientais_geom_gix ON public.embargos_ambientais USING gist (geom);

COMMENT ON TABLE public.embargos_ambientais IS
  'Embargos ambientais (IBAMA, IMAC) no Acre, carregados por scripts/embargos_carga.py. Cruzamento com o CAR é por sobreposição. Sem nome/CPF do embargado (minimização). Migration 360.';

-- Última carga de cada fonte (a tela diz "atualizado em …"; carga que
-- falhou também fica registrada, para o relatório nunca fingir atualidade).
CREATE TABLE IF NOT EXISTS public.embargos_cargas (
  id           bigserial PRIMARY KEY,
  fonte        text NOT NULL,
  executado_em timestamptz NOT NULL DEFAULT now(),
  ok           boolean NOT NULL,
  linhas       int,
  observacao   text
);

ALTER TABLE public.embargos_ambientais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embargos_cargas ENABLE ROW LEVEL SECURITY;

-- Leitura: mesmo gate dos relatórios de CAR (grupo Gestão) e do Mapa.
-- Escrita: nenhuma policy — só o script, pela API de gerenciamento.
CREATE POLICY embargos_select ON public.embargos_ambientais
  FOR SELECT TO authenticated USING (pode_ver('monitoramento') OR pode_ver('mapa'));
CREATE POLICY embargos_cargas_select ON public.embargos_cargas
  FOR SELECT TO authenticated USING (pode_ver('monitoramento') OR pode_ver('mapa'));

REVOKE ALL ON public.embargos_ambientais, public.embargos_cargas FROM anon;
GRANT SELECT ON public.embargos_ambientais, public.embargos_cargas TO authenticated;

-- Embargos dentro de um retângulo (a UC do relatório ou o imóvel do Mapa).
-- A interseção com cada CAR é feita no navegador (turf), como o PRODES e
-- as zonas: a geometria do CAR vem AO VIVO do SICAR e não está no banco.
-- SECURITY INVOKER: quem não passa na RLS recebe lista vazia.
CREATE OR REPLACE FUNCTION public.car_embargos_bbox(
  p_xmin double precision, p_ymin double precision,
  p_xmax double precision, p_ymax double precision)
RETURNS TABLE (
  id bigint, fonte text, num_termo text, num_auto text, num_processo text,
  data_embargo date, situacao text, data_desembargo date, area_ha numeric,
  municipio text, descricao text, geojson text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT e.id, e.fonte, e.num_termo, e.num_auto, e.num_processo,
         e.data_embargo, e.situacao, e.data_desembargo, e.area_ha,
         e.municipio, left(e.descricao, 400),
         ST_AsGeoJSON(CASE WHEN GeometryType(e.geom) LIKE '%POLYGON'
                           THEN ST_SimplifyPreserveTopology(e.geom, 0.00002) ELSE e.geom END, 6)
    FROM embargos_ambientais e
   WHERE e.geom && ST_MakeEnvelope(p_xmin, p_ymin, p_xmax, p_ymax, 4326)
   ORDER BY e.data_embargo DESC NULLS LAST
   LIMIT 5000
$$;
REVOKE ALL ON FUNCTION public.car_embargos_bbox(double precision, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.car_embargos_bbox(double precision, double precision, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.car_embargos_atualizacao()
RETURNS TABLE (fonte text, executado_em timestamptz, ok boolean, linhas int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT DISTINCT ON (c.fonte) c.fonte, c.executado_em, c.ok, c.linhas
    FROM embargos_cargas c
   ORDER BY c.fonte, c.executado_em DESC
$$;
REVOKE ALL ON FUNCTION public.car_embargos_atualizacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.car_embargos_atualizacao() TO authenticated;
