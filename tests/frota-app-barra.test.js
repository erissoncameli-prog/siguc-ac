// ── App Frota · barra inferior de navegação ──────────────────────
// Executar: npx playwright test tests/frota-app-barra.test.js
//
// Guarda contra uma regressão que já voltou três vezes: a barra
// inferior (.fm-pill-nav) sumia, "demorava a aparecer" e depois ficava
// sem responder ao toque.
//
// Causa: qualquer contêiner ANCESTRAL da barra com `transform` diferente
// de `none` vira containing block dos descendentes `position: fixed`
// (CSS Transforms L1). A barra deixava de se posicionar pela viewport e
// ia para o fim do documento — invisível nas abas que rolam, "voltando"
// só quando o usuário rolava até o fim, e com a área de toque
// desalinhada da área pintada. As animações de troca de tela
// (fwTransicaoTela + classes .fw-tela-*) deixavam justamente esse
// transform residual na .fm-shell, por causa do fill-mode `both`.
//
// Os testes abaixo reproduzem a condição exata (shell animada + aba com
// muito conteúdo) sem precisar de login: montam o shell e chamam as
// funções da própria página. Se alguém reintroduzir transform num
// ancestral da barra — ou o fill-mode `both` —, eles quebram.

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const MODOS = ['motorista', 'gestor', 'solicitante'];

// Abre a página e espera o boot ASSENTAR na tela de login. Sem isso há
// corrida: o boot é assíncrono e termina chamando mostrarLoginFrota(),
// que limpa #app — apagaria um shell montado antes da hora. Depois
// esconde o login, que fica no fluxo normal do documento (não é overlay)
// e somaria 100vh à altura da página.
async function abrirAppSemSessao(page) {
  await page.goto(`${BASE}/pages/frota-app.html`);
  await page.waitForFunction(() => typeof window.montarBarraNav === 'function', null, { timeout: 15_000 });
  await page.locator('#tela-login-frota').waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => { document.getElementById('tela-login-frota').hidden = true; });
}

// Monta o shell do modo, enche a aba de conteúdo alto (o que fazia a
// .fm-shell crescer muito além da viewport) e roda a animação de troca
// de tela que deixava o transform residual.
async function prepararModo(page, modo) {
  await abrirAppSemSessao(page);

  await page.evaluate((m) => {
    if (m === 'motorista') montarShellMotorista();
    else if (m === 'gestor') montarShellGestor();
    else montarShellSolicitante(false);

    // Conteúdo alto: é o cenário em que o bug aparecia (Dados,
    // Histórico, Config, Viagem, Solicitar). Abas curtas escondiam o
    // problema porque a .fm-shell ficava do tamanho da viewport.
    document.getElementById('fm-conteudo').innerHTML =
      '<div style="height:3000px;background:linear-gradient(#eee,#ccc)"></div>';

    // A animação de troca de modo — a que deixava transform pendurado.
    fwTransicaoTela(document.querySelector('.fm-shell'), 'fade');
  }, modo);

  // Espera a animação terminar (a mais longa é 320ms) e o listener de
  // animationend limpar a classe.
  await page.waitForTimeout(700);
}

for (const modo of MODOS) {
  test(`[${modo}] barra fica visível na viewport depois da animação de troca de modo`, async ({ page }) => {
    await prepararModo(page, modo);

    const nav = page.locator('.fm-pill-nav');
    await expect(nav).toBeVisible();

    const dentro = await page.evaluate(() => {
      const r = document.querySelector('.fm-pill-nav').getBoundingClientRect();
      return { bottom: r.bottom, top: r.top, altura: window.innerHeight };
    });
    // O sintoma "a barra sumiu" era exatamente isto: bottom lá pelos
    // 3000px, muito além da altura da janela.
    expect(dentro.bottom).toBeLessThanOrEqual(dentro.altura + 1);
    expect(dentro.top).toBeGreaterThan(0);
  });

  test(`[${modo}] nenhum ancestral da barra tem transform residual`, async ({ page }) => {
    await prepararModo(page, modo);

    const culpados = await page.evaluate(() => {
      const fora = [];
      let el = document.querySelector('.fm-pill-nav').parentElement;
      while (el && el !== document.documentElement) {
        const cs = getComputedStyle(el);
        // transform, filter e perspective têm todos o mesmo efeito de
        // criar containing block para descendentes fixed.
        if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none') {
          fora.push(`${el.tagName.toLowerCase()}.${el.className} → transform:${cs.transform} filter:${cs.filter}`);
        }
        el = el.parentElement;
      }
      return fora;
    });
    expect(culpados).toEqual([]);
  });

  test(`[${modo}] barra continua fixa na viewport ao rolar a página`, async ({ page }) => {
    await prepararModo(page, modo);

    const antes = await page.evaluate(() => document.querySelector('.fm-pill-nav').getBoundingClientRect().top);
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(200);
    const depois = await page.evaluate(() => document.querySelector('.fm-pill-nav').getBoundingClientRect().top);

    // Fixa na viewport = não se move ao rolar. Quando o bug estava
    // ativo a barra rolava junto com o conteúdo (virava absolute).
    expect(Math.abs(depois - antes)).toBeLessThanOrEqual(1);
  });

  test(`[${modo}] o toque nos botões da barra chega ao botão certo`, async ({ page }) => {
    await prepararModo(page, modo);

    // O sintoma "trava" era a barra aparecer pintada num lugar e a área
    // de toque estar noutro. O clique do Playwright faz hit-test de
    // verdade nas coordenadas do elemento, então ele reproduz isso.
    // As funções de aba são trocadas por espiãs porque as de verdade
    // renderizam a partir de dados que só existem com login.
    await page.evaluate(() => {
      window.__abaClicada = null;
      const espiao = aba => { window.__abaClicada = aba; };
      window.motoristaAba = espiao;
      window.gestorAba = espiao;
      window.solicitanteAba = espiao;
    });

    const botoes = page.locator('.fm-pill-btn');
    const total = await botoes.count();
    expect(total).toBeGreaterThan(2);

    // Testa o último botão (Config): fica na ponta da barra, onde o
    // desalinhamento aparecia primeiro.
    const ultimo = botoes.nth(total - 1);
    const esperado = await ultimo.getAttribute('data-tab');
    await ultimo.click({ timeout: 5000 });

    expect(await page.evaluate(() => window.__abaClicada)).toBe(esperado);
  });
}

// O shell provisório existe para que a barra e a faixa apareçam ANTES
// das consultas de perfil, que num sinal ruim demoram segundos.
test('shell provisório já traz a barra antes dos dados chegarem', async ({ page }) => {
  await abrirAppSemSessao(page);

  const comModoSalvo = await page.evaluate(() => {
    montarShellProvisorio('motorista');
    return {
      botoes: document.querySelectorAll('.fm-pill-btn').length,
      esqueletos: document.querySelectorAll('#fm-conteudo .fw-skeleton').length,
      // Abas desligadas enquanto não há dados para renderizar.
      habilitados: [...document.querySelectorAll('.fm-pill-btn')].filter(b => !b.disabled).length,
    };
  });
  expect(comModoSalvo.botoes).toBe(6);
  expect(comModoSalvo.esqueletos).toBeGreaterThan(0);
  expect(comModoSalvo.habilitados).toBe(0);

  // Primeiro acesso (sem modo salvo) não tem palpite: sem barra.
  await page.evaluate(() => montarShellProvisorio(null));
  await expect(page.locator('.fm-pill-nav')).toHaveCount(0);
});

// A barra vive fora de #app justamente para escapar das animações — o
// preço é que limpá-la não é automático. Se alguém esquecer o
// montarBarraNav(null) numa tela sem abas, ela fica flutuando por cima.
test('barra não aparece na tela de login (tela sem abas)', async ({ page }) => {
  await abrirAppSemSessao(page);
  await page.evaluate(() => { montarShellMotorista(); mostrarLoginFrota(); });
  await expect(page.locator('.fm-pill-nav')).toHaveCount(0);
});
