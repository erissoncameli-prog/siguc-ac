-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — correção de série histórica a partir
-- da planilha corrigida enviada pela SEMA (verificação de dados,
-- 17/07/2024), comparada célula a célula contra
-- docs/qualidade-agua/serie-historica.csv (a fonte já importada pela
-- migration 253). Só 111 células de 450 linhas × 38 colunas
-- divergiram — nada mais da série mudou.
--
-- ACHADO 1 — resolve a pendência de conferência humana registrada no
-- CLAUDE.md ("Sólidos em suspensão continua pendência de conferência
-- humana"): 108 das 339 linhas quarentenadas por "mistura de unidade
-- g/L×mg/L" tinham de fato o valor errado — a planilha corrigida
-- confirma, para essas 108, EXATAMENTE o valor antigo dividido por
-- 1000 (medido, não arbitrado: as 108 razões batem 1000 na casa
-- decimal). As outras 231 linhas quarentenadas pelo mesmo motivo NÃO
-- mudaram na planilha corrigida — seguem pendentes de conferência em
-- pages/agua-conferencia.html, sem alteração nesta migration.
--
-- 107 das 108 linhas corrigidas estavam com status='quarentena' e
-- motivo EXCLUSIVAMENTE esse (conferido antes de escrever esta
-- migration — nenhuma tinha outro motivo concatenado); promovidas
-- para 'completo' e o motivo limpo. A 108ª (linha 61) já estava
-- 'completo' com o valor antigo errado — só o valor foi corrigido, o
-- status não muda.
--
-- ACHADO 2 — linha 335: nitrogenio_amoniacal estava 250 mg/L (valor
-- fisicamente implausível), corrigido para 2.5 na planilha nova
-- (típico erro de vírgula deslocada). Motivo de quarentena da linha
-- 335 é outro (sólidos, não corrigido nesta linha) — status
-- permanece 'quarentena', só o campo é corrigido.
--
-- ACHADO 3 — linha 240: a planilha corrigida só preencheu as colunas
-- informativas "IQA %"/"IQA CETESB" (68 informativo/BOA), que o
-- sistema nunca armazena bruto — IQA é sempre DERIVADO por
-- agua_calcular_iqa(), nunca lido de planilha. Nada a gravar aqui.
--
-- origem_dados (jsonb, migration 306) registra a proveniência do
-- campo corrigido, reaproveitando o vocabulário já usado pelo parser
-- de laudo ('corrigido_apos_parser' = valor originalmente errado,
-- corrigido após conferência) — aqui a conferência foi a planilha
-- corrigida da SEMA, não o parser de OCR, mas o sentido é o mesmo:
-- valor substituído após verificação, nunca o dado bruto original.
-- ═══════════════════════════════════════════════════════════

SELECT set_config(
  'app.justificativa',
  'Correção de série histórica (2016-2024) a partir da planilha corrigida enviada pela SEMA (Verificação de Dados, 17/07/2024) — sólidos em suspensão totais com mistura de unidade g/L×mg/L (108 linhas) e nitrogênio amoniacal com vírgula deslocada (1 linha). Ver docs/qualidade-agua/plano.md.',
  true
);

-- ── Sólidos em suspensão totais: valor antigo ÷ 1000 (confirmado célula a célula) ──
UPDATE agua_coletas
SET
  solidos_suspensao_totais = solidos_suspensao_totais / 1000,
  origem_dados = origem_dados || jsonb_build_object('solidos_suspensao_totais', 'corrigido_apos_parser')
WHERE linha_origem_planilha IN (
  61,62,63,64,65,66,67,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,85,86,87,88,89,
  119,120,121,122,123,124,125,126,127,128,129,132,135,136,137,138,139,140,141,142,143,144,145,146,
  163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,
  197,198,199,200,201,202,203,204,205,206,209,210,211,212,214,215,216,217,218,219,220,221,222,223
);

-- ── Promove para 'completo' as 107 linhas cujo ÚNICO motivo de quarentena
--    era exatamente essa suspeita de unidade (linha 61 já era 'completo') ──
UPDATE agua_coletas
SET status = 'completo', quarentena_motivo = NULL
WHERE status = 'quarentena'
  AND quarentena_motivo LIKE 'Sólidos em suspensão preenchidos%incoerente com a mediana%'
  AND linha_origem_planilha IN (
    61,62,63,64,65,66,67,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,85,86,87,88,89,
    119,120,121,122,123,124,125,126,127,128,129,132,135,136,137,138,139,140,141,142,143,144,145,146,
    163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,
    197,198,199,200,201,202,203,204,205,206,209,210,211,212,214,215,216,217,218,219,220,221,222,223
  );

-- ── Nitrogênio amoniacal da linha 335: 250 → 2.5 (vírgula deslocada) ──
UPDATE agua_coletas
SET
  nitrogenio_amoniacal = 2.5,
  origem_dados = origem_dados || jsonb_build_object('nitrogenio_amoniacal', 'corrigido_apos_parser')
WHERE linha_origem_planilha = 335
  AND nitrogenio_amoniacal = 250;
