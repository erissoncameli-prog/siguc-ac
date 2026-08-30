// ── SIGUC-AC · Leitor de QR (câmera) — fonte única ────────────────
// Nasceu para ler a etiqueta de frasco da Qualidade da Água
// (js/agua-etiqueta.js) em pages/agua-laudos.html: em vez de procurar
// a coleta na tabela, o técnico aponta a câmera pro QR e o sistema
// abre direto. Escrito genérico (não sabe nada de "coleta" ou
// "laudo") pra ser reaproveitado por QUALQUER tela que precise ler um
// QR — nunca reimplementar câmera+detecção numa página nova.
//
// USA A API NATIVA DO NAVEGADOR (BarcodeDetector), sem lib vendorizada
// nova: suportada em Chrome/Edge (desktop e Android) desde 2020, que é
// o parque de máquina real da SEMA-AC. Sem suporte em Firefox/Safari —
// `qrScannerSuportado()` deixa cada página decidir se mostra o botão
// de escanear; SEM o botão, a busca manual de sempre continua
// funcionando igual. Nunca é a única forma de achar algo no sistema.
//
// API:
//   qrScannerSuportado() → boolean, síncrono
//   qrScannerAbrir({ titulo, dica }) → Promise<string|null>
//     resolve com o texto lido, ou null se o usuário cancelar/fechar
//     sem ler nada (erro de câmera incluso — nunca rejeita a Promise).

function qrScannerSuportado() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

let _qrScannerOverlay = null
let _qrScannerStream = null
let _qrScannerLoopId = null

function _qrScannerGarantirDOM() {
  if (_qrScannerOverlay) return _qrScannerOverlay

  const style = document.createElement('style')
  style.textContent = `
    .qrscan-overlay { display:none; position:fixed; inset:0; z-index:400; background:rgba(0,0,0,.7); align-items:center; justify-content:center; }
    .qrscan-overlay.aberto { display:flex; }
    .qrscan-card { background:#fff; border-radius:14px; padding:16px; width:100%; max-width:360px; margin:16px; display:flex; flex-direction:column; gap:10px; }
    .qrscan-titulo { font-size:15px; font-weight:700; color:#111827; margin:0; }
    .qrscan-video-wrap { position:relative; border-radius:10px; overflow:hidden; background:#000; aspect-ratio:1/1; }
    .qrscan-video-wrap video { width:100%; height:100%; object-fit:cover; }
    .qrscan-mira { position:absolute; inset:14%; border:2px solid #fff; border-radius:10px; box-shadow:0 0 0 999px rgba(0,0,0,.25); pointer-events:none; }
    .qrscan-dica { font-size:12.5px; color:#6B7280; margin:0; }
    .qrscan-erro { font-size:12.5px; color:#B91C1C; margin:0; }
    .qrscan-fechar { align-self:flex-end; min-height:24px; padding:6px 14px; border-radius:8px; border:1px solid #D1D5DB; background:#F9FAFB; cursor:pointer; font-size:13px; }
    .qrscan-fechar:focus-visible { outline:2px solid #2563EB; outline-offset:2px; }
  `
  document.head.appendChild(style)

  const overlay = document.createElement('div')
  overlay.className = 'qrscan-overlay'
  overlay.innerHTML = `
    <div class="qrscan-card">
      <p class="qrscan-titulo" id="qrscan-titulo">Escanear QR</p>
      <div class="qrscan-video-wrap"><video id="qrscan-video" autoplay playsinline muted></video><div class="qrscan-mira"></div></div>
      <p class="qrscan-dica" id="qrscan-dica">Aponte a câmera para o QR da etiqueta.</p>
      <p class="qrscan-erro" id="qrscan-erro" hidden></p>
      <button type="button" class="qrscan-fechar" id="qrscan-fechar">Cancelar</button>
    </div>`
  document.body.appendChild(overlay)
  _qrScannerOverlay = overlay
  return overlay
}

function _qrScannerParar() {
  if (_qrScannerLoopId) { cancelAnimationFrame(_qrScannerLoopId); _qrScannerLoopId = null }
  if (_qrScannerStream) { _qrScannerStream.getTracks().forEach(t => t.stop()); _qrScannerStream = null }
  if (_qrScannerOverlay) _qrScannerOverlay.classList.remove('aberto')
}

function qrScannerAbrir(opts = {}) {
  return new Promise(async resolve => {
    if (!qrScannerSuportado()) { resolve(null); return }

    const overlay = _qrScannerGarantirDOM()
    document.getElementById('qrscan-titulo').textContent = opts.titulo || 'Escanear QR'
    document.getElementById('qrscan-dica').textContent = opts.dica || 'Aponte a câmera para o QR da etiqueta.'
    const elErro = document.getElementById('qrscan-erro')
    elErro.hidden = true
    const video = document.getElementById('qrscan-video')
    overlay.classList.add('aberto')

    const finalizar = valor => { _qrScannerParar(); resolve(valor) }
    document.getElementById('qrscan-fechar').onclick = () => finalizar(null)

    try {
      _qrScannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      video.srcObject = _qrScannerStream
      // Nunca aguardar a Promise de play(): em alguns navegadores/
      // stream sem track ela não resolve nem rejeita, travando aqui
      // pra sempre — dispara e segue pro loop de detecção.
      video.play().catch(() => {})

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      const tick = async () => {
        if (!_qrScannerStream) return // já foi fechado (cancelado) entre frames
        try {
          const codigos = await detector.detect(video)
          if (codigos.length && codigos[0].rawValue) { finalizar(codigos[0].rawValue); return }
        } catch (e) { /* frame ilegível — tenta o próximo, câmera às vezes falha um quadro */ }
        _qrScannerLoopId = requestAnimationFrame(tick)
      }
      _qrScannerLoopId = requestAnimationFrame(tick)
    } catch (e) {
      elErro.hidden = false
      elErro.textContent = e.name === 'NotAllowedError'
        ? 'Permissão de câmera negada — habilite nas configurações do navegador.'
        : 'Não foi possível acessar a câmera.'
      setTimeout(() => finalizar(null), 2500)
    }
  })
}
