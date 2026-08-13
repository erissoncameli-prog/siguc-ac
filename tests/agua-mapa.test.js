// ── Qualidade da Água · Mapa (Fase 4) ────────────────────────────
// Executar: npx playwright test tests/agua-mapa.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual aos demais testes de pages/mapa.html)
//
// A página exige sessão Supabase para montar o mapa de verdade (mesma
// limitação documentada em tests/mapa-resumo-painel.test.js); aqui o
// alvo são as funções que a gaveta e o recorte usam, chamadas direto
// na própria página — não a tela inteira autenticada.
//
// O que este arquivo trava:
//  - o limite do Acre desenhado no mapa reaproveita js/mapa-recorte.js
//    sem cópia própria de PIP (geoNoAcre segue rejeitando os mesmos
//    casos de fora do estado que tests/mapa-recorte.test.js já trava);
//  - gaveta lateral NÃO é modal — sem overlay de tela cheia, fecha só
//    via fecharGaveta() (o botão ✕), nunca por clique fora;
//  - IQA e conformidade CONAMA são dois canais visuais SEPARADOS no
//    mesmo marcador/gaveta — nunca um substitui o outro;
//  - ponto sem coleta na campanha fica VAZADO no marcador (raio > 0,
//    fillOpacity 0), nunca some do mapa.

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const PAGINA = `${BASE}/pages/agua-mapa.html`;

// Pontos ativos reais de agua_pontos_coleta (produção, migration 248/250),
// exceto Assis Brasil — estação de fronteira (Acre-Peru-Bolívia) que
// cai ~72 m fora do polígono simplificado de data/acre_estado.geojson;
// ver o comentário em montarMarcadores() de pages/agua-mapa.html sobre
// por que ela NÃO é filtrada do mapa mesmo assim (dado curado, não
// ingestão por bbox). Os demais 16 continuam uma checagem de sanidade
// útil: se algum vier false, o cadastro mudou (investigar a coordenada).
const PONTOS_PRODUCAO = [
  ['Brasiléia', -11.017389147, -68.745096461],
  ['Cruzeiro do Sul', -7.634276347, -72.658782839],
  ['Feijó', -8.159255993, -70.354700346],
  ['Jordão', -9.186558123, -71.952935275],
  ['Mâncio Lima', -7.620997385, -72.796731481],
  ['Manoel Urbano', -8.842986621, -69.258872553],
  ['Marechal Thaumaturgo', -8.949068662, -72.78461477],
  ['Plácido de Castro', -10.337762522, -67.184536281],
  ['Porto Acre', -9.589999366, -67.531181823],
  ['Porto Walter', -8.263677845, -72.741702318],
  ['Rio Branco', -9.956933591, -67.776911567],
  ['Santa Rosa do Purus', -9.43278, -70.49278],
  ['Sena Madureira', -9.076365258, -68.654524645],
  ['Senador Guiomard', -10.078928794, -67.543850461],
  ['Tarauacá', -8.158209267, -70.758293727],
  ['Xapuri', -10.649855917, -68.507403637],
];

test('limite do Acre carrega e geoNoAcre bate com os pontos de produção', async ({ page }) => {
  await page.goto(PAGINA);
  await page.waitForFunction(() => typeof window.geoNoAcre === 'function' && typeof window.geoAcreCarregar === 'function', null, { timeout: 15_000 });

  const carregado = await page.evaluate(async () => {
    await window.geoAcreCarregar();
    return window.geoAcreCarregado();
  });
  expect(carregado).toBe(true);

  for (const [nome, lat, lng] of PONTOS_PRODUCAO) {
    const dentro = await page.evaluate(([lat, lng]) => window.geoNoAcre(lat, lng), [lat, lng]);
    expect(dentro, `${nome} (${lat}, ${lng}) deveria estar dentro do Acre`).toBe(true);
  }

  // Mesmos casos de tests/mapa-recorte.test.js — fora do estado.
  const ucayaliPeru = await page.evaluate(() => window.geoNoAcre(-10.4206, -73.5353));
  expect(ucayaliPeru).toBe(false);
  const pandoBolivia = await page.evaluate(() => window.geoNoAcre(-11.2125, -68.7169));
  expect(pandoBolivia).toBe(false);
});

test('montarMarcadores NÃO filtra pontos de coleta pelo limite do Acre (dado curado, não ingestão por bbox)', async ({ page }) => {
  await page.goto(PAGINA);
  await page.waitForFunction(() => typeof window.montarMarcadores === 'function' && typeof window.L !== 'undefined', null, { timeout: 15_000 });

  const r = await page.evaluate(async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="amapa" style="width:400px;height:400px"></div>');
    inicializarMapa()
    await window.geoAcreCarregar()
    // Assis Brasil de verdade — geoNoAcre() diz "fora" (~72 m do polígono
    // simplificado), mas é uma estação oficial e precisa continuar visível.
    _pontos = [{ id: 'assis-brasil', nome: 'Assis Brasil', _lat: -10.945198, _lng: -69.566179 }]
    montarMarcadores()
    return {
      geoNoAcreDiriaFora: !window.geoNoAcre(-10.945198, -69.566179),
      marcadorExiste: !!_markers['assis-brasil'],
    }
  });
  expect(r.geoNoAcreDiriaFora, 'pré-condição do teste: geoNoAcre precisa reportar fora para este ponto').toBe(true);
  expect(r.marcadorExiste, 'ponto curado não pode ser descartado pelo recorte de bbox').toBe(true);
});

test('gaveta lateral: não é modal, abre com dado real, fecha só via fecharGaveta (o ✕)', async ({ page }) => {
  await page.goto(PAGINA);
  await page.waitForFunction(() => typeof window.abrirGaveta === 'function' && typeof window.fecharGaveta === 'function', null, { timeout: 15_000 });

  await page.evaluate(() => {
    _pontos = [{ id: 'p1', nome: 'Ponto Teste', codigo_ana: '13438000', municipio: 'Rio Branco', rio: 'Rio Acre', bacia: 'Purus', classe_enquadramento: 'classe_2', uc_id: null, _lat: -9.97, _lng: -67.82 }];
    _campanhas = [{ id: 'c1', ano: 2024, ordem: 'primeira', data_inicio: '2024-01-01', data_fim: '2024-01-31' }];
    _coletaPorChave = {
      'p1|c1': {
        iqa: 65.4, iqa_faixa: 'Boa', conama_violacoes: ['ph'], status: 'completo',
        data_coleta: '2024-01-15', hora_coleta: '09:30:00', coletor_nome: 'Fulano',
        laboratorio_nome: 'Lab X', ph: 5.2, laudo_url: null, observacoes: null, quarentena_motivo: null,
      },
    };
    _campanhaIdx = 0;
    abrirGaveta('p1');
  });

  await expect(page.locator('#amapa-gaveta.aberta')).toBeVisible();
  await expect(page.locator('#ag-titulo')).toHaveText('Ponto Teste');
  await expect(page.locator('#ag-corpo')).toContainText('Boa');
  await expect(page.locator('#ag-corpo')).toContainText('violação');

  // Não é modal: nada cobrindo a tela inteira por cima do mapa (mesma
  // checagem de tests/mapa-resumo-painel.test.js).
  const cobrindo = await page.evaluate(() => {
    return [...document.querySelectorAll('body > *')].filter(el => {
      if (el.id === 'siguc-progress-bar') return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      if (s.position !== 'fixed' && s.position !== 'absolute') return false;
      const r = el.getBoundingClientRect();
      const telaToda = r.width >= window.innerWidth * 0.95 && r.height >= window.innerHeight * 0.95;
      return telaToda && s.pointerEvents !== 'none' && +s.zIndex >= 400;
    }).map(el => el.id || el.className || el.tagName);
  });
  expect(cobrindo, `elementos cobrindo a tela: ${JSON.stringify(cobrindo)}`).toEqual([]);

  // Fecha só pela função que o botão ✕ chama — nunca por clique fora.
  await page.evaluate(() => fecharGaveta());
  await expect(page.locator('#amapa-gaveta.aberta')).toHaveCount(0);
});

test('IQA e conformidade CONAMA são canais separados — um nunca substitui o outro', async ({ page }) => {
  await page.goto(PAGINA);
  await page.waitForFunction(() => typeof window.montarCorpoGaveta === 'function', null, { timeout: 15_000 });

  const ponto = { nome: 'X', codigo_ana: '1', municipio: 'Y', rio: 'Z', bacia: 'B', classe_enquadramento: 'classe_2', uc_id: null, _lat: -9, _lng: -68 };
  const camp = { id: 'c1', ano: 2024, ordem: 'primeira' };

  // IQA "Boa" e violação CONAMA ao mesmo tempo — as duas informações
  // aparecem juntas, nenhuma esconde a outra (rio Boa que viola turbidez).
  const comViolacao = await page.evaluate(({ ponto, camp }) => {
    const coleta = { iqa: 65, iqa_faixa: 'Boa', conama_violacoes: ['turbidez'], status: 'completo', data_coleta: '2024-01-01', turbidez: 250 };
    return montarCorpoGaveta(ponto, coleta, camp);
  }, { ponto, camp });
  expect(comViolacao).toContain('Boa');
  expect(comViolacao).toContain('violação');
  expect(comViolacao).toContain('Turbidez');

  // Conforme + IQA Ótima — os dois blocos continuam presentes.
  const conforme = await page.evaluate(({ ponto, camp }) => {
    const coleta = { iqa: 85, iqa_faixa: 'Ótima', conama_violacoes: [], status: 'completo', data_coleta: '2024-01-01' };
    return montarCorpoGaveta(ponto, coleta, camp);
  }, { ponto, camp });
  expect(conforme).toContain('Ótima');
  expect(conforme).toContain('Conforme');

  // Sem limites cadastrados para a classe (null) é um TERCEIRO estado,
  // distinto de "conforme" — nunca deve virar um badge verde por engano.
  const semLimites = await page.evaluate(({ ponto, camp }) => {
    const coleta = { iqa: 70, iqa_faixa: 'Boa', conama_violacoes: null, status: 'completo', data_coleta: '2024-01-01' };
    return montarCorpoGaveta(ponto, coleta, camp);
  }, { ponto, camp });
  expect(semLimites).toContain('Sem limites');

  // Sem coleta na campanha — a gaveta deixa explícito que é lacuna de
  // monitoramento, não ausência de ponto.
  const semColeta = await page.evaluate(({ ponto, camp }) => montarCorpoGaveta(ponto, null, camp), { ponto, camp });
  expect(semColeta).toContain('Sem coleta registrada');
  expect(semColeta).toContain('não desaparece');
});

test('ponto sem coleta na campanha fica vazado no marcador, nunca some do mapa', async ({ page }) => {
  await page.goto(PAGINA);
  await page.waitForFunction(() => typeof window.renderCampanha === 'function' && typeof window.montarMarcadores === 'function' && typeof window.L !== 'undefined', null, { timeout: 15_000 });

  const r = await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="amapa" style="width:400px;height:400px"></div>');
    inicializarMapa();
    _pontos = [
      { id: 'com', nome: 'Com coleta', _lat: -9.97, _lng: -67.82 },
      { id: 'sem', nome: 'Sem coleta', _lat: -9.5, _lng: -70.0 },
    ];
    _campanhas = [{ id: 'c1', ano: 2024, ordem: 'primeira' }];
    _coletaPorChave = { 'com|c1': { iqa: 60, iqa_faixa: 'Boa', conama_violacoes: [], status: 'completo' } };
    montarMarcadores();
    renderCampanha(0);
    return {
      marcadorSemExiste: !!_markers['sem'],
      semRaio: _markers['sem'].getRadius(),
      semOpacidade: _markers['sem'].options.fillOpacity,
      semTracejado: _markers['sem'].options.dashArray,
      comOpacidade: _markers['com'].options.fillOpacity,
    };
  });

  expect(r.marcadorSemExiste, 'o marcador sem coleta não pode ser removido do mapa').toBe(true);
  expect(r.semRaio).toBeGreaterThan(0);
  expect(r.semOpacidade).toBe(0);
  expect(r.semTracejado).toBeTruthy();
  expect(r.comOpacidade).toBeGreaterThan(0);
});
