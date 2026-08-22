# Recursos Hídricos e Qualidade Ambiental (DERHQA) — plano

Guarda-chuva do departamento na plataforma. Nasce reorganizando o que
já existe (Qualidade da Água, entregue em 5 fases —
`docs/qualidade-agua/plano.md`) e abre espaço para Bacias Hidrográficas
e, mais à frente, Qualidade do Ar.

**Fases A e B — ENTREGUES.** A Fase B saiu **sem o polígono das
bacias** (não existe arquivo oficial no sistema, e as fontes da ANA/IBGE
estão bloqueadas na política de rede das sessões de desenvolvimento) —
a divisão por bacia vem do cadastro do ponto, e a tela avisa isso.
Fases C e D são planejamento; nada delas foi implementado.

---

## 0. Por que o guarda-chuva

"Qualidade da Água" era um grupo de primeiro nível na sidebar, ao lado
de Gestão / Brigadas / Biomonitor. Mas água é um *produto* do DERHQA, não
o departamento: o mesmo departamento responde por bacias hidrográficas,
outorga/recursos hídricos e qualidade ambiental (incluindo ar). O
organograma já sabia disso — `modulo_unidades` liga a chave `agua` ao
DERHQA desde a migration 265, e o cabeçalho dos relatórios já sai com
"Departamento de Recursos Hídricos e Qualidade Ambiental" (migration
299). Só o menu tinha ficado com o nome do subproduto.

---

## Fase A — ENTREGUE: hierarquia e catálogo

### A.1 Sidebar ganhou um 3º nível (subgrupo)

`js/layout.js` (`gerarLayout`) passou a aceitar `subgrupos` dentro de um
grupo. A árvore ficou:

```
Diretoria Técnica                    ← super (macroárea da SEMA)
└ Recursos Hídricos e Qual. Ambiental  ← grupo (o departamento)
   └ Qualidade da Água                  ← subgrupo (as 6 páginas de hoje)
     · Bacias Hidrográficas             ← subgrupo declarado, sem página
     · Qualidade do Ar                  ← subgrupo declarado, sem página
```

Decisões que valem para qualquer subgrupo futuro:

- **Não virou `super:`.** `super` é a MACROÁREA (Diretoria Técnica ×
  Administrativo) e o DERHQA está dentro da Diretoria Técnica. Além
  disso `super` é só um divisor — não recolhe —, e o departamento
  precisa continuar sendo acordeão.
- **Subgrupo é o MESMO acordeão do grupo**, um nível abaixo: mesma
  classe `.nav-grupo` (+ `.nav-subgrupo`), mesmo `toggleNavGrupo`, mesma
  preferência em `localStorage['siguc_nav_grupos']` (ids são únicos
  entre grupos e subgrupos), mesmo colapso por `grid-template-rows`
  (nunca `transform` — armadilha documentada na barra do app Frota).
- **Grupo E subgrupo da página atual nascem abertos.** Só o grupo não
  bastaria: o link ficaria escondido um nível abaixo.
- **Subgrupo sem item não renderiza**, e grupo sem nenhum subgrupo
  visível também não — por isso Bacias/Ar já estão declarados em
  `js/layout.js` e ainda assim nada aparece no menu.
- **O gate de permissão é por SUBGRUPO**, não do grupo. Um `modulo:` no
  grupo esconderia o departamento inteiro de quem tem acesso a Bacias
  mas não à Água.
- ⚠️ **Bug real achado pelo teste ao aninhar**: `.nav-grupo.aberto
  .nav-grupo-corpo` é seletor DESCENDENTE — abrir o grupo abria também o
  corpo do subgrupo (e girava o chevron dele). As duas regras passaram a
  usar combinador de filho (`>`) em `css/global.css`. Qualquer nível
  novo precisa do mesmo cuidado.

Zero páginas tocadas (só `js/layout.js` + `css/global.css`, a fonte
única do menu das ~45 páginas de mesa). Guarda:
`tests/sidebar-grupos.test.js`, 21 testes (3 novos para o subgrupo).

### A.2 Catálogo de módulos (migration 303)

Nascem `bacias` e `ar` em `modulos`, **`ativo = false`** (só super_admin
alcança até a primeira tela existir — `nivel_efetivo_calc` devolve
`sem_acesso` para módulo inativo, mesmo caminho que `agua` seguiu na
Fase 0) e `exige_lotacao = false` (regra do plano de organograma:
módulo novo nunca nasce mudando acesso de ninguém). Ambos ligados ao
DERHQA em `modulo_unidades`, o que faz `modulo_departamento('bacias')`
já devolver o departamento certo no primeiro relatório gerado.

⚠️ **`modulos.grupo` da chave `agua` NÃO foi alterado** (segue
'Gestão'). Parece rótulo, mas é a chave de fallback de permissão
(`nivel_catalogo_perfil` → `grupo_permissoes_padrao`) — e `agua` não tem
NENHUMA linha em `perfil_permissoes_padrao`, ou seja **todo** o acesso
dela hoje vem do padrão do grupo 'Gestão'. Trocar o grupo tiraria o
acesso de todo mundo em silêncio. Rótulo de menu vive em
`js/layout.js`; `modulos.grupo` é regra de acesso.

Pelo mesmo motivo `bacias`/`ar` nasceram em 'Gestão'. Quando cada uma
ganhar tela, decidir explicitamente se restringe ao DERHQA
(`exige_lotacao = true`, como `agua` desde a 281) — um painel de bacias
tende a ser mais aberto que um laudo de IQA.

### A.3 Nomes de arquivo

As páginas `agua-*` ficam como estão — renomear quebraria `pwa/sw.js`,
os builds Capacitor, testes e links já distribuídos. Páginas novas
nascem `rh-*` (Bacias/Recursos Hídricos) e `ar-*`.

---

## Fase B — Bacias Hidrográficas — ENTREGUE (sem o polígono)

`pages/rh-bacias.html` ("Painel das Bacias", subgrupo Bacias
Hidrográficas). Entregue com a divisão por bacia vindo do CADASTRO do
ponto (`agua_pontos_coleta.bacia`, texto), porque o polígono oficial
não existe no sistema — decisão do usuário depois de a busca por um
arquivo público falhar (ver B.2 abaixo). A tela **diz isso na cara**,
num aviso fixo no topo: nada de fingir recorte geográfico que não foi
feito.

O que a tela faz, e por que ela existe além do painel de Relatórios:
o painel da Água sempre olha UM recorte de cada vez ("Acre todo" ou uma
bacia). Comparar Purus × Juruá × Madeira lado a lado era a leitura que
faltava. Escolher uma bacia aqui **destaca e recorta o mapa, mas nunca
some com as outras da comparação**.

- **Agregação nova, no lugar certo**: `aguaRelPorBacia(coletas)` e
  `aguaRelSerieBacia(coletas, bacia)` em `js/agua-relatorio-dados.js`
  (puras, sem rede) — nunca na página. Reusam `aguaRelResumo`/
  `aguaRelPorCampanha`, então IQA e conformidade continuam vindo
  prontos do banco.
- **IQA médio de bacia é NÚMERO, nunca faixa.** Classificar uma média
  seria recalcular no cliente o que `agua_iqa_faixa()` faz no banco —
  mesma regra que o painel já seguia nas barras. Por isso os
  mini-gráficos são chamados com `semLegenda` (opção nova em
  `aguaIqaGraficoHTML`): exibir as 5 cores de faixa ali prometeria uma
  classificação que não foi feita.
- **Eixo comum**: a série de cada bacia usa TODAS as campanhas do
  recorte, não só as daquela bacia — é o que deixa os mini-gráficos
  comparáveis; campanha não medida vira lacuna, nunca some do eixo.
- **Mapa é o MESMO `aguaPainelMapaCriar`** de Relatórios/público, com
  `opts.referenciaSempre` (novo, aditivo): aqui o assunto é a rede
  hidrográfica, então limite do Acre, municípios e hidrografia WMS do
  IBGE ficam visíveis também no mapa de ruas — nas outras duas telas
  seguem só no satélite, como o usuário pediu.
- **CSS do painel virou arquivo**: `css/agua-painel.css`, contraparte
  de `js/agua-painel.js`. Os ~270 linhas de `.adash-*`/`.adet-*` viviam
  copiadas no `<style>` de `agua-relatorios.html` e `agua-publico.html`
  — esta seria a TERCEIRA cópia. As três páginas agora linkam a mesma
  folha (as 30 guardas das duas telas antigas rodaram e passaram depois
  da extração).
- **Migration 304** ativa o módulo `bacias` (`ativo=true` + rota),
  mesmo passo que a 256 deu para `agua`. `exige_lotacao` fica FALSE de
  propósito: é leitura agregada do que a SEMA já publica no painel
  público, sem laudo nem dado pessoal — restringir ao DERHQA esconderia
  da diretoria uma visão institucional.
- **Fail-open no mapa**: se o Leaflet não carregar, o card do mapa some
  e os números continuam — painel em branco por causa da camada visual
  é pior que painel sem mapa.
- Guarda: `tests/rh-bacias.test.js` (9 testes). O Leaflet é servido de
  `tests/fixtures/vendor/` por `page.route` — `unpkg.com` oscila na
  política de rede deste tipo de ambiente e sem isso metade dos testes
  de mapa vira flake; a PÁGINA continua usando o CDN em produção.
- `pwa/sw.js`: frota 98 → 99 (`js/layout.js`) e agua 19 → 20
  (`js/agua-relatorio-dados.js`) — os dois arquivos tocados que estão
  em shell de app.

**O que fica faltando nesta fase**: o polígono. Quando ele chegar,
entra a tabela `bacias_hidrograficas` (B.2 abaixo), a bacia do ponto
passa a ser derivada por ponto-em-polígono e esta tela ganha os
contornos no mapa — sem refazer card, agregação nem teste.

## Fase B — desenho original (referência)

Objetivo: dashboard + relatórios mostrando, no mapa do Acre, as bacias
hidrográficas do estado e o que a SEMA monitora dentro de cada uma.

### B.1 O dado que já existe

`agua_pontos_coleta.bacia` é **texto livre**: Purus (8 pontos), Juruá
(7), Madeira (1), 1 nulo (Rio Iquiri — o painel já trata como "Sem bacia
definida"). Isso basta para os cards de agregação (IQA médio por bacia,
nº de pontos, conformidade CONAMA) — `js/agua-relatorio-dados.js` já
agrega por bacia hoje.

O que NÃO existe: polígono nenhum de bacia, nem em `data/`, nem em
`camadas_mapa` (as 20 camadas cadastradas são zoneamento/lotes/
hidrografia de UC específica).

### B.2 Polígono: molde do `limite_acre` (migration 239)

Para ponto-em-bacia, área por bacia e recorte de mapa, o polígono
precisa estar no PostGIS. Repetir o mecanismo já validado:

- tabela `bacias_hidrograficas` (nome, nível ottobacia, `geom
  geometry(MultiPolygon,4326)`, GIST);
- geometria **não embutida na migration**: carregada por `pg_net` do
  MESMO arquivo que o cliente usa (`data/bacias_acre.geojson`), em passo
  separado depois do COMMIT — banco e navegador nunca discordam da
  divisa;
- funções `geo_bacia_do_ponto(lat, lon)` e uma `bacias_carregar()` no
  molde de `limite_acre_carregar()`, fail-open com a tabela vazia;
- depois disso, `agua_pontos_coleta.bacia` (texto) pode virar FK
  preenchida por ponto-em-polígono, em vez de digitada.

**Bloqueio conhecido:** a política de rede das sessões de
desenvolvimento devolve **403 no proxy** para `dadosabertos.ana.gov.br`,
`snirh.gov.br`, `geoservicos.ibge.gov.br` e `servicos.ibge.gov.br` —
medido, não suposto (mesma pendência já registrada na Fase 4 da
Qualidade da Água). Isso impede **baixar** a geometria numa sessão; não
impede o produto, porque o navegador do usuário em produção alcança
esses domínios (o Mapa das UCs já consome o WMS BC250 do IBGE ao vivo).
Decisão registrada: tentar a carga numa sessão com esses domínios
liberados; até lá, a Fase B pode entregar tudo que depende só do campo
`bacia` + drenagem por WMS.

### B.3 Mapa

Reaproveitar, nunca reimplementar: `js/mapa-recorte.js` (limite do Acre,
ponto-em-polígono), `js/agua-painel.js` (`aguaPainelMapaCriar` — já tem
pino gota-d'água, rosa dos ventos, escala, legenda, satélite híbrido,
municípios e hidrografia WMS) e `js/agua-iqa-visual.js` (cores por
faixa, validadas contra daltonismo).

---

### B.4 Material recebido — Atlas de Vulnerabilidade a Inundações (ANA)

O usuário enviou o pôster A0 `Atlas_vulnerabilidade_norte_A0_03_02_2014`
(ANA, 2013; base cartográfica ao milionésimo do IBGE, DATUM SAD69,
1:2.850.000). Conteúdo: hidrografia + **trechos de curso d'água
inundáveis** classificados em alta/média/baixa vulnerabilidade. Para o
Acre: 786 trechos em 50 cursos d'água nos 22 municípios (184 alta, 164
média, 438 baixa); só Rio Branco tem 50 trechos, 43 de alta.

**Não contém polígono de bacia** — não desbloqueia a Fase B. É um tema
próprio (vulnerabilidade a inundação), candidato natural a camada/painel
do DERHQA depois das Fases B e C. Extrair geometria do pôster não é
caminho: é um PDF de apresentação a 1:2,85 milhões, sem
georreferenciamento declarado; o dado vetorial correspondente vive no
acervo da ANA (mesmo bloqueio de rede das outras fontes).

## Fase C — Plataformas de Coleta — ENTREGUE

Escopo ampliado a pedido do usuário: não só o inventário (o que o
desenho original previa), mas **série de medições + hidrograma +
relatório diário por rio + notificação de cota + e-mail diário** —
mesmo formato de tela já provado pela Água (agregação no banco, painel
lê pronto, nada recalculado no cliente).

Testado antes de escrever qualquer código: a ANA responde 401 na API
telemétrica atual (existe, mas exige credencial de Identificador+Senha
do HidroWeb) e o serviço SOAP antigo (telemetriaws1) não responde mais
— medido do PRÓPRIO BANCO via `pg_net`, não deste sandbox (o banco
alcança a internet normalmente; só esta sessão de desenvolvimento é
bloqueada). Decisão do usuário: construir o ingestor completo e
publicá-lo desligado, esperando a credencial.

### C.1 Banco (migrations 305, 306, 306b, 307)

- **`tipo_notificacao` ganha `'hidro'`** (305, migration própria — regra
  do projeto: ADD VALUE precisa estar commitado antes de ser usado).
- **Duas tabelas** (306): `rh_estacoes` (inventário — código ANA, tipo,
  telemetria, operadora, rio, bacia, `geom Point`, e as **cotas de
  atenção/alerta/inundação cadastradas em cm** — nunca calculadas) e
  `rh_medicoes` (uma linha por leitura: nível/chuva/vazão + `origem`
  telemetria/convencional/importação/manual — dado bruto de sensor e
  dado digitado não podem ficar indistinguíveis depois, mesma
  disciplina do `status` completo/quarentena da Água). Unique
  `(estacao_id, data_hora, origem)` — constraint normal, não índice
  parcial (lição da 257b: `ON CONFLICT` do PostgREST não mira índice
  parcial). RLS pelo módulo `bacias` (mesma leitura de rede
  hidrográfica; chave nova inflaria o catálogo à toa).
- **`vw_rh_estacoes_detalhe`** (SECURITY INVOKER): última leitura,
  variação em 24h (janela de ≥20h de defasagem — telemetria falha por
  sensor, estação convencional lê 1×/dia), chuva 24h/7d, e
  **`situacao_cota` DERIVADA comparando com as cotas cadastradas —
  NULL quando a estação não tem cota nenhuma, que NÃO é "normal"**
  (mesma distinção de `conama_violacoes` nulo na Qualidade da Água).
- **`rh_relatorio_diario(data)`** (306b): agrega POR RIO (não por
  estação — é assim que a leitura operacional acontece), com detalhe
  por estação em jsonb. **`rh_registrar_medicoes(jsonb)`**: ingestão em
  lote idempotente, usada pela importação de planilha na tela E pela
  Edge Function. **`rh_checar_cotas()`**: SECURITY DEFINER, notifica
  super_admin/gestor/diretor/chefe_departamento/tecnico quando uma
  estação passa de cota, dedupe por `ref` (estação+situação+dia) —
  mesmo molde de `frota_checar_vencimentos`.
  Verificado contra produção com dado de teste antes do commit (linhas
  apagadas ao final): relatório do dia devolveu variação de +215 cm e
  50,5 mm de chuva; `rh_checar_cotas()` gerou notificação real dentro
  de uma transação com ROLLBACK.
- **Crons (307)**: `rh-checar-cotas` de HORA EM HORA (não 1×/dia como o
  resto do projeto — cheia é evento rápido; o dedupe evita spam) e
  `hidro-relatorio-diario` às 08h BRT. **`ingest-hidro` NÃO tem cron
  agendado** — o comando fica pronto em comentário na migration, para
  rodar quando a credencial da ANA existir.

### C.2 Front-end

- **`js/rh-hidro.js`** (novo): rótulos, cores de cota (as MESMAS 4
  cores já validadas contra daltonismo em `js/agua-iqa-visual.js`,
  reaproveitadas na ordem normal→grave — nunca uma paleta nova),
  **hidrograma em SVG** (nível em linha + chuva em barras invertidas do
  topo — convenção clássica da hidrologia, as duas no mesmo eixo de
  tempo, cotas como linhas tracejadas SEMPRE rotuladas), exportação CSV
  (BOM + `;`, o que o Excel pt-BR abre direto) e o **parser de
  importação** — aceita as grafias de cabeçalho do HidroWeb e da
  planilha do estado (não são iguais), nunca inventa data: linha sem
  data válida é descartada e CONTADA, nunca silenciada.
- **`js/rh-relatorio-pdf.js`** (novo): PDF do relatório diário,
  reaproveitando os primitivos de `js/agua-relatorio-pdf.js`
  (`_agpdfCtx`/`_agpdfTitulo`/`_agpdfTabela`/…) — nunca uma segunda
  implementação de layout de PDF. `_agpdfDesenharCabecalhoPagina` ganhou
  parâmetro `linhaModulo` para o timbre sair "Recursos Hídricos" em vez
  de "Qualidade da Água".
- **`pages/rh-estacoes.html`** (novo): KPIs, mapa, relatório diário por
  rio, lista de estações com cadastro (`podeEditar`), importação de
  planilha e exportações (PDF/CSV/CSV do inventário). Clicar numa
  estação abre o hidrograma dos últimos 30 dias.
- **`js/agua-painel.js` ganhou `aguaPainelMapaBase()`**: a base
  cartográfica (tiles, rosa dos ventos, escala, camadas de referência,
  "Configurar camadas") foi extraída de `aguaPainelMapaCriar` para ser
  compartilhada com a tela de estações, que precisa dos MESMOS
  componentes mas com marcadores/legenda diferentes (pinos de IQA ×
  círculos de cota). `legendaFn` é injetável — cada tela passa a
  própria legenda.
- **Camada no Mapa das UCs** (`pages/mapa.html`), pedido do usuário
  ("igual os CAR"): nova aba "💧 Rec. Hídricos" no molde exato do
  toggle do CAR — checkbox liga/desliga, carrega uma vez e cacheia,
  círculos coloridos por `rhCotaCor`, popup com nível/variação/link
  para a tela dedicada, entrada na legenda geral do mapa quando ativa.
- **Configurações › Qualidade da Água** ganhou o campo "Relatório
  diário de rios — destinatários" (`config_sistema.dados.hidro.emails`,
  textarea de e-mails) — lido pela Edge Function
  `hidro-relatorio-diario`. Lista vazia é decisão válida: sem e-mail,
  o aviso de cota segue chegando por notificação.

### C.3 Ingestor da ANA — pronto, desligado

`supabase/functions/ingest-hidro`: publicado, mas sem
`ANA_HIDROWEB_ID`/`ANA_HIDROWEB_SENHA` nos secrets devolve
`{ok:false, motivo:'sem-credencial'}` sem gravar nada. Quando a SEMA
concluir o cadastro na ANA: cadastrar os dois secrets no painel do
Supabase (nunca no repositório/frontend) e agendar o cron comentado na
migration 307. A função autentica via OAuth do HidroWebService, busca a
série telemétrica ADOTADA (dado já consistido pela ANA) de cada
estação com `codigo_ana` + `telemetrica=true`, grava por
`rh_registrar_medicoes` (idempotente) e roda `rh_checar_cotas()` na
mesma execução.

### C.4 Guarda

`tests/rh-estacoes.test.js` (12 testes) — as três regras que não podem
quebrar: situação de cota NUNCA calculada no cliente (vem pronta da
view), estação sem cota NUNCA vira "normal", e o parser de planilha
nunca inventa data (descarta e conta). Mesmo padrão de Leaflet
vendorizado (`tests/fixtures/vendor/`) das outras suítes da Água.

`pwa/sw.js`: agua v20 → v21 (`agua-relatorio-dados.js`,
`agua-relatorio-pdf.js` e `agua-iqa-visual.js` — todos no shell do app
de campo da Água — foram tocados por esta entrega).

---

## Fase D — Qualidade do Ar (planejada)

Só a estrutura foi reservada (subgrupo na sidebar + chave `ar` no
catálogo, inativa). Quando for feita, seguir o formato já provado pela
Água: estações + medições + índice derivado **no banco** (uma função só,
nunca recalculado em JS por página), faixas em tabela e não em código
(molde de `agua_limites_conama`), painel compartilhado entre a tela de
mesa e a pública. Referência normativa a levantar com a área: Resolução
CONAMA nº 491/2018 (padrões de qualidade do ar).

---

## Regras herdadas que continuam valendo

- Cálculo derivado (IQA, e um futuro IQAr) vive em UM lugar só, no
  banco. Página lê view pronta.
- `pages/agua-relatorios.html` (mesa) ⇄ `pages/agua-publico.html`
  (público) são par de duplicação obrigatória — mudança nos cards/mapa
  entra em `js/agua-painel.js` e vale para as duas.
- Toda tabela nova com dado pessoal = entrada nova no ROPA
  (`lgpd_tratamentos`) na mesma entrega. Bacia/estação/medição de rio
  não são dado pessoal; operador/responsável de estação seria.
- Migration nova: rodar `list_migrations` antes (o repositório local
  pode estar atrás do banco — foi o caso aqui: repo em 301, banco já em
  302b).
