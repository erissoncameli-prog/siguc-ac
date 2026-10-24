// ── Mapa das UCs · popup e cor por atributo das camadas (js/mapa-camadas-config.js) ──
// Executar: npx playwright test tests/mapa-camadas-config.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html), banco falso, camada injetada em `camadas`.
// Trava o que não pode voltar:
// - campo técnico e `_siguc_pid` nunca aparecem no popup;
// - medida calculada sempre rotulada "não registrais";
// - dado pessoal só por "Ver dados pessoais" → RPC camada_dados_pessoais,
//   e só para quem pode editar o mapa (sem permissão: aviso, sem botão);
// - o editor muda o popup e a cor por atributo, e a legenda segue as classes;
// - a migration 367 continua tirando CPF/nome do GeoJSON público.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
test.use({ viewport: { width: 1366, height: 768 } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const VENDOR = path.join(__dirname, 'fixtures', 'vendor');

const quad = (x, y, d) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
const CAMADA = {
  id: 'cam-1', nome: 'Lotes de teste', cor: '#16a34a', visivel: true, layer: null, uc_id: null, unidades_conservacao: null,
  feature_colors: {}, style_config: {},
  geojson: { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: quad(-68.0, -10.0, 0.01), properties: { Num_Lote: 7, Zona: 'ZPI', Area_ha: 123.4567, tessellate: -1, _siguc_pid: '11111111-1111-1111-1111-111111111111' } },
    { type: 'Feature', geometry: quad(-67.98, -10.0, 0.01), properties: { Num_Lote: 8, Zona: 'ZUS', Area_ha: 50, tessellate: -1 } },
    { type: 'Feature', geometry: quad(-67.96, -10.0, 0.01), properties: { Num_Lote: 9, Zona: 'ZUS', Area_ha: '', tessellate: -1 } },
  ] },
};

async function abrir(page, { perfil = 'super_admin', permissoes = {} } = {}) {
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
  await page.waitForFunction(() => typeof renderPagina === 'function' && typeof L !== 'undefined' && typeof ccfPopupHTML === 'function');
  await page.evaluate(({ perfil, permissoes, camada }) => {
    appState.perfil = perfil; appState.usuario = { id: 'u1', nome_completo: 'Teste' }; appState.permissoes = permissoes;
    document.getElementById('app').innerHTML = gerarLayout('Mapa das UCs', 'mapa') + renderPagina() + '</div></div></div>';
    if (!L.Control.MiniMap) L.Control.MiniMap = L.Control.extend({ onAdd() { return L.DomUtil.create('div') } });
    if (!L.markerClusterGroup) L.markerClusterGroup = () => L.layerGroup();
    iniciarMapa();
    window._rpcChamadas = [];
    db = { rpc: async (nome, args) => { window._rpcChamadas.push({ nome, args }); return { data: [{ campo: 'CPF', valor: '***.456.789-**' }, { campo: 'Nome_Ocupa', valor: 'Fulano de Tal' }], error: null } } };
    camadas = [JSON.parse(JSON.stringify(camada))];
    _renderizarCamada(camadas[0]);
    renderCamadasHtml();
    mapaL.fitBounds(camadas[0].layer.getBounds(), { animate: false });
  }, { perfil, permissoes, camada: CAMADA });
}

// Abre o popup da feição i e devolve o texto dele.
async function popup(page, i) {
  await page.evaluate(i => { mapaL.closePopup(); camadas[0].layer.getLayers()[i].openPopup() }, i);
  // o anterior ainda pode estar no fade de saída: o aberto agora é o último
  const el = page.locator('.leaflet-popup-content').last();
  await expect(el).toBeVisible();
  return el.innerText();
}

test('funções puras: formato, medidas e linhas sem campo técnico', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => {
    const c = { style_config: {} };
    const sem = ccfLinhas(c, { Num_Lote: 7, tessellate: -1, _siguc_pid: 'x', vazio: '', name: 'A' });
    const com = ccfLinhas({ style_config: { popup: { campos: [{ campo: 'Area_ha', rotulo: 'Área do lote', sufixo: ' ha', casas: 2 }, { campo: 'Num_Lote' }] } } },
      { Num_Lote: 7, Area_ha: 123.4567, Zona: 'ZPI' });
    const m = ccfMetricas({ type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] });
    const l = ccfMetricas({ type: 'LineString', coordinates: [[0, 0], [0, 0.01]] });
    return { sem, com, m, l, f: [ccfFormatar(1234.5), ccfFormatar('12,5', { casas: 1, sufixo: ' m' }), ccfFormatar('ZPI')] };
  });
  expect(r.sem).toEqual([{ rotulo: 'Num_Lote', valor: '7' }]);
  expect(r.com).toEqual([{ rotulo: 'Área do lote', valor: '123,46 ha' }, { rotulo: 'Num_Lote', valor: '7' }]);
  const k = 2 * Math.PI * 6371008.8 / 360 * 0.01;
  expect(Math.abs(r.m.areaHa / (k * k / 10000) - 1)).toBeLessThan(0.005);
  expect(Math.abs(r.m.perimetroM - 4 * k)).toBeLessThan(2);
  expect(Math.abs(r.l.comprimentoM - k)).toBeLessThan(0.5);
  expect(r.f).toEqual(['1.234,5', '12,5 m', 'ZPI']);
});

test('popup: sem campo técnico nem _siguc_pid, com medida "não registral"', async ({ page }) => {
  await abrir(page);
  const t = await popup(page, 0);
  expect(t).toContain('Num_Lote');
  expect(t).not.toContain('tessellate');
  expect(t).not.toContain('_siguc_pid');
  expect(t).not.toContain('11111111');
  expect(t).toContain('Área calculada');
  expect(t).toContain('não registrais');
  // feição sem dado pessoal não oferece nada
  const t2 = await popup(page, 1);
  expect(t2).not.toContain('dados pessoais');
});

test('dado pessoal: quem edita o mapa consulta pela RPC; quem não edita só vê o aviso', async ({ page }) => {
  await abrir(page, { perfil: 'super_admin' });
  await popup(page, 0);
  await page.click('[data-ccf-ver]');
  await expect(page.locator('.ccf-pessoal')).toContainText('***.456.789-**');
  await expect(page.locator('.ccf-pessoal')).toContainText('Acesso registrado');
  const chamadas = await page.evaluate(() => window._rpcChamadas);
  expect(chamadas).toEqual([{ nome: 'camada_dados_pessoais', args: { p_camada: 'cam-1', p_pid: '11111111-1111-1111-1111-111111111111' } }]);
});

test('sem permissão de editar o mapa: aviso de acesso restrito e nenhuma consulta', async ({ page }) => {
  await abrir(page, { perfil: 'tecnico', permissoes: { mapa: 'visualizar' } });
  const t = await popup(page, 0);
  expect(t).toContain('acesso restrito');
  await expect(page.locator('[data-ccf-ver]')).toHaveCount(0);
  expect(await page.evaluate(() => window._rpcChamadas.length)).toBe(0);
});

test('editor: colorir por atributo pinta por classe e a legenda acompanha; desmarcar campo some do popup', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => toggleExpandirCamada('cam-1'));
  const ed = page.locator('[data-ccf-editor="cam-1"]');
  await expect(ed).toBeVisible();
  await ed.locator('[data-ccf-acao="colorir"]').selectOption('Zona');
  await expect(page.locator('[data-ccf-editor="cam-1"] .ccf-classe')).toHaveCount(2);
  const cores = await page.evaluate(() => camadas[0].layer.getLayers().map(l => l.options.fillColor));
  expect(cores[1]).toBe(cores[2]);           // as duas ZUS com a mesma cor
  expect(cores[0]).not.toBe(cores[1]);       // ZPI diferente
  const leg = await page.evaluate(() => document.querySelector('.cart-legenda')?.innerText || '');
  expect(leg).toContain('Lotes de teste — ZUS');
  expect(leg).toContain('Lotes de teste — ZPI');
  // trocar a cor de uma classe muda o desenho
  await page.evaluate(() => { const i = document.querySelector('[data-ccf-editor="cam-1"] [data-ccf-acao="cor"][data-ccf-valor="ZPI"]'); i.value = '#123456'; i.dispatchEvent(new Event('input', { bubbles: true })) });
  expect(await page.evaluate(() => camadas[0].layer.getLayers()[0].options.fillColor)).toBe('#123456');
  // desmarcar Area_ha e renomear Num_Lote
  await page.locator('[data-ccf-editor="cam-1"] [data-ccf-campo="Area_ha"] [data-ccf-acao="mostrar"]').uncheck();
  await page.locator('[data-ccf-editor="cam-1"] [data-ccf-campo="Num_Lote"] [data-ccf-acao="rotulo"]').fill('Lote nº');
  const t = await popup(page, 0);
  expect(t).toContain('Lote nº');
  expect(t).not.toContain('Area_ha');
  // vai para o banco pelo "Salvar estilo" de sempre: está no style_config
  const sc = await page.evaluate(() => camadas[0].style_config);
  expect(sc.colorirPor.campo).toBe('Zona');
  expect(sc.popup.campos.map(x => x.campo)).not.toContain('Area_ha');
});

test('migration 367: CPF e nome saem do GeoJSON por trigger, leitura só pela RPC com log', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '367_camadas_mapa_dados_pessoais.sql'), 'utf8');
  expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF geojson ON public\.camadas_mapa/);
  expect(sql).toMatch(/REVOKE ALL ON public\.camadas_mapa_dados_pessoais FROM PUBLIC, anon, authenticated/);
  expect(sql).toMatch(/pode_editar\('mapa'\)/);
  expect(sql).toMatch(/car_mascarar_documento/);
  expect(sql).toMatch(/INSERT INTO public\.lgpd_acesso_dado_terceiro/);
  // nenhuma policy de leitura na tabela privada
  expect(sql).not.toMatch(/CREATE POLICY[^;]*camadas_mapa_dados_pessoais/);
});
