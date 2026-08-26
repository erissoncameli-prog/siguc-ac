const { test, expect } = require('@playwright/test');
const PAG = 'http://localhost:5500/tests/fixtures/estilos-harness.html';

test('Fase 2 — foco, desabilitado, btn-xs, carregando e esqueleto', async ({ page }) => {
  await page.goto(PAG);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#b1')).paddingLeft === '16px');

  // 1) .btn-xs >= 24px de altura (WCAG 2.2 Target Size)
  const hXs = (await page.locator('#b3').boundingBox()).height;

  // 2) desabilitado tem de diferir do ativo
  const corAtivo = await page.locator('#b1').evaluate(e => getComputedStyle(e).backgroundColor);
  const corDesab = await page.locator('#b2').evaluate(e => getComputedStyle(e).backgroundColor);
  const cursor   = await page.locator('#b2').evaluate(e => getComputedStyle(e).cursor);

  // 3) foco por teclado pinta contorno
  await page.keyboard.press('Tab');
  const focado  = await page.evaluate(() => document.activeElement.id);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth);

  // 4) botao carregando: rotulo transparente, largura preservada
  const corTexto = await page.locator('#b4').evaluate(e => getComputedStyle(e).color);
  const wCarreg  = (await page.locator('#b4').boundingBox()).width;

  // 5) esqueleto reserva altura
  const hSk = (await page.locator('#sk').boundingBox()).height;

  // 6) contraste do cabecalho de tabela (Fase 1, confere junto)
  const corTh = await page.locator('#th').evaluate(e => getComputedStyle(e).color);

  console.log(`btn-xs=${hXs}px | ativo=${corAtivo} desab=${corDesab} cursor=${cursor}`);
  console.log(`foco=#${focado} outline=${outline} | carregando cor=${corTexto} w=${wCarreg}px`);
  console.log(`esqueleto=${hSk}px | thead th=${corTh}`);

  expect(hXs).toBeGreaterThanOrEqual(24);
  expect(corDesab).not.toBe(corAtivo);
  expect(cursor).toBe('not-allowed');
  expect(parseFloat(outline)).toBeGreaterThan(0);
  expect(corTexto).toContain('rgba(0, 0, 0, 0)');
  expect(wCarreg).toBeGreaterThan(40);
  expect(hSk).toBeGreaterThanOrEqual(12);
  expect(corTh).toBe('rgb(107, 114, 128)');   // --cinza-500
});

test('anel de foco na sidebar usa ouro, nao o verde que sumiria no fundo escuro', async ({ page }) => {
  await page.goto(PAG);
  await page.locator('#ls').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const cor = await page.locator('#ls').evaluate(e => getComputedStyle(e).outlineColor);
  console.log(`sidebar outline=${cor}`);
  expect(cor).toBe('rgb(244, 211, 94)');      // --ouro-claro
});

test('clique de mouse NAO pinta anel — o contrato do :focus-visible', async ({ page }) => {
  await page.goto(PAG);
  await page.locator('#b1').click();
  const estilo = await page.locator('#b1').evaluate(e => getComputedStyle(e).outlineStyle);
  console.log(`apos clique outline-style=${estilo}`);
  expect(estilo).toBe('none');
});

// ── Guarda estrutural: nenhuma tabela de mesa sem contêiner de rolagem.
// Sem isso a tabela empurra o corpo da página e o usuário rola a tela
// INTEIRA de lado (cabeçalho e menu junto) no celular. O projeto já
// tinha .table-wrap/.table-scroll em css/global.css; 4 páginas nunca
// tinham sido envolvidas. Lê os arquivos, não o navegador — é uma regra
// sobre a marcação, e assim vale para página nova sem custo de render.
const fs = require('fs');
const path = require('path');

test('toda página de mesa com <table> tem contêiner de rolagem horizontal', () => {
  const dir = path.join(__dirname, '..', 'pages');
  const semProtecao = fs.readdirSync(dir)
    .filter(f => f.endsWith('.html'))
    .filter(f => {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      return s.includes('<table') && !/table-wrap|table-scroll|overflow-x/.test(s);
    });
  expect(semProtecao, `sem contêiner de rolagem: ${semProtecao.join(', ')}`).toEqual([]);
});

// ── btnEspera + esqueleto (js/config.js). Estes são os helpers que as
// telas passaram a chamar; se quebrarem, o envio de formulário some.
test('btnEspera trava a largura, desabilita e restaura o rótulo original', async ({ page }) => {
  await page.goto(PAG);
  await page.waitForFunction(() => typeof window.btnEspera === 'function');

  const b = page.locator('#b1');
  const larguraAntes = (await b.boundingBox()).width;
  const rotuloAntes  = await b.textContent();

  await page.evaluate(() => { window._restaurar = btnEspera(document.getElementById('b1')); });

  expect(await b.evaluate(e => e.disabled)).toBe(true);
  expect(await b.evaluate(e => e.getAttribute('aria-busy'))).toBe('true');
  // O requisito é NAO ENCOLHER, não ser idêntico: btnEspera usa
  // Math.ceil para nunca ficar abaixo da largura natural (aqui, 66,33
  // vira 67). Encolher é o defeito — 0,67px a mais, não.
  const larguraDurante = (await b.boundingBox()).width;
  expect(larguraDurante).toBeGreaterThanOrEqual(larguraAntes);
  expect(larguraDurante).toBeLessThan(larguraAntes + 2);
  // .btn tem `transition: all .15s`, então a cor ANIMA até transparente
  // — ler logo após add('carregando') pega rgba(...,0.65) no meio do
  // caminho. Espera a transição fechar em vez de medir um quadro solto.
  await expect.poll(
    () => b.evaluate(e => getComputedStyle(e).color),
    { timeout: 2000 }
  ).toBe('rgba(0, 0, 0, 0)');

  await page.evaluate(() => window._restaurar());
  expect(await b.evaluate(e => e.disabled)).toBe(false);
  expect(await b.evaluate(e => e.hasAttribute('aria-busy'))).toBe(false);
  expect(await b.textContent()).toBe(rotuloAntes);
  expect((await b.boundingBox()).width).toBeCloseTo(larguraAntes, 1);
});

test('btnEspera é idempotente na restauração e tolera botão nulo', async ({ page }) => {
  await page.goto(PAG);
  await page.waitForFunction(() => typeof window.btnEspera === 'function');
  const r = await page.evaluate(() => {
    const f = btnEspera(null); f(); f();          // não pode lançar
    const g = btnEspera(document.getElementById('b1'));
    g(); g();                                      // restaurar 2x
    return document.getElementById('b1').disabled;
  });
  expect(r).toBe(false);
});

test('esqueleto de tabela respeita o número de colunas e reserva altura', async ({ page }) => {
  await page.goto(PAG);
  await page.waitForFunction(() => typeof window.skeletonTabelaHTML === 'function');
  await page.evaluate(() => {
    document.getElementById('tb-sk').innerHTML = skeletonTabelaHTML(3, 4);
  });
  await expect(page.locator('#tb-sk tr')).toHaveCount(4);
  await expect(page.locator('#tb-sk tr:first-child td')).toHaveCount(3);
  const alt = (await page.locator('#tb-sk').boundingBox()).height;
  expect(alt).toBeGreaterThan(100);   // 4 linhas de verdade, nao uma
});
