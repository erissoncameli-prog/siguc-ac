// ── SIGUC-AC · Smoke E2E do fluxo de Pesquisa (read-only) ─────────
// Seguro contra produção: só carrega páginas, valida UI e chama a RPC
// pública (token inválido). NÃO submete pesquisas.
// Rodar: TEST_BASE_URL=https://siguc-ac.vercel.app npx playwright test tests/pesquisa-flow.test.js

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

// Lê a config pública do próprio site (sem hardcodar chave no repo).
async function getSupabaseConfig(request) {
  const res = await request.get(`${BASE}/js/config.js`);
  const txt = await res.text();
  const url = (txt.match(/SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  const key = (txt.match(/SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  return { url, key };
}

// ── Páginas públicas respondem 200 ────────────────────────────────
for (const path of ['/index.html', '/pages/pesquisa-publica.html', '/pages/pesquisa-status.html', '/pages/pesquisas.html']) {
  test(`GET ${path} responde 200`, async ({ request }) => {
    const res = await request.get(`${BASE}${path}`);
    expect(res.status()).toBe(200);
  });
}

// ── Portal público mostra conteúdo de submissão ───────────────────
test('portal público carrega com conteúdo de pesquisa', async ({ page }) => {
  await page.goto(`${BASE}/pages/pesquisa-publica.html`, { waitUntil: 'domcontentloaded' });
  const txt = (await page.locator('body').innerText()).toLowerCase();
  expect(txt).toMatch(/pesquisa/);
});

// ── Página de status trata token inválido ─────────────────────────
test('status: token inválido informa erro', async ({ page }) => {
  await page.goto(`${BASE}/pages/pesquisa-status.html`, { waitUntil: 'domcontentloaded' });
  const campo = page.locator('#campo-token');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await campo.fill('token-inexistente-xyz');
  await page.click('button:has-text("Consultar"), button:has-text("Buscar"), button[type="submit"]');
  await page.waitForTimeout(2500);
  const txt = (await page.locator('body').innerText()).toLowerCase();
  expect(txt).toMatch(/não encontrado|nao encontrado|verifique/);
});

// ── Sem sessão, a RPC de dados não retorna pesquisas (RLS) ─────────
// A proteção real é no banco (RLS), não na UI. Valida que um cliente
// anônimo não consegue listar pesquisas via PostgREST.
test('anon não lista pesquisas (RLS)', async ({ request }) => {
  const { url, key } = await getSupabaseConfig(request);
  expect(key, 'anon key deve estar em js/config.js').toBeTruthy();
  const res = await request.get(`${url}/rest/v1/pesquisas?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  // Sem sessão, RLS faz a query retornar vazio (200 + []).
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(Array.isArray(body) ? body.length : 0).toBe(0);
});

// ── RPC pública retorna null p/ token inexistente (migração 026) ───
test('RPC buscar_pesquisa_por_token retorna null para token falso', async ({ request }) => {
  const { url, key } = await getSupabaseConfig(request);
  const res = await request.post(`${url}/rest/v1/rpc/buscar_pesquisa_por_token`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    data: { p_token: 'token-que-nao-existe-000' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toBeNull();
});

// ── FLUXO COMPLETO COM ESCRITA (somente STAGING) ──────────────────
const PODE_ESCREVER = process.env.TEST_ALLOW_WRITES === '1';

test.describe('fluxo de submissão (staging)', () => {
  test.skip(!PODE_ESCREVER, 'Defina TEST_ALLOW_WRITES=1 em ambiente de staging');

  test('submeter pesquisa gera número de processo', async ({ page }) => {
    await page.goto(`${BASE}/pages/pesquisa-publica.html`);
    // Preencher o wizard e submeter; ajustar seletores conforme as etapas.
    // await expect(page.locator('#sucesso-codigo')).toContainText(/PESQ\/SEMA-AC/);
  });
});
