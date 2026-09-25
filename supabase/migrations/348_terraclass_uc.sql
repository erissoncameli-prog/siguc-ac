-- ═══════════════════════════════════════════════════════════════════
-- 348 — Uso do solo das áreas desmatadas por UC (TerraClass × limite)
-- ═══════════════════════════════════════════════════════════════════
-- Diferente do recorte por município (347, agregação de ATRIBUTO — o
-- polígono do TerraClass já vem cortado por município), UC exige cortar a
-- GEOMETRIA de cada polígono pelo limite da UC. E geometria do TerraClass
-- NÃO entra pelo pg_net: foi uma página dela que reiniciou o banco de
-- produção pela 3ª vez (25/09/2026 21:29 UTC, ver CLAUDE.md).
--
-- Por isso o cálculo roda FORA do banco: `scripts/terraclass_uc.py`, no
-- workflow `.github/workflows/terraclass-uc.yml`. O script lê o limite das
-- UCs e grava SÓ os totais aqui, pela API de gerenciamento do Supabase
-- (mesmo segredo SUPABASE_ACCESS_TOKEN do deploy — nenhuma chave nova,
-- nada no frontend). Área = geodésica (pyproj.Geod), a mesma medida do
-- `ST_Area(geography)` usado no resto do painel.
--
-- Só entram polígonos que foram USO em algum ano (os que são floresta,
-- água ou vegetação natural em TODOS os anos ficam de fora na própria
-- consulta ao WFS) — é o que qualifica o desmatado, e o que mantém o
-- volume baixável.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.terraclass_uc (
  ano        smallint NOT NULL,
  uc_id      uuid     NOT NULL REFERENCES public.unidades_conservacao(id) ON DELETE CASCADE,
  classe     smallint NOT NULL,
  poligonos  integer  NOT NULL,
  area_ha    numeric  NOT NULL,
  calculado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ano, uc_id, classe)
);
COMMENT ON TABLE public.terraclass_uc IS
  'TerraClass (INPE/Embrapa) recortado pelo limite de cada UC: área por ano × classe. Calculado fora do banco (scripts/terraclass_uc.py) — só polígonos que foram uso em algum ano.';

ALTER TABLE public.terraclass_uc ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS terraclass_uc_select ON public.terraclass_uc;
CREATE POLICY terraclass_uc_select ON public.terraclass_uc
  FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
REVOKE ALL ON public.terraclass_uc FROM anon;
