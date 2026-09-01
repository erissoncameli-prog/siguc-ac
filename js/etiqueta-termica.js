// ── SIGUC-AC · Motor genérico de etiqueta térmica ──────────────────
// Extraído de js/agua-etiqueta.js nesta entrega (Biomonitor virou o
// 2º consumidor — mesma lição de js/frota-consumo.js: no 2º uso,
// centraliza em vez de copiar). Não sabe nada de "coleta", "ninho" ou
// "berçário" — só canvas, texto, QR e PDF. Cada módulo
// (js/agua-etiqueta.js, js/biomonitor-etiqueta.js) desenha o PRÓPRIO
// layout com estas peças e usa a MESMA imagem para preview, PDF de N
// vias/lote e, no futuro, o bitmap enviado à impressora térmica.
//
// Depende de: js/qrcode-generator.js (global `qrcode`), carregado sob
// demanda pela própria página; js/vendor/jspdf-2.5.2.umd.min.js
// (carregado aqui, uma vez, sob demanda).

// Canvas na resolução exata da etiqueta (mm × dpi) — devolve também
// `px()`, o conversor mm→pixel que todo desenho usa.
function etqNovoCanvas(canvas, mm, dpi) {
  const px = v => Math.round(v * dpi / 25.4)
  const W = px(mm.w), H = px(mm.h)
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  ctx.textBaseline = 'top'
  return { ctx, W, H, px }
}

// Reduz o tamanho da fonte até o texto caber na largura disponível —
// nunca um tamanho fixo pra texto de conteúdo/comprimento variável
// (achado real na etiqueta de frasco: código fixo vazava a largura e
// ficava por baixo do QR).
function etqAjustarFonte(ctx, texto, larguraMax, pesoFamilia, familia, pxMax, pxMin) {
  for (let tam = pxMax; tam >= pxMin; tam--) {
    ctx.font = `${pesoFamilia} ${tam}px ${familia}`
    if (ctx.measureText(texto).width <= larguraMax) return tam
  }
  ctx.font = `${pesoFamilia} ${pxMin}px ${familia}`
  return pxMin
}

// Quebra de linha simples por largura disponível (sem lib) — usa a
// fonte já setada em ctx antes da chamada.
function etqLinhasDeTexto(ctx, texto, larguraMax) {
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

// Desenha o QR de `texto` num quadrado de `tamanhoPx`, com o canto
// superior esquerdo em (x, y). Sem <img> assíncrona — lê os módulos
// direto do gerador (js/qrcode-generator.js), pra sair pronto na
// mesma chamada que desenha o resto da etiqueta.
function etqDesenharQR(ctx, texto, x, y, tamanhoPx) {
  if (!texto || typeof qrcode !== 'function') return
  try {
    const qr = qrcode(0, 'M')
    qr.addData(texto)
    qr.make()
    const cellCount = qr.getModuleCount()
    const cell = tamanhoPx / cellCount
    for (let r = 0; r < cellCount; r++) {
      for (let c = 0; c < cellCount; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(x + c * cell, y + r * cell, Math.ceil(cell), Math.ceil(cell))
      }
    }
  } catch (e) { console.warn('[etiqueta-termica] QR falhou:', e) }
}

// ── PDF — carregado sob demanda (só jsPDF, sem autotable — etiqueta
// não usa tabela), vendorizado no mesmo arquivo que
// js/agua-relatorio-pdf.js já usa ────────────────────────────────
let _etqJsPdfPromise = null
function etqCarregarJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve()
  if (_etqJsPdfPromise) return _etqJsPdfPromise
  _etqJsPdfPromise = new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = '../js/vendor/jspdf-2.5.2.umd.min.js'
    s.onload = res
    s.onerror = () => rej(new Error('Falha ao carregar jsPDF.'))
    document.head.appendChild(s)
  })
  return _etqJsPdfPromise
}

// Um PDF com uma página por PNG (já renderizado), no tamanho exato da
// etiqueta (mm) — nunca redesenha em texto vetorial do jsPDF, pra
// nunca divergir do preview/bitmap. Serve tanto pra "N vias da mesma
// etiqueta" quanto "1 via de N etiquetas diferentes (lote)" — quem
// monta a lista de PNGs decide qual dos dois é.
async function etqMontarPdfDePngs(pngs, mm) {
  await etqCarregarJsPDF()
  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ unit: 'mm', format: [mm.w, mm.h], compress: true })
  pngs.forEach((png, i) => {
    if (i > 0) pdf.addPage([mm.w, mm.h])
    pdf.addImage(png, 'PNG', 0, 0, mm.w, mm.h)
  })
  return pdf
}

function etqBaixarPdf(pdf, filename) {
  const url = URL.createObjectURL(pdf.output('blob'))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
