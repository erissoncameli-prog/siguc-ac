-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — seed das estações históricas
-- e das campanhas da série 2016–2026
-- Fase 0 do plano em docs/qualidade-agua/plano.md
--
-- SÃO 17 ESTAÇÕES, NÃO 20
-- A planilha traz 20 códigos de estação distintos, e o plano fala em
-- "20 estações". Conferido linha a linha: TRÊS deles são erro de
-- digitação do código de uma estação que já está na lista — é o
-- achado 1 do próprio plano ("a mesma estação com códigos 13438000,
-- 13433800, 13488000; Rio Branco como 1360100"). Semear 20 linhas
-- criaria três estações fantasmas com uma coleta cada, exatamente o
-- problema que o cadastro existe para resolver. As grafias erradas
-- ficam em `codigos_alias`, para a Fase 1 casar as 450 linhas sem
-- inventar ponto e para o erro continuar rastreável:
--   13438000 (Assis Brasil) ← 13433800, 13488000
--   13601000 (Rio Branco)   ← 1360100
--
-- SANTA ROSA DO PURUS — a coordenada corrigida
-- Na planilha, a estação 13169900 está gravada em
-- -8.263678, -72.741702, que é a coordenada de PORTO WALTER, no
-- Juruá, em outra bacia (achado 3 do plano; medidas as duas posições
-- depois da correção, são 279 km em linha reta). A
-- linha 420 da planilha copiou coordenada E altitude da linha 392,
-- de Porto Walter — inclusive os 201 m.
-- Substituída pela sede municipal de Santa Rosa do Purus
-- (-9.43278, -70.49278), que fica na margem do Rio Purus. É um
-- localizador do município, NÃO a coordenada da estação: entra com
-- `coordenada_conferida = false` e observação dizendo isso. Inventar
-- precisão de estação seria trocar um erro conhecido por um erro
-- invisível. A altitude fica NULA pelo mesmo motivo — a que estava lá
-- era a de Porto Walter.
--
-- AS OUTRAS 16 COORDENADAS FORAM CONFERIDAS CONTRA O POLÍGONO DO
-- MUNICÍPIO (`data/municipios_acre.geojson`), e nenhuma outra troca
-- apareceu. Três caem fora do polígono e todas as três se explicam:
-- Assis Brasil por 60 m e Brasiléia por ~0 (as estações ficam sobre o
-- Rio Acre, que é a própria divisa), e Mâncio Lima 2,2 km dentro de
-- Cruzeiro do Sul (a estação do Rio Môa fica perto da foz). Nenhuma é
-- troca de município. Mesmo assim TODAS entram com
-- `coordenada_conferida = false`: nenhuma foi conferida em campo, e
-- marcar só a que sabidamente estava errada daria a impressão de que
-- as outras foram.
--
-- BACIA — nulo onde não há certeza
-- Preenchida onde a hidrografia é inequívoca (Acre e Iaco são
-- afluentes do Purus; Môa, Tarauacá e Envira, do Juruá; Abunã, do
-- Madeira). Fica NULA na estação do Rio Iquiri (Senador Guiomard):
-- na própria planilha "Iquiri" aparece também como grafia errada dos
-- rios Iaco e Abunã, então o nome não basta para decidir a bacia.
-- Campo de cadastro, editável na Fase 2 — nulo é resposta melhor que
-- palpite gravado.
--
-- CAMPANHAS
-- Semeadas as 20 combinações ano+ordem que a série de fato contém
-- (2016 só teve a primeira; 2026 idem, por ora).
-- A coluna `periodo` fica NULA de propósito: na planilha o "Período
-- certificação" é um contador sequencial (Primeiro … Décimo Nono) que
-- NÃO acompanha a campanha — 2017/Primeira aparece como "Segundo" e
-- como "Terceiro", 2022 tem quatro grafias do mesmo período. Concilia-
-- ção é trabalho da Fase 1, com quem conhece o calendário de
-- certificação; gravar agora só congelaria a confusão.
-- ═══════════════════════════════════════════════════════════

-- ── Estações ──────────────────────────────────────────────────
INSERT INTO agua_pontos_coleta
  (codigo_ana, codigos_alias, nome, municipio, rio, bacia, geom, altitude_m,
   coordenada_conferida, coordenada_observacao)
VALUES
  ('13438000', ARRAY['13433800','13488000'], 'Assis Brasil', 'Assis Brasil', 'Rio Acre', 'Purus',
   ST_SetSRID(ST_MakePoint(-69.566178706128580, -10.945198173059070), 4326), 231, false,
   'Coordenada da planilha. Cai 60 m fora do polígono do município — a estação fica sobre o Rio Acre, que é a divisa.'),

  ('13459000', '{}', 'Brasiléia', 'Brasiléia', 'Rio Acre', 'Purus',
   ST_SetSRID(ST_MakePoint(-68.745096461343040, -11.017389147115420), 4326), 187, false,
   'Coordenada da planilha. Sobre a divisa com Epitaciolândia — o Rio Acre separa as duas cidades.'),

  ('12500004', '{}', 'Cruzeiro do Sul', 'Cruzeiro do Sul', 'Rio Juruá', 'Juruá',
   ST_SetSRID(ST_MakePoint(-72.658782838577610, -7.634276346822194), 4326), 165, false,
   'Coordenada da planilha, não conferida em campo.'),

  ('12660000', '{}', 'Feijó', 'Feijó', 'Rio Envira', 'Juruá',
   ST_SetSRID(ST_MakePoint(-70.354700345509120, -8.159255993149376), 4326), 153, false,
   'Coordenada da planilha, não conferida em campo.'),

  ('12557000', '{}', 'Jordão', 'Jordão', 'Rio Tarauacá', 'Juruá',
   ST_SetSRID(ST_MakePoint(-71.952935274864630, -9.186558122532947), 4326), 264, false,
   'Coordenada da planilha, não conferida em campo.'),

  ('12430000', '{}', 'Mâncio Lima', 'Mâncio Lima', 'Rio Môa', 'Juruá',
   ST_SetSRID(ST_MakePoint(-72.796731480769040, -7.620997384760779), 4326), 178, false,
   'Coordenada da planilha. Cai 2,2 km dentro de Cruzeiro do Sul — a estação do Rio Môa fica perto da foz. Confirmar em campo.'),

  ('13190000', '{}', 'Manoel Urbano', 'Manoel Urbano', 'Rio Purus', 'Purus',
   ST_SetSRID(ST_MakePoint(-69.258872552890200, -8.842986621185595), 4326), 144, false,
   'Coordenada da planilha, não conferida em campo. Em parte das linhas o rio aparece como "ACRE"; o rio da estação é o Purus.'),

  ('12369000', '{}', 'Marechal Thaumaturgo', 'Marechal Thaumaturgo', 'Rio Juruá', 'Juruá',
   ST_SetSRID(ST_MakePoint(-72.784614769837970, -8.949068661768846), 4326), 208, false,
   'Coordenada da planilha, não conferida em campo.'),

  ('15324300', '{}', 'Plácido de Castro', 'Plácido de Castro', 'Rio Abunã', 'Madeira',
   ST_SetSRID(ST_MakePoint(-67.184536280968080, -10.337762522149955), 4326), 126, false,
   'Coordenada da planilha, não conferida em campo. Em uma linha o rio aparece como "IQUIRI"; o rio da estação é o Abunã.'),

  ('13610001', '{}', 'Porto Acre', 'Porto Acre', 'Rio Acre', 'Purus',
   ST_SetSRID(ST_MakePoint(-67.531181823088910, -9.589999366418281), 4326), 122, false,
   'Coordenada da planilha, não conferida em campo.'),

  ('12389000', '{}', 'Porto Walter', 'Porto Walter', 'Rio Juruá', 'Juruá',
   ST_SetSRID(ST_MakePoint(-72.741702318048550, -8.263677845414033), 4326), 192, false,
   'Coordenada da planilha, não conferida em campo. A altitude aparece como 201 m e 192 m para a mesma coordenada; adotado 192 m, que é o valor das linhas mais recentes. Conferir.'),

  ('13601000', ARRAY['1360100'], 'Rio Branco', 'Rio Branco', 'Rio Acre', 'Purus',
   ST_SetSRID(ST_MakePoint(-67.776911566739560, -9.956933590645951), 4326), 133, false,
   'Coordenada da planilha, não conferida em campo.'),

  ('13169900', '{}', 'Santa Rosa do Purus', 'Santa Rosa do Purus', 'Rio Purus', 'Purus',
   ST_SetSRID(ST_MakePoint(-70.492780000000000, -9.432780000000000), 4326), NULL, false,
   'COORDENADA CORRIGIDA: a planilha trazia a de Porto Walter (-8,263678 / -72,741702), outra bacia, 279 km em linha reta. O valor aqui é a sede municipal de Santa Rosa do Purus, na margem do Purus — localizador provisório, NÃO a posição da estação. Altitude nula pelo mesmo motivo (a que constava era a de Porto Walter). Levantar em campo.'),

  ('13408000', '{}', 'Sena Madureira', 'Sena Madureira', 'Rio Iaco', 'Purus',
   ST_SetSRID(ST_MakePoint(-68.654524644638510, -9.076365258320617), 4326), 127, false,
   'Coordenada da planilha, não conferida em campo. Em duas linhas o rio aparece como "IQUIRI"; o rio da estação é o Iaco.'),

  ('13770000', '{}', 'Senador Guiomard', 'Senador Guiomard', 'Rio Iquiri', NULL,
   ST_SetSRID(ST_MakePoint(-67.543850461357780, -10.078928794137362), 4326), 153, false,
   'Coordenada da planilha, não conferida em campo. Bacia não preenchida: "Iquiri" também aparece na planilha como grafia errada de outros rios — confirmar a hidrografia antes de classificar.'),

  ('12600002', '{}', 'Tarauacá', 'Tarauacá', 'Rio Tarauacá', 'Juruá',
   ST_SetSRID(ST_MakePoint(-70.758293727092240, -8.158209266596135), 4326), 161, false,
   'Coordenada da planilha, não conferida em campo.'),

  ('13550001', '{}', 'Xapuri', 'Xapuri', 'Rio Acre', 'Purus',
   ST_SetSRID(ST_MakePoint(-68.507403636578740, -10.649855917150802), 4326), 169, false,
   'Coordenada da planilha, não conferida em campo.')
ON CONFLICT (codigo_ana) DO NOTHING;

-- ── Campanhas da série 2016–2026 ──────────────────────────────
INSERT INTO agua_campanhas (ano, ordem)
VALUES
  (2016,'primeira'),
  (2017,'primeira'), (2017,'segunda'),
  (2018,'primeira'), (2018,'segunda'),
  (2019,'primeira'), (2019,'segunda'),
  (2020,'primeira'), (2020,'segunda'),
  (2021,'primeira'), (2021,'segunda'),
  (2022,'primeira'), (2022,'segunda'),
  (2023,'primeira'), (2023,'segunda'),
  (2024,'primeira'), (2024,'segunda'),
  (2025,'primeira'), (2025,'segunda'),
  (2026,'primeira')
ON CONFLICT (ano, ordem) DO NOTHING;

-- ── Conferência: todo ponto tem que cair no Acre (com tolerância) ──
-- Reusa `limite_acre` (migration 239), o mesmo polígono que recorta
-- focos de calor e alertas. Se o seed introduzir um ponto fora do
-- estado, a migration falha AQUI em vez de a Fase 4 descobrir no mapa.
--
-- POR QUE TOLERÂNCIA, E POR QUE 500 m
-- Rodada sem folga, esta checagem reprovou Assis Brasil: a estação
-- fica 71 m FORA do polígono. Não é coordenada errada — é que a
-- estação fica sobre o Rio Acre, que ali é a divisa internacional, e
-- o `limite_acre` tem 988 vértices para 2.600 km de perímetro (um
-- vértice a cada ~2,6 km). Uma linha reta entre dois vértices não
-- acompanha o meandro do rio, e a estação cai do lado de fora da
-- corda. Brasiléia e Mâncio Lima têm o mesmo perfil.
-- 500 m separa os dois casos com folga: pega troca de estação (Santa
-- Rosa do Purus estava a 279 KM) e absorve a resolução do polígono.
-- A checagem é FAIL-OPEN como a `geo_ponto_no_acre`: com
-- `limite_acre` vazia (banco novo, geometria ainda não carregada por
-- pg_net) não há o que comparar e o seed passa.
DO $$
DECLARE fora int;
BEGIN
  SELECT count(*) INTO fora
    FROM agua_pontos_coleta p
   WHERE EXISTS (SELECT 1 FROM limite_acre)
     AND NOT EXISTS (
       SELECT 1 FROM limite_acre la
        WHERE ST_DWithin(p.geom::geography, la.geom::geography, 500)
     );
  IF fora > 0 THEN
    RAISE EXCEPTION 'Seed de qualidade da água: % ponto(s) a mais de 500 m fora do limite do Acre', fora;
  END IF;
END $$;
