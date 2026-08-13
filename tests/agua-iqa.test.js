// ── Qualidade da Água · regressão do IQA contra a série histórica ──
// Executar: npx playwright test tests/agua-iqa.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual ao tests/mapa-recorte.test.js)
//
// Guarda de `agua_calcular_iqa()` (migration 249), a DEFINIÇÃO ÚNICA
// do cálculo do IQA no SIGUC. O teste chama a função DE VERDADE, no
// banco, via RPC — não uma cópia em JavaScript. Isso é deliberado:
// uma cópia aqui seria exatamente o que a migration existe para
// impedir (a lição de `js/frota-consumo.js`, que nasceu de três
// cópias do mesmo bloco com o mesmo bug).
//
// POR QUE ESTE TESTE EXISTE
// Mover dez anos de série histórica para uma fórmula nova só é
// defensável com prova de que a fórmula não distorce o passado. As
// 268 linhas da planilha que já trazem IQA calculado são essa prova,
// e viram regressão permanente: qualquer mexida futura nas curvas que
// quebre o histórico falha aqui antes de chegar à produção.
//
// O QUE ELE TRAVA
//  - erro contra as 268 linhas fica abaixo do baseline de 1,75 ponto
//    registrado no plano (e abaixo do que a Fase 0 de fato entregou);
//  - a FAIXA é derivada do valor, nunca digitada — na planilha 9
//    classificações divergiam do próprio número;
//  - ΔT ausente cai no q neutro, e ligar o termo não vira um degrau
//    silencioso na série;
//  - os pesos são renormalizados quando falta parâmetro (senão a
//    falta de um dado pareceria piora do rio);
//  - abaixo de peso mínimo a função devolve NULL em vez de um índice
//    montado com dois parâmetros.
//
// ⚠ COMPARAÇÃO É COM ΔT NEUTRO, DE PROPÓSITO
// A série histórica foi calculada SEM o termo de temperatura (medido:
// o baseline de 1,75 do plano só se reproduz com o q neutro). Comparar
// com ΔT ligado misturaria erro de curva com mudança de método. O
// efeito de ligar o termo é medido à parte, no último teste.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

// index.html expõe `window.db` justamente para os testes de RPC
// pública read-only, e não exige sessão.
const PAGINA = `${BASE}/index.html`;

// Baseline registrado em docs/qualidade-agua/plano.md, com as curvas
// como foram digitalizadas. A Fase 0 tinha que ficar ABAIXO disto.
const BASELINE_MEDIANA = 1.75;
// O que a Fase 0 entregou, com folga para variação de arredondamento.
// Serve para que um refino futuro que piore o resultado não passe
// despercebido só por ainda estar abaixo do baseline antigo.
const TETO_MEDIANA = 1.10;

// ── Leitura da série histórica ────────────────────────────────
// Só normalização de texto — nenhuma conta do IQA acontece aqui.
//
// ⚠ NÃO trocar por `linha.split(',')`. 143 das 451 linhas do CSV têm
// campo entre aspas COM vírgula dentro: a coordenada
// ("-8.263677845414033, -72.74170231804855") e os valores gravados
// com vírgula decimal ("23,00" em Temp Ar, "0,050" em FosforoTotal).
// Split ingênuo desloca as colunas dessas linhas e o teste passa a
// comparar turbidez com fósforo, silenciosamente.
function separaCampos(linha) {
  const campos = [];
  let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') { atual += '"'; i++; }   // "" escapado
        else aspas = false;
      } else atual += c;
    } else if (c === '"') {
      aspas = true;
    } else if (c === ',') {
      campos.push(atual); atual = '';
    } else atual += c;
  }
  campos.push(atual);
  return campos;
}

function csvLinhas() {
  const bruto = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'qualidade-agua', 'serie-historica.csv'), 'utf8');
  const linhas = bruto.split('\n').filter(l => l.trim());
  // O arquivo é CRLF (451/451 linhas — Excel). split('\n') deixa o \r
  // no fim de cada linha, e ele cai no ÚLTIMO campo de cada uma. Sem
  // trim() no CABEÇALHO (só os valores eram tratados), a chave virava
  // "IQA CETESB\r" — toda leitura por r['IQA CETESB'] batia undefined
  // e o teste de faixa via as 268 linhas como "divergentes" em vez das
  // 9 reais.
  const cab = separaCampos(linhas[0]).map(c => c.trim());
  return linhas.slice(1).map(l => {
    const campos = separaCampos(l);
    const o = {};
    cab.forEach((c, i) => { o[c] = (campos[i] || '').trim(); });
    return o;
  });
}

// Valor censurado ("<1") vale METADE do limite de detecção — decisão 3
// do plano. Números com mais de uma vírgula são erro de digitação da
// planilha ("2,419,00"): as vírgulas são separador de milhar.
function num(s) {
  if (s === undefined || s === null) return null;
  let t = String(s).trim();
  if (!t) return null;
  let censurado = false;
  if (t.startsWith('<')) { censurado = true; t = t.slice(1).trim(); }
  t = t.replace(/\s/g, '');
  t = (t.split(',').length > 2) ? t.replace(/,/g, '') : t.replace(',', '.');
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return censurado ? v / 2 : v;
}

function amostras() {
  return csvLinhas()
    .filter(r => (r['IQA %'] || '').trim())
    .map(r => ({
      linha:    r.linha_origem,
      alvo:     num(r['IQA %']),
      faixaCsv: (r['IQA CETESB'] || '').trim(),
      tempAr:   num(r['Temp Ar']),
      tempAm:   num(r['Temp Amostra']),
      od:       num(r['OD']),
      coli:     num(r['ColiformesTermotolerantes']),
      ph:       num(r['pH']),
      dbo:      num(r['DBO']),
      n:        num(r['NitrogenioTotal']),
      pt:       num(r['FosforoTotal']),
      turb:     num(r['Turbidez']),
      sol:      (num(r['SolDissolvidosTotais']) === null && num(r['SolSuspensaoTotais']) === null)
                  ? null
                  : (num(r['SolDissolvidosTotais']) || 0) + (num(r['SolSuspensaoTotais']) || 0),
    }));
}

// ── Ponte com o banco ─────────────────────────────────────────
async function abrir(page) {
  await page.goto(PAGINA);
  // `db` só existe depois que /api/env resolve (config em runtime,
  // sem credencial no fonte). Em localhost o loader busca a env de
  // produção — ver js/config.js.
  await page.waitForFunction(() => !!window.db, null, { timeout: 30_000 });
}

// Chama uma RPC para muitas linhas de uma vez, em ondas — 268 idas e
// voltas em série levariam minutos.
async function rpcLote(page, fn, lista, montarArgs, lote = 40) {
  return page.evaluate(async ({ fn, lista, montarArgsTxt, lote }) => {
    const montar = new Function('return ' + montarArgsTxt)();
    const saida = [];
    for (let i = 0; i < lista.length; i += lote) {
      const fatia = lista.slice(i, i + lote);
      const res = await Promise.all(fatia.map(async item => {
        const { data, error } = await window.db.rpc(fn, montar(item));
        if (error) throw new Error(`${fn}: ${error.message}`);
        return data;
      }));
      saida.push(...res);
    }
    return saida;
  }, { fn, lista, montarArgsTxt: montarArgs.toString(), lote });
}

// A saturação também vem do banco: `agua_od_saturacao` faz parte da
// mesma definição única, e converter aqui seria reimplementar.
async function comSaturacao(page, linhas) {
  const sat = await rpcLote(page, 'agua_od_saturacao', linhas,
    r => ({ p_od_mg_l: r.od, p_temp_c: r.tempAm }));
  return linhas.map((r, i) => ({ ...r, sat: sat[i] === null ? null : Number(sat[i]) }));
}

function argsIqa(r) {
  return {
    p_od_saturacao: r.sat,
    p_coliformes_termotolerantes: r.coli,
    p_ph: r.ph,
    p_dbo: r.dbo,
    p_nitrogenio_total: r.n,
    p_fosforo_total: r.pt,
    p_delta_temperatura: r.dt,
    p_turbidez: r.turb,
    p_solidos_totais: r.sol,
  };
}

const mediana = v => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ══════════════════════════════════════════════════════════════

test('a série histórica é reproduzida dentro da tolerância', async ({ page }) => {
  test.setTimeout(300_000);
  await abrir(page);

  const linhas = amostras();
  expect(linhas.length).toBe(268);   // pega CSV trocado ou truncado

  // ΔT neutro: mesmo método com que a planilha foi calculada.
  const comSat = (await comSaturacao(page, linhas)).map(r => ({ ...r, dt: null }));
  const calc = await rpcLote(page, 'agua_calcular_iqa', comSat, argsIqa);

  const semIndice = calc.filter(v => v === null).length;
  expect(semIndice, 'toda linha com IQA na planilha tem os 9 parâmetros').toBe(0);

  const erros = calc.map((v, i) => Math.abs(Number(v) - linhas[i].alvo));
  const med = mediana(erros);
  const dentro5  = erros.filter(e => e <= 5).length  / erros.length;
  const dentro10 = erros.filter(e => e <= 10).length / erros.length;

  console.log(`IQA vs série histórica — mediana ${med.toFixed(3)} · ` +
              `±5: ${(dentro5 * 100).toFixed(1)}% · ±10: ${(dentro10 * 100).toFixed(1)}% · ` +
              `pior ${Math.max(...erros).toFixed(2)}`);

  expect(med, `erro mediano tem que ficar abaixo do baseline de ${BASELINE_MEDIANA}`)
    .toBeLessThan(BASELINE_MEDIANA);
  expect(med, 'erro mediano regrediu em relação ao que a Fase 0 entregou')
    .toBeLessThan(TETO_MEDIANA);
  expect(dentro5).toBeGreaterThanOrEqual(0.89);
  expect(dentro10).toBeGreaterThanOrEqual(0.99);

  // Correlação de Pearson — o baseline do plano era 0,946. Pega o caso
  // em que o erro mediano melhora mas a ORDENAÇÃO das coletas se
  // perde, que é o que quebraria a leitura de série temporal.
  const x = calc.map(Number), y = linhas.map(r => r.alvo);
  const mx = x.reduce((a, b) => a + b) / x.length;
  const my = y.reduce((a, b) => a + b) / y.length;
  const cov = x.reduce((a, _, i) => a + (x[i] - mx) * (y[i] - my), 0);
  const dx = Math.sqrt(x.reduce((a, v) => a + (v - mx) ** 2, 0));
  const dy = Math.sqrt(y.reduce((a, v) => a + (v - my) ** 2, 0));
  const r = cov / (dx * dy);
  console.log(`correlação ${r.toFixed(4)}`);
  expect(r).toBeGreaterThanOrEqual(0.946);
});

test('a faixa é derivada do valor, nunca digitada', async ({ page }) => {
  await abrir(page);

  // Fronteiras exatas das cinco faixas.
  const casos = [
    [100, 'Ótima'], [79.01, 'Ótima'], [79, 'Ótima'],
    [78.99, 'Boa'], [51, 'Boa'], [50.99, 'Regular'],
    [36, 'Regular'], [35.99, 'Ruim'], [19, 'Ruim'],
    [18.99, 'Péssima'], [0, 'Péssima'],
  ];
  const obtidas = await rpcLote(page, 'agua_iqa_faixa', casos, c => ({ p_iqa: c[0] }));
  casos.forEach((c, i) => expect(obtidas[i], `IQA ${c[0]}`).toBe(c[1]));

  const nula = await rpcLote(page, 'agua_iqa_faixa', [[null]], c => ({ p_iqa: c[0] }));
  expect(nula[0]).toBeNull();

  // A planilha traz 9 linhas em que a faixa escrita à mão contradiz o
  // próprio valor (achado 6 do plano) — IQA 44,15 marcado BOA, IQA
  // 51,12 marcado REGULAR. Conferir que continuam sendo 9 é o que dá
  // sentido a derivar: se um dia forem 0, a planilha foi corrigida na
  // origem; se forem mais, o dado piorou e a Fase 1 precisa saber.
  const linhas = amostras();
  const faixaEsperada = await rpcLote(page, 'agua_iqa_faixa', linhas, r => ({ p_iqa: r.alvo }));
  const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const divergentes = linhas.filter((r, i) => semAcento(r.faixaCsv) !== semAcento(faixaEsperada[i]));
  console.log('faixas digitadas que contradizem o próprio valor:',
              divergentes.map(d => `linha ${d.linha} (${d.alvo} marcado ${d.faixaCsv})`).join(', '));
  expect(divergentes.length).toBe(9);
});

test('pesos renormalizam quando falta parâmetro, e há piso de peso', async ({ page }) => {
  await abrir(page);

  // Com todos os q iguais, a média geométrica ponderada é aquele q —
  // independentemente de QUANTOS parâmetros existem. É o jeito direto
  // de provar que os pesos foram renormalizados: se não fossem, tirar
  // parâmetro derrubaria o índice.
  //  q = 50 em: OD 50% de saturação, pH 6 é 55 … então usa-se um caso
  //  construído com os pontos exatos das curvas onde q = 50:
  //  coliformes 100 → 50 · nitrogênio 4 → 50 · fósforo 0,2 → 50
  const cheio = { p_od_saturacao: null, p_coliformes_termotolerantes: 100, p_ph: null,
                  p_dbo: null, p_nitrogenio_total: 4, p_fosforo_total: 0.2,
                  p_delta_temperatura: null, p_turbidez: null, p_solidos_totais: null };
  // Peso medido = 0,15 + 0,10 + 0,10 = 0,35 — abaixo do piso de 0,60.
  const abaixoDoPiso = await rpcLote(page, 'agua_calcular_iqa', [cheio], a => a);
  expect(abaixoDoPiso[0], 'peso medido insuficiente devolve NULL, não um índice inventado')
    .toBeNull();

  // Agora com peso suficiente e todos os q = 50 (turbidez 60 → 44 não
  // serve; DBO 6 → 46 também não). Usa-se OD 50% → 42,5 e mede-se que
  // o resultado fica ENTRE o menor e o maior q, nunca fora.
  const bastante = { ...cheio, p_od_saturacao: 50, p_ph: 7.5, p_turbidez: 20 };
  const [v] = await rpcLote(page, 'agua_calcular_iqa', [bastante], a => a);
  expect(Number(v)).toBeGreaterThan(42.5);   // menor q envolvido
  expect(Number(v)).toBeLessThan(94);        // maior q envolvido (ΔT neutro)

  // Só o ΔT neutro não basta: sem nenhum parâmetro medido, NULL.
  const vazio = { p_od_saturacao: null, p_coliformes_termotolerantes: null, p_ph: null,
                  p_dbo: null, p_nitrogenio_total: null, p_fosforo_total: null,
                  p_delta_temperatura: null, p_turbidez: null, p_solidos_totais: null };
  const [nada] = await rpcLote(page, 'agua_calcular_iqa', [vazio], a => a);
  expect(nada).toBeNull();
});

test('ΔT ausente cai no q neutro e ligar o termo não vira degrau', async ({ page }) => {
  test.setTimeout(300_000);
  await abrir(page);

  // ΔT nulo tem que dar exatamente o mesmo que ΔT = 0: os dois valem
  // q = 94. É o que garante que os 6% da série sem `Temp Ar` continuem
  // comparáveis com o resto.
  const base = { p_od_saturacao: 80, p_coliformes_termotolerantes: 100, p_ph: 7,
                 p_dbo: 4, p_nitrogenio_total: 2, p_fosforo_total: 0.1,
                 p_turbidez: 20, p_solidos_totais: 150 };
  const [comNulo, comZero] = await rpcLote(page, 'agua_calcular_iqa',
    [{ ...base, p_delta_temperatura: null }, { ...base, p_delta_temperatura: 0 }], a => a);
  expect(Number(comNulo)).toBeCloseTo(Number(comZero), 6);

  // ΔT usa o valor ABSOLUTO: rio mais frio que o ar penaliza igual a
  // rio mais quente (ressalva registrada no plano — é o método
  // original, não um descuido).
  const [neg, pos] = await rpcLote(page, 'agua_calcular_iqa',
    [{ ...base, p_delta_temperatura: -6 }, { ...base, p_delta_temperatura: 6 }], a => a);
  expect(Number(neg)).toBeCloseTo(Number(pos), 6);
  expect(Number(pos)).toBeLessThan(Number(comZero));   // ΔT alto derruba o índice

  // E, na série real, ligar o termo move o índice pouco no caso típico
  // — o plano mediu |ΔT| mediano de 1,7 °C. Se um dia essa mediana
  // explodir, a série de antes e a de depois deixaram de ser
  // comparáveis e alguém precisa decidir o que fazer, em vez de o
  // gráfico mudar de patamar em silêncio.
  const linhas = (await comSaturacao(page, amostras()))
    .map(r => ({ ...r, dt: (r.tempAr === null || r.tempAm === null) ? null : Math.abs(r.tempAm - r.tempAr) }));
  const semDt = await rpcLote(page, 'agua_calcular_iqa', linhas.map(r => ({ ...r, dt: null })), argsIqa);
  const comDt = await rpcLote(page, 'agua_calcular_iqa', linhas, argsIqa);
  const desvios = comDt.map((v, i) => Math.abs(Number(v) - Number(semDt[i])));
  const medDesvio = mediana(desvios);
  console.log(`efeito de ligar o ΔT — mediana ${medDesvio.toFixed(3)} ponto · ` +
              `pior ${Math.max(...desvios).toFixed(2)}`);
  expect(medDesvio).toBeLessThan(1.5);
});

test('as curvas mantêm a forma (monotonicidade e pico)', async ({ page }) => {
  await abrir(page);

  const pontos = (curva, xs) => rpcLote(page, 'agua_iqa_q', xs.map(x => ({ curva, x })),
    a => ({ p_curva: a.curva, p_x: a.x }));

  // Decrescentes: mais poluente, menor qualidade.
  for (const [curva, xs] of [
    ['coliformes_termotolerantes', [1, 10, 100, 1000, 5000, 20000, 100000]],
    ['dbo',              [0, 2, 4, 6, 8, 10, 15, 20, 30, 50]],
    ['nitrogenio_total', [0, 1, 2, 4, 6, 10, 20, 50, 100]],
    ['fosforo_total',    [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5, 10]],
    ['turbidez',         [0, 5, 10, 20, 40, 60, 80, 100, 150, 200, 300, 500, 1000]],
    ['delta_temperatura',[0, 1, 2, 3, 4, 5, 6, 8, 10, 15]],
  ]) {
    const q = (await pontos(curva, xs)).map(Number);
    for (let i = 1; i < q.length; i++) {
      expect(q[i], `${curva}: q em x=${xs[i]} não pode subir`).toBeLessThanOrEqual(q[i - 1]);
    }
  }

  // pH tem pico perto do neutro e cai para os dois lados.
  const ph = (await pontos('ph', [2, 4, 6, 7, 7.5, 8, 9, 11, 14])).map(Number);
  const topo = ph.indexOf(Math.max(...ph));
  expect(topo).toBe(4);                       // x = 7,5
  expect(ph[0]).toBeLessThan(ph[3]);
  expect(ph[8]).toBeLessThan(ph[5]);

  // Saturação de OD: pico perto de 100%, e supersaturação penaliza.
  const od = (await pontos('od_saturacao', [0, 50, 90, 100, 110, 130, 200])).map(Number);
  expect(Math.max(...od)).toBe(od[4]);        // 110%
  expect(od[6]).toBeLessThan(od[3]);          // 200% pior que 100%

  // Fora da faixa a curva satura, não extrapola — senão turbidez de
  // 5.000 UNT devolveria q negativo e o índice viraria número
  // imaginário.
  const extremos = (await pontos('turbidez', [-10, 0, 1000, 100000])).map(Number);
  expect(extremos[0]).toBe(extremos[1]);
  expect(extremos[3]).toBe(extremos[2]);
  expect(extremos[3]).toBeGreaterThan(0);
});
