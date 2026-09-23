-- ============================================================
-- 342b_prodes_coletar_round_numeric.sql
-- Achado ao rodar a 342 de verdade: a coleta devolveu 0 anos. ST_Area
-- devolve double precision e round(double, int) não existe no Postgres
-- (42883) — a exceção era engolida pelo RAISE WARNING e o pedido era
-- APAGADO mesmo assim, então a falha sumia sem deixar rastro.
-- Duas correções: cast para numeric antes do round, e pedido que falha
-- fica na fila para o próximo coletar() tentar de novo (só sai da fila
-- o que foi gravado, ou resposta não-200).
-- Mesma assinatura: CREATE OR REPLACE basta. A 342 também foi corrigida
-- no arquivo, para banco novo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prodes_resumo_coletar()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p record; j jsonb; nfeat int; area numeric; n int := 0;
BEGIN
  FOR p IN
    SELECT pe.ano, r.status_code, r.content
      FROM prodes_resumo_pedidos pe
      JOIN net._http_response r ON r.id = pe.request_id
  LOOP
    IF p.status_code = 200 THEN
      BEGIN
        j := p.content::jsonb;
        SELECT count(*), coalesce(sum((f->'properties'->>'area_km')::numeric), 0) * 100
          INTO nfeat, area
          FROM jsonb_array_elements(j->'features') f;
        -- 0 feições = ano ainda não publicado: nunca grava zero.
        IF nfeat > 0 THEN
          INSERT INTO prodes_resumo_ano (ano, poligonos, area_ha, atualizado_em)
          VALUES (p.ano, nfeat, round(area), now())
          ON CONFLICT (ano) DO UPDATE
            SET poligonos = EXCLUDED.poligonos, area_ha = EXCLUDED.area_ha,
                atualizado_em = now();

          -- Por UC, só quando a resposta trouxe geometria.
          IF (j->'features'->0->'geometry') IS NOT NULL
             AND jsonb_typeof(j->'features'->0->'geometry') = 'object' THEN
            DELETE FROM prodes_uc_ano WHERE ano = p.ano;
            INSERT INTO prodes_uc_ano (ano, uc_id, poligonos, area_ha)
            SELECT p.ano, u.id, count(*),
                   round((sum(ST_Area(ST_Intersection(g.geom, u.geom)::geography)) / 10000)::numeric, 1)
              FROM (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'), 4326)) AS geom
                      FROM jsonb_array_elements(j->'features') f
                     WHERE jsonb_typeof(f->'geometry') = 'object') g
              JOIN (SELECT id, ST_MakeValid(geom) AS geom FROM unidades_conservacao
                     WHERE geom IS NOT NULL) u
                ON ST_Intersects(g.geom, u.geom)
             GROUP BY u.id;
          END IF;
          n := n + 1;
        END IF;
        DELETE FROM prodes_resumo_pedidos WHERE ano = p.ano;
      EXCEPTION WHEN others THEN
        -- Fica na fila (não apaga o pedido): o próximo coletar() tenta de
        -- novo enquanto a resposta existir no pg_net.
        RAISE WARNING 'prodes_resumo_coletar: falha em %: %', p.ano, SQLERRM;
      END;
    ELSE
      DELETE FROM prodes_resumo_pedidos WHERE ano = p.ano;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prodes_resumo_coletar() FROM PUBLIC, anon, authenticated;
