-- A versão da 292 rodava os 953 mil focos numa transação só —
-- o cliente que chama (MCP/execute_sql, timeout de 60s) cancelou
-- antes de terminar, e tudo foi desfeito (nenhuma linha classificada
-- sobreviveu). Substituída por uma versão que processa UM lote por
-- chamada — cada chamada é sua própria transação e comita antes da
-- próxima, então dá para invocar em sequência sem perder progresso
-- se uma chamada cair.
--
-- Uso (repetir até devolver 0):
--   SELECT focos_calor_ac_classificar_lote(20000);
-- (Ver migration 292c: sem o índice parcial de lá, cada chamada
-- fica lenta por ter que varrer a tabela toda procurando NULL.)

DROP FUNCTION IF EXISTS public.focos_calor_ac_classificar(int);

CREATE OR REPLACE FUNCTION public.focos_calor_ac_classificar_lote(p_lote int DEFAULT 20000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rodada INT;
BEGIN
  WITH alvo AS (
    SELECT id FROM focos_calor_ac WHERE dentro_acre IS NULL LIMIT p_lote
  )
  UPDATE focos_calor_ac f
     SET dentro_acre = geo_ponto_no_acre(f.lat::double precision, f.lon::double precision),
         uc_id = (SELECT id FROM encontrar_uc_por_ponto(f.lat, f.lon) LIMIT 1)
    FROM alvo
   WHERE f.id = alvo.id;

  GET DIAGNOSTICS v_rodada = ROW_COUNT;
  RETURN v_rodada;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.focos_calor_ac_classificar_lote(int) FROM PUBLIC, anon, authenticated;
