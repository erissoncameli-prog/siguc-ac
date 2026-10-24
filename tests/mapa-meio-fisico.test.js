// ── Mapa das UCs · Meio físico do IBGE (js/mapa-meio-fisico.js) ──
// Executar: npx playwright test tests/mapa-meio-fisico.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html), banco falso; o arquivo do tema é servido
// por stub (o real vem do workflow meio-fisico.yml). Trava:
// - nada é baixado antes de o tema ser ligado;
// - cor por atributo e legenda por classe (mesmas funções ccf* da Fase 3);
// - popup com rótulos amigáveis, fonte e escala, e o aviso de mapeamento
//   regional;
// - pane entre as imagens e as camadas vetoriais (UC por cima);
// - opacidade e "colorir por" mudam o desenho e ficam salvos.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
test.use({ viewport: { width: 1366, height: 768 } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const VENDOR = path.join(__dirname, 'fixtures', 'vendor');

const quad = (x, y, d) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
const PEDO = { type: 'FeatureCollection', fonte: 'IBGE — BDIA:pedo_area', escala: '1:250.000', features: [
  { type: 'Feature', geometry: quad(-70.0, -10.0, 0.2), properties: { legenda_2: 'Argissolos Vermelho-Amarelos', ordem: 'ARGISSOLOS', textura: 'média/argilosa' } },
  { type: 'Feature', geometry: quad(-69.7, -10.0, 0.2), properties: { legenda_2: 'Latossolos Amarelos', ordem: 'LATOSSOLOS', textura: 'argilosa' } },
  { type: 'Feature', geometry: quad(-69.4, -10.0, 0.2), properties: { legenda_2: 'Argissolos Vermelhos', ordem: 'ARGISSOLOS', textura: 'argilosa' } },
] };
const MASSAS = { type: 'FeatureCollection', fonte: 'ANA — SNIRH2016/Massa_dagua/MapServer/0', features: [
  { type: 'Feature', geometry: quad(-70.0, -9.6, 0.05), properties: { nmoriginal: 'Lagoa Sacado', detipomass: 'Natural', nuareaha: 3.2 } },
  { type: 'Feature', geometry: quad(-69.8, -9.6, 0.05), properties: { detipomass: 'Artificial', nmgenerico: 'Barragem', nuareaha: 412 } },
] };

async function abrir(page) {
  await page.addInitScript(() => {
    const mk = pend => { const f = function () {}; const p = new Proxy(f, { get(t, k) { if (k === 'then') return pend ? () => {} : r => r({ data: null, error: null }); if (k === 'auth') return mk(true); return mk(pend) }, apply() { return p } }); return p };
    window.supabase = { createClient: () => mk(false) };
  });
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await page.route('**/*.tile.openstreetmap.org/**', r => r.abort());
  await page.route('**/mt*.google.com/**', r => r.abort());
  await page.route('**/unpkg.com/**', r => r.abort());
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.css'), contentType: 'text/css' }));
  const pedidos = [];
  await page.route('**/data/meio_fisico/**', r => { const u = new URL(r.request().url()).pathname; pedidos.push(u); r.fulfill({ json: u.endsWith('/massas_dagua.geojson') ? MASSAS : PEDO }) });
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof renderPagina === 'function' && typeof L !== 'undefined' && typeof mfMontar === 'function');
  await page.evaluate(() => {
    appState.perfil = 'super_admin'; appState.usuario = { id: 'u1', nome_completo: 'Teste' }; appState.permissoes = {};
    document.getElementById('app').innerHTML = gerarLayout('Mapa das UCs', 'mapa') + renderPagina() + '</div></div></div>';
    if (!L.Control.MiniMap) L.Control.MiniMap = L.Control.extend({ onAdd() { return L.DomUtil.create('div') } });
    if (!L.markerClusterGroup) L.markerClusterGroup = () => L.layerGroup();
    iniciarMapa();
  });
  return pedidos;
}

async function ligarPedologia(page) {
  await page.click('#mlb-btn-meio');
  await expect(page.locator('[data-mf-tema]')).toHaveCount(7);
  await page.locator('[data-mf-tema="pedologia"] [data-mf-acao="ligar"]').check();
  await page.waitForFunction(() => mfAtivos().includes('pedologia'));
}

test('aba lista os 7 temas (IBGE e ANA) com fonte e escala; nada é baixado antes de ligar', async ({ page }) => {
  const pedidos = await abrir(page);
  await page.click('#mlb-btn-meio');
  const textos = await page.locator('[data-mf-tema] .mf-meta').allInnerTexts();
  expect(textos.length).toBe(7);
  expect(textos.filter(t => /IBGE/.test(t)).every(t => /1:/.test(t))).toBe(true);
  // a ANA não publica a escala: a tela diz isso, nunca inventa um número
  const ana = textos.filter(t => /ANA/.test(t));
  expect(ana.length).toBe(2);
  expect(ana.every(t => /escala não informada pelo serviço/.test(t) && !/1:/.test(t))).toBe(true);
  expect(pedidos).toEqual([]);
});

test('ligar pedologia: colore por ordem, legenda por classe, contador e pane abaixo das UCs', async ({ page }) => {
  const pedidos = await abrir(page);
  await ligarPedologia(page);
  expect(pedidos).toEqual(['/data/meio_fisico/pedologia.geojson']);
  const r = await page.evaluate(() => {
    const lyr = _mf.camadas.pedologia.layer.getLayers()
    return { cores: lyr.map(l => l.options.fillColor), pane: lyr[0].options.pane,
      z: ['tilePane', 'meioFisicoPane', 'overlayPane'].map(p => Number(getComputedStyle(mapaL.getPane(p)).zIndex)) }
  });
  expect(r.pane).toBe('meioFisicoPane');
  expect(r.cores[0]).toBe(r.cores[2]);       // os dois ARGISSOLOS
  expect(r.cores[0]).not.toBe(r.cores[1]);
  expect(r.z[0]).toBeLessThan(r.z[1]);
  expect(r.z[1]).toBeLessThan(r.z[2]);
  const leg = await page.evaluate(() => document.querySelector('.cart-legenda')?.innerText || '');
  expect(leg).toContain('Solos (pedologia) — ARGISSOLOS');
  expect(leg).toContain('Solos (pedologia) — LATOSSOLOS');
  await expect(page.locator('#meio-count-badge')).toHaveText('1');
  await expect(page.locator('[data-mf-tema="pedologia"] .mf-status')).toHaveText('3 polígonos');
});

test('popup com rótulos amigáveis, fonte, escala e aviso de mapeamento regional', async ({ page }) => {
  await abrir(page);
  await ligarPedologia(page);
  await page.evaluate(() => _mf.camadas.pedologia.layer.getLayers()[1].openPopup());
  const t = await page.locator('.leaflet-popup-content').last().innerText();
  expect(t).toMatch(/latossolos amarelos/i);  // o CSS do popup põe o título em maiúsculas
  expect(t).toContain('Ordem');
  expect(t).toContain('Textura');
  expect(t).not.toContain('legenda_2');
  expect(t).toContain('1:250.000');
  expect(t).toContain('não substitui levantamento de campo');
});

test('colorir por e opacidade mudam o desenho e ficam salvos', async ({ page }) => {
  await abrir(page);
  await ligarPedologia(page);
  await page.locator('[data-mf-tema="pedologia"] [data-mf-acao="colorir"]').selectOption('legenda_2');
  const cores = await page.evaluate(() => _mf.camadas.pedologia.layer.getLayers().map(l => l.options.fillColor));
  expect(new Set(cores).size).toBe(3);       // três classes detalhadas diferentes
  await page.evaluate(() => { const i = document.querySelector('[data-mf-tema="pedologia"] [data-mf-acao="opacidade"]'); i.value = '80'; i.dispatchEvent(new Event('input', { bubbles: true })) });
  expect(await page.evaluate(() => _mf.camadas.pedologia.layer.getLayers()[0].options.fillOpacity)).toBe(0.8);
  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('siguc_meio_fisico')));
  expect(pref).toEqual({ ativos: ['pedologia'], colorir: { pedologia: 'legenda_2' }, opacidade: { pedologia: 0.8 } });
  // desligar some do mapa e da legenda
  await page.locator('[data-mf-tema="pedologia"] [data-mf-acao="ligar"]').uncheck();
  expect(await page.evaluate(() => mfAtivos().length)).toBe(0);
  const leg = await page.evaluate(() => document.querySelector('.cart-legenda')?.innerText || '');
  expect(leg).not.toContain('pedologia');
});

test('arquivo que falha: aviso no tema e a caixa volta a desmarcada', async ({ page }) => {
  await abrir(page);
  await page.unroute('**/data/meio_fisico/**');
  await page.route('**/data/meio_fisico/**', r => r.fulfill({ status: 404, body: '' }));
  await page.click('#mlb-btn-meio');
  // click, não check(): com 404 o app desmarca a caixa antes de o check()
  // conferir o estado, e ele acusa "não mudou" (instabilidade real medida)
  await page.locator('[data-mf-tema="geologia"] [data-mf-acao="ligar"]').click();
  await expect(page.locator('[data-mf-tema="geologia"] .mf-status')).toHaveText('Não foi possível carregar o arquivo.');
  await expect(page.locator('[data-mf-tema="geologia"] [data-mf-acao="ligar"]')).not.toBeChecked();
});

test('massas d\'água da ANA: cor por tipo, popup sem escala inventada', async ({ page }) => {
  await abrir(page);
  await page.click('#mlb-btn-meio');
  await page.locator('[data-mf-tema="massas_dagua"] [data-mf-acao="ligar"]').check();
  await page.waitForFunction(() => mfAtivos().includes('massas_dagua'));
  await expect(page.locator('[data-mf-tema="massas_dagua"] .mf-status')).toHaveText('2 polígonos');
  const cores = await page.evaluate(() => _mf.camadas.massas_dagua.layer.getLayers().map(l => l.options.fillColor));
  expect(cores[0]).not.toBe(cores[1]);       // Natural × Artificial
  const leg = await page.evaluate(() => mfItensLegenda().map(i => i.label));
  expect(leg).toEqual(expect.arrayContaining(["Massas d'água — Natural", "Massas d'água — Artificial"]));
  await page.evaluate(() => _mf.camadas.massas_dagua.layer.getLayers()[0].openPopup());
  const t = await page.locator('.leaflet-popup-content').last().innerText();
  expect(t).toMatch(/lagoa sacado/i);
  expect(t).toContain('escala não informada pelo serviço');
  expect(t).not.toMatch(/escala 1:/);
});

test('massas d\'água por área: degradê em escala log com legenda em barra', async ({ page }) => {
  await abrir(page);
  await page.click('#mlb-btn-meio');
  await page.locator('[data-mf-tema="massas_dagua"] [data-mf-acao="ligar"]').check();
  await page.waitForFunction(() => mfAtivos().includes('massas_dagua'));
  await page.locator('[data-mf-tema="massas_dagua"] [data-mf-acao="colorir"]').selectOption('nuareaha');
  const cores = await page.evaluate(() => _mf.camadas.massas_dagua.layer.getLayers().map(l => l.options.fillColor));
  expect(cores).toEqual(['#440154', '#FDE725']);
  const leg = page.locator('.cart-legenda .cart-leg-degrade');
  await expect(leg).toContainText("Massas d'água — Área (cadastro ANA) (escala log)");
  await expect(leg.locator('.cart-leg-degrade-rot')).toHaveText(/^3\s*412$/);
});
