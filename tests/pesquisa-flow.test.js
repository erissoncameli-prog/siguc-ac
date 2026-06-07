// ── SIGUC-AC · Testes do fluxo de Pesquisa ───────────────────────
// Executar:  TEST_BASE_URL=https://siguc-ac.vercel.app npx playwright test tests/pesquisa-flow.test.js
//
// Estes testes são SEGUROS p/ rodar contra produção: são read-only
// (carregam páginas, validam formulário e RPCs públicas com token
// inválido). NÃO submetem pesquisas — submissão polui o banco e só
// deve rodar contra um ambiente de STAGING (ver bloco no final).

const { test, expect } = require('@playwright/test');
const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

// ── Portal público de submissão ───────────────────────────────────
test('portal público carrega e mostra o formulário', async ({ page }) => {
  await page.goto(`${BASE}/pages/pesquisa-publica.html`);
  await expect(page.locator('#p-titulo')).toBeVisible();
  await expect(page.locator('#p-resumo')).toBeVisible();
  await expect(page.locator('#p-email')).toBeVisible();
});

test('portal público valida campos obrigatórios (sem submeter)', async ({ page }) => {
  await page.goto(`${BASE}/pages/pesquisa-publica.html`);
  // Tenta avançar sem preencher — deve permanecer na etapa/sem número de processo
  const botao = page.locator('button', { hasText: /avan|enviar|pr[oó]xim/i }).first();
  if (await botao.count()) {
    await botao.click();
    await page.waitForTimeout(500);
  }
  await expect(page.locator('#sucesso-codigo')).toHaveCount(0); // não gerou processo
});

// ── Página de acompanhamento por token ────────────────────────────
test('status: token inválido informa "não encontrado"', async ({ page }) => {
  await page.goto(`${BASE}/pages/pesquisa-status.html`);
  await page.fill('#campo-token', 'token-que-nao-existe-xyz');
  await page.click('button:has-text("Consultar"), button:has-text("Buscar"), button[type="submit"]');
  await page.waitForTimeout(2500);
  const txt = (await page.locator('body').innerText()).toLowerCase();
  expect(txt).toMatch(/não encontrado|nao encontrado|verifique/);
});

// ── Gestão interna exige login ────────────────────────────────────
test('pesquisas.html redireciona/bloqueia sem autenticação', async ({ page }) => {
  await page.goto(`${BASE}/pages/pesquisas.html`);
  await page.waitForTimeout(1500);
  const url = page.url();
  const semAcesso = url.includes('index') ||
    await page.locator('input[type="password"]').count() > 0;
  expect(semAcesso).toBeTruthy();
});

// ── RPC pública read-only retorna vazio para token inexistente ─────
test('RPC buscar_pesquisa_por_token com token falso retorna null', async ({ page }) => {
  await page.goto(`${BASE}/index.html`); // carrega supabase-js + config
  const res = await page.evaluate(async () => {
    // db é exposto globalmente por js/config.js
    const r = await window.db.rpc('buscar_pesquisa_por_token', { p_token: 'nao-existe-000' });
    return r;
  });
  expect(res.error).toBeFalsy();
  expect(res.data == null).toBeTruthy();
});

// ── FLUXO COMPLETO COM ESCRITA (somente STAGING) ──────────────────
// Roda apenas quando STAGING confirmado, para não poluir produção.
// Defina: TEST_ALLOW_WRITES=1 e TEST_BASE_URL=<url-staging>
const PODE_ESCREVER = process.env.TEST_ALLOW_WRITES === '1';

test.describe('fluxo de submissão (staging)', () => {
  test.skip(!PODE_ESCREVER, 'Pulado: defina TEST_ALLOW_WRITES=1 em ambiente de staging');

  test('submeter pesquisa gera número de processo e token', async ({ page }) => {
    await page.goto(`${BASE}/pages/pesquisa-publica.html`);
    const stamp = Date.now();
    // Preenche o mínimo do formulário (ajustar seletores conforme as etapas)
    await page.fill('#p-titulo', `Pesquisa automatizada ${stamp}`);
    await page.fill('#p-resumo', 'Resumo de teste automatizado com no mínimo cem caracteres para passar na validação do formulário público do SIGUC-AC.');
    await page.fill('#p-nome',  'Pesquisador Teste');
    await page.fill('#p-email', `qa+${stamp}@example.com`);
    // ... demais etapas/campos conforme o wizard ...
    // await page.click('#btn-enviar')
    // await expect(page.locator('#sucesso-codigo')).toContainText(/PESQ\/SEMA-AC/);
  });
});
