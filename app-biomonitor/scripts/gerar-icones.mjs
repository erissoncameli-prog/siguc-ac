// ── SIGUC Biomonitor — gerador de ícones Android (sem dependências) ──
// Decodifica pwa/icons/icon-biomonitor-512.png (tartaruga branca sobre teal)
// e grava os mipmaps do launcher + um splash teal sólido:
//   • mipmap-*/ic_launcher.png            (ícone legado, quadrado)
//   • mipmap-*/ic_launcher_round.png      (recorte circular)
//   • mipmap-*/ic_launcher_foreground.png (adaptativo, logo centrado)
//   • drawable*/splash.png                (fundo teal sólido do launch)
// PNG lido/gravado à mão (zlib + CRC32), reamostragem por média de área.

import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))
const RAIZ = dirname(APP)
const RES  = join(APP, 'android/app/src/main/res')

const TEAL = [0x0E, 0x48, 0x62]   // background_color do manifest (launch)

// ── CRC32 / chunks / encode PNG ────────────────────────────────
const CRC_TAB = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()
function crc32(buf) {
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
function encodePng(largura, altura, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4)
  ihdr[8] = 8; ihdr[9] = 6  // 8 bits, RGBA
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

// ── Decode PNG (8-bit RGBA, sem entrelaçamento) ────────────────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('não é PNG')
  const largura = buf.readUInt32BE(16), altura = buf.readUInt32BE(20)
  const bitDepth = buf[24], colorType = buf[25]
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`esperado 8-bit RGBA, veio depth ${bitDepth} type ${colorType}`)
  // Concatena IDAT
  let off = 8
  const idats = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const tipo = buf.toString('ascii', off + 4, off + 8)
    if (tipo === 'IDAT') idats.push(buf.subarray(off + 8, off + 8 + len))
    if (tipo === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idats))
  const bpp = 4, stride = largura * bpp
  const out = Buffer.alloc(altura * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < altura; y++) {
    const filtro = raw[y * (stride + 1)]
    const linha = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = linha[i]
      switch (filtro) {
        case 1: v = (v + a) & 0xFF; break
        case 2: v = (v + b) & 0xFF; break
        case 3: v = (v + ((a + b) >> 1)) & 0xFF; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
          v = (v + pr) & 0xFF; break
        }
      }
      cur[i] = v
    }
    cur.copy(out, y * stride)
    prev = cur
  }
  return { largura, altura, rgba: out }
}

// ── Reamostragem por média de área (downscale) → canvas destino ─
// escala em [0..1]: fração do canvas ocupada pelo logo (centralizado)
function reamostrar(src, tam, escala = 1) {
  const dst = Buffer.alloc(tam * tam * 4)   // transparente
  const alvo = Math.round(tam * escala)
  const off = Math.floor((tam - alvo) / 2)
  const sw = src.largura, sh = src.altura
  for (let dy = 0; dy < alvo; dy++) {
    const sy0 = Math.floor(dy * sh / alvo), sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) * sh / alvo))
    for (let dx = 0; dx < alvo; dx++) {
      const sx0 = Math.floor(dx * sw / alvo), sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) * sw / alvo))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * sw + sx) * 4
          r += src.rgba[i]; g += src.rgba[i + 1]; b += src.rgba[i + 2]; a += src.rgba[i + 3]; n++
        }
      }
      const i = ((dy + off) * tam + (dx + off)) * 4
      dst[i] = Math.round(r / n); dst[i + 1] = Math.round(g / n)
      dst[i + 2] = Math.round(b / n); dst[i + 3] = Math.round(a / n)
    }
  }
  return dst
}

function mascaraCircular(rgba, tam) {
  const c = (tam - 1) / 2, r = tam / 2
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      const dx = x - c, dy = y - c
      if (dx * dx + dy * dy > r * r) rgba[(y * tam + x) * 4 + 3] = 0
    }
  }
  return rgba
}

function solido(tam, cor) {
  const rgba = Buffer.alloc(tam * tam * 4)
  for (let i = 0; i < tam * tam; i++) {
    rgba[i * 4] = cor[0]; rgba[i * 4 + 1] = cor[1]; rgba[i * 4 + 2] = cor[2]; rgba[i * 4 + 3] = 255
  }
  return rgba
}

function gravar(caminho, buf) {
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, buf)
  console.log(`  ${caminho.replace(RAIZ + '/', '')} (${buf.length} bytes)`)
}

// ── Execução ───────────────────────────────────────────────────
console.log('Gerando ícones do Biomonitor…')
const src = decodePng(readFileSync(join(RAIZ, 'pwa/icons/icon-biomonitor-512.png')))

// mipmaps: [dpi, tam ícone, tam foreground adaptativo]
const DPIS = [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]
for (const [dpi, tam, tamFg] of DPIS) {
  gravar(join(RES, `mipmap-${dpi}/ic_launcher.png`),            encodePng(tam,   tam,   reamostrar(src, tam, 1)))
  gravar(join(RES, `mipmap-${dpi}/ic_launcher_round.png`),      encodePng(tam,   tam,   mascaraCircular(reamostrar(src, tam, 1), tam)))
  gravar(join(RES, `mipmap-${dpi}/ic_launcher_foreground.png`), encodePng(tamFg, tamFg, reamostrar(src, tamFg, 0.62)))
}

// splash: fundo teal sólido (esticado no launch — sólido não distorce)
const splash = encodePng(256, 256, solido(256, TEAL))
const SPLASHES = [
  'drawable/splash.png',
  'drawable-land-mdpi/splash.png', 'drawable-land-hdpi/splash.png', 'drawable-land-xhdpi/splash.png',
  'drawable-land-xxhdpi/splash.png', 'drawable-land-xxxhdpi/splash.png',
  'drawable-port-mdpi/splash.png', 'drawable-port-hdpi/splash.png', 'drawable-port-xhdpi/splash.png',
  'drawable-port-xxhdpi/splash.png', 'drawable-port-xxxhdpi/splash.png',
]
for (const p of SPLASHES) gravar(join(RES, p), splash)

console.log('Ícones do Biomonitor gerados.')
