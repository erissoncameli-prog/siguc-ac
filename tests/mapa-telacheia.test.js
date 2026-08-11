// ── Mapa das UCs · painéis em tela cheia ─────────────────────────
// Executar: npx playwright test tests/mapa-telacheia.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual ao tests/frota-app-barra.test.js)
//
// POR QUE ESTE TESTE EXISTE: em tela cheia, TODOS os painéis do nível
// do <body> sumiam — CAR, PRODES, projeto de análise, análise do
// alerta, painel-resumo e até a barra de progresso. Eram DUAS causas
// independentes, e corrigir só uma não resolvia:
//
//  1. EMPILHAMENTO — .mapa-wrapper.imersivo tinha z-index 2000 e os
//     painéis vão de 600 a 800, então o wrapper pintava por cima. Isso
//     acontecia ANTES de qualquer fullscreen (por isso o sintoma
//     aparecia até no Safari do iPad, que não tem fullscreen nativo
//     fora de <video>).
//  2. TOP LAYER — requestFullscreen() era chamado no wrapper, o que o
//     promove à top layer, onde só ele e seus DESCENDENTES são
//     pintados. Um irmão não renderiza nem com z-index 99999.
//
// A verificação é por PIXEL de propósito: foi só medindo pixel que as
// duas causas apareceram separadas. `checkVisibility`, getBoundingClientRect
// e elementFromPoint reportam o painel como perfeitamente visível nos
// dois casos — eles descrevem o layout, não o que foi pintado.
//
// Não é preciso decodificar PNG: basta comparar o recorte de 1×1 do
// painel com o do fundo do mapa. Bytes iguais = o painel não pintou
// nada ali, ou seja, sumiu.

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

// Um pixel da tela, como Buffer PNG cru.
const pixel = (page, x, y) => page.screenshot({ clip: { x, y, width: 1, height: 1 } });

// A página só monta .mapa-wrapper depois do login Supabase. Onde não
// há sessão (CI sem rede, sandbox), injetamos o wrapper mínimo: o que
// este teste exercita é o CSS real do modo imersivo e as funções reais
// entrarTelaCheia/_setDrawer, não o conteúdo do mapa.
async function prepararMapa(page) {
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof window.entrarTelaCheia === 'function', null, { timeout: 20_000 });
  await page.evaluate(() => {
    if (!document.querySelector('.mapa-wrapper')) {
      const w = document.createElement('div');
      w.className = 'mapa-wrapper';
      w.innerHTML = '<div class="mapa-container" style="flex:1"><div id="mapa" style="height:100%"></div></div>';
      (document.getElementById('app') || document.body).appendChild(w);
    }
    // Fullscreen exige gesto do usuário; um botão real dá a ativação.
    if (!document.getElementById('__fsbtn')) {
      const b = document.createElement('button');
      b.id = '__fsbtn';
      b.textContent = 'fs';
      b.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99999';
      b.onclick = () => window.entrarTelaCheia();
      document.body.appendChild(b);
    }
  });
}

async function entrarImersivo(page) {
  await page.click('#__fsbtn');
  await page.waitForFunction(() => document.body.classList.contains('mapa-imersivo'), null, { timeout: 5_000 });
  await page.waitForTimeout(700); // animação mapa-fs-in (.28s) + fullscreen
}

test('painel-resumo continua PINTADO em tela cheia', async ({ page }) => {
  await prepararMapa(page);
  await page.evaluate(() => { window._alertasAtivo = false; window.abrirResumoAlertas(); });
  await page.waitForFunction(() => {
    const t = getComputedStyle(document.getElementById('resumo-panel')).transform;
    return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
  }, null, { timeout: 5_000 });

  await entrarImersivo(page);

  const { width, height } = page.viewportSize();
  const cx = Math.round(width - 120);          // dentro do painel (direita)
  const cy = Math.round(height / 2);
  const fundoX = Math.round(width * 0.25);     // área do mapa, longe do painel

  const noPainel = await pixel(page, cx, cy);
  const noFundo  = await pixel(page, fundoX, cy);

  // O painel é branco; o fundo imersivo é #0A1A0F. Se o painel tivesse
  // sumido, os dois recortes seriam idênticos.
  expect(noPainel.equals(noFundo),
    'o painel-resumo não pintou nada em tela cheia — voltou a ficar fora da top layer ou abaixo do wrapper').toBe(false);

  // E o painel segue aberto (não foi só um efeito de fechar sozinho).
  await expect(page.locator('#resumo-panel')).toHaveClass(/aberto/);
});

test('tela cheia é pedida na raiz do documento, não no wrapper', async ({ page }) => {
  await prepararMapa(page);
  await entrarImersivo(page);

  const alvo = await page.evaluate(() => {
    const el = document.fullscreenElement || document.webkitFullscreenElement;
    if (!el) return 'sem-fullscreen';           // navegador negou: só o imersivo CSS
    return el === document.documentElement ? 'html'
         : el.classList.contains('mapa-wrapper') ? 'wrapper' : (el.id || el.tagName);
  });
  // 'sem-fullscreen' é aceitável (headless/iOS podem negar); 'wrapper'
  // é o bug de volta — seria a top layer engolindo todos os painéis.
  expect(alvo, 'fullscreen pedido no wrapper enterra os painéis na top layer').not.toBe('wrapper');
});

test('wrapper imersivo não enterra a faixa de z-index dos painéis', async ({ page }) => {
  await prepararMapa(page);
  await entrarImersivo(page);

  const z = await page.evaluate(() => {
    const w = document.querySelector('.mapa-wrapper');
    const alvos = ['car-det-panel', 'zona-prodes-panel', 'malerta-panel', 'resumo-panel',
                   'car-cfg-overlay', 'car-consulta-overlay', 'proj-overlay', 'modal-nova-camada'];
    return {
      wrapper: parseInt(getComputedStyle(w).zIndex, 10),
      painefs: alvos.map(id => {
        const el = document.getElementById(id);
        return { id, z: el ? parseInt(getComputedStyle(el).zIndex, 10) : null };
      }).filter(x => x.z !== null && !Number.isNaN(x.z)),
    };
  });

  expect(z.painefs.length).toBeGreaterThan(4);
  for (const p of z.painefs) {
    expect(p.z, `${p.id} (z=${p.z}) precisa ficar acima do wrapper imersivo (z=${z.wrapper})`)
      .toBeGreaterThan(z.wrapper);
  }
});

test('no imersivo, resumo e drawer "Exibição" se alternam', async ({ page }) => {
  await prepararMapa(page);
  // O drawer só existe no layout real; onde ele não foi montado,
  // injeta a casca que _setDrawer manipula.
  await page.evaluate(() => {
    if (!document.querySelector('.mapa-painel-wrap')) {
      const d = document.createElement('div');
      d.className = 'mapa-painel-wrap';
      document.querySelector('.mapa-wrapper').appendChild(d);
    }
  });
  await entrarImersivo(page);

  await page.evaluate(() => { window._alertasAtivo = false; window.abrirResumoAlertas(); });
  await expect(page.locator('#resumo-panel')).toHaveClass(/aberto/);

  // Abrir o drawer fecha o resumo…
  await page.evaluate(() => window._setDrawer(true));
  await expect(page.locator('#resumo-panel')).not.toHaveClass(/aberto/);
  expect(await page.evaluate(() => document.querySelector('.mapa-painel-wrap').classList.contains('drawer-aberto'))).toBe(true);

  // …e reabrir o resumo fecha o drawer.
  await page.evaluate(() => window.abrirResumoAlertas());
  await expect(page.locator('#resumo-panel')).toHaveClass(/aberto/);
  expect(await page.evaluate(() => document.querySelector('.mapa-painel-wrap').classList.contains('drawer-aberto'))).toBe(false);

  // Fechar o resumo pela alternância NÃO grava "não quero mais ver".
  expect(await page.evaluate(() => localStorage.getItem('siguc_resumo_alertas'))).not.toBe('0');
});
