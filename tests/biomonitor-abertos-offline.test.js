// ── SIGUC Biomonitor · ninhos abertos disponíveis offline e sem travar ──
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

test('limpeza de 7 dias NÃO apaga ninho da temporada atual; apaga o de outra temporada e eventos antigos', async ({ page }) => {
  await abrirApp(page);
  const r = await page.evaluate(async () => {
    const velho = '2026-08-01T00:00:00Z';
    await bioOfflineSalvarNinho({ uuid_cliente: 'n-atual', status: 'transferido', status_sync: 'confirmado',
      sincronizado_em: velho, criado_em: velho, temporada_id: 't-2026' });
    await bioOfflineSalvarNinho({ uuid_cliente: 'n-velha', status: 'soltado', status_sync: 'confirmado',
      sincronizado_em: velho, criado_em: velho, temporada_id: 't-2025' });
    await bioOfflineSalvarNinho({ uuid_cliente: 'n-pend', status: 'encontrado', status_sync: 'pendente',
      criado_em: velho, temporada_id: 't-2025' });
    await bioOfflineSalvarVisita({ uuid_cliente: 'v-velha', ninho_uuid: 'n-atual', status_sync: 'confirmado',
      sincronizado_em: velho, criado_em: velho });
    await bioOfflineLimparConfirmados();
    const ninhos  = (await bioOfflineListarNinhos()).map(n => n.uuid_cliente).sort();
    const visitas = await bioOfflineVisitasDoNinho('n-atual');
    return { ninhos, visitas: visitas.length };
  });
  expect(r.ninhos).toEqual(['n-atual', 'n-pend']);   // pendente nunca sai; temporada atual fica
  expect(r.visitas).toBe(0);                          // evento já enviado continua sendo limpo
});

test('pull traz TODOS os ninhos (568, paginado) com os campos da eclosão e sobrevive à limpeza', async ({ page }) => {
  await abrirApp(page);
  const r = await page.evaluate(async (todos) => {
    const pedidas = [];
    window.__stubResposta = (tabela, f) => {
      if (tabela !== 'vw_ninhos_validacao') return { data: [], error: null };
      pedidas.push({ ...f });
      const [a, z] = f.range || [0, todos.length - 1];
      return { data: todos.slice(a, z + 1), error: null };
    };
    await bioSyncPullNinhos('g-abuna');
    await bioOfflineLimparConfirmados();
    const locais = await bioOfflineListarNinhos();
    const um = locais.find(n => n.uuid_cliente === 'u-300');
    return {
      total: locais.length,
      um: { data_prevista_eclosao: um.data_prevista_eclosao, qtd_ovos: um.qtd_ovos,
            server_id: um.server_id, status_sync: um.status_sync, temporada_id: um.temporada_id },
      paginas: pedidas.length,
      filtros: pedidas[0],
      ultimaSync: !!(await bioOfflineGetConfig('ninhos_ultima_sync')),
    };
  }, Array.from({ length: 568 }, (_, i) => ninhoServidor(i + 1)));
  expect(r.total).toBe(568);
  expect(r.um).toEqual({ data_prevista_eclosao: '2026-10-25', qtd_ovos: 30,
    server_id: 'srv-300', status_sync: 'confirmado', temporada_id: 't-2026' });
  expect(r.paginas).toBe(2);
  expect(r.filtros.eq).toEqual({ grupo_id: 'g-abuna', temporada_id: 't-2026' });
  expect(r.ultimaSync).toBe(true);
});

test('edição local ainda NÃO enviada não é sobrescrita pelo servidor', async ({ page }) => {
  await abrirApp(page);
  const r = await page.evaluate(async (srv) => {
    await bioOfflineSalvarNinho({ uuid_cliente: 'u-1', status: 'eclodido', status_sync: 'pendente',
      status_validacao: 'pendente', qtd_ovos: 41, criado_em: '2026-08-20T10:00:00Z',
      praia_id: 'p-belem', praia_atual_id: 'p-berc', numero_atual: srv.numero_atual });
    await bioSyncMesclarNinhosServidor([srv]);
    return await bioOfflineGetNinho('u-1');
  }, ninhoServidor(1));
  expect(r.status).toBe('eclodido');          // eclosão local pendente preservada
  expect(r.qtd_ovos).toBe(41);
  expect(r.status_sync).toBe('pendente');     // continua na fila de envio
  expect(r.status_validacao).toBe('validado');// decisão da gestão chega
});

test('servidor pendurado (rede sem internet): a lista aparece na hora pelos dados do aparelho e cai para "Sem conexão"', async ({ page }) => {
  test.setTimeout(40_000);
  await abrirApp(page);
  await page.evaluate(async (ns) => {
    await bioSyncMesclarNinhosServidor(ns);
    await bioOfflineSetConfig('ninhos_ultima_sync', new Date().toISOString());
    window.__stubResposta = () => new Promise(() => {});   // nunca responde
    BioApp.monitor = { grupo_id: 'g-abuna', nome_completo: 'Monitor Teste' };
    BioApp.temporadaAtual = { id: 't-2026', data_inicio: '2026-07-01', data_fim: '2027-06-30' };
    BioApp.abertosFiltroPraia = { id: 'p-berc', nome: 'Praia Berçário 01 JE' };
    BioApp.abertosStatusFiltro = 'transferido';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    bioMostrarTela('tela-abertos');
    window.__fim = bioCarregarAbertos();
  }, [ninhoServidor(1), ninhoServidor(2), ninhoServidor(3)]);

  // Antes do prazo do servidor estourar, os 3 ninhos já estão na tela
  await expect(page.locator('#bio-lista-abertos .bio-nfc')).toHaveCount(3, { timeout: 3_000 });
  await expect(page.locator('#bio-abertos-estado')).toContainText('Atualizando do servidor');
  // Prazo (8 s) estoura: aviso muda, lista continua
  await page.evaluate(() => window.__fim);
  await expect(page.locator('#bio-abertos-estado')).toContainText('Sem conexão com o servidor');
  await expect(page.locator('#bio-abertos-estado')).toContainText('atualizado em');
  await expect(page.locator('#bio-lista-abertos .bio-nfc')).toHaveCount(3);
});

test('resposta de filtro antigo que chega por último NÃO sobrescreve a lista do filtro atual', async ({ page }) => {
  await abrirApp(page);
  const r = await page.evaluate(async (ns) => {
    BioApp.monitor = { grupo_id: 'g-abuna', nome_completo: 'Monitor Teste' };
    BioApp.temporadaAtual = { id: 't-2026', data_inicio: '2026-07-01', data_fim: '2027-06-30' };
    BioApp.abertosFiltroPraia = null;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.__stubResposta = (tabela, f) => {
      if (tabela !== 'vw_ninhos_validacao') return { data: [], error: null };
      // filtro "encontrado" (antigo) responde DEPOIS e vazio; "todos" responde já
      if (f.eq.status === 'encontrado') return new Promise(ok => setTimeout(() => ok({ data: [], error: null }), 600));
      return { data: ns, error: null };
    };
    bioMostrarTela('tela-abertos');
    BioApp.abertosStatusFiltro = 'encontrado';
    const antigo = bioCarregarAbertos();
    BioApp.abertosStatusFiltro = null;
    const novo = bioCarregarAbertos();
    await Promise.all([antigo, novo]);
    await new Promise(ok => setTimeout(ok, 200));
    return document.querySelectorAll('#bio-lista-abertos .bio-nfc').length;
  }, [ninhoServidor(1), ninhoServidor(2)]);
  expect(r).toBe(2);
});
