// ── SIGUC · Guias de introdução / treinamento (js/guia-app.js) ──
// Executar: npx playwright test tests/agua-guia.test.js
//
// Guarda o que não pode quebrar em silêncio:
//  - o guia abre OFFLINE, sem cliente Supabase e sem sessão (o motor
//    não pode depender de rede para ensinar alguém a usar o app);
//  - passo cujo alvo não existe (ou está numa tela fechada) é PULADO,
//    nunca deixa o destaque apontando para o vazio nem trava o guia —
//    é o que faz o mesmo conteúdo servir de cartilha em Configurações
//    e de tour com destaque dentro da tela;
//  - fechar/pular nunca deixa overlay preso barrando a tela;
//  - concluir marca progresso que sobrevive à recarga, e o convite de
//    primeiro acesso não volta depois de dispensado;
//  - TODO seletor `alvo` declarado no conteúdo existe no HTML — pega
//    tour apontando para elemento removido numa refatoração futura;
//  - a conclusão vira chamada a capacitacao_registrar_conclusao, e
//    falhar essa chamada NÃO quebra nada (fail-open).

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

async function abrirApp(page) {
  // O CDN do supabase-js não é alcançável neste ambiente e a espera
  // pelo bloqueio custa ~12 s por teste. Abortar deixa a página no
  // mesmo estado (sem cliente Supabase) — que é justamente o cenário
  // que estes testes querem: o guia não pode depender de sessão.
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await page.goto(`${BASE}/pages/agua-app.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
}

// Entra na Home sem passar por Supabase — o motor de guias não pode
// depender de sessão, e é justamente isso que este atalho prova.
async function entrarHomeDeTeste(page) {
  await page.evaluate(async () => {
    await aOfflineInit();
    App.coletor = { id: 'coletor-guia', nome_completo: 'Teste Guia' };
    App.pontos = [];
    await entrarHome();
  });
  await page.locator('#tela-home').waitFor({ state: 'visible', timeout: 10_000 });
}

test('o guia abre e navega passo a passo sem rede e sem sessão', async ({ page }) => {
  await abrirApp(page);
  await page.evaluate(() => {
    guiaDefinir({ ...AGUA_GUIAS, aoTrocarTela: () => {} });
    guiaAbrir('primeiros-passos', { voltarCentral: false });
  });

  const painel = page.locator('.guia-painel');
  await expect(painel).toBeVisible();
  const primeiro = await painel.locator('.guia-titulo').textContent();

  await painel.locator('[data-guia-prox]').click();
  const segundo = await painel.locator('.guia-titulo').textContent();
  expect(segundo).not.toBe(primeiro);

  // "Anterior" está desabilitado no primeiro passo e volta depois.
  await painel.locator('[data-guia-ant]').click();
  expect(await painel.locator('.guia-titulo').textContent()).toBe(primeiro);
  await expect(painel.locator('[data-guia-ant]')).toBeDisabled();
});

test('passo com alvo em tela fechada vira cartão de texto, sem destaque perdido', async ({ page }) => {
  await abrirApp(page);
  await entrarHomeDeTeste(page);

  // 'fazer-uma-coleta' aponta para campos do formulário, que NÃO está
  // aberto: nenhum passo pode ficar com o recorte num retângulo 0×0
  // no canto da tela.
  const r = await page.evaluate(() => {
    guiaDefinir({ ...AGUA_GUIAS, aoTrocarTela: id => { if (id !== 'tela-form') mostrarTela(id) } });
    guiaAbrir('fazer-uma-coleta', { voltarCentral: false });
    const spot = document.querySelector('.guia-spot');
    return {
      painelVisivel: !!document.querySelector('.guia-painel'),
      spotEscondido: !spot || spot.hidden,
      formAberto: !document.getElementById('tela-form').hidden,
    };
  });
  expect(r.painelVisivel).toBe(true);
  expect(r.spotEscondido).toBe(true);
  // O guia NUNCA abre o formulário cru só para poder destacar algo.
  expect(r.formAberto).toBe(false);
});

test('destaque aparece sobre o elemento real quando ele está visível', async ({ page }) => {
  await abrirApp(page);
  await entrarHomeDeTeste(page);

  await page.evaluate(() => {
    guiaDefinir({ ...AGUA_GUIAS, aoTrocarTela: () => {} });
    guiaAbrir('primeiros-passos', { passo: 2, voltarCentral: false }); // passo com alvo #pill-nav
  });

  const spot = page.locator('.guia-spot');
  await expect(spot).toBeVisible();

  // O recorte tem de cobrir de fato a barra de navegação — asserção de
  // classe não provaria posição nenhuma.
  const r = await page.evaluate(() => {
    const s = document.querySelector('.guia-spot').getBoundingClientRect();
    const n = document.getElementById('pill-nav').getBoundingClientRect();
    return { s: { t: s.top, l: s.left, w: s.width, h: s.height },
             n: { t: n.top, l: n.left, w: n.width, h: n.height } };
  });
  expect(r.s.w).toBeGreaterThan(r.n.w - 1);
  expect(r.s.h).toBeGreaterThan(r.n.h - 1);
  expect(Math.abs(r.s.t - (r.n.top ?? r.n.t))).toBeLessThan(20);
});

test('fechar não deixa overlay preso barrando a tela', async ({ page }) => {
  await abrirApp(page);
  await entrarHomeDeTeste(page);
  await page.evaluate(() => {
    guiaDefinir({ ...AGUA_GUIAS, aoTrocarTela: () => {} });
    guiaAbrir('primeiros-passos', { voltarCentral: false });
  });
  await page.locator('.guia-painel [data-guia-fechar]').first().click();
  await expect(page.locator('#guia-raiz')).toBeHidden();

  // Clique real em botão da Home tem de chegar ao destino (overlay
  // preso é invisível no DOM e mortal no uso).
  const chegou = await page.evaluate(() => new Promise(res => {
    const b = document.getElementById('btn-nova-coleta');
    b.addEventListener('click', () => res(true), { once: true });
    const r = b.getBoundingClientRect();
    const alvo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    res(!!alvo && (alvo === b || b.contains(alvo)));
  }));
  expect(chegou).toBe(true);
});

test('Esc fecha o guia', async ({ page }) => {
  await abrirApp(page);
  await page.evaluate(() => {
    guiaDefinir({ ...AGUA_GUIAS, aoTrocarTela: () => {} });
    guiaAbrirCentral();
  });
  await expect(page.locator('.guia-painel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#guia-raiz')).toBeHidden();
});

test('concluir marca progresso que sobrevive à recarga', async ({ page }) => {
  await abrirApp(page);

  await page.evaluate(async () => {
    guiaDefinir({ ...AGUA_GUIAS, aoTrocarTela: () => {} });
    guiaAbrir('gps-e-foto', { voltarCentral: false });
    // Avança até o botão virar "Concluir" e clica.
    for (let i = 0; i < 20; i++) {
      const b = document.querySelector('[data-guia-prox]');
      if (!b) break;
      const ultimo = b.textContent.trim() === 'Concluir';
      b.click();
      if (ultimo) break;
    }
  });
  expect(await page.evaluate(() => guiaConcluido('gps-e-foto'))).toBe(true);

  await page.reload();
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
  const aindaConcluido = await page.evaluate(() => {
    guiaDefinir({ ...AGUA_GUIAS, aoTrocarTela: () => {} });
    return guiaConcluido('gps-e-foto');
  });
  expect(aindaConcluido).toBe(true);
});

test('convite de primeiro acesso aparece uma vez e não volta depois de dispensado', async ({ page }) => {
  await abrirApp(page);
  await entrarHomeDeTeste(page);
  await expect(page.locator('#guia-convite')).toBeVisible();

  await page.locator('[data-guia-dispensar]').click();
  await expect(page.locator('#guia-convite')).toHaveCount(0);

  await page.evaluate(() => { agIniciarGuias(); });
  await expect(page.locator('#guia-convite')).toHaveCount(0);
});

test('todo seletor de alvo declarado no conteúdo existe no HTML', async ({ page }) => {
  await abrirApp(page);
  const faltando = await page.evaluate(() => {
    const fora = [];
    for (const g of AGUA_GUIAS.guias) {
      for (const p of (g.passos || [])) {
        if (p.alvo && !document.querySelector(p.alvo)) fora.push(`${g.slug}: ${p.alvo}`);
      }
    }
    return fora;
  });
  expect(faltando).toEqual([]);
});

test('todo verbete referenciado por um "?" da página existe no conteúdo', async ({ page }) => {
  await abrirApp(page);
  const orfaos = await page.evaluate(() => {
    const chaves = Object.keys(AGUA_GUIAS.verbetes || {});
    return [...document.querySelectorAll('[data-guia-verbete]')]
      .map(b => b.dataset.guiaVerbete)
      .filter(c => !chaves.includes(c));
  });
  expect(orfaos).toEqual([]);
});

test('o "?" do campo abre o verbete e leva ao guia completo', async ({ page }) => {
  await abrirApp(page);
  await entrarHomeDeTeste(page);
  await page.evaluate(() => {
    guiaDefinir({ ...AGUA_GUIAS, aoTrocarTela: () => {} });
    document.querySelector('[data-guia-verbete="codigo-amostra"]').click();
  });
  await expect(page.locator('.guia-painel')).toContainText('Código da coleta');
  await page.locator('[data-guia-ir]').click();
  await expect(page.locator('.guia-pontos')).toBeVisible();
});

test('conclusão é enviada ao banco, e falhar o envio não quebra nada', async ({ page }) => {
  await abrirApp(page);

  const r = await page.evaluate(async () => {
    const chamadas = [];
    // Cliente de mentira que SEMPRE falha: prova o fail-open.
    window.db = { rpc: (nome, args) => { chamadas.push({ nome, args }); return Promise.resolve({ error: { message: 'offline' } }); } };
    guiaDefinir({ ...AGUA_GUIAS, aoTrocarTela: () => {} });
    guiaAbrir('fila-e-sincronizacao', { voltarCentral: false });
    for (let i = 0; i < 20; i++) {
      const b = document.querySelector('[data-guia-prox]');
      if (!b) break;
      const ultimo = b.textContent.trim() === 'Concluir';
      b.click();
      if (ultimo) break;
    }
    await new Promise(r => setTimeout(r, 200));
    return {
      chamadas,
      // Falha de envio nunca desfaz o progresso local nem trava a tela.
      concluidoLocal: guiaConcluido('fila-e-sincronizacao'),
      overlayFechado: document.getElementById('guia-raiz').hidden,
      pendentesGuardados: JSON.parse(localStorage.getItem('siguc_guia_pendentes') || '[]').length,
    };
  });

  expect(r.chamadas.map(c => c.nome)).toContain('capacitacao_registrar_conclusao');
  expect(r.chamadas[0].args.p_escopo).toBe('agua-app');
  expect(r.chamadas[0].args.p_guia).toBe('fila-e-sincronizacao');
  expect(r.concluidoLocal).toBe(true);
  expect(r.overlayFechado).toBe(true);
  // O que não subiu fica na fila para a próxima abertura — nunca se perde.
  expect(r.pendentesGuardados).toBeGreaterThan(0);
});
