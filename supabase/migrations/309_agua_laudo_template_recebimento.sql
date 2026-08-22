-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — gabarito do QUILAB ganha "recebimento"
-- Entrega 3 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md.
--
-- O laudo imprime "Recebimento no laboratório: DD/MM/AAAA" — campo
-- que a Entrega 2 calibrou mas não incluiu no template final (só
-- número do laudo, data da coleta e procedência entraram). Esta
-- entrega usa esse campo para popular
-- `agua_coletas.data_recebimento_laboratorio` (migration 308), que
-- alimenta o alerta de prazo de preservação.
--
-- Coordenada validada com OCR de verdade contra as duas fixtures reais
-- (`tests/fixtures/laudos/quilab-amostra-1.pdf` e `-9.pdf`): leu
-- "15/09/2025" e "24/09/0005" respectivamente — o dia/mês saem
-- corretos nas duas, o ANO errou na segunda (mesmo modo de falha já
-- documentado: dígito do ano trocado, sem sinal de baixa confiança).
-- Por isso este campo NUNCA entra na trava de identidade (§3.3) — só
-- data_coleta e procedência bloqueiam autofill; recebimento seria
-- bloqueio falso com frequência demais. `js/agua-laudo-ocr.js` só
-- propõe a data de recebimento como valor pronto quando o ano
-- extraído é plausível (entre 2015 e o ano atual+1); fora disso, o
-- texto lido aparece como referência, mas o campo do formulário fica
-- vazio para o técnico digitar.
-- ═══════════════════════════════════════════════════════════

UPDATE agua_laudo_templates
SET campos_identidade = campos_identidade || '{
  "recebimento": {"top": 0.25228, "left": 0.645161, "width": 0.314516, "height": 0.017104}
}'::jsonb
WHERE ativo = true
  AND NOT (campos_identidade ? 'recebimento');
