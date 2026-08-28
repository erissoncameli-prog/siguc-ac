// ── SIGUC Biomonitor · app de campo — tela de login não pode ser beco sem saída ──
// Executar: npx playwright test tests/biomonitor-login.test.js
//
// Caso real que originou este guarda: monitores cadastrados e ATIVOS
// recebiam "não vinculado a nenhum grupo de monitoramento" ao abrir o
// app. A causa não era o cadastro — era a conta autenticada não ser a
// que está em monitores_biodiversidade.usuario_id (pessoa com dois
// e-mails, ou sessão antiga de outra pessoa guardada no aparelho).
//
// O agravante, que este teste trava: nesse ramo o app mostrava a tela
// de login SEM chamar bioIniciarTelaLogin() e SEM signOut(). Ou seja,
// o botão "Entrar" ficava sem handler e a sessão ruim continuava no
// localStorage — a pessoa não conseguia entrar com a conta certa nem
// reabrindo o app. Bate com o dado de produção: monitor com login
// gerado e last_sign_in_at nulo.
//
// Rede real de Supabase é bloqueada neste ambiente (mesma limitação
// documentada em tests/agua-app-fluxo.test.js), então o cliente é um
// stub instalado antes dos scripts da página.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

// /api/env é servido pela Vercel em produção; no servidor estático do teste
// não existe, e sem ele config.js deixa SUPABASE_URL vazio e o app cai em
// "Sem conexão com o servidor" antes de chegar ao ramo que interessa.
async function rotearEnv(page) {
  await page.route('**/api/env', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: 'https://stub.supabase.co', supabaseKey: 'chave-stub' }),
  }));
}

// Sessão presa de uma conta que NÃO é monitor: bio_monitor_atual → null.
async function abrirComSessaoDeOutraConta(page, { emailSessao = 'siebraemilly@gmail.com' } = {}) {
  await page.addInitScript(({ emailSessao }) => {
    window.__bioStub = { signOutChamado: 0, loginTentado: null };
    const session = { user: { email: emailSessao, id: 'uid-nao-monitor' } };
    let atual = session;
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: atual } }),
          signOut: async () => { window.__bioStub.signOutChamado++; atual = null; return {}; },
          signInWithPassword: async ({ email }) => {
            window.__bioStub.loginTentado = email;
            return { error: { message: 'stub' } };
          },
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        // Só bio_monitor_atual importa aqui; o resto devolve vazio.
        rpc: async () => ({ data: null, error: null }),
        from: () => ({
          select() { return this; }, eq() { return this; }, order() { return this; },
          limit: async () => ({ data: [], error: null }),
          then: (r) => r({ data: [], error: null }),
        }),
      }),
    };
  }, { emailSessao });

  await rotearEnv(page);
  await page.goto(`${BASE}/pages/biomonitor.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
}

test('sessão de conta que não é monitor: erro explica, mas o login segue utilizável', async ({ page }) => {
  await abrirComSessaoDeOutraConta(page);

  // 1) O erro aparece e NOMEIA a conta usada — "não vinculado a nenhum
  //    grupo" sozinho mandava o monitor procurar a coordenação pelo
  //    cadastro, que estava certo o tempo todo.
  const erro = page.locator('#bio-login-erro');
  await expect(erro).toBeVisible();
  await expect(erro).toContainText('siebraemilly@gmail.com');

  // 2) A sessão ruim foi encerrada — senão o app reabre neste mesmo
  //    estado para sempre (persistSession em localStorage).
  expect(await page.evaluate(() => window.__bioStub.signOutChamado)).toBeGreaterThan(0);

  // 3) O botão "Entrar" tem handler: clicar chega ao signInWithPassword.
  //    Era exatamente isto que faltava (bioIniciarTelaLogin não era
  //    chamada neste ramo).
  await page.fill('#bio-login-email', 'siebraemilly@outlook.com');
  await page.fill('#bio-login-senha', 'senha-de-teste');
  await page.click('#bio-btn-login');
  await expect.poll(() => page.evaluate(() => window.__bioStub.loginTentado))
    .toBe('siebraemilly@outlook.com');
});

test('sem sessão nenhuma: login continua funcionando (não houve regressão)', async ({ page }) => {
  await page.addInitScript(() => {
    window.__bioStub = { loginTentado: null };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          signOut: async () => ({}),
          signInWithPassword: async ({ email }) => {
            window.__bioStub.loginTentado = email;
            return { error: { message: 'stub' } };
          },
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        rpc: async () => ({ data: null, error: null }),
        from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; },
                       then: (r) => r({ data: [], error: null }) }),
      }),
    };
  });
  await rotearEnv(page);
  await page.goto(`${BASE}/pages/biomonitor.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });

  await page.fill('#bio-login-email', 'monitor@teste.br');
  await page.fill('#bio-login-senha', 'x123456');
  await page.click('#bio-btn-login');
  await expect.poll(() => page.evaluate(() => window.__bioStub.loginTentado))
    .toBe('monitor@teste.br');
});
