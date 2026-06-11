// ── SIGUC Brigadas — gerador de ícones (sem dependências) ─────
// Desenha a chama da brigada (branca sobre verde #12A66A) e grava:
//   • pwa/icons/icon-192.png e icon-512.png  (PWA do site)
//   • android mipmaps: ic_launcher, ic_launcher_round, ic_launcher_foreground
// PNG codificado manualmente (zlib + CRC32), raster com supersampling 4x4.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))
const RAIZ = dirname(APP)

const VERDE = [0x12, 0xA6, 0x6A]
const BRANCO = [0xFF, 0xFF, 0xFF]

// ── PNG ────────────────────────────────────────────────────────
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
function png(largura, altura, rgba) {
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

// ── Geometria da chama (coords normalizadas 0..1, y para baixo) ─
// Gota = círculo ∪ triângulo (ápice + 2 pontos de tangência)
function dentroGota(x, y, cx, cy, r, ax, ay) {
  const dx = x - cx, dy = y - cy
  if (dx * dx + dy * dy <= r * r) return true
  // tangentes do ápice (ax,ay) ao círculo
  const px = ax - cx, py = ay - cy
  const d2 = px * px + py * py, d = Math.sqrt(d2)
  if (d <= r) return false
  const a = r * r / d, h = r * Math.sqrt(d2 - r * r) / d
  const ux = px / d, uy = py / d
  const bx = cx + a * ux, by = cy + a * uy
  const t1x = bx - h * uy, t1y = by + h * ux
  const t2x = bx + h * uy, t2y = by - h * ux
  return dentroTriangulo(x, y, ax, ay, t1x, t1y, t2x, t2y)
}
function dentroTriangulo(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx)
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx)
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)
}

// Glifo: chama externa branca com núcleo na cor do fundo
// escala/offset permitem encolher o glifo dentro do canvas
function coberturaGlifo(x, y, escala, offX = 0, offY = 0) {
  const gx = (x - 0.5 - offX) / escala + 0.5
  const gy = (y - 0.5 - offY) / escala + 0.5
  const externa = dentroGota(gx, gy, 0.5, 0.60, 0.225, 0.5, 0.14)
  if (!externa) return 0
  const nucleo = dentroGota(gx, gy, 0.5, 0.685, 0.105, 0.5, 0.46)
  return nucleo ? 2 : 1   // 1 = branco, 2 = furo (cor do fundo)
}

// ── Máscaras de fundo ──────────────────────────────────────────
function mascaraFundo(x, y, forma) {
  if (forma === 'quadrado') return true
  if (forma === 'circulo') {
    const dx = x - 0.5, dy = y - 0.5
    return dx * dx + dy * dy <= 0.25
  }
  if (forma === 'arredondado') {  // rounded square r=18%
    const r = 0.18
    const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0)
    const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
    return dx * dx + dy * dy <= r * r
  }
  return false  // 'transparente' (foreground adaptativo)
}

// ── Raster ─────────────────────────────────────────────────────
const SS = 4  // supersampling 4x4
function renderizar(tam, forma, escalaGlifo) {
  const rgba = Buffer.alloc(tam * tam * 4)
  for (let py = 0; py < tam; py++) {
    for (let px = 0; px < tam; px++) {
      let fundo = 0, branco = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / tam
          const y = (py + (sy + 0.5) / SS) / tam
          const temFundo = mascaraFundo(x, y, forma)
          const g = coberturaGlifo(x, y, escalaGlifo)
          if (forma === 'transparente') {
            // foreground adaptativo: só o glifo (furo = transparente)
            if (g === 1) branco++
          } else {
            if (temFundo) fundo++
            if (temFundo && g === 1) branco++
          }
        }
      }
      const n = SS * SS
      const i = (py * tam + px) * 4
      if (forma === 'transparente') {
        rgba[i] = BRANCO[0]; rgba[i+1] = BRANCO[1]; rgba[i+2] = BRANCO[2]
        rgba[i+3] = Math.round(255 * branco / n)
      } else {
        // composição: verde de fundo, glifo branco, núcleo volta ao verde
        const aF = fundo / n, aB = (branco - 0) / n
        const verdeEfetivo = aF - aB / 1  // parte verde visível
        const r = (VERDE[0] * Math.max(verdeEfetivo, 0) + BRANCO[0] * aB) / Math.max(aF, 1e-6)
        const g2 = (VERDE[1] * Math.max(verdeEfetivo, 0) + BRANCO[1] * aB) / Math.max(aF, 1e-6)
        const b = (VERDE[2] * Math.max(verdeEfetivo, 0) + BRANCO[2] * aB) / Math.max(aF, 1e-6)
        rgba[i] = Math.min(255, Math.round(r))
        rgba[i+1] = Math.min(255, Math.round(g2))
        rgba[i+2] = Math.min(255, Math.round(b))
        rgba[i+3] = Math.round(255 * aF)
      }
    }
  }
  return png(tam, tam, rgba)
}

function gravar(caminho, buf) {
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, buf)
  console.log(`  ${caminho.replace(RAIZ + '/', '')} (${buf.length} bytes)`)
}

console.log('Gerando ícones…')

// PWA (corrige /pwa/icons ausente no site)
gravar(join(RAIZ, 'pwa/icons/icon-192.png'), renderizar(192, 'quadrado', 0.72))
gravar(join(RAIZ, 'pwa/icons/icon-512.png'), renderizar(512, 'quadrado', 0.72))

// Android mipmaps
const RES = join(APP, 'android/app/src/main/res')
const DPIS = [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]
for (const [dpi, tam, tamFg] of DPIS) {
  gravar(join(RES, `mipmap-${dpi}/ic_launcher.png`),            renderizar(tam,   'arredondado',  0.78))
  gravar(join(RES, `mipmap-${dpi}/ic_launcher_round.png`),      renderizar(tam,   'circulo',      0.70))
  gravar(join(RES, `mipmap-${dpi}/ic_launcher_foreground.png`), renderizar(tamFg, 'transparente', 0.40))
}

console.log('Ícones gerados.')
