// ── Otimização de foto · fonte única js/foto-otimizar.js ──────────
// Executar: npx playwright test tests/foto-otimizar.test.js
//
// O módulo reduz o tamanho de arquivo das fotos antes do upload
// (redimensiona + reencoda WebP/JPEG) e mantém o EXIF GPS nos DOIS
// contêineres. Estes testes travam o que não pode quebrar:
//
//  1. REDUZ DE VERDADE. Foto grande sai menor e com o lado máximo
//     respeitado — a régua é o Chromium real (WebP encode existe aqui).
//  2. NUNCA CRESCE. Imagem já pequena/otimizada volta o ORIGINAL, nunca
//     um arquivo maior (fail-safe).
//  3. EXIF NO CONTÊINER CERTO. JPEG ganha APP1/"Exif"; WebP vira
//     estendido (VP8X + chunk "EXIF") e continua decodificável como
//     imagem — a coordenada não pode custar um arquivo corrompido.
//  4. DEGRADA/são coerentes os utilitários (extensão pelo tipo).

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const HARNESS = `${BASE}/tests/fixtures/foto-otimizar-harness.html`;

async function abrir(page) {
  await page.goto(HARNESS);
  await page.waitForFunction(() => typeof window.otimizarFoto === 'function');
}

const GPS = { lat: -9.9754, lng: -67.8249, alt: 160 };

test('Chromium codifica WebP (base da estratégia)', async ({ page }) => {
  await abrir(page);
  expect(await page.evaluate(() => fotoWebpSuportado())).toBe(true);
});

test('reduz uma foto grande: lado máx 1600, arquivo menor, WebP', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(async () => {
    const orig = await gerarFotoGrande(3000, 2000, 'image/jpeg', 0.92);
    const otim = await otimizarFoto(orig);
    const d = await dimsDoBlob(otim);
    return { origSize: orig.size, otimSize: otim.size, tipo: otim.type, ...d };
  });
  expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(1600);
  expect(r.otimSize).toBeLessThan(r.origSize);
  expect(r.tipo).toBe('image/webp');
});

test('respeita maxLado customizado', async ({ page }) => {
  await abrir(page);
  const d = await page.evaluate(async () => {
    const orig = await gerarFotoGrande(2400, 1200, 'image/jpeg', 0.9);
    const otim = await otimizarFoto(orig, { maxLado: 1000 });
    return await dimsDoBlob(otim);
  });
  expect(Math.max(d.w, d.h)).toBe(1000);
});

test('fail-safe: imagem já pequena volta o ORIGINAL, nunca maior', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(async () => {
    const orig = await gerarFotoGrande(32, 32, 'image/jpeg', 0.6);
    const otim = await otimizarFoto(orig);
    return { origSize: orig.size, otimSize: otim.size, mesmo: otim === orig };
  });
  // Ou devolveu o próprio objeto, ou pelo menos não estourou o tamanho.
  expect(r.otimSize).toBeLessThanOrEqual(r.origSize);
});

test('EXIF GPS em JPEG entra num segmento APP1 "Exif"', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(async (gps) => {
    const c = canvasSimples(800, 600);
    const blob = await fotoCanvasParaBlob(c, { formato: 'image/jpeg', gps });
    const b = await bytesDoBlob(blob);
    const txt = String.fromCharCode(...b.slice(0, 64));
    return { tipo: blob.type, soi: b[0] === 0xFF && b[1] === 0xD8,
             app1: b[2] === 0xFF && b[3] === 0xE1, temExif: txt.includes('Exif') };
  }, GPS);
  expect(r.tipo).toBe('image/jpeg');
  expect(r.soi).toBe(true);
  expect(r.app1).toBe(true);
  expect(r.temExif).toBe(true);
});

test('EXIF GPS em WebP vira VP8X + chunk EXIF e ainda decodifica', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(async (gps) => {
    const c = canvasSimples(800, 600);
    const blob = await fotoCanvasParaBlob(c, { formato: 'image/webp', gps });
    const b = await bytesDoBlob(blob);
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    const txt = String.fromCharCode(...b);
    let decodifica = false;
    try { const bmp = await createImageBitmap(blob); decodifica = bmp.width === 800 && bmp.height === 600; } catch (_) {}
    return { tipo: blob.type,
             riff: String.fromCharCode(b[0],b[1],b[2],b[3]) === 'RIFF',
             webp: String.fromCharCode(b[8],b[9],b[10],b[11]) === 'WEBP',
             vp8x: fourcc === 'VP8X', temExifChunk: txt.includes('EXIF'), decodifica };
  }, GPS);
  expect(r.tipo).toBe('image/webp');
  expect(r.riff).toBe(true);
  expect(r.webp).toBe(true);
  expect(r.vp8x).toBe(true);
  expect(r.temExifChunk).toBe(true);
  expect(r.decodifica).toBe(true);
});

test('sem GPS o WebP não ganha chunk EXIF nem a flag', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(async () => {
    const c = canvasSimples(400, 300);
    const blob = await fotoCanvasParaBlob(c, { formato: 'image/webp' });
    const b = new Uint8Array(await blob.arrayBuffer());
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    // Se o encoder emitiu VP8X, a flag de EXIF (0x08) tem que estar
    // desligada; e nunca deve existir um chunk "EXIF".
    const flagExif = fourcc === 'VP8X' ? !!(b[20] & 0x08) : false;
    let temExifChunk = false, p = 12;
    while (p + 8 <= b.length) {
      const fcc = String.fromCharCode(b[p], b[p+1], b[p+2], b[p+3]);
      const sz = b[p+4] | (b[p+5]<<8) | (b[p+6]<<16) | (b[p+7]<<24);
      if (fcc === 'EXIF') temExifChunk = true;
      p += 8 + sz + (sz & 1);
    }
    return { flagExif, temExifChunk };
  });
  expect(r.flagExif).toBe(false);
  expect(r.temExifChunk).toBe(false);
});

test('fotoExtDoTipo mapeia o tipo do blob', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => ({
    webp: fotoExtDoTipo({ type: 'image/webp' }),
    jpg:  fotoExtDoTipo({ type: 'image/jpeg' }),
    png:  fotoExtDoTipo({ type: 'image/png' }),
    outro: fotoExtDoTipo({ type: 'application/pdf' }, 'bin'),
  }));
  expect(r).toEqual({ webp: 'webp', jpg: 'jpg', png: 'png', outro: 'bin' });
});
