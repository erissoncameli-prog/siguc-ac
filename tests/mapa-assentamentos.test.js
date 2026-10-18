// ── Mapa das UCs · Projetos de Assentamento (INCRA) ─────────────────
// Executar: npx playwright test tests/mapa-assentamentos.test.js
// (servidor estático na raiz do repo — http://localhost:5500)
//
// Trava: arquivo gerado pelo script (110 PAs, modalidades, as DUAS áreas),
// a seção liga/desliga, o resumo bate com o arquivo, o filtro por
// modalidade recorta mapa + resumo + legenda, a janela mostra os campos e
// a fonte, e pages/mapa.html está ligado ao módulo (seção, legenda,
// preferências, contador).

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
const BASE = process.env.BASE_URL || process.env.TEST_BASE_URL || 'http://localhost:5500';
const RAIZ = path.join(__dirname, '..');
const GJ = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/assentamentos_acre.geojson'), 'utf8'));

async function abrir(page) {
  await page.route('**/*.tile.openstreetmap.org/**', r => r.abort());
  await page.goto(`${BASE}/tests/fixtures/mapa-assentamentos-harness.html`);
  await page.waitForFunction(() => typeof togglePA === 'function' && window.mapaL);
}

test('arquivo: 110 assentamentos, modalidades e as duas áreas', () => {
  expect(GJ.features).toHaveLength(110);
  const mods = {};
  GJ.features.forEach(f => { mods[f.properties.modalidade] = (mods[f.properties.modalidade] || 0) + 1 });
  expect(mods).toEqual({ PA: 77, PDS: 16, PAE: 13, PAF: 4 });
  const p = GJ.features.find(f => f.properties.cd_sipra === 'AC0016000').properties;
  expect(p).toMatchObject({ nome: 'CHICO MENDES', modalidade: 'PAE', municipio: 'Xapuri', fase: 7, fase_nome: 'Consolidado', criado_em: '1989-03-08' });
  expect(p.area_ato_ha).toBeGreaterThan(0);
  expect(p.area_poligono_ha).toBeGreaterThan(0);
  expect(GJ.metadata.fonte).toContain('INCRA');
});

test('liga a camada: polígonos no mapa, contador e resumo batendo com o arquivo', async ({ page }) => {
  await abrir(page);
  await page.check('#pa-toggle');
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length > 0);
  expect(await page.locator('.leaflet-overlay-pane path').count()).toBe(110);
  await expect(page.locator('#pa-count-badge')).toHaveText('110');
  const area = GJ.features.reduce((s, f) => s + f.properties.area_poligono_ha, 0);
  const fam = GJ.features.reduce((s, f) => s + (f.properties.familias || 0), 0);
  await expect(page.locator('#pa-res-total')).toHaveText('110');
  await expect(page.locator('#pa-res-fam')).toHaveText(fam.toLocaleString('pt-BR'));
  await expect(page.locator('#pa-res-area')).toHaveText((area / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  expect(await page.evaluate(() => paItemLegenda()?.label)).toBe('Projetos de Assentamento (INCRA)');
  await page.uncheck('#pa-toggle');
  expect(await page.locator('.leaflet-overlay-pane path').count()).toBe(0);
  expect(await page.evaluate(() => paItemLegenda())).toBeNull();
});

test('filtro por modalidade recorta mapa e resumo', async ({ page }) => {
  await abrir(page);
  await page.check('#pa-toggle');
  await page.waitForSelector('[data-pa-mod="PA"]');
  await page.uncheck('[data-pa-mod="PA"]');
  expect(await page.locator('.leaflet-overlay-pane path').count()).toBe(33);
  await expect(page.locator('#pa-res-total')).toHaveText('33');
  await expect(page.locator('#pa-stat')).toHaveText('33 de 110 assentamentos no filtro');
  expect(await page.evaluate(() => window._prefsAgendado)).toBe(true);
  await page.check('[data-pa-mod="PA"]');
  expect(await page.locator('.leaflet-overlay-pane path').count()).toBe(110);
});

test('janela do assentamento: campos, as duas áreas, aviso de divergência e fonte', async ({ page }) => {
  await abrir(page);
  const html = await page.evaluate(() => {
    const f = _paGeojson ? null : null
    return fetch('../../data/assentamentos_acre.geojson').then(r => r.json()).then(gj => ({
      normal: paPopupHTML(gj.features.find(x => x.properties.cd_sipra === 'AC0016000').properties),
      diverge: paPopupHTML(gj.features.find(x => x.properties.cd_sipra === 'AC0058000').properties),  // PA TAQUARI
      xss: paPopupHTML({ nome_completo: '<img src=x onerror=alert(1)>', modalidade: 'PA' }),
    }));
  });
  expect(html.normal).toContain('PAE — Assentamento Agroextrativista');
  expect(html.normal).toContain('AC0016000');
  expect(html.normal).toContain('Xapuri');
  expect(html.normal).toContain('7 — Consolidado');
  expect(html.normal).toContain('08/03/1989');
  expect(html.normal).toContain('INCRA — Acervo Fundiário');
  expect(html.normal).not.toContain('divergem');
  expect(html.diverge).toContain('Área no ato');
  expect(html.diverge).toContain('Área do polígono');
  expect(html.diverge).toContain('divergem mais de 10%');
  expect(html.xss).not.toContain('<img');
});

test('estilo: cor e nomes aplicados à camada e lembrados', async ({ page }) => {
  await abrir(page);
  await page.check('#pa-toggle');
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length === 110);
  await page.evaluate(() => { const e = document.getElementById('pa-cor-linha'); e.value = '#ff0000'; e.dispatchEvent(new Event('input')) });
  expect(await page.locator('.leaflet-overlay-pane path').first().getAttribute('stroke')).toBe('#ff0000');
  await page.click('.ap-bloco[data-ap-chave="pa"] summary'); // bloco Aparência nasce recolhido
  await page.check('#pa-nomes');
  await expect(page.locator('.leaflet-tooltip').first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('siguc_pa_estilo')).cor)).toBe('#ff0000');
});

test('pages/mapa.html ligado ao módulo', () => {
  const html = fs.readFileSync(path.join(RAIZ, 'pages/mapa.html'), 'utf8');
  expect(html).toContain('<script src="../js/mapa-assentamentos.js"></script>');
  expect(html).toContain("sec('pa', 'Projetos de Assentamento'");
  expect(html).toContain('paSecaoHTML()');
  expect(html).toContain('id="pa-count-badge"');
  expect(html).toContain('paItemLegenda()');          // legenda da tela e da impressão
  expect(html).toContain('paPrefsCapturar()');        // preferências na nuvem
  expect(html).toContain('paPrefsAplicar(dados.pa)');
  expect(html).toContain('paAtualizarPainel()');      // sincroniza ao abrir a guia
});
