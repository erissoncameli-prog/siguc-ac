// ── Mapa das UCs · camada enviada em KML/KMZ (js/mapa-kml.js) ──
// Executar: npx playwright test tests/mapa-camadas-kml.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html), banco falso; arquivo entregue pelo próprio
// <input type=file> do modal "Nova camada". Trava:
// - .kml e .kmz entram (KMZ com doc.kml + KML interno referenciado);
// - altitude descartada, polígono com furo e MultiGeometry preservados;
// - tabela HTML da descrição vira atributo (é o que deixa o gatilho da
//   migration 367 achar o CPF pelo nome da coluna);
// - HTML da descrição vira TEXTO: nada de <script>/<img onerror> no popup;
// - estilo do KML não vai para o banco; pasta vira atributo;
// - imagem sobreposta, link externo e marcador sem geometria são contados.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
test.use({ viewport: { width: 1366, height: 768 } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const VENDOR = path.join(__dirname, 'fixtures', 'vendor');
const JSZIP = require.resolve('jszip/dist/jszip.min.js');

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document><name>Lotes do Afluente.kml</name>
  <Style id="s1"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style>
  <Folder><name>Setor Norte</name>
    <Placemark><name>Lote 7</name><styleUrl>#s1</styleUrl>
      <description><![CDATA[<table><tr><th colspan="2">Lotes</th></tr><tr><td><table>
        <tr><td>Num_Lote</td><td>7</td></tr><tr><td>CPF</td><td>123.456.789-01</td></tr>
        <tr><td>Area_ha</td><td>12,5</td></tr></table></td></tr></table>]]></description>
      <Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>
        -68.0,-10.0,150 -67.99,-10.0,150 -67.99,-9.99,150 -68.0,-9.99,150 -68.0,-10.0,150
      </coordinates></LinearRing></outerBoundaryIs>
      <innerBoundaryIs><LinearRing><coordinates>
        -67.997,-9.997,0 -67.993,-9.997,0 -67.993,-9.993,0 -67.997,-9.993,0 -67.997,-9.997,0
      </coordinates></LinearRing></innerBoundaryIs></Polygon>
    </Placemark>
  </Folder>
  <Placemark><name>Trilha</name>
    <description><![CDATA[Acesso pela <b>estrada</b><br>com chuva <script>window._xss=1</script><img src=x onerror="window._xss=2">]]></description>
    <ExtendedData><Data name="Situacao"><value>Aberta</value></Data></ExtendedData>
    <MultiGeometry>
      <LineString><coordinates>-67.98,-10.0,10 -67.97,-9.99,12</coordinates></LineString>
      <Point><coordinates>-67.975,-9.995,0</coordinates></Point>
    </MultiGeometry>
  </Placemark>
  <Placemark><name>Sem geometria</name></Placemark>
  <GroundOverlay><name>Foto</name><Icon><href>foto.jpg</href></Icon>
    <LatLonBox><north>-9.9</north><south>-10</south><east>-67.9</east><west>-68</west></LatLonBox></GroundOverlay>
  <NetworkLink><name>Externo</name><Link><href>https://exemplo.org/outro.kml</href></Link></NetworkLink>
</Document></kml>`;

const KML_INTERNO = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Ponto interno</name><Point><coordinates>-67.9,-9.9,5</coordinates></Point></Placemark>
</Document></kml>`;
const DOC_KMZ = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Pacote</name>
  <Placemark><name>Ponto principal</name><Point><coordinates>-67.8,-9.8</coordinates></Point></Placemark>
  <NetworkLink><Link><href>files/interno.kml</href></Link></NetworkLink>
</Document></kml>`;

async function abrir(page) {
  await page.addInitScript(() => {
    const mk = pend => { const f = function () {}; const p = new Proxy(f, { get(t, k) { if (k === 'then') return pend ? () => {} : r => r({ data: null, error: null }); if (k === 'auth') return mk(true); return mk(pend) }, apply() { return p } }); return p };
    window.supabase = { createClient: () => mk(false) };
  });
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await page.route('**/cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', r => r.fulfill({ path: JSZIP, contentType: 'application/javascript' }));
  await page.route('**/*.tile.openstreetmap.org/**', r => r.abort());
  await page.route('**/mt*.google.com/**', r => r.abort());
  await page.route('**/unpkg.com/**', r => r.abort());
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.css'), contentType: 'text/css' }));
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof renderPagina === 'function' && typeof L !== 'undefined' && typeof kmlLerArquivo === 'function' && typeof JSZip !== 'undefined');
  await page.evaluate(() => {
    appState.perfil = 'super_admin'; appState.usuario = { id: 'u1', nome_completo: 'Teste' }; appState.permissoes = {};
    document.getElementById('app').innerHTML = gerarLayout('Mapa das UCs', 'mapa') + renderPagina() + '</div></div></div>';
    if (!L.Control.MiniMap) L.Control.MiniMap = L.Control.extend({ onAdd() { return L.DomUtil.create('div') } });
    if (!L.markerClusterGroup) L.markerClusterGroup = () => L.layerGroup();
    iniciarMapa();
    window._inserts = [];
    db = { from: () => ({ insert: row => { window._inserts.push(row); const d = { id: 'nova', ...row }; return { select: () => ({ single: async () => ({ data: d, error: null }) }) } } }), rpc: async () => ({ data: [], error: null }) };
    camadas = [];
    abrirModalNovaCamada();
  });
}

async function enviar(page, name, buffer, mimeType) {
  await page.locator('#nc-arquivo').setInputFiles({ name, mimeType, buffer });
  await expect(page.locator('#nc-arquivo-status')).toContainText(/✓|Erro|Nenhuma/, { timeout: 10000 });
  return page.locator('#nc-arquivo-status').innerText();
}

test('o campo de arquivo aceita .kml e .kmz', async ({ page }) => {
  await abrir(page);
  expect(await page.locator('#nc-arquivo').getAttribute('accept')).toMatch(/\.kml/);
  expect(await page.locator('#nc-arquivo').getAttribute('accept')).toMatch(/\.kmz/);
});

test('KML: geometria 2D, furo, MultiGeometry, tabela da descrição e o que ficou de fora', async ({ page }) => {
  await abrir(page);
  const status = await enviar(page, 'lotes.kml', Buffer.from(KML), 'application/vnd.google-earth.kml+xml');
  expect(status).toContain('2 geometrias');
  expect(status).toContain('1 imagem sobreposta');
  expect(status).toContain('1 link para KML externo');
  expect(status).toContain('1 marcador sem geometria');
  expect(await page.locator('#nc-nome').inputValue()).toBe('Lotes do Afluente');

  const g = await page.evaluate(() => _novaCamadaGeoJson);
  const [lote, trilha] = g.features;
  expect(lote.geometry.type).toBe('Polygon');
  expect(lote.geometry.coordinates).toHaveLength(2); // contorno + furo
  expect(lote.geometry.coordinates.flat().every(c => c.length === 2)).toBe(true);
  expect(lote.properties).toMatchObject({ name: 'Lote 7', Num_Lote: '7', CPF: '123.456.789-01', Area_ha: '12,5', pasta: 'Setor Norte' });
  expect(lote.properties.descricao).toBeUndefined(); // descrição era só a tabela
  for (const k of ['stroke', 'stroke-width', 'styleUrl', 'description']) expect(lote.properties).not.toHaveProperty(k);

  expect(trilha.geometry.type).toBe('GeometryCollection');
  expect(JSON.stringify(trilha.geometry)).not.toMatch(/,1[02]\]/); // altitude 10/12 descartada
  expect(trilha.properties.Situacao).toBe('Aberta');
  expect(trilha.properties.descricao).toBe('Acesso pela estrada\ncom chuva');
  expect(trilha.properties).not.toHaveProperty('pasta');
});

test('HTML da descrição nunca é interpretado, nem na leitura nem no popup', async ({ page }) => {
  await abrir(page);
  await enviar(page, 'lotes.kml', Buffer.from(KML), 'application/vnd.google-earth.kml+xml');
  const r = await page.evaluate(async () => {
    const c = { id: 'k', nome: 'K', cor: '#16a34a', visivel: true, layer: null, feature_colors: {}, style_config: {}, geojson: _novaCamadaGeoJson };
    camadas = [c]; _renderizarCamada(c);
    c.layer.getLayers()[1].openPopup?.();
    await new Promise(r => setTimeout(r, 300));
    return { xss: window._xss, html: document.querySelector('.leaflet-popup-content')?.innerHTML || '' };
  });
  expect(r.html).toContain('Acesso pela estrada'); // o popup abriu de verdade
  expect(r.xss).toBeUndefined();
  expect(r.html).not.toMatch(/<script|onerror/i);
});

test('KMZ: doc.kml + KML interno do pacote, e salvar grava o GeoJSON convertido', async ({ page }) => {
  await abrir(page);
  const JSZipNode = require('jszip');
  const z = new JSZipNode();
  z.file('doc.kml', DOC_KMZ); z.file('files/interno.kml', KML_INTERNO);
  const buf = await z.generateAsync({ type: 'nodebuffer' });
  const status = await enviar(page, 'pacote.kmz', buf, 'application/vnd.google-earth.kmz');
  expect(status).toContain('2 geometrias');
  expect(status).not.toContain('não importado'); // link interno não é "ignorado"
  const nomes = await page.evaluate(() => _novaCamadaGeoJson.features.map(f => f.properties.name));
  expect(nomes).toEqual(['Ponto principal', 'Ponto interno']);
  expect(await page.locator('#nc-nome').inputValue()).toBe('Pacote');

  await page.evaluate(() => salvarNovaCamada());
  await expect.poll(() => page.evaluate(() => window._inserts.length)).toBe(1);
  const ins = await page.evaluate(() => window._inserts[0]);
  expect(ins.nome).toBe('Pacote');
  expect(ins.geojson.features[1].geometry).toEqual({ type: 'Point', coordinates: [-67.9, -9.9] });
});

test('KML inválido diz o motivo e não deixa nada pronto para salvar', async ({ page }) => {
  await abrir(page);
  const status = await enviar(page, 'quebrado.kml', Buffer.from('<kml><Document><Placemark>'), 'application/vnd.google-earth.kml+xml');
  expect(status).toContain('Erro no KML');
  expect(await page.evaluate(() => _novaCamadaGeoJson)).toBeNull();
});
