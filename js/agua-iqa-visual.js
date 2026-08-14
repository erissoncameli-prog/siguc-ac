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

const AGUA_IQA_FAIXA_COR = {
  'Ótima':   '#1D4ED8',
  'Boa':     '#059669',
  'Regular': '#CA8A04',
  'Ruim':    '#C2410C',
  'Péssima': '#9F1239',
}

// Classes badge-* de css/global.css — só usável em telas de mesa que
// carregam global.css (agua-mapa.html). O app de campo (agua-app.html)
// não carrega global.css e usa a cor direto (ver aguaIqaBadgeInlineHTML).
const AGUA_IQA_FAIXA_BADGE = {
  'Ótima':   'badge-blue',
  'Boa':     'badge-verde',
  'Regular': 'badge-ouro',
  'Ruim':    'badge-erro badge-outline',
  'Péssima': 'badge-erro',
}

const AGUA_SEM_IQA_COR = '#9CA3AF'

// "2022 · 1ª" (curto, chip/eixo) ou "2022 · 1ª campanha" (longo, título)
function aguaCampanhaLabel(ano, ordem, curto) {
  const o = ordem === 'segunda' ? '2ª' : '1ª'
  return curto ? `${ano}·${o}` : `${ano} · ${o}${curto === false ? ' campanha' : ''}`
}

// Chip/badge autocontido (cor direta, sem depender de global.css) —
// para o app de campo. `fb` = texto de fallback quando faixa é nula.
function aguaIqaChipHTML(iqa, faixa, fb) {
  if (iqa == null || !faixa) {
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:${AGUA_SEM_IQA_COR}">
      <span style="width:9px;height:9px;border-radius:50%;background:${AGUA_SEM_IQA_COR}"></span>${fb || 'Sem índice'}</span>`
  }
  const cor = AGUA_IQA_FAIXA_COR[faixa] || AGUA_SEM_IQA_COR
  return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:${cor}">
    <span style="width:9px;height:9px;border-radius:50%;background:${cor}"></span>${Number(iqa).toFixed(0)} · ${faixa}</span>`
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
    return `<circle cx="${x(i)}" cy="${y(p.iqa)}" r="5" fill="${cor}" stroke="#fff" stroke-width="1.5"/>`
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

  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Gráfico de IQA por campanha">
      ${grade}${linhas}${pontosSvg}${rotulos}
    </svg>
    <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:4px">${legenda}</div>`
}
