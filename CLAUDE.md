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
- app-frota/ → shell nativo Capacitor do Frota (APK Android gerado pelo
  workflow frota-apk.yml a partir de pages/frota-app.html; appId
  br.gov.ac.sema.siguc.frota — convive com Brigadas e Biomonitor; build via
  app-frota/scripts/build-www.mjs — ver docs/app-frota.md; alterações
  sempre nos arquivos web)

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

## Próxima tarefa
Módulo A — Estrutura Organizacional SEMA-AC
Criar migration 003_estrutura_organizacional.sql + página admin de gestão de cargos
