// ── SIGUC Qualidade da Água — cores e gráfico do IQA por faixa ──
// Definição única das 5 cores de faixa do IQA (Ótima/Boa/Regular/Ruim/
// Péssima) e do gráfico de linha por campanha — reaproveitado por
// pages/agua-mapa.html (mesa) e pages/agua-app.html (campo). Mesma
// lição de js/frota-consumo.js/js/mapa-recorte.js: cálculo/gráfico
// mora em UM lugar, nunca reimplementado numa tela.
//
// PALETA CORRIGIDA NESTA ENTREGA — a de agua-mapa.html (herdada sem
// checagem) falhava no validador de daltonismo do skill de dataviz:
// Ruim (#EA580C) e Regular (#CA8A04) tinham ΔE 2,9 sob deuteranopia
// (limite mínimo é 6) e ΔE 11,7 mesmo para visão normal (piso é 15) —
// literalmente indistinguíveis para quem tem a forma mais comum de
// daltonismo. A escala nova mantém a ordem intuitiva pior→melhor
// (vermelho→laranja→âmbar→verde→azul) com mais separação de matiz e
// luminância; ainda assim NUNCA usar só a cor — sempre rótulo de texto
// junto (regra do projeto, reforçada pelo guia do skill de dataviz
// para paletas de status: "a status color never carries meaning
// alone").

const AGUA_IQA_FAIXA_ORDEM = ['Ótima', 'Boa', 'Regular', 'Ruim', 'Péssima']

// PÉSSIMA CORRIGIDA (painel de relatórios): #9F1239 ↔ Ruim (#C2410C)
// dava ΔE 12,3 para visão NORMAL — abaixo do piso 15 do validador do
// skill de dataviz, ou seja, duas faixas vizinhas da MESMA escala que
// um leitor sem daltonismo custa a separar (o problema só apareceu
// agora porque o painel põe as 5 faixas lado a lado numa barra
// segmentada; no mapa e no app elas nunca se encostavam). #86198F
// mantém a leitura pior→melhor e passa os 5 checks
// (scripts/validate_palette.js do skill, modo light).
const AGUA_IQA_FAIXA_COR = {
  'Ótima':   '#1D4ED8',
  'Boa':     '#059669',
  'Regular': '#CA8A04',
  'Ruim':    '#C2410C',
  'Péssima': '#86198F',
}

// Classes badge-* de css/global.css — só usável em telas de mesa que
// carregam global.css (agua-mapa.html). O app de campo (agua-app.html)
// não carrega global.css e usa a cor direto (ver aguaIqaBadgeInlineHTML).
const AGUA_IQA_FAIXA_BADGE = {
  'Ótima':   'badge-blue',
  'Boa':     'badge-verde',
  'Regular': 'badge-ouro',
  'Ruim':    'badge-erro badge-outline',
  'Péssima': 'badge-roxo', // acompanha a cor nova de AGUA_IQA_FAIXA_COR (badge e marcador nunca podem discordar na mesma tela)
}

const AGUA_SEM_IQA_COR = '#9CA3AF'

// "2022 · 1ª" (curto, chip/eixo) ou "2022 · 1ª campanha" (longo, título)
function aguaCampanhaLabel(ano, ordem, curto) {
  const o = ordem === 'segunda' ? '2ª' : '1ª'
  return curto ? `${ano}·${o}` : `${ano} · ${o}${curto === false ? ' campanha' : ''}`
}

// Chip/badge autocontido (cor direta, sem depender de global.css) —
// para o app de campo. `fb` = texto de fallback quando faixa é nula.
// `provisorio` = coleta ainda em quarentena (mesma cautela do mapa:
// mostra o dado, mas visualmente distinto de um laudo já conferido —
// nunca esconde, nunca finge que é definitivo).
function aguaIqaChipHTML(iqa, faixa, fb, provisorio) {
  if (iqa == null || !faixa) {
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:${AGUA_SEM_IQA_COR}">
      <span style="width:9px;height:9px;border-radius:50%;background:${AGUA_SEM_IQA_COR}"></span>${fb || 'Sem índice'}</span>`
  }
  const cor = AGUA_IQA_FAIXA_COR[faixa] || AGUA_SEM_IQA_COR
  return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:${cor};opacity:${provisorio ? .65 : 1}">
    <span style="width:9px;height:9px;border-radius:50%;background:${cor}"></span>${Number(iqa).toFixed(0)} · ${faixa}${provisorio ? ' · em conferência' : ''}</span>`
}

// ── Gráfico de linha do IQA por campanha (SVG desenhado à mão — o
// projeto não tem lib de gráfico, mesmo padrão do painel-resumo de
// pages/mapa.html) ──────────────────────────────────────────────
// `pontos`: [{ label, iqa, faixa }] já ordenados no tempo. IQA nulo
// (piso de peso da agua_calcular_iqa — dado insuficiente) quebra a
// linha nesse ponto em vez de interpolar por cima de um vazio.
// Devolve HTML pronto (SVG + legenda) — sem interação de hover/tap
// complexa: a lista de texto que acompanha o gráfico (chamador monta)
// já cobre a leitura acessível ponto a ponto.
function aguaIqaGraficoHTML(pontos, opts) {
  const o = Object.assign({ width: 320, height: 170 }, opts || {})
  const PAD_L = 26, PAD_R = 10, PAD_T = 12, PAD_B = 26
  const w = o.width, h = o.height
  const plotW = w - PAD_L - PAD_R, plotH = h - PAD_T - PAD_B
  const n = pontos.length

  if (!n) return '<p style="text-align:center;color:#9CA3AF;font-size:13px;padding:24px 0">Sem coletas com IQA calculado neste ponto ainda</p>'

  const x = i => n === 1 ? PAD_L + plotW / 2 : PAD_L + (plotW * i) / (n - 1)
  const y = v => PAD_T + plotH * (1 - Math.max(0, Math.min(100, v)) / 100)

  // Grade horizontal recessiva (0/25/50/75/100)
  const grade = [0, 25, 50, 75, 100].map(v => `
    <line x1="${PAD_L}" y1="${y(v)}" x2="${w - PAD_R}" y2="${y(v)}" stroke="#E5E7EB" stroke-width="1"/>
    <text x="${PAD_L - 6}" y="${y(v) + 3}" font-size="9" fill="#9CA3AF" text-anchor="end" font-family="var(--font-mono,monospace)">${v}</text>`).join('')

  // Segmentos de linha, quebrando em pontos sem IQA (nunca interpola
  // por cima de um vazio — mesmo espírito do "ponto vazado" do mapa).
  let segmentos = [], atual = []
  pontos.forEach((p, i) => {
    if (p.iqa == null) { if (atual.length > 1) segmentos.push(atual); atual = []; return }
    atual.push(`${x(i)},${y(p.iqa)}`)
  })
  if (atual.length > 1) segmentos.push(atual)
  const linhas = segmentos.map(seg =>
    `<polyline points="${seg.join(' ')}" fill="none" stroke="#94A3B8" stroke-width="2" stroke-linecap="round"/>`).join('')

  const pontosSvg = pontos.map((p, i) => {
    if (p.iqa == null) {
      // Vazado — mesmo tratamento visual do mapa para "sem índice"
      return `<circle cx="${x(i)}" cy="${y(50)}" r="4" fill="none" stroke="${AGUA_SEM_IQA_COR}" stroke-width="1.5" stroke-dasharray="2,2"/>`
    }
    const cor = AGUA_IQA_FAIXA_COR[p.faixa] || AGUA_SEM_IQA_COR
    // Preenchimento fraco = quarentena (ainda em conferência), mesmo
    // limiar 0,5 de agua-mapa.html — nunca esconder o dado, só marcar
    // que não é definitivo.
    const fillOpacity = p.status === 'quarentena' ? .5 : 1
    return `<circle cx="${x(i)}" cy="${y(p.iqa)}" r="5" fill="${cor}" fill-opacity="${fillOpacity}" stroke="#fff" stroke-width="1.5"/>`
  }).join('')

  // Rótulos do eixo X — só a cada N para não amontoar em telas
  // estreitas (mesmo problema que o eixo temporal de agua-mapa.html
  // evita usando campanha por índice, não data contínua).
  const passo = Math.max(1, Math.ceil(n / 6))
  const rotulos = pontos.map((p, i) => (i % passo !== 0 && i !== n - 1) ? '' : `
    <text x="${x(i)}" y="${h - 8}" font-size="9" fill="#9CA3AF" text-anchor="middle">${p.label}</text>`).join('')

  const legenda = AGUA_IQA_FAIXA_ORDEM.map(f => `
    <span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#6B7280">
      <span style="width:8px;height:8px;border-radius:50%;background:${AGUA_IQA_FAIXA_COR[f]}"></span>${f}</span>`).join('')

  const temQuarentena = pontos.some(p => p.status === 'quarentena')

  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Gráfico de IQA por campanha">
      ${grade}${linhas}${pontosSvg}${rotulos}
    </svg>
    <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:4px">${legenda}</div>
    ${temQuarentena ? '<p style="text-align:center;font-size:10px;color:#9CA3AF;margin-top:4px">Preenchimento fraco = ainda em conferência (dado não verificado)</p>' : ''}`
}

// ── Primitivos do painel (pages/agua-relatorios.html) ────────────
// Mesmos SVGs desenhados à mão do gráfico acima — moram aqui, e não na
// página, pelo mesmo motivo de sempre (js/frota-consumo.js): tela nova
// que precise de barra/medidor/distribuição por faixa usa estes, nunca
// remonta o desenho. Todos devolvem HTML pronto e não dependem de
// global.css (o app de campo não o carrega).
//
// Nenhum deles calcula IQA nem classifica faixa: recebem números e
// faixas JÁ vindos do banco (agua_calcular_iqa/agua_iqa_faixa,
// migration 249). Classificar a MÉDIA de um período numa faixa seria
// recalcular no cliente — por isso as barras de magnitude usam uma
// escala de UM tom só (verde institucional), não a paleta de faixa.

function _aguaHex(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function _aguaMistura(a, b, t) {
  const A = _aguaHex(a), B = _aguaHex(b)
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * Math.max(0, Math.min(1, t))))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}
function _aguaEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]))
}

// Medidor semicircular segmentado (0–100%). Sequencial de UM tom
// (magnitude, não identidade — regra do skill de dataviz): os
// segmentos preenchidos vão de verde-claro a verde-escuro; o restante
// fica cinza. O número no centro é o dado; a cor só reforça.
function aguaIqaGaugeHTML(pct, opts) {
  const o = Object.assign({
    width: 280, segmentos: 34, corDe: '#7FD4A8', corAte: '#1F4E2C',
    vazio: '#E5E7EB', rotulo: '', vazioTexto: '—',
  }, opts || {})
  const w = o.width, cx = w / 2, cy = w / 2
  const rOut = w / 2 - 6, rIn = rOut - Math.max(14, w * 0.075)
  const h = Math.round(cy + 12)
  const n = o.segmentos
  const temValor = pct != null && isFinite(pct)
  const preenchidos = temValor ? Math.round((Math.max(0, Math.min(100, pct)) / 100) * n) : 0

  let segs = ''
  for (let i = 0; i < n; i++) {
    const ang = Math.PI * ((i + 0.5) / n) + Math.PI // 180° → 360°
    const cos = Math.cos(ang), sin = Math.sin(ang)
    const cor = i < preenchidos ? _aguaMistura(o.corDe, o.corAte, n === 1 ? 1 : i / (n - 1)) : o.vazio
    segs += `<line x1="${(cx + rIn * cos).toFixed(1)}" y1="${(cy + rIn * sin).toFixed(1)}" x2="${(cx + rOut * cos).toFixed(1)}" y2="${(cy + rOut * sin).toFixed(1)}" stroke="${cor}" stroke-width="6" stroke-linecap="round"/>`
  }

  // O rótulo fica FORA do SVG, em HTML: dentro dele, o texto de 12px
  // encostava no número (que é grande e de largura variável) e ainda
  // era cortado pela viewBox em rótulo longo. Em HTML ele quebra linha
  // e centraliza sozinho.
  // `display:block` + `height:auto` no próprio SVG: sem isso ele é
  // inline (herda line-height) e a caixa fica mais alta que o desenho,
  // empurrando o rótulo para fora do contêiner.
  return `<div style="text-align:center">
    <svg viewBox="0 0 ${w} ${h}" style="display:block;width:100%;height:auto" role="img"
        aria-label="${_aguaEsc(o.rotulo || 'Medidor')}: ${temValor ? Math.round(pct) + '%' : 'sem dado'}">
      ${segs}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="'Fraunces',Georgia,serif" font-size="${Math.round(w * 0.145)}" font-weight="700" fill="#111827">${temValor ? Math.round(pct) + '%' : o.vazioTexto}</text>
    </svg>
    ${o.rotulo ? `<p style="font-size:12px;color:#6B7280;margin:-6px 0 0;line-height:1.35">${_aguaEsc(o.rotulo)}</p>` : ''}
  </div>`
}

// Barras verticais de magnitude, com o valor rotulado acima de cada
// uma (o "badge" do modelo) e a maior destacada. UMA série → sem
// legenda, por regra do skill; identidade fica no rótulo do eixo X e
// no <title> (tooltip nativo, camada de hover mínima).
// `itens`: [{ label, valor, valorTexto, titulo, fraco }] — `fraco`
// marca dado ainda em conferência (quarentena), nunca escondido.
function aguaIqaBarrasHTML(itens, opts) {
  const o = Object.assign({ max: 100, height: 210, corBase: '#CDE9DA', corTopo: '#2D6A4F', vazio: 'Sem dado' }, opts || {})
  const lista = itens || []
  if (!lista.length) return `<p style="text-align:center;color:#9CA3AF;font-size:12px;padding:28px 0">${_aguaEsc(o.vazio)}</p>`

  const larguraBarra = 52, gap = 16
  const w = lista.length * larguraBarra + (lista.length - 1) * gap
  const h = o.height, PAD_T = 34, PAD_B = 34
  const plotH = h - PAD_T - PAD_B
  const maiorValor = Math.max(...lista.map(i => (i.valor == null ? 0 : i.valor)))

  const barras = lista.map((it, i) => {
    const x = i * (larguraBarra + gap)
    const temValor = it.valor != null && isFinite(it.valor)
    const alt = temValor ? Math.max(6, (Math.max(0, Math.min(o.max, it.valor)) / o.max) * plotH) : 6
    const y = PAD_T + plotH - alt
    const destaque = temValor && it.valor === maiorValor
    const yBadge = Math.max(4, y - 26)
    const rx = Math.min(12, larguraBarra / 2)
    return `<g>
      <title>${_aguaEsc(it.titulo || it.label)}${temValor ? ' — ' + _aguaEsc(it.valorTexto) : ''}</title>
      <rect x="${x}" y="${y}" width="${larguraBarra}" height="${alt}" rx="${rx}" fill="${temValor ? (destaque ? o.corTopo : o.corBase) : '#F3F4F6'}" fill-opacity="${it.fraco ? .55 : 1}"/>
      <rect x="${x + 6}" y="${yBadge}" width="${larguraBarra - 12}" height="19" rx="9.5" fill="#F3F4F6"/>
      <text x="${x + larguraBarra / 2}" y="${yBadge + 13}" text-anchor="middle" font-family="'DM Sans',sans-serif" font-size="11" font-weight="700" fill="${temValor ? '#374151' : '#9CA3AF'}">${_aguaEsc(temValor ? it.valorTexto : '—')}</text>
      <text x="${x + larguraBarra / 2}" y="${h - 12}" text-anchor="middle" font-family="'DM Sans',sans-serif" font-size="10.5" fill="#6B7280">${_aguaEsc(it.label)}</text>
    </g>`
  }).join('')

  const temFraco = lista.some(i => i.fraco)
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMax meet"
      role="img" aria-label="Barras: ${_aguaEsc(lista.map(i => `${i.label} ${i.valorTexto || '—'}`).join(', '))}">${barras}</svg>
    ${temFraco ? '<p style="font-size:10px;color:#9CA3AF;margin-top:2px">Barra esmaecida = inclui coleta ainda em conferência</p>' : ''}`
}

// Barra horizontal segmentada da distribuição por faixa do IQA — a
// única leitura do painel em que as 5 cores de faixa aparecem juntas.
// 2px de respiro entre segmentos (spec do skill) e legenda sempre
// presente com o número ao lado: a cor nunca carrega o dado sozinha.
// `contagem`: { 'Ótima': n, ... }; `semIQA` entra como segmento cinza.
function aguaIqaFaixasBarraHTML(contagem, semIQA, opts) {
  const o = Object.assign({ altura: 14 }, opts || {})
  const itens = AGUA_IQA_FAIXA_ORDEM
    .map(f => ({ label: f, n: (contagem || {})[f] || 0, cor: AGUA_IQA_FAIXA_COR[f] }))
    .concat(semIQA ? [{ label: 'Sem índice', n: semIQA, cor: AGUA_SEM_IQA_COR }] : [])
  const total = itens.reduce((s, i) => s + i.n, 0)
  if (!total) return '<p style="font-size:12px;color:#9CA3AF;margin:8px 0">Nenhuma coleta com índice calculado no recorte.</p>'

  const segmentos = itens.filter(i => i.n > 0).map(i =>
    `<div title="${_aguaEsc(i.label)}: ${i.n} coleta(s)" style="flex:${i.n} 1 0;background:${i.cor};min-width:4px"></div>`).join('')
  const legenda = itens.filter(i => i.n > 0).map(i => `
    <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#374151">
      <span style="width:8px;height:8px;border-radius:2px;background:${i.cor}"></span>${_aguaEsc(i.label)}
      <strong style="color:#111827">${i.n}</strong></span>`).join('')

  return `<div style="display:flex;gap:2px;height:${o.altura}px;border-radius:${o.altura / 2}px;overflow:hidden;background:#F3F4F6">${segmentos}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px 14px;margin-top:10px">${legenda}</div>`
}
