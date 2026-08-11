// ── Mapa das UCs · painel-resumo dos alertas ─────────────────────
// Executar: npx playwright test tests/mapa-resumo-painel.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual ao tests/frota-app-barra.test.js)
//
// POR QUE ESTE TESTE EXISTE: o painel nasceu com um #resumo-overlay
// cobrindo a viewport inteira (inset:0, z-index 640) com onclick de
// fechar. Isso fazia duas coisas erradas de uma vez: fechava o painel
// a qualquer clique fora E bloqueava o mapa inteiro — arrastar, dar
// zoom e clicar em marcador não chegavam ao Leaflet enquanto o resumo
// estivesse aberto. Resumo do que está no mapa precisa ser lido COM o
// mapa em uso; é painel lateral, não modal.
//
// O que ele trava:
//  - nenhum elemento cobrindo a tela por cima do mapa;
//  - clique no mapa NÃO fecha o painel;
//  - o clique chega mesmo ao mapa (não é engolido por camada);
//  - o ✕ fecha, e a escolha é lembrada entre sessões;
//  - a alça redimensiona e respeita os limites.

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

// A página exige sessão Supabase para montar o mapa; o alvo aqui é o
// comportamento do painel, então montamos a gaveta real e exercitamos
// as funções que ela usa, na própria página.
async function abrirPainel(page) {
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof window.abrirResumoAlertas === 'function', null, { timeout: 20_000 });
  await page.evaluate(() => {
    // Sem dados: o corpo do painel mostra o aviso de camada desligada,
    // que é suficiente para testar a mecânica da gaveta.
    window._alertasAtivo = false;
    window.abrirResumoAlertas();
  });
  await page.locator('#resumo-panel.aberto').waitFor({ state: 'visible', timeout: 10_000 });
  // A gaveta entra com transform por 0,28s — medir ou clicar antes de
  // a transição assentar mira um alvo em movimento (a alça chega a
  // aparecer a ~40px da borda). Espera o transform virar identidade.
  await page.waitForFunction(() => {
    const t = getComputedStyle(document.getElementById('resumo-panel')).transform;
    return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
  }, null, { timeout: 5_000 });
}

test('painel aberto não cobre a tela nem fecha ao clicar fora', async ({ page }) => {
  await abrirPainel(page);

  // 1. Não existe overlay de tela cheia por cima do mapa.
  const cobrindo = await page.evaluate(() => {
    return [...document.querySelectorAll('body > div, body > *')].filter(el => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      if (s.position !== 'fixed' && s.position !== 'absolute') return false;
      const r = el.getBoundingClientRect();
      const telaToda = r.width >= window.innerWidth * 0.95 && r.height >= window.innerHeight * 0.95;
      return telaToda && s.pointerEvents !== 'none' && +s.zIndex >= 400;
    }).map(el => el.id || el.className || el.tagName);
  });
  expect(cobrindo, `elementos cobrindo a tela: ${JSON.stringify(cobrindo)}`).toEqual([]);

  // 2. O que está no canto superior esquerdo (área do mapa) NÃO é uma
  //    camada de fechar — é o próprio mapa/conteúdo da página.
  const alvo = await page.evaluate(() => {
    const el = document.elementFromPoint(80, Math.round(window.innerHeight / 2));
    return { id: el?.id || '', dentroDoResumo: !!el?.closest('#resumo-panel') };
  });
  expect(alvo.dentroDoResumo).toBe(false);
  expect(alvo.id).not.toBe('resumo-overlay');

  // 3. Clicar longe do painel não fecha.
  await page.mouse.click(80, Math.round(page.viewportSize().height / 2));
  await page.waitForTimeout(400);
  await expect(page.locator('#resumo-panel')).toHaveClass(/aberto/);
});

test('✕ fecha e a escolha é lembrada; reabrir volta a valer', async ({ page }) => {
  await abrirPainel(page);

  await page.locator('#resumo-panel button[title="Fechar resumo"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#resumo-panel')).not.toHaveClass(/aberto/);

  // Fechou por escolha → não reabre sozinho ao ligar a camada.
  const pref = await page.evaluate(() => ({
    guardado: localStorage.getItem('siguc_resumo_alertas'),
    autoAbre: window._resumoAutoAbrir(),
  }));
  expect(pref.guardado).toBe('0');
  expect(pref.autoAbre).toBe(false);

  // Reabrir pelo botão restaura a abertura automática.
  await page.evaluate(() => window.abrirResumoAlertas());
  await expect(page.locator('#resumo-panel')).toHaveClass(/aberto/);
  expect(await page.evaluate(() => window._resumoAutoAbrir())).toBe(true);
});

test('alça redimensiona e respeita os limites', async ({ page }) => {
  await abrirPainel(page);
  const larguraDe = () => page.evaluate(() => document.getElementById('resumo-panel').getBoundingClientRect().width);

  const inicial = await larguraDe();
  expect(inicial).toBeGreaterThan(300);

  const alca = page.locator('#resumo-resize');
  const box  = await alca.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + 200, { steps: 10 });
  await page.mouse.up();

  const alargado = await larguraDe();
  expect(alargado).toBeGreaterThan(inicial);
  expect(alargado).toBeLessThanOrEqual(600);

  // Persistiu.
  expect(await page.evaluate(() => parseInt(localStorage.getItem('siguc_resumo_largura'), 10)))
    .toBeGreaterThan(inicial);

  // Arrastar muito para a direita não encolhe abaixo do mínimo.
  const box2 = await alca.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + 200);
  await page.mouse.down();
  await page.mouse.move(box2.x + 900, box2.y + 200, { steps: 10 });
  await page.mouse.up();
  expect(await larguraDe()).toBeGreaterThanOrEqual(280);
});
