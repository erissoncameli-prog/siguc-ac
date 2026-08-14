// ── SIGUC-AC · Qualidade da Água — Relatório PDF por bacia (Fase 5) ─
// Documento de registro/fiscalização: tabela de coletas por ponto e
// campanha, com IQA e conformidade CONAMA lado a lado (nunca um
// escondendo o outro — regra do módulo, já em pages/agua-mapa.html).
// Desenhado direto com jsPDF (texto/tabelas), no MESMO motor e padrão
// visual do relatório do Biomonitor (js/biomonitor-relatorio-ninho.js):
// cabeçalho/rodapé com timbre oficial, paginação que nunca corta um
// bloco no meio. Nunca reimplementado — o padrão é copiado aqui porque
// os dois módulos têm domínios de dado diferentes (não dá pra chamar
// as funções de lá, que são específicas de ninho), mas o MESMO
// desenho visual (cores, margens, tipografia) é mantido.
//
// A fonte DM Sans embutida (BIOPDF_FONT_REGULAR_B64/BOLD_B64) é
// reaproveitada de js/biomonitor-pdf-fonts.js sem cópia — é só um
// recurso de fonte (150 KB de base64), não lógica de domínio do
// Biomonitor; a página que usa este arquivo inclui aquele <script>
// como dependência, igual a como o mapa reaproveita js/mapa-recorte.js.
//
// Depende de: formatData() (js/config.js); getCabecalhoRelatorio(),
// gerarProtocolo() (js/config-sistema.js); BIOPDF_FONT_REGULAR_B64/
// BIOPDF_FONT_BOLD_B64 (js/biomonitor-pdf-fonts.js); aguaRelLabelCampanha(),
// AGUA_REL_PARAM_LABEL (js/agua-relatorio-dados.js); jsPDF + jspdf-autotable
// (js/vendor/jspdf-2.5.2.umd.min.js, js/vendor/jspdf-autotable-3.8.4.min.js).

// Mesma paleta de pages/agua-mapa.html (IQA_FAIXA_COR) — validada para
// daltonismo junto com as outras cores do módulo (ver CLAUDE.md, seção
// do painel-resumo do mapa principal). Cópia de valor, não de lógica.
const AGPDF_IQA_COR = {
  'Ótima': [21, 128, 61], 'Boa': [132, 204, 22], 'Regular': [202, 138, 4],
  'Ruim': [234, 88, 12], 'Péssima': [185, 28, 28],
}
const AGPDF_SEM_IQA_COR = [156, 163, 175]

const AGPDF_M = 15
const AGPDF_TOPO = 26
const AGPDF_RODAPE = 14
const AGPDF_COR = {
  texto: [17, 24, 39], muted: [107, 114, 128], muted2: [156, 163, 175],
  floresta: [10, 26, 15], borda: [229, 231, 235], claro: [249, 250, 251],
}

// ── Biblioteca sob demanda ────────────────────────────────────────
// Vendorizada (js/vendor/, mesmo padrão de turf-6.5.0.min.js/
// proj4-2.11.0.min.js) em vez do CDN que o Biomonitor usa: mesma
// versão (jsPDF 2.5.2 + autotable 3.8.4), só o transporte muda.
let _agpdfLibsPromise = null
function _agpdfCarregarLibs() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve()
  if (_agpdfLibsPromise) return _agpdfLibsPromise
  const carregarScript = src => new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar ' + src + '.'))
    document.head.appendChild(s)
  })
  _agpdfLibsPromise = carregarScript('../js/vendor/jspdf-2.5.2.umd.min.js')
    .then(() => carregarScript('../js/vendor/jspdf-autotable-3.8.4.min.js'))
  return _agpdfLibsPromise
}

function _agpdfNovoDocumento() {
  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  pdf.addFileToVFS('DMSans-Regular.ttf', BIOPDF_FONT_REGULAR_B64)
  pdf.addFont('DMSans-Regular.ttf', 'DMSans', 'normal')
  pdf.addFileToVFS('DMSans-Bold.ttf', BIOPDF_FONT_BOLD_B64)
  pdf.addFont('DMSans-Bold.ttf', 'DMSans', 'bold')
  pdf.setFont('DMSans', 'normal')
  return pdf
}

function _agpdfCtx(pdf, cab, protocolo) {
  return { pdf, cab, protocolo, W: pdf.internal.pageSize.getWidth(), H: pdf.internal.pageSize.getHeight(), y: AGPDF_TOPO }
}

function _agpdfNovaPagina(ctx) { ctx.pdf.addPage(); ctx.y = AGPDF_TOPO }
function _agpdfGarantirEspaco(ctx, altura) {
  if (ctx.y + altura > ctx.H - AGPDF_RODAPE) _agpdfNovaPagina(ctx)
}

function _agpdfTitulo(ctx, texto) {
  _agpdfGarantirEspaco(ctx, 10)
  const { pdf } = ctx
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(...AGPDF_COR.floresta)
  pdf.text(texto.toUpperCase(), AGPDF_M, ctx.y)
  pdf.setDrawColor(...AGPDF_COR.floresta); pdf.setLineWidth(0.5)
  pdf.line(AGPDF_M, ctx.y + 1.8, ctx.W - AGPDF_M, ctx.y + 1.8)
  ctx.y += 7
}

function _agpdfParagrafo(ctx, texto, opts = {}) {
  const { pdf } = ctx
  pdf.setFont('DMSans', opts.bold ? 'bold' : 'normal'); pdf.setFontSize(8.6)
  pdf.setTextColor(...(opts.muted ? AGPDF_COR.muted2 : AGPDF_COR.texto))
  const linhas = pdf.splitTextToSize(texto, ctx.W - AGPDF_M * 2)
  const altura = linhas.length * 4.2
  _agpdfGarantirEspaco(ctx, altura + 2)
  pdf.text(linhas, AGPDF_M, ctx.y)
  ctx.y += altura + 3
}

function _agpdfTabela(ctx, opts) {
  const { pdf } = ctx
  pdf.autoTable({
    startY: ctx.y,
    margin: { left: AGPDF_M, right: AGPDF_M, top: AGPDF_TOPO, bottom: AGPDF_RODAPE },
    styles: { font: 'DMSans', fontSize: 8, textColor: AGPDF_COR.texto, cellPadding: 1.6, lineColor: AGPDF_COR.borda, lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { fillColor: AGPDF_COR.floresta, textColor: 255, fontStyle: 'bold', fontSize: 7.2 },
    alternateRowStyles: { fillColor: AGPDF_COR.claro },
    ...opts,
  })
  ctx.y = pdf.lastAutoTable.finalY + 6
}

// ── Cabeçalho/rodapé — passada final sobre todas as páginas já
// existentes (só assim dá pra saber o total de páginas) ────────────
function _agpdfDesenharCabecalhoPagina(pdf, cab, protocolo, logos) {
  const W = pdf.internal.pageSize.getWidth()
  const topo = 8
  let x = AGPDF_M
  if (logos.gov) pdf.addImage(logos.gov, /^data:image\/jpe?g/i.test(logos.gov) ? 'JPEG' : 'PNG', x, topo, 11, 11)
  x += 13
  if (logos.secr) pdf.addImage(logos.secr, /^data:image\/jpe?g/i.test(logos.secr) ? 'JPEG' : 'PNG', x, topo, 11, 11)
  const xTexto = AGPDF_M + 26
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(...AGPDF_COR.floresta)
  pdf.text(`${cab.secretaria} — ${cab.siglaSecr}`, xTexto, topo + 4.5)
  pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...AGPDF_COR.muted)
  pdf.text(`${cab.diretoria} · ${cab.departamento} · Qualidade da Água`, xTexto, topo + 8.5)
  pdf.setFontSize(7); pdf.setTextColor(...AGPDF_COR.muted2)
  pdf.text('SIGUC-AC', W - AGPDF_M, topo + 2.5, { align: 'right' })
  pdf.text('Prot. ' + protocolo, W - AGPDF_M, topo + 6.5, { align: 'right' })
  pdf.setDrawColor(...AGPDF_COR.floresta); pdf.setLineWidth(0.6)
  pdf.line(AGPDF_M, AGPDF_TOPO - 4, W - AGPDF_M, AGPDF_TOPO - 4)
}

function _agpdfDesenharRodapePagina(pdf, cab, protocolo, numeroPagina, totalPaginas) {
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight()
  const y = H - 8
  pdf.setDrawColor(...AGPDF_COR.borda); pdf.setLineWidth(0.2)
  pdf.line(AGPDF_M, y - 3, W - AGPDF_M, y - 3)
  pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...AGPDF_COR.muted2)
  pdf.text(`${cab.secretaria} · ${cab.siglaDiret}`, AGPDF_M, y)
  pdf.text(`Pág. ${numeroPagina}/${totalPaginas} · Prot. ${protocolo}`, W - AGPDF_M, y, { align: 'right' })
}

function _agpdfAplicarCabecalhoRodapeGlobal(ctx, logos) {
  const { pdf } = ctx
  const total = pdf.internal.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i)
    _agpdfDesenharCabecalhoPagina(pdf, ctx.cab, ctx.protocolo, logos)
    _agpdfDesenharRodapePagina(pdf, ctx.cab, ctx.protocolo, i, total)
  }
}

async function _agpdfBuscarDataURL(url) {
  if (!url) return null
  try {
    const alvo = (typeof fotoUrlAssinada === 'function' ? await fotoUrlAssinada(url) : null) || url
    const r = await fetch(alvo)
    if (!r.ok) return null
    const blob = await r.blob()
    return await new Promise((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result); fr.onerror = rej
      fr.readAsDataURL(blob)
    })
  } catch (e) { return null }
}

// ── Seções ────────────────────────────────────────────────────────
function _agpdfCapa(ctx, relatorio, labelBacia, periodoTxt) {
  const { pdf } = ctx
  ctx.y = 70
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...AGPDF_COR.muted2)
  pdf.text('RELATÓRIO DE QUALIDADE DA ÁGUA — POR BACIA HIDROGRÁFICA', ctx.W / 2, ctx.y, { align: 'center' })
  ctx.y += 12
  pdf.setFontSize(22); pdf.setTextColor(...AGPDF_COR.floresta)
  const linhasNome = pdf.splitTextToSize(labelBacia === 'Sem bacia definida' ? labelBacia : `Bacia do ${labelBacia}`, ctx.W - AGPDF_M * 2 - 20)
  pdf.text(linhasNome, ctx.W / 2, ctx.y, { align: 'center' })
  ctx.y += linhasNome.length * 9 + 4
  pdf.setFont('DMSans', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...AGPDF_COR.muted)
  pdf.text(periodoTxt, ctx.W / 2, ctx.y, { align: 'center' })
  ctx.y += 30

  const r = relatorio.resumo
  const kpis = [
    ['Pontos de coleta', String(r.nPontos)],
    ['Coletas no período', String(r.totalColetas)],
    ['Campanhas', String(relatorio.campanhas.length)],
    ['IQA médio da bacia', r.iqaMedio != null ? r.iqaMedio.toFixed(1) : '—'],
    ['Conformidade CONAMA', r.pctConforme != null ? r.pctConforme.toFixed(0) + '% conforme' : 'sem limites cadastrados'],
    ['Coletas em quarentena', String(r.quarentena)],
  ]
  const colW = (ctx.W - AGPDF_M * 2) / 3
  kpis.forEach(([lbl, val], i) => {
    const col = i % 3, lin = Math.floor(i / 3)
    const x = AGPDF_M + col * colW
    const y = ctx.y + lin * 26
    pdf.setDrawColor(...AGPDF_COR.borda); pdf.setLineWidth(0.3)
    pdf.line(x, y - 5, x + colW - 8, y - 5)
    pdf.setFont('DMSans', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...AGPDF_COR.floresta)
    pdf.text(val, x, y + 4)
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...AGPDF_COR.muted)
    pdf.text(lbl, x, y + 10)
  })
  ctx.y += 60

  if (r.quarentena > 0) {
    _agpdfParagrafo(ctx, `${r.quarentena} coleta(s) deste período está(ão) em quarentena — dado pendente de conferência humana (ver Configurações › Qualidade da Água › Conferência). As linhas em quarentena aparecem marcadas nas tabelas a seguir; o IQA e a conformidade CONAMA delas, quando exibidos, são preliminares.`, { muted: true })
  }
  if (Object.keys(r.violacoesPorParametro).length) {
    const txt = Object.entries(r.violacoesPorParametro)
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${AGUA_REL_PARAM_LABEL[p] || p} (${n})`)
      .join(', ')
    _agpdfParagrafo(ctx, `Parâmetros com violação da Resolução CONAMA (classe de enquadramento do ponto) no período: ${txt}.`, { muted: true })
  }
}

function _agpdfSecaoPonto(ctx, ponto) {
  _agpdfGarantirEspaco(ctx, 14)
  _agpdfTitulo(ctx, `${ponto.nome}${ponto.codigo_ana ? ' — ' + ponto.codigo_ana : ''}`)
  const sub = [ponto.rio, ponto.municipio].filter(Boolean).join(' · ')
  if (sub) {
    ctx.pdf.setFont('DMSans', 'normal'); ctx.pdf.setFontSize(8); ctx.pdf.setTextColor(...AGPDF_COR.muted)
    ctx.pdf.text(sub, AGPDF_M, ctx.y)
    ctx.y += 5
  }

  const linhas = ponto.coletas.map(c => {
    const semLimites = c.conama_violacoes == null
    const violou = !semLimites && c.conama_violacoes.length > 0
    const conamaTxt = semLimites ? 'Sem limites' : (violou ? `${c.conama_violacoes.length} violação(ões)` : 'Conforme')
    return [
      aguaRelLabelCampanha(c),
      formatData(c.data_coleta),
      c.status === 'quarentena' ? 'Quarentena' : 'Completo',
      c.iqa != null ? c.iqa.toFixed(1) : '—',
      c.iqa_faixa || '—',
      conamaTxt,
    ]
  })

  _agpdfTabela(ctx, {
    head: [['Campanha', 'Data', 'Status', 'IQA', 'Faixa', 'CONAMA']],
    body: linhas,
    columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 24 }, 2: { cellWidth: 24 }, 3: { cellWidth: 16, halign: 'right' }, 4: { cellWidth: 24 }, 5: { cellWidth: 'auto' } },
    didParseCell: data => {
      if (data.section !== 'body') return
      const c = ponto.coletas[data.row.index]
      if (data.column.index === 2 && c.status === 'quarentena') {
        data.cell.styles.textColor = [202, 138, 4]; data.cell.styles.fontStyle = 'bold'
      }
      if (data.column.index === 4 && c.iqa_faixa) {
        data.cell.styles.textColor = AGPDF_IQA_COR[c.iqa_faixa] || AGPDF_SEM_IQA_COR
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.column.index === 5 && c.conama_violacoes?.length > 0) {
        data.cell.styles.textColor = [185, 28, 28]
      }
    },
  })
}

// ── Montagem completa → devolve o objeto jsPDF ──────────────────────
async function aguaRelMontarPdf(relatorio, labelBacia, periodoTxt, cab, protocolo) {
  await _agpdfCarregarLibs()
  const pdf = _agpdfNovoDocumento()
  const ctx = _agpdfCtx(pdf, cab, protocolo)

  const logos = {
    gov: cab.logoGoverno ? await _agpdfBuscarDataURL(cab.logoGoverno) : null,
    secr: cab.logoSecr ? await _agpdfBuscarDataURL(cab.logoSecr) : null,
  }

  _agpdfCapa(ctx, relatorio, labelBacia, periodoTxt)
  _agpdfNovaPagina(ctx)
  if (!relatorio.pontos.length) {
    _agpdfParagrafo(ctx, 'Nenhuma coleta encontrada para esta bacia no período selecionado.')
  } else {
    relatorio.pontos.forEach(ponto => _agpdfSecaoPonto(ctx, ponto))
  }

  _agpdfAplicarCabecalhoRodapeGlobal(ctx, logos)
  return pdf
}

// Baixa o PDF já montado (sem preview — documento de registro, mesmo
// padrão de download direto usado no restante da mesa do módulo).
function aguaRelBaixarPdf(pdf, filename) {
  const url = URL.createObjectURL(pdf.output('blob'))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
