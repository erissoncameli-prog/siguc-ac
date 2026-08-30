// ── SIGUC · Guias das telas de MESA da Qualidade da Água ────────
// Executar: npx playwright test tests/agua-guia-mesa.test.js
//
// Complementa tests/agua-guia.test.js (app de campo). O que trava:
//  - o botão "Ajuda" da topbar (js/layout.js) só aparece onde há
//    catálogo declarado — e aparece MESMO o layout sendo injetado
//    depois, de dentro do init assíncrono da página (foi o motivo de
//    guiaAutoDefinir existir);
//  - abrir um guia com a tela aberta destaca o elemento real;
//  - integridade do catálogo: todo verbete aponta para um guia que
//    existe, todo guia tem passos, e nenhum slug se repete.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

const USUARIO_STUB = { id: 'u-guia', nome_completo: 'Técnica de Teste', email: 't@x.invalid', perfil: 'gestor', ativo: true };

// Mesmo contorno de tests/agua-relatorios.test.js: sem bloquear o CDN,
// o supabase-js real sobrescreveria o stub e a página cairia no login.
async function abrirLaudosComStub(page) {
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.addInitScript(usuario => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const vazio = () => {
      const q = {
        select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q,
        single: async () => ({ data: usuario, error: null }),
        maybeSingle: async () => ({ data: usuario, error: null }),
        then: r => Promise.resolve({ data: [], error: null }).then(r),
      };
      return q;
    };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: usuario.id } } } }),
          getUser: async () => ({ data: { user: { id: usuario.id } } }),
          signOut: async () => ({}),
        },
        rpc: async nome => (nome === 'nivel_efetivo' ? { data: 'editar', error: null } : { data: null, error: null }),
        from: () => vazio(),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      }),
    };
  }, USUARIO_STUB);

  await page.goto(`${BASE}/pages/agua-laudos.html`);
  await page.locator('#topbar-guia').waitFor({ state: 'visible', timeout: 20_000 });
}

test('o botão "Ajuda" aparece na topbar depois que o layout é injetado', async ({ page }) => {
  await abrirLaudosComStub(page);
  await expect(page.locator('#topbar-guia')).toBeVisible();

  await page.locator('#topbar-guia').click();
  await expect(page.locator('.guia-painel')).toBeVisible();
  await expect(page.locator('.guia-lista')).toContainText('Lançar o laudo do laboratório');
});

test('guia da tela aberta destaca o elemento real', async ({ page }) => {
  await abrirLaudosComStub(page);
  await page.evaluate(() => guiaAbrir('lancar-laudo', { voltarCentral: false }));

  await expect(page.locator('.guia-spot')).toBeVisible();
  const cobre = await page.evaluate(() => {
    const s = document.querySelector('.guia-spot').getBoundingClientRect();
    const a = document.getElementById('tbody-fila').getBoundingClientRect();
    return s.left <= a.left + 1 && s.right >= a.right - 1 && s.top <= a.top + 1;
  });
  expect(cobre).toBe(true);
});

test('aba Capacitação existe e lê a RPC do relatório, nunca a tabela direto', async ({ page }) => {
  const chamadas = [];
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.addInitScript(usuario => {
    window.__rpcChamadas = [];
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const vazio = tabela => {
      const q = { select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q,
        single: async () => ({ data: usuario, error: null }),
        maybeSingle: async () => ({ data: usuario, error: null }),
        then: r => { window.__tabelas = (window.__tabelas || []).concat(tabela); return Promise.resolve({ data: [], error: null }).then(r) } };
      return q;
    };
    window.supabase = { createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: usuario.id } } } }), signOut: async () => ({}) },
      rpc: async (nome, args) => {
        window.__rpcChamadas.push({ nome, args });
        if (nome === 'nivel_efetivo') return { data: 'editar', error: null };
        if (nome === 'capacitacao_relatorio') return { data: [
          { usuario_id: 'u1', nome: 'Ana', escopo: args.p_escopo, guia: 'primeiros-passos', versao: 1, concluido_em: '2026-08-20T10:00:00Z' },
          { usuario_id: 'u1', nome: 'Ana', escopo: args.p_escopo, guia: 'fazer-uma-coleta', versao: 1, concluido_em: '2026-08-21T10:00:00Z' },
        ], error: null };
        return { data: null, error: null };
      },
      from: t => vazio(t),
      storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
    }) };
  }, USUARIO_STUB);

  await page.goto(`${BASE}/pages/agua-pontos.html`);
  await page.locator('#tab-capacitacao').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#tab-capacitacao').click();

  await expect(page.locator('#tbody-capacitacao')).toContainText('Ana');
  // Os TÍTULOS vêm do catálogo do cliente — o banco não guarda texto de guia.
  await expect(page.locator('#tbody-capacitacao')).toContainText('Fazer uma coleta');

  const r = await page.evaluate(() => ({
    rpcs: window.__rpcChamadas.map(c => c.nome),
    tabelas: window.__tabelas || [],
  }));
  expect(r.rpcs).toContain('capacitacao_relatorio');
  // A tabela nunca é lida direto: a RLS só devolveria as linhas do
  // próprio usuário, e o relatório precisa do módulo inteiro.
  expect(r.tabelas).not.toContain('capacitacao_conclusoes');
});

test('catálogo da mesa é íntegro (slugs únicos, passos presentes, verbetes apontando para guia existente)', async ({ page }) => {
  await abrirLaudosComStub(page);
  const r = await page.evaluate(() => {
    const g = AGUA_GUIAS_MESA.guias;
    const slugs = g.map(x => x.slug);
    return {
      duplicados: slugs.filter((s, i) => slugs.indexOf(s) !== i),
      semPassos: g.filter(x => !(x.passos || []).length).map(x => x.slug),
      semTitulo: g.filter(x => !x.titulo || !x.resumo).map(x => x.slug),
      verbetesOrfaos: Object.entries(AGUA_GUIAS_MESA.verbetes || {})
        .filter(([, v]) => v.guia && !slugs.includes(v.guia)).map(([k]) => k),
      escopo: AGUA_GUIAS_MESA.escopo,
    };
  });
  expect(r.duplicados).toEqual([]);
  expect(r.semPassos).toEqual([]);
  expect(r.semTitulo).toEqual([]);
  expect(r.verbetesOrfaos).toEqual([]);
  // O escopo alimenta capacitacao_conclusoes.escopo (migration 327) e
  // dele sai o módulo — 'agua-mesa' precisa continuar começando por
  // 'agua', senão o relatório de capacitação checa a permissão errada.
  expect(r.escopo.split('-')[0]).toBe('agua');
});

// Guarda geral, achada por um bug REAL desta entrega: `js/agua-laudo-kpis.js`
// e o <script> inline de `pages/agua-laudos.html` declaravam ambos
// `const AGUA_STATUS_LABEL`. Dois <script> clássicos compartilham o
// escopo léxico de const/let, então o nome repetido quebrava o PARSE do
// bloco inteiro e a página não renderizava NADA — sem erro visível para
// quem só olha o código de um dos dois arquivos.
for (const pagina of ['agua-laudos', 'agua-conferencia', 'agua-pontos', 'agua-relatorios', 'agua-mapa']) {
  test(`${pagina}.html não tem identificador global declarado duas vezes`, async ({ page }) => {
    const erros = [];
    page.on('pageerror', e => erros.push(String(e)));
    await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
    await page.goto(`${BASE}/pages/${pagina}.html`);
    await page.waitForTimeout(1500);
    expect(erros.filter(e => /already been declared/.test(e))).toEqual([]);
  });
}
