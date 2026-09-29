// ═══════════════════════════════════════════════════════════════════
// chart-rosca-rotulos.js — número e percentual escritos NA rosca/pizza
// (Chart.js v4), mais o total no centro da rosca.
//
// Antes o valor só existia no tooltip (hover/clique): quem lia o
// relatório impresso ou o PDF do Painel (que copia o canvas via
// toBase64Image) via fatias sem número nenhum. O rótulo é desenhado no
// próprio canvas, então vai para o PDF junto.
//
// Uso: `roscaRotulosAplicar(cfg, { centro: 'ninhos' })` antes do
// `new Chart(...)`. Só age em type 'doughnut'/'pie'.
//   - Fatia com menos de ROSCA_MIN_FRACAO do total fica SEM texto (não
//     cabe e embolaria com a vizinha) — o número e o percentual dela
//     continuam na legenda, que sempre traz "rótulo — n (p%)".
//   - Centro (só rosca, nunca pizza): total em DM Sans — regra do
//     sistema: número de KPI nunca em Fraunces.
//   - Cor do texto pela luminância da fatia (escuro em fatia clara).
// ═══════════════════════════════════════════════════════════════════

const ROSCA_MIN_FRACAO = 0.04

function roscaFmtNum(n) {
  return Number(n || 0).toLocaleString('pt-BR')
}

// 53 → "53%"; 4,2 → "4,2%"; 0,21 → "0,2%"; >0 mas <0,1 → "<0,1%";
// 99,8 → "99,8%" (nunca "100%" enquanto sobra fatia).
function roscaFmtPct(valor, total) {
  if (!total || !valor) return '0%'
  const p = 100 * valor / total
  if (p < 0.1) return '<0,1%'
  // ≥ 99,5% com sobra: nunca "100%" enquanto existe outra fatia.
  if (p >= 10 && (p < 99.5 || valor >= total)) return Math.round(p) + '%'
  return p.toFixed(1).replace('.', ',').replace(',0', '') + '%'
}

function _roscaCorTexto(bg) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(bg || ''))
  if (!m) return '#fff'
  const h = m[1]
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.4 ? '#111827' : '#fff'
}

const roscaRotulosPlugin = {
  id: 'roscaRotulos',
  afterDatasetsDraw(chart, _args, opts) {
    const ds = chart.data.datasets[0]
    const meta = chart.getDatasetMeta(0)
    if (!ds || !meta || !meta.data.length) return
    const dados = ds.data.map(x => Number(x) || 0)
    const total = dados.reduce((s, x) => s + x, 0)
    const { ctx } = chart
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (total) {
      meta.data.forEach((arc, i) => {
        if (!dados[i] || dados[i] / total < ROSCA_MIN_FRACAO) return
        if (meta.data[i].hidden || !chart.getDataVisibility(i)) return
        const { x, y } = arc.tooltipPosition()
        const bg = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor
        ctx.fillStyle = _roscaCorTexto(bg)
        ctx.font = '700 12px "DM Sans", sans-serif'
        ctx.fillText(roscaFmtNum(dados[i]), x, y - 7)
        ctx.font = '500 11px "DM Sans", sans-serif'
        ctx.fillText(roscaFmtPct(dados[i], total), x, y + 7)
      })
    }

    if (opts && opts.centro && chart.config.type === 'doughnut') {
      const arc0 = meta.data[0]
      if (arc0) {
        ctx.fillStyle = opts.corCentro || '#111827'
        ctx.font = '700 18px "DM Sans", sans-serif'
        ctx.fillText(roscaFmtNum(total), arc0.x, arc0.y - 7)
        ctx.fillStyle = '#6B7280'
        ctx.font = '500 11px "DM Sans", sans-serif'
        ctx.fillText(opts.centro, arc0.x, arc0.y + 11)
      }
    }
    ctx.restore()
  }
}

// Legenda "Rótulo — 1.234 (53%)": garante número e percentual também
// para a fatia pequena demais para ter texto dentro.
function _roscaLegendaLabels(chart) {
  const base = (Chart.overrides[chart.config.type] || Chart.overrides.doughnut)
    .plugins.legend.labels.generateLabels(chart)
  const dados = (chart.data.datasets[0]?.data || []).map(x => Number(x) || 0)
  const total = dados.reduce((s, x) => s + x, 0)
  return base.map(l => ({
    ...l,
    text: `${l.text} — ${roscaFmtNum(dados[l.index])} (${roscaFmtPct(dados[l.index], total)})`
  }))
}

function roscaRotulosAplicar(cfg, opcoes = {}) {
  if (!cfg || (cfg.type !== 'doughnut' && cfg.type !== 'pie')) return cfg
  cfg.plugins = [...(cfg.plugins || []), roscaRotulosPlugin]
  cfg.options = cfg.options || {}
  cfg.options.plugins = cfg.options.plugins || {}
  cfg.options.plugins.roscaRotulos = { ...(cfg.options.plugins.roscaRotulos || {}), ...opcoes }
  const leg = cfg.options.plugins.legend = cfg.options.plugins.legend || {}
  leg.labels = { ...(leg.labels || {}), generateLabels: _roscaLegendaLabels }
  return cfg
}
