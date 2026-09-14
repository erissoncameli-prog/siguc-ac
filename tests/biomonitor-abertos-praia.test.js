// ── SIGUC Biomonitor · ninho transferido continua visível na praia de origem ──
// Executar: npx playwright test tests/biomonitor-abertos-praia.test.js
//
// Bug real (produção): a aba "Ninhos abertos" filtrava só por praia_atual_id
// (onde o ninho incuba AGORA). Ninho transferido sumia da praia onde foi
// cadastrado — Praia de Belém tinha 10 ninhos e mostrava 8 (2 no berçário);
// Praia do Balseiro mostrava 0 (os 2 foram para outra praia). Correção:
// filtra por praia_id OU praia_atual_id, e o card mostra o selo DIRECIONAL
// ("Transferido para X" quando visto pela origem; "Transferido de X" quando
// visto pelo destino ou sem filtro).
//
// Rede real de Supabase é bloqueada neste ambiente (mesma limitação de
// tests/biomonitor-etiqueta.test.js) — cliente stub instalado antes dos
// scripts; bioNinhoCardInner é síncrona e não depende de sessão nem rede.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

async function abrirAppSemSessao(page) {
  await page.addInitScript(() => {
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          signOut: async () => ({}),
          signInWithPassword: async () => ({ error: { message: 'stub' } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        rpc: async () => ({ data: null, error: null }),
        from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; },
                       then: (r) => r({ data: [], error: null }) }),
      }),
    };
  });
  await page.route('**/api/env', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: 'https://stub.supabase.co', supabaseKey: 'chave-stub' }),
  }));
  await page.goto(`${BASE}/pages/biomonitor.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
}

// Ninho de Belém transferido para o berçário (mesmo caso de produção)
const NINHO_TRANSFERIDO = {
  especie: 'tracaja', status: 'transferido', data_encontro: '2026-08-20',
  praia_id: 'p-belem', praia_atual_id: 'p-berc',
  praia_nome: 'Praia de Belém', praia_atual_nome: 'Praia Berçário 01',
  numero_ninho: 'PRBE-TR-2026-001', numero_atual: 'BER01-TR-2026-001',
};

test('visto pela praia de ORIGEM: mostra "Transferido para" o destino e a praia de origem', async ({ page }) => {
  await abrirAppSemSessao(page);
  const html = await page.evaluate(
    n => bioNinhoCardInner(n, { contextoPraiaId: 'p-belem' }),
    NINHO_TRANSFERIDO,
  );
  expect(html).toContain('Transferido para Praia Berçário 01');
  expect(html).not.toContain('Transferido de');
  // A praia principal exibida é a de origem, não o destino
  expect(html).toContain('>Praia de Belém<');
  // Número exibido é o de origem
  expect(html).toContain('#PRBE-TR-2026-001');
});

test('visto pelo DESTINO: mostra "Transferido de" a origem', async ({ page }) => {
  await abrirAppSemSessao(page);
  const html = await page.evaluate(
    n => bioNinhoCardInner(n, { contextoPraiaId: 'p-berc' }),
    NINHO_TRANSFERIDO,
  );
  expect(html).toContain('Transferido de Praia de Belém');
  expect(html).not.toContain('Transferido para');
  expect(html).toContain('>Praia Berçário 01<');
});

test('sem filtro (Todas as praias): mostra a praia atual e "Transferido de" a origem', async ({ page }) => {
  await abrirAppSemSessao(page);
  const html = await page.evaluate(
    n => bioNinhoCardInner(n, {}),
    NINHO_TRANSFERIDO,
  );
  expect(html).toContain('Transferido de Praia de Belém');
  expect(html).toContain('>Praia Berçário 01<');
});

test('ninho não transferido: nenhum selo de transferência, em qualquer contexto', async ({ page }) => {
  await abrirAppSemSessao(page);
  const html = await page.evaluate(() => bioNinhoCardInner({
    especie: 'tracaja', status: 'encontrado', data_encontro: '2026-08-28',
    praia_id: 'p-belem', praia_atual_id: 'p-belem',
    praia_nome: 'Praia de Belém', praia_atual_nome: 'Praia de Belém',
    numero_ninho: 'PRBE-TR-2026-003', numero_atual: 'PRBE-TR-2026-003',
  }, { contextoPraiaId: 'p-belem' }));
  expect(html).not.toContain('Transferido');
  expect(html).toContain('>Praia de Belém<');
});

test('filtro por praia origem-ou-atual inclui o ninho pela origem E pela praia atual', async ({ page }) => {
  await abrirAppSemSessao(page);
  const r = await page.evaluate(async () => {
    // Semeia dois ninhos no IndexedDB: um transferido de Belém p/ berçário,
    // outro cadastrado e ainda em Belém.
    await bioOfflineSalvarNinho({
      uuid_cliente: 'n-transf', numero_ninho: 'PRBE-TR-2026-001', numero_atual: 'BER01-TR-2026-001',
      especie: 'tracaja', status: 'transferido', status_sync: 'confirmado', criado_em: '2026-08-20T00:00:00Z',
      praia_id: 'p-belem', praia_atual_id: 'p-berc',
    });
    await bioOfflineSalvarNinho({
      uuid_cliente: 'n-fica', numero_ninho: 'PRBE-TR-2026-003', numero_atual: 'PRBE-TR-2026-003',
      especie: 'tracaja', status: 'encontrado', status_sync: 'confirmado', criado_em: '2026-08-28T00:00:00Z',
      praia_id: 'p-belem', praia_atual_id: 'p-belem',
    });
    const porBelem = await bioOfflineListarNinhos({ praiaQualquer: 'p-belem' });
    const porBerc  = await bioOfflineListarNinhos({ praiaQualquer: 'p-berc' });
    const soAtualBelem = await bioOfflineListarNinhos({ praiaAtualId: 'p-belem' });
    return {
      belem: porBelem.map(n => n.uuid_cliente).sort(),
      berc:  porBerc.map(n => n.uuid_cliente).sort(),
      soAtual: soAtualBelem.map(n => n.uuid_cliente).sort(),
    };
  });
  // Belém (origem-ou-atual): os DOIS ninhos, inclusive o transferido
  expect(r.belem).toEqual(['n-fica', 'n-transf']);
  // Berçário (origem-ou-atual): só o transferido, pela praia atual
  expect(r.berc).toEqual(['n-transf']);
  // Comportamento antigo (só praia_atual) perderia o transferido em Belém
  expect(r.soAtual).toEqual(['n-fica']);
});
