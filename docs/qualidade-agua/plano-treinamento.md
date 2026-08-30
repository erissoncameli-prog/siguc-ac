# Qualidade da Água — Interface de treinamento (guias de introdução)

Status: **ENTREGUE** — Fases 1, 2 e 3, telas de mesa e registro de
capacitação no banco (migration 327). O resumo do que ficou como regra
permanente está em `CLAUDE.md`, seção "Regra do sistema — guias de
introdução e treinamento". Este documento preserva o estudo prévio; as
decisões tomadas com o usuário depois dele estão na §8, ao final. Pedido do usuário: "criar uma
interface de treinamento, como se fosse guias de introdução, para
facilitar ao usuário".

Este documento é o estudo prévio: o que o app já exige do coletor, onde
ele erra hoje, o que cada camada de treinamento resolve, e em que ordem
entregar. Ler antes de codar.

---

## 1. O que o usuário precisa aprender (levantado do código, não suposto)

Inventário do que `pages/agua-app.html` exige de quem coleta:

| Tela | O que o coletor precisa saber e o app não explica |
|---|---|
| Login / PIN | Por que existem DUAS credenciais (e-mail+senha uma vez; PIN todo dia). O PIN é local do aparelho, não do sistema. |
| Home | O que o chip de conexão significa; que "Nova coleta" funciona **sem rede**; que GPS só é lido ao salvar. |
| Nova coleta — ponto | Que a lista de pontos é cache local e precisa ser atualizada em Config antes de ir a campo. |
| Nova coleta — GPS | Que a leitura é pontual (não contínua); que divergência >1 km é **aviso, não erro** — e o que fazer quando aparece. |
| Nova coleta — parâmetros | Quais são de campo (sonda) e quais vêm do laboratório depois; unidades (mg/L, UNT, µS/cm); que a sonda escolhida vira padrão. |
| Nova coleta — alertas | Que o retângulo de alerta comparativo **nunca bloqueia no app** (regra do sistema), e que "atípico para este ponto" pede reconferir a leitura, não apagar o número. |
| Nova coleta — código/etiqueta | A regra mais confusa do módulo: deixar em branco = sistema gera; digitar = frasco já tem etiqueta própria; etiqueta só sai com código reservado (Config › Etiquetas). |
| Foto | Que a marca d'água é automática; para que serve a foto do ponto. |
| Fila | Que "pendente" não é erro; que nada se perde; que confirmar exige rede. |
| Histórico | Que coleta "em conferência" (quarentena) aparece marcada e não é erro. |
| Config | Preparação pré-campo: atualizar pontos + reservar códigos + conferir armazenamento. |

Dois pontos merecem destaque porque já geraram relato real do usuário:
- **"o botão de imprimir etiqueta não apareceu"** — comportamento correto,
  descoberto tarde demais. Já foi mitigado com a dica do campo, mas é
  exatamente o tipo de regra que um guia de preparação pré-campo resolve
  antes de a pessoa sair.
- **Coletor sempre em branco** (migration 326) — mostrou que o app tem
  regras invisíveis que só aparecem no artefato final.

## 2. Restrições do projeto que o desenho tem de respeitar

Não são preferências — são regras já registradas em `CLAUDE.md`:

1. **Nada pode impedir o trabalho de campo.** Nenhum guia bloqueia,
   nenhum é obrigatório, todo passo tem "Pular". Diferente do gate de
   LGPD (que exige ciência): treinamento não tem valor jurídico.
2. **Offline-first.** O conteúdo tem de abrir sem rede, no primeiro dia,
   em aparelho que nunca sincronizou. Isso empurra o conteúdo para o
   código (ou cache pré-carregado), não para uma consulta ao banco.
3. **Fonte única** (lição de `js/frota-consumo.js`): o motor do guia
   nasce genérico (`js/guia-app.js`), servindo os 4 apps de campo; só o
   CONTEÚDO é por app. Nunca 4 cópias de um tour.
4. **Estados de interface**: foco visível `:focus-visible`, alvo ≥24×24,
   `:disabled` estilizado, `prefers-reduced-motion` desliga animação de
   destaque.
5. **Sem emoji em UI** — ícones via `BICON_PATHS`/`bico()` (`help`,
   `award`, `check`, `x` já existem).
6. **Versionamento**: `pwa/sw.js` → `VERSOES.agua` +1 e arquivos novos em
   `SHELLS.agua` + nas 3 listas de `app-agua/scripts/build-www.mjs`
   (senão o APK abre sem o guia).
7. **Guarda automatizada**: `tests/agua-guia.test.js` (Playwright).

## 3. As quatro camadas possíveis (e o que cada uma resolve)

Não são alternativas excludentes — são camadas. A recomendação de ordem
está na §4.

### Camada A — Cartilhas ("guias de introdução")
Tela de conteúdo, por assunto, acessível a qualquer momento em
**Config › Ajuda e treinamento** e oferecida no primeiro acesso.
- Formato: lista de guias → guia aberto em passos (cartões com título,
  texto curto, ilustração/ícone e, quando útil, um "atalho" que leva à
  tela real).
- ~7 guias: *Primeiros passos*, *Antes de ir a campo*, *Fazer uma
  coleta*, *GPS e foto*, *Alertas de valor atípico*, *Etiquetas e código
  da amostra*, *Fila e sincronização*.
- Resolve: consulta ("como era mesmo?"), onboarding assíncrono, e serve
  de roteiro para um treinamento presencial.
- Custo: baixo. Risco: baixo. É a camada que sustenta as outras.

### Camada B — Tour guiado sobre a interface real (coach marks)
Destaque (recorte claro) sobre o elemento real da tela + balão
explicativo, avançando passo a passo.
- Resolve: "onde fica" — o que a cartilha explica mal em texto.
- Risco conhecido: acopla o tour a seletores da página. Mitigação
  obrigatória: cada passo declara o seletor e **pula em silêncio** se o
  elemento não existir (nunca trava o tour, nunca aponta para o vazio).
  Guarda no teste: todo seletor declarado precisa existir no HTML.
- Restrição visual: o app já tem `.pin-baralho`, rio animado e overlays;
  o destaque usa `box-shadow` gigante (sem `transform` em ancestral —
  mesma armadilha da barra do Frota) e respeita `prefers-reduced-motion`.

### Camada C — Modo treinamento (sandbox)
Um interruptor em Config: o app inteiro entra em "treinamento" — o
coletor preenche uma coleta de verdade, tira foto, lê GPS, vê os alertas
comparativos — e **nada entra na fila real nem no banco**.
- Resolve: o medo de errar, que é a barreira real de quem nunca usou.
  É também o que permite treinar uma turma inteira sem sujar a base.
- Regras não negociáveis do desenho:
  - Faixa persistente no topo em todas as telas ("MODO TREINAMENTO — nada
    é enviado"), cor distinta do design system, impossível de confundir.
  - Registro de treino **nunca** entra no store `registros` (fila real):
    store própria ou descarte imediato. Nunca chama
    `agua_reservar_codigos` (não pode consumir a numeração real —
    buraco na sequência é irreversível por desenho).
  - Sair do modo apaga os dados de treino do aparelho.
  - O modo NÃO altera nada no servidor — é 100% cliente.
- Custo: médio-alto (toca o caminho de salvar, a fila e a etiqueta).
  É onde mora o risco de regressão; entra depois, com teste próprio
  cobrando que nada de treino chega ao Supabase.

### Camada D — Ajuda contextual por campo ("?" ao lado do rótulo)
Reaproveita o `.campo-dica` que já existe em todo campo do formulário,
acrescentando um botão `?` que expande a explicação longa.
- Resolve: dúvida no instante do preenchimento, sem sair da tela.
- Custo: baixo, e o conteúdo é o MESMO dicionário das cartilhas — nunca
  um segundo texto que possa divergir.

### Fora de escopo (avaliado e descartado nesta rodada)
- **Vídeo**: peso no APK e no cache offline; e conteúdo que envelhece sem
  ninguém reeditar.
- **Certificado/avaliação de capacitação**: vira registro de RH, exige
  tabela, e não foi pedido. Se a SEMA quiser depois, a Camada C já dá a
  base ("concluiu o treino de coleta").

## 4. Ordem de entrega proposta

**Fase 1 — Cartilhas + entrada + contexto (Camadas A e D).**
Arquivos novos: `js/guia-app.js` (motor genérico: navegação de passos,
overlay, marcação de "já visto"), `js/agua-guias.js` (conteúdo — dados
puros), `css/guia-app.css`. Entrada em Config › Ajuda e treinamento;
convite discreto no primeiro acesso (dispensável para sempre, nunca
bloqueante); `?` nos campos que já têm `.campo-dica`.
Progresso salvo no IndexedDB (store `config`, chave `guia_vistos` — sem
bump de schema, mesmo padrão de `etq_codigos_reservados`).
`pwa/sw.js`: agua +1, 3 arquivos novos no shell e no `build-www.mjs`.

**Fase 2 — Tour guiado (Camada B).** Reusa o motor da Fase 1; acrescenta
o destaque sobre elemento real. Um tour por tela (Home, Nova coleta,
Fila), sempre pulável.

**Fase 3 — Modo treinamento (Camada C).** Só depois que 1 e 2
estabilizarem, com teste dedicado provando isolamento total da fila real
e da reserva de códigos.

## 5. Onde o conteúdo mora — decisão de arquitetura

Recomendação: **conteúdo no código** (`js/agua-guias.js`), não no banco.
- Funciona offline no primeiro dia, sem sync prévia (requisito duro).
- Passa por revisão em commit, como o resto do texto do app.
- O molde de banco (`lgpd_documentos`) existe para documento com valor
  jurídico e aceite versionado; guia de treinamento não é isso.
- Se a SEMA quiser editar sem deploy no futuro, a migração é aditiva:
  tabela nova + cache local, mantendo o conteúdo do código como fallback
  (mesmo padrão de `js/lgpd-campo.js`).

## 6. Escopo: app de campo × telas de mesa

Este plano cobre o **app de campo** (`pages/agua-app.html`). As telas de
mesa do módulo têm curva de aprendizado tão grande quanto — em especial
`agua-laudos.html` (leitura assistida do laudo por OCR, conferência campo
a campo) e `agua-conferencia.html` (promover coleta de quarentena) — e o
mesmo motor `js/guia-app.js` serve as duas, com conteúdo próprio. Fica
como extensão possível, a confirmar com o usuário; não está incluída nas
Fases 1–3 acima.

## 7. Guardas de teste previstas

`tests/agua-guia.test.js` (Playwright, molde de `tests/agua-etiqueta.test.js`):
1. Guia abre offline (sem cliente Supabase real) e navega passo a passo.
2. Fechar/pular nunca deixa overlay preso nem barra a Home.
3. "Já visto" persiste entre recargas e o convite não reaparece.
4. (Fase 2) todo seletor declarado nos passos existe no HTML — pega tour
   apontando para elemento removido numa refatoração futura.
5. (Fase 3) salvar em modo treinamento não cria registro na fila real
   nem chama a RPC de reserva de códigos.


---

## 8. O que foi decidido e entregue (posterior ao estudo acima)

O usuário escolheu o escopo máximo: as três fases, todas as superfícies
e registro de capacitação no banco. O que mudou em relação ao estudo:

- **§3/§4 — as três camadas entraram**, não só a Fase 1. O motor nasceu
  com destaque de elemento (Fase 2) e o app ganhou o sandbox (Fase 3).
- **§6 — as telas de mesa entraram** (`agua-laudos`, `agua-conferencia`,
  `agua-pontos`, `agua-relatorios`, `agua-mapa`), com catálogo próprio
  (`js/agua-guias-mesa.js`, escopo 'agua-mesa') e entrada pelo botão
  "Ajuda" da topbar.
- **§5 vale como escrito**: conteúdo no código. Mas o PROGRESSO passou a
  ser também registrado no banco (migration 327), a pedido do usuário —
  local primeiro, servidor depois, fail-open. O estudo previa só o
  progresso local.
- **Tour e cartilha viraram um conteúdo só**, decisão tomada ao codar:
  em vez de escrever passos separados para o tour, o mesmo passo com
  `alvo` vira destaque onde o elemento está visível. Metade do conteúdo
  a manter, e nenhuma chance de as duas versões divergirem.
- **Achado durante a entrega, fora do escopo**: `pages/agua-laudos.html`
  estava quebrada em produção desde o PR #337 por um `const` global
  declarado duas vezes. Corrigido, com varredura automatizada nas 5
  telas para pegar a classe do erro de novo.

Pendências deliberadas, não esquecimentos:
- Os outros 3 apps de campo (Brigadas, Biomonitor, Frota) NÃO ganharam
  guias — o motor é genérico e já serve os quatro, falta só escrever o
  conteúdo de cada um. É trabalho de conteúdo, não de código.
- O relatório de capacitação mostra conclusão por pessoa; não há
  exportação nem cobrança automática de quem não concluiu. Cobrar
  esbarraria na regra de que treinamento não é gate — se um dia for
  pedido, é decisão de produto, não extensão natural.
