// ── SIGUC Qualidade da Água · alertas comparativos ──────────────
// Executar: npx playwright test tests/agua-alertas.test.js
//
// Entrega 1 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md.
//
// O QUE ESTE GUARDA TRAVA
// 1. O avaliador offline (js/agua-alertas.js) só COMPARA — não pode
//    ganhar limiar próprio nunca. Os testes passam faixas explícitas e
//    conferem o resultado; se alguém escrever um limite no JS, a
//    fixture deixa de mandar no resultado e o teste quebra.
// 2. Violação CONAMA não vira alerta de digitação (o resumo diz isso
//    em texto, e nenhum tipo 'conama' existe).
// 3. Nível `bloqueio` impede salvar NA MESA e NUNCA no app.
// 4. Falha de rede/RPC devolve lista vazia — alerta é ajuda, não
//    requisito: nunca pode impedir alguém de gravar.
//
// A malha SQL em si (as regras, os limiares, a barreira de Tukey) é
// conferida contra produção por execute_sql, não daqui — mesmo padrão
// da Fase 2/3. O que roda aqui é a metade client-side.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

const FONTE = fs.readFileSync(path.join(__dirname, '..', 'js', 'agua-alertas.js'), 'utf8');

// Página vazia + o arquivo sob teste. Nenhuma página real serve de
// base: todas declaram seu próprio `let db` no escopo global e colidem
// com o de js/config.js (mesma armadilha documentada em
// tests/sidebar-grupos.test.js).
async function comAvaliador(page) {
  await page.goto(`${BASE}/tests/fixtures/sidebar-harness.html`);
  await page.addScriptTag({ content: FONTE });
}

// Faixa de exemplo: turbidez num ponto onde o usual vai de 30 a 200
// UNT e a barreira histórica fecha em 12–450.
const BASE_TURBIDEZ = {
  turbidez: { base: 'ponto_campanha', n: 31, mediana: 90,
              usual_inf: 30, usual_sup: 200, lim_inf: 12, lim_sup: 450 },
};

test.describe('avaliador offline — só compara, não define limiar', () => {
  test('silencia dentro da faixa e dispara fora dela, nos dois sentidos', async ({ page }) => {
    await comAvaliador(page);
    const r = await page.evaluate(b => ({
      dentro: aguaAlertasDoBaseline(b, { turbidez: 90 }),
      acima:  aguaAlertasDoBaseline(b, { turbidez: 900 }),
      abaixo: aguaAlertasDoBaseline(b, { turbidez: 1 }),
      borda:  aguaAlertasDoBaseline(b, { turbidez: 450 }),   // limite é inclusivo
    }), BASE_TURBIDEZ);

    expect(r.dentro).toHaveLength(0);
    expect(r.borda).toHaveLength(0);
    expect(r.acima).toHaveLength(1);
    expect(r.acima[0].tipo).toBe('atipico');
    expect(r.acima[0].nivel).toBe('confirmar');
    expect(r.acima[0].mensagem).toContain('Acima');
    expect(r.abaixo[0].mensagem).toContain('Abaixo');
  });

  test('a faixa vem da fixture, não do código — mudar a fixture muda o veredito', async ({ page }) => {
    await comAvaliador(page);
    // O MESMO valor: normal numa faixa larga, atípico numa estreita.
    // Se alguém embutir um limiar de turbidez no JS, um dos dois quebra.
    const r = await page.evaluate(() => ({
      larga:    aguaAlertasDoBaseline({ turbidez: { lim_inf: 0, lim_sup: 5000, mediana: 90, usual_inf: 30, usual_sup: 200 } }, { turbidez: 800 }),
      estreita: aguaAlertasDoBaseline({ turbidez: { lim_inf: 0, lim_sup: 100,  mediana: 90, usual_inf: 30, usual_sup: 200 } }, { turbidez: 800 }),
    }));
    expect(r.larga).toHaveLength(0);
    expect(r.estreita).toHaveLength(1);
  });

  test('sem baseline, sem limite ou sem valor não inventa alerta', async ({ page }) => {
    await comAvaliador(page);
    const r = await page.evaluate(b => ({
      semBaseline: aguaAlertasDoBaseline(null, { turbidez: 9999 }),
      semParametro: aguaAlertasDoBaseline(b, { ph: 99 }),          // ph não está na fixture
      limiteNulo: aguaAlertasDoBaseline({ ph: { lim_inf: null, lim_sup: null } }, { ph: 99 }),
      valorVazio: aguaAlertasDoBaseline(b, { turbidez: '' }),
      naoNumero:  aguaAlertasDoBaseline(b, { turbidez: 'abc' }),
    }), BASE_TURBIDEZ);
    for (const lista of Object.values(r)) expect(lista).toHaveLength(0);
  });

  test('a mensagem diz de onde veio a referência (base e n)', async ({ page }) => {
    await comAvaliador(page);
    const html = await page.evaluate(b => {
      const [a] = aguaAlertasDoBaseline(b, { turbidez: 900 });
      return aguaAlertaHintHTML(a);
    }, BASE_TURBIDEZ);
    // "atípico para este ponto (mediana 90, n=31)" é acionável;
    // "valor atípico" não é — por isso base e n são obrigatórios.
    expect(html).toContain('histórico deste ponto nesta campanha');
    expect(html).toContain('n=31');
    expect(html).toContain('90');
  });
});

test.describe('classificação e resumo', () => {
  const ALERTAS = [
    { parametro: 'ph', tipo: 'atipico', nivel: 'confirmar', mensagem: 'Acima da faixa.' },
    { parametro: 'ph', tipo: 'fisico', nivel: 'bloqueio', mensagem: 'Impossível.' },
    { parametro: 'turbidez', tipo: 'contexto', nivel: 'informar', mensagem: 'Evento hidrológico.' },
  ];

  test('o campo é colorido pelo alerta MAIS GRAVE que ele tem', async ({ page }) => {
    await comAvaliador(page);
    const r = await page.evaluate(a => ({
      ph: aguaAlertaDoCampo(a, 'ph').nivel,
      turbidez: aguaAlertaDoCampo(a, 'turbidez').nivel,
      semAlerta: aguaAlertaDoCampo(a, 'od'),
    }), ALERTAS);
    expect(r.ph).toBe('bloqueio');
    expect(r.turbidez).toBe('informar');
    expect(r.semAlerta).toBeNull();
  });

  test('só `confirmar` entra no texto de confirmação; sem nada, devolve null', async ({ page }) => {
    await comAvaliador(page);
    const r = await page.evaluate(a => ({
      texto: aguaAlertasTextoConfirmacao(a),
      bloqueios: aguaAlertasBloqueios(a).length,
      vazio: aguaAlertasTextoConfirmacao([]),
      soInformar: aguaAlertasTextoConfirmacao([{ parametro: 'ph', nivel: 'informar', mensagem: 'x' }]),
    }), ALERTAS);
    expect(r.bloqueios).toBe(1);
    expect(r.texto).toContain('pH');
    expect(r.texto).not.toContain('Evento hidrológico');   // informar não pede confirmação
    expect(r.vazio).toBeNull();
    expect(r.soInformar).toBeNull();
  });

  test('o resumo diz que CONAMA é leitura separada — e não existe alerta de CONAMA', async ({ page }) => {
    await comAvaliador(page);
    const r = await page.evaluate(a => ({
      html: aguaAlertasResumoHTML(a),
      vazio: aguaAlertasResumoHTML([]),
      tipos: Object.keys(AGUA_ALERTA_NIVEL),
    }), ALERTAS);
    // Violação de padrão legal é resultado do rio, não erro de
    // digitação: se algum dia virar alerta aqui, este teste quebra.
    expect(r.html).toContain('CONAMA é leitura separada');
    expect(r.html).not.toMatch(/viola(ção|do) do limite/i);
    expect(r.vazio).toBe('');
    expect(r.tipos.sort()).toEqual(['bloqueio', 'confirmar', 'informar']);
  });

  test('mensagem de alerta é escapada antes de ir para o HTML', async ({ page }) => {
    await comAvaliador(page);
    const html = await page.evaluate(() => aguaAlertasResumoHTML(
      [{ parametro: '<img src=x onerror=alert(1)>', nivel: 'confirmar', mensagem: '<script>x</script>' }]));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;');
  });
});

test.describe('caminho online — a RPC é a autoridade', () => {
  test('manda ponto, ordem, campanha e só os valores numéricos', async ({ page }) => {
    await comAvaliador(page);
    const chamada = await page.evaluate(async () => {
      let capturado = null;
      const db = { rpc: (nome, args) => { capturado = { nome, args }; return Promise.resolve({ data: [] }); } };
      await aguaAlertasAvaliar(db, {
        pontoId: 'p1', ordem: 'primeira', campanhaId: 'c1', coletaId: 'x1',
        valores: { ph: 7.2, turbidez: null, dbo: '', od: '6.5', lixo: 'abc' },
      });
      return capturado;
    });
    expect(chamada.nome).toBe('agua_avaliar_coleta');
    expect(chamada.args.p_ponto_id).toBe('p1');
    expect(chamada.args.p_ordem).toBe('primeira');
    expect(chamada.args.p_campanha_id).toBe('c1');
    expect(chamada.args.p_coleta_id).toBe('x1');
    // Nulo, vazio e não-numérico não trafegam; texto numérico vira número.
    expect(chamada.args.p_valores).toEqual({ ph: 7.2, od: 6.5 });
  });

  test('RPC que falha devolve lista vazia — nunca impede gravar', async ({ page }) => {
    await comAvaliador(page);
    const r = await page.evaluate(async () => {
      const comErro   = { rpc: () => Promise.resolve({ error: { message: 'offline' } }) };
      const explodindo = { rpc: () => { throw new Error('sem rede') } };
      return {
        erro: await aguaAlertasAvaliar(comErro, { pontoId: 'p', ordem: 'primeira', valores: { ph: 7 } }),
        excecao: await aguaAlertasAvaliar(explodindo, { pontoId: 'p', ordem: 'primeira', valores: { ph: 7 } }),
        semPonto: await aguaAlertasAvaliar({ rpc: () => { throw new Error('não deveria chamar') } },
                                           { pontoId: null, ordem: 'primeira', valores: { ph: 7 } }),
      };
    });
    expect(r.erro).toEqual([]);
    expect(r.excecao).toEqual([]);
    expect(r.semPonto).toEqual([]);
  });

  test('baseline baixado é indexado por ponto → ordem → parâmetro', async ({ page }) => {
    await comAvaliador(page);
    const mapa = await page.evaluate(async () => {
      const db = { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [
        { ponto_id: 'p1', ordem: 'primeira', parametro: 'ph', base: 'ponto', n: 20,
          mediana: 7, usual_inf: 6, usual_sup: 8, lim_inf: 5, lim_sup: 9 },
        { ponto_id: 'p1', ordem: 'segunda', parametro: 'ph', base: 'ponto', n: 20,
          mediana: 6.5, usual_inf: 6, usual_sup: 7, lim_inf: 4, lim_sup: 8 },
      ] }) }) }) };
      return aguaAlertasBaixarBaseline(db, ['p1']);
    });
    // A régua muda com a campanha: pH 8,5 é normal na 1ª e atípico na 2ª.
    expect(mapa.p1.primeira.ph.lim_sup).toBe(9);
    expect(mapa.p1.segunda.ph.lim_sup).toBe(8);
  });
});

// ── O app de campo NUNCA bloqueia ────────────────────────────
// Este é o teste que mais importa desta entrega. "Nada pode impedir o
// trabalho de campo" é regra do sistema (aviso de LGPD, GPS
// divergente, checklist do Frota): o coletor está na margem do rio,
// possivelmente sem rede, e perder a coleta é sempre pior que gravar
// um número que a mesa vai conferir depois. Exercita a página REAL,
// com um valor que dispara alerta, e cobra que a coleta ainda assim
// chegue à fila.
const APP_FOTO = path.join(__dirname, 'fixtures', 'agua-teste.jpg');

test('app de campo: alerta aparece, mas a coleta é salva assim mesmo', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(String(e)));

  await page.goto(`${BASE}/pages/agua-app.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });

  await page.evaluate(async () => {
    await aOfflineInit();
    const ponto = {
      id: 'ponto-teste-0001', codigo_ana: '12345678', nome: 'Rio Teste — Ponte Nova',
      municipio: 'Rio Branco', rio: 'Rio Teste',
      geom: { type: 'Point', coordinates: [-67.8243, -9.9754] },
    };
    await aOfflineSalvarPontos([ponto]);
    App.coletor = { id: 'coletor-teste-0001', nome_completo: 'Teste Coletor' };
    App.pontos = [ponto];
    // Faixa cacheada como a sync teria deixado: turbidez de 12 a 450
    // neste ponto, na segunda campanha.
    App.baselines = { 'ponto-teste-0001': { segunda: {
      turbidez: { base: 'ponto', n: 30, mediana: 90, usual_inf: 30, usual_sup: 200, lim_inf: 12, lim_sup: 450 },
    } } };
    await aOfflineSetConfig('baselines', App.baselines);
    db = null;   // força o caminho offline: sem cliente, sem RPC
    await entrarHome();
  });
  await page.locator('#tela-home').waitFor({ state: 'visible', timeout: 10_000 });

  await page.locator('#btn-nova-coleta').click();
  await page.locator('#tela-form').waitFor({ state: 'visible' });

  await page.selectOption('#f-ponto', 'ponto-teste-0001');
  await page.fill('#f-data', '2026-08-14');            // mês 8 → segunda campanha
  await page.fill('#f-temp-amostra', '26.1');
  await page.fill('#f-ph', '7.2');
  await page.fill('#f-turbidez', '980');               // muito acima de 450
  await page.setInputFiles('#input-foto-camera', APP_FOTO);
  await page.locator('#foto-grid .foto-thumb').waitFor({ state: 'visible', timeout: 10_000 });

  // O aviso aparece (offline, pelo baseline cacheado)…
  await expect(page.locator('#f-alertas')).toContainText('Acima da faixa histórica', { timeout: 5_000 });
  await expect(page.locator('#f-h-turbidez')).toContainText('Acima');

  // …e o salvamento acontece do mesmo jeito, sem diálogo nenhum.
  await page.locator('#btn-salvar').click();
  await page.locator('#tela-home').waitFor({ state: 'visible', timeout: 10_000 });

  const pendentes = await page.evaluate(() => aOfflineListarPendentes());
  expect(pendentes).toHaveLength(1);
  expect(pendentes[0].turbidez).toBeCloseTo(980);      // gravou o valor que o coletor mediu
  expect(erros).toEqual([]);
});
