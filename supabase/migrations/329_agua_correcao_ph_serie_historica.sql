-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — correção de pH vinda da conferência
-- da planilha "Verificação de Dados (IQA 2026) SÓLIDOS TOTAIS",
-- enviada pela SEMA, comparada célula a célula contra o banco.
--
-- ACHADO 0 — a coluna "Sólidos Totais" da planilha NÃO é dado novo e
-- NÃO foi importada. Ela é a SOMA de solidos_suspensao_totais +
-- solidos_dissolvidos_totais que o banco já tem: a soma das 450
-- linhas bate exatamente (23.937,357026 dos dois lados, diferença
-- 0,000000000); 338 linhas batem com a soma, 29 com os dissolvidos
-- (são as que nunca tiveram suspensão) e 82 linhas de 2016–2021
-- trazem 0 onde o banco não tem medição — importar isso trocaria
-- "não medido" por "medido igual a zero", que é pior que o estado
-- atual (zero de sólidos totais num rio é impossível). Nenhuma das
-- 228 linhas em quarentena por sólidos é resolvida por esta planilha:
-- ela não informa a suspensão separada. Registrado aqui para que a
-- próxima sessão não reabra a mesma conferência.
--
-- ACHADO 1 — pH: 21 linhas divergem, e o banco é que está errado.
-- Seis estão FORA DA ESCALA (0–14): 16,36 · 14,74 · 14,39 · 13,29 ·
-- 12,52 · 12,50. As 13 de 2024 já estavam em quarentena com o pH
-- citado no motivo (junto do motivo de sólidos); as 8 de 2020–2021
-- estavam 'completo' — inclusive a linha 183, com pH 1,62, que
-- agua_valor_plausivel classifica só como 'improvavel' e por isso
-- nunca barrou nada: ela entra no IQA publicado hoje.
-- Efeito da correção no índice: 13 das 21 linhas mudam de faixa
-- (ex.: linha 374 Ruim 35,08 → Boa 52,97; linha 183 Regular 37,39 →
-- Boa 63,25). O IQA é sempre DERIVADO por agua_calcular_iqa(), então
-- basta corrigir o pH — nada de IQA é gravado.
-- O status NÃO muda em nenhuma linha: as 13 de 2024 seguem em
-- quarentena pelo motivo de sólidos, que continua de pé; só a
-- sentença do pH sai do texto do motivo.
--
-- Nada aqui altera sólidos, nem promove/rebaixa status de coleta.
-- A base PO4 do alerta de ortofosfato vai na migration 330.
-- ═══════════════════════════════════════════════════════════

-- ── ACHADO 1, parte A: os 21 valores de pH ─────────────────────────
-- O valor ANTIGO entra no WHERE de propósito: se alguém já tiver
-- corrigido a linha à mão, esta migration não sobrescreve em silêncio
-- (e o DO block abaixo acusa a divergência em vez de deixar passar).
WITH corrigido(linha, ph_antigo, ph_novo) AS (VALUES
  (175, 9.67, 7.67), (176, 9.44, 7.44), (178,  8.40, 7.40), (179,  9.48, 7.48),
  (180,10.01, 7.51), (181,10.63, 7.63), (182,  9.69, 6.69), (183,  1.62, 6.62),
  (366, 8.33, 7.33), (367, 9.84, 6.84), (368, 10.37, 7.37), (369, 13.29, 6.59),
  (370,12.50, 6.50), (371,16.36, 6.36), (372,  9.40, 7.41), (373, 12.30, 6.32),
  (374,14.39, 7.39), (375,14.74, 7.74), (376, 11.26, 7.26), (377, 12.52, 6.52),
  (378,10.41, 7.01)
)
UPDATE agua_coletas c
   SET ph = k.ph_novo::numeric,
       origem_dados = COALESCE(c.origem_dados,'{}'::jsonb)
                      || jsonb_build_object('ph','corrigido_apos_parser')
  FROM corrigido k
 WHERE c.linha_origem_planilha = k.linha
   AND c.ph = k.ph_antigo::numeric;

DO $$
DECLARE v_restantes integer;
BEGIN
  SELECT count(*) INTO v_restantes
    FROM agua_coletas
   WHERE linha_origem_planilha IN (175,176,178,179,180,181,182,183,366,367,368,
                                   369,370,371,372,373,374,375,376,377,378)
     AND (ph < 4 OR ph > 9);
  IF v_restantes > 0 THEN
    RAISE EXCEPTION 'Correção de pH incompleta: % linha(s) seguem fora de 4–9', v_restantes;
  END IF;
END $$;

-- ── ACHADO 1, parte B: tira a sentença do pH do motivo de quarentena ──
-- O motivo é concatenado com ' | '. Só a parte do pH sai; a de
-- sólidos continua, e por isso as 13 linhas seguem em quarentena.
UPDATE agua_coletas
   SET quarentena_motivo = NULLIF(trim(regexp_replace(
         quarentena_motivo,
         '\s*\|\s*pH [0-9.]+ fisicamente impossível \(escala 0–14\)\. Conferir digitação contra o laudo físico\.',
         '')), '')
 WHERE linha_origem_planilha IN (366,367,368,369,370,371,372,373,374,375,376,377,378)
   AND quarentena_motivo LIKE '%fisicamente impossível (escala 0–14)%';
