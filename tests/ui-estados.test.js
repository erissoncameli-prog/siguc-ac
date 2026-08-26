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
