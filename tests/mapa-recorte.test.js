// ── Mapa das UCs · recorte pelo limite do Acre ───────────────────
// Executar: npx playwright test tests/mapa-recorte.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual ao tests/frota-app-barra.test.js)
//
// Guarda de js/mapa-recorte.js, o arquivo único que pages/mapa.html e
// pages/alertas-ambientais.html usam para responder "este ponto está
// no Acre?" e "em qual UC?".
//
// POR QUE ESTE TESTE EXISTE: FIRMS e DETER só aceitam consulta por
// BOUNDING BOX, e um retângulo em volta do Acre engloba pedaços do
// Amazonas, de Rondônia, de Ucayali (Peru) e de Pando (Bolívia).
// Antes do recorte, 31% dos focos FIRMS e 29% dos alertas DETER
// gravados não eram do Acre e apareciam desenhados no mapa. Se este
// teste falhar, o mapa voltou a mostrar fogo em outro país.
//
// O que ele trava:
//  - pontos de AM/RO/Peru/Bolívia ficam FORA; capitais do Acre, dentro;
//  - a área do polígono carregado bate com a área real do estado
//    (16,4 milhões de ha) — pega arquivo trocado ou truncado;
//  - ponto-em-UC acerta polígono côncavo (Serra do Divisor é uma faixa
//    em L na divisa com o Peru; o centroide dela cai fora dela mesma);
//  - a classificação em lote carimba _noAcre/_ucNome e conta certo;
//  - o custo continua compatível com os 5.000 focos que a tela carrega.

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

// Página leve que carrega só o helper — o mapa.html inteiro exige
// sessão Supabase, e aqui o alvo é a geometria, não a tela.
const PAGINA = `${BASE}/pages/alertas-ambientais.html`;

async function prepararHelper(page) {
  await page.goto(PAGINA);
  await page.waitForFunction(() => typeof window.geoNoAcre === 'function', null, { timeout: 15_000 });
  return page.evaluate(async () => {
    await window.geoAcreCarregar();
    const gj = await (await fetch('../data/uc_acre.geojson')).json();
    window.geoUCsPreparar(gj);
    return { acre: window.geoAcreCarregado(), ucs: window.geoUCsPreparadas() };
  });
}

test('recorte do Acre: dentro é dentro, fora é fora', async ({ page }) => {
  const pronto = await prepararHelper(page);
  expect(pronto.acre).toBe(true);
  expect(pronto.ucs).toBe(true);

  const casos = [
    // [rótulo, lat, lng, esperado]
    ['Rio Branco (capital)',       -9.9749,  -67.8243, true],
    ['Cruzeiro do Sul',            -7.6306,  -72.6706, true],
    ['Sena Madureira',             -9.0656,  -68.6569, true],
    ['Ucayali / PERU',            -10.4206,  -73.5353, false],
    ['Pando / BOLÍVIA',           -11.2125,  -68.7169, false],
    ['Rondônia (leste da divisa)', -10.9686, -66.6540, false],
    ['Amazonas (norte da divisa)',  -7.0514, -71.6633, false],
    ['Manaus / AM',                 -3.1000, -60.0000, false],
  ];

  const obtidos = await page.evaluate(cs => cs.map(([n, la, lo]) => window.geoNoAcre(la, lo)), casos);
  casos.forEach(([rotulo, , , esperado], i) => {
    expect(obtidos[i], `${rotulo} deveria estar ${esperado ? 'DENTRO' : 'FORA'} do Acre`).toBe(esperado);
  });
});

test('polígono carregado é mesmo o do Acre (área e vértices)', async ({ page }) => {
  await prepararHelper(page);
  const m = await page.evaluate(async () => {
    const gj = await (await fetch('../data/acre_estado.geojson')).json();
    const g = gj.features[0].geometry;
    const aneis = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1);
    // Área do polígono esférico, em hectares (fórmula de excesso
    // esférico simplificada — precisão suficiente para pegar arquivo
    // trocado, não para cálculo cartográfico).
    const R = 6371008.8, rad = x => x * Math.PI / 180;
    let area = 0;
    for (const anel of aneis) {
      let s = 0;
      for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
        s += (rad(anel[i][0]) - rad(anel[j][0])) * (2 + Math.sin(rad(anel[j][1])) + Math.sin(rad(anel[i][1])));
      }
      area += Math.abs(s * R * R / 2);
    }
    return { vertices: aneis.reduce((a, r) => a + r.length, 0), milhoesHa: area / 1e4 / 1e6 };
  });
  // Acre tem 16,4 milhões de hectares (164.173 km²).
  expect(m.milhoesHa).toBeGreaterThan(16.0);
  expect(m.milhoesHa).toBeLessThan(16.8);
  expect(m.vertices).toBeGreaterThan(500);
});

test('ponto-em-UC acerta polígono côncavo e ignora buraco', async ({ page }) => {
  await prepararHelper(page);
  const r = await page.evaluate(async () => {
    const gj = await (await fetch('../data/uc_acre.geojson')).json();
    // Ponto interior de verdade: varre uma linha horizontal no meio da
    // UC e pega o meio do par de cruzamentos MAIS LARGO. O centroide
    // dos vértices NÃO serve — em UC côncava (Serra do Divisor é uma
    // faixa em L) ele cai fora dela mesma; e o primeiro par também
    // não, porque pode ser uma reentrância estreita.
    const interior = nome => {
      const f = gj.features.find(x => (x.properties?.nome || '') === nome);
      if (!f) return null;
      const g = f.geometry;
      const aneis = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1);
      const anel = aneis.reduce((a, b) => (a.length > b.length ? a : b));
      const ys = anel.map(p => p[1]);
      const y = (Math.min(...ys) + Math.max(...ys)) / 2;
      const xs = [];
      for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
        const [xi, yi] = anel[i], [xj, yj] = anel[j];
        if ((yi > y) !== (yj > y)) xs.push((xj - xi) * (y - yi) / (yj - yi) + xi);
      }
      xs.sort((a, b) => a - b);
      if (xs.length < 2) return null;
      let melhor = 0, vao = -1;
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] > vao) { vao = xs[i + 1] - xs[i]; melhor = i; }
      }
      return [y, (xs[melhor] + xs[melhor + 1]) / 2];
    };
    // Nomes exatamente como estão em data/uc_acre.geojson — é
    // 'Chandles', não 'Chandless'.
    const alvos = ['Serra do Divisor', 'Chandles', 'Chico Mendes'];
    return alvos.map(nome => {
      const p = interior(nome);
      return { nome, achado: p ? window.geoUCEm(p[0], p[1]) : null, temPonto: !!p };
    });
  });
  for (const { nome, achado, temPonto } of r) {
    expect(temPonto, `UC ${nome} não existe no geojson`).toBe(true);
    expect(achado, `ponto interior de ${nome}`).toBe(nome);
  }

  // Fora de qualquer UC (área urbana de Rio Branco).
  const semUC = await page.evaluate(() => window.geoUCEm(-9.9749, -67.8243));
  expect(semUC).toBeNull();
});

test('classificação em lote carimba e conta, e aguenta o volume da tela', async ({ page }) => {
  await prepararHelper(page);
  const r = await page.evaluate(() => {
    const lista = [
      { lat: -9.9749, lon: -67.8243 },  // Rio Branco — Acre, fora de UC
      { lat: -10.4206, lon: -73.5353 }, // Peru
      { lat: -11.2125, lon: -68.7169 }, // Bolívia
      { lat: null, lon: null },         // sem coordenada
    ];
    const cont = window.geoClassificar(lista, x => [x.lat, x.lon]);
    // Volume real da tela: _carregarFocos busca até 5.000 focos.
    const t0 = performance.now();
    const massa = Array.from({ length: 5000 }, () => ({
      lat: -11 + Math.random() * 4, lon: -74 + Math.random() * 7.5
    }));
    window.geoClassificar(massa, x => [x.lat, x.lon]);
    return { cont, marcado: lista[0]._noAcre, semGeom: lista[3]._noAcre, ms: performance.now() - t0 };
  });

  expect(r.cont.total).toBe(4);
  expect(r.cont.dentroAcre).toBe(1);
  expect(r.cont.foraAcre).toBe(3);   // 2 fora do estado + 1 sem coordenada
  expect(r.marcado).toBe(true);
  expect(r.semGeom).toBe(false);
  // Folga larga de propósito: o que se trava aqui é a ordem de
  // grandeza (índice de bbox funcionando), não o número exato.
  expect(r.ms).toBeLessThan(3000);
});
