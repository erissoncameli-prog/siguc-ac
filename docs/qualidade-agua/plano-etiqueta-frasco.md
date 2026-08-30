# Qualidade da Água — Etiqueta do frasco (impressão térmica Bluetooth)

**Fase 1 ENTREGUE** (migration 325, `js/agua-etiqueta.js`,
`tests/agua-etiqueta.test.js`) — tudo que não depende da impressora
chegar. Fase 2 (transporte Bluetooth + driver do modelo) aguarda a
compra; o requisito de §2 é o que vai para a cotação. Resumo da
entrega e das divergências reais em relação ao plano original está no
fim deste arquivo (§9). Decisões do usuário já tomadas (ver §1).

## 1. Decisões tomadas antes de planejar

| Pergunta | Decisão |
|---|---|
| Etiqueta por frasco ou por coleta? | **Por coleta, com N vias** — o técnico escolhe quantas imprimir e cola em todos os frascos daquela amostra. Sem tabela de kit de frascos, sem migration de catálogo. |
| Como imprimir offline se `codigo_amostra` nasce no trigger? | **Reserva de bloco de códigos** — o app baixa códigos `COL-AAAA-NNNN` definitivos antes de ir a campo. |
| Onde precisa funcionar? | **APK Android + PWA/navegador + mesa (desktop)**. |
| Especificar a impressora antes de codar? | **Sim** — §2 é entregável independente de código. |

## 2. Requisito de compra da impressora

Levar isto à cotação. Nenhum modelo foi homologado por nós; o que está travado é o
*requisito*, não a marca.

| Item | Requisito mínimo | Por quê |
|---|---|---|
| Mídia | Etiqueta adesiva **sintética (BOPP/PP)**, com **sensor de gap**, 40×60 mm (ou 50×30 mm) | Frasco molhado, gelo e caixa térmica destroem papel térmico comum: borra e descola |
| Tecnologia | Térmica direta basta para o ciclo coleta→laboratório (dias). Transferência térmica (fita resina) só se a etiqueta precisar sobreviver meses de arquivo | Térmica direta desbota com calor/UV |
| Resolução | **203 dpi** (8 pontos/mm) | Abaixo disso o QR e o código ficam ilegíveis no tamanho da etiqueta |
| Largura de impressão | ≥ 48 mm | Cabe a etiqueta proposta em §4 |
| Linguagem de comando | **TSPL/TSPL2, CPCL ou ESC/POS raster, com manual público** | É o que permite escrever o driver. **Recusar impressora que só funcione pelo app proprietário do fabricante** — sem manual, não há integração |
| Bluetooth | **SPP (Bluetooth Classic) de preferência**; BLE aceito se o serviço/característica de escrita e o MTU forem documentados | Ver risco de desempenho em §7 |
| Robustez | IP54 desejável, bateria trocável, alça/coldre | Uso em barco e margem de rio |

## 3. Restrições do sistema que mandam no desenho

1. **Nada pode impedir o trabalho de campo** (regra do sistema). Falha de impressão,
   de pareamento ou de bateria **nunca** bloqueia salvar a coleta.
2. `codigo_amostra` é gerado por **trigger no banco** (migration 273) e só existe
   depois do sync. O trigger **respeita** um valor informado pelo cliente — é
   exatamente essa porta que a reserva de códigos usa, sem alterar o trigger.
3. `codigo_amostra` tem **UNIQUE** (`uq_agua_coletas_codigo_amostra`) e um contador
   único por ano (`agua_coletas_contador`). A reserva **tem** que consumir esse mesmo
   contador, senão o app gera colisão que só aparece no sync, em campo.
4. **Fonte única** (lição do `js/frota-consumo.js`): o desenho da etiqueta vive em
   um arquivo só, consumido por preview, impressora e PDF.
5. `pwa/sw.js`: `VERSOES.agua` 26 → 27, e o APK sai sozinho pelo
   `apk-auto-trigger.yml`.

## 4. Conteúdo proposto da etiqueta (40×60 mm, 203 dpi = 320×480 pontos)

```
┌────────────────────────────────┐
│ SEMA-AC · QUALIDADE DA ÁGUA    │  faixa preta, 3 mm
│                                │
│  COL-2026-0042        ▓▓▓▓▓▓   │  código 6 mm mono + QR 15 mm
│                       ▓▓▓▓▓▓   │
│  Rio Acre — Ponte Metálica     │  ponto (nome)
│  ANA 12345678                  │  código ANA
│  29/08/2026  08:14             │
│  Coletor: J. Silva             │
│  ────────────────────────────  │
│  Preservação: ______________   │  campo manuscrito
│  Via 2 de 4                    │
└────────────────────────────────┘
```

- QR carrega o código da amostra (nível M, módulo ≥3 pontos ⇒ ~15 mm).
  `js/qrcode-generator.js` já é vendorizado e **já está no shell da Água**.
- Fonte mínima ~3 mm a 203 dpi. Nada de Fraunces em número de destaque
  (regra do sistema) — mono/sans.
- "Preservação" fica manuscrito: a decisão foi *uma etiqueta por coleta*, então a
  etiqueta não sabe qual frasco é qual. Se um dia isso virar problema real, o
  caminho é o kit de frascos, que fica registrado como não feito.

## 5. As cinco peças a construir

### Peça 1 — Migration: reserva de códigos
- `agua_codigos_reservados` (codigo PK, ano, reservado_por, reservado_em,
  uuid_cliente, usado_em, expira_em). RLS: o dono vê e usa os seus.
- RPC `agua_reservar_codigos(p_qtd)` **SECURITY DEFINER**, consumindo
  `agua_coletas_contador` — teto por chamada (ex.: 50) e teto em aberto por
  usuário (ex.: 200), para não furar a numeração à toa.
- **Buraco na numeração é consequência aceita e precisa ser declarada**:
  `COL-2026-0042` pode nunca existir. Sem isso documentado, uma auditoria futura
  conclui que sumiu uma coleta. Entra um relatório de reservados-não-usados em
  `pages/agua-conferencia.html`.
- **Código reservado nunca é reciclado.** Reutilizar reabre a chance de dois
  frascos físicos com o mesmo código (uma etiqueta velha sobrou na caixa).
- Virada de ano: reserva de dezembro usada em janeiro segue `COL-2026-…`. Aceito
  (o código é identidade, não data); a expiração em 31/12 reduz o caso.

### Peça 2 — `js/agua-etiqueta.js` (desenho, fonte única)
Desenha em `<canvas>` 1-bit a partir de mm × dpi. A **mesma** função alimenta os
três destinos: preview na tela, bitmap para a impressora, PDF de contingência.
Nenhuma página redesenha etiqueta.

### Peça 3 — `js/impressora-bt.js` (transporte, degradação declarada)
| Caminho | Onde funciona | Limite |
|---|---|---|
| A. Plugin nativo (Capacitor) | APK Android | Único que alcança **Bluetooth Classic/SPP**. Android 12+ exige `BLUETOOTH_CONNECT`/`SCAN` |
| B. Web Bluetooth | Chrome Android (PWA) | **Só BLE**, só HTTPS, exige gesto do usuário. **Não existe em iPhone** |
| C. PDF/PNG + compartilhar | Todos, inclusive iPhone e mesa | Passa pelo app da impressora ou por impressora USB/rede. Usa `js/compartilhar-arquivo.js`, que já existe |

O caminho C é o que faz a entrega **funcionar no dia 1, antes de a impressora
chegar**. A e B são otimização de fluxo, não pré-requisito.

### Peça 4 — `js/impressora-drivers.js` (o pedaço específico do modelo)
Um objeto por linguagem (`escpos_raster` `GS v 0`, `tspl` `BITMAP`, `cpcl` `EG`);
todos recebem o mesmo bitmap 1-bit e devolvem `Uint8Array`. O cadastro da
impressora (nome BT, linguagem, largura, dpi) é **preferência por aparelho**
(IndexedDB/localStorage), nunca dado de banco — mesmo padrão da sonda padrão
(migration 314) e de `siguc_agua_painel_camadas`.
**Quando o modelo chegar, muda um arquivo pequeno. Só ele.**

### Peça 5 — Superfícies (regra de duplicação)
- **App** (`pages/agua-app.html`): "Imprimir etiqueta" na tela de sucesso do salvar
  **e** no card da coleta (Histórico/Fila) — reimpressão tem que existir, etiqueta
  rasga e molha. Seletor de nº de vias.
- **Config do app**: parear impressora, imprimir teste, vias padrão, e
  **reservar códigos** com indicador "12 códigos disponíveis offline".
- **Mesa** (`pages/agua-pontos.html`, aba nova): lote pré-impresso em PDF A4
  antes da campanha. É o plano B quando a térmica quebra no meio do rio.

## 6. Fases

| Fase | Depende da impressora? | Entrega |
|---|---|---|
| 1 | **Não** | Migration de reserva + `agua-etiqueta.js` + preview + PDF/compartilhar + lote na mesa + testes. Já utilizável em campo |
| 2 | Sim | `impressora-bt.js` + driver do modelo + pareamento no Config + teste em campo |
| 3 | Não (opcional) | Ler o QR no lançamento do laudo (`agua-laudos.html`): casa frasco físico com a coleta na tela e alimenta a trava de identidade que a Entrega 2 já tem |

## 7. Riscos

- **BLE lento.** 40×60 mm a 203 dpi = 320×480 pontos = 18,75 KB. Com MTU de 20
  bytes são ~960 pacotes — 10 a 20 s por etiqueta. Mitigação: preferir SPP Classic
  na compra; ou usar comando de texto nativo da impressora em vez de raster quando
  a etiqueta não tiver QR.
- **Térmica direta desbota.** Coberto pelo requisito de mídia em §2.
- **Impressora sem manual público.** Mata a integração. É o item nº 1 a conferir na
  cotação.

## 8. O que decidimos NÃO fazer

- Driver "universal" que adivinha a linguagem da impressora.
- Guardar a impressora pareada no banco (é preferência de aparelho).
- Bloquear o salvamento por falha de impressão.
- Kit de frascos por parâmetro/preservante (decisão: uma etiqueta por coleta, N vias).

## 9. Fase 1 — ENTREGUE (o que foi construído e o que divergiu do plano)

- **Migration 325**: `agua_codigos_reservados` + `agua_reservar_codigos(qtd)`
  (SECURITY DEFINER, mesmo contador da 273, teto 50/chamada e
  200 em aberto por técnico) + trigger `trg_agua_marcar_codigo_usado`
  (AFTER, marca `usado_em` sozinho quando a coleta sincroniza) +
  `agua_codigos_reservados_pendentes()` (relatório de mesa). Achado do
  advisor logo após aplicar: a função de trigger nasceu chamável direto
  via RPC (mesmo padrão de sempre — `ALTER DEFAULT PRIVILEGES` do
  projeto concede EXECUTE por nome) — corrigido na 325b com `REVOKE
  ALL ... FROM PUBLIC, anon, authenticated`, mesmo molde da 179.
- **`js/agua-etiqueta.js`**: canvas 40×60 mm a 203 dpi como fonte única
  do desenho (preview, PDF de N vias, PDF em lote — todos a MESMA
  imagem raster, nunca texto vetorial duplicado). QR desenhado direto
  dos módulos internos de `js/qrcode-generator.js` (sem `<img>`
  assíncrona — a etiqueta precisa sair pronta na mesma chamada).
- **Divergência 1 — overlay só abre quando o código veio do pool.**
  O plano original não previa essa distinção. Ao escrever o teste,
  ficou claro que abrir o overlay em TODO salvamento quebraria o fluxo
  comum (inclusive `tests/agua-app-fluxo.test.js`, que sempre digita
  um código manual) — e que a distinção é também a coisa certa a
  fazer: código digitado à mão significa frasco com etiqueta própria
  (texto de ajuda do campo), imprimir a nossa por cima não serve pra
  nada.
- **Divergência 2 — relatório de reservados pendentes foi para
  `pages/agua-pontos.html` (aba "Etiquetas"), não para
  `agua-conferencia.html`** como o plano original cogitava. Decisão
  tomada ao codar: ficou mais coeso ao lado do lote de reimpressão
  (mesmo assunto — códigos/etiquetas), enquanto Conferência é sobre
  promover dado de laudo em quarentena, outro assunto.
- **"Lote de mesa" mudou de forma**: em vez de pré-imprimir etiquetas
  em branco antes da campanha (o rótulo de ponto/data/coletor não
  existe antes da coleta acontecer), virou REIMPRESSÃO de coletas já
  sincronizadas — o cenário real descrito no próprio plano ("plano B
  quando a térmica quebra no meio do rio" só faz sentido depois que a
  coleta já aconteceu e foi enviada).
- `pwa/sw.js`: agua v26 → v27. `app-agua/scripts/build-www.mjs`
  atualizado nas 3 listas (dev, standalone, Capacitor).
- Guarda: `tests/agua-etiqueta.test.js` (4 testes, rodados de verdade
  contra `pages/agua-app.html`) — confirmado que
  `tests/agua-app-fluxo.test.js` continua passando sem alteração.
  `pages/agua-pontos.html` não tem suíte própria no repositório (nenhuma
  das 45 páginas de mesa "sozinhas" tem); a aba nova foi conferida por
  `node --check` e pelo padrão das abas irmãs, não por teste ponta a
  ponta — registrado como limitação, não como lacuna escondida.
- **Nada mudou nos itens que dependem da impressora** (§2, §5 Peça 3/4,
  §6 Fase 2/3, §7) — seguem exatamente como planejados, aguardando a
  compra.
