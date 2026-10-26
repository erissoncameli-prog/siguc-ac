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
const FUND = { type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: quad(-70.0, -10.4, 0.2), properties: { tipo: 'UCUS', tipo_rotulo: 'UC de uso sustentável', nome: 'RESEX Teste', orgao: 'ICMbio', zona: 'Zona 2', area_ha: 4000 } },
  { type: 'Feature', geometry: quad(-69.7, -10.4, 0.1), properties: { tipo: 'IRU', tipo_rotulo: 'Imóvel rural (propriedade privada)', subtipo: 'Propriedade Privada', area_ha: 900 } },
] };
const MANIFESTO = { camadas: {
  fase3_fundiario: { arquivo: 'fase3_fundiario.geojson', fonte: 'SEMA-AC — ZEE Fase III, base fundiária', escala: null, feicoes: 2, complementar: true },
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
    r.fulfill({ json: u.endsWith('/fase3_gestao.geojson') ? FASE3 : u.endsWith('/fase3_fundiario.geojson') ? FUND : FASE2 });
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
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('siguc_zee')))).toEqual({ ativa: 'fase2_gestao', colorir: 'subzona', opacidade: 0.7, comp: [], ocultos: [] });
});

test('arquivos REAIS (SEMA, 26/10/2026): Fase II só zonas, Fase III com subzona e unidade de manejo', async ({ page }) => {
  test.setTimeout(60000);
  await abrir(page, { reais: true });
  await abrirAba(page);
  await expect(page.locator('.zee-aviso')).toHaveCount(0);
  await expect(page.locator('[data-zee-camada="fase3_gestao"] [data-zee-acao="ligar"]')).toBeEnabled();
  // a Fase III tem subzona: a opção de colorir por subzona aparece
  await expect(page.locator('[data-zee-acao="colorir"]')).toHaveCount(1);
  await ligar(page, 'fase2_gestao');
  const zonas = await page.evaluate(() => _zee.layer.getLayers().map(l => [l.feature.properties.zona_cod, l.options.fillColor]));
  expect(zonas).toEqual([['1', '#E69F00'], ['2', '#009E73'], ['3', '#CC79A7'], ['4', '#0072B2']]);
  const leg = await page.evaluate(() => zeeItensLegenda().map(i => i.label));
  expect(leg).toHaveLength(4);
  expect(leg[3]).toMatch(/Zona 4 — Cidades florestais/);

  await ligar(page, 'fase3_gestao');
  const f3 = await page.evaluate(() => _zee.layer.getLayers().map(l => l.feature.properties));
  expect(f3).toHaveLength(30);
  expect([...new Set(f3.map(p => p.zona_cod))]).toEqual(['1', '2', '3', '4']);
  expect(new Set(f3.map(p => p.subzona)).size).toBe(20);
  expect(f3.filter(p => p.unidade).length).toBe(13);
  // nomes do PRÓPRIO arquivo (a Fase III renomeou as zonas)
  expect(f3.find(p => p.zona_cod === '4').zona).toBe('Zona 4 — Cidades do Acre');
  // um código, um nome
  const nomes = {};
  for (const p of f3) for (const [c, n] of [[p.zona_cod, p.zona], [p.subzona, p.subzona_nome], [p.unidade, p.unidade_nome]]) {
    if (!c || !n) continue;
    expect(nomes[c] ?? n).toBe(n); nomes[c] = n;
  }
  await page.locator('[data-zee-acao="colorir"]').selectOption('subzona');
  expect(await page.evaluate(() => zeeItensLegenda().length)).toBe(20);

  // colorir por unidade de manejo: 13 unidades + 17 subzonas sem unidade
  await page.locator('[data-zee-acao="colorir"]').selectOption('unidade');
  expect(await page.evaluate(() => zeeItensLegenda().length)).toBe(30);
  expect(new Set(await page.evaluate(() => _zee.layer.getLayers().map(l => l.options.fillColor))).size).toBe(30);
  // árvore de classes: 4 zonas + 20 subzonas + 13 unidades, com área oficial
  await expect(page.locator('#zee-classes [data-zee-acao="classe"]')).toHaveCount(37);
  await expect(page.locator('#zee-classes .zee-cl', { hasText: 'Unidade 1.1.1' })).toContainText('206.336 ha');
  // ocultar a Zona 2: some do mapa e da legenda; os filhos ficam travados
  await page.locator('#zee-classes [data-zee-cod="2"]').uncheck();
  expect(await page.evaluate(() => _zee.layer.getLayers().filter(l => l.feature.properties.zona_cod === '2').length)).toBe(0);
  expect(await page.evaluate(() => _zee.layer.getLayers().length)).toBe(24);
  expect(await page.evaluate(() => zeeItensLegenda().length)).toBe(24);
  await expect(page.locator('#zee-classes [data-zee-cod="2.1"]')).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('siguc_zee')).ocultos)).toEqual(['2']);
  await page.locator('#zee-classes [data-zee-acao="todas"]').click();
  await page.waitForFunction(() => _zee.layer.getLayers().length === 30);
  await expect(page.locator('#mlb-dropdown')).toBeVisible(); // o painel não fecha
  // quadro de áreas oficiais 2007 × 2020 (planilha da SEMA)
  const q = page.locator('#zee-quadro details');
  await q.locator('summary').click();
  await expect(q.locator('tbody tr')).toHaveCount(37);
  await expect(q.locator('tr', { hasText: '1.1.8' })).toContainText('nova');
  await expect(q.locator('tr.zee-q-n1', { hasText: 'Zona 3' })).toContainText('-56,0%');
  await page.locator('[data-zee-acao="colorir"]').selectOption('subzona');

  // clique de verdade no mapa: o popup abre na feição de baixo do cursor
  await page.click('#mlb-dropdown .mlb-close');
  await expect(page.locator('#mlb-dropdown')).toBeHidden();
  const alvo = await page.evaluate(() => {
    const l = _zee.layer.getLayers().find(l => l.feature.properties.unidade === '1.1.1')
    // ponto dentro da MAIOR parte da unidade, longe das divisas (a simplificação
    // deixa sobreposições finas, de metros, entre feições vizinhas)
    const g = l.feature.geometry
    const partes = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
    const maior = partes.map(c => turf.polygon(c)).sort((a, b) => turf.area(b) - turf.area(a))[0]
    const [lng, lat] = turf.pointOnFeature(turf.buffer(maior, -1, { units: 'kilometers' })).geometry.coordinates
    const c = L.latLng(lat, lng); mapaL.setView(c, 13, { animate: false })
    const p = mapaL.latLngToContainerPoint(c), r = mapaL.getContainer().getBoundingClientRect()
    return { x: r.left + p.x, y: r.top + p.y }
  })
  let t0 = Date.now();
  await page.mouse.click(alvo.x, alvo.y);
  await expect(page.locator('.leaflet-popup-content')).toBeVisible();
  // arquivo de 15 MB (~716 mil vértices): medido ~0,1–0,5 s; o teto (folgado para CI carregado) pega regressão grosseira
  expect(Date.now() - t0).toBeLessThan(15000);
  const t = await page.locator('.leaflet-popup-content').last().innerText();
  expect(t).toMatch(/Unidade de manejo 1\.1\.1/i);
  expect(t).toContain('Zona 1 — Sistemas de Produção Agropecuários e Florestais Sustentáveis');
  expect(t).toContain('sem lei estadual que o institua');
  expect(t).toMatch(/Área oficial \(SEMA, 2020\):\s*206\.336 ha/);
  expect(t).toMatch(/Área na Fase II \(2007\):\s*134\.673 ha/);
  t0 = Date.now();
  await page.mouse.move(alvo.x, alvo.y + 150); await page.mouse.down();
  await page.mouse.move(alvo.x + 200, alvo.y + 250, { steps: 10 }); await page.mouse.up();
  expect(Date.now() - t0).toBeLessThan(15000);
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

test('base fundiária: liga junto com a fase, cor por tipo, imóvel rural sem nome', async ({ page }) => {
  const pedidos = await abrir(page);
  await abrirAba(page);
  // sem fundiário no manifesto, a seção nem aparece (testado no caso "sem arquivo"); aqui aparece
  const caixa = page.locator('[data-zee-comp="fase3_fundiario"] [data-zee-acao="comp"]');
  await expect(caixa).toBeVisible();
  expect(pedidos).not.toContain('/data/zee/fase3_fundiario.geojson'); // só baixa ao ligar
  await ligar(page, 'fase2_gestao');
  await caixa.check();
  await page.waitForFunction(() => zeeComplementaresAtivas().length === 1);
  // as duas no mapa ao mesmo tempo, fundiário por cima das zonas e abaixo das UCs
  const r = await page.evaluate(() => ({
    fase: zeeAtiva(),
    cores: _zee.comp.fase3_fundiario.getLayers().map(l => l.options.color),
    z: ['zeePane', 'zeeCompPane', 'overlayPane'].map(p => Number(getComputedStyle(mapaL.getPane(p)).zIndex)),
  }));
  expect(r.fase).toBe('fase2_gestao');
  expect(r.cores).toEqual(['#8C6D1F', '#E69F00']);
  expect(r.z[0]).toBeLessThan(r.z[1]);
  expect(r.z[1]).toBeLessThan(r.z[2]);
  await expect(page.locator('#zee-count-badge')).toHaveText('2');
  const leg = await page.evaluate(() => document.querySelector('.cart-legenda')?.innerText || '');
  expect(leg).toContain('Fundiário ZEE III — UC de uso sustentável');
  expect(leg).toContain('Fundiário ZEE III — Imóvel rural (propriedade privada)');
  // popup do imóvel rural: tipo, sem nome, com o aviso
  await page.evaluate(() => _zee.comp.fase3_fundiario.getLayers()[1].openPopup());
  const t = await page.locator('.leaflet-popup-content').last().innerText();
  expect(t).toContain('Imóvel rural (propriedade privada)');
  expect(t).toContain('nome e titular não são exibidos');
  // desligar a fase não desliga o fundiário
  await page.locator('[data-zee-camada="fase2_gestao"] [data-zee-acao="ligar"]').uncheck();
  expect(await page.evaluate(() => [zeeAtiva(), zeeComplementaresAtivas()])).toEqual([null, ['fase3_fundiario']]);
  await caixa.uncheck();
  expect(await page.evaluate(() => zeeComplementaresAtivas())).toEqual([]);
});

test('arquivo listado no manifesto que falha: aviso e a caixa volta a desmarcada', async ({ page }) => {
  await abrir(page, { geojsonStatus: 404 });
  await abrirAba(page);
  await page.locator('[data-zee-camada="fase2_gestao"] [data-zee-acao="ligar"]').click();
  await expect(page.locator('[data-zee-camada="fase2_gestao"] .zee-status')).toHaveText('Não foi possível carregar o arquivo.');
  await expect(page.locator('[data-zee-camada="fase2_gestao"] [data-zee-acao="ligar"]')).not.toBeChecked();
  expect(await page.evaluate(() => zeeAtiva())).toBe(null);
});
