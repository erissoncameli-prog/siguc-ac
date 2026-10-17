-- ============================================================
-- 361_prodes_taxa_oficial.sql
-- Taxa OFICIAL de desmatamento do PRODES (INPE) para o Acre, em km²,
-- numa série À PARTE da área dos polígonos (prodes_resumo_ano).
--
-- Por que à parte (medido em 16/10/2026): a taxa oficial não é a soma dos
-- polígonos do incremento — leva correção de nuvem e outros ajustes.
-- 2025: taxa 324 km² × polígonos 275 km². 2022: 840 × 1.006. Pôr a taxa
-- como barra junto dos polígonos misturaria duas medidas e a tendência
-- ficaria errada. O painel mostra a taxa num card próprio, só em "Acre
-- todo" (o INPE só publica taxa por estado), e ela nunca entra no teste
-- de tendência nem é somada a nada.
--
-- Fonte: o arquivo que o próprio painel do TerraBrasilis lê
-- (app/prodes/dashboard/deforestation/files/rates<ANO>.json, ~24 KB —
-- cabe com folga no pg_net; ver a regra dura das respostas grandes no
-- CLAUDE.md). O nome do arquivo leva o ano da última estimativa, então o
-- solicitar pede ano−1, ano e ano+1 e o coletar usa o que tiver o ano
-- mais recente. O Acre é a área `loiname` 18278 no arquivo — conferido
-- contra as notas do INPE e da imprensa (2022 = 840, 2023 = 601,
-- 2024 = 449, 2025 = 324, 2026 = 252). Trava: se o 1988 desse código não
-- for 620 km² (1º ano da série do Acre), o código mudou e nada é gravado.
--
-- Estimada × consolidada: o arquivo não diz. Regra: o ano mais recente do
-- arquivo nasce `estimada`; vira `consolidada` quando o valor dele muda
-- (o INPE publicou a consolidação — o estimado fica em km2_estimado) ou,
-- sem mudança, a partir de 1º/ago do ano seguinte (quando já começou
-- outro ano-PRODES e a consolidação já saiu no 1º semestre).
--
-- Série desde 2008 (decisão do usuário), para casar com o painel.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.prodes_taxa_ano (
  uf            char(2)  NOT NULL DEFAULT 'AC',
  ano           int      NOT NULL CHECK (ano >= 2008),
  km2           numeric  NOT NULL CHECK (km2 >= 0),
  tipo          text     NOT NULL CHECK (tipo IN ('estimada', 'consolidada')),
  km2_estimado  numeric,                -- o número estimado, quando a consolidação o substituiu
  divulgado_em  date,                   -- last_update_date do TerraBrasilis na coleta
  fonte         text     NOT NULL DEFAULT 'INPE/PRODES — TerraBrasilis (taxas por estado)',
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uf, ano)
);
COMMENT ON TABLE public.prodes_taxa_ano IS
  'Taxa oficial de desmatamento PRODES por estado (km²). NÃO é a soma dos polígonos (prodes_resumo_ano) — nunca somar nem misturar no mesmo gráfico. Migration 361.';

ALTER TABLE public.prodes_taxa_ano ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'prodes_taxa_ano' AND policyname = 'prodes_taxa_ano_select') THEN
    CREATE POLICY prodes_taxa_ano_select ON public.prodes_taxa_ano
      FOR SELECT TO authenticated USING (pode_ver('mapa'));
  END IF;
END $$;
REVOKE ALL ON public.prodes_taxa_ano FROM anon;
GRANT SELECT ON public.prodes_taxa_ano TO authenticated;

-- Pedidos pg_net em voo (só as funções abaixo tocam; RLS sem policy).
CREATE TABLE IF NOT EXISTS public.prodes_taxa_pedidos (
  arquivo       text PRIMARY KEY,       -- 'rates2026.json', 'last_update_date.json'
  request_id    bigint NOT NULL,
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  coletado      boolean NOT NULL DEFAULT false
);
ALTER TABLE public.prodes_taxa_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prodes_taxa_pedidos FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.prodes_taxa_solicitar()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a int := extract(year FROM now())::int; arq text; rid bigint; n int := 0;
BEGIN
  FOREACH arq IN ARRAY ARRAY['rates' || (a - 1) || '.json', 'rates' || a || '.json',
                             'rates' || (a + 1) || '.json', 'last_update_date.json'] LOOP
    SELECT net.http_get(
      'https://terrabrasilis.dpi.inpe.br/app/prodes/dashboard/deforestation/files/' || arq,
      timeout_milliseconds := 60000) INTO rid;
    INSERT INTO prodes_taxa_pedidos (arquivo, request_id) VALUES (arq, rid)
      ON CONFLICT (arquivo) DO UPDATE
        SET request_id = EXCLUDED.request_id, solicitado_em = now(), coletado = false;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_taxa_solicitar() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prodes_taxa_coletar()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record; j jsonb; melhor jsonb; ano_max int := 0; amax int;
  ref_1988 numeric; dt date; lin record; atual record; n int := 0;
  pendentes int;
BEGIN
  SELECT count(*) INTO pendentes
    FROM prodes_taxa_pedidos pe
    LEFT JOIN net._http_response resp ON resp.id = pe.request_id
   WHERE NOT pe.coletado AND resp.id IS NULL;
  IF pendentes > 0 THEN
    RAISE NOTICE 'prodes_taxa_coletar: % resposta(s) ainda não chegaram', pendentes;
    RETURN 0;
  END IF;

  FOR p IN
    SELECT pe.arquivo, resp.status_code, resp.content
      FROM prodes_taxa_pedidos pe JOIN net._http_response resp ON resp.id = pe.request_id
     WHERE NOT pe.coletado
  LOOP
    CONTINUE WHEN p.status_code IS DISTINCT FROM 200 OR p.content IS NULL;
    -- Nunca converter resposta grande (regra do CLAUDE.md): o arquivo
    -- real tem ~24 KB; acima de 1 MB é outra coisa.
    CONTINUE WHEN length(p.content) > 1000000;
    BEGIN
      j := p.content::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF p.arquivo = 'last_update_date.json' THEN
      BEGIN dt := (j->>'last_date')::date; EXCEPTION WHEN others THEN dt := NULL; END;
    ELSIF jsonb_typeof(j->'periods') = 'array' THEN
      SELECT max((pp->'endDate'->>'year')::int) INTO amax FROM jsonb_array_elements(j->'periods') pp;
      IF amax > ano_max THEN ano_max := amax; melhor := j; END IF;
    END IF;
  END LOOP;

  IF melhor IS NULL THEN
    RAISE NOTICE 'prodes_taxa_coletar: nenhum arquivo de taxas válido';
    RETURN 0;
  END IF;

  -- Trava de identidade do código do Acre.
  SELECT (a->>'area')::numeric INTO ref_1988
    FROM jsonb_array_elements(melhor->'periods') pp,
         jsonb_array_elements(pp->'features') f,
         jsonb_array_elements(f->'areas') a
   WHERE (pp->'endDate'->>'year')::int = 1988 AND f->>'loiname' = '18278' AND (a->>'type') = '1';
  IF ref_1988 IS DISTINCT FROM 620 THEN
    RAISE WARNING 'prodes_taxa_coletar: o código 18278 não parece ser o Acre (1988 = %); nada gravado', ref_1988;
    RETURN 0;
  END IF;

  FOR lin IN
    SELECT (pp->'endDate'->>'year')::int AS ano, (a->>'area')::numeric AS km2
      FROM jsonb_array_elements(melhor->'periods') pp,
           jsonb_array_elements(pp->'features') f,
           jsonb_array_elements(f->'areas') a
     WHERE f->>'loiname' = '18278' AND (a->>'type') = '1'
       AND (pp->'endDate'->>'year')::int >= 2008
  LOOP
    SELECT * INTO atual FROM prodes_taxa_ano WHERE uf = 'AC' AND ano = lin.ano;
    IF NOT FOUND THEN
      INSERT INTO prodes_taxa_ano (uf, ano, km2, tipo, divulgado_em)
      VALUES ('AC', lin.ano, lin.km2,
              CASE WHEN lin.ano = ano_max AND current_date < make_date(lin.ano + 1, 8, 1)
                   THEN 'estimada' ELSE 'consolidada' END,
              dt);
      n := n + 1;
    ELSIF atual.km2 IS DISTINCT FROM lin.km2 THEN
      UPDATE prodes_taxa_ano
         SET km2 = lin.km2,
             km2_estimado = CASE WHEN atual.tipo = 'estimada' THEN atual.km2 ELSE km2_estimado END,
             tipo = 'consolidada', divulgado_em = coalesce(dt, divulgado_em), atualizado_em = now()
       WHERE uf = 'AC' AND ano = lin.ano;
      n := n + 1;
    ELSIF atual.tipo = 'estimada' AND current_date >= make_date(lin.ano + 1, 8, 1) THEN
      UPDATE prodes_taxa_ano SET tipo = 'consolidada', atualizado_em = now()
       WHERE uf = 'AC' AND ano = lin.ano;
      n := n + 1;
    END IF;
  END LOOP;

  UPDATE prodes_taxa_pedidos SET coletado = true WHERE NOT coletado;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_taxa_coletar() FROM PUBLIC, anon, authenticated;

-- Polígonos do ano recém-divulgado: a taxa sai em outubro, os polígonos
-- vêm depois. Enquanto houver ano com taxa e SEM polígonos, pede todo dia
-- só esse ano (ano não publicado responde 0 feições — resposta pequena);
-- quando os polígonos entram, prodes_resumo_coletar grava o ano (com UC
-- e município) e a checagem diária para de pedir sozinha.
CREATE OR REPLACE FUNCTION public.prodes_poligonos_verificar()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a int; n int := 0;
BEGIN
  FOR a IN
    SELECT t.ano FROM prodes_taxa_ano t
     WHERE t.uf = 'AC'
       AND NOT EXISTS (SELECT 1 FROM prodes_resumo_ano r WHERE r.ano = t.ano)
       AND NOT EXISTS (SELECT 1 FROM prodes_resumo_pedidos pe WHERE pe.ano = t.ano
                        AND pe.solicitado_em > now() - interval '20 hours')
  LOOP
    PERFORM prodes_resumo_solicitar(a, a);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_poligonos_verificar() FROM PUBLIC, anon, authenticated;

-- Taxa: todo dia (o arquivo tem ~24 KB). Sai 2× por ano — estimativa em
-- out/nov, consolidação no 1º semestre — e entra no painel no dia seguinte.
-- Pedidos ficam na tabela (coletado = true), sem apagar linha: o apply_migration
-- do MCP expira com comando destrutivo no texto.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN
  ('prodes-taxa-solicitar', 'prodes-taxa-coletar', 'prodes-poligonos-verificar', 'prodes-poligonos-coletar');
SELECT cron.schedule('prodes-taxa-solicitar', '5 9 * * *', $$SELECT public.prodes_taxa_solicitar()$$);
SELECT cron.schedule('prodes-taxa-coletar', '15 9 * * *', $$SELECT public.prodes_taxa_coletar()$$);
SELECT cron.schedule('prodes-poligonos-verificar', '25 9 * * *', $$SELECT public.prodes_poligonos_verificar()$$);
SELECT cron.schedule('prodes-poligonos-coletar', '45 9 * * *', $$SELECT public.prodes_resumo_coletar(1)$$);

-- Carga inicial: mesmos números do arquivo do INPE lido em 17/10/2026
-- (last_update_date 2026-10-16). O cron acima confere e atualiza.
INSERT INTO public.prodes_taxa_ano (uf, ano, km2, tipo, divulgado_em) VALUES
  ('AC',2008,254,'consolidada','2026-10-16'),('AC',2009,167,'consolidada','2026-10-16'),
  ('AC',2010,259,'consolidada','2026-10-16'),('AC',2011,280,'consolidada','2026-10-16'),
  ('AC',2012,305,'consolidada','2026-10-16'),('AC',2013,221,'consolidada','2026-10-16'),
  ('AC',2014,309,'consolidada','2026-10-16'),('AC',2015,264,'consolidada','2026-10-16'),
  ('AC',2016,372,'consolidada','2026-10-16'),('AC',2017,257,'consolidada','2026-10-16'),
  ('AC',2018,444,'consolidada','2026-10-16'),('AC',2019,682,'consolidada','2026-10-16'),
  ('AC',2020,706,'consolidada','2026-10-16'),('AC',2021,889,'consolidada','2026-10-16'),
  ('AC',2022,840,'consolidada','2026-10-16'),('AC',2023,601,'consolidada','2026-10-16'),
  ('AC',2024,449,'consolidada','2026-10-16'),('AC',2025,324,'consolidada','2026-10-16'),
  ('AC',2026,252,'estimada','2026-10-16')
ON CONFLICT (uf, ano) DO NOTHING;
