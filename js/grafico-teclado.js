// ═══════════════════════════════════════════════════════════════════
// grafico-teclado.js — acesso por teclado aos gráficos SVG do sistema
// ───────────────────────────────────────────────────────────────────
// Os gráficos do projeto são SVG desenhados à mão (js/agua-iqa-visual.js,
// js/rh-hidro.js) — sem lib, de propósito, e isso não muda aqui. O que
// faltava era acesso: havia 0 ocorrências de `tabindex` e 0 de `focus`
// em todos eles, então quem navega por teclado não alcançava nenhum
// ponto, e o valor só existia no tooltip nativo (hover de mouse).
//
// DECISÃO DE ORDEM DE TABULAÇÃO — era a pergunta em aberto.
// UMA parada de Tab por gráfico, com as SETAS percorrendo os pontos.
// Não um tabindex por ponto: o gráfico do IQA tem ~20 campanhas, mas o
// hidrograma de uma estação chega a 90+ medições — 90 paradas de Tab
// dentro de um card tornariam o teclado inútil na página inteira.
// Home/End vão ao primeiro/último. É o mesmo padrão de "cursor virtual"
// que a WAI usa para grade e listbox.
//
// FONTE ÚNICA DO DADO: o helper NÃO recebe uma segunda cópia dos
// valores — ele lê os `<title>` que os geradores já colocam em cada
// forma (círculo, barra, fatia). Enquanto o gráfico desenhar tooltip
// nativo, o teclado e a tabela alternativa acompanham de graça, e nunca
// divergem do que o mouse mostra.
//
// O CSS vive AQUI DENTRO, injetado uma vez, em vez de num .css próprio:
// os consumidores são páginas de mesa (css/global.css), o app de campo
// da Água (css/agua-app.css) e o painel público (que roda sem sessão).
// Um arquivo só entra em shell de PWA e em build nativo; dois seriam
// duas listas para manter em sincronia.
// ═══════════════════════════════════════════════════════════════════

const GT_ESTILO_ID = 'gt-estilo'

function _gtInjetarEstilo() {
  if (document.getElementById(GT_ESTILO_ID)) return
  const s = document.createElement('style')
  s.id = GT_ESTILO_ID
  s.textContent = `
.gt-wrap { position: relative; }
.gt-svg { display: block; border-radius: 6px; }
.gt-svg:focus { outline: none; }
.gt-svg:focus-visible { outline: 3px solid rgba(82,183,136,.55); outline-offset: 3px; }
.gt-alvo { outline: none; }
/* Realce do ponto sob o cursor: anel DESENHADO, não outline — outline
   em forma SVG é irregular entre navegadores. */
.gt-halo { pointer-events: none; }
.gt-dica {
  font-size: 10.5px; color: var(--cinza-500, #6B7280); text-align: center;
  margin: 4px 0 0; opacity: 0; transition: opacity .15s;
}
.gt-svg:focus-visible ~ .gt-dica { opacity: 1; }
.gt-live {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
.gt-tabela { margin-top: 8px; font-size: 12px; }
.gt-tabela summary {
  cursor: pointer; color: var(--verde-medio, #2D6A4F); font-weight: 500;
  font-size: 11.5px; padding: 3px 0;
}
.gt-tabela summary:focus-visible { outline: 3px solid rgba(82,183,136,.55); outline-offset: 2px; border-radius: 4px; }
.gt-tabela table { width: 100%; border-collapse: collapse; margin-top: 6px; }
.gt-tabela th, .gt-tabela td {
  text-align: left; padding: 5px 8px; font-size: 11.5px;
  border-bottom: 1px solid var(--borda, #E5E7EB); font-variant-numeric: tabular-nums;
}
.gt-tabela th {
  font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--cinza-500, #6B7280); background: var(--cinza-50, #F9FAFB);
}
.gt-tabela-wrap { overflow-x: auto; }
@media (prefers-reduced-motion: reduce) { .gt-dica { transition: none; } }
`
  document.head.appendChild(s)
}

function _gtEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// Envolve um SVG já pronto. `svg` é a string que o gerador devolveu.
// opts.rotulo   — nome do gráfico, lido em voz alta ao focar
// opts.colunas  — cabeçalhos da tabela alternativa (default: 2 colunas)
// opts.semTabela — true para omitir o <details> (gráfico já ao lado de
//                  uma tabela na tela; repetir seria ruído)
function graficoTecladoEnvolver(svg, opts) {
  const o = Object.assign({ rotulo: 'Gráfico', semTabela: false }, opts || {})
  return `<div class="gt-wrap" data-gt>
  <div class="gt-svg" tabindex="0" role="application" aria-label="${_gtEsc(o.rotulo)}. Use as setas para percorrer os pontos.">${svg}</div>
  <p class="gt-live" aria-live="polite" role="status"></p>
  <p class="gt-dica">← → percorre os pontos · Home e End vão às pontas</p>
  ${o.semTabela ? '' : '<div data-gt-tabela></div>'}
</div>`
}

// Formas que carregam dado — a mesma marca que o tooltip nativo usa.
// `data-gt-ponto` existe para o caso do hidrograma, onde DUAS séries têm
// tooltip (barra de chuva e ponto de nível) mas só uma deve ser a régua
// de navegação: sem isso, as setas percorreriam todas as barras e só
// depois todos os níveis, o que não corresponde ao eixo do tempo.
// Sem nenhum marcador, vale toda forma com <title> — é o caso do
// gráfico de IQA, onde só os pontos têm tooltip.
function _gtPontos(wrap) {
  const svg = wrap.querySelector('svg')
  if (!svg) return []
  const marcados = Array.from(svg.querySelectorAll('[data-gt-ponto]'))
  if (marcados.length) return marcados
  return Array.from(svg.querySelectorAll('circle, rect, path, line'))
    .filter(el => el.querySelector('title'))
}

function _gtTexto(el) {
  const t = el.querySelector('title')
  return t ? (t.textContent || '').trim() : ''
}

// Monta a tabela alternativa a partir dos MESMOS <title>. O texto dos
// geradores é "rótulo — valor · qualificador", então quebra no travessão
// quando ele existe e cai para uma coluna só quando não existe.
function _gtMontarTabela(wrap) {
  const alvo = wrap.querySelector('[data-gt-tabela]')
  if (!alvo) return
  const linhas = _gtPontos(wrap).map(_gtTexto).filter(Boolean)
  if (!linhas.length) { alvo.remove(); return }

  const partido = linhas.map(t => {
    const i = t.indexOf('—')
    return i === -1 ? [t, ''] : [t.slice(0, i).trim(), t.slice(i + 1).trim()]
  })
  const temDuas = partido.some(p => p[1])
  const corpo = partido.map(p => temDuas
    ? `<tr><td>${_gtEsc(p[0])}</td><td>${_gtEsc(p[1])}</td></tr>`
    : `<tr><td>${_gtEsc(p[0])}</td></tr>`).join('')
  const cab = temDuas ? '<tr><th>Item</th><th>Valor</th></tr>' : '<tr><th>Item</th></tr>'

  alvo.outerHTML = `<details class="gt-tabela">
  <summary>Ver como tabela (${linhas.length})</summary>
  <div class="gt-tabela-wrap"><table><thead>${cab}</thead><tbody>${corpo}</tbody></table></div>
</details>`
}

function _gtRemoverHalo(wrap) {
  const h = wrap.querySelector('.gt-halo')
  if (h) h.remove()
}

// Realce visual do ponto sob o cursor. Desenha um anel na posição da
// forma, em vez de mexer nos atributos dela — assim nada do desenho
// original é perdido ao sair do foco.
function _gtRealcar(wrap, el) {
  _gtRemoverHalo(wrap)
  const svg = wrap.querySelector('svg')
  if (!svg || !el) return
  let cx, cy, r
  if (el.tagName === 'circle') {
    cx = +el.getAttribute('cx'); cy = +el.getAttribute('cy')
    r = (+el.getAttribute('r') || 4) + 4
  } else {
    const b = el.getBBox()
    cx = b.x + b.width / 2; cy = b.y + b.height / 2
    r = Math.max(b.width, b.height) / 2 + 4
  }
  if (!isFinite(cx) || !isFinite(cy)) return
  const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  halo.setAttribute('class', 'gt-halo')
  halo.setAttribute('cx', cx); halo.setAttribute('cy', cy); halo.setAttribute('r', r)
  halo.setAttribute('fill', 'none')
  halo.setAttribute('stroke', '#0A1A0F')
  halo.setAttribute('stroke-width', '2')
  svg.appendChild(halo)
}

function _gtIr(wrap, indice) {
  const pontos = _gtPontos(wrap)
  if (!pontos.length) return
  const i = Math.max(0, Math.min(pontos.length - 1, indice))
  wrap.dataset.gtIndice = String(i)
  _gtRealcar(wrap, pontos[i])
  const live = wrap.querySelector('.gt-live')
  if (live) live.textContent = `${i + 1} de ${pontos.length}. ${_gtTexto(pontos[i])}`
}

// Delegação em document, não um Aplicar(root) por página: os gráficos
// são remontados a cada troca de filtro (innerHTML novo), e um handler
// por instância exigiria lembrar de rechamá-lo em todo ponto de render.
function _gtInstalar() {
  if (window._gtInstalado) return
  window._gtInstalado = true
  _gtInjetarEstilo()

  document.addEventListener('focusin', ev => {
    const svgBox = ev.target.closest && ev.target.closest('.gt-svg')
    if (!svgBox) return
    const wrap = svgBox.closest('.gt-wrap')
    if (!wrap) return
    if (!wrap.dataset.gtPronto) { wrap.dataset.gtPronto = '1'; _gtMontarTabela(wrap) }
    _gtIr(wrap, Number(wrap.dataset.gtIndice) || 0)
  })

  document.addEventListener('focusout', ev => {
    const svgBox = ev.target.closest && ev.target.closest('.gt-svg')
    if (svgBox) _gtRemoverHalo(svgBox.closest('.gt-wrap'))
  })

  document.addEventListener('keydown', ev => {
    const svgBox = ev.target.closest && ev.target.closest('.gt-svg')
    if (!svgBox) return
    const wrap = svgBox.closest('.gt-wrap')
    if (!wrap) return
    const total = _gtPontos(wrap).length
    if (!total) return
    const atual = Number(wrap.dataset.gtIndice) || 0
    let destino = null
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') destino = atual + 1
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') destino = atual - 1
    else if (ev.key === 'Home') destino = 0
    else if (ev.key === 'End') destino = total - 1
    if (destino === null) return
    ev.preventDefault()      // seta dentro do gráfico não rola a página
    _gtIr(wrap, destino)
  })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _gtInstalar)
  } else {
    _gtInstalar()
  }
}

if (typeof window !== 'undefined') {
  window.graficoTecladoEnvolver = graficoTecladoEnvolver
}
