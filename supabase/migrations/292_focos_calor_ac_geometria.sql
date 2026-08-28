-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 292 — Geometria + recorte na série histórica de fogo
-- Entrega 1 (Base) do Dashboard de Alertas Ambientais.
--
-- focos_calor_ac (953 316 linhas, 2001-2024) só tinha lat/lon
-- soltos — sem geometria nem índice espacial, nunca recortada
-- pelo limite do Acre. É a base para a tendência histórica de
-- fogo no painel (24 anos, contra os 2 meses de alertas_ambientais).
--
-- geom é GENERATED ALWAYS ... STORED: o Postgres computa e
-- grava para as 953 mil linhas existentes na própria migration,
-- sem UPDATE manual em lote. dentro_acre/uc_id continuam
-- colunas comuns (dependem de limite_acre/unidades_conservacao,
-- não podem ser geradas por expressão IMMUTABLE) — populadas
-- pela função de manutenção da migration 292b, chamada em lotes
-- fora da transação da migration, mesmo padrão da migration 239
-- (limite_acre_limpar_fora). Ver 292b/292c para a versão final
-- da função de classificação e o índice que a viabilizou.
--
-- Nenhuma linha é apagada — arquivo histórico, mesma regra já
-- registrada no projeto para esta tabela.
--
-- Resultado medido em produção após 292/292b/292c: 953 316/953 316
-- linhas classificadas — 570 819 (60%) dentro do Acre, 92 627
-- dentro de alguma UC.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE focos_calor_ac
  ADD COLUMN geom geometry(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lon::double precision, lat::double precision), 4326)
  ) STORED;

CREATE INDEX idx_focos_ac_geom ON focos_calor_ac USING gist (geom);

ALTER TABLE focos_calor_ac
  ADD COLUMN dentro_acre boolean,
  ADD COLUMN uc_id uuid REFERENCES unidades_conservacao(id);

COMMENT ON COLUMN focos_calor_ac.dentro_acre IS
  'Classificado uma vez por focos_calor_ac_classificar_lote() (292b). NULL = ainda não classificado (nunca reinterpretar como fora do Acre).';

CREATE INDEX idx_focos_ac_dentro_acre ON focos_calor_ac (dentro_acre) WHERE dentro_acre IS NOT NULL;
CREATE INDEX idx_focos_ac_uc          ON focos_calor_ac (uc_id) WHERE uc_id IS NOT NULL;

-- Primeira versão da função de classificação — processava tudo
-- numa única transação e foi SUBSTITUÍDA na migration 292b depois
-- que o backfill real (953 mil linhas) mostrou que uma chamada
-- única estoura o timeout do cliente que a invoca e desfaz o
-- lote inteiro. Criada aqui por fidelidade ao que rodou em
-- produção nesta migration; 292b já a derruba com DROP FUNCTION.
CREATE OR REPLACE FUNCTION public.focos_calor_ac_classificar(p_lote int DEFAULT 100000)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total INT := 0;
  v_rodada INT;
BEGIN
  LOOP
    WITH alvo AS (
      SELECT id FROM focos_calor_ac WHERE dentro_acre IS NULL LIMIT p_lote
    )
    UPDATE focos_calor_ac f
       SET dentro_acre = geo_ponto_no_acre(f.lat::double precision, f.lon::double precision),
           uc_id = (SELECT id FROM encontrar_uc_por_ponto(f.lat, f.lon) LIMIT 1)
      FROM alvo
     WHERE f.id = alvo.id;

    GET DIAGNOSTICS v_rodada = ROW_COUNT;
    v_total := v_total + v_rodada;
    EXIT WHEN v_rodada = 0;
  END LOOP;

  RETURN v_total || ' foco(s) classificado(s)';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.focos_calor_ac_classificar(int) FROM PUBLIC, anon, authenticated;
