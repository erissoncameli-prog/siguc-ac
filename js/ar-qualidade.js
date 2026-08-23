// ── SIGUC · Qualidade do Ar — rótulos, cor e gráfico de série ──────
// Mesma lição de js/rh-hidro.js/js/frota-consumo.js: cálculo e desenho
// em UM lugar, nunca reimplementado na página.
//
// NENHUMA classificação por faixa (tipo IQAr) é feita aqui de
// propósito — a Resolução CONAMA Nº 506/2024 define um índice oficial,
// mas as faixas numéricas dela não puderam ser confirmadas nesta
// entrega (os domínios com o texto da resolução estavam bloqueados na
// política de rede desta sessão). Mesma disciplina do resto do
// projeto: nunca gravar/exibir uma classificação que não foi
// verificada contra a fonte oficial. O sistema mostra o NÚMERO bruto
// e usa como única referência a diretriz da OMS já citada em todo o
// resto do sistema (média diária ≤ 15 µg/m³) — texto, nunca cor
// "boa/ruim" inventada. Quando alguém confirmar as faixas da 506/2024
// contra o documento oficial, entram aqui, num lugar só.

const AR_OMS_LIMITE_24H = 15 // µg/m³ — mesma referência já citada nos boletins

function arPm25Txt(v) {
  return (v == null || !isFinite(v)) ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} µg/m³`
}

// Só duas cores — dentro/acima da referência OMS — nunca uma escala de
// muitas faixas sem fonte confirmada. `--sucesso`/`--erro` do design
// system, mesmo par usado no resto do projeto para bom/ruim binário.
function arPm25Cor(v) {
  if (v == null || !isFinite(v)) return '#9CA3AF'
  return Number(v) <= AR_OMS_LIMITE_24H ? '#059669' : '#DC2626'
}
function arPm25Situacao(v) {
  if (v == null || !isFinite(v)) return 'Sem leitura'
  return Number(v) <= AR_OMS_LIMITE_24H ? 'Dentro da referência OMS' : 'Acima da referência OMS'
}

function _arEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ── Resumo (KPIs da tela) ───────────────────────────────────────
// Puro. `sensores`: linhas de vw_ar_sensores_atual.
function arResumoSensores(sensores) {
  const lista = (sensores || []).filter(s => s.pm25_bruto != null)
  const acima = lista.filter(s => Number(s.pm25_bruto) > AR_OMS_LIMITE_24H)
  const media = lista.length ? lista.reduce((s, x) => s + Number(x.pm25_bruto), 0) / lista.length : null
  const pior = lista.length ? lista.reduce((a, b) => Number(b.pm25_bruto) > Number(a.pm25_bruto) ? b : a) : null
  return {
    total: (sensores || []).length,
    comLeitura: lista.length,
    media,
    acima: acima.length,
    pior,
  }
}

// ── Série de um sensor (linha simples) ──────────────────────────
// `leituras`: [{ data_hora, pm25_bruto }] em ordem cronológica.
function arSerieHTML(leituras, opts) {
  const o = Object.assign({ width: 720, height: 220 }, opts || {})
  const dados = (leituras || []).filter(l => l && l.data_hora && l.pm25_bruto != null)
  if (!dados.length) {
    return '<p style="text-align:center;color:#9CA3AF;font-size:13px;padding:32px 0">Sem leituras no período selecionado</p>'
  }
  const PAD_L = 40, PAD_R = 16, PAD_T = 14, PAD_B = 24
  const w = o.width, h = o.height
  const plotW = w - PAD_L - PAD_R, plotH = h - PAD_T - PAD_B

  const valores = dados.map(l => Number(l.pm25_bruto))
  const vMax = Math.max(AR_OMS_LIMITE_24H, ...valores) * 1.15
  const t0 = new Date(dados[0].data_hora).getTime()
  const t1 = new Date(dados[dados.length - 1].data_hora).getTime()
  const x = ts => (t1 === t0) ? PAD_L + plotW / 2 : PAD_L + plotW * ((new Date(ts).getTime() - t0) / (t1 - t0))
  const y = v => PAD_T + plotH * (1 - v / vMax)

  const linha = dados.map(l => `${x(l.data_hora).toFixed(1)},${y(Number(l.pm25_bruto)).toFixed(1)}`).join(' ')
  const yOms = y(AR_OMS_LIMITE_24H)

  const fmtData = ts => {
    const d = new Date(ts)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const rotulosX = [dados[0], dados[Math.floor(dados.length / 2)], dados[dados.length - 1]]
    .map((l, i, arr) => `<text x="${x(l.data_hora).toFixed(1)}" y="${h - 6}" font-size="9" fill="#9CA3AF"
      text-anchor="${i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}">${fmtData(l.data_hora)}</text>`).join('')

  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="PM2.5 ao longo do período, em µg/m³">
      <line x1="${PAD_L}" y1="${yOms.toFixed(1)}" x2="${w - PAD_R}" y2="${yOms.toFixed(1)}"
        stroke="#DC2626" stroke-width="1.2" stroke-dasharray="5 4" opacity=".7"/>
      <text x="${w - PAD_R}" y="${(yOms - 3).toFixed(1)}" font-size="9" fill="#DC2626" text-anchor="end">Referência OMS (${AR_OMS_LIMITE_24H} µg/m³)</text>
      <polyline points="${linha}" fill="none" stroke="#164070" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${rotulosX}
      <text x="${PAD_L - 4}" y="${PAD_T}" font-size="8.5" fill="#9CA3AF" text-anchor="end">µg/m³</text>
    </svg>`
}

function arCsvSerie(leituras, sensorNome) {
  const cab = ['Sensor', 'Data/hora', 'PM2.5 bruto (µg/m³)', 'Umidade (%)', 'Temperatura (°C)']
  const linhas = (leituras || []).map(l => [
    sensorNome, new Date(l.data_hora).toLocaleString('pt-BR'),
    l.pm25_bruto, l.umidade_pct, l.temperatura_c,
  ])
  const txt = [cab, ...linhas].map(l => l.map(c => {
    const s = c == null ? '' : String(c)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(';')).join('\r\n')
  return '﻿' + txt
}

function arBaixarCsv(conteudo, nomeArquivo) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nomeArquivo
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
