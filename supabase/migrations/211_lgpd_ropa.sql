-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 1 — ROPA (Registro das Operações de
-- Tratamento de Dados Pessoais), Art. 37 da Lei 13.709/2018
--
-- POR QUE NO BANCO, E NÃO EM DOCUMENTO
-- O ROPA em Word/PDF desatualiza no primeiro sprint: alguém adiciona
-- uma coluna de CPF e o documento não sabe. Aqui cada tratamento
-- aponta para as TABELAS REAIS que o materializam (coluna `tabelas`),
-- então a defasagem fica visível e auditável — dá para cruzar o ROPA
-- com o information_schema e achar tabela com dado pessoal que não
-- foi declarada.
--
-- DECISÃO ARQUITETURAL — BASE LEGAL NÃO É CONSENTIMENTO
-- A SEMA-AC é órgão público. O tratamento se apoia em execução de
-- política pública (Art. 7º, III) e cumprimento de obrigação legal
-- (Art. 7º, II), não em consentimento. Isso é deliberado e é o ponto
-- que evita dor de cabeça futura: se o sistema fosse construído sobre
-- consentimento, cada titular teria direito de revogação (Art. 8º,
-- §5º) — e um brigadista revogando obrigaria a apagar o registro de
-- combate a incêndio, que é documento público de arquivo permanente
-- (Lei 8.159/1991). Com base em política pública esse conflito não
-- existe. Consentimento fica reservado ao que é de fato opcional
-- (foto de perfil, notificação push).
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- Não cria canal de direitos do titular (Art. 18) nem documentos/
-- aceite — isso é a Fase 2 (migration 212). Aqui é só o inventário.
-- ═══════════════════════════════════════════════════════════

-- ── Bases legais (Art. 7º e Art. 11) ───────────────────────────
-- Só as que o SIGUC efetivamente usa. Legítimo interesse (Art. 7º,
-- IX) está de fora de propósito: a ANPD entende que hipótese é para
-- controlador privado; órgão público se apoia no Art. 7º, III.
CREATE TYPE lgpd_base_legal AS ENUM (
  'politica_publica',   -- Art. 7º, III — execução de política pública
  'obrigacao_legal',    -- Art. 7º, II  — cumprimento de obrigação legal
  'execucao_contrato',  -- Art. 7º, V   — execução de contrato
  'exercicio_direitos', -- Art. 7º, VI  — processo judicial/administrativo
  'consentimento'       -- Art. 7º, I   — só para o que é opcional
);

-- Como o dado chegou ao órgão. Distinguir coleta direta de base
-- externa importa: no dado de terceiro (SICAR/SINAFLOR/DOF) o titular
-- nunca interagiu com a SEMA, então a transparência do Art. 9º não
-- pode ser feita "na tela" — tem que estar na política pública.
CREATE TYPE lgpd_origem_dado AS ENUM (
  'coleta_direta',      -- o próprio titular informa no sistema
  'coleta_terceiro',    -- servidor cadastra em nome do titular
  'api_externa',        -- integração com base de outro órgão
  'geracao_automatica'  -- o sistema produz (log, GPS, auditoria)
);

CREATE TABLE lgpd_tratamentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        text NOT NULL UNIQUE,
  nome          text NOT NULL,
  modulo        text,
  finalidade    text NOT NULL,

  base_legal         lgpd_base_legal NOT NULL,
  base_legal_detalhe text NOT NULL,

  categorias_titulares text[] NOT NULL DEFAULT '{}',
  categorias_dados     text[] NOT NULL DEFAULT '{}',
  -- Sensível no sentido do Art. 5º, II (origem racial, convicção
  -- religiosa, saúde, biometria, genética...). Foto de rosto usada
  -- como identificação visual NÃO é biometria: vira dado sensível só
  -- se alimentar reconhecimento facial, o que o SIGUC não faz.
  dado_sensivel        boolean NOT NULL DEFAULT false,
  -- Art. 14 — criança e adolescente. Quando true, exige consentimento
  -- específico e destacado de um dos pais ou responsável.
  dado_de_menor        boolean NOT NULL DEFAULT false,

  origem         lgpd_origem_dado NOT NULL,
  origem_detalhe text,

  -- Tabelas reais que materializam o tratamento. É o que permite
  -- auditar o ROPA contra o schema em vez de acreditar nele.
  tabelas text[] NOT NULL DEFAULT '{}',

  -- NULL = guarda permanente (documento de arquivo, Lei 8.159/1991).
  -- Não confundir com "sem política de retenção definida": o critério
  -- textual é obrigatório justamente para essa distinção ficar clara.
  retencao_meses   integer,
  retencao_criterio text NOT NULL,

  compartilhamento            text,
  transferencia_internacional boolean NOT NULL DEFAULT false,

  -- Alto risco = exige Relatório de Impacto (RIPD, Art. 38) antes de
  -- a ANPD pedir. Marcado para geolocalização de trabalhador e para
  -- base de terceiros em larga escala.
  alto_risco  boolean NOT NULL DEFAULT false,
  observacoes text,

  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lgpd_trat_modulo ON lgpd_tratamentos(modulo) WHERE ativo;
CREATE INDEX idx_lgpd_trat_risco  ON lgpd_tratamentos(alto_risco) WHERE ativo;

CREATE TRIGGER trg_lgpd_trat_touch
  BEFORE UPDATE ON lgpd_tratamentos
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE lgpd_tratamentos ENABLE ROW LEVEL SECURITY;

-- Leitura para qualquer autenticado: o ROPA é instrumento de
-- transparência, esconder dele o próprio servidor seria contrassenso.
-- Não vai para `anon` — o que é público ao cidadão é a Política de
-- Privacidade (Fase 2), redigida para leitura leiga, não o inventário
-- técnico com nome de tabela.
CREATE POLICY lgpd_trat_select ON lgpd_tratamentos FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY lgpd_trat_write ON lgpd_tratamentos FOR ALL
  USING (EXISTS (
    SELECT 1 FROM usuarios u
     WHERE u.id = auth.uid()
       AND u.perfil IN ('super_admin', 'gestor')
       AND u.ativo
  ));

-- ── Seed: o inventário levantado nas 100 tabelas do banco ──────
INSERT INTO lgpd_tratamentos
  (codigo, nome, modulo, finalidade, base_legal, base_legal_detalhe,
   categorias_titulares, categorias_dados, dado_sensivel, dado_de_menor,
   origem, origem_detalhe, tabelas, retencao_meses, retencao_criterio,
   compartilhamento, transferencia_internacional, alto_risco, observacoes)
VALUES

('TRAT-001', 'Contas de acesso ao SIGUC', 'nucleo',
 'Autenticar servidores e controlar permissões de acesso aos módulos do sistema.',
 'politica_publica', 'Art. 7º, III — execução de política pública de gestão ambiental; o controle de acesso é condição para operar o sistema.',
 ARRAY['servidores públicos','colaboradores'],
 ARRAY['nome completo','e-mail institucional','telefone','perfil de acesso'],
 false, false, 'coleta_terceiro', 'Cadastro feito pela administração do sistema.',
 ARRAY['usuarios','usuario_permissoes','usuario_ucs_extras'],
 NULL, 'Enquanto durar o vínculo; a conta é inativada, não excluída, para preservar a integridade referencial da trilha de auditoria.',
 'Não há compartilhamento externo.', false, false, NULL),

('TRAT-002', 'Trilha de auditoria de acessos', 'nucleo',
 'Registrar tentativas de login, bloqueios e acessos para segurança da informação e prestação de contas.',
 'obrigacao_legal', 'Art. 7º, II — combinado com o dever de guarda documental (Lei 8.159/1991) e com o Art. 46 da LGPD (medidas de segurança).',
 ARRAY['servidores públicos'],
 ARRAY['e-mail','endereço IP','user-agent','data/hora'],
 false, false, 'geracao_automatica', 'Gerado pelo próprio sistema a cada tentativa de acesso.',
 ARRAY['auditoria_acessos'],
 60, 'Expurgo automático aos 5 anos (job pg_cron lgpd-retencao-auditoria, migration 209).',
 'Não há compartilhamento externo.', false, false,
 'A função de expurgo existia desde a migration 042 mas só passou a ser executada na 209.'),

('TRAT-003', 'Cadastro funcional da equipe', 'nucleo',
 'Manter o quadro de servidores lotados nas unidades e a estrutura de cargos e ocupações.',
 'politica_publica', 'Art. 7º, III — organização administrativa do órgão.',
 ARRAY['servidores públicos'],
 ARRAY['nome','matrícula','lotação','cargo'],
 false, false, 'coleta_terceiro', 'Informado pela área de gestão de pessoas.',
 ARRAY['equipe_servidores','cargos','cargo_ocupacoes','unidades_organizacionais','delegacoes_temporarias'],
 NULL, 'Guarda permanente — compõe o histórico institucional de ocupação de cargos.',
 'Publicidade de atos de nomeação segue o regime do Diário Oficial.', false, false, NULL),

('TRAT-004', 'Cadastro de brigadistas', 'brigadas',
 'Gerir a composição das brigadas de combate a incêndio florestal, com identificação, habilitação e contato de emergência.',
 'politica_publica', 'Art. 7º, III — política pública de prevenção e combate a incêndios florestais.',
 ARRAY['brigadistas'],
 ARRAY['nome','CPF','RG','CNH','data de nascimento','telefone','e-mail','foto','contato de emergência'],
 false, false, 'coleta_terceiro', 'Cadastro feito pela coordenação da brigada.',
 ARRAY['brigadistas','equipes_brigada'],
 60, 'Vínculo ativo + 5 anos após o desligamento (prazo de eventual responsabilização e comprovação de atuação).',
 'Pode ser compartilhado com o CBMAC em operações integradas.', false, false,
 'Foto é identificação visual em campo, não biometria — não alimenta reconhecimento facial.'),

('TRAT-005', 'Registros de campo das brigadas', 'brigadas',
 'Documentar ocorrências atendidas, área afetada, fauna resgatada e comprovar a atuação da brigada.',
 'politica_publica', 'Art. 7º, III — execução e comprovação da política de combate a incêndios.',
 ARRAY['brigadistas','terceiros eventualmente retratados em foto'],
 ARRAY['geolocalização','fotografias com marca d''água','data/hora','autoria do registro'],
 false, false, 'coleta_direta', 'Registrado pelo próprio brigadista no app de campo.',
 ARRAY['registros_campo','registro_fauna','areas_incendio_evitado'],
 NULL, 'Guarda permanente — documento de comprovação de política pública ambiental.',
 'Base de relatórios institucionais e prestação de contas.', false, true,
 'ALTO RISCO: associa geolocalização a trabalhador identificado. Exige RIPD e limitação de finalidade — o dado existe para comprovar a ocorrência, não para monitorar o deslocamento do brigadista.'),

('TRAT-006', 'Telemetria de sessão do app Brigadas', 'brigadas',
 'Registrar sessões e atividade no aplicativo de campo para suporte técnico e apuração de integridade dos registros.',
 'politica_publica', 'Art. 7º, III — combinado com o Art. 46 (segurança e rastreabilidade do dado).',
 ARRAY['brigadistas'],
 ARRAY['data/hora de sessão','geolocalização do ping','ações no app'],
 false, false, 'geracao_automatica', 'Gerado pelo aplicativo durante o uso.',
 ARRAY['brigadista_sessoes','brigadista_log_atividade'],
 12, 'Expurgo em 12 meses — prazo suficiente para suporte e apuração; além disso vira vigilância sem finalidade.',
 'Não há compartilhamento externo.', false, true,
 'ALTO RISCO: telemetria de trabalhador. Retenção curta é a principal medida mitigadora.'),

('TRAT-007', 'Participantes de atividades de educação ambiental', 'brigadas',
 'Registrar presença em ações de educação ambiental para comprovação da atividade.',
 'politica_publica', 'Art. 7º, III — execução de política pública de educação ambiental.',
 ARRAY['participantes de atividades','possivelmente crianças e adolescentes'],
 ARRAY['nome','CPF','data de nascimento','sexo','lista de presença digitalizada'],
 false, true, 'coleta_direta', 'Coletado presencialmente em lista de presença.',
 ARRAY['registro_participantes'],
 60, 'Cinco anos — prazo de comprovação da execução da atividade.',
 'Não há compartilhamento externo.', false, false,
 'ATENÇÃO — dado_de_menor marcado como verdadeiro por precaução: a tabela guarda data de nascimento e as atividades de educação ambiental podem envolver escolares, mas isso ainda não foi confirmado pela área. Se confirmado, o Art. 14 exige consentimento específico e destacado de um dos pais ou responsável, e a coleta de CPF de criança precisa ser reavaliada quanto à necessidade (Art. 6º, III). Revisar antes de qualquer nova campanha.'),

('TRAT-008', 'Cadastro de monitores de biodiversidade', 'biomonitor',
 'Gerir os monitores comunitários que atuam no monitoramento de quelônios e demais programas.',
 'politica_publica', 'Art. 7º, III — política pública de conservação da biodiversidade.',
 ARRAY['monitores de biodiversidade'],
 ARRAY['nome','CPF','RG','data de nascimento','telefone','e-mail','foto'],
 false, false, 'coleta_terceiro', 'Cadastro feito pela coordenação do programa.',
 ARRAY['monitores_biodiversidade','grupos_biomonitor'],
 60, 'Vínculo ativo + 5 anos após o desligamento.',
 'Não há compartilhamento externo.', false, false, NULL),

('TRAT-009', 'Registros de biomonitoramento', 'biomonitor',
 'Documentar ninhos, transferências, eclosões, solturas e ocorrências para produção de dados científicos de conservação.',
 'politica_publica', 'Art. 7º, III — política pública de conservação; o dado pessoal aqui é acessório (autoria e localização do registro).',
 ARRAY['monitores de biodiversidade'],
 ARRAY['autoria do registro','geolocalização','fotografias','data/hora'],
 false, false, 'coleta_direta', 'Registrado pelo próprio monitor no app de campo.',
 ARRAY['ninhos_quelonios','transferencias_ninho','eclosoes_ninho','visitas_ninho','solturas_filhotes','ocorrencias_bercario','monitor_bio_sessoes'],
 NULL, 'Guarda permanente — série histórica científica.',
 'Dados agregados podem compor publicações e relatórios científicos, sem identificação do monitor.', false, true,
 'ALTO RISCO pelo mesmo motivo do TRAT-005: geolocalização associada a pessoa identificada.'),

('TRAT-010', 'Cadastro de motoristas', 'frota',
 'Habilitar e controlar os motoristas autorizados a conduzir veículos oficiais.',
 'politica_publica', 'Art. 7º, III — combinado com o dever de controle da frota oficial.',
 ARRAY['motoristas','servidores'],
 ARRAY['nome','CPF','matrícula','telefone','número/categoria/validade da CNH','foto'],
 false, false, 'coleta_terceiro', 'Cadastro feito pela gestão do Setor de Transporte.',
 ARRAY['frota_motoristas','frota_veiculo_motoristas'],
 60, 'Vínculo ativo + 5 anos — prazo de eventual responsabilização por infração ou sinistro.',
 'Compartilhado com o DETRAN em caso de infração de trânsito.', false, false, NULL),

('TRAT-011', 'Viagens, abastecimentos e inspeções com geolocalização', 'frota',
 'Controlar o uso da frota oficial: check-out/check-in de viagem, abastecimento e inspeção veicular.',
 'politica_publica', 'Art. 7º, III — combinado com o dever de prestação de contas do uso de bem e recurso público.',
 ARRAY['motoristas','solicitantes de viagem','passageiros'],
 ARRAY['geolocalização de saída e chegada','fotografias de cupom e hodômetro','quilometragem','data/hora'],
 false, false, 'coleta_direta', 'Registrado pelo motorista no app; a coordenada é capturada silenciosamente no momento da ação.',
 ARRAY['frota_viagens','frota_abastecimentos','frota_inspecoes','frota_inspecao_itens','frota_comunicados_manutencao'],
 60, 'Cinco anos — alinhado ao prazo de prestação de contas ao controle externo.',
 'Prestação de contas ao TCE quando requisitada.', false, true,
 'ALTO RISCO: geolocalização de trabalhador. Mitigação já implantada: a captura é configurável por categoria (frota_config_gps, migration 177), a coordenada nunca aparece no app do motorista — só na mesa — e nunca bloqueia a ação se o GPS falhar.'),

('TRAT-012', 'Pesquisadores e autorizações de pesquisa', 'pesquisa',
 'Processar solicitações de autorização de pesquisa em unidades de conservação e emitir a AAP.',
 'execucao_contrato', 'Art. 7º, V — execução de procedimento a pedido do titular; combinado com o Art. 7º, III quanto ao poder de autorizar pesquisa em UC.',
 ARRAY['pesquisadores externos','equipe de pesquisa'],
 ARRAY['nome','CPF','RG','e-mail','telefone','instituição','documentos do projeto'],
 false, false, 'coleta_direta', 'Informado pelo próprio pesquisador no portal.',
 ARRAY['pesquisadores','pesquisas','pesquisa_equipe','pesquisa_documentos','pesquisa_relatorios','pesquisa_historico','pesquisa_emails'],
 NULL, 'Guarda permanente — a autorização é ato administrativo e o relatório de pesquisa integra o acervo da UC.',
 'A validação pública da AAP por QR expõe apenas número, validade e situação — nunca CPF ou e-mail.', false, false,
 'A view v_aap_publica expunha CPF e e-mail ao público até ser removida na migration 209.'),

('TRAT-013', 'Base do Cadastro Ambiental Rural (CAR)', 'territorial',
 'Cruzar imóveis rurais com limites de unidades de conservação e alertas ambientais para instrução de fiscalização e análise territorial.',
 'politica_publica', 'Art. 7º, III — execução de política pública ambiental e exercício do poder de polícia; o acesso decorre da integração institucional com o SICAR.',
 ARRAY['proprietários e possuidores de imóveis rurais'],
 ARRAY['CPF/CNPJ','identificação do imóvel','perímetro georreferenciado'],
 false, false, 'api_externa', 'Obtido por integração (API) com o SICAR — Sistema Nacional de Cadastro Ambiental Rural.',
 ARRAY['car_dados_locais','car_marcados'],
 NULL, 'Enquanto vigente a integração institucional; o dado é espelho de base federal, atualizado na origem.',
 'Origem federal (SICAR/Serviço Florestal Brasileiro).', false, true,
 'ALTO RISCO por volume e por ser dado de terceiro: são dezenas de milhares de titulares que nunca interagiram com a SEMA-AC, o que torna inviável a informação individual do Art. 9º. A transparência se dá pela Política de Privacidade, que declara a origem, a finalidade e a base legal. Exige RIPD e log de acesso (Fase 4).'),

('TRAT-014', 'Bases de origem florestal (SINAFLOR e DOF)', 'territorial',
 'Acompanhar autorizações de supressão vegetal e transporte de produto florestal para fiscalização.',
 'politica_publica', 'Art. 7º, III — exercício do poder de polícia ambiental.',
 ARRAY['detentores de autorização','emitentes de DOF'],
 ARRAY['CPF/CNPJ','identificação da autorização'],
 false, false, 'api_externa', 'Sincronização periódica com sistemas federais (IBAMA/SINAFLOR).',
 ARRAY['sinaflor_asv','dof_transportes','dof_importacoes'],
 NULL, 'Enquanto vigente a integração; dado espelho de base federal.',
 'Origem federal (IBAMA).', false, false, NULL),

('TRAT-015', 'Ocorrências ambientais', 'ocorrencias',
 'Registrar e acompanhar ocorrências ambientais (incêndio, desmatamento, invasão, entre outras) nas unidades de conservação.',
 'politica_publica', 'Art. 7º, III — execução da política de proteção das unidades de conservação.',
 ARRAY['servidores registrantes','terceiros eventualmente retratados'],
 ARRAY['geolocalização','fotografias','autoria e histórico de tramitação'],
 false, false, 'coleta_direta', 'Registrado por servidor ou originado de alerta automático.',
 ARRAY['ocorrencias','alertas_ambientais'],
 NULL, 'Guarda permanente — pode instruir processo administrativo sancionador.',
 'Pode instruir procedimento junto a órgãos de fiscalização e Ministério Público.', false, false, NULL),

('TRAT-016', 'Notificações e mensageria', 'nucleo',
 'Enviar avisos operacionais (prazos, pendências, alertas) por painel interno, e-mail e notificação push.',
 'politica_publica', 'Art. 7º, III quanto ao aviso operacional; o push depende de permissão explícita do navegador, hipótese de consentimento (Art. 7º, I).',
 ARRAY['servidores','pesquisadores','motoristas','brigadistas'],
 ARRAY['e-mail','identificador do dispositivo (endpoint push)','user-agent'],
 false, false, 'geracao_automatica', 'Gerado pelo sistema; a inscrição push é criada quando o usuário autoriza no navegador.',
 ARRAY['notificacoes','notificacoes_historico','push_subscriptions','frota_notif_preferencias','pesquisa_emails'],
 12, 'Histórico de notificação por 12 meses. A inscrição push é excluída ao ser revogada pelo usuário ou quando o provedor a invalida.',
 'Envio de e-mail por operador (Resend).', true, false,
 'O envio de e-mail transacional passa por operador com infraestrutura no exterior — única transferência internacional mapeada. O banco de dados fica em território nacional (região sa-east-1, São Paulo).');

COMMENT ON TABLE lgpd_tratamentos IS
  'ROPA — Registro das Operações de Tratamento (LGPD Art. 37). A coluna `tabelas` aponta para as tabelas reais que materializam cada tratamento, permitindo auditar o registro contra o schema.';
