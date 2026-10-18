// ── Relatórios do Mapa das UCs e do CAR na UC · padrão único ─────────
// Executar: npx playwright test tests/relatorios-mapa-padrao.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// O que este teste trava:
//  - moldura cartográfica única (js/mapa-moldura.js): barra de escala com
//    comprimento redondo e o meio na MESMA unidade do total; referência
//    SIRGAS 2000 + grade UTM; legenda com borda escura em linha branca;
//  - cabeçalho do relatório em HTML na mesma ordem do timbre em PDF
//    (Secretaria / Diretoria / Departamento · módulo), departamento do
//    módulo (nunca o campo genérico) e NUNCA emoji no lugar da logo;
//  - fundo dos mapas: satélite troca as cores que somem na floresta
//    (contorno do CAR vira amarelo), "sem fundo" volta ao verde-escuro;
//  - impressão do Mapa das UCs leva o MAPA DE VERDADE (o próprio #mapa
//    entra na folha) com barra de escala, e devolve o mapa ao fechar —
//    antes imprimia um aviso no lugar do mapa;
//  - "Nova aba" saiu (abria os mapas em branco).

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
const BASE = process.env.BASE_URL || 'http://localhost:5500';
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function abrir(page, opts = {}) {
  await page.route('**/*arcgisonline.com/**', r => r.fulfill({ body: PNG1, contentType: 'image/png' }));
  await page.route('**/logo-*.png', r => r.fulfill({ body: PNG1, contentType: 'image/png' }));
  if (opts.semLogo) await page.addInitScript(() => { window._semLogo = true });
  await page.goto(`${BASE}/tests/fixtures/relatorio-mapa-harness.html`);
  await page.waitForFunction(() => typeof moldEscalaG === 'function' && typeof relAbrirPreview === 'function' && window.CART);
}

test('moldura: barra de escala redonda, meio na mesma unidade, referência e legenda', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => ({
    km: moldEscalaMedida(10, 80),          // 800 m pedidos → 1 km
    m: moldEscalaMedida(2.4, 80),          // 192 m → 200 m
    svg: moldEscalaSVG(10),
    ref: moldReferencia(19),
    refSem: moldReferencia(),
    legenda: moldLegendaHTML([{ rotulo: 'Limite da UC', cor: '#FFFFFF', tipo: 'linha', halo: '#374151' }]),
    zona: moldUtmZona(-68.5),
  }));
  expect(r.km).toEqual({ metros: 1000, px: 100, rotulo: '1 km' });
  expect(r.m.rotulo).toBe('200 m');
  expect(r.svg).toContain('>0,5<');                    // meio de 1 km sai "0,5", nunca "500"
  expect(r.svg).toContain('>1<');
  expect(r.svg).toContain('>km<');
  expect(r.ref).toBe('Datum SIRGAS 2000 · grade UTM 19S (EPSG:31979, km) · exibição Web Mercator');
  expect(r.refSem).toContain('EPSG:3857');
  expect(r.legenda).toContain('stroke="#374151"');      // linha branca ganha borda escura na legenda clara
  expect(r.zona).toBe(19);
});

test('cabeçalho: ordem do timbre em PDF, departamento do módulo, sem emoji', async ({ page }) => {
  await abrir(page, { semLogo: true });
  const html = await page.evaluate(async () => {
    const cab = await getCabecalhoRelatorio(REL_CAB_MODULO); cab.linhaModulo = 'Cadastro Ambiental Rural'
    return _htmlCabecalho(cab, 'SIGUC-2026-0042', '17/10/2026')
  });
  expect(await page.evaluate(() => window._cabModulo)).toBe('monitoramento');
  const linhas = await page.evaluate(h => {
    const d = document.createElement('div'); d.innerHTML = h
    return [...d.querySelectorAll('.rel-inst > div')].map(e => e.textContent.trim())
  }, html);
  expect(linhas).toEqual([
    'Secretaria de Estado do Meio Ambiente do Acre — SEMA-AC',
    'Diretoria de Meio Ambiente',
    'Departamento de Unidades de Conservação · Cadastro Ambiental Rural',
  ]);
  expect(html).not.toMatch(/🌿|🏛|🗺/u);
  expect(html).toContain('Prot. nº SIGUC-2026-0042');
});

test('fundo dos mapas: satélite troca as cores que somem na floresta', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => {
    const sat = _legendaHTML(_LEG_DET)
    _relSetFundo('sem')
    const sem = _legendaHTML(_LEG_DET)
    _relSetFundo('satelite')
    return { sat, sem, cred: _relFonteMapa('PRODES/INPE') }
  });
  expect(r.sat).toContain('#FACC15');
  expect(r.sem).toContain('#1F4E2C');
  expect(r.cred).toBe('PRODES/INPE · Imagem de fundo: Esri World Imagery (Esri, Maxar, Earthstar Geographics)');
  expect(await page.evaluate(() => typeof _abrirNovaAba)).toBe('undefined');
});

test('imprimir o Mapa das UCs leva o mapa de verdade e devolve ao fechar', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => {
    window._m = L.map('mapa').setView([-9.5, -69.5], 9)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(window._m)
    CART.init(window._m)
  });
  await page.evaluate(() => CART.imprimir('Mapa das Unidades de Conservação — Acre'));
  const folha = page.locator('#rel-preview-overlay .rel-a4.rel-a4-paisagem');
  await expect(folha).toHaveCount(1);
  await expect(folha.locator('#cart-print-slot > #mapa')).toHaveCount(1);              // o mapa está NA folha
  await expect(folha.locator('#cart-print-slot .leaflet-tile').first()).toBeAttached();
  await expect(folha).not.toContainText('Captura do mapa');                             // o aviso antigo
  await expect(folha.locator('.rel-inst .sec')).toHaveText('Secretaria de Estado do Meio Ambiente do Acre — SEMA-AC');
  await expect(folha.locator('#cart-print-escala svg')).toHaveCount(1);
  await expect(folha.locator('svg[aria-label="Norte"]')).toHaveCount(1);
  await expect(folha).toContainText('Datum SIRGAS 2000');
  await page.click('#rel-preview-overlay [data-rel-fechar]');
  await expect(page.locator('#rel-preview-overlay')).toHaveCount(0);
  await expect(page.locator('#wrap > #mapa')).toHaveCount(1);                          // voltou ao lugar
});

test('relatório do imóvel: mapa com satélite, barra de escala na moldura e grade UTM', async ({ page }) => {
  await abrir(page);
  await page.evaluate(async () => {
    const ucFeat = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-69.6, -9.6], [-69.4, -9.6], [-69.4, -9.4], [-69.6, -9.4], [-69.6, -9.6]]] } }
    document.body.insertAdjacentHTML('beforeend', `<div style="width:700px">${_htmlMapaABNT({ id: 'rel-mapa-uc-X', titulo: 'Mapa da UC', altura: 300, fonte: 'SEMA-AC', camadas: [{ label: 'Limite da UC', color: 'uc', kind: 'line' }], zona: 19 })}</div>`)
    await _inicializarMapasRelatorio([], false, { ucNome: 'X', ucFeat, bbox: [-69.6, -9.6, -69.4, -9.4], zona: 19, centroide: [-69.5, -9.5], nome_full: 'X' })
  });
  const quadro = page.locator('.rel-mapa-wrap');
  await expect(quadro.locator('img.leaflet-tile[src*="arcgisonline"]').first()).toBeAttached();   // satélite, não OSM
  await expect(quadro.locator('.rel-mapa-escala svg[aria-label^="Escala gráfica"]')).toHaveCount(1); // barra, nunca "1:N"
  await expect(quadro.locator('.leaflet-control-scale')).toHaveCount(0);                            // sem 2ª escala
  await expect(quadro.locator('.rel-grid-lbl').first()).toBeAttached();                            // grade UTM
  await expect(quadro).toContainText('Grade UTM 19S · EPSG:31979');
  await expect(quadro).toContainText('Esri World Imagery');
  expect(await quadro.locator('.rel-mapa-escala').textContent()).not.toMatch(/1:\d/);
});
