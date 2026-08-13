-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água (IQA) — import da série histórica
-- Fase 1 do plano em docs/qualidade-agua/plano.md ("Fase 1 — escopo
-- desta entrega"). Migra as 450 coletas de
-- docs/qualidade-agua/serie-historica.csv para agua_coletas.
--
-- GERAÇÃO DO BLOCO DE VALORES
-- O bloco `INSERT INTO _agua_import_raw VALUES (...)` abaixo (450
-- linhas) foi gerado por scripts/agua_gerar_migration_serie_historica.py
-- a partir do CSV — mecânico o bastante (linha a linha, mesma ordem
-- de colunas) para não valer a pena digitar à mão, mas o script usa
-- csv.reader (parser de verdade, o mesmo motivo do parser em
-- tests/agua-iqa.test.js: 143/451 linhas têm campo entre aspas com
-- vírgula dentro) e nenhuma conta do IQA acontece nele — só
-- normalização de texto para tipo SQL. O resto desta migration (joins,
-- quarentena, sanity checks) é SQL de mão, revisável linha a linha.
-- Reexecutar o gerador e colar de novo é o caminho se o CSV mudar.
--
-- CASAMENTO PONTO E CAMPANHA — decisões 1 e 2 do escopo da Fase 1
-- Ponto: `EstacaoCodigo = codigo_ana OR EstacaoCodigo = ANY(codigos_alias)`
-- — nunca por nome de município (grafias variam linha a linha).
-- Campanha: `ano + ordem` (normalizado para minúsculo/trim antes do
-- cast pro enum). Os dois casamentos são conferidos por DO $$ antes
-- do INSERT em agua_coletas: se alguma linha não casar com ponto ou
-- campanha, a migration FALHA (RAISE EXCEPTION) em vez de descartar
-- silenciosamente — um INNER JOIN sozinho dropa linha sem avisar.
--
-- VALOR CENSURADO ('<1') — decisão 4 do escopo
-- `_agua_import_raw` guarda o bruto em três colunas: o valor (NULL
-- quando censurado), `coli_censurado` e `coli_limite` (o limite que
-- vinha depois do '<'). Na carga final: a coluna numérica recebe
-- METADE do limite (decisão 3 do plano) e `censurados` jsonb guarda o
-- limite original — nunca os dois juntos como se fossem a mesma coisa.
-- Só ColiformesTermotolerantes teve valor censurado nesta série (56
-- linhas, achado 5 do plano); nenhuma outra coluna numérica trouxe '<'.
--
-- COORDENADA DA PLANILHA NÃO VIRA `localizacao`
-- 112/450 linhas trazem uma coordenada (coluna "Coordenadas (UTM)",
-- que apesar do nome já vem em grau decimal). Conferido: em toda
-- estação, a coordenada da linha é IDÊNTICA à coordenada da própria
-- estação semeada na migration 250 — não é a posição do aparelho no
-- momento da coleta, é a coordenada do ponto repetida por algumas
-- linhas. `agua_coletas.localizacao` significa posição do APARELHO
-- (comentário da 248, capturada só a partir da Fase 3); gravar a
-- coordenada da planilha ali sugeriria uma precisão de campo que a
-- série histórica nunca teve. Fica de fora do import.
--
-- QUARENTENA — decisão 5 do escopo, quatro critérios, cada um com o
-- valor original preservado (na própria coluna) e o motivo explicando
-- por que a linha precisa de conferência humana com o laudo físico:
--
--   1. pH fisicamente impossível (fora de 0–14). São 3 linhas nesta
--      série (16,36; 14,39; 14,74 — linha_origem 371, 374, 375).
--   2. OD muito acima da saturação calculada por `agua_od_saturacao()`
--      (>150%, sempre a mesma função da migration 249 — não uma cópia
--      do cálculo aqui). O limiar de 150% deixa passar supersaturação
--      plausível (fotossíntese/aeração, até ~134% no resto da série) e
--      pega só o outlier real: OD 27 mg/L a 25,3 °C = 332% de
--      saturação (linha_origem 296) — a mesma linha que, junto com o
--      pH 16,36, faz o erro máximo da regressão do teste chegar a 25
--      pontos (ver cabeçalho da migration 249).
--   3. Sólidos em suspensão preenchidos — a pendência registrada no
--      plano (mediana 0,342 mg/L com turbidez mediana de 90 UNT: os
--      dois não podem estar certos ao mesmo tempo; suspeita de mistura
--      de unidade g/L×mg/L ao longo dos anos). SEM fator de conversão
--      adivinhado — decisão que precisa de alguém da SEMA com o laudo
--      físico em mãos. Atinge 339 das 450 linhas: é o critério que
--      domina a quarentena desta importação, e é intencional.
--   4. ACHADO NESTA ENTREGA, não estava no plano: o ano da campanha
--      (coluna "Ano") diverge da data da coleta em mais de 1 ano só na
--      linha_origem 271 (Ano=2022, Data=2026-10-26) — as outras 3
--      linhas com Ano≠ano(Data) (234–236) são coleta feita em
--      janeiro que ainda pertence à 2ª campanha do ano anterior,
--      padrão normal de campanha que atravessa virada de ano. A linha
--      271 destoa: todas as outras coletas do mesmo período de
--      certificação ("Décimo Segundo") são de setembro–dezembro de
--      2022, e 2026 já teria outro período — é 1 dígito trocado (2→6),
--      não campanha nova. Mesmo critério de nunca converter a olho:
--      fica em quarentena com a data ORIGINAL preservada, não
--      "corrigida" para 2022 por suposição. (Esta linha já entra em
--      quarentena pelo critério 3 de qualquer forma — o achado só
--      acrescenta o motivo ao que já seria quarentenado.)
--
-- NÃO GRAVA O IQA DA PLANILHA — decisão 6 do escopo. As colunas IQA,
-- "IQA %" e "IQA CETESB" do CSV não têm coluna correspondente aqui.
--
-- TELA DE CONFERÊNCIA — decisão 7 do escopo, implementada à parte em
-- pages/agua-conferencia.html (não faz parte desta migration).
-- ═══════════════════════════════════════════════════════════

-- ── 1. Carga bruta em tabela temporária ───────────────────────
CREATE TEMP TABLE _agua_import_raw (
  linha                  integer PRIMARY KEY,
  estacao_codigo         text NOT NULL,
  campanha_ano           smallint NOT NULL,
  campanha_ordem         text NOT NULL,
  data_coleta            date NOT NULL,
  hora_coleta            time,
  temp_ar                numeric,
  temp_amostra           numeric,
  ph                     numeric,
  od                     numeric,
  turbidez               numeric,
  condutividade_eletrica numeric,
  dbo                    numeric,
  nitrogenio_total       numeric,
  nitrogenio_amoniacal   numeric,
  nitratos               numeric,
  fosforo_total          numeric,
  ortofosfato_dissolvido numeric,
  solidos_dissolvidos_totais numeric,
  solidos_suspensao_totais   numeric,
  coliformes_termotolerantes numeric,   -- NULL quando censurado (ver coli_censurado)
  coli_censurado         boolean NOT NULL DEFAULT false,
  coli_limite            numeric,       -- limite de detecção reportado como "<N"
  coliformes_totais      numeric,
  escherichia_coli       numeric,
  alcalinidade_total     numeric,
  carbono_organico_total numeric,
  cloreto                numeric,
  condutividade_especifica numeric,
  descarga_liquida       numeric
) ON COMMIT DROP;

INSERT INTO _agua_import_raw (
  linha, estacao_codigo, campanha_ano, campanha_ordem, data_coleta, hora_coleta,
  temp_ar, temp_amostra, ph, od, turbidez, condutividade_eletrica, dbo,
  nitrogenio_total, nitrogenio_amoniacal, nitratos, fosforo_total, ortofosfato_dissolvido,
  solidos_dissolvidos_totais, solidos_suspensao_totais,
  coliformes_termotolerantes, coli_censurado, coli_limite,
  coliformes_totais, escherichia_coli, alcalinidade_total,
  carbono_organico_total, cloreto, condutividade_especifica, descarga_liquida
) VALUES
  (2, '13610001', 2016, 'primeira', DATE '2016-08-23', TIME '12:30', 40.36, 36.48, 6.62, 8.7644, 707.3775, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 0.1, 29.0),
  (3, '13601000', 2016, 'primeira', DATE '2016-08-24', TIME '13:08', 33.52, 28.26, 7.95, 7.5631, 20.5566, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 130.262, NULL),
  (4, '13770000', 2016, 'primeira', DATE '2016-08-25', TIME '13:37', 31.43, 26.68, 7.37, 7.4126, 72.9431, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 8.741, 1.0),
  (5, '13459000', 2016, 'primeira', DATE '2016-08-26', TIME '06:37', 29.8, 25.76, 7.64, 7.3192, 46.3196, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 102.637, NULL),
  (6, '13438000', 2016, 'primeira', DATE '2016-08-26', TIME '09:55', 34.23, 29.98, 7.74, 7.508, 39.8314, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 288.28, 4.0),
  (7, '15324300', 2016, 'primeira', DATE '2016-08-26', TIME '11:47', 37.78, 28.0, 6.4, 7.0618, 56.6373, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 31.537, 10.0),
  (8, '13550001', 2016, 'primeira', DATE '2016-08-26', TIME '20:47', 31.89, 29.33, 7.38, 8.237, 63.1038, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 115.349, NULL),
  (9, '13408000', 2016, 'primeira', DATE '2016-09-28', TIME '09:02:00', 35.9, 31.15, 8.37, 7.4162, 85.8394, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 420.327, 15.0),
  (10, '13190000', 2016, 'primeira', DATE '2016-09-29', TIME '05:48', 26.1, 30.07, 7.05, 8.0001, 44.5663, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 377.747, 111.0),
  (11, '12557000', 2016, 'primeira', DATE '2016-10-12', TIME '13:26', 31.9, 29.58, 7.77, 9.4889, 132.3087, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 268.975, 40.0),
  (12, '12369000', 2016, 'primeira', DATE '2016-10-12', TIME '15:06', 29.21, 27.74, 7.08, 5.1248, 308.94431, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 191.197, 271.0),
  (13, '12389000', 2016, 'primeira', DATE '2016-10-13', TIME '20:05', 26.35, 28.06, 7.56, 6.2874, 138.45261, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 143.359, 180.0),
  (14, '12430000', 2016, 'primeira', DATE '2016-10-10', TIME '10:07', 25.94, 27.6, 6.05, 6.927, 52.7142, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 48.903, 24.0),
  (15, '12500004', 2016, 'primeira', DATE '2016-10-14', TIME '08:14', 28.9, 26.7, 7.43, 5.7246, 140.851, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 69.313, 170.0),
  (16, '12600002', 2016, 'primeira', DATE '2016-10-15', TIME '15:22', 29.9, 29.94, 7.76, 8.2533, 319.8407, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 175.781, 231.0),
  (17, '12660000', 2016, 'primeira', DATE '2016-10-19', TIME '08:20', 36.1, 31.68, 7.91, 8.4703, 149.362, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 314.893, 116.0),
  (18, '13438000', 2017, 'segunda', DATE '2017-01-09', TIME '12:53', 31.37, 26.98, 6.33, 6.5149, 270.71671, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 60.854, 46.0),
  (19, '13459000', 2017, 'segunda', DATE '2017-01-10', TIME '08:20', 27.56, 25.73, 5.9, 6.6896, 521.15277, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 50.328, NULL),
  (20, '13550001', 2017, 'segunda', DATE '2017-01-10', TIME '10:08', 27.05, 26.28, 6.79, 6.2401, 407.32321, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 75.103, NULL),
  (21, '15324300', 2017, 'segunda', DATE '2017-01-10', TIME '13:58', 30.45, 26.51, 6.36, 5.8777, 110.1691, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 24.301, 112.0),
  (22, '13601000', 2017, 'segunda', DATE '2017-01-12', TIME '08:46', 28.7, 26.7, 6.81, 4.7574, 269.33609, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 56.618, NULL),
  (23, '13770000', 2017, 'segunda', DATE '2017-01-16', TIME '10:25', 28.89, 25.33, 5.82, 4.1211, 36.184, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 19.755, 21.0),
  (24, '12430000', 2017, 'segunda', DATE '2017-01-17', TIME '09:56', 26.7, 25.01, NULL, 1.3008, 12.283, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 21.612, 296.0),
  (25, '12500004', 2017, 'segunda', DATE '2017-01-17', TIME '14:38', 30.5, 25.11, NULL, 3.1001, 142.814, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 41.357, 2689.0),
  (26, '13610001', 2017, 'segunda', DATE '2017-01-18', TIME '10:22', 27.3, 26.13, 6.66, 5.2214, 256.48209, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 48.404, 628.0),
  (27, '12600002', 2017, 'segunda', DATE '2017-01-19', TIME '06:20:00', 27.1, 25.8, NULL, 5.5068, 571.70728, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 165.895, 631.0),
  (28, '12660000', 2017, 'segunda', DATE '2017-01-19', TIME '12:55', 35.6, 25.53, 8.61, 4.7734, 553.16022, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 212.9, 1468.0),
  (29, '13190000', 2017, 'segunda', DATE '2017-01-20', TIME '05:37', 26.9, 25.64, 7.76, 5.4261, 609.0816, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 155.278, 1492.0),
  (30, '13408000', 2017, 'segunda', DATE '2017-01-20', TIME '11:15', 35.3, 26.32, 8.11, 5.7381, 337.1922, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 88.876, 447.0),
  (31, '13438000', 2017, 'primeira', DATE '2017-03-28', TIME '17:40', NULL, 26.072, 6.8551, 6.8362, 246.51489, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (32, '13550001', 2017, 'primeira', DATE '2017-03-29', TIME '12:26', NULL, 27.0382, 7.2339, 6.4904, 573.112, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (33, '13459000', 2017, 'primeira', DATE '2017-03-30', TIME '10:44', NULL, 26.0537, 5.9872, 3.945, 33.4488, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (34, '12557000', 2017, 'primeira', DATE '2017-03-30', TIME '14:44', NULL, 26.0537, 5.9872, 3.945, 33.4488, 21.1709, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (35, '13408000', 2017, 'primeira', DATE '2017-03-31', TIME '11:26:00', NULL, 27.2734, 7.245, 5.7213, 470.73749, 85.9627, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (36, '12600002', 2017, 'primeira', DATE '2017-04-01', TIME '07:09:00', NULL, 26.5652, 7.9708, 5.7781, 722.73798, 156.2657, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (37, '12660000', 2017, 'primeira', DATE '2017-04-01', TIME '15:33:00', NULL, 27.2435, 8.0488, 5.3349, 375.6882, 201.3365, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (38, '13610001', 2017, 'primeira', DATE '2017-04-02', TIME '08:50:00', NULL, 25.9737, 7.63, 5.6755, 74.4948, 45.8538, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (39, '13190000', 2017, 'primeira', DATE '2017-04-02', TIME '12:13', NULL, 27.3198, 7.7634, 5.1542, 348.1106, 61.2983, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (40, '12430000', 2017, 'primeira', DATE '2017-04-05', TIME '17:21', NULL, 25.6215, 6.1122, 3.3653, 8.4059, 26.5402, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (41, '12500004', 2017, 'primeira', DATE '2017-04-06', TIME '10:13', NULL, 25.9877, 6.9435, 3.6753, 538.23621, 86.192, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (42, '15324300', 2017, 'primeira', DATE '2017-04-08', TIME '08:11:00', NULL, 27.8051, 7.6786, 5.8115, 326.2413, 213.1813, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (43, '13770000', 2017, 'primeira', DATE '2017-04-19', TIME '08:15', NULL, 25.5638, 8.6355, 7.3837, 170.6748, 289.379, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (44, '12369000', 2017, 'primeira', DATE '2017-04-20', TIME '07:10', NULL, 27.2071, 7.93, 6.4389, 228.4675, 303.66449, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (45, '12389000', 2017, 'primeira', DATE '2017-04-20', TIME '14:38', NULL, 27.6155, 7.8091, 6.1094, 256.85739, 197.9599, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (46, '12430000', 2017, 'segunda', DATE '2017-07-19', TIME '08:48:00', NULL, 25.0238, 8.1759, 6.762, 43.2763, 57.1165, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (47, '12389000', 2017, 'primeira', DATE '2017-10-27', TIME '07:20', NULL, 28.9916, 7.6642, 7.8012, 164.981, 208.2467, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (48, '12557000', 2017, 'primeira', DATE '2017-11-01', TIME '06:47', NULL, 28.9616, 7.7721, 7.5359, 180.53101, 236.8589, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (49, '13550001', 2018, 'segunda', DATE '2018-02-07', TIME '08:35', NULL, 26.6975, 6.8493, 6.2062, 830.59363, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (50, '13459000', 2018, 'segunda', DATE '2018-02-08', TIME '07:35', NULL, 27.1886, 7.0669, 6.5729, 666.04468, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (51, '12500004', 2018, 'segunda', DATE '2018-02-19', NULL, 25.4, 25.37, 6.94, 3.86, 796.32001, 88.01, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (52, '12430000', 2018, 'segunda', DATE '2018-02-20', NULL, 23.8, 25.47, 5.84, 4.71, 56.2, 23.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (53, '15324300', 2018, 'segunda', DATE '2018-02-27', NULL, 25.3, 24.63, 6.67, 5.71, 32.28, 15.25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (54, '13770000', 2018, 'segunda', DATE '2018-02-28', NULL, 24.9, 25.12, 5.81, 4.09, 29.73, 15.48, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (55, '13550001', 2018, 'primeira', DATE '2018-05-12', NULL, NULL, 27.03, 7.17, 6.87, 316.10001, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (56, '12557000', 2018, 'primeira', DATE '2018-05-25', NULL, 25.2, 27.2, 7.91, 7.27, 38.89, 438.45999, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (57, '12500004', 2018, 'primeira', DATE '2018-05-26', NULL, NULL, 24.13, 6.94, 3.86, 186.50999, 186.50999, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (58, '12430000', 2018, 'primeira', DATE '2018-05-26', NULL, NULL, 23.55, 5.76, 3.96, 18.64, 18.59, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (59, '13770000', 2018, 'primeira', DATE '2018-05-31', NULL, NULL, 24.23, 6.23, 6.66, 19.14, 13.92, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (60, '15324300', 2018, 'primeira', DATE '2018-05-31', NULL, NULL, 24.35, 6.43, 6.63, 91.78, 16.63, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (61, '12600002', 2018, 'primeira', DATE '2018-08-22', TIME '07:30', 20.52, 23.99, 8.03, 7.43, 110.8, 223.8, NULL, 0.04, NULL, NULL, 0.01, NULL, 91.9, 66.8, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (62, '12500004', 2018, 'primeira', DATE '2018-08-21', TIME '08:30:00', 22.0, 27.15, 7.23, 6.18, 98.34, 94.1, NULL, 0.04, NULL, NULL, 0.01, NULL, 49.0, 72.8, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (63, '12430000', 2018, 'primeira', DATE '2018-08-21', TIME '10:00:00', 25.9, 26.89, 6.6, 6.58, 63.27, 30.33, NULL, 0.5, NULL, NULL, 0.01, NULL, 16.29, 43.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (64, '12660000', 2018, 'primeira', DATE '2018-08-22', TIME '09:00', 22.62, 25.63, 8.27, 7.33, 84.44, 372.39999, NULL, 0.04, NULL, NULL, 0.01, NULL, 154.89999, 66.85, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (65, '13190000', 2018, 'primeira', DATE '2018-08-23', TIME '08:12', 26.7, 26.78, 8.32, 7.76, 54.54, 329.10001, NULL, 2.6, NULL, NULL, 0.9, NULL, 133.89999, 41.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (66, '13408000', 2018, 'primeira', DATE '2018-08-24', TIME '08:00', 27.15, 26.14, 7.61, 5.76, 332.26001, 208.60001, NULL, 3.04, NULL, NULL, 0.01, NULL, 85.7, 222.10001, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (67, '13459000', 2018, 'primeira', DATE '2018-08-31', TIME '06:32', 23.01, 26.47, 7.68, 7.14, 48.11, NULL, NULL, 0.04, NULL, NULL, 0.01, NULL, 45.0, 35.28, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (68, '13438000', 2018, 'primeira', DATE '2018-08-31', TIME '08:30', 25.49, 27.81, 8.04, 7.3, 43.02, NULL, NULL, 1.1, NULL, NULL, 0.01, NULL, 140.5, 4.48, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (69, '13550001', 2018, 'primeira', DATE '2018-08-31', TIME '08:45', 26.85, 25.6, 7.21, 7.59, 120.76, NULL, NULL, 2.2, NULL, NULL, 1.5, NULL, 38.0, 91.7, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (70, '13601000', 2018, 'primeira', DATE '2018-09-03', TIME '10:00', 27.69, 27.02, 7.28, 6.75, 173.11, NULL, NULL, 2.7, NULL, NULL, 0.01, NULL, 29.6, 162.2, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (71, '13770000', 2018, 'primeira', DATE '2018-09-04', TIME '09:23', 24.48, 22.93, 7.84, 6.81, 33.6, 16.9, NULL, 1.9, NULL, NULL, 0.01, NULL, 8.39, 28.51, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (72, '13610001', 2018, 'primeira', DATE '2018-09-05', TIME '09:15', 23.39, 26.46, 7.79, 6.76, 127.69, 73.6, NULL, 0.04, NULL, NULL, 0.01, NULL, 31.3, 120.0, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, 81.0),
  (73, '15324300', 2018, 'primeira', DATE '2018-09-06', TIME '08:30:00', 21.06, 24.2, 7.01, 7.44, 83.13, 20.7, NULL, 0.8, NULL, NULL, 2.9, NULL, 9.91, 50.44, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 25.0),
  (74, '12660000', 2018, 'segunda', DATE '2018-11-20', TIME '07:37', 26.46, 27.4, 6.54, 5.3, 473.07001, 188.10001, NULL, 0.04, NULL, NULL, 0.01, NULL, 69.0, 26.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (75, '13190000', 2018, 'segunda', DATE '2018-11-20', TIME '10:45', 27.95, 28.92, 6.65, 5.98, 217.84, 178.60001, NULL, 2.2, NULL, NULL, 0.2, NULL, 98.0, 45.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (76, '13408000', 2018, 'segunda', DATE '2018-11-20', TIME '13:35', 28.4, 26.84, 5.66, 5.48, 412.01999, 64.1, NULL, 2.5, NULL, NULL, 0.01, NULL, 92.0, 182.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (77, '13438000', 2018, 'segunda', DATE '2018-11-22', TIME '08:40', 26.69, 26.78, 5.98, 5.92, 548.75, NULL, NULL, 0.9, NULL, NULL, 0.01, NULL, 54.0, 10.2, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (78, '13459000', 2018, 'segunda', DATE '2018-11-22', TIME '10:50', 26.89, 26.13, 5.8, 4.68, 869.57001, NULL, NULL, 0.04, NULL, NULL, 0.01, NULL, 62.0, 42.6, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (79, '13550001', 2018, 'segunda', DATE '2018-11-22', TIME '13:25', 28.67, 27.03, 5.86, 4.62, 707.33002, NULL, NULL, 1.2, NULL, NULL, 6.1, NULL, 68.0, 120.1, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (80, '12430000', 2018, 'segunda', DATE '2018-11-24', TIME '08:00', 27.4, 26.7, 5.5, 3.89, 40.04, 25.9, NULL, 0.4, NULL, NULL, 0.01, NULL, 18.0, 46.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (81, '12500004', 2018, 'segunda', DATE '2018-11-24', TIME '09:00', 26.2, 25.6, 5.61, 2.46, 268.10999, 49.8, NULL, 0.04, NULL, NULL, 0.05, NULL, 40.0, 65.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (82, '13770000', 2018, 'segunda', DATE '2018-11-26', TIME '11:20:00', 28.48, 26.04, 5.21, 6.07, 94.04, 20.6, NULL, 1.6, NULL, NULL, 0.01, NULL, 32.0, 26.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (83, '12600002', 2018, 'segunda', DATE '2018-11-29', TIME '07:00', 24.8, 25.9, 4.72, 4.58, 460.82999, 116.6, NULL, 0.04, NULL, NULL, 0.01, NULL, 70.0, 42.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (84, '13610001', 2018, 'segunda', DATE '2018-12-06', TIME '08:40:00', 26.9, 26.7, 7.7, 4.94, 280.67001, 44.8, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, 604.0),
  (85, '15324300', 2018, 'segunda', DATE '2018-12-08', TIME '08:45', 25.9, 25.6, 8.3, 6.01, 75.65, 21.1, NULL, 0.6, NULL, NULL, 1.9, NULL, 42.0, 32.0, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 125.0),
  (86, '12369000', 2018, 'segunda', DATE '2018-12-11', TIME '06:00:00', 24.4, 27.1, 8.77, 6.39, 258.60999, 209.5, NULL, 0.04, NULL, NULL, 0.01, NULL, 62.0, 76.6, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (87, '13601000', 2018, 'segunda', DATE '2018-12-17', TIME '09:00', 24.0, 27.5, 9.54, 6.26, 193.28, NULL, NULL, 1.7, NULL, NULL, 0.1, NULL, 46.0, 162.0, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (88, '12389000', 2018, 'segunda', DATE '2018-12-23', TIME '07:00:00', 24.4, 25.0, 4.79, 3.94, 490.54999, 72.5, NULL, 0.04, NULL, NULL, 0.01, NULL, 72.0, 68.2, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (89, '12557000', 2018, 'segunda', DATE '2018-12-29', TIME '10:40', 27.7, 26.64, 6.94, 6.91, 110.73, 308.89999, NULL, 0.04, NULL, NULL, 0.01, NULL, 90.8, 65.6, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (90, '12430000', 2019, 'primeira', DATE '2019-02-19', TIME '09:00', 26.76, 25.05, 5.26, 3.9, 9.68, NULL, NULL, NULL, 0.25, NULL, 0.002, NULL, 17.38, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 16.9, NULL),
  (91, '12500004', 2019, 'primeira', DATE '2019-02-10', TIME '10:30', 26.9, 25.8, 6.07, 4.49, 341.10999, NULL, NULL, NULL, 0.08, NULL, 0.02, NULL, 38.9, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 68.7, NULL),
  (92, '12600002', 2019, 'primeira', DATE '2019-02-20', TIME '08:00:00', 25.67, 27.15, 7.02, 6.15, 430.45999, NULL, NULL, NULL, 0.12, NULL, 0.64, NULL, 67.6, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 164.0, NULL),
  (93, '12660000', 2019, 'primeira', DATE '2019-02-20', TIME '14:30', 25.45, 27.58, 7.11, 5.38, 640.29999, NULL, NULL, NULL, 0.04, NULL, 0.002, NULL, 99.0, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 251.7, NULL),
  (94, '13190000', 2019, 'primeira', DATE '2019-02-21', TIME '10:20', 28.34, 27.0, 6.52, 4.43, 796.59998, NULL, NULL, NULL, 1.4, NULL, 0.12, NULL, 17.9, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 137.9, NULL),
  (95, '13408000', 2019, 'primeira', DATE '2019-02-21', TIME '13:30', 26.87, 26.67, 6.22, 3.75, 920.25, NULL, NULL, NULL, 1.69, NULL, 0.002, NULL, 59.5, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 67.6, NULL),
  (96, '15324300', 2019, 'primeira', DATE '2019-02-22', TIME '16:50', 25.4, 25.9, 5.59, 4.42, 33.11, NULL, NULL, NULL, 0.129, NULL, 1.59, NULL, 108.3, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 12.8, 326.0),
  (97, '13610001', 2019, 'primeira', DATE '2019-02-23', TIME '11:30', 27.2, 26.6, 6.56, 5.32, 230.46001, NULL, NULL, NULL, 0.94, NULL, 0.128, NULL, 20.1, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 34.3, 1046.0),
  (98, '13438000', 2019, 'primeira', DATE '2019-02-26', TIME '09:15', 26.55, 27.9, 6.98, 6.77, 152.3, NULL, NULL, NULL, 1.1, NULL, 0.002, NULL, 68.1, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 175.2, NULL),
  (99, '13459000', 2019, 'primeira', DATE '2019-02-26', TIME '13:40:00', 28.03, 27.65, 6.7, 6.7, 311.29999, NULL, NULL, NULL, 0.04, NULL, 0.002, NULL, 91.9, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 75.4, NULL),
  (100, '13550001', 2019, 'primeira', DATE '2019-02-27', TIME '08:45:00', 24.46, 26.32, 6.67, 5.95, 560.54999, NULL, NULL, NULL, 0.98, NULL, 2.11, NULL, 22.7, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 50.8, NULL),
  (101, '13770000', 2019, 'primeira', DATE '2019-02-28', TIME '09:15', 25.39, 25.21, 5.74, 4.59, 32.2, NULL, NULL, NULL, 1.2, NULL, 0.003, NULL, 7.84, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 12.5, NULL),
  (102, '13601000', 2019, 'primeira', DATE '2019-02-28', TIME '11:35:00', 29.16, 26.79, 5.94, 5.38, 230.89999, NULL, NULL, NULL, 0.88, NULL, 0.052, NULL, 19.22, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 41.2, NULL),
  (103, '13610001', 2019, 'segunda', DATE '2019-05-02', TIME '14:14', 29.8, 28.1, 6.02, 6.01, 269.07999, NULL, NULL, NULL, 0.932, NULL, 0.13, NULL, 20.0, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 42.6, 477.0),
  (104, '15324300', 2019, 'segunda', DATE '2019-05-03', TIME '11:00', 32.8, 26.4, 6.02, 4.69, 44.82, NULL, NULL, NULL, 0.2, NULL, 0.031, NULL, 8.94, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 16.9, 242.0),
  (105, '13438000', 2019, 'segunda', DATE '2019-05-06', TIME '15:05', 33.9, 27.96, 7.21, 6.48, 596.90002, NULL, NULL, NULL, 0.9, NULL, 0.002, NULL, 39.9, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 91.3, NULL),
  (106, '13459000', 2019, 'segunda', DATE '2019-05-07', TIME '09:12:00', 29.44, 26.84, 7.1, 6.18, 700.27002, NULL, NULL, NULL, 0.04, NULL, 0.02, NULL, 36.7, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 90.7, NULL),
  (107, '12369000', 2019, 'segunda', DATE '2019-05-07', TIME '10:00', 32.44, 27.93, 7.53, 6.35, 317.10001, NULL, NULL, NULL, 0.04, NULL, 0.061, NULL, 16.7, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 178.7, NULL),
  (108, '13550001', 2019, 'segunda', DATE '2019-05-08', TIME '08:50:00', 27.7, 26.93, 7.11, 6.54, 383.89999, NULL, NULL, NULL, 0.79, NULL, 1.86, NULL, 28.9, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 73.1, NULL),
  (109, '13770000', 2019, 'segunda', DATE '2019-05-09', TIME '09:24', 28.71, 25.77, 5.99, 5.51, 31.8, NULL, NULL, NULL, 1.3, NULL, 0.006, NULL, 9.55, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 16.4, NULL),
  (110, '12389000', 2019, 'segunda', DATE '2019-05-09', TIME '09:30', 30.4, 28.35, 7.33, 5.96, 340.5, NULL, NULL, NULL, 0.012, NULL, 0.002, NULL, 64.2, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 163.2, NULL),
  (111, '13601000', 2019, 'segunda', DATE '2019-05-10', TIME '10:14', 28.89, 27.06, 6.6, 6.15, 233.8, NULL, NULL, NULL, 0.26, NULL, 0.04, NULL, 17.57, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 45.4, NULL),
  (112, '12430000', 2019, 'segunda', DATE '2019-05-10', TIME '15:00', 29.46, 26.72, 6.36, 3.86, 13.52, NULL, NULL, NULL, 0.11, NULL, 0.002, NULL, 14.77, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 34.2, NULL),
  (113, '12500004', 2019, 'segunda', DATE '2019-05-11', TIME '09:23', 28.04, 27.89, 7.04, 5.02, 166.35001, NULL, NULL, NULL, 0.3, NULL, 0.07, NULL, 38.9, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 97.6, NULL),
  (114, '12600002', 2019, 'segunda', DATE '2019-05-14', TIME '16:20', 22.6, 26.35, 7.61, 6.51, 240.23, NULL, NULL, NULL, 0.08, NULL, 0.05, NULL, 91.9, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 182.9, NULL),
  (115, '12660000', 2019, 'segunda', DATE '2019-05-16', TIME '09:30', 26.76, 27.68, 7.96, 6.69, 119.8, NULL, NULL, NULL, 0.04, NULL, 0.002, NULL, 169.0, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 448.5, NULL),
  (116, '13190000', 2019, 'segunda', DATE '2019-05-17', TIME '12:38:00', 26.66, 27.0, 7.58, 6.5, 230.14999, NULL, NULL, NULL, 1.34, NULL, 0.212, NULL, 70.4, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 223.2, NULL),
  (117, '13408000', 2019, 'segunda', DATE '2019-05-17', TIME '15:48:00', 27.83, 26.89, 7.27, 6.62, 304.04999, NULL, NULL, NULL, 1.31, NULL, 0.002, NULL, 28.1, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 158.2, NULL),
  (118, '12557000', 2019, 'segunda', DATE '2019-05-18', TIME '08:45', 28.03, 25.15, 8.25, 7.83, 30.61, NULL, NULL, NULL, 0.22, NULL, 0.002, NULL, 176.8, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 451.6, NULL),
  (119, '12660000', 2019, 'primeira', DATE '2019-08-05', TIME '10:00', 20.2, 25.17, 8.23, 7.67, 36.42, NULL, 6.0, 1.9, 1.2, 0.03, 0.022, 5.0, 68.3, 32.4, NULL, false, NULL, 1.0, NULL, NULL, NULL, NULL, 489.8, NULL),
  (120, '12600002', 2019, 'primeira', DATE '2019-08-05', TIME '12:10', 21.53, 24.58, 8.18, 8.39, 36.19, NULL, 7.0, 1.2, 0.8, 0.09, 0.002, 12.0, 127.7, 31.6, NULL, false, NULL, 3.0, NULL, NULL, NULL, NULL, 361.4, NULL),
  (121, '12430000', 2019, 'primeira', DATE '2019-08-06', TIME '09:30', 22.4, 24.26, 6.89, 6.57, 50.7, NULL, NULL, 1.6, 1.6, 0.11, 0.021, 9.1, 134.12, 22.3, NULL, false, NULL, 10.0, NULL, NULL, NULL, NULL, 58.5, NULL),
  (122, '12500004', 2019, 'primeira', DATE '2019-08-06', TIME '11:06', 25.05, 25.18, 7.57, 7.42, 31.5, NULL, 7.0, 2.0, 2.0, 0.08, 0.121, 7.3, 138.2, 18.12, NULL, false, NULL, 6.8, NULL, NULL, NULL, NULL, 210.5, NULL),
  (123, '12369000', 2019, 'primeira', DATE '2019-08-09', TIME '08:43', 26.43, 26.44, 8.15, 7.07, 16.18, NULL, 5.0, 0.6, 0.5, 0.06, 0.031, 8.1, 99.1, 21.42, NULL, false, NULL, 7.4, NULL, NULL, NULL, NULL, 439.3, NULL),
  (124, '12389000', 2019, 'primeira', DATE '2019-08-14', TIME '10:00', 26.1, 28.53, 7.82, 6.48, 43.66, NULL, 8.0, 0.5, 0.5, 0.08, 0.002, 6.1, 110.2, 25.2, NULL, false, NULL, 3.0, NULL, NULL, NULL, NULL, 378.1, NULL),
  (125, '13190000', 2019, 'primeira', DATE '2019-08-16', TIME '15:00', 31.5, 28.65, 8.22, 7.94, 27.65, NULL, 7.0, 1.9, 1.6, 0.02, 0.031, 7.4, 130.10001, 21.1, NULL, false, NULL, 16.9, NULL, NULL, NULL, NULL, 427.0, NULL),
  (126, '13408000', 2019, 'primeira', DATE '2019-08-16', TIME '17:00', 25.1, 28.68, 8.29, 8.36, 41.2, NULL, 7.0, 2.2, 1.8, 0.1, 0.026, 9.3, 112.16, 15.6, NULL, false, NULL, 91.4, NULL, NULL, NULL, NULL, 458.6, NULL),
  (127, '13438000', 2019, 'primeira', DATE '2019-08-27', TIME '08:20:00', 24.32, 24.05, 8.05, 7.62, 28.2, NULL, 9.0, 0.5, 0.3, 0.06, 0.022, 11.16, 97.8, 11.12, NULL, true, 1.0, 4.9, NULL, NULL, NULL, NULL, 648.0, NULL),
  (128, '13459000', 2019, 'primeira', DATE '2019-08-27', TIME '11:05', 28.27, 25.12, 7.44, 6.43, 198.27, NULL, 8.0, 1.6, 1.0, 0.11, 0.002, 7.3, 78.7, 16.32, NULL, true, 1.0, 8.9, NULL, NULL, NULL, NULL, 213.2, NULL),
  (129, '13550001', 2019, 'primeira', DATE '2019-08-28', TIME '11:30', 30.56, 27.73, 7.58, 6.87, 114.19, NULL, 7.0, 1.6, 1.2, 0.07, 0.002, 8.3, 68.1, 10.11, NULL, true, 1.0, 3.7, NULL, NULL, NULL, NULL, 226.2, NULL),
  (130, '13601000', 2019, 'primeira', DATE '2019-09-02', TIME '17:13', 28.5, 30.66, 7.45, 6.93, 89.66, NULL, NULL, NULL, NULL, NULL, 0.31, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 110.3, NULL),
  (131, '13770000', 2019, 'primeira', DATE '2019-09-03', TIME '14:24', 27.5, 26.7, 6.48, 6.02, 41.74, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 19.1, 2.0),
  (132, '15324300', 2019, 'primeira', DATE '2019-09-04', TIME '13:30', 31.9, 28.5, 6.54, 7.06, 84.57, NULL, NULL, 0.6, 0.5, 0.06, 0.021, 5.7, 28.9, 15.2, NULL, false, NULL, 3.0, NULL, NULL, NULL, NULL, 19.2, 30.0),
  (133, '13610001', 2019, 'primeira', DATE '2019-09-05', TIME '09:00', 28.1, 29.9, 7.24, 6.37, 43.54, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 115.9, 51.0),
  (134, '12557000', 2019, 'primeira', DATE '2019-09-19', TIME '08:23', 26.89, 29.41, 8.32, 7.3, 50.48, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 695.0, NULL),
  (135, '13190000', 2019, 'segunda', DATE '2019-11-12', TIME '08:15', 26.6, 27.29, 7.57, 5.58, 7.5, NULL, 7.0, 1.8, 1.5, 0.1, 0.03, 11.2, 87.3, 20.02, NULL, false, NULL, 6.9, NULL, NULL, NULL, NULL, 182.3, NULL),
  (136, '13610001', 2019, 'segunda', DATE '2019-11-12', TIME '13:30', 27.0, 28.0, 6.75, 5.37, 399.70001, NULL, 7.0, 0.8, 0.6, 0.09, 0.023, 7.5, 83.1, 16.8, NULL, true, 1.0, 2.0, NULL, NULL, NULL, NULL, 117.1, 245.0),
  (137, '12660000', 2019, 'segunda', DATE '2019-11-14', TIME '08:40', 26.15, 27.12, 7.47, 4.83, 308.70999, NULL, 9.0, 1.0, 0.9, 0.06, 0.02, 6.1, 134.3, 12.5, NULL, false, NULL, 4.0, NULL, NULL, NULL, NULL, 159.5, NULL),
  (138, '12600002', 2019, 'segunda', DATE '2019-11-14', TIME '06:38', 24.67, 27.0, 7.49, 5.45, 345.81, NULL, 7.0, 1.8, 1.4, 0.04, 0.026, 14.0, 110.0, 10.68, NULL, false, NULL, 6.1, NULL, NULL, NULL, NULL, 165.7, NULL),
  (139, '15324300', 2019, 'segunda', DATE '2019-11-18', TIME '13:00', 27.5, 26.5, 6.01, 5.7, 131.5, NULL, 8.0, 0.5, 0.4, 0.08, 0.021, 7.3, 43.2, 16.8, NULL, false, NULL, 4.11, NULL, NULL, NULL, NULL, 43.5, 121.0),
  (140, '12500004', 2019, 'segunda', DATE '2019-11-21', TIME '09:25', 27.29, 26.43, 6.7, 4.29, 173.10001, NULL, 7.0, 2.0, 2.0, 0.07, 0.232, 11.0, 61.8, 9.6, NULL, false, NULL, 8.9, NULL, NULL, NULL, NULL, 61.1, NULL),
  (141, '12430000', 2019, 'segunda', DATE '2019-11-21', TIME '08:30', 26.21, 25.2, 5.86, 3.73, 37.14, NULL, 8.0, 1.5, 1.4, 0.07, 0.02, 13.0, 91.4, 6.8, NULL, false, NULL, 3.7, NULL, NULL, NULL, NULL, 24.5, NULL),
  (142, '13601000', 2019, 'segunda', DATE '2019-11-25', TIME '11:30', 30.4, 26.7, 6.58, 4.93, 262.25, NULL, 6.0, 3.2, 2.0, 0.09, 0.213, 8.0, 128.0, 71.12, NULL, true, 1.0, 5.3, NULL, NULL, NULL, NULL, 105.1, NULL),
  (143, '13770000', 2019, 'segunda', DATE '2019-11-26', TIME '09:10', 27.0, 26.19, 5.79, 4.59, 49.1, NULL, 8.0, 0.5, 0.3, 0.12, 0.002, 8.16, 29.9, 2.9, NULL, false, NULL, 110.0, NULL, NULL, NULL, NULL, 44.1, 13.0),
  (144, '13438000', 2019, 'segunda', DATE '2019-11-29', TIME '08:06', 23.63, 24.41, 7.02, 5.41, 1002.0, NULL, 8.0, 0.4, 0.3, 0.08, 0.021, 8.7, 124.4, 14.3, NULL, false, NULL, 4.9, NULL, NULL, NULL, NULL, 66.3, NULL),
  (145, '13459000', 2019, 'segunda', DATE '2019-11-29', TIME '11:00', 24.58, 24.47, 6.47, 5.6, 789.79999, NULL, 8.0, 1.6, 0.9, 0.06, 0.0231, 10.0, 89.1, 18.11, NULL, true, 1.0, 12.16, NULL, NULL, NULL, NULL, 37.5, NULL),
  (146, '13550001', 2019, 'segunda', DATE '2019-11-30', TIME '08:10', 26.72, 24.81, 6.65, 5.53, 725.40002, NULL, 11.0, 1.0, 1.0, 0.09, 0.0321, 7.0, 33.12, 5.2, NULL, true, 1.0, 14.18, NULL, NULL, NULL, NULL, 39.3, NULL),
  (147, '13601000', 2020, 'primeira', DATE '2020-02-17', TIME '11:44', 29.9, 26.8, 8.39, 6.37, 145.75999, NULL, 6.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (148, '12430000', 2020, 'primeira', DATE '2020-02-18', TIME '08:40', 26.9, 26.7, 6.88, 5.77, 31.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 33.8, NULL),
  (149, '13770000', 2020, 'primeira', DATE '2020-02-18', TIME '08:45:00', 28.2, 26.2, 7.26, 5.01, 28.2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 24.0),
  (150, '15324300', 2020, 'primeira', DATE '2020-02-18', TIME '09:30:00', 31.2, 26.4, 7.84, 5.35, 34.06, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 15.0, 369.0),
  (151, '12500004', 2020, 'primeira', DATE '2020-02-18', TIME '10:18:00', 31.85, 26.97, 7.47, 5.92, 354.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 95.9, NULL),
  (152, '13610001', 2020, 'primeira', DATE '2020-02-18', TIME '13:35', 28.4, 27.5, 7.46, 6.36, 169.5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 37.5, 795.0),
  (153, '12600002', 2020, 'primeira', DATE '2020-02-19', TIME '09:00', 27.61, 27.34, 7.6, 6.87, 450.92999, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 188.7, NULL),
  (154, '12660000', 2020, 'primeira', DATE '2020-02-19', TIME '11:20:00', 27.41, 27.74, 7.68, 6.66, 327.54999, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 229.3, NULL),
  (155, '13190000', 2020, 'primeira', DATE '2020-02-20', TIME '08:30:00', 27.01, 28.35, 7.61, 6.86, 365.25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 177.3, NULL),
  (156, '13408000', 2020, 'primeira', DATE '2020-02-20', TIME '10:43', 30.32, 27.34, 6.94, 6.64, 455.29999, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 78.5, NULL),
  (157, '13438000', 2020, 'primeira', DATE '2020-02-28', TIME '08:30:00', 26.28, 26.56, 7.48, 7.43, 408.10999, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 111.3, NULL),
  (158, '13459000', 2020, 'primeira', DATE '2020-02-28', TIME '11:00:00', 30.0, 26.64, 6.74, 7.09, 362.82001, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 50.3, NULL),
  (159, '13550001', 2020, 'primeira', DATE '2020-02-29', TIME '08:10', 25.24, 26.7, 6.77, 6.72, 403.75, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 1.0, NULL, NULL, NULL, NULL, NULL, 48.2, NULL),
  (160, '12369000', 2020, 'primeira', DATE '2020-03-04', TIME '10:25', 30.38, 27.62, 7.3, 6.16, 502.25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 156.4, NULL),
  (161, '12389000', 2020, 'primeira', DATE '2020-03-06', TIME '09:15', 24.91, 27.7, 7.28, 6.51, 471.75, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 134.2, NULL),
  (162, '12557000', 2020, 'primeira', DATE '2020-03-12', TIME '10:00', 27.6, 25.7, 7.57, 7.56, 367.89999, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 222.5, NULL),
  (163, '13438000', 2020, 'segunda', DATE '2020-11-05', TIME '08:25', 29.14, 28.58, 8.02, 8.35, 36.5, NULL, 5.0, 0.2, 0.2, 0.06, 0.011, 0.0, 114.8, 12.35, NULL, true, 1.0, 65.9, NULL, NULL, NULL, NULL, 231.4, NULL),
  (164, '13459000', 2020, 'segunda', DATE '2020-11-05', TIME '11:55', 29.58, 30.01, 7.53, 7.5, 122.93, NULL, 7.0, 0.5, 0.3, 0.05, 0.0132, 0.8, 49.8, 6.8, NULL, true, 1.0, 62.4, NULL, NULL, NULL, NULL, 96.3, NULL),
  (165, '13550001', 2020, 'segunda', DATE '2020-11-06', TIME '08:50', 29.18, 28.82, 7.33, 7.48, 63.98, NULL, 8.0, 0.4, 0.6, 0.08, 0.0102, 0.6, 41.2, 5.8, NULL, true, 1.0, 144.0, NULL, NULL, NULL, NULL, 74.3, NULL),
  (166, '12557000', 2020, 'segunda', DATE '2020-11-19', TIME '11:35', 28.09, 30.19, 8.03, 7.46, 63.3, NULL, 9.0, 0.23, 0.2, 0.08, 0.0012, 0.34, 107.7, 4.8, NULL, false, NULL, 101.3, 48.0, NULL, NULL, NULL, 220.5, NULL),
  (167, '12369000', 2020, 'segunda', DATE '2020-11-25', TIME '08:06', 27.03, 27.35, 7.35, 5.96, 55.21, NULL, 10.0, 0.24, 0.2, 0.11, 0.0042, 0.0, 132.10001, 30.0, NULL, false, NULL, 73.8, 16.0, NULL, NULL, NULL, 121.5, NULL),
  (168, '12389000', 2020, 'segunda', DATE '2020-11-27', TIME '08:17', 25.0, 27.65, 7.3, 5.75, 61.97, NULL, 5.0, 0.62, 0.6, 0.05, 0.0231, 0.0, 56.0, 10.2, NULL, false, NULL, 30.6, 11.0, NULL, NULL, NULL, 106.1, NULL),
  (169, '12430000', 2020, 'segunda', DATE '2020-11-30', TIME '09:20', 27.58, 27.32, 6.65, 6.79, 17.4, NULL, 6.0, 0.9, 0.6, 0.12, 0.0423, 0.8, 23.8, 5.8, NULL, false, NULL, 118.1, 19.0, NULL, NULL, NULL, 37.2, NULL),
  (170, '12500004', 2020, 'segunda', DATE '2020-11-30', TIME '10:50', 29.9, 27.45, 7.04, 5.98, 55.8, NULL, 11.0, 1.1, 0.8, 0.16, 0.0132, 0.0, 38.8, 4.0, NULL, false, NULL, 129.8, 53.0, NULL, NULL, NULL, 69.7, NULL),
  (171, '12600002', 2020, 'segunda', DATE '2020-12-01', TIME '09:20', 26.6, 27.55, 7.57, 6.75, 101.75, NULL, 7.0, 1.2, 1.0, 0.12, 0.0039, 0.0, 59.3, 6.9, NULL, false, NULL, 50.4, 22.0, NULL, NULL, NULL, 129.6, NULL),
  (172, '12660000', 2020, 'segunda', DATE '2020-12-02', TIME '10:00', 26.2, 28.52, 7.71, 6.5, 83.9, NULL, 8.0, 0.8, 0.6, 0.1, 0.0013, 1.8, 84.8, 6.8, NULL, false, NULL, 94.5, 32.0, NULL, NULL, NULL, 164.7, NULL),
  (173, '13190000', 2020, 'segunda', DATE '2020-12-03', TIME '11:40:00', 28.0, 27.07, 7.96, 6.99, 51.6, NULL, 9.0, 0.9, 0.8, 0.18, 0.03, 0.0, 119.0, 15.0, NULL, false, NULL, 118.0, 10.0, NULL, NULL, NULL, 240.7, NULL),
  (174, '13408000', 2020, 'segunda', DATE '2020-12-03', TIME '14:00', 31.0, 31.2, 8.29, 9.34, 34.18, NULL, 7.0, 1.4, 0.8, 0.15, 0.0053, 0.9, 68.7, 3.8, NULL, false, NULL, 78.2, 4.0, NULL, NULL, NULL, 265.6, NULL),
  (175, '13610001', 2020, 'segunda', DATE '2020-12-08', TIME '09:55', 29.47, 29.13, 9.67, 5.93, 47.64, NULL, 8.0, 0.6, 0.6, 0.09, 0.0022, 0.82, 51.0, 7.9, NULL, true, 1.0, 73.8, NULL, NULL, NULL, NULL, 92.2, 795.0),
  (176, '15324300', 2020, 'segunda', DATE '2020-12-09', TIME '09:40:00', 33.83, 26.5, 9.44, 6.91, 60.03, NULL, 6.0, 0.4, 0.2, 0.04, 0.0132, 0.0, 15.54, 4.0, NULL, false, NULL, 10.0, 1.0, NULL, NULL, NULL, 22.7, 369.0),
  (177, '13770000', 2020, 'segunda', DATE '2020-12-10', TIME '09:25:00', 25.68, 25.85, 5.35, 6.24, 29.08, NULL, 5.0, 0.42, 0.3, 0.04, 0.0021, 0.0, 14.97, 3.0, NULL, false, NULL, 45.3, 3.0, NULL, NULL, NULL, 22.8, 24.0),
  (178, '13601000', 2020, 'segunda', DATE '2020-12-11', TIME '10:00', 25.38, 27.83, 8.4, 6.78, 51.96, NULL, 6.0, 1.6, 0.98, 0.0, 0.0248, 0.38, 40.4, 6.9, NULL, true, 1.0, 165.2, NULL, NULL, NULL, NULL, 74.5, NULL),
  (179, '12430000', 2021, 'primeira', DATE '2021-02-09', TIME '08:00', NULL, 25.75, 9.48, 4.15, 4.29, NULL, 5.0, 0.7, 0.6, 0.07, 0.0198, 0.2, 91.3, 8.0, 14.1, false, NULL, 66.3, NULL, 8.0, 4.32, 6.0, 20.1, NULL),
  (180, '12500004', 2021, 'primeira', DATE '2021-02-09', TIME '08:58', 25.85, 26.45, 10.01, 5.09, 37.5, NULL, 9.0, 0.72, 0.6, 0.11, 0.0121, 0.01, 42.3, 3.6, 41.7, false, NULL, 90.8, NULL, 13.0, 6.7, 8.0, 44.1, NULL),
  (181, '12600002', 2021, 'primeira', DATE '2021-02-10', TIME '06:49', 26.7, 26.71, 10.63, 6.63, 140.6, NULL, 6.0, 1.6, 1.2, 0.08, 0.0022, 0.02, 71.2, 5.6, 2.0, false, NULL, 28.2, NULL, 10.0, 5.26, 6.0, 146.5, NULL),
  (182, '12660000', 2021, 'primeira', DATE '2021-02-10', TIME '08:25', 24.92, 26.14, 9.69, 6.19, 116.2, NULL, 6.0, 0.6, 0.05, 0.08, 0.0022, 0.88, 91.6, 5.6, 22.8, false, NULL, 78.9, NULL, 10.0, 2.4, 12.0, 142.2, NULL),
  (183, '13190000', 2021, 'primeira', DATE '2021-02-11', TIME '07:47', 23.84, 25.45, 1.62, 5.11, 243.23, NULL, 7.0, 0.89, 0.86, 0.12, 0.021, 0.0, 73.3, 8.1, 8.4, false, NULL, 78.0, NULL, 6.0, 6.055, 12.0, 88.9, NULL),
  (184, '13408000', 2021, 'primeira', DATE '2021-02-12', TIME '07:40', 24.4, 25.4, 8.38, 4.3, 179.3, NULL, 4.0, 0.8, 0.71, 0.02, 0.0041, 0.1, 10.64, 4.3, 3.1, false, NULL, 31.5, NULL, 8.0, 3.2, 3.0, 60.9, NULL),
  (185, '13438000', 2021, 'primeira', DATE '2021-02-18', TIME '09:57', 27.07, 25.06, 7.01, 7.53, 185.54, NULL, 5.0, 0.4, 0.3, 0.03, 0.0012, 0.05, 37.5, 4.0, 14.6, false, NULL, 36.4, NULL, 8.0, 4.01, 5.0, 72.1, NULL),
  (186, '13459000', 2021, 'primeira', DATE '2021-02-18', TIME '14:09', 26.33, 24.56, 6.83, 6.36, 253.6, NULL, 6.0, 0.4, 0.35, 0.04, 0.0031, 0.02, 30.1, 4.11, 10.9, false, NULL, 45.9, NULL, 10.0, 5.48, 6.0, 56.6, 711.058),
  (187, '13550001', 2021, 'primeira', DATE '2021-02-19', TIME '08:45', 27.19, 24.76, 6.84, 6.74, 244.95, NULL, 7.0, 0.35, 0.05, 0.14, 0.0181, 0.16, 119.9, 17.12, 52.1, false, NULL, 121.0, NULL, 11.0, 6.51, 8.0, 52.5, 899.65),
  (188, '13601000', 2021, 'primeira', DATE '2021-02-25', TIME '09:01', 29.12, 25.55, 6.31, 5.61, 95.04, NULL, 4.0, 1.1, 0.8, 0.01, 0.0142, 0.19, 21.5, 3.7, 27.5, false, NULL, 93.3, NULL, 10.0, 4.44, 2.0, 43.2, NULL),
  (189, '13610001', 2021, 'primeira', DATE '2021-02-24', TIME '12:07', 25.78, 25.78, 4.21, 9.14, 3.14, NULL, 5.0, 0.5, 0.4, 0.05, 0.0011, 0.21, 24.4, 3.78, 14.6, false, NULL, 29.5, NULL, 8.0, 4.33, 6.0, 9.0, NULL),
  (190, '13770000', 2021, 'primeira', DATE '2021-02-23', TIME '04:25', 25.65, 30.14, 4.57, 8.39, 1.82, NULL, 6.0, 0.6, 0.4, 0.0, 0.0012, 0.31, 10.6, 2.136, 4.0, false, NULL, 13.2, NULL, 10.0, 5.38, 7.0, 19.1, 33.859),
  (191, '15324300', 2021, 'primeira', DATE '2021-02-23', TIME '10:15', 25.73, 25.71, 5.95, 5.1, 18.06, NULL, 4.0, 0.6, 0.4, 0.0, 0.0111, 0.01, 12.34, 31.8, 2.0, false, NULL, 8.4, NULL, 12.0, 1.04, 8.0, 19.1, 536831.0),
  (192, '13770000', 2021, 'segunda', DATE '2021-05-31', TIME '13:10', 26.28, 24.862, 6.02, 6.27, 31.94, NULL, 8.0, 0.4, 0.36, 0.21, 0.001, 0.25, 7.61, 2.8, 17.8, false, NULL, 78.2, NULL, 10.0, 4.1, 6.0, 15.1, 9.644),
  (193, '13601000', 2021, 'segunda', DATE '2021-06-01', TIME '10:00', 25.07, 26.63, 7.0, 6.5, 170.75, NULL, 9.0, 0.6, 0.6, 0.04, 0.8, 0.13, 39.8, 3.2, 0.0, false, NULL, 2.0, NULL, 6.0, 3.8, 10.0, 76.3, 124.454),
  (194, '13610001', 2021, 'segunda', DATE '2021-06-02', TIME '09:00', 26.15, 26.76, 6.9, 6.03, 144.81, NULL, 6.0, 0.4, 0.3, 0.16, 0.0012, 0.23, 40.2, 4.0, 0.0, false, NULL, 95.0, NULL, 20.0, 3.8, 16.0, 83.7, 134.375),
  (195, '15324300', 2021, 'segunda', DATE '2021-06-03', TIME '09:30', 33.63, 24.96, 6.19, 6.8, 70.4, NULL, 10.0, 0.4, 0.36, 0.09, 0.0129, 0.04, 10.58, 30.0, 4.2, false, NULL, 25.4, NULL, 8.0, 2.0, 6.0, 20.2, 81.078),
  (196, '12430000', 2021, 'segunda', DATE '2021-06-08', TIME '09:30', 26.15, 26.32, 6.55, 5.68, 33.4, NULL, 9.0, 0.5, 0.5, 0.05, 0.0126, 0.15, 23.1, 0.06, 0.0, false, NULL, 45.3, NULL, 16.0, 4.2, 10.0, 45.6, NULL),
  (197, '12500004', 2021, 'segunda', DATE '2021-06-08', TIME '11:00', 27.37, 26.85, 7.26, 6.2, 47.5, NULL, 10.0, 0.6, 0.5, 0.11, 0.011, 0.03, 72.3, 2.9, 0.0, false, NULL, 83.1, NULL, 10.0, 6.5, 8.0, 125.8, NULL),
  (198, '12600002', 2021, 'segunda', DATE '2021-06-09', TIME '08:40', 26.23, 27.5, 7.97, 6.83, 108.17, NULL, 7.0, 1.6, 1.4, 0.09, 0.002, 0.05, 151.7, 5.0, 0.0, false, NULL, 2.0, NULL, 6.0, 3.8, 12.0, 297.4, NULL),
  (199, '12660000', 2021, 'segunda', DATE '2021-06-10', TIME '09:40', 28.56, 28.53, 8.13, 6.72, 55.08, NULL, 7.0, 0.6, 0.5, 0.14, 0.00212, 0.36, 231.0, 10.2, 0.0, false, NULL, 32.4, NULL, 50.0, 3.0, 16.0, 472.0, NULL),
  (200, '13190000', 2021, 'segunda', DATE '2021-06-11', TIME '10:30', 29.05, 29.25, 8.13, 7.01, 70.11, NULL, 10.0, 0.62, 0.6, 0.2, 0.012, 0.02, 193.4, 14.2, 0.0, false, NULL, 65.9, NULL, 25.0, 4.6, 12.0, 395.8, NULL),
  (201, '13408000', 2021, 'segunda', DATE '2021-06-11', TIME '13:20', 29.71, 29.3, 8.02, 7.77, 54.45, NULL, 8.0, 0.6, 0.6, 0.17, 0.0014, 0.08, 161.6, 9.0, 0.0, false, NULL, 12.4, NULL, 18.0, 3.0, 12.0, 331.1, NULL),
  (202, '13169900', 2021, 'segunda', DATE '2021-06-18', TIME '08:35', 24.5, 27.43, 8.14, 6.98, 61.29, NULL, 8.0, 0.32, 0.3, 0.25, 0.0027, 0.05, 174.8, 30.0, 0.0, false, NULL, 9.9, NULL, 16.0, 0.1, 10.0, 363.3, NULL),
  (203, '12557000', 2021, 'segunda', DATE '2021-06-25', TIME '09:00', 27.0, 25.99, 8.36, 7.57, 21.27, NULL, 6.0, 0.22, 0.19, 0.18, 0.00113, 0.29, 338.0, 5.0, 0.0, false, NULL, 1.0, NULL, 6.0, 0.32, 8.0, 446.4, NULL),
  (204, '13438000', 2021, 'segunda', DATE '2021-06-30', TIME '07:34', 13.8, 17.9, 7.93, 8.69, 10.55, NULL, 5.0, 0.32, 0.22, 0.28, 0.0011, 0.08, 174.2, 3.5, 0.0, false, NULL, 5.34, NULL, 30.0, 3.2, 14.0, 357.3, NULL),
  (205, '13459000', 2021, 'segunda', DATE '2021-06-30', TIME '10:30', 16.6, 18.9, 7.28, 8.69, 104.5, NULL, 9.0, 0.3, 0.3, 0.024, 0.0029, 8.69, 54.4, 4.0, 0.0, false, NULL, 3.1, NULL, 10.0, 5.0, 14.0, 87.2, 27.56),
  (206, '13550001', 2021, 'segunda', DATE '2021-07-01', TIME '09:00', 19.2, 20.0, 7.32, 8.43, 107.77, NULL, 7.0, 0.2, 0.1, 0.07, 0.0022, 0.11, 54.6, 10.0, 0.0, false, NULL, 7.5, NULL, 7.0, 5.4, 10.0, 107.4, 55.178),
  (207, '12389000', 2021, 'primeira', DATE '2021-08-18', TIME '09:15', 27.7, 29.4, 7.86, 5.8, 35.03, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 400.1, NULL),
  (208, '12369000', 2021, 'primeira', DATE '2021-08-19', TIME '17:00', 28.2, 30.7, 8.46, 8.08, 13.88, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, 433.3, NULL),
  (209, '13601000', 2021, 'primeira', DATE '2021-09-08', TIME '10:30', 37.5, 30.1, 7.7, 6.47, 51.5, NULL, 7.0, 6.0, 6.0, 0.032, 0.5, 0.09, 49.6, 3.9, 0.0, false, NULL, 3.0, NULL, 4.0, 2.9, 7.0, 132.6, 34.947),
  (210, '13770000', 2021, 'primeira', DATE '2021-09-08', TIME '14:45', 31.8, 26.9, 6.59, 5.85, 30.01, NULL, 6.0, 0.4, 0.4, 0.16, 0.002, 0.1, 10.33, 2.9, 10.3, false, NULL, 31.0, NULL, 8.0, 3.2, 5.0, 23.5, 1.84),
  (211, '13610001', 2021, 'primeira', DATE '2021-09-09', TIME '14:45', 35.1, 31.3, 7.53, 6.76, 24.79, NULL, 8.0, 1.0, 0.8, 0.21, 0.018, 0.3, 47.4, 3.8, 0.0, false, NULL, 39.7, NULL, 18.0, 3.1, 10.0, 130.8, 39.624),
  (212, '15324300', 2021, 'primeira', DATE '2021-09-10', TIME '11:00', 29.5, 28.2, 6.58, 7.0, 50.96, NULL, 8.0, 0.42, 0.4, 0.13, 0.013, 0.09, 17.51, 10.2, 0.0, false, NULL, 10.0, NULL, 10.0, 2.4, 4.0, 30.1, 18.288),
  (213, '12430000', 2021, 'primeira', DATE '2021-09-15', TIME '08:15', 27.94, 28.88, 6.72, 6.51, 50.23, NULL, 7.0, 0.6, 0.4, 0.11, 0.021, 0.19, 78.9, 0.8, 0.0, false, NULL, 59.6, NULL, 20.0, 3.8, 15.0, 60.2, NULL),
  (214, '12500004', 2021, 'primeira', DATE '2021-09-15', TIME '09:30', 27.84, 28.68, 7.3, 4.45, 208.7, NULL, 6.0, 0.7, 0.6, 0.09, 0.022, 0.05, 23.8, 2.6, 0.0, false, NULL, 21.1, NULL, 11.0, 5.2, 6.0, 230.2, NULL),
  (215, '12600002', 2021, 'primeira', DATE '2021-09-16', TIME '07:25', 26.67, 28.13, 7.6, 6.22, 482.3, NULL, 5.0, 1.0, 0.9, 0.1, 0.0028, 0.18, 172.1, 4.2, 0.0, false, NULL, 1.0, NULL, 19.0, 3.6, 10.0, 201.3, NULL),
  (216, '12660000', 2021, 'primeira', DATE '2021-09-16', TIME '09:10', 26.62, 29.72, 7.91, 4.97, 188.09, NULL, 5.0, 0.6, 0.4, 0.12, 0.00131, 0.41, 75.1, 11.0, 0.0, false, NULL, 11.9, NULL, 20.0, 2.8, 10.0, 469.7, NULL),
  (217, '13190000', 2021, 'primeira', DATE '2021-09-17', TIME '07:33', 26.36, 29.58, 8.34, 6.77, 51.93, NULL, 8.0, 0.8, 0.5, 0.07, 0.018, 0.1, 170.9, 9.0, 0.0, false, NULL, 35.7, NULL, 18.0, 3.8, 10.0, 402.6, NULL),
  (218, '13408000', 2021, 'primeira', DATE '2021-09-17', TIME '10:00', 27.07, 29.29, 8.35, 6.78, 41.42, NULL, 10.0, 0.6, 0.4, 0.22, 0.0032, 0.09, 143.3, 6.0, 0.0, false, NULL, 10.3, NULL, 12.0, 2.6, 8.0, 485.4, NULL),
  (219, '13169900', 2021, 'primeira', DATE '2021-09-24', TIME '08:22', 24.9, 28.2, 8.1, 6.82, 186.9, NULL, 7.0, 0.4, 0.31, 0.2, 0.0018, 0.09, 97.1, 15.0, 0.0, false, NULL, 5.6, NULL, 10.0, 0.4, 6.0, 245.7, NULL),
  (220, '12557000', 2021, 'primeira', DATE '2021-09-30', TIME '08:15', 27.26, 26.23, 7.9, 6.37, 203.5, NULL, 4.0, 0.3, 0.2, 0.14, 0.0018, 0.31, 102.5, 6.2, 0.0, false, NULL, 3.0, NULL, 12.0, 0.5, 7.0, 282.8, NULL),
  (221, '13438000', 2021, 'primeira', DATE '2021-10-07', TIME '09:25', 29.1, 28.9, 7.84, 6.81, 310.72, NULL, 6.0, 0.26, 0.2, 0.17, 0.001, 0.1, 82.3, 3.4, 0.0, false, NULL, 7.9, NULL, 19.0, 3.0, 11.0, 226.3, NULL),
  (222, '13459000', 2021, 'primeira', DATE '2021-10-07', TIME '13:40', 31.0, 28.5, 7.47, 6.88, 92.92, NULL, 6.0, 0.55, 0.4, 0.23, 0.0018, 0.08, 49.2, 2.5, 0.0, false, NULL, 10.0, NULL, 16.0, 3.6, 10.0, 125.6, 31.108),
  (223, '13550001', 2021, 'primeira', DATE '2021-10-08', TIME '07:20', 27.8, 29.2, 7.35, 6.45, 93.84, NULL, 5.0, 0.3, 0.15, 0.09, 0.0018, 0.12, 44.9, 8.0, 0.0, false, NULL, 4.6, NULL, 10.0, 4.1, 6.0, 131.3, 39.645),
  (224, '13601000', 2021, 'segunda', DATE '2021-12-08', TIME '10:00', 28.8, 26.38, 6.58, 3.83, 318.45, NULL, 5.0, 6.1, 4.5, 0.24, 0.1, 0.11, 27.0, 0.342, 0.0, false, NULL, 6.0, NULL, 8.0, 1.6, 5.0, 65.5, 325.197),
  (225, '13770000', 2021, 'segunda', DATE '2021-12-08', TIME '15:20', 25.8, 25.7, 5.75, 5.18, 99.96, NULL, 5.0, 3.1, 2.3, 0.08, 0.2, 0.05, 11.28, 0.456, 0.0, false, NULL, 10.0, NULL, 5.0, 2.0, 4.0, 25.0, 7.735),
  (226, '13610001', 2021, 'segunda', DATE '2021-12-09', TIME '10:30', 34.0, 27.5, 6.42, 3.95, 294.83, NULL, 10.0, 1.2, 0.7, 0.1, 0.09, 0.21, 24.2, 0.3, 0.0, false, NULL, 25.1, NULL, 12.0, 25.1, 8.0, 65.8, 477.114),
  (227, '15324300', 2021, 'segunda', DATE '2021-12-10', TIME '14:00', 34.9, 26.6, 5.95, 5.7, 131.05, NULL, 6.0, 1.3, 0.8, 0.07, 0.086, 0.14, 9.96, 0.4256, 0.0, false, NULL, 13.0, NULL, 14.0, 1.8, 6.0, 25.3, 126.091),
  (228, '12500004', 2021, 'segunda', DATE '2021-12-14', TIME '07:01', 25.7, 25.78, 6.61, 2.92, 265.04, NULL, 8.0, 1.06, 0.9, 0.12, 0.062, 0.09, 27.1, 0.342, 0.0, false, NULL, 15.3, NULL, 10.0, 1.6, 7.0, 71.4, NULL),
  (229, '12430000', 2021, 'segunda', DATE '2021-12-14', TIME '08:07', 25.6, 25.45, 5.39, 1.86, 14.69, NULL, 10.0, 1.9, 1.6, 0.18, 0.039, 0.06, 11.2, 0.0988, 0.0, false, NULL, 34.1, NULL, 16.0, 1.6, 12.0, 28.4, NULL),
  (230, '12600002', 2021, 'segunda', DATE '2021-12-15', TIME '06:40', 25.85, 26.61, 7.57, 6.29, 331.05, NULL, 7.0, 2.0, 1.8, 0.05, 0.012, 0.11, 69.7, 0.1748, 0.0, false, NULL, 4.0, NULL, 18.0, 1.0, 7.0, 176.4, NULL),
  (231, '12660000', 2021, 'segunda', DATE '2021-12-15', TIME '08:15', 27.12, 26.43, 7.63, 5.612, 270.28, NULL, 4.0, 2.4, 1.1, 0.07, 0.051, 0.1, 66.6, 0.1596, 0.0, false, NULL, 3.0, NULL, 12.0, 0.9, 8.0, 163.5, NULL),
  (232, '13190000', 2021, 'segunda', DATE '2021-12-16', TIME '07:00', 27.2, 27.23, 7.34, 5.07, 373.84, NULL, 10.0, 1.2, 0.8, 0.2, 0.012, 0.08, 55.0, 2.432, 5.3, false, NULL, 49.0, NULL, 10.0, 1.3, 6.0, 138.6, NULL),
  (233, '13408000', 2021, 'segunda', DATE '2021-12-16', TIME '08:32', 27.06, 26.42, 6.66, 3.99, 285.57, NULL, 13.0, 2.9, 1.6, 0.17, 0.056, 0.04, 28.8, 0.722, 3.0, false, NULL, 14.21, NULL, 15.0, 1.4, 10.0, 73.5, NULL),
  (234, '13438000', 2021, 'segunda', DATE '2022-01-11', TIME '10:40', 31.2, 29.0, 7.64, 7.6, 74.62, NULL, 10.0, 3.0, 2.4, 0.09, 0.039, 0.05, 99.1, 0.1064, 0.0, false, NULL, 4.0, NULL, 10.0, 0.9, 6.0, 274.1, NULL),
  (235, '13459000', 2021, 'segunda', DATE '2022-01-11', TIME '13:30', 33.4, 27.1, 7.07, 6.66, 166.06, NULL, 9.0, 5.2, 5.0, 0.11, 0.039, 0.03, 33.1, 0.418, 2.0, false, NULL, 6.4, NULL, 12.0, 1.1, 5.0, 78.8, 65.476),
  (236, '13550001', 2021, 'segunda', DATE '2022-01-12', TIME '08:30', 26.6, 26.7, 6.54, 6.38, 239.5, NULL, 4.0, 3.8, 3.6, 0.03, 0.096, 0.1, 28.2, 0.38, 0.0, false, NULL, 2.7, NULL, 6.0, 1.6, 4.0, 60.7, 177.125),
  (237, '12369000', 2022, 'primeira', DATE '2022-04-08', TIME '12:00', 27.7, 26.3, 7.63, 6.06, 337.49, NULL, 6.0, 1.1, 0.8, 0.14, 0.042, 0.29, 71.6, 0.224, 0.0, false, NULL, 17.7, NULL, 15.0, 21.0, 10.0, 205.7, NULL),
  (238, '12430000', 2022, 'primeira', DATE '2022-03-30', TIME '07:45', 23.32, 24.02, 6.3, 4.07, 8.75, NULL, 7.0, 0.8, 1.4, 0.14, 0.03, 0.09, 9.6, 0.0971, 1.0, false, NULL, 18.7, NULL, 11.0, 1.23, 9.0, 25.8, NULL),
  (239, '12500004', 2022, 'primeira', DATE '2022-03-30', TIME '09:00', 26.22, 24.71, 6.85, 3.8, 357.61, NULL, 5.0, 0.88, 0.5, 0.09, 0.043, 0.01, 21.6, 0.299, 0.0, false, NULL, 11.0, NULL, 8.0, 1.3, 5.0, 63.0, NULL),
  (240, '12557000', 2022, 'primeira', DATE '2022-05-12', TIME '11:00', 23.9, 25.9, 8.18, 6.34, 287.17, NULL, 6.0, 1.3, 1.0, 0.1, 0.0028, 0.25, 142.6, 0.0534, 0.0, false, NULL, 2.0, NULL, 10.0, 0.09, 5.0, 391.4, NULL),
  (241, '12600002', 2022, 'primeira', DATE '2022-03-31', TIME '15:50', 26.17, 25.31, 7.49, 5.68, 493.73, NULL, 8.0, 1.7, 1.3, 0.03, 0.01, 0.14, 54.8, 0.1737, 0.0, false, NULL, 2.0, NULL, 12.0, 0.8, 8.0, 154.3, NULL),
  (242, '12660000', 2022, 'primeira', DATE '2022-04-01', TIME '13:30', 21.62, 25.594, 7.63, 5.97, 348.51, NULL, 6.0, 2.1, 1.4, 0.09, 0.045, 0.05, 86.8, 0.1589, 0.0, false, NULL, 5.0, NULL, 6.0, 1.0, 4.0, 235.8, NULL),
  (243, '13169900', 2022, 'primeira', DATE '2022-05-09', TIME '09:00', NULL, NULL, NULL, NULL, NULL, NULL, 10.0, 1.16, 0.9, 0.11, 0.02, 0.05, 89.69, 0.015, 0.0, false, NULL, 3.1, NULL, 8.0, 0.8, 4.0, NULL, NULL),
  (244, '13190000', 2022, 'primeira', DATE '2022-04-04', TIME '08:00', 27.656, 25.143, 7.59, 5.7, 476.62, NULL, 8.0, 1.5, 1.0, 0.17, 0.019, 0.03, 63.5, 1.341, 1.0, false, NULL, 11.5, NULL, 8.0, 1.2, 4.0, 172.8, NULL),
  (245, '13408000', 2022, 'primeira', DATE '2022-04-04', TIME '10:15', 24.704, 24.747, 7.24, 4.64, 598.53, NULL, 10.0, 2.4, 1.9, 0.24, 0.077, 0.09, 33.8, 0.881, 20.2, false, NULL, 20.2, NULL, 18.0, 1.6, 12.0, 88.9, NULL),
  (246, '13438000', 2022, 'primeira', DATE '2022-04-29', TIME '06:41', 24.8, 27.5, 7.87, 6.79, 94.78, NULL, 8.0, 3.5, 2.8, 0.02, 0.033, 0.09, 88.1, 0.1032, 0.0, false, NULL, 6.0, NULL, 8.0, 1.0, 4.0, 249.6, NULL),
  (247, '13459000', 2022, 'primeira', DATE '2022-04-28', TIME '13:23', 29.6, 27.9, 7.62, 6.66, 272.17, NULL, 5.0, 1.7, 3.1, 0.08, 0.025, 0.0, 32.2, 0.41, 0.0, false, NULL, 2.0, NULL, 8.0, 1.0, 3.0, 89.3, NULL),
  (248, '13550001', 2022, 'primeira', DATE '2022-04-28', TIME '10:24', 29.6, 27.9, 7.52, 6.82, 144.95, NULL, 5.0, 2.99, 1.7, 0.09, 0.079, 0.15, 36.8, 0.291, 0.0, false, NULL, 3.1, NULL, 9.0, 2.16, 7.0, 84.9, NULL),
  (249, '13610001', 2022, 'primeira', DATE '2022-04-26', TIME '11:00', 31.9, 28.2, 6.91, 5.78, 252.02, NULL, 5.0, 1.5, 0.9, 0.21, 1.2, 0.43, 23.8, 0.239, 0.0, false, NULL, 13.7, NULL, 10.0, 21.0, 6.0, 64.1, NULL),
  (250, '13770000', 2022, 'primeira', DATE '2022-04-27', TIME '08:27', 28.69, 25.9, 6.68, 5.45, 19.6, NULL, 7.0, 2.5, 1.9, 0.11, 0.018, 0.07, 7.47, 0.397, 0.0, false, NULL, 6.1, NULL, 9.0, 1.13, 6.0, 19.6, NULL),
  (251, '13601000', 2022, 'primeira', DATE '2022-04-29', TIME '14:45', 28.4, 28.8, 7.58, 6.34, 173.97, NULL, 7.0, 2.9, 2.12, 0.19, 0.011, 0.09, 28.4, 0.312, 0.0, false, NULL, 10.0, NULL, 6.0, 1.3, 3.0, 76.6, NULL),
  (252, '15324300', 2022, 'primeira', DATE '2022-04-27', TIME '10:09', 32.1, 26.24, 6.42, 5.46, 61.54, NULL, 4.0, 0.9, 0.4, 0.12, 0.099, 0.19, 8.91, 0.396, 0.0, false, NULL, 9.4, NULL, 16.0, 2.0, 8.0, 26.4, NULL),
  (253, '13438000', 2022, 'segunda', DATE '2022-07-06', TIME '07:30', 25.7, 27.4, 7.9, 7.6, 4.4, NULL, 6.0, 3.19, 2.34, 0.06, 0.03, 0.12, 67.18, 0.1024, 0.0, false, NULL, 31.1, NULL, 5.0, 0.8, 3.88, 335.9, NULL),
  (254, '13459000', 2022, 'segunda', DATE '2022-07-06', TIME '09:20', 30.0, 27.4, 8.04, 8.47, 11.05, NULL, 8.0, 1.91, 3.5, 0.1, 0.02, 0.01, 28.91, 0.303, 0.0, false, NULL, 5.0, NULL, 10.0, 1.19, 5.0, 143.9, NULL),
  (255, '13550001', 2022, 'segunda', DATE '2022-07-06', TIME '14:30', 24.0, 28.82, 8.16, 9.1, 15.13, NULL, 6.0, 3.1, 1.4, 0.11, 0.063, 0.13, 31.2, 0.283, 0.0, false, NULL, 5.3, NULL, 8.0, 2.0, 5.0, 141.4, NULL),
  (256, '13610001', 2022, 'segunda', DATE '2022-06-29', TIME '14:00', 30.4, 27.5, 7.28, 7.5, 43.88, NULL, 4.0, 1.19, 0.77, 0.19, 1.08, 0.37, 33.9, 0.198, 0.0, false, NULL, 1.0, NULL, 8.0, 20.0, 4.0, 85.0, NULL),
  (257, '13770000', 2022, 'segunda', DATE '2022-06-28', TIME '13:30', 27.1, 23.4, 6.29, 7.45, 13.52, NULL, 5.0, 2.11, 2.0, 0.09, 0.016, 0.1, 6.41, 0.324, 0.0, false, NULL, 78.2, NULL, 11.0, 1.08, 8.0, 13.6, NULL),
  (258, '15324300', 2022, 'segunda', DATE '2022-06-30', TIME '10:00', 25.1, 24.5, 7.18, 8.04, 25.22, NULL, 5.0, 0.6, 0.37, 0.15, 0.077, 0.22, 9.6, 0.263, 0.0, false, NULL, 7.5, NULL, 20.0, 1.9, 10.0, 21.0, NULL),
  (259, '13601000', 2022, 'segunda', DATE '2022-06-29', TIME '08:50', 25.1, 26.3, 7.3, 7.64, 50.89, NULL, 5.0, 2.34, 1.91, 0.12, 0.01, 0.05, 35.9, 0.274, 0.0, false, NULL, 1.0, NULL, 5.0, 1.1, 3.8, 91.2, NULL),
  (260, '13601000', 2022, 'primeira', DATE '2022-10-14', TIME '08:35', 24.64, 27.34, 7.2, 5.75, 272.96, NULL, 7.0, 2.93, 2.18, 0.16, 0.019, 0.08, 49.66, 0.284, 0.0, false, NULL, 3.0, NULL, 7.0, 1.3, 4.1, 125.4, NULL),
  (261, '13438000', 2022, 'primeira', DATE '2022-10-11', TIME '06:30', 25.38, 29.96, 8.29, 6.1, 272.35, NULL, 7.0, 3.96, 2.7, 0.08, 0.039, 0.1, 77.18, 0.1021, 0.0, false, NULL, 19.0, NULL, 7.0, 1.0, 3.0, 382.6, NULL),
  (262, '12557000', 2022, 'primeira', DATE '2022-11-12', TIME '06:15:00', 23.1, 27.38, 8.67, 7.7, 5.21, NULL, 4.0, 1.1, 0.8, 0.16, 0.0017, 0.21, 137.3, 0.041, 0.0, false, NULL, 0.9, NULL, 7.0, 0.82, 3.0, 428.0, NULL),
  (263, '12500004', 2022, 'primeira', DATE '2022-09-26', TIME '07:58', 27.43, 26.3, 7.63, 6.32, 53.0, NULL, 7.0, 2.1, 1.2, 0.09, 0.11, 3.4, 38.7, 0.09, 0.0, false, NULL, 3.11, NULL, 8.0, 0.9, 6.0, 179.0, NULL),
  (264, '12430000', 2022, 'primeira', DATE '2022-09-26', TIME '08:52', 29.64, 27.46, 7.09, 5.67, 64.47, NULL, 8.0, 2.91, 2.0, 0.09, 0.027, 0.13, 65.99, 0.1021, 0.0, false, NULL, 2.0, NULL, 6.0, 1.0, 2.5, 43.6, NULL),
  (265, '12660000', 2022, 'primeira', DATE '2022-09-26', TIME '09:23', 26.36, 29.74, 8.7, 7.24, 31.16, NULL, 8.0, 2.3, 1.5, 0.14, 0.035, 0.18, 79.5, 0.149, 0.0, false, NULL, 5.7, NULL, 6.0, 2.0, 4.0, 7.24, NULL),
  (266, '12600002', 2022, 'primeira', DATE '2022-09-28', TIME '07:50', 31.16, 26.36, 8.47, 6.6, 31.16, NULL, 5.0, 0.5, 0.8, 16.0, 0.0211, 0.3, 59.3, 15.0, 0.0, false, NULL, 1.0, NULL, 7.0, 0.0, 5.0, 7.24, NULL),
  (267, '13190000', 2022, 'primeira', DATE '2022-09-28', TIME '07:00', 24.908, 29.739, 8.71, 6.6, 42.34, NULL, 6.0, 3.0, 2.0, 0.16, 0.036, 0.31, 151.3, 0.0612, 0.0, false, NULL, 10.0, NULL, 12.0, 0.1, 7.0, 455.8, NULL),
  (268, '13408000', 2022, 'primeira', DATE '2022-09-28', TIME '08:50', 27.17, 26.7, 8.64, 6.53, 29.86, NULL, 7.0, 2.4, 1.96, 0.02, 0.024, 0.04, 71.12, 0.102, 0.0, false, NULL, 2.0, NULL, 4.0, 0.5, 2.0, 488.2, NULL),
  (269, '13610001', 2022, 'primeira', DATE '2022-10-04', TIME '10:00', 29.789, 30.524, 8.3, 8.05, 38.26, NULL, 6.0, 3.1, 2.0, 0.16, 0.036, 0.31, 151.3, 0.0612, 0.0, false, NULL, 10.0, NULL, 12.0, 0.1, 7.0, 150.2, NULL),
  (270, '13770000', 2022, 'primeira', DATE '2022-01-05', TIME '08:05', 40.78, 25.391, 6.57, 5.88, 40.78, NULL, 5.0, 2.9, 2.1, 0.14, 0.02, 0.1, 8.16, 0.388, 0.0, false, NULL, 4.0, NULL, 11.0, 1.3, 8.0, 23.3, NULL),
  (271, '12369000', 2022, 'primeira', DATE '2026-10-26', TIME '06:00', 26.99, 27.24, 7.63, 5.87, 50.68, NULL, 8.0, 0.89, 0.71, 0.1, 0.0332, 0.0, 118.11, 28.9, 0.0, false, NULL, 12.0, NULL, 15.0, 0.12, 8.0, 132.0, NULL),
  (272, '15324300', 2022, 'primeira', DATE '2022-10-13', TIME '09:25', 25.97, 27.21, 6.61, 6.84, 97.51, NULL, 4.0, 0.8, 0.51, 0.17, 0.098, 0.26, 12.91, 0.281, 0.0, false, NULL, 12.7, NULL, 25.0, 2.12, 14.0, 26.7, NULL),
  (273, '12430000', 2022, 'segunda', DATE '2022-12-13', TIME '08:18', 24.47, 27.64, 6.83, 6.91, 22.55, NULL, 5.0, 2.3, 1.1, 0.06, 0.02, 0.15, 13.5, 0.1026, 0.0, false, NULL, 1.0, NULL, 8.0, 1.3, 3.0, 34.0, NULL),
  (274, '12500004', 2022, 'segunda', DATE '2022-12-13', TIME '09:37', 28.03, 28.4, 7.66, 6.88, 27.35, NULL, 10.0, 4.11, 3.4, 0.12, 0.18, 4.2, 57.1, 0.039, 0.0, false, NULL, 5.1, NULL, 15.0, 1.3, 12.0, 140.8, NULL),
  (275, '12600002', 2022, 'segunda', DATE '2022-12-14', TIME '11:20', 32.85, 30.05, 8.29, 7.95, 35.48, NULL, 4.0, 1.3, 1.6, 0.19, 0.0121, 0.23, 65.5, 0.131, 0.0, false, NULL, 3.0, NULL, 10.0, 0.0, 8.0, 111.9, NULL),
  (276, '12660000', 2022, 'segunda', DATE '2022-12-14', TIME '14:22', 32.12, 29.92, 7.86, 6.9, 54.9, NULL, 6.0, 2.7, 1.3, 0.13, 0.032, 0.17, 59.6, 0.128, 0.0, false, NULL, 2.9, NULL, 16.0, 2.9, 10.0, 176.4, NULL),
  (277, '13190000', 2022, 'segunda', DATE '2022-12-15', TIME '07:20', 26.68, 29.36, 7.7, 6.66, 111.43, NULL, 4.0, 2.2, 1.0, 0.1, 0.031, 0.28, 48.6, 0.0511, 0.0, false, NULL, 3.1, NULL, 10.0, 0.0, 5.0, 133.8, NULL),
  (278, '13408000', 2022, 'segunda', DATE '2022-12-15', TIME '09:17', 28.38, 29.22, 7.42, 6.48, 255.11, NULL, 4.0, 2.1, 1.2, 0.0, 0.018, 0.01, 32.3, 0.1012, 0.0, false, NULL, 1.0, NULL, 2.0, 0.3, 1.0, 23.2, NULL),
  (279, '13770000', 2022, 'segunda', DATE '2022-12-12', TIME '08:50', 26.53, 25.52, 6.0, 4.82, 61.38, NULL, 4.0, 2.5, 1.7, 0.11, 0.02, 0.18, 10.04, 0.51, 0.0, false, NULL, 43.0, NULL, 16.0, 1.1, 13.0, 85.1, NULL),
  (280, '13610001', 2022, 'segunda', DATE '2022-12-13', TIME '08:56', 26.92, 27.54, 6.9, 5.1, 388.65, NULL, 6.0, 2.3, 0.9, 0.22, 1.2, 0.4, 26.1, 0.219, 0.0, false, NULL, 3.4, NULL, 10.0, 23.0, 6.0, 63.8, NULL),
  (281, '15324300', 2022, 'segunda', DATE '2022-12-14', TIME '09:56', 28.11, 26.52, 6.25, 5.95, 104.52, NULL, 6.0, 1.8, 2.18, 0.13, 0.02, 0.08, 11.01, 0.316, 0.0, false, NULL, 51.0, NULL, 12.0, 1.0, 6.0, 27.7, NULL),
  (282, '13550001', 2022, 'segunda', DATE '2022-12-19', TIME '10:11', 27.35, 27.56, 7.37, 6.06, 345.13, NULL, 4.0, 3.0, 1.5, 0.08, 0.024, 0.12, 33.3, 0.314, 0.0, false, NULL, 2.9, NULL, 18.0, 0.9, 10.0, 209.9, NULL),
  (283, '13438000', 2022, 'segunda', DATE '2022-12-20', TIME '06:11', 23.2, 26.18, 7.2, 6.84, 275.72, NULL, 5.0, 2.5, 1.7, 0.11, 0.024, 0.16, 38.9, 0.9031, 0.0, false, NULL, 10.0, NULL, 8.0, 1.5, 6.0, 140.8, NULL),
  (284, '13459000', 2022, 'segunda', DATE '2022-12-20', TIME '08:49', 24.3, 26.71, 7.15, 6.44, 577.11, NULL, 5.0, 4.9, 3.1, 0.11, 0.033, 0.05, 28.9, 0.401, 0.0, false, NULL, 2.0, NULL, 10.0, 2.1, 5.0, 76.3, NULL),
  (285, '13601000', 2022, 'segunda', DATE '2022-12-15', TIME '09:41', 29.05, 28.12, 7.13, 5.82, 351.74, NULL, 6.0, 3.11, 2.0, 0.11, 0.024, 0.04, 24.2, 0.253, 0.0, false, NULL, 2.0, NULL, 2.0, 5.0, 0.03, 66.7, NULL),
  (286, '12389000', 2023, 'primeira', DATE '2023-04-19', TIME '07:15', 26.95, 26.69, 7.57, 4.81, 248.2, NULL, 10.0, 5.11, 4.9, 0.46, 0.039, 1.2, 64.7, 0.213, 21.0, false, NULL, 98.5, NULL, 20.0, 4.7, 12.0, 158.8, NULL),
  (287, '12369000', 2023, 'primeira', DATE '2023-04-21', TIME '07:40', 23.0, 25.89, 7.91, 6.42, 172.63, NULL, 6.0, 3.15, 2.0, 0.19, 0.029, 0.31, 52.1, 0.6024, 0.0, false, NULL, 2.0, NULL, 16.0, 1.9, 10.0, 133.9, NULL),
  (288, '12430000', 2023, 'primeira', DATE '2023-03-23', TIME '15:00', 25.89, 24.85, 6.62, 5.25, 8.24, NULL, 7.0, 3.5, 2.1, 0.12, 0.029, 0.5, 11.68, 0.1019, 4.0, false, NULL, 13.2, NULL, 15.0, 1.5, 8.0, 23.9, NULL),
  (289, '13408000', 2023, 'primeira', DATE '2023-03-31', TIME '08:18', 27.12, 25.59, 6.91, 3.63, 236.1, NULL, 6.0, 3.7, 1.9, 0.1, 0.041, 0.16, 25.6, 0.1015, 0.0, false, NULL, 5.2, NULL, 12.0, 1.0, 5.0, 64.2, NULL),
  (290, '12500004', 2023, 'primeira', DATE '2023-03-24', TIME '14:22', 25.63, 25.23, 7.04, 5.74, 83.01, NULL, 8.0, 3.12, 2.91, 0.14, 0.3, 3.4, 30.1, 0.0371, 6.0, false, NULL, 15.6, NULL, 20.0, 1.8, 10.0, NULL, NULL),
  (291, '13190000', 2023, 'primeira', DATE '2023-03-29', TIME '07:12', 24.56, 25.41, 7.4, 4.72, 241.54, NULL, 6.0, 3.21, 2.13, 0.25, 0.043, 0.9, 41.1, 0.0523, 0.0, false, NULL, 6.0, NULL, 12.0, 0.8, 8.0, 104.6, NULL),
  (292, '13610001', 2023, 'primeira', DATE '2023-03-09', TIME '10:15', 31.33, 27.65, 6.65, 5.89, 126.7, NULL, 8.0, 4.12, 1.4, 0.31, 1.9, 0.6, 18.42, 0.25, 0.0, false, NULL, 1.0, NULL, 15.0, 29.0, 10.0, 42.0, NULL),
  (293, '15324300', 2023, 'primeira', DATE '2023-03-10', TIME '10:24', 27.82, 26.52, 6.24, 5.3, 16.79, NULL, 9.0, 2.19, 3.11, 0.38, 0.05, 0.213, 8.38, 0.36, 0.0, false, NULL, 10.0, NULL, 18.0, 1.9, 10.0, 19.0, NULL),
  (294, '12600002', 2023, 'primeira', DATE '2023-03-27', TIME '16:29', 33.33, 25.53, 7.18, 5.79, 193.55, NULL, 8.0, 2.7, 1.9, 0.25, 0.0132, 0.39, 29.8, 0.144, 0.0, false, NULL, 1.0, NULL, 16.0, 0.5, 6.0, 101.3, NULL),
  (295, '12660000', 2023, 'primeira', DATE '2023-03-28', TIME '16:02', 27.15, 25.58, 7.82, 6.05, 215.47, NULL, 5.0, 3.5, 2.0, 0.23, 0.021, 0.42, 75.9, 0.112, 0.0, false, NULL, 1.0, NULL, 12.0, 2.3, 8.0, 173.0, NULL),
  (296, '1360100', 2023, 'primeira', DATE '2023-03-13', TIME '09:30', 26.82, 25.31, 6.8, 27.0, 72.38, NULL, 7.0, 4.1, 2.9, 0.24, 0.032, 0.1, 16.28, 0.294, 0.0, false, NULL, 17.4, NULL, 9.0, 1.7, 0.08, 41.6, NULL),
  (297, '13770000', 2023, 'primeira', DATE '2023-03-14', TIME '08:26', 29.32, 25.71, 5.34, 3.65, 10.03, NULL, 7.0, 4.1, 2.8, 0.24, 0.04, 0.28, 7.41, 0.491, 0.0, false, NULL, 2.0, NULL, 20.0, 1.5, 15.0, 15.1, NULL),
  (298, '13550001', 2023, 'primeira', DATE '2023-03-17', TIME '07:53', 24.29, 26.89, 7.25, 6.77, 171.63, NULL, 8.0, 3.91, 2.3, 0.19, 0.036, 0.15, 30.8, 0.342, 0.0, false, NULL, 10.0, NULL, 20.0, 1.86, 16.0, 60.8, 207.731),
  (299, '13459000', 2023, 'primeira', DATE '2023-03-16', TIME '07:00', 27.01, 26.61, 7.38, 7.14, 192.13, NULL, 9.0, 5.31, 3.77, 0.17, 0.05, 0.13, 30.1, 0.419, 2.0, false, NULL, 4.0, NULL, 12.0, 2.8, 6.0, 75.2, 82.329),
  (300, '13438000', 2023, 'primeira', DATE '2023-03-15', TIME '07:24', 26.97, 26.61, 7.28, 7.14, 152.5, NULL, 6.0, 2.7, 1.9, 0.2, 0.032, 0.31, 40.6, 0.133, 2.0, false, NULL, 8.0, NULL, 10.0, 0.7, 8.0, 105.2, NULL),
  (301, '13601000', 2023, 'segunda', DATE '2023-06-19', TIME '11:20', 30.78, 23.15, 7.26, 8.5, 33.8, NULL, 5.0, 2.71, 1.4, 0.19, 0.027, 0.11, 40.7, 0.254, 8.3, false, NULL, 23.4, NULL, 6.0, 2.0, 4.0, 94.0, NULL),
  (302, '13610001', 2023, 'segunda', DATE '2023-06-21', TIME '16:00', 30.94, 25.11, 7.47, 8.22, 27.3, NULL, 5.0, 3.18, 1.3, 0.29, 0.07, 0.58, 36.5, 0.189, 17.9, false, NULL, 30.0, NULL, 12.0, 19.0, 8.0, 86.5, NULL),
  (303, '13550001', 2023, 'segunda', DATE '2023-06-22', TIME '11:30', 26.08, 26.12, 7.41, 8.34, 36.2, NULL, 12.0, 4.2, 3.13, 0.31, 0.045, 0.028, 49.9, 0.413, 11.0, false, NULL, 40.1, NULL, 12.0, 2.3, 8.0, 117.0, NULL),
  (304, '13459000', 2023, 'segunda', DATE '2023-06-23', TIME '11:20', 29.7, 25.87, 7.42, 8.44, 21.97, NULL, 6.0, 2.4, 1.8, 0.13, 0.048, 0.1, 50.2, 0.31, 3.0, false, NULL, 7.1, NULL, 15.0, 1.9, 10.0, 107.5, NULL),
  (305, '13488000', 2023, 'segunda', DATE '2023-06-23', TIME '08:10', 26.07, 26.31, 7.09, 8.73, 1.49, NULL, 7.0, 3.4, 2.5, 0.27, 0.039, 0.036, 109.6, 0.151, 7.2, false, NULL, 29.5, NULL, 12.0, 1.1, 5.0, 1.8, NULL),
  (306, '13408000', 2023, 'segunda', DATE '2023-06-16', TIME '10:23', 20.88, 22.36, 7.94, 8.46, 28.42, NULL, 8.0, 3.93, 2.32, 0.14, 0.044, 0.23, 94.8, 0.1021, 3.0, false, NULL, 11.0, NULL, 10.0, 1.8, 7.0, 216.9, NULL),
  (307, '13190000', 2023, 'segunda', DATE '2023-06-16', TIME '08:36', 19.26, 23.4, 8.34, 8.21, 42.1, NULL, 8.0, 3.9, 2.71, 0.3, 0.05, 0.83, 132.2, 0.0632, 6.7, false, NULL, 13.7, NULL, 16.0, 0.5, 10.0, 313.0, NULL),
  (308, '12660000', 2023, 'segunda', DATE '2023-06-12', TIME '11:00', 32.07, 28.65, 7.91, 6.82, 32.57, NULL, 10.0, 4.11, 2.9, 0.38, 0.032, 0.49, 130.4, 0.21, 2.0, false, NULL, 6.3, NULL, 20.0, 2.88, 11.0, 314.3, NULL),
  (309, '12600002', 2023, 'segunda', DATE '2023-06-15', TIME '15:00', 19.48, 22.33, 7.54, 7.27, 111.16, NULL, 16.0, 4.82, 3.11, 0.32, 0.14, 0.45, 68.2, 0.151, 4.0, false, NULL, 7.1, NULL, 19.0, 0.93, 10.0, 185.6, NULL),
  (310, '12500004', 2023, 'segunda', DATE '2023-06-13', TIME '11:45', 29.39, 27.46, 7.18, 6.23, 27.51, NULL, 7.0, 3.11, 1.79, 0.25, 0.28, 2.89, 60.8, 0.0293, 8.4, false, NULL, 20.1, NULL, 28.0, 2.5, 15.0, 138.0, NULL),
  (311, '12430000', 2023, 'segunda', DATE '2023-06-14', TIME '15:00', 17.1, 24.53, 6.57, 5.62, 8.96, NULL, 6.0, 3.97, 2.6, 0.07, 0.031, 0.8, 15.94, 0.1011, 10.3, false, NULL, 35.0, NULL, 12.0, 1.7, 6.0, 35.2, NULL),
  (312, '13770000', 2023, 'segunda', DATE '2023-06-20', TIME '10:00', 24.64, 20.89, 7.14, 8.06, 9.3, NULL, 10.0, 4.89, 3.12, 0.29, 0.0, 0.17, 5.83, 0.383, 3.0, false, NULL, 8.0, NULL, 18.0, 1.3, 11.0, 13.2, NULL),
  (313, '15324300', 2023, 'segunda', DATE '2023-06-21', TIME '10:10', 28.67, 22.38, 6.6, 8.35, 22.98, NULL, 6.0, 3.19, 2.41, 0.16, 0.063, 0.208, 9.15, 0.27, 4.1, false, NULL, 18.8, NULL, 10.0, 1.0, 5.0, 19.7, NULL),
  (314, '13433800', 2023, 'primeira', DATE '2023-09-22', TIME '07:10', 25.99, 27.84, 8.05, 6.61, 30.51, NULL, 5.0, 3.91, 2.11, 0.1, 0.059, 0.08, 126.6, 0.293, 31.0, false, NULL, 866.0, NULL, 10.0, 2.4, 13.0, 324.9, NULL),
  (315, '13459000', 2023, 'primeira', DATE '2023-09-21', TIME '15:30', 29.93, 31.44, 8.7, 7.94, 27.63, NULL, 9.0, 4.8, 3.1, 0.19, 0.081, 0.029, 61.0, 0.138, 274.0, false, NULL, 547.0, NULL, 10.0, 1.5, 8.0, 157.4, 11.954),
  (316, '13550001', 2023, 'primeira', DATE '2023-09-21', TIME '12:20', 29.43, 31.46, 8.2, 7.65, 28.74, NULL, 9.0, 4.78, 3.89, 0.42, 0.06, 0.035, 64.5, 0.59, 410.0, false, NULL, 1732.0, NULL, 25.0, 2.9, 11.0, 153.5, 17.022),
  (317, '13770000', 2023, 'primeira', DATE '2023-09-20', TIME '12:50', 26.44, 27.24, 6.46, 5.82, 45.35, NULL, 8.0, 3.71, 2.49, 0.32, 0.011, 0.22, 8.44, 0.0288, 35.0, false, NULL, 82.0, NULL, 12.0, 1.1, 9.0, 22.2, NULL),
  (318, '13610001', 2023, 'primeira', DATE '2023-09-19', TIME '10:00', 27.57, 30.49, 6.75, 6.75, 23.41, NULL, 6.0, 2.7, 1.9, 0.41, 0.088, 0.72, 54.7, 0.157, 172.0, false, NULL, 396.0, NULL, 25.0, 15.0, 10.0, 140.4, NULL),
  (319, '13601000', 2023, 'primeira', DATE '2023-09-18', TIME '10:14', 33.31, 29.87, 7.91, 5.78, 157.74, NULL, 9.0, 5.21, 3.11, 0.36, 0.069, 0.17, 46.8, 0.348, 51.72, false, NULL, 721.0, NULL, 30.0, 2.1, 20.0, 120.3, NULL),
  (320, '15324300', 2023, 'primeira', DATE '2023-09-20', TIME '10:25', 31.24, 28.84, 7.32, 6.8, 64.63, NULL, 8.0, 3.4, 2.9, 0.18, 0.083, 0.212, 11.78, 0.33, 11.0, false, NULL, 90.0, NULL, 18.0, 1.3, 11.0, 29.9, NULL),
  (321, '13408000', 2023, 'primeira', DATE '2023-09-15', TIME '09:15', 29.39, 33.315, 8.14, 6.67, 3.51, NULL, 6.0, 3.5, 2.0, 0.24, 0.038, 0.77, 184.8, 0.1038, 51.72, false, NULL, 344.0, NULL, 16.0, 2.1, 9.0, 9.0, NULL),
  (322, '13190000', 2023, 'primeira', DATE '2023-09-15', TIME '07:14', 23.627, 29.397, 8.96, 6.46, 7.9, NULL, 7.0, 4.8, 3.5, 0.58, 0.07, 1.31, 159.0, 0.0781, 4.0, false, NULL, 65.0, NULL, 20.0, 0.8, 14.0, 46.73, NULL),
  (323, '12600002', 2023, 'primeira', DATE '2023-09-14', TIME '14:50', 30.038, 32.434, 8.82, 7.424, 30.9, NULL, 7.0, 2.66, 1.9, 0.19, 0.013, 0.25, 121.3, 0.12, 76.0, false, NULL, 1986.0, NULL, 15.0, 0.59, 8.0, 310.6, NULL),
  (324, '12660000', 2023, 'primeira', DATE '2023-09-14', TIME '17:22', 26.44, 30.945, 8.63, 7.6, 12.9, NULL, 6.0, 3.91, 2.3, 0.3, 0.028, 0.38, 156.0, 0.239, 113.7, false, NULL, 2419.0, NULL, 15.0, 2.31, 13.0, 562.0, NULL),
  (325, '12430000', 2023, 'primeira', DATE '2023-09-13', TIME '16:00', 28.56, 31.687, 7.29, 7.12, 49.93, NULL, 8.0, 4.75, 2.93, 0.2, 0.055, 1.0, 23.3, 0.102, 121.0, false, NULL, 332.0, NULL, 20.0, 1.9, 12.0, 56.7, NULL),
  (326, '12500004', 2023, 'primeira', DATE '2023-09-12', TIME '16:00', 29.4, 31.02, 8.31, 7.44, 32.75, NULL, 5.0, 3.99, 2.11, 0.19, 0.37, 2.31, 97.3, 0.32, 432.0, false, NULL, 1290.0, NULL, 35.0, 3.0, 20.0, 247.6, NULL),
  (327, '13438000', 2023, 'segunda', DATE '2023-12-27', TIME '11:56', 26.68, 26.786, 6.82, 4.86, 353.15, NULL, 5.0, 2.51, 1.3, 0.14, 0.024, 0.26, 33.2, 0.114, 140.8, false, NULL, 866.4, NULL, 8.0, 1.1, 5.0, 74.0, NULL),
  (328, '13459000', 2023, 'segunda', DATE '2023-12-27', TIME '09:12', 27.21, 27.21, 7.11, 5.95, 133.36, NULL, 7.0, 3.0, 1.83, 0.52, 0.039, 0.194, 24.1, 0.44, 76.0, false, NULL, 1732.0, NULL, 20.0, 2.4, 15.0, 53.6, NULL),
  (329, '13550001', 2023, 'segunda', DATE '2023-12-26', TIME '13:00', 26.36, 27.91, 6.85, 6.84, 64.84, NULL, 5.0, 3.23, 1.74, 0.25, 0.029, 0.1, 20.11, 0.321, 32.0, false, NULL, 344.8, NULL, 15.0, 2.0, 9.0, 45.1, NULL),
  (330, '13770000', 2023, 'segunda', DATE '2023-12-20', TIME '12:45', 27.4, 27.85, 6.86, 6.48, 65.64, NULL, 6.0, 3.51, 2.4, 0.18, 0.038, 0.3, 11.62, 0.43, 48.7, false, NULL, 109.0, NULL, 10.0, 1.0, 8.0, 21.8, NULL),
  (331, '13610001', 2023, 'segunda', DATE '2023-12-21', TIME '09:50', 27.14, 28.71, 6.82, 4.16, 160.97, NULL, 5.0, 3.25, 1.1, 0.14, 2.0, 0.43, 31.9, 0.192, 5.0, false, NULL, 73.8, NULL, 12.0, 21.0, 8.0, 68.4, NULL),
  (332, '13601000', 2023, 'segunda', DATE '2023-12-20', TIME '10:24', 34.37, 28.84, 7.26, 4.51, 182.01, NULL, 5.0, 3.83, 2.36, 0.2, 3.83, 0.12, 34.1, 0.261, 12.0, false, NULL, 195.0, NULL, 6.0, 1.8, 0.11, 74.7, NULL),
  (333, '15324300', 2023, 'segunda', DATE '2023-12-22', TIME '10:50', 33.61, 29.2, 6.82, 6.84, 30.5, NULL, 7.0, 3.94, 2.6, 0.09, 0.039, 0.1, 12.98, 0.311, 7.4, false, NULL, 62.0, NULL, 10.0, 1.85, 4.0, 28.1, NULL),
  (334, '13408000', 2023, 'segunda', DATE '2023-12-19', TIME '11:00', 27.28, 28.14, 6.96, 3.23, 130.15, NULL, 5.0, 4.15, 2.41, 0.14, 0.05, 0.19, 49.5, 0.1021, 6.1, false, NULL, 80.9, NULL, 20.0, 1.92, 7.0, 111.9, NULL),
  (335, '13190000', 2023, 'segunda', DATE '2023-12-19', TIME '09:58', 31.04, 27.66, 7.12, 4.6, 165.56, NULL, 8.0, 3.89, 250.0, 0.35, 0.061, 1.24, 59.0, 0.053, 1.0, false, NULL, 106.0, NULL, 20.0, 1.0, 11.0, 133.5, NULL),
  (336, '12600002', 2023, 'segunda', DATE '2023-12-18', TIME '10:50', 32.59, 26.21, 7.01, 3.48, 188.83, NULL, 5.0, 2.11, 9.0, 0.53, 3.02, 0.45, 47.7, 0.29, 5.2, false, NULL, 12.0, NULL, 20.0, 0.8, 10.0, 107.4, NULL),
  (337, '12660000', 2023, 'segunda', DATE '2023-12-18', TIME '13:10', 31.87, 26.58, 7.22, 4.65, 151.56, NULL, 6.0, 4.1, 2.39, 0.4, 0.07, 0.62, 49.9, 0.131, 42.1, false, NULL, 143.0, NULL, 16.0, 2.1, 10.0, 113.5, NULL),
  (338, '12430000', 2023, 'segunda', DATE '2023-12-15', TIME '14:29', 27.61, 28.07, 6.53, 4.86, 48.57, NULL, 5.0, 2.19, 1.4, 0.17, 0.018, 0.31, 14.93, 0.11, 4.1, false, NULL, 106.3, NULL, 12.0, 1.18, 12.0, 32.2, NULL),
  (339, '12500004', 2023, 'segunda', DATE '2023-12-15', TIME '15:30', 28.41, 28.16, 7.05, 4.91, 64.7, NULL, 6.0, 3.99, 2.12, 0.13, 0.24, 2.8, 33.11, 0.0229, 3.0, false, NULL, 10.2, NULL, 15.0, 1.3, 6.0, 72.1, NULL),
  (340, '13438000', 2024, 'primeira', DATE '2024-03-26', TIME '09:20', 26.55, 27.79, 7.2, 6.13, 482.45, NULL, 7.0, 3.9, 2.0, 0.21, 0.035, 0.33, 59.0, 0.14, 98.5, false, NULL, 325.0, NULL, 13.0, 1.6, 8.0, 107.9, NULL),
  (341, '13459000', 2024, 'primeira', DATE '2024-03-26', TIME '12:00', 28.96, 28.96, 7.72, 6.19, 301.28, NULL, 6.0, 2.85, 1.3, 0.77, 0.042, 0.139, 73.7, 0.32, 57.0, false, NULL, 686.0, NULL, 25.0, 2.9, 10.0, 148.2, NULL),
  (342, '13550001', 2024, 'primeira', DATE '2024-03-27', TIME '10:50', 35.46, 28.74, 8.17, 6.32, 201.44, NULL, 8.0, 4.92, 2.34, 0.23, 0.037, 0.18, 47.3, 0.43, 26.0, false, NULL, 214.0, NULL, 20.0, 2.8, 16.0, 120.3, NULL),
  (343, '13770000', 2024, 'primeira', DATE '2024-03-20', TIME '10:30', 33.92, 26.88, 6.44, 3.6, 32.6, NULL, 5.0, 4.0, 2.1, 0.11, 0.03, 0.35, 8.83, 0.381, 33.0, false, NULL, 99.0, NULL, 15.0, 0.81, 6.0, 18.1, NULL),
  (344, '13610001', 2024, 'primeira', DATE '2024-03-21', TIME '09:59', 27.21, 28.95, 7.06, 4.78, 317.62, NULL, 7.0, 3.83, 1.9, 0.1, 1.5, 0.38, 26.1, 0.177, 10.0, false, NULL, 55.0, NULL, 16.0, 18.0, 10.0, 57.1, NULL),
  (345, '13601000', 2024, 'primeira', DATE '2024-03-23', TIME '09:45', 26.77, 28.18, 6.86, 5.56, 195.68, NULL, 8.0, 4.5, 3.1, 0.27, 0.034, 0.19, 31.7, 0.293, 9.0, false, NULL, 98.0, NULL, 12.0, 2.5, 1.0, 67.0, NULL),
  (346, '15324300', 2024, 'primeira', DATE '2024-03-22', TIME '10:30', 33.21, 27.71, 6.06, 3.04, 27.91, NULL, 5.0, 3.3, 2.19, 0.13, 0.02, 0.17, 13.59, 0.271, 8.0, false, NULL, 59.1, NULL, 7.0, 2.1, 5.0, 29.2, NULL),
  (347, '13408000', 2024, 'primeira', DATE '2024-04-16', TIME '10:40', 29.23, 30.03, 7.81, 6.33, 111.86, NULL, 8.0, 4.3, 2.91, 0.2, 0.07, 0.38, 65.9, 0.1053, 5.0, false, NULL, 45.0, NULL, 24.0, 2.4, 9.0, 115.2, NULL),
  (348, '13190000', 2024, 'primeira', DATE '2024-04-16', TIME '08:10', 26.39, 30.16, 8.15, 6.55, 87.22, NULL, 6.0, 3.93, 2.3, 0.53, 0.71, 1.52, 138.6, 0.49, 6.3, false, NULL, 86.7, NULL, 25.0, 1.66, 18.0, 254.4, NULL),
  (349, '12600002', 2024, 'primeira', DATE '2024-04-12', TIME '16:30', 30.77, 30.21, 8.11, 6.81, 78.04, NULL, 6.0, 5.31, 3.1, 0.39, 0.025, 0.43, 124.5, 0.131, 11.5, false, NULL, 88.0, NULL, 23.0, 2.86, 10.0, 234.9, NULL),
  (350, '12660000', 2024, 'primeira', DATE '2024-04-15', TIME '12:30', 28.22, 29.8, 8.13, 6.6, 61.34, NULL, 5.0, 5.0, 3.11, 0.83, 0.09, 0.101, 135.2, 0.159, 52.0, false, NULL, 195.0, NULL, 20.0, 3.0, 15.0, 252.2, NULL),
  (351, '12430000', 2024, 'primeira', DATE '2024-04-09', TIME '14:00', 34.14, 26.35, 7.06, 3.76, 20.37, NULL, 7.0, 3.5, 2.14, 0.22, 0.021, 0.3, 33.1, 0.115, 7.3, false, NULL, 95.0, NULL, 16.0, 1.6, 8.0, 24.0, NULL),
  (352, '12500004', 2024, 'primeira', DATE '2024-04-09', TIME '15:10', 27.58, 26.54, 7.12, 3.79, 163.96, NULL, 5.0, 3.19, 1.31, 0.09, 0.29, 2.21, 28.8, 0.0311, 5.0, false, NULL, 12.0, NULL, 10.0, 1.7, 5.0, 52.2, NULL),
  (353, '13438000', 2024, 'segunda', DATE '2024-06-25', TIME '07:10', 21.85, 26.31, 7.43, 7.26, 26.56, NULL, 9.0, 4.33, 2.93, 0.19, 0.029, 0.38, 117.0, 0.137, 54.0, false, NULL, 195.0, NULL, 15.0, 1.0, 6.0, 428.1, NULL),
  (354, '13459000', 2024, 'segunda', DATE '2024-06-25', TIME '10:30', 27.18, 28.2, 7.66, 8.13, 37.76, NULL, 5.0, 2.61, 1.5, 0.61, 0.037, 0.12, 94.7, 0.292, 50.0, false, NULL, 287.0, NULL, 30.0, 3.4, 12.0, 156.7, NULL),
  (355, '13550001', 2024, 'segunda', DATE '2024-06-26', TIME '10:25', 29.84, 27.74, 7.3, 7.7, 48.19, NULL, 7.0, 5.0, 3.0, 0.3, 0.04, 21.0, 72.2, 0.321, 30.0, false, NULL, 183.0, NULL, 25.0, 2.0, 13.0, 67.0, NULL),
  (356, '13770000', 2024, 'segunda', DATE '2024-06-20', TIME '13:10', 29.34, 25.38, 6.77, 6.67, 55.55, NULL, 7.0, 3.8, 1.71, 0.16, 0.033, 0.24, 11.1, 0.27, 27.0, false, NULL, 85.0, NULL, 10.0, 0.5, 4.0, 18.8, NULL),
  (357, '13610001', 2024, 'segunda', DATE '2024-06-22', TIME '09:30', 27.53, 29.37, 7.49, 7.43, 54.83, NULL, 6.0, 3.92, 2.1, 0.13, 1.77, 0.4, 68.5, 0.139, 8.0, false, NULL, 48.1, NULL, 20.0, 16.0, 8.0, 124.4, NULL),
  (358, '13601000', 2024, 'segunda', DATE '2024-06-20', TIME '10:10', 28.41, 29.46, 6.7, 6.67, 74.44, NULL, 6.0, 4.11, 2.9, 0.3, 0.029, 0.21, 79.7, 0.31, 6.0, false, NULL, 71.2, NULL, 20.0, 2.12, 0.87, 141.2, NULL),
  (359, '15324300', 2024, 'segunda', DATE '2024-06-21', TIME '09:30', 28.18, 27.82, 6.35, 7.17, 85.82, NULL, 7.0, 4.11, 2.9, 0.19, 0.028, 0.23, 15.1, 0.291, 5.0, false, NULL, 45.0, NULL, 11.0, 1.89, 3.0, 28.4, NULL),
  (360, '13408000', 2024, 'segunda', DATE '2024-07-02', TIME '13:30', 28.83, 28.25, 8.66, 9.35, 21.54, NULL, 6.0, 3.8, 2.4, 0.17, 0.05, 0.35, 149.0, 0.533, 9.0, false, NULL, 51.0, NULL, 22.0, 1.8, 7.0, 451.3, NULL),
  (361, '13190000', 2024, 'segunda', DATE '2024-07-02', TIME '10:30', 21.84, 26.99, 8.1, 8.0, 29.46, NULL, 5.0, 3.4, 2.5, 0.48, 0.51, 0.62, 154.8, 0.43, 8.0, false, NULL, 98.0, NULL, 20.0, 1.32, 10.0, 462.6, NULL),
  (362, '12600002', 2024, 'segunda', DATE '2024-06-28', TIME '15:30', 31.43, 31.43, 7.9, 7.74, 36.9, NULL, 8.0, 5.5, 3.87, 0.33, 0.032, 0.48, 195.0, 0.124, 7.0, false, NULL, 74.0, NULL, 20.0, 2.3, 8.0, 352.2, NULL),
  (363, '12660000', 2024, 'segunda', DATE '2024-06-28', TIME '14:20', 33.11, 30.92, 8.61, 7.65, 27.71, NULL, 10.0, 5.41, 3.93, 0.7, 0.072, 0.11, 129.0, 0.147, 48.0, false, NULL, 165.0, NULL, 30.0, 2.51, 17.0, 549.0, NULL),
  (364, '12430000', 2024, 'segunda', DATE '2024-07-01', TIME '15:00', 24.81, 27.7, 6.26, 6.79, 56.79, NULL, 5.0, 3.9, 2.0, 0.24, 0.029, 0.33, 37.4, 0.12, 8.0, false, NULL, 83.6, NULL, 12.0, 1.13, 6.0, 61.3, NULL),
  (365, '12500004', 2024, 'segunda', DATE '2024-07-01', TIME '15:45', 22.49, 28.22, 7.05, 6.96, 48.48, NULL, 6.0, 3.14, 1.7, 0.1, 0.031, 1.7, 134.2, 0.321, 3.0, false, NULL, 41.0, NULL, 14.0, 1.21, 6.0, 236.8, NULL),
  (366, '13438000', 2024, 'primeira', DATE '2024-09-20', TIME '13:45', 33.4, 28.29, 8.33, 8.02, 10.72, NULL, 10.0, 5.11, 3.9, 0.28, 0.035, 0.43, 160.7, 0.141, 85.0, false, NULL, 1299.0, NULL, 30.0, 1.3, 10.0, 4.3, NULL),
  (367, '13459000', 2024, 'primeira', DATE '2024-09-21', TIME '06:30', 25.7, 28.91, 9.84, 6.68, 35.67, NULL, 7.0, 5.11, 3.7, 0.97, 0.041, 0.151, 87.7, 0.321, 51.0, false, NULL, 325.5, NULL, 70.0, 3.9, 16.0, 182.7, NULL),
  (368, '13550001', 2024, 'primeira', DATE '2024-09-20', TIME '09:00', 25.71, 28.59, 10.37, 7.97, 54.43, NULL, 12.0, 6.18, 4.35, 0.27, 0.074, 0.24, 89.3, 0.399, 44.0, false, NULL, 648.0, NULL, 50.0, 2.5, 18.0, 188.7, NULL),
  (369, '13770000', 2024, 'primeira', DATE '2024-10-02', TIME '12:30', 27.49, 26.98, 13.29, 5.8, 51.81, NULL, 9.0, 4.32, 2.9, 0.21, 0.045, 0.31, 19.39, 0.238, 259.0, false, NULL, 1290.0, NULL, 30.0, 0.9, 6.0, 30.8, NULL),
  (370, '13610001', 2024, 'primeira', DATE '2024-10-01', TIME '09:00', 30.02, 29.11, 12.5, 6.88, 32.08, NULL, 8.0, 5.2, 3.11, 0.19, 0.092, 0.53, 83.7, 0.158, 56.0, false, NULL, 980.0, NULL, 40.0, 4.0, 10.0, 165.5, NULL),
  (371, '13601000', 2024, 'primeira', DATE '2024-09-30', TIME '09:40', 24.71, 28.31, 16.36, 5.98, 62.56, NULL, 8.0, 5.6, 3.8, 0.43, 0.051, 0.35, 96.8, 0.372, 241.0, false, NULL, 816.0, NULL, 30.0, 2.3, 10.0, 186.1, NULL),
  (372, '15324300', 2024, 'primeira', DATE '2024-09-19', TIME '11:47', 29.71, 28.76, 9.4, 8.1, 48.25, NULL, 9.0, 5.3, 3.8, 0.29, 0.039, 0.7, 18.6, 0.312, 32.0, false, NULL, 122.0, NULL, 16.0, 2.16, 5.0, 35.4, NULL),
  (373, '13408000', 2024, 'primeira', DATE '2024-09-27', TIME '08:37', 24.14, 29.08, 12.3, 6.21, 48.79, NULL, 10.0, 5.71, 3.9, 0.35, 0.062, 0.42, 241.0, 0.612, 59.0, false, NULL, 467.0, NULL, 60.0, 1.4, 11.0, 507.0, NULL),
  (374, '13190000', 2024, 'primeira', DATE '2024-09-27', TIME '07:00', 25.02, 29.18, 14.39, 6.72, 61.82, NULL, 13.0, 7.1, 5.11, 0.82, 0.72, 0.71, 277.0, 0.521, 39.0, false, NULL, 490.0, NULL, 80.0, 3.0, 12.0, 467.7, NULL),
  (375, '12600002', 2024, 'primeira', DATE '2024-09-25', TIME '13:50', 27.57, 32.79, 14.74, 8.3, 59.44, NULL, 15.0, 6.1, 4.9, 0.56, 0.071, 0.61, 66.8, 0.154, 63.0, false, NULL, 770.0, NULL, 80.0, 2.9, 10.0, 357.2, NULL),
  (376, '12660000', 2024, 'primeira', DATE '2024-09-26', TIME '13:30', 29.32, 31.75, 11.26, 7.52, 66.31, NULL, 16.0, 6.51, 4.8, 0.68, 0.092, 0.121, 257.0, 0.212, 123.0, false, NULL, 616.7, NULL, 90.0, 2.9, 20.0, 559.0, NULL),
  (377, '12430000', 2024, 'primeira', DATE '2024-09-24', TIME '14:15', 27.37, 32.74, 12.52, 8.73, 53.39, NULL, 10.0, 3.81, 2.9, 0.41, 0.035, 0.39, 33.4, 0.13, 95.0, false, NULL, 920.0, NULL, 60.0, 1.2, 8.0, 65.1, NULL),
  (378, '12500004', 2024, 'primeira', DATE '2024-09-23', TIME '15:20', 30.52, 31.17, 10.41, 7.09, 53.7, NULL, 11.0, 6.1, 4.12, 0.44, 0.033, 0.55, 120.5, 0.213, 70.0, false, NULL, 1203.0, NULL, 150.0, 3.9, 12.0, 259.3, NULL),
  (379, '13438000', 2025, 'primeira', DATE '2025-04-04', TIME '09:20', 25.81, 26.66, 6.74, 8.08, 870.61, NULL, 8.0, 4.4, 2.5, 1.6, 0.033, 2.13, 3.0, 0.459, 579.0, false, NULL, 1732.0, NULL, 23.0, 1.9, 12.0, 126.7, NULL),
  (380, '13459000', 2025, 'primeira', DATE '2025-04-03', TIME '12:30', 25.98, 26.55, 6.67, 7.06, 602.72, NULL, 7.0, 3.9, 2.5, 1.0, 0.034, 2.11, 46.8, 0.592, 648.0, false, NULL, 1553.0, NULL, 40.0, 2.18, 11.0, 99.3, NULL),
  (381, '13550001', 2025, 'primeira', DATE '2025-04-04', TIME '13:30', 26.28, 27.13, 6.68, 7.26, 541.44, NULL, 10.0, 4.92, 3.2, 1.9, 0.066, 1.0, 37.3, 0.494, 84.4, false, NULL, 770.0, NULL, 20.0, 1.5, 10.0, 94.1, NULL),
  (382, '13770000', 2025, 'primeira', DATE '2025-04-02', TIME '13:00', 26.8, 25.84, 5.5, 5.14, 26.58, NULL, 8.0, 3.9, 2.4, 1.1, 0.0354, 0.91, 9.33, 0.401, 55.0, false, NULL, 313.0, NULL, 6.0, 1.4, 4.0, 19.6, NULL),
  (383, '13610001', 2025, 'primeira', DATE '2025-04-01', TIME '09:50', 28.03, 27.6, 6.5, 6.04, 252.36, NULL, 5.0, 4.3, 2.1, 1.3, 0.069, 1.0, 24.8, 0.411, 10.0, false, NULL, 436.0, NULL, 12.0, 2.11, 8.0, 50.9, NULL),
  (384, '13601000', 2025, 'primeira', DATE '2025-03-31', TIME '16:30', 25.92, 27.24, 5.79, 5.96, 228.31, NULL, 12.0, 4.4, 3.5, 1.8, 0.036, 1.7, 26.1, 0.531, 12.0, false, NULL, 85.0, NULL, 8.0, 1.83, 6.0, 53.0, NULL),
  (385, '15324300', 2025, 'primeira', DATE '2025-04-02', TIME '10:00', 25.83, 26.35, 5.2, 5.15, 34.43, NULL, 5.0, 4.5, 3.3, 1.5, 0.036, 1.1, 10.2, 0.36, 49.0, false, NULL, 631.0, NULL, 10.0, 1.77, 7.0, 19.7, NULL),
  (386, '13408000', 2025, 'primeira', DATE '2025-03-27', TIME '07:50', 25.51, 27.72, 6.42, 6.29, 730.54, NULL, 12.0, 3.72, 1.29, 2.0, 0.056, 1.36, 39.5, 0.556, 88.0, false, NULL, 343.3, NULL, 50.0, 1.4, 10.0, 79.6, NULL),
  (387, '13190000', 2025, 'primeira', DATE '2025-03-26', TIME '16:00', 27.01, 27.89, 6.66, 6.71, 630.4, NULL, 6.0, 4.2, 3.1, 1.2, 0.0342, 1.3, 69.9, 0.363, 3.0, false, NULL, 135.0, NULL, 60.0, 3.11, 9.0, 147.1, NULL),
  (388, '12600002', 2025, 'primeira', DATE '2025-03-24', TIME '16:00', 27.85, 27.91, 6.89, 6.89, 467.6, NULL, 7.0, 4.15, 2.2, 1.7, 0.056, 0.82, 66.9, 0.295, 80.0, false, NULL, 590.0, NULL, 64.0, 2.21, 6.0, 140.3, NULL),
  (389, '12660000', 2025, 'primeira', DATE '2025-03-25', TIME '16:50', 30.66, 27.66, 6.77, 6.95, 384.4, NULL, 14.0, 3.82, 1.8, 1.3, 0.0431, 1.8, 82.4, 0.576, 7.0, false, NULL, 153.0, NULL, 75.0, 3.0, 16.0, 167.3, NULL),
  (390, '12430000', 2025, 'primeira', DATE '2025-03-18', TIME '13:30', 28.43, 25.0, 5.35, 3.39, 9.73, NULL, 6.0, 2.01, 1.6, 1.3, 0.04, 0.9, 12.9, 0.24, 16.9, false, NULL, 139.6, NULL, 20.0, 0.9, 8.0, 20.6, NULL),
  (391, '12500004', 2025, 'primeira', DATE '2025-03-19', TIME '16:52', 24.79, 25.7, 6.1, 4.34, 521.88, NULL, 8.0, 5.2, 3.9, 2.1, 0.041, 0.7, 39.5, 0.821, 160.0, false, NULL, 1980.0, NULL, 33.0, 2.3, 9.0, 82.8, NULL),
  (392, '12389000', 2025, 'primeira', DATE '2025-03-21', TIME '16:14', 24.15, 25.75, 5.79, 5.24, 452.41, NULL, 12.0, 3.1, 1.9, 0.9, 0.031, 1.5, 48.7, 0.337, 6.0, false, NULL, 63.0, NULL, 41.0, 3.7, 10.0, 101.5, NULL),
  (393, '12369000', 2025, 'primeira', DATE '2025-03-21', TIME '05:30', 24.17, 26.08, 6.33, 6.61, 553.04, NULL, 5.0, 2.9, 1.8, 0.6, 0.03, 0.8, 63.8, 0.432, 38.0, false, NULL, 960.0, NULL, 69.0, 1.4, 18.0, 132.2, NULL),
  (394, '13438000', 2025, 'segunda', DATE '2025-06-20', TIME '07:30', 23.61, 27.22, 7.63, 7.09, 43.1, NULL, 6.0, 4.6, 2.9, 1.83, 0.027, 3.2, 138.5, 0.611, 330.0, false, NULL, 920.0, NULL, 30.0, 2.8, 8.0, 216.5, NULL),
  (395, '13459000', 2025, 'segunda', DATE '2025-06-19', TIME '13:00', 34.13, 27.41, 7.54, 7.88, 37.86, NULL, 5.0, 4.21, 1.95, 1.89, 0.028, 3.17, 55.5, 0.383, 284.0, false, NULL, 770.0, NULL, 30.0, 1.95, 10.0, 83.2, NULL),
  (396, '13550001', 2025, 'segunda', DATE '2025-06-19', TIME '10:00', 29.79, 27.16, 7.16, 7.33, 48.2, NULL, 12.0, 4.62, 2.81, 1.5, 0.072, 1.17, 49.1, 0.349, 63.0, false, NULL, 547.0, NULL, 28.0, 1.3, 13.0, 73.8, NULL),
  (397, '13770000', 2025, 'segunda', DATE '2025-06-18', TIME '08:40', 25.4, 23.86, 6.11, 6.93, 56.63, NULL, 5.0, 3.11, 1.9, 1.21, 0.025, 0.4, 7.46, 0.309, 87.0, false, NULL, 420.0, NULL, 10.0, 2.16, 6.0, 11.5, NULL),
  (398, '13610001', 2025, 'segunda', DATE '2025-06-16', TIME '10:45', 26.48, 26.52, 7.09, 7.5, 55.1, NULL, 5.0, 5.1, 2.99, 1.18, 0.073, 1.11, 44.6, 0.371, 18.0, false, NULL, 250.0, NULL, 16.0, 2.5, 10.0, 69.1, NULL),
  (399, '13601000', 2025, 'segunda', DATE '2025-06-15', TIME '11:00', 26.7, 26.23, 7.06, 7.46, 74.21, NULL, 6.0, 3.8, 2.91, 1.6, 0.027, 1.8, 45.2, 0.429, 10.0, false, NULL, 66.0, NULL, 6.0, 1.42, 4.0, 72.1, NULL),
  (400, '15324300', 2025, 'segunda', DATE '2025-06-18', TIME '11:37', 30.13, 24.8, 6.34, 7.42, 85.52, NULL, 6.0, 4.7, 2.3, 1.18, 0.025, 0.9, 11.9, 0.33, 25.0, false, NULL, 372.0, NULL, 8.0, 1.17, 5.0, 14.3, NULL),
  (401, '13408000', 2025, 'segunda', DATE '2025-06-19', TIME '10:29', 25.95, 28.83, 7.5, 6.8, 35.87, NULL, 10.0, 4.1, 2.17, 1.39, 0.049, 2.0, 99.5, 0.395, 61.0, false, NULL, 290.0, NULL, 30.0, 1.8, 8.0, 214.2, NULL),
  (402, '13190000', 2025, 'segunda', DATE '2025-06-19', TIME '07:50', 26.04, 28.07, 7.85, 7.22, 113.26, NULL, 8.0, 4.1, 2.91, 1.0, 0.0285, 1.5, 140.2, 0.298, 14.0, false, NULL, 116.0, NULL, 40.0, 2.24, 12.0, 311.4, NULL),
  (403, '12600002', 2025, 'segunda', DATE '2025-06-17', TIME '14:45', 24.74, 28.36, 7.55, 7.19, 161.88, NULL, 5.0, 3.89, 2.0, 1.4, 0.048, 1.31, 121.6, 0.32, 110.0, false, NULL, 416.0, NULL, 50.0, 2.7, 8.0, 284.4, NULL),
  (404, '12660000', 2025, 'segunda', DATE '2025-06-18', TIME '15:30', 26.93, 28.18, 7.56, 6.84, 128.75, NULL, 10.0, 4.17, 2.11, 1.71, 0.0391, 2.12, 158.4, 0.61, 13.0, false, NULL, 190.0, NULL, 52.0, 2.61, 19.0, 316.0, NULL),
  (405, '12430000', 2025, 'segunda', DATE '2025-06-16', TIME '15:56', 24.62, 24.84, 5.48, 5.72, 35.46, NULL, 8.0, 3.95, 2.4, 1.7, 0.038, 0.5, 14.11, 0.198, 21.0, false, NULL, 210.0, NULL, 28.0, NULL, 10.0, 26.7, NULL),
  (406, '12500004', 2025, 'segunda', DATE '2025-06-16', TIME '15:10', 24.16, 25.55, 6.3, 6.26, 90.35, NULL, 7.0, 4.19, 2.13, 1.0, 0.032, 1.3, 41.8, 0.293, 63.0, false, NULL, 692.0, NULL, 30.0, 1.9, 14.0, 85.7, NULL),
  (407, '13438000', 2025, 'primeira', DATE '2025-09-18', TIME '17:00', 24.3, 32.31, 7.55, 8.04, 30.9, NULL, 6.0, 3.87, 2.3, 0.11, 0.04, 0.16, 161.3, 0.324, 8.0, false, NULL, 26.0, NULL, 9.0, 0.9, 5.0, 292.3, NULL),
  (408, '13459000', 2025, 'primeira', DATE '2025-09-19', TIME '08:20', 27.24, 29.04, 7.64, 7.54, 82.78, NULL, 5.0, 5.1, 4.12, 0.13, 0.03, 0.09, 99.5, 0.291, 5.0, false, NULL, 18.0, NULL, 6.0, 1.3, 4.0, 163.2, NULL),
  (409, '13550001', 2025, 'primeira', DATE '2025-09-18', TIME '13:00', 28.66, 30.98, 7.59, 8.42, 28.74, NULL, 7.0, 3.9, 2.18, 0.1, 0.038, 0.11, 74.7, 0.257, 4.0, false, NULL, 12.0, NULL, 8.0, 1.7, 5.0, 127.2, NULL),
  (410, '13770000', 2025, 'primeira', DATE '2025-09-15', TIME '12:00', 27.18, 25.93, 5.93, 6.66, 58.54, NULL, 6.0, 3.0, 2.0, 0.1, 0.023, 0.08, 13.3, 0.297, 8.0, false, NULL, 11.0, NULL, 9.0, 1.0, 6.0, 23.5, NULL),
  (411, '13610001', 2025, 'primeira', DATE '2025-09-16', TIME '09:30', 27.32, 25.33, 5.4, 8.9, 23.91, NULL, 7.0, 4.11, 2.7, 0.19, 0.042, 0.592, 81.1, 0.038, 12.0, false, NULL, 20.0, NULL, 10.0, 0.9, 8.0, 3.3, NULL),
  (412, '13601000', 2025, 'primeira', DATE '2025-09-16', TIME '12:25', 32.01, 30.34, 7.31, 6.92, 157.74, NULL, 6.0, 3.0, 2.1, 0.11, 0.02, 0.07, 72.5, 0.24, 5.0, false, NULL, 11.0, NULL, 8.0, 1.17, 5.0, 141.0, NULL),
  (413, '15324300', 2025, 'primeira', DATE '2025-09-17', TIME '14:40', 28.24, 29.56, 6.66, 7.65, 64.85, NULL, 5.0, 2.12, 1.0, 0.2, 0.011, 0.31, 20.9, 0.299, 6.0, false, NULL, 19.0, NULL, 20.0, 1.5, 10.0, 29.4, NULL),
  (414, '13408000', 2025, 'primeira', DATE '2025-09-26', TIME '17:10', 24.04, 29.68, 8.04, 8.46, 78.99, NULL, 6.0, 4.3, 3.0, 0.09, 0.03, 0.13, 234.0, 0.235, 8.0, false, NULL, 25.3, NULL, 10.0, 1.3, 6.0, 415.8, NULL),
  (415, '13190000', 2025, 'primeira', DATE '2025-09-26', TIME '15:00', 26.59, 29.32, 8.13, 7.73, 44.34, NULL, 8.0, 3.11, 2.24, 0.13, 0.049, 0.44, 245.0, 0.053, 5.0, false, NULL, 19.0, NULL, 11.0, 0.7, 6.0, 433.9, NULL),
  (416, '12600002', 2025, 'primeira', DATE '2025-09-25', TIME '15:00', 24.03, 28.35, 7.74, 7.7, 31.45, NULL, 6.0, 0.8, 1.0, 0.2, 0.0216, 0.1, 134.0, 0.224, 12.0, false, NULL, 28.0, NULL, 11.0, 2.9, 7.0, 229.8, NULL),
  (417, '12660000', 2025, 'primeira', DATE '2025-09-25', TIME '16:15', 25.07, 27.76, 7.53, 6.68, 32.16, NULL, 7.0, 2.8, 1.9, 0.18, 0.29, 0.21, 183.2, 0.151, 8.9, false, NULL, 21.0, NULL, 10.0, 1.13, 6.0, 327.3, NULL),
  (418, '12430000', 2025, 'primeira', DATE '2025-09-24', TIME '15:00', 23.59, 28.6, 6.76, 7.06, 61.47, NULL, 5.0, 2.5, 1.81, 0.07, 0.022, 2.3, 33.8, 0.021, 5.0, false, NULL, 20.0, NULL, 10.0, 0.8, 6.0, 42.5, NULL),
  (419, '12500004', 2025, 'primeira', DATE '2025-09-23', TIME '16:40', 25.47, 30.39, 7.37, 7.02, 52.4, NULL, 6.0, 2.4, 1.5, 0.12, 0.1, 3.5, 89.4, 0.11, 3.0, false, NULL, 7.0, NULL, 10.0, 1.0, 7.0, 150.3, NULL),
  (420, '13169900', 2025, 'primeira', DATE '2025-09-24', TIME '06:45', 28.05, 22.53, 6.5, 8.82, 11.53, NULL, 8.0, 3.17, 1.81, 0.17, 0.028, 1.1, 214.0, 0.039, 5.9, false, NULL, 17.0, NULL, 8.0, 0.8, 5.0, 13.4, NULL),
  (421, '12369000', 2025, 'primeira', DATE '2025-10-03', TIME '08:10', 25.27, 24.9, 7.76, 8.19, 50.2, NULL, 5.0, 2.5, 1.8, 0.17, 0.039, 0.09, 108.2, 0.089, 10.0, false, NULL, 30.7, NULL, 6.0, 0.9, 4.0, 8.9, NULL),
  (422, '12389000', 2025, 'primeira', DATE '2025-10-01', TIME '06:50', 29.06, 24.7, 7.36, 8.56, 38.79, NULL, 5.0, 2.9, 1.1, 0.16, 0.023, 0.09, 108.2, 0.029, 15.0, false, NULL, 90.0, NULL, 8.0, 0.8, 4.0, 6.6, NULL),
  (423, '12557000', 2025, 'primeira', DATE '2025-10-16', TIME '08:12', 26.44, 26.33, 7.36, 8.09, 16.4, NULL, 7.0, 2.91, 1.5, 0.25, 0.021, 0.13, 181.5, 0.039, 20.0, false, NULL, 80.0, NULL, 11.0, 1.3, 6.0, 3.9, NULL),
  (424, '13438000', 2025, 'segunda', DATE '2025-12-22', TIME '14:30', 26.98, 29.64, 6.98, 7.02, 314.43, NULL, 5.0, 3.17, 1.84, 0.9, 0.039, 0.16, 62.1, 0.1248, 36.0, false, NULL, 410.0, NULL, 10.0, 1.4, 6.0, 137.9, NULL),
  (425, '13459000', 2025, 'segunda', DATE '2025-12-23', TIME '06:30', 23.92, 27.2, 6.8, 7.17, 355.23, NULL, 7.0, 3.77, 2.98, 1.18, 0.025, 0.12, 36.3, 0.1057, 5.0, false, NULL, 24.0, NULL, 12.0, 1.51, 4.0, 72.5, NULL),
  (426, '13550001', 2025, 'segunda', DATE '2025-12-23', TIME '08:00', 25.9, 25.97, 6.76, 7.2, 204.98, NULL, 6.0, 4.11, 26.6, 0.8, 0.03, 0.09, 28.8, 0.09908, 2.0, false, NULL, 11.0, NULL, 16.0, 1.3, 8.0, 52.7, NULL),
  (427, '13770000', 2025, 'segunda', DATE '2025-12-09', TIME '10:47', 25.95, 24.73, 5.73, 5.69, 63.51, NULL, 5.0, 3.9, 2.18, 0.1, 0.03, 0.09, 14.95, 0.334, 133.0, false, NULL, 513.0, NULL, 8.0, 0.8, 6.0, 24.6, NULL),
  (428, '13610001', 2025, 'segunda', DATE '2025-12-08', TIME '11:00', NULL, NULL, NULL, NULL, NULL, NULL, 5.0, 3.16, 1.9, 1.0, 0.039, 0.1, 31.6, 0.585, 13.0, false, NULL, 146.0, NULL, 12.0, 1.2, 8.0, NULL, NULL),
  (429, '13601000', 2025, 'segunda', DATE '2025-12-12', TIME '07:00', 25.71, 25.71, 6.51, 5.59, 266.87, NULL, 7.0, 4.11, 2.5, 0.19, 0.024, 0.24, 26.2, 0.178, 9.0, false, NULL, 148.0, NULL, 16.0, 1.4, 8.0, 54.5, NULL),
  (430, '15324300', 2025, 'segunda', DATE '2025-12-09', TIME '08:10', 25.04, 25.13, 5.99, 6.49, 67.51, NULL, 6.0, 1.8, 0.9, 0.6, 0.019, 0.05, 12.5, 0.015, 4.0, false, NULL, 11.0, NULL, 6.0, 1.18, 4.0, 24.7, NULL),
  (431, '13408000', 2025, 'segunda', DATE '2025-12-18', TIME '09:45', 24.9, 26.23, 6.62, 5.24, 212.07, NULL, 5.0, 3.99, 2.11, 1.0, 0.028, 0.05, 44.7, 0.0459, 129.0, false, NULL, 356.0, NULL, 10.0, 1.17, 6.0, 91.6, NULL),
  (432, '13190000', 2025, 'segunda', DATE '2025-02-18', TIME '07:50', 23.66, 26.32, 6.85, 6.31, 165.64, NULL, 6.0, 4.12, 2.49, 0.11, 0.038, 2.0, 67.8, 0.01467, 186.0, false, NULL, 870.0, NULL, 12.0, 0.9, 8.0, 143.0, NULL),
  (433, '12600002', 2025, 'segunda', DATE '2025-12-17', TIME '07:45', 24.66, 27.09, 7.07, 6.59, 94.93, NULL, 7.0, 3.1, 1.19, 1.12, 0.021, 3.0, 83.2, 0.139, 141.0, false, NULL, 689.0, NULL, 8.0, 1.9, 5.0, 178.9, NULL),
  (434, '12660000', 2025, 'segunda', DATE '2025-12-17', TIME '10:00', 22.26, 25.87, 6.81, 6.12, 120.85, NULL, 5.0, 2.7, 1.3, 0.7, 0.251, 1.9, 29.9, 0.0256, 30.0, false, NULL, 244.8, NULL, 12.0, 1.6, 9.0, 161.7, NULL),
  (435, '12430000', 2025, 'segunda', DATE '2025-12-16', TIME '15:00', 26.85, 25.46, 6.05, 2.47, 33.92, NULL, 6.0, 3.0, 1.99, 0.9, 0.027, 0.09, 13.72, 0.0146, 170.0, false, NULL, 986.0, NULL, 6.0, 1.1, 3.0, 32.6, NULL),
  (436, '12500004', 2025, 'segunda', DATE '2025-12-16', TIME '15:51', 27.01, 25.7, 5.97, 3.82, 47.37, NULL, 7.0, 3.4, 1.8, 0.09, 0.011, 0.12, 31.7, 0.04, 150.0, false, NULL, 480.0, NULL, 11.0, 0.8, 4.0, 62.9, NULL),
  (437, '13438000', 2026, 'primeira', DATE '2026-04-09', TIME '14:00', 27.19, 27.14, 8.67, 6.33, 600.37, NULL, 10.0, 6.72, 3.81, 1.5, 0.04, 0.19, 31.28, 0.037, 1120.0, false, NULL, 241900.0, NULL, 42.0, 1.9, 5.0, 91.9, NULL),
  (438, '13459000', 2026, 'primeira', DATE '2026-04-10', TIME '06:10', 24.42, 26.74, 8.68, 6.81, 361.13, NULL, 12.0, 6.9, 3.4, 1.3, 0.045, 0.16, 27.42, 0.032, 980.0, false, NULL, 1732.0, NULL, 46.0, 1.8, 8.0, 64.8, NULL),
  (439, '13550001', 2026, 'primeira', DATE '2026-04-09', TIME '10:00', 29.57, 28.16, 7.67, 6.91, 322.28, NULL, 10.0, 6.7, 3.81, 1.1, 0.039, 0.2, 25.1, 0.25, 71.0, false, NULL, 489.0, NULL, 40.0, 2.0, 6.0, 73.5, NULL),
  (440, '13770000', 2026, 'primeira', DATE '2026-04-07', TIME '09:00', 29.43, 26.14, 8.16, 4.89, 25.47, NULL, 6.0, 1.1, 6.0, 0.2, 4.3, 0.14, 16.7, 0.14, 4.0, false, NULL, 187.0, NULL, 20.0, 0.4, 3.0, 19.5, NULL),
  (441, '13610001', 2026, 'primeira', DATE '2026-04-08', TIME '15:45', 27.53, 27.09, 6.36, 5.73, 249.7, NULL, 6.0, 6.11, 2.3, 0.71, 0.021, 0.08, 14.27, 0.142, 2.0, false, NULL, 99.0, NULL, 38.0, 0.8, 4.0, 41.1, NULL),
  (442, '13601000', 2026, 'primeira', DATE '2026-04-06', TIME '09:00', 27.7, 26.36, 8.75, 5.79, 233.87, NULL, 5.0, 6.7, 3.1, 0.12, 0.017, 0.13, 14.2, 0.132, 5.0, false, NULL, 20.0, NULL, 20.0, 0.9, 3.0, 42.4, NULL),
  (443, '15324300', 2026, 'primeira', DATE '2026-04-07', TIME '10:00', 30.31, 26.22, 7.32, 4.61, 32.29, NULL, 5.0, 3.7, 1.99, 0.21, 0.014, 0.11, 10.49, 0.104, 5.0, false, NULL, 110.0, NULL, 22.0, 1.0, 3.0, 19.9, NULL),
  (444, '13408000', 2026, 'primeira', DATE '2026-03-24', TIME '10:00', 25.04, 25.13, 5.99, 6.49, 24.7, NULL, 7.0, 3.5, 1.9, 0.8, 0.018, 0.11, 19.83, 0.19, 4.0, false, NULL, 13.0, NULL, 30.0, 0.8, 4.0, 24.7, NULL),
  (445, '13190000', 2026, 'primeira', DATE '2026-03-23', TIME '10:00', 25.71, 25.71, 6.51, 5.59, 300.04, NULL, 8.0, 6.21, 3.16, 0.09, 0.027, 1.1, 16.35, 0.134, 18.0, false, NULL, 33.0, NULL, 32.0, 1.3, 5.0, 54.5, NULL),
  (446, '12600002', 2026, 'primeira', DATE '2026-03-19', TIME '07:50', 31.92, 28.21, 7.34, 6.39, 274.32, NULL, 10.0, 5.0, 2.18, 2.11, 0.03, 4.0, 64.91, 0.537, 10.0, false, NULL, 345.0, NULL, 150.0, 2.16, 10.0, 193.0, NULL),
  (447, '12660000', 2026, 'primeira', DATE '2026-03-20', TIME '17:00', 26.77, 27.86, 7.49, 6.32, 327.12, NULL, 7.0, 6.11, 2.4, 0.3, 0.171, 2.18, 73.87, 0.727, 2.0, false, NULL, 141.0, NULL, 50.0, 1.0, 6.0, 216.2, NULL),
  (448, '12430000', 2026, 'primeira', DATE '2026-03-18', TIME '15:30', 25.74, 25.3, 6.65, 8.59, 324.0, NULL, 8.0, 5.7, 12.5, 12.5, 0.02, 1.8, 11.6, 0.11, 172.0, false, NULL, 172.0, NULL, 38.0, 1.9, 4.0, 6.3, NULL),
  (449, '12500004', 2026, 'primeira', DATE '2026-03-18', TIME '15:00', 26.15, 26.29, 7.07, 4.31, 243.56, NULL, 12.0, 7.11, 3.5, 1.0, 0.016, 0.1, 22.08, 0.184, 289.0, false, NULL, 510.0, NULL, 22.0, 1.8, 2.0, 66.9, NULL),
  (450, '12369000', 2026, 'primeira', DATE '2026-03-17', TIME '10:00', 29.06, 26.23, 7.53, 4.01, 501.16, NULL, 9.0, 7.0, 3.0, 1.0, 0.12, 2.3, 31.72, 0.03, 613.0, false, NULL, 1299.0, NULL, 40.0, 2.1, 10.0, 101.0, NULL),
  (451, '12389000', 2026, 'primeira', DATE '2026-03-17', TIME '12:00', 29.25, 25.7, 5.97, 3.82, 605.0, NULL, 7.0, 6.3, 2.9, 0.12, 0.021, 1.0, 31.85, 0.035, 816.0, false, NULL, 1732.0, NULL, 52.0, 2.1, 8.0, 62.9, NULL);

-- ── 2. Sanity: 450 linhas carregadas ───────────────────────────
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM _agua_import_raw;
  IF n <> 450 THEN
    RAISE EXCEPTION 'Import Fase 1: esperava 450 linhas em _agua_import_raw, achou %', n;
  END IF;
END $$;

-- ── 3. Sanity: toda estação casa com um ponto de coleta ────────
-- Nunca por nome de município (grafias variam) — só codigo_ana ou
-- codigos_alias (migration 250). Falha alto em vez de o INNER JOIN
-- do passo 5 descartar a linha em silêncio.
DO $$ DECLARE sem_ponto int; DECLARE exemplos text; BEGIN
  SELECT count(*), string_agg(DISTINCT v.estacao_codigo, ', ')
    INTO sem_ponto, exemplos
    FROM _agua_import_raw v
   WHERE NOT EXISTS (
     SELECT 1 FROM agua_pontos_coleta p
      WHERE v.estacao_codigo = p.codigo_ana OR v.estacao_codigo = ANY(p.codigos_alias));
  IF sem_ponto > 0 THEN
    RAISE EXCEPTION 'Import Fase 1: % linha(s) sem ponto de coleta correspondente (códigos: %)', sem_ponto, exemplos;
  END IF;
END $$;

-- ── 4. Sanity: toda campanha (ano+ordem) já está semeada ───────
DO $$ DECLARE sem_campanha int; DECLARE exemplos text; BEGIN
  SELECT count(*), string_agg(DISTINCT v.campanha_ano || '/' || v.campanha_ordem, ', ')
    INTO sem_campanha, exemplos
    FROM _agua_import_raw v
   WHERE NOT EXISTS (
     SELECT 1 FROM agua_campanhas c
      WHERE c.ano = v.campanha_ano AND c.ordem = v.campanha_ordem::ordem_campanha_agua);
  IF sem_campanha > 0 THEN
    RAISE EXCEPTION 'Import Fase 1: % linha(s) sem campanha correspondente (%)', sem_campanha, exemplos;
  END IF;
END $$;

-- ── 5. Import: junta ponto e campanha, deriva quarentena ───────
INSERT INTO agua_coletas (
  ponto_id, campanha_id, data_coleta, hora_coleta,
  temp_ar, temp_amostra, ph, od, turbidez, condutividade_eletrica, dbo,
  nitrogenio_total, nitrogenio_amoniacal, nitratos, fosforo_total, ortofosfato_dissolvido,
  solidos_dissolvidos_totais, solidos_suspensao_totais,
  coliformes_termotolerantes, coliformes_totais, escherichia_coli,
  alcalinidade_total, carbono_organico_total, cloreto, condutividade_especifica, descarga_liquida,
  censurados, status, quarentena_motivo, linha_origem_planilha
)
SELECT
  p.id,
  c.id,
  v.data_coleta,
  v.hora_coleta,
  v.temp_ar, v.temp_amostra, v.ph, v.od, v.turbidez, v.condutividade_eletrica, v.dbo,
  v.nitrogenio_total, v.nitrogenio_amoniacal, v.nitratos, v.fosforo_total, v.ortofosfato_dissolvido,
  v.solidos_dissolvidos_totais, v.solidos_suspensao_totais,
  -- Decisão 3 do plano: a coluna numérica guarda METADE do limite
  -- quando censurado. O limite bruto vai só para `censurados`.
  CASE WHEN v.coli_censurado THEN v.coli_limite / 2 ELSE v.coliformes_termotolerantes END,
  v.coliformes_totais, v.escherichia_coli,
  v.alcalinidade_total, v.carbono_organico_total, v.cloreto, v.condutividade_especifica, v.descarga_liquida,

  CASE WHEN v.coli_censurado
       THEN jsonb_build_object('coliformes_termotolerantes', v.coli_limite)
       ELSE '{}'::jsonb END,

  CASE WHEN v.solidos_suspensao_totais IS NOT NULL
         OR (v.ph IS NOT NULL AND (v.ph < 0 OR v.ph > 14))
         OR (v.od IS NOT NULL AND v.temp_amostra IS NOT NULL
             AND agua_od_saturacao(v.od, v.temp_amostra) IS NOT NULL
             AND agua_od_saturacao(v.od, v.temp_amostra) > 150)
         OR abs(extract(year from v.data_coleta)::int - v.campanha_ano) > 1
       THEN 'quarentena'::status_coleta_agua
       ELSE 'completo'::status_coleta_agua
  END,

  nullif(array_to_string(ARRAY[
    CASE WHEN v.solidos_suspensao_totais IS NOT NULL THEN
      format('Sólidos em suspensão preenchidos (%s mg/L) — incoerente com a mediana da série (0,342 mg/L) frente à turbidez típica (mediana 90 UNT); suspeita de mistura de unidade g/L×mg/L. Não converter sem conferir o laudo físico.', v.solidos_suspensao_totais)
    END,
    CASE WHEN v.ph IS NOT NULL AND (v.ph < 0 OR v.ph > 14) THEN
      format('pH %s fisicamente impossível (escala 0–14). Conferir digitação contra o laudo físico.', v.ph)
    END,
    CASE WHEN v.od IS NOT NULL AND v.temp_amostra IS NOT NULL
           AND agua_od_saturacao(v.od, v.temp_amostra) IS NOT NULL
           AND agua_od_saturacao(v.od, v.temp_amostra) > 150 THEN
      format('OD %s mg/L muito acima da saturação calculada (%s%% a %s °C) — conferir sensor/unidade no laudo físico.',
             v.od, round(agua_od_saturacao(v.od, v.temp_amostra), 1), v.temp_amostra)
    END,
    CASE WHEN abs(extract(year from v.data_coleta)::int - v.campanha_ano) > 1 THEN
      format('Ano da campanha (%s) diverge em mais de 1 ano da data da coleta (%s) — provável erro de digitação, não corrigido automaticamente.', v.campanha_ano, v.data_coleta)
    END
  ], ' | '), ''),

  v.linha
FROM _agua_import_raw v
JOIN agua_pontos_coleta p ON v.estacao_codigo = p.codigo_ana OR v.estacao_codigo = ANY(p.codigos_alias)
JOIN agua_campanhas c ON c.ano = v.campanha_ano AND c.ordem = v.campanha_ordem::ordem_campanha_agua;

-- ── 6. Sanity final: 450 coletas importadas ─────────────────────
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM agua_coletas WHERE linha_origem_planilha IS NOT NULL;
  IF n <> 450 THEN
    RAISE EXCEPTION 'Import Fase 1: esperava 450 coletas com linha_origem_planilha, achou %', n;
  END IF;
END $$;
