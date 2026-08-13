-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD — Qualidade da Água no ROPA
--
-- Regra do projeto (migration 211): tabela nova com dado pessoal =
-- entrada nova em `lgpd_tratamentos`, NA MESMA ENTREGA, apontando as
-- tabelas reais que a materializam. É o que permite auditar o
-- registro contra o schema em vez de acreditar nele.
--
-- Duas entradas, porque são dois titulares diferentes:
--  TRAT-018 — o COLETOR (servidor/colaborador da SEMA): a coleta
--    carrega quem coletou, onde o aparelho estava e uma foto do
--    ponto. Mesma família de TRAT-005/009/011 (trabalhador com
--    geolocalização), e por isso também `alto_risco`.
--  TRAT-019 — o RESPONSÁVEL TÉCNICO do laboratório contratado: nome,
--    registro de conselho e contato de um profissional de empresa
--    terceirizada. Base legal é execução de contrato (Art. 7º, V),
--    como em TRAT-012, e não política pública: o vínculo é contratual.
--
-- BASE LEGAL NÃO É CONSENTIMENTO (decisão registrada na 211). O
-- monitoramento da qualidade da água é atribuição do órgão ambiental
-- estadual; construir sobre consentimento criaria direito de
-- revogação sobre uma série histórica de guarda permanente.
--
-- SOBRE A GEOLOCALIZAÇÃO — o que de fato é gravado
-- `agua_coletas.localizacao` é UMA leitura pontual, no instante em
-- que a coleta é salva (o app da Fase 3 seguirá o padrão do Frota:
-- `getCurrentPosition`, melhor esforço, nunca bloqueando o trabalho
-- de campo). Não há rastreamento contínuo, e a posição do APARELHO é
-- guardada separada da posição da ESTAÇÃO
-- (`agua_pontos_coleta.geom`) justamente para que a diferença entre
-- as duas possa ser auditada — é controle de qualidade da coleta, não
-- de deslocamento de pessoa. Quando a Fase 3 entregar o app, o Aviso
-- de Campo ganha a variante `agua` (mesmo mecanismo das migrations
-- 222/223: uma linha em `lgpd_documentos` com `app = 'agua'`, sem
-- migration de schema).
-- ═══════════════════════════════════════════════════════════

INSERT INTO lgpd_tratamentos (
  codigo, nome, modulo, finalidade,
  base_legal, base_legal_detalhe,
  categorias_titulares, categorias_dados,
  dado_sensivel, dado_de_menor,
  origem, origem_detalhe,
  tabelas,
  retencao_meses, retencao_criterio,
  compartilhamento, transferencia_internacional,
  alto_risco, observacoes
) VALUES
(
  'TRAT-018',
  'Coletas de qualidade da água com geolocalização e foto',
  'agua',
  'Registrar a coleta de amostra de água nas estações de monitoramento do Estado, com identificação de quem coletou, posição do aparelho e foto do ponto, para compor a série histórica de qualidade da água e permitir auditoria da coleta.',
  'politica_publica',
  'Art. 7º, III — execução de política pública de monitoramento ambiental, atribuição do órgão ambiental estadual (Lei 6.938/1981, Art. 6º, VI; Resolução CONAMA 357/2005).',
  ARRAY['servidores e colaboradores da SEMA responsáveis pela coleta'],
  ARRAY['nome do coletor','vínculo com conta de usuário','geolocalização do aparelho no momento da coleta','fotografia do ponto de coleta','data e hora da coleta'],
  false, false,
  'coleta_direta',
  'O próprio coletor registra a coleta no app de campo (Fase 3); até lá, o técnico lança pela mesa.',
  ARRAY['agua_coletas'],
  NULL,
  'Guarda permanente — a coleta é o registro primário de uma série histórica ambiental de dez anos e instrui enquadramento de corpo hídrico e eventual apuração de poluição. Mesmo critério de TRAT-005 e TRAT-009.',
  'Resultados agregados de qualidade da água são de publicidade obrigatória (Lei 12.527/2011). O nome do coletor e a posição do aparelho NÃO integram a divulgação — são dado interno de auditoria da coleta.',
  false,
  true,
  'Geolocalização de trabalhador: leitura pontual no instante da coleta, sem rastreamento contínuo. A posição do aparelho é guardada separada da posição da estação (agua_pontos_coleta.geom) para permitir auditar a diferença entre as duas. Coberto pelo RIPD de geolocalização (migration 217) na mesma família de TRAT-005/006/009/011 — atualizar o RIPD para citar TRAT-018 na próxima revisão.'
),
(
  'TRAT-019',
  'Laboratórios contratados de análise de água',
  'agua',
  'Identificar o laboratório e o responsável técnico que produziu cada laudo, para prestação de contas do contrato e para rastrear mudança de patamar da série que decorra de troca de prestador.',
  'execucao_contrato',
  'Art. 7º, V — execução de contrato administrativo de prestação de serviço de análise laboratorial.',
  ARRAY['responsáveis técnicos de laboratórios contratados'],
  ARRAY['nome','registro em conselho profissional','e-mail','telefone'],
  false, false,
  'coleta_terceiro',
  'Servidor cadastra a partir dos documentos do contrato e do laudo.',
  ARRAY['agua_laboratorios'],
  60,
  'Cinco anos após o encerramento do contrato — prazo de prestação de contas ao controle externo. O cadastro é inativado, não excluído, para não quebrar o vínculo com os laudos já emitidos.',
  'Consta dos autos do processo de contratação.',
  false,
  false,
  NULL
)
ON CONFLICT (codigo) DO NOTHING;
