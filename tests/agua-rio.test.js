// ── SIGUC Qualidade da Água · rio, toque na água e emblema ───────
// Executar: npx playwright test tests/agua-rio.test.js
//
// Guarda de js/agua-rio.js nas 4 telas com .lock-screen do app de campo
// e do emblema do app (telas de bloqueio + faixa institucional da Home).
// Mesmo molde dos outros guardas de app (tests/agua-app-fluxo.test.js):
// página real contra servidor estático local, sem depender de rede.
//
// A verificação do desenho é por PIXEL do próprio canvas (getImageData),
// não por screenshot — mesma lição de tests/mapa-telacheia.test.js: o
// layout pode reportar tudo certo enquanto nada foi pintado. Aqui há um
// motivo extra para ler o canvas em vez da tela: a vinheta do CSS fica
// POR CIMA do rio, então um screenshot mede vinheta + rio misturados.
//
// O canal alpha é a métrica: o canvas nasce transparente e o rio pinta
// com 'lighter', então alpha acumulado = quanto foi desenhado ali.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

// Mesmo contorno do binário documentado nos outros testes deste projeto.
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}
// O rio se desliga sozinho com "reduzir movimento"; estes testes medem o
// comportamento animado, então fixa a preferência em vez de torcer.
test.use({ reducedMotion: 'no-preference' });

async function abrirApp(page) {
  const erros = [];
  page.on('pageerror', e => erros.push(String(e)));
  page.on('console', msg => { if (msg.type() === 'error') erros.push(msg.text()); });
  await page.goto(`${BASE}/pages/agua-app.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
  return erros;
}

// Mesmo filtro de tests/agua-app-fluxo.test.js: o ambiente de execução
// bloqueia CDN/Supabase, e o servidor estático não manda o header
// Service-Worker-Allowed que só existe no vercel.json de produção — nada
// disso é erro do app.
function errosDoApp(erros) {
  return erros.filter(e =>
    !/cdn\.jsdelivr|supabase\.co|Failed to load resource|fonts\.googleapis|ERR_/i.test(e)
    && !/not under the max scope allowed/i.test(e));
}

// Soma do alpha pintado numa caixa do canvas, em coordenadas CSS da tela.
async function alphaNaCaixa(page, seletorTela, cx, cy, lado) {
  return page.evaluate(({ seletorTela, cx, cy, lado }) => {
    const tela = document.querySelector(seletorTela);
    const cv = tela.querySelector('canvas.lock-rio');
    if (!cv || !cv.width) return -1;
    const r = tela.getBoundingClientRect();
    const esc = cv.width / r.width;              // backing store ÷ CSS px
    const x = Math.max(0, Math.round((cx - lado / 2) * esc));
    const y = Math.max(0, Math.round((cy - lado / 2) * esc));
    const w = Math.min(Math.round(lado * esc), cv.width - x);
    const h = Math.min(Math.round(lado * esc), cv.height - y);
    if (w <= 0 || h <= 0) return -1;
    const d = cv.getContext('2d').getImageData(x, y, w, h).data;
    let soma = 0;
    for (let i = 3; i < d.length; i += 4) soma += d[i];
    return soma;
  }, { seletorTela, cx, cy, lado });
}

test.describe('Rio de fundo das telas de bloqueio', () => {

  test('o emblema do app carrega (não é imagem quebrada)', async ({ page }) => {
    const erros = await abrirApp(page);

    // naturalWidth só é > 0 quando o arquivo realmente veio — pega o
    // caminho errado, que a olho nu some sem erro nenhum.
    const imgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.lock-screen img.lock-mascote')).map(i => ({
        src: i.getAttribute('src'),
        ok: i.complete && i.naturalWidth > 0,
      })));

    expect(imgs.length, 'as 4 telas de bloqueio têm emblema').toBe(4);
    for (const i of imgs) expect(i.ok, `emblema carregou: ${i.src}`).toBe(true);
    // A gota plana antiga não pode ter sobrado em nenhuma tela.
    expect(await page.locator('.lock-screen svg.lock-mascote').count()).toBe(0);
    expect(errosDoApp(erros)).toEqual([]);
  });

  test('o rio pinta de verdade e a correnteza avança', async ({ page }) => {
    await abrirApp(page);

    const cv = page.locator('#tela-login canvas.lock-rio');
    await expect(cv).toHaveCount(1);

    // Atrás de tudo e sem roubar toque das teclas.
    const estilo = await cv.evaluate(el => {
      const s = getComputedStyle(el);
      return { z: s.zIndex, pe: s.pointerEvents, pos: s.position };
    });
    expect(estilo.pe).toBe('none');
    expect(estilo.z).toBe('0');
    expect(estilo.pos).toBe('absolute');

    // Vinheta e conteúdo têm de ficar ACIMA do rio, nessa ordem.
    const camadas = await page.evaluate(() => {
      const t = document.querySelector('#tela-login');
      return {
        vinheta: getComputedStyle(t, '::after').zIndex,
        conteudo: getComputedStyle(t.querySelector('.lock-logo')).zIndex,
      };
    });
    expect(Number(camadas.vinheta)).toBeGreaterThan(0);
    expect(Number(camadas.conteudo)).toBeGreaterThan(Number(camadas.vinheta));

    // Pintou alguma coisa.
    await page.waitForTimeout(700);
    const meio = await page.evaluate(() => {
      const r = document.querySelector('#tela-login').getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    const pintado = await alphaNaCaixa(page, '#tela-login', meio.w / 2, meio.h / 2, 120);
    expect(pintado, 'o rio pintou pixels no centro da tela').toBeGreaterThan(0);

    // E MUDA — rio parado não é rio. Duas leituras separadas no tempo
    // não podem bater exatamente.
    const a1 = await page.evaluate(() => {
      const cv = document.querySelector('#tela-login canvas.lock-rio');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i];
      return s;
    });
    await page.waitForTimeout(450);
    const a2 = await page.evaluate(() => {
      const cv = document.querySelector('#tela-login canvas.lock-rio');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i];
      return s;
    });
    expect(a1).toBeGreaterThan(0);
    expect(a2).not.toBe(a1);
  });

  test('tocar a tela levanta onda no ponto do toque', async ({ page }) => {
    await abrirApp(page);
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => {
      const b = document.querySelector('#tela-login').getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    // Longe do centro (onde a correnteza é mais forte e ruidosa) e longe
    // das bordas: o contraste do toque fica evidente.
    const cx = r.w * 0.28, cy = r.h * 0.62;

    const antes = await alphaNaCaixa(page, '#tela-login', cx, cy, 70);

    await page.mouse.move(r.x + cx, r.y + cy);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(70);   // dentro do clarão (260ms) do toque

    const depois = await alphaNaCaixa(page, '#tela-login', cx, cy, 70);

    // O clarão + respingos pintam um disco cheio; o rio sozinho só passa
    // fios finos. A diferença é de ordem de grandeza, não de ruído.
    expect(depois, 'o toque acendeu a água onde o dedo encostou')
      .toBeGreaterThan(antes * 1.5 + 1000);
  });

  test('o canvas não rouba o toque das teclas do PIN', async ({ page }) => {
    const erros = await abrirApp(page);

    await page.evaluate(() => mostrarTela('tela-config-pin'));
    await page.locator('#tela-config-pin').waitFor({ state: 'visible' });
    // O rio da tela recém-exibida precisa subir sozinho.
    await expect(page.locator('#tela-config-pin canvas.lock-rio')).toHaveCount(1);

    await page.locator('#tela-config-pin .pin-key[data-v="7"]').click();
    await page.locator('#tela-config-pin .pin-key[data-v="4"]').click();

    const marcados = await page.locator('#tela-config-pin .pin-dot.ativo').count();
    expect(marcados, 'os dois dígitos chegaram ao teclado').toBe(2);
    expect(errosDoApp(erros)).toEqual([]);
  });

  test('tela escondida não anima (bateria do aparelho de campo)', async ({ page }) => {
    await abrirApp(page);
    await page.waitForTimeout(800);

    // Só #tela-login está visível no boot. As outras 3 não podem ter
    // pintado um pixel — senão são 4 rios rodando ao mesmo tempo.
    const paradas = await page.evaluate(() =>
      ['#tela-trocar-senha', '#tela-bloqueio', '#tela-config-pin'].map(sel => {
        const cv = document.querySelector(sel + ' canvas.lock-rio');
        if (!cv) return { sel, alpha: -1 };
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i];
        return { sel, alpha: s };
      }));

    for (const p of paradas) {
      expect(p.alpha, `${p.sel} não pintou enquanto escondida`).toBe(0);
    }
  });

  test('emblema da Home fica centrado entre as logos e abaixo da faixa', async ({ page }) => {
    await abrirApp(page);
    await page.evaluate(() => mostrarTela('tela-home'));
    await page.locator('#tela-home').waitFor({ state: 'visible' });

    const em = page.locator('#tela-home .faixa-mascote');
    await expect(em).toHaveCount(1);
    expect(await em.evaluate(i => i.complete && i.naturalWidth > 0),
      'o emblema da faixa carregou').toBe(true);

    // Entre as duas logos = coluna do meio da grade, centrado na faixa.
    const cx = await page.evaluate(() => {
      const e = document.querySelector('#tela-home .faixa-mascote').getBoundingClientRect();
      const f = document.querySelector('#tela-home .faixa-inst').getBoundingClientRect();
      return {
        centroEmblema: e.x + e.width / 2,
        centroFaixa: f.x + f.width / 2,
        transborda: (e.y + e.height) - (f.y + f.height),
      };
    });
    expect(Math.abs(cx.centroEmblema - cx.centroFaixa),
      'centrado na faixa').toBeLessThan(2);
    // "Um pouco abaixo": tem de vazar para fora da faixa, sem se soltar dela.
    expect(cx.transborda).toBeGreaterThan(10);
    expect(cx.transborda).toBeLessThan(45);
  });

  test('a animação do emblema não descentra (armadilha do translateX)', async ({ page }) => {
    await abrirApp(page);
    await page.evaluate(() => mostrarTela('tela-home'));
    await page.locator('#tela-home').waitFor({ state: 'visible' });

    // O emblema é centrado por `left:50%` + `translateX(-50%)`. Um keyframe
    // que esqueça o translateX joga a arte meia largura para a direita no
    // meio do ciclo — some do lugar e ninguém liga o defeito à animação.
    // Amostra um ciclo inteiro (4,6 s) e cobra o centro em TODOS os quadros.
    const desvios = [];
    for (let i = 0; i < 13; i++) {
      desvios.push(await page.evaluate(() => {
        const e = document.querySelector('#tela-home .faixa-mascote').getBoundingClientRect();
        const f = document.querySelector('#tela-home .faixa-inst').getBoundingClientRect();
        return Math.abs((e.x + e.width / 2) - (f.x + f.width / 2));
      }));
      await page.waitForTimeout(400);
    }
    const pior = Math.max(...desvios);
    expect(pior, `maior desvio do centro no ciclo: ${pior.toFixed(2)}px`).toBeLessThan(2);

    // E precisa estar de fato animando (duas animações: boiar + halo).
    const anim = await page.locator('#tela-home .faixa-mascote')
      .evaluate(el => getComputedStyle(el).animationName);
    expect(anim).toContain('agua-emblema-boia');
    expect(anim).toContain('agua-emblema-halo');
  });
});
