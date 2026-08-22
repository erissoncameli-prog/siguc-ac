-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — leitura assistida do laudo (Entrega 2)
-- Plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md, §3.
--
-- O QUE ESTA MIGRATION CRIA
-- `agua_laudo_templates`: onde vive o GABARITO de cada laboratório —
-- posição de cada campo na página, escala do parâmetro (casas
-- decimais), tudo em coordenadas RELATIVAS (fração de largura/altura
-- da página, 0 a 1), para não depender do DPI de renderização.
-- `agua_coletas.origem_dados`: proveniência por campo (parser/digitado/
-- corrigido após o parser), gravada junto do valor.
--
-- ACHADO REAL, MEDIDO CONTRA 3 LAUDOS DO QUILAB — muda a arquitetura
-- do §3.1 do plano: os laudos anexados são digitalização de mesa
-- scanner (Epson Scan 2, 200 dpi, zero fonte embutida — confirmado
-- objeto a objeto no PDF). Não há texto para extrair: o parser tem
-- de fazer OCR sobre a IMAGEM renderizada da página, não regex sobre
-- camada de texto. O plano original previa os dois casos (§3.5,
-- "PDF sem camada de texto") mas deixava OCR fora da v1 por falta de
-- amostra — a amostra chegou, e o §10 é atualizado por esta entrega.
--
-- POR QUE GABARITO POR POSIÇÃO, NÃO BUSCA DE TEXTO
-- Medido nas 17 páginas do lote enviado: a posição de cada linha do
-- laudo varia no máximo ~17 px numa página de 3508 px de altura
-- (300 dpi, A4) — ruído do próprio processo de digitalização em mesa
-- scanner, não do conteúdo. O layout é fixo por template do
-- laboratório. Por isso o gabarito recorta uma CAIXA generosa ao
-- redor de cada valor (não busca o rótulo por OCR de página inteira,
-- que já provou ser 5-10x mais lento e mais sujeito a erro de
-- segmentação de tabela).
--
-- ACHADO CRÍTICO — NUNCA CONFIAR NA VÍRGULA QUE O OCR LÊ
-- Testado com o valor real "3,17" (Nitrogênio Total, laudo nº 1.347/
-- 2025): OCR de página inteira leu "3,47" — trocou o dígito 1↔4 numa
-- célula limpa, sem borrão, sem alerta de baixa confiança que
-- distinguisse esse erro dos acertos ao redor. Já o OCR sobre o
-- RECORTE da célula, com whitelist de caracteres numéricos, leu os
-- dígitos "317" corretamente — só a posição da vírgula é que não é
-- confiável (o glifo da vírgula é pequeno demais em 300 dpi para o
-- OCR situar com segurança).
-- Solução: `casas_decimais` é uma constante do TEMPLATE, não uma
-- leitura do OCR. Medido nas 17 páginas: cada parâmetro imprime
-- SEMPRE o mesmo número de casas nesse laboratório (a maioria 2,
-- fósforo total e sólidos em suspensão 3). O parser lê só os dígitos
-- (ignora separador, sinal, tudo que não é 0-9) e insere o ponto
-- decimal na posição fixa do template — nunca onde o OCR "achou" a
-- vírgula. Consequência direta: A CONFERÊNCIA HUMANA TEM DE MOSTRAR O
-- RECORTE DA IMAGEM, nunca o texto OCR re-digitado — um texto errado
-- reexibido pareceria tão correto quanto um certo.
--
-- POR QUE JSONB, E NÃO UMA TABELA DE CAMPOS
-- O gabarito é un-por-laboratório e muda inteiro quando o laboratório
-- reformata o relatório (2ª via, novo timbre) — tratar como conjunto
-- versionado, no molde de `lgpd_documentos`/`agua_limites_conama`
-- (regra do projeto: parâmetro variável em tabela, nunca em código).
-- `campos` é um objeto {parametro: {top,left,width,height,casas}},
-- sempre em FRAÇÃO da página (0..1) — funciona em qualquer DPI de
-- renderização do pdf.js no navegador.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agua_laudo_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  laboratorio_id uuid NOT NULL REFERENCES agua_laboratorios(id) ON DELETE CASCADE,
  versao         integer NOT NULL DEFAULT 1,
  ativo          boolean NOT NULL DEFAULT true,

  -- Texto (não posição) que identifica ESTE laboratório numa página
  -- desconhecida — comparado por substring, sem diferenciar
  -- maiúscula/acento (normalização no parser). É a etapa 2 do
  -- pipeline (§3.3 do plano): antes de confiar em qualquer posição,
  -- confirma que a página é DESTE laboratório.
  ancora_texto   text NOT NULL CHECK (length(btrim(ancora_texto)) >= 3),

  -- Caixas do CABEÇALHO (identidade da amostra) — comparadas contra a
  -- coleta aberta antes de habilitar qualquer autofill (§3.3, "trava
  -- de identidade"). Cada chave é {top,left,width,height} em fração
  -- da página; OCR de texto livre (não numérico) roda nessas caixas.
  campos_identidade jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Caixas dos VALORES, uma por parâmetro de agua_coletas. Cada
  -- entrada: {top,left,width,height,casas_decimais}. `casas_decimais`
  -- é o achado acima — constante do template, nunca lido do OCR.
  campos         jsonb NOT NULL DEFAULT '{}'::jsonb,

  criado_por     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_agua_laudo_tpl_campos_obj CHECK (jsonb_typeof(campos) = 'object'),
  CONSTRAINT ck_agua_laudo_tpl_identidade_obj CHECK (jsonb_typeof(campos_identidade) = 'object'),
  CONSTRAINT uq_agua_laudo_tpl_versao UNIQUE (laboratorio_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_agua_laudo_tpl_lab_ativo
  ON agua_laudo_templates (laboratorio_id) WHERE ativo;

DROP TRIGGER IF EXISTS trg_agua_laudo_tpl_updated ON agua_laudo_templates;
CREATE TRIGGER trg_agua_laudo_tpl_updated BEFORE UPDATE ON agua_laudo_templates
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE agua_laudo_templates ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de agua_laboratorios/agua_pontos_coleta: quem VÊ o
-- módulo lê o gabarito (precisa para o parser rodar no navegador de
-- qualquer técnico); só quem EDITA cadastra/corrige.
CREATE POLICY agua_laudo_tpl_select ON agua_laudo_templates
  FOR SELECT TO authenticated USING (pode_ver('agua'));
CREATE POLICY agua_laudo_tpl_insert ON agua_laudo_templates
  FOR INSERT TO authenticated WITH CHECK (pode_editar('agua'));
CREATE POLICY agua_laudo_tpl_update ON agua_laudo_templates
  FOR UPDATE TO authenticated USING (pode_editar('agua')) WITH CHECK (pode_editar('agua'));
CREATE POLICY agua_laudo_tpl_delete ON agua_laudo_templates
  FOR DELETE TO authenticated USING (pode_editar('agua'));

-- ── Proveniência por campo (§3.4 do plano) ────────────────────
-- {parametro: 'parser'|'digitado'|'corrigido_apos_parser'}. Não é
-- coluna por campo (seria 22 colunas booleanas) — é o mesmo critério
-- de `agua_coletas.censurados`: metadado de PROVENIÊNCIA de valores
-- específicos, não campo consultável por si (mesmo raciocínio da
-- migration 228 para especificações de equipamento).
ALTER TABLE agua_coletas
  ADD COLUMN IF NOT EXISTS origem_dados jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE agua_coletas
  ADD CONSTRAINT ck_agua_origem_dados_objeto CHECK (jsonb_typeof(origem_dados) = 'object');

COMMENT ON COLUMN agua_coletas.origem_dados IS
  'Proveniência por campo: {parametro: "parser"|"digitado"|"corrigido_apos_parser"}. Nunca populada automaticamente pelo parser sem confirmação humana — ver js/agua-laudo-ocr.js.';

-- ── Recria a view enumerando as colunas (armadilha da 260: `c.*`
-- expande no momento da CRIAÇÃO da view, coluna nova não aparece até
-- recriar) — acrescenta só origem_dados, no fim, mesmo padrão da 260.
CREATE OR REPLACE VIEW vw_agua_coletas_detalhe
WITH (security_invoker = true) AS
SELECT
  c.id, c.ponto_id, c.campanha_id, c.laboratorio_id, c.data_coleta, c.hora_coleta,
  c.coletor_id, c.coletor_nome, c.localizacao, c.foto_url, c.laudo_url,
  c.temp_ar, c.temp_amostra, c.ph, c.od, c.turbidez, c.condutividade_eletrica,
  c.dbo, c.nitrogenio_total, c.nitrogenio_amoniacal, c.nitratos, c.fosforo_total,
  c.ortofosfato_dissolvido, c.solidos_dissolvidos_totais, c.solidos_suspensao_totais,
  c.coliformes_termotolerantes, c.coliformes_totais, c.escherichia_coli,
  c.alcalinidade_total, c.carbono_organico_total, c.cloreto,
  c.condutividade_especifica, c.descarga_liquida, c.censurados, c.status,
  c.quarentena_motivo, c.observacoes, c.linha_origem_planilha, c.criado_por,
  c.criado_em, c.atualizado_em,
  p.codigo_ana, p.nome AS ponto_nome, p.municipio AS ponto_municipio,
  p.rio AS ponto_rio, p.bacia AS ponto_bacia, p.classe_enquadramento, p.uc_id,
  ST_Y(p.geom) AS ponto_lat, ST_X(p.geom) AS ponto_lng,
  ca.ano AS campanha_ano, ca.ordem AS campanha_ordem,
  l.nome AS laboratorio_nome,
  ST_Y(c.localizacao) AS lat, ST_X(c.localizacao) AS lng,
  CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
       THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END AS delta_temperatura,
  (c.temp_ar IS NULL OR c.temp_amostra IS NULL) AS delta_temperatura_neutro,
  agua_od_saturacao(c.od, c.temp_amostra) AS od_saturacao,
  CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
       THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
       ELSE NULL::numeric END AS solidos_totais,
  agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
    c.nitrogenio_total, c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
         ELSE NULL::numeric END
  ) AS iqa,
  agua_iqa_faixa(agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
    c.nitrogenio_total, c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
         ELSE NULL::numeric END
  )) AS iqa_faixa,
  agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total) AS conama_violacoes,
  CASE WHEN agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total) IS NULL THEN NULL::boolean
       ELSE cardinality(agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total)) = 0
  END AS conama_conforme,
  c.codigo_amostra,
  c.excluido_em, c.excluido_por, c.exclusao_justificativa,
  CASE WHEN c.localizacao IS NULL THEN NULL::numeric
       ELSE ST_Distance(c.localizacao::geography, p.geom::geography)::numeric END AS distancia_ponto_metros,
  agua_gps_faixa(CASE WHEN c.localizacao IS NULL THEN NULL::numeric
       ELSE ST_Distance(c.localizacao::geography, p.geom::geography)::numeric END) AS gps_confirmacao,

  -- ── Acrescentado nesta migration (Entrega 2) — só no fim é permitido ──
  c.origem_dados

FROM agua_coletas c
JOIN agua_pontos_coleta p ON p.id = c.ponto_id
JOIN agua_campanhas ca ON ca.id = c.campanha_id
LEFT JOIN agua_laboratorios l ON l.id = c.laboratorio_id
WHERE c.excluido_em IS NULL;

REVOKE ALL ON agua_laudo_templates FROM anon;
