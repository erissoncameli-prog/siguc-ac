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

## Comandos
- Servir localmente (sem build — HTML/JS estático): `python -m http.server 3456`
  (ver `.claude/launch.json`) ou qualquer static server na porta 5500
  (`TEST_BASE_URL` padrão dos testes é `http://localhost:5500`).
- Testes (Playwright): `npm test` roda só `tests/smoke.test.js`. Suite
  completa (read-only): `npx playwright test tests/`. Um teste específico:
  `npx playwright test tests/smoke.test.js -g "nome do teste"`.
  Contra produção: `TEST_BASE_URL=https://siguc-ac.vercel.app npx playwright test tests/`.
- Guardrails estáticos (segurança/lint do projeto, roda na CI): `bash scripts/guardrails.sh`.
- Deploy manual com rollback automático (health check + smoke tests):
  `npm run deploy` (chama `scripts/deploy-with-rollback.sh`; requer `vercel` CLI
  autenticado). Deploy normal de `main` é automático via `deploy.yml`
  (Supabase Edge Functions) + integração Vercel↔GitHub (frontend).
- Sem linter/build configurado — não há `npm run lint`/`npm run build`.

## Estrutura de pastas
- index.html → tela de login
- pages/ → módulos internos (autenticados, usam `gerarLayout()`): dashboard,
  dashboard-executivo, mapa, unidades, monitoramento, ocorrencias, documentos,
  relatorios, equipe, usuarios, historico-acessos, trocar-senha, configuracoes,
  estrutura-organizacional, alertas-ambientais, painel-gestor, saude-sistema
  (observabilidade), netflora (inventário florestal), validacao-campo
  - Pesquisa/AAP: pesquisas.html (gestão interna), pesquisa-publica.html e
    cadastro-pesquisador.html/login-pesquisador.html/portal-pesquisador.html/
    perfil-pesquisador.html/redefinir-senha-pesquisador.html (portal público
    do pesquisador), pesquisa-status.html, validar-aap.html (validação
    pública via QR do AAP emitido)
  - App Brigadas: brigada.html (app de campo), brigadas.html e
    admin-brigadas.html (gestão), relatorios-brigadas.html,
    instalar-brigadas.html (página pública de instalação/atualização)
  - App Biomonitor (quelônios): biomonitor.html (app de campo),
    admin-biomonitor.html, biomonitor-bercarios.html, biomonitor-validacao.html,
    relatorios-biomonitor.html, instalar-biomonitor.html
- js/ → config.js, layout.js, config-sistema.js, env-loader.js,
  observability.js + queryLogger.js + api-monitor.js (observabilidade —
  ver "Observabilidade"), mapa-cartografia.js + mapa-camadas.js,
  relatorio-car.js; brigada-offline.js (IndexedDB) + brigada-sync.js +
  brigada-captura.js (câmera/GPS/marca d'água) + brigada-fauna.js +
  brigada-area.js + brigada-participantes.js; biomonitor-offline.js +
  biomonitor-sync.js + biomonitor-quelonios.js + biomonitor-alertas.js +
  biomonitor-timeline.js; vendor/ (libs de terceiros vendorizadas)
- css/ → global.css, sidebar.css, brigada.css (app de campo),
  biomonitor.css (app de campo), relatorio-print.css
- data/ → uc_acre.geojson, uc_zonas_acre.geojson, uc_detalhes.json,
  municipios_acre.geojson, ti_acre.geojson
- pwa/ → sw.js (service worker; subir CACHE a cada mudança web),
  manifest.json, icons/mascote.png, icons/mascote-copa.png, mascote-video.mp4
- supabase/migrations/ → 001…153+, numeração sequencial mas não estritamente
  cronológica (números duplicados coexistem, ex. `015_*`, `042_*`, `055_*`,
  `061_*`, `070_*`, `075_*` — cada um é um arquivo distinto; ver "Banco")
- supabase/functions/ → Edge Functions (Deno): admin-criar-usuario,
  admin-reset-senha, gerar-login-brigadista, gerar-login-monitor, gerar-aap,
  ingest-focos, monitorar-alertas, monitorar-quelonios, pesquisa-email,
  processar-pesquisa-emails, sincronizar-sinaflor, sisbio-sisgen. Deploy via
  workflow `deploy.yml` (`supabase functions deploy`) a cada push em `main`.
- api/ → Serverless Functions da Vercel (Node, sem framework):
  health.js/health/ (health check com fallback de credenciais públicas),
  metrics.js, env.js (expõe URL+anon key pública), geo.js (proxy consolidado
  MapBiomas/Open-Meteo/Overpass — `?svc=`), car-proxy.js, prodes-proxy.js,
  focos-proxy.js (FIRMS/BDQueimadas), dof-proxy.js (Diário Oficial),
  planet-tiles.js/planet-mosaics.js (Planet/NICFI, usa `PLANET_API_KEY`),
  biomonitor-apk-latest.js. Rotas/CSP/timeouts configurados em vercel.json.
- docs/ → app-brigadas.md, app-biomonitor.md (como gerar/assinar/distribuir
  os APKs), QA-AUTOMACAO.md (camadas de CI), specs do Biomonitor
  (biomonitor-funcionalidades.md, biomonitor-perfis-acesso.md,
  biomonitor-transferencia-monitoramento.md)
- scripts/ → guardrails.sh (lint de segurança, ver "Comandos"),
  deploy-with-rollback.sh, importar_focos_calor.py, sincronizar_uc_areas.py,
  converter_zonas.py e outros utilitários de dados/geoprocessamento (Python)
- tests/ → smoke.test.js (Playwright, roda em todo push/PR),
  pesquisa-flow.test.js (fluxo de pesquisa; bloco de escrita requer staging)
- .github/workflows/ → qa.yml (guardrails + gitleaks + semgrep + trivy + e2e),
  deploy.yml (Edge Functions em push para main), claude-review.yml e
  security-review.yml (revisão por IA em PRs, requerem `ANTHROPIC_API_KEY`),
  brigadas-apk.yml e biomonitor-apk.yml (build/release do APK, manual ou por tag)
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
153+ migrations em `supabase/migrations/`, organizadas por fase (números não
são estritamente cronológicos — vários prefixos se repetem entre fases, ex.
dois `015_*`, dois `042_*`; o arquivo/conteúdo é a fonte da verdade, não só o
número). Fases principais:

- **001–002 — base**: 001_initial.sql cria usuarios, unidades_conservacao
  (PostGIS), ocorrencias, monitoramento_indicadores, monitoramento_registros,
  documentos, equipe_servidores (RLS em todas; trigger touch_atualizado_em()).
  002 adiciona auditoria_acessos + bloqueio após 5 tentativas
  (verificar_bloqueio()/registrar_tentativa_acesso()).
- **003–011 — estrutura organizacional / alertas / painel do gestor**:
  unidades_organizacionais, cargos, cargo_ocupacoes, delegacoes_temporarias
  (VIEW cargos_atuais); alertas_ambientais (DETER-B/BDQueimadas/FIRMS/PRODES);
  notificações do painel do gestor com trigger projeto→notificação.
- **012–041 — Gestão de Pesquisa / Portal do Pesquisador / AAP**:
  fluxo de submissão→triagem→análise→emissão de AAP (PDF+QR)→execução;
  portal público do pesquisador (auth própria, área/formação, endereço);
  validação pública do AAP via RPC anônima; hardening de segurança e
  `search_path` fixo em várias RPCs; também nesta faixa: camadas do mapa
  (018–020), Netflora — inventário florestal (021), DOF/transportes (022).
- **042–072 — App Brigadas**: brigadas/brigadistas (funcao, status,
  foto_url, usuario_id…), registros_campo + registro_fauna + especies_fauna,
  VIEW vw_registros_validacao (relatórios), auditoria/sessão do brigadista,
  `is_chefe_brigada()` SECURITY DEFINER (evita recursão de RLS),
  equipes_brigada (A/B/C), RPC `app_desempenho_brigada()` (agregados sem
  expor linhas), origem_acionamento, fluxo de correções pendentes.
- **073–142+ — App Biomonitor (quelônios)**: praias, ninhos, ovos/eclosão,
  transferência entre praias, berçários (biometria, mortalidade, soltura em
  lote), alertas de quelônios, gestão de temporada, dashboards/VIEWs de
  resumo (vw_bercarios_resumo, vw_praias_biomonitor_viaveis, etc.).

Ao criar uma migration nova, use o próximo número livre da fase relevante
(ou o próximo número global mais alto — confira `ls supabase/migrations | sort -V | tail`).

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

## Observabilidade
`js/observability.js` (carregado antes de qualquer código que use `db`)
implementa: request ID por sessão (`Observability.getRequestId()`), logger
JSON estruturado em buffer e thresholds configuráveis via `window.__ENV`
(`ALERT_ERROR_RATE_THRESHOLD`, `ALERT_LATENCY_P99_THRESHOLD`,
`ALERT_MEMORY_THRESHOLD`, `ALERT_CACHE_MISS_THRESHOLD`, `ALERT_WEBHOOK_URL`
— ver `.env.example`). `js/queryLogger.js` decora o client Supabase (`db`)
para classificar cada query em FAST/SLOW(>50ms)/CRITICAL(>200ms) e redigir
campos sensíveis (senha/token/cpf/etc.) do log. `pages/saude-sistema.html`
é o painel visual disso. No backend: `api/health.js` (checa banco + auth
Supabase, 200/207/503) e `api/health/live.js` (liveness simples) são usados
pelos smoke tests e por `scripts/deploy-with-rollback.sh`, que faz deploy via
Vercel CLI, aguarda o health check, roda smoke tests e reverte o alias de
produção automaticamente em caso de falha.

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
- Login + auth Supabase, sidebar + layout compartilhado (gerarLayout()),
  auditoria de acessos com bloqueio, GeoJSONs do Acre
- **Estrutura Organizacional** (estrutura-organizacional.html): gestão de
  cargos/ocupantes/delegações temporárias (separação cargo × ocupante)
- **Alertas Ambientais** (alertas-ambientais.html): ingestão de
  DETER-B/BDQueimadas/FIRMS/PRODES (Edge Functions `ingest-focos`,
  `monitorar-alertas`, proxies `focos-proxy.js`/`prodes-proxy.js`) com
  cruzamento geoespacial e notificação ao gestor
- **Painel do Gestor** (painel-gestor.html): inbox de notificações com fluxo
  de status e escalamento
- **Gestão de Pesquisa / Portal do Pesquisador** (pesquisas.html,
  pesquisa-publica.html, portal-pesquisador.html e páginas relacionadas):
  submissão → triagem → análise → emissão de AAP (PDF+QR, Edge Function
  `gerar-aap`) → execução → relatórios; validação pública do AAP
  (validar-aap.html); Edge Function `sisbio-sisgen` para integração externa
- **Dashboard Executivo** (dashboard-executivo.html): visão por nível
  (UC / Diretoria / Secretaria)
- **Netflora** (netflora.html): inventário florestal (netflora_inventarios)
- **Mapa/cartografia**: camadas (js/mapa-camadas.js), proxies geoespaciais
  consolidados (api/geo.js: MapBiomas/Open-Meteo/Overpass), CAR
  (car-proxy.js), Diário Oficial (dof-proxy.js), Planet/NICFI (só server-side)
- **Observabilidade / saúde do sistema**: ver seção "Observabilidade"

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

### App Biomonitor (campo, quelônios) — implementado
- Offline-first (IndexedDB `siguc_biomonitor_v1`) + sync; login Supabase +
  PIN (Edge Function `gerar-login-monitor`); mesmo padrão do Brigadas mas
  cliente/app isolado (appId `br.gov.ac.sema.siguc.biomonitor`, convive no
  mesmo aparelho — ver docs/app-biomonitor.md).
- Domínio: praias (com sigla, rio, localização livre), ninhos (distância do
  rio, temp/umidade/profundidade), visitas a ninho (perdas de ovos,
  predação/descarte), transferência de ninho entre praias (com janela
  crítica), eclosão e ovos viáveis, berçários (compartilhados pela equipe,
  uma espécie por lote, biometria — carapaça/plastrão, mortalidade, soltura
  em lote/pool único), alertas de quelônios, gestão por temporada
  (evita misturar dados entre temporadas).
- Edge Function `monitorar-quelonios` para automações server-side.
- Aba Dados / relatórios (relatorios-biomonitor.html): gráficos de
  crescimento, mortalidade, ocorrências e resumos via VIEWs/RPCs dedicadas.
- Config/instalação/atualização seguem o mesmo padrão do Brigadas
  (`instalar-biomonitor.html`, checagem de Releases do GitHub,
  `api/biomonitor-apk-latest.js`).

## Versionamento (OBRIGATÓRIO — vale para TODA sessão)
- A versão de referência do app é o cache do service worker em
  `pwa/sw.js`: `const CACHE = 'siguc-brigadas-vN'`.
- A CADA implementação concluída, ANTES do commit/deploy, INCREMENTAR
  a versão: ler o número atual de `CACHE` em `pwa/sw.js` e subir em 1
  (vN → vN+1). Ex.: `siguc-brigadas-v114` → `siguc-brigadas-v115`.
- Isso invalida o cache do service worker e garante que os aparelhos
  (web/PWA e app de campo) recebam a versão nova. Sem isso, os usuários
  continuam vendo a versão antiga.
- Obrigatório sempre que a entrega tocar arquivos web (HTML/JS/CSS/PWA).
  Entregas só de banco/migrations (sem arquivos web) dispensam o
  incremento — na dúvida, incremente.
- Mencionar a nova versão no commit (ex.: "sw.js: cache vN → vN+1").
- Esta regra é permanente e deve ser seguida em todas as sessões, sem
  precisar ser solicitada novamente.

## Regras de desenvolvimento
- VERSIONAMENTO: a cada implementação concluída, subir a versão do cache
  em `pwa/sw.js` (vN → vN+1) — ver seção "Versionamento" acima.
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

## Variáveis de ambiente
Ver `.env.example` para o template completo. Principais:
- SUPABASE_URL=https://atqtybcsvepdabsvgaly.supabase.co
- SUPABASE_ANON_KEY=(pública, já em config.js/vercel.json)
- SUPABASE_SERVICE_ROLE_KEY=(somente Edge Functions, nunca no frontend)
- RESEND_API_KEY=(e-mail de alertas/pesquisa)
- PLANET_API_KEY=(Planet/NICFI Basemaps; só no servidor — usada pelos
  proxies /api/planet-tiles e /api/planet-mosaics. Nunca no frontend)
- SUPABASE_ACCESS_TOKEN=(CI — usado por deploy.yml para `supabase functions deploy`)
- ANTHROPIC_API_KEY=(CI — ativa claude-review.yml e security-review.yml; opcional)
- ALERT_ERROR_RATE_THRESHOLD, ALERT_LATENCY_P99_THRESHOLD, ALERT_MEMORY_THRESHOLD,
  ALERT_CACHE_MISS_THRESHOLD, ALERT_WEBHOOK_URL (observabilidade — ver seção acima)
- TEST_BASE_URL, HEALTH_URL, LIVE_URL (testes/deploy — ver "Comandos")
