// ── SIGUC Qualidade da Água — Etiqueta do frasco de amostra ───────
// Fase 1 do plano em docs/qualidade-agua/plano-etiqueta-frasco.md.
// O DESENHO em si (canvas, texto auto-ajustado, QR, PDF) vive em
// js/etiqueta-termica.js — motor compartilhado com o Biomonitor
// (js/biomonitor-etiqueta.js, 2º consumidor). Este arquivo só tem o
// LAYOUT da etiqueta de frasco e a lógica exclusiva da Água: a
// reserva de códigos.
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
// Desenho — usa o motor de js/etiqueta-termica.js. A MESMA imagem
// alimenta o preview na tela, o PDF de N vias/lote e, no futuro, o
// bitmap enviado à impressora.
// ═══════════════════════════════════════════════════════════════

// `dados`: { codigo_amostra, ponto_nome, codigo_ana, data_coleta
// ('AAAA-MM-DD'), hora_coleta ('HH:MM'), coletor_nome, lat, lng,
// via, totalVias }
function aguaEtiquetaDesenhar(canvas, dados, opts = {}) {
  const dpi = opts.dpi || AGUA_ETIQUETA_DPI
  const mm  = opts.mm  || AGUA_ETIQUETA_MM
  const { ctx, W, H, px } = etqNovoCanvas(canvas, mm, dpi)

  const pad = px(2)
  const larguraUtil = W - pad * 2
  let y = 0

  // Faixa superior preta com o rótulo institucional em negativo
  const faixaH = px(4)
  ctx.fillRect(0, 0, W, faixaH)
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${px(2.3)}px Arial, sans-serif`
  ctx.fillText('SEMA-AC · QUALIDADE DA ÁGUA', pad, px(0.9))
  ctx.fillStyle = '#000'
  y = faixaH + px(2.5)

  // Código da amostra (o dado mais importante da etiqueta) — fonte
  // AUTO-AJUSTADA pra nunca vazar a largura, nunca um tamanho fixo.
  const codigo = dados.codigo_amostra || '—'
  const tamCodigo = etqAjustarFonte(ctx, codigo, larguraUtil, 'bold', '"Courier New", monospace', px(5.5), px(3))
  ctx.fillText(codigo, pad, y)
  y += Math.round(tamCodigo * 1.25)

  // Linha separadora
  y += px(1)
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.lineWidth = px(0.15); ctx.stroke()
  y += px(2.3)

  ctx.font = `bold ${px(2.6)}px Arial, sans-serif`
  const linhasPonto = etqLinhasDeTexto(ctx, dados.ponto_nome || 'Ponto não identificado', larguraUtil)
  linhasPonto.slice(0, 2).forEach(l => { ctx.fillText(l, pad, y); y += px(3.1) })

  ctx.font = `${px(2.2)}px Arial, sans-serif`
  // Rio + código ANA na MESMA linha — economiza altura (a etiqueta já
  // é apertada com QR + rodapé fixos); rio some sozinho se o ponto
  // não tiver um cadastrado (ponto fora de curso d'água nomeado).
  const infoLocal = [dados.rio, dados.codigo_ana ? `ANA ${dados.codigo_ana}` : null].filter(Boolean).join(' · ')
  if (infoLocal) { ctx.fillText(infoLocal, pad, y); y += px(2.8) }

  if (dados.lat != null && dados.lng != null) {
    ctx.fillText(`Coord: ${Number(dados.lat).toFixed(5)}, ${Number(dados.lng).toFixed(5)}`, pad, y)
    y += px(2.8)
  }

  const dataFmt = dados.data_coleta ? new Date(dados.data_coleta + 'T00:00:00').toLocaleDateString('pt-BR') : '—'
  const horaFmt = dados.hora_coleta ? String(dados.hora_coleta).slice(0, 5) : ''
  ctx.fillText(`Coleta: ${dataFmt}${horaFmt ? '  ' + horaFmt : ''}`, pad, y); y += px(2.8)

  if (dados.coletor_nome) {
    ctx.fillText(`Coletor: ${dados.coletor_nome}`.slice(0, 40), pad, y); y += px(2.8)
  }

  // QR do código — abaixo do texto (nunca ao lado: o código sozinho já
  // ocupa a largura toda), centralizado no espaço livre antes do
  // rodapé fixo.
  const rodapeY = H - px(9)
  const espacoLivre = rodapeY - y
  if (dados.codigo_amostra && espacoLivre > px(8)) {
    const qrPx = Math.min(px(15), espacoLivre - px(1.5))
    etqDesenharQR(ctx, dados.codigo_amostra, Math.round((W - qrPx) / 2), y + px(1), qrPx)
  }

  // Rodapé: linha para anotar preservação a mão + via/total
  y = rodapeY
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
// PDF — N vias (mesma coleta) ou lote (N coletas, 1 via cada).
// Monta a lista de PNGs aqui (que é a parte específica da Água — os
// campos de `dados`); a montagem do PDF em si é a peça compartilhada
// de js/etiqueta-termica.js.
// ═══════════════════════════════════════════════════════════════

async function aguaEtiquetaMontarPdfVias(dados, vias, opts = {}) {
  const mm = opts.mm || AGUA_ETIQUETA_MM
  const pngs = []
  for (let v = 1; v <= vias; v++) pngs.push(aguaEtiquetaPngDataURL({ ...dados, via: v, totalVias: vias }, opts))
  return etqMontarPdfDePngs(pngs, mm)
}

// Lote de mesa: uma etiqueta (1 via) por coleta da lista — reimpressão
// em lote quando a térmica falhou em campo (plano B, ver plano da
// Fase 1). `lista` já vem com os campos que aguaEtiquetaDesenhar usa.
async function aguaEtiquetaMontarPdfLote(lista, opts = {}) {
  const mm = opts.mm || AGUA_ETIQUETA_MM
  const pngs = lista.map(dados => aguaEtiquetaPngDataURL({ ...dados, via: 1, totalVias: 1 }, opts))
  return etqMontarPdfDePngs(pngs, mm)
}

function aguaEtiquetaBaixarPdf(pdf, filename) {
  etqBaixarPdf(pdf, filename)
}
