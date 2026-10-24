// ── Mapa das UCs · Minha localização (js/mapa-gps.js) ──
// Executar: npx playwright test tests/mapa-gps.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html), banco falso, posição simulada pelo próprio
// navegador (permissão + geolocation do Playwright). Trava:
// - ponto e círculo de precisão na posição recebida, coordenada em graus +
//   UTM e a UC em que o ponto está;
// - precisão ruim é avisada (no computador a posição vem da rede);
// - permissão negada vira texto no painel, sem ponto e sem exceção;
// - acompanhar move o ponto; desligar apaga tudo e para o acompanhamento;
// - nada é enviado ao servidor.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
test.use({ viewport: { width: 1366, height: 768 } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const VENDOR = path.join(__dirname, 'fixtures', 'vendor');


async function abrir(page, context, { permitir = true, pos = { latitude: -10.0, longitude: -68.0, accuracy: 8 } } = {}) {
  if (permitir) await context.grantPermissions(['geolocation'], { origin: BASE });
  await context.setGeolocation(pos);
  await page.addInitScript(() => {
    window._rpcs = 0;
    const mk = pend => { const f = function () {}; const p = new Proxy(f, { get(t, k) { if (k === 'then') return pend ? () => {} : r => r({ data: null, error: null }); if (k === 'auth') return mk(true); if (k === 'rpc') window._rpcs++; return mk(pend) }, apply() { return p } }); return p };
    window.supabase = { createClient: () => mk(false) };
  });
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await page.route('**/*.tile.openstreetmap.org/**', r => r.abort());
  await page.route('**/mt*.google.com/**', r => r.abort());
  await page.route('**/unpkg.com/**', r => r.abort());
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.css'), contentType: 'text/css' }));
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof renderPagina === 'function' && typeof L !== 'undefined' && typeof gpsMontar === 'function');
  await page.evaluate(() => {
    appState.perfil = 'super_admin'; appState.usuario = { id: 'u1', nome_completo: 'Teste' }; appState.permissoes = {};
    document.getElementById('app').innerHTML = gerarLayout('Mapa das UCs', 'mapa') + renderPagina() + '</div></div></div>';
    if (!L.Control.MiniMap) L.Control.MiniMap = L.Control.extend({ onAdd() { return L.DomUtil.create('div') } });
    if (!L.markerClusterGroup) L.markerClusterGroup = () => L.layerGroup();
    iniciarMapa();
    window._rpcs = 0;
  });
  await page.waitForFunction(() => _ucGeojson?.features?.length > 0);
}

const painel = page => page.locator('.gps-painel');

test('liga: ponto e círculo na posição, coordenada graus + UTM, precisão e UC', async ({ page, context }) => {
  await abrir(page, context);
  await page.click('.gps-btn');
  await expect(painel(page).locator('[data-gps-coord]')).toBeVisible();
  const r = await page.evaluate(() => ({
    ponto: _gps.ponto.getLatLng(), raio: _gps.circulo.getRadius(), pane: _gps.ponto.options.pane,
    pressed: document.querySelector('.gps-btn').getAttribute('aria-pressed'),
    noMapa: mapaL.getBounds().contains(_gps.ponto.getLatLng()),
  }));
  expect(r.ponto.lat).toBeCloseTo(-10.0, 6);
  expect(r.ponto.lng).toBeCloseTo(-68.0, 6);
  expect(r.raio).toBe(8);
  expect(r.pane).toBe('gpsPane');
  expect(r.pressed).toBe('true');
  expect(r.noMapa).toBe(true);
  const t = await painel(page).innerText();
  expect(t).toContain('-10,000000, -68,000000');
  expect(t).toMatch(/UTM 19S · E [\d.]+ · N [\d.]+/);
  expect(t).toContain('± 8 m');
  // a página usa o limite REAL das UCs (data/uc_acre.geojson): a UC esperada é a que ela calcula
  const uc = await page.evaluate(() => _ucNomePorCoordenada(-10.0, -68.0));
  expect(uc).toBeTruthy();
  expect(t).toContain(`Dentro da UC: ${uc}`);
  expect(t).not.toContain('Precisão baixa');
  expect(t).toContain('Nada é gravado');
  expect(await page.evaluate(() => window._rpcs)).toBe(0);
});

test('fora de UC e precisão ruim: o painel diz as duas coisas', async ({ page, context }) => {
  await abrir(page, context, { pos: { latitude: -9.0, longitude: -70.0, accuracy: 850 } });
  await page.click('.gps-btn');
  await expect(painel(page).locator('[data-gps-uc]')).toHaveText('Fora das UCs mapeadas');
  await expect(painel(page)).toContainText('± 850 m');
  await expect(painel(page).locator('.gps-aviso')).toContainText('Precisão baixa');
});

test('permissão negada: mensagem no painel, sem ponto, sem erro na página', async ({ page, context }) => {
  await abrir(page, context, { permitir: false });
  // só conta o que acontecer a partir do clique (o banco falso tem ruído próprio)
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await page.click('.gps-btn');
  await expect(painel(page).locator('.gps-erro')).toContainText('Permissão de localização negada');
  expect(await page.evaluate(() => _gps.ponto)).toBeNull();
  expect(erros).toEqual([]);
});

test('acompanhar move o ponto; desligar apaga tudo e para o acompanhamento', async ({ page, context }) => {
  await abrir(page, context);
  await page.click('.gps-btn');
  await expect(painel(page).locator('[data-gps-coord]')).toBeVisible();
  await page.click('[data-gps="acompanhar"]');
  await expect(page.locator('[data-gps="acompanhar"]')).toHaveAttribute('aria-pressed', 'true');
  await context.setGeolocation({ latitude: -10.05, longitude: -68.05, accuracy: 5 });
  await page.waitForFunction(() => Math.abs(_gps.ponto.getLatLng().lat + 10.05) < 1e-6);
  await expect(painel(page)).toContainText('± 5 m');
  await page.click('.gps-btn');
  const r = await page.evaluate(() => {
    // o renderizador SVG da pane também é "camada" do Leaflet: conta só o desenho
    let n = 0; mapaL.eachLayer(l => { if (l instanceof L.CircleMarker && l.options.pane === 'gpsPane') n++ })
    return { n, watch: _gps.watchId, ligado: gpsLigado(), oculto: document.querySelector('.gps-painel').hidden }
  });
  expect(r).toEqual({ n: 0, watch: null, ligado: false, oculto: true });
});

test('clique no botão não vira clique no mapa (popup/medição não reagem)', async ({ page, context }) => {
  await abrir(page, context);
  await page.evaluate(() => { window._cliques = 0; mapaL.on('click', () => window._cliques++) });
  await page.click('.gps-btn');
  await expect(painel(page).locator('[data-gps-coord]')).toBeVisible();
  await page.click('[data-gps="centralizar"]');
  expect(await page.evaluate(() => window._cliques)).toBe(0);
});
