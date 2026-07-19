# SIGUC-AC — Sistema de Gestão de Unidades de Conservação do Acre
# Contexto para Claude Code — SEMA-AC / DIMA

## Status do projeto
Stack atual: HTML/JS Vanilla + Supabase. Não migrar para Next.js.
Sistema já tem login, sidebar, layout e páginas funcionando.

## Stack confirmada
- Frontend: HTML5 + JS Vanilla (sem framework)
- Estilo: CSS puro com design system próprio
- Banco: Supabase + PostGIS
- Auth: Supabase Auth (sessionStorage; app Brigadas usa cliente isolado
  com sessão persistente em localStorage, protegida por PIN)
- Deploy: Vercel | Testes: Playwright

## Estrutura de pastas
- index.html → tela de login
- pages/ → dashboard, mapa, unidades, monitoramento, ocorrencias,
  documentos, relatorios, equipe, usuarios, historico-acessos, trocar-senha
  - App Brigadas: brigada.html (app de campo), brigadas.html e
    admin-brigadas.html (gestão), relatorios-brigadas.html,
    instalar-brigadas.html (página pública de instalação/atualização)
  - Frota (Setor de Transporte): DUAS superfícies para o MESMO fluxo
    de solicitar/aprovar viagem — páginas web de mesa
    (frota-solicitar.html solicita, frota-viagens.html aprova/recusa)
    E o app unificado de campo/mobile frota-app.html (modos
    solicitante/motorista/gestor, PWA instalável via
    instalar-frota.html, sem shell Capacitor ainda). Gestão de frota:
    frota-veiculos.html, frota-manutencao.html, frota-tarefas.html.
    Abastecimento: motorista registra o evento físico no frota-app.html
    (modo motorista, offline-first); gestão valida e classifica em
    frota-abastecimentos.html (contrato/fonte — motorista nunca vê).
    Cadastro de fontes de recurso e contratos: frota-contratos.html.
    Ver regra de duplicação obrigatória em "Regras de desenvolvimento".
- js/ → config.js, layout.js, mapa-cartografia.js, observability.js,
  queryLogger.js; brigada-offline.js (IndexedDB), brigada-sync.js,
  brigada-captura.js (câmera/GPS/marca d'água), brigada-fauna.js
- css/ → sidebar.css, brigada.css (app de campo)
- data/ → uc_acre.geojson, uc_zonas_acre.geojson, uc_detalhes.json,
  municipios_acre.geojson, ti_acre.geojson
- pwa/ → sw.js (service worker; subir CACHE a cada mudança web),
  manifest.json, icons/mascote.png, icons/mascote-copa.png, mascote-video.mp4
- supabase/migrations/ → 001…060 (ver "Banco")
- api/ → health.js, metrics.js
- app/ → shell nativo Capacitor do Brigadas (APK Android gerado pelo
  workflow brigadas-apk.yml a partir dos mesmos arquivos web;
  build via app/scripts/build-www.mjs — ver docs/app-brigadas.md;
  alterações sempre nos arquivos web)
- app-biomonitor/ → shell nativo Capacitor do Biomonitor (APK Android
  gerado pelo workflow biomonitor-apk.yml a partir de pages/biomonitor.html
  + js/biomonitor-*.js; appId br.gov.ac.sema.siguc.biomonitor — convive com
  o Brigadas; build via app-biomonitor/scripts/build-www.mjs —
  ver docs/app-biomonitor.md; alterações sempre nos arquivos web)

## Design system (nunca alterar variáveis sem alinhamento)
--floresta:#0A1A0F | --verde-c:#52B788 | --ouro:#C9A84C | --ouro-c:#F0CB6A
--t1:#F4EFE6 | Fontes: Fraunces (títulos) + DM Sans (UI)

## Banco — migrations aplicadas
001_initial.sql: usuarios, unidades_conservacao (PostGIS), ocorrencias,
monitoramento_indicadores, monitoramento_registros, documentos,
equipe_servidores. RLS em todas. Trigger touch_atualizado_em().

002_auditoria_acessos.sql: auditoria_acessos, bloqueio após 5 tentativas,
funções verificar_bloqueio() e registrar_tentativa_acesso().

Brigadas/registros de campo (042–060). Principais:
- 042–044: brigadas, brigadistas (funcao, status, foto_url, usuario_id…)
- 045–046: registros_campo + registro_fauna + especies_fauna
- 047/053: VIEW vw_registros_validacao (usada nos relatórios)
- 049: auditoria/sessões do brigadista
- 050: is_chefe_brigada() SECURITY DEFINER (evita recursão de RLS)
- 058_equipes_brigada.sql: tabela equipes_brigada (A/B/C, lider_id),
  brigadistas.equipe_id, registros_campo.equipe_id + duracao_horas;
  trigger preenche registros_campo.equipe (texto) pelo equipe_id;
  seed A/B/C por brigada + trigger ao criar brigada; view atualizada
- 059_rpc_desempenho_brigada.sql: RPC app_desempenho_brigada(desde,ate)
  SECURITY DEFINER → agregados da brigada do chamador (totais, por
  equipe, por brigadista) sem expor linhas (usada na aba Dados do app)
- 060_origem_acionamento.sql: enum origem_acionamento
  (denuncia_193|informacao_populares|ronda_brigada|outro) +
  registros_campo.origem_acionamento; view atualizada

Frota — abastecimento (174–175):
- 174_frota_fontes_contratos.sql: frota_fontes_recurso (orçamentária/
  não orçamentária), frota_contratos_combustivel (1 contrato → 1
  fonte; valor_global só referência, sem controle de saldo na v1).
  Cadastro de mesa (frota-contratos.html), RLS pode_ver/pode_editar.
- 175_frota_abastecimentos.sql: frota_abastecimentos (evento físico
  do motorista + campos de validação da gestão), código
  ABAST-AAAA-NNNN (trigger, molde da 168); RPCs
  frota_registrar_abastecimento (motorista, idempotente por
  uuid_cliente, molde da 173 — nunca aceita contrato/status do
  cliente), frota_validar_abastecimento (gestão, exige contrato_id),
  frota_rejeitar_abastecimento (gestão); view
  vw_frota_abastecimentos_detalhe (SECURITY INVOKER, padrão 165);
  bucket frota-abastecimentos (fotos de cupom/hodômetro).
- 176_frota_localizacao_gps.sql: geometry(Point,4326) + GIST em
  frota_viagens (localizacao_saida/localizacao_chegada) e
  frota_abastecimentos (localizacao); parâmetros p_lat/p_lng
  (DEFAULT NULL) em frota_checkout_viagem, frota_checkin_viagem,
  frota_abrir_viagem_direta e frota_registrar_abastecimento; views
  expõem lat/lng extraídos (ST_Y/ST_X, padrão 047/053). Ver regra do
  sistema abaixo.
- 177_frota_config_gps.sql: tabela singleton frota_config_gps
  (captura_viagens/captura_abastecimento, RLS SELECT autenticado /
  UPDATE pode_editar('frota')), trigger preenche atualizado_por/em.
  Liga/desliga a regra de captura de GPS por categoria — ver seção
  abaixo.
- 178_frota_fix_overload_gps.sql: corrige overload duplicado que a
  176 deixou no banco (CREATE OR REPLACE com lista de parâmetros
  diferente cria função nova em vez de substituir — mesmo cuidado que
  a 173 já tomava com DROP FUNCTION antes de recriar). Sem isso,
  chamadas às RPCs de viagem/abastecimento sem p_lat/p_lng dão "could
  not choose best candidate function". A 176 já foi corrigida no
  arquivo para não repetir o erro em bases novas.
- 179_frota_revoke_trigger_functions.sql: revoga EXECUTE de
  frota_gerar_codigo_abastecimento e
  frota_marcar_atualizador_config_gps (só devem rodar via trigger,
  nunca chamadas direto pelo cliente) — achado pelo advisor de
  segurança do Supabase, mesmo padrão da 165.
- 180_frota_abastecimento_trava_veiculo.sql: frota_registrar_abastecimento
  passa a rejeitar p_veiculo_id diferente do veículo da viagem
  em_andamento do motorista (quando existir) — trava de servidor,
  segunda camada da regra abaixo.
- 181_frota_fix_checkin_regressao.sql: corrige regressão que a 176
  introduziu em frota_checkin_viagem — ao recriar a função pra
  adicionar localizacao_chegada/p_lat/p_lng, usei o corpo original da
  155 em vez do já corrigido pela 169, perdendo o cast explícito
  ::status_veiculo_frota no CASE que define o status do veículo (erro
  "column status is of type status_veiculo_frota but expression is of
  type text", impedindo TODO check-in) e a chamada a
  frota_checar_manutencao_veiculo() ao final. Lição: ao recriar uma
  RPC pra adicionar parâmetro, sempre partir do CREATE OR REPLACE mais
  recente (não do original), e testar os dois ramos de qualquer CASE
  antes de aplicar em produção.

## Relatórios de consumo de combustível
Consumo médio calculado no cliente (sem RPC/view nova) pelo método
"tanque cheio a tanque cheio": entre 2 abastecimentos consecutivos do
mesmo veículo com tanque_cheio=true, os litros do 2º representam o
combustível gasto na distância (ou horas) entre os dois — precisa de
pelo menos 2 abastecimentos com tanque cheio pra aparecer. Km/L para
hodômetro, L/h para horímetro (embarcações).
- App do motorista (frota-app.html, aba Dados → fmResumoCombustivel):
  números do próprio motorista, por veículo usado. Conta abastecimentos
  pendentes+validados (rejeitados ficam fora — dado contestado).
- Mesa (frota-veiculos.html, aba "Consumo" no cadastro do veículo →
  carregarConsumoVeiculo): só abastecimentos VALIDADOS (mesma regra do
  restante do módulo — contrato/fonte já classificados pela gestão).
Os dois pontos usam vw_frota_abastecimentos_detalhe (já traz
litros_final/valor_final ajustados e placa/modelo/medidor).

## Regra do sistema — trava de veículo no abastecimento
O abastecimento nunca deve poder ser lançado num veículo diferente do
que o motorista está de fato usando. Defesa em 2 camadas:
1. App (frota-app.html, fmViagemAtivaDoMotorista): antes de abrir o
   modal de abastecimento — de qualquer entrada (Início, aba Viagem,
   ou card da viagem) — detecta se o motorista tem viagem
   em_andamento (inclusive check-out feito offline, ainda não
   sincronizado, consultando a fila local). Se achar, trava o veículo
   (esconde o seletor). Só mostra o seletor livre quando não há
   nenhuma viagem em andamento — nesse caso, exclui da lista veículos
   em_manutencao/baixado (carregarVeiculosAtivosAbastecimento).
2. Banco (frota_registrar_abastecimento, migration 180): valida de
   novo, server-side — se o motorista tem viagem em_andamento, o
   veículo enviado TEM que ser o dela, senão rejeita. Protege contra
   cache desatualizado ou qualquer chamada fora do fluxo da tela.
Qualquer novo ponto de entrada de abastecimento no app deve chamar
abrirAbastecimento (que já aplica a trava) em vez de montar o modal
na mão.

## Regra do sistema — localização GPS em Frota (configurável)
Toda viagem (check-out e check-in, inclusive viagem avulsa) e todo
abastecimento capturam a localização do aparelho no momento da ação.
Captura é feita no app (frota-app.html, função `fmObterGps`), de forma
silenciosa e melhor esforço — sem tela própria, sem watchPosition em
segundo plano, e NUNCA bloqueia a ação se o GPS falhar, for negado ou
demorar (timeout de 6s; segue com lat/lng null). A coordenada só é
exibida na plataforma de mesa (frota-viagens.html,
frota-abastecimentos.html — função `linkMapa`, link para o Google
Maps), nunca no app do motorista. Qualquer nova ação do motorista que
"inicie" ou "encerre" algo no módulo Frota deve seguir essa mesma
regra — capturar via `fmObterGpsSeAtivo` e persistir a coordenada.

Liga/desliga por categoria (177_frota_config_gps.sql): tabela singleton
`frota_config_gps` (captura_viagens / captura_abastecimento), editável
só por quem edita 'frota'. Toggle na mesa: card no topo de
frota-viagens.html (viagens: checkout/checkin/avulsa) e de
frota-abastecimentos.html (abastecimento) — independentes entre si. O
app lê e cacheia essa config no IndexedDB (fmAtualizarConfigGps,
refeita a cada tick de sync de 45s); fail-safe = true sempre que não
houver linha, cache ou conexão — a captura só fica desligada depois
que a config "desligada" chegou ao aparelho pelo menos uma vez. Quando
desligada, o app nem solicita permissão de geolocalização
(fmObterGpsSeAtivo curto-circuita antes de chamar fmObterGps).

## Enums do banco
perfil_usuario: super_admin | gestor | tecnico | financeiro | visualizador
categoria_uc: PI|REBIO|ESEC|MONA|RVS|FLONA|RESEX|RDS|RPPN|APA|ARIE
grupo_uc: protecao_integral | uso_sustentavel
esfera_uc: federal | estadual | municipal | privada
status_uc: criada|regularizada|em_regularizacao|decreto_suspenso|em_revisao
severidade_ocorrencia: critica|alta|media|baixa
tipo_ocorrencia: incendio|desmatamento|invasao|caca_pesca_ilegal|
  mineracao_ilegal|contaminacao|especie_invasora|outro
status_ocorrencia: aberta|em_atendimento|resolvida|arquivada

## Helpers globais (js/config.js)
db, appState.usuario, appState.perfil, t(), esc(), formatBRL(),
formatNum(), formatData(), toast(), carregarUsuario(), iniciais(),
BADGE_CATEGORIA, BADGE_SEVERIDADE, BADGE_STATUS_OC, BADGE_STATUS_UC
Ícones: BICON_PATHS, bico('nome'), bIconsAplicar(root) (ver Regras).

## Estrutura organizacional SEMA-AC
Separação CARGO (permanente) x OCUPANTE (substituível por portaria).

Hierarquia institucional:
visualizador < tecnico < gestor < super_admin
pesquisador_externo < analista_uc < gestor_uc < chefe_deuc < diretor_dima < secretario

Pessoas chave:
- Secretário: Leonardo das Neves Carvalho
- Diretor DIMA: Erisson Cameli Santiago

Unidades: SECRETARIA > DIMA > DEUC | CIGMA | JURÍDICO

## Módulos — situação

### Já implementado
- Login + auth Supabase
- Sidebar + layout compartilhado (gerarLayout)
- Páginas: todas as listadas em pages/
- Auditoria de acessos com bloqueio
- GeoJSONs do Acre

### App Brigadas (campo) — implementado
- Offline-first (IndexedDB) + sync; login Supabase + PIN; câmera/GPS/
  marca d'água; catálogo de espécies; auditoria de sessão.
- Registro de ocorrência: atividade, "Acionada por?"
  (origem_acionamento), equipe, horário (início/término →
  duracao_horas calculada e persistida), apoio do CBMAC
  (integrada_cbmac; só em natureza combate), área, fotos (até 5)
  e fauna.
- Fotos: câmera nativa do SO (input capture) + galeria; no APK usa o
  plugin Capacitor Camera (CAMERA/PHOTOS). Marca d'água sempre aplicada.
- Equipes A/B/C: equipe é atributo do brigadista; no app o seletor fica
  na tela inicial (ao lado do nome), pré-preenchido e trocável; gestão
  (renomear/líder/criar/excluir) em admin-brigadas.html.
- Tela inicial: foto do brigadista (avatar) com borda "liquid glass";
  tocar → menu (ver em tela cheia / trocar foto por galeria ou câmera).
  Nome em Arial; brigada e equipe como chips.
- Fila de envio: tamanho do arquivo, nº de fotos, data/hora da ocorrência
  e do envio; mostra os 6 últimos com "Ver mais".
- Aba Dados: resultados individuais + desempenho da brigada (totais,
  ranking por equipe e por brigadista) via RPC app_desempenho_brigada.
- Relatórios (relatorios-brigadas.html): ranking de equipes por
  registros/área/fauna resgatada/horas.
- Config: QR de instalação (aponta para
  siguc-ac.vercel.app/pages/instalar-brigadas.html), verificar
  atualização, alterar PIN, catálogo, zerar fila, sair.
- Atualização: aviso automático (banner + pontinho no Config). Web/PWA
  via ciclo do service worker (handler SKIP_WAITING no sw.js); APK
  compara com GitHub Releases (1×/dia) e oferece download do APK.
- Modo Copa (sazonal): de 11/06 a 19/07/2026 troca o mascote por
  icons/mascote-copa.png (fallback seguro p/ mascote.png) com brilho
  dourado. Controlado em brigada.html (ehModoCopa/aplicarMascoteCopa).

### A implementar (ordem de prioridade)
A) Estrutura Organizacional → 003_estrutura_organizacional.sql
   Tabelas: unidades_organizacionais, cargos, cargo_ocupacoes,
   delegacoes_temporarias. VIEW cargos_atuais.

B) Alertas Ambientais → 005_alertas_ambientais.sql
   Fontes: DETER-B, BDQueimadas, FIRMS, PRODES
   Cron 06h BRT + cruzamento PostGIS ST_Within + e-mail ao gestor

C) Painel do Gestor (Inbox de notificações)
   Status: GERADA→ENVIADA→VISUALIZADA→EM_ANÁLISE→ENCAMINHADA→RESOLVIDA
   SLA automático + escalamento hierárquico

D) Gestão de Pesquisa (13 etapas)
   Submissão → triagem → análise → AAP (PDF+QR) → execução → relatórios
   Integração SISBIO/SISGEN. Bloqueio por inadimplência.

E) Dashboard Executivo por nível (UC / Diretoria / Secretaria)

## Versionamento (OBRIGATÓRIO — vale para TODA sessão)
- `pwa/sw.js` é um único arquivo compartilhado pelos 3 PWAs (Brigadas,
  Biomonitor, Frota), mas cache e versão são ISOLADOS por app: cada
  página registra o SW com `scope` próprio (`/pages/brigada.html`,
  `/pages/biomonitor.html`, `/pages/frota-app.html`), e o SW deriva
  `APP` do `self.registration.scope` para escolher o app shell e o
  nome do cache (`siguc-<app>-vN`). O objeto `VERSOES` no topo do
  arquivo guarda o contador de cada um.
- A CADA implementação concluída, ANTES do commit/deploy, INCREMENTAR
  em `pwa/sw.js` SÓ o contador do app que a entrega tocou (vN → vN+1
  dentro de `VERSOES.brigadas`, `VERSOES.biomonitor` ou
  `VERSOES.frota`) — não mexer nos outros dois. Se a entrega tocar
  mais de um app (ex.: um JS compartilhado como `js/config.js` ou
  `brigada-captura.js`, usado por Brigadas E Biomonitor), incrementar
  todos os apps afetados.
- Isso invalida o cache do service worker daquele app e garante que os
  aparelhos (web/PWA e app de campo) recebam a versão nova. Sem isso,
  os usuários continuam vendo a versão antiga.
- Obrigatório sempre que a entrega tocar arquivos web (HTML/JS/CSS/PWA)
  daquele app específico. Entregas só de banco/migrations (sem
  arquivos web) dispensam o incremento — na dúvida, incremente.
- Se adicionar/remover arquivo do app shell de um app, atualizar
  também a lista correspondente em `SHELLS` (mesmo arquivo).
- Mencionar a nova versão no commit (ex.: "sw.js: biomonitor v1 → v2").
- Esta regra é permanente e deve ser seguida em todas as sessões, sem
  precisar ser solicitada novamente.

## Regras de desenvolvimento
- VERSIONAMENTO: a cada implementação concluída, subir a versão do cache
  do(s) app(s) afetado(s) em `pwa/sw.js` (vN → vN+1) — ver seção
  "Versionamento" acima.
- Manter design system — nunca alterar variáveis CSS sem alinhamento
- Novos JS em js/ seguindo padrão do projeto
- Novas páginas em pages/ com gerarLayout() obrigatório
- Novas tabelas sempre com RLS habilitado
- Migrations numeradas sequencialmente
- Funções SQL com SECURITY DEFINER quando acessam auth.*
- Commits em português, pequenos e descritivos
- NUNCA expor SERVICE_ROLE_KEY no frontend
- ÍCONES: nunca usar emoji em UI (botões, chips, navegação, marcadores
  de lista). Padrão único = SVG de traço 24×24, fill none, stroke
  currentColor, stroke-width 2, cantos arredondados (estilo Feather/
  Lucide), registrado em js/config.js (BICON_PATHS). Em HTML estático
  use data-icon="nome" (bIconsAplicar injeta); em JS use bico('nome').
  Ícone novo = adicionar um path no MESMO estilo em BICON_PATHS.
- APK Android (workflows brigadas-apk.yml e biomonitor-apk.yml): NÃO gerar
  novo APK a cada mudança. Só gerar quando o usuário pedir ou quando já
  houver acúmulo suficiente para valer a pena. Mudanças web/PWA podem ir à
  produção normalmente (lembrar de subir a versão do cache em pwa/sw.js).
- DUPLICAÇÃO OBRIGATÓRIA — Frota tem o MESMO fluxo em duas superfícies
  (páginas web de mesa E o app unificado frota-app.html). Qualquer
  mudança FUNCIONAL num dos pares abaixo (alerta novo, validação nova,
  campo novo, RPC nova chamada na aprovação/solicitação etc.) tem que
  ser replicada no outro par na MESMA entrega — nunca só um lado.
  Antes de marcar a tarefa como concluída, checar explicitamente se o
  par existe e foi tocado:
  - Solicitar viagem: `frota-solicitar.html` ⇄ `frota-app.html` (modo
    solicitante, função `renderModoSolicitante`)
  - Aprovar/recusar viagem: `frota-viagens.html` ⇄ `frota-app.html`
    (modo gestor, funções `abrirAprovar`/`confirmarAprovar`)
  Esse padrão de "página de mesa" + "app unificado" cobrindo o mesmo
  fluxo tende a se repetir conforme o módulo Frota crescer — ao criar
  uma tela nova de mesa que já tenha equivalente no app (ou vice-versa),
  aplicar a mesma regra e documentar o par aqui.
  EXCEÇÃO por decisão de produto — Abastecimento: o par não é
  simétrico. REGISTRO do evento físico (litros/valor/fotos) só existe
  no app (`frota-app.html`, modo motorista, função
  `confirmarAbastecimento`) — motorista não tem acesso de mesa.
  VALIDAÇÃO/classificação por contrato só existe na mesa
  (`frota-abastecimentos.html`, funções `confirmarValidar`/
  `confirmarRejeitar`) — não replicada no modo gestor do app na v1
  (decisão registrada ao criar o fluxo). Se "lançar abastecimento"
  for adicionado a uma tela de mesa, ou "validar" for adicionado ao
  app, replicar nos dois lados na mesma entrega, como nos pares acima.

## Variáveis de ambiente
SUPABASE_URL=https://atqtybcsvepdabsvgaly.supabase.co
SUPABASE_ANON_KEY=(pública, já em config.js)
SUPABASE_SERVICE_ROLE_KEY=(somente Edge Functions, nunca no frontend)
RESEND_API_KEY=(e-mail de alertas)
PLANET_API_KEY=(Planet/NICFI Basemaps; só no servidor — usada pelos
  proxies /api/planet-tiles e /api/planet-mosaics. Nunca no frontend)

## Próxima tarefa
Módulo A — Estrutura Organizacional SEMA-AC
Criar migration 003_estrutura_organizacional.sql + página admin de gestão de cargos
