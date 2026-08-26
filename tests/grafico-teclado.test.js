const { test, expect } = require('@playwright/test');
const PAG = 'http://localhost:5500/tests/fixtures/grafico-harness.html';

async function montar(page) {
  await page.goto(PAG);
  await page.waitForFunction(() => typeof window.montar === 'function' && typeof aguaIqaGraficoHTML === 'function');
  await page.evaluate(() => window.montar());
}

test('gráfico é UMA parada de Tab, não uma por ponto', async ({ page }) => {
  await montar(page);
  await page.locator('#antes').focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.className)).toContain('gt-svg');
  // a proxima parada tem de ser o <summary> da tabela, nunca outro ponto
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.tagName)).toBe('SUMMARY');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('depois');
});

test('setas percorrem os pontos e anunciam o valor', async ({ page }) => {
  await montar(page);
  await page.locator('.gt-svg').focus();
  const ler = () => page.locator('.gt-live').textContent();

  expect(await ler()).toContain('1 de 5');
  expect(await ler()).toContain('62,4');

  await page.keyboard.press('ArrowRight');
  expect(await ler()).toContain('2 de 5');
  expect(await ler()).toContain('71,8');

  // ponto sem IQA nao pode ser pulado nem mentir um valor
  await page.keyboard.press('ArrowRight');
  expect(await ler()).toContain('sem IQA calculado');

  await page.keyboard.press('End');
  expect(await ler()).toContain('5 de 5');

  await page.keyboard.press('Home');
  expect(await ler()).toContain('1 de 5');

  // nao passa da ponta
  await page.keyboard.press('ArrowLeft');
  expect(await ler()).toContain('1 de 5');
});

test('seta dentro do gráfico não rola a página', async ({ page }) => {
  await montar(page);
  await page.evaluate(() => document.body.style.height = '3000px');
  await page.locator('.gt-svg').focus();
  const antes = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => window.scrollY)).toBe(antes);
});

test('tabela alternativa traz todos os pontos, inclusive quarentena', async ({ page }) => {
  await montar(page);
  await page.locator('.gt-svg').focus();
  await page.locator('.gt-tabela summary').click();
  const linhas = page.locator('.gt-tabela tbody tr');
  await expect(linhas).toHaveCount(5);
  await expect(page.locator('.gt-tabela')).toContainText('em conferência');
});

test('o realce some ao sair do foco, sem estragar o desenho', async ({ page }) => {
  await montar(page);
  const circulos = () => page.locator('.gt-svg svg circle').count();
  const antes = await circulos();
  await page.locator('.gt-svg').focus();
  expect(await page.locator('.gt-halo').count()).toBe(1);
  await page.locator('#depois').focus();
  expect(await page.locator('.gt-halo').count()).toBe(0);
  expect(await circulos()).toBe(antes);
});
