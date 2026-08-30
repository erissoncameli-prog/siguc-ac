// ── SIGUC Qualidade da Água · etiqueta do frasco (js/agua-etiqueta.js) ──
// Executar: npx playwright test tests/agua-etiqueta.test.js
//
// Fase 1 do plano em docs/qualidade-agua/plano-etiqueta-frasco.md.
// Guarda o que não pode quebrar em silêncio:
//  - o desenho da etiqueta produz um canvas do tamanho certo (mm×dpi)
//    e com conteúdo de verdade (não uma tela em branco);
//  - o pool de códigos reservados é FIFO, nunca duplica, e só é
//    consumido quando algo de fato pede um código (nunca ao abrir o
//    formulário — abandonar a tela não pode "gastar" um código à toa);
//  - salvar uma coleta com o campo de código EM BRANCO consome um
//    código do pool e a coleta offline grava esse código;
//  - salvar uma coleta com código DIGITADO À MÃO nunca abre o overlay
//    de impressão — o texto de ajuda do campo diz que é para quando o
//    frasco já tem etiqueta própria, imprimir a nossa por cima não
//    faz sentido (e é o que evita quebrar o fluxo de salvamento comum
//    de tests/agua-app-fluxo.test.js, que sempre digita um código).

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const FOTO_FIXTURE = path.join(__dirname, 'fixtures', 'agua-teste.jpg');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

async function abrirAppSemLogin(page) {
  await page.goto(`${BASE}/pages/agua-app.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
}

async function entrarComoColetorDeTeste(page) {
  await page.evaluate(async () => {
    await aOfflineInit();
    const ponto = {
      id: 'ponto-teste-etq',
      codigo_ana: '87654321',
      nome: 'Rio Teste — Etiqueta',
      municipio: 'Rio Branco',
      rio: 'Rio Teste',
      geom: { type: 'Point', coordinates: [-67.8243, -9.9754] },
    };
    await aOfflineSalvarPontos([ponto]);
    App.coletor = { id: 'coletor-teste-etq', nome_completo: 'Teste Etiqueta' };
    App.pontos = [ponto];
    await entrarHome();
  });
  await page.locator('#tela-home').waitFor({ state: 'visible', timeout: 10_000 });
}

test('desenha a etiqueta no tamanho certo, com conteúdo de verdade', async ({ page }) => {
  await abrirAppSemLogin(page);

  const r = await page.evaluate(() => {
    const canvas = aguaEtiquetaCriarCanvas({
      codigo_amostra: 'COL-2026-0042',
      ponto_nome: 'Rio Acre — Ponte Metálica',
      rio: 'Rio Acre',
      codigo_ana: '12345678',
      data_coleta: '2026-08-29',
      hora_coleta: '08:14',
      coletor_nome: 'J. Silva',
      lat: -9.9754, lng: -67.8243,
      via: 1, totalVias: 1,
    });
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let pretos = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 50 && data[i + 1] < 50 && data[i + 2] < 50) pretos++;
    }
    return { w: canvas.width, h: canvas.height, pretos };
  });

  // 40×60 mm a 203 dpi ≈ 320×480 px
  expect(r.w).toBeCloseTo(320, -1);
  expect(r.h).toBeCloseTo(480, -1);
  // Faixa preta do topo sozinha já teria milhares de pixels — se
  // "pretos" for baixo, o desenho não rodou de verdade.
  expect(r.pretos).toBeGreaterThan(1000);
});

test('nome do rio entra na etiqueta quando o ponto tem um cadastrado', async ({ page }) => {
  await abrirAppSemLogin(page);

  // Sem acesso ao texto desenhado num canvas, a prova é comparativa:
  // a MESMA etiqueta com e sem `rio` tem que ter mais pixel preto com
  // ele (a linha "Rio Acre · ANA 12345678" desenha algo a mais) — e o
  // desenho não pode quebrar quando o ponto não tem rio cadastrado
  // (ponto fora de curso d'água nomeado).
  const r = await page.evaluate(() => {
    const contarPretos = canvas => {
      const ctx = canvas.getContext('2d')
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let n = 0
      for (let i = 0; i < data.length; i += 4) { if (data[i] < 50) n++ }
      return n
    }
    const base = {
      codigo_amostra: 'COL-2026-0043', ponto_nome: 'Rio Acre — Ponte Metálica',
      codigo_ana: '12345678', data_coleta: '2026-08-29', hora_coleta: '08:14',
      coletor_nome: 'J. Silva', lat: -9.9754, lng: -67.8243, via: 1, totalVias: 1,
    }
    const comRio = contarPretos(aguaEtiquetaCriarCanvas({ ...base, rio: 'Rio Acre' }))
    const semRio = contarPretos(aguaEtiquetaCriarCanvas(base)) // sem `rio` — não pode quebrar
    return { comRio, semRio }
  })

  expect(r.comRio).toBeGreaterThan(r.semRio);
});

test('código da amostra nunca vaza a margem direita, e o QR fica ABAIXO do texto, nunca por cima', async ({ page }) => {
  await abrirAppSemLogin(page);

  // Achado em produção (screenshot no PR): "COL-2026-0042" em fonte
  // fixa vazava os 40mm e ficava por baixo/em cima do QR. Guarda dupla:
  // (1) a margem direita reservada (pad) na ALTURA do código fica
  // branca — o texto ocupa a largura útil, nunca vaza pra fora dela
  // (a fonte se auto-ajusta pra isso, ver _aEtqAjustarFonte);
  // (2) o QR existe mais abaixo, fora da linha do código — prova que
  // ele desceu, não desapareceu.
  const r = await page.evaluate(() => {
    const canvas = aguaEtiquetaCriarCanvas({
      codigo_amostra: 'COL-2026-0042', // o mesmo formato do bug relatado
      ponto_nome: 'Rio Acre — Ponte Metálica',
      codigo_ana: '12345678',
      data_coleta: '2026-08-29', hora_coleta: '08:14',
      coletor_nome: 'J. Silva', lat: -9.9754, lng: -67.8243,
      via: 1, totalVias: 1,
    });
    const ctx = canvas.getContext('2d');
    const dpi = 203, mmParaPx = v => Math.round(v * dpi / 25.4);
    // Linha do código: logo abaixo da faixa preta (4mm) — mede a
    // margem direita reservada (2mm de pad) nessa altura.
    const yIni = mmParaPx(4.5), yFim = mmParaPx(9.5);
    const padPx = mmParaPx(2);
    const { data } = ctx.getImageData(canvas.width - padPx, yIni, padPx, yFim - yIni);
    let pretosNaMargem = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 50) pretosNaMargem++;
    }

    // O QR precisa existir em algum lugar mais abaixo (prova que não
    // sumiu, só mudou de lugar) — mede uma faixa mais pro fim da
    // etiqueta, antes do rodapé fixo (a 9mm do fundo).
    const yQrIni = mmParaPx(30), yQrFim = mmParaPx(48);
    const { data: dataQr } = ctx.getImageData(0, yQrIni, canvas.width, yQrFim - yQrIni);
    let pretosNaFaixaDoQr = 0;
    for (let i = 0; i < dataQr.length; i += 4) {
      if (dataQr[i] < 50) pretosNaFaixaDoQr++;
    }

    return { pretosNaMargem, pretosNaFaixaDoQr };
  });

  expect(r.pretosNaMargem).toBe(0); // nada vazando pra fora da margem direita, na altura do código
  expect(r.pretosNaFaixaDoQr).toBeGreaterThan(500); // o QR está lá embaixo
});

test('pool de códigos reservados: FIFO, sem duplicar, só consome quando pedido', async ({ page }) => {
  await abrirAppSemLogin(page);

  const r = await page.evaluate(async () => {
    await aOfflineInit();
    await aOfflineSetConfig('etq_codigos_reservados', []); // limpo, sem depender de ordem entre testes

    const adicionados1 = await aEtqAdicionarAoPool([
      { codigo: 'COL-2026-0001', expira_em: '2026-12-31T23:59:59Z' },
      { codigo: 'COL-2026-0002', expira_em: '2026-12-31T23:59:59Z' },
    ]);
    const contagemAntes = await aEtqContarDisponiveis();

    // Reforça o mesmo código — não deve duplicar.
    const adicionados2 = await aEtqAdicionarAoPool([{ codigo: 'COL-2026-0001', expira_em: '2026-12-31T23:59:59Z' }]);
    const contagemDepoisDuplicata = await aEtqContarDisponiveis();

    const primeiro = await aEtqConsumirCodigo();
    const contagemDepoisConsumo = await aEtqContarDisponiveis();
    const segundo = await aEtqConsumirCodigo();

    return { adicionados1, contagemAntes, adicionados2, contagemDepoisDuplicata, primeiro, contagemDepoisConsumo, segundo };
  });

  expect(r.adicionados1).toBe(2);
  expect(r.contagemAntes).toBe(2);
  expect(r.adicionados2).toBe(2); // não cresceu — o código já existia
  expect(r.contagemDepoisDuplicata).toBe(2);
  expect(r.primeiro).toBe('COL-2026-0001'); // FIFO — o mais antigo sai primeiro
  expect(r.contagemDepoisConsumo).toBe(1);
  expect(r.segundo).toBe('COL-2026-0002');
});

test('salvar com código em branco consome o pool; salvar com código digitado nunca abre a etiqueta', async ({ page }) => {
  await abrirAppSemLogin(page);
  await entrarComoColetorDeTeste(page);

  await page.evaluate(async () => {
    await aOfflineSetConfig('etq_codigos_reservados', []);
    await aEtqAdicionarAoPool([{ codigo: 'COL-2026-0099', expira_em: '2026-12-31T23:59:59Z' }]);
  });

  // ── Caso 1: campo de código em branco → usa o pool, abre a etiqueta.
  await page.locator('#btn-nova-coleta').click();
  await page.locator('#tela-form').waitFor({ state: 'visible' });
  await page.selectOption('#f-ponto', 'ponto-teste-etq');
  await page.fill('#f-data', '2026-08-29');
  await page.setInputFiles('#input-foto-camera', FOTO_FIXTURE);
  await page.locator('#foto-grid .foto-thumb').waitFor({ state: 'visible', timeout: 10_000 });

  await page.locator('#btn-salvar').click();
  await page.locator('#tela-home').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#etiqueta-overlay').waitFor({ state: 'visible', timeout: 10_000 });
  await expect(page.locator('#etq-canvas')).toBeVisible();

  const pendentes1 = await page.evaluate(() => aOfflineListarPendentes());
  expect(pendentes1.find(r => r.codigo_amostra === 'COL-2026-0099')).toBeTruthy();

  const poolDepois = await page.evaluate(() => aEtqContarDisponiveis());
  expect(poolDepois).toBe(0); // o único código do pool foi consumido

  await page.locator('#etiqueta-overlay-fechar').click();
  await expect(page.locator('#etiqueta-overlay')).toBeHidden();

  // ── Caso 2: código digitado à mão → nunca abre a etiqueta (a
  // ajuda do campo diz que é para frasco com etiqueta própria).
  await page.locator('#btn-nova-coleta').click();
  await page.locator('#tela-form').waitFor({ state: 'visible' });
  await page.selectOption('#f-ponto', 'ponto-teste-etq');
  await page.fill('#f-data', '2026-08-29');
  await page.fill('#f-codigo-amostra', 'FRASCO-PROPRIO-01');
  await page.setInputFiles('#input-foto-camera', FOTO_FIXTURE);
  await page.locator('#foto-grid .foto-thumb').waitFor({ state: 'visible', timeout: 10_000 });

  await page.locator('#btn-salvar').click();
  await page.locator('#tela-home').waitFor({ state: 'visible', timeout: 10_000 });
  await expect(page.locator('#etiqueta-overlay')).toBeHidden();

  const pendentes2 = await page.evaluate(() => aOfflineListarPendentes());
  expect(pendentes2.find(r => r.codigo_amostra === 'FRASCO-PROPRIO-01')).toBeTruthy();
});

test('reimpressão pelo card da Fila usa os dados do registro offline, sem rede', async ({ page }) => {
  await abrirAppSemLogin(page);
  await entrarComoColetorDeTeste(page);

  await page.evaluate(async () => {
    await aOfflineSalvar({
      uuid_cliente: 'uuid-fila-etq-teste',
      ponto_id: 'ponto-teste-etq',
      campanha_ano: 2026, campanha_ordem: 'segunda',
      data_coleta: '2026-08-20', hora_coleta: '10:00',
      coletor_id: 'coletor-teste-etq',
      codigo_amostra: 'COL-2026-0077',
      observacoes: null, lat: null, lng: null, foto_blob: null,
    });
  });

  await page.locator('[data-tela="tela-fila"]').click();
  await page.locator('#tela-fila').waitFor({ state: 'visible' });
  await expect(page.locator('.sync-item-etq-btn')).toHaveCount(1);

  await page.locator('.sync-item-etq-btn').click();
  await page.locator('#etiqueta-overlay').waitFor({ state: 'visible' });
  const canvasVisivel = await page.locator('#etq-canvas').isVisible();
  expect(canvasVisivel).toBe(true);
});

test('formulário avisa ANTES de coletar se há código reservado para imprimir na hora', async ({ page }) => {
  // Achado real (relato do usuário): sem código reservado, o botão de
  // etiqueta pós-salvar não aparece — comportamento correto (o código
  // definitivo só existe se veio do pool), mas o coletor não tinha
  // como saber disso ANTES de coletar e achou que o recurso tinha
  // sumido. A dica do campo agora avisa de antemão.
  await abrirAppSemLogin(page);
  await entrarComoColetorDeTeste(page);
  await page.evaluate(async () => { await aOfflineSetConfig('etq_codigos_reservados', []) });

  await page.locator('#btn-nova-coleta').click();
  await page.locator('#tela-form').waitFor({ state: 'visible' });
  await expect(page.locator('#f-codigo-dica')).toContainText('sem código reservado');

  await page.locator('#btn-back-form').click();
  await page.evaluate(async () => {
    await aEtqAdicionarAoPool([{ codigo: 'COL-2026-0088', expira_em: '2026-12-31T23:59:59Z' }]);
  });

  await page.locator('#btn-nova-coleta').click();
  await page.locator('#tela-form').waitFor({ state: 'visible' });
  await expect(page.locator('#f-codigo-dica')).toContainText('1 código reservado disponível');
});
