// ── SIGUC Biomonitor — Etiquetas de ninho, berçário e lote ────────
// Plano em docs/biomonitor/plano-etiqueta-ninho-bercario.md. Motor de
// desenho compartilhado com a Água em js/etiqueta-termica.js (2º
// consumidor) — este arquivo só tem os TRÊS layouts do Biomonitor.
//
// DIFERENÇA-CHAVE em relação à Água: nenhum dos três objetos precisa
// de reserva de código. `numero_ninho` já nasce no cliente, no
// instante do cadastro (bioGerarNumeroNinho, js/biomonitor-quelonios.js)
// — 100% offline, sem trigger de banco. `bercarios.codigo` (migration
// 328) é gerado raramente, sem concorrência de campo. O lote usa o
// número do ninho de origem, que já existe.
//
// ETIQUETA DE NINHO: por decisão do usuário, é um ADESIVO PEQUENO,
// só QR + código — complementa a placa manuscrita já usada em campo
// (ninhos ficam meses expostos ao sol/chuva na praia; a placa física
// já resolve a durabilidade, o adesivo só acelera abrir o registro
// escaneando em vez de digitar). NUNCA substitui a placa manuscrita.
//
// ETIQUETA DE BERÇÁRIO: placa completa — estrutura fixa, ambiente
// controlado, mesma lógica da etiqueta de frasco da Água. Nunca
// imprime números que mudam todo dia (ocupação) — só estático + QR
// pra ver o resto ao vivo (vw_bercarios_resumo já calcula tudo).
//
// ETIQUETA DE LOTE: presa ao balde/bandeja do lote dentro do
// berçário — evita confundir levas de ninhos diferentes no mesmo
// tanque. Campo manuscrito "Vivos hoje" porque esse número muda a
// cada visita (mesma razão de "Preservação" na etiqueta de frasco).

const BIO_ETIQUETA_NINHO_MM    = { w: 30, h: 40 }
const BIO_ETIQUETA_BERCARIO_MM = { w: 40, h: 60 }
const BIO_ETIQUETA_LOTE_MM     = { w: 40, h: 60 }
const BIO_ETIQUETA_DPI = 203

const BIOETQ_TIPO_LABEL = { tanque_fibra: 'Tanque de fibra', piscina_alvenaria: 'Piscina de alvenaria', viveiro: 'Viveiro', outro: 'Outro' }

// ═══════════════════════════════════════════════════════════════
// Ninho — adesivo QR (30×40mm)
// `dados`: { numero (numero_atual ?? numero_ninho) }
// ═══════════════════════════════════════════════════════════════
function bioEtiquetaNinhoDesenhar(canvas, dados, opts = {}) {
  const dpi = opts.dpi || BIO_ETIQUETA_DPI
  const mm  = opts.mm  || BIO_ETIQUETA_NINHO_MM
  const { ctx, W, H, px } = etqNovoCanvas(canvas, mm, dpi)
  const pad = px(1.5)
  let y = 0

  const faixaH = px(4)
  ctx.fillRect(0, 0, W, faixaH)
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${px(2.1)}px Arial, sans-serif`
  ctx.fillText('SEMA-AC', pad, px(0.9))
  ctx.fillStyle = '#000'
  y = faixaH + px(2)

  const codigo = dados.numero || '—'
  const tam = etqAjustarFonte(ctx, codigo, W - pad * 2, 'bold', '"Courier New", monospace', px(3.4), px(2))
  ctx.fillText(codigo, pad, y)
  y += Math.round(tam * 1.3) + px(1.5)

  const espacoLivre = H - px(3) - y
  if (dados.numero && espacoLivre > px(8)) {
    const qrPx = Math.min(W - pad * 2, espacoLivre)
    etqDesenharQR(ctx, dados.numero, Math.round((W - qrPx) / 2), y, qrPx)
    y += qrPx + px(1.5)
  }

  ctx.font = `${px(1.8)}px Arial, sans-serif`
  ctx.fillText('Escaneie p/ abrir', pad, y)

  return canvas
}

// ═══════════════════════════════════════════════════════════════
// Berçário — placa completa (40×60mm)
// `dados`: { codigo, nome, tipo, capacidade_max, responsavel_nome,
//            uc_nome }
// ═══════════════════════════════════════════════════════════════
function bioEtiquetaBercarioDesenhar(canvas, dados, opts = {}) {
  const dpi = opts.dpi || BIO_ETIQUETA_DPI
  const mm  = opts.mm  || BIO_ETIQUETA_BERCARIO_MM
  const { ctx, W, H, px } = etqNovoCanvas(canvas, mm, dpi)
  const pad = px(2)
  const larguraUtil = W - pad * 2
  let y = 0

  const faixaH = px(7)
  ctx.fillRect(0, 0, W, faixaH)
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${px(2.3)}px Arial, sans-serif`
  ctx.fillText('SEMA-AC · BIOMONITORAMENTO', pad, px(0.9))
  ctx.font = `bold ${px(2.6)}px Arial, sans-serif`
  ctx.fillText('BERÇÁRIO', pad, px(3.6))
  ctx.fillStyle = '#000'
  y = faixaH + px(2.5)

  const nome = dados.nome || 'Berçário'
  const tam = etqAjustarFonte(ctx, nome, larguraUtil, 'bold', 'Arial, sans-serif', px(4.2), px(2.4))
  ctx.fillText(nome, pad, y)
  y += Math.round(tam * 1.3) + px(1)

  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.lineWidth = px(0.15); ctx.stroke()
  y += px(2.3)

  ctx.font = `${px(2.2)}px Arial, sans-serif`
  const linhas = [
    BIOETQ_TIPO_LABEL[dados.tipo] || dados.tipo,
    dados.capacidade_max != null ? `Capacidade: ${dados.capacidade_max} filhotes` : null,
    dados.responsavel_nome ? `Responsável: ${dados.responsavel_nome}` : null,
    dados.uc_nome ? `UC: ${dados.uc_nome}` : null,
  ].filter(Boolean)
  linhas.forEach(l => { ctx.fillText(l, pad, y); y += px(2.9) })

  const rodapeY = H - px(9)
  const espacoLivre = rodapeY - y
  if (dados.codigo && espacoLivre > px(8)) {
    const qrPx = Math.min(px(16), espacoLivre - px(1.5))
    etqDesenharQR(ctx, dados.codigo, Math.round((W - qrPx) / 2), y + px(1), qrPx)
  }

  y = rodapeY
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.lineWidth = px(0.12); ctx.stroke()
  y += px(1.8)
  ctx.font = `${px(2)}px Arial, sans-serif`
  ctx.fillText('Ver ocupação ao vivo:', pad, y)
  y += px(2.8)
  ctx.font = `bold ${px(2)}px Arial, sans-serif`
  ctx.fillText('escaneie o QR acima', pad, y)

  return canvas
}

// ═══════════════════════════════════════════════════════════════
// Lote — etiqueta de balde/bandeja (40×60mm)
// `dados`: { lote_id, bercario_nome, numero_ninho, especie_nome,
//            especie_sigla, qtd_entrada, data_entrada }
// ═══════════════════════════════════════════════════════════════
function bioEtiquetaLoteDesenhar(canvas, dados, opts = {}) {
  const dpi = opts.dpi || BIO_ETIQUETA_DPI
  const mm  = opts.mm  || BIO_ETIQUETA_LOTE_MM
  const { ctx, W, H, px } = etqNovoCanvas(canvas, mm, dpi)
  const pad = px(2)
  const larguraUtil = W - pad * 2
  let y = 0

  const faixaH = px(4)
  ctx.fillRect(0, 0, W, faixaH)
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${px(2.3)}px Arial, sans-serif`
  ctx.fillText('SEMA-AC · BIOMONITORAMENTO', pad, px(0.9))
  ctx.fillStyle = '#000'
  y = faixaH + px(2.5)

  const titulo = dados.bercario_nome || 'Berçário'
  const tam = etqAjustarFonte(ctx, titulo, larguraUtil, 'bold', 'Arial, sans-serif', px(3.4), px(2.2))
  ctx.fillText(titulo, pad, y)
  y += Math.round(tam * 1.3) + px(0.8)
  ctx.font = `${px(2)}px Arial, sans-serif`
  ctx.fillText('Lote de filhotes', pad, y)
  y += px(3)

  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.lineWidth = px(0.15); ctx.stroke()
  y += px(2.2)

  ctx.font = `${px(2.1)}px Arial, sans-serif`
  const especie = [dados.especie_nome, dados.especie_sigla ? `(${dados.especie_sigla})` : null].filter(Boolean).join(' ')
  const dataFmt = dados.data_entrada ? new Date(dados.data_entrada + 'T00:00:00').toLocaleDateString('pt-BR') : '—'
  const linhas = [
    dados.numero_ninho ? `Origem: ${dados.numero_ninho}` : null,
    [especie, dados.qtd_entrada != null ? `${dados.qtd_entrada} filhotes` : null].filter(Boolean).join(' · ') || null,
    `Entrada: ${dataFmt}`,
  ].filter(Boolean)
  linhas.forEach(l => { ctx.fillText(l, pad, y); y += px(2.8) })

  const rodapeY = H - px(9)
  const espacoLivre = rodapeY - y
  if (dados.lote_id && espacoLivre > px(8)) {
    const qrPx = Math.min(px(14), espacoLivre - px(1.5))
    etqDesenharQR(ctx, dados.lote_id, Math.round((W - qrPx) / 2), y + px(1), qrPx)
  }

  y = rodapeY
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.lineWidth = px(0.12); ctx.stroke()
  y += px(1.6)
  ctx.font = `${px(1.9)}px Arial, sans-serif`
  ctx.fillText('Vivos hoje: ___________', pad, y)

  return canvas
}

// ═══════════════════════════════════════════════════════════════
// Canvas → PNG → PDF (peças finas em cima do motor compartilhado)
// ═══════════════════════════════════════════════════════════════
function _bioEtqCanvas(desenharFn, dados, opts) {
  const canvas = document.createElement('canvas')
  desenharFn(canvas, dados, opts)
  return canvas
}
function _bioEtqPngDataURL(desenharFn, dados, opts) {
  return _bioEtqCanvas(desenharFn, dados, opts).toDataURL('image/png')
}

function bioEtiquetaNinhoCriarCanvas(dados, opts)    { return _bioEtqCanvas(bioEtiquetaNinhoDesenhar, dados, opts) }
function bioEtiquetaBercarioCriarCanvas(dados, opts) { return _bioEtqCanvas(bioEtiquetaBercarioDesenhar, dados, opts) }
function bioEtiquetaLoteCriarCanvas(dados, opts)     { return _bioEtqCanvas(bioEtiquetaLoteDesenhar, dados, opts) }

async function bioEtiquetaNinhoMontarPdfVias(dados, vias, opts = {}) {
  const mm = opts.mm || BIO_ETIQUETA_NINHO_MM
  const pngs = []
  for (let v = 1; v <= vias; v++) pngs.push(_bioEtqPngDataURL(bioEtiquetaNinhoDesenhar, dados, opts))
  return etqMontarPdfDePngs(pngs, mm)
}

// Reimpressão em lote (mesa) — uma etiqueta por ninho da lista.
async function bioEtiquetaNinhoMontarPdfLote(lista, opts = {}) {
  const mm = opts.mm || BIO_ETIQUETA_NINHO_MM
  const pngs = lista.map(dados => _bioEtqPngDataURL(bioEtiquetaNinhoDesenhar, dados, opts))
  return etqMontarPdfDePngs(pngs, mm)
}

async function bioEtiquetaBercarioMontarPdfVias(dados, vias, opts = {}) {
  const mm = opts.mm || BIO_ETIQUETA_BERCARIO_MM
  const pngs = []
  for (let v = 1; v <= vias; v++) pngs.push(_bioEtqPngDataURL(bioEtiquetaBercarioDesenhar, dados, opts))
  return etqMontarPdfDePngs(pngs, mm)
}

async function bioEtiquetaLoteMontarPdfVias(dados, vias, opts = {}) {
  const mm = opts.mm || BIO_ETIQUETA_LOTE_MM
  const pngs = []
  for (let v = 1; v <= vias; v++) pngs.push(_bioEtqPngDataURL(bioEtiquetaLoteDesenhar, dados, opts))
  return etqMontarPdfDePngs(pngs, mm)
}

function bioEtiquetaBaixarPdf(pdf, filename) {
  etqBaixarPdf(pdf, filename)
}
