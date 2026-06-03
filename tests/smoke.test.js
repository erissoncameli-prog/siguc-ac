// ── SIGUC-AC · Smoke / Regression Tests (Regra 8) ────────────────
// Requer: npm install -D playwright @playwright/test
// Executar: npx playwright test tests/smoke.test.js

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

// ── Health endpoints ──────────────────────────────────────────────
test('health/live retorna 200', async ({ request }) => {
  const res = await request.get(`${BASE}/api/health/live`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('alive');
});

test('health retorna 200 ou 207 com checks', async ({ request }) => {
  const res = await request.get(`${BASE}/api/health`);
  expect([200, 207]).toContain(res.status());
  const body = await res.json();
  expect(body).toHaveProperty('checks');
  expect(body).toHaveProperty('status');
  expect(['healthy', 'degraded']).toContain(body.status);
});

// ── Páginas críticas carregam ─────────────────────────────────────
test('index.html carrega', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  await expect(page).toHaveTitle(/SIGUC/i);
});

test('dashboard redireciona para login quando não autenticado', async ({ page }) => {
  await page.goto(`${BASE}/pages/dashboard.html`);
  // Aguarda redirect ou presença de formulário de login
  await page.waitForTimeout(1500);
  const url = page.url();
  const hasLogin = url.includes('index') || await page.locator('input[type="password"]').count() > 0;
  expect(hasLogin).toBeTruthy();
});

// ── Login — caminho de falha esperado ─────────────────────────────
test('login com credenciais inválidas exibe erro', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  await page.fill('input[type="email"]',    'invalido@teste.com');
  await page.fill('input[type="password"]', 'senhaerrada');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  // Deve continuar na mesma página (não redireciona para dashboard)
  expect(page.url()).not.toContain('dashboard');
});

// ── Observabilidade client-side ───────────────────────────────────
test('Observability está disponível no window', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  const hasObs = await page.evaluate(() => typeof window.Observability !== 'undefined');
  expect(hasObs).toBe(true);
});

test('Request ID é gerado e tem formato UUID', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  const requestId = await page.evaluate(() => window.Observability?.getRequestId());
  expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
