-- 311_rh_estacoes_seed.sql
--
-- Resolve o "Plataformas de Coleta" vazio (pages/rh-estacoes.html):
-- rh_estacoes nunca recebeu nenhuma estação cadastrada — a causa raiz
-- é anterior a qualquer credencial da ANA (ver item 2, ainda pendente,
-- em docs/recursos-hidricos/plano.md). Cadastro extraído dos dois
-- boletins reais fornecidos pela SEMA (Nº148 e Nº149, 21/08/2026) +
-- conferido contra o tutorial de elaboração (Nº124).
--
-- ACHADO QUE MUDOU O SCHEMA: as cotas que aparecem nesses relatórios
-- ("Cota de Estiagem: Alerta | Alerta Máximo") são cotas de ESTIAGEM
-- (quanto MENOR o nível, pior — ex.: Assis Brasil em alerta máximo a
-- partir de 3,50 m, e o nível atual real é 2,66 m, já abaixo). As
-- colunas que já existiam (`cota_atencao_cm`/`cota_alerta_cm`/
-- `cota_inundacao_cm`, e a lógica de `situacao_cota` na view e de
-- `rh_checar_cotas()`) são de CHEIA — quanto MAIOR o nível, pior.
-- São direções opostas: gravar estiagem nessas colunas faria o alerta
-- de cheia disparar errado (ou nunca disparar). Por isso duas colunas
-- NOVAS, só para cadastro/consulta por enquanto — a lógica de alerta
-- de estiagem (view + rh_checar_cotas) fica para uma entrega própria,
-- quando o Painel das Bacias/relatório diário for ler esse dado.
-- Nenhuma cota de CHEIA foi cadastrada aqui: os relatórios fornecidos
-- não trazem esse valor para nenhuma estação — fica NULL (correto:
-- "sem cota cadastrada" na view, nunca "normal" por omissão).
--
-- Dados que NÃO foram cadastrados por falta de certeza (regra do
-- projeto: nunca inventar dado) ficam NULL: município de estações cujo
-- nome não é o do próprio município (Aldeia dos Patos, Espalha,
-- Riozinho do Rola, Seringal São José/Guarany/Santa Helena, Ponte do
-- Liberdade, Colônia Dolores) e o rio exato dessas mesmas estações —
-- só a BACIA (seção do relatório) é seguramente atribuível a todas.
--
-- Dois códigos ANA corrigidos por terem 9 dígitos no PDF de origem
-- (padrão real da ANA é 8): Assis Brasil "134450000"→13445000 e Santa
-- Rosa do Purus "131690000"→13169900 (o relatório hidrometeorológico,
-- mais recente, já traz "13169900" certo — usado aqui).
--
-- Duas discrepâncias entre os dois relatórios, registradas em
-- observações em vez de escolhidas às cegas:
--   • Porto Walter: alerta máximo 2,00 m no Boletim do Tempo Nº149,
--     1,35 m no Relatório Hidrometeorológico Nº148 (mesma data). Usado
--     o do Boletim (valor mais frequente/consistente entre edições);
--     o outro fica anotado para conferência humana.
--   • Jordão: o nível é lido no PCD 12557000, mas a CHUVA desse
--     município vem de um PCD diferente (00971002, conforme nota de
--     rodapé do relatório hidrometeorológico) — registrado em
--     observações, sem criar uma segunda linha (o schema é 1 estação =
--     1 physical PCD; duas variáveis em códigos diferentes é uma
--     particularidade dessa localidade, não o padrão).
--
-- Depois desta migration, "Plataformas de Coleta" mostra o inventário
-- real (25 estações), mas as leituras (`rh_medicoes`) continuam vazias
-- até o item 2 (credenciais ANA_HIDROWEB_ID/ANA_HIDROWEB_SENHA) ligar
-- `ingest-hidro`, ou até existir lançamento manual para as leituras de
-- Defesa Civil/CEMADEN que a API da ANA não cobre.

ALTER TABLE rh_estacoes
  ADD COLUMN IF NOT EXISTS cota_estiagem_alerta_cm         integer,
  ADD COLUMN IF NOT EXISTS cota_estiagem_alerta_maximo_cm  integer;

COMMENT ON COLUMN rh_estacoes.cota_estiagem_alerta_cm IS
  'Cota de referência de ESTIAGEM (cm) — abaixo dela é alerta. Direção oposta a cota_alerta_cm (cheia). Cadastrada, nunca derivada.';
COMMENT ON COLUMN rh_estacoes.cota_estiagem_alerta_maximo_cm IS
  'Cota de referência de ESTIAGEM MÁXIMA (cm) — abaixo dela é o nível mais severo de estiagem. Sempre <= cota_estiagem_alerta_cm.';

-- ── Seed — Bacia Rio Acre ───────────────────────────────────────────
INSERT INTO rh_estacoes
  (codigo_ana, nome, tipo, telemetrica, operadora, rio, bacia, municipio,
   cota_estiagem_alerta_cm, cota_estiagem_alerta_maximo_cm, observacoes)
VALUES
  ('13439000', 'Aldeia dos Patos', 'fluviopluviometrica', true, 'ANA',
   'Rio Acre', 'Rio Acre', NULL, 35, 30, NULL),
  ('13445000', 'Assis Brasil', 'fluviopluviometrica', true, 'ANA',
   'Rio Acre', 'Rio Acre', 'Assis Brasil', 400, 350,
   'Código ANA corrigido: o PDF de origem traz "134450000" (9 dígitos); padrão ANA é 8 dígitos.'),
  ('13470000', 'Brasiléia', 'fluviopluviometrica', true, 'ANA',
   'Rio Acre', 'Rio Acre', 'Brasiléia', 400, 350, NULL),
  ('13550000', 'Xapuri', 'fluviopluviometrica', true, 'ANA',
   'Rio Acre', 'Rio Acre', 'Xapuri', 220, 220,
   'Alerta e Alerta Máximo iguais (2,20 m) nos dois relatórios de origem — não é erro de digitação desta migration.'),
  ('13540000', 'Colônia Dolores (Xapuri)', 'fluviopluviometrica', true, 'ANA',
   NULL, 'Rio Acre', 'Xapuri', 250, 200, NULL),
  ('13568000', 'Capixaba (C. São José)', 'fluviopluviometrica', true, 'ANA',
   NULL, 'Rio Acre', 'Capixaba', 400, 350, NULL),
  ('13600002', 'Rio Branco', 'fluviopluviometrica', true, 'ANA',
   'Rio Acre', 'Rio Acre', 'Rio Branco', 300, 269, NULL),
  ('13572000', 'Espalha (S. Belo H.)', 'fluviopluviometrica', true, 'ANA',
   NULL, 'Rio Acre', NULL, 350, 300, NULL),
  ('13578000', 'Riozinho do Rola', 'fluviopluviometrica', true, 'ANA',
   'Riozinho do Rola', 'Rio Acre', NULL, 350, 300, NULL),
  ('13610001', 'Porto Acre', 'fluviopluviometrica', true, 'ANA',
   'Rio Acre', 'Rio Acre', 'Porto Acre', 220, 200, NULL),

  -- ── Bacia Abunã ────────────────────────────────────────────────
  ('15324000', 'Plácido de Castro', 'fluviopluviometrica', true, 'ANA',
   'Rio Abunã', 'Abunã', 'Plácido de Castro', 220, 200, NULL),

  -- ── Bacia Purus ────────────────────────────────────────────────
  ('13310000', 'Sena Madureira', 'fluviopluviometrica', true, 'ANA',
   'Rio Iaco', 'Purus', 'Sena Madureira', 220, 200, NULL),
  ('13180000', 'Manoel Urbano', 'fluviopluviometrica', true, 'ANA',
   'Rio Purus', 'Purus', 'Manoel Urbano', 250, 200, NULL),
  ('13169900', 'Santa Rosa do Purus', 'fluviopluviometrica', true, 'ANA',
   'Rio Purus', 'Purus', 'Santa Rosa do Purus', 130, 100,
   'Código ANA corrigido: o Boletim do Tempo traz "131690000" (9 dígitos); usado o "13169900" do Relatório Hidrometeorológico (8 dígitos, padrão ANA).'),
  ('13300000', 'Seringal São José', 'fluviopluviometrica', true, 'ANA',
   NULL, 'Purus', NULL, 220, 200, NULL),
  ('13405000', 'Seringal Guarany', 'pluviometrica', true, 'ANA',
   NULL, 'Purus', NULL, NULL, NULL,
   'Sem cota de nível cadastrada na fonte (relatório traz "-|-") — só chuva.'),

  -- ── Bacia Tarauacá-Envira ──────────────────────────────────────
  ('12650000', 'Feijó', 'fluviopluviometrica', true, 'ANA',
   'Rio Envira', 'Tarauacá-Envira', 'Feijó', 250, 200, NULL),
  ('12557000', 'Jordão', 'fluviopluviometrica', true, 'ANA',
   NULL, 'Tarauacá-Envira', 'Jordão', 170, 150,
   'A chuva deste município é lida em PCD separado (código ANA 00971002, conforme nota do Relatório Hidrometeorológico) — este registro cobre o nível.'),
  ('12640000', 'Seringal Santa Helena', 'fluviopluviometrica', true, 'ANA',
   NULL, 'Tarauacá-Envira', NULL, 250, 200, NULL),
  ('12590000', 'Tarauacá', 'fluviopluviometrica', true, 'ANA',
   'Rio Tarauacá', 'Tarauacá-Envira', 'Tarauacá', 220, 200, NULL),

  -- ── Bacia Juruá ────────────────────────────────────────────────
  ('12500000', 'Cruzeiro do Sul', 'fluviopluviometrica', true, 'ANA',
   'Rio Juruá', 'Juruá', 'Cruzeiro do Sul', 230, 200, NULL),
  ('12510500', 'Ponte do Liberdade', 'fluviopluviometrica', true, 'ANA',
   NULL, 'Juruá', NULL, 130, 100, NULL),
  ('12390000', 'Porto Walter', 'fluviopluviometrica', true, 'ANA',
   NULL, 'Juruá', 'Porto Walter', 250, 200,
   'Alerta Máximo divergente entre as duas fontes na mesma data (21/08/2026): 2,00 m no Boletim do Tempo Nº149 (usado aqui) x 1,35 m no Relatório Hidrometeorológico Nº148 — pendente de conferência humana com a SEMA/CIGMA antes de usar em alerta automático.'),
  ('12370000', 'Marechal Thaumaturgo', 'fluviopluviometrica', true, 'ANA',
   NULL, 'Juruá', 'Marechal Thaumaturgo', 250, 200, NULL),
  ('00772006', 'Mâncio Lima', 'pluviometrica', true, 'ANA',
   NULL, 'Juruá', 'Mâncio Lima', NULL, NULL,
   'PCD meteorológica localizada na área urbana do município (conforme nota do Relatório Hidrometeorológico) — sem cota de nível de rio.')
ON CONFLICT (codigo_ana) DO NOTHING;
