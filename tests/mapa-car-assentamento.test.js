// ── Mapa das UCs · CAR por Projeto de Assentamento ──────────────────
// Executar: npx playwright test tests/mapa-car-assentamento.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html) sem login: o script inline define as
// funções do CAR mesmo sem sessão. O SICAR é trocado por um stub de
// _carFetchJson montado com o PRÓPRIO polígono do assentamento (turf), e
// _carregarMarcados por um no-op (lê o banco).
//
// Trava: o modo "Por Assentamento" existe e lista os 110 PAs agrupados por
// modalidade; a carga mantém só o que TOCA o polígono (o imóvel de fora
// sai) e "Incluir entorno" traz o retângulo inteiro; o resumo por tipo
// explica AST × IRU; o detalhe do imóvel diz "Assentamento"; o botão da
// janela do assentamento liga a camada CAR e carrega.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const VENDOR = path.join(__dirname, 'fixtures', 'vendor');
const SIPRA = 'AC0016000'; // PAE CHICO MENDES

async function abrir(page, opts = {}) {
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await page.route('**/*.tile.openstreetmap.org/**', r => r.abort());
  await page.route('**/mt*.google.com/**', r => r.abort());
  await page.route('**/unpkg.com/**', r => r.abort()); // registrado ANTES: a Playwright testa a última rota primeiro
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.css'), contentType: 'text/css' }));
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof carregarDadosCARAssentamento === 'function' && typeof L !== 'undefined', null, { timeout: 20_000 });
  await page.evaluate(async (sipra) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="__m" style="width:600px;height:400px"></div><div id="__dd"></div><span id="car-count-badge" style="display:none"></span>'); // contador vive no botão da guia
    mapaL = L.map('__m').setView([-10.5, -68.5], 8);
    mapaL.createPane('carPane'); // como o init do mapa faz
    document.getElementById('__dd').innerHTML = _renderDropdown('car');
    window._carregarMarcados = async () => {};
    _ucGeojson = { type: 'FeatureCollection', features: [] }; // na página real a guia de UCs já carregou
    window._carUC = 0;
    const gj = await paCarregar();
    const pa = gj.features.find(f => f.properties.cd_sipra === sipra);
    const pt = turf.pointOnFeature(pa).geometry.coordinates;
    const bb = turf.bbox(pa);
    const quad = (x, y, d, props) => ({ type: 'Feature', properties: props,
      geometry: { type: 'Polygon', coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] } });
    // 1 AST (o assentamento inteiro), 2 IRU dentro, 1 IRU no canto do retângulo FORA do polígono
    const fora = [bb[0] + 0.0005, bb[3] - 0.0005];
    const foraDentro = turf.booleanPointInPolygon(fora, pa);
    window._fix = { type: 'FeatureCollection', totalFeatures: 4, features: [
      { ...pa, properties: { cod_imovel: 'AC-AST-1', tipo_imovel: 'AST', ind_status: 'AT' } },
      quad(pt[0], pt[1], 0.002, { cod_imovel: 'AC-IRU-1', tipo_imovel: 'IRU', ind_status: 'AT' }),
      quad(pt[0] + 0.001, pt[1], 0.001, { cod_imovel: 'AC-IRU-2', tipo_imovel: 'IRU', ind_status: 'AT' }),
      quad(fora[0], fora[1], 0.0003, { cod_imovel: 'AC-IRU-FORA', tipo_imovel: 'IRU', ind_status: 'AT' }),
    ] };
    window._foraDentro = foraDentro;
    window._carFetchJson = async () => { window._carUC++; return window._fix };
  }, SIPRA);
  // camada CAR ligada, como o usuário faz antes de escolher o modo
  if (!opts.semLigar) await page.evaluate(async () => { const t = document.getElementById('car-toggle'); t.checked = true; await toggleCamadaCAR(t) });
}

test('modo "Por Assentamento" lista os 110 PAs agrupados por modalidade', async ({ page }) => {
  await abrir(page);
  await page.check('input[name="car-modo"][value="pa"]');
  await expect(page.locator('#car-wrap-pa')).toBeVisible();
  await expect(page.locator('#car-wrap-uc')).toBeHidden();
  await page.waitForFunction(() => document.querySelectorAll('#car-sel-pa option').length > 1);
  expect(await page.locator('#car-sel-pa option[value]:not([value=""])').count()).toBe(110);
  expect(await page.locator('#car-sel-pa optgroup').evaluateAll(g => g.map(x => x.label.split(' ')[0]))).toEqual(['PA', 'PAE', 'PDS', 'PAF']);
});

test('carrega só o que toca o polígono; "Incluir entorno" traz o retângulo; resumo por tipo', async ({ page }) => {
  await abrir(page);
  expect(await page.evaluate(() => window._foraDentro)).toBe(false); // o imóvel "de fora" está mesmo fora
  await page.check('input[name="car-modo"][value="pa"]');
  await page.waitForFunction(() => document.querySelectorAll('#car-sel-pa option').length > 1);
  await page.selectOption('#car-sel-pa', SIPRA);
  await expect(page.locator('#car-status-txt')).toContainText('3 imóvel(is) em PAE CHICO MENDES');
  expect(await page.evaluate(() => _carFeatures.map(f => f.properties.cod_imovel).sort())).toEqual(['AC-AST-1', 'AC-IRU-1', 'AC-IRU-2']);
  await expect(page.locator('#car-pa-tipos')).toContainText('1 AST');
  await expect(page.locator('#car-pa-tipos')).toContainText('2 IRU');
  await expect(page.locator('#car-pa-tipos')).toContainText('a sobreposição é esperada');
  await expect(page.locator('#car-count-badge')).toHaveText('3');
  expect(await page.evaluate(() => _carUCAtual)).toBe('PAE CHICO MENDES');

  await page.check('#car-pa-bbox');
  await expect(page.locator('#car-status-txt')).toContainText('4 imóvel(is)');

  // trocar de modo limpa o resumo do assentamento
  await page.check('input[name="car-modo"][value="uc"]');
  await expect(page.locator('#car-pa-tipos')).toBeHidden();
  expect(await page.evaluate(() => _carPaAtual)).toBeNull();
});

test('detalhe do imóvel diz "Assentamento (INCRA)" em vez de UC', async ({ page }) => {
  await abrir(page);
  await page.evaluate(async (s) => { _carModo = 'pa'; await carregarDadosCARAssentamento(s) }, SIPRA);
  const html = await page.evaluate(() => _htmlCarAtributos(_carFeatures[1]));
  expect(html).toContain('Assentamento (INCRA)');
  expect(html).toContain('PAE CHICO MENDES');
  expect(html).not.toContain('UC correspondente');
});

test('botão da janela do assentamento liga a camada CAR e carrega', async ({ page }) => {
  await abrir(page, { semLigar: true });
  const html = await page.evaluate(async (s) => {
    const gj = await paCarregar();
    return paPopupHTML(gj.features.find(f => f.properties.cd_sipra === s).properties);
  }, SIPRA);
  expect(html).toContain(`data-pa-car="${SIPRA}"`);
  expect(html).toContain('Ver CARs deste assentamento');
  await page.evaluate(h => { document.body.insertAdjacentHTML('beforeend', `<div id="__pop">${h}</div>`) }, html);
  await page.click('#__pop .pa-btn-car');
  await page.waitForFunction(() => _carPaAtual === 'AC0016000' && _carFeatures.length === 3);
  await expect(page.locator('#car-status-txt')).toContainText('3 imóvel(is)');
  expect(await page.evaluate(() => document.getElementById('car-toggle').checked)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('input[name="car-modo"][value="pa"]').checked)).toBe(true);
  await expect(page.locator('#car-sel-pa')).toHaveValue(SIPRA);
});
