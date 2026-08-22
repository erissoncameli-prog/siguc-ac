-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — gabarito do laudo QUILAB
-- Entrega 2 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md.
--
-- Coordenadas MEDIDAS, não estimadas: calibradas contra as 17
-- páginas do lote real enviado pelo usuário (todas do mesmo
-- laboratório, mesmo layout — "LAUDO ANALITICO" QUILAB/ACQUALIMP) e
-- VALIDADAS rodando o OCR de verdade (Tesseract, mesmo motor
-- vendorizado que roda no navegador) contra os recortes calculados.
-- Resultado da validação: 40 de 42 valores corretos (3 páginas × 14
-- parâmetros) — as 2 falhas foram uma leitura vazia (o parser
-- simplesmente não propõe nada; o técnico digita) e uma leitura
-- truncada (capturável pela confirmação obrigatória, que mostra o
-- recorte da imagem ao lado do campo).
--
-- ACHADO QUE DEFINE O DESENHO DA CAIXA: a borda da tabela fica colada
-- acima de cada linha de valor. Um recorte que inclua a borda faz o
-- Tesseract fundir régua + dígitos num só blob e devolver STRING
-- VAZIA (medido: "3,17" virou "" com a borda dentro do recorte; sem
-- ela, "3,17" @ 87% de confiança). Por isso o topo de cada caixa
-- começa ABAIXO do topo do rótulo (deslocamento positivo pequeno,
-- 4 px em 300 dpi), nunca em cima ou acima dele.
--
-- CASAS DECIMAIS SÃO CONSTANTE DO TEMPLATE, NUNCA LIDAS DO OCR — ver
-- cabeçalho da migration 304: o glifo da vírgula é pequeno demais em
-- 300 dpi para o OCR situar com segurança (achado real: "3,17" foi
-- lido "3,47" por troca de dígito 1↔4 em teste de página inteira).
-- O parser lê só os dígitos e insere o separador na posição fixa
-- medida aqui — fósforo total e sólidos em suspensão têm 3 casas
-- nesse laboratório, todos os demais têm 2 (confirmado visualmente
-- nas 3 páginas de amostra, não inferido de uma só).
--
-- CAMPOS DE IDENTIDADE cobrem o TÍTULO ("LAUDO ANALITICO Nº X"),
-- "Data da Coleta" e "Procedência" (nome do ponto/rio, como o
-- laboratório escreve — ex. "Rio Iquiri/ Senador Guiomard") — são os
-- três que o parser confere contra a coleta aberta antes de propor
-- qualquer preenchimento (trava de identidade, §3.3 do plano).
-- ═══════════════════════════════════════════════════════════

INSERT INTO agua_laudo_templates (laboratorio_id, versao, ativo, ancora_texto, campos_identidade, campos)
SELECT
  l.id, 1, true,
  'QUILAB',
  '{
    "numero_laudo": {"top": 0.155359, "left": 0.120968, "width": 0.645161, "height": 0.022805},
    "data_coleta":  {"top": 0.210946, "left": 0.645161, "width": 0.314516, "height": 0.017104},
    "procedencia":  {"top": 0.289339, "left": 0.645161, "width": 0.314516, "height": 0.017104}
  }'::jsonb,
  '{
    "temp_ar":                    {"top": 0.431471, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "dbo":                        {"top": 0.448005, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "nitrogenio_amoniacal":       {"top": 0.46488,  "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "nitrogenio_total":           {"top": 0.48073,  "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "fosforo_total":               {"top": 0.497263, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 3},
    "solidos_dissolvidos_totais": {"top": 0.514481, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "solidos_suspensao_totais":   {"top": 0.530673, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 3},
    "nitratos":                    {"top": 0.547092, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "ortofosfato_dissolvido":     {"top": 0.563369, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "cloreto":                     {"top": 0.579932, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "alcalinidade_total":         {"top": 0.596579, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "carbono_organico_total":     {"top": 0.613141, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "coliformes_totais":           {"top": 0.713113, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2},
    "escherichia_coli":            {"top": 0.729048, "left": 0.721774, "width": 0.16129, "height": 0.017104, "casas_decimais": 2}
  }'::jsonb
FROM agua_laboratorios l
WHERE l.nome ILIKE '%QUILAB%'
ON CONFLICT (laboratorio_id, versao) DO NOTHING;
