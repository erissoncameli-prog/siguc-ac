// ── SIGUC-AC · Moldura cartográfica dos relatórios ───────────────────
// Fonte ÚNICA dos elementos de mapa impresso (mesma lição de
// js/frota-consumo.js): norte, barra de escala, bloco de referência,
// legenda, grade UTM e fundo de satélite. Usada pelos três relatórios com
// mapa — relatório do imóvel CAR (js/relatorio-car.js), impressão do Mapa
// das UCs (js/mapa-cartografia.js) e CAR na UC (js/car-uc-mapa.js). Antes
// cada um tinha a sua seta, a sua escala e o seu texto de referência, e
// eles divergiam (um dizia "1:50.000", o outro tinha barra; um dizia
// WGS 84, o outro SIRGAS 2000).
//
// Regras que valem para todo mapa daqui:
//  - escala é sempre BARRA GRÁFICA. Escala numérica ("1:50.000") só vale
//    num tamanho de impressão: no PDF ampliado ou na folha reduzida ela
//    mente, a barra não.
//  - texto em DM Sans, igual ao resto do relatório.
//  - referência diz a verdade sobre o desenho: os mapas são exibidos em
//    Web Mercator (é a projeção dos ladrilhos) sobre dados SIRGAS 2000; a
//    grade, quando há, é UTM SIRGAS 2000 da zona do recorte.
//  - fundo padrão = satélite Esri World Imagery (responde com CORS, então
//    entra também no PDF), com a opção "sem fundo". O crédito vai junto.

const MOLD_FONTE = 'DM Sans,Arial,sans-serif'
const MOLD_SATELITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const MOLD_SATELITE_CREDITO = 'Imagem de fundo: Esri World Imagery (Esri, Maxar, Earthstar Geographics)'
const MOLD_SEM_FUNDO_COR = '#EEF1EA'

function moldEsc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function moldDataEmissao(d = new Date()) {
  return d.toLocaleDateString('pt-BR')
}

// ── Referência ───────────────────────────────────────────────────────
function moldUtmZona(lon) { return Math.floor((Number(lon) + 180) / 6) + 1 }
function moldEpsgUtm(zona) { return 31960 + zona }   // SIRGAS 2000 / UTM Sul: 18S = 31978, 19S = 31979

// Uma frase só, a mesma em todo mapa. Com zona = há grade UTM no mapa.
function moldReferencia(zona) {
  return zona
    ? `Datum SIRGAS 2000 · grade UTM ${zona}S (EPSG:${moldEpsgUtm(zona)}, km) · exibição Web Mercator`
    : 'Datum SIRGAS 2000 · exibição Web Mercator (EPSG:3857)'
}

// ── Norte ────────────────────────────────────────────────────────────
// Seta de norte (mapa em Web Mercator é norte para cima, sem rotação).
// `g` posiciona pelo centro da seta; `svg` é a versão solta para HTML.
function moldNorteG(x, y, cor = '#0A1A0F', halo = null) {
  const h = halo ? ` stroke="${halo}" stroke-width="1.6" paint-order="stroke"` : ''
  return `<g transform="translate(${x},${y})" aria-label="Norte"><path d="M0,-13 L7,7 L0,3 L-7,7 Z" fill="${cor}"${h}/>`
    + `<path d="M0,-13 L0,3 L-7,7 Z" fill="${cor}" opacity=".55"/>`
    + `<text y="20" text-anchor="middle" font-size="10" font-weight="700" font-family="${MOLD_FONTE}" fill="${cor}"${h}>N</text></g>`
}
function moldNorteSVG(cor = '#0A1A0F') {
  return `<svg viewBox="-12 -16 24 40" width="20" height="32" role="img" aria-label="Norte">${moldNorteG(0, 0, cor)}</svg>`
}

// ── Barra de escala ──────────────────────────────────────────────────
// Comprimento "redondo" (1, 2, 5 × 10^n) perto de `alvoPx`.
function moldEscalaMedida(mPorPx, alvoPx = 80) {
  if (!(mPorPx > 0)) return null
  const alvo = mPorPx * alvoPx
  const p10 = Math.pow(10, Math.floor(Math.log10(alvo)))
  const m = [1, 2, 5, 10].map(k => k * p10).reduce((a, b) => Math.abs(b - alvo) < Math.abs(a - alvo) ? b : a)
  return { metros: m, px: m / mPorPx, rotulo: moldDistancia(m) }
}
function moldDistancia(m) {
  return m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR')} km` : `${m.toLocaleString('pt-BR')} m`
}

// Barra em dois segmentos alternados (padrão cartográfico), com 0, meio e
// total rotulados. `x,y` = canto inferior esquerdo da barra.
function moldEscalaG(x, y, mPorPx, cor = '#0A1A0F', fundo = '#FFFFFF', alvoPx = 80, halo = null) {
  const e = moldEscalaMedida(mPorPx, alvoPx)
  if (!e) return ''
  const meio = e.px / 2
  const h = halo ? ` stroke="${halo}" stroke-width="2.4" paint-order="stroke"` : ''
  const t = (tx, txt, ancora) => `<text x="${tx.toFixed(1)}" y="-6" text-anchor="${ancora}" font-size="9" font-family="${MOLD_FONTE}" fill="${cor}"${h}>${txt}</text>`
  return `<g transform="translate(${x},${y})" aria-label="Escala ${moldEsc(e.rotulo)}">`
    + `<rect x="0" y="-4" width="${meio.toFixed(1)}" height="4" fill="${cor}"/>`
    + `<rect x="${meio.toFixed(1)}" y="-4" width="${meio.toFixed(1)}" height="4" fill="${fundo}" stroke="${cor}" stroke-width=".8"/>`
    // O meio sai na MESMA unidade do total (com 1 km, o meio é "0,5", nunca "500").
    // Números CENTRADOS nas marcas (0, meio, total) e a unidade à direita
    // da barra — com o total alinhado pelo fim, "10" e "20 km" se encostavam.
    + t(0, '0', 'middle') + t(meio, (e.metros >= 1000 ? e.metros / 2000 : e.metros / 2).toLocaleString('pt-BR'), 'middle')
    + t(e.px, (e.metros >= 1000 ? e.metros / 1000 : e.metros).toLocaleString('pt-BR'), 'middle')
    + `<text x="${(e.px + 6).toFixed(1)}" y="0" font-size="9" font-family="${MOLD_FONTE}" fill="${cor}"${h}>${e.metros >= 1000 ? 'km' : 'm'}</text>`
    + '</g>'
}
function moldEscalaSVG(mPorPx, cor = '#0A1A0F', alvoPx = 80) {
  const e = moldEscalaMedida(mPorPx, alvoPx)
  if (!e) return ''
  const w = Math.ceil(e.px) + 30
  return `<svg viewBox="-8 -16 ${w} 20" width="${w}" height="20" role="img" aria-label="Escala gráfica ${moldEsc(e.rotulo)}">${moldEscalaG(0, 2, mPorPx, cor, '#FFFFFF', alvoPx)}</svg>`
}

// Metros por pixel no centro de um mapa Leaflet (medido, não estimado).
function moldMetrosPorPxLeaflet(map) {
  try {
    const t = map.getSize(), y = t.y / 2
    const a = map.containerPointToLatLng([t.x / 2 - 50, y]), b = map.containerPointToLatLng([t.x / 2 + 50, y])
    return a.distanceTo(b) / 100
  } catch { return null }
}

// ── Legenda ──────────────────────────────────────────────────────────
// item = { rotulo, cor, tipo: 'area'|'linha'|'ponto'|'contorno', tracejado?, preenchimento? }
function _moldAmostraSVG(it) {
  const tr = it.tracejado ? ' stroke-dasharray="4 3"' : ''
  // halo = traço escuro por baixo (linha branca/clara sobre a legenda clara)
  const sob = it.halo ? `<line x1="1" y1="6" x2="15" y2="6" stroke="${it.halo}" stroke-width="4.2"/>` : ''
  if (it.tipo === 'linha') return `${sob}<line x1="1" y1="6" x2="15" y2="6" stroke="${it.cor}" stroke-width="2.2"${tr}/>`
  if (it.tipo === 'ponto') return `<circle cx="8" cy="6" r="4" fill="${it.cor}" stroke="#fff" stroke-width="1"/>`
  if (it.tipo === 'contorno') return (it.halo ? `<rect x="1.5" y="1.5" width="13" height="9" fill="none" stroke="${it.halo}" stroke-width="3.6"/>` : '')
    + `<rect x="1.5" y="1.5" width="13" height="9" fill="none" stroke="${it.cor}" stroke-width="1.8"${tr}/>`
  return `<rect x="1.5" y="1.5" width="13" height="9" fill="${it.preenchimento || it.cor}" fill-opacity="${it.preenchimento ? 1 : .45}" stroke="${it.cor}" stroke-width="1.2"${tr}/>`
}
function moldLegendaHTML(itens) {
  return (itens || []).map(it => `<span class="mold-leg-item"><svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true">${_moldAmostraSVG(it)}</svg>${moldEsc(it.rotulo)}</span>`).join('')
}

// Faixa de rodapé em SVG (legenda + referência + crédito + data) — para o
// CAR na UC, onde a tela mostra e o PDF rasteriza o MESMO desenho.
// Quebra a legenda em linhas pela largura disponível.
function moldRodapeSVG({ largura, itens, linhas }) {
  const M = 8, ALT_ITEM = 16, ALT_LINHA = 12
  let x = M, y = M + 10, s = ''
  const larg = it => 22 + it.rotulo.length * 5.2 + 14
  for (const it of itens || []) {
    if (x + larg(it) > largura - M && x > M) { x = M; y += ALT_ITEM }
    s += `<g transform="translate(${x.toFixed(1)},${(y - 9).toFixed(1)})">${_moldAmostraSVG(it)}</g>`
      + `<text x="${(x + 20).toFixed(1)}" y="${y.toFixed(1)}" font-size="10" font-family="${MOLD_FONTE}" fill="#1F2937">${moldEsc(it.rotulo)}</text>`
    x += larg(it)
  }
  y += 6
  for (const l of linhas || []) {
    y += ALT_LINHA
    s += `<text x="${M}" y="${y.toFixed(1)}" font-size="9" font-family="${MOLD_FONTE}" fill="#4B5563">${moldEsc(l)}</text>`
  }
  const h = Math.ceil(y + M)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largura} ${h}" width="${largura}" height="${h}" role="img" aria-label="Legenda e referência do mapa">`
    + `<rect width="${largura}" height="${h}" fill="#F9FAFB"/>${s}</svg>`
}

// ── Grade UTM em SVG ─────────────────────────────────────────────────
// Para mapa desenhado à mão (CAR na UC). Precisa de proj4 (vendorizado em
// js/vendor/proj4-2.11.0.min.js); sem ele devolve '' — o mapa segue sem
// grade, nunca quebra. proj(lon,lat)→[x,y] e inv(x,y)→[lon,lat] são as
// funções da vista; linhas amostradas para acompanhar a curvatura.
function _moldUtmDef(z) { return `+proj=utm +zone=${z} +south +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs` }
function moldPasso(span, alvo = 4) {
  const raw = Math.max(span / alvo, 1)
  const pot = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / pot
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pot
}
function moldGradeUtmSVG({ w, h, proj, inv, zona, cor = '#FFFFFF', halo = 'rgba(0,0,0,.55)' }) {
  if (typeof proj4 === 'undefined' || !zona) return ''
  const def = _moldUtmDef(zona)
  const cantos = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => proj4('EPSG:4326', def, inv(x, y)))
  const Es = cantos.map(c => c[0]), Ns = cantos.map(c => c[1])
  const minE = Math.min(...Es), maxE = Math.max(...Es), minN = Math.min(...Ns), maxN = Math.max(...Ns)
  const passo = Math.max(moldPasso(maxE - minE), moldPasso(maxN - minN))
  const AM = 16
  const px = (e, n) => { const ll = proj4(def, 'EPSG:4326', [e, n]); return proj(ll[0], ll[1]) }
  const km = m => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  const rot = (x, y, txt, ancora, base) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${ancora}" dominant-baseline="${base}" font-size="8" font-family="${MOLD_FONTE}" fill="${cor}" stroke="${halo}" stroke-width="2.2" paint-order="stroke">${txt}</text>`
  let linhas = '', rots = ''
  for (let e = Math.ceil(minE / passo) * passo; e <= maxE; e += passo) {
    const pts = []
    for (let k = 0; k <= AM; k++) pts.push(px(e, minN + (maxN - minN) * k / AM))
    linhas += `<path d="${pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('')}"/>`
    const topo = pts.reduce((a, b) => (b[1] < a[1] ? b : a))
    if (topo[0] > 14 && topo[0] < w - 14) rots += rot(topo[0], 3, km(e), 'middle', 'hanging')
  }
  for (let n = Math.ceil(minN / passo) * passo; n <= maxN; n += passo) {
    const pts = []
    for (let k = 0; k <= AM; k++) pts.push(px(minE + (maxE - minE) * k / AM, n))
    linhas += `<path d="${pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('')}"/>`
    const esq = pts.reduce((a, b) => (b[0] < a[0] ? b : a))
    if (esq[1] > 14 && esq[1] < h - 24) rots += rot(3, esq[1], km(n), 'start', 'middle')
  }
  return `<g aria-hidden="true"><g fill="none" stroke="${cor}" stroke-width=".7" stroke-dasharray="3 4" opacity=".75">${linhas}</g>${rots}</g>`
}

if (typeof module !== 'undefined') {
  module.exports = {
    MOLD_SATELITE_URL, MOLD_SATELITE_CREDITO, moldEsc, moldReferencia, moldUtmZona, moldEpsgUtm,
    moldEscalaMedida, moldDistancia, moldEscalaG, moldEscalaSVG, moldNorteG, moldNorteSVG,
    moldLegendaHTML, moldRodapeSVG, moldGradeUtmSVG, moldPasso,
  }
}
