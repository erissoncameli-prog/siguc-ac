// ── SIGUC Biomonitor · tela cheia do mapa do relatório ────────────────
// Executar: npx playwright test tests/biomonitor-mapa-telacheia.test.js
//
// Pedido do usuário: botão para ver o mapa de pages/relatorios-biomonitor.html
// (aba Mapa) em tela cheia. O que este arquivo trava:
// 1. O botão existe no controle do mapa, com rótulo acessível, e alterna.
// 2. Em tela cheia o mapa ocupa a VIEWPORT inteira — não a caixa da
//    página. O .fade-in da página deixa transform no ancestral, que
//    prenderia o position:fixed (por isso o .mapa-outer vai para o <body>).
// 3. O painel do ninho (#mapa-slide-panel, irmão no <body>) continua por
//    cima da tela cheia — lição do Mapa das UCs (tests/mapa-telacheia.test.js).
// 4. Esc e o botão devolvem o mapa ao lugar original na página.
//
// Página real, Supabase stubado, CDNs servidos de tests/fixtures/vendor/
// (mesmo contorno de tests/rh-bacias.test.js).

const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500'
const CHROMIUM_PATH = '/opt/pw-browsers/chromium'
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } })
}
const VENDOR = path.join(__dirname, 'fixtures', 'vendor')

const USUARIO = { id: 'u-bio', nome_completo: 'Bióloga de Teste', email: 'b@x.invalid', perfil: 'gestor', ativo: true }
const PRAIAS = [{ id: 'p1', nome: 'Praia do Condado', sigla: 'PC', ninhos_total: 2, lat: -9.9, lng: -67.0,
  geojson: { type: 'Polygon', coordinates: [[[-67.01, -9.91], [-66.99, -9.91], [-66.99, -9.89], [-67.01, -9.89], [-67.01, -9.91]]] } }]
const NINHOS = [{ id: 'n1', numero_ninho: 'PC-TR-2026-001', especie: 'tracaja', status: 'transferido', praia_id: 'p1',
  praia_nome: 'Praia do Condado', lat: -9.9, lng: -67.0, data_encontro: '2026-08-11', qtd_ovos: 21 }]

async function abrirMapa(page) {
  await page.route('**/cdn.jsdelivr.net/**', r => {
    if (r.request().url().includes('chart')) return r.fulfill({ path: path.join(VENDOR, 'chart-4.5.1.umd.min.js'), contentType: 'application/javascript' })
    return r.abort()
  })
  await page.route('**/unpkg.com/leaflet@*/dist/leaflet.js', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.js'), contentType: 'application/javascript' }))
  await page.route('**/unpkg.com/leaflet@*/dist/leaflet.css', r => r.fulfill({ path: path.join(VENDOR, 'leaflet.css'), contentType: 'text/css' }))
  await page.route('**/unpkg.com/leaflet.heat**', r => r.fulfill({ body: 'L.heatLayer=function(){return L.layerGroup()}', contentType: 'application/javascript' }))
  await page.route('**/*.google.com/**', r => r.abort())
  await page.addInitScript(([usuario, praias, ninhos]) => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' })
    const rpcs = {
      bio_relatorio_completo: { kpis: { total_ninhos: 1 }, por_especie: [], por_praia: [], por_mes: [], por_ano: [] },
      bio_mapa_praias: praias, bio_mapa_ninhos: ninhos, bio_dashboard_praias: [],
      nivel_efetivo: 'editar',
    }
    const consulta = () => {
      const q = {
        select: () => q, in: () => q, order: () => q, limit: () => q, is: () => q, eq: () => q,
        gte: () => q, lte: () => q, not: () => q, or: () => q, range: () => q,
        single: async () => ({ data: usuario, error: null }),
        maybeSingle: async () => ({ data: usuario, error: null }),
        then: (r) => Promise.resolve({ data: [], error: null }).then(r),
      }
      return q
    }
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: usuario.id } } } }),
          getUser: async () => ({ data: { user: { id: usuario.id } } }),
          signOut: async () => ({}),
        },
        rpc: async (nome) => ({ data: rpcs[nome] ?? null, error: null }),
        from: () => consulta(),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      }),
    }
  }, [USUARIO, PRAIAS, NINHOS])
  await page.goto(`${BASE}/pages/relatorios-biomonitor.html`)
  await page.locator('#tab-btn-mapa').waitFor({ state: 'visible', timeout: 20_000 })
  await page.evaluate(() => window.aplicar())
  await page.waitForFunction(() => document.querySelector('#sec-mapa'), null, { timeout: 20_000 })
  await page.click('#tab-btn-mapa')
  await page.locator('#mapa-fs-btn').waitFor({ state: 'visible', timeout: 20_000 })
}

test('botão de tela cheia: rótulo acessível e alvo de toque ≥ 24px', async ({ page }) => {
  await abrirMapa(page)
  const b = page.locator('#mapa-fs-btn')
  await expect(b).toHaveAttribute('aria-label', 'Ver mapa em tela cheia')
  await expect(b).toHaveAttribute('aria-pressed', 'false')
  const caixa = await b.boundingBox()
  expect(caixa.width).toBeGreaterThanOrEqual(24)
  expect(caixa.height).toBeGreaterThanOrEqual(24)
})

test('em tela cheia o mapa ocupa a viewport inteira, e volta ao lugar ao sair', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await abrirMapa(page)
  const antes = await page.locator('#mapa-bio').boundingBox()
  await page.click('#mapa-fs-btn')
  const outer = page.locator('.mapa-outer.tela-cheia')
  await expect(outer).toHaveCount(1)
  const cx = await outer.boundingBox()
  expect(cx.x).toBe(0)
  expect(cx.y).toBe(0)
  expect(cx.width).toBe(1280)
  expect(cx.height).toBe(800)
  const mapa = await page.locator('#mapa-bio').boundingBox()
  expect(mapa.height).toBeGreaterThan(antes.height)
  await expect(page.locator('#mapa-fs-btn')).toHaveAttribute('aria-label', 'Sair da tela cheia')
  // o próprio Leaflet acompanhou o tamanho novo (invalidateSize)
  await page.waitForFunction(() => {
    const el = document.getElementById('mapa-bio')
    const pane = el.querySelector('.leaflet-map-pane')
    return pane && el.clientHeight > 600
  })

  await page.click('#mapa-fs-btn')
  await expect(page.locator('.mapa-outer.tela-cheia')).toHaveCount(0)
  expect(await page.evaluate(() => !!document.querySelector('#sec-mapa .mapa-outer #mapa-bio'))).toBe(true)
  expect(await page.evaluate(() => document.body.classList.contains('mapa-em-tela-cheia'))).toBe(false)
})

test('Esc sai da tela cheia', async ({ page }) => {
  await abrirMapa(page)
  await page.click('#mapa-fs-btn')
  await expect(page.locator('.mapa-outer.tela-cheia')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.mapa-outer.tela-cheia')).toHaveCount(0)
  expect(await page.evaluate(() => !!document.querySelector('#sec-mapa .mapa-outer'))).toBe(true)
})

test('painel do ninho continua por cima da tela cheia', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await abrirMapa(page)
  await page.click('#mapa-fs-btn')
  await page.evaluate(() => document.getElementById('mapa-slide-panel').classList.add('aberto'))
  await page.waitForTimeout(400)   // transição do painel
  const p = await page.locator('#mapa-slide-panel').boundingBox()
  const noTopo = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y)
    return !!(el && el.closest('#mapa-slide-panel'))
  }, [p.x + p.width / 2, p.y + p.height / 2])
  expect(noTopo).toBe(true)
  // Esc com o painel aberto fecha o PAINEL primeiro, a tela cheia fica
  await page.keyboard.press('Escape')
  await expect(page.locator('#mapa-slide-panel')).not.toHaveClass(/aberto/)
  await expect(page.locator('.mapa-outer.tela-cheia')).toHaveCount(1)
})
