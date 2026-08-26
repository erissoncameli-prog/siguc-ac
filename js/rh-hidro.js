// ── SIGUC · Recursos Hídricos — plataformas hidrometeorológicas ──
// Rótulos, cores, hidrograma e exportação em planilha das estações de
// nível/chuva. Mesma lição de js/frota-consumo.js e js/agua-iqa-visual.js:
// desenho e formatação moram em UM lugar; a página só injeta.
//
// NADA aqui classifica cota. `situacao_cota` vem pronta da view
// `vw_rh_estacoes_detalhe` (migration 306), que compara o nível com as
// cotas CADASTRADAS da estação — o cliente só rotula e colore. É a
// mesma disciplina do IQA/CONAMA na Qualidade da Água.

const RH_TIPO_LABEL = {
  fluviometrica:       'Fluviométrica (nível)',
  pluviometrica:       'Pluviométrica (chuva)',
  fluviopluviometrica: 'Fluvio-pluviométrica',
  climatologica:       'Climatológica',
  qualidade_agua:      'Qualidade da água',
}

const RH_SITUACAO_LABEL = {
  operante: 'Operante', intermitente: 'Intermitente',
  desativada: 'Desativada', planejada: 'Planejada',
}

const RH_ORIGEM_LABEL = {
  telemetria: 'Telemetria', convencional: 'Convencional',
  importacao: 'Importação', manual: 'Digitada',
}

// Escala de severidade da cota. NÃO é paleta nova: são as MESMAS
// quatro cores já validadas contra daltonismo em js/agua-iqa-visual.js
// (Boa/Regular/Ruim/Péssima), reaproveitadas na ordem normal → grave.
// Como lá, a cor NUNCA anda sozinha — sempre com rótulo de texto.
const RH_COTA_COR = {
  normal:    '#059669',
  atencao:   '#CA8A04',
  alerta:    '#C2410C',
  inundacao: '#86198F',
}
const RH_COTA_LABEL = {
  normal: 'Normal', atencao: 'Atenção', alerta: 'Alerta', inundacao: 'Inundação',
}
const RH_COTA_ORDEM = ['inundacao', 'alerta', 'atencao', 'normal']
const RH_SEM_COTA_COR = '#9CA3AF'

function rhCotaCor(situacao) { return RH_COTA_COR[situacao] || RH_SEM_COTA_COR }
// Estação sem cota cadastrada NÃO é "normal" — é desconhecida. Mesma
// distinção de `conama_violacoes` nulo na Água (sem limites ≠ conforme).
function rhCotaLabel(situacao) { return RH_COTA_LABEL[situacao] || 'Sem cota cadastrada' }

function _rhEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function _rhNum(v, casas) {
  if (v == null || !isFinite(v)) return '—'
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 })
}
function rhNivel(cm)  { return cm == null ? '—' : `${_rhNum(cm, 0)} cm` }
function rhChuva(mm)  { return mm == null ? '—' : `${_rhNum(mm, 1)} mm` }
function rhVazao(q)   { return q  == null ? '—' : `${_rhNum(q, 1)} m³/s` }
function rhVariacao(cm) {
  if (cm == null) return '—'
  const n = Number(cm)
  return `${n > 0 ? '+' : ''}${_rhNum(n, 0)} cm`
}

// ── Resumo do inventário (KPIs da tela) ─────────────────────────
// Puro. `estacoes` são linhas de vw_rh_estacoes_detalhe.
function rhResumoEstacoes(estacoes) {
  const lista = (estacoes || []).filter(e => e.ativo !== false)
  const comLeitura = lista.filter(e => e.ultima_leitura)
  const recente = comLeitura.filter(e => (Date.now() - new Date(e.ultima_leitura).getTime()) <= 36 * 3600 * 1000)
  const porSituacao = {}
  lista.forEach(e => { if (e.situacao_cota) porSituacao[e.situacao_cota] = (porSituacao[e.situacao_cota] || 0) + 1 })
  const emCota = (porSituacao.atencao || 0) + (porSituacao.alerta || 0) + (porSituacao.inundacao || 0)
  return {
    total: lista.length,
    telemetricas: lista.filter(e => e.telemetrica).length,
    comLeituraRecente: recente.length,
    semLeitura: lista.length - comLeitura.length,
    porSituacao,
    emCota,
    // Pior situação do conjunto — a manchete da tela.
    pior: RH_COTA_ORDEM.find(s => porSituacao[s]) || null,
    rios: [...new Set(lista.map(e => e.rio).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    bacias: [...new Set(lista.map(e => e.bacia).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  }
}

// ── Hidrograma: nível (linha) + chuva (barras invertidas) ───────
// Convenção clássica da hidrologia — a chuva desce do topo, o nível
// sobe da base, no MESMO eixo de tempo: é assim que se lê "choveu e o
// rio respondeu". As cotas cadastradas entram como linhas horizontais
// pontilhadas, cada uma rotulada (nunca só a cor).
//
// `medicoes`: [{ data_hora, nivel_cm, chuva_mm }] em ordem cronológica.
// `opts.cotas`: { atencao, alerta, inundacao } em cm (opcionais).
function rhHidrogramaHTML(medicoes, opts) {
  const o = Object.assign({ width: 720, height: 260 }, opts || {})
  const dados = (medicoes || []).filter(m => m && m.data_hora)
  if (!dados.length) {
    return '<p style="text-align:center;color:#9CA3AF;font-size:13px;padding:32px 0">Sem leituras no período selecionado</p>'
  }

  const PAD_L = 46, PAD_R = 46, PAD_T = 14, PAD_B = 26
  const w = o.width, h = o.height
  const plotW = w - PAD_L - PAD_R, plotH = h - PAD_T - PAD_B
  const faixaChuva = plotH * 0.32   // terço de cima para a chuva

  const niveis = dados.map(m => m.nivel_cm).filter(v => v != null).map(Number)
  const cotas = o.cotas || {}
  const refs = [cotas.atencao, cotas.alerta, cotas.inundacao].filter(v => v != null).map(Number)
  const chuvas = dados.map(m => m.chuva_mm).filter(v => v != null).map(Number)

  const nivMin = niveis.length ? Math.min(...niveis) : 0
  const nivMax = Math.max(...(niveis.length ? niveis : [1]), ...refs)
  const span = Math.max(1, nivMax - nivMin)
  const nMin = nivMin - span * 0.12, nMax = nivMax + span * 0.12
  const chuvaMax = Math.max(1, ...(chuvas.length ? chuvas : [1]))

  const t0 = new Date(dados[0].data_hora).getTime()
  const t1 = new Date(dados[dados.length - 1].data_hora).getTime()
  const x = ts => (t1 === t0) ? PAD_L + plotW / 2 : PAD_L + plotW * ((new Date(ts).getTime() - t0) / (t1 - t0))
  const yNivel = v => PAD_T + faixaChuva + (plotH - faixaChuva) * (1 - (v - nMin) / (nMax - nMin))
  const yChuva = v => PAD_T + faixaChuva * (v / chuvaMax)   // desce do topo

  // Barras de chuva (do topo para baixo).
  const larguraBarra = Math.max(2, Math.min(14, plotW / Math.max(dados.length, 1) * 0.6))
  const barras = dados.filter(m => m.chuva_mm != null && Number(m.chuva_mm) > 0).map(m => {
    const cx = x(m.data_hora), alt = yChuva(Number(m.chuva_mm)) - PAD_T
    return `<rect x="${(cx - larguraBarra / 2).toFixed(1)}" y="${PAD_T}" width="${larguraBarra.toFixed(1)}" height="${Math.max(1, alt).toFixed(1)}"
      fill="#2563A8" fill-opacity=".68" rx="1"><title>${_rhEsc(rhChuva(m.chuva_mm))}</title></rect>`
  }).join('')

  // Pontos de leitura, um por passo de tempo. Servem a duas coisas que
  // faltavam: são a régua de navegação por teclado (`data-gt-ponto`,
  // js/grafico-teclado.js) e dão tooltip de mouse à LINHA DE NÍVEL, que
  // é a série principal do hidrograma e não tinha nenhum — só as barras
  // de chuva tinham. Quase invisíveis de propósito: o desenho não muda,
  // só ganha alvo. O título cobre o passo inteiro (nível + chuva), então
  // as setas percorrem o tempo, não uma série de cada vez.
  const pontosLeitura = dados.map(m => {
    const cx = x(m.data_hora)
    const nivel = m.nivel_cm == null ? null : Number(m.nivel_cm)
    const cy = nivel == null ? (PAD_T + faixaChuva + (plotH - faixaChuva) / 2) : yNivel(nivel)
    if (!isFinite(cx) || !isFinite(cy)) return ''
    const d = new Date(m.data_hora)
    const quando = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
    const partes = [`Nível ${rhNivel(nivel)}`]
    if (m.chuva_mm != null) partes.push(`chuva ${rhChuva(m.chuva_mm)}`)
    if (m.vazao_m3s != null) partes.push(`vazão ${rhVazao(m.vazao_m3s)}`)
    return `<circle data-gt-ponto cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4"
      fill="#1F4E2C" fill-opacity="${nivel == null ? 0 : .01}"><title>${_rhEsc(quando)} — ${_rhEsc(partes.join(' · '))}</title></circle>`
  }).join('')

  // Linhas de cota — pontilhadas, rotuladas à direita.
  const linhasCota = ['atencao', 'alerta', 'inundacao'].filter(k => cotas[k] != null).map(k => {
    const y = yNivel(Number(cotas[k]))
    if (!isFinite(y)) return ''
    return `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${w - PAD_R}" y2="${y.toFixed(1)}"
        stroke="${RH_COTA_COR[k]}" stroke-width="1.4" stroke-dasharray="5 4" opacity=".85"/>
      <text x="${w - PAD_R + 4}" y="${(y + 3).toFixed(1)}" font-size="9" fill="${RH_COTA_COR[k]}" font-weight="700">${RH_COTA_LABEL[k]}</text>`
  }).join('')

  // Linha do nível — quebra em leitura ausente, nunca interpola por
  // cima de um vazio (mesma regra do gráfico de IQA).
  let segmentos = [], atual = []
  dados.forEach(m => {
    if (m.nivel_cm == null) { if (atual.length > 1) segmentos.push(atual); atual = []; return }
    atual.push(`${x(m.data_hora).toFixed(1)},${yNivel(Number(m.nivel_cm)).toFixed(1)}`)
  })
  if (atual.length > 1) segmentos.push(atual)
  const linhaNivel = segmentos.map(seg =>
    `<polyline points="${seg.join(' ')}" fill="none" stroke="#1F4E2C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`).join('')

  // Eixos: nível à esquerda, chuva à direita.
  const ticksNivel = [nMin, (nMin + nMax) / 2, nMax].map(v => `
    <line x1="${PAD_L}" y1="${yNivel(v).toFixed(1)}" x2="${w - PAD_R}" y2="${yNivel(v).toFixed(1)}" stroke="#E5E7EB" stroke-width="1"/>
    <text x="${PAD_L - 6}" y="${(yNivel(v) + 3).toFixed(1)}" font-size="9" fill="#9CA3AF" text-anchor="end">${_rhNum(v, 0)}</text>`).join('')
  const ticksChuva = `<text x="${w - PAD_R + 4}" y="${PAD_T + 8}" font-size="9" fill="#2563A8">${_rhNum(chuvaMax, 1)} mm</text>`

  const fmtData = ts => {
    const d = new Date(ts)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const rotulosX = [dados[0], dados[Math.floor(dados.length / 2)], dados[dados.length - 1]]
    .map((m, i, arr) => `<text x="${x(m.data_hora).toFixed(1)}" y="${h - 8}" font-size="9" fill="#9CA3AF"
      text-anchor="${i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}">${fmtData(m.data_hora)}</text>`).join('')

  const svgHidro = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img"
         aria-label="Hidrograma: nível do rio em centímetros e chuva em milímetros ao longo do período">
      ${ticksNivel}${barras}${linhasCota}${linhaNivel}${pontosLeitura}${rotulosX}${ticksChuva}
      <text x="${PAD_L - 6}" y="${PAD_T + faixaChuva + 12}" font-size="8.5" fill="#9CA3AF" text-anchor="end">cm</text>
    </svg>`

  // Degrada em silêncio se js/grafico-teclado.js não estiver carregado.
  const corpoHidro = typeof graficoTecladoEnvolver === 'function'
    ? graficoTecladoEnvolver(svgHidro, { rotulo: 'Hidrograma da estação' })
    : svgHidro

  return `
    ${corpoHidro}
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:2px;font-size:10.5px;color:#6B7280">
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:2px;background:#1F4E2C;display:inline-block"></span>Nível do rio (cm)</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:9px;height:9px;background:#2563A8;opacity:.68;display:inline-block;border-radius:1px"></span>Chuva (mm)</span>
      ${['atencao', 'alerta', 'inundacao'].filter(k => cotas[k] != null).map(k =>
        `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;border-top:2px dashed ${RH_COTA_COR[k]};display:inline-block"></span>Cota de ${RH_COTA_LABEL[k].toLowerCase()}</span>`).join('')}
    </div>`
}

// ── Exportação em planilha (CSV) ────────────────────────────────
// CSV com BOM e separador ';' — é o que o Excel em pt-BR abre sem
// pedir importação, e a planilha aqui existe para quem trabalha nele.
function _rhCsv(linhas) {
  const txt = linhas.map(l => l.map(c => {
    const s = c == null ? '' : String(c)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(';')).join('\r\n')
  return '﻿' + txt
}

function rhCsvEstacoes(estacoes) {
  const cab = ['Código ANA', 'Nome', 'Tipo', 'Situação', 'Telemétrica', 'Operadora', 'Rio', 'Bacia',
    'Município', 'Latitude', 'Longitude', 'Cota atenção (cm)', 'Cota alerta (cm)', 'Cota inundação (cm)',
    'Última leitura', 'Nível atual (cm)', 'Variação 24h (cm)', 'Chuva 24h (mm)', 'Chuva 7d (mm)', 'Situação da cota']
  const linhas = (estacoes || []).map(e => [
    e.codigo_ana, e.nome, RH_TIPO_LABEL[e.tipo] || e.tipo, RH_SITUACAO_LABEL[e.situacao] || e.situacao,
    e.telemetrica ? 'Sim' : 'Não', e.operadora, e.rio, e.bacia, e.municipio, e.lat, e.lng,
    e.cota_atencao_cm, e.cota_alerta_cm, e.cota_inundacao_cm,
    e.ultima_leitura ? new Date(e.ultima_leitura).toLocaleString('pt-BR') : '',
    e.nivel_atual_cm, e.variacao_24h_cm, e.chuva_24h, e.chuva_7d, rhCotaLabel(e.situacao_cota),
  ])
  return _rhCsv([cab, ...linhas])
}

function rhCsvRelatorioDiario(linhas, dataTxt) {
  const cab = ['Rio', 'Bacia', 'Estações', 'Nível médio (cm)', 'Nível máximo (cm)', 'Variação no dia (cm)',
    'Chuva total (mm)', 'Chuva máxima (mm)', 'Estações em cota', 'Pior situação']
  const corpo = (linhas || []).map(l => [
    l.rio, l.bacia, l.n_estacoes, l.nivel_medio_cm, l.nivel_max_cm, l.variacao_cm,
    l.chuva_total_mm, l.chuva_max_mm, l.estacoes_em_cota, rhCotaLabel(l.pior_situacao),
  ])
  return _rhCsv([[`Relatório diário — ${dataTxt || ''}`], [], cab, ...corpo])
}

function rhCsvMedicoes(medicoes, estacaoNome) {
  const cab = ['Estação', 'Data/hora', 'Nível (cm)', 'Chuva (mm)', 'Vazão (m³/s)', 'Origem']
  const linhas = (medicoes || []).map(m => [
    estacaoNome, new Date(m.data_hora).toLocaleString('pt-BR'),
    m.nivel_cm, m.chuva_mm, m.vazao_m3s, RH_ORIGEM_LABEL[m.origem] || m.origem,
  ])
  return _rhCsv([cab, ...linhas])
}

function rhBaixarCsv(conteudo, nomeArquivo) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nomeArquivo
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Importação de planilha (CSV do HidroWeb ou do estado) ───────
// Lê CSV com ';' ou ',' e devolve linhas normalizadas para
// rh_registrar_medicoes. Aceita as grafias mais comuns de cabeçalho —
// a planilha da ANA e a do estado não usam o mesmo nome de coluna, e
// exigir um formato único seria empurrar o trabalho de conversão para
// quem só quer subir o arquivo.
const RH_COL_ALIAS = {
  data_hora: ['data_hora', 'datahora', 'data e hora', 'data', 'datetime', 'data_medicao'],
  nivel_cm:  ['nivel_cm', 'nivel', 'nível', 'cota', 'cota_cm', 'nivel(cm)'],
  chuva_mm:  ['chuva_mm', 'chuva', 'precipitacao', 'precipitação', 'chuva(mm)', 'pluviometria'],
  vazao_m3s: ['vazao_m3s', 'vazao', 'vazão', 'descarga'],
  codigo:    ['codigo_ana', 'codigo', 'código', 'estacao', 'estação', 'estacao_codigo'],
}

function rhParseCsvMedicoes(texto) {
  const linhas = String(texto || '').split(/\r?\n/).filter(l => l.trim())
  if (linhas.length < 2) return { linhas: [], erros: ['Arquivo vazio ou sem cabeçalho.'] }
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ','
  const cab = linhas[0].split(sep).map(c => c.trim().toLowerCase().replace(/^"|"$/g, ''))

  const idx = {}
  Object.entries(RH_COL_ALIAS).forEach(([campo, nomes]) => {
    const i = cab.findIndex(c => nomes.includes(c))
    if (i >= 0) idx[campo] = i
  })
  const erros = []
  if (idx.data_hora == null) erros.push('Não achei a coluna de data/hora (aceita: data_hora, data, cota... ver ajuda).')
  if (idx.nivel_cm == null && idx.chuva_mm == null && idx.vazao_m3s == null) {
    erros.push('Nenhuma coluna de medição encontrada (nível, chuva ou vazão).')
  }
  if (erros.length) return { linhas: [], erros }

  const num = v => {
    const s = String(v ?? '').trim().replace(/^"|"$/g, '').replace(/\./g, '').replace(',', '.')
    if (!s) return null
    const n = Number(s)
    return isFinite(n) ? n : null
  }
  const data = v => {
    const s = String(v ?? '').trim().replace(/^"|"$/g, '')
    // dd/mm/aaaa [hh:mm] — formato das planilhas brasileiras — ou ISO.
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/)
    if (br) {
      const [, d, m, a, hh, mm] = br
      return `${a}-${m}-${d}T${(hh || '00').padStart(2, '0')}:${mm || '00'}:00`
    }
    return isNaN(new Date(s).getTime()) ? null : new Date(s).toISOString()
  }

  const out = []
  const descartadas = []
  linhas.slice(1).forEach((l, i) => {
    const cols = l.split(sep)
    const dh = data(cols[idx.data_hora])
    if (!dh) { descartadas.push(i + 2); return }
    out.push({
      codigo: idx.codigo != null ? String(cols[idx.codigo] || '').trim().replace(/^"|"$/g, '') : null,
      data_hora: dh,
      nivel_cm:  idx.nivel_cm  != null ? num(cols[idx.nivel_cm])  : null,
      chuva_mm:  idx.chuva_mm  != null ? num(cols[idx.chuva_mm])  : null,
      vazao_m3s: idx.vazao_m3s != null ? num(cols[idx.vazao_m3s]) : null,
    })
  })
  if (descartadas.length) {
    erros.push(`${descartadas.length} linha(s) sem data válida foram ignoradas (primeira: linha ${descartadas[0]}).`)
  }
  return { linhas: out, erros }
}
