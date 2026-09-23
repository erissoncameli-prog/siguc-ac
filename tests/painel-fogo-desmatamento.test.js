// ── Painel de Fogo e Desmatamento · agregações e gráficos ─────────
// Executar: npx playwright test tests/painel-fogo-desmatamento.test.js
// (não precisa de servidor — carrega js/painel-fogo-desmatamento.js direto)
//
// O que este teste trava:
//  - filtro de LOCAL (Acre todo / todas as UCs / uma UC) recorta fogo e
//    desmatamento do jeito certo, e o período também;
//  - "Acre todo" usa o número OFICIAL do INPE, nunca a soma das UCs;
//  - ano sem registro vira null (buraco declarado), nunca zero;
//  - ano em curso sai marcado como parcial;
//  - rosca: "dentro × fora" soma o total do Acre; com uma UC escolhida,
//    vira "nesta UC × restante";
//  - ranking lista todas as UCs, em ordem, e a UC filtrada é destacada;
//  - cada gráfico desenha SVG com <title> por ponto (teclado/tabela) e
//    diz "sem dados" em vez de desenhar um gráfico vazio.

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}
const ARQ = path.join(__dirname, '..', 'js', 'painel-fogo-desmatamento.js');

const DADOS = {
  ucs: [
    { id: 'A', nome: 'RESEX Chico Mendes', grupo: 'uso_sustentavel' },
    { id: 'B', nome: 'Parque Estadual Chandless', grupo: 'protecao_integral' },
  ],
  focosUcMes: [
    { ano: 2024, mes: 8, uc_id: 'A', focos: 100 },
    { ano: 2024, mes: 9, uc_id: 'B', focos: 10 },
    { ano: 2024, mes: 9, uc_id: null, focos: 900 },
    { ano: 2026, mes: 8, uc_id: 'A', focos: 5 },
    { ano: 2026, mes: 8, uc_id: null, focos: 50 },
  ],
  focosResumo: [
    { ano: 2024, focos: 1010, origem: 'serie_historica' },
    { ano: 2026, focos: 55, origem: 'firms_diario' },
  ],
  prodesAno: [
    { ano: 2024, poligonos: 5699, area_ha: 41135 },
    { ano: 2025, poligonos: 5096, area_ha: 27546 },
  ],
  prodesUcAno: [
    { ano: 2024, uc_id: 'A', poligonos: 721, area_ha: 4305 },
    { ano: 2024, uc_id: 'B', poligonos: 3, area_ha: 12 },
    { ano: 2025, uc_id: 'A', poligonos: 500, area_ha: 3000 },
  ],
};
const F = (x) => Object.assign({ tipo: 'ambos', escopo: '', anoIni: 2024, anoFim: 2026, hoje: '2026-09-23T12:00:00' }, x);

async function carregar(page) {
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ path: ARQ });
}
async function rodar(page, fn, ...args) {
  return page.evaluate(({ fn, args, DADOS }) => {
    const conv = a => (a && a.hoje ? Object.assign({}, a, { hoje: new Date(a.hoje) }) : a);
    return window[fn](DADOS, ...args.map(conv));
  }, { fn, args, DADOS });
}

test('focos por ano: escopo, ano sem registro e ano parcial', async ({ page }) => {
  await carregar(page);
  expect(await rodar(page, 'pfdFocosPorAno', F({}))).toEqual([
    { ano: 2024, n: 1010, parcial: false },
    { ano: 2025, n: null, parcial: false },     // sem registro ≠ zero
    { ano: 2026, n: 55, parcial: true },
  ]);
  const ucs = await rodar(page, 'pfdFocosPorAno', F({ escopo: 'ucs' }));
  expect(ucs.map(p => p.n)).toEqual([110, null, 5]);
  const b = await rodar(page, 'pfdFocosPorAno', F({ escopo: 'B' }));
  expect(b.map(p => p.n)).toEqual([10, null, 0]);  // ano COM registro, zero na UC
});

test('focos por mês somam o período e respeitam o local', async ({ page }) => {
  await carregar(page);
  const m = await rodar(page, 'pfdFocosPorMes', F({ escopo: 'A' }));
  expect(m).toEqual([{ mes: 7, n: 0 }, { mes: 8, n: 105 }, { mes: 9, n: 0 }, { mes: 10, n: 0 }, { mes: 11, n: 0 }]);
});

test('desmatamento: Acre todo = número oficial; UC = interseção; sem PRODES = null', async ({ page }) => {
  await carregar(page);
  const acre = await rodar(page, 'pfdDesmatPorAno', F({}));
  expect(acre.map(p => p.ha)).toEqual([41135, 27546, null]);
  const ucs = await rodar(page, 'pfdDesmatPorAno', F({ escopo: 'ucs' }));
  expect(ucs.map(p => p.ha)).toEqual([4317, 3000, null]);
  const b = await rodar(page, 'pfdDesmatPorAno', F({ escopo: 'B' }));
  expect(b.map(p => p.ha)).toEqual([12, 0, null]);
});

test('acumulado ignora ano sem dado sem zerar a soma', async ({ page }) => {
  await carregar(page);
  const r = await page.evaluate(() => pfdAcumulado([{ ha: 10 }, { ha: null }, { ha: 5 }], 'ha').map(p => p.acumulado));
  expect(r).toEqual([10, null, 15]);
});

test('rosca dentro × fora e "nesta UC × restante"', async ({ page }) => {
  await carregar(page);
  const fogo = await rodar(page, 'pfdDentroFora', F({}), 'queimada');
  expect(fogo.map(i => [i.rotulo, i.n])).toEqual([['Dentro de UCs', 115], ['Fora de UCs', 950]]);
  const umaUC = await rodar(page, 'pfdDentroFora', F({ escopo: 'A' }), 'desmatamento');
  expect(umaUC.map(i => [i.rotulo, i.n])).toEqual([['Nesta UC', 7305], ['Restante do Acre', 41135 + 27546 - 7305]]);
});

test('ranking lista todas as UCs em ordem decrescente', async ({ page }) => {
  await carregar(page);
  const r = await rodar(page, 'pfdRankingUC', F({}), 'desmatamento');
  expect(r.map(i => [i.nome, i.valor])).toEqual([['RESEX Chico Mendes', 7305], ['Parque Estadual Chandless', 12]]);
});

test('KPIs: total, ano de pico e anos sem dado', async ({ page }) => {
  await carregar(page);
  const k = await rodar(page, 'pfdKpis', F({}));
  expect(k.focos).toBe(1065);
  expect(k.anoPicoFoco.ano).toBe(2024);
  expect(k.areaHa).toBe(68681);
  expect(k.anosSemFoco).toEqual([2025]);
  expect(k.anosSemDesm).toEqual([2026]);
  expect(k.anoParcial).toBe(2026);
});

test('gráficos desenham SVG com <title> por ponto e avisam quando vazios', async ({ page }) => {
  await carregar(page);
  const r = await page.evaluate(() => {
    const div = document.createElement('div');
    const out = {};
    const conta = html => { div.innerHTML = html; return { svg: !!div.querySelector('svg'), titulos: div.querySelectorAll('svg title').length, vazio: !!div.querySelector('.pfd-vazio') }; };
    const serie = [{ rotulo: '2024', valor: 10 }, { rotulo: '2025', valor: null }, { rotulo: '2026', valor: 4, parcial: true }];
    out.linha = conta(pfdLinhaHTML(serie, { cor: '#EA580C', unidade: 'focos', rotulo: 'x' }));
    out.area = conta(pfdAreaHTML(serie, { cor: '#166534', unidade: 'ha', rotulo: 'x' }));
    out.barras = conta(pfdBarrasHTML(serie, { cor: '#166534', unidade: 'ha', rotulo: 'x' }));
    out.ranking = conta(pfdRankingHTML([{ uc_id: 'A', nome: 'A', valor: 3 }, { uc_id: 'B', nome: 'B', valor: 0 }], { cor: '#EA580C', unidade: 'focos', rotulo: 'x' }));
    out.rosca = conta(pfdRoscaHTML([{ rotulo: 'Dentro', n: 3, cor: '#2F9E5B' }, { rotulo: 'Fora', n: 1, cor: '#F59E0B' }], { unidade: 'focos', rotulo: 'x' }));
    out.linhaVazia = conta(pfdLinhaHTML([{ rotulo: '2024', valor: null }], { cor: '#EA580C', unidade: 'focos', rotulo: 'x' }));
    out.roscaVazia = conta(pfdRoscaHTML([{ rotulo: 'a', n: 0, cor: '#000' }], { unidade: 'focos', rotulo: 'x' }));
    // o ponto do ano parcial é vazado
    div.innerHTML = pfdLinhaHTML(serie, { cor: '#EA580C', unidade: 'focos', rotulo: 'x' });
    out.parcialVazado = [...div.querySelectorAll('circle')].some(c => c.getAttribute('fill') === '#fff' && /parcial/.test(c.textContent));
    return out;
  });
  expect(r.linha).toEqual({ svg: true, titulos: 2, vazio: false });   // ano null não vira ponto
  expect(r.area).toEqual({ svg: true, titulos: 2, vazio: false });
  expect(r.barras).toEqual({ svg: true, titulos: 2, vazio: false });
  expect(r.ranking).toEqual({ svg: true, titulos: 1, vazio: false });  // UC com zero fica fora
  expect(r.rosca).toEqual({ svg: true, titulos: 2, vazio: false });
  expect(r.linhaVazia.vazio).toBe(true);
  expect(r.roscaVazia.vazio).toBe(true);
  expect(r.parcialVazado).toBe(true);
});

// ── Página real (cliente Supabase simulado) ───────────────────────
// Mesmo contorno de tests/agua-conferencia-filtros.test.js: sem bloquear
// o CDN, o supabase-js real sobrescreve o stub e a página cai no login.
const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const USUARIO_STUB = { id: 'u-pfd', nome_completo: 'Gestora de Teste', email: 'g@x.invalid', perfil: 'gestor', ativo: true };
const TABELAS = {
  unidades_conservacao: [
    { id: 'A', nome: 'RESEX Chico Mendes', sigla: 'RCM', categoria: 'RESEX', grupo: 'uso_sustentavel' },
    { id: 'B', nome: 'Parque Estadual Chandless', sigla: 'PEC', categoria: 'PI', grupo: 'protecao_integral' },
  ],
  focos_uc_mes: [
    { ano: 2023, mes: 8, uc_id: 'A', focos: 300, origem: 'serie_historica' },
    { ano: 2023, mes: 9, uc_id: null, focos: 3000, origem: 'serie_historica' },
    { ano: 2024, mes: 8, uc_id: 'A', focos: 100, origem: 'serie_historica' },
    { ano: 2024, mes: 9, uc_id: 'B', focos: 10, origem: 'serie_historica' },
    { ano: 2024, mes: 9, uc_id: null, focos: 900, origem: 'serie_historica' },
  ],
  focos_resumo_ano: [
    { ano: 2023, focos: 3300, origem: 'serie_historica', periodo_ini: '2023-07-01', periodo_fim: '2023-11-04' },
    { ano: 2024, focos: 1010, origem: 'serie_historica', periodo_ini: '2024-07-01', periodo_fim: '2024-11-04' },
  ],
  prodes_resumo_ano: [{ ano: 2023, poligonos: 5877, area_ha: 46295 }, { ano: 2024, poligonos: 5699, area_ha: 41135 }],
  prodes_uc_ano: [
    { ano: 2023, uc_id: 'A', poligonos: 600, area_ha: 3800 },
    { ano: 2024, uc_id: 'A', poligonos: 721, area_ha: 4305 },
    { ano: 2024, uc_id: 'B', poligonos: 3, area_ha: 12 },
  ],
};

async function abrirPainel(page) {
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.addInitScript(([usuario, tabelas]) => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const consulta = (tabela) => {
      let de = 0, ate = 999;
      const q = {
        select: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, eq: () => q,
        range: (a, b) => { de = a; ate = b; return q },
        single: async () => ({ data: usuario, error: null }),
        maybeSingle: async () => ({ data: usuario, error: null }),
        then: (r) => Promise.resolve({ data: (tabelas[tabela] || []).slice(de, ate + 1), error: null }).then(r),
      };
      return q;
    };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: usuario.id } } } }),
          getUser: async () => ({ data: { user: { id: usuario.id } } }),
          signOut: async () => ({}),
        },
        rpc: async (nome) => (nome === 'nivel_efetivo' ? { data: 'editar', error: null } : { data: null, error: null }),
        from: (tabela) => consulta(tabela),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      }),
    };
  }, [USUARIO_STUB, TABELAS]);
  await page.goto(`${BASE}/pages/painel-fogo-desmatamento.html`);
  await page.locator('.pfd-kpis').waitFor({ state: 'visible', timeout: 20_000 });
}

test('anos sem dado viram faixas legíveis, e o eixo de barras não atropela os anos', async ({ page }) => {
  await carregar(page);
  const r = await page.evaluate(() => {
    const anos = []; for (let a = 2008; a <= 2026; a++) anos.push(a);
    const svg = pfdBarrasHTML(anos.map(a => ({ rotulo: String(a), valor: a - 2000 })),
      { cor: '#166534', unidade: 'ha', rotulo: 't' });
    const rotulos = [...new DOMParser().parseFromString(svg, 'text/html').querySelectorAll('svg > text')]
      .map(t => t.textContent).filter(t => /^\d{4}$/.test(t));
    return {
      faixas: pfdFaixasAnos([2025, 2008, 2009, 2010, 2011, 2026, 2013]),
      um: pfdFaixasAnos([2026]), vazio: pfdFaixasAnos([]), rotulos,
    };
  });
  expect(r.faixas).toBe('2008–2011, 2013 e 2025, 2026');
  expect(r.um).toBe('2026');
  expect(r.vazio).toBe('');
  expect(r.rotulos.length).toBeLessThanOrEqual(10);
  expect(r.rotulos).toContain('2026'); // o ano mais recente sempre rotulado
});

test('página: no celular (390px) nada rola de lado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await abrirPainel(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(390);
});

test('página: abre com os 4 tipos de gráfico, KPIs e as duas seções', async ({ page }) => {
  await abrirPainel(page);
  await page.selectOption('#pfd-ini', '2023');
  const titulos = await page.locator('.pfd-card h3').allInnerTexts();
  expect(titulos).toEqual([
    'Focos de calor por ano', 'Focos por mês da temporada', 'Focos dentro × fora de UCs', 'UCs com mais focos',
    'Área desmatada por ano', 'Desmatamento acumulado', 'Área dentro × fora de UCs', 'UCs com mais área desmatada',
  ]);
  // linha, barras, rosca e área desenhados de verdade (SVG com <title>)
  expect(await page.locator('.pfd-card svg title').count()).toBeGreaterThan(10);
  await expect(page.locator('.pfd-kpi').first()).toContainText('4.310');   // 3.300 + 1.010 focos
  await expect(page.locator('.pfd-kpis')).toContainText('87.430');          // 46.295 + 41.135 ha oficiais
});

test('página: "Só queimadas" esconde o desmatamento e vice-versa', async ({ page }) => {
  await abrirPainel(page);
  await page.getByRole('button', { name: 'Só queimadas' }).click();
  await expect(page.getByRole('button', { name: 'Só queimadas' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pfd-secao-titulo')).toHaveCount(1);
  await expect(page.locator('.pfd-secao-titulo')).toContainText('Queimadas');
  await page.getByRole('button', { name: 'Só desmatamento' }).click();
  await expect(page.locator('.pfd-secao-titulo')).toHaveCount(1);
  await expect(page.locator('.pfd-secao-titulo')).toContainText('Desmatamento');
});

test('página: escolher uma UC recorta os números e muda a rosca para "nesta UC"', async ({ page }) => {
  await abrirPainel(page);
  await page.selectOption('#pfd-ini', '2023');
  await page.selectOption('#pfd-local', 'A');
  await expect(page.locator('.pfd-secao-titulo').first()).toContainText('RESEX Chico Mendes');
  await expect(page.locator('.pfd-kpi').first()).toContainText('400');       // 300 + 100 focos na UC
  await expect(page.locator('.pfd-card h3', { hasText: 'nesta UC' }).first()).toBeVisible();
  await expect(page.locator('.pfd-legenda').first()).toContainText('Restante do Acre');
});

test('página: período invertido é corrigido, nunca vira tela vazia', async ({ page }) => {
  await abrirPainel(page);
  // padrão 2008..ano corrente: "Até" antes do "De" puxa o "De" junto
  await page.selectOption('#pfd-fim', '2005');
  await expect(page.locator('#pfd-ini')).toHaveValue('2005');
  // e "De" depois do "Até" empurra o "Até"
  await page.selectOption('#pfd-ini', '2024');
  await expect(page.locator('#pfd-fim')).toHaveValue('2024');
});
