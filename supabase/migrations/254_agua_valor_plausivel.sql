-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — plausibilidade de valor digitado
-- Fase 2 do plano em docs/qualidade-agua/plano.md ("Fase 2 — escopo
-- desta entrega", item 3 — lançamento de laudo).
--
-- POR QUE UMA FUNÇÃO, E NÃO VALIDAÇÃO EM JS
-- A migration 253 (Fase 1) já codificou, em SQL, os dois critérios que
-- separam valor impossível de valor plausível ao importar a série
-- histórica: pH fora de 0–14 e OD muito acima da saturação calculada
-- por `agua_od_saturacao()`. Reescrever esses limites em JavaScript
-- para validar o formulário de lançamento de laudo criaria uma SEGUNDA
-- cópia do mesmo critério — mesma lição de `js/frota-consumo.js` e
-- `js/mapa-recorte.js`: cálculo mora em UM lugar, nunca reimplementado
-- numa tela. `agua_valor_plausivel()` é essa definição única; o
-- formulário chama a função via RPC.
--
-- TRÊS NÍVEIS, NÃO DOIS
-- 'impossivel'  → bloqueia o salvamento (fisicamente não existe).
-- 'improvavel'  → não bloqueia, mas pede confirmação explícita de
--                 quem está digitando (fora do range típico da série,
--                 mas não impossível — supersaturação por fotossíntese
--                 chega a ~134% na série histórica, por exemplo).
-- 'ok'          → sem alerta.
-- NULL          → sem valor para avaliar (parâmetro não preenchido).
--
-- SÓ pH E OD TÊM LIMITE ESPECÍFICO
-- São os dois únicos parâmetros com critério VALIDADO contra a série
-- histórica (migration 253). Os demais parâmetros de laboratório e de
-- campo recebem só a checagem genérica de não-negatividade — uma
-- concentração, turbidez ou condutividade negativa não existe
-- fisicamente, mas inventar faixas "prováveis" para cada um dos outros
-- 17 parâmetros sem dado de série que sustente o limite seria o mesmo
-- erro que a Fase 0 evitou ao não adivinhar fator de conversão para os
-- sólidos em suspensão. Sólidos em suspensão especificamente CONTINUAM
-- sem checagem própria aqui — a suspeita de mistura de unidade
-- (g/L×mg/L, achado da Fase 1) não tem um limiar confiável ainda; é
-- pendência de conferência humana, não algoritmo (ver plano.md).
--
-- Pura (não lê tabela, não toca auth.*) — mesma classe de
-- `agua_iqa_q`/`agua_od_saturacao`, por isso pode ser EXECUTE de
-- anon+authenticated sem abrir superfície nenhuma.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION agua_valor_plausivel(
  p_parametro    text,
  p_valor        numeric,
  p_temp_amostra numeric DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  sat numeric;
BEGIN
  IF p_valor IS NULL THEN RETURN NULL; END IF;

  CASE p_parametro
    WHEN 'ph' THEN
      -- Limite impossível: migration 253 (escala 0–14). Limite
      -- improvável: achado 4 do plano — 20 das 445 linhas históricas
      -- caem fora de 4–9 sem serem fisicamente impossíveis.
      IF p_valor < 0 OR p_valor > 14 THEN RETURN 'impossivel'; END IF;
      IF p_valor < 4 OR p_valor > 9  THEN RETURN 'improvavel'; END IF;
      RETURN 'ok';

    WHEN 'od' THEN
      -- Mesma função e mesmo limiar de 150% da migration 253. Sem
      -- temperatura da amostra não dá para derivar saturação — cai só
      -- na checagem de não-negatividade.
      sat := agua_od_saturacao(p_valor, p_temp_amostra);
      IF sat IS NULL THEN
        RETURN CASE WHEN p_valor < 0 THEN 'impossivel' ELSE 'ok' END;
      END IF;
      IF sat > 150 THEN RETURN 'impossivel'; END IF;
      -- Refino da Fase 0 registra supersaturação plausível (fotossíntese/
      -- aeração) até ~134% no resto da série histórica.
      IF sat > 130 THEN RETURN 'improvavel'; END IF;
      RETURN 'ok';

    ELSE
      -- Checagem genérica: nenhum dos demais parâmetros (DBO,
      -- nitrogênio, fósforo, turbidez, condutividade, sólidos,
      -- coliformes, etc.) pode ser negativo.
      IF p_valor < 0 THEN RETURN 'impossivel'; END IF;
      RETURN 'ok';
  END CASE;
END;
$$;

COMMENT ON FUNCTION agua_valor_plausivel(text, numeric, numeric) IS
  'Classifica um valor digitado como ok/improvavel/impossivel, reusando os limites de pH e OD que a migration 253 já validou contra a série histórica. Único lugar do sistema com essa checagem — não reimplementar em JS.';

REVOKE ALL ON FUNCTION agua_valor_plausivel(text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agua_valor_plausivel(text, numeric, numeric) TO anon, authenticated;
