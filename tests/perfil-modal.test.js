// ── Modal "Meu Perfil" (js/perfil.js) ─────────────────────────────
// Executar: npx playwright test tests/perfil-modal.test.js
// (precisa de um servidor estático na raiz do repo — ver
//  tests/sidebar-grupos.test.js para o padrão de harness)
//
// POR QUE ESTE TESTE EXISTE: o bloco do nome na sidebar virou botão
// que abre um modal (js/perfil.js) reunindo "Meus Dados" e "Alterar
// Senha", antes dois links soltos no rodapé, e acrescentando edição
// do próprio cadastro + foto única sincronizada nos apps de campo
// (migration 261). Regras fáceis de quebrar numa edição futura:
// (1) o clique no bloco do nome sempre abre o modal, nunca navega;
// (2) só nome/telefone/cargo vão no UPDATE de perfilSalvar — perfil,
//     ativo, uc_id e email nunca são enviados pelo cliente (a trava
//     de verdade é o trigger no banco, mas o cliente não deve nem
//     tentar);
// (3) a RPC de foto é sempre perfil_atualizar_foto, nunca um UPDATE
//     direto em usuarios.foto_url — é ela quem propaga para os apps.
//
// Harness igual ao de sidebar-grupos.test.js: página vazia + stub do
// cliente Supabase, porque nenhuma página real serve de base (todas
// declaram `let db` no escopo global, que colide com o de config.js).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

const GLOBAL_CSS = fs.readFileSync(path.join(__dirname, '../css/global.css'), 'utf8')
  .replace(/@import[^;]+;/, '');

async function montarComPerfil(page, usuarioExtra) {
  await page.goto(`${BASE}/tests/fixtures/sidebar-harness.html`);

  const chamadas = { updates: [], rpcs: [] };
  await page.exposeFunction('_registrarUpdate', (tbl, payload) => chamadas.updates.push({ tbl, payload }));
  await page.exposeFunction('_registrarRpc', (nome, args) => chamadas.rpcs.push({ nome, args }));

  await page.addScriptTag({ content: `
    window.supabase = { createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'teste@sema.ac.gov.br' } } } }),
        getUser: async () => ({ data: { user: { email: 'teste@sema.ac.gov.br' } } }),
        signInWithPassword: async () => ({ error: null }),
        updateUser: async () => ({ error: null }),
      },
      from: (tbl) => ({
        select: () => ({ eq: () => ({
          single: async () => ({ data: null }),
          order: () => ({ limit: async () => ({ data: [] }) }),
        }) }),
        update: (payload) => ({ eq: async (col, val) => { await window._registrarUpdate(tbl, payload); return { error: null }; } }),
      }),
      rpc: async (nome, args) => { await window._registrarRpc(nome, args); return { data: null, error: null }; },
      storage: { from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/avatares/u1/foto.jpg' } }),
        createSignedUrl: async () => ({ data: { signedUrl: '' } }),
        remove: async () => ({}),
      }) },
    }) };
  ` });

  await page.addScriptTag({ url: '/js/config.js' });
  await page.addScriptTag({ url: '/js/layout.js' });
  await page.addScriptTag({ url: '/js/fotos-privadas.js' });
  await page.addScriptTag({ url: '/js/perfil.js' });
  await page.addStyleTag({ content: GLOBAL_CSS });

  await page.evaluate((extra) => {
    // Atribuição SEM `window.` de propósito — `db` é `let` no topo de
    // js/config.js, então é um binding léxico do realm, distinto de
    // `window.db` (mesma pegadinha documentada no cabeçalho de
    // js/config.js/sigucDb). `window.db = ...` deixaria perfil.js
    // lendo um `db` léxico ainda undefined.
    db = supabase.createClient();
    window.db = db; // smoke tests/páginas reais também leem window.db
    appState.usuario = Object.assign({
      id: 'u1', nome_completo: 'Erisson Cameli Santiago', email: 'erisson@sema.ac.gov.br',
      perfil: 'super_admin', cargo: 'Diretor DIMA', telefone: '(68) 99999-0000', foto_url: null,
    }, extra || {});
    document.body.insertAdjacentHTML('beforeend', gerarLayout('Dashboard', 'dashboard'));
  }, usuarioExtra);

  return chamadas;
}

test('clicar no bloco do nome abre o modal, não navega', async ({ page }) => {
  await montarComPerfil(page);
  await expect(page.locator('.perfil-overlay.aberto')).toHaveCount(0);

  await page.locator('.sidebar-user').click();

  await expect(page.locator('.perfil-overlay.aberto')).toHaveCount(1);
  await expect(page.locator('.perfil-modal')).toBeVisible();
  await expect(page).toHaveURL(/sidebar-harness\.html$/); // não navegou
});

test('as três abas existem e alternam o painel visível', async ({ page }) => {
  await montarComPerfil(page);
  await page.locator('.sidebar-user').click();

  await expect(page.locator('.pf-painel[data-aba="perfil"]')).toHaveClass(/ativo/);
  await expect(page.locator('.pf-painel[data-aba="senha"]')).not.toHaveClass(/ativo/);

  await page.locator('.pf-tab[data-aba="senha"]').click();
  await expect(page.locator('.pf-painel[data-aba="senha"]')).toHaveClass(/ativo/);
  await expect(page.locator('.pf-painel[data-aba="perfil"]')).not.toHaveClass(/ativo/);

  await page.locator('.pf-tab[data-aba="privacidade"]').click();
  await expect(page.locator('.pf-painel[data-aba="privacidade"]')).toHaveClass(/ativo/);
  await expect(page.locator('.pf-link[href="/pages/meus-dados.html"]')).toBeVisible();
});

test('Salvar manda só nome/telefone/cargo — nunca perfil, ativo, uc_id ou email', async ({ page }) => {
  const chamadas = await montarComPerfil(page);
  await page.locator('.sidebar-user').click();

  await page.fill('#pf-nome', 'Novo Nome Completo');
  await page.fill('#pf-tel', '(68) 90000-1111');
  await page.locator('.pf-acoes button:has-text("Salvar")').click();

  await expect.poll(() => chamadas.updates.length).toBeGreaterThan(0);
  const upd = chamadas.updates.find(u => u.tbl === 'usuarios');
  expect(upd).toBeTruthy();
  const campos = Object.keys(upd.payload).sort();
  expect(campos).toEqual(['cargo', 'nome_completo', 'telefone'].sort());
  expect(upd.payload.nome_completo).toBe('Novo Nome Completo');

  // O nome no topo da sidebar reflete a mudança sem recarregar a página.
  await expect(page.locator('#sidebar-nome')).toHaveText('Novo Nome Completo');
});

test('campos definidos pela administração são somente leitura', async ({ page }) => {
  await montarComPerfil(page);
  await page.locator('.sidebar-user').click();

  const readonlyInputs = page.locator('.pf-inp[readonly]');
  await expect(readonlyInputs).toHaveCount(2); // e-mail e perfil de acesso
});

test('trocar a foto chama a RPC perfil_atualizar_foto, nunca UPDATE direto em usuarios.foto_url', async ({ page }) => {
  const chamadas = await montarComPerfil(page);
  await page.locator('.sidebar-user').click();

  // PNG mínimo 2x2, gerado no navegador — evita depender de um
  // arquivo de fixture binário no repo.
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 800;
    c.getContext('2d').fillRect(0, 0, 800, 800);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'foto.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('pf-file').files = dt.files;
    await perfilFotoEscolhida(document.getElementById('pf-file'));
  });

  await expect.poll(() => chamadas.rpcs.length).toBeGreaterThan(0);
  expect(chamadas.rpcs[0].nome).toBe('perfil_atualizar_foto');
  expect(chamadas.rpcs[0].args.p_url).toContain('/avatares/u1/');

  // Nenhum UPDATE direto na tabela usuarios setando foto_url — a
  // propagação para brigadistas/frota_motoristas/monitores é
  // responsabilidade exclusiva da RPC (SECURITY DEFINER).
  const updateComFoto = chamadas.updates.find(u => u.tbl === 'usuarios' && 'foto_url' in u.payload);
  expect(updateComFoto).toBeUndefined();

  // Depois de enviar, o botão "Remover" aparece.
  await expect(page.locator('.pf-foto-acoes button:has-text("Remover")')).toBeVisible();
});

test('Escape fecha o modal', async ({ page }) => {
  await montarComPerfil(page);
  await page.locator('.sidebar-user').click();
  await expect(page.locator('.perfil-overlay.aberto')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('.perfil-overlay.aberto')).toHaveCount(0);
});
