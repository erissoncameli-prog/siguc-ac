// ── SIGUC Brigadas — ícones de classe de fauna (sem dependências) ──
// Lê app/resources/fauna-grid.png (grade 3x2 de fotos da fauna
// amazônica gerada por IA) e recorta cada quadro em círculo compacto
// (144px) para o seletor de classes da tela Registrar Animal.
// O recorte circular central elimina as margens e a marca d'água.

import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))
const RAIZ = dirname(APP)

// ── PNG encode (igual aos demais geradores) ───────────────────
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

// ── PNG decode (tipos 0/2/3/6, 8 bits) ────────────────────────
function pngDecode(buf) {
  let pos = 8
  let w, h, tipo, idat = [], plte = null, trns = null
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const nome = buf.toString('ascii', pos + 4, pos + 8)
    const dados = buf.subarray(pos + 8, pos + 8 + len)
    if (nome === 'IHDR') {
      w = dados.readUInt32BE(0); h = dados.readUInt32BE(4)
      if (dados[8] !== 8) throw new Error('bit depth não suportado')
      tipo = dados[9]
      if (dados[12] !== 0) throw new Error('entrelaçado não suportado')
    }
    else if (nome === 'PLTE') plte = dados
    else if (nome === 'tRNS') trns = dados
    else if (nome === 'IDAT') idat.push(dados)
    else if (nome === 'IEND') break
    pos += 12 + len
  }
  const canais = { 0: 1, 2: 3, 3: 1, 6: 4 }[tipo]
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * canais
  const px = Buffer.alloc(h * stride)
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
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    if (tipo === 6) { rgba[i*4]=px[i*4]; rgba[i*4+1]=px[i*4+1]; rgba[i*4+2]=px[i*4+2]; rgba[i*4+3]=px[i*4+3] }
    else if (tipo === 2) { rgba[i*4]=px[i*3]; rgba[i*4+1]=px[i*3+1]; rgba[i*4+2]=px[i*3+2]; rgba[i*4+3]=255 }
    else if (tipo === 3) {
      const p = px[i]
      rgba[i*4]=plte[p*3]; rgba[i*4+1]=plte[p*3+1]; rgba[i*4+2]=plte[p*3+2]
      rgba[i*4+3]=trns && p < trns.length ? trns[p] : 255
    }
    else { rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=px[i]; rgba[i*4+3]=255 }
  }
  return { w, h, rgba }
}

// ── Recorte circular com downsample supersampled ──────────────
const SS = 4
function recortarCirculo(img, cx, cy, raioFonte, tamSaida) {
  const rgba = Buffer.alloc(tamSaida * tamSaida * 4)
  const rSaida = tamSaida / 2
  for (let y = 0; y < tamSaida; y++) {
    for (let x = 0; x < tamSaida; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ox = x + (sx + 0.5) / SS, oy = y + (sy + 0.5) / SS
          const dx = ox - rSaida, dy = oy - rSaida
          if (Math.sqrt(dx * dx + dy * dy) > rSaida) continue
          const fx = Math.round(cx + dx / rSaida * raioFonte)
          const fy = Math.round(cy + dy / rSaida * raioFonte)
          if (fx < 0 || fy < 0 || fx >= img.w || fy >= img.h) continue
          const i = (fy * img.w + fx) * 4
          r += img.rgba[i]; g += img.rgba[i+1]; b += img.rgba[i+2]; a += 255
        }
      }
      const n = SS * SS
      const i = (y * tamSaida + x) * 4
      rgba[i]   = Math.round(r / n / (a / n / 255 || 1))
      rgba[i+1] = Math.round(g / n / (a / n / 255 || 1))
      rgba[i+2] = Math.round(b / n / (a / n / 255 || 1))
      rgba[i+3] = Math.round(a / n)
    }
  }
  return pngEncode(tamSaida, tamSaida, rgba)
}

// ── Pipeline ───────────────────────────────────────────────────
const img = pngDecode(readFileSync(join(APP, 'resources/fauna-grid.png')))
console.log(`Origem: ${img.w}x${img.h}`)

const celW = img.w / 3, celH = img.h / 2
// raio: 42% da célula — fica dentro do quadro, fora das margens/marca d'água
const raio = Math.min(celW, celH) * 0.42

// [classe, coluna, linha, offsetY (fração da célula), fatorRaio]
// invertebrado: centro mais alto e raio menor para escapar da
// marca d'água no rodapé da imagem original
const MAPA = [
  ['mamifero',     0, 0, 0,     1   ], ['ave',   1, 0, 0, 1], ['reptil',       2, 0, 0,     1   ],
  ['anfibio',      0, 1, 0,     1   ], ['peixe', 1, 1, 0, 1], ['invertebrado', 2, 1, -0.07, 0.88],
]

const DEST = join(RAIZ, 'pwa/icons/fauna')
mkdirSync(DEST, { recursive: true })

for (const [classe, col, lin, offY, fator] of MAPA) {
  const cx = col * celW + celW / 2
  const cy = lin * celH + celH / 2 + offY * celH
  const buf = recortarCirculo(img, cx, cy, raio * fator, 144)
  writeFileSync(join(DEST, `${classe}.png`), buf)
  console.log(`  pwa/icons/fauna/${classe}.png (${buf.length} bytes)`)
}
console.log('Ícones de fauna gerados.')
