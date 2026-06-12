// ── SIGUC Brigadas — ícones a partir do mascote (sem dependências) ──
// Lê app/resources/mascote-origem.png (banner com o selo circular do
// mascote), detecta e recorta o selo, e gera:
//   • app/resources/mascote-512.png  (master transparente)
//   • pwa/icons/mascote.png          (usado na UI do app/site)
//   • pwa/icons/icon-192/512.png     (selo sobre verde — PWA)
//   • android mipmaps: ic_launcher, ic_launcher_round, ic_launcher_foreground
// PNG decode/encode manual (zlib); reamostragem bilinear; máscara circular AA.

import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))
const RAIZ = dirname(APP)
const VERDE = [0x12, 0xA6, 0x6A]

// ── PNG: CRC + chunks (encoder) ───────────────────────────────
const CRC_TAB = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()
const crc32 = buf => {
  let c = 0xFFFFFFFF
  for (const b of buf) c = CRC_TAB[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function chunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length)
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo))
  return Buffer.concat([len, corpo, crc])
}
function pngEncode(largura, altura, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const linhas = Buffer.alloc(altura * (1 + largura * 4))
  for (let y = 0; y < altura; y++) {
    rgba.copy(linhas, y * (1 + largura * 4) + 1, y * largura * 4, (y + 1) * largura * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(linhas, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── PNG decoder (tipos 0, 2, 3, 6; 8 bits; sem entrelaçamento) ─
function pngDecode(buf) {
  let pos = 8
  let w, h, tipo, idat = [], plte = null, trns = null
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const nome = buf.toString('ascii', pos + 4, pos + 8)
    const dados = buf.subarray(pos + 8, pos + 8 + len)
    if (nome === 'IHDR') {
      w = dados.readUInt32BE(0); h = dados.readUInt32BE(4)
      if (dados[8] !== 8) throw new Error(`bit depth ${dados[8]} não suportado`)
      tipo = dados[9]
      if (dados[12] !== 0) throw new Error('PNG entrelaçado não suportado')
    }
    else if (nome === 'PLTE') plte = dados
    else if (nome === 'tRNS') trns = dados
    else if (nome === 'IDAT') idat.push(dados)
    else if (nome === 'IEND') break
    pos += 12 + len
  }
  const canais = { 0: 1, 2: 3, 3: 1, 6: 4 }[tipo]
  if (!canais) throw new Error(`color type ${tipo} não suportado`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * canais
  const px = Buffer.alloc(h * stride)

  // Desfaz filtros por scanline
  for (let y = 0; y < h; y++) {
    const filtro = raw[y * (stride + 1)]
    const linha = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = px.subarray(y * stride, (y + 1) * stride)
    const ant = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= canais ? out[i - canais] : 0
      const b = ant ? ant[i] : 0
      const c = (ant && i >= canais) ? ant[i - canais] : 0
      let v = linha[i]
      if (filtro === 1) v += a
      else if (filtro === 2) v += b
      else if (filtro === 3) v += (a + b) >> 1
      else if (filtro === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      out[i] = v & 0xFF
    }
  }

  // Converte para RGBA
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    if (tipo === 6) {
      rgba[i*4] = px[i*4]; rgba[i*4+1] = px[i*4+1]; rgba[i*4+2] = px[i*4+2]; rgba[i*4+3] = px[i*4+3]
    } else if (tipo === 2) {
      rgba[i*4] = px[i*3]; rgba[i*4+1] = px[i*3+1]; rgba[i*4+2] = px[i*3+2]; rgba[i*4+3] = 255
    } else if (tipo === 3) {
      const p = px[i]
      rgba[i*4] = plte[p*3]; rgba[i*4+1] = plte[p*3+1]; rgba[i*4+2] = plte[p*3+2]
      rgba[i*4+3] = trns && p < trns.length ? trns[p] : 255
    } else {
      rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = px[i]; rgba[i*4+3] = 255
    }
  }
  return { w, h, rgba }
}

// ── Amostragem bilinear ────────────────────────────────────────
function amostra(img, x, y) {
  const x0 = Math.max(0, Math.min(img.w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(img.h - 1, Math.floor(y)))
  const x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const p = (xx, yy, c) => img.rgba[(yy * img.w + xx) * 4 + c]
  const out = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    out[c] = p(x0, y0, c) * (1 - fx) * (1 - fy) + p(x1, y0, c) * fx * (1 - fy)
           + p(x0, y1, c) * (1 - fx) * fy       + p(x1, y1, c) * fx * fy
  }
  return out
}

// ── Pipeline ───────────────────────────────────────────────────
const origem = pngDecode(readFileSync(join(APP, 'resources/mascote-origem.png')))

// Fundo = cor do canto; selo = bounding box dos pixels diferentes do fundo
const bg = [origem.rgba[0], origem.rgba[1], origem.rgba[2]]
let minX = origem.w, minY = origem.h, maxX = 0, maxY = 0
for (let y = 0; y < origem.h; y++) {
  for (let x = 0; x < origem.w; x++) {
    const i = (y * origem.w + x) * 4
    const d = Math.abs(origem.rgba[i] - bg[0]) + Math.abs(origem.rgba[i+1] - bg[1]) + Math.abs(origem.rgba[i+2] - bg[2])
    if (d > 48) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
}
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
const raio = Math.max(maxX - minX, maxY - minY) / 2
console.log(`Selo detectado: centro (${cx.toFixed(0)}, ${cy.toFixed(0)}), raio ${raio.toFixed(0)}px`)

// Renderiza o selo em um canvas tam×tam com máscara circular antialiased.
// escala: fração do canvas ocupada pelo selo. fundo: null = transparente.
function renderSelo(tam, escala, fundo) {
  const rgba = Buffer.alloc(tam * tam * 4)
  const rSelo = (tam * escala) / 2
  const cTam = tam / 2
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      const i = (y * tam + x) * 4
      const dx = x + 0.5 - cTam, dy = y + 0.5 - cTam
      const dist = Math.sqrt(dx * dx + dy * dy)
      // cobertura do círculo do selo com AA de 1px
      const cob = Math.max(0, Math.min(1, rSelo - dist + 0.5))
      let r, g, b, a
      if (cob > 0) {
        const [sr, sg, sb] = amostra(origem, cx + dx / rSelo * raio, cy + dy / rSelo * raio)
        if (fundo) {
          r = sr * cob + fundo[0] * (1 - cob)
          g = sg * cob + fundo[1] * (1 - cob)
          b = sb * cob + fundo[2] * (1 - cob)
          a = 255
        } else { r = sr; g = sg; b = sb; a = 255 * cob }
      } else if (fundo) {
        [r, g, b] = fundo; a = 255
      } else { r = g = b = a = 0 }
      rgba[i] = Math.round(r); rgba[i+1] = Math.round(g); rgba[i+2] = Math.round(b); rgba[i+3] = Math.round(a)
    }
  }
  return pngEncode(tam, tam, rgba)
}

function gravar(caminho, buf) {
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, buf)
  console.log(`  ${caminho.replace(RAIZ + '/', '')} (${buf.length} bytes)`)
}

console.log('Gerando ícones do mascote…')

// Master + UI (transparente)
gravar(join(APP, 'resources/mascote-512.png'), renderSelo(512, 1, null))
gravar(join(RAIZ, 'pwa/icons/mascote.png'),    renderSelo(512, 1, null))

// PWA (selo sobre verde — maskable-safe a 78%)
gravar(join(RAIZ, 'pwa/icons/icon-192.png'), renderSelo(192, 0.78, VERDE))
gravar(join(RAIZ, 'pwa/icons/icon-512.png'), renderSelo(512, 0.78, VERDE))

// Android mipmaps
const RES = join(APP, 'android/app/src/main/res')
const DPIS = [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]
for (const [dpi, tam, tamFg] of DPIS) {
  gravar(join(RES, `mipmap-${dpi}/ic_launcher.png`),            renderSelo(tam,   0.96, null))
  gravar(join(RES, `mipmap-${dpi}/ic_launcher_round.png`),      renderSelo(tam,   0.96, null))
  gravar(join(RES, `mipmap-${dpi}/ic_launcher_foreground.png`), renderSelo(tamFg, 0.58, null))
}

console.log('Ícones do mascote gerados.')
