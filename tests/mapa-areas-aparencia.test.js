// ── Mapa das UCs · guia Áreas Territoriais: seções e bloco "Aparência" ──
// Executar: npx playwright test tests/mapa-areas-aparencia.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html) a 1366×768, sem login: o supabase-js é
// trocado por um stub cuja autenticação nunca responde (a página não vai
// para o login) e o layout + mapa são montados como o init faz.
//
// Trava o defeito relatado ("não consigo configurar cor e linha dos
// assentamentos"): as seções eram espremidas pela coluna flex, havia
// rolagem dentro de rolagem e os controles do PA ficavam abaixo da borda
// do painel. Agora: nenhuma seção espremida, uma aberta por vez (lembrada),
// UMA rolagem só, chave liga/desliga no cabeçalho que não abre a seção, e
// cor/espessura mudando o mapa nas três camadas pelo mesmo bloco.

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
  await page.route('**/unpkg.com/**', r => r.abort()); // antes: a Playwright testa a última rota primeiro
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.css'), contentType: 'text/css' }));
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof renderPagina === 'function' && typeof L !== 'undefined' && typeof apBlocoHTML === 'function');
  await page.evaluate(() => {
    appState.perfil = 'super_admin'; appState.usuario = { id: 'u1', nome_completo: 'Teste' };
    document.getElementById('app').innerHTML = gerarLayout('Mapa das UCs', 'mapa') + renderPagina() + '</div></div></div>';
    // plugins do Leaflet vêm de CDN (bloqueado aqui): só o mínimo para o init seguir
    if (!L.Control.MiniMap) L.Control.MiniMap = L.Control.extend({ onAdd() { return L.DomUtil.create('div') } });
    if (!L.markerClusterGroup) L.markerClusterGroup = () => L.layerGroup();
    iniciarMapa();
  });
  await page.waitForFunction(() => _ucLayer && _ucGeojson);
  await page.click('#mlb-btn-areas');
  await expect(page.locator('[data-areas-sec="pa"]')).toBeVisible();
}

const mudarCor = async (page, k, cor) => page.click(`.ap-bloco[data-ap-chave="${k}"] [data-ap-cor="${cor}"] >> nth=0`);

test('nenhuma seção espremida, uma aberta por vez e lembrada; chave não abre a seção', async ({ page }) => {
  await abrir(page);
  for (const k of ['uc', 'ti', 'pa']) {
    const h = await page.locator(`[data-areas-sec="${k}"] .areas-sec-head`).boundingBox();
    expect(h.height, `cabeçalho ${k}`).toBeGreaterThanOrEqual(30);
  }
  // nasce tudo recolhido — nenhuma seção ocupa o painel sem pedir
  expect(await page.locator('.areas-sec-body:not([hidden])').count()).toBe(0);
  // a chave liga a camada sem abrir a seção
  await page.click('[data-areas-sec="pa"] .areas-sw');
  await page.waitForFunction(() => _paLayer && _paLayer.getLayers().length === 110);
  await expect(page.locator('#areas-sec-pa')).toBeHidden();
  await expect(page.locator('#areas-n-pa')).toHaveText('110');
  // uma aberta por vez
  await page.click('[aria-controls="areas-sec-ti"]');
  await expect(page.locator('#areas-sec-ti')).toBeVisible();
  await page.click('[aria-controls="areas-sec-pa"]');
  await expect(page.locator('#areas-sec-pa')).toBeVisible();
  await expect(page.locator('#areas-sec-ti')).toBeHidden();
  // lembrada ao reabrir a guia
  await page.click('#mlb-btn-areas'); await page.click('#mlb-btn-areas');
  await expect(page.locator('#areas-sec-pa')).toBeVisible();
  await expect(page.locator('#pa-toggle')).toBeChecked();
});

test('PA: controles alcançáveis com UMA rolagem, painel estreito e mapa enquadrando', async ({ page }) => {
  await abrir(page);
  await page.click('[data-areas-sec="pa"] .areas-sw');
  await page.waitForFunction(() => _paLayer && _paLayer.getLayers().length === 110);
  await page.click('[aria-controls="areas-sec-pa"]');
  await page.click('.ap-bloco[data-ap-chave="pa"] summary');
  await expect(page.locator('#mlb-dropdown')).toHaveClass(/mlb-estreito/);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // só o corpo do painel rola — nada dentro dele tem rolagem própria
  const rolagens = await page.evaluate(() => [...document.querySelectorAll('#mlb-dropdown *')].filter(e => {
    const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1;
  }).map(e => e.className));
  expect(rolagens.every(c => String(c).includes('mlb-dropdown-body'))).toBe(true);
  // o último controle chega à tela rolando o painel, sem sair dele
  const rest = page.locator('.ap-bloco[data-ap-chave="pa"] .ap-restaurar');
  await rest.scrollIntoViewIfNeeded();
  const r = await rest.boundingBox(), dd = await page.locator('#mlb-dropdown').boundingBox();
  expect(r.y + r.height).toBeLessThanOrEqual(Math.min(768, dd.y + dd.height) + 1);
  // o mapa enquadra a camada à direita do painel
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => {
    const m = mapaL.getContainer().getBoundingClientRect(), d = document.getElementById('mlb-dropdown').getBoundingClientRect();
    const b = _paLayer.getBounds(), sw = mapaL.latLngToContainerPoint(b.getSouthWest());
    return mapaL.getBounds().contains(b) && sw.x + m.left >= d.right - 2;
  })).toBe(true);
});

test('cor e espessura mudam o mapa nas três camadas pelo mesmo bloco', async ({ page }) => {
  await abrir(page);
  await page.click('[data-areas-sec="ti"] .areas-sw');
  await page.click('[data-areas-sec="pa"] .areas-sw');
  await page.waitForFunction(() => _tiLayer && _paLayer && _paLayer.getLayers().length === 110);
  const traco = k => page.evaluate(k => { const l = ({ uc: _ucLayer, ti: _tiLayer, pa: _paLayer })[k].getLayers()[0]._path; return [String(l.getAttribute('stroke')).toLowerCase(), l.getAttribute('stroke-width')] }, k);
  for (const k of ['uc', 'ti', 'pa']) {
    await page.click(`[aria-controls="areas-sec-${k}"]`);
    await page.click(`.ap-bloco[data-ap-chave="${k}"] summary`);
    await mudarCor(page, k, '#D55E00');
    await page.selectOption(`#${k}-peso`, '4');
    expect(await traco(k), k).toEqual(['#d55e00', '4']);
    // amostra do cabeçalho acompanha
    expect(await page.locator(`#areas-am-${k} rect`).getAttribute('stroke').then(v => v.toLowerCase())).toBe('#d55e00');
  }
  // restaurar padrão do PA (seção e bloco seguem abertos) volta à cor do módulo
  await page.click('.ap-bloco[data-ap-chave="pa"] .ap-restaurar');
  expect(await traco('pa')).toEqual(['#6d28d9', '1.5']);
  // UC: "Cor de cada UC" devolve a cor própria de cada unidade
  await page.click('[aria-controls="areas-sec-uc"]');
  await page.click('.ap-bloco[data-ap-chave="uc"] summary');
  await page.click('.ap-bloco[data-ap-chave="uc"] .ap-cor-propria');
  expect(await page.evaluate(() => _ucCorLinha)).toBe('');
  await page.selectOption('#uc-peso', '3'); // mexer na espessura não volta para a cor única
  expect(await page.evaluate(() => _ucCorLinha)).toBe('');
});

// ── UCs por tipo e nível ("Colorir por", js/mapa-uc-tipos.js) ──────────
// Trava: cada modo pinta pela cor do tipo e a legenda acompanha; a cor do
// tipo é editável; os filtros se SOMAM (categoria oculta + esfera desligada
// = só o cruzamento); e voltar a "Cada UC" devolve a cor individual.
const abrirUC = async page => {
  await abrir(page);
  await page.evaluate(() => { localStorage.removeItem('siguc_uc_colorir'); localStorage.removeItem('siguc_uc_tipo_ocultos'); localStorage.removeItem('siguc_uc_cores_tipo') });
  await page.click('[aria-controls="areas-sec-uc"]');
  await expect(page.locator('#areas-sec-uc')).toBeVisible();
  // parte de todas as esferas ligadas (o padrão é só estaduais). Com mais de uma
  // esfera o card de estatísticas lançava ReferenceError (areaTotal) e cortava o redesenho.
  await page.evaluate(() => { ['federal', 'municipal'].forEach(e => { document.getElementById('uc-esfera-' + e).checked = true }); toggleUCEsfera() });
};
const nUC = page => page.evaluate(() => _ucLayer.getLayers().length);
const fillsUC = page => page.evaluate(() => _ucLayer.getLayers().map(l => [l.feature.properties.categoria, l.feature.properties.esfera, l.options.fillColor]));

test('colorir por categoria: cor do tipo no mapa, linhas com contagem e legenda', async ({ page }) => {
  await abrirUC(page);
  const total = await nUC(page);
  await page.click('[data-uct-modo="categoria"]');
  await expect(page.locator('#uc-controles')).toBeHidden(); // lista por UC dá lugar às categorias
  const linhas = page.locator('#uct-lista .uct-linha');
  expect(await linhas.count()).toBe(8);
  if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2 });
  await expect(linhas.first()).toContainText('5');
  const f = await fillsUC(page);
  expect(f).toHaveLength(total);
  const porCat = {}; f.forEach(([c, , cor]) => { (porCat[c] = porCat[c] || new Set()).add(cor) });
  Object.values(porCat).forEach(s => expect(s.size).toBe(1));                 // uma cor por categoria
  expect(new Set(Object.values(porCat).map(s => [...s][0])).size).toBe(8);   // e oito cores diferentes
  const leg = await page.evaluate(() => uctItensLegenda(_ucsFeaturesVisiveis(), 0.4).map(i => i.label));
  expect(leg).toContain('UC — Reserva Extrativista');
  // mudar a cor de uma categoria
  await page.click('[data-uct-cor="categoria:Reserva Extrativista"]');
  await page.click('[data-uct-paleta] [data-uct-escolher="#CC79A7"]');
  const resex = (await fillsUC(page)).filter(x => x[0] === 'Reserva Extrativista').map(x => x[2]);
  expect(new Set(resex)).toEqual(new Set(['#CC79A7']));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('siguc_uc_cores_tipo')).categoria['Reserva Extrativista'])).toBe('#CC79A7');
});

test('filtros juntos: categoria oculta + esfera desligada; voltar a "Cada UC" mantém o filtro', async ({ page }) => {
  await abrirUC(page);
  const gj = await page.evaluate(() => _ucGeojson.features.map(f => f.properties));
  expect(await nUC(page)).toBe(gj.length);
  await page.click('[data-uct-modo="categoria"]');
  // só Florestas: oculta todas as categorias menos Floresta Estadual/Nacional
  const cats = [...new Set(gj.map(p => p.categoria))].filter(c => !c.startsWith('Floresta'));
  for (const c of cats) await page.uncheck(`[data-uct-mostrar="categoria:${c}"]`);
  expect(await nUC(page)).toBe(gj.filter(p => p.categoria.startsWith('Floresta')).length);
  // + só estaduais (pelo modo Esfera, que usa o filtro de sempre)
  await page.click('[data-uct-modo="esfera"]');
  await page.uncheck('[data-uct-mostrar="esfera:federal"]');
  await page.uncheck('[data-uct-mostrar="esfera:municipal"]');
  expect(await page.evaluate(() => _ucEsfFed)).toBe(false);
  const so = gj.filter(p => p.categoria.startsWith('Floresta') && p.esfera === 'estadual');
  expect(so.length).toBeGreaterThan(0);
  expect(await nUC(page)).toBe(so.length);
  // cor por esfera: todas iguais (só estaduais)
  expect(new Set((await fillsUC(page)).map(x => x[2])).size).toBe(1);
  // volta a "Cada UC": filtro continua, cores individuais voltam
  await page.click('[data-uct-modo="uc"]');
  await expect(page.locator('#uc-controles')).toBeVisible();
  expect(await nUC(page)).toBe(so.length);
  const individuais = await page.evaluate(() => _ucLayer.getLayers().map(l => l.options.fillColor === _ucCorNome(l.feature.properties.nome, l.feature.properties.cor)));
  expect(individuais.every(Boolean)).toBe(true);
  // preferências guardam modo e filtros
  const pref = await page.evaluate(() => _prefsCapturar().uc_tipos);
  expect(pref.modo).toBe('uc');
  expect(pref.ocultos.length).toBe(cats.length);
});
