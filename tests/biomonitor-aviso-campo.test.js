// ── SIGUC Biomonitor · sincroniza ao abrir/voltar e avisa antes de ir a campo ──
// Executar: npx playwright test tests/biomonitor-aviso-campo.test.js
//
// Pedido do usuário (07/10/2026): toda vez que o app abrir com internet as
// tabelas devem sincronizar, e um popup deve lembrar o monitor de abrir o
// app com internet antes de ir para área sem cobertura.
// Mesmo harness de tests/biomonitor-abertos-offline.test.js.
// Executar: npx playwright test tests/biomonitor-abertos-offline.test.js
//
// Bug real (produção, 07/10/2026, às vésperas das eclosões): a aba "Ninhos
// Abertos" ficava vazia para os monitores. Quatro causas, as três de app
// travadas aqui (a 4ª — RLS de grupos — é a migration 357, conferida no
// banco):
//   1. a limpeza de 7 dias apagava do aparelho os ninhos que o pull acabara
//      de baixar (gravados com a data do sync ORIGINAL);
//   2. o pull trazia só 200 ninhos (o grupo tem 568) e quase sem campos;
//   3. com o aparelho "achando" que tinha rede, a consulta pendurava e a
//      tela ficava em "Carregando do servidor…" para sempre;
//   4. resposta de um filtro antigo sobrescrevia a lista do filtro atual.
//
// Cliente Supabase stub (rede real bloqueada neste ambiente — mesma
// técnica de tests/biomonitor-abertos-praia.test.js). O stub responde por
// window.__stubResposta(tabela, filtros), que cada teste redefine.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

const GRUPO = 'g-abuna';
const TEMP  = { id: 't-2026', nome: 'Quelônios 2026/2027', data_inicio: '2026-07-01', data_fim: '2027-06-30', is_atual: true };

async function abrirApp(page) {
  await page.addInitScript(() => {
    // Builder encadeável: registra os filtros e devolve o que
    // window.__stubResposta decidir (objeto, Promise ou "nunca").
    const builder = (tabela) => {
      const f = { tabela, eq: {}, neq: {}, in: {}, or: null, range: null };
      const b = {
        select() { return b; }, order() { return b; }, abortSignal() { return b; },
        eq(c, v) { f.eq[c] = v; return b; }, neq(c, v) { f.neq[c] = v; return b; },
        in(c, v) { f.in[c] = v; return b; }, or(v) { f.or = v; return b; },
        range(a, z) { f.range = [a, z]; return b; },
        limit() { return b; }, maybeSingle() { return b; },
        then(ok, err) {
          const r = window.__stubResposta ? window.__stubResposta(tabela, f) : { data: [], error: null };
          return Promise.resolve(r).then(ok, err);
        },
      };
      return b;
    };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          signOut: async () => ({}),
          signInWithPassword: async () => ({ error: { message: 'stub' } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        rpc: async () => ({ data: null, error: null }),
        from: builder,
      }),
    };
  });
  await page.route('**/api/env', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: 'https://stub.supabase.co', supabaseKey: 'chave-stub' }),
  }));
  await page.goto(`${BASE}/pages/biomonitor.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(async (t) => { await bioOfflineSetConfig('temporada_atual', t); }, TEMP);
}

const ninhoServidor = (i, extra = {}) => ({
  id: `srv-${i}`, uuid_cliente: `u-${i}`,
  numero_ninho: `PRBE-TR-2026-${String(i).padStart(3, '0')}`,
  numero_atual: `BER01-TR-2026-${String(i).padStart(3, '0')}`,
  especie: 'tracaja', status: 'transferido', status_validacao: 'validado',
  data_encontro: '2026-08-20', criado_em: `2026-08-20T10:${String(i % 60).padStart(2, '0')}:00Z`,
  sincronizado_em: '2026-08-21T00:00:00Z',
  praia_id: 'p-belem', praia_nome: 'Praia de Belém',
  praia_atual_id: 'p-berc', praia_atual_nome: 'Praia Berçário 01 JE',
  grupo_id: 'g-abuna', temporada_id: 't-2026',
  qtd_ovos: 30, data_prevista_eclosao: '2026-10-25', dias_para_eclosao: 18,
  ...extra,
});


async function preparar(page, { online }) {
  await page.evaluate(async (on) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
    BioApp.monitor = { id: 'm-1', grupo_id: 'g-abuna', nome_completo: 'Monitor Teste' };
    BioApp.temporadaAtual = { id: 't-2026', data_inicio: '2026-07-01', data_fim: '2027-06-30' };
    BioApp._avisoCampoFeito = false;
    try { localStorage.removeItem('siguc_bio_aviso_campo_dia'); } catch (_) {}
  }, online);
}

test('online: sincroniza e o popup diz "pronto para ir a campo" com a quantidade de ninhos', async ({ page }) => {
  await abrirApp(page);
  await preparar(page, { online: true });
  const r = await page.evaluate(async (ns) => {
    window.__stubResposta = (tabela) => tabela === 'vw_ninhos_validacao'
      ? { data: ns, error: null } : { data: [], error: null };
    await bioAvisoPreparoCampo(bioSyncTudoAguardando({ monitorId: 'm-1' }));
    return {
      visivel: !document.getElementById('bio-campo-overlay').hidden,
      estado: document.querySelector('.bio-campo-card').dataset.estado,
      texto: document.getElementById('bio-campo-msg').textContent,
      titulo: document.getElementById('bio-campo-titulo').textContent,
    };
  }, [ninhoServidor(1), ninhoServidor(2), ninhoServidor(3)]);
  expect(r.visivel).toBe(true);
  expect(r.estado).toBe('ok');
  expect(r.titulo).toContain('Pronto para ir a campo');
  expect(r.texto).toContain('3 ninhos da temporada');
  expect(r.texto).toContain('sem sinal');
});

test('online no MESMO dia: sucesso não repete o popup', async ({ page }) => {
  await abrirApp(page);
  await preparar(page, { online: true });
  const r = await page.evaluate(async () => {
    window.__stubResposta = () => ({ data: [], error: null });
    await bioAvisoPreparoCampo(bioSyncTudoAguardando({ monitorId: 'm-1' }));
    bioAvisoCampoFechar();
    BioApp._avisoCampoFeito = false;           // simula reabrir o app
    await bioAvisoPreparoCampo(bioSyncTudoAguardando({ monitorId: 'm-1' }));
    return document.getElementById('bio-campo-overlay').hidden;
  });
  expect(r).toBe(true);
});

test('online mas a sincronização falha: o popup avisa SEMPRE, com a data dos dados guardados', async ({ page }) => {
  await abrirApp(page);
  await preparar(page, { online: true });
  const r = await page.evaluate(async () => {
    await bioOfflineSetConfig('ninhos_ultima_sync', '2026-10-01T12:00:00Z');
    window.__stubResposta = () => ({ data: null, error: { message: 'falhou' } });
    localStorage.setItem('siguc_bio_aviso_campo_dia', new Date().toISOString().slice(0, 10));
    await bioAvisoPreparoCampo(bioSyncTudoAguardando({ monitorId: 'm-1' }));
    return {
      visivel: !document.getElementById('bio-campo-overlay').hidden,
      estado: document.querySelector('.bio-campo-card').dataset.estado,
      texto: document.getElementById('bio-campo-msg').textContent,
    };
  });
  expect(r.visivel).toBe(true);
  expect(r.estado).toBe('falhou');
  expect(r.texto).toContain('01/10');
});

test('sem internet e dados com mais de 1 dia: alerta de dados desatualizados; fecha tocando fora', async ({ page }) => {
  await abrirApp(page);
  await preparar(page, { online: false });
  await page.evaluate(async () => {
    await bioOfflineSetConfig('ninhos_ultima_sync', '2026-09-01T12:00:00Z');
    await bioAvisoPreparoCampo(null);
  });
  await expect(page.locator('.bio-campo-card')).toHaveAttribute('data-estado', 'offline_antigo');
  await expect(page.locator('#bio-campo-titulo')).toContainText('desatualizados');
  await page.mouse.click(5, 5);
  await expect(page.locator('#bio-campo-overlay')).toBeHidden();
});

test('modo treinamento não mostra o popup (o treino nunca sincroniza)', async ({ page }) => {
  await abrirApp(page);
  await preparar(page, { online: false });
  const r = await page.evaluate(async () => {
    window.bioModoTreinoAtivo = () => true;
    await bioAvisoPreparoCampo(null);
    return document.getElementById('bio-campo-overlay').hidden;
  });
  expect(r).toBe(true);
});

test('voltar do segundo plano com internet sincroniza (se a última foi há mais de 5 min)', async ({ page }) => {
  await abrirApp(page);
  await preparar(page, { online: true });
  const r = await page.evaluate(async () => {
    const pedidas = [];
    window.__stubResposta = (tabela) => { pedidas.push(tabela); return { data: [], error: null }; };
    await bioOfflineSetConfig('ninhos_ultima_sync', new Date(Date.now() - 10 * 60000).toISOString());
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    const ate = Date.now() + 5000;
    while (!pedidas.includes('vw_ninhos_validacao') && Date.now() < ate) await new Promise(ok => setTimeout(ok, 100));
    const sincronizou = pedidas.includes('vw_ninhos_validacao');
    // sincronizado agora há pouco: voltar de novo NÃO dispara outra
    while (_bioSyncEmAndamento) await new Promise(ok => setTimeout(ok, 100));
    await bioOfflineSetConfig('ninhos_ultima_sync', new Date().toISOString());
    pedidas.length = 0;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(ok => setTimeout(ok, 800));
    return { sincronizou, repetiu: pedidas.includes('vw_ninhos_validacao') };
  });
  expect(r.sincronizou).toBe(true);
  expect(r.repetiu).toBe(false);
});
