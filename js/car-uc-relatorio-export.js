// ── SIGUC-AC · Relatório "CAR na UC" — exportação (PDF e Excel) ───────
// Reaproveita os primitivos do PDF da Qualidade da Água (mesmo caminho
// que js/rh-relatorio-pdf.js já usa): timbre institucional único
// (js/relatorio-cabecalho-pdf.js — logo do Acre à esquerda, SEMA à
// direita, proporção preservada), tabela com autotable, rodapé com
// página e protocolo. Nenhuma segunda implementação de layout de PDF.
//
// A lista de colunas é a MESMA do CSV (carucColunasExportacao em
// js/car-uc-relatorio.js) — as três saídas nunca divergem.
//
// Depende de: js/car-uc-relatorio.js, js/config-sistema.js,
// js/biomonitor-pdf-fonts.js, js/relatorio-cabecalho-pdf.js,
// js/agua-relatorio-pdf.js (e jsPDF/ExcelJS vendorizados, sob demanda).

const CARUC_PDF_MODULO = 'monitoramento' // dono do grupo Gestão → DEUC no timbre

function _carucPdfNovoDocumento() {
  const { jsPDF } = window.jspdf
  // Paisagem: a tabela de imóveis tem 10+ colunas.
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  pdf.addFileToVFS('DMSans-Regular.ttf', BIOPDF_FONT_REGULAR_B64)
  pdf.addFont('DMSans-Regular.ttf', 'DMSans', 'normal')
  pdf.addFileToVFS('DMSans-Bold.ttf', BIOPDF_FONT_BOLD_B64)
  pdf.addFont('DMSans-Bold.ttf', 'DMSans', 'bold')
  pdf.setFont('DMSans', 'normal')
  return pdf
}

const _carucN = (v, c = 2) => carucFormatarValor(v, c)

function _carucTabelaContagem(ctx, titulo, lista, rotuloCol) {
  if (!lista?.length) return
  _agpdfTitulo(ctx, titulo)
  _agpdfTabela(ctx, {
    head: [[rotuloCol, 'Imóveis', 'Área sobreposta (ha)']],
    body: lista.map(g => [g.rotulo, String(g.n), _carucN(g.ha)]),
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  })
}

async function carucMontarPdf(rel, protocolo) {
  await _agpdfCarregarLibs()
  const cab = await getCabecalhoRelatorio(CARUC_PDF_MODULO)
  const pdf = _carucPdfNovoDocumento()
  const ctx = _agpdfCtx(pdf, cab, protocolo)
  ctx.linhaModulo = 'Unidades de Conservação · CAR'
  const { uc, resumo: r, opcoes: o } = rel

  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(14); pdf.setTextColor(...AGPDF_COR.floresta)
  pdf.text(`Imóveis do CAR na UC — ${uc.nome}`, AGPDF_M, ctx.y + 2)
  ctx.y += 9

  _agpdfTabela(ctx, {
    body: [
      ['Unidade de conservação', `${uc.nome} (${uc.codigo || '—'})`],
      ['Categoria / esfera', `${uc.sigla || uc.categoria || '—'} · ${uc.esfera || '—'}`],
      ['Área oficial', uc.area_ha ? _carucN(uc.area_ha, 0) + ' ha' : '—'],
      ['Criação', uc.data_criacao ? uc.data_criacao.split('-').reverse().join('/') : '—'],
      ['Base do CAR', `SICAR (consulta ao vivo em ${new Date(rel.gerado_em).toLocaleString('pt-BR')}) + planilha SICAR local`],
      ['Recorte', rel.zoneamento.usouZa ? 'Imóveis na UC e imóveis só na zona de amortecimento' : 'Imóveis que se sobrepõem à UC'],
    ],
    theme: 'plain',
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
  })

  _agpdfTitulo(ctx, 'Enquadramento pela categoria da UC')
  _agpdfParagrafo(ctx, `${rel.enquadramento.rotulo}. ${rel.enquadramento.texto}`)

  _agpdfTitulo(ctx, 'Resumo')
  const linhasResumo = [
    ['Imóveis que se sobrepõem à UC', String(r.na_uc)],
    ['Soma das áreas sobrepostas', `${_carucN(r.soma_sobreposicao_ha)} ha${r.pct_soma_da_uc != null ? ` (${_carucN(r.pct_soma_da_uc, 1)}% da área da UC)` : ''}`],
    ['Imóveis com ponto de atenção', String(r.com_atencao)],
    ['Imóveis sem dados na planilha local', String(r.sem_planilha)],
  ]
  if (rel.zoneamento.usouZa) linhasResumo.splice(1, 0, ['Imóveis só na zona de amortecimento', String(r.so_za)])
  if (o.focos) linhasResumo.push([`Focos de calor ${o.focosDe}–${o.focosAte} (na parte do imóvel na UC/ZA)`, _carucN(r.focos_total, 0)])
  if (o.deter) linhasResumo.push(['Alertas DETER (desde jun/2026)', `${_carucN(r.deter_alertas, 0)} · ${_carucN(r.deter_ha)} ha`])
  if (o.prodes) linhasResumo.push(['PRODES: desmatado após 22/07/2008 · série 2008+ · até 2007', `${_carucN(r.prodes_pos_marco_ha)} ha · ${_carucN(r.prodes_total_ha)} ha · ${_carucN(r.prodes_ate2007_ha)} ha`])
  _agpdfTabela(ctx, { body: linhasResumo, theme: 'plain', columnStyles: { 0: { cellWidth: 120 }, 1: { fontStyle: 'bold' } } })
  _agpdfParagrafo(ctx, 'A soma das áreas pode passar da área real ocupada: imóveis do CAR se sobrepõem entre si com frequência.', { muted: true })

  _agpdfTitulo(ctx, 'Zonas de manejo')
  if (!rel.zoneamento.tem) {
    _agpdfParagrafo(ctx, 'UC sem zoneamento cadastrado no sistema — não é possível comparar os imóveis com as zonas de manejo.', { muted: true })
  } else {
    _agpdfParagrafo(ctx, `Fonte: ${rel.zoneamento.fonte}.`, { muted: true })
    if (r.por_zona.length) {
      _agpdfTabela(ctx, {
        head: [['Zona', 'Enquadramento', 'Imóveis', 'Área sobreposta (ha)']],
        body: r.por_zona.map(z => [z.nome, carucEnquadrarZona(z.codigo, z.nome).rotulo, String(z.n), _carucN(z.ha)]),
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      })
    }
    if (r.sem_zona) _agpdfParagrafo(ctx, `${r.sem_zona} imóvel(is) na UC fora de qualquer zona cadastrada.`, { muted: true })
  }

  _carucTabelaContagem(ctx, 'Por situação do cadastro', r.por_situacao, 'Situação')
  _carucTabelaContagem(ctx, 'Por classe SICAR', r.por_classe, 'Classe')
  _carucTabelaContagem(ctx, 'Por tipo de imóvel', r.por_tipo, 'Tipo')
  _carucTabelaContagem(ctx, 'Por tamanho (módulos fiscais)', r.por_faixa, 'Faixa')

  // Relação completa — nova página, mesmas colunas do CSV/Excel.
  _agpdfNovaPagina(ctx)
  _agpdfTitulo(ctx, `Relação dos imóveis (${rel.imoveis.length})`)
  const cols = carucColunasExportacao(rel).filter(c => !['Localização', 'Status', 'Módulos fiscais'].includes(c.rotulo) || (c.rotulo === 'Localização' && rel.zoneamento.usouZa))
  _agpdfTabela(ctx, {
    head: [cols.map(c => c.rotulo)],
    body: rel.imoveis.map(i => cols.map(c => carucFormatarValor(c.valor(i), c.casas))),
    styles: { font: 'DMSans', fontSize: 6.2, cellPadding: 1, overflow: 'linebreak', lineColor: AGPDF_COR.borda, lineWidth: 0.1 },
    headStyles: { fillColor: AGPDF_COR.floresta, textColor: 255, fontStyle: 'bold', fontSize: 6 },
    columnStyles: Object.fromEntries(cols.map((c, k) => [k, c.casas != null ? { halign: 'right' } : {}])),
  })

  _agpdfTitulo(ctx, 'Notas')
  const notas = [
    'Geometria dos imóveis: WFS público do SICAR, consultado no momento da geração. Atributos cadastrais: planilha SICAR local importada no sistema; CPF/CNPJ sempre mascarado. A consulta foi registrada no log de acesso a dado de terceiro (LGPD).',
    'Área na UC/ZA: interseção do polígono do imóvel com o limite da UC (ou da zona de amortecimento), calculada no sistema.',
  ]
  if (o.focos) notas.push(`Focos: mesma série da linha do tempo do mapa — temporada de fogo (1º/jul a 4/nov), VIIRS S-NPP + MODIS; antes de 2012 não é comparável (entrada do VIIRS).`)
  if (o.deter) notas.push('DETER: alertas gravados no sistema, que começam em jun/2026.')
  if (o.prodes) notas.push('PRODES/INPE (TerraBrasilis): o ano PRODES vai de agosto a julho; "após o marco" soma os anos 2009 em diante, os primeiros inteiramente posteriores a 22/07/2008 (Lei 12.651/2012). "Até 2007" é a camada de desmatamento acumulado do INPE.')
  if (rel.falhas.prodes) notas.push(`ATENÇÃO: ${rel.falhas.prodes} de ${rel.falhas.prodes_quadrantes} quadrantes do PRODES não responderam — os valores de PRODES podem estar incompletos.`)
  if (rel.falhas.ambiental) notas.push(`ATENÇÃO: focos/DETER não puderam ser calculados para ${rel.falhas.ambiental} imóvel(is).`)
  notas.forEach(n => _agpdfParagrafo(ctx, n, { muted: true }))

  const logos = {
    gov: cab.logoGoverno ? await _agpdfBuscarDataURL(cab.logoGoverno) : null,
    secr: cab.logoSecr ? await _agpdfBuscarDataURL(cab.logoSecr) : null,
  }
  _agpdfAplicarCabecalhoRodapeGlobal(ctx, logos)
  return pdf
}

// ── Excel (ExcelJS — nunca SheetJS, ver CLAUDE.md) ──────────────────
let _carucXlsxPromise = null
function _carucCarregarExcel() {
  if (window.ExcelJS) return Promise.resolve()
  if (_carucXlsxPromise) return _carucXlsxPromise
  _carucXlsxPromise = new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = '../js/vendor/exceljs-4.4.0.bare.min.js'
    s.onload = res; s.onerror = () => { _carucXlsxPromise = null; rej(new Error('Falha ao carregar a biblioteca de planilha.')) }
    document.head.appendChild(s)
  })
  return _carucXlsxPromise
}

async function carucMontarXlsx(rel) {
  await _carucCarregarExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'SIGUC-AC'
  const cols = carucColunasExportacao(rel)
  const ws = wb.addWorksheet('Imóveis', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = cols.map(c => ({ header: c.rotulo, key: c.rotulo, width: Math.min(48, Math.max(12, c.rotulo.length + 4)) }))
  for (const i of rel.imoveis) {
    const linha = ws.addRow(cols.map(c => {
      const v = c.valor(i)
      return c.casas != null && v != null ? Number(v) : (v ?? '')
    }))
    cols.forEach((c, k) => { if (c.casas != null) linha.getCell(k + 1).numFmt = c.casas ? '#,##0.' + '0'.repeat(c.casas) : '#,##0' })
  }
  const cab = ws.getRow(1)
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1A0F' } }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }

  const r = rel.resumo
  const wr = wb.addWorksheet('Resumo')
  wr.columns = [{ width: 48 }, { width: 18 }, { width: 22 }]
  const add = (a, b, c) => wr.addRow([a, b ?? '', c ?? ''])
  const titulo = t => { const row = add(t); row.font = { bold: true }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5EE' } } }
  titulo(`Imóveis do CAR na UC — ${rel.uc.nome}`)
  add('Gerado em', new Date(rel.gerado_em).toLocaleString('pt-BR'))
  add('Enquadramento da categoria', rel.enquadramento.rotulo)
  add('Imóveis na UC', r.na_uc)
  if (rel.zoneamento.usouZa) add('Imóveis só na zona de amortecimento', r.so_za)
  add('Soma das áreas sobrepostas (ha)', Number(r.soma_sobreposicao_ha.toFixed(2)))
  add('Imóveis com ponto de atenção', r.com_atencao)
  add('Zoneamento', rel.zoneamento.tem ? rel.zoneamento.fonte : 'UC sem zoneamento cadastrado')
  const bloco = (t, lista, rot) => {
    if (!lista?.length) return
    add(''); titulo(t); add(rot, 'Imóveis', 'Área sobreposta (ha)').font = { bold: true }
    lista.forEach(g => add(g.rotulo || g.nome, g.n, Number(g.ha.toFixed(2))))
  }
  bloco('Por zona de manejo', r.por_zona.map(z => ({ rotulo: z.nome, n: z.n, ha: z.ha })), 'Zona')
  bloco('Por situação', r.por_situacao, 'Situação')
  bloco('Por classe SICAR', r.por_classe, 'Classe')
  bloco('Por tipo de imóvel', r.por_tipo, 'Tipo')
  bloco('Por tamanho (módulos fiscais)', r.por_faixa, 'Faixa')

  return wb.xlsx.writeBuffer()
}

function carucBaixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

function carucNomeArquivo(rel, ext) {
  const slug = carucNorm(rel.uc.nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `car-na-uc_${slug}_${rel.gerado_em.slice(0, 10)}.${ext}`
}
