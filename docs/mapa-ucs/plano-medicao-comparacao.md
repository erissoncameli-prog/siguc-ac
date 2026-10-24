# Mapa das UCs — Medição e Comparação temporal (plano)

Origem: funções vistas no `jurema-webgis` (Cardeal Map, Vitor Signori,
`github.com/vitorsig86-art/jurema-webgis`), lido em 24/10/2026. O repositório
NÃO tem licença (= todos os direitos reservados): aproveitamos as IDEIAS, nenhum
trecho de código. Ele é React + Cesium; o SIGUC é JS puro + Leaflet 1.9.4, então
tudo é reescrito no padrão do projeto.

Decisões do usuário (24/10/2026):
- Começar pelas Fases 1 (medição) e 2 (comparação temporal).
- Comparação com **Planet mensal, Sentinel-2 e PRODES**.
- Sem drone/3D por enquanto (fases de ortomosaico e modelo 3D saem do plano).
- Camadas de meio físico (IBGE/ANA) virão por **download no GitHub Actions**
  (molde de `terraclass-uc.yml`/`embargos.yml`) — fase posterior, fora deste doc.
- Não pedir autorização ao autor: nada de código dele entra.

---

## Fase 1 — Ferramentas de medição — ENTREGUE (24/10/2026)

Decisão tomada na implementação: ícones em `BICON_PATHS` (regra do projeto),
com os 5 contadores de `pwa/sw.js` subindo.

### O que entra
Barra de 4 botões + limpar, igual em ideia à do Jurema, menos a "diferença de
cota" (no Leaflet não há superfície 3D; só faria sentido com um MDT nosso
consultado por ponto — fica de fora, e a tela não promete o que não mede):

| Ferramenta | Resultado |
|---|---|
| Coordenada | lat/long em graus decimais **e** UTM SIRGAS 2000 da zona (18S/19S) — `proj4` já vendorizado; botão copiar |
| Distância | soma dos trechos, geodésica (`turf.length`), parcial a cada clique; m até 1 km, depois km |
| Área | `turf.area` + perímetro; m² até 1 ha, depois ha (e km² acima de 10.000 ha). Rótulo "medida no mapa — não registral" (mesma cautela do Jurema) |
| Limpar | apaga todas as medições da sessão |

### Arquivo e integração
- **`js/mapa-medicao.js`** (prefixo `med`), fonte única. `pages/mapa.html` só
  chama `medMontar(mapaL)` depois de criar o mapa — mesma lição de
  `js/mapa-assentamentos.js`. Nenhuma conta na página.
- Controle Leaflet próprio no canto **topleft**, abaixo do zoom e do botão de
  tela cheia (`_adicionarControleTelaCheia`). Ícones novos em `BICON_PATHS`
  (`js/config.js`) no estilo de traço — nunca emoji. ⚠️ `js/config.js` está no
  shell dos 4 apps → `pwa/sw.js` sobe os 4 contadores (gatilho de APK).
  Alternativa a decidir na implementação: ícones como SVG local do módulo, sem
  tocar em `config.js` (evita 4 APKs por causa de 4 ícones).
- Controle: botão com `aria-pressed`, `:focus-visible`, alvo ≥ 24×24px (regra de
  estados de interface).

### Interação (o ponto mais delicado)
- Clique adiciona vértice; duplo clique ou **Enter** fecha; **Backspace** desfaz
  o último vértice; **Esc** cancela; trocar de ferramenta encerra a atual.
- ⚠️ **Clique de medição não pode abrir popup de UC/CAR/alerta.** Os eventos das
  camadas vetoriais disparam antes do `click` do mapa. Enquanto mede, o container
  ganha a classe `.med-ativa` e `.med-ativa .leaflet-interactive{pointer-events:
  none}` desliga a interação das camadas — volta sozinho ao sair. Testar com UC,
  CAR e marcadores de alerta ligados.
- `doubleClickZoom` desligado durante a medição e restaurado depois (senão o
  duplo clique que fecha a área também dá zoom).
- Cursor em cruz; linha "elástica" do último vértice até o ponteiro com o valor
  parcial em tooltip.
- Medições desenhadas num `L.layerGroup` próprio, em pane própria acima das
  camadas temáticas (`createPane('medicao')`, z-index de pane do Leaflet —
  não confundir com a faixa 600–800 dos painéis de página).
- Toque (iPad): mesmo fluxo, com botão "Concluir" visível na barra (não há
  duplo clique confiável em toque).

### Persistência e impressão
- Nada vai ao banco nem ao `localStorage` — é medição de sessão.
- Impressão (`CART.imprimir`, que MOVE o próprio `#mapa` para a folha): as
  medições já saem junto porque são camadas do mapa; conferir que o tooltip com
  o valor também aparece na folha.

### Tela cheia
- A barra é controle Leaflet, então vive dentro do `#mapa` — sem risco de top
  layer (regra "painéis na tela cheia do mapa").

### Guarda — `tests/mapa-medicao.test.js`
- Funções puras (formatação, UTM de um ponto conhecido de Rio Branco conferido
  à mão, área de um quadrado de 1 km conhecido).
- Página real (molde de `tests/mapa-areas-aparencia.test.js`, 1366×768, stub do
  supabase-js e dos plugins): medir distância por cliques reais; medir sobre uma
  UC **não** abre o popup dela (contrafactual: sem a classe `.med-ativa`, abre);
  Esc cancela; duplo clique não muda o zoom; funciona no imersivo.
- Sem mudança em `pwa/sw.js` se os ícones ficarem no módulo (tela de mesa).

---

## Fase 2 — Comparação temporal (divisor arrastável) — ENTREGUE (24/10/2026)

Ajustes feitos na implementação (registrados no CLAUDE.md):
- Entrada é um botão no próprio mapa (canto superior esquerdo), que já vale no
  imersivo — em vez de um botão na aba Cobertura Vegetal + outro no imersivo.
- As panes ficam ACIMA das imagens do painel, então nada "cobre" a
  comparação; o aviso diz o que ficou POR BAIXO (aparece onde a imagem não
  cobre, como no lado do PRODES).

### O que entra
Duas imagens lado a lado com um divisor vertical arrastável: "Esquerda" e
"Direita", cada lado com fonte + data. Fontes:

| Fonte | Como já existe no SIGUC | Escolha de data no comparador |
|---|---|---|
| Planet / NICFI mensal | `mapaPlanetMosaicos()` + `mapaPlanetLayer(L, mosaico, op)` (`js/mapa-camadas.js`, proxy `/api/planet`) | mês (lista de mosaicos disponíveis) |
| Sentinel-2 | `/api/sentinel?…&data=AAAA-MM-DD` (cena do dia) e `&ano=AAAA` (época seca) | ano (época seca) ou data de cena (`_sentinelCarregarDatas`) |
| PRODES | WMS TerraBrasilis `yearly_deforestation_biome` com `CQL_FILTER: year=N` (já usado em `_tlSetProdes`) | ano |

Pode misturar fontes (ex.: Planet jan/2024 × Planet jan/2026, ou Sentinel 2022
× PRODES 2023). PRODES é transparente: num lado PRODES fica SOBRE a base
corrente do mapa; o texto do lado diz isso.

### Arquivo e integração
- **`js/mapa-comparar.js`** (prefixo `cmp`), fonte única. As fábricas de camada
  são as que JÁ existem (`mapaPlanetLayer`, URL do proxy Sentinel, WMS PRODES) —
  ⚠️ a do PRODES e a do Sentinel hoje estão inline em `pages/mapa.html`
  (`VEG_LAYERS.prodes`, `_tlSetProdes`, `_tlSetSentinelAno`): movê-las para
  `js/mapa-camadas.js` (fábricas `mapaProdesAnoLayer`, `mapaSentinelLayer`) e
  fazer a linha do tempo e o comparador usarem a mesma. Nunca uma 4ª cópia da
  URL do WMS. ⚠️ Hoje `pages/mapa.html` NÃO carrega `js/mapa-camadas.js` (só
  `alertas-ambientais.html` e `validacao-campo.html` carregam) e tem a sua
  própria cópia do Planet (`VEG_LAYERS.planet`, `_planetCarregarMosaicos`):
  passar a carregar o arquivo e trocar a cópia pela função compartilhada.
- Entrada: botão "Comparar imagens" na aba "Cobertura Vegetal" e no cluster de
  controles do imersivo (`.mapa-fs-controls`). Sair: botão "Sair da comparação"
  e Esc.

### Mecânica no Leaflet
- Duas panes próprias (`cmpEsquerda`, `cmpDireita`), acima das bases e ABAIXO
  das camadas temáticas (UC, CAR e alertas seguem por cima dos dois lados —
  é o que dá sentido a comparar dentro da UC).
- Recorte com `clip-path: inset(...)` em cada pane, recalculado em
  `move`/`zoom`/`resize` e ao arrastar. ⚠️ As panes andam com o pan do mapa
  (`transform` do map pane): o recorte é em coordenada de CAMADA, não de tela —
  converter com `map.containerPointToLayerPoint`. É o mesmo problema que o
  plugin leaflet-side-by-side resolve; fazemos à mão (sem dependência nova,
  ~100 linhas).
- `clip-path` não cria containing block para `position:fixed` (diferente de
  `transform`/`filter`), então não reabre a armadilha da barra do Frota.
- Arrastar o divisor desliga `dragging` do mapa só durante o arrasto (o Jurema
  faz o mesmo com o controlador de câmera) e restaura ao soltar/cancelar,
  inclusive em `lostpointercapture`.
- Divisor = `role="slider"`, `tabindex=0`, setas (2%), Home/End,
  `aria-valuetext` "40% à esquerda". Limites 2–98%.
- Rótulos fixos no topo de cada lado ("Esquerda: Planet — jan/2024"), cortados
  pela largura disponível.

### Avisos (ideia do Jurema)
- Carregando / campanha indisponível (Planet sem mosaico, Sentinel sem cena,
  erro de tile) — por lado, `role="status"`.
- "Mesma imagem nos dois lados."
- **Camada cobrindo a comparação**: se Sentinel/Planet/GIBS/MapBiomas estiverem
  ligados no painel normal acima das panes, lista quais e sugere desligar.
  **Decisão do usuário (24/10/2026): só avisar** — o comparador nunca liga,
  desliga nem muda opacidade de camada do painel. O aviso some sozinho quando
  o usuário desliga a camada (ou zera a opacidade) no painel.

### Custo de API
Comparação dobra os tiles pedidos. Planet (NICFI) e Sentinel passam pelos
nossos proxies (`/api/planet`, `/api/sentinel`) e têm cota: verificar no log da
Vercel o volume depois da entrega. Sem cache novo nesta fase.

### Impressão
Comparação NÃO vai para `CART.imprimir` nesta fase (recorte por `clip-path` na
folha A4 exigiria recalcular para o tamanho da folha). Ao imprimir em modo
comparação, sair dele antes, com aviso. Fica como melhoria futura.

### Guarda — `tests/mapa-comparar.test.js`
Página real, proxies trocados por stub que devolve PNG de cor sólida diferente
por lado (vermelho × azul):
- verificação por PIXEL (mesma técnica de `tests/mapa-telacheia.test.js`):
  recorte 1×1 à esquerda do divisor = cor da esquerda, à direita = cor da
  direita; depois de arrastar, o mesmo ponto troca de cor;
- o recorte acompanha o pan (arrastar o mapa não desalinha a divisa);
- teclado move o divisor; Esc sai sem alterar nenhuma camada do painel;
- camada de imagem ligada no painel gera o aviso e continua ligada (nunca é desligada);
- UC desenhada continua visível e clicável dos dois lados;
- funciona no imersivo.
Contrafactual: sem a conversão de coordenada de camada, o teste do pan reprova.

Sem mudança em `pwa/sw.js`: `js/mapa-camadas.js` não está em nenhum `SHELLS`
nem nos `build-www.mjs` (conferido em 24/10/2026). Rodar também os testes de
`alertas-ambientais.html` e `validacao-campo.html`, que usam o mesmo arquivo.

---

## Ordem de entrega
1. Fase 1 (medição) — PR próprio.
2. Extração das fábricas PRODES/Sentinel para `js/mapa-camadas.js` (sem mudança
   visível; linha do tempo segue igual — `tests/mapa-linha-tempo.test.js` prova).
3. Fase 2 (comparação) — PR próprio.
4. Registro das regras novas no `CLAUDE.md` em cada entrega.

## Fase 3 — ENTREGUE (24/10/2026)
Popup configurável, medidas calculadas e cor por atributo nas camadas
enviadas (`js/mapa-camadas-config.js`) + dado pessoal tirado do GeoJSON
(migration 367). Ver a regra no CLAUDE.md.

## Fora deste plano (registrado)
- Meio físico IBGE/ANA
  via GitHub Actions (Fase 4), GPS + legenda em degradê (Fase 5).
- Ortomosaico de drone e modelo 3D: sem levantamentos hoje.
