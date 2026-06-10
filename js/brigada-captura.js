// ── SIGUC Brigadas — Câmera, GPS e Marca d'água ───────────────

let _stream = null
let _capturaFotos = []   // array de Blobs (max 5)
let _gpsAtual = null
let _gpsWatchId = null

// ── Câmera ────────────────────────────────────────────────────
async function bCameraAbrir(videoEl) {
  bCameraFechar()
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    videoEl.srcObject = _stream
    await videoEl.play()
    return true
  } catch (err) {
    console.warn('[brigada-captura] câmera:', err)
    return false
  }
}

function bCameraFechar() {
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null }
}

async function bCameraCapturar(videoEl, brigadista, gps) {
  if (_capturaFotos.length >= 5) return null

  const canvas = document.createElement('canvas')
  canvas.width  = videoEl.videoWidth  || 1280
  canvas.height = videoEl.videoHeight || 720
  const ctx = canvas.getContext('2d')
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)

  bCameraAguaMarca(ctx, canvas.width, canvas.height, brigadista, gps)

  return new Promise(resolve => {
    canvas.toBlob(blob => {
      _capturaFotos.push(blob)
      resolve(blob)
    }, 'image/jpeg', 0.85)
  })
}

// Captura sem adicionar ao array global — fauna usa sua própria lista
async function bCameraCapturarPuro(videoEl, brigadista, gps) {
  const canvas = document.createElement('canvas')
  canvas.width  = videoEl.videoWidth  || 1280
  canvas.height = videoEl.videoHeight || 720
  const ctx = canvas.getContext('2d')
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
  bCameraAguaMarca(ctx, canvas.width, canvas.height, brigadista, gps)
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85)
  })
}

// ── Marca d'água ──────────────────────────────────────────────
function bCameraAguaMarca(ctx, w, h, brigadista, gps) {
  const linha1 = brigadista?.nome ?? 'Brigadista'
  const linha2 = gps
    ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
    : 'GPS indisponível'
  const linha3 = new Date().toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' })

  const pad = 12
  const fs  = Math.max(14, Math.round(h * 0.018))
  ctx.font = `${fs}px DM Mono, monospace`

  const linhas  = [linha1, linha2, linha3]
  const largMax = Math.max(...linhas.map(l => ctx.measureText(l).width))
  const alturaCaixa = (fs + 4) * linhas.length + pad * 2

  const x = pad
  const y = h - alturaCaixa - pad

  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  ctx.roundRect(x, y, largMax + pad * 2, alturaCaixa, 6)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  linhas.forEach((l, i) => {
    ctx.fillText(l, x + pad, y + pad + fs + i * (fs + 4))
  })

  // SIGUC badge
  ctx.font = `bold ${fs * 0.9}px DM Sans, sans-serif`
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  const badge = 'SIGUC/SEMA-AC'
  const bw = ctx.measureText(badge).width + pad * 2
  ctx.beginPath()
  ctx.roundRect(w - bw - pad, pad, bw, fs + pad * 1.5, 6)
  ctx.fill()
  ctx.fillStyle = '#7BE0AE'
  ctx.fillText(badge, w - bw - pad + pad, pad + fs)
}

// ── Galeria de preview ────────────────────────────────────────
function bCapturaMostrarGaleria(containerEl) {
  containerEl.innerHTML = ''
  _capturaFotos.forEach((blob, i) => {
    const url  = URL.createObjectURL(blob)
    const wrap = document.createElement('div')
    wrap.className = 'foto-thumb'
    wrap.innerHTML = `
      <img src="${url}" alt="foto ${i+1}" loading="lazy">
      <button class="foto-del" data-i="${i}" aria-label="Remover foto ${i+1}">✕</button>
    `
    wrap.querySelector('.foto-del').addEventListener('click', () => {
      URL.revokeObjectURL(url)
      _capturaFotos.splice(i, 1)
      bCapturaMostrarGaleria(containerEl)
    })
    containerEl.appendChild(wrap)
  })
}

function bCapturaGetFotos() { return [..._capturaFotos] }
function bCapturaLimpar()   { _capturaFotos = [] }

// ── GPS ───────────────────────────────────────────────────────
function bGpsIniciar(onAtualizar) {
  if (!('geolocation' in navigator)) return

  const opt = { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }

  _gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      _gpsAtual = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy,
        alt: pos.coords.altitude,
        ts:  pos.timestamp,
      }
      if (onAtualizar) onAtualizar(_gpsAtual)
    },
    err => console.warn('[brigada-captura] GPS:', err),
    opt
  )
}

function bGpsParar() {
  if (_gpsWatchId != null) { navigator.geolocation.clearWatch(_gpsWatchId); _gpsWatchId = null }
}

function bGpsAtual() { return _gpsAtual }

async function bGpsUmaLeitura() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('GPS não disponível')); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy,
        alt: pos.coords.altitude,
        ts:  pos.timestamp,
      }),
      reject,
      { enableHighAccuracy: true, timeout: 15000 }
    )
  })
}

// ── Formatar coords para exibição ─────────────────────────────
function bGpsFormatarDMS(lat, lng) {
  const fmt = (deg, pos, neg) => {
    const d = Math.abs(deg)
    const g = Math.floor(d)
    const m = Math.floor((d - g) * 60)
    const s = ((d - g - m / 60) * 3600).toFixed(1)
    return `${g}°${m}'${s}" ${deg >= 0 ? pos : neg}`
  }
  return `${fmt(lat, 'N', 'S')}  ${fmt(lng, 'E', 'O')}`
}
