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

## Regras de desenvolvimento
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
- APK Android (workflow brigadas-apk.yml): NÃO gerar novo APK a cada
  mudança. Só gerar quando o usuário pedir ou quando já houver acúmulo
  suficiente para valer a pena. Mudanças web/PWA podem ir à produção
  normalmente (lembrar de subir a versão do cache em pwa/sw.js).

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
