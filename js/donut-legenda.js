// ── Donut + legenda — molde único, reutilizado por dashboards que
// mostram uma categoria dividida em N fatias (label + valor + cor).
// Extraído do renderDonut() que existia só em dashboard-executivo.html
// — mesma lição do js/frota-consumo.js: nunca reimplementar por página.
// Não usado por pages/mapa.html: o donut do painel-resumo (_rsDonut)
// é especializado (sempre 2 segmentos dentro/fora de UC, com gap entre
// arcos e aria-label próprio) e aquela página é sensível demais para
// trocar sua peça de gráfico "por fora".

function donutLegendaHTML(itens, opts) {
  opts = opts || {}
  const total = itens.reduce((s, i) => s + (Number(i.n) || 0), 0)
  if (!total) return `<p style="font-size:12px;color:#9CA3AF;padding:20px 0">${opts.vazio || 'Sem dados'}</p>`

  const r = 40, cx = 50, cy = 50
  let ang = -90
  const paths = itens.map(item => {
    if (!item.n) return ''
    const pct = item.n / total
    const a1  = ang * Math.PI / 180
    ang += pct * 360
    const a2  = ang * Math.PI / 180
    const large = pct > 0.5 ? 1 : 0
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2)
    return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${item.cor}"/>`
  }).join('')

  return `
<div class="donut-legenda-wrap">
  <svg width="118" height="118" viewBox="0 0 100 100" style="flex-shrink:0">
    ${paths}
    <circle cx="50" cy="50" r="24" fill="#fff"/>
    <text x="50" y="55" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="18" font-weight="800" fill="#111827">${total}</text>
    ${opts.centroSub ? `<text x="50" y="66" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="6.5" fill="#9CA3AF">${esc(opts.centroSub)}</text>` : ''}
  </svg>
  <div class="donut-legenda-lista">
    ${itens.map(i => `
    <div class="donut-legenda-item">
      <span class="donut-legenda-dot" style="background:${i.cor}"></span>
      <span class="donut-legenda-label">${esc(i.label)}</span>
      <span class="donut-legenda-valor">${i.n}</span>
      <span class="donut-legenda-pct">${(i.n / total * 100).toFixed(1).replace('.', ',')}%</span>
    </div>`).join('')}
  </div>
</div>`
}
