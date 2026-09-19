// ── SIGUC — Otimização de foto (fonte única) ──────────────────────
//
// Reduz o tamanho de arquivo das fotos ANTES de subir ao Storage, sem
// perda de qualidade visual significativa. Mesma lição de
// js/frota-consumo.js / js/mapa-recorte.js: NENHUMA tela reimplementa
// redimensionamento/reencode/EXIF por conta própria — todas passam por
// aqui. Sem dependência nova (só canvas).
//
// Duas frentes usam este módulo:
//   1. Superfícies SEM marca d'água (Frota: defeito/abastecimento/
//      checklist; cadastros de mesa: veículo/motorista/brigadista/
//      equipamento/boletim) — chamam `otimizarFoto(file, {...})`, que
//      decodifica, redimensiona e reencoda. Hoje sobem o arquivo CRU do
//      celular (3–12 MB); passam a subir ~120–250 KB.
//   2. Pipeline de campo COM marca d'água (js/brigada-captura.js) — já
//      desenha a marca no canvas; chama `fotoCanvasParaBlob(canvas,
//      {...})` para o encode final + injeção de EXIF GPS.
//
// FORMATO: WebP quando o navegador/WebView sabe CODIFICAR (detecção
// única), com fallback automático para JPEG. WebP rende ~25–35% menor
// que JPEG na mesma qualidade — mas o encode chegou depois do decode em
// alguns motores, então a detecção + fallback é obrigatória para não
// quebrar aparelho antigo.
//
// FAIL-SAFE: qualquer falha de decode/encode devolve o arquivo
// ORIGINAL — otimizar foto nunca pode impedir o registro (regra do
// trabalho de campo). Se o resultado sair MAIOR que o original (imagem
// já pequena/comprimida), também devolve o original.

const FOTO_MAX_LADO_PADRAO = 1600
const FOTO_QUALIDADE_PADRAO = 0.80

// ── Detecção única: o motor sabe CODIFICAR WebP? ──────────────────
let _fotoWebpSuportado = null
function fotoWebpSuportado() {
  if (_fotoWebpSuportado != null) return _fotoWebpSuportado
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    // toDataURL cai para PNG quando o formato pedido não é suportado —
    // o prefixo do data URL é a prova síncrona e confiável.
    _fotoWebpSuportado = c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch (_) { _fotoWebpSuportado = false }
  return _fotoWebpSuportado
}

// Extensão de arquivo a partir do tipo do blob otimizado — para montar
// o `path` no Storage coerente com o conteúdo (webp/jpg/png).
function fotoExtDoTipo(blob, fallback = 'jpg') {
  const t = blob && blob.type
  if (t === 'image/webp') return 'webp'
  if (t === 'image/jpeg') return 'jpg'
  if (t === 'image/png')  return 'png'
  return fallback
}

function _fotoCanvasBlob(canvas, formato, q) {
  return new Promise(res => {
    try { canvas.toBlob(b => res(b), formato, q) }
    catch (_) { res(null) }
  })
}

// Decodifica File/Blob respeitando a orientação EXIF do original. Usa
// createImageBitmap (rápido, aplica orientação) com fallback para
// <img> nos motores que não aceitam a opção imageOrientation.
async function _fotoDecodificar(entrada) {
  try {
    return await createImageBitmap(entrada, { imageOrientation: 'from-image' })
  } catch (_) { /* motor sem a opção — tenta o caminho <img> */ }
  try {
    const url = URL.createObjectURL(entrada)
    try {
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
      return img
    } finally { URL.revokeObjectURL(url) }
  } catch (_) { return null }
}

function _fotoDims(src) {
  const w = src.width || src.naturalWidth || 0
  const h = src.height || src.naturalHeight || 0
  return { w, h }
}

// ── API 1 — arquivo → arquivo otimizado (sem marca d'água) ────────
async function otimizarFoto(entrada, opts = {}) {
  if (!entrada || typeof entrada.arrayBuffer !== 'function') return entrada
  const maxLado   = opts.maxLado   ?? FOTO_MAX_LADO_PADRAO
  const qualidade = opts.qualidade ?? FOTO_QUALIDADE_PADRAO

  const src = await _fotoDecodificar(entrada)
  if (!src) return entrada
  let { w, h } = _fotoDims(src)
  if (!w || !h) return entrada

  if (Math.max(w, h) > maxLado) {
    const r = maxLado / Math.max(w, h)
    w = Math.round(w * r); h = Math.round(h * r)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  try { canvas.getContext('2d').drawImage(src, 0, 0, w, h) }
  catch (_) { return entrada }
  if (src.close) { try { src.close() } catch (_) {} }

  const webp = opts.formato ? opts.formato === 'image/webp' : fotoWebpSuportado()
  const formato = opts.formato || (webp ? 'image/webp' : 'image/jpeg')
  let blob = await _fotoCanvasBlob(canvas, formato, qualidade)
  if (!blob && formato !== 'image/jpeg') blob = await _fotoCanvasBlob(canvas, 'image/jpeg', qualidade)
  if (!blob) return entrada

  // Nunca devolver algo maior que o original (imagem já otimizada).
  if (entrada.size && blob.size >= entrada.size) return entrada

  if (opts.gps) blob = await fotoInjetarExif(blob, opts.gps)
  return blob
}

// ── API 2 — canvas (com marca d'água) → blob final ───────────────
// Usado por js/brigada-captura.js depois de desenhar a marca d'água.
// Reencoda para WebP/JPEG e injeta o EXIF GPS no contêiner certo.
async function fotoCanvasParaBlob(canvas, opts = {}) {
  const qualidade = opts.qualidade ?? FOTO_QUALIDADE_PADRAO
  const webp = fotoWebpSuportado()
  const formato = opts.formato || (webp ? 'image/webp' : 'image/jpeg')
  let blob = await _fotoCanvasBlob(canvas, formato, qualidade)
  if (!blob && formato !== 'image/jpeg') blob = await _fotoCanvasBlob(canvas, 'image/jpeg', qualidade)
  if (!blob) return null
  if (opts.gps) blob = await fotoInjetarExif(blob, opts.gps)
  return blob
}

// ── EXIF GPS — bloco TIFF (little-endian) ─────────────────────────
// Constrói o bloco TIFF com as tags de GPS (Lat/Lon/Alt). É o mesmo
// payload para os dois contêineres: no JPEG entra num segmento APP1
// (prefixado por "Exif\0\0"); no WebP entra num chunk RIFF "EXIF" (sem
// prefixo). Antes vivia à mão em js/brigada-captura.js (bInjetarExifGps,
// só JPEG) — centralizado aqui para servir os dois formatos.
function fotoConstruirTiffGps(gps) {
  if (!gps || !isFinite(gps.lat) || !isFinite(gps.lng)) return null
  const temAlt = gps.alt != null && isFinite(gps.alt)

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

  const nGps     = temAlt ? 6 : 4
  const gpsStart = 26
  const gpsEnd   = gpsStart + 2 + nGps * 12 + 4
  const offLat   = gpsEnd
  const offLon   = offLat + 24
  const offAlt   = offLon + 24
  const totalTiff = temAlt ? offAlt + 8 : offAlt

  const buf = new ArrayBuffer(totalTiff)
  const dv  = new DataView(buf)
  const u8  = new Uint8Array(buf)
  let p = 0
  const w16 = v => { dv.setUint16(p, v, true); p += 2 }
  const w32 = v => { dv.setUint32(p, v, true); p += 4 }
  const rat = (n, d) => { w32(n); w32(d) }

  u8[0] = 0x49; u8[1] = 0x49; p = 2   // "II" little-endian
  w16(0x002A); w32(8)

  p = 8; w16(1)
  w16(0x8825); w16(4); w32(1); w32(gpsStart)   // ponteiro GPS sub-IFD
  w32(0)

  p = gpsStart; w16(nGps)
  w16(0x0001); w16(2); w32(2); dv.setUint8(p, latRef); p += 4   // LatRef
  w16(0x0002); w16(5); w32(3); w32(offLat)                     // Latitude
  w16(0x0003); w16(2); w32(2); dv.setUint8(p, lonRef); p += 4   // LonRef
  w16(0x0004); w16(5); w32(3); w32(offLon)                     // Longitude
  if (temAlt) {
    w16(0x0005); w16(1); w32(1); dv.setUint8(p, altRef); p += 4 // AltRef
    w16(0x0006); w16(5); w32(1); w32(offAlt)                   // Altitude
  }
  w32(0)  // next IFD

  p = offLat; latRat.forEach(([n, d]) => rat(n, d))
  p = offLon; lonRat.forEach(([n, d]) => rat(n, d))
  if (temAlt) { p = offAlt; rat(altCm, 100) }

  return u8
}

async function fotoInjetarExif(blob, gps) {
  const tiff = fotoConstruirTiffGps(gps)
  if (!tiff) return blob
  try {
    if (blob.type === 'image/webp') return await _fotoInjetarExifWebp(blob, tiff)
    if (blob.type === 'image/jpeg') return await _fotoInjetarExifJpeg(blob, tiff)
  } catch (_) { /* fail-open: devolve o arquivo válido sem EXIF */ }
  return blob
}

// JPEG: insere um segmento APP1 (FF E1) logo após o SOI (FF D8).
async function _fotoInjetarExifJpeg(blob, tiff) {
  const exifHdr = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00])  // "Exif\0\0"
  const payloadLen = exifHdr.length + tiff.length
  const app1 = new Uint8Array(4 + payloadLen)
  app1[0] = 0xFF; app1[1] = 0xE1
  app1[2] = ((payloadLen + 2) >> 8) & 0xFF
  app1[3] =  (payloadLen + 2)       & 0xFF
  app1.set(exifHdr, 4)
  app1.set(tiff, 4 + exifHdr.length)

  const orig = new Uint8Array(await blob.arrayBuffer())
  if (orig[0] !== 0xFF || orig[1] !== 0xD8) return blob  // não é JPEG válido
  const out = new Uint8Array(orig.length + app1.length)
  out.set(orig.subarray(0, 2))
  out.set(app1, 2)
  out.set(orig.subarray(2), 2 + app1.length)
  return new Blob([out], { type: 'image/jpeg' })
}

// WebP: o EXIF vai num chunk "EXIF" e o arquivo precisa estar no formato
// "estendido" (chunk VP8X com o bit de EXIF ligado). Dois caminhos:
//   (a) o encoder já emite VP8X — é o caso do Chromium/WebView, que
//       inclui VP8X + ICCP. Basta LIGAR o bit de EXIF nas flags e
//       ANEXAR o chunk EXIF ao final (EXIF/XMP vêm depois da imagem).
//   (b) o encoder emite o formato "simples" (RIFF/WEBP + 1 chunk VP8 ) —
//       aí montamos o VP8X do zero antes da imagem.
// Chunks RIFF são alinhados em bytes pares (pad 0x00 quando o tamanho é
// ímpar; o pad não entra no campo size, mas conta no total do RIFF).
async function _fotoInjetarExifWebp(blob, tiff) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'RIFF') return blob
  if (String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) !== 'WEBP') return blob
  const fourcc = String.fromCharCode(buf[12], buf[13], buf[14], buf[15])

  const pad = n => (n & 1) ? 1 : 0
  const exifChunk = () => {
    const c = new Uint8Array(8 + tiff.length + pad(tiff.length))
    c[0] = 0x45; c[1] = 0x58; c[2] = 0x49; c[3] = 0x46          // "EXIF"
    const sz = tiff.length
    c[4] = sz & 0xFF; c[5] = (sz >> 8) & 0xFF; c[6] = (sz >> 16) & 0xFF; c[7] = (sz >> 24) & 0xFF
    c.set(tiff, 8)
    return c
  }
  const comRiffSize = out => {
    const total = out.length - 8
    out[4] = total & 0xFF; out[5] = (total >> 8) & 0xFF
    out[6] = (total >> 16) & 0xFF; out[7] = (total >> 24) & 0xFF
    return out
  }

  // ── (a) já é VP8X: liga a flag de EXIF e anexa o chunk ao final ──
  if (fourcc === 'VP8X') {
    const chunk = exifChunk()
    const out = new Uint8Array(buf.length + chunk.length)
    out.set(buf, 0)
    out[20] = out[20] | 0x08                       // flags do VP8X (offset 12+8) + EXIF
    out.set(chunk, buf.length)
    return new Blob([comRiffSize(out)], { type: 'image/webp' })
  }

  // ── (b) formato simples: monta VP8X do zero antes da imagem ──
  const dv = new DataView(buf.buffer)
  const imgSize = dv.getUint32(16, true)
  const imgData = buf.subarray(20, 20 + imgSize)
  // VP8 (lossy) guarda 14 bits de largura/altura após o start code.
  let cw = 0, ch = 0
  if (fourcc === 'VP8 ' && imgData.length >= 10) {
    cw = (imgData[6] | (imgData[7] << 8)) & 0x3FFF
    ch = (imgData[8] | (imgData[9] << 8)) & 0x3FFF
  }
  if (!cw || !ch) return blob

  const vp8x = new Uint8Array(10)
  vp8x[0] = 0x08
  const cwm = cw - 1, chm = ch - 1
  vp8x[4] = cwm & 0xFF; vp8x[5] = (cwm >> 8) & 0xFF; vp8x[6] = (cwm >> 16) & 0xFF
  vp8x[7] = chm & 0xFF; vp8x[8] = (chm >> 8) & 0xFF; vp8x[9] = (chm >> 16) & 0xFF

  const chunks = []
  const put = (fcc, data, padBytes) => {
    const hdr = new Uint8Array(8)
    for (let i = 0; i < 4; i++) hdr[i] = fcc.charCodeAt(i)
    const sz = data.length
    hdr[4] = sz & 0xFF; hdr[5] = (sz >> 8) & 0xFF; hdr[6] = (sz >> 16) & 0xFF; hdr[7] = (sz >> 24) & 0xFF
    chunks.push(hdr, data)
    if (padBytes) chunks.push(new Uint8Array(1))
  }
  put('VP8X', vp8x, 0)
  put(fourcc, imgData, pad(imgSize))
  put('EXIF', tiff, pad(tiff.length))

  let corpo = 0
  chunks.forEach(c => corpo += c.length)
  const out = new Uint8Array(12 + corpo)
  out[0] = 0x52; out[1] = 0x49; out[2] = 0x46; out[3] = 0x46   // RIFF
  out[8] = 0x57; out[9] = 0x45; out[10] = 0x42; out[11] = 0x50 // WEBP
  let p = 12
  chunks.forEach(c => { out.set(c, p); p += c.length })
  return new Blob([comRiffSize(out)], { type: 'image/webp' })
}
