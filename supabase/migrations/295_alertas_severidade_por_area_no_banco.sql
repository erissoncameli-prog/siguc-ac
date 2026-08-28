-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 295 — severidade do DETER calculada no banco
-- Entrega 2 (Ingestão) do Dashboard de Alertas Ambientais.
--
-- A Entrega 1 moveu o cálculo de area_ha do DETER para o banco
-- (ST_Area sobre o polígono real, na trigger de 291) — antes,
-- severidadeAreaHa() no edge function calculava sobre uma área
-- sempre nula (o bug raiz do "nenhum alerta crítico/alto" achado
-- no diagnóstico). Com a área só existindo DEPOIS do INSERT
-- chegar ao banco, o edge function não tem mais como calcular a
-- severidade sozinho — ela precisa nascer no mesmo lugar que a
-- área. Estende alertas_resolver_campos(): quando `poligono` é
-- enviado, a severidade por faixa de hectare (mesmos limiares que
-- já existiam em JS: ≥2500 crítica, ≥1000 alta, ≥100 média, senão
-- baixa) passa a ser calculada aqui. Alertas de fonte pontual
-- (FIRMS por FRP, BDQUEIMADAS fixa em 'media') continuam decididos
-- no edge function, sem mudança — só o ramo com poligono é afetado.
--
-- Validado com INSERT de teste (revertido): polígono de ~121 ha
-- gravou area_ha=121.23 e severidade='media', como esperado.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.alertas_resolver_campos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uc RECORD;
BEGIN
  IF NEW.poligono IS NOT NULL THEN
    NEW.area_ha := round((ST_Area(NEW.poligono::geography) / 10000)::numeric, 2);
    IF NEW.geom IS NULL THEN
      NEW.geom := ST_Centroid(NEW.poligono);
    END IF;
    NEW.severidade := CASE
      WHEN NEW.area_ha >= 2500 THEN 'critica'
      WHEN NEW.area_ha >= 1000 THEN 'alta'
      WHEN NEW.area_ha >= 100  THEN 'media'
      ELSE 'baixa'
    END::severidade_ocorrencia;
  END IF;

  IF NEW.geom IS NOT NULL THEN
    SELECT * INTO v_uc FROM encontrar_uc_por_ponto(ST_Y(NEW.geom)::numeric, ST_X(NEW.geom)::numeric) LIMIT 1;
    NEW.uc_id   := v_uc.id;
    NEW.uc_nome := v_uc.nome;
  ELSE
    NEW.uc_id   := NULL;
    NEW.uc_nome := NULL;
  END IF;

  RETURN NEW;
END;
$function$;
