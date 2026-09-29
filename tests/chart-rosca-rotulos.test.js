// ── Número e percentual NA rosca (relatório do Biomonitor) ──
// Executar: npx playwright test tests/chart-rosca-rotulos.test.js
//
// js/chart-rosca-rotulos.js escreve "n · p%" dentro de cada fatia e o
// total no centro da rosca, no PRÓPRIO canvas — é o que faz o número ir
// para o PDF do Painel (que copia o canvas via toBase64Image). Travas:
//  1. O rótulo PINTA a fatia (bytes do canvas, não asserção de classe).
//  2. Fatia menor que 4% fica sem texto, mas a legenda sempre traz
//     número e percentual — nenhuma fatia fica sem o valor visível.
//  3. Centro só na rosca, nunca na pizza.
//  4. A página usa UMA paleta para o desfecho dos ninhos (Painel e
//     detalhado) e a perda do registro do ninho entra por causa.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const HARNESS = `${BASE}/tests/fixtures/rosca-rotulos-harness.html`;

async function abrir(page) {
  await page.goto(HARNESS);
  await page.waitForFunction(() => typeof window.roscaRotulosAplicar === 'function' && typeof window.Chart === 'function');
}

// Conta pixels "de texto" (brancos ou quase pretos) num quadrado em volta
// do ponto de rótulo da fatia i.
async function pixelsTexto(page, id, i, raio = 14) {
  return page.evaluate(({ id, i, raio }) => {
    const ch = Chart.getChart(document.getElementById(id))
    const arc = ch.getDatasetMeta(0).data[i]
    const { x, y } = arc.tooltipPosition()
    const r = ch.canvas.getBoundingClientRect()
    const esc = ch.canvas.width / r.width
    const d = ch.ctx.getImageData(Math.round((x - raio) * esc), Math.round((y - raio) * esc), Math.round(2 * raio * esc), Math.round(2 * raio * esc)).data
    let n = 0
    for (let k = 0; k < d.length; k += 4) {
      const [R, G, B, A] = [d[k], d[k + 1], d[k + 2], d[k + 3]]
      if (A > 200 && ((R > 235 && G > 235 && B > 235) || (R < 40 && G < 40 && B < 60))) n++
    }
    return n
  }, { id, i, raio })
}

test('formatação do percentual', async ({ page }) => {
  await abrir(page)
  const r = await page.evaluate(() => [
    roscaFmtPct(301, 568), roscaFmtPct(26, 12451), roscaFmtPct(1, 20000), roscaFmtPct(4, 100), roscaFmtPct(0, 10), roscaFmtNum(12425), roscaFmtPct(12425, 12451), roscaFmtPct(7, 7),
  ])
  expect(r).toEqual(['53%', '0,2%', '<0,1%', '4%', '0%', '12.425', '99,8%', '100%'])
})

test('rótulo pinta a fatia grande; sem o módulo, a mesma fatia fica lisa', async ({ page }) => {
  await abrir(page)
  const cores = ['#1A6B8C', '#C9A84C']
  await page.evaluate((c) => desenhar('c1', 'doughnut', [301, 267], c, {}, false), cores)
  const sem = await pixelsTexto(page, 'c1', 0)
  await page.evaluate((c) => desenhar('c1', 'doughnut', [301, 267], c, {}, true), cores)
  const com = await pixelsTexto(page, 'c1', 0)
  expect(sem).toBe(0)
  expect(com).toBeGreaterThan(20)
})

test('fatia < 4% sem texto dentro, mas com número e % na legenda', async ({ page }) => {
  await abrir(page)
  await page.evaluate(() => desenhar('c1', 'doughnut', [12425, 26], ['#C9A84C', '#6b7280'], {}, true))
  const pequena = await pixelsTexto(page, 'c1', 1, 3)
  const legenda = await page.evaluate(() => Chart.getChart(document.getElementById('c1')).legend.legendItems.map(l => l.text))
  expect(pequena).toBe(0)
  expect(legenda).toEqual(['Fatia 0 — 12.425 (99,8%)', 'Fatia 1 — 26 (0,2%)'])
})

test('total no centro só na rosca, nunca na pizza', async ({ page }) => {
  await abrir(page)
  const centro = (id) => page.evaluate((id) => {
    const ch = Chart.getChart(document.getElementById(id))
    const a = ch.getDatasetMeta(0).data[0]
    const esc = ch.canvas.width / ch.canvas.getBoundingClientRect().width
    const d = ch.ctx.getImageData(Math.round((a.x - 12) * esc), Math.round((a.y - 16) * esc), Math.round(24 * esc), Math.round(14 * esc)).data
    let n = 0
    for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 200 && d[k] < 60 && d[k + 1] < 60) n++
    return n
  }, id)
  await page.evaluate(() => desenhar('c1', 'doughnut', [301, 267], ['#1A6B8C', '#C9A84C'], {}, true))
  const semCentro = await centro('c1')
  await page.evaluate(() => desenhar('c1', 'doughnut', [301, 267], ['#1A6B8C', '#C9A84C'], { centro: 'ninhos' }, true))
  const comCentro = await centro('c1')
  await page.evaluate(() => desenhar('c2', 'pie', [5, 5], ['#ef4444', '#38bdf8'], { centro: 'ovos' }, true))
  expect(semCentro).toBe(0)
  expect(comCentro).toBeGreaterThan(10)
  // pizza: o miolo é a própria fatia (vermelha/azul), sem texto escuro
  expect(await centro('c2')).toBe(0)
})

test('relatório: uma paleta para o desfecho dos ninhos e perda do registro por causa', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'relatorios-biomonitor.html'), 'utf8')
  // Painel e detalhado desenham a MESMA rosca
  expect(src).toContain("roscaDesfechoNinhos('graf-p-desfecho', k)")
  expect(src).toContain("roscaDesfechoNinhos('graf-status', k)")
  // nenhuma paleta local de status de ninho sobrou
  expect(src).not.toMatch(/\['#7ECEE8','#C9A84C','#2A9D6F'/)
  // descarte do registro (causa vazia) cai pela causa do motivo, não em "natural"
  expect(src).toContain("r.causa || (['predacao','humana'].includes(r.motivo) ? r.motivo : null)")
  // desfecho dos ovos inclui incubação e ninho perdido
  expect(src).toContain('k.total_ovos_em_incubacao')
  expect(src).toContain('k.total_ovos_ninho_perdido')
})
