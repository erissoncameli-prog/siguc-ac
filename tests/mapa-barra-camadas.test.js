// ── Mapa das UCs · barra de camadas fixa no topo do mapa ──
// Executar: npx playwright test tests/mapa-barra-camadas.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html), mesmo stub de tests/mapa-areas-aparencia.test.js.
// A barra flutuava (arrastável, posição salva) e quebrava em 2–3 linhas; agora
// é uma faixa só, colada em cima do mapa, com a largura do mapa, e rola de lado
// quando as abas não cabem. Trava: posição (topo do mapa, linha própria, não o
// cobre), uma linha, setas só do lado que tem aba escondida, última aba
// alcançável com o menu dentro da tela, página sem rolagem lateral, posição
// antiga ignorada — nas duas apresentações (normal e tela cheia).

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const VENDOR = path.join(__dirname, 'fixtures', 'vendor');

async function abrir(page, largura, altura, { posAntiga } = {}) {
  await page.setViewportSize({ width: largura, height: altura });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(pos => {
    if (pos) try { localStorage.setItem('siguc_lb_pos', JSON.stringify(pos)); } catch (e) {}
    const mk = pend => { const f = function () {}; const p = new Proxy(f, { get(t, k) { if (k === 'then') return pend ? () => {} : r => r({ data: null, error: null }); if (k === 'auth') return mk(true); return mk(pend) }, apply() { return p } }); return p };
    window.supabase = { createClient: () => mk(false) };
  }, posAntiga || null);
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await page.route('**/*.tile.openstreetmap.org/**', r => r.abort());
  await page.route('**/mt*.google.com/**', r => r.abort());
  await page.route('**/unpkg.com/**', r => r.abort());
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.css'), contentType: 'text/css' }));
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof renderPagina === 'function' && typeof L !== 'undefined');
  await page.evaluate(() => {
    appState.perfil = 'super_admin'; appState.usuario = { id: 'u1', nome_completo: 'Teste' };
    document.getElementById('app').innerHTML = gerarLayout('Mapa das UCs', 'mapa') + renderPagina() + '</div></div></div>';
    if (!L.Control.MiniMap) L.Control.MiniMap = L.Control.extend({ onAdd() { return L.DomUtil.create('div') } });
    if (!L.markerClusterGroup) L.markerClusterGroup = () => L.layerGroup();
    iniciarMapa();
  });
  await page.waitForFunction(() => typeof mapaL !== 'undefined' && mapaL);
}

const medir = page => page.evaluate(() => {
  const r = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } };
  const tabs = [...document.querySelectorAll('.mlb-tab')].map(r);
  const fx = document.getElementById('mlb-tabs');
  return {
    barra: r(document.querySelector('#mapa-layerbar .mlb-trilho')),
    mapa: r(document.getElementById('mapa')),
    tops: [...new Set(tabs.map(t => Math.round(t.t)))],
    cabe: fx.scrollWidth <= fx.clientWidth,
    esq: !document.getElementById('mlb-seta-esq').hidden,
    dir: !document.getElementById('mlb-seta-dir').hidden,
    rolaPagina: document.documentElement.scrollWidth > window.innerWidth + 1,
    posicao: getComputedStyle(document.getElementById('mapa-layerbar')).position,
  };
});

for (const [largura, altura] of [[1366, 768], [768, 1000], [390, 844]]) {
  for (const imersivo of [false, true]) {
    test(`${largura}px ${imersivo ? 'tela cheia' : 'normal'}: faixa única no topo do mapa, rola de lado`, async ({ page }) => {
      await abrir(page, largura, altura);
      if (imersivo) { await page.evaluate(() => entrarTelaCheia()); await page.waitForTimeout(350); }
      const m = await medir(page);
      expect(m.posicao, 'barra não flutua').toBe('relative');
      expect(m.tops.length, 'uma linha só').toBe(1);
      expect(m.barra.b, 'barra acima do mapa, sem cobri-lo').toBeLessThanOrEqual(m.mapa.t + 0.5);
      expect(m.mapa.t - m.barra.b, 'colada no mapa').toBeLessThan(16);
      expect(m.barra.l, 'começa na borda do mapa').toBeGreaterThanOrEqual(m.mapa.l - 1);
      if (!imersivo) expect(Math.abs(m.barra.r - m.mapa.r), 'largura do mapa').toBeLessThan(1.5);
      expect(m.rolaPagina, 'página sem rolagem lateral').toBe(false);
      expect(m.esq, 'no início, sem seta para trás').toBe(false);
      expect(m.dir, 'seta para frente só quando há aba escondida').toBe(!m.cabe);
      if (imersivo) {
        // ações da tela cheia visíveis e sem sobrepor a faixa
        const fs = await page.locator('.mapa-fs-controls').boundingBox();
        expect(fs).not.toBeNull();
        if (largura > 768) expect(fs.x, 'Exibição/Sair à direita da faixa').toBeGreaterThanOrEqual(m.barra.r - 0.5);
      }
      // a última aba é alcançável e o menu dela abre dentro da tela
      if (!m.cabe) { await page.click('#mlb-seta-dir'); await page.waitForTimeout(50); }
      await page.click('#mlb-btn-acre');
      const ab = await page.locator('#mlb-btn-acre').boundingBox();
      const vista = await page.locator('#mlb-tabs').boundingBox();
      expect(ab.x + ab.width, 'aba inteira à vista').toBeLessThanOrEqual(vista.x + vista.width + 1);
      const dd = await page.locator('#mlb-dropdown').boundingBox();
      expect(dd.x, 'menu dentro da tela (esq)').toBeGreaterThanOrEqual(-0.5);
      expect(dd.x + dd.width, 'menu dentro da tela (dir)').toBeLessThanOrEqual(largura + 0.5);
      expect(dd.y, 'menu logo abaixo da faixa').toBeGreaterThanOrEqual(m.barra.b - 1);
      if (!m.cabe) {
        const m2 = await medir(page);
        expect(m2.esq, 'rolada até o fim: seta para trás aparece').toBe(true);
        expect(m2.dir, 'no fim: sem seta para frente').toBe(false);
      }
    });
  }
}

test('menu abre colado na aba clicada; a 1ª aba abre na borda esquerda', async ({ page }) => {
  await abrir(page, 1366, 768);
  await page.click('#mlb-btn-veg');
  const dd = await page.locator('#mlb-dropdown').boundingBox();
  const lb = await page.locator('#mapa-layerbar').boundingBox();
  const t1 = await page.locator('#mlb-btn-veg').boundingBox();
  expect(Math.abs(dd.x - t1.x), 'menu começa na 1ª aba').toBeLessThan(1);
  expect(dd.x - lb.x).toBeLessThan(8);
  await page.click('#mlb-btn-alertas');
  const tab = await page.locator('#mlb-btn-alertas').boundingBox();
  const dd2 = await page.locator('#mlb-dropdown').boundingBox();
  expect(Math.abs(dd2.x - tab.x) < 1 || dd2.x + dd2.width >= lb.x + lb.width - 1, 'alinhado à aba ou à direita').toBe(true);
});

test('roda do mouse rola a faixa de lado e o Tab traz a aba à vista', async ({ page }) => {
  await abrir(page, 390, 844);
  const antes = await page.evaluate(() => document.getElementById('mlb-tabs').scrollLeft);
  await page.locator('#mlb-tabs').hover();
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(a => document.getElementById('mlb-tabs').scrollLeft > a, antes);
  await page.evaluate(() => { document.getElementById('mlb-tabs').scrollLeft = 0; });
  await page.focus('#mlb-btn-mun');
  const ab = await page.locator('#mlb-btn-mun').boundingBox();
  const vista = await page.locator('#mlb-tabs').boundingBox();
  expect(ab.x + ab.width).toBeLessThanOrEqual(vista.x + vista.width + 1);
});

test('posição antiga salva (de quando flutuava) é ignorada e apagada; sem alça de arrasto', async ({ page }) => {
  await abrir(page, 1366, 768, { posAntiga: { x: 700, y: 500 } });
  const m = await medir(page);
  expect(m.posicao).toBe('relative');
  expect(m.barra.b).toBeLessThanOrEqual(m.mapa.t + 0.5);
  expect(await page.evaluate(() => localStorage.getItem('siguc_lb_pos'))).toBeNull();
  expect(await page.locator('#lb-drag-grip').count()).toBe(0);
  expect(await page.evaluate(() => 'lb_pos' in _prefsCapturar())).toBe(false);
});

test('abas sem emoji: ícone SVG em todas', async ({ page }) => {
  await abrir(page, 1366, 768);
  const r = await page.evaluate(() => [...document.querySelectorAll('.mlb-tab')].map(t => ({ svg: !!t.querySelector('svg.bico'), emoji: /\p{Extended_Pictographic}/u.test(t.textContent) })));
  expect(r.length).toBe(11);
  for (const t of r) { expect(t.svg).toBe(true); expect(t.emoji).toBe(false); }
});
