# Recursos Hídricos e Qualidade Ambiental (DERHQA) — plano

Guarda-chuva do departamento na plataforma. Nasce reorganizando o que
já existe (Qualidade da Água, entregue em 5 fases —
`docs/qualidade-agua/plano.md`) e abre espaço para Bacias Hidrográficas
e, mais à frente, Qualidade do Ar.

**Fase A — ENTREGUE** (esta rodada). Fases B a D são planejamento; nada
delas foi implementado.

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

## Fase B — Bacias Hidrográficas (planejada)

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

## Fase C — Plataformas de coleta de dados (planejada)

Inventário das estações que medem água no Acre, sejam da ANA, do estado
ou de terceiros. **Tabela própria, não misturar com
`agua_pontos_coleta`**: ponto de coleta é onde a SEMA amostra para o
IQA; estação é infraestrutura de terceiro, com série própria.

Esboço: `rh_estacoes` (código na fonte — ex. Hidroweb —, nome, tipo
`fluviometrica|pluviometrica|telemetrica|qualidade`, operadora, situação,
rio, bacia, município, `geom Point 4326`, período da série, link).
`agua_pontos_coleta.codigo_ana` já existe e vira o vínculo natural entre
os dois. Carga do inventário: arquivo em `data/` ou Edge Function —
mesmo bloqueio de rede da Fase B para baixar direto.

Produto: camada no mapa + card "cobertura de monitoramento por bacia"
(quantas estações, de quem, qual bacia tem vazio).

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
