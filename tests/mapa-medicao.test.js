// ── Mapa das UCs · ferramentas de medição (js/mapa-medicao.js) ──
// Executar: npx playwright test tests/mapa-medicao.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html) montada como em
// tests/mapa-areas-aparencia.test.js. Trava o que não pode quebrar:
// - números conferidos contra conta independente (não contra o turf);
// - clicar para medir em cima de uma UC NÃO abre o popup dela
//   (contrafactual: o mesmo clique, sem medição, abre);
// - duplo clique conclui sem dar zoom; Esc cancela sem sair da tela cheia.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
test.use({ viewport: { width: 1366, height: 768 } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const VENDOR = path.join(__dirname, 'fixtures', 'vendor');

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
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof renderPagina === 'function' && typeof L !== 'undefined' && typeof medMontar === 'function');
  await page.evaluate(() => {
    appState.perfil = 'super_admin'; appState.usuario = { id: 'u1', nome_completo: 'Teste' };
    document.getElementById('app').innerHTML = gerarLayout('Mapa das UCs', 'mapa') + renderPagina() + '</div></div></div>';
    if (!L.Control.MiniMap) L.Control.MiniMap = L.Control.extend({ onAdd() { return L.DomUtil.create('div') } });
    if (!L.markerClusterGroup) L.markerClusterGroup = () => L.layerGroup();
    iniciarMapa();
  });
  await page.waitForFunction(() => _ucLayer && _ucLayer.getLayers().length > 0);
}

// Ponto de tela (página) dentro de uma UC, com o mapa enquadrado nela.
async function pontoDentroDeUC(page) {
  return page.evaluate(() => {
    const lyr = _ucLayer.getLayers().find(l => l.feature && /Chandless/i.test(l.feature.properties?.nome || '')) || _ucLayer.getLayers()[0];
    mapaL.fitBounds(lyr.getBounds(), { animate: false });
    const pt = turf.pointOnFeature(lyr.feature).geometry.coordinates;
    const cp = mapaL.latLngToContainerPoint([pt[1], pt[0]]);
    const r = mapaL.getContainer().getBoundingClientRect();
    return { x: r.left + cp.x, y: r.top + cp.y };
  });
}

test('números: distância, área e UTM batem com conta independente', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => {
    // 0,01° de latitude no equador = 1.111,95 m (raio do turf 6.371.008,8 m)
    const d = medDistanciaM([[0, -60], [0.01, -60]]);
    // quadrado de 0,01° × 0,01° no equador ≈ 1.111,95² m² (esférico)
    const a = medAreaPerimetro([[0, -60], [0, -59.99], [0.01, -59.99], [0.01, -60]]);
    const c = medCoordenada(-9.9747, -67.8243); // Rio Branco
    return {
      d, area: a.areaM2, perim: a.perimetroM, c,
      fmt: [medFormatarDistancia(85.25), medFormatarDistancia(850), medFormatarDistancia(1234.5),
        medFormatarArea(950), medFormatarArea(123456), medFormatarArea(2.5e9)],
    };
  });
  const k = 2 * Math.PI * 6371008.8 / 360 * 0.01;
  expect(Math.abs(r.d - k)).toBeLessThan(0.5);
  expect(Math.abs(r.area / (k * k) - 1)).toBeLessThan(0.005);
  expect(Math.abs(r.perim - 4 * k)).toBeLessThan(2);
  // zona 19S, meridiano central −69°: E ≈ 500 km + 1,18° × 111 km × cos(10°) ≈ 629 km
  expect(r.c.zona).toBe(19);
  expect(r.c.hemisferio).toBe('S');
  expect(r.c.epsg).toBe(31979);
  expect(Math.abs(r.c.e - 628900)).toBeLessThan(1500);
  expect(Math.abs(r.c.n - 8897000)).toBeLessThan(3000);
  expect(r.fmt).toEqual(['85,3 m', '850 m', '1,23 km', '950 m²', '12,35 ha', '2.500,0 km² (250.000 ha)']);
});

test('barra de medição: foco, tamanho de alvo e ícones', async ({ page }) => {
  await abrir(page);
  const btns = page.locator('.med-bar .med-btn');
  await expect(btns).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const b = await btns.nth(i).boundingBox();
    expect(b.width).toBeGreaterThanOrEqual(24);
    expect(b.height).toBeGreaterThanOrEqual(24);
    expect(await btns.nth(i).locator('svg').count()).toBe(1);
  }
  await expect(page.locator('[data-med-acao="limpar"]')).toBeDisabled();
});

test('medir sobre uma UC não abre o popup dela (contrafactual: sem medir, abre)', async ({ page }) => {
  await abrir(page);
  let p = await pontoDentroDeUC(page);
  // contrafactual — sem medição o clique abre o popup da UC
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.leaflet-popup')).toHaveCount(1);
  // o popup faz autoPan: fecha e reenquadra antes de medir
  await page.evaluate(() => { mapaL.closePopup(); mapaL.stop() });
  p = await pontoDentroDeUC(page);

  await page.click('[data-med="dist"]');
  await expect(page.locator('[data-med="dist"]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x + 120, p.y + 40);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await expect(page.locator('.med-painel .med-valor')).toContainText('Total');
  await page.click('[data-med-acao="concluir"]');
  await expect(page.locator('.med-rotulo')).toHaveCount(1);
  await expect(page.locator('.med-painel')).toContainText('Distância medida');
  await expect(page.locator('[data-med-acao="limpar"]')).toBeEnabled();
  // desligar a ferramenta devolve o clique às camadas
  await page.click('[data-med="dist"]');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.leaflet-popup')).toHaveCount(1);
});

test('área: duplo clique conclui sem dar zoom; Backspace desfaz; Limpar apaga', async ({ page }) => {
  await abrir(page);
  const p = await pontoDentroDeUC(page);
  const zoom0 = await page.evaluate(() => mapaL.getZoom());
  await page.click('[data-med="area"]');
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x + 150, p.y);
  await page.mouse.click(p.x + 150, p.y + 100);
  await page.mouse.click(p.x + 60, p.y + 160);
  await page.keyboard.press('Backspace');
  await expect.poll(() => page.evaluate(() => _med.pontos.length)).toBe(3);
  await page.mouse.dblclick(p.x + 40, p.y + 120);
  await expect(page.locator('.med-painel')).toContainText('Área medida');
  await expect(page.locator('.med-painel')).toContainText('não registral');
  expect(await page.evaluate(() => mapaL.getZoom())).toBe(zoom0);
  // o 1º clique do duplo clique não vira vértice repetido
  const n = await page.evaluate(() => _med.grupo.getLayers()[0].getLayers()[0].getLatLngs()[0].length);
  expect(n).toBe(4);
  await page.click('[data-med="area"]'); // desliga
  expect(await page.evaluate(() => mapaL.doubleClickZoom.enabled())).toBe(true);
  await page.click('[data-med-acao="limpar"]');
  await expect(page.locator('.med-rotulo')).toHaveCount(0);
});

test('coordenada mostra graus e UTM; Esc encerra sem sair da tela cheia', async ({ page }) => {
  await abrir(page);
  const p = await pontoDentroDeUC(page);
  await page.evaluate(() => toggleTelaCheia());
  await page.waitForFunction(() => _mapaImersivo === true);
  await page.click('[data-med="coord"]');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.med-painel')).toContainText('UTM');
  await expect(page.locator('.med-painel')).toContainText('EPSG:3197');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-med="coord"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => _mapaImersivo)).toBe(true);
  // barra continua visível e clicável no imersivo
  await expect(page.locator('[data-med="dist"]')).toBeVisible();
});
