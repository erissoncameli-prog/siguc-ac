# Biomonitor — Etiquetas de ninho e berçário

Plano. Nada codado ainda — protótipos visuais publicados como Artifact
(ver mensagem da sessão). Pedido do usuário: etiqueta pra identificar
ninho (todos os dados) e berçário (capacidade + outros dados), no
mesmo modelo da etiqueta de frasco da Água.

## 1. Achado que muda o desenho, antes de qualquer decisão de layout

**O ninho NÃO tem o problema que a Água teve.** Em Água,
`codigo_amostra` só existe depois do sync (trigger no banco) — por
isso a Fase 1 precisou de reserva de bloco de códigos.
`ninhos_quelonios.numero_ninho`, ao contrário, é **gerado no
CLIENTE, na hora do cadastro, 100% offline**
(`bioGerarNumeroNinho()`, `js/biomonitor-quelonios.js`): formato
`{sigla-praia}-{sigla-espécie}-{ano-temporada}-{sequencial}`, ex.
`PC-TR-2026-014`. Não existe reserva, não existe pool, não existe
"código provisório" — **o identificador já está pronto no instante
em que o monitor termina de cadastrar o ninho**, antes mesmo de
tirar a primeira foto.

Isso simplifica a Fase 1 do biomonitor em relação à da Água: não
precisa de migration de reserva, não precisa de RPC, não precisa de
pool no IndexedDB. É desenhar a etiqueta e imprimir — o dado já existe.

**Berçário é diferente**: `bercarios` é um CADASTRO FIXO (a
instalação física — tanque, piscina, viveiro), não um evento. Mais
parecido com `agua_pontos_coleta` do que com `agua_coletas`: existe
antes de qualquer coisa acontecer nele, tem um só registro por
estrutura física, e não tem `numero`/código nenhum hoje (só `nome`,
texto livre). Aqui a etiqueta é uma **placa permanente** afixada na
estrutura, não uma etiqueta de evento.

Junto do berçário existe `lotes_bercario` — um LOTE é a leva de
filhotes de UM ninho que entrou no berçário numa data. Múltiplos lotes
(de ninhos e às vezes espécies diferentes) convivem no mesmo berçário
ao mesmo tempo. Isso é o evento — mais parecido com a coleta da Água.

## 2. Os três objetos, e o que cada um pede

| Objeto | Tabela | Natureza | Identidade hoje | Etiqueta análoga na Água |
|---|---|---|---|---|
| **Ninho** | `ninhos_quelonios` | Evento, ~2 a 5 meses de vida útil (incubação) | `numero_ninho`, gerado no cliente | `agua_coletas` → etiqueta de frasco |
| **Berçário** | `bercarios` | Estrutura fixa, permanente | só `nome` (texto livre, sem código) | `agua_pontos_coleta` (nunca teve etiqueta — é a Fase B/C do plano da Água) |
| **Lote** | `lotes_bercario` | Evento dentro do berçário, semanas a poucos meses | sem código formal (por isso a tela do app usa "ninho de origem" pra identificar) | não tem análogo direto — mais perto do "kit de frasco" que foi rejeitado na Água |

O pedido do usuário ("ninhos e berçários... para berçário deve conter
capacidade e outros dados") bate com as linhas 1 e 2. A linha 3 (lote)
entra como decisão a confirmar — ver §5.

## 3. Diferença física que muda o requisito de mídia (achado, não suposição)

A etiqueta de frasco vive numa bancada de laboratório, dias. **A
etiqueta de ninho vive fincada na areia da praia, sob sol e chuva, por
até 160 dias** (jabuti/muçuã — `incubacao_dias_media` do catálogo,
consultado em produção: tracajá 68, tartaruga 55, cabeçudo 52, iaçá 70,
cupido 68, muçuã 135, jabuti-pé-de-elefante 140, jabuti-piranga 140).

O comentário da própria coluna já diz o que existe hoje: `numero_ninho`
*"código na placa (ex: P01-2025-047)"* — ou seja, **já existe uma placa
física no ninho hoje**, preenchida à mão (caneta permanente/piloto),
porque é isso que sobrevive a meses de praia. Uma etiqueta adesiva
impressa numa térmica (mesmo mídia sintética BOPP, como a da Água) é
**duvidosa nesse ambiente** — não testada, e o risco de decepcionar
(etiqueta ilegível depois de 2 meses de sol/chuva) é real.

**Berçário não tem esse problema**: é estrutura fixa, normalmente sob
cobertura, mais parecida com o ambiente de uma bancada.

## 4. Proposta — não substituir, complementar (ninho) vs. placa nova (berçário)

- **Ninho**: a etiqueta impressa NÃO substitui a placa manuscrita
  (que já funciona) — ela é um **adesivo QR pequeno**, colado na MESMA
  placa/estaca já usada, ao lado do número escrito à mão. Serve pra
  abrir o ninho na hora (escanear em vez de digitar o número na busca,
  útil em visita de campo com luva/sol/tela pequena) e, se laminado ou
  numa fita mais resistente, sobrevive tempo suficiente. Ficha
  completa (todos os dados do ninho) sai em **PDF/PNG pra imprimir e
  plastificar à parte** (guardado na prancheta da equipe ou
  encapado) — não fica exposto ao tempo. É a peça que cobre "deve
  conter todos os dados do ninho" sem depender da durabilidade do
  adesivo.
  - Alternativa (se a equipe já testou e confia no adesivo BOPP a céu
    aberto por 2+ meses): etiqueta completa substituindo a placa. Ver
    pergunta ao usuário — decisão de campo, não de código.
- **Berçário**: **placa completa de verdade**, com todos os dados
  estáticos + QR (capacidade, tipo, responsável, UC) — ambiente
  controlado, mesma lógica da etiqueta de frasco. Ocupação atual
  NUNCA entra impressa (mudaria todo dia) — só via QR, que abre o
  card com os números ao vivo (`vw_bercarios_resumo`, já existe e já
  calcula `filhotes_vivos_atual`/`lotes_ativos`).

## 5. Decisão em aberto — etiqueta de LOTE

`lotes_bercario` (a leva de um ninho dentro do berçário) não foi
pedida explicitamente, mas é o nível que hoje mais confunde na
prática: vários lotes de ninhos diferentes dividem o mesmo tanque, e a
tela do app já trata "ninho de origem" como a única forma de
diferenciar. Uma etiqueta pequena presa ao balde/bandeja do lote
(ninho de origem, espécie, data de entrada, quantidade, QR) resolveria
isso — mas é escopo extra que o usuário não pediu. Ver pergunta.

## 6. Conteúdo proposto de cada etiqueta

### 6.1 — Adesivo QR do ninho (ou etiqueta completa, se decidido)
```
┌──────────────────────────────┐
│ SEMA-AC · BIOMONITORAMENTO   │
│                               │
│  PC-TR-2026-014               │
│                    ▓▓▓▓▓▓     │  QR → abre o ninho no app/mesa
│  Tracajá (TR)      ▓▓▓▓▓▓     │
│  Praia do Carapanã            │
│  Encontrado: 12/07/2026       │
│  62 ovos                      │
│  Previsão eclosão: 18/09/2026 │
│  Monitor: J. Silva             │
│  ────────────────────────────  │
│  Transferido para: __________  │  campo manuscrito
└──────────────────────────────┘
```
- "Previsão eclosão" é a original (`data_prevista_eclosao`), nunca a
  ajustada por temperatura (`data_prevista_eclosao_ajustada`) — mesma
  disciplina da Água com `data_prevista_eclosao` vs. reavaliações: o
  que vai numa placa fixa tem que ser o compromisso original, não um
  número que muda a cada visita.
- "Transferido para" cobre o caso real de `transferencias_ninho` —
  mesma lógica do "Preservação: ___" da Água (dado que só existe
  depois, manuscrito).

### 6.2 — Placa do berçário
```
┌──────────────────────────────┐
│ SEMA-AC · BIOMONITORAMENTO   │
│         BERÇÁRIO              │
│                               │
│  Berçário Central              │
│                    ▓▓▓▓▓▓     │  QR → abre o berçário (ocupação ao vivo)
│  Tanque de fibra   ▓▓▓▓▓▓     │
│  Capacidade: 300 filhotes      │
│  Responsável: M. Souza         │
│  UC: RESEX Rio Iaco             │
└──────────────────────────────┘
```
Nada de número dinâmico impresso (ocupação, lotes ativos) — só o QR
leva pra lá. É placa permanente, reimpressa só se um dado estático
mudar (troca de responsável, reforma).

### 6.3 — Etiqueta de lote (SE aprovada, ver §5)
```
┌──────────────────────────────┐
│ SEMA-AC · BIOMONITORAMENTO   │
│                               │
│  Berçário Central · Lote       │
│                    ▓▓▓▓▓▓     │
│  Origem: PC-TR-2026-014        │
│  Tracajá (TR) · 58 filhotes     │
│  Entrada: 20/09/2026            │
│  ────────────────────────────  │
│  Vivos hoje: ______             │  campo manuscrito
└──────────────────────────────┘
```

## 7. Arquitetura — reaproveitar ou generalizar

`js/agua-etiqueta.js` hoje mistura duas coisas: (a) motor genérico de
desenho (canvas raster, texto auto-ajustado, QR, PDF de N vias/lote) e
(b) lógica específica da Água (pool de códigos reservados). Como esta
é a SEGUNDA vez que o sistema precisa desenhar uma etiqueta térmica —
mesma régua que já vale pro resto do projeto (`js/frota-consumo.js`,
`js/compartilhar-arquivo.js`: no segundo uso, centraliza em vez de
copiar) — a proposta é:

- **Extrair o motor genérico** para `js/etiqueta-termica.js`: canvas
  40×60mm/203dpi (ou tamanho configurável), faixa institucional,
  auto-ajuste de fonte, desenho de QR a partir de
  `js/qrcode-generator.js`, `PDF de N vias`, `PDF em lote`. Sem saber
  nada de "coleta" nem "ninho".
- `js/agua-etiqueta.js` fica só com o layout da etiqueta de frasco +
  a lógica do pool (que é exclusiva da Água).
- `js/biomonitor-etiqueta.js` (novo) só com os layouts de ninho/
  berçário/lote — sem pool nenhum, porque não precisa.
- Nenhuma mudança de comportamento na Água nesta entrega — é
  refatoração pura, coberta pelos testes que já existem
  (`tests/agua-etiqueta.test.js` tem que continuar passando sem
  alteração).

## 8. Onde entra em cada superfície (regra de duplicação, se aplicável)

- **App de campo** (`pages/biomonitor.html`): botão "Imprimir
  etiqueta" ao lado do "Gerar PDF" que já existe no card de cada ninho
  (`bioNinhoCardInner`, `data-acao="pdf"` — mesma linha de ação, nunca
  telas separadas). No berçário, o mesmo botão na tela de detalhe do
  lote (`tela-detalhe-lote`) — se o lote for aprovado (§5).
- **Mesa** (`pages/admin-biomonitor.html`, aba "Berçários" já
  existe): botão "Imprimir placa" na linha de cada berçário na
  tabela — mesmo padrão da coluna de ações que já existe ali.
- **Mesa** (`pages/relatorios-biomonitor.html` ou
  `biomonitor-validacao.html`, que já geram a ficha em PDF do ninho):
  reimpressão em lote de etiquetas de ninho, espelhando a aba
  "Etiquetas" de `agua-pontos.html` — plano B pra quando a impressora
  falhar em campo.

## 9. Sinergia com a Água — a impressora é a MESMA

Requisito de compra já existe (`docs/qualidade-agua/plano-etiqueta-frasco.md`,
§2) e não muda: etiqueta adesiva sintética, sensor de gap, 203dpi,
TSPL/CPCL/ESC-POS documentado, Bluetooth. **A impressora comprada pra
Água serve para os dois módulos** — não é compra nova. Isso é motivo a
mais pra fechar a compra logo: o retorno cobre dois módulos, não um.

## 10. Fases

| Fase | Depende da impressora? | Entrega |
|---|---|---|
| 1 | Não | `js/etiqueta-termica.js` (motor extraído) + `js/biomonitor-etiqueta.js` (ninho + berçário) + PDF/compartilhar + botões nas 2-3 superfícies + testes. Sem migration (identidade já existe nos dois casos — nem reserva de código, nem código novo pro berçário, a menos que §11 mude isso) |
| 2 | Sim | Reaproveita o driver Bluetooth que a Fase 2 da Água já vai construir — sem trabalho novo de transporte, só o layout já pronto da Fase 1 |

## 11. Decisão em aberto — berçário precisa de um código curto?

`bercarios` não tem nenhum código hoje, só `nome` (texto livre). O QR
pode carregar o `id` (uuid) direto — funciona, mas não dá pra
DIGITAR um uuid se o leitor de QR falhar (sol forte, tela suja).
`agua_pontos_coleta`/`agua_equipamentos` sempre tiveram um humano-
legível (código ANA / nome único). Duas saídas:
- (A) QR carrega o `id` (uuid) — zero mudança de schema, mas sem
  fallback digitável caso a leitura falhe.
- (B) migration pequena adiciona um código curto opcional a
  `bercarios` (ex. sequencial `BERC-01`), gerado uma vez — mesmo
  padrão de `BIOEQ-AAAA-NNNN` (migration 175/226), sem toda a
  complexidade de reserva (berçário nasce raro, sem concorrência de
  campo).
Ver pergunta ao usuário.
