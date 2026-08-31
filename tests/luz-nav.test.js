// ── Anel/bastão da barra de navegação · fonte única dos 4 apps ────
// Executar: npx playwright test tests/luz-nav.test.js
//
// js/luz-nav.js + css/luz-nav.css substituem o preenchimento
// translúcido estático da aba ativa por um traço que circunda o
// botão (anel em repouso) e vira cápsula reta durante a troca
// (bastão). Estes testes travam o que não pode quebrar — ver a
// análise em CLAUDE.md ("Regra do sistema — anel/bastão da barra de
// navegação"):
//
//  1. NUNCA UMA FORMA ABERTA. width >= height do <rect> em TODO
//     quadro do percurso — é a regra central ("sempre um anel numa
//     aba ou um bastão reto entre duas, nunca uma curva").
//  2. O BASTÃO REALMENTE ABRE, e o TRAÇO ENGROSSA junto — número
//     medido no navegador, não classe.
//  3. A LUZ NUNCA COBRE NADA: fica atrás dos botões (z-index), e o
//     crachá de pendência fica na FRENTE dela.
//  4. NENHUM ANCESTRAL GANHA transform — a armadilha que já derrubou
//     a barra do Frota três vezes (documentada no CLAUDE.md).
//  5. A BARRA CONTINUA CLICÁVEL com a luz em voo, e ARRASTAR seleciona
//     a aba mais próxima com solta imantada.
//  6. A COR NÃO VAZA entre duas barras montadas na mesma página.
//  7. DEGRADA EM SILÊNCIO sem o módulo chamado.
//  8. RESPEITA "reduzir movimento" — anel salta, sem bastão.
//  9. O RAIO DO ANEL acompanha o botão (Frota: 48px normal, 56px
//     primária) — nunca um raio fixo.
// 10. SOBREVIVE À BARRA SER RECRIADA DO ZERO (só o Frota faz isso,
//     ao trocar de modo) — luzNavMontar é idempotente e religa.

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const HARNESS = `${BASE}/tests/fixtures/luz-nav-harness.html`;

async function abrir(page) {
  await page.goto(HARNESS);
  await page.waitForFunction(() => typeof window.luzNavMontar === 'function');
}

// Clica uma aba e devolve amostras de {w,h,strokeWidth} colhidas a
// cada quadro durante ~900ms — tempo de sobra para o voo mais longo
// assentar (medido: ~350-420ms na nossa geometria).
async function clicarEAmostrar(page, navId, btnSeletor) {
  await page.click(`#${navId} ${btnSeletor}`);
  return page.evaluate(async (id) => {
    const nucleo = document.querySelector(`#${id} .luz-nav-nucleo`);
    const amostras = [];
    const t0 = performance.now();
    await new Promise((res) => {
      const passo = () => {
        amostras.push({
          w: +nucleo.getAttribute('width'),
          h: +nucleo.getAttribute('height'),
          esp: +nucleo.getAttribute('stroke-width'),
        });
        if (performance.now() - t0 < 900) requestAnimationFrame(passo);
        else res();
      };
      requestAnimationFrame(passo);
    });
    return amostras;
  }, navId);
}

test.describe('anel/bastão da barra de navegação', () => {

  test('nunca existe forma aberta — width >= height em todo quadro', async ({ page }) => {
    await abrir(page);
    await page.click('#nav-a [data-tela="tela-home"]'); // assenta no repouso
    await page.waitForTimeout(600);
    const amostras = await clicarEAmostrar(page, 'nav-a', '[data-tela="tela-config"]');
    expect(amostras.length).toBeGreaterThan(10);
    const abertas = amostras.filter((a) => a.w < a.h - 0.5);
    expect(abertas, `${abertas.length} quadro(s) com forma aberta`).toEqual([]);
  });

  test('o bastão realmente abre, e o traço engrossa junto', async ({ page }) => {
    await abrir(page);
    await page.click('#nav-a [data-tela="tela-home"]');
    await page.waitForTimeout(600);
    const repouso = await page.evaluate(() => {
      const n = document.querySelector('#nav-a .luz-nav-nucleo');
      return { w: +n.getAttribute('width'), esp: +n.getAttribute('stroke-width') };
    });
    const amostras = await clicarEAmostrar(page, 'nav-a', '[data-tela="tela-config"]');
    const pico = amostras.reduce((m, a) => (a.w > m.w ? a : m), amostras[0]);
    // "tela-config" é a 5ª aba, salto de ponta a ponta — o bastão tem
    // que abrir bem além do anel parado.
    expect(pico.w).toBeGreaterThan(repouso.w * 1.4);
    expect(pico.esp).toBeGreaterThan(repouso.esp);
  });

  test('a luz fica atrás dos botões — nunca cobre ícone nem rótulo', async ({ page }) => {
    await abrir(page);
    await page.click('#nav-a [data-tela="tela-home"]');
    const z = await page.evaluate(() => ({
      luz: getComputedStyle(document.querySelector('#nav-a .luz-nav-svg')).zIndex,
      btn: getComputedStyle(document.querySelector('#nav-a .pill-btn')).zIndex,
      temLuz: document.getElementById('nav-a').classList.contains('tem-luz'),
    }));
    expect(z.temLuz).toBe(true);
    expect(Number(z.btn)).toBeGreaterThan(Number(z.luz));
  });

  test('o crachá da Fila fica na frente da luz', async ({ page }) => {
    await abrir(page);
    // Mostra o crachá (como o app faz ao ter pendência) e manda a luz
    // pra aquele botão — a cor deveria puxar pro alerta também.
    await page.evaluate(() => {
      document.querySelector('#nav-a [data-tela="tela-fila"] .pill-badge').hidden = false;
    });
    await page.click('#nav-a [data-tela="tela-fila"]');
    await page.waitForTimeout(700); // assenta

    // A cor da luz puxou pro alerta (--luz-cor-alerta), não a cor
    // padrão do app — confirma a exceção semântica, com o crachá
    // AINDA visível (lido antes de qualquer outra mutação, senão o
    // próprio ato de escondê-lo depois já reverteria a cor).
    const corFinal = await page.evaluate(() =>
      document.querySelector('#nav-a .luz-nav-nucleo').getAttribute('stroke'));
    expect(corFinal).toMatch(/^url\(#/); // é o gradiente; a cor real está nos <stop>
    const stopCor = await page.evaluate(() => {
      const grad = document.querySelector('#nav-a linearGradient');
      return grad.querySelectorAll('stop')[1].getAttribute('stop-color');
    });
    expect(stopCor.toLowerCase()).toBe('#e0a227');

    const badge = page.locator('#nav-a [data-tela="tela-fila"] .pill-badge');
    const caixa = await badge.boundingBox();
    const alvo = { x: Math.round(caixa.x + caixa.width / 2), y: Math.round(caixa.y + caixa.height / 2), width: 1, height: 1 };
    const pixel = await page.screenshot({ clip: alvo });
    // O fundo do crachá é #EF5B3C (239,91,60) — bem distinto do verde
    // da luz (#7BE0AE) ou do preto da barra. Compara contra um recorte
    // da MESMA barra com o crachá escondido, que nunca será igual
    // byte a byte (Node não tem decodificador PNG nativo à mão aqui).
    await page.evaluate(() => {
      document.querySelector('#nav-a [data-tela="tela-fila"] .pill-badge').hidden = true;
    });
    await page.waitForTimeout(50);
    const semCrachar = await page.screenshot({ clip: alvo });
    expect(Buffer.compare(pixel, semCrachar), 'o crachá pintou algo ali').not.toBe(0);
  });

  test('nenhum ancestral ganhou transform', async ({ page }) => {
    await abrir(page);
    await page.click('#nav-a [data-tela="tela-fila"]');
    const ruins = await page.evaluate(() => {
      let el = document.getElementById('nav-a').parentElement;
      const achados = [];
      while (el && el !== document.documentElement) {
        if (getComputedStyle(el).transform !== 'none') achados.push(el.className || el.tagName);
        el = el.parentElement;
      }
      return achados;
    });
    expect(ruins).toEqual([]);
  });

  test('a barra continua clicável com a luz em voo', async ({ page }) => {
    await abrir(page);
    await page.click('#nav-a [data-tela="tela-home"]');
    // Clica em sequência rápida, sem esperar o voo assentar — a área
    // de toque não pode descolar da pintada.
    await page.click('#nav-a [data-tela="tela-fila"]');
    await page.click('#nav-a [data-tela="tela-dados"]');
    await page.click('#nav-a [data-tela="tela-config"]');
    await expect(page.locator('#nav-a [data-tela="tela-config"]')).toHaveClass(/ativa/);
    await expect(page.locator('#nav-a [data-tela="tela-fila"]')).not.toHaveClass(/ativa/);
  });

  test('arrastar a luz seleciona a aba mais próxima da solta', async ({ page }) => {
    await abrir(page);
    await page.click('#nav-a [data-tela="tela-home"]');
    await page.waitForTimeout(500);
    const nav = page.locator('#nav-a');
    const caixa = await nav.boundingBox();
    const alvoBtn = await page.locator('#nav-a [data-tela="tela-dados"]').boundingBox();

    await page.mouse.move(caixa.x + 26, caixa.y + caixa.height / 2);
    await page.mouse.down();
    await page.mouse.move(alvoBtn.x + alvoBtn.width / 2, caixa.y + caixa.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator('#nav-a [data-tela="tela-dados"]')).toHaveClass(/ativa/);
  });

  test('arrastar e soltar num botão que não é aba volta pra aba ativa, com voo', async ({ page }) => {
    await abrir(page);
    await page.click('#nav-a [data-tela="tela-fila"]');
    await page.waitForTimeout(500);
    const nav = page.locator('#nav-a');
    const caixa = await nav.boundingBox();
    const camBtn = await page.locator('#nav-a [data-nat-form]').boundingBox();
    const filaBtn = await page.locator('#nav-a [data-tela="tela-fila"]').boundingBox();

    await page.mouse.move(filaBtn.x + filaBtn.width / 2, caixa.y + caixa.height / 2);
    await page.mouse.down();
    await page.mouse.move(camBtn.x + camBtn.width / 2, caixa.y + caixa.height / 2, { steps: 12 });
    await page.mouse.up();

    // .ativa não muda — câmera nunca vira aba — mas a luz TEM que
    // voltar sozinha pro lugar certo, com voo de verdade (não um
    // salto): é o caso em que .click() no botão-alvo não gera mutação
    // nenhuma pro MutationObserver interno pegar sozinho.
    await expect(page.locator('#nav-a [data-tela="tela-fila"]')).toHaveClass(/ativa/);
    const alvoFila = filaBtn.x + filaBtn.width / 2 - caixa.x;
    let viuLonge = false, pico = 0;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(25);
      const g = await page.evaluate(() => {
        const n = document.querySelector('#nav-a .luz-nav-nucleo');
        return { w: +n.getAttribute('width'), x: +n.getAttribute('x') };
      });
      if (Math.abs(g.x + g.w / 2 - alvoFila) > 6) viuLonge = true;
      if (g.w > pico) pico = g.w;
    }
    expect(viuLonge, 'a luz nunca saiu de cima da câmera — não voltou').toBe(true);
    const final = await page.evaluate(() => {
      const n = document.querySelector('#nav-a .luz-nav-nucleo');
      return { w: +n.getAttribute('width'), x: +n.getAttribute('x') };
    });
    expect(Math.abs(final.x + final.w / 2 - alvoFila)).toBeLessThan(2);
  });

  test('a cor não vaza entre duas barras montadas na mesma página', async ({ page }) => {
    await abrir(page);
    await page.click('#nav-a [data-tela="tela-fila"]');
    await page.click('#nav-b [data-tela="tela-historico"]');
    await page.waitForTimeout(700);
    const cores = await page.evaluate(() => ({
      a: document.querySelector('#nav-a linearGradient stop').getAttribute('stop-color'),
      b: document.querySelector('#nav-b linearGradient stop').getAttribute('stop-color'),
    }));
    expect(cores.a).not.toBe(cores.b);
    expect(cores.a.toLowerCase()).toBe('#7be0ae');
    expect(cores.b.toLowerCase()).toBe('#7dd3fc');
  });

  test('degrada em silêncio — sem luzNavMontar, a barra funciona como antes', async ({ page }) => {
    await page.goto(HARNESS);
    // Não chama luzNavMontar em lugar nenhum: só o clique nativo do
    // navegador no <button>, sem o listener da página (que também
    // chamaria o módulo) — simula o script não ter carregado.
    await page.evaluate(() => {
      document.querySelectorAll('#nav-a .pill-btn').forEach((b) => b.classList.remove('ativa'));
      document.querySelector('#nav-a [data-tela="tela-dados"]').classList.add('ativa');
    });
    const estilo = await page.evaluate(() => {
      const el = document.querySelector('#nav-a [data-tela="tela-dados"]');
      return { bg: getComputedStyle(el).backgroundColor, temLuz: document.getElementById('nav-a').classList.contains('tem-luz') };
    });
    expect(estilo.temLuz).toBe(false);
    // rgba(255,255,255,.12) — o preenchimento antigo continua valendo.
    expect(estilo.bg).toBe('rgba(255, 255, 255, 0.12)');
  });

  test('respeita "reduzir movimento" — o anel salta, sem bastão', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page);
    await page.click('#nav-a [data-tela="tela-home"]');
    await page.waitForTimeout(100);
    await page.click('#nav-a [data-tela="tela-config"]');
    // Sem esperar nada: se saltou de verdade, já está fechado no
    // quadro seguinte (nenhuma mola rodando).
    const logo = await page.evaluate(() => {
      const n = document.querySelector('#nav-a .luz-nav-nucleo');
      return { w: +n.getAttribute('width'), h: +n.getAttribute('height') };
    });
    expect(Math.abs(logo.w - logo.h)).toBeLessThan(1);
  });

  test('o raio do anel acompanha o botão (Frota: normal 48px, primária 56px)', async ({ page }) => {
    await abrir(page);
    await page.click('#nav-c [data-tab="inicio"]');
    await page.waitForTimeout(500);
    const normal = await page.evaluate(() => +document.querySelector('#nav-c .luz-nav-nucleo').getAttribute('height'));
    expect(normal).toBeGreaterThanOrEqual(46);
    expect(normal).toBeLessThanOrEqual(50);

    await page.click('#nav-c [data-tab="nova"]'); // a aba primária, 56px
    await page.waitForTimeout(700);
    const primaria = await page.evaluate(() => +document.querySelector('#nav-c .luz-nav-nucleo').getAttribute('height'));
    expect(primaria).toBeGreaterThanOrEqual(54);
    expect(primaria).toBeLessThanOrEqual(58);
  });

  test('sobrevive à barra sendo recriada do zero (troca de modo do Frota)', async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => window.recriarBarra('inicio'));
    await page.waitForTimeout(200);
    let opacidade = await page.evaluate(() => document.querySelector('.recriavel-nav .luz-nav-svg')?.style.opacity);
    expect(opacidade).toBe('1');

    // Troca de modo: a barra INTEIRA é substituída por um <nav> novo
    // (outro nó, mesma classe) — luzNavMontar precisa religar sozinho.
    await page.evaluate(() => window.recriarBarra('dados'));
    await page.waitForTimeout(200);
    const dadosAtivo = await page.evaluate(() => {
      const svg = document.querySelector('.recriavel-nav .luz-nav-svg');
      const btn = document.querySelector('.recriavel-nav [data-tab="dados"]');
      const r = btn.getBoundingClientRect(), n = btn.closest('.recriavel-nav').getBoundingClientRect();
      const nucleo = document.querySelector('.recriavel-nav .luz-nav-nucleo');
      const cxAnel = +nucleo.getAttribute('x') + (+nucleo.getAttribute('width')) / 2;
      const cxBotao = r.left - n.left + r.width / 2;
      return { opacidade: svg.style.opacity, dist: Math.abs(cxAnel - cxBotao) };
    });
    expect(dadosAtivo.opacidade).toBe('1');
    expect(dadosAtivo.dist).toBeLessThan(2);

    // Limpa a barra (modo null, como montarBarraNav(null) no Frota) —
    // não pode sobrar observer nem erro no console.
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.evaluate(() => window.limparBarraRecriavel());
    await page.waitForTimeout(100);
    expect(erros).toEqual([]);
  });

});
