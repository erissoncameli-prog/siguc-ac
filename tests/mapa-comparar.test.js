// ── Mapa das UCs · comparação de imagens (js/mapa-comparar.js) ──
// Executar: npx playwright test tests/mapa-comparar.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Página REAL (pages/mapa.html). Os proxies /api/planet e /api/sentinel
// são trocados por stub que devolve tile de COR SÓLIDA (Planet vermelho,
// Sentinel azul), e a verificação é por PIXEL — mesma técnica de
// tests/mapa-telacheia.test.js: o recorte 1×1 é comparado, byte a byte,
// com o de um quadrado de referência pintado na própria página. Assim o
// teste prova o que foi PINTADO, não o que o layout diz.
// Trava: cada lado mostra a sua imagem; o recorte acompanha o divisor E o
// pan do mapa; teclado move o divisor; Esc sai sem mexer no painel; camada
// do painel só gera aviso (decisão do usuário), nunca é desligada.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
test.use({ viewport: { width: 1366, height: 768 } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const VENDOR = path.join(__dirname, 'fixtures', 'vendor');

// PNG 256×256 de uma cor só (RGB, sem alpha), montado à mão.
function pngSolido([r, g, b]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 });
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 };
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii'), len = Buffer.alloc(4), c = Buffer.alloc(4)
    len.writeUInt32BE(dados.length); c.writeUInt32BE(crc(Buffer.concat([t, dados])))
    return Buffer.concat([len, t, dados, c])
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2
  const linha = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 256 }, () => [r, g, b]).flat())])
  const cru = Buffer.concat(Array.from({ length: 256 }, () => linha))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(cru)), bloco('IEND', Buffer.alloc(0))])
}
const VERMELHO = [220, 20, 20], AZUL = [20, 40, 220]
const PNG_PLANET = pngSolido(VERMELHO), PNG_S2 = pngSolido(AZUL)

async function abrir(page, { semPlanet = false, s2Motivo = null } = {}) {
  await page.addInitScript(() => {
    const mk = pend => { const f = function () {}; const p = new Proxy(f, { get(t, k) { if (k === 'then') return pend ? () => {} : r => r({ data: null, error: null }); if (k === 'auth') return mk(true); return mk(pend) }, apply() { return p } }); return p };
    window.supabase = { createClient: () => mk(false) };
  });
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await page.route('**/*.tile.openstreetmap.org/**', r => r.abort());
  await page.route('**/mt*.google.com/**', r => r.abort());
  await page.route('**/storage.googleapis.com/**', r => r.abort());
  await page.route('**/terrabrasilis.dpi.inpe.br/**', r => r.fulfill({ body: PNG_S2, contentType: 'image/png' }));
  await page.route('**/unpkg.com/**', r => r.abort());
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.css'), contentType: 'text/css' }));
  await page.route('**/api/**', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/api/planet' && u.searchParams.get('op') === 'mosaics' && semPlanet) {
      return r.fulfill({ json: { disponivel: false, recente: null, motivo: 'conta-sem-mosaicos', mosaicos: [] } });
    }
    if (u.pathname === '/api/sentinel' && u.searchParams.get('bbox') && s2Motivo) return r.fulfill({ json: { disponivel: false, motivo: s2Motivo, datas: [] } });
    if (u.pathname === '/api/planet' && u.searchParams.get('op') === 'mosaics') {
      return r.fulfill({ json: { disponivel: true, recente: { name: 'm2026-09', label: 'set/2026', data: '2026-09' }, mosaicos: [
        { name: 'm2026-09', label: 'set/2026', data: '2026-09' },
        { name: 'm2025-09', label: 'set/2025', data: '2025-09' },
        { name: 'm2024-09', label: 'set/2024', data: '2024-09' },
      ] } });
    }
    if (u.pathname === '/api/planet') return r.fulfill({ body: PNG_PLANET, contentType: 'image/png' });
    if (u.pathname === '/api/sentinel' && u.searchParams.get('bbox')) return r.fulfill({ json: { disponivel: true, dias: 60, datas: [{ data: '2026-09-10', nuvem: 4.2 }] } });
    if (u.pathname === '/api/sentinel') return r.fulfill({ body: PNG_S2, contentType: 'image/png' });
    return r.abort();
  });
  await page.goto(`${BASE}/pages/mapa.html`);
  await page.waitForFunction(() => typeof renderPagina === 'function' && typeof L !== 'undefined' && typeof cmpMontar === 'function');
  await page.evaluate(() => {
    appState.perfil = 'super_admin'; appState.usuario = { id: 'u1', nome_completo: 'Teste' };
    document.getElementById('app').innerHTML = gerarLayout('Mapa das UCs', 'mapa') + renderPagina() + '</div></div></div>';
    if (!L.Control.MiniMap) L.Control.MiniMap = L.Control.extend({ onAdd() { return L.DomUtil.create('div') } });
    if (!L.markerClusterGroup) L.markerClusterGroup = () => L.layerGroup();
    iniciarMapa();
  });
  await page.waitForFunction(() => _ucLayer && _ucLayer.getLayers().length > 0);
}

// Tira do mapa tudo o que pinta por cima das imagens, para o pixel ser só do tile.
async function limparVetores(page) {
  await page.evaluate(() => {
    toggleUC(false);
    mapaL.eachLayer(l => { if (l instanceof L.Path || l instanceof L.Tooltip) mapaL.removeLayer(l) });
    // quadrados de referência fora do mapa, com as cores exatas dos tiles
    for (const [id, c] of [['ref-vermelho', 'rgb(220,20,20)'], ['ref-azul', 'rgb(20,40,220)']]) {
      const d = document.createElement('div'); d.id = id
      d.style.cssText = `position:fixed;z-index:99999;width:6px;height:6px;top:2px;left:${id === 'ref-azul' ? 12 : 2}px;background:${c}`
      document.body.appendChild(d)
    }
  });
}

const px = (page, x, y) => page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });

async function caixaMapa(page) { return page.evaluate(() => { const r = mapaL.getContainer().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }) }

async function abrirComparacaoPlanetXSentinel(page) {
  await page.click('.cmp-abrir');
  await expect(page.locator('.cmp-painel')).toBeVisible();
  await page.selectOption('[data-cmp-fonte="dir"]', 'sentinel');
  await esperarTiles(page);
}

// 'load' da camada chega antes do fade dos tiles (Leaflet anima a opacidade):
// espera os tiles das duas panes estarem opacos de fato.
async function esperarTiles(page) {
  await page.waitForFunction(() => {
    if (_cmp.lados.esq.carregando || _cmp.lados.dir.carregando || !_cmp.lados.esq.ok || !_cmp.lados.dir.ok) return false
    const imgs = [...document.querySelectorAll('.leaflet-cmpEsquerda-pane img, .leaflet-cmpDireita-pane img')]
    return imgs.length > 0 && imgs.every(i => getComputedStyle(i).opacity === '1')
  });
}

test('cada lado pinta a sua imagem e o recorte acompanha o divisor e o pan', async ({ page }) => {
  await abrir(page);
  await limparVetores(page);
  await abrirComparacaoPlanetXSentinel(page);
  const R = await px(page, 3, 3), A = await px(page, 13, 3);
  const m = await caixaMapa(page);
  const y = m.y + m.h * 0.35;
  expect((await px(page, m.x + m.w * 0.25, y)).equals(R), 'esquerda = Planet').toBe(true);
  expect((await px(page, m.x + m.w * 0.75, y)).equals(A), 'direita = Sentinel').toBe(true);

  // arrastar o divisor para 85%: o ponto em 75% passa a ser da esquerda
  const d = await page.locator('.cmp-pega').boundingBox();
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(m.x + m.w * 0.85, d.y + d.height / 2, { steps: 6 });
  await page.mouse.up();
  await esperarTiles(page);
  expect((await px(page, m.x + m.w * 0.75, y)).equals(R), 'depois de arrastar').toBe(true);
  expect(await page.evaluate(() => mapaL.dragging.enabled()), 'arrasto do mapa restaurado').toBe(true);

  // pan do mapa: a divisa continua no divisor (coordenada de camada)
  await page.evaluate(() => mapaL.panBy([-300, 120], { animate: false }));
  await esperarTiles(page);
  const xd = m.x + m.w * 0.85;
  expect((await px(page, xd - 20, y)).equals(R), 'pan: à esquerda do divisor').toBe(true);
  expect((await px(page, xd + 20, y)).equals(A), 'pan: à direita do divisor').toBe(true);
});

test('teclado move o divisor; Esc sai e devolve o mapa sem recorte', async ({ page }) => {
  await abrir(page);
  await abrirComparacaoPlanetXSentinel(page);
  const div = page.locator('.cmp-divisor');
  await expect(div).toHaveAttribute('role', 'slider');
  await div.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await expect(div).toHaveAttribute('aria-valuenow', '40');
  await page.keyboard.press('End');
  await expect(div).toHaveAttribute('aria-valuenow', '98');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmp-painel')).toHaveCount(0);
  await expect(page.locator('.cmp-divisor')).toHaveCount(0);
  const r = await page.evaluate(() => ({ clip: mapaL.getPane('cmpEsquerda').style.clip + mapaL.getPane('cmpDireita').style.clip,
    camadas: Object.values(_cmp.lados).filter(Boolean).length, botao: document.querySelector('.cmp-abrir').getAttribute('aria-pressed') }));
  expect(r).toEqual({ clip: '', camadas: 0, botao: 'false' });
});

test('camada do painel só gera aviso e nunca é desligada; mesma imagem avisa', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => toggleCamadaVeg('mapbiomas', true));
  await page.click('.cmp-abrir');
  await expect(page.locator('.cmp-avisos')).toContainText('MapBiomas');
  expect(await page.evaluate(() => mapaL.hasLayer(VEG_LAYERS.mapbiomas.layer))).toBe(true);
  // usuário desliga no painel → o aviso some sozinho
  await page.evaluate(() => toggleCamadaVeg('mapbiomas', false));
  await expect(page.locator('.cmp-avisos')).not.toContainText('MapBiomas');
  // mesma imagem dos dois lados
  const esq = await page.locator('[data-cmp-valor="esq"]').inputValue();
  await page.selectOption('[data-cmp-valor="dir"]', esq);
  await expect(page.locator('.cmp-avisos')).toContainText('Mesma imagem');
  // sair não religa nem desliga nada do painel
  await page.evaluate(() => toggleCamadaVeg('mapbiomas', true));
  await page.click('[data-cmp-acao="sair"]');
  expect(await page.evaluate(() => mapaL.hasLayer(VEG_LAYERS.mapbiomas.layer))).toBe(true);
});

test('padrão Planet recente × 2 anos antes; Sentinel oferece época seca e cenas; PRODES por ano', async ({ page }) => {
  await abrir(page);
  await page.click('.cmp-abrir');
  await expect(page.locator('[data-cmp-valor="esq"]')).toHaveValue('m2024-09');
  await expect(page.locator('[data-cmp-valor="dir"]')).toHaveValue('m2026-09');
  await expect(page.locator('.cmp-tag-dir')).toHaveText('Planet · set/2026');
  await page.selectOption('[data-cmp-fonte="dir"]', 'sentinel');
  await expect(page.locator('[data-cmp-valor="dir"] option[value="data:2026-09-10"]')).toHaveCount(1);
  await expect(page.locator('[data-cmp-valor="dir"]')).toHaveValue(`ano:${new Date().getFullYear() - 1}`);
  expect(await page.locator('[data-cmp-valor="dir"] option[value^="ano:"]').count()).toBeGreaterThan(5);
  await page.selectOption('[data-cmp-fonte="esq"]', 'prodes');
  // PRODES abre no ACUMULADO (é o que mostra mudança entre dois anos)
  await expect(page.locator('[data-cmp-status="esq"]')).toContainText('desmatado até o ano');
  const wms = await page.evaluate(() => _cmp.lados.esq.layer.wmsParams);
  expect(wms.CQL_FILTER).toMatch(/^INCLUDE;year<=\d{4}$/);
  expect(wms.layers.split(',')).toHaveLength(2);
  const anoSo = await page.evaluate(() => _cmp.prodesAnos[0]);
  await page.selectOption('[data-cmp-valor="esq"]', `ano:${anoSo}`);
  expect(await page.evaluate(() => _cmp.lados.esq.layer.wmsParams.CQL_FILTER)).toBe(`year=${anoSo}`);
  await expect(page.locator('[data-cmp-status="esq"]')).toContainText('aproxime o zoom');
  // painel por cima dos controles do Leaflet (legenda, informações) — senão fica coberto
  const zp = await page.evaluate(() => [getComputedStyle(document.querySelector('.cmp-painel')).zIndex, getComputedStyle(document.querySelector('.leaflet-bottom')).zIndex].map(Number));
  expect(zp[0]).toBeGreaterThan(zp[1]);
  // a imagem fica acima do tilePane e abaixo das camadas vetoriais
  const z = await page.evaluate(() => [mapaL.getPane('tilePane'), mapaL.getPane('cmpEsquerda'), mapaL.getPane('overlayPane')].map(p => Number(getComputedStyle(p).zIndex)));
  expect(z[0]).toBeLessThan(z[1]);
  expect(z[1]).toBeLessThan(z[2]);
});

test('no imersivo funciona e Esc sai da comparação sem sair da tela cheia; imprimir encerra', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => toggleTelaCheia());
  await page.waitForFunction(() => _mapaImersivo === true);
  await page.click('.cmp-abrir');
  await expect(page.locator('.cmp-painel')).toBeVisible();
  await expect(page.locator('.cmp-pega')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmp-painel')).toHaveCount(0);
  expect(await page.evaluate(() => _mapaImersivo)).toBe(true);
  await page.click('.cmp-abrir');
  await expect(page.locator('.cmp-painel')).toBeVisible();
  await page.evaluate(() => { try { CART.imprimir('t') } catch (_) {} });
  await expect(page.locator('.cmp-painel')).toHaveCount(0);
});

test('Sentinel com credencial recusada: aviso diz a causa; sem Planet, abre em PRODES acumulado', async ({ page }) => {
  await abrir(page, { semPlanet: true, s2Motivo: 'token-http-401' });
  await page.click('.cmp-abrir');
  const anos = await page.evaluate(() => _cmp.prodesAnos);
  await expect(page.locator('[data-cmp-valor="dir"]')).toHaveValue(`ate:${anos[0]}`);
  expect(await page.evaluate(() => _cmp.lados.esq.valor)).toMatch(/^ate:\d{4}$/);
  await expect(page.locator('[data-cmp-fonte="dir"] option[value="sentinel"]')).toContainText('fora do ar');
  await page.selectOption('[data-cmp-fonte="dir"]', 'sentinel');
  await expect(page.locator('[data-cmp-status="dir"]')).toContainText('fora do ar');
  await expect(page.locator('.cmp-avisos')).toContainText('token-http-401');
  await expect(page.locator('.cmp-avisos')).toContainText('CDSE_CLIENT_ID');
  // dois lados "só o ano": o aviso explica por que não parece mudar
  await page.selectOption('[data-cmp-fonte="dir"]', 'prodes');
  await page.selectOption('[data-cmp-valor="dir"]', `ano:${anos[0]}`);
  await page.selectOption('[data-cmp-valor="esq"]', `ano:${anos[3]}`);
  await expect(page.locator('.cmp-avisos')).toContainText('Desmatado até');
});
