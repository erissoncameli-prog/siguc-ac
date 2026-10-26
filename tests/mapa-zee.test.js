// ── Mapa das UCs · ZEE do Acre (js/mapa-zee.js) ───────────────────────
// Executar: npx playwright test tests/mapa-zee.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html), banco falso. O manifesto e o arquivo do
// Mapa de Gestão são servidos por stub (os reais vêm de scripts/zee_acre.py);
// a lista de documentos é a REAL (data/zee/documentos.json). Trava:
// - sem o arquivo vetorial, a aba DIZ isso, não deixa ligar e entrega os
//   documentos para baixar (links públicos, nova aba, sem referrer);
// - pane entre o Meio Físico e as camadas vetoriais (UC por cima);
// - cor por zona (Okabe-Ito) e por subzona (tons da cor da zona);
// - popup com situação legal, escala e o aviso de zoneamento regional;
// - Fase II e Fase III nunca juntas no mapa.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
test.use({ viewport: { width: 1366, height: 768 } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const VENDOR = path.join(__dirname, 'fixtures', 'vendor');
const DOCJ = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'zee', 'documentos.json'), 'utf8'));
const DOCS = [DOCJ.acervo, ...DOCJ.grupos.flatMap(g => g.documentos)];

const quad = (x, y, d) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
const Z1 = 'Zona 1 — Consolidação de sistemas de produção sustentáveis';
const Z2 = 'Zona 2 — Uso sustentável dos recursos naturais e proteção ambiental';
const FASE2 = { type: 'FeatureCollection', fonte: 'SEMA-AC — ZEE Fase II, Mapa de Gestão Territorial', escala: '1:250.000', features: [
  { type: 'Feature', geometry: quad(-70.0, -10.0, 0.2), properties: { zona_cod: '1', zona: Z1, subzona: '1.1', subzona_nome: 'Alto potencial social', diretriz: 'Consolidar a produção agropecuária', area_ha: 4500 } },
  { type: 'Feature', geometry: quad(-69.7, -10.0, 0.2), properties: { zona_cod: '1', zona: Z1, subzona: '1.2', subzona_nome: 'Médio potencial social', area_ha: 4400 } },
  { type: 'Feature', geometry: quad(-69.4, -10.0, 0.2), properties: { zona_cod: '2', zona: Z2, subzona: '2.1', subzona_nome: 'UCs de proteção integral', area_ha: 4300 } },
] };
const FASE3 = { type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: quad(-70.0, -9.6, 0.2), properties: { zona_cod: '3', zona: 'Zona 3 — Áreas prioritárias para o ordenamento territorial', subzona: '3.1' } },
] };
const MANIFESTO = { camadas: {
  fase2_gestao: { arquivo: 'fase2_gestao.geojson', fonte: FASE2.fonte, escala: '1:250.000', gerado_em: '2026-10-25', feicoes: 3, subzonas: 3 },
  fase3_gestao: { arquivo: 'fase3_gestao.geojson', fonte: 'SEMA-AC — ZEE Fase III', escala: null, gerado_em: '2026-10-25', feicoes: 1, subzonas: 1 },
} };

async function abrir(page, { manifesto = MANIFESTO, geojsonStatus = 200, reais = false } = {}) {
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
  // reais = os arquivos do repositório (data/zee/), servidos pelo servidor estático
  if (!reais) await page.route('**/data/zee/manifesto.json', r => { pedidos.push('manifesto'); manifesto ? r.fulfill({ json: manifesto }) : r.fulfill({ status: 404, body: '' }) });
  if (!reais) await page.route('**/data/zee/*.geojson', r => {
    const u = new URL(r.request().url()).pathname; pedidos.push(u);
    if (geojsonStatus !== 200) return r.fulfill({ status: geojsonStatus, body: '' });
    r.fulfill({ json: u.endsWith('/fase3_gestao.geojson') ? FASE3 : FASE2 });
  });
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof renderPagina === 'function' && typeof L !== 'undefined' && typeof zeeMontar === 'function');
  await page.evaluate(() => {
    appState.perfil = 'super_admin'; appState.usuario = { id: 'u1', nome_completo: 'Teste' }; appState.permissoes = {};
    document.getElementById('app').innerHTML = gerarLayout('Mapa das UCs', 'mapa') + renderPagina() + '</div></div></div>';
    if (!L.Control.MiniMap) L.Control.MiniMap = L.Control.extend({ onAdd() { return L.DomUtil.create('div') } });
    if (!L.markerClusterGroup) L.markerClusterGroup = () => L.layerGroup();
    iniciarMapa();
  });
  return pedidos;
}

async function abrirAba(page) {
  await page.click('#mlb-btn-zee');
  await expect(page.locator('[data-zee-camada]')).toHaveCount(2);
  await expect(page.locator('#zee-docs .zee-doc')).toHaveCount(DOCS.length);
  await expect(page.locator('#zee-docs details.zee-grupo')).toHaveCount(DOCJ.grupos.length);
}

async function ligar(page, id) {
  await page.locator(`[data-zee-camada="${id}"] [data-zee-acao="ligar"]`).check();
  await page.waitForFunction(i => zeeAtiva() === i, id);
}

test('sem o arquivo vetorial: aviso, nada para ligar, documentos para baixar', async ({ page }) => {
  const pedidos = await abrir(page, { manifesto: null });
  await abrirAba(page);
  await expect(page.locator('.zee-aviso')).toContainText('ainda não foi recebido da SEMA');
  for (const id of ['fase2_gestao', 'fase3_gestao']) {
    await expect(page.locator(`[data-zee-camada="${id}"] [data-zee-acao="ligar"]`)).toBeDisabled();
    await expect(page.locator(`[data-zee-camada="${id}"] .zee-status`)).toHaveText('Arquivo ainda não recebido.');
  }
  // situação legal aparece mesmo sem dado: só a Fase II tem lei
  await expect(page.locator('[data-zee-camada="fase2_gestao"] .zee-sit')).toContainText('Lei Estadual nº 1.904');
  await expect(page.locator('[data-zee-camada="fase3_gestao"] .zee-sit')).toContainText('sem lei estadual');
  const links = await page.locator('#zee-docs a').evaluateAll(as => as.map(a => ({ href: a.href, alvo: a.target, rel: a.rel })));
  expect(links.map(l => l.href)).toEqual(DOCS.map(d => d.url));
  expect(links.every(l => l.alvo === '_blank' && /noopener/.test(l.rel) && /noreferrer/.test(l.rel))).toBe(true);
  expect(links[0].href).toBe('https://drive.google.com/drive/folders/1K3MH1K6fenD7_e33EH1biwRS_ykU2RWa');
  // a lei do ZEE está entre os documentos, no site oficial da SEMA
  expect(links.map(l => l.href)).toContain('https://sema.ac.gov.br/wp-content/uploads/2025/05/Lei_n._1.904_de_5_de_junho_de_2007_Lei_do_ZEE.pdf');
  // só endereço oficial: site da SEMA ou o Drive da SEMA
  expect(links.every(l => /^https:\/\/(sema\.ac\.gov\.br|drive\.google\.com)\//.test(l.href))).toBe(true);
  // grupos nascem recolhidos e abrem no clique
  await expect(page.locator('#zee-docs details.zee-grupo[open]')).toHaveCount(0);
  await page.locator('#zee-docs details.zee-grupo summary').first().click();
  await expect(page.locator('#zee-docs details.zee-grupo').first().locator('a').first()).toBeVisible();
  // nenhum geojson baixado — e a barra/legenda não ganham nada
  expect(pedidos.filter(p => p !== 'manifesto')).toEqual([]);
  await expect(page.locator('#zee-count-badge')).toBeHidden();
});

test('ligar a Fase II: cor por zona, pane abaixo das UCs, legenda e contador', async ({ page }) => {
  const pedidos = await abrir(page);
  // nada é baixado antes de ligar
  expect(pedidos.filter(p => p !== 'manifesto')).toEqual([]);
  await abrirAba(page);
  await ligar(page, 'fase2_gestao');
  expect(pedidos).toContain('/data/zee/fase2_gestao.geojson');
  const r = await page.evaluate(() => {
    const lyr = _zee.layer.getLayers()
    return { cores: lyr.map(l => l.options.fillColor), pane: lyr[0].options.pane,
      z: ['meioFisicoPane', 'zeePane', 'overlayPane'].map(p => Number(getComputedStyle(mapaL.getPane(p)).zIndex)) }
  });
  expect(r.pane).toBe('zeePane');
  expect(r.cores).toEqual(['#E69F00', '#E69F00', '#009E73']); // zona 1, zona 1, zona 2
  expect(r.z[0]).toBeLessThan(r.z[1]);
  expect(r.z[1]).toBeLessThan(r.z[2]);
  const leg = await page.evaluate(() => document.querySelector('.cart-legenda')?.innerText || '');
  expect(leg).toContain(`ZEE Fase II — ${Z1}`);
  expect(leg).toContain(`ZEE Fase II — ${Z2}`);
  await expect(page.locator('#zee-count-badge')).toHaveText('1');
  await expect(page.locator('[data-zee-camada="fase2_gestao"] .zee-status')).toHaveText('3 polígonos');
});

test('popup: subzona como título, diretriz, situação legal, escala e aviso', async ({ page }) => {
  await abrir(page);
  await abrirAba(page);
  await ligar(page, 'fase2_gestao');
  await page.evaluate(() => _zee.layer.getLayers()[0].openPopup());
  const t = await page.locator('.leaflet-popup-content').last().innerText();
  expect(t).toMatch(/subzona 1\.1 — alto potencial social/i);
  expect(t).toContain('Consolidar a produção agropecuária');
  expect(t).toContain('Em vigor — Lei Estadual nº 1.904');
  expect(t).toContain('escala 1:250.000');
  expect(t).toContain('não substitui a análise do imóvel');
  expect(t).not.toContain('zona_cod');
  expect(t).not.toContain('_titulo');
});

test('colorir por subzona: tons da cor da zona, legenda por subzona, preferência salva', async ({ page }) => {
  await abrir(page);
  await abrirAba(page);
  await ligar(page, 'fase2_gestao');
  await page.locator('[data-zee-acao="colorir"]').selectOption('subzona');
  const cores = await page.evaluate(() => _zee.layer.getLayers().map(l => l.options.fillColor));
  expect(new Set(cores).size).toBe(3);
  expect(cores[2]).toBe('#009E73'); // única subzona da zona 2 = a própria cor da zona
  // 1.1 e 1.2 são tons do laranja da zona 1 (canal vermelho domina)
  for (const c of cores.slice(0, 2)) {
    const [r, g, b] = [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
    expect(r).toBeGreaterThan(g); expect(g).toBeGreaterThan(b);
  }
  const leg = await page.evaluate(() => zeeItensLegenda().map(i => i.label));
  expect(leg).toEqual(['ZEE Fase II — Subzona 1.1 (Alto potencial social)', 'ZEE Fase II — Subzona 1.2 (Médio potencial social)',
    'ZEE Fase II — Subzona 2.1 (UCs de proteção integral)']);
  await page.evaluate(() => { const i = document.querySelector('[data-zee-acao="opacidade"]'); i.value = '70'; i.dispatchEvent(new Event('input', { bubbles: true })) });
  expect(await page.evaluate(() => _zee.layer.getLayers()[0].options.fillOpacity)).toBe(0.7);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('siguc_zee')))).toEqual({ ativa: 'fase2_gestao', colorir: 'subzona', opacidade: 0.7 });
});

test('arquivo REAL da Fase II (SEMA, 26/10/2026): 4 zonas, sem subzona — só "colorir por zona"', async ({ page }) => {
  await abrir(page, { reais: true });
  await abrirAba(page);
  await expect(page.locator('.zee-aviso')).toHaveCount(0);
  await expect(page.locator('[data-zee-camada="fase3_gestao"] [data-zee-acao="ligar"]')).toBeDisabled();
  // sem subzona no arquivo, a opção de colorir por subzona não faz nada — não aparece
  await expect(page.locator('[data-zee-acao="colorir"]')).toHaveCount(0);
  await ligar(page, 'fase2_gestao');
  const zonas = await page.evaluate(() => _zee.layer.getLayers().map(l => [l.feature.properties.zona_cod, l.options.fillColor]));
  expect(zonas).toEqual([['1', '#E69F00'], ['2', '#009E73'], ['3', '#CC79A7'], ['4', '#0072B2']]);
  const leg = await page.evaluate(() => zeeItensLegenda().map(i => i.label));
  expect(leg).toHaveLength(4);
  expect(leg[3]).toMatch(/Zona 4 — Cidades florestais/);
});

test('Fase III liga e desliga a Fase II — nunca as duas no mapa', async ({ page }) => {
  await abrir(page);
  await abrirAba(page);
  await ligar(page, 'fase2_gestao');
  await ligar(page, 'fase3_gestao');
  await expect(page.locator('[data-zee-camada="fase2_gestao"] [data-zee-acao="ligar"]')).not.toBeChecked();
  const n = await page.evaluate(() => { let k = 0; mapaL.eachLayer(l => { if (l.options && l.options.pane === 'zeePane' && l.feature) k++ }); return k });
  expect(n).toBe(1); // só o polígono da Fase III
  await page.evaluate(() => _zee.layer.getLayers()[0].openPopup());
  const t = await page.locator('.leaflet-popup-content').last().innerText();
  expect(t).toContain('sem lei estadual que o institua');
  expect(t).toContain('escala não informada pela fonte');
  expect(t).not.toMatch(/escala 1:/);
  // desligar some do mapa e da legenda
  await page.locator('[data-zee-camada="fase3_gestao"] [data-zee-acao="ligar"]').uncheck();
  expect(await page.evaluate(() => zeeAtiva())).toBe(null);
  const leg = await page.evaluate(() => document.querySelector('.cart-legenda')?.innerText || '');
  expect(leg).not.toContain('ZEE');
});

test('arquivo listado no manifesto que falha: aviso e a caixa volta a desmarcada', async ({ page }) => {
  await abrir(page, { geojsonStatus: 404 });
  await abrirAba(page);
  await page.locator('[data-zee-camada="fase2_gestao"] [data-zee-acao="ligar"]').click();
  await expect(page.locator('[data-zee-camada="fase2_gestao"] .zee-status')).toHaveText('Não foi possível carregar o arquivo.');
  await expect(page.locator('[data-zee-camada="fase2_gestao"] [data-zee-acao="ligar"]')).not.toBeChecked();
  expect(await page.evaluate(() => zeeAtiva())).toBe(null);
});
