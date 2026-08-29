// ── Baralho de PIN · display compartilhado pelos 4 apps de campo ──
// Executar: npx playwright test tests/pin-baralho.test.js
//
// O baralho substitui as 4 bolinhas do PIN por 4 cartas que se
// empilham quando o PIN fecha (js/pin-baralho.js + css/pin-baralho.css).
// Estes testes travam o que não pode quebrar:
//
//  1. A ESPERA NÃO MUDA O LAYOUT. O monte se forma por `transform`
//     dentro da mesma caixa — se alguém trocar por mudança de largura
//     ou por um spinner que entra na tela, a barra de ações pula (é a
//     mesma regra de btnEspera/skeleton do resto do sistema).
//  2. O DÍGITO NÃO FICA NA TELA. PIN é credencial, não código de SMS:
//     aparece por meio segundo e vira ponto.
//  3. O ERRO DEVOLVE AS QUATRO CASAS. Recusado, o baralho se abre de
//     volta e o display volta ao estado de digitar — nunca fica preso
//     no monte.
//  4. DEGRADA EM SILÊNCIO. Sem o módulo, `pinBaralhoPintar` recusa o
//     elemento e cada app cai nas bolinhas do próprio HTML.
//  5. O SELETOR DUPLICADO VENCE. `.pin-baralho.pin-baralho` existe
//     para ganhar do `gap` que o CSS de cada app declara no MESMO
//     elemento, inclusive quando esse CSS vem depois (Frota).

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const HARNESS = `${BASE}/tests/fixtures/pin-baralho-harness.html`;

async function abrir(page) {
  await page.goto(HARNESS);
  await page.waitForFunction(() => typeof window.pinBaralhoMontar === 'function');
}

async function montar(page) {
  await page.evaluate(() => window.pinBaralhoMontar(document.getElementById('display')));
}

async function digitar(page, str) {
  await page.evaluate((s) => window.pinBaralhoPintar(document.getElementById('display'), s), str);
}

test.describe('baralho de PIN', () => {

  test('monta 4 cartas no lugar das bolinhas', async ({ page }) => {
    await abrir(page);
    await expect(page.locator('#display .pin-dot')).toHaveCount(4);
    await montar(page);
    await expect(page.locator('#display .pin-dot')).toHaveCount(0);
    await expect(page.locator('#display .pin-carta')).toHaveCount(4);
    // Idempotente: montar de novo não duplica nem some com nada.
    await montar(page);
    await expect(page.locator('#display .pin-carta')).toHaveCount(4);
  });

  test('não toca em display que ninguém montou (degradação)', async ({ page }) => {
    await abrir(page);
    await montar(page);
    const intocado = await page.evaluate(() =>
      window.pinBaralhoPintar(document.getElementById('display-intocado'), '12'));
    expect(intocado).toBe(false);              // o app cai nas bolinhas
    await expect(page.locator('#display-intocado .pin-dot')).toHaveCount(4);
  });

  test('o gap do baralho vence o gap declarado pelo app', async ({ page }) => {
    await abrir(page);
    await montar(page);
    // O harness declara `gap:14px` num <style> inline, que vem DEPOIS
    // do <link> — é a situação do frota-app.html. Sem o seletor
    // duplicado, o 14px venceria.
    const gap = await page.evaluate(() =>
      getComputedStyle(document.getElementById('display')).columnGap);
    expect(gap).toBe('12px');
  });

  test('a cor do app vence o padrão do módulo', async ({ page }) => {
    await abrir(page);
    await montar(page);
    await digitar(page, '1');
    // O módulo NÃO pode declarar --pin-cor: `.pin-baralho.pin-baralho`
    // tem especificidade maior que o `.pin-display` de cada app e
    // pintaria os quatro de azul. O padrão entra como fallback do
    // var(), nunca como declaração.
    const r = await page.evaluate(() => ({
      cor: getComputedStyle(document.getElementById('display')).getPropertyValue('--pin-cor').trim(),
      // color-mix resolve para `color(srgb …)`; 159/255 = 0.623 é o
      // verde do harness, 125/255 = 0.490 seria o azul do módulo.
      borda: getComputedStyle(document.querySelector('#display .pin-carta.cheia')).borderTopColor,
    }));
    expect(r.cor).toBe('#9FE870');
    expect(r.borda).toContain('0.623');
  });

  test('o dígito aparece e vira ponto — o PIN não fica legível', async ({ page }) => {
    await abrir(page);
    await montar(page);
    // Leitura SÍNCRONA logo após pintar: o dígito só fica meio segundo
    // na tela, então um `expect` com retry chegaria depois da máscara e
    // acusaria falha onde não há.
    const logoApos = await page.evaluate(() => {
      const el = document.getElementById('display');
      window.pinBaralhoPintar(el, '7');
      const c = el.querySelector('.pin-carta');
      return { texto: c.textContent, cheia: c.classList.contains('cheia') };
    });
    expect(logoApos).toEqual({ texto: '7', cheia: true });
    const primeira = page.locator('#display .pin-carta').first();
    // Meio segundo depois o dígito some e sobra o ponto.
    await expect(primeira.locator('.pin-ponto')).toBeVisible({ timeout: 3000 });
    await expect(primeira).toHaveText('');
  });

  test('formar o monte não muda o tamanho da caixa', async ({ page }) => {
    await abrir(page);
    await montar(page);
    await digitar(page, '1234');
    const antes = await page.locator('#display').boundingBox();

    await page.evaluate(() => window.pinBaralhoFechar(document.getElementById('display')));
    await expect(page.locator('#display')).toHaveClass(/pin-conferindo/);
    // A animação de empilhar leva ~360ms; mede depois de assentar.
    await page.waitForTimeout(600);
    const depois = await page.locator('#display').boundingBox();

    expect(Math.round(depois.width)).toBe(Math.round(antes.width));
    expect(Math.round(depois.height)).toBe(Math.round(antes.height));

    // E as cartas de fato se juntaram: os centros convergem para um
    // ponto só (é isso que faz o monte, não uma classe qualquer).
    const centros = await page.evaluate(() =>
      [...document.querySelectorAll('#display .pin-carta')].map(c => {
        const r = c.getBoundingClientRect(); return r.left + r.width / 2;
      }));
    const espalhamento = Math.max(...centros) - Math.min(...centros);
    expect(espalhamento).toBeLessThan(12);
  });

  test('aprovado: o visto entra na carta do topo', async ({ page }) => {
    await abrir(page);
    await montar(page);
    await digitar(page, '1234');
    await page.evaluate(async () => {
      const el = document.getElementById('display');
      await window.pinBaralhoFechar(el);
      await window.pinBaralhoAprovar(el);
    });
    await expect(page.locator('#display .pin-carta.pin-aprovada')).toHaveCount(1);
    await expect(page.locator('#display .pin-carta.pin-aprovada .pin-selo')).toBeVisible();
    // Deixou de conferir — o pulso para junto com o veredito.
    await expect(page.locator('#display')).not.toHaveClass(/pin-conferindo/);
  });

  test('recusado: o baralho se abre de volta nas quatro casas', async ({ page }) => {
    await abrir(page);
    await montar(page);
    await digitar(page, '9999');
    await page.evaluate(async () => {
      const el = document.getElementById('display');
      await window.pinBaralhoFechar(el);
      await window.pinBaralhoRecusar(el);
    });

    // Volta ao estado de digitar: sem monte, sem marca de recusa, sem
    // dígito preso e com as 4 casas separadas de novo.
    const el = page.locator('#display');
    await expect(el).not.toHaveClass(/pin-empilhando/);
    await expect(el).not.toHaveClass(/pin-conferindo/);
    await expect(el).not.toHaveClass(/pin-recusado/);
    await expect(page.locator('#display .pin-carta.cheia')).toHaveCount(0);
    await expect(page.locator('#display .pin-ponto')).toHaveCount(0);

    const centros = await page.evaluate(() =>
      [...document.querySelectorAll('#display .pin-carta')].map(c => {
        const r = c.getBoundingClientRect(); return r.left + r.width / 2;
      }));
    expect(Math.max(...centros) - Math.min(...centros)).toBeGreaterThan(100);
  });

  test('apagar o PIN com o monte formado desfaz o monte', async ({ page }) => {
    await abrir(page);
    await montar(page);
    await digitar(page, '1234');
    await page.evaluate(() => window.pinBaralhoFechar(document.getElementById('display')));
    await expect(page.locator('#display')).toHaveClass(/pin-conferindo/);
    // É o que os apps fazem ao zerar o buffer (erro, cancelamento).
    await digitar(page, '');
    await expect(page.locator('#display')).not.toHaveClass(/pin-conferindo/);
    await expect(page.locator('#display')).not.toHaveClass(/pin-empilhando/);
  });

  test('movimento reduzido: sem deslizar, mas com o veredito na tela', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page);
    await montar(page);
    await digitar(page, '1234');
    await page.evaluate(async () => {
      const el = document.getElementById('display');
      await window.pinBaralhoFechar(el);
      await window.pinBaralhoAprovar(el);
    });
    await expect(page.locator('#display .pin-carta.pin-aprovada .pin-selo')).toBeVisible();
    // O traço do visto é desenhado inteiro de saída, sem a animação.
    const offset = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#display .pin-selo path')).strokeDashoffset);
    expect(parseFloat(offset)).toBe(0);
  });

});
