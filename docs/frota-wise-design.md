# Identidade visual "Wise" — módulo Frota

Tema isolado ao módulo Frota (`frota-*.html`, `frota-app.html`). **Não
altera** o design system institucional do SIGUC-AC (`css/global.css`,
sidebar, demais páginas) — CLAUDE.md proíbe mudar essas variáveis sem
alinhamento.

## Como aplicar numa página

```html
<link rel="stylesheet" href="../css/global.css">
<link rel="stylesheet" href="../css/frota-wise-theme.css">
...
<script src="../js/frota-wise.js"></script>
```

Envolva o conteúdo (fora da sidebar/header gerados por `gerarLayout()`)
com `class="fw-theme"`. Todas as classes `fw-*` só têm efeito dentro
desse wrapper.

## Tokens (`css/frota-wise-theme.css`, escopo `.fw-theme`)

| Token | Valor | Uso |
|---|---|---|
| `--fw-green` | `#9FE870` | destaque primário, botão primário |
| `--fw-forest` | `#163300` | texto sobre verde, headings |
| `--fw-green-tint` | `#DCF3D8` | fundo de badges/avatares positivos |
| `--fw-bg` | `#FFFFFF` | fundo principal |
| `--fw-bg-muted` | `#F2F5F7` | seções alternadas, inputs, hover |
| `--fw-text` / `--fw-text-muted` | `#0E0F0C` / `#454745` | texto |
| `--fw-border` | `#E8EAED` | bordas |

Tipografia: **Archivo** (700–900) para títulos, **Inter** para corpo.
Botão primário: fundo `--fw-green`, texto `--fw-forest` (nunca branco).

## Cores de status da frota (`.fw-badge-*`)

| Status | Fundo | Texto |
|---|---|---|
| Disponível (`fw-badge-disponivel`) | `#DCF3D8` | `#163300` |
| Em rota / em uso (`fw-badge-em-rota`) | `#E0E7FF` | `#260AC0` |
| Em manutenção (`fw-badge-manutencao`) | `#FDF3D7` | `#7A5C00` |
| Inativo / bloqueado (`fw-badge-inativo`) | `#FBE9E6` | `#A8200D` |
| Documentação vencendo (`fw-badge-doc-vencendo`) | `#FDF3D7` | `#7A5C00` |

## Componentes disponíveis

`btn-primary/secondary/tertiary` (pílula), `fw-card`, `fw-vehicle-card`,
`fw-list-item` (+ `fw-list-icon/main/title/subtitle/value`), `fw-kpi-card`
(+ `fw-kpi-label/value/delta`), `fw-badge-*`, `fw-avatar`, `fw-filter-chip`,
`table.fw-table`, `fw-skeleton`.

`js/frota-wise.js`: `fwAnimateNumber(el, valorFinal, opts)` — ticker
estilo odômetro para KPIs (respeita `prefers-reduced-motion`).
`fwSkeleton(alturaPx, larguraCss)` — bloco de skeleton loading.

## Status da aplicação

- [x] Tokens + componentes base (`css/frota-wise-theme.css`, `js/frota-wise.js`)
- [x] `pages/frota-veiculos.html` — KPIs animados + badges de status de veículo
- [x] `pages/frota-viagens.html` — KPIs animados + badges de status de viagem
- [x] `pages/frota-solicitar.html` — badges de status de viagem
- [x] `pages/frota-manutencao.html` — KPIs animados + badges de OS/plano de manutenção
- [x] `pages/frota-tarefas.html` — badges de notificação
- [x] `pages/frota-abastecimentos.html` — KPIs animados + badges de status
- [x] `pages/frota-contratos.html` — badges ativo/inativo
- [x] `pages/frota-app.html` (PWA de campo, modos solicitante/motorista/gestor) —
      KPIs animados + badges de status nos 3 modos
- [x] `pwa/sw.js` — `VERSOES.frota` incrementado (13 → 14) e shell atualizado
      com `css/frota-wise-theme.css` + `js/frota-wise.js`
- [ ] `fw-vehicle-card`, `fw-list-item`, `fw-filter-chip`, `fw-avatar` ainda não
      aplicados nas listagens (hoje usam `<table>`/linhas no padrão institucional
      já com badges Wise) — trocar exige repaginar a listagem, não só o token

## Exceção — identidade da tela Início (`frota-app.html`, modo motorista)

A "casca" da Início (avatar, saudação, cards de ação) foi alinhada ao
padrão institucional em vez de seguir o Tema Wise à risca — achado ao
comparar lado a lado com o app Brigadas: o avatar sem moldura e os
botões achatados destoavam demais do resto da plataforma. Trocado por:
moldura de avatar única (`css/avatar-foto.css` + `js/avatar-foto.js`,
mesma da CLAUDE.md "foto de perfil sincronizada" — o app tinha uma
implementação própria do menu Ver/Trocar, `#modal-foto-mot-menu`,
nunca migrada quando os outros 3 apps foram; removida em favor do
componente único), nome em Fraunces (`--font-display`, a fonte de
título da plataforma, não o Archivo do Wise) e os dois botões de ação
(`Registrar abastecimento`/`Solicitar manutenção`) viraram cards com
ícone em destaque (`.fm-action-card`), no mesmo espírito dos cards
"O que deseja registrar?" do Biomonitor. O restante do app (badges,
KPIs, formulários) continua no Tema Wise — decisão de escopo, não
pendência.
- `pwa/sw.js`: `SHELLS.frota` ganhou `/css/avatar-foto.css` (o arquivo
  já estava faltando ali — o CSS nunca tinha ido nem para o `<link>`
  da própria página, por isso a moldura nunca apareceu). `VERSOES.frota`
  94 → 95. `app-frota/scripts/build-www.mjs`: `avatar-foto.css` entrou
  em `ARQUIVOS_CSS`.
