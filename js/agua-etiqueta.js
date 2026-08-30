// ── SIGUC Qualidade da Água — Etiqueta do frasco de amostra ───────
// Fase 1 do plano em docs/qualidade-agua/plano-etiqueta-frasco.md.
// Fonte única do desenho da etiqueta (mesma lição de
// js/frota-consumo.js): o canvas desenhado aqui alimenta o preview na
// tela, o PDF de contingência (Peça 1) e, na Fase 2, o bitmap enviado
// à impressora térmica — nunca uma segunda implementação do layout.
//
// GEOMETRIA: 40×60 mm a 203 dpi (padrão de mercado de térmica
// portátil) — configurável via `opts`, nunca hardcoded no meio do
// desenho.
//
// RESERVA DE CÓDIGOS (client-side): o app reserva um bloco de
// códigos definitivos (RPC agua_reservar_codigos, migration 325)
// enquanto há conexão, e guarda a lista aqui no IndexedDB (store
// `config` de js/agua-offline.js, reaproveitado — sem bump de schema).
// `aEtqConsumirCodigo()` tira o próximo da fila (FIFO — os números
// mais antigos saem primeiro) só no momento de SALVAR a coleta, nunca
// ao abrir o formulário (abandonar o formulário não pode "gastar" um
// código à toa).
//
// NADA AQUI BLOQUEIA SALVAR NEM IMPRIMIR: se a fila de reservados
// estiver vazia, a coleta salva sem código (como sempre foi — o
// trigger gera um no sync) e a etiqueta simplesmente não pode ser
// impressa até sincronizar. É degradação aceita, documentada no plano.

const AGUA_ETIQUETA_MM  = { w: 40, h: 60 }
const AGUA_ETIQUETA_DPI = 203

// ═══════════════════════════════════════════════════════════════
// Reserva de códigos — persistência local (chave única no store
// `config`, mesmo padrão de 'equipamento_padrao_id')
// ═══════════════════════════════════════════════════════════════
const AETQ_CHAVE_POOL = 'etq_codigos_reservados'

async function aEtqListarPool() {
  return (await aOfflineGetConfig(AETQ_CHAVE_POOL)) || []
}

async function aEtqAdicionarAoPool(codigos) {
  const atual = await aEtqListarPool()
  const vistos = new Set(atual.map(c => c.codigo))
  const novos = (codigos || []).filter(c => !vistos.has(c.codigo))
  await aOfflineSetConfig(AETQ_CHAVE_POOL, [...atual, ...novos])
  return atual.length + novos.length
}

async function aEtqContarDisponiveis() {
  return (await aEtqListarPool()).length
}

// Tira o próximo código disponível (FIFO) e já REMOVE do pool local —
// chamado só no momento de salvar a coleta (nunca ao abrir o
// formulário), senão abandonar a tela "gastaria" um código à toa.
async function aEtqConsumirCodigo() {
  const pool = await aEtqListarPool()
  if (!pool.length) return null
  const [proximo, ...resto] = pool
  await aOfflineSetConfig(AETQ_CHAVE_POOL, resto)
  return proximo.codigo
}

// Reservar online (RPC) — exige conexão/sessão, chamado da tela de
// Config antes de ir a campo. `db` é o cliente global (js/config.js).
async function aEtqReservarOnline(qtd) {
  if (!db) throw new Error('Sem conexão — reserve os códigos com internet, antes de ir a campo.')
  const { data, error } = await db.rpc('agua_reservar_codigos', { p_qtd: qtd })
  if (error) throw error
  await aEtqAdicionarAoPool(data || [])
  return (data || []).length
}

// ═══════════════════════════════════════════════════════════════
// Desenho — canvas é a fonte única do visual (raster, não texto
// vetorial): a MESMA imagem vira PNG de preview, página de PDF e,
// na Fase 2, bitmap 1-bit para a impressora. Sem libs.
// ═══════════════════════════════════════════════════════════════

// `dados`: { codigo_amostra, ponto_nome, codigo_ana, data_coleta
// ('AAAA-MM-DD'), hora_coleta ('HH:MM'), coletor_nome, via, totalVias }
function aguaEtiquetaDesenhar(canvas, dados, opts = {}) {
  const dpi = opts.dpi || AGUA_ETIQUETA_DPI
  const mm  = opts.mm  || AGUA_ETIQUETA_MM
  const px  = v => Math.round(v * dpi / 25.4)
  const W = px(mm.w), H = px(mm.h)
  canvas.width = W
  canvas.height = H

  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  ctx.textBaseline = 'top'

  const pad = px(2)
  let y = 0

  // Faixa superior preta com o rótulo institucional em negativo
  const faixaH = px(4)
  ctx.fillRect(0, 0, W, faixaH)
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${px(2.3)}px Arial, sans-serif`
  ctx.fillText('SEMA-AC · QUALIDADE DA ÁGUA', pad, px(0.9))
  ctx.fillStyle = '#000'
  y = faixaH + px(2.5)

  // Código da amostra (grande) — o dado mais importante da etiqueta
  ctx.font = `bold ${px(5.5)}px "Courier New", monospace`
  ctx.fillText(dados.codigo_amostra || '—', pad, y)
  y += px(6.5)

  // QR do código, alinhado à direita, ao lado do texto acima
  if (dados.codigo_amostra && typeof qrcode === 'function') {
    try {
      const qr = qrcode(0, 'M')
      qr.addData(dados.codigo_amostra)
      qr.make()
      const qrSizeMm = 15
      const qrPx = px(qrSizeMm)
      const qrImg = new Image()
      // Desenho síncrono: qrcode-generator devolve <img>/<table> pela
      // API createImgTag/createTableTag, mas createDataURL já entrega
      // um PNG pronto — desenhamos direto do módulo interno em vez de
      // depender de onload assíncrono (a etiqueta tem de sair pronta
      // na mesma chamada, para virar PDF/bitmap sem esperar imagem).
      const cellCount = qr.getModuleCount()
      const cell = qrPx / cellCount
      const qx = W - pad - qrPx, qy = faixaH + px(2)
      for (let r = 0; r < cellCount; r++) {
        for (let c = 0; c < cellCount; c++) {
          if (qr.isDark(r, c)) ctx.fillRect(qx + c * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell))
        }
      }
    } catch (e) { console.warn('[agua-etiqueta] QR falhou:', e) }
  }

  // Linha separadora
  y += px(1)
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.lineWidth = px(0.15); ctx.stroke()
  y += px(2.5)

  ctx.font = `bold ${px(2.6)}px Arial, sans-serif`
  const linhas = _aEtqLinhasDeTexto(ctx, dados.ponto_nome || 'Ponto não identificado', W - pad * 2, px(2.6))
  linhas.slice(0, 2).forEach(l => { ctx.fillText(l, pad, y); y += px(3.2) })

  ctx.font = `${px(2.3)}px Arial, sans-serif`
  if (dados.codigo_ana) { ctx.fillText(`ANA ${dados.codigo_ana}`, pad, y); y += px(3) }

  const dataFmt = dados.data_coleta ? new Date(dados.data_coleta + 'T00:00:00').toLocaleDateString('pt-BR') : '—'
  const horaFmt = dados.hora_coleta ? String(dados.hora_coleta).slice(0, 5) : ''
  ctx.fillText(`${dataFmt}${horaFmt ? '  ' + horaFmt : ''}`, pad, y); y += px(3)

  if (dados.coletor_nome) {
    ctx.fillText(`Coletor: ${dados.coletor_nome}`.slice(0, 34), pad, y); y += px(3)
  }

  // Rodapé: linha para anotar preservação a mão + via/total
  y = H - px(9)
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.lineWidth = px(0.12); ctx.stroke()
  y += px(1.5)
  ctx.font = `${px(2)}px Arial, sans-serif`
  ctx.fillText('Preservação: ___________________', pad, y)
  y += px(3.2)
  const via = dados.via || 1, totalVias = dados.totalVias || 1
  ctx.font = `bold ${px(2)}px Arial, sans-serif`
  ctx.fillText(`Via ${via} de ${totalVias}`, pad, y)

  return canvas
}

// Quebra de linha simples por largura disponível (sem lib) — usada só
// para o nome do ponto, que pode ser longo.
function _aEtqLinhasDeTexto(ctx, texto, larguraMax, fontPx) {
  const palavras = String(texto).split(/\s+/)
  const linhas = []
  let atual = ''
  for (const p of palavras) {
    const teste = atual ? atual + ' ' + p : p
    if (ctx.measureText(teste).width > larguraMax && atual) {
      linhas.push(atual)
      atual = p
    } else {
      atual = teste
    }
  }
  if (atual) linhas.push(atual)
  return linhas
}

function aguaEtiquetaCriarCanvas(dados, opts) {
  const canvas = document.createElement('canvas')
  aguaEtiquetaDesenhar(canvas, dados, opts)
  return canvas
}

function aguaEtiquetaPngDataURL(dados, opts) {
  return aguaEtiquetaCriarCanvas(dados, opts).toDataURL('image/png')
}

function aguaEtiquetaPngBlob(dados, opts) {
  return new Promise(resolve => {
    aguaEtiquetaCriarCanvas(dados, opts).toBlob(resolve, 'image/png')
  })
}

// ═══════════════════════════════════════════════════════════════
// PDF — N vias (mesma coleta) ou lote (N coletas, 1 via cada), uma
// página por etiqueta, no tamanho exato da etiqueta (mm). Cada página
// embute o PNG do canvas — nunca redesenha em texto vetorial do
// jsPDF, para o documento nunca divergir do preview/bitmap.
//
// Carrega só o jsPDF (sem autotable — a etiqueta não usa tabela),
// vendorizado no mesmo arquivo que js/agua-relatorio-pdf.js já usa.
let _aEtqJsPdfPromise = null
function _aEtqCarregarJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve()
  if (_aEtqJsPdfPromise) return _aEtqJsPdfPromise
  _aEtqJsPdfPromise = new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = '../js/vendor/jspdf-2.5.2.umd.min.js'
    s.onload = res
    s.onerror = () => rej(new Error('Falha ao carregar jsPDF.'))
    document.head.appendChild(s)
  })
  return _aEtqJsPdfPromise
}

async function aguaEtiquetaMontarPdfVias(dados, vias, opts = {}) {
  await _aEtqCarregarJsPDF()
  const mm = opts.mm || AGUA_ETIQUETA_MM
  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ unit: 'mm', format: [mm.w, mm.h], compress: true })
  for (let v = 1; v <= vias; v++) {
    if (v > 1) pdf.addPage([mm.w, mm.h])
    const png = aguaEtiquetaPngDataURL({ ...dados, via: v, totalVias: vias }, opts)
    pdf.addImage(png, 'PNG', 0, 0, mm.w, mm.h)
  }
  return pdf
}

// Lote de mesa: uma etiqueta (1 via) por coleta da lista — reimpressão
// em lote quando a térmica falhou em campo (plano B, ver plano da
// Fase 1). `lista` já vem com os campos que aguaEtiquetaDesenhar usa.
async function aguaEtiquetaMontarPdfLote(lista, opts = {}) {
  await _aEtqCarregarJsPDF()
  const mm = opts.mm || AGUA_ETIQUETA_MM
  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ unit: 'mm', format: [mm.w, mm.h], compress: true })
  lista.forEach((dados, i) => {
    if (i > 0) pdf.addPage([mm.w, mm.h])
    const png = aguaEtiquetaPngDataURL({ ...dados, via: 1, totalVias: 1 }, opts)
    pdf.addImage(png, 'PNG', 0, 0, mm.w, mm.h)
  })
  return pdf
}

function aguaEtiquetaBaixarPdf(pdf, filename) {
  const url = URL.createObjectURL(pdf.output('blob'))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
