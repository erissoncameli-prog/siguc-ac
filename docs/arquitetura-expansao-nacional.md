# SIGUC Nacional — Arquitetura de Expansão Multiestado

**Status:** proposta (nenhuma implementação ainda)
**Escopo:** transformar o SIGUC-AC (single-tenant, Acre) numa plataforma
nacional multi-tenant onde cada estado gerencia seus próprios dados, com
painel por estado e painel nacional agregado, e isolamento total entre
estados.

---

## 1. Diagnóstico da arquitetura atual

O sistema hoje é **single-tenant por construção**: existe exatamente um
"dono" implícito (SEMA-AC) e isso está assumido em quatro camadas
distintas. Entender onde o acoplamento mora é o que dimensiona o esforço.

### 1.1 Banco de dados (142 migrations)

- **Nenhuma tabela tem noção de estado.** `unidades_conservacao`,
  `usuarios`, `ocorrencias`, `brigadas`, `registros_campo`,
  `pesquisas`, `alertas`, todo o Biomonitor — tudo pressupõe um único
  território.
- **RLS existe e é madura**, mas as policies isolam por *perfil* e por
  *UC/brigada*, nunca por tenant. O padrão de helpers `SECURITY DEFINER`
  (`is_super_admin()`, `is_chefe_brigada()`, `nivel_efetivo()`) é
  exatamente o mecanismo certo para estender — isso é um ativo, não um
  passivo.
- **`config_sistema` é um singleton** (`id = 1`): nomes de governo,
  secretaria, diretoria, logos, cabeçalhos de relatório — um único
  registro para o sistema inteiro.
- **Unicidades e numerações são globais**: `unidades_conservacao.codigo`
  (`UC-001`) é `UNIQUE` global; as sequências de numeração do módulo de
  pesquisa (migration 024) são únicas por sistema. Dois estados
  colidiriam imediatamente.
- **Bom sinal:** os enums centrais (`categoria_uc`, `grupo_uc`,
  `esfera_uc`, tipos de ocorrência) seguem o **SNUC**, que é lei federal
  — já são nacionais por natureza. Não precisam mudar.

### 1.2 Frontend

- **~236 ocorrências de "Acre"/"SEMA-AC"** hardcoded em 40 arquivos
  (título de páginas, cabeçalhos, textos, `mapa.html` sozinho tem 54).
- **GeoJSONs estáticos em `data/`** (`uc_acre.geojson`,
  `municipios_acre.geojson`, `ti_acre.geojson`, `acre_estado.geojson`)
  carregados por caminho fixo. O mapa tem centro/zoom do Acre fixos.
- `config-sistema.js` já abstrai o cabeçalho institucional com fallbacks
  para o Acre — o *padrão* está certo, só o cardinal está errado (1 em
  vez de N).

### 1.3 Apps de campo (Brigadas / Biomonitor)

- Offline-first com IndexedDB + sync. A fila de sync não carrega
  contexto de tenant (não precisa hoje).
- APKs apontam para `siguc-ac.vercel.app` e para um único projeto
  Supabase. Marca d'água, mascote e branding são do Acre.

### 1.4 Infra e integrações

- Um projeto Supabase, um deploy Vercel (`siguc-ac.vercel.app`), um
  conjunto de env vars.
- Crons de alertas rodam "06h BRT" — o Acre está em UTC−5, a maior parte
  do país em UTC−3. Numa plataforma nacional, **horário vira atributo do
  estado**, não constante do sistema.
- Proxies (`/api/planet-tiles`, `focos-proxy`, `car-proxy`, DETER/PRODES)
  filtram implicitamente pelo território do Acre.

---

## 2. A decisão central: modelo de multi-tenancy

Três opções clássicas, avaliadas contra a realidade do projeto (stack
Supabase + JS vanilla, equipe pequena, contexto governamental).

### Opção A — Banco compartilhado, isolamento por linha (`estado_id` + RLS)

Um único projeto Supabase. Nova tabela `estados`; coluna `estado_id` nas
tabelas raiz; RLS composta com o estado do usuário.

| Prós | Contras |
|---|---|
| Um codebase, um deploy, uma operação | Retrofit de RLS em ~142 migrations de schema |
| Painel nacional é uma query (agregação trivial) | Um bug de RLS = vazamento entre estados |
| Custo marginal por estado ≈ zero | Vizinhança barulhenta (um estado pesado afeta todos) |
| Onboarding de estado = inserir linhas | Estados podem exigir soberania sobre "seu banco" |
| Migrations continuam únicas e lineares | |

### Opção B — Um projeto Supabase por estado

Mesmo código, N bancos. Isolamento físico.

| Prós | Contras |
|---|---|
| Isolamento absoluto (vazamento é impossível por construção) | Orquestrar migrations em N projetos (hoje já são 142) |
| Autonomia institucional real por estado | Painel nacional exige camada de agregação (ETL/FDW) |
| Billing e pausa por estado | Custo fixo por projeto × 27 |
| | Auth fragmentada; usuário federal precisa de N contas |
| | Operação explode para equipe pequena |

### Opção C — Schema por estado no mesmo banco

Descartada: o PostgREST/Supabase expõe mal múltiplos schemas com Auth
compartilhada, e ela herda os piores custos de A e B ao mesmo tempo.

### ✅ Recomendação: **Opção A** como arquitetura base, com a Opção B como válvula de escape

Justificativa:

1. **RLS é exatamente a ferramenta para "cada estado só vê o seu"** — o
   projeto já domina o padrão (helpers `SECURITY DEFINER` + policies).
   O risco de vazamento se mitiga com engenharia (§4.2), não mudando de
   arquitetura.
2. **O painel nacional — requisito explícito — sai de graça** na Opção A
   e vira um subprojeto inteiro (ETL, sincronização, consistência) na
   Opção B.
3. **A equipe é pequena.** Operar 27 projetos Supabase com 142+
   migrations sincronizadas não é viável sem um time de plataforma.
4. **Válvula de escape:** se um estado grande exigir contratualmente
   infraestrutura própria, o desenho com `estado_id` explícito em tudo
   permite exportar o "recorte" daquele estado para um projeto dedicado
   e alimentar o painel nacional por réplica/ETL — sem reescrever o
   sistema. A Opção A não fecha a porta para a B; a B fecha a porta
   para a A.

---

## 3. Arquitetura proposta

### 3.1 Modelo de dados — a espinha dorsal do tenant

**Nova tabela `estados`** (o tenant):

- `id uuid`, `uf char(2) UNIQUE` (AC, AM, RO…), `nome`,
  `timezone` (ex.: `America/Rio_Branco`), `ativo`,
  `config jsonb` (branding, contatos, parâmetros).
- Linha seed: Acre. O sistema atual vira "o primeiro tenant".

**`estado_id` nas tabelas — regra de denormalização:**

- **Tabelas raiz** recebem `estado_id NOT NULL` + FK + índice:
  `usuarios`, `unidades_conservacao`, `brigadas`, `ocorrencias`,
  `pesquisas`, `documentos`, `equipe_servidores`, `camadas_mapa`,
  `alertas_*`, `unidades_organizacionais`, raiz do Biomonitor
  (praias/bercários/temporadas), `especies_fauna` (com flag "catálogo
  nacional" — ver §3.6).
- **Tabelas folha** (ex.: `registro_fauna`, `visitas_ninho`, fotos) já
  são isoladas transitivamente pela FK para a raiz — **não** recebem
  `estado_id`, evitando redundância e triggers de consistência. Exceção:
  tabelas folha de altíssimo volume consultadas sem join
  (`registros_campo`) recebem `estado_id` denormalizado via trigger,
  por desempenho de RLS.
- **`config_sistema` deixa de ser singleton**: `id=1` → uma linha por
  estado (`estado_id UNIQUE`). `getConfigSistema()` passa a resolver
  pelo estado do usuário logado — a assinatura do helper não muda, o
  frontend quase não percebe.

**Unicidades passam a ser compostas:** `UNIQUE (estado_id, codigo)` em
UCs; sequências de numeração (pesquisa, ocorrências — migration 069) por
estado; códigos exibidos ganham a UF (`UC-AC-001`, `OC-AC-2026-0042`).

### 3.2 Isolamento — RLS em duas camadas

**Camada 1 — o estado no JWT.** Usar o *Custom Access Token Hook* do
Supabase Auth para gravar `estado_id` (e `perfil`) em
`app_metadata`/claims. A checagem de tenant em RLS vira comparação com o
JWT — `O(1)` por linha, sem subquery em `usuarios`:

> conceito: `estado_id = (auth.jwt() -> 'app_metadata' ->> 'estado_id')::uuid`

**Camada 2 — um único helper, nunca policies artesanais.** Criar UM
helper canônico (ex.: `mesmo_estado(estado_id)` / `estado_do_usuario()`)
`STABLE SECURITY DEFINER`, no mesmo padrão de `is_super_admin()`. **Toda
policy nova compõe:** `mesmo_estado(t.estado_id) AND <regra atual de
perfil/UC>`. A regra de ouro: *nenhuma policy escreve a checagem de
tenant à mão* — o helper é o único ponto de verdade e o único ponto de
auditoria.

**Perfis nacionais.** Novos perfis com escopo trans-estado:

- `admin_nacional` — administra a plataforma e o onboarding de estados;
- `visualizador_nacional` — vê o painel geral (agregados), ex.: MMA,
  ICMBio, imprensa institucional.

Importante: o painel nacional **não** dá a esses perfis SELECT nas
tabelas cruas dos estados. Eles consomem **apenas RPCs/views agregadas**
(`SECURITY DEFINER`) que devolvem números consolidados — nunca linhas
(mesmo padrão já usado em `app_desempenho_brigada`, migration 059).
Isso mantém a promessa "cada estado só acessa os seus dados" verdadeira
até para os perfis federais, por padrão; drill-down em dados brutos de
um estado só com convênio/autorização explícita (flag no `estados.config`).

### 3.3 Frontend — de "SIGUC-AC" para "SIGUC" parametrizado

- **Uma única aplicação, um único deploy.** O tenant é resolvido **pelo
  login** (o `estado_id` vem no JWT), não pela URL. Subdomínios por
  estado (`ac.siguc...`) ficam como cosmético opcional futuro — não
  como mecanismo de segurança.
- **Branding data-driven:** `appState` ganha `estado`; `layout.js` e
  `config-sistema.js` leem nome/sigla/logos/cores de acento do
  `config_sistema` do estado. As ~236 strings "Acre/SEMA-AC" migram para
  o config (com o Acre como seed, então nada muda visualmente para o
  usuário atual). O design system base (`--floresta`, `--ouro`, fontes)
  permanece **da plataforma** — estados personalizam logos e textos, não
  o tema (senão vira 27 sistemas visuais para manter).
- **Geodados saem de `data/` e vão para o banco/Storage:**
  - Geometrias de UC já existem em PostGIS (`geom`, `zona_amortecimento`)
    — o mapa passa a buscá-las por RPC (GeoJSON gerado por
    `ST_AsGeoJSON`, com cache), filtradas por estado via RLS.
  - Camadas de contexto (limite estadual, municípios, TIs) viram
    arquivos por estado no Supabase Storage
    (`geo/{uf}/municipios.geojson`…), registrados na já existente
    `camadas_mapa` (migrations 018–020 — outro ativo reaproveitável).
  - Centro/zoom inicial do mapa = atributo do estado.
- **Dashboards:** `dashboard.html`/`dashboard-executivo.html` já ficam
  automaticamente "do estado" via RLS (zero mudança de query). Nova
  página `painel-nacional.html`: mapa do Brasil coroplético + agregados
  por estado (nº de UCs, hectares protegidos, ocorrências por status,
  focos, brigadas ativas, pesquisas), consumindo só as RPCs agregadas.
  Materialized views com refresh agendado se o volume pedir.

### 3.4 Apps de campo (Brigadas / Biomonitor)

- **Um único APK nacional** — sem builds por estado. O app já resolve
  tudo a partir do usuário logado (brigada → UC → estado); a única
  mudança estrutural é a fila offline carimbar o contexto ao sincronizar
  (o `estado_id` denormalizado em `registros_campo` resolve no servidor,
  via trigger — o app quase não muda).
- Branding do app (marca d'água, cabeçalho) puxa do config do estado
  após o login; mascote/Modo Copa permanecem da plataforma.
- QR de instalação e `instalar-brigadas.html` continuam únicos.

### 3.5 Integrações, crons e proxies

- **Crons por fuso:** alertas às "06h locais" iteram sobre `estados`
  usando `estados.timezone` (Acre UTC−5 ≠ Brasília UTC−3).
- **Fontes de alerta** (DETER-B, BDQueimadas/FIRMS, PRODES) já são
  nacionais na origem — o download passa a filtrar por UF dos estados
  ativos e o cruzamento `ST_Within` roda contra as UCs de cada estado
  (o PostGIS não muda em nada).
- Proxies (CAR, focos, Planet) recebem parâmetro de UF/bbox em vez de
  assumir o Acre.

### 3.6 Catálogos: nacional × estadual

Decisão explícita por catálogo, para evitar 27 cópias divergentes:

- **Nacionais (compartilhados, curadoria da plataforma):** enums SNUC,
  `especies_fauna` base, `especies_quelonio_catalogo`, catálogo de
  módulos/permissões (056/057).
- **Estaduais:** `atividades_catalogo` (054), estrutura organizacional,
  equipes, camadas de mapa, `config_sistema`.
- Mecanismo: `estado_id NULL = registro nacional` visível a todos +
  registros com `estado_id` = extensões locais (espécies regionais,
  atividades próprias).

### 3.7 Onboarding de um novo estado (o produto interno)

A expansão só escala se ativar um estado for procedimento, não projeto.
Página `admin-plataforma.html` (perfil `admin_nacional`) com um wizard:

1. Criar o estado (UF, nome, fuso, contatos);
2. Preencher `config_sistema` (governo, secretaria, logos, cabeçalhos);
3. Importar geodados (limite estadual, municípios, TIs, shapefile/GeoJSON
   das UCs → PostGIS);
4. Semear estrutura organizacional e módulos;
5. Criar o primeiro `super_admin` estadual (que a partir daí administra
   usuários, brigadas e UCs do seu estado com as telas que já existem).

Nota: `super_admin` atual passa a significar "super admin **do seu
estado**" — as policies existentes que o citam ganham o AND de tenant
como todas as outras. Quem cruza estados é só `admin_nacional`.

---

## 4. Plano de migração em fases

Princípio: **o Acre nunca quebra.** Cada fase é deployável com o sistema
em produção, e o Acre é sempre o tenant nº 1 validando o caminho.

- **Fase 0 — Fundação (banco):** tabela `estados` + seed Acre;
  `estado_id` NULLABLE nas raízes → backfill (tudo = Acre) → `NOT NULL`;
  unicidades compostas; hook de JWT; helper `mesmo_estado()`.
  *Zero mudança visível.*
- **Fase 1 — Isolamento:** reescrever policies das tabelas raiz
  compondo o helper; `config_sistema` por estado; suíte de testes de
  vazamento (§4.2). *Zero mudança visível.*
- **Fase 2 — Frontend parametrizado:** branding via config; geodados por
  estado (Storage/RPC); mapa com centro/zoom do estado; remoção das
  strings hardcoded. *Acre continua idêntico, mas agora por dados.*
- **Fase 3 — Painel nacional:** RPCs agregadas, `painel-nacional.html`,
  perfis nacionais.
- **Fase 4 — Onboarding:** wizard de ativação de estado; piloto com um
  segundo estado real (idealmente pequeno e parceiro).
- **Fase 5 — Escala:** particionamento por `estado_id` nas tabelas de
  alto volume *se e quando* a medição pedir; subdomínios cosméticos;
  SLA/observabilidade por estado (o `observability.js`/`metrics.js`
  ganham dimensão de tenant).

### 4.1 Estimativa honesta de esforço relativo

| Fase | Peso | Risco |
|---|---|---|
| 0 — Fundação | médio | baixo |
| 1 — Isolamento (RLS) | **alto** (é o grosso: ~142 migrations de história para revisar) | **alto** — mitigável |
| 2 — Frontend | médio (mecânico, espalhado) | baixo |
| 3 — Painel nacional | médio | baixo |
| 4 — Onboarding | médio | médio (importação de geodados é o pior pedaço) |

### 4.2 Mitigação do risco nº 1 (vazamento entre estados)

1. **Helper único** de tenant — proibido inline (§3.2);
2. **Teste automatizado de isolamento**: script que, com dois usuários
   de estados diferentes, varre TODAS as tabelas com RLS e falha se
   qualquer linha do estado A aparecer para B — roda no CI a cada
   migration nova (Playwright/SQL, no padrão de testes já existente);
3. **`estado_id NOT NULL`** nas raízes: linha sem tenant é
   impossível, não "esquecível";
4. **Revisão dedicada das ~30 funções `SECURITY DEFINER`** existentes —
   elas bypassam RLS por definição e cada uma precisa do filtro de
   estado explícito (é o ponto mais provável de vazamento);
5. Auditoria (`auditoria_acessos`, `queryLogger`) ganha `estado_id` para
   forense.

---

## 5. O que **não** muda (e por quê)

- **Stack:** HTML/JS vanilla + Supabase + PostGIS + Vercel. Multi-tenancy
  é um problema de modelo de dados e RLS, não de framework. Migrar de
  stack agora somaria risco sem somar isolamento.
- **Enums SNUC** — já são a taxonomia federal.
- **Design system** (variáveis, fontes, ícones BICON) — identidade da
  plataforma.
- **Arquitetura offline-first dos apps** e o ciclo de versionamento do
  service worker (`pwa/sw.js`).
- **O padrão de helpers RLS `SECURITY DEFINER`** — é ele que torna a
  Opção A segura; a proposta o generaliza em vez de substituí-lo.

## 6. Decisões em aberto (para alinhamento antes da Fase 0)

1. **Nome/domínio:** `siguc-ac.vercel.app` → domínio nacional
   (ex.: `siguc.eco.br`?) mantendo redirect do atual.
2. **Governança do painel nacional:** quem enxerga os agregados
   (MMA? consórcio de estados? público?) e se algum ente federal terá
   drill-down em dados brutos mediante convênio.
3. **Modelo comercial/institucional** por estado (convênio, cessão,
   SaaS gov) — afeta se a válvula de escape da Opção B será exigida
   contratualmente por algum estado.
4. **Usuário multi-estado** (consultor que atende 2 UFs): fora do escopo
   inicial (1 usuário = 1 estado); se necessário, evolui-se o claim de
   JWT para lista sem mudar o resto do desenho.
