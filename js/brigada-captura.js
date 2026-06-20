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

async function bCameraCapturar(videoEl, brigadista, gps, contexto = {}) {
  if (_capturaFotos.length >= 5) return null

  const canvas = document.createElement('canvas')
  canvas.width  = videoEl.videoWidth  || 1280
  canvas.height = videoEl.videoHeight || 720
  const ctx = canvas.getContext('2d')
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)

  await bCameraAguaMarca(ctx, canvas.width, canvas.height, brigadista, gps, contexto)

  return new Promise(resolve => {
    canvas.toBlob(async blob => {
      blob = await bInjetarExifGps(blob, gps)
      _capturaFotos.push(blob)
      resolve(blob)
    }, 'image/jpeg', 0.85)
  })
}

// Processa um arquivo de imagem (câmera nativa do SO via <input capture>
// ou foto escolhida da galeria), redimensiona, aplica marca d'água e
// devolve o Blob final — mesmo pipeline da câmera web.
async function bCapturaProcessarArquivo(file, brigadista, gps, contexto = {}) {
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload  = () => res(fr.result)
    fr.onerror = rej
    fr.readAsDataURL(file)
  })
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl })

  const maxLado = 1920
  let w = img.naturalWidth, h = img.naturalHeight
  if (Math.max(w, h) > maxLado) {
    const r = maxLado / Math.max(w, h)
    w = Math.round(w * r); h = Math.round(h * r)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  await bCameraAguaMarca(ctx, w, h, brigadista, gps, contexto)
  return new Promise(res => canvas.toBlob(
    async b => res(await bInjetarExifGps(b, gps)),
    'image/jpeg', 0.85
  ))
}

// Captura sem adicionar ao array global — fauna usa sua própria lista
async function bCameraCapturarPuro(videoEl, brigadista, gps, contexto = {}) {
  const canvas = document.createElement('canvas')
  canvas.width  = videoEl.videoWidth  || 1280
  canvas.height = videoEl.videoHeight || 720
  const ctx = canvas.getContext('2d')
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
  await bCameraAguaMarca(ctx, canvas.width, canvas.height, brigadista, gps, contexto)
  return new Promise(resolve => {
    canvas.toBlob(async blob => resolve(await bInjetarExifGps(blob, gps)), 'image/jpeg', 0.85)
  })
}

// ── Marca d'água ──────────────────────────────────────────────
async function bCameraAguaMarca(ctx, w, h, brigadista, gps, contexto = {}) {
  const linha1 = brigadista?.nome ?? 'Brigadista'
  const partes = []
  if (contexto.brigada) partes.push(contexto.brigada)
  if (contexto.equipe)  partes.push(`Equipe ${contexto.equipe}`)
  const linha2 = partes.length ? partes.join(' · ') : null
  const linha3 = gps
    ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
    : 'GPS indisponível'
  const linha4 = new Date().toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' })

  const pad = 12
  const fs  = Math.max(14, Math.round(h * 0.018))
  ctx.font = `${fs}px DM Mono, monospace`

  const linhas  = [linha1, linha2, linha3, linha4].filter(Boolean)
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
    // brigada/equipe em tom levemente diferente para destacar
    ctx.fillStyle = (i === 1 && linha2) ? '#C9E8D6' : '#ffffff'
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

  // Logos institucionais — canto inferior direito, discretas
  try {
    const logosCache = await bOfflineGetConfig('logos_cache_v2')
    // [src, escala]: SEMA −40% (0.60), Acre −15% (0.85)
    const entradas = [
      [logosCache?.sec, 0.60],
      [logosCache?.gov, 0.85],
    ].filter(([src]) => src)
    if (entradas.length) {
      const logoHBase = Math.max(36, Math.round(h * 0.065))
      const logoGap = Math.round(w * 0.012)
      const logoPad = pad

      // carrega imagens em paralelo
      const imgs = await Promise.all(entradas.map(([src]) => new Promise(res => {
        const img = new Image()
        img.onload = () => res(img)
        img.onerror = () => res(null)
        img.src = src
      })))

      // calcula dimensões individuais com escala por logo
      let totalW = 0
      const logoHMax = logoHBase // altura do container = logo maior (gov, 0.85)
      const dims = imgs.map((img, i) => {
        if (!img) return null
        const escala = entradas[i][1]
        const lh = Math.round(logoHBase * escala)
        const lw = Math.round(lh * (img.naturalWidth / img.naturalHeight))
        totalW += lw + logoGap
        return { img, lw, lh }
      }).filter(Boolean)
      totalW -= logoGap

      const bgX = w - logoPad - totalW - logoPad
      const bgY = h - logoPad - logoHMax - logoPad
      ctx.fillStyle = 'rgba(0,0,0,0.30)'
      ctx.beginPath()
      ctx.roundRect(bgX, bgY, totalW + logoPad * 2, logoHMax + logoPad * 1.2, 6)
      ctx.fill()

      // desenha logos da direita para esquerda, alinhadas na base
      let xRight = w - logoPad * 2
      for (const { img, lw, lh } of [...dims].reverse()) {
        xRight -= lw
        const yLogo = bgY + logoPad * 0.6 + (logoHMax - lh) / 2 // centraliza verticalmente
        ctx.globalAlpha = 0.85
        ctx.drawImage(img, xRight, yLogo, lw, lh)
        ctx.globalAlpha = 1
        xRight -= logoGap
      }
    }
  } catch (_) { /* logos opcionais — não bloqueiam a captura */ }
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

function bCapturaAdicionar(blob) {
  if (_capturaFotos.length >= 5) return false
  _capturaFotos.push(blob)
  return true
}

// ── Câmera nativa (app Capacitor) ─────────────────────────────
// No app instalado usamos a câmera nativa do Android (tela cheia,
// flash, zoom, foco por toque) via @capacitor/camera. A marca d'água
// é aplicada depois no canvas — mesmo pipeline da câmera web.
function bCameraEhNativa() {
  return !!(window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Camera)
}

async function bCameraNativaCapturar(brigadista, gps, source = 'CAMERA', contexto = {}) {
  let foto
  try {
    foto = await window.Capacitor.Plugins.Camera.getPhoto({
      source,                 // 'CAMERA' (câmera) ou 'PHOTOS' (galeria)
      resultType: 'base64',
      quality: 85,
      width: 1920,
      correctOrientation: true,
      saveToGallery: false,
    })
  } catch { return null }   // brigadista cancelou ou negou permissão
  if (!foto?.base64String) return null

  const img = new Image()
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
    img.src = `data:image/${foto.format ?? 'jpeg'};base64,${foto.base64String}`
  })

  const canvas = document.createElement('canvas')
  canvas.width  = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  await bCameraAguaMarca(ctx, canvas.width, canvas.height, brigadista, gps, contexto)

  return new Promise(resolve => canvas.toBlob(
    async b => resolve(await bInjetarExifGps(b, gps)),
    'image/jpeg', 0.85
  ))
}

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

// ── EXIF GPS — injeta coordenadas no JPEG ────────────────────
// Insere um segmento APP1/EXIF mínimo com as tags GPS logo após o
// marcador SOI do JPEG gerado pelo canvas. Permite que aplicativos
// de gestão de fotos, GIS e sistemas legais leiam as coordenadas
// diretamente do arquivo, sem depender de metadados externos.
async function bInjetarExifGps(blob, gps) {
  if (!gps || !isFinite(gps.lat) || !isFinite(gps.lng)) return blob

  const temAlt = gps.alt != null && isFinite(gps.alt)

  // Graus decimais → [graus, minutos, segundos×100] como racionais EXIF
  function toRat(deg) {
    const d = Math.abs(deg)
    const g = Math.floor(d)
    const m = Math.floor((d - g) * 60)
    const s = Math.round(((d - g) * 60 - m) * 60 * 100)
    return [[g, 1], [m, 1], [s, 100]]
  }

  const latRat = toRat(gps.lat)
  const lonRat = toRat(gps.lng)
  const latRef = gps.lat >= 0 ? 0x4E : 0x53   // 'N' | 'S'
  const lonRef = gps.lng >= 0 ? 0x45 : 0x57   // 'E' | 'W'
  const altCm  = temAlt ? Math.round(Math.abs(gps.alt) * 100) : 0
  const altRef = (temAlt && gps.alt < 0) ? 1 : 0

  // ── Layout do bloco TIFF (little-endian) ──────────────────────
  // 0–7   TIFF header
  // 8–25  IFD0  (1 entrada: ponteiro GPS 0x8825)
  // 26–X  GPS IFD
  // X…    dados dos racionais (Lat, Lon, Alt)
  const nGps     = temAlt ? 6 : 4
  const gpsStart = 26
  const gpsEnd   = gpsStart + 2 + nGps * 12 + 4
  const offLat   = gpsEnd
  const offLon   = offLat + 24        // 3 racionais × 8 bytes
  const offAlt   = offLon + 24        // 3 racionais × 8 bytes
  const totalTiff = temAlt ? offAlt + 8 : offAlt

  const buf = new ArrayBuffer(totalTiff)
  const dv  = new DataView(buf)
  const u8  = new Uint8Array(buf)
  let p = 0

  const w16 = v => { dv.setUint16(p, v, true); p += 2 }
  const w32 = v => { dv.setUint32(p, v, true); p += 4 }
  const rat  = (n, d) => { w32(n); w32(d) }

  // TIFF header
  u8[0] = 0x49; u8[1] = 0x49; p = 2
  w16(0x002A); w32(8)

  // IFD0 — 1 entrada (GPS sub-IFD)
  p = 8; w16(1)
  w16(0x8825); w16(4); w32(1); w32(gpsStart)
  w32(0)

  // GPS IFD
  p = gpsStart; w16(nGps)
  // LatRef   ASCII 2 inline
  w16(0x0001); w16(2); w32(2); dv.setUint8(p, latRef); p += 4
  // Latitude RATIONAL 3 → offset
  w16(0x0002); w16(5); w32(3); w32(offLat)
  // LonRef   ASCII 2 inline
  w16(0x0003); w16(2); w32(2); dv.setUint8(p, lonRef); p += 4
  // Longitude RATIONAL 3 → offset
  w16(0x0004); w16(5); w32(3); w32(offLon)
  if (temAlt) {
    // AltRef  BYTE 1 inline
    w16(0x0005); w16(1); w32(1); dv.setUint8(p, altRef); p += 4
    // Altitude RATIONAL 1 → offset
    w16(0x0006); w16(5); w32(1); w32(offAlt)
  }
  w32(0)  // next IFD

  // Dados racionais
  p = offLat;  latRat.forEach(([n, d]) => rat(n, d))
  p = offLon;  lonRat.forEach(([n, d]) => rat(n, d))
  if (temAlt) { p = offAlt; rat(altCm, 100) }

  // Montar APP1: FF E1 + length (BE) + "Exif\0\0" + TIFF
  const tiff = u8
  const exifHdr = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00])  // "Exif\0\0"
  const payloadLen = exifHdr.length + tiff.length
  const app1 = new Uint8Array(4 + payloadLen)
  app1[0] = 0xFF; app1[1] = 0xE1
  app1[2] = ((payloadLen + 2) >> 8) & 0xFF
  app1[3] =  (payloadLen + 2)       & 0xFF
  app1.set(exifHdr, 4)
  app1.set(tiff, 4 + exifHdr.length)

  // Inserir após o SOI (FF D8) do JPEG original
  const orig = new Uint8Array(await blob.arrayBuffer())
  const out  = new Uint8Array(orig.length + app1.length)
  out.set(orig.subarray(0, 2))                // FF D8
  out.set(app1, 2)                            // APP1 com GPS
  out.set(orig.subarray(2), 2 + app1.length)  // resto do JPEG

  return new Blob([out], { type: 'image/jpeg' })
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
