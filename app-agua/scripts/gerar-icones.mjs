// ── SIGUC Água — gerador de ícones (sem dependências) ───────────
// Mesmo molde de app-frota/scripts/gerar-icones.mjs: reamostra as duas
// artes já prontas e opacas em pwa/icons/ para os tamanhos do Android —
// não há detecção de círculo nem composição, ambas já são quadrados.
//   • icon-agua-512.png            → mipmap ic_launcher / ic_launcher_round
//   • icon-agua-maskable-512.png   → mipmap ic_launcher_foreground (adaptativo)
//                                   → splash.png (fundo do launch screen)
// PNG lido/gravado à mão (zlib + CRC32), reamostragem por média de área.

import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))
const RAIZ = dirname(APP)
const RES  = join(APP, 'android/app/src/main/res')
const PWA  = join(RAIZ, 'pwa/icons')

// Verde --floresta do design system (mesmo tom já usado como fundo de
// icon-agua-maskable-512.png) — usado no fundo do launch screen.
const FLORESTA = [0x0A, 0x1A, 0x0F]   // #0A1A0F

// ── CRC32 / chunks / encode PNG ────────────────────────────────
const CRC_TAB = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c }
  return t
})()
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC_TAB[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
function chunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length)
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo))
  return Buffer.concat([len, corpo, crc])
}
function encodePng(largura, altura, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const linhas = Buffer.alloc(altura * (1 + largura * 4))
  for (let y = 0; y < altura; y++) rgba.copy(linhas, y * (1 + largura * 4) + 1, y * largura * 4, (y + 1) * largura * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(linhas, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Decode PNG (8-bit, RGB ou RGBA, sem entrelaçamento) → RGBA ──
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('não é PNG')
  const largura = buf.readUInt32BE(16), altura = buf.readUInt32BE(20)
  const bitDepth = buf[24], colorType = buf[25]
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`esperado 8-bit RGB/RGBA, veio depth ${bitDepth} type ${colorType}`)
  const canais = colorType === 6 ? 4 : 3
  let off = 8; const idats = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const tipo = buf.toString('ascii', off + 4, off + 8)
    if (tipo === 'IDAT') idats.push(buf.subarray(off + 8, off + 8 + len))
    if (tipo === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idats))
  const stride = largura * canais
  const lin = Buffer.alloc(altura * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < altura; y++) {
    const filtro = raw[y * (stride + 1)]
    const linha = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= canais ? cur[i - canais] : 0, b = prev[i], c = i >= canais ? prev[i - canais] : 0
      let v = linha[i]
      if (filtro === 1) v = (v + a) & 0xFF
      else if (filtro === 2) v = (v + b) & 0xFF
      else if (filtro === 3) v = (v + ((a + b) >> 1)) & 0xFF
      else if (filtro === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 0xFF }
      cur[i] = v
    }
    cur.copy(lin, y * stride); prev = cur
  }
  // Expande para RGBA
  const rgba = Buffer.alloc(largura * altura * 4)
  for (let p = 0; p < largura * altura; p++) {
    rgba[p * 4] = lin[p * canais]; rgba[p * 4 + 1] = lin[p * canais + 1]; rgba[p * 4 + 2] = lin[p * canais + 2]
    rgba[p * 4 + 3] = canais === 4 ? lin[p * canais + 3] : 255
  }
  return { largura, altura, rgba }
}

// Reamostra `src` (quadrado) para `tam`x`tam` por média de área, escalando
// o conteúdo por `escala` e centralizando sobre um canvas `bg` ([r,g,b]
// opaco) ou transparente (null)
function render(src, tam, escala = 1, bg = null) {
  const dst = Buffer.alloc(tam * tam * 4)
  if (bg) for (let p = 0; p < tam * tam; p++) { dst[p * 4] = bg[0]; dst[p * 4 + 1] = bg[1]; dst[p * 4 + 2] = bg[2]; dst[p * 4 + 3] = 255 }
  const alvo = Math.round(tam * escala), off = Math.floor((tam - alvo) / 2)
  const sw = src.largura, sh = src.altura
  for (let dy = 0; dy < alvo; dy++) {
    const sy0 = Math.floor(dy * sh / alvo), sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) * sh / alvo))
    for (let dx = 0; dx < alvo; dx++) {
      const sx0 = Math.floor(dx * sw / alvo), sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) * sw / alvo))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) { const i = (sy * sw + sx) * 4; const al = src.rgba[i + 3]; r += src.rgba[i] * al; g += src.rgba[i + 1] * al; b += src.rgba[i + 2] * al; a += al; n++ }
      const o = ((dy + off) * tam + (dx + off)) * 4
      const alpha = a / n
      if (alpha < 1) { if (!bg) { dst[o + 3] = 0 } continue }
      const fr = r / a, fg = g / a, fb = b / a
      dst[o] = Math.round(fr); dst[o + 1] = Math.round(fg); dst[o + 2] = Math.round(fb); dst[o + 3] = Math.round(alpha)
    }
  }
  return dst
}

function gravar(caminho, buf) { mkdirSync(dirname(caminho), { recursive: true }); writeFileSync(caminho, buf); console.log(`  ${caminho.replace(RAIZ + '/', '')} (${buf.length} bytes)`) }

// ── Execução ───────────────────────────────────────────────────
console.log('Gerando ícones da Água a partir de pwa/icons/icon-agua-*.png…')
const opaco = decodePng(readFileSync(join(PWA, 'icon-agua-512.png')))
const maskable = decodePng(readFileSync(join(PWA, 'icon-agua-maskable-512.png')))

// Android mipmaps. icon-agua-512.png tem cantos transparentes (recorte do
// squircle da arte original) — diferente do Frota, aqui passamos FLORESTA
// como fundo do ic_launcher/_round pré-adaptativo (Android <8) para não
// deixar canto transparente/vazado no launcher de aparelho antigo.
const DPIS = [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]
for (const [dpi, tam, tamFg] of DPIS) {
  gravar(join(RES, `mipmap-${dpi}/ic_launcher.png`),            encodePng(tam,   tam,   render(opaco, tam, 1, FLORESTA)))
  gravar(join(RES, `mipmap-${dpi}/ic_launcher_round.png`),      encodePng(tam,   tam,   render(opaco, tam, 1, FLORESTA)))
  gravar(join(RES, `mipmap-${dpi}/ic_launcher_foreground.png`), encodePng(tamFg, tamFg, render(maskable, tamFg, 1)))
}

// Splash: fundo verde sólido --floresta (esticado no launch — sólido não distorce)
const splashRgba = Buffer.alloc(256 * 256 * 4)
for (let p = 0; p < 256 * 256; p++) { splashRgba[p * 4] = FLORESTA[0]; splashRgba[p * 4 + 1] = FLORESTA[1]; splashRgba[p * 4 + 2] = FLORESTA[2]; splashRgba[p * 4 + 3] = 255 }
const splash = encodePng(256, 256, splashRgba)
const SPLASHES = ['drawable/splash.png',
  'drawable-land-mdpi/splash.png', 'drawable-land-hdpi/splash.png', 'drawable-land-xhdpi/splash.png', 'drawable-land-xxhdpi/splash.png', 'drawable-land-xxxhdpi/splash.png',
  'drawable-port-mdpi/splash.png', 'drawable-port-hdpi/splash.png', 'drawable-port-xhdpi/splash.png', 'drawable-port-xxhdpi/splash.png', 'drawable-port-xxxhdpi/splash.png']
for (const p of SPLASHES) gravar(join(RES, p), splash)

console.log('Ícones da Água gerados.')
