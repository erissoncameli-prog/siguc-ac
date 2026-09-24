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
//    diz "sem dados" em vez de desenhar um gráfico vazio;
//  - filtro por ESFERA (federal/estadual/municipal) recorta tudo e a
//    rosca vira "UCs federais × restante do Acre";
//  - FONTE dos focos: BDQueimadas é série à parte (ano inteiro, 12 meses,
//    nunca parcial) — nunca somada com a do FIRMS;
//  - TENDÊNCIA (Mann-Kendall + Sen) contra séries de resposta conhecida:
//    sobe, desce, oscila sem direção, ano extremo não arrasta a reta, e
//    ano parcial/sem dado fica fora da conta;
//  - SALDO desmatado × floresta que resta: soma o acumulado até 2007 + a
//    série anual + o resíduo (no ano da detecção); "Acre todo" usa os
//    números do estado, UC/esfera a interseção; o ano segue o "Até" e
//    para no último PRODES publicado;
//  - MUNICÍPIO (migration 345): recorta focos/desmatamento/saldo pelas
//    tabelas *_mun_*, ranking dos municípios com o escolhido destacado;
//  - filtro EM ETAPAS: cada nível revela só o próximo campo, a trilha
//    volta um nível, e o recorte sobrevive no endereço (#…).

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
    { id: 'A', nome: 'RESEX Chico Mendes', grupo: 'uso_sustentavel', esfera: 'federal' },
    { id: 'B', nome: 'Parque Estadual Chandless', grupo: 'protecao_integral', esfera: 'estadual' },
  ],
  bdqUcMes: [
    { ano: 2024, mes: 2, uc_id: null, focos: 7 },
    { ano: 2024, mes: 9, uc_id: 'A', focos: 40 },
    { ano: 2024, mes: 9, uc_id: null, focos: 353 },
    { ano: 2025, mes: 9, uc_id: 'B', focos: 4 },
  ],
  bdqResumo: [{ ano: 2024, focos: 400 }, { ano: 2025, focos: 4 }],
  cobertura: [
    { classe: 'area_total', ano: 0, uc_id: null, area_ha: 1000000 },
    { classe: 'd2007', ano: 2007, uc_id: null, area_ha: 100000 },
    { classe: 'residuo', ano: 2024, uc_id: null, area_ha: 1000 },
    { classe: 'nao_floresta', ano: 2007, uc_id: null, area_ha: 500 },
    { classe: 'hidrografia', ano: 2007, uc_id: null, area_ha: 1500 },
    { classe: 'area_total', ano: 0, uc_id: 'A', area_ha: 100000 },
    { classe: 'd2007', ano: 2007, uc_id: 'A', area_ha: 5000 },
    { classe: 'residuo', ano: 2025, uc_id: 'A', area_ha: 100 },
    { classe: 'area_total', ano: 0, uc_id: 'B', area_ha: 50000 },
    { classe: 'd2007', ano: 2007, uc_id: 'B', area_ha: 0 },
    { classe: 'area_total', ano: 0, uc_id: null, cd_ibge: 'M1', area_ha: 500000 },
    { classe: 'd2007', ano: 2007, uc_id: null, cd_ibge: 'M1', area_ha: 50000 },
  ],
  // Municípios (migration 345): somam o mesmo total do estado.
  municipios: [{ cd_ibge: 'M1', nome: 'Rio Branco' }, { cd_ibge: 'M2', nome: 'Feijó' }],
  focosMunMes: [
    { ano: 2024, mes: 8, cd_ibge: 'M1', focos: 600 },
    { ano: 2024, mes: 9, cd_ibge: 'M2', focos: 410 },
    { ano: 2026, mes: 8, cd_ibge: 'M1', focos: 55 },
  ],
  prodesMunAno: [
    { ano: 2024, cd_ibge: 'M1', poligonos: 3000, area_ha: 30000 },
    { ano: 2024, cd_ibge: 'M2', poligonos: 2699, area_ha: 11135 },
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

test('saldo: acumulado 2007 + anual + resíduo, por estado e por UC', async ({ page }) => {
  await carregar(page);
  // Acre: 100.000 (até 2007) + 41.135 (2024) + 1.000 (resíduo detectado em 2024)
  const acre = await rodar(page, 'pfdCobertura', F({ anoFim: 2024 }));
  expect(acre.anoRef).toBe(2024);
  expect(acre.desmatado).toBe(142135);
  expect(acre.resta).toBe(1000000 - 142135 - 2000);   // − não floresta − rios
  expect(acre.pctDesmatado).toBeCloseTo(14.2135, 3);
  expect(acre.serie.map(s => s.ano)).toEqual([2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]);
  expect(acre.serie[0].desmatado).toBe(100000);     // 2007 = só o acumulado
  // "Até" depois do último PRODES publicado para no último (2025)
  const depois = await rodar(page, 'pfdCobertura', F({ anoFim: 2026 }));
  expect(depois.anoRef).toBe(2025);
  expect(depois.desmatado).toBe(100000 + 41135 + 27546 + 1000);
  // UC: interseção (5.000) + anual da UC (4.305 + 3.000) + resíduo (100)
  const a = await rodar(page, 'pfdCobertura', F({ escopo: 'A', anoFim: 2026 }));
  expect(a.area).toBe(100000);
  expect(a.desmatado).toBe(5000 + 4305 + 3000 + 100);
  // esfera: soma das UCs daquela esfera, nunca os números do estado
  const est = await rodar(page, 'pfdCobertura', F({ escopo: 'esf:estadual', anoFim: 2026 }));
  expect(est.area).toBe(50000);
  expect(est.desmatado).toBe(12);
  // "Até" antes de 2007: mostra 2007 e avisa
  const antes = await rodar(page, 'pfdCobertura', F({ anoIni: 2003, anoFim: 2005 }));
  expect(antes.anoRef).toBe(2007);
  expect(antes.antesDoPeriodo).toBe(true);
  // sem base de cobertura: null, nunca 100% floresta inventado
  const vazio = await page.evaluate(() => pfdCobertura({ cobertura: [], prodesAno: [] }, { escopo: '', anoFim: 2024 }));
  expect(vazio).toBeNull();
});

test('área empilhada: faixas até o total, um alvo com <title> por ano', async ({ page }) => {
  await carregar(page);
  const r = await page.evaluate(() => {
    const camadas = [{ chave: 'd', rotulo: 'Desmatado', cor: '#9A3412' }, { chave: 'f', rotulo: 'Floresta', cor: '#0D9488' }];
    const pontos = [2007, 2008, 2009].map((a, i) => ({ rotulo: String(a), valores: { d: 10 + i, f: 90 - i } }));
    const div = document.createElement('div');
    div.innerHTML = pfdEmpilhadaHTML(pontos, camadas, { total: 100, unidade: 'ha', rotulo: 'x' });
    const alvos = [...div.querySelectorAll('rect[data-gt-ponto]')].map(el => el.querySelector('title').textContent);
    const um = document.createElement('div');
    um.innerHTML = pfdEmpilhadaHTML(pontos.slice(0, 1), camadas, { total: 100, unidade: 'ha', rotulo: 'x' });
    return { alvos, faixas: div.querySelectorAll('svg path[fill="#9A3412"], svg path[fill="#0D9488"]').length,
      legenda: div.querySelector('.pfd-legenda').textContent.replace(/\s+/g, ' '), umAlvo: um.querySelectorAll('rect[data-gt-ponto]').length };
  });
  expect(r.faixas).toBe(2);
  expect(r.alvos).toEqual([
    '2007 — Desmatado 10 ha (10,0%) · Floresta 90 ha (90,0%)',
    '2008 — Desmatado 11 ha (11,0%) · Floresta 89 ha (89,0%)',
    '2009 — Desmatado 12 ha (12,0%) · Floresta 88 ha (88,0%)',
  ]);
  expect(r.legenda).toContain('Floresta 88 88,0%');   // legenda com o último ano
  expect(r.umAlvo).toBe(1);   // um ano só ainda desenha e navega
});

test('esfera: recorta focos e desmatamento só nas UCs daquela esfera', async ({ page }) => {
  await carregar(page);
  const fed = await rodar(page, 'pfdFocosPorAno', F({ escopo: 'esf:federal' }));
  expect(fed.map(p => p.n)).toEqual([100, null, 5]);
  const est = await rodar(page, 'pfdDesmatPorAno', F({ escopo: 'esf:estadual' }));
  expect(est.map(p => p.ha)).toEqual([12, 0, null]);
  const rosca = await rodar(page, 'pfdDentroFora', F({ escopo: 'esf:federal' }), 'queimada');
  expect(rosca.map(i => [i.rotulo, i.n])).toEqual([['UCs federais', 105], ['Restante do Acre', 960]]);
  const rank = await rodar(page, 'pfdRankingUC', F({ escopo: 'esf:estadual' }), 'desmatamento');
  expect(rank.map(i => i.nome)).toEqual(['Parque Estadual Chandless']);   // só a esfera escolhida
  const esf = await rodar(page, 'pfdPorEsfera', F({ escopo: 'ucs' }), 'desmatamento');
  expect(esf.map(i => [i.rotulo, i.n])).toEqual([['UCs federais', 7305], ['UCs estaduais', 12], ['UCs municipais', 0]]);
});

test('fonte BDQueimadas: série à parte, ano inteiro, sem ano parcial', async ({ page }) => {
  await carregar(page);
  const anos = await rodar(page, 'pfdFocosPorAno', F({ fonte: 'bdq' }));
  expect(anos).toEqual([
    { ano: 2024, n: 400, parcial: false },
    { ano: 2025, n: 4, parcial: false },
    { ano: 2026, n: null, parcial: false },    // ainda não publicado — nunca zero
  ]);
  const meses = await rodar(page, 'pfdFocosPorMes', F({ fonte: 'bdq' }));
  expect(meses.length).toBe(12);
  expect(meses.find(m => m.mes === 2).n).toBe(7);   // fora da temporada, mas conta no ano inteiro
  const uc = await rodar(page, 'pfdFocosPorAno', F({ fonte: 'bdq', escopo: 'A' }));
  expect(uc.map(p => p.n)).toEqual([40, 0, null]);
  // FIRMS continua intacto: as duas nunca se misturam
  const firms = await rodar(page, 'pfdFocosPorAno', F({}));
  expect(firms.map(p => p.n)).toEqual([1010, null, 55]);
});

test('tendência: Mann-Kendall + Sen contra séries de resposta conhecida', async ({ page }) => {
  await carregar(page);
  const r = await page.evaluate(() => {
    const serie = vals => vals.map((v, i) => ({ ano: 2010 + i, valor: v }));
    const sobe = pfdTendencia(serie([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]));
    const desce = pfdTendencia(serie([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]));
    const oscila = pfdTendencia(serie([5, 9, 4, 8, 5, 9, 4, 8]));
    const curta = pfdTendencia(serie([1, 2, 3, 4]));
    // ano extremo (seca) no meio de uma subida de 10/ano: Sen continua 10
    const comExtremo = serie([100, 110, 120, 130, 5000, 150, 160, 170, 180, 190]);
    const robusta = pfdTendencia(comExtremo);
    // parcial e sem dado ficam fora da conta
    const comParcial = pfdTendencia([...serie([10, 20, 30, 40, 50]), { ano: 2015, valor: 1, parcial: true }, { ano: 2016, valor: null }]);
    const duas = pfdTendencias([...serie([10, 20, 30, 40, 50, 60, 70, 80]), { ano: 2018, valor: 2, parcial: true }]);
    const frase = pfdTendenciaFrase(sobe, 'focos');
    return { sobe, desce, oscila, curta, robusta, comParcial, duas, frase };
  });
  expect(r.sobe.direcao).toBe('subindo');
  expect(r.sobe.inclinacao).toBe(10);
  expect(r.sobe.S).toBe(45);
  expect(r.sobe.p).toBeLessThan(0.001);   // z = 44/√125 ≈ 3,94
  expect(r.desce.direcao).toBe('caindo');
  expect(r.desce.inclinacao).toBe(-10);
  expect(r.oscila.direcao).toBe('estavel');
  expect(r.oscila.p).toBeGreaterThan(0.05);
  expect(r.curta.insuficiente).toBe(true);
  expect(r.robusta.inclinacao).toBe(10);   // regressão comum daria bem mais
  expect(r.robusta.direcao).toBe('subindo');
  expect(r.comParcial.n).toBe(5);
  expect(r.comParcial.anoFim).toBe(2014);
  expect(r.duas.total.anoIni).toBe(2010);
  expect(r.duas.recente.anoIni).toBe(2013);   // últimos 5 anos FECHADOS
  expect(r.duas.recente.anoFim).toBe(2017);
  expect(r.frase).toMatch(/^subindo · \+10 focos\/ano/);
});

test('gráfico de tendência: barras navegáveis + retas rotuladas, veredito com texto', async ({ page }) => {
  await carregar(page);
  const r = await page.evaluate(() => {
    const pontos = [10, 20, 30, 40, 50, 60].map((v, i) => ({ ano: 2019 + i, rotulo: String(2019 + i), valor: v }));
    pontos.push({ ano: 2025, rotulo: '2025', valor: 5, parcial: true });
    const tt = pfdTendencias(pontos);
    const div = document.createElement('div');
    div.innerHTML = pfdTendenciaHTML(pontos, tt, { cor: '#EA580C', unidade: 'focos', rotulo: 'x' });
    const barras = div.querySelectorAll('rect[data-gt-ponto]');
    const retas = [...div.querySelectorAll('line[stroke-width="3"], line[stroke-width="2.5"]')];
    div.innerHTML = pfdTendenciaResumoHTML(tt, 'focos');
    const itens = [...div.querySelectorAll('.pfd-tend-item')].map(li => [li.dataset.direcao, li.querySelector('.pfd-tend-veredito').textContent.trim()]);
    const insuf = document.createElement('div');
    insuf.innerHTML = pfdTendenciaResumoHTML(pfdTendencias(pontos.slice(0, 3)), 'focos');
    return {
      barras: barras.length,
      parcialTitulo: [...barras].some(b => /fora da tendência/.test(b.textContent)),
      retas: retas.map(l => l.querySelector('title').textContent),
      itens,
      insuf: insuf.textContent.replace(/\s+/g, ' '),
    };
  });
  expect(r.barras).toBe(7);
  expect(r.parcialTitulo).toBe(true);
  expect(r.retas.length).toBe(2);
  expect(r.retas[0]).toMatch(/Tendência do período 2019–2024: subindo/);
  expect(r.itens).toEqual([['subindo', 'Subindo'], ['subindo', 'Subindo']]);
  expect(r.insuf).toContain('Dados insuficientes');
  expect(r.insuf).toContain('mínimo 5');
});

test('município: focos, desmatamento, ranking, rosca e saldo pelo cd_ibge', async ({ page }) => {
  await carregar(page);
  const m = F({ escopo: 'mun:M2' });
  expect(await rodar(page, 'pfdFocosPorAno', m)).toEqual([
    { ano: 2024, n: 410, parcial: false },
    { ano: 2025, n: null, parcial: false },
    { ano: 2026, n: 0, parcial: true },
  ]);
  const desm = await rodar(page, 'pfdDesmatPorAno', m);
  expect(desm.find(p => p.ano === 2024).ha).toBe(11135);
  expect(desm.find(p => p.ano === 2025).ha).toBeNull();          // sem linha municipal = sem dado, nunca zero
  const rank = await rodar(page, 'pfdRankingMun', F({}), 'queimada');
  expect(rank.map(r => [r.nome, r.valor])).toEqual([['Rio Branco', 655], ['Feijó', 410]]);
  expect(rank[0].uc_id).toBe('mun:M1');                           // mesma chave que o destaque usa
  const rosca = await rodar(page, 'pfdDentroFora', m, 'desmatamento');
  expect(rosca.map(r => r.rotulo)).toEqual(['Neste município', 'Restante do Acre']);
  expect(rosca[0].n).toBe(11135);
  expect(rosca[1].n).toBe(41135 + 27546 - 11135);
  const cob = await rodar(page, 'pfdCobertura', F({ escopo: 'mun:M1', anoFim: 2024 }));
  expect(cob.area).toBe(500000);
  expect(cob.d2007).toBe(50000);
  expect(cob.recente).toBe(30000);
  // a linha municipal da cobertura nunca entra no total do estado
  expect((await rodar(page, 'pfdCobertura', F({ anoFim: 2024 }))).area).toBe(1000000);
});

// ── Página real (cliente Supabase simulado) ───────────────────────
// Mesmo contorno de tests/agua-conferencia-filtros.test.js: sem bloquear
// o CDN, o supabase-js real sobrescreve o stub e a página cai no login.
const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const USUARIO_STUB = { id: 'u-pfd', nome_completo: 'Gestora de Teste', email: 'g@x.invalid', perfil: 'gestor', ativo: true };
const TABELAS = {
  unidades_conservacao: [
    { id: 'A', nome: 'RESEX Chico Mendes', sigla: 'RCM', categoria: 'RESEX', grupo: 'uso_sustentavel', esfera: 'federal' },
    { id: 'B', nome: 'Parque Estadual Chandless', sigla: 'PEC', categoria: 'PI', grupo: 'protecao_integral', esfera: 'estadual' },
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
  focos_bdq_uc_mes: [
    { ano: 2023, mes: 3, uc_id: null, focos: 12 },
    { ano: 2023, mes: 9, uc_id: 'A', focos: 250 },
    { ano: 2024, mes: 9, uc_id: 'B', focos: 8 },
    { ano: 2024, mes: 9, uc_id: null, focos: 8400 },
  ],
  focos_bdq_resumo_ano: [{ ano: 2023, focos: 262, arquivo: 'x' }, { ano: 2024, focos: 8408, arquivo: 'y' }],
  prodes_cobertura: [
    { classe: 'area_total', ano: 0, uc_id: null, area_ha: 16416639 },
    { classe: 'd2007', ano: 2007, uc_id: null, area_ha: 1941849 },
    { classe: 'residuo', ano: 2023, uc_id: null, area_ha: 5000 },
    { classe: 'nao_floresta', ano: 2007, uc_id: null, area_ha: 7005 },
    { classe: 'hidrografia', ano: 2007, uc_id: null, area_ha: 11334 },
    { classe: 'area_total', ano: 0, uc_id: 'A', area_ha: 926748 },
    { classe: 'd2007', ano: 2007, uc_id: 'A', area_ha: 39590 },
    { classe: 'area_total', ano: 0, uc_id: 'B', area_ha: 693464 },
    { classe: 'd2007', ano: 2007, uc_id: 'B', area_ha: 283 },
    { classe: 'area_total', ano: 0, uc_id: null, cd_ibge: '1200302', area_ha: 2797000 },
    { classe: 'd2007', ano: 2007, uc_id: null, cd_ibge: '1200302', area_ha: 100000 },
  ],
  municipios_acre: [{ cd_ibge: '1200302', nome: 'Feijó' }, { cd_ibge: '1200401', nome: 'Rio Branco' }],
  focos_mun_mes: [
    { ano: 2023, mes: 8, cd_ibge: '1200401', focos: 1000, origem: 'serie_historica' },
    { ano: 2023, mes: 9, cd_ibge: '1200302', focos: 2300, origem: 'serie_historica' },
    { ano: 2024, mes: 8, cd_ibge: '1200401', focos: 300, origem: 'serie_historica' },
    { ano: 2024, mes: 9, cd_ibge: '1200302', focos: 710, origem: 'serie_historica' },
  ],
  focos_bdq_mun_mes: [
    { ano: 2023, mes: 9, cd_ibge: '1200401', focos: 262 },
    { ano: 2024, mes: 9, cd_ibge: '1200302', focos: 8408 },
  ],
  prodes_mun_ano: [
    { ano: 2023, cd_ibge: '1200401', poligonos: 3000, area_ha: 20000 },
    { ano: 2023, cd_ibge: '1200302', poligonos: 2877, area_ha: 26295 },
    { ano: 2024, cd_ibge: '1200401', poligonos: 2000, area_ha: 11135 },
    { ano: 2024, cd_ibge: '1200302', poligonos: 3699, area_ha: 30000 },
  ],
  prodes_uc_ano: [
    { ano: 2023, uc_id: 'A', poligonos: 600, area_ha: 3800 },
    { ano: 2024, uc_id: 'A', poligonos: 721, area_ha: 4305 },
    { ano: 2024, uc_id: 'B', poligonos: 3, area_ha: 12 },
  ],
};

async function abrirPainel(page, hash = '') {
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
  await page.goto(`${BASE}/pages/painel-fogo-desmatamento.html${hash}`);
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

test('página: abre com linha, barras, tendência, rosca, ranking e área nas duas seções', async ({ page }) => {
  await abrirPainel(page);
  await page.selectOption('#pfd-ini', '2023');
  const titulos = await page.locator('.pfd-card h3').allInnerTexts();
  expect(titulos).toEqual([
    'Focos de calor por ano', 'Focos por mês da temporada', 'Tendência dos focos de calor', 'Focos dentro × fora de UCs', 'UCs com mais focos',
    'Focos por município',
    'Área desmatada × floresta que resta — Acre todo', 'Como chegou até aqui — Acre todo',
    'Área desmatada por ano', 'Desmatamento acumulado', 'Tendência do desmatamento', 'Área dentro × fora de UCs', 'UCs com mais área desmatada',
    'Área desmatada por município',
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
  await page.getByRole('button', { name: 'Unidades de Conservação' }).click();
  await page.selectOption('#pfd-uc', 'A');
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

test('página: filtro por esfera e "Todas as UCs" com a rosca por esfera', async ({ page }) => {
  await abrirPainel(page);
  await page.getByRole('button', { name: 'Unidades de Conservação' }).click();
  // "Todas as UCs" é o primeiro passo do nível UC
  await expect(page.locator('.pfd-card h3', { hasText: 'Focos em UCs por esfera' })).toBeVisible();
  const opcoes = await page.locator('#pfd-esfera option').allInnerTexts();
  expect(opcoes).toEqual(['Todas as esferas', 'UCs federais (1)', 'UCs estaduais (1)']);   // esfera sem UC não vira opção
  await page.selectOption('#pfd-esfera', 'federal');
  await expect(page.locator('.pfd-secao-titulo').first()).toContainText('UCs federais');
  await expect(page.locator('#pfd-conteudo')).toContainText('Restante do Acre');
  // a lista de UCs passa a ter só as da esfera
  expect(await page.locator('#pfd-uc option').allInnerTexts()).toEqual(['Todas desta esfera', 'RESEX Chico Mendes']);
  await page.selectOption('#pfd-esfera', '');
  await expect(page.locator('.pfd-card h3', { hasText: 'Focos em UCs por esfera' })).toBeVisible();
  await expect(page.locator('.pfd-card h3', { hasText: 'Área desmatada em UCs por esfera' })).toBeVisible();
});

test('página: fonte BDQueimadas troca a série de focos, e some em "Só desmatamento"', async ({ page }) => {
  await abrirPainel(page);
  await page.selectOption('#pfd-ini', '2023');
  await page.selectOption('#pfd-fonte', 'bdq');
  await expect(page.locator('.pfd-kpi').first()).toContainText('8.670');     // 262 + 8.408, nunca somado ao FIRMS
  await expect(page.locator('.pfd-secao-titulo').first()).toContainText('BDQueimadas/INPE');
  await expect(page.locator('.pfd-card h3', { hasText: 'Focos por mês' })).toHaveText('Focos por mês');
  await expect(page.locator('.pfd-aviso')).toContainText('o INPE só publica o ano');
  await page.click('.pfd-seg button:has-text("Só desmatamento")');
  await expect(page.locator('#pfd-campo-fonte')).toBeHidden();
});

test('página: saldo desmatado × floresta que resta segue o local e o "Até"', async ({ page }) => {
  await abrirPainel(page);
  const resumo = page.locator('.pfd-cob-resumo');
  // Acre até 2024: 1.941.849 + 46.295 + 41.135 + 5.000 = 2.034.279 ha
  await expect(resumo).toContainText('2.034.279 ha');
  await expect(resumo).toContainText('Até 2024');
  await expect(page.locator('.pfd-card h3', { hasText: 'Área desmatada × floresta que resta' }).locator('xpath=..').locator('svg text').first()).toContainText('%');
  await page.getByRole('button', { name: 'Unidades de Conservação' }).click();
  await page.selectOption('#pfd-uc', 'A');
  await expect(resumo).toContainText('926.748 ha no total');   // a área da UC vira o total
  await expect(page.locator('.pfd-card h3', { hasText: 'Como chegou até aqui — RESEX Chico Mendes' })).toBeVisible();
  await page.selectOption('#pfd-fim', '2023');
  await expect(resumo).toContainText('Até 2023');
});

test('página: filtro em etapas — cada nível revela só o próximo campo', async ({ page }) => {
  await abrirPainel(page);
  await expect(page.locator('#pfd-mun')).toHaveCount(0);
  await expect(page.locator('#pfd-uc')).toHaveCount(0);
  await expect(page.locator('#pfd-trilha')).toHaveText('Acre');
  await page.getByRole('button', { name: 'Municípios' }).click();
  await expect(page.locator('#pfd-mun')).toBeVisible();
  await expect(page.locator('#pfd-uc')).toHaveCount(0);
  await page.getByRole('button', { name: 'Unidades de Conservação' }).click();
  await expect(page.locator('#pfd-mun')).toHaveCount(0);
  await expect(page.locator('#pfd-esfera')).toBeVisible();
  await expect(page.locator('#pfd-uc')).toBeVisible();
  await page.selectOption('#pfd-esfera', 'estadual');
  await page.selectOption('#pfd-uc', 'B');
  await expect(page.locator('#pfd-trilha')).toHaveText(/Acre\s*›\s*Unidades de Conservação\s*›\s*UCs estaduais\s*›\s*Parque Estadual Chandless/);
  // a trilha volta um nível: esfera sem a UC
  await page.locator('#pfd-trilha button', { hasText: 'UCs estaduais' }).click();
  await expect(page.locator('#pfd-uc')).toHaveValue('');
  await expect(page.locator('#pfd-esfera')).toHaveValue('estadual');
  await page.locator('#pfd-trilha button', { hasText: 'Acre' }).click();
  await expect(page.locator('#pfd-esfera')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Acre todo' })).toHaveAttribute('aria-pressed', 'true');
});

test('página: município recorta tudo, destaca no ranking e esconde o ranking de UCs', async ({ page }) => {
  await abrirPainel(page);
  await page.getByRole('button', { name: 'Municípios' }).click();
  // sem município escolhido: Acre inteiro, ranking comparando os municípios
  await expect(page.locator('.pfd-card h3', { hasText: 'Focos por município' })).toBeVisible();
  await page.selectOption('#pfd-mun', '1200302');
  await expect(page.locator('.pfd-secao-titulo').first()).toContainText('Feijó');
  await expect(page.locator('.pfd-kpi').first()).toContainText('3.010');           // 2.300 + 710
  await expect(page.locator('.pfd-kpis')).toContainText('56.295');                 // 26.295 + 30.000 ha
  await expect(page.locator('.pfd-card h3', { hasText: 'neste município' }).first()).toBeVisible();
  await expect(page.locator('.pfd-card h3', { hasText: 'UCs com mais' })).toHaveCount(0);
  await expect(page.locator('.pfd-cob-resumo')).toContainText('2.797.000 ha no total');
  // destaque: o escolhido em negrito no ranking
  const negrito = await page.locator('.pfd-card', { hasText: 'Focos por município' })
    .locator('svg text[font-weight="700"]').allTextContents();
  expect(negrito).toEqual(['Feijó']);
  await expect(page.locator('#pfd-trilha')).toHaveText(/Acre\s*›\s*Municípios\s*›\s*Feijó/);
  await page.locator('#pfd-trilha button', { hasText: 'Municípios' }).click();
  await expect(page.locator('#pfd-mun')).toHaveValue('');
  await expect(page.locator('.pfd-secao-titulo').first()).toContainText('Acre todo');
});

test('página: o recorte vai para o endereço e volta ao abrir o link', async ({ page }) => {
  await abrirPainel(page);
  await page.getByRole('button', { name: 'Municípios' }).click();
  await page.selectOption('#pfd-mun', '1200302');
  await page.selectOption('#pfd-ini', '2023');
  const hash = await page.evaluate(() => location.hash);
  expect(hash).toContain('onde=mun');
  expect(hash).toContain('mun=1200302');
  const pg2 = await page.context().newPage();
  await abrirPainel(pg2, hash);
  await expect(pg2.locator('#pfd-mun')).toHaveValue('1200302');
  await expect(pg2.locator('#pfd-ini')).toHaveValue('2023');
  await expect(pg2.locator('.pfd-secao-titulo').first()).toContainText('Feijó');
  // link com valor que não existe cai no padrão, nunca em tela vazia
  const pg3 = await page.context().newPage();
  await abrirPainel(pg3, '#onde=mun&mun=9999999&de=1800');
  await expect(pg3.locator('#pfd-mun')).toHaveValue('');
  await expect(pg3.locator('#pfd-ini')).toHaveValue('2008');
});
