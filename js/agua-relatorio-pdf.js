// ── SIGUC-AC · Qualidade da Água — Relatório PDF por bacia (Fase 5) ─
// Documento de registro/fiscalização: tabela de coletas por ponto e
// campanha, com IQA e conformidade CONAMA lado a lado (nunca um
// escondendo o outro — regra do módulo, já em pages/agua-mapa.html).
// Também tem aguaRelMontarPdfColeta() — ficha de UMA coleta, usada
// pelo app de campo (pages/agua-app.html) para exportar/compartilhar
// ao tocar num card do Histórico. Mesmos primitivos de desenho.
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
// AGUA_REL_PARAM_LABEL, aguaRelFiltrosTxt() (js/agua-relatorio-dados.js);
// jsPDF + jspdf-autotable (js/vendor/jspdf-2.5.2.umd.min.js,
// js/vendor/jspdf-autotable-3.8.4.min.js).

// A paleta de faixa vem de js/agua-iqa-visual.js (AGUA_IQA_FAIXA_COR),
// convertida de hex para RGB — o PDF NÃO tem cópia própria.
// Antes tinha, e havia DIVERGIDO: 'Boa' era lima (#84CC16) enquanto o
// mapa/app/painel usavam verde (#059669), e 'Péssima' continuou no
// vermelho antigo depois da correção de daltonismo. Um relatório
// impresso com cor diferente da tela é o pior lugar para essa
// divergência aparecer. O fallback abaixo só existe para o caso de
// alguma página futura carregar este arquivo sem o de visual.
const AGPDF_IQA_COR_FALLBACK = {
  'Ótima': [29, 78, 216], 'Boa': [5, 150, 105], 'Regular': [202, 138, 4],
  'Ruim': [194, 65, 12], 'Péssima': [134, 25, 143],
}
const AGPDF_SEM_IQA_COR = [156, 163, 175]

function _agpdfHexRGB(hex) {
  const n = parseInt(String(hex).slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function _agpdfCorFaixa(faixa) {
  const paleta = typeof AGUA_IQA_FAIXA_COR !== 'undefined' ? AGUA_IQA_FAIXA_COR : null
  if (paleta && paleta[faixa]) return _agpdfHexRGB(paleta[faixa])
  return AGPDF_IQA_COR_FALLBACK[faixa] || AGPDF_SEM_IQA_COR
}
function _agpdfOrdemFaixas() {
  return typeof AGUA_IQA_FAIXA_ORDEM !== 'undefined'
    ? AGUA_IQA_FAIXA_ORDEM : ['Ótima', 'Boa', 'Regular', 'Ruim', 'Péssima']
}

// Mesmo rótulo estático de pages/agua-mapa.html/agua-pontos.html
// (CLASSE_LABEL) — duplicado aqui pela mesma razão de AGUA_REL_PARAM_LABEL
// em js/agua-relatorio-dados.js: não é cálculo, não entra na regra de
// centralização.
const AGPDF_CLASSE_LABEL = { especial: 'Especial', classe_1: 'Classe 1', classe_2: 'Classe 2', classe_3: 'Classe 3', classe_4: 'Classe 4' }

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

// ── Gráficos do painel, portados para o PDF ───────────────────────
// Mesmas leituras de pages/agua-relatorios.html, desenhadas com os
// primitivos do jsPDF (o projeto não tem lib de gráfico; converter o
// SVG da tela em imagem exigiria canvas/rasterização e sairia serrilhado
// no impresso). Os DADOS vêm das MESMAS funções de
// js/agua-relatorio-dados.js que alimentam a tela — nenhuma agregação
// nova aqui, e nada de IQA/CONAMA recalculado.
//
// Como na tela: a média de um ponto/campanha NUNCA é classificada numa
// faixa (isso é papel de agua_iqa_faixa() no banco), então as barras de
// magnitude usam um tom só; a paleta de faixa aparece apenas onde a
// faixa vem pronta do banco, na distribuição.

function _agpdfRotuloBloco(ctx, texto, x, largura) {
  const { pdf } = ctx
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(7.6); pdf.setTextColor(...AGPDF_COR.floresta)
  pdf.text(texto.toUpperCase(), x, ctx.y)
  pdf.setDrawColor(...AGPDF_COR.borda); pdf.setLineWidth(0.3)
  pdf.line(x, ctx.y + 1.6, x + largura, ctx.y + 1.6)
}

// Barra segmentada da distribuição por faixa + legenda com o número ao
// lado de cada cor (a cor nunca carrega o dado sozinha).
function _agpdfBarraFaixas(ctx, dist, x, y, largura) {
  const { pdf } = ctx
  const itens = _agpdfOrdemFaixas()
    .map(f => ({ label: f, n: dist.contagem[f] || 0, cor: _agpdfCorFaixa(f) }))
    .concat(dist.semIQA ? [{ label: 'Sem índice', n: dist.semIQA, cor: AGPDF_SEM_IQA_COR }] : [])
    .filter(i => i.n > 0)
  const total = itens.reduce((s, i) => s + i.n, 0)
  if (!total) {
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...AGPDF_COR.muted2)
    pdf.text('Nenhuma coleta com índice calculado no período.', x, y + 4)
    return 10
  }
  const alturaBarra = 4.4
  const gap = 0.7
  const util = largura - gap * (itens.length - 1)
  let cx = x
  itens.forEach(i => {
    const w = (i.n / total) * util
    pdf.setFillColor(...i.cor)
    pdf.roundedRect(cx, y, Math.max(w, 1.2), alturaBarra, 1, 1, 'F')
    cx += w + gap
  })
  // Legenda em até 3 colunas, quadradinho + rótulo + contagem
  const porCol = Math.ceil(itens.length / 3)
  const colW = largura / 3
  let yLeg = y + alturaBarra + 5
  itens.forEach((i, idx) => {
    const col = Math.floor(idx / porCol), lin = idx % porCol
    const lx = x + col * colW, ly = yLeg + lin * 4.4
    pdf.setFillColor(...i.cor); pdf.roundedRect(lx, ly - 2.2, 2.4, 2.4, 0.5, 0.5, 'F')
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7.4); pdf.setTextColor(...AGPDF_COR.texto)
    pdf.text(`${i.label}  ${i.n}`, lx + 3.6, ly)
  })
  return alturaBarra + 5 + porCol * 4.4
}

// Medidor semicircular segmentado (conformidade CONAMA) — mesma leitura
// do card da tela, inclusive o terceiro estado ("sem limites") ficando
// FORA do percentual e dito por extenso embaixo.
function _agpdfGauge(ctx, pct, cxm, y, largura) {
  const { pdf } = ctx
  const r = Math.min(largura / 2 - 2, 21)
  const cy = y + r
  const N = 26
  const temValor = pct != null && isFinite(pct)
  const acesos = temValor ? Math.round((Math.max(0, Math.min(100, pct)) / 100) * N) : 0
  pdf.setLineCap('round'); pdf.setLineWidth(1.7)
  for (let i = 0; i < N; i++) {
    const ang = Math.PI + Math.PI * ((i + 0.5) / N)
    const cos = Math.cos(ang), sin = Math.sin(ang)
    if (i < acesos) {
      const t = N === 1 ? 1 : i / (N - 1)
      pdf.setDrawColor(Math.round(127 - 96 * t), Math.round(212 - 134 * t), Math.round(168 - 124 * t))
    } else {
      pdf.setDrawColor(...AGPDF_COR.borda)
    }
    pdf.line(cxm + (r - 5) * cos, cy + (r - 5) * sin, cxm + r * cos, cy + r * sin)
  }
  pdf.setLineCap('butt'); pdf.setLineWidth(0.2)
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(17); pdf.setTextColor(...AGPDF_COR.floresta)
  pdf.text(temValor ? Math.round(pct) + '%' : '—', cxm, cy - 1, { align: 'center' })
  return r + 3
}

// Ranking de parâmetros que mais violaram (o card de lista da tela).
function _agpdfRanking(ctx, itens, totalAvaliadas, x, y, largura) {
  const { pdf } = ctx
  if (!itens.length) {
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...AGPDF_COR.muted2)
    const l = pdf.splitTextToSize('Nenhuma violação de limite CONAMA no período — ou nenhum ponto com limites cadastrados para a classe.', largura)
    pdf.text(l, x, y + 4)
    return l.length * 4.2 + 4
  }
  const alt = 7
  itens.forEach((v, i) => {
    const ly = y + i * alt
    pdf.setFillColor(...AGPDF_COR.claro); pdf.roundedRect(x, ly, largura, alt - 1.4, 1.2, 1.2, 'F')
    pdf.setFont('DMSans', 'bold'); pdf.setFontSize(7); pdf.setTextColor(...AGPDF_COR.muted)
    pdf.text(String(i + 1), x + 2.6, ly + 3.9, { align: 'center' })
    pdf.setFontSize(8); pdf.setTextColor(...AGPDF_COR.texto)
    pdf.text(v.label, x + 6, ly + 3.9)
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7.4); pdf.setTextColor(...AGPDF_COR.muted)
    const pctTxt = totalAvaliadas ? ` (${((v.n / totalAvaliadas) * 100).toFixed(0)}%)` : ''
    pdf.text(`${v.n} coleta(s)${pctTxt}`, x + largura - 2, ly + 3.9, { align: 'right' })
  })
  return itens.length * alt
}

// Barras verticais do IQA médio por ponto, com o valor rotulado acima
// e a maior destacada — magnitude, então um tom só (ver comentário do
// bloco). Ponto sem índice entra como barra vazia com "—".
function _agpdfBarrasPontos(ctx, itens, x, y, largura, altura) {
  const { pdf } = ctx
  if (!itens.length) return 0
  const n = itens.length
  const passo = largura / n
  const bw = Math.min(passo * 0.62, 14)
  const plotH = altura - 12
  const maior = Math.max(...itens.map(i => (i.valor == null ? 0 : i.valor)))
  itens.forEach((it, i) => {
    const bx = x + i * passo + (passo - bw) / 2
    const tem = it.valor != null && isFinite(it.valor)
    const h = tem ? Math.max(1.5, (Math.max(0, Math.min(100, it.valor)) / 100) * plotH) : 1.5
    const by = y + 8 + (plotH - h)
    if (tem && it.valor === maior) pdf.setFillColor(45, 106, 79)
    else if (tem) pdf.setFillColor(205, 233, 218)
    else pdf.setFillColor(243, 244, 246)
    pdf.roundedRect(bx, by, bw, h, 1.6, 1.6, 'F')
    pdf.setFont('DMSans', 'bold'); pdf.setFontSize(7); pdf.setTextColor(...AGPDF_COR.texto)
    pdf.text(tem ? it.valor.toFixed(1) : '—', bx + bw / 2, by - 1.6, { align: 'center' })
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(6.4); pdf.setTextColor(...AGPDF_COR.muted)
    const nome = pdf.splitTextToSize(it.label, passo - 1)[0]
    pdf.text(nome, bx + bw / 2, y + altura - 1, { align: 'center' })
  })
  return altura
}

// Evolução do IQA MÉDIO DA BACIA por campanha. Na tela o gráfico é de
// um ponto escolhido por chip; num documento não há chip, e imprimir um
// gráfico por ponto encheria o relatório — a média por campanha é a
// leitura equivalente para o período inteiro. Campanha sem coleta vira
// GAP (linha quebrada), nunca interpolada: lacuna de monitoramento é
// informação, mesma regra do ponto vazado no mapa.
function _agpdfLinhaCampanhas(ctx, serie, x, y, largura, altura) {
  const { pdf } = ctx
  const plotH = altura - 6
  const px = i => serie.length === 1 ? x + largura / 2 : x + (largura * i) / (serie.length - 1)
  const py = v => y + plotH * (1 - Math.max(0, Math.min(100, v)) / 100)

  pdf.setDrawColor(...AGPDF_COR.borda); pdf.setLineWidth(0.2)
  ;[0, 25, 50, 75, 100].forEach(v => {
    pdf.line(x, py(v), x + largura, py(v))
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(6); pdf.setTextColor(...AGPDF_COR.muted2)
    pdf.text(String(v), x - 1.5, py(v) + 1, { align: 'right' })
  })

  pdf.setDrawColor(148, 163, 184); pdf.setLineWidth(0.5)
  for (let i = 1; i < serie.length; i++) {
    if (serie[i - 1].iqaMedio == null || serie[i].iqaMedio == null) continue
    pdf.line(px(i - 1), py(serie[i - 1].iqaMedio), px(i), py(serie[i].iqaMedio))
  }
  serie.forEach((s, i) => {
    if (s.iqaMedio == null) {
      pdf.setDrawColor(...AGPDF_SEM_IQA_COR); pdf.setLineWidth(0.3)
      pdf.circle(px(i), py(50), 1.1, 'S')
    } else {
      pdf.setFillColor(45, 106, 79)
      pdf.circle(px(i), py(s.iqaMedio), 1.3, 'F')
    }
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(6.2); pdf.setTextColor(...AGPDF_COR.muted)
    pdf.text(s.labelCurto, px(i), y + altura, { align: 'center' })
  })
  return altura
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
  ctx.y += 6

  // Filtros de busca ativos (rio/status/faixa IQA/CONAMA) além de bacia
  // e campanha — mostrados logo na capa, pra ninguém confundir este
  // documento com "a bacia inteira" quando ele foi recortado.
  const filtrosTxt = aguaRelFiltrosTxt(relatorio.filtros)
  if (filtrosTxt) {
    pdf.setFont('DMSans', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...AGPDF_COR.floresta)
    pdf.text(`Filtros aplicados: ${filtrosTxt}`, ctx.W / 2, ctx.y, { align: 'center' })
    ctx.y += 24
  } else {
    ctx.y += 24
  }

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
        data.cell.styles.textColor = _agpdfCorFaixa(c.iqa_faixa)
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

// ── Ficha de UMA coleta — usada pelo app de campo (toque no card do
// Histórico em pages/agua-app.html) para exportar/compartilhar. Uma
// página normalmente (só estoura pra 2 se "Observações" for longo);
// não tem capa como o relatório por bacia, o título já é a própria
// coleta. Reaproveita os MESMOS primitivos de desenho (_agpdfTitulo,
// _agpdfParagrafo, _agpdfTabela, cabeçalho/rodapé) — nunca uma segunda
// implementação de layout de PDF neste módulo.
function _agpdfCartaoDuplo(ctx, esquerda, direita) {
  const { pdf } = ctx
  const colW = (ctx.W - AGPDF_M * 2 - 8) / 2
  _agpdfGarantirEspaco(ctx, 26)
  const y0 = ctx.y
  ;[[AGPDF_M, esquerda], [AGPDF_M + colW + 8, direita]].forEach(([x, cartao]) => {
    pdf.setDrawColor(...AGPDF_COR.borda); pdf.setLineWidth(0.3)
    pdf.roundedRect(x, y0, colW, 24, 1.5, 1.5)
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...AGPDF_COR.muted)
    pdf.text(cartao.titulo, x + 4, y0 + 7)
    pdf.setFont('DMSans', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...(cartao.cor || AGPDF_COR.texto))
    pdf.text(cartao.valor, x + 4, y0 + 16)
    if (cartao.sub) {
      pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...AGPDF_COR.muted)
      const linhasSub = pdf.splitTextToSize(cartao.sub, colW - 8)
      pdf.text(linhasSub[0], x + 4, y0 + 21)
    }
  })
  ctx.y = y0 + 24 + 6
}

async function aguaRelMontarPdfColeta(coleta, cab, protocolo) {
  await _agpdfCarregarLibs()
  const pdf = _agpdfNovoDocumento()
  const ctx = _agpdfCtx(pdf, cab, protocolo)

  const logos = {
    gov: cab.logoGoverno ? await _agpdfBuscarDataURL(cab.logoGoverno) : null,
    secr: cab.logoSecr ? await _agpdfBuscarDataURL(cab.logoSecr) : null,
  }

  ctx.y = 34
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...AGPDF_COR.muted2)
  pdf.text('FICHA DE COLETA — QUALIDADE DA ÁGUA', AGPDF_M, ctx.y)
  ctx.y += 9
  pdf.setFontSize(16); pdf.setTextColor(...AGPDF_COR.floresta)
  pdf.text(`${coleta.ponto_nome}${coleta.codigo_ana ? ' — ' + coleta.codigo_ana : ''}`, AGPDF_M, ctx.y)
  ctx.y += 6
  const sub = [coleta.ponto_rio, coleta.ponto_municipio, AGPDF_CLASSE_LABEL[coleta.classe_enquadramento] || coleta.classe_enquadramento].filter(Boolean).join(' · ')
  if (sub) {
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...AGPDF_COR.muted)
    pdf.text(sub, AGPDF_M, ctx.y)
    ctx.y += 8
  } else ctx.y += 4

  _agpdfParagrafo(ctx, `${aguaRelLabelCampanha(coleta)} · Coletado em ${formatData(coleta.data_coleta)}${coleta.hora_coleta ? ' às ' + String(coleta.hora_coleta).slice(0, 5) : ''} · Coletor: ${coleta.coletor_nome || '—'} · Laboratório: ${coleta.laboratorio_nome || '—'}`, { bold: true })
  if (coleta.status === 'quarentena') {
    _agpdfParagrafo(ctx, `Em conferência (quarentena)${coleta.quarentena_motivo ? ': ' + coleta.quarentena_motivo : ''} — IQA e conformidade abaixo são preliminares, pendentes de validação da equipe técnica.`, { muted: true })
  }

  const semLimites = coleta.conama_violacoes == null
  const violou = !semLimites && coleta.conama_violacoes.length > 0
  _agpdfCartaoDuplo(ctx,
    {
      titulo: 'IQA',
      valor: coleta.iqa != null ? Number(coleta.iqa).toFixed(1) : '—',
      sub: coleta.iqa_faixa || 'Sem dado suficiente',
      cor: _agpdfCorFaixa(coleta.iqa_faixa),
    },
    {
      titulo: 'CONFORMIDADE CONAMA',
      valor: semLimites ? 'Sem limites' : (violou ? `${coleta.conama_violacoes.length} violação(ões)` : 'Conforme'),
      sub: violou ? coleta.conama_violacoes.map(v => AGUA_REL_PARAM_LABEL[v] || v).join(', ')
        : (semLimites ? `Classe ${AGPDF_CLASSE_LABEL[coleta.classe_enquadramento] || coleta.classe_enquadramento || '—'} sem limites cadastrados` : ''),
      cor: violou ? [185, 28, 28] : (semLimites ? AGPDF_SEM_IQA_COR : [21, 128, 61]),
    })

  const linhasParam = Object.entries(AGUA_REL_PARAM_LABEL)
    .filter(([campo]) => coleta[campo] != null)
    .map(([campo, rotulo]) => [rotulo, Number(coleta[campo]).toLocaleString('pt-BR', { maximumFractionDigits: 2 }), coleta.conama_violacoes?.includes(campo) ? 'Fora do limite' : ''])

  if (linhasParam.length) {
    _agpdfTitulo(ctx, 'Parâmetros medidos')
    _agpdfTabela(ctx, {
      head: [['Parâmetro', 'Valor', '']],
      body: linhasParam,
      columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 40, halign: 'right' }, 2: { cellWidth: 'auto' } },
      didParseCell: data => {
        if (data.section !== 'body') return
        if (linhasParam[data.row.index][2]) {
          data.cell.styles.textColor = [185, 28, 28]
          if (data.column.index !== 1) data.cell.styles.fontStyle = 'bold'
        }
      },
    })
  } else {
    _agpdfParagrafo(ctx, 'Nenhum parâmetro numérico registrado ainda — aguardando laudo do laboratório.', { muted: true })
  }

  if (coleta.observacoes) {
    _agpdfTitulo(ctx, 'Observações')
    _agpdfParagrafo(ctx, coleta.observacoes)
  }
  if (coleta.codigo_amostra) {
    _agpdfParagrafo(ctx, `Amostra: ${coleta.codigo_amostra}`, { muted: true })
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
