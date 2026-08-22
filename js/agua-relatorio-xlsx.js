// ── SIGUC-AC · Qualidade da Água — exportar planilha Excel (.xlsx) ──
// Fonte única do QUE entra na planilha — mesma lição de sempre
// (js/frota-consumo.js). Usada pelas duas telas que já exportam
// PDF/PPTX (pages/agua-relatorios.html, mesa; pages/agua-publico.html,
// sem login). Nenhuma delas monta coluna na mão — o conjunto de
// colunas é DERIVADO da presença do campo na primeira linha do
// recorte (c.X !== undefined), o mesmo truque que
// aguaPainelColetaDetalheHTML (js/agua-painel.js) já usa para separar
// o que a mesa vê do que o público vê: a RPC pública
// (agua_publico_coletas(), migration 300) simplesmente não devolve
// coletor/GPS/foto/laudo/observações — ausência de coluna, nunca um
// `if (publico)` espalhado aqui.
//
// NUNCA recalcula IQA/CONAMA/faixa — os três já vêm prontos na linha
// (agua_calcular_iqa()/agua_conama_violacoes(), migration 249), tanto
// em vw_agua_coletas_detalhe (mesa) quanto em agua_publico_coletas()
// (público).
//
// Biblioteca sob demanda: ExcelJS vendorizado (js/vendor/
// exceljs-4.4.0.bare.min.js — dist/exceljs.bare.js oficial do pacote,
// sem polyfill, feito para browser). Mesmo padrão de carregamento
// preguiçoso de js/agua-relatorio-pdf.js (_agpdfCarregarLibs).
// NÃO usa o pacote "xlsx"/SheetJS: a versão publicada no npm está
// travada numa release com CVE de prototype pollution/ReDoS sem
// correção (SheetJS moveu releases corrigidas para cdn.sheetjs.com,
// fora do npm), e mesmo pegando a build corrigida direto do CDN deles,
// a build COMMUNITY não escreve estilo de célula de verdade (fill/
// font ficam no objeto em memória, mas nunca saem no styles.xml —
// confirmado abrindo o .xlsx gerado e inspecionando o zip). ExcelJS
// escreve fill/font/frozen pane de verdade e é MIT puro.

let _agxlsxLibPromise = null
function _agxlsxCarregarLib() {
  if (window.ExcelJS) return Promise.resolve()
  if (_agxlsxLibPromise) return _agxlsxLibPromise
  _agxlsxLibPromise = new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = '../js/vendor/exceljs-4.4.0.bare.min.js'
    s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar a biblioteca de planilha.'))
    document.head.appendChild(s)
  })
  return _agxlsxLibPromise
}

// Colunas na ORDEM em que aparecem na planilha. `chave` bate com o
// campo da linha (ou é só uma etiqueta interna quando `valor` monta o
// dado a partir de mais de um campo — ex. conformidade CONAMA).
// `privado: true` só entra se a linha tiver a coluna: no público,
// `c[chave] === undefined` e a coluna some sozinha — sem lista
// separada de "colunas do público" para manter em dois lugares.
const AGXLSX_COLUNAS = [
  { chave: 'ponto_nome', rotulo: 'Ponto' },
  { chave: 'codigo_ana', rotulo: 'Código ANA' },
  { chave: 'ponto_rio', rotulo: 'Rio' },
  { chave: 'ponto_bacia', rotulo: 'Bacia', fmt: v => v || 'Sem bacia definida' },
  { chave: 'ponto_municipio', rotulo: 'Município' },
  { chave: 'classe_enquadramento', rotulo: 'Classe de enquadramento' },
  { chave: 'campanha_ano', rotulo: 'Campanha (ano)' },
  { chave: 'campanha_ordem', rotulo: 'Campanha (ordem)', fmt: v => v === 'segunda' ? '2ª' : '1ª' },
  { chave: 'data_coleta', rotulo: 'Data da coleta', fmt: v => v ? formatData(v) : '' },
  { chave: 'hora_coleta', rotulo: 'Hora', privado: true, fmt: v => v ? String(v).slice(0, 5) : '' },
  { chave: 'codigo_amostra', rotulo: 'Código da amostra', privado: true },
  { chave: 'status', rotulo: 'Status', fmt: v => AGUA_REL_STATUS_LABEL[v] || v },
  ...Object.entries(AGUA_REL_PARAM_LABEL).map(([chave, rotulo]) => ({ chave, rotulo })),
  { chave: 'iqa', rotulo: 'IQA', fmt: v => v != null ? Number(v.toFixed(1)) : '' },
  { chave: 'iqa_faixa', rotulo: 'Faixa do IQA' },
  { chave: 'conama_status', rotulo: 'Conformidade CONAMA', valor: c => AGUA_REL_CONAMA_LABEL[aguaRelConamaStatus(c)] },
  { chave: 'conama_violacoes', rotulo: 'Parâmetros em violação',
    valor: c => (c.conama_violacoes || []).map(p => AGUA_REL_PARAM_LABEL[p] || p).join(', ') },
  { chave: 'laboratorio_nome', rotulo: 'Laboratório', privado: true },
  { chave: 'coletor_nome', rotulo: 'Coletor', privado: true },
  { chave: 'data_recebimento_laboratorio', rotulo: 'Recebimento no laboratório', privado: true, fmt: v => v ? formatData(v) : '' },
  { chave: 'quarentena_motivo', rotulo: 'Motivo da quarentena', privado: true },
  { chave: 'observacoes', rotulo: 'Observações', privado: true },
]

function _agxlsxColunasAtivas(coletas) {
  const amostra = coletas[0] || {}
  return AGXLSX_COLUNAS.filter(c => !c.privado || amostra[c.chave] !== undefined)
}

function _agxlsxValorCelula(c, col) {
  const bruto = col.valor ? col.valor(c) : c[col.chave]
  const v = col.fmt ? col.fmt(bruto) : bruto
  return v == null ? '' : v
}

const AGXLSX_COR_CABECALHO = 'FF164070' // --adash-azul-esc, mesma cor de marca do painel
const AGXLSX_COR_QUARENTENA = 'FFFEF3C7' // mesmo amarelo de aviso já usado no módulo (ex. modal de conferência)

// `rel`: objeto de aguaRelMontar (coletas já filtradas pelo recorte da
// tela — o mesmo que o PDF/PPTX exportam). `cab`/`protocolo`: mesmo
// cabeçalho institucional que o PDF usa (protocolo fixo no público,
// "Acesso público — não protocolado" — nunca gerar_protocolo_relatorio
// por um visitante anônimo, mesma regra de sempre).
async function aguaRelMontarXlsx(rel, labelBacia, periodoTxt, cab, protocolo) {
  await _agxlsxCarregarLib()
  const coletas = rel.coletas || []
  const colunas = _agxlsxColunasAtivas(coletas)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'SIGUC-AC'
  wb.created = new Date()

  // ── Aba 1: Coletas ────────────────────────────────────────────
  const wsC = wb.addWorksheet('Coletas', { views: [{ state: 'frozen', ySplit: 1 }] })
  wsC.columns = colunas.map(col => ({ header: col.rotulo, key: col.chave, width: Math.max(10, col.rotulo.length + 2) }))
  coletas.forEach(c => {
    const linha = {}
    colunas.forEach(col => { linha[col.chave] = _agxlsxValorCelula(c, col) })
    const row = wsC.addRow(linha)
    if (c.status === 'quarentena') {
      row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AGXLSX_COR_QUARENTENA } } })
    }
  })
  wsC.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AGXLSX_COR_CABECALHO } }
  })
  if (colunas.length) {
    wsC.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } }
  }

  // ── Aba 2: Resumo ────────────────────────────────────────────
  // Mesmos números do cabeçalho do PDF/PPTX (rel.resumo, já pronto por
  // aguaRelMontar) — contexto de uma olhada, sem abrir a aba de dados.
  const wsR = wb.addWorksheet('Resumo')
  wsR.columns = [{ key: 'k', width: 28 }, { key: 'v', width: 46 }]
  const r = rel.resumo || {}
  const filtrosTxt = aguaRelFiltrosTxt(rel.filtros)
  const linhasResumo = [
    ['Recorte', labelBacia || 'Acre todo'],
    ['Período', periodoTxt || '—'],
    ...(filtrosTxt ? [['Filtros adicionais', filtrosTxt]] : []),
    ['Total de coletas', r.totalColetas ?? 0],
    ['Pontos de coleta', r.nPontos ?? 0],
    ['Em quarentena', r.quarentena ?? 0],
    ['IQA médio', r.iqaMedio != null ? Number(r.iqaMedio.toFixed(1)) : '—'],
    ['Coletas com IQA calculado', r.comIQA ?? 0],
    ['Conformidade CONAMA', r.pctConforme != null ? `${r.pctConforme.toFixed(0)}%` : '—'],
    ['Coletas com limite CONAMA cadastrado', r.comConama ?? 0],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    ['Protocolo', protocolo || '—'],
  ]
  linhasResumo.forEach(([k, v]) => wsR.addRow({ k, v }))
  wsR.getColumn(1).eachCell(cell => { cell.font = { bold: true } })
  wsR.insertRow(1, { k: cab?.secretaria || 'SIGUC-AC', v: 'Qualidade da Água — Coletas' })
  wsR.getRow(1).eachCell(cell => {
    cell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AGXLSX_COR_CABECALHO } }
  })

  return wb.xlsx.writeBuffer()
}

function aguaRelBaixarXlsx(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
