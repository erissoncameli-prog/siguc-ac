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
    Checklist de inspeção (DVIR): o motorista confere itens no app
    antes do check-out (e no check-in, para os itens marcados); item
    reprovado vira comunicado de defeito no funil que já existia.
    Catálogo e histórico em frota-inspecoes.html.
    frota-administrar.html reúne Manutenção/Abastecimentos/Contratos/
    Veículos e Motoristas/Inspeções em abas (a única entrada no menu
    lateral) —
    cada aba é a página correspondente carregada num iframe com
    `?embed=1` (gerarLayout, js/layout.js, retorna só o conteúdo, sem
    duplicar sidebar/topbar); as 5 páginas continuam existindo e
    funcionando sozinhas, só não têm mais link direto na sidebar.
    O CSP padrão do site é `frame-ancestors 'none'` (vercel.json, anti-
    clickjacking) — essas 5 páginas têm um bloco de headers próprio no
    vercel.json com `frame-ancestors 'self'` + `X-Frame-Options:
    SAMEORIGIN`, senão o navegador bloqueia o iframe. Qualquer página
    nova que precise ser embutida (mesmo padrão) precisa do mesmo
    carve-out — nunca afrouxar o `frame-ancestors 'none'` global.
    Ver regra de duplicação obrigatória em "Regras de desenvolvimento".
- js/ → config.js, layout.js, mapa-cartografia.js, mapa-recorte.js
  (limite do Acre + ponto-em-UC), observability.js,
  queryLogger.js; brigada-offline.js (IndexedDB), brigada-sync.js,
  brigada-captura.js (câmera/GPS/marca d'água), brigada-fauna.js;
  frota-consumo.js, frota-passageiros.js, frota-viagens-status.js
  (status efetivo + blocos da lista de viagens)
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
- app-frota/ → shell nativo Capacitor do Frota (APK Android gerado pelo
  workflow frota-apk.yml a partir de pages/frota-app.html; appId
  br.gov.ac.sema.siguc.frota — convive com Brigadas e Biomonitor; build via
  app-frota/scripts/build-www.mjs — ver docs/app-frota.md; alterações
  sempre nos arquivos web)
- app-agua/ → shell nativo Capacitor da Qualidade da Água (APK Android,
  ver docs/app-agua.md — a partir de pages/agua-app.html +
  js/agua-offline.js + js/agua-sync.js; appId br.gov.ac.sema.siguc.agua
  — convive com Brigadas/Biomonitor/Frota; build via
  app-agua/scripts/build-www.mjs; alterações sempre nos arquivos web)

## Design system (nunca alterar variáveis sem alinhamento)
--floresta:#0A1A0F | --verde-c:#52B788 | --ouro:#C9A84C | --ouro-c:#F0CB6A
--t1:#F4EFE6 | Fontes: Fraunces (títulos) + DM Sans (UI)

### Regra do sistema — fonte dos números de KPI: nunca Fraunces
Pedido explícito do usuário: Fraunces (`--font-display`, a serifada de
título do design system) NUNCA deve aparecer nos NÚMEROS de card de
KPI (o valor grande — "365", "24 dias" etc.) — o usuário achou o
efeito "cara pura de IA" ao ver os KPIs de Qualidade da Água
(`js/agua-laudo-kpis.js`, cards `.adash-num` + centro da rosca de
"Situação da série"). Corrigido com DM Sans (`var(--font-sans)`) nos
dois lugares — `.adash-num` recebe `style` inline nesse arquivo, e
`_aguaRoscaHTML` (`js/agua-iqa-visual.js`) ganhou o parâmetro
`fonteCentro` para o texto central do donut, com Fraunces como padrão
só para preservar o uso ANTIGO (faixa do IQA, `aguaIqaFaixasRoscaHTML`
— não tocado por este pedido).
- **Escopo da regra**: só o VALOR do KPI (o número grande). Títulos de
  card, cabeçalhos de página e o resto do design system (Fraunces em
  `.pf-nome`, `.sidebar-brand-logo` etc.) continuam como estavam —
  isto não é uma revisão geral de tipografia, é a reação a um caso
  específico que o usuário viu e não gostou.
- Qualquer KPI NOVO (novo módulo, novo painel) que mostre um número
  grande em destaque segue esta regra desde o nascimento: nunca
  Fraunces no valor, DM Sans (`var(--font-sans)`) por padrão.

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

Mapa/alertas:
- 239_limite_acre_recorte.sql: limite_acre (singleton PostGIS),
  geo_ponto_no_acre(lat,lon) e trigger que descarta ponto fora do
  estado em focos_calor/alertas_ambientais. Geometria carregada por
  pg_net, em passo separado — ver "Regra do sistema — recorte pelo
  limite do Acre".

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
- 196–205 (endurecimento + Fases 1 a 6 do plano em
  docs/frota-analise-e-plano.md — ler o cabeçalho de cada uma):
  196/197 fecham a superfície anônima (zero função frota_* SECURITY
  DEFINER executável por anon); 198 torna check-out/check-in
  idempotentes por uuid_cliente (fim da pílula envenenada na fila
  offline); 199/200 tornam os buckets do Frota privados, com leitura
  por signed URL (js/fotos-privadas.js) e escrita restrita; 201 impede
  escalar motorista com viagem vencida sem check-in
  (vw_frota_viagens_vencidas); 202 expõe motorista_telefone na
  vw_frota_viagens_detalhe; 203/204 são o checklist de inspeção (DVIR)
  — a inspeção viaja DENTRO do check-out/check-in, nunca como chamada
  separada; 205 alerta vencimento de documento e CNH por pg_cron
  (frota_checar_vencimentos + vw_frota_vencimentos).
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

## Notificações no APK Android (Frota) — sem FCM
O Web Push (PushManager/VAPID, `pages/frota-app.html` + `pwa/sw.js` +
`api/push-send.js`, migrations 164/191/208) funciona em Safari/PWA e
navegadores, mas NUNCA entrega nada dentro do APK gerado pelo
Capacitor — a WebView não tem processo de push nativo por trás (exigiria
Firebase Cloud Messaging, app registrado, credenciais novas na Vercel;
não implementado). Sem isso, `estadoPush()` no APK sempre cai em
'indisponivel' e o Config mostrava "Notificações indisponíveis neste
dispositivo" mesmo com o usuário querendo ativar.
Solução adotada, sem infraestrutura nova: `js/frota-notif-local.js` +
plugin `@capacitor/local-notifications` (só existe dentro do APK —
`fmNotifNativaDisponivel()` guarda tudo; fora do APK essas funções são
no-op e o Web Push de sempre continua valendo).
- **Lembretes de viagem (2h/1h/30min antes)**: AGENDADOS no aparelho
  (AlarmManager) com a hora exata, sempre que `carregarViagensMotorista`/
  `carregarMinhasViagens` carregam a lista — entrega garantida mesmo com
  o app fechado, porque não depende de o processo estar vivo. Mesmas
  janelas do cron server-side (migration 208), IDs derivados por hash
  (viagem+janela+papel) para poder cancelar o que não se aplica mais.
  Reagenda sozinho depois de reboot do aparelho (o plugin já cuida
  disso — `LocalNotificationRestoreReceiver` no manifest dele).
- **Outros avisos** (aprovação/recusa de viagem etc., tabela
  `notificacoes`): notificados na hora durante o tick de sync de 45s que
  já existia (`instalarGatilhosSyncFrota`) — só chegam com o app
  aberto/recente, teto do que dá sem FCM.
- Config do app: `atualizarItemPushConfig` ramifica por
  `fmNotifNativaDisponivel()` — no APK usa `estadoNotifNativa`/
  `ativarNotifNativa` (permissão nativa de notificação do Android); fora
  dele, `estadoPush`/`ativarPushFrota` (Web Push) como sempre.
  `itemPushConfig(estado, acaoAtivar)` ganhou o 2º parâmetro pra isso.
- Se FCM for implementado no futuro (entrega instantânea com app morto),
  isso continua valendo por cima — os lembretes agendados localmente
  cobrem até cenário offline, que nem FCM cobre.
- `app-frota/scripts/build-www.mjs`: novo arquivo entra em `ARQUIVOS_JS`.
  `pwa/sw.js`: `SHELLS.frota` ganha o arquivo, frota v70 → v71.
- **Achado ao testar em produção**: `verificarAtualizacaoFrota()` (Config
  → Verificar atualização) só sabia checar o ciclo do service worker
  (comentário antigo dizia "PWA, sem shell Capacitor ainda" — desatualizado,
  o `app-frota/` já existe). Dentro do APK isso não faz nada (nunca há SW
  registrado — `if ('serviceWorker' in navigator && !window.Capacitor)`),
  então o botão só recarregava a página em silêncio, sem nunca oferecer o
  APK novo. Corrigido no mesmo padrão do Brigadas (`pages/brigada.html`,
  `verificarUpdateAndroid`): no APK, compara `window.FROTA_BUILD` (estampado
  pelo build nativo) com o Release mais novo `frota-v*` no GitHub e oferece
  o `.apk` para download; fora do APK, segue pelo SW como sempre. frota v71
  → v72.

## Regra do sistema — recorte pelo limite do Acre (mapa e alertas)
Alerta e foco de calor só existem no mapa se estiverem DENTRO do
Acre. Não é filtro opcional, não tem toggle: é recorte, sempre ligado.

Causa (medida, não suposta): FIRMS e o WFS do DETER só aceitam
consulta por BOUNDING BOX, e um retângulo em volta do Acre engloba
pedaços de AM, RO, Ucayali (Peru) e Pando (Bolívia). Antes da
correção, 113 de 362 focos FIRMS (31%) e 503 de 1.733 alertas DETER
(29%) gravados não eram do Acre — e apareciam desenhados no mapa. O
BDQueimadas, única fonte que já filtrava de verdade (`estado='ACRE'`),
estava 100% correto: o problema é o bbox, não a fonte.

Geometria em UM lugar só: `js/mapa-recorte.js` (mesma lição do
`js/frota-consumo.js` e do `js/fotos-privadas.js`). Antes,
`pages/mapa.html` e `pages/alertas-ambientais.html` tinham cada um sua
cópia de `_pipGeom` — e nenhuma testava o limite do estado. Nunca
reimplementar PIP numa página.
- API: `geoAcreCarregar()`, `geoNoAcre(lat,lng)`, `geoUCsPreparar(gj)`,
  `geoUCEm(lat,lng)`, `geoClassificar(lista, getLatLng)`,
  `geoLatLngDeGeom(geom)`.
- Desempenho: bbox pré-calculada por anel + classificação feita UMA
  vez na carga (carimba `_noAcre`/`_ucNome`/`_lat`/`_lng` no registro);
  o render só lê o campo. 5.000 focos classificam em ~50 ms. Fazer PIP
  por ponto a cada render trava a página (21 UCs, 49 mil vértices).
- FAIL-OPEN: sem o limite carregado, `geoNoAcre` devolve true — falha
  de rede nunca deve resultar em mapa vazio.

Defesa em 3 camadas (mesmo espírito da trava de veículo do Frota,
migration 180 + app):
1. cliente — `js/mapa-recorte.js`, corrige a tela sem esperar cron;
2. ingestão — `supabase/functions/_shared/acre.ts`, usado por
   `ingest-focos` e `monitorar-alertas`: não gasta escrita com dado que
   será descartado e faz os contadores devolvidos dizerem a verdade;
3. banco — migration 239: `limite_acre` (singleton PostGIS),
   `geo_ponto_no_acre(lat,lon)` e trigger BEFORE INSERT que DESCARTA
   (RETURN NULL) ponto fora do estado em `focos_calor` e
   `alertas_ambientais`. É a garantia dura: vale para qualquer rota de
   ingestão, atual ou futura, sem depender de redeploy.
⚠ A geometria NÃO está embutida na migration (988 vértices, ~21 KB).
É carregada do MESMO arquivo que o cliente usa
(`data/acre_estado.geojson`, servido em produção) via `pg_net`, para
banco e navegador nunca discordarem da divisa. pg_net é assíncrono —
a requisição só sai depois do COMMIT, então a carga é PASSO SEPARADO,
depois de aplicar a migration:
  `SELECT net.http_get('https://siguc-ac.vercel.app/data/acre_estado.geojson');`
  (aguardar) `SELECT limite_acre_carregar();` → depois
  `SELECT limite_acre_limpar_fora();`
`geo_ponto_no_acre` é FAIL-OPEN com `limite_acre` vazia: banco novo se
comporta como antes, nunca rejeitando toda a ingestão por falta do
polígono. Conferir a carga pela área (16,4 milhões de ha).

Filtro dentro/fora de UC vale para TUDO. O rádio `alerta-loc` era lido
só por `renderAlertasMapa` — o rótulo dizia literalmente "Localização
(DETER)" —, então o fogo continuava no mapa inteiro com "Somente
dentro de UCs" ligado. Agora `_filtrarAlertas()`/`_filtrarFocos()` são
a única definição de "o que está no mapa", e o painel-resumo consome
exatamente essas funções (gráficos sempre batem com os marcadores).
Ponto novo de exibição no mapa = usar essas funções, nunca refiltrar
na mão. `_ucNomesEmExibicao()` (não confundir com `_ucNomesVisiveis()`,
que é outra coisa e devolve null sem filtro): com a camada de UCs
desligada, cai para TODAS as UCs — "dentro de UC" é fato geográfico, e
conjunto vazio faria o filtro limpar o mapa sem explicação.

`focos_calor_ac` (953 mil linhas, série histórica 2001-2024) NÃO foi
limpa — apagar ~30% de um arquivo histórico é irreversível. A linha do
tempo recorta esses pontos no cliente (`_tlRenderAno`).

Painel-resumo (`abrirResumoAlertas`, pages/mapa.html): abre junto com a
camada, gráficos em SVG à mão (o projeto não tem lib de gráfico; padrão
já era esse, ver `#usc-donut`).
⚠ NÃO é modal e NÃO tem overlay. Nasceu com um `#resumo-overlay`
cobrindo a viewport (`inset:0`) com onclick de fechar, e isso fazia
duas coisas erradas: fechava a qualquer clique fora E matava o mapa —
arrastar, zoom e clique em marcador não chegavam ao Leaflet. Resumo do
que está no mapa tem de ser lido COM o mapa em uso; é gaveta lateral,
como o `#uc-stats-card`. Fecha só no ✕ ou ao desligar a camada.
Qualquer painel novo que descreva o mapa segue a mesma regra —
overlay de tela cheia só para diálogo que exige decisão.
`fecharResumoAlertas(porEscolha)`: `false` é o fechamento automático ao
desligar a camada e NÃO grava preferência; `true` (o ✕) grava
`siguc_resumo_alertas='0'` e impede a reabertura automática até o
usuário clicar em "Resumo e gráficos" de novo. Largura arrastável pela
alça (`.painel-resize`, 280–600 px, persistida em
`siguc_resumo_largura`) porque a gaveta cobre parte do mapa. Os dois
painéis da direita (resumo e análise por alerta) se alternam — abrir um
fecha o outro, senão empilham. Cores validadas para daltonismo sem
sair das cores dos marcadores: desmatamento #166534 × queimada #EA580C
(ΔE 9,6 protan) e dentro #2F9E5B × fora de UC #F59E0B (ΔE 9,4). NÃO
usar #166534 com #DC2626 (a cor do marcador de queimada) num gráfico:
ΔE 1,6 — indistinguível. Identidade sempre também em rótulo direto +
tabela, nunca só na cor.
Guardas: `tests/mapa-recorte.test.js` (geometria) e
`tests/mapa-resumo-painel.test.js` (painel não-modal). Nos testes, a
gaveta anima 0,28s: esperar o `transform` virar identidade antes de
medir ou clicar, senão o alvo está em movimento.

## Regra do sistema — painéis na tela cheia do mapa
Em `pages/mapa.html`, TODO painel do nível do `<body>` (CAR, PRODES,
projeto de análise, análise do alerta, painel-resumo, barra de
progresso) sumia no modo imersivo. Eram DUAS causas independentes —
corrigir só uma não resolvia:
1. **Empilhamento**: `.mapa-wrapper.imersivo` tinha `z-index:2000` e os
   painéis vão de 600 a 800. O wrapper pintava por cima, e isso
   acontecia ANTES de qualquer fullscreen — por isso o sintoma aparecia
   até no Safari do iPad, que não tem `requestFullscreen` fora de
   `<video>`. Agora o wrapper é `z-index:300`: ele só precisa cobrir a
   sidebar (100; 200 no mobile). **Manter a faixa 600–800 livre** é o
   que faz painel novo aparecer sem entrar em lista nenhuma.
2. **Top layer**: `requestFullscreen()` era chamado no wrapper, o que o
   promove à top layer, onde só ele e seus DESCENDENTES são pintados —
   um irmão não renderiza nem com `z-index:99999` (medido). Agora a
   tela cheia é pedida em `document.documentElement`. Quem dá o visual
   imersivo é a classe `.imersivo` (`position:fixed; inset:0`), não o
   fullscreen nativo; pedir na raiz não muda nada visualmente e mantém
   a página inteira dentro da subárvore.
Mesma família da armadilha da barra do Frota: um ancestral muda as
regras de renderização dos descendentes. Elemento novo que precise
aparecer no imersivo = ficar na faixa acima de 300 e NÃO virar irmão
de um elemento em fullscreen.
No imersivo as gavetas da direita (`.malerta-panel` — resumo e análise
por alerta) usam a geometria do drawer "Exibição" (recuo 14px, cantos
arredondados) e se ALTERNAM com ele (`_setDrawer` / `abrirResumoAlertas`):
disputam o mesmo canto.
Guarda: `tests/mapa-telacheia.test.js`. A verificação é por PIXEL de
propósito — `checkVisibility`, `getBoundingClientRect` e
`elementFromPoint` reportam o painel como visível nos dois bugs, porque
descrevem o layout, não o que foi pintado. Não precisa decodificar PNG:
compara-se o recorte 1×1 do painel com o do fundo; bytes iguais = o
painel não pintou nada ali.

## Relatórios de consumo de combustível
Cálculo em UM lugar só: `js/frota-consumo.js`
(`frotaConsumoVeiculo` / `frotaConsumoAgregado` / `frotaConsumoTexto`).
Nunca reimplementar nas páginas — antes eram 3 cópias do mesmo bloco,
com o mesmo bug. No cliente, sem RPC/view nova.

Método: agregado por odômetro — km total ÷ litros totais. A janela vai
do 1º ao último abastecimento; os litros que contam são os de TODOS
menos o do PRIMEIRO (o combustível dele foi queimado antes da janela
começar; já o do último repõe o gasto que o odômetro dele mesmo já
mede). Km/L para hodômetro, L/h para horímetro (embarcações).
NÃO usa `tanque_cheio` — campo que o motorista marca por hábito, não
por medição. Precisa de 2+ abastecimentos com km entre eles.
Guarda de cauda: abastecimento recente sem km rodado (odômetro igual
ao anterior) é descartado — jogaria litros no denominador sem km no
numerador. Erro de fronteira (nível do tanque no 1º vs último) é
inerente ao método agregado e se dilui com o histórico.
Base: migration 192 garante medidor sempre crescente; a view
vw_frota_abastecimentos_detalhe já traz litros_final/valor_final
ajustados e placa/modelo/medidor.

Três superfícies consomem a função (todas devem ser tocadas juntas):
- App do motorista (frota-app.html, aba Dados → fmResumoCombustivel):
  números do próprio motorista, por veículo usado. Conta abastecimentos
  pendentes+validados (rejeitados ficam fora — dado contestado).
- Mesa (frota-veiculos.html, aba "Consumo" no cadastro do veículo →
  carregarConsumoVeiculo): só abastecimentos VALIDADOS (mesma regra do
  restante do módulo — contrato/fonte já classificados pela gestão).
- Dashboard (frota-dashboard.html → consumoPorVeiculo): só validados;
  KPI geral da frota usa `frotaConsumoAgregado` (soma km ÷ soma
  litros), nunca média das médias — senão uma moto que rodou 200 km
  pesa igual a uma caminhonete que rodou 20.000.
Divergência intencional: o app conta pendentes e as telas de mesa não,
então o mesmo veículo pode mostrar números diferentes nas duas.

## Regra do sistema — barra inferior do app Frota fora do que anima
A `.fm-pill-nav` (barra de abas do frota-app.html) vive num host próprio,
`#fm-nav-host`, IRMÃO de `#app` — nunca dentro da `.fm-shell`. Montada
por `montarBarraNav(modo)`; `montarBarraNav(null)` limpa (obrigatório em
toda tela sem abas: login, seletor de perfil, carregamento inicial).

Motivo: `transform` diferente de `none` num ANCESTRAL faz o elemento
virar containing block dos descendentes `position: fixed` (CSS
Transforms L1). Enquanto a barra era filha da `.fm-shell` — animada por
`entrarModo` via `fwTransicaoTela` —, ela se posicionava pelo fim do
DOCUMENTO em vez da viewport: sumia nas abas que rolam (Dados,
Histórico, Config, Viagem, Solicitar), "voltava" só ao rolar até o fim,
e a área de toque descolava da pintada (barra visível, botões mortos).
A regressão voltou 3 vezes porque foi diagnosticada como bug de
composição do WebKit; não é — reproduz no Chrome desktop.

Três travas, todas necessárias:
1. Barra fora de qualquer contêiner animado (acima).
2. `.fw-tela-*` usam `fill-mode: backwards`, NUNCA `both` — com `both`
   o `transform: translateX(0)` do keyframe final persiste para sempre.
   `fwTransicaoTela` ainda remove a classe no `animationend` (filtrando
   `ev.target`, que o evento borbulha).
3. Nada de `transform`/`will-change: transform` na própria barra — o
   centramento usa `margin: auto`, não `left:50% + translateX(-50%)`.

Guarda: `tests/frota-app-barra.test.js` (14 testes, 3 modos) — barra na
viewport, zero transform nos ancestrais, fixa ao rolar, e clique real
chegando ao botão. Qualquer elemento fixo novo no app deve seguir a
mesma regra.

## Passageiros da viagem (migration 235)
O que era texto livre (`frota_viagens.lista_passageiros`, migration
184 — "um nome por linha") virou registro estruturado: tabela
`frota_viagem_passageiros` (nome, `sexo` reaproveitando o enum
`sexo_participante` da 084, `necessidade_especifica`). Editor e
exibição vivem em UM arquivo, `js/frota-passageiros.js` — mesma
lição do `js/frota-consumo.js`; nunca remontar a lista na página.
API: `fpFormHTML({compacto})` (compacto = app, campos empilhados),
`fpPayload`/`fpDefinirLista`/`fpLimpar`, `fpDaViagem` (normaliza as
duas gerações de dado — cai no texto livre nas viagens antigas),
`fpResumoHTML`, `fpAlertaNecessidadesHTML`. Guarda:
`tests/frota-passageiros.test.js`.
- Solicitação passou a usar a RPC `frota_solicitar_viagem`
  (SECURITY **INVOKER**, não DEFINER): viagem + passageiros na mesma
  transação — com tabela filha, dois `.insert()` deixariam viagem sem
  os nomes se o segundo falhasse. A policy `frota_viag_insert` (158)
  continua sendo quem autoriza; a RPC não amplia privilégio nenhum.
- O `passageiros` (número) passa a ser derivado da lista quando ela
  existe, e segue editável para quem ainda não sabe os nomes.
- É por causa do ALERTA na aprovação que a necessidade é coletada:
  `#ap-alerta-necessidades` existe nas DUAS superfícies
  (frota-viagens.html e frota-app.html modo gestor) — par obrigatório.
- LGPD: necessidade específica é dado de saúde (Art. 5º, II) →
  `TRAT-017` no ROPA, base legal Art. 11, II, "b" + dever de
  acessibilidade (Lei 13.146/2015). Campo opcional, 200 caracteres,
  e purgado 90 dias depois da viagem por pg_cron
  (`frota_purgar_necessidade_passageiros`) — o nome fica os 5 anos da
  prestação de contas, a condição de saúde não. As sugestões de
  necessidade são lista FIXA no código: alimentar
  `frota_registrar_sugestao` (o catálogo aprendido da manutenção)
  espalharia o dado de um passageiro para todos os solicitantes.
- Vínculo com a base de usuários (migration 236): o campo nome tem
  busca incremental em `usuarios` (`fpNomeAlterado`/`fpBuscarUsuarios`
  em js/frota-passageiros.js) — quem já é cadastrado entra com
  telefone pronto. `frota_viagem_passageiros.usuario_id` guarda só o
  VÍNCULO (uuid); o telefone nunca é copiado pra linha, é resolvido ao
  vivo via join na view (`vw_frota_viagens_detalhe.passageiros_lista`),
  mesmo padrão de solicitante_nome/motorista_nome — não descola se a
  pessoa trocar de telefone depois. Sem RPC privilegiada nova: achado
  ao desenhar isto — a policy de SELECT de `usuarios` em produção
  (`usuarios_auth_select`) já libera qualquer autenticado a ler
  nome/telefone/cargo de qualquer colega, e essa policy NÃO está em
  nenhuma migration do repositório (drift, aplicada fora do controle
  de versão) — diverge do que a migration 001 e o ROPA (TRAT-001)
  descrevem. Não foi alterada nesta entrega; fica registrada como
  pendência de governança, não como bug desta funcionalidade.
  Passageiro vinculado NÃO é notificado (decisão de produto — só quem
  tem conta e foi de fato escalado/solicitou recebe notificação hoje).
- Divisão em vários veículos distribui os NOMES, não só o número
  (migration 236): `frota_aprovar_viagem_multipla` aceita
  `passageiro_ids` por alocação e reaponta cada linha de
  `frota_viagem_passageiros` pra viagem-filha certa — quem não é
  citado em nenhuma alocação fica na viagem-mãe (primeira alocação, id
  não muda), sem caso especial no código. Isso resolve sozinho o
  "ficar no histórico da viagem" e a visibilidade certa por motorista
  (a RLS da 235 delega pra policy da própria `frota_viagens`: o
  motorista da filha só vê os nomes apontados pro veículo dele). Na
  tela de aprovação (`ativarModoMultiplo`/`ativarModoMultiploG`), a
  distribuição inicial é automática e igualitária (round-robin, só
  quando a viagem tem lista estruturada — `fpDistribuirLinhas`); o
  gestor remaneja depois pelo seletor de cada chip (`fpMoverPassageiro`
  /`fpChipsLinhaHTML`) — sem drag-and-drop, o projeto não tem essa
  dependência em lugar nenhum. Guarda: `tests/frota-passageiros.test.js`.
- Motorista revê os passageiros no check-out (`abrirModalCheckout`,
  `co-resumo`) — visível e destacado, SEM travar a ação: nada pode
  impedir o trabalho de campo (regra do sistema).
- Ainda em aberto: a RPC de divisão (186) não copia
  `cidade_origem`/`cidade_destino` para as viagens-filhas — lacuna
  anterior a esta entrega, sem relação com passageiros.

## Regra do sistema — capacidade do veículo e divisão automática
`frota_veiculos.capacidade_passageiros` = **passageiros ALÉM do
motorista** (caminhonete cabine dupla de 5 lugares = 4). Está no
`COMMENT` da coluna e no rótulo do cadastro (`frota-veiculos.html`).
Antes o rótulo era só "Capacidade (passageiros)" e a frota entrou com
os dois significados misturados — Ônix Plus (5 lugares) cadastrado
como 4, Amarok/L200/Triton (também 5) como 5 —, então o sistema
achava que uma caminhonete levava 5 passageiros e **um veículo só
"cobria" um grupo de 6**: a aprovação abria com um veículo e todos
dentro. Migration 242 fixa o significado e corrige os dados.

Quantos veículos um grupo precisa é decisão do BANCO, nunca de um
número fixo na tela. `frota_veiculos_para_grupo(inicio, fim, total)`
(migration 242) é a definição única — escolhe os veículos (maior
capacidade primeiro, até cobrir o grupo) e já devolve a **cota** de
cada um, dividida proporcionalmente à capacidade (largest remainder:
6 passageiros em 2 caminhonetes = 3 e 3). Antes essa regra existia em
DUAS cópias, `frota_sugerir_alocacao` (192b) e
`frota_sugerir_motorista_escala` (190, que decide quantos motoristas
sugerir) — podiam discordar na mesma viagem. Mesma lição do
`js/frota-consumo.js`.
- Moto, quadriciclo e embarcação ficam FORA da sugestão automática (o
  gestor continua podendo escolhê-los à mão — viagem fluvial existe).
  Sem isso, a voadeira de teste (capacidade 6) era sugerida para
  viagem por estrada, e uma moto sem capacidade preenchida valia 4
  lugares pelo `COALESCE(cap, 4)`.
- O `> 4` fixo saiu das duas telas de aprovação: `abrirAprovar` chama
  `frota_sugerir_alocacao` e abre o modo múltiplo quando vêm **2+
  veículos**, com o grupo já repartido entre as linhas. O aviso do
  topo é montado por `fpAvisoDivisaoHTML` e diz também quando a frota
  disponível NÃO cobre o grupo.
- **Veículo e motorista só vêm pré-selecionados em viagem
  INTERMUNICIPAL**, onde existe rodízio ("o da vez",
  `frota_sugerir_motorista_escala`). Em viagem municipal o sistema
  divide o grupo — quantos veículos e quantos passageiros em cada —
  mas deixa os dois campos em branco para o gestor escolher: sem
  rodízio por trás, pré-selecionar seria só pegar o de maior
  capacidade da lista, sem critério. O texto do aviso muda junto
  (`preSelecionado`) — a tela não promete o que não fez.
- `fpDistribuirLinhas` respeita a cota de cada linha; sem cota (linha
  que o gestor adicionou à mão) cai no rodízio igualitário de antes.
  Cada linha avisa quando passa da capacidade do veículo escolhido —
  avisa, nunca bloqueia.
- Superfícies tocadas juntas (regra de duplicação): `frota-viagens.html`
  e `frota-app.html` modo gestor. Guarda:
  `tests/frota-passageiros.test.js`.

## Regra do sistema — status efetivo e blocos da lista de viagens
Toda lista de viagem, em QUALQUER superfície, se divide em três blocos:
**Em andamento**, **Próximas** (crescente — a mais perto primeiro) e
**Passadas** (decrescente). No app do solicitante os dois blocos longos
são SUB-ABAS em chip (`fmChipsHTML`, o mesmo controle do Histórico do
motorista) e "Em andamento" fica FIXA acima delas — é a única que exige
atenção agora e quase sempre tem 0 ou 1 card; esconder atrás de aba
faria caçar o que devia saltar aos olhos. Nas telas de mesa os três
blocos são cabeçalhos na própria tabela (há espaço vertical, e
frota-viagens.html ainda tem filtro de período). Definição única em
`js/frota-viagens-status.js` (`fvStatus`, `fvGrupo`, `fvAgrupar`,
`fvLabel`, `fvBadge`, `fvExplicacao`, `fvAtrasada`, `fvAtivas`) —
mesma lição do `js/frota-consumo.js`: antes eram 4 cópias de
STATUS_LABEL (frota-app, frota-solicitar, frota-viagens,
frota-dashboard) e nenhuma noção de tempo. Nunca remontar rótulo,
badge ou agrupamento numa página.

**Viagem que passou do retorno previsto sem check-out não aconteceu**
(migrations 240/241, status `nao_realizada`, terminal como
recusada/cancelada). Antes ela ficava `aprovada` para sempre:
"Aguardando saída" eterno no app do motorista, KPI de aprovadas
inflado, fila de aprovação do gestor entupida com data vencida e
nenhum histórico para o solicitante. (A `vw_frota_viagens_vencidas`,
201, cobre o caso INVERSO: a que saiu e não fez check-in — essa
continua "Em andamento", com selo de atraso.)
- Corte pelo RETORNO previsto, nunca pela saída: sair duas horas
  atrasado é rotina; o que caracteriza "não realizada" é a janela
  inteira fechar sem o veículo se mover.
- **Duas velocidades, de propósito.** Exibição: `status_efetivo` na
  `vw_frota_viagens_detalhe` deriva SEM carência — a viagem cai em
  "passadas" no minuto seguinte ao vencimento, sem esperar cron.
  Gravação: `frota_encerrar_viagens_nao_realizadas()` por pg_cron
  horário (`20 * * * *`) só materializa após 12h, para o check-out
  feito offline em campo ainda encontrar a viagem aberta (mesmo
  cuidado da 198 com a pílula envenenada da fila).
  **Exibição lê `status_efetivo`/`fvStatus(v)`; `v.status` é o
  registro, não o que se mostra.**
- `motivo_nao_realizacao`: `sem_inicio` (venceu aprovada, sem
  check-out) × `sem_aprovacao` (venceu solicitada, gestão nunca
  respondeu). Um enum só, dois motivos — a distinção vive no texto.
- Notificação só para viagem vencida há menos de 7 dias: encerrar
  passivo antigo é certo, avisar todo mundo sobre viagem de um mês
  atrás é barulho que ninguém resolve. `sem_aprovacao` não notifica a
  gestão (o SLA da 207 já cobra o mesmo fato).
- **Check-out tardio REABRE** (`frota_checkout_viagem` aceita
  `nao_realizada` e limpa as marcas): nada se perde e a fila offline
  nunca trava. Só falha se o slot já tiver sido dado a outra viagem no
  período — aí a mensagem manda abrir viagem avulsa.
- Aprovar viagem de janela vencida é bloqueado no banco pelo trigger
  `trg_frota_viagem_aprovacao_vencida` (BEFORE UPDATE, cobre
  `frota_aprovar_viagem`, a múltipla e qualquer caminho futuro sem
  recriar função grande — lição da 181). As duas superfícies de
  aprovação avisam antes de abrir o modal.
- `nao_realizada` não conta como uso em lugar nenhum (consumo, %
  de conclusão, rodízio de motorista — este já olhava só `concluida`).
- Superfícies tocadas juntas (regra de duplicação): app solicitante,
  app motorista (some do Início, entra no Histórico), app gestor (sai
  da fila de aprovação), `frota-solicitar.html`, `frota-viagens.html`
  (filtro de status + filtro de período + KPI "Não realizadas (30
  dias)" + linha do tempo), `frota-dashboard.html` (rosca, KPI e CSV).
- Guarda: `tests/frota-viagens-agrupamento.test.js`.

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

## Regra do sistema — fotos em bucket privado (LGPD)
TODO bucket com imagem de pessoa ou dado pessoal é PRIVADO. Nenhum
`getPublicUrl` serve arquivo: quem exibe assina na hora, com
`js/fotos-privadas.js` (helper único, compartilhado pelos 3 apps —
nasceu como js/frota-fotos.js na migration 200 e virou genérico na
210). Nunca reimplementar assinatura numa página — é a mesma lição do
js/frota-consumo.js.
- Privados: frota-* (200), brigadistas, registros-campo,
  biomonitor-fotos (210), pesquisa-documentos.
- Públicos de propósito: só config-logos (marca institucional).
- API: `fotoAttr(url, fallback)` no template (render síncrono) +
  `assinarFotos(container)` depois de injetar o HTML; `fotoUrlAssinada
  (url)` para uso imperativo (.src, window.open, fetch de PDF). Nomes
  `frota*` seguem como alias.
- O que fica GRAVADO no banco continua sendo a URL pública — ela vale
  como endereço (bucket + caminho), não como acesso. Sem migração de
  dados.
- Sempre ter fallback: offline a assinatura falha, e avatar deve cair
  nas iniciais, nunca em imagem quebrada. Fotos ainda na fila offline
  são blob:/data: — `fotoRef` devolve null e o chamador exibe direto.
- O helper resolve o cliente Supabase certo (`_fotoDb`): Brigadas
  reatribui o global `db`, mas o Biomonitor usa `window._bioDB_client`.
- ⚠️ Tornar um bucket privado QUEBRA o cliente antigo. Aplicar a
  migration só DEPOIS do deploy do código que assina (ver cabeçalho
  das migrations 200 e 210).

## Regra do sistema — exportar .xlsx: ExcelJS, nunca o pacote "xlsx"/SheetJS
Sempre que uma tela precisar gerar um Excel de verdade (não CSV) com
formatação (cabeçalho colorido, linha destacada, congelar painel),
vendorizar **ExcelJS** (`js/vendor/exceljs-4.4.0.bare.min.js` —
`dist/exceljs.bare.js` oficial do pacote, feito pra browser, sem
polyfill), carregado sob demanda como jsPDF/pptxgenjs. Duas armadilhas
medidas nesta entrega (`js/agua-relatorio-xlsx.js`), não achadas por
suposição:
1. O pacote **`xlsx` (SheetJS) do npm está travado numa versão com CVE
   de prototype pollution + ReDoS sem correção** — a SheetJS parou de
   publicar release corrigida no npm e moveu para `cdn.sheetjs.com`
   por fora. `npm install xlsx` sempre vem vulnerável.
2. **Mesmo pegando a build corrigida direto do CDN oficial deles, a
   build Community NÃO escreve estilo de célula de verdade.** `cell.s
   = {fill:...}` é aceito sem erro, mas o fill nunca aparece no
   `styles.xml` do arquivo gerado — confirmado abrindo o .xlsx e
   inspecionando o zip, não por documentação. Cor de célula, negrito,
   painel congelado só funcionam de verdade com o SheetJS Pro
   (pago) ou com outra biblioteca. ExcelJS é MIT puro e escreve tudo
   isso corretamente (confirmado do mesmo jeito: zip aberto,
   `styles.xml` com o fill real, `s="N"` na célula).
Nunca tentar `xlsx`/SheetJS de novo pra formatação — é retrabalho
já feito.

## Regra do sistema — timbre institucional (logo Acre × logo SEMA) nos relatórios
TODO relatório (PDF ou impressão/HTML) tem a logo do Governo do Acre
na margem ESQUERDA e a da SEMA na margem DIREITA — nunca as duas do
mesmo lado — e cada logo SEMPRE mantém a proporção original da
imagem, nunca esticada num quadrado fixo.

Achado real: os dois relatórios desenhados com jsPDF (Água e
Biomonitor) tinham `pdf.addImage(logo, fmt, x, y, 11, 11)` — um
quadrado fixo de 11×11mm que força qualquer logo não-quadrada a
esticar/espremer, com as duas logos empilhadas do lado esquerdo.

Fonte única do timbre em jsPDF: `js/relatorio-cabecalho-pdf.js`
(`relatorioPdfDesenharCabecalho`) — mesma lição do
`js/frota-consumo.js`/`js/mapa-recorte.js`, nunca reimplementar o
desenho do cabeçalho numa página nova. A função usa
`pdf.getImageProperties()` para pegar a proporção real da imagem e
encaixa dentro de uma caixa máxima (object-fit:contain, nunca
estica); o texto institucional fica centralizado no espaço entre as
duas logos, e o bloco "SIGUC-AC / Prot. XXX" (que antes ficava no
canto superior direito) passa a ficar ACIMA da logo da SEMA, na faixa
livre entre o topo da página e o início das logos — senão colidiria
com a logo que passou a ocupar aquele canto. Usado por
`js/agua-relatorio-pdf.js` e `js/biomonitor-relatorio-ninho.js` (este
último também gera a ficha de campo via
`js/biomonitor-relatorio-campo.js`, sem cópia).
- Toda página que carregue um dos dois geradores de PDF precisa
  incluir `<script src=".../js/relatorio-cabecalho-pdf.js">` ANTES do
  respectivo `agua-relatorio-pdf.js`/`biomonitor-relatorio-ninho.js` —
  e entrar em `SHELLS.agua`/`SHELLS.biomonitor` (pwa/sw.js) e nas
  listas `ARQUIVOS_JS` dos builds nativos
  (`app-agua/scripts/build-www.mjs`, `app-biomonitor/scripts/build-www.mjs`).
- Relatórios em HTML/impressão (sem jsPDF) seguem a MESMA regra de
  posicionamento, com CSS: `js/relatorio-car.js` + `css/relatorio-print.css`
  (`.rel-cabecalho`: logo à esquerda, `.rel-inst` centralizado
  flex:1, `.rel-logo-secr-col` — logo da SEMA + protocolo empilhados —
  à direita) e a capa de `pages/analise-cientifica-biomonitor.html`
  (`.ac-capa-logos { justify-content: space-between }`, logos já eram
  proporcionais por `object-fit: contain`, só a POSIÇÃO mudou). CSS
  com `object-fit: contain` (nunca `cover`/`fill`) em qualquer `<img>`
  de logo institucional é a regra equivalente em HTML.
- Qualquer relatório novo (PDF ou impressão) que precise do timbre
  institucional segue essa regra desde o nascimento — logo Acre à
  esquerda, logo SEMA à direita, proporção preservada.

Fonte das logos em si: SEMPRE `config_sistema.dados.logos`
(`governo_url`/`secretaria_url`, gravados em Configurações →
Institucional/Privacidade, `pages/configuracoes.html`). Nenhum
relatório tem URL de logo fixa no código — todos leem
`getCabecalhoRelatorio()` (`js/config-sistema.js`) no momento de
gerar o documento, com a única exceção da ficha de campo do
Biomonitor (`js/biomonitor-relatorio-campo.js`, `_biocampoBuscarLogos`),
que consulta a MESMA coluna só porque `pages/biomonitor.html` usa
cliente Supabase isolado (`window._bioDB_client`, sem o `db` global
que `getCabecalhoRelatorio()` precisa) — não é uma segunda fonte,
é a mesma fonte lida por outro cliente.
`getConfigSistema()` cacheia em memória por aba (`_configSistemaCache`)
para não bater no banco a cada relatório; `invalidarConfigCache()`
(chamada por `_salvarDados()` em `pages/configuracoes.html` a cada
troca) zera o cache da PRÓPRIA aba e grava um timestamp em
`localStorage` (`siguc_config_sistema_atualizado`) — o evento
`storage` do navegador dispara nas OUTRAS abas/páginas já abertas
(nunca na que fez a mudança, é assim que o evento funciona), zerando
o cache delas também. Efeito: trocar a logo em Configurações já vale
para um relatório gerado logo em seguida, mesmo numa aba que já
estava aberta antes da troca — sem precisar recarregar a página.

## Regra do sistema — foto de perfil sincronizada em todos os apps
UMA FOTO SÓ por pessoa, com fan-out em vez de join (migrations 261/289
— ler o cabeçalho da 261 para o motivo: os 3 apps de campo são
offline-first e leem `foto_url` da própria linha, cacheada no
IndexedDB; um join no servidor sumiria com o avatar sem rede, cenário
normal de campo). `usuarios.foto_url` é a fonte; a função interna
`_perfil_propagar_foto(usuario_id, url)` copia o endereço para
`brigadistas`/`frota_motoristas`/`monitores_biodiversidade` `WHERE
usuario_id = usuario_id` — Água não entra (usa `usuarios.foto_url`
direto, sem tabela de identidade própria).

Duas RPCs chamam o mesmo fan-out, para as duas direções de troca:
- `perfil_atualizar_foto(p_url)` — a PRÓPRIA pessoa troca a foto, em
  QUALQUER superfície (modal "Meu Perfil" na mesa, ou dentro de
  Brigadas/Frota/Biomonitor). `auth.uid()` é o alvo; valida que o
  endereço está em `avatares/<uid>/…`.
- `admin_atualizar_foto_usuario(p_usuario_id, p_url)` (289) —
  super_admin/gestor define a foto de OUTRA pessoa no cadastro
  (`pages/usuarios.html`, criação e edição). Mesma validação de
  endereço, mas contra a pasta do ALVO, não de quem chama.

**Bucket único: `avatares/<uid>/…`, privado desde a 261.** Os apps de
campo tinham cada um o próprio bucket (`brigadistas`, `frota-
motoristas`, `biomonitor-fotos`) e trocavam a foto gravando DIRETO lá
+ direto na própria tabela — a troca ficava presa naquele app, nunca
voltava para `usuarios` nem para os outros dois. Corrigido: os 3 apps
agora sobem para `avatares` e chamam `perfil_atualizar_foto` (helper
único `avatarSincronizarFotoPropria`, `js/avatar-foto.js`) — e SÓ
DEPOIS disso, opcionalmente, também atualizam a própria linha direto
(idempotente com o que a RPC já fez; é o que sustenta um cadastro de
campo sem `usuario_id` — PIN-only —, caso em que a RPC não tem o que
propagar). Os buckets antigos continuam existindo (fotos já gravadas
antes desta entrega), só não recebem upload novo do fluxo de troca de
foto própria.

**Moldura + menu "Ver foto / Trocar foto" únicos**
(`js/avatar-foto.js` + `css/avatar-foto.css`): anel dourado afastado
da borda sólida branca, sem glow/gradiente animado — de propósito,
para não parecer o clichê visual de "gerado por IA". Tocar a foto abre
um bottom sheet (Ver em tela cheia / Trocar / Cancelar); sem foto
ainda, vai direto para trocar. Cada tela só monta o HTML
(`.avatar-foto-wrap` → `.avatar-foto-anel` + `.avatar-foto` +
`.avatar-foto-badge`) e registra o que "ver"/"trocar" significam ali
com `avatarFotoRegistrar(id, {temFoto, verFoto, trocarFoto})` — nunca
reimplementar o menu numa página. Usado em `pages/usuarios.html`
(cadastro/edição), no modal "Meu Perfil" (`pf-foto`, retrofit) e no
card de config do Biomonitor (`bio-config-avatar`, que antes ia direto
pro seletor de arquivo, sem "ver"). Frota já tinha um menu próprio
(`#modal-foto-mot-menu`) e Brigadas o "liquid glass" documentado
abaixo — nenhum dos dois foi reskinado nesta entrega, só a
sincronização por baixo; unificar o visual deles fica para quando for
pedido.

Carregamento: `css/avatar-foto.css` e `js/avatar-foto.js` são
estáticos nas páginas que já os usam (`usuarios.html`,
`brigada.html`, `biomonitor.html`, `frota-app.html` — sempre ANTES do
JS de página que os referencia). No modal "Meu Perfil", que roda nas
~45 páginas de mesa, o carregamento é sob demanda
(`_perfilCarregarAvatarFoto` em `js/perfil.js`), mesmo padrão de
`_perfilCarregarFotos` — nunca pendurar em cada página.

`pwa/sw.js`: brigadas 263→264, biomonitor 31→32, frota 93→94 (os 3
ganharam `js/avatar-foto.js`; brigadas/biomonitor também
`css/avatar-foto.css`).

**Achado depois do deploy — Água tinha o desenho pronto, mas nunca
leu nem exibiu a foto.** `pages/agua-app.html` já tinha `.home-avatar`/
`.config-avatar` com CSS "liquid glass" e `cursor:pointer` prontos —
pareciam clicáveis mas não tinham handler NENHUM, e a query de login
nem selecionava `foto_url` (`prosseguirAposAuth`, só `id, nome_completo,
perfil, ativo, deve_trocar_senha`). Corrigido: `foto_url` entra na
query e em `App.coletor` (cacheado offline junto); `agAtualizarAvatar()`
pinta os dois avatares via `fotoUrlAssinada`; `agRegistrarAvatarMenu()`
liga os dois ao menu Ver/Trocar (`avatarFotoClicar`/`avatarFotoRegistrar`
de `js/avatar-foto.js`) — chamado em `entrarHome()` e `carregarConfig()`.
Troca sobe pelo MESMO `avatarSincronizarFotoPropria` dos outros 3 apps,
mas aqui sem gravação redundante na própria tabela: Água NÃO tem tabela
de identidade própria (migration 261) — o "coletor" É a linha de
`usuarios`, então a RPC `perfil_atualizar_foto` já grava a única linha
que existe. `pwa/sw.js`: agua 17→18 (`js/avatar-foto.js` +
`css/avatar-foto.css` no shell). `app-agua/scripts/build-www.mjs`
atualizado em paralelo (mesmo sem o APK ser gerado ainda) para não
divergir do que os outros 3 `build-www.mjs` já fazem.

## LGPD — governança de dados pessoais
Plano em 5 fases; 0 a 2 entregues. Migrations 209–212.
- **ROPA vivo no banco** (`lgpd_tratamentos`, migration 211): 16
  tratamentos mapeados, cada um apontando as TABELAS REAIS que o
  materializam (coluna `tabelas`). Tabela nova com dado pessoal =
  entrada nova no ROPA, na mesma entrega. É o que permite auditar o
  registro contra o schema em vez de acreditar nele.
- **BASE LEGAL NUNCA É CONSENTIMENTO** para o núcleo do sistema. SEMA
  é órgão público: Art. 7º, III (política pública) e Art. 7º, II
  (obrigação legal). Consentimento só no que é de fato opcional (foto
  de perfil, push). Construir sobre consentimento criaria direito de
  revogação que quebraria registros de guarda permanente.
- **Documentos versionados** (`lgpd_documentos` +
  `lgpd_documento_versoes`, migration 212): texto vive no banco, não em
  HTML. `hash_sha256` é coluna GENERATED — não pode divergir do texto.
  Editar = criar versão nova, o que volta a cobrar aceite de todos.
- **Aceite** (`lgpd_aceites`): aponta para a VERSÃO, referencia
  `auth.users` (único âncora comum a servidor, brigadista, monitor,
  motorista e pesquisador). Sem policy de UPDATE/DELETE — é registro
  de prova. Só entra pela RPC `lgpd_registrar_aceite` (idempotente).
- **Gate de ciência**: disparado por `carregarUsuario()` (js/config.js),
  que carrega `js/lgpd.js` dinamicamente. Deliberadamente NÃO é
  `<script>` em cada página — assim nenhuma página nova nasce sem o
  controle. Os 3 apps de campo não chamam `carregarUsuario` e por isso
  não são bloqueados: são offline-first e um gate dependente de rede
  poderia travar um brigadista em campo. FAIL-OPEN: se a RPC falhar, o
  gate não aparece e o sistema segue.
- **Página pública** `pages/privacidade.html` (sem login): a política é
  o único documento com `publico = true`, porque fala também de quem
  não é usuário (CPF vindo da API do SICAR — 53 mil titulares).
  Encarregado/DPO vem de `config_sistema.dados.encarregado`, editável
  em Configurações → Privacidade, sem migration nem deploy.
- **Aviso de campo** (`js/lgpd-campo.js` + migration 213): documento
  próprio, curto, exibido DENTRO dos 3 apps — brigadista/monitor/
  motorista são 4 dos 5 tratamentos de alto risco. Regra que manda no
  arquivo: NADA pode impedir o trabalho de campo. Texto cacheado em
  localStorage e reexibido sem rede; ciência gravada local primeiro e
  sincronizada depois; falha de envio fica pendente e retenta na
  próxima abertura, sem reexibir nem barrar. Reler em Configurações de
  cada app.
- O aviso de campo NÃO entra em `lgpd_pendencias_aceite()` (o gate de
  mesa) — senão todo servidor administrativo veria aviso sobre GPS de
  brigadista. Superfície própria: RPC `lgpd_aviso_campo(p_app)`.
- **Documentos dedicados por app** (migrations 222/223): o Aviso de
  Campo era UM texto genérico, idêntico nos 3 apps, listando as
  atividades dos três juntas ("viagem, abastecimento, ocorrência...")
  — um monitor lia sobre abastecimento, que nunca faz. `lgpd_documentos`
  ganhou coluna `app` (NULL = documento geral; slug — Aviso de Campo por
  app), reaproveitando o MESMO vocabulário de `lgpd_tratamentos.modulo`
  (211): `brigadas`|`biomonitor`|`frota`|`pesquisa`. Constraint virou
  `UNIQUE(tipo, coalesce(app,''))`. App novo no futuro = INSERT de uma
  linha com o `app` dele — zero migration de schema.
  `lgpd_aviso_campo(p_app)` recebe o slug; `p_app DEFAULT NULL` +
  fail-open (RPC devolve vazio, nunca erro) cobre cliente antigo em
  cache de PWA. ⚠️ Ao mudar a assinatura de `lgpd_aviso_campo()` de
  zero para um parâmetro, `CREATE OR REPLACE` criou uma função NOVA em
  vez de substituir (mesmo erro da 178/173 com Frota) — "function ...
  is not unique" ao chamar sem argumento. Corrigido na 224 com `DROP
  FUNCTION` explícito antes. Vale para qualquer RPC deste projeto: se a
  lista de parâmetros muda, `DROP FUNCTION` primeiro, sempre.
  O `aviso_campo` genérico antigo foi DESATIVADO (`ativo=false`), não
  apagado — preserva o histórico de aceite de quem já usava os 3 apps;
  os 3 avisos novos nasceram como documentos novos, do zero (v1.0), não
  como versão nova do antigo.
- **Cache do aviso de campo é por app** (`js/lgpd-campo.js`): como os 3
  apps são páginas na MESMA origem, compartilham `localStorage` — sem
  isso, abrir dois apps no mesmo aparelho faria um sobrescrever o cache
  do outro. Cada HTML declara `window.LGPD_CAMPO_APP` ('brigadas'/
  'biomonitor'/'frota') ANTES de carregar `lgpd-campo.js`; o arquivo lê
  isso no load (top-level, não dentro de função) para escolher a RPC
  certa e escopar as chaves de cache.
- **Achado ao revisar o texto do GPS**: o Aviso de Campo dizia "não há
  acompanhamento contínuo... a leitura acontece só no instante da
  ação" para os 3 apps igualmente. Falso para 2 deles — Brigadas
  (`bGpsIniciar`, js/brigada-captura.js) e Biomonitor (`bioIniciarGPS`,
  js/biomonitor-quelonios.js) usam `watchPosition` (contínuo) enquanto
  a tela principal está aberta, para indicador ao vivo na tela e —
  no Biomonitor — checar proximidade de praia/ninho. Só o Frota
  (`fmObterGps`) é `getCurrentPosition` pontual, como o texto sempre
  disse. A ressalva que salva a alegação: o watch é só LOCAL — nunca
  vira stream pro servidor. O que É gravado é uma localização única no
  login (`brigadista_iniciar_sessao`/`bio_monitor_iniciar_sessao`) e a
  localização de cada registro salvo; o "ping" de sessão a cada 5 min
  (Brigadas, `brigadista_ping_sessao`) é só heartbeat de presença —
  não carrega coordenada nenhuma. Textos novos (223) descrevem isso com
  precisão, um por app. RIPD de geolocalização segue com a redação
  antiga ("nenhum dos apps usa watchPosition") — pendente de correção
  numa próxima revisão, mesmo mecanismo da migration 220.
- **Aviso — Pesquisa** (`tipo='aviso_pesquisa'`, migration 223): o
  portal do pesquisador não tinha nada específico sobre o que de fato
  coleta (CPF/RG/documentos do projeto, sem GPS/foto) — só Política e
  Termo genéricos. Gate PRÓPRIO em `portal-pesquisador.html`
  (`lgpdPesquisaVerificar`), sem a complexidade offline do
  `lgpd-campo.js` — o portal sempre tem conexão quando carrega, então
  chama `lgpd_registrar_aceite` direto, sem cache/fila local.
- **CLIENTE SUPABASE — use sempre `sigucDb()` (js/config.js)**, nunca
  `window.db` direto. `db` é `let`, então NÃO é propriedade de window:
  quando um app faz `db = clientePróprio`, o `window.db` publicado pelo
  config.js continua apontando para o cliente de mesa, SEM sessão.
  Ordem correta: `_bioDB_client` → `db` → `window.db`. Biomonitor usa
  só `window._bioDB_client`; Brigadas e Frota reatribuem `db`.
- **Canal do titular / "Meus dados"** (`lgpd_solicitacoes_titular`,
  migrations 214/215): serve as 5 populações (servidor, brigadista,
  monitor, motorista, pesquisador) com UMA tabela e DUAS RPCs, porque
  todas ancoram em `auth.users` — mesmo motivo de `lgpd_aceites`.
  `lgpd_meus_dados()` (SECURITY INVOKER — só agrega o que a RLS de
  cada tabela de identidade já libera para o próprio dono) devolve
  cadastro + aceites + histórico de solicitações; `usuario_id` tem
  `DEFAULT auth.uid()`, então o INSERT do cliente manda só
  `{tipo, descricao}`. Trigger carimba `respondido_por`/`respondido_em`
  no servidor (nunca confia no cliente) e notifica automaticamente:
  nova solicitação → todo `super_admin`/`gestor` (não existe papel de
  "encarregado" no sistema de permissões); resposta → o titular.
  `vw_lgpd_solicitacoes` resolve o nome cruzando as 5 tabelas de
  identidade, porque nem todo titular tem linha em `usuarios`.
  Renderer único em `js/lgpd.js` (`lgpdMontarMeusDados` /
  `lgpdAbrirMeusDados`) — página inteira em `pages/meus-dados.html`
  (mesa, link fixo no rodapé da sidebar, visível a qualquer perfil) e
  modal nos 3 apps de campo (Configurações → Meus dados). Administração
  das solicitações em Configurações → Privacidade.
- **RIPD** (migrations 217/218): dois relatórios de impacto, reusando
  `lgpd_documentos` (mesmo `tipo` enum, `exige_aceite=false`,
  `publico=false`) em vez de tabela própria — RIPD É um texto
  versionado com data de vigência, a mesma coisa que Política/Termo/
  Aviso. `ripd_geolocalizacao` cobre os 4 tratamentos de trabalhador
  (TRAT-005/006/009/011); `ripd_car` cobre o TRAT-013 (volume + titular
  de terceiro). ⚠️ Novo valor de enum SÓ pode ser usado depois de
  commitado — precisa de uma migration própria só para o `ALTER TYPE
  ... ADD VALUE`, antes de qualquer INSERT que o use (erro real visto
  ao aplicar: "unsafe use of new value ... must be committed").
- **Log de acesso a dado de terceiro** (`lgpd_acesso_dado_terceiro`,
  migration 216): SELECT não dispara trigger no Postgres, então o
  único jeito de garantir o registro é o cliente passar por uma RPC.
  `car_consultar_local(cod_imovel)` substitui o
  `.from('car_dados_locais').select('*').eq(...)` que
  `_buscarDadosLocais` (pages/mapa.html) fazia direto — mesma
  permissão de antes (`pode_ver('mapa')`), só passa a gravar quem viu
  o nome/CPF de qual imóvel.
- **Busca do CAR sem CPF no retorno** (`car_buscar_local`, migration
  221 — fechou o risco residual que o RIPD v1.0 tinha registrado como
  conhecido): `_consultaCARLocal` (pages/mapa.html) parou de fazer
  select direto, que devolvia a linha bruta (com `cpf_cnpj`) pro
  navegador. Achado ao investigar: esse select também FURAVA o log da
  216 — `confirmarConsultaCAR` pré-populava `_carDadosLocais` com a
  linha bruta da busca, então abrir o detalhe de um imóvel achado por
  busca nunca chamava `car_consultar_local`. Corrigido nas duas
  frentes: a RPC de busca não devolve `cpf_cnpj`, e `_buscarDadosLocais`
  só reaproveita cache que já tem a chave `cpf_cnpj` (prova de que
  passou pela RPC de log) — cache "leve" da busca não serve mais pra
  isso. RIPD do CAR atualizado pra v1.1 documentando a correção (RIPD
  não exige aceite, então nova versão não pede ciência de novo).
- **Revisão anual como mecanismo, não só texto** (`lgpd_revisoes` +
  `lgpd_checar_revisao_anual`, migration 220): pg_cron mensal (dia 1,
  09h UTC) notifica quem edita Configurações → Privacidade se a última
  revisão passou de 12 meses (ou nunca houve uma). Dedupe pelo mesmo
  padrão da 207 (frota) — não notifica de novo enquanto já houver
  notificação pendente do mesmo subtipo. Marcar revisão feita é ação
  manual do admin (botão em Configurações → Privacidade), não
  automática — não faz sentido o sistema se autodeclarar revisado.
- **Plano de Resposta a Incidente** (Art. 48, migration 220): também
  documento versionado (`tipo='plano_incidente'`), com detecção →
  classificação de gravidade → contenção → comunicação (interna, ANPD,
  titulares) → documentação → revisão pós-incidente.
- Fechou o plano de 5 fases (0 a 5, todas as migrations 209–221
  aplicadas em produção, migration 210 já aplicada após o deploy).
- **Portal do pesquisador** (`perfil-pesquisador.html`) tem card 5
  "Seus dados e seus direitos": lê Política/Termo e canal do titular
  (formulário + histórico de solicitações), reaproveitando
  `lgpdMarkdown`/`lgpdDocumentoVigente` de `js/lgpd.js` (funções puras,
  não dependem de `config.js`) — mesmo padrão de shim local de
  `esc`/`formatData`/`toast` já usado em `pages/privacidade.html`. Sem
  gate bloqueante de propósito (mudaria comportamento de quem já usa o
  portal, decisão de produto que não foi tomada).
### ⚠️ LGPD — pendências que dependem de decisão/dado humano (não é código)
Plano tecnicamente completo (0 a 5, migrations 209–221 em produção),
mas 3 itens não podem ser preenchidos por uma sessão de Claude Code —
não é falta de tempo, é que fabricar qualquer um deles seria simular
conformidade em vez de entregá-la. Ficam aqui até alguém trazer o dado:

1. **Nome do Encarregado (DPO)**. Campo pronto em Configurações →
   Privacidade (`config_sistema.dados.encarregado`: nome/e-mail/
   telefone/portaria) — só preencher quando a portaria de designação
   sair. Até lá, `pages/privacidade.html` mostra o canal institucional
   da secretaria no lugar do nome.
2. **Confirmação se há menor de idade nas atividades de educação
   ambiental**. `lgpd_tratamentos.dado_de_menor = true` para TRAT-007
   (`registro_participantes`) está marcado por PRECAUÇÃO, não por
   confirmação — a tabela guarda `data_nascimento` e a área nunca
   confirmou se há escolares. Se confirmado, o Art. 14 passa a exigir
   consentimento específico de responsável e a coleta de CPF de menor
   precisa ser reavaliada quanto à necessidade (Art. 6º, III). Pedir
   isso à coordenação de educação ambiental.
3. **Primeira revisão anual**. Mecanismo armado (`lgpd_revisoes` +
   `lgpd_checar_revisao_anual`, pg_cron mensal) mas ZERO linhas em
   `lgpd_revisoes` — ninguém revisou ROPA/RIPD/políticas/log do CAR
   ainda. Botão "Marcar revisão feita" em Configurações → Privacidade
   já funciona; precisa de um super_admin/gestor de fato ler os
   documentos e clicar.

Quando qualquer um desses chegar, é edição pontual — não precisa
reabrir o plano.

## Regra do sistema — sidebar de mesa (grupos recolhíveis)
A sidebar (`js/layout.js`, `gerarLayout()`, usado pelas 45 páginas de
mesa) tinha 7 grupos soltos, 37 links — lista comprida demais. Virou
acordeão de 2 níveis, sem tocar nenhuma das 45 páginas (só
`js/layout.js` + `css/global.css`, que já é a fonte única do menu).
- **Grupo → acordeão.** Cada `nav-section` virou um `<button>`
  (`.nav-section-toggle`) que abre/fecha um `.nav-grupo-corpo`. O grupo
  da página atual **nasce sempre aberto**, calculado dentro do próprio
  `gerarLayout()` (que já recebe `paginaAtiva`) — nunca escondido atrás
  de um acordeão fechado. Os demais respeitam a preferência salva em
  `localStorage['siguc_nav_grupos']` (por `toggleNavGrupo(id)`); sem
  preferência salva, começam fechados.
- **Superbloco é só um divisor, não um acordeão próprio.** `grupo.super`
  (`'Diretoria Técnica'` ou `'Administrativo'`) emite um `<div
  class="nav-super">` antes do primeiro grupo daquela leva — a função
  compara `grupo.super` com o super do grupo anterior renderizado, só
  imprime de novo quando muda. Frota — Transporte é o único grupo em
  `'Administrativo'`; Gestão/Brigadas/Biomonitor/Água ficam em
  `'Diretoria Técnica'`. `Principal` (Dashboard/Mapa/Unidades) e
  `Sistema` (Usuários/Estrutura Org./Configurações/Saúde do Sistema,
  renomeado de "Administração" nesta entrega) ficam SEM `super` —
  blocos fixos no topo e no fim. Não confundir os dois "administra":
  `Sistema` é administração DO SOFTWARE; `Administrativo` é área da
  SEMA (onde Frota mora, e onde um Almoxarifado/Patrimônio futuro
  entraria sem reabrir a estrutura).
- **Colapso por `grid-template-rows: 0fr → 1fr`, nunca
  `transform`/`max-height` com transform.** Mesma armadilha documentada
  na barra do app Frota (`transform` num ancestral vira containing
  block de descendentes `position:fixed`) — aqui não há `position:fixed`
  dentro da nav, mas a regra do projeto é não introduzir `transform` de
  novo num ancestral da sidebar sem necessidade. O chevron (`.nav-chevron`)
  gira via `transform: rotate()`, mas é folha (SVG), não ancestral de
  nada.
- Rail de ícones (recolher a barra inteira, não só os grupos) foi
  avaliado e adiado por decisão do usuário — só o acordeão por grupo
  entrou nesta entrega.
- `pwa/sw.js`: só `VERSOES.frota` sobe (81→82) — `js/layout.js` E
  `css/global.css` estão nos DOIS lugares do shell do Frota (`<link>`/
  `<script>` em `frota-app.html` E `SHELLS.frota`). Brigadas/Biomonitor
  não sobem: `css/global.css` está em `SHELLS.brigadas` mas
  `brigada.html` não o referencia (entrada obsoleta no shell, não
  mexida aqui) e `biomonitor.html` não usa nenhum dos dois arquivos.
- Guarda: `tests/sidebar-grupos.test.js`. `gerarLayout()` exige
  `appState`/`t`/`esc` (de `js/config.js`) e `config.js` por sua vez
  exige o global `supabase` do CDN — o teste carrega os arquivos numa
  página vazia dedicada (`tests/fixtures/sidebar-harness.html`) com um
  stub de `window.supabase.createClient`, porque nenhuma página real do
  projeto serve de base: todas já declaram seu próprio `let db` no
  escopo global, e isso colide com o `let db` de `config.js` (dois
  `<script>` clássicos no mesmo documento compartilham o mesmo escopo
  léxico para `let`/`const` — a segunda declaração quebra o parse da
  página inteira, silenciosamente, sem lançar no `<script>` em si).

## Regra do sistema — subgrupo na sidebar (3º nível, DERHQA)
`gerarLayout()` aceita `subgrupos` dentro de um grupo — acordeão
ANINHADO. Hoje só o DERHQA usa: o grupo é o DEPARTAMENTO ("Recursos
Hídricos e Qual. Ambiental") e cada tema é um subgrupo — "Qualidade da
Água" (as 6 páginas de sempre), "Bacias Hidrográficas" e "Qualidade do
Ar" (declarados em `js/layout.js`, ainda sem página). Plano completo em
`docs/recursos-hidricos/plano.md`.
- **Não virou `super:`**: `super` é a MACROÁREA da SEMA (Diretoria
  Técnica × Administrativo) e o DERHQA está dentro da Diretoria Técnica
  — além de `super` não recolher, e o departamento precisar continuar
  sendo acordeão.
- Subgrupo é o MESMO mecanismo do grupo, um nível abaixo: mesma classe
  `.nav-grupo` (+ `.nav-subgrupo`), mesmo `toggleNavGrupo`, mesma
  preferência em `siguc_nav_grupos` (ids únicos entre grupos e
  subgrupos), mesmo colapso por `grid-template-rows` — nunca
  `transform`. Grupo E subgrupo da página atual nascem abertos (só o
  grupo não bastaria: o link ficaria escondido um nível abaixo).
- **Subgrupo sem item não renderiza**, e grupo sem subgrupo visível
  também não — é o que mantém Bacias/Ar declarados e invisíveis.
- **Gate de permissão por SUBGRUPO**, não no grupo: um `modulo:` no
  grupo esconderia o departamento inteiro de quem tem acesso a Bacias
  mas não à Água.
- ⚠️ **Bug real achado pelo teste ao aninhar**: `.nav-grupo.aberto
  .nav-grupo-corpo` é seletor DESCENDENTE — abrir o grupo abria também
  o corpo do subgrupo (e girava o chevron dele). As duas regras usam
  combinador de FILHO (`>`) desde então (`css/global.css`). Nível novo =
  mesmo cuidado.
- **`modulos.grupo` NÃO é rótulo, é regra de acesso.** O rename NÃO
  tocou `modulos.grupo` da chave `agua` (segue 'Gestão'): é a chave de
  fallback de `nivel_catalogo_perfil` → `grupo_permissoes_padrao`, e
  `agua` não tem NENHUMA linha em `perfil_permissoes_padrao` — todo o
  acesso dela vem do padrão de 'Gestão'. Trocar o grupo tiraria acesso
  de todo mundo em silêncio. Rótulo de menu vive em `js/layout.js`.
- Migration 303: `bacias` e `ar` nascem no catálogo `ativo = false`
  (só super_admin até existir tela, como `agua` na Fase 0) e
  `exige_lotacao = false`, ligadas ao DERHQA em `modulo_unidades` (é o
  que faz `modulo_departamento()` acertar o cabeçalho do primeiro
  relatório). Páginas novas nascem `rh-*`/`ar-*` — as `agua-*` não são
  renomeadas (quebraria `pwa/sw.js`, builds Capacitor, testes e links).
- Guarda: `tests/sidebar-grupos.test.js` (21 testes, 3 do subgrupo).
- `pwa/sw.js`: frota 97 → 98 (`js/layout.js` E `css/global.css` estão no
  shell do Frota).

## Recursos Hídricos — Fase B: Painel das Bacias (migration 304)
`pages/rh-bacias.html`, primeira tela do subgrupo Bacias Hidrográficas.
Plano e histórico em `docs/recursos-hidricos/plano.md` (Fase B).
- **NÃO existe polígono de bacia no sistema.** A divisão vem do texto
  `agua_pontos_coleta.bacia` (Purus/Juruá/Madeira + 1 sem bacia), e a
  tela **diz isso num aviso fixo** — nunca fingir recorte geográfico
  que não foi feito. Quando o arquivo oficial chegar, entra a tabela
  `bacias_hidrograficas` no molde do `limite_acre` (migration 239,
  geometria carregada por pg_net do mesmo arquivo que o cliente usa) e
  a bacia do ponto passa a ser derivada por ponto-em-polígono.
- Razão de existir (não é cópia do painel da Água): `agua-relatorios`
  sempre olha UM recorte; aqui a leitura é COMPARATIVA entre bacias.
  Escolher uma bacia destaca e recorta o MAPA, mas **nunca some com as
  outras da tabela** — senão a tela perde o sentido.
- Agregação nova em `js/agua-relatorio-dados.js` (`aguaRelPorBacia`,
  `aguaRelSerieBacia`), puras — nunca na página. **IQA médio de bacia é
  NÚMERO, nunca faixa** (classificar média = recalcular o que
  `agua_iqa_faixa()` faz no banco); por isso o gráfico é chamado com
  `semLegenda` (opção nova de `aguaIqaGraficoHTML`).
- Mapa é o MESMO `aguaPainelMapaCriar`, com `opts.referenciaSempre`
  (novo, ADITIVO — as outras duas telas não mudam): aqui o assunto é a
  rede hidrográfica, então limite/municípios/hidrografia IBGE aparecem
  também no mapa de ruas, não só no satélite.
- **`css/agua-painel.css` (novo) é a contraparte em CSS de
  `js/agua-painel.js`** — os ~270 linhas de `.adash-*`/`.adet-*` eram
  copiadas no `<style>` de `agua-relatorios.html` e `agua-publico.html`;
  esta seria a 3ª cópia. As três páginas linkam a mesma folha; mudança
  visual do painel entra AQUI e vale para as três (o par de duplicação
  obrigatória mesa ⇄ público continua valendo igual).
- Migration 304 ativa o módulo `bacias` (molde da 256 para `agua`).
  `exige_lotacao` fica FALSE de propósito: leitura agregada do que já é
  público, sem laudo nem dado pessoal.
- Fail-open: se o Leaflet não carregar, o card do mapa some e os
  números continuam — painel em branco por causa da camada visual é
  pior que painel sem mapa.
- Guarda: `tests/rh-bacias.test.js` (9). O Leaflet é servido de
  `tests/fixtures/vendor/` por `page.route` (unpkg oscila na política
  de rede do sandbox); a PÁGINA segue no CDN em produção.
- `pwa/sw.js`: frota 98 → 99 (`js/layout.js`), agua 19 → 20
  (`js/agua-relatorio-dados.js`).

## Recursos Hídricos — Fase C: Plataformas de Coleta (migrations 305-307)
`pages/rh-estacoes.html` — estações hidrometeorológicas (nível, chuva,
vazão) da ANA/estado/terceiros. Plano completo em
`docs/recursos-hidricos/plano.md` (Fase C).
- **Duas tabelas**: `rh_estacoes` (inventário + COTAS cadastradas em cm
  — atenção/alerta/inundação, nunca calculadas) e `rh_medicoes` (série,
  uma linha por leitura, com `origem` telemetria/convencional/
  importação/manual). Não confundir com `agua_pontos_coleta` — aquele é
  onde a SEMA amostra pro IQA; estação é infra de terceiro, série
  própria. RLS pelo módulo `bacias` (mesma leitura de rede
  hidrográfica).
- **`situacao_cota` é DERIVADA em `vw_rh_estacoes_detalhe`**, nunca no
  cliente. Estação SEM cota cadastrada é NULL → "Sem cota cadastrada",
  NUNCA "normal" (mesma distinção de `conama_violacoes` nulo na Água).
- **Testado contra a ANA de verdade, do banco (pg_net), antes de
  desenhar**: a API telemétrica atual responde 401 (existe, exige
  credencial); o SOAP antigo não responde mais. `ingest-hidro`
  (Edge Function) está publicada e PRONTA, mas sem
  `ANA_HIDROWEB_ID`/`ANA_HIDROWEB_SENHA` nos secrets devolve
  `sem-credencial` sem gravar nada — ligar é cadastrar os 2 secrets +
  agendar o cron comentado na migration 307, nunca no frontend.
- **Hidrograma em SVG** (`js/rh-hidro.js`): nível em linha + chuva em
  barra invertida do topo, cotas como linha tracejada SEMPRE rotulada
  (nunca só cor). Mesmas 4 cores de cota já validadas contra
  daltonismo em `js/agua-iqa-visual.js` — nunca uma paleta nova.
- **`aguaPainelMapaBase()`** (novo, em `js/agua-painel.js`): a base
  cartográfica (tiles, rosa dos ventos, escala, camadas de referência,
  config) foi extraída de `aguaPainelMapaCriar` para servir também o
  mapa de estações, com `legendaFn` injetável — cada tela usa sua
  própria legenda sobre a mesma base.
- **Camada no Mapa das UCs** (`pages/mapa.html`), pedido do usuário
  "igual os CAR": aba "💧 Rec. Hídricos", checkbox liga/desliga,
  círculos por `rhCotaCor`, popup com link pra tela dedicada.
- **Relatório diário por RIO** (`rh_relatorio_diario`, nunca por
  estação — é a leitura operacional real), em 4 formatos: tela, PDF
  (`js/rh-relatorio-pdf.js`, reaproveita os primitivos de
  `js/agua-relatorio-pdf.js` — `linhaModulo` parametrizado pra sair
  "Recursos Hídricos" no timbre), CSV e e-mail diário
  (`hidro-relatorio-diario`, destinatários em Configurações › Qualidade
  da Água, `config_sistema.dados.hidro.emails` — lista vazia é decisão
  válida, o aviso de cota segue por notificação mesmo sem e-mail).
- **Notificação de cota** (`rh_checar_cotas`, cron de HORA em hora —
  não 1×/dia como o resto do projeto, porque cheia é rápido; dedupe por
  `ref` evita spam) para super_admin/gestor/diretor/chefe_departamento/
  tecnico.
- Guarda: `tests/rh-estacoes.test.js` (12 testes) — as 3 regras que não
  podem quebrar: cota nunca calculada no cliente, sem-cota nunca vira
  "normal", parser de planilha nunca inventa data.
- `pwa/sw.js`: agua v20 → v21 (`agua-relatorio-dados.js`,
  `agua-relatorio-pdf.js`, `agua-iqa-visual.js` — todos no shell do app
  de campo da Água).

## Enums do banco
perfil_usuario: super_admin | gestor | tecnico | financeiro | visualizador |
  brigadista | biologo | secretario | diretor | chefe_departamento |
  gestor_uc | assistente_admin | pesquisador_externo | validador_brigada |
  validador_fauna
  (lista completa — achado na Fase 3 do LGPD que este arquivo trazia
  só 5 valores; brigadista/monitor/motorista/pesquisador TÊM linha em
  `usuarios`, com perfil próprio, então também alcançam a mesa/sidebar
  se logarem com e-mail+senha em vez do PIN do app de campo)
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

## Regra do sistema — Acesso por organograma
Plano completo, com o levantamento contra produção que justifica cada
escolha, em `docs/acesso-por-organograma.md`. Resumo do que existe hoje
(migrations 262–269, todas com verificação real contra o banco, não só
lidas — snapshot 1656/1656 sem divergência, cadeia de hash 9/9 sem
quebra):

- **`usuario_lotacoes`**: onde cada servidor trabalha (histórico, não
  estado — mudar de setor fecha uma linha e abre outra). Diferente de
  `cargo_ocupacoes` (chefia, 1 titular por unidade) — quem ocupa cargo
  é lotado por DERIVAÇÃO (`usuario_unidades()`), nunca digitado duas
  vezes. Tela: aba "Lotações" em `estrutura-organizacional.html`.
- **`modulo_unidades`**: qual setor é DONO de cada módulo, com herança
  pela árvore (`alcance_por_lotacao()`) — descendente da unidade dona
  herda o mesmo nível; ancestral (chefia acima) herda só `visualizar`.
  Tela: aba "Acesso por Setor", só super_admin.
- **`credenciamentos`**: exceção de acesso fora do setor, sempre com
  prazo (`data_fim` obrigatória) e justificativa (mín. 20 caracteres,
  checado no banco), só concedida por super_admin,
  `teto_do_perfil()`-capada (nunca eleva além do que o perfil já
  alcança em algum módulo hoje). Cron diário avisa vencimento. Tela:
  aba "Credenciamentos", só super_admin.
- **`nivel_efetivo()`** (v2, migration 267): mesma assinatura de
  sempre. Ordem: super_admin → credenciamento vigente → override
  individual (`usuario_permissoes`, válvula de escape) →
  **`modulos.exige_lotacao = false`** (hoje, em TODO módulo): cai no
  padrão de sempre (`perfil_permissoes_padrao` > `grupo_permissoes_padrao`
  > sem_acesso) → se `true`: alcance por lotação, capado pelo teto do
  perfil, com fail-open para o padrão de sempre se o módulo não tiver
  dono cadastrado.
- **`trilha_auditoria`** (migration 269): genérica (`tabela`/
  `registro_id`, sem nada específico de módulo), trigger ligado nas 4
  tabelas acima. Só super_admin lê; **nem o super_admin escreve** —
  só o trigger grava (`REVOKE` + `SECURITY DEFINER`). Cadeia de hash
  encadeado + `trilha_auditoria_verificar()`. Selo diário
  (`trilha_auditoria_selos`) é gerado e gravado, mas o ENVIO para fora
  do banco não está implementado (exigiria embutir `SERVICE_ROLE_KEY`
  num cron — anti-padrão que o projeto evita).

**Regra permanente, vale a partir de agora**: policy nova que decide
acesso a MÓDULO usa `pode_ver`/`pode_editar`, nunca `perfil = '...'`
direto. Se aparecer `perfil = '...'` numa policy nova, é dívida técnica
e precisa de justificativa escrita no commit.

**Antes de converter uma policy EXISTENTE para `pode_ver`/`pode_editar`,
comparar o array de perfis hard-coded contra o que
`perfil_permissoes_padrao`/`grupo_permissoes_padrao` concede hoje para
o módulo.** Achado real (não hipótese): na maioria das tabelas testadas
(`documentos`, `equipe_servidores`, `netflora_*`, `unidades_conservacao`,
`camadas_mapa`, `alertas_ambientais`, `monitoramento_indicadores`) o
catálogo DIVERGE da regra real — converter às cegas amplia ou reduz
acesso de verdade, silenciosamente. `config_sistema` foi a única
convertida (migration 268) porque as duas fontes coincidiam
exatamente. Ver §3.2 de `docs/acesso-por-organograma.md` para a lista
completa classificada (o que já foi convertido, o que tem drift, o que
é dono-do-registro/app-de-campo e fica como está).

Guarda: `tests/permissao-organograma.test.js` cobre a metade
client-side (`appState.permissoes` alimentado por `minhas_permissoes`
em `carregarUsuario()`, fail-open). A metade em SQL não tem guarda
automatizada ainda — foi verificada por transações com `ROLLBACK`
durante as migrations, não por teste que rode sozinho.

**Consumidor real de `modulo_unidades` — departamento certo no
cabeçalho dos relatórios (migration 299).** Achado ao investigar por
que o PDF da Qualidade da Água mostrava "Departamento de Unidades de
Conservação": `getCabecalhoRelatorio()` (js/config-sistema.js) sempre
leu UM campo genérico único (`config_sistema.dados.departamento`),
compartilhado por TODO relatório do sistema, não importa o módulo.
`modulo_unidades` já resolvia isso desde a migration 265 (`agua` →
DERHQA, `biomonitor` → DEBIO, `frota` → DITLOG...) — só nunca tinha
sido consumida por um relatório.
- `getCabecalhoRelatorio(moduloChave)` ganhou parâmetro OPCIONAL: com
  ele, `departamento`/`siglaDep` vêm da nova função
  `modulo_departamento(chave)` (lê `modulo_unidades`); sem ele,
  comportamento idêntico ao de sempre — nenhuma das ~10 páginas que já
  chamavam a função sem argumento precisou mudar. Módulo sem dono
  cadastrado cai no campo genérico de Configurações (fail-open, nunca
  fica sem departamento nenhum).
- **Achado colateral**: 4 telas do Biomonitor (`js/biomonitor-analise.js`,
  `js/biomonitor-analise-comparativa.js`, `js/biomonitor-relatorio-ninho.js`,
  `pages/relatorios-biomonitor.html`) já faziam
  `cab.departamento = 'Departamento de Biodiversidade'` na mão, uma
  cópia do mesmo workaround em cada arquivo, para o MESMO bug que a
  Água tinha — só que a Água nunca ganhou cópia nenhuma, por isso
  aparecia errada e o Biomonitor não. As 4 cópias foram substituídas
  por `getCabecalhoRelatorio('biomonitor')`.
- **Cabeçalho do PDF virou 3 linhas** (`js/relatorio-cabecalho-pdf.js`,
  compartilhado por Água e Biomonitor): Secretaria (negrito) /
  Diretoria / Departamento + nome do módulo — antes eram 2 linhas,
  com Diretoria e Departamento espremidos numa string só
  (`linhaModulo` pré-formatada pelo chamador). Agora a função lê
  `cab.diretoria`/`cab.departamento` direto, e `linhaModulo` (opcional)
  é só o sufixo pequeno da 3ª linha ("Qualidade da Água",
  "Biomonitoramento"). Cabe no espaço já reservado (`AGPDF_TOPO`/
  `BIOPDF_TOPO` não mudaram) — confirmado extraindo o texto de um PDF
  gerado de verdade, as 3 linhas saem separadas.
- **Nome do DERHQA corrigido**: a migration 004 tinha criado o nó no
  organograma com `nome = sigla` como placeholder ("DERHQA"), nunca
  preenchido por extenso — agora "Departamento de Recursos Hídricos e
  Qualidade Ambiental".
- ⚠️ **Achado testando como `anon` de verdade**: `modulo_departamento()`
  respondia para `anon` mesmo só com `REVOKE ALL ... FROM PUBLIC` —
  mesma lição da 165/249/252b/297, o `ALTER DEFAULT PRIVILEGES` do
  projeto concede EXECUTE a `anon` por NOME em toda função nova.
  Corrigido com `REVOKE EXECUTE ... FROM anon` explícito antes do
  `GRANT ... TO authenticated`; a chamada aninhada de dentro de
  `agua_publico_cabecalho()` (SECURITY DEFINER) continua funcionando
  para o painel público — `current_user` é o dono durante toda a
  cadeia, o REVOKE só fecha a chamada DIRETA.
- Guarda: `tests/agua-publico.test.js` (migration 299 — SECURITY
  DEFINER + REVOKE de anon + fallback) e
  `tests/agua-relatorios.test.js` (PDF de verdade, as 3 linhas
  separadas, nunca mais "Departamento de Unidades de Conservação" no
  relatório da Água).

## Módulos — situação

### Já implementado
- Login + auth Supabase
- Sidebar + layout compartilhado (gerarLayout)
- Páginas: todas as listadas em pages/
- Auditoria de acessos com bloqueio
- GeoJSONs do Acre
- Estrutura Organizacional (`unidades_organizacionais`, `cargos`,
  `cargo_ocupacoes`, `delegacoes_temporarias`) — ver
  `pages/estrutura-organizacional.html` e "Regra do sistema — Acesso
  por organograma" acima

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
- `pwa/sw.js` é um único arquivo compartilhado pelos 4 PWAs (Brigadas,
  Biomonitor, Frota, Água), mas cache e versão são ISOLADOS por app:
  cada página registra o SW com `scope` próprio (`/pages/brigada.html`,
  `/pages/biomonitor.html`, `/pages/frota-app.html`,
  `/pages/agua-app.html`), e o SW deriva `APP` do
  `self.registration.scope` para escolher o app shell e o nome do
  cache (`siguc-<app>-vN`). O objeto `VERSOES` no topo do arquivo
  guarda o contador de cada um.
  **Esse mesmo contador agora também dispara o build do APK
  automaticamente** — ver `.github/workflows/apk-auto-trigger.yml` e a
  regra de APK em "Regras de desenvolvimento" abaixo. Não é um sistema
  paralelo: é o MESMO incremento que esta seção já exige.
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
- MIGRATIONS SEMPRE APLICADAS: toda migration criada (arquivo novo em
  supabase/migrations/) deve ser aplicada no banco de produção
  (projeto SIGUC-AC, id atqtybcsvepdabsvgaly) via mcp__Supabase__apply_migration
  na mesma entrega — nunca deixar só o arquivo no repositório sem
  rodar no banco. Depois de aplicar, checar mcp__Supabase__get_advisors
  (type security) por avisos novos introduzidos pela migration. Regra
  permanente, sem precisar ser pedida de novo.
- Commits em português, pequenos e descritivos
- NUNCA expor SERVICE_ROLE_KEY no frontend
- ÍCONES: nunca usar emoji em UI (botões, chips, navegação, marcadores
  de lista). Padrão único = SVG de traço 24×24, fill none, stroke
  currentColor, stroke-width 2, cantos arredondados (estilo Feather/
  Lucide), registrado em js/config.js (BICON_PATHS). Em HTML estático
  use data-icon="nome" (bIconsAplicar injeta); em JS use bico('nome').
  Ícone novo = adicionar um path no MESMO estilo em BICON_PATHS.
- APK Android — REGRA MUDOU (decisão do usuário, substitui a regra
  antiga de "só gerar quando pedido ou já houver acúmulo"): agora TODO
  app gera APK novo SOZINHO sempre que atualiza, sem precisar pedir.
  Mecanismo: `.github/workflows/apk-auto-trigger.yml` dispara em todo
  push a `main` que mexa em `pwa/sw.js`, compara o `VERSOES` de antes ×
  depois do commit, e roda `gh workflow run` no `<app>-apk.yml`
  correspondente a cada contador que subiu. Não olha lista de arquivo
  nenhuma — usa o PRÓPRIO contador que a regra "Versionamento" abaixo
  já obriga subir a cada entrega que toca o shell de um app. Efeito
  prático: **subir o contador de `VERSOES[app]` em `pwa/sw.js` (regra
  de sempre, inalterada) agora TAMBÉM é o gatilho do build do APK** —
  nenhum passo extra precisa ser lembrado além do que já era
  obrigatório. Isso vale para os 4 apps (brigadas/biomonitor/frota/
  agua), inclusive Água, que não tinha nenhum APK gerado até esta
  decisão — o primeiro build saiu desta mesma entrega.
  Continua tudo igual: mudança web/PWA vai à produção normalmente,
  service worker invalidado pelo contador de sempre — só que agora,
  além disso, o Android também recebe um Release novo sem intervenção.
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
  EXCEÇÃO por decisão de produto — Checklist de inspeção (DVIR,
  migrations 203/204): assimétrico pelo mesmo motivo do abastecimento.
  REGISTRO da inspeção só existe no app (`frota-app.html`, funções
  `abrirChecklist` / `clPayloadInspecao`, enviado junto do check-out e
  do check-in — nunca como chamada separada, ver cabeçalho da 204),
  porque quem confere o veículo é o motorista, em campo. CONFIGURAÇÃO
  do catálogo e leitura do histórico só existem na mesa
  (`frota-inspecoes.html`). Se "registrar inspeção" for para uma tela
  de mesa, ou o catálogo virar editável no app, aplicar a regra dos
  pares acima.

## Regra do sistema — cálculos de ovos/filhotes do Biomonitor (UM lugar só)
Mapa completo, com o histórico do bug encontrado e das 4 fontes de
dado, em `docs/biomonitor-calculos-ovos-filhotes.md` — LER antes de
mexer em qualquer cálculo de postura/eclosão/descarte/predação/
berçário. Resumo (migration 320, 24/08/2026):

Achado real: `vw_descartes_ovos` nunca expunha a coluna `causa`
(existe na tabela desde a 123) — `relatorios-biomonitor.html` já
consultava essa coluna, a query falhava (42703, coluna não existe) e a
seção "Descarte de ovos por causa" ficava sempre zerada, EM SILÊNCIO
(Supabase não lança exceção JS em erro de coluna; devolve
`data:null, error:{...}` e o código não checava `error`). Junto com
isso, cinco RPCs/views tinham fórmulas DIVERGENTES da mesma regra de
negócio (viáveis calculado 2x em SQL diferente; mortalidade de
berçário com 3 caminhos; "eclodidos" contando `em_bercario`/`soltado`
em alguns lugares e não em outros) e cálculos que só existiam na
Análise Científica (a tela mais recente e mais fácil de estender)
nunca chegavam ao relatório oficial nem ao PDF por ninho.

- **"Ovos viáveis/perdidos por causa"**: fórmula única em
  `vw_ninho_ovos` (migration 124) — `viaveis = postura − Σ
  descartes_ovos.qtd`. Toda RPC/view nova faz `JOIN vw_ninho_ovos`,
  nunca refaz a soma.
- **"Mortalidade em berçário"**: fórmula única em
  `vw_lotes_bercario_mortalidade` (migration 133) — individual se o
  lote tem filhotes rastreados, senão `ocorrencias_bercario` agregada,
  nunca abaixo do confirmado em `solturas_filhotes.mortalidade`. Toda
  RPC nova faz `JOIN vw_lotes_bercario_mortalidade`.
- **Checklist de superfícies** (ao adicionar cálculo novo, marcar
  quais foram tocadas): app de campo (`bio_dados_aba`), mesa/admin
  (`vw_praias_biomonitor`), relatório web (`bio_relatorio_completo`),
  PDF por ninho + ficha de campo + validação (`vw_ninhos_validacao`),
  Análise Científica (`bio_analise_detalhada`/`bio_analise_praias`),
  tela de Berçários. Um cálculo que nasce só na Análise Científica é o
  padrão de falha mais comum — ao adicionar algo lá, perguntar
  explicitamente se o relatório oficial e o PDF por ninho também
  precisam.
- **Nome de campo igual em toda RPC** (`taxa_eclosao_pct`,
  `total_ovos_viaveis` etc.) — nunca um sinônimo novo pro mesmo dado.
- **Coluna nova numa view existente entra SEMPRE ao final da lista** —
  `CREATE OR REPLACE VIEW` rejeita (erro 42P16) reordenar ou inserir
  no meio. Mesmo cuidado do `DROP FUNCTION` antes de mudar assinatura
  de RPC, documentado em vários pontos deste arquivo.
- **Testar a query do cliente contra o schema real** antes de assumir
  que uma coluna existe — foi assim que o bug acima foi encontrado, não
  lendo código.

## Biomonitor — Anomalias congênitas em filhotes (migration 321)
Registro de eclosão ganhou contador `filhotes_anomalia` (SUBCONJUNTO
de `filhotes_vivos`, CHECK `<=`, nunca um 4º balde somado ao total —
filhote deformado ainda é filhote vivo, segue o fluxo normal) + tipo
por catálogo fechado (`anomalia_filhote_tipo`: casco/membro/corpo/
albinismo/outro), múltipla escolha por eclosão. No berçário,
`filhotes_bercario.anomalia` é flag INDEPENDENTE de `doente`
(migration 144) — anomalia é congênita (conhecida desde a eclosão,
toggle direto sem ocorrência), doente é adoecimento durante o
cuidado (passa por ocorrência, captura causa/data).
- Propagado às mesmas 5 superfícies da regra acima, na mesma entrega:
  app (`bio_dados_aba`, KPI + contador/chips no form de eclosão +
  toggle na tela do indivíduo), mesa/admin (`vw_praias_biomonitor`,
  popup do mapa), relatório web (`bio_relatorio_completo`, KPI + taxa
  + quebra por tipo), PDF por ninho + validação (`vw_ninhos_
  validacao`, coluna "Anomalia" na tabela de filhotes individuais),
  Análise Científica (`bio_analise_detalhada`).
- **Achado ao aplicar**: `vw_praias_biomonitor` em produção tinha
  DRIFT — colunas `grupo_id`/`grupo_nome`/`area_m2` existiam no banco
  sem nenhuma migration commitada, e a correção de fan-out + eclodidos
  (inclui `em_bercario`/`soltado`) da migration 146 nunca chegou a
  essa view em produção (sobrescrita por esse drift, que partiu de uma
  versão anterior). Corrigido junto, reconstruindo a view do
  `pg_get_viewdef()` real de produção — nunca do arquivo de migration
  local, que pode estar desatualizado. Lição: antes de `CREATE OR
  REPLACE VIEW` numa view antiga, conferir `information_schema.columns`
  contra produção, não só o histórico de migrations do repositório.
- `pwa/sw.js`: biomonitor v34 → v35.

## Biomonitor — Equipamentos em cautela (migrations 226/227/228)
Cadastro do bem é SEMPRE na mesa (`biomonitor-equipamentos.html`,
perfil tecnico/gestor/super_admin): descrição, plaqueta física
(texto livre, opcional) + código interno gerado por trigger
(`BIOEQ-AAAA-NNNN`, molde da 175 do Frota), foto (bucket já privado
`biomonitor-fotos`, migration 210 — sem bucket novo). A cautela —
um ou mais equipamentos entregues de uma vez — é assinada pelo
monitor no app (`pages/biomonitor.html` → Configurações → Meus
equipamentos → `js/biomonitor-equipamentos.js`), reaproveitando o
padrão de documento versionado do LGPD: `lgpd_documentos` ganhou o
tipo `termo_equipamento` (enum novo, migration 226 — commitada
separada da 227 por causa da regra de ADD VALUE do projeto) e a
assinatura em si é um `lgpd_aceites` (ancorado em `auth.users`,
mesma âncora comum a todos os perfis). Tabelas próprias
`biomonitor_cautelas`/`biomonitor_cautela_itens` guardam qual
monitor está com qual equipamento, com devolução por item (permite
devolução parcial de uma cautela com vários itens). RPC
`biomonitor_registrar_cautela` (chamada pelo app, idempotente por
`uuid_cliente`, fila offline no IndexedDB — store `cautelas`,
sincronizada por `bioSyncCautelas`) e RPC
`biomonitor_devolver_equipamentos` (só mesa — decisão de produto:
devolução nunca é feita pelo monitor no app, só a gestão confirma o
recebimento físico do bem). Relatório de patrimônio (quem está com
o quê, histórico) é a própria `biomonitor-equipamentos.html`, view
`vw_biomonitor_cautelas_detalhe`. `pwa/sw.js`: biomonitor v22 → v23
(novo `js/biomonitor-equipamentos.js` no shell).

Cadastro do bem (228): campos fixos comuns (`categoria` enum, `marca`,
`modelo`, `numero_serie`, `data_aquisicao`, `fornecedor`) + `grupo_id`
(FK `grupos_biomonitor` — bem pertence a um grupo de monitoramento,
não a um pool geral da SEMA, decisão de produto) + `especificacoes
jsonb` para os campos que só fazem sentido por categoria (ex.: IMEI
de GPS, motor de embarcação — catálogo `ESPEC_CAMPOS` em
`biomonitor-equipamentos.html`, evita tabela nova a cada tipo de
equipamento). Valor de aquisição/nota fiscal ficaram de fora por
decisão de produto (fora do escopo, não é dado financeiro que o
cadastro pretende rastrear). Efeito colateral: `biomonitor_registrar_
cautela` passa a validar que o equipamento é do MESMO grupo do
monitor (mesmo espírito da trava de veículo do Frota, migration 180)
— o cache de equipamentos do app (`bioSyncCacheEquipamentos`) já
filtra por `grupo_id` do monitor pra não mostrar o que ele não pode
pegar. `pwa/sw.js`: biomonitor v23 → v24.

Prazo de devolução + alertas + ocorrências (229/230): toda cautela
tem `data_prevista_devolucao` (obrigatória) — o monitor escolhe o
prazo (7/15/30 dias) ao assinar no app, a RPC `biomonitor_registrar_
cautela` ganhou o parâmetro `p_dias_prazo` (assinatura antiga sem
esse parâmetro foi `DROP FUNCTION`ada, regra do projeto — CREATE OR
REPLACE com lista de parâmetros diferente cria overload em vez de
substituir). A cautela nasce pendente de validação; a mesa confirma
via RPC `biomonitor_validar_cautela` (pode ajustar a data), e quem
valida vira o "dono" da cautela para efeito de alerta — junto com o
monitor e todo `super_admin` (rede de segurança se ninguém validou
ainda). `biomonitor_checar_cautelas_vencidas` roda via pg_cron
(diário, 09h15 UTC), dois avisos por cautela (3 dias antes + no
vencimento) com dedupe por `ref` no `meta` da notificação — mesmo
molde de `frota_checar_vencimentos` (migration 205). Novo valor
`'biomonitor'` em `tipo_notificacao` (migration 229, própria por
regra do ADD VALUE). `biomonitor_devolver_equipamentos` resolve os
avisos pendentes da cautela quando ela é totalmente devolvida.

Ocorrência de equipamento (dano/defeito/extravio/perda): o monitor
reporta a qualquer momento pelo app (não só na devolução), mesmo com
a cautela ainda aberta — tabela `biomonitor_equipamento_ocorrencias`,
RPC `biomonitor_reportar_ocorrencia_equipamento` (idempotente por
`uuid_cliente`, fila offline). Notifica os mesmos destinatários do
alerta de vencimento (validador da cautela relacionada + todo
super_admin). A mesa trata em `biomonitor-equipamentos.html`
(RPC `biomonitor_tratar_ocorrencia_equipamento`), podendo mudar o
status do bem (disponível/manutenção/baixado) no mesmo passo.
`pwa/sw.js`: biomonitor v24 → v25.

## Variáveis de ambiente
SUPABASE_URL=https://atqtybcsvepdabsvgaly.supabase.co
SUPABASE_ANON_KEY=(pública, já em config.js)
SUPABASE_SERVICE_ROLE_KEY=(somente Edge Functions, nunca no frontend)
RESEND_API_KEY=(e-mail de alertas)
PLANET_API_KEY=(Planet/NICFI Basemaps; só no servidor — usada pelos
  proxies /api/planet-tiles e /api/planet-mosaics. Nunca no frontend)

## Qualidade da Água (IQA) — migrations 248–256
Módulo IRMÃO de Brigadas/Biomonitor/Frota, não aninhado no Biomonitor
(`grupos_biomonitor` exige `uc_id NOT NULL` e a maioria dos pontos fica
fora de UC). Plano completo e histórico das decisões em
`docs/qualidade-agua/plano.md` — ler antes de mexer.

**O CÁLCULO DO IQA VIVE EM UM LUGAR SÓ: `agua_calcular_iqa()`**
(migration 249). Nenhuma página reimplementa a conta em JavaScript —
mesma lição de `js/frota-consumo.js` e `js/mapa-recorte.js`. Tela nova
que precise do índice lê `vw_agua_coletas_detalhe`; não recalcula.
Junto vêm `agua_iqa_q` (curvas), `agua_od_saturacao`, `agua_iqa_faixa`
e `agua_conama_violacoes`.

- **Cadastro (248):** `agua_pontos_coleta` (código ANA + `codigos_alias`
  para as grafias erradas da planilha, PostGIS, classe de
  enquadramento), `agua_campanhas` (ano + primeira/segunda),
  `agua_coletas` (campo e laboratório na MESMA linha — é sempre 1:1) e
  `agua_laboratorios`. RLS em todas por `pode_ver`/`pode_editar('agua')`.
  O módulo `agua` nasceu em `modulos` com **`ativo = false`**: durante
  as Fases 0 e 1 só super_admin alcança as tabelas, que é o certo numa
  fase sem tela. Ativar é UPDATE de uma linha, na entrega que criar a
  página.
- **Bruto grava, derivado deriva.** `temp_ar` e `temp_amostra` são
  colunas; o ΔT sai na view. Se a SEMA adotar ponto de controle a
  montante no futuro, é troca de view, não migração de dados. Vale
  igual para a saturação de OD (grava-se mg/L) e para os sólidos
  totais (grava-se dissolvidos e suspensão separados).
- **A FAIXA É DERIVADA, NUNCA DIGITADA.** Na planilha, 9 das 268
  classificações contradiziam o próprio valor (IQA 44,15 marcado BOA).
  No sistema isso deixa de ser possível.
- **Valor censurado (`<1`)**: a coluna numérica guarda METADE do limite
  de detecção e `agua_coletas.censurados` (jsonb) guarda de qual limite
  veio — senão `0,5` no banco vira resultado medido que ninguém
  reconcilia com o laudo.
- **IQA e conformidade CONAMA são leituras SEPARADAS**: um rio pode ter
  IQA "Boa" e violar o limite de turbidez. `agua_conama_violacoes`
  devolve a LISTA do que está fora (array vazio = conforme; NULL = a
  classe do ponto não tem limites cadastrados, que NÃO é o mesmo que
  conforme). Limites em tabela (`agua_limites_conama`), não em código:
  só a Classe 2 está validada, as outras entram por INSERT.
- **Piso de peso**: abaixo de 0,60 de peso medido a função devolve NULL
  em vez de um índice montado com dois parâmetros; os pesos são
  renormalizados pelo que existe, senão faltar dado pareceria piora do
  rio.
- Guarda: `tests/agua-iqa.test.js` — regressão contra as 268 linhas com
  IQA da série histórica, chamando a função DE VERDADE por RPC (uma
  cópia em JS no teste seria o que a migration existe para impedir).
  Erro mediano 0,695 (baseline do plano: 1,75). ⚠ A comparação usa ΔT
  neutro de propósito: a série histórica foi calculada SEM o termo de
  temperatura.
- **Fase 1 ENTREGUE (migration 253)**: as 450 coletas de
  `docs/qualidade-agua/serie-historica.csv` estão em `agua_coletas` —
  **111 `completo`, 339 `quarentena`**. Ponto casado por
  `codigos_alias`, campanha por `ano+ordem`, os dois com `DO $$` de
  sanity ANTES do insert (falha alto se alguma linha não casar, em vez
  de um `INNER JOIN` descartar em silêncio). Quarentena por pH fora de
  0–14, OD >150% da saturação (`agua_od_saturacao`), sólidos em
  suspensão preenchidos (339 linhas — o critério que domina, de
  propósito, é a pendência de unidade ainda sem resolver) e um achado
  desta entrega: linha 271 com o ano da campanha (2022) e a data da
  coleta (2026) divergindo por mais de 1 ano (1 dígito trocado, não
  campanha nova) — quarentena, sem corrigir por suposição. Censurado
  (`<1`) vai para `censurados` (bruto) + metade do limite na coluna
  numérica. IQA da planilha NÃO foi gravado. Bloco de import gerado por
  `scripts/agua_gerar_migration_serie_historica.py` (csv.reader de
  verdade, guardado no repo para reexecutar se o CSV mudar). Tela de
  conferência: `pages/agua-conferencia.html` (lista quarentena, edita
  campo a campo, promove a `completo` ou mantém com observação — sem
  RPC nova, grava direto via `pode_editar('agua')`). Detalhe completo
  em `docs/qualidade-agua/plano.md`, seção "Fase 1 — ENTREGUE".
- **Fase 2 ENTREGUE (migrations 254–256)**: a mesa. `agua_valor_plausivel()`
  (254) é a definição única de "esse valor faz sentido?" — reusa os
  MESMOS limites que a 253 já validou (pH 0–14 impossível/4–9
  improvável; OD >150% da saturação impossível/>130% improvável);
  nenhuma página reimplementa faixa nenhuma. Bucket `agua-laudos` (255,
  privado desde o nascimento — PDF+imagem, 10 MB). Duas páginas novas:
  `pages/agua-pontos.html` (CRUD de pontos — com mapa Leaflet na hora
  de salvar, EWKT `SRID=4326;POINT(lng lat)` direto do cliente, mesmo
  padrão de `admin-biomonitor.html` — e de laboratórios) e
  `pages/agua-laudos.html` (fila de `status='aguardando_lab'` +
  lançamento: cada campo checado por `agua_valor_plausivel` ao perder
  o foco, salvar bloqueia `'impossivel'` e pede `confirm()` para
  `'improvavel'`). Sidebar ganhou o grupo "Qualidade da Água" (3 links,
  incluindo a Conferência da Fase 1 que não tinha entrada ainda).
  **Módulo ATIVO** (migration 256) — confirmado que `tecnico`/`gestor`
  (já com `editar` no grupo `'Gestão'`) cobrem quem opera a mesa;
  `biologo` não precisou de permissão nova.
- **Fase 4 ENTREGUE (sem migration)**: `pages/agua-mapa.html`, mapa
  dedicado — eixo temporal por campanha real (ano+ordem, não intervalo
  contínuo de anos — só ~20 campanhas existem), ponto sem coleta na
  campanha fica VAZADO (nunca some), gaveta lateral (`#amapa-gaveta`,
  não modal, fecha só no ✕) com IQA e conformidade CONAMA em blocos
  SEPARADOS (nunca um substitui o outro; terceiro estado "sem limites
  cadastrados" tratado à parte de "conforme"). Reaproveita
  `js/mapa-recorte.js` só para desenhar a linha do limite do Acre —
  **não filtra os 17 pontos de coleta por `geoNoAcre`**: diferente de
  focos/alertas (ingeridos por bbox, precisam do recorte para não trazer
  lixo de outro país/estado), os pontos são cadastrados um a um pela
  SEMA; Assis Brasil (fronteira Acre-Peru-Bolívia) cai ~72 m fora do
  polígono simplificado de `data/acre_estado.geojson` e sumiria do mapa
  se o mesmo filtro fosse aplicado — ver comentário em
  `montarMarcadores()`. UC de cada ponto vem do `uc_id` já cadastrado
  (autoritativo), não recalculada por `geoUCEm()`. Guarda:
  `tests/agua-mapa.test.js`.
  **Camada de hidrografia (rios) NÃO entrou** — domínios de dado
  geoespacial testados (ANA/SNIRH, IBGE, MMA, INPE, SEMA-AC) devolveram
  403 na política de rede da sessão que tentou; pendência documentada
  em `docs/qualidade-agua/plano.md`, seção "Fase 4 — ENTREGUE", para
  quando uma sessão tiver esses domínios liberados.
- **Fase 3 (app de campo) ENTREGUE** — depois desta rodada, ver seção
  própria "Qualidade da Água — app de campo (Fase 3)" abaixo.
- **Fase 5 ENTREGUE (sem migration)**: `pages/agua-relatorios.html` —
  relatório por bacia hidrográfica nos dois formatos pedidos, PDF
  (`js/agua-relatorio-pdf.js`, timbre oficial, molde jsPDF do
  Biomonitor) e PPTX (`js/agua-relatorio-pptx.js`, gráfico de linha
  nativo da evolução do IQA por ponto, paleta de
  `scripts/gerar-pptx.js`). Fonte única dos dados/agregação em
  `js/agua-relatorio-dados.js`, nunca recalcula IQA/CONAMA — lê
  `vw_agua_coletas_detalhe` pronta. Bacia NULA (Rio Iquiri) vira "Sem
  bacia definida", nunca quebra; coleta em quarentena aparece marcada,
  nunca escondida. jsPDF/autotable/pptxgenjs vendorizados em
  `js/vendor/` (turf/proj4 já eram; jsPDF passou a ser também, nesta
  entrega, para permitir validar os dois arquivos de verdade dentro da
  política de rede da sessão). Fecha o plano original de 5 fases — ver
  "Fase 5 — ENTREGUE" em `docs/qualidade-agua/plano.md` para o
  detalhe completo e o que ficou pendente (hidrografia, ícone do app,
  sólidos em suspensão — nenhum deles reaberto por esta fase).

⚠ Dois aprendizados desta entrega que valem para TODA função nova:
`REVOKE ... FROM PUBLIC` não fecha nada no Supabase (o `ALTER DEFAULT
PRIVILEGES` do projeto concede EXECUTE a `anon` por NOME — revogar do
papel pelo nome), e toda função precisa nascer com `SET search_path =
public`, senão o advisor de segurança acusa.

## Qualidade da Água — app de campo (Fase 3, migrations 257–260)

App de campo offline-first para a coleta de amostras: `pages/agua-app.html`
+ `js/agua-offline.js`/`js/agua-sync.js` (molde de
`brigada-offline.js`/`brigada-sync.js`, simplificado — coleta é linha
única, sem filhos tipo fauna/participantes), câmera/GPS via
`js/brigada-captura.js` reaproveitado sem alteração, shell nativo
`app-agua/` (appId `br.gov.ac.sema.siguc.agua`, convive com os outros
3), `.github/workflows/agua-apk.yml`. Primeiro APK da Água gerado na
entrega de Recursos Hídricos (Fase C) — junto com a mudança de regra
que faz todo app buildar sozinho quando atualiza (ver "Versionamento"
mais acima e a regra de APK em "Regras de desenvolvimento").

**Quem coleta — decidido nesta entrega**: os MESMOS técnicos que já
usam a mesa (`tecnico`/`gestor`/`biologo`), não uma população de campo
sem conta (diferente do Brigadas). Por isso **não existe tabela de
identidade nova** — `agua_coletas.coletor_id` (desde a Fase 0) é
preenchido com `auth.uid()` direto, e `pode_editar('agua')` (já em
produção) já autoriza o app a gravar. ROPA sem entrada nova: TRAT-018
(migration 251, Fase 0) já previa GPS pontual + foto para esta fase.

**GPS é PONTUAL** (`bGpsUmaLeitura`), não contínuo como Brigadas/
Biomonitor — só compara com a coordenada cadastrada do ponto
(auditoria), sem indicador ao vivo. Divergência > 1 km vira aviso não
bloqueante, nunca trava o salvamento.

Bucket próprio `agua-fotos-campo` (privado desde o nascimento,
diferente de `agua-laudos` — que é o PDF do laudo, lançado pela mesa).
Idempotência por `uuid_cliente` (upsert simples, molde Brigadas — sem
elevação de privilégio a proteger como no Frota).

**Dois achados só visíveis testando contra o banco de verdade** (guardar
para qualquer migration futura deste tipo):
1. Índice UNIQUE **parcial** (`WHERE x IS NOT NULL`) não é alvo válido
   de `ON CONFLICT (x)` do PostgREST/supabase-js — o Postgres só infere
   índice parcial quando a cláusula ON CONFLICT repete o mesmo
   predicado, o que o upsert do cliente não faz. Toda sincronização
   falhava. Corrigido (257b) para UNIQUE CONSTRAINT normal — que já
   trata múltiplos NULL como não-conflitantes sem precisar de índice
   parcial nenhum.
2. `c.*` numa view (`vw_agua_coletas_detalhe`) expande no momento da
   CRIAÇÃO da view, não a cada consulta — coluna nova na tabela base
   não aparece na view até ela ser recriada. `CREATE OR REPLACE VIEW`
   só aceita ACRESCENTAR coluna ao final da saída, nunca no meio:
   corrigir exige enumerar as colunas antigas explicitamente e só
   então acrescentar a nova (migration 260).

Guarda: `tests/agua-app-fluxo.test.js` (Playwright, cliente Supabase
stub — rede real bloqueada neste tipo de ambiente de execução).
Contrato do lado do banco conferido à parte via `execute_sql` contra
produção (mesmo padrão da Fase 2), linha de teste apagada ao final.

Detalhe completo — inclusive um bug real de geração de CSS achado
nesta entrega (`sed` de cabeçalho mal calculado corrompeu
`css/agua-app.css` e derrubou a regra `[hidden]`, fazendo todas as
telas do app renderizarem sobrepostas) — em
`docs/qualidade-agua/plano.md`, seção "Fase 3 — ENTREGUE".

**Pós-lançamento (fora do plano de 5 fases) — Histórico de IQA no
app.** Nova aba "Histórico" na barra inferior: gráfico de linha do IQA
por campanha para um ponto escolhido + lista "Minhas coletas" do
próprio técnico. Cor por faixa e o gráfico SVG saem de
`js/agua-iqa-visual.js` (novo, reaproveitado também por
`agua-mapa.html` — mesma lição de `js/frota-consumo.js`, nunca
reimplementar em cada tela); a paleta antiga do IQA falhava o
validador de daltonismo do skill de dataviz (Ruim×Regular
indistinguíveis sob deuteranopia) e foi corrigida junto. Coleta em
quarentena NUNCA é escondida do histórico — mesma cautela do mapa,
aparece com preenchimento fraco + rótulo "em conferência" (achado ao
usar: filtrar por `status='completo'` deixava o gráfico praticamente
vazio a partir de 2022, quase toda a série recente ainda em
quarentena). "Fora do limite" mostra o(s) parâmetro(s) que violou(aram)
(`conama_violacoes` da view), não só a bandeira genérica.

**Pós-lançamento — detalhe da coleta + exportar ficha em PDF.** Tocar
num card do Histórico (por ponto ou "Minhas coletas") abre um modal
(`#coleta-overlay`, busca a linha inteira por id na hora — as listas
só trazem os campos que já usam) com todos os dados: identificação,
cartões de IQA/CONAMA, os ~22 parâmetros medidos (violado destacado),
observações e anexos (foto/laudo, assinados via
`js/fotos-privadas.js`). Botão "Exportar PDF" gera uma ficha de UMA
coleta — `aguaRelMontarPdfColeta()`, nova função em
`js/agua-relatorio-pdf.js` (Fase 5), reaproveitando os MESMOS
primitivos de desenho do relatório por bacia (nunca uma segunda
implementação de layout de PDF no módulo) — e compartilha o arquivo
com `js/compartilhar-arquivo.js` (**novo, arquivo compartilhado**:
lógica de 3 camadas — nativo Capacitor → Web Share API → baixar —
extraída de `js/biomonitor-relatorio-campo.js`, que virou wrapper fino
em cima dela; Água é o 2º consumidor, mesma lição de
`js/frota-consumo.js`, então centralizou em vez de copiar pela 2ª vez).
Isso trouxe o motor de PDF (jsPDF + autotable vendorizados,
`config-sistema.js`, `agua-relatorio-dados.js`, `biomonitor-pdf-fonts.js`)
como dependência nova do shell do app de campo — carregado sob demanda
(só quando o botão é usado), exige conexão (mesma trava que o
Biomonitor já usa nesse caso). Achado ao mexer no build nativo: o
Capacitor do app-biomonitor nunca tinha `js/biomonitor-equipamentos.js`
na lista de cópia do `build-www.mjs` (gap da entrega das migrations
226-228, sem relação com esta) — corrigido junto, pois bloqueava
validar o build do próprio `app-agua`. Guarda: novo teste em
`tests/agua-relatorios.test.js` (`aguaRelMontarPdfColeta`, PDF de
verdade aberto com pdf-parse) e em `tests/agua-app-fluxo.test.js`
(modal + exportação de ponta a ponta, PDF real gerado localmente sem
CDN). `pwa/sw.js`: agua v5 → v6, biomonitor v25 → v26 (ganhou
`compartilhar-arquivo.js` no shell).

**Pós-lançamento — Painel visual em `pages/agua-relatorios.html`.** A
tela de Relatórios (formulário + 6 KPIs + lista) virou um painel de
cards, com o layout inspirado num modelo de dashboard trazido pelo
usuário — só o ESTILO (cabeçalho com pílulas, KPI invertido, medidor
semicircular, barras com valor rotulado, card de ranking); cores e
fontes seguem o design system. Os botões PDF/PPTX viraram um menu
"Exportar" e os filtros, uma gaveta com contador — nenhum filtro foi
perdido. Gráficos novos moram em `js/agua-iqa-visual.js`
(`aguaIqaGaugeHTML`, `aguaIqaBarrasHTML`, `aguaIqaFaixasBarraHTML`,
ao lado do `aguaIqaGraficoHTML` que já existia) e as agregações em
`js/agua-relatorio-dados.js` (`aguaRelPorCampanha`, `aguaRelIqaPorPonto`,
`aguaRelDistribuicaoFaixas`, `aguaRelVariacaoIQA`,
`aguaRelViolacoesRanking`) — a página não desenha SVG nem agrega nada.
**Classificar uma MÉDIA numa faixa seria recalcular no cliente**: por
isso as barras de magnitude usam escala de um tom só (verde) em vez da
paleta de faixa, e o KPI de IQA médio mostra só o número. Chip de
campanha recorta a EXIBIÇÃO de um card, nunca o relatório exportado.
Quarentena entra em tudo, marcada. **Paleta do IQA corrigida**:
`Péssima` #9F1239 → **#86198F** (contra `Ruim` #C2410C dava ΔE 12,3 em
visão normal, abaixo do piso 15 do validador do skill de dataviz — só
apareceu agora porque as duas faixas nunca tinham se encostado antes da
barra segmentada); badge do mapa acompanhou (`badge-erro` →
`badge-roxo`). Duas armadilhas de layout documentadas no código: classe
com `display` vence o `[hidden]` de global.css (precisa de regra
`[hidden]` própria), e filho de card `flex-column` esticado pela grade
precisa de `flex-shrink:0`, senão o conteúdo vaza por cima do vizinho.
Guarda: +8 testes em `tests/agua-relatorios.test.js` (o CDN do
supabase-js precisa ser bloqueado por `page.route`, senão sobrescreve o
stub e a página redireciona pro login; o `require` do `pdf-parse` virou
preguiçoso porque o binding nativo dele derrubava a coleta inteira).
`pwa/sw.js`: agua v11 → v12; brigadas 262 → 263, biomonitor 30 → 31,
frota 86 → 87 (js/config.js ganhou 3 ícones e está no shell dos 4).

**O painel também é a PRIMEIRA PÁGINA do PDF** (`js/agua-relatorio-pdf.js`).
A capa era identificação + 6 números; virou o mesmo painel, na mesma
ordem (KPIs → distribuição por faixa → CONAMA + ranking → IQA por ponto
→ evolução por campanha), desenhado com os primitivos do jsPDF (não é o
SVG da tela rasterizado — sairia serrilhado) e alimentado pelas MESMAS
funções de `js/agua-relatorio-dados.js`. Diferença deliberada: sem chip
para escolher ponto, o PDF traça a **média da bacia por campanha**; o
gráfico de barras mostra os 10 melhores pontos ("(10 de N)" no título) e
o detalhamento das páginas seguintes continua trazendo todos. Dois bugs
corrigidos junto: (1) `AGPDF_IQA_COR` era cópia da paleta que havia
DIVERGIDO da tela ('Boa' lima em vez de verde; 'Péssima' no vermelho
pré-correção) — agora deriva de `AGUA_IQA_FAIXA_COR`, com fallback local;
(2) `_agpdfNovaPagina` incondicional depois da capa inseria folha em
branco quando a nota de quarentena transbordava sozinha — virou
condicional, com teste travando a contagem exata de páginas. ⚠️ Ao
escrever asserção sobre texto extraído de PDF: a legenda sai colada na
seguinte ("…Boa 2Regular 1…"), então `\b` não serve depois do número
(usar `(?!\d)`), e títulos de bloco/seção estão em CAIXA ALTA.
`pwa/sw.js`: agua v12 → v13.

**E no PPTX (slide 2)**: "Resumo do período" virou "Painel do período"
com os mesmos blocos (KPIs, distribuição por faixa, rosca da
conformidade CONAMA com os TRÊS estados, IQA médio por ponto); slides 3
e 4 seguem iguais. Diferença deliberada em relação ao PDF: aqui os
gráficos são **nativos** (`addChart` do pptxgenjs), porque num deck quem
apresenta precisa editar/copiar o gráfico — no documento impresso, não.
`js/agua-relatorio-pptx.js` não está em shell de app (só a mesa usa),
então não mexe em `pwa/sw.js`. ⚠️ PPTX renderizado não pôde ser
conferido (sem LibreOffice/PowerPoint na máquina) — a verificação é
estrutural sobre o XML do .pptx, e é isso que o teste trava.

**Rosca em vez de barra, escopo "Acre todo" e mapa dinâmico no
painel.** Três pedidos numa sessão: distribuição por faixa virou rosca
(`aguaIqaFaixasRoscaHTML`, substituiu `aguaIqaFaixasBarraHTML` — removida,
sem outro consumidor); `Acre todo` é o valor `''` do seletor de bacia e
agora o PADRÃO (nada mais de "escolha uma bacia" antes de ver algo) —
`aguaRelBuscarTodasColetas()` busca sem filtro nenhum, e `aguaRelMontar()`
ganhou `opts.bacia` pra recortar CLIENT-SIDE dentro do que já foi
carregado; a gaveta de Filtros ganhou um campo "Bacia" que só habilita
quando o cabeçalho está em "Acre todo" (senão seria redundante) — é por
aí que "quero mais detalhe" vira "aplico bacia + rio na gaveta" sem
voltar ao cabeçalho. Mapa novo reaproveita tudo de `pages/agua-mapa.html`:
o ESTILO do marcador (preenchimento por faixa + borda por CONAMA +
opacidade da quarentena) foi extraído pra `aguaIqaEstiloMarcador()` em
`js/agua-iqa-visual.js` e as duas telas passaram a chamar a mesma
função — nunca duas cópias do mesmo desenho. Diferença: o mapa dedicado
colore pela campanha selecionada no eixo temporal; o do painel colore
pela coleta MAIS RECENTE do recorte já filtrado (nunca média
classificada numa faixa). Container do mapa fica FORA de `#rl-conteudo`
(que é reconstruído a cada filtro) — nasce uma vez, só troca marcador,
preserva zoom entre filtros. `pwa/sw.js`: agua v13 → v14. Achado
testando: um bug de ÍNDICE na fixture do TESTE (não no app) fazia todo
marcador cair na mesma longitude — destructuring posicional com
contagem errada de blanks; corrigido indexando por `p[6]`/`p[7]` em vez
de contar vírgulas no olho.

**Pós-lançamento — emblema + rio nas telas de bloqueio do app.** As 4
telas com `.lock-screen` de `agua-app.html` (entrar, criar senha, digitar
PIN, criar PIN) trocaram a gota plana em SVG pelo emblema do app
(`/pwa/icons/icon-agua-512.png`, o mesmo do launcher) e ganharam um rio
animado ao fundo, com resposta ao toque. Tudo em `js/agua-rio.js` (novo);
nenhuma página redesenha nada.
- **Campo de fluxo, nunca senóide.** A 1ª tentativa animava ondas
  mudando de FASE: curva que muda de forma sem sair do lugar não é lida
  como correnteza, o olho vê fio luminoso se contorcendo. O que vale é
  partícula advectada (nasce no topo, deixa esteira, morre embaixo) — o
  padrão VIAJA. Três coisas fazem parecer rio, e mexer nelas é mexer no
  efeito: turbulência de ROTACIONAL (divergência zero, os fios se
  enrolam em vez de se cruzarem), PERFIL DE CANAL (meio rápido, margem
  quase parada — sem isso é chuva caindo, não rio) e ESTEIRA
  (`destination-out` tirando alpha, nunca `clearRect`).
- ⚠ **A diferença finita do rotacional tem de ser dividida por 2·d.**
  Sem normalizar, a deriva lateral fica em ~1 px/s contra 46 px/s de
  descida — chuva reta, sem redemoinho. Foi o defeito real da 1ª versão,
  achado medindo o campo, não olhando a tela. Ao normalizar, o outro
  extremo aparece: o `vy` chega a −62 (água SUBINDO). Calibragem final
  por varredura numérica (`curl` 30, amortecimento 0,22 no eixo
  vertical) + piso em `_campo`: a turbulência amassa a descida, nunca a
  inverte.
- ⚠ **Calibragem é proporcional à tela, nunca em pixel absoluto.** Com
  escala fixa o redemoinho tem sempre ~139 px: numa tela de 274 é um
  meandro calmo, numa de 430 vira rabisco miúdo e o fundo parece
  ARRANHADO. `_calibrar()` amarra o tamanho do redemoinho à LARGURA e a
  velocidade à ALTURA (a água leva ~12 s para atravessar em qualquer
  aparelho).
- ⚠ **Quem morre de idade renasce ESPALHADO, não no topo.** A travessia
  (~12 s) é mais longa que a vida de um filete (3–9 s), então quase
  nenhum completa o percurso; mandar todos de volta ao topo amontoava a
  água na faixa de cima e deixava a metade de baixo vazia. Só quem sai
  pela borda volta pelo topo.
- **Toque na água**: a onda não é só um anel desenhado por cima — ela
  EMPURRA o campo de fluxo ao passar (`_campo` soma o empurrão radial),
  então os filetes se afastam do dedo de verdade, com anel, clarão curto
  e respingos balísticos. Escutado na `.lock-screen` em CAPTURA, não no
  canvas (que é `pointer-events:none`): assim apertar uma tecla do PIN
  também ondula — cada dígito vira uma gota na água.
- ⚠ **Armadilha de CSS achada aqui**: `.lock-screen > *` tem a MESMA
  especificidade que `.lock-rio` e vem depois no arquivo, então vencia
  com `position: relative` — e canvas relative vira item do flex,
  empurrando o conteúdo das 4 telas. O `position: absolute` precisa ser
  repetido na regra `.lock-screen > .lock-rio`. Empilhamento:
  0 rio · 1 vinheta · 2 conteúdo.
- **Bateria (aparelho de campo)**: as 4 telas coexistem no DOM, então
  sem trava rodariam 4 rios ao mesmo tempo. `IntersectionObserver` só
  anima a tela à vista, e `visibilitychange` para com o app em segundo
  plano. Com "reduzir movimento" o rio desenha um quadro parado e o
  toque nem é instalado.
- ⚠ **`/pwa/icons/…` NÃO existe dentro do APK.** O emblema é a primeira
  `<img>` de caminho absoluto do app; sem cópia explícita, as 4 telas do
  APK abririam com imagem quebrada (o site serve pela Vercel, o shell
  nativo não tem nada fora de `www/`). `app-agua/scripts/build-www.mjs`
  passou a copiar `pwa/icons/` e ganhou uma trava para `<img src="/…">`
  não embarcada — irmã da que já existia para `<script src="/js/…">`.
  Qualquer imagem nova de caminho absoluto precisa entrar na lista.
- Guarda: `tests/agua-rio.test.js` (5 testes). A verificação do desenho é
  por PIXEL do próprio canvas (`getImageData`, canal alpha), não por
  screenshot — a vinheta do CSS fica POR CIMA do rio, então um
  screenshot mediria os dois misturados. Cobre também o emblema
  carregando de fato (`naturalWidth > 0` pega caminho errado, que a olho
  nu só some), o canvas não roubando o toque das teclas, e as telas
  escondidas com ZERO pixel pintado.
- `pwa/sw.js`: agua v15 → v16 (`js/agua-rio.js` e o ícone no shell).

**Pós-lançamento — emblema na faixa institucional da Home.** O mesmo
emblema entrou na `.faixa-inst` do `tela-home`, na coluna do MEIO da
grade (entre Governo do Acre e SEMA) e transbordando ~27 px para baixo
da faixa — a estrutura já existia no molde de `brigada.css` (grade
`1fr 96px 1fr`, `.faixa-mascote` absoluto, `margin-bottom` da faixa
reservando o espaço); só estava sem ocupante, porque Água não tem
mascote. Animação própria de água: `agua-emblema-boia` (sobe/desce de
leve) + `agua-emblema-halo` (o brilho ciano respirando junto), no lugar
do `mascote-respira` herdado.
- 70 px, não os 86 px do molde: lá o mascote é foto circular, aqui é um
  squircle cheio — no mesmo tamanho pesa demais e invade o conteúdo.
- `border-radius: 0` (mesma razão do `.lock-mascote`) e `cursor:pointer`
  removido: no Brigadas tocar o mascote abre menu, aqui não faz nada.
- ⚠ **TODO keyframe do emblema precisa repetir `translateX(-50%)`** — é
  ele que centra na coluna do meio (`left:50%`). Um keyframe sem isso
  joga a arte meia largura para a direita NO MEIO do ciclo, defeito que
  ninguém liga à animação depois. O teste amostra o ciclo inteiro
  (4,6 s) cobrando o centro em todos os quadros; conferido que reprova
  de fato (34,77 px de desvio com um keyframe quebrado de propósito).
- O `filter` do drop-shadow vive só nos keyframes do halo: declarado
  também na regra base, sobrescreveria a animação e o brilho não
  pulsaria.
- Guarda: +2 testes em `tests/agua-rio.test.js` (7 no total).
- `pwa/sw.js`: agua v16 → v17. Nenhum arquivo novo entra no shell, mas
  `css/agua-app.css` e `pages/agua-app.html` (os dois tocados aqui) JÁ
  estão nele e a v16 já tinha ido para produção — sem o incremento, quem
  abrisse com a v16 em cache não receberia o emblema.

**Pós-lançamento — Painel PÚBLICO (link para o site da SEMA), sem
login.** `pages/agua-publico.html` — mesmo painel de
`pages/agua-relatorios.html` (KPIs, rosca por faixa, medidor CONAMA,
barras por ponto, evolução por campanha, mapa, exportação PDF/PPTX),
publicável como link no site institucional. Decisão de acesso: só link
direto, sem iframe — `frame-ancestors 'none'` global do `vercel.json`
continua valendo também para esta página (nenhum carve-out novo).
Quarentena ENTRA, marcada como dado preliminar (mesma regra do painel
de mesa) — sem isso a série de 2022 em diante fica quase vazia no
público. Exportação de PDF e PPTX aberta a qualquer visitante.

- **Nunca duas cópias do painel**: os cards saíram de dentro de
  `agua-relatorios.html` para `js/agua-painel.js` (novo —
  `aguaPainelHTML()`, pura, devolve string; `aguaPainelMapaCriar()`,
  cria o Leaflet + desenha o limite do Acre + atualiza marcador) — as
  DUAS páginas chamam as mesmas funções. Mesma lição de
  `js/frota-consumo.js`: um ajuste futuro no painel vale para as duas
  telas de graça, nunca diverge.
- **`anon` já tem GRANT de tabela em tudo** (padrão do Supabase) — o
  que hoje bloqueia leitura pública é só a RLS de
  `agua_coletas`/`agua_pontos_coleta` (`pode_ver('agua')`, que desde a
  281 exige lotação). Afrouxar essa RLS para "ou lotação ou anon"
  seria abrir a MESMA porta para qualquer chamada direta ao Supabase, e
  o alvo aqui é uma superfície bem mais estreita. Solução: migration
  297, três funções `agua_publico_*` **SECURITY DEFINER** (dono
  `postgres`, que tem `BYPASSRLS` — mesmo mecanismo que já sustenta
  `is_chefe_brigada()`/`nivel_efetivo()`), cada uma com **lista
  explícita de colunas no `RETURNS TABLE`** — nunca `SELECT *`, nunca a
  view interna `vw_agua_coletas_detalhe`. O que não está na lista não
  pode vazar por descuido futuro:
  - `agua_publico_coletas()` — ponto/campanha/data/status/IQA/CONAMA.
    FICAM DE FORA (não existem como coluna, não é `WHERE` escondendo):
    `coletor_id`/`coletor_nome`/`criado_por` (identifica o SERVIDOR,
    não o rio), `localizacao`/`lat`/`lng`/`gps_confirmacao` (GPS do
    aparelho do técnico), `foto_url`/`laudo_url`/`observacoes`/
    `quarentena_motivo`, `linha_origem_planilha`, `laboratorio_id`.
  - `agua_publico_pontos()` — id/nome/lat/lng já extraídos
    (`ST_Y`/`ST_X`), para o mapa. A página pública nem carrega
    `js/mapa-recorte.js` — não precisa parsear geom bruto.
  - `agua_publico_cabecalho()` — só o timbre (nomes + URLs das logos),
    mesmas chaves de `getCabecalhoRelatorio()`; sem endereço/telefone/
    e-mail/responsáveis técnicos (não usados pelo timbre).
  - IQA e CONAMA continuam calculados pelas MESMAS funções da view
    interna (`agua_calcular_iqa`/`agua_conama_violacoes`) — chamadas
    de DENTRO da função SECURITY DEFINER, então o `REVOKE` de `anon`
    em `agua_conama_violacoes` (migration 252b, ela não é pura) segue
    valendo para chamada DIRETA e não se aplica aqui dentro (mesmo
    mecanismo de sempre: dentro do corpo de uma SECURITY DEFINER,
    `current_user` é o dono). Confirmado rodando como `anon` de
    verdade (`SET LOCAL ROLE anon`): as três funções respondem, e
    `SELECT FROM agua_coletas` direto continua dando "permission
    denied for function pode_editar" — a RLS de mesa não mudou em
    nada.
- **Sem protocolo institucional no PDF/PPTX público.**
  `gerar_protocolo_relatorio()` incrementa uma sequência COMPARTILHADA
  por todos os relatórios do sistema — não é apropriado deixar
  visitante anônimo incrementá-la a cada exportação. O rodapé do
  documento público usa o texto fixo "Acesso público — não
  protocolado" no lugar do número; a RPC nunca é chamada por
  `agua-publico.html`.
- **Página autônoma de propósito**: sem `gerarLayout()`, sem
  `carregarUsuario()` — e portanto sem gate de LGPD/perfil (os dois só
  existem DENTRO de `carregarUsuario()`, nunca chamada aqui) e sem
  redirecionamento para `index.html`. Ainda carrega `js/config.js`
  (única fonte de `esc`/`bico`/`formatNum`/`BICON_PATHS`/`toast` — 
  reaproveitar em vez de duplicar) mas nunca chama a função que
  dispara login; cabeçalho institucional próprio (`.apub-*`, logo Acre
  à esquerda/SEMA à direita — mesma regra de timbre do projeto) no
  lugar da sidebar.
- Guarda: `tests/agua-publico.test.js` — trava a LISTA DE COLUNAS lendo
  o texto da migration 297 (nenhuma das proibidas aparece no
  `RETURNS TABLE`), que a página nunca chama `.from()`/`db.auth` (stub
  sem os dois — travaria com "is not a function" se a página tentasse),
  render de ponta a ponta sem sessão, quarentena marcada, mapa a partir
  de `agua_publico_pontos()`, e que a exportação nunca chama
  `gerar_protocolo_relatorio`.
- Sem mudança em `pwa/sw.js`: `agua-publico.html` não é PWA/app de
  campo, não entra em nenhum `SHELLS`.
- **Regra permanente, pedida pelo usuário**: `pages/agua-relatorios.html`
  (mesa) e `pages/agua-publico.html` (link público) são o mesmo par de
  "duplicação obrigatória" que já existe para o Frota (ver "Regras de
  desenvolvimento" acima) — mudança visual/funcional nos CARDS ou no
  MAPA do painel (novo KPI, gráfico novo, filtro novo, campo novo na
  tabela) entra em `js/agua-painel.js`, então já vale para as duas
  telas de graça. Mas toda vez que a tela de MESA ganhar algo que a
  função compartilhada não cobre (nova RPC de dado, novo campo que
  não está na whitelist de `agua_publico_coletas()`/`agua_publico_pontos()`/
  `agua_publico_cabecalho()`, nova ação que dependa de sessão), quem
  entrega a mudança decide explicitamente se o público também ganha —
  e se ganhar, é migration nova na whitelist (nunca afrouxar RLS nem
  expor a view interna), nunca herdado por acidente.

**Pós-lançamento — Base legal, "Entenda o cálculo do IQA" e rebrand
azul do painel (migration 298).** Pedido do usuário, aplicado nas DUAS
telas (mesa e público) via `js/agua-painel.js`, junto com o par de
duplicação obrigatória acima.

- **Card "Base Legal e Conformidade"** (`aguaPainelBaseLegalHTML`):
  sempre mostra a Resolução CONAMA nº 357/2005 (Art. 14/15 — texto
  citado a partir do PDF oficial que o usuário enviou, conferido
  linha a linha contra os limites já cadastrados em
  `agua_limites_conama`, DOU nº 053 de 18/03/2005) — **texto fixo no
  cliente**, nunca gerado/inventado. Atos ADICIONAIS (portaria
  estadual etc.) são cadastrados em Configurações → Qualidade da Água
  (`config_sistema.dados.agua.base_legal`, array de
  `{titulo, orgao, data, link, ementa}` — mesmo padrão de
  `responsaveis_tecnicos`/`encarregado`, sem migration nem deploy para
  editar). Migration 298 só amplia `agua_publico_cabecalho()` com a
  chave `baseLegal` (mesma assinatura, `CREATE OR REPLACE` seguro) —
  a mesa lê `config_sistema` direto via `getConfigSistema()` (já
  autenticada), o público via essa RPC. Card aparece INDEPENDENTE do
  filtro/recorte de coletas (inclusive com "Nenhuma coleta encontrada").
- **Popup "Entenda o cálculo do IQA"** (`aguaPainelExplicacaoIqaHTML`,
  botão novo no cabeçalho, reaproveita `.modal-overlay`/`.modal` de
  `css/global.css`): pesos e faixas são os NÚMEROS REAIS de
  `agua_calcular_iqa()`/`agua_iqa_faixa()` (migration 249) — OD 17%,
  Coliformes termotolerantes 15%, pH 12%, DBO 10%, Nitrogênio total
  10%, Fósforo total 10%, ΔT 10%, Turbidez 8%, Sólidos totais 8%;
  faixas Ótima ≥79 / Boa 51–78 / Regular 36–50 / Ruim 19–35 / Péssima
  <19. Se o cálculo mudar lá, este texto tem que ser atualizado junto
  — é comentário no próprio código, não teste automatizado.
- **Rebrand azul do painel** — só a cor de MARCA (pílulas, cabeçalho
  institucional, chip ativo, card escuro do KPI: `#2563A8` →
  `#164070`, variáveis `--adash-azul`/`--adash-azul-esc` escopadas em
  `.adash`, nunca a `--verde-medio` global — o resto do SIGUC-AC
  continua verde). **A paleta da FAIXA do IQA (Ótima/Boa/Regular/Ruim/
  Péssima, verde→vermelho, validada contra daltonismo) e o semáforo de
  delta positivo/negativo (`--sucesso`/`--erro`) NÃO mudaram** —
  decisão confirmada com o usuário: são semântica ambiental e
  universal, não "verde de marca".
- **Título em Source Serif 4** (`<link>` do Google Fonts nas DUAS
  páginas, não em `css/global.css` — só este painel diverge do
  Fraunces sitewide, escolha deliberada do usuário após comparar um
  rascunho publicado como Artifact). CSP já cobria (`style-src`/
  `font-src` já liberam `fonts.googleapis.com`/`fonts.gstatic.com`).
- Guarda: `tests/agua-publico.test.js` ganhou os testes da migration
  298 (estrutural, sem depender de rede) e 3 testes de render (card
  sempre visível, atos adicionais somando à CONAMA, popup com os
  pesos/faixas reais) — estes 3 últimos dependem do CDN real do
  Leaflet (unpkg.com) para a página terminar de montar, mesma
  limitação de rede já documentada para `tests/agua-relatorios.test.js`
  (não é regressão: confirmado visualmente com screenshot renderizado
  via stub de `L`, nas duas telas).
- Sem mudança em `pwa/sw.js` (nenhuma das duas páginas é PWA/app de
  campo).

**Pós-lançamento — Componentes cartográficos oficiais no mini-mapa do
painel ("Mapa dos pontos de coleta").** Pedido do usuário: o mapa do
painel (não o `pages/agua-mapa.html` dedicado — o card menor dentro do
próprio painel de Relatórios/público) ganhou os mesmos componentes já
padrão do Mapa das UCs (`pages/mapa.html`), em escala reduzida pro
tamanho do card — nunca reimplementados do zero:
- **Rosa dos ventos**: mesmo SVG de `_adicionarRosaDosVentos()`
  (`pages/mapa.html`), copiado verbatim para `js/agua-painel.js`
  (`_aguaPainelRosaDosVentos`) — mesma identidade visual "oficial" em
  todo o sistema, só menor (40px em vez de 52px).
- **Escala**: `L.control.scale()` nativo do Leaflet, métrica, mesma
  configuração de `js/mapa-cartografia.js` (`_adicionarEscala`).
- **Legenda**: mesmas categorias de `pages/agua-mapa.html`
  (`#amapa-legenda`) — preenchimento = faixa do IQA, borda = CONAMA
  (conforme/violação), preenchimento fraco = quarentena — nunca uma
  terceira cópia da legenda; lê `AGUA_IQA_FAIXA_COR`/`_ORDEM` de
  `js/agua-iqa-visual.js`, a mesma fonte que os marcadores já usam
  (`aguaIqaEstiloMarcador`), então nunca diverge da cor real do ponto.
- **Satélite**: alternância de 2 estados (Mapa/Satélite) — não o
  painel completo de basemaps de `pages/mapa.html` (MapBiomas/PRODES/
  Sentinel/Planet — overkill pra um card de 380px), só a MESMA fonte
  de tile de satélite já usada lá (Google, `lyrs=s`, mesmos
  subdomínios `mt0-3`) e no minimapa (`_adicionarMiniMapa`, `lyrs=y`)
  — nunca um provedor de imagem novo.
- Tudo em `aguaPainelMapaCriar()` (`js/agua-painel.js`), então vale
  para as duas telas de graça — mesmo par de duplicação obrigatória.
- Guarda: `tests/agua-relatorios.test.js` e `tests/agua-publico.test.js`
  ganharam 1 teste cada (rosa/escala/legenda visíveis, toggle de
  satélite troca o estado ativo sem quebrar os marcadores) — mesma
  limitação de rede (Leaflet via unpkg.com) já documentada acima;
  confirmado funcionando via stub de `L` fora da suíte automatizada
  (rosa/escala/legenda/toggle, os 4 renderizando e o clique trocando
  de tile de verdade).

**Pós-lançamento — Pino gota-d'água + popup de detalhe do ponto, com
exportação de UMA coleta (migration 300).** Pedido do usuário, com
proposta apresentada e aprovada ANTES de codar (Artifact de comparação
de 3 formas de marcador): o círculo simples do mapa do painel virou um
pino "gota d'água" (Opção A), e clicar nele abre um popup com o
detalhe da coleta mais recente do ponto + botão para exportar só
aquela ficha em PDF.
- **Forma do pino, não a cor/semântica**: `_aguaPainelPinSVG`/
  `_aguaPainelPinIcon` (`js/agua-painel.js`) trocam `L.circleMarker`
  por `L.marker` + `L.divIcon` com um SVG de gota (recorte branco +
  glifo de gota dentro) — a cor de preenchimento (faixa do IQA), a
  borda (conformidade CONAMA) e a opacidade reduzida (quarentena)
  continuam vindo de `aguaIqaEstiloMarcador()`, sem nenhuma mudança de
  semântica. `aguaPainelMapaCriar().atualizar(rel, geoms, onClique)`
  ganhou o 3º parâmetro (opcional) — cada página decide o que "clicar
  no pino" faz; sem ele, comportamento idêntico a antes.
- **Dado ambiental, não pessoal — decisão confirmada com o usuário
  antes de codar.** O popup só teria IQA/CONAMA que o mapa já mostra
  sem os ~21 parâmetros medidos (pH, turbidez, OD...) — por isso a
  migration 300 ampliou `agua_publico_coletas()` com esses parâmetros
  + `classe_enquadramento`. Continuam de fora, sem mudança nenhuma:
  coletor/GPS do aparelho/foto/laudo/observações/hora/código da
  amostra (ausência de coluna no `RETURNS TABLE`, nunca `WHERE`
  escondendo) — mesma disciplina de whitelist da 297. `CREATE OR
  REPLACE` não aceita mudar a lista de colunas (lição repetida da
  178/224/173/297) — `DROP FUNCTION` explícito antes.
- **`aguaPainelColetaDetalheHTML(ponto, c)`** (`js/agua-painel.js`) é
  pura e compartilhada pelas duas telas — mesmo par de duplicação
  obrigatória do painel. Campos que só existem na mesa (`coletor_nome`,
  `laboratorio_nome`, `quarentena_motivo`, `observacoes`) usam
  `!== undefined` para sumir de vez no público (ausência de coluna) em
  vez de aparecer como "—" (campo existe, só está vazio) — mesma
  distinção que o resto do projeto já usa para dado ausente vs. dado
  vazio. IQA/CONAMA calculados pela MESMA função do mapa/relatório,
  nunca recalculados no popup.
- **Exportar** reaproveita `aguaRelMontarPdfColeta()`/`aguaRelBaixarPdf()`
  (`js/agua-relatorio-pdf.js`, já existentes desde o detalhe de coleta
  do app de campo — pós-lançamento anterior) sem nenhuma alteração:
  na mesa (`agua-relatorios.html`) usa `getCabecalhoRelatorio('agua')`
  + `gerarProtocolo()`, como o PDF por bacia já fazia; no público
  (`agua-publico.html`) usa o `_cab`/`PROTOCOLO_PUBLICO` já lidos para
  o PDF por bacia — nunca chama `gerar_protocolo_relatorio()` (regra
  da Fase pública, visitante anônimo não protocola).
- Guarda: `tests/agua-relatorios.test.js`/`tests/agua-publico.test.js`
  — seletor do marcador trocou de `path.leaflet-interactive`
  (`L.circleMarker`) para `.adash-mapa-pin` (`L.divIcon`) em todos os
  testes de mapa existentes, + 1 teste novo por tela (clique abre o
  popup, botão de exportar visível, público sem "Coletor"/"Laboratório").
  Mesma limitação de rede (unpkg.com) documentada acima; confirmado
  funcionando via stub de `L` fora da suíte (pino SVG, callback de
  clique, HTML do popup com IQA/CONAMA/parâmetro violado destacado).
- Sem mudança em `pwa/sw.js` (nenhuma das duas páginas é PWA/app de
  campo).

**Pós-lançamento — Limite do Acre, municípios e hidrografia SEMPRE
carregados no mapa do painel, inclusive no satélite.** Pedido do
usuário: o satélite não tem nenhum rótulo político/hidrográfico (ao
contrário do mapa de ruas, que já traz alguns do OpenStreetMap) — as
mesmas camadas de referência que `pages/mapa.html` (Mapa das UCs) já
oferece como TOGGLE entram aqui como parte fixa do mapa, sem menu de
camadas (o card do painel não tem espaço para um).
- **Municípios**: mesmo arquivo `data/municipios_acre.geojson` de
  `pages/mapa.html` (`_carregarMunicipios`/`_renderizarMunicipios`),
  desenhado com `L.geoJSON` + rótulo permanente por polígono
  (`.adash-mapa-mun-label`, mesmo estilo visual de `.subbacia-label`
  de lá — nunca uma segunda folha de CSS para o mesmo rótulo).
- **Hidrografia (rios/massas d'água)**: MESMO serviço WMS de
  `pages/mapa.html` (`HIDRO_WMS_URL`/`HIDRO_WMS_LAYERS` → IBGE BC250,
  `geoservicos.ibge.gov.br`) — nunca uma segunda fonte. Lá é opcional
  (`VEG_LAYERS.hidrografia`); aqui entra sempre ligada, na mesma
  transparência.
- **Limite do Acre** já entrava sempre ligado desde o desenho original
  do mapa do painel (`desenharLimiteAcre`, sem mudança aqui).
- Ordem de pilha: `_trocarBase()` (satélite/ruas) já chamava
  `camadaBase.bringToBack()` — reaproveitado sem alteração, garante
  que trocar de basemap nunca cobre a hidrografia (mesmo tilePane) nem
  os polígonos de município (overlayPane, sempre acima de tile).
  Pinos ficam acima de tudo por padrão do Leaflet (markerPane).
- Tudo em `aguaPainelMapaCriar()` (`js/agua-painel.js`), então vale
  para as duas telas de graça — mesmo par de duplicação obrigatória do
  painel. Legenda (`_aguaPainelLegendaHTML`) ganhou a seção "Camadas de
  referência" citando as três, para quem olha o mapa saber o que está
  vendo.
- Guarda: +1 teste por tela em `tests/agua-relatorios.test.js`/
  `tests/agua-publico.test.js` (rótulo de município visível sem
  precisar ligar nada, inclusive depois de trocar pra satélite) + a
  legenda ganhou a asserção da nova seção nos testes já existentes.
  Hidrografia (tile WMS de verdade) é rede externa que este sandbox já
  bloqueia para os outros componentes — confirmada fora da suíte via
  stub de `L` (2 camadas geoJSON + 1 camada WMS anexadas ao mapa,
  nomes de município reais nos tooltips).
- Sem mudança em `pwa/sw.js` (nenhuma das duas páginas é PWA/app de
  campo).

**Pós-lançamento — Configurar cor/espessura das delimitações e
mostrar/ocultar nomes dos municípios.** Pedido do usuário, em cima da
entrega anterior (limite do Acre + municípios + hidrografia sempre
carregados): um botão de engrenagem (`.adash-mapa-config-ctrl`,
`_aguaPainelControleConfigCamadas`) abre um painel flutuante com cor e
espessura do limite do Acre, cor e espessura dos municípios, e um
checkbox para mostrar/ocultar o nome de cada município — mudança ao
vivo (sem botão "Aplicar"), mesmo espírito dos outros controles do
mapa do painel.
- **Preferência de EXIBIÇÃO, não dado do banco** — persistida em
  `localStorage` (`siguc_agua_painel_camadas`, mesmo padrão de
  `siguc_nav_grupos`/`siguc_resumo_largura`), por navegador, sem RPC
  nova. `_aguaPainelCamadasCarregar`/`_aguaPainelCamadasSalvar`
  (`js/agua-painel.js`) leem/gravam com fallback pro padrão
  (`AGUA_PAINEL_CAMADAS_PADRAO`) se o storage estiver vazio, corrompido
  ou indisponível (modo privado) — nunca quebra o mapa por isso.
- **A legenda reflete a cor ao vivo**: `_aguaPainelLegendaHTML(cfg)`
  ganhou o parâmetro `cfg` (antes hardcoded `#1F4E2C`/`#6366f1`) — ao
  mudar a cor no painel de configuração, o chip "Limite do Acre"/
  "Municípios" na legenda muda junto, nunca fica com a cor errada.
  Guarda a referência do container da legenda
  (`_legendaCtl.getContainer()`) para reescrever o innerHTML no mesmo
  handler que restila as camadas.
- **Restilo sem recarregar dado**: `setStyle()` nas duas camadas
  (`L.geoJSON` já desenhadas) — não refaz o `fetch` dos geojson. O
  toggle de nomes precisa de `unbindTooltip`+`bindTooltip` (o
  `permanent` do tooltip do Leaflet não é uma propriedade que dá para
  só atualizar, é preciso re-vincular) + `openTooltip()` quando volta a
  mostrar.
- Ícone de engrenagem é o MESMO padrão SVG de traço 24×24 já usado no
  resto do projeto (não passou por `BICON_PATHS`/`bico()` porque este
  arquivo não depende de `js/config.js` — é usado também pelo painel
  público, que roda sem sessão).
- Tudo em `js/agua-painel.js`, então vale para as duas telas de graça
  (mesmo par de duplicação obrigatória) — inclusive no público, onde o
  ajuste é só uma preferência local do navegador do visitante, sem
  nenhum dado sensível envolvido.
- Guarda: +1 teste por tela em `tests/agua-relatorios.test.js`/
  `tests/agua-publico.test.js` (abrir o painel, trocar cor/espessura,
  legenda atualiza, ocultar nomes esconde o rótulo). `input[type=color]`
  não é preenchível por `page.fill()` no Playwright — o teste seta
  `.value` e dispara `input` manualmente. Mesma limitação de rede
  (unpkg.com) documentada acima; confirmado funcionando via stub de `L`
  fora da suíte (restilo das duas camadas, legenda atualizada, toggle
  de tooltip, persistência em localStorage).
- Sem mudança em `pwa/sw.js` (nenhuma das duas páginas é PWA/app de
  campo).

**Pós-lançamento — Painel de configuração sobrepondo a legenda +
padrão amarelo contínuo.** Dois ajustes pedidos pelo usuário em cima da
entrega anterior:
- **Painel escondido atrás da legenda**: `.leaflet-top` e
  `.leaflet-bottom` do Leaflet nascem com o MESMO z-index (1000) — o
  canto `bottomright` (legenda) vem depois no DOM que o `topright`
  (onde mora o botão de engrenagem), então sempre pintava por cima
  quando os dois se sobrepunham num mapa baixo como este card. Um
  z-index local no painel flutuante não resolve — a disputa é entre os
  CANTOS (ancestrais), não entre os elementos dentro de cada canto.
  Corrigido com `.adash-mapa-wrap .leaflet-top.leaflet-right {
  z-index:1001 }`, escopado ao card do painel (não mexe em nenhum outro
  mapa do sistema). O painel é temporário — só existe enquanto aberto —
  então sobrepor a legenda é o comportamento certo.
- **Padrão novo**: `AGUA_PAINEL_CAMADAS_PADRAO` passou a `acreCor:
  '#FACC15', acrePeso: 2.6, munCor: '#FACC15', munPeso: 2` — linha
  contínua amarela nas duas delimitações, limite do Acre 30% mais
  espesso que os municípios (2,6 = 2 × 1,3, exato). O `dashArray: '4
  6'` que fazia os municípios tracejados foi removido (linha contínua,
  como pedido); os sliders de espessura do painel de configuração
  ganharam `step="0.1"` (eram `step="1"`) para conseguir alcançar essa
  proporção com precisão ao ajustar manualmente depois.
- Preferência já salva em `localStorage` continua valendo — quem já
  tinha mudado a cor antes desta entrega não é resetado; o padrão novo
  só vale para quem nunca configurou nada.
- Tudo em `js/agua-painel.js` + CSS das duas páginas, então vale para
  as duas telas de graça (mesmo par de duplicação obrigatória).
- Guarda: confirmado fora da suíte via stub de `L` (cor/espessura
  inicial das duas camadas batendo com o padrão novo, proporção exata
  1,3×) — mesma limitação de rede (unpkg.com) documentada acima para o
  z-index (depende de CSS/Leaflet real renderizando, não testável pelo
  stub).
- Sem mudança em `pwa/sw.js` (nenhuma das duas páginas é PWA/app de
  campo).

**Pós-lançamento — Limite do Acre/municípios só na visão satélite +
satélite virou híbrido (nome de rio nativo).** Correção pedida pelo
usuário sobre a entrega anterior: o limite do Acre, os municípios e a
hidrografia (as 3 "camadas de referência") tinham virado sempre
visíveis, inclusive no mapa de ruas — errado, porque o de ruas (OSM) já
tem seus próprios limites/rótulos, então a camada nova só duplicava
informação. A intenção sempre foi só para o satélite, que não tem nada
disso.
- **Visibilidade adiada, não condicionada no desenho.** Os 3 desenhos
  (limite do Acre, municípios, hidrografia) carregam do mesmo jeito de
  antes, mas não chamam mais `.addTo(mapa)` direto — cada um se
  registra em `_registrarCamadaReferencia(layer)`
  (`aguaPainelMapaCriar`, `js/agua-painel.js`), que adiciona/remove do
  mapa conforme `_modoAtual` ('ruas' por padrão, `_atualizarCamadas
  Referencia()` roda de novo a cada clique no toggle Mapa/Satélite).
  Evita condição de corrida: os 3 fetches terminam em momentos
  diferentes, bem depois do primeiro render — sem esse registro central,
  cada um teria que saber sozinho se deve ou não estar visível no
  instante em que termina de carregar.
- **Satélite → híbrido**: `AGUA_PAINEL_TILE_SATELITE` trocou de
  `lyrs=s` (satélite puro, sem rótulo nenhum) para `lyrs=y` — o MESMO
  id do botão "Híbrido" de `pages/mapa.html` e do minimapa de lá
  (`_adicionarMiniMapa`). É o mosaico que já traz nome de rio/cidade
  como rótulo nativo do Google, sem depender só da geometria (sem
  nome) da WMS de hidrografia do IBGE — nunca uma segunda fonte de
  tile, só troca de camada dentro da mesma fonte. O botão continua
  rotulado "Satélite" na UI (é como o usuário se refere à visão), só o
  mosaico por trás mudou.
- Legenda ganhou "(só satélite)" no título da seção "Camadas de
  referência", pra não confundir quem olha o mapa de ruas sem ver
  nenhuma delas.
- Tudo em `js/agua-painel.js`, então vale para as duas telas de graça
  (mesmo par de duplicação obrigatória do painel).
- Guarda: os testes de "mapa nasce com..." viraram "fica oculto no
  mapa de ruas, aparece ao trocar pra satélite, some de novo ao
  voltar" nas duas suítes; o teste do painel "Configurar camadas"
  agora troca pra satélite antes de abrir o painel (as delimitações
  não existem no DOM em mapa de ruas). Confirmado fora da suíte via
  stub de `L`: as 3 camadas ficam fora do mapa (`hasLayer` = false) em
  ruas, entram ao trocar pra satélite, saem de novo ao voltar — e o
  tile do satélite é `lyrs=y`.

## Regra do sistema — alertas comparativos no lançamento (Água)
Entrega 1 do plano em `docs/qualidade-agua/plano-leitura-laudo-e-alertas.md`
(migrations 302/302b). A checagem física de valor isolado que existia
(`agua_valor_plausivel`, 254) ganhou a camada COMPARATIVA que nunca
teve: o valor lançado é comparado com o histórico do próprio ponto,
com os demais parâmetros da mesma amostra e com a própria campanha.

**A malha vive em UM lugar só: `agua_avaliar_coleta()`** — nenhuma
tela reimplementa limiar (mesma lição de `js/frota-consumo.js` e
`js/mapa-recorte.js`). `js/agua-alertas.js` é avaliador FINO: chama a
RPC, compara número com número e desenha. Seis tipos, três níveis:
`bloqueio` (só `fisico`; impede salvar **na mesa**), `confirmar`
(pede `confirm()`), `informar` (nunca interrompe).
- **Violação CONAMA NÃO é alerta de digitação** e não entra na malha.
  Turbidez de 300 UNT em rio amazônico em cheia é resultado
  verdadeiro e grave; tratá-la como suspeita ensina o técnico a
  ignorar avisos. Continua em bloco separado (`agua_conama_violacoes`).
- **A régua é por ponto E por ordem de campanha** (cheia × seca), com
  degradação DECLARADA: `ponto_campanha` → `ponto` → `rio` → `serie`,
  mínimo n=8. A mensagem é obrigada a dizer qual base usou e com que
  `n` — "atípico para este ponto (mediana 45, n=31)" é acionável,
  "valor atípico" não é.
- **Estatística robusta (quartis ± 3×IQR, em escala log para os
  parâmetros multiplicativos)**, nunca média + desvio padrão: a série
  tem outlier real (turbidez p95 = 588 contra mediana 90) que
  arrastaria a faixa até não alertar nada. `k = 3,0` foi MEDIDO contra
  as 452 coletas de produção (dispara em 12,2% das `completo` × 22,0%
  das `quarentena` — ~2× mais na população já suspeita, em todos os
  cortes testados), não arbitrado.
- **Contexto de campanha**: se os outros pontos da mesma campanha
  saíram da faixa no mesmo sentido, é evento hidrológico e o alerta
  cai para informativo. Sem isso a primeira cheia dispara 17 alertas
  falsos e a malha perde credibilidade na primeira semana.
- **No app, NADA bloqueia** — nem valor fisicamente impossível ("nada
  pode impedir o trabalho de campo", regra do sistema). O app é
  offline-first: cacheia as faixas (`vw_agua_baseline_ponto`, já na
  unidade natural do parâmetro) no store `config` do IndexedDB e usa
  `aguaAlertasDoBaseline`, que é COMPARAÇÃO PURA — nenhuma regra
  duplicada em JS, e o critério novo do banco passa a valer assim que
  sincronizar. Exceção deliberada e documentada à regra "um lugar só".
- **Avaliação da coleta INTEIRA, com debounce de 500 ms — nunca uma
  chamada por campo**: as regras de coerência (ortofosfato × fósforo
  total, E. coli × termotolerantes, SDT × condutividade) só existem
  olhando o conjunto.
- ⚠️ **View que agrega série histórica não pode ser consultada dentro
  de laço** — achado real desta entrega: `vw_agua_baseline_ponto`
  custa 200 ms por avaliação e a 302 a chamava até 22× por chamada
  (~4 s; um lote de 452 estourou o timeout de 60 s). A 302b lê uma vez
  e itera em memória (750 ms). Vale para qualquer RPC futura.
- **Superfícies tocadas juntas** (regra de duplicação):
  `agua-laudos.html` (lançamento), `agua-conferencia.html` (promover
  de quarentena exige resolver bloqueios; manter em quarentena
  continua livre) e `agua-app.html` (campo, offline).
- Guarda: `tests/agua-alertas.test.js` (12 testes) — o mais importante
  exercita a página REAL do app e cobra que a coleta seja salva
  mesmo com alerta na tela.
- `pwa/sw.js`: agua 19 → 20.
- **Achado de dado, novo**: ortofosfato dissolvido > fósforo total em
  273 de 310 coletas (88%) — e NÃO é a conversão PO₄/P (daria fator
  fixo 3,07): razão mediana 8,6, quartis 2,9 e 30,9, persistente em
  todos os anos. Nada foi corrigido — é conferência humana com o laudo
  físico, como os sólidos em suspensão.

## Regra do sistema — leitura assistida do laudo em PDF (Água)
Entrega 2 do plano em `docs/qualidade-agua/plano-leitura-laudo-e-alertas.md`
(migrations 304/305/306), em cima da malha de alertas da Entrega 1.
`pages/agua-laudos.html` lê o PDF do laboratório e PROPÕE o
preenchimento, campo a campo, com o recorte da imagem ao lado —
NUNCA grava nada sozinho.

**Achado que mudou a arquitetura logo na abertura**: os laudos reais
enviados são digitalização de mesa scanner (Epson Scan 2, 200 dpi,
zero fonte embutida) — não texto extraível. `pdf.js` renderiza a
página em canvas; `tesseract.js` faz OCR sobre o recorte de cada
célula (`js/agua-laudo-ocr.js`, único lugar do pipeline — nunca
reimplementar numa página). Os dois vendorizados em `js/vendor/`
(~10 MB, carregado só quando o técnico escolhe um PDF).

- **Gabarito por POSIÇÃO FIXA**, não busca de texto —
  `agua_laudo_templates` (por laboratório, versionado, `campos` +
  `campos_identidade` em jsonb, fração 0–1 da página). Medido nas 17
  páginas do lote real: a posição de cada linha varia no máximo
  ~17 px numa página de 3508 px — ruído do scanner, não do conteúdo.
- ⚠️ **A borda da tabela fica colada acima do valor.** Recorte que a
  inclua faz o OCR fundir régua+dígitos e devolver string VAZIA
  (medido: "3,17"→"" com a borda dentro; sem ela, "3,17" a 87% de
  confiança). Toda caixa do gabarito começa ABAIXO do rótulo
  (deslocamento positivo), nunca em cima — vale para qualquer
  template novo de outro laboratório.
- ⚠️ **Casas decimais são constante do TEMPLATE, nunca lidas do
  OCR.** O glifo da vírgula é pequeno demais em 300 dpi para o OCR
  situar com segurança — achado real: "3,17" foi lido "3,47" (troca
  1↔4) numa célula limpa, sem sinal de baixa confiança. O parser lê
  só os DÍGITOS e insere o separador na posição fixa do template.
- **Nada entra no banco sem confirmação humana campo a campo**, e a
  conferência mostra o RECORTE DA IMAGEM, nunca o texto OCR
  re-digitado — um texto errado reexibido pareceria tão correto
  quanto um certo. `agua_coletas.origem_dados` (jsonb) guarda, por
  campo, se veio de `parser`/`digitado`/`corrigido_apos_parser`.
- **Trava de identidade bloqueia TODO autofill** se data da coleta ou
  procedência do laudo divergirem da coleta aberta na tela — nada é
  proposto, só o confronto aparece. É a defesa contra lançar o laudo
  do ponto A na coleta do ponto B.
- **Extração determinística, nunca por LLM** — o laudo é prova
  jurídica; um número plausível que não está no papel é o pior modo
  de falha possível aqui.
- Calibração medida contra o motor de OCR de verdade, não estimada:
  40/42 (95%) em teste offline (poppler); 10–11/14 (71–79%) no
  navegador real — a diferença é o decodificador JPEG do Chromium
  divergir sutilmente do poppler em casos-limite. Toda falha medida
  foi string vazia, nunca número errado silencioso.
- `agua_atualizar_coleta` ganhou `origem_dados` na whitelist —
  mudança CIRÚRGICA no corpo (assinatura intacta, sem `DROP
  FUNCTION`); trocar a lógica de merge por COALESCE quebraria o NULL
  explícito que a tela de conferência usa para limpar
  `quarentena_motivo`.
- Guarda: `tests/agua-laudo-parser.test.js` (10 testes, pipeline real
  no Chromium, contra páginas REAIS extraídas do lote enviado —
  `tests/fixtures/laudos/`, nunca fixture sintética).
- Sem mudança em `pwa/sw.js`: `agua-laudos.html` é tela de mesa, não
  app de campo.
- Pendente para a Entrega 3: cadastro de template pela mesa (hoje é
  SQL direto), `agua_prazos_analise`, segundo laboratório (estrutura
  já suporta, falta amostra para calibrar).

## Regra do sistema — gabarito de laudo e prazo de preservação (Água)
Entrega 3 do plano em `docs/qualidade-agua/plano-leitura-laudo-e-alertas.md`
(migrations 307/308/308b/309), fechando duas das quatro pendências da
Entrega 2 (as outras duas — segundo laboratório, OCR não-SIMD —
continuam sem amostra/necessidade real, registradas como estão).

- **Cadastro de gabarito pela mesa** (aba "Gabaritos de laudo" em
  `pages/agua-pontos.html`): editor de JSON, não calibrador visual —
  medir a posição de cada campo contra um laudo real é trabalho de
  quem está olhando o PDF (como a Entrega 2 fez para o QUILAB); a tela
  cadastra o resultado dessa medição, não faz a medição. Editar (não
  criar) exige reauth + justificativa, mesmo tratamento de
  `agua_atualizar_ponto`/`agua_atualizar_laboratorio` — mudar o
  gabarito muda o que o parser propõe em todo lançamento futuro.
- **Prazo de preservação** (`agua_prazos_analise`, 18 parâmetros do
  Standard Methods 24ª ED — a mesma norma citada no laudo — em tabela,
  nunca código): `agua_prazo_preservacao_alertas(data_coleta,
  data_recebimento, parametros[])` compara o intervalo coleta→
  recebimento contra o prazo de cada parâmetro presente na amostra.
  **Sempre informativo, nunca bloqueia** — estourar o prazo não é
  "resultado errado", é "resultado com validade comprometida", e isso
  tem de ficar registrado, não impedir o lançamento.
- **Recebimento no laboratório é PROXY do início da análise** — este
  laudo não imprime data de análise em si, só coleta e recebimento.
  Aproximação FAVORÁVEL: a análise só pode ocorrer depois do
  recebimento, então o alerta é piso do atraso real, nunca alarme
  inflado. Campo novo: `agua_coletas.data_recebimento_laboratorio`.
- ⚠️ **Recebimento NUNCA entra na trava de identidade.** Validado com
  OCR de verdade: dia/mês saem corretos, mas o ano erra ocasionalmente
  um dígito (mesmo modo de falha da Entrega 2 — "3,17"→"3,47").
  Bloquear autofill por causa desse campo geraria falso bloqueio
  demais. `aguaLaudoExtrairDataPlausivel()` só propõe a data quando o
  ano cai num intervalo plausível (2015 até ano atual+1); fora disso,
  `null` — o texto lido fica só como referência, o técnico digita.
- Guarda: +2 testes em `tests/agua-laudo-parser.test.js` (12 no
  total).
- Sem mudança em `pwa/sw.js`: `agua-pontos.html` e `agua-laudos.html`
  são telas de mesa, não app de campo.

## Próxima tarefa
**Recursos Hídricos e Qualidade Ambiental (DERHQA)** — Fases A, B e C
ENTREGUES (ver "Recursos Hídricos — Fase B" e "— Fase C" acima).
Próximo passo é a Fase D (Qualidade do Ar) — só estrutura reservada
(subgrupo na sidebar + chave `ar` inativa no catálogo), nada
implementado. O polígono das bacias segue pendente: sem ele, o Painel
das Bacias agrega pelo campo de texto do cadastro do ponto. O ingestor
automático da ANA (`ingest-hidro`) está pronto e publicado, mas
desligado até a SEMA concluir o cadastro de credencial no HidroWeb —
ver §C.3 do plano. O usuário enviou o Atlas de Vulnerabilidade a
Inundações da ANA (pôster A0, 2013) — hidrografia + trechos inundáveis,
SEM polígono de bacia; é tema próprio para uma camada futura,
registrado em §B.4 do plano.

Histórico da Fase A: Fase A ENTREGUE
(sidebar reorganizada: o grupo agora é o departamento e Qualidade da
Água virou subgrupo; migration 303 criou `bacias` e `ar` no catálogo,
inativas). Próximo passo é a **Fase B — Bacias Hidrográficas**
(dashboard + relatórios sobre as bacias do Acre e as plataformas de
coleta da ANA/estado), planejada em `docs/recursos-hidricos/plano.md`.
Bloqueio conhecido e medido: `dadosabertos.ana.gov.br`, `snirh.gov.br`
e `geoservicos.ibge.gov.br`/`servicos.ibge.gov.br` devolvem 403 no
proxy das sessões de desenvolvimento — a geometria das bacias precisa
de uma sessão com esses domínios liberados (ou do arquivo trazido pela
SEMA); o navegador em produção alcança esses serviços normalmente.

Módulo Qualidade da Água (IQA): as 5 fases do plano original estão
ENTREGUES (ver `docs/qualidade-agua/plano.md`, seções "Fase 0" a "Fase
5 — ENTREGUE"). Fase 5 fechou o plano: `pages/agua-relatorios.html`
gera relatório por bacia hidrográfica em PDF (documento de registro —
`js/agua-relatorio-pdf.js`, timbre oficial, padrão jsPDF do
Biomonitor) E PPTX (apresentação executiva — `js/agua-relatorio-pptx.js`,
gráfico nativo de evolução do IQA), sempre lendo `vw_agua_coletas_detalhe`
pronta, nunca recalculando IQA/CONAMA. Sem migration nesta fase.
Pendências que sobraram, nenhuma delas tarefa de código de uma sessão
só (ver "Fase 5 concluída — plano original fechado" no plano para o
resumo): **camada de hidrografia** do mapa (Fase 4, bloqueada por
política de rede — domínios já identificados), **ícone do app Água**
(placeholder do Capacitor) e **sólidos em suspensão** (conferência
humana pendente, `pages/agua-conferencia.html`). Módulo Qualidade da
Água não tem mais fase planejada em aberto — trabalho futuro nele é
extensão nova, não retomada de plano. Ao criar qualquer migration
neste ou em outro módulo, rodar `mcp__Supabase__list_migrations`
primeiro — não assumir o número pelo que está no repositório local.

**Sólidos em suspensão continua pendência de conferência humana**
(mediana de 0,342 mg/L com turbidez mediana de 90 UNT — provável
mistura de g/L com mg/L ao longo dos anos): as 339 linhas quarentenadas
por isso esperam alguém da SEMA com o laudo físico, usando a tela de
`pages/agua-conferencia.html`. Não é tarefa de código.

**Ícone do launcher do app Água** ainda é o placeholder genérico do
Capacitor (`app-agua/android`) — trocar por arte própria antes do
primeiro APK real. (Nota: esta pendência já foi resolvida numa entrega
posterior — ver "~~Ícone do app Água~~ — resolvido" em
`docs/qualidade-agua/plano.md`, seção "Decisões ainda abertas"; este
parágrafo ficou desatualizado e não foi reescrito agora, fora do
escopo desta entrega.)

**Painel público (link para o site da SEMA) — ENTREGUE.**
`pages/agua-publico.html` + migration 297 (`agua_publico_coletas`/
`agua_publico_pontos`/`agua_publico_cabecalho`, SECURITY DEFINER) — ver
o parágrafo "Pós-lançamento — Painel PÚBLICO" acima, na seção da Fase 3
do app de campo, para o desenho completo (whitelist de colunas, sem
protocolo institucional, `js/agua-painel.js` compartilhado com a tela
de mesa).

**Acesso por organograma**: as 9 frentes do plano
(`docs/acesso-por-organograma.md`) — lotação, amarração módulo↔setor,
credenciamento, `nivel_efetivo()` v2, trilha de auditoria — estão
ENTREGUES na infraestrutura (migrations 262–269), todas com
`modulos.exige_lotacao = false`, ou seja **nada mudou de acesso para
ninguém ainda**. Falta: (1) inventariar/converter o resto das ~125
policies com `perfil` direto que sobraram (ver §3.2 do plano — a
maioria tem DRIFT confirmado entre o catálogo de permissões e a RLS
real, não é conversão mecânica); (2) ligar `exige_lotacao` módulo a
módulo, o que depende de dado humano (lotação de cada servidor + qual
setor é dono de cada módulo) e do relatório `vw_impacto_lotacao()`
rodado antes de cada virada. Ver seção "Regra do sistema — Acesso por
organograma" acima para o resumo do modelo.
