// ── SIGUC-AC · Qualidade da Água — Relatório PPTX por bacia (Fase 5) ─
// Apresentação executiva (para gestores, não para arquivo — o
// documento de registro é o PDF, js/agua-relatorio-pdf.js): capa,
// PAINEL do período (o mesmo da tela e da 1ª página do PDF), evolução
// do IQA por ponto ao longo das campanhas e conformidade CONAMA
// detalhada. Usa pptxgenjs (js/vendor/pptxgenjs-4.0.1.bundle.js
// — vendorizado, mesmo padrão de js/vendor/turf-6.5.0.min.js/
// proj4-2.11.0.min.js, para não depender de CDN).
//
// Paleta e convenções visuais (header escuro + barra dourada, cards
// com sombra suave) copiadas de scripts/gerar-pptx.js (deck de
// treinamento do Brigadas) — mesma identidade do projeto, não um
// desenho novo. O gerador de treinamento roda em Node e monta slides
// de mockup de celular; aqui a lógica é outra (dados/gráficos, não
// screenshots), então não há função para reaproveitar de lá, só a
// paleta de cores.
//
// Depende de: aguaRelLabelCampanha(), aguaRelSerieIQA(), aguaRelFiltrosTxt(),
// aguaRelDistribuicaoFaixas(), aguaRelIqaPorPonto() (js/agua-relatorio-dados.js);
// AGUA_IQA_FAIXA_COR/ORDEM (js/agua-iqa-visual.js — só a paleta, com
// fallback local); window.PptxGenJS (js/vendor/pptxgenjs-4.0.1.bundle.js).

const AGPPTX_C = {
  darkBg: '0A1A0F', green: '52B788', gold: 'C9A84C', goldLt: 'F0CB6A',
  txt: 'F4EFE6', bg: 'EFF7F2', white: 'FFFFFF', muted: '6B7280', border: 'D1FAE5',
}
const AGPPTX_W = 10, AGPPTX_H = 5.625, AGPPTX_M = 0.4

let _agpptxLibPromise = null
function _agpptxCarregarLib() {
  if (window.PptxGenJS) return Promise.resolve()
  if (_agpptxLibPromise) return _agpptxLibPromise
  _agpptxLibPromise = new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = '../js/vendor/pptxgenjs-4.0.1.bundle.js'
    s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar pptxgenjs.'))
    document.head.appendChild(s)
  })
  return _agpptxLibPromise
}

function _agpptxHeader(pres, slide, titulo, subtitulo) {
  slide.background = { color: AGPPTX_C.bg }
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: AGPPTX_W, h: 0.7, fill: { color: AGPPTX_C.darkBg }, line: { color: AGPPTX_C.darkBg, width: 0 } })
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.7, w: AGPPTX_W, h: 0.035, fill: { color: AGPPTX_C.gold }, line: { color: AGPPTX_C.gold, width: 0 } })
  slide.addText(titulo, { x: AGPPTX_M, y: 0, w: 6.8, h: 0.7, fontSize: 18, bold: true, color: AGPPTX_C.txt, fontFace: 'Georgia', valign: 'middle', margin: 0 })
  slide.addText(subtitulo || 'SIGUC-AC · SEMA', { x: 7.0, y: 0, w: 2.6, h: 0.7, fontSize: 9, color: AGPPTX_C.green, fontFace: 'Calibri', valign: 'middle', align: 'right', margin: 0 })
}

function _agpptxCard(pres, slide, x, y, w, h, opts = {}) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: opts.fill || AGPPTX_C.white },
    line: { color: opts.border || AGPPTX_C.border, width: 1 },
    shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.07 },
  })
}

// ── Slide 1: capa ────────────────────────────────────────────────
function _agpptxSlideCapa(pres, labelBacia, periodoTxt, protocolo, filtrosTxt) {
  const s = pres.addSlide()
  s.background = { color: AGPPTX_C.darkBg }
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: AGPPTX_H - 0.12, w: AGPPTX_W, h: 0.12, fill: { color: AGPPTX_C.gold }, line: { color: AGPPTX_C.gold, width: 0 } })
  s.addText('QUALIDADE DA ÁGUA — SIGUC-AC', { x: AGPPTX_M, y: 1.0, w: 9.2, h: 0.5, fontSize: 13, color: AGPPTX_C.green, fontFace: 'Calibri', bold: true, charSpacing: 2 })
  const titulo = labelBacia === 'Sem bacia definida' ? labelBacia : `Bacia do ${labelBacia}`
  s.addText(titulo, { x: AGPPTX_M, y: 1.55, w: 9.2, h: 1.4, fontSize: 34, color: AGPPTX_C.txt, fontFace: 'Georgia', bold: true, valign: 'top' })
  s.addText(periodoTxt, { x: AGPPTX_M, y: 2.95, w: 9.2, h: 0.5, fontSize: 15, color: AGPPTX_C.goldLt, fontFace: 'Calibri' })
  // Filtros ativos (rio/status/faixa IQA/CONAMA) — mesma preocupação do
  // PDF: a capa não pode parecer "a bacia inteira" quando foi recortada.
  if (filtrosTxt) {
    s.addText(`Filtros aplicados: ${filtrosTxt}`, { x: AGPPTX_M, y: 3.4, w: 9.2, h: 0.35, fontSize: 10, color: AGPPTX_C.green, fontFace: 'Calibri', italic: true })
  }
  s.addText(`SEMA-AC · DIMA · Protocolo ${protocolo}`, { x: AGPPTX_M, y: AGPPTX_H - 0.55, w: 9.2, h: 0.35, fontSize: 9, color: AGPPTX_C.green, fontFace: 'Calibri' })
}

// ── Slide 2: painel (o mesmo da tela e da 1ª página do PDF) ──────
// Aqui os gráficos são NATIVOS do PowerPoint (addChart), não desenho:
// num deck, quem apresenta precisa poder editar/copiar o gráfico, e o
// pptxgenjs já entrega isso. É a diferença deliberada para o PDF, onde
// a mesma leitura é desenhada com primitivos (documento é impresso, não
// editado).
//
// Os dados saem das MESMAS funções de js/agua-relatorio-dados.js que
// alimentam a tela — nada de IQA/CONAMA recalculado, e a média de um
// ponto nunca vira "faixa" (classificar é papel do banco), por isso as
// barras por ponto usam um tom só.
function _agpptxCorFaixa(faixa) {
  const paleta = typeof AGUA_IQA_FAIXA_COR !== 'undefined' ? AGUA_IQA_FAIXA_COR : null
  const hex = paleta && paleta[faixa]
  return hex ? String(hex).replace('#', '') : '9CA3AF'
}

function _agpptxSlidePainel(pres, relatorio) {
  const s = pres.addSlide()
  _agpptxHeader(pres, s, 'Painel do período')
  const r = relatorio.resumo

  // KPIs — mesma faixa de seis do topo do painel
  const kpis = [
    ['Pontos', String(r.nPontos)],
    ['Campanhas', String(relatorio.campanhas.length)],
    ['Coletas', String(r.totalColetas)],
    ['IQA médio', r.iqaMedio != null ? r.iqaMedio.toFixed(1) : '—'],
    ['Conforme CONAMA', r.pctConforme != null ? r.pctConforme.toFixed(0) + '%' : '—'],
    ['Em conferência', String(r.quarentena)],
  ]
  const gap = 0.14
  const cw = (AGPPTX_W - AGPPTX_M * 2 - gap * (kpis.length - 1)) / kpis.length
  kpis.forEach(([lbl, val], i) => {
    const x = AGPPTX_M + i * (cw + gap)
    _agpptxCard(pres, s, x, 0.95, cw, 0.92)
    s.addText(val, { x: x + 0.05, y: 1.0, w: cw - 0.1, h: 0.5, fontSize: 20, bold: true, color: AGPPTX_C.darkBg, fontFace: 'Georgia', align: 'center', margin: 0 })
    s.addText(lbl.toUpperCase(), { x: x + 0.05, y: 1.48, w: cw - 0.1, h: 0.32, fontSize: 7, color: AGPPTX_C.muted, fontFace: 'Calibri', align: 'center', charSpacing: 0.5, margin: 0 })
  })

  // Distribuição por faixa (barra empilhada) — única leitura em que as
  // 5 cores de faixa aparecem juntas; a faixa vem pronta do banco.
  const meia = (AGPPTX_W - AGPPTX_M * 2 - 0.3) / 2
  const yG = 2.15, hG = 1.45
  const dist = aguaRelDistribuicaoFaixas(relatorio.coletas)
  const ordem = typeof AGUA_IQA_FAIXA_ORDEM !== 'undefined' ? AGUA_IQA_FAIXA_ORDEM : ['Ótima', 'Boa', 'Regular', 'Ruim', 'Péssima']
  const seriesFaixa = ordem.filter(f => (dist.contagem[f] || 0) > 0)
    .map(f => ({ name: f, labels: ['Coletas'], values: [dist.contagem[f]] }))
  if (dist.semIQA > 0) seriesFaixa.push({ name: 'Sem índice', labels: ['Coletas'], values: [dist.semIQA] })

  s.addText('DISTRIBUIÇÃO POR FAIXA DO IQA', { x: AGPPTX_M, y: yG - 0.28, w: meia, h: 0.25, fontSize: 8, bold: true, color: AGPPTX_C.darkBg, fontFace: 'Calibri', charSpacing: 0.5, margin: 0 })
  if (seriesFaixa.length) {
    s.addChart(pres.ChartType.bar, seriesFaixa, {
      x: AGPPTX_M, y: yG, w: meia, h: hG,
      barDir: 'bar', barGrouping: 'stacked',
      chartColors: seriesFaixa.map(f => (f.name === 'Sem índice' ? '9CA3AF' : _agpptxCorFaixa(f.name))),
      showLegend: true, legendPos: 'b', legendFontSize: 8,
      showValue: true, dataLabelColor: 'FFFFFF', dataLabelFontSize: 8,
      catAxisHidden: true, valAxisHidden: true, showTitle: false,
    })
  } else {
    s.addText('Nenhuma coleta com índice calculado no período.', { x: AGPPTX_M, y: yG + 0.5, w: meia, h: 0.4, fontSize: 10, color: AGPPTX_C.muted, align: 'center' })
  }

  // Conformidade CONAMA — rosca com os TRÊS estados. "Sem limites
  // cadastrados" é fatia própria, nunca somada a "conforme".
  const xDir = AGPPTX_M + meia + 0.3
  s.addText('CONFORMIDADE CONAMA', { x: xDir, y: yG - 0.28, w: meia, h: 0.25, fontSize: 8, bold: true, color: AGPPTX_C.darkBg, fontFace: 'Calibri', charSpacing: 0.5, margin: 0 })
  const semLimites = r.totalColetas - r.comConama
  const fatias = [
    ['Conforme', r.conforme, '059669'],
    ['Com violação', r.comConama - r.conforme, 'C2410C'],
    ['Sem limites cadastrados', semLimites, '9CA3AF'],
  ].filter(f => f[1] > 0)
  if (fatias.length) {
    s.addChart(pres.ChartType.doughnut, [{ name: 'Coletas', labels: fatias.map(f => f[0]), values: fatias.map(f => f[1]) }], {
      x: xDir, y: yG, w: meia, h: hG,
      chartColors: fatias.map(f => f[2]), holeSize: 55,
      showLegend: true, legendPos: 'r', legendFontSize: 8,
      showValue: true, dataLabelColor: 'FFFFFF', dataLabelFontSize: 8, showTitle: false,
    })
  } else {
    s.addText('Nenhuma coleta avaliada contra limites no período.', { x: xDir, y: yG + 0.5, w: meia, h: 0.4, fontSize: 10, color: AGPPTX_C.muted, align: 'center' })
  }

  // IQA médio por ponto — magnitude, um tom só (ver comentário do bloco)
  const porPonto = aguaRelIqaPorPonto(relatorio).filter(p => p.iqaMedio != null).slice(0, 10)
  const yB = 4.05
  s.addText(`IQA MÉDIO POR PONTO DE COLETA${porPonto.length < relatorio.pontos.length ? ` (${porPonto.length} DE ${relatorio.pontos.length})` : ''}`,
    { x: AGPPTX_M, y: yB - 0.28, w: AGPPTX_W - AGPPTX_M * 2, h: 0.25, fontSize: 8, bold: true, color: AGPPTX_C.darkBg, fontFace: 'Calibri', charSpacing: 0.5, margin: 0 })
  if (porPonto.length) {
    s.addChart(pres.ChartType.bar, [{
      name: 'IQA médio', labels: porPonto.map(p => p.nome), values: porPonto.map(p => Number(p.iqaMedio.toFixed(1))),
    }], {
      x: AGPPTX_M, y: yB, w: AGPPTX_W - AGPPTX_M * 2, h: 1.05,
      barDir: 'col', chartColors: ['2D6A4F'], showLegend: false, showTitle: false,
      valAxisMinVal: 0, valAxisMaxVal: 100, valAxisHidden: true,
      catAxisLabelFontSize: 7, showValue: true, dataLabelFontSize: 7, dataLabelPosition: 'outEnd', dataLabelColor: '374151',
    })
  } else {
    s.addText('Nenhum ponto com IQA calculado no período.', { x: AGPPTX_M, y: yB + 0.3, w: AGPPTX_W - AGPPTX_M * 2, h: 0.4, fontSize: 10, color: AGPPTX_C.muted, align: 'center' })
  }

  if (r.quarentena > 0) {
    s.addText(`${r.quarentena} coleta(s) em quarentena — pendente(s) de conferência humana; contam nos gráficos acima e o IQA/CONAMA delas é preliminar.`,
      { x: AGPPTX_M, y: AGPPTX_H - 0.4, w: AGPPTX_W - AGPPTX_M * 2, h: 0.32, fontSize: 8, italic: true, color: 'CA8A04', margin: 0 })
  }
  return s
}

// ── Slide 3: evolução do IQA por ponto ───────────────────────────
function _agpptxSlideEvolucao(pres, relatorio) {
  const s = pres.addSlide()
  _agpptxHeader(pres, s, 'Evolução do IQA por ponto')

  if (relatorio.campanhas.length < 2 || !relatorio.pontos.length) {
    s.addText('Sem campanhas suficientes no período para traçar uma série (mínimo de 2).',
      { x: AGPPTX_M, y: 2.4, w: AGPPTX_W - AGPPTX_M * 2, h: 0.6, fontSize: 13, color: AGPPTX_C.muted, align: 'center' })
    return s
  }

  const categorias = relatorio.campanhas.map(aguaRelLabelCampanha)
  const dadosGrafico = relatorio.pontos.map(ponto => {
    const serie = aguaRelSerieIQA(ponto, relatorio.campanhas)
    return { name: ponto.nome, labels: categorias, values: serie.map(p => p.iqa) }
  }).filter(d => d.values.some(v => v != null))

  s.addChart(pres.ChartType.line, dadosGrafico, {
    x: 0.5, y: 0.95, w: AGPPTX_W - 1.0, h: AGPPTX_H - 1.5,
    showLegend: dadosGrafico.length > 1, legendPos: 'b', legendFontSize: 8,
    showTitle: false, lineSize: 2.5, lineSmooth: false, lineDataSymbol: 'circle', lineDataSymbolSize: 5,
    catAxisLabelFontSize: 8, valAxisLabelFontSize: 8, valAxisTitle: 'IQA', showValAxisTitle: true,
    valAxisMinVal: 0, valAxisMaxVal: 100, chartColors: ['52B788', 'C9A84C', '3B82C4', 'EF5B3C', '7C3AED', '0891B2', '84CC16', '9CA3AF'],
    dataLabelColor: '374151', dataLabelFontSize: 7,
  })
  return s
}

// ── Slide 4: conformidade CONAMA ─────────────────────────────────
function _agpptxSlideConama(pres, relatorio) {
  const s = pres.addSlide()
  _agpptxHeader(pres, s, 'Conformidade CONAMA (classe de enquadramento)')

  const entradas = Object.entries(relatorio.resumo.violacoesPorParametro).sort((a, b) => b[1] - a[1])
  if (!entradas.length) {
    const semLimite = relatorio.resumo.comConama === 0
    s.addText(semLimite ? 'Nenhum ponto desta bacia tem limites CONAMA cadastrados para a classe de enquadramento no período.' : 'Nenhuma violação registrada no período — todas as coletas com limites cadastrados estão conformes.',
      { x: AGPPTX_M, y: 2.4, w: AGPPTX_W - AGPPTX_M * 2, h: 0.6, fontSize: 13, color: AGPPTX_C.muted, align: 'center' })
    return s
  }

  const rows = [[
    { text: 'Parâmetro', options: { bold: true, color: AGPPTX_C.white, fill: { color: AGPPTX_C.darkBg } } },
    { text: 'Coletas em violação', options: { bold: true, color: AGPPTX_C.white, fill: { color: AGPPTX_C.darkBg } } },
  ]]
  entradas.forEach(([param, n]) => {
    rows.push([
      { text: AGUA_REL_PARAM_LABEL[param] || param },
      { text: String(n) },
    ])
  })
  s.addTable(rows, { x: AGPPTX_M, y: 1.0, w: AGPPTX_W - AGPPTX_M * 2, colW: [(AGPPTX_W - AGPPTX_M * 2) * 0.7, (AGPPTX_W - AGPPTX_M * 2) * 0.3], fontSize: 11, border: { type: 'solid', color: AGPPTX_C.border, pt: 0.5 }, autoPage: false })
  s.addText(`${relatorio.resumo.conforme}/${relatorio.resumo.comConama} coletas com limites cadastrados estão conformes (${relatorio.resumo.pctConforme.toFixed(0)}%).`,
    { x: AGPPTX_M, y: AGPPTX_H - 0.55, w: AGPPTX_W - AGPPTX_M * 2, h: 0.4, fontSize: 9, color: AGPPTX_C.muted })
  return s
}

// ── Montagem completa → devolve um Blob .pptx ────────────────────
async function aguaRelMontarPptx(relatorio, labelBacia, periodoTxt, protocolo) {
  await _agpptxCarregarLib()
  const pres = new window.PptxGenJS()
  pres.layout = 'LAYOUT_16x9'
  pres.title = `Qualidade da Água — ${labelBacia}`
  pres.author = 'SEMA-AC · DIMA'

  _agpptxSlideCapa(pres, labelBacia, periodoTxt, protocolo, aguaRelFiltrosTxt(relatorio.filtros))
  _agpptxSlidePainel(pres, relatorio)
  _agpptxSlideEvolucao(pres, relatorio)
  _agpptxSlideConama(pres, relatorio)

  return pres.write({ outputType: 'blob' })
}

function aguaRelBaixarPptx(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
