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
      ['Filtros aplicados', rel.filtros?.length ? `${rel.filtros.join(' · ')} — ${rel.imoveis.length} de ${rel.total_sem_filtro} imóveis` : 'Nenhum (relação completa)'],
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
    ['Titulares com mais de um CAR nesta UC (imóveis)', `${r.titulares_multi} (${r.imoveis_titular_multi})`],
    ['Possível fracionamento · mesmo nome com documento diferente', `${r.fracionamento} · ${r.homonimos}`],
    ['Imóveis com sobreposição entre CARs (≥ 0,1 ha)', String(r.com_sobreposicao)],
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

  _carucTabelaContagem(ctx, 'Prioridade para fiscalização', r.por_prioridade.filter(p => p.n), 'Prioridade')
  _carucTabelaContagem(ctx, 'Quanto do imóvel está na UC', r.por_faixa_uc, 'Faixa')
  _carucTabelaContagem(ctx, 'Por município', r.por_municipio, 'Município')
  _carucTabelaContagem(ctx, 'Por situação do cadastro', r.por_situacao, 'Situação')
  _carucTabelaContagem(ctx, 'Por classe SICAR', r.por_classe, 'Classe')
  _carucTabelaContagem(ctx, 'Por tipo de imóvel', r.por_tipo, 'Tipo')
  _carucTabelaContagem(ctx, 'Por tamanho (módulos fiscais)', r.por_faixa, 'Faixa')

  // Relação completa — nova página. O PDF leva uma tabela de LEITURA
  // (11 colunas, larguras fixas, texto longo numa linha própria por
  // imóvel); Excel/CSV continuam com todas as colunas separadas.
  _agpdfNovaPagina(ctx)
  _agpdfTitulo(ctx, `Relação dos imóveis (${rel.imoveis.length})`)
  const agrupado = !!(rel.agrupado && rel.grupos)
  const cols = _carucPdfColunas(rel, agrupado)
  const estiloRel = {
    styles: { font: 'DMSans', fontSize: 6.4, cellPadding: 1.1, overflow: 'linebreak', lineColor: AGPDF_COR.borda, lineWidth: 0.1, valign: 'top' },
    headStyles: { fillColor: AGPDF_COR.floresta, textColor: 255, fontStyle: 'bold', fontSize: 6.2 },
    alternateRowStyles: {},
  }
  const corpoImoveis = (lista, pinos) => lista.flatMap((i, k) => {
    const linha = cols.map(c => c.valor(i, pinos?.[k]))
    const nota = _carucPdfNota(i)
    return nota ? [linha, [{ content: nota, colSpan: cols.length, styles: { fontSize: 5.8, textColor: AGPDF_COR.muted, cellPadding: { top: 0.4, bottom: 1.4, left: 2.4, right: 1.1 } } }]] : [linha]
  })
  const tabelaImoveis = (lista, pinos) => _agpdfTabela(ctx, {
    ...estiloRel,
    head: [cols.map(c => c.rotulo)],
    body: corpoImoveis(lista, pinos),
    columnStyles: Object.fromEntries(cols.map((c, k) => [k, { cellWidth: c.largura ?? 'auto', halign: c.direita ? 'right' : 'left' }])),
  })
  let usouSatelite = false
  if (agrupado) {
    // Agrupado: um bloco por titular, na ordem da tela — cabeçalho, mapa
    // (2+ CARs, o MESMO SVG da tela rasterizado) e os imóveis dele.
    const fundo = o.fundoMapa || 'satelite'
    const comMapa = typeof carucMapaGrupo === 'function'
    const acre = comMapa && rel.grupos.some(g => g.fora?.length) ? await carucMapaAcre() : null
    for (const g of rel.grupos) {
      const temMapa = comMapa && carucMapaGrupoTemMapa(g)
      _agpdfTabela(ctx, { body: [[carucGrupoRotulo(g)]], theme: 'plain',
        styles: { font: 'DMSans', fontStyle: 'bold', fontSize: 7.4, fillColor: [232, 245, 238], textColor: AGPDF_COR.floresta, cellPadding: 1.6 } })
      ctx.y -= 4
      if (temMapa) usouSatelite = (await _carucPdfMapaGrupo(ctx, rel, g, fundo, acre)) || usouSatelite
      let n = 0
      tabelaImoveis(g.imoveis, temMapa ? g.imoveis.map(i => i._mapa ? String(++n) : '') : null)
      if (temMapa && g.fora?.length) {
        const fora = g.fora.slice(0, 30)
        _agpdfTabela(ctx, {
          ...estiloRel,
          head: [['Nº', 'Fora da UC · mesmo titular · Nº do CAR', 'Imóvel', 'Município', 'Situação', 'Área declarada (ha)']],
          headStyles: { ...estiloRel.headStyles, fillColor: [146, 64, 14] },
          body: fora.map((f, k) => ['F' + (k + 1), f.cod, f.nome_imovel || '—', f.municipio || '—', f.situacao || '—', _carucN(f.area_declarada_ha)]),
          columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 62 }, 5: { halign: 'right', cellWidth: 26 } },
        })
        if (g.fora.length > fora.length) _agpdfParagrafo(ctx, `… e mais ${g.fora.length - fora.length} CAR(s) deste titular fora da UC — todos estão no mapa e na planilha Excel (aba "Fora da UC").`, { muted: true })
      }
    }
  } else {
    tabelaImoveis(rel.imoveis, null)
  }

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
  notas.push('Prioridade — Alta: UC de proteção integral ou zona de proteção, com desmatamento PRODES após 2008 ou alerta DETER (só quando pedidos). Média: CAR em proteção integral, zona de proteção, imóvel particular em UC de domínio público, inscrição após a criação da UC, possível fracionamento, classe Vermelho ou sobreposição com outro CAR. Baixa: nenhum desses.')
  notas.push('Titular: o agrupamento por CPF/CNPJ é feito no servidor e o número do titular vale só neste relatório. Possível fracionamento: mesmo CPF com 2 ou mais imóveis de até 4 módulos fiscais somando mais de 4. Sobreposição entre CARs conta a partir de 0,1 ha.')
  if (rel.agrupado) notas.push(`Mapa por titular (2 ou mais CARs no recorte): o número no polígono é o da linha da tabela. ${o.foraUc ? 'F1, F2… são CARs do mesmo CPF/CNPJ fora da UC — não entram em nenhum total da UC; a consulta registrou cada um no log de acesso a dado de terceiro (LGPD).' : 'Os CARs do mesmo titular fora da UC não foram pedidos nesta consulta.'}`)
  if (usouSatelite) notas.push(CARUC_MAPA_CREDITO + '.')
  notas.forEach(n => _agpdfParagrafo(ctx, n, { muted: true }))

  const logos = {
    gov: cab.logoGoverno ? await _agpdfBuscarDataURL(cab.logoGoverno) : null,
    secr: cab.logoSecr ? await _agpdfBuscarDataURL(cab.logoSecr) : null,
  }
  _agpdfAplicarCabecalhoRodapeGlobal(ctx, logos)
  return pdf
}

// ── Tabela de leitura do PDF ─────────────────────────────────────────
// 11 colunas no máximo, larguras fixas (paisagem: 267 mm úteis). Agrupado:
// titular/CPF/CARs saem da linha — já estão no cabeçalho do grupo. Focos,
// DETER e PRODES viram UMA coluna "Ambiental", só quando pedidos.
function _carucPdfColunas(rel, agrupado) {
  const o = rel.opcoes || {}
  const n2 = v => _carucN(v)
  const amb = o.focos || o.deter || o.prodes
  const cols = []
  if (agrupado) cols.push({ rotulo: 'Nº', largura: 7, valor: (i, pino) => pino || '' })
  cols.push({ rotulo: 'Nº do CAR', largura: 40,
    valor: i => i.cod + (rel.zoneamento?.usouZa && i.local !== 'uc' ? '\n(só na zona de amortecimento)' : '') })
  cols.push(agrupado
    ? { rotulo: 'Imóvel', valor: i => i.nome_imovel || '—' }
    : { rotulo: 'Imóvel / titular', valor: i => [i.nome_imovel || '—', [i.titular, i.documento].filter(Boolean).join(' · ')].filter(Boolean).join('\n') })
  cols.push({ rotulo: 'Município', largura: 20, valor: i => i.municipio || '—' })
  cols.push({ rotulo: 'Situação / classe', largura: 25, valor: i => [i.situacao || '—', i.classe].filter(Boolean).join('\n') })
  cols.push({ rotulo: 'Tipo', largura: 17, valor: i => carucTipoImovel(i.tipo_imovel) })
  cols.push({ rotulo: 'Área na UC (ha · %)', largura: 19, direita: true,
    valor: i => `${n2(i.area_analise_ha)}${i.pct_analise != null ? `\n${carucFormatarValor(i.pct_analise, 1)}%` : ''}` })
  cols.push({ rotulo: 'Zonas', valor: i => (i.zonas || []).map(z => z.nome).join('; ') || '—' })
  cols.push({ rotulo: 'Inscrição', largura: 15, valor: i => i.data_inscricao ? i.data_inscricao.split('-').reverse().join('/') : '—' })
  if (amb) cols.push({ rotulo: 'Ambiental', largura: 34, valor: i => {
    const p = []
    if (o.focos) p.push(`Focos ${o.focosDe}–${o.focosAte}: ${i.ambiental ? carucFormatarValor(i.ambiental.focos_periodo, 0) : '—'}`)
    if (o.deter) p.push(`DETER: ${i.ambiental ? `${carucFormatarValor(i.ambiental.deter_alertas, 0)} (${n2(i.ambiental.deter_ha)} ha)` : '—'}`)
    if (o.prodes) p.push(`PRODES pós-2008: ${i.prodes ? n2(i.prodes.pos_marco_ha) + ' ha' : '—'}`)
    return p.join('\n')
  } })
  cols.push({ rotulo: 'Prioridade', largura: 15, valor: i => CARUC_PRIORIDADE_ROTULO[i.prioridade?.nivel] || '—' })
  return cols
}

// Linha própria, de largura inteira, abaixo do imóvel: o texto longo que
// espremido numa coluna virava uma letra por linha.
function _carucPdfNota(i) {
  const partes = []
  if (i.prioridade?.motivos?.length) partes.push('Motivo: ' + i.prioridade.motivos.join('; '))
  if (i.atencoes?.length) partes.push('Atenção: ' + i.atencoes.join('; '))
  if (i.sobreposicoes?.length) partes.push('Sobrepõe: ' + i.sobreposicoes.slice(0, 4).map(s => `${s.cod} (${_carucN(s.ha)} ha${s.mesmo_titular ? ', mesmo titular' : ''})`).join('; ')
    + (i.sobreposicoes.length > 4 ? ` e mais ${i.sobreposicoes.length - 4}` : ''))
  return partes.join('   ·   ')
}

// Mapa do titular no PDF: zoom nos CARs + UC inteira (+ Acre quando há
// CARs de fora), lado a lado, 66 mm de altura — cabe na paisagem com
// folga. Devolve true se o satélite entrou.
async function _carucPdfMapaGrupo(ctx, rel, g, fundo, acre) {
  const ALT = 66
  try {
    const m = await carucMapaGrupo(rel, g, fundo, acre)
    const sat = fundo === 'satelite' && !m.semSatelite
    const imgs = []
    for (const svg of [m.zoom, m.uc, m.acre]) if (svg) imgs.push(await carucMapaSvgParaImagem(svg, 2, sat))
    if (!imgs.length) return false
    _agpdfGarantirEspaco(ctx, ALT + 8)
    let x = AGPDF_M
    for (const im of imgs) {
      const w = ALT * im.w / im.h
      ctx.pdf.addImage(im.dataUrl, sat ? 'JPEG' : 'PNG', x, ctx.y, w, ALT)
      ctx.pdf.setDrawColor(...AGPDF_COR.borda); ctx.pdf.setLineWidth(0.2); ctx.pdf.rect(x, ctx.y, w, ALT)
      x += w + 3
    }
    ctx.y += ALT + 3.5
    ctx.pdf.setFont('DMSans', 'normal'); ctx.pdf.setFontSize(6.6); ctx.pdf.setTextColor(...AGPDF_COR.muted)
    const leg = ['1º quadro: CARs do titular ampliados (nº = coluna "Nº")', '2º: UC inteira, retângulo = área ampliada', 'traço contínuo: limite da UC']
    if (rel.geo?.zonas?.length) leg.push('tracejado: zonas de manejo')
    if (m.acre) leg.push('3º: Acre, pontos F1, F2… = CARs do mesmo titular fora da UC')
    if (m.semSatelite) leg.push('imagem de satélite indisponível na geração — sem fundo')
    ctx.pdf.text(leg.join(' · '), AGPDF_M, ctx.y)
    ctx.y += 4
    return sat
  } catch (e) {
    console.warn('[caruc] mapa do titular no PDF', e)
    _agpdfParagrafo(ctx, 'Mapa do titular indisponível nesta geração.', { muted: true })
    return false
  }
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

  // Agrupado: a aba "Imóveis" continua com UMA linha por imóvel (linha de
  // cabeçalho no meio quebraria o filtro e a ordenação da planilha), já
  // na ordem por titular, e o resumo por titular vai numa aba própria.
  if (rel.agrupado && rel.grupos) {
    const wt = wb.addWorksheet('Titulares', { views: [{ state: 'frozen', ySplit: 1 }] })
    wt.columns = [
      { header: 'Titular nº', width: 11 }, { header: 'Titular', width: 36 }, { header: 'CPF/CNPJ (mascarado)', width: 22 },
      { header: 'Imóveis no recorte', width: 16 }, { header: 'CARs nesta UC', width: 14 }, { header: 'CARs no Acre', width: 13 },
      { header: 'Área na UC/ZA (ha)', width: 17 }, { header: 'Nº dos CAR', width: 60 },
      { header: 'CARs fora da UC', width: 15 },
    ]
    for (const g of rel.grupos) {
      const l = wt.addRow([g.grupo ?? '', g.titular || (g.grupo == null ? 'Sem titular identificado' : ''), g.documento || '',
        g.imoveis.length, g.cars_uc ?? '', g.cars_estado ?? '', Number(g.ha.toFixed(2)), g.imoveis.map(i => i.cod).join('; '),
        rel.opcoes.foraUc && g.grupo != null ? (g.fora?.length || 0) : ''])
      l.getCell(7).numFmt = '#,##0.00'
    }
    const ct = wt.getRow(1)
    ct.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ct.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1A0F' } }

    const comFora = rel.grupos.filter(g => g.grupo != null && g.fora?.length)
    if (comFora.length) {
      // Lista COMPLETA (a tela e o PDF mostram as 30 primeiras por titular).
      const wf = wb.addWorksheet('Fora da UC', { views: [{ state: 'frozen', ySplit: 1 }] })
      wf.columns = [
        { header: 'Titular nº', width: 11 }, { header: 'Titular', width: 36 }, { header: 'No mapa', width: 9 },
        { header: 'Nº do CAR', width: 48 }, { header: 'Imóvel', width: 30 }, { header: 'Município', width: 20 },
        { header: 'Situação', width: 14 }, { header: 'Área declarada (ha)', width: 18 },
      ]
      for (const g of comFora) g.fora.forEach((f, k) => {
        const l = wf.addRow([g.grupo, g.titular || '', 'F' + (k + 1), f.cod, f.nome_imovel || '', f.municipio || '', f.situacao || '',
          f.area_declarada_ha != null ? Number(f.area_declarada_ha) : ''])
        l.getCell(8).numFmt = '#,##0.00'
      })
      const cf = wf.getRow(1)
      cf.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cf.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92400E' } }
      wf.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } }
    }
  }

  const r = rel.resumo
  const wr = wb.addWorksheet('Resumo')
  wr.columns = [{ width: 48 }, { width: 18 }, { width: 22 }]
  const add = (a, b, c) => wr.addRow([a, b ?? '', c ?? ''])
  const titulo = t => { const row = add(t); row.font = { bold: true }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5EE' } } }
  titulo(`Imóveis do CAR na UC — ${rel.uc.nome}`)
  add('Gerado em', new Date(rel.gerado_em).toLocaleString('pt-BR'))
  add('Filtros aplicados', rel.filtros?.length ? rel.filtros.join(' · ') : 'Nenhum (relação completa)')
  if (rel.filtros?.length) add('Imóveis no recorte', rel.imoveis.length, `de ${rel.total_sem_filtro}`)
  add('Enquadramento da categoria', rel.enquadramento.rotulo)
  add('Imóveis na UC', r.na_uc)
  if (rel.zoneamento.usouZa) add('Imóveis só na zona de amortecimento', r.so_za)
  add('Soma das áreas sobrepostas (ha)', Number(r.soma_sobreposicao_ha.toFixed(2)))
  add('Imóveis com ponto de atenção', r.com_atencao)
  add('Titulares com mais de um CAR nesta UC', r.titulares_multi, `${r.imoveis_titular_multi} imóveis`)
  add('Possível fracionamento (imóveis)', r.fracionamento)
  add('Mesmo nome, documento diferente (imóveis)', r.homonimos)
  add('Imóveis com sobreposição entre CARs', r.com_sobreposicao)
  add('Zoneamento', rel.zoneamento.tem ? rel.zoneamento.fonte : 'UC sem zoneamento cadastrado')
  const bloco = (t, lista, rot) => {
    if (!lista?.length) return
    add(''); titulo(t); add(rot, 'Imóveis', 'Área sobreposta (ha)').font = { bold: true }
    lista.forEach(g => add(g.rotulo || g.nome, g.n, Number(g.ha.toFixed(2))))
  }
  bloco('Prioridade para fiscalização', r.por_prioridade.filter(p => p.n), 'Prioridade')
  bloco('Quanto do imóvel está na UC', r.por_faixa_uc, 'Faixa')
  bloco('Por município', r.por_municipio, 'Município')
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
  return `car-na-uc_${slug}_${rel.gerado_em.slice(0, 10)}${rel.filtros?.length ? '_filtrado' : ''}.${ext}`
}
