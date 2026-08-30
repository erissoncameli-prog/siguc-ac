// ── SIGUC-AC · Leitor de QR por câmera (js/qr-scanner.js) ─────────
// Executar: npx playwright test tests/qr-scanner.test.js
//
// Fonte única reaproveitada por pages/agua-laudos.html (achar a
// coleta pela etiqueta em vez de procurar na tabela). A câmera de
// verdade nunca existe neste ambiente de execução — todo teste aqui
// stuba `navigator.mediaDevices.getUserMedia` e `window.BarcodeDetector`,
// nunca pede permissão real. `tests/fixtures/qr-scanner-harness.html`
// isola o módulo (sem config.js/Supabase), mesmo padrão de
// tests/pin-baralho.test.js.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

test('qrScannerSuportado() reflete a presença de BarcodeDetector', async ({ page }) => {
  await page.goto(`${BASE}/tests/fixtures/qr-scanner-harness.html`);

  const semSuporte = await page.evaluate(() => {
    delete window.BarcodeDetector;
    return qrScannerSuportado();
  });
  expect(semSuporte).toBe(false);

  const comSuporte = await page.evaluate(() => {
    window.BarcodeDetector = class {};
    return qrScannerSuportado();
  });
  expect(comSuporte).toBe(true);
});

test('sem suporte do navegador, resolve null na hora — nunca pede câmera', async ({ page }) => {
  await page.goto(`${BASE}/tests/fixtures/qr-scanner-harness.html`);

  const r = await page.evaluate(async () => {
    delete window.BarcodeDetector;
    let pediuCamera = false;
    navigator.mediaDevices.getUserMedia = () => { pediuCamera = true; return Promise.reject(new Error('não deveria chamar')); };
    const resultado = await qrScannerAbrir({ titulo: 'Teste' });
    return { resultado, pediuCamera };
  });

  expect(r.resultado).toBeNull();
  expect(r.pediuCamera).toBe(false);
});

test('lê o QR e fecha o overlay sozinho (caminho feliz)', async ({ page }) => {
  await page.goto(`${BASE}/tests/fixtures/qr-scanner-harness.html`);

  const resultadoPromise = page.evaluate(async () => {
    window.BarcodeDetector = class {
      constructor() {}
      async detect() { return [{ rawValue: 'COL-2026-0042' }]; }
    };
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    return qrScannerAbrir({ titulo: 'Escanear etiqueta' });
  });

  // Overlay tem que estar visível ENQUANTO a leitura acontece.
  await page.locator('.qrscan-overlay.aberto').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#qrscan-titulo')).toHaveText('Escanear etiqueta');

  const resultado = await resultadoPromise;
  expect(resultado).toBe('COL-2026-0042');
  await expect(page.locator('.qrscan-overlay')).not.toHaveClass(/aberto/);
});

test('cancelar fecha a câmera e resolve null (nunca deixa a câmera ligada)', async ({ page }) => {
  await page.goto(`${BASE}/tests/fixtures/qr-scanner-harness.html`);

  const paradaPromise = page.evaluate(() => {
    window.BarcodeDetector = class {
      constructor() {}
      async detect() { return []; } // nunca acha nada — só o cancelamento resolve
    };
    let parou = false;
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = new MediaStream();
      stream.getTracks = () => [{ stop: () => { parou = true } }];
      return stream;
    };
    window._qrTesteParou = () => parou;
    return qrScannerAbrir({ titulo: 'Teste cancelar' });
  });

  await page.locator('.qrscan-overlay.aberto').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#qrscan-fechar').click();

  const resultado = await paradaPromise;
  expect(resultado).toBeNull();
  const parou = await page.evaluate(() => window._qrTesteParou());
  expect(parou).toBe(true);
});

test('erro de câmera (permissão negada) mostra aviso e resolve null', async ({ page }) => {
  await page.goto(`${BASE}/tests/fixtures/qr-scanner-harness.html`);

  const resultadoPromise = page.evaluate(() => {
    window.BarcodeDetector = class {};
    navigator.mediaDevices.getUserMedia = async () => {
      const erro = new Error('negado'); erro.name = 'NotAllowedError';
      throw erro;
    };
    return qrScannerAbrir({ titulo: 'Teste erro' });
  });

  await expect(page.locator('#qrscan-erro')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#qrscan-erro')).toContainText('Permissão de câmera negada');

  const resultado = await resultadoPromise;
  expect(resultado).toBeNull();
});
