// ── SIGUC Biomonitor · etiquetas de ninho/berçário/lote (js/biomonitor-etiqueta.js) ──
// Executar: npx playwright test tests/biomonitor-etiqueta.test.js
//
// Plano em docs/biomonitor/plano-etiqueta-ninho-bercario.md. Motor de
// desenho compartilhado com a Água em js/etiqueta-termica.js — estes
// testes cobrem só os 3 layouts do Biomonitor e a integração do
// overlay no app (js/biomonitor-quelonios.js), não o motor genérico
// (já coberto por tests/agua-etiqueta.test.js).
//
// Rede real de Supabase é bloqueada neste ambiente (mesma limitação de
// tests/biomonitor-login.test.js), então o cliente é um stub instalado
// antes dos scripts da página — as funções de desenho/canvas são
// puras e não dependem de sessão nem de rede.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

async function rotearEnv(page) {
  await page.route('**/api/env', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: 'https://stub.supabase.co', supabaseKey: 'chave-stub' }),
  }));
}

async function abrirAppSemSessao(page) {
  await page.addInitScript(() => {
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          signOut: async () => ({}),
          signInWithPassword: async () => ({ error: { message: 'stub' } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        rpc: async () => ({ data: null, error: null }),
        from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; },
                       then: (r) => r({ data: [], error: null }) }),
      }),
    };
  });
  await rotearEnv(page);
  await page.goto(`${BASE}/pages/biomonitor.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
}

function contarPixelsPretos(w, h, data) {
  let pretos = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 50 && data[i + 1] < 50 && data[i + 2] < 50) pretos++;
  }
  return pretos;
}

test('etiqueta de ninho: 30×54mm, com praia/monitor/data-hora, QR e conteúdo de verdade', async ({ page }) => {
  await abrirAppSemSessao(page);

  const r = await page.evaluate(() => {
    const canvas = bioEtiquetaNinhoCriarCanvas({
      numero: 'PC-TT-2026-001', praia: 'Praia Zé Paraná', monitor_nome: 'Maria Souza',
      criado_em: '2026-06-10T08:14:00.000Z',
    });
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let pretos = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 50 && data[i + 1] < 50 && data[i + 2] < 50) pretos++;
    }
    return { w: canvas.width, h: canvas.height, pretos };
  });

  // 30×54 mm a 203 dpi ≈ 240×432 px
  expect(r.w).toBeCloseTo(240, -1);
  expect(r.h).toBeCloseTo(432, -1);
  expect(r.pretos).toBeGreaterThan(500);
});

test('etiqueta de ninho: praia/monitor comparecem (mais pixel preto do que sem eles)', async ({ page }) => {
  await abrirAppSemSessao(page);

  const { comDados, semDados } = await page.evaluate(() => {
    function contar(dados) {
      const canvas = bioEtiquetaNinhoCriarCanvas(dados);
      const ctx = canvas.getContext('2d');
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let p = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 50) p++;
      return p;
    }
    return {
      comDados: contar({ numero: 'PC-TT-2026-002', praia: 'Praia Zé Paraná', monitor_nome: 'Maria Souza', criado_em: '2026-06-10T08:14:00.000Z' }),
      semDados: contar({ numero: 'PC-TT-2026-002' }),
    };
  });
  expect(comDados).toBeGreaterThan(semDados);
});

test('etiqueta de ninho: nome de praia muito longo é truncado com "…", nunca vaza a largura útil', async ({ page }) => {
  await abrirAppSemSessao(page);

  // Diferente do nome do berçário (placa de 40mm, cabe 2 linhas), a
  // etiqueta de ninho tem só 30mm: _bioEtqLinhaTruncada corta em vez de
  // quebrar linha. Mede a LARGURA MEDIDA do texto resultante (não
  // pixel de canvas — perto do limite, anti-aliasing do glifo sangra
  // 1-2px além do avanço medido, o que não é "vazar a etiqueta" de
  // verdade) contra a largura útil real da função de desenho.
  const r = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const { ctx, W, px } = etqNovoCanvas(canvas, BIO_ETIQUETA_NINHO_MM, BIO_ETIQUETA_DPI);
    const larguraUtil = W - px(1.5) * 2;
    const nomeLongo = 'Praia da Restinga do Igarapé Grande da Reserva Extrativista';
    const longo = _bioEtqLinhaTruncada(ctx, `Praia: ${nomeLongo}`, larguraUtil, 'normal', 'Arial, sans-serif', px(1.7), px(1.4));
    ctx.font = `normal ${longo.tam}px Arial, sans-serif`;
    const larguraMedidaLongo = ctx.measureText(longo.texto).width;

    const nomeCurto = 'Praia Zé Paraná';
    const curto = _bioEtqLinhaTruncada(ctx, `Praia: ${nomeCurto}`, larguraUtil, 'normal', 'Arial, sans-serif', px(1.7), px(1.4));

    return {
      larguraUtil, larguraMedidaLongo,
      truncouLongo: longo.texto.endsWith('…') && longo.texto.length < `Praia: ${nomeLongo}`.length,
      truncouCurto: curto.texto.endsWith('…'),
    };
  });

  expect(r.larguraMedidaLongo).toBeLessThanOrEqual(r.larguraUtil);
  expect(r.truncouLongo).toBe(true);
  expect(r.truncouCurto).toBe(false); // nome curto cabe inteiro, sem "…" à toa
});

test('etiqueta de ninho: sem número, ainda desenha algo (nunca uma tela em branco)', async ({ page }) => {
  await abrirAppSemSessao(page);

  const pretos = await page.evaluate(() => {
    const canvas = bioEtiquetaNinhoCriarCanvas({ numero: null });
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let p = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 50) p++;
    return p;
  });
  expect(pretos).toBeGreaterThan(0);
});

test('etiqueta de berçário: 40×60mm, com dados estáticos e QR — nunca ocupação ao vivo', async ({ page }) => {
  await abrirAppSemSessao(page);

  const r = await page.evaluate(() => {
    const canvas = bioEtiquetaBercarioCriarCanvas({
      codigo: 'BERC-01', nome: 'Berçário Central', tipo: 'tanque_fibra',
      capacidade_max: 500, responsavel_nome: 'Maria Souza', uc_nome: 'Resex Chico Mendes',
    });
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let pretos = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 50) pretos++;
    return { w: canvas.width, h: canvas.height, pretos };
  });

  // 40×60 mm a 203 dpi ≈ 320×480 px
  expect(r.w).toBeCloseTo(320, -1);
  expect(r.h).toBeCloseTo(480, -1);
  expect(r.pretos).toBeGreaterThan(1000);
});

test('etiqueta de berçário: nome longo nunca vaza a largura da placa (auto-ajuste de fonte)', async ({ page }) => {
  await abrirAppSemSessao(page);

  // Mesma prova de tests/agua-etiqueta.test.js (sobreposição de QR real
  // achada em produção): mede a margem direita reservada (pad), só na
  // ALTURA da linha do nome — nunca desde y=0, que cairia dentro da
  // faixa preta do cabeçalho (fillRect) e daria falso positivo. A janela
  // (9.5mm–13mm) fica depois do cabeçalho (7mm) e antes do traço
  // divisório (~13.5mm+), cobrindo só o texto do nome auto-ajustado.
  const margemLivre = await page.evaluate(() => {
    const canvas = bioEtiquetaBercarioCriarCanvas({
      codigo: 'BERC-02', nome: 'Berçário de Recuperação de Filhotes da Reserva Extrativista',
      tipo: 'piscina_alvenaria', capacidade_max: 1200,
    });
    const ctx = canvas.getContext('2d');
    const dpi = 203, mmParaPx = v => Math.round(v * dpi / 25.4);
    const yIni = mmParaPx(9.5), yFim = mmParaPx(13);
    const padPx = mmParaPx(2);
    const { data } = ctx.getImageData(canvas.width - padPx, yIni, padPx, yFim - yIni);
    let pretos = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 50) pretos++;
    return pretos;
  });
  expect(margemLivre).toBe(0);
});

test('etiqueta de lote: 40×60mm, com origem/espécie/data e campo manuscrito de vivos', async ({ page }) => {
  await abrirAppSemSessao(page);

  const r = await page.evaluate(() => {
    const canvas = bioEtiquetaLoteCriarCanvas({
      lote_id: 'uuid-lote-teste', bercario_nome: 'Berçário Central', numero_ninho: 'PC-TT-2026-001',
      especie_nome: 'Tracajá', especie_sigla: 'TT', qtd_entrada: 42, data_entrada: '2026-06-10',
    });
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let pretos = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 50) pretos++;
    return { w: canvas.width, h: canvas.height, pretos };
  });

  expect(r.w).toBeCloseTo(320, -1);
  expect(r.h).toBeCloseTo(480, -1);
  expect(r.pretos).toBeGreaterThan(1000);
});

test('etiqueta de lote: sem dados de espécie/quantidade, ainda desenha sem quebrar', async ({ page }) => {
  await abrirAppSemSessao(page);

  const pretos = await page.evaluate(() => {
    const canvas = bioEtiquetaLoteCriarCanvas({ lote_id: 'uuid-lote-vazio', bercario_nome: 'Berçário X' });
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let p = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 50) p++;
    return p;
  });
  expect(pretos).toBeGreaterThan(0);
});

test('overlay do app: "Etiqueta" no card do ninho abre o preview com o número certo', async ({ page }) => {
  await abrirAppSemSessao(page);

  await page.evaluate(() => {
    bioAbrirEtiquetaNinho({ numero_ninho: 'PC-TT-2026-005', numero_atual: null });
  });

  await expect(page.locator('#bio-etq-overlay')).toBeVisible();
  await expect(page.locator('#bio-etq-titulo')).toHaveText('Etiqueta do ninho');

  const pretos = await page.evaluate(() => {
    const canvas = document.getElementById('bio-etq-canvas');
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let p = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 50) p++;
    return p;
  });
  expect(pretos).toBeGreaterThan(500);

  // Fechar pelo botão limpa o estado (não deixa "preso" pra próxima abertura).
  await page.click('#bio-etq-fechar');
  await expect(page.locator('#bio-etq-overlay')).toBeHidden();
});

test('overlay do app: ninho sem número nenhum não abre o overlay (nada pra imprimir)', async ({ page }) => {
  await abrirAppSemSessao(page);

  await page.evaluate(() => {
    bioAbrirEtiquetaNinho({ numero_ninho: null, numero_atual: null });
  });
  await expect(page.locator('#bio-etq-overlay')).toBeHidden();
});

test('card do ninho: 6 botões de ação (com "Etiqueta") não estouram a largura do card em tela de celular', async ({ page }) => {
  // Relatado em produção: a barra de ações (Corrigir/+Transferência/
  // Eclosão/Visita/Gerar PDF/Etiqueta) usava flex sem quebra de linha —
  // com 6 botões possíveis (status_validacao='em_correcao' + status
  // 'encontrado', o pior caso), a barra ultrapassava a largura do card
  // numa tela estreita. Corrigido com flex-wrap: wrap.
  await page.setViewportSize({ width: 390, height: 844 }); // largura típica de celular
  await abrirAppSemSessao(page);

  await page.evaluate(() => {
    document.getElementById('tela-abertos').classList.add('ativa');
    bioRenderizarListaNinhos('bio-lista-abertos', [{
      id: 'ninho-teste-overflow', status: 'encontrado', status_validacao: 'em_correcao',
      numero_ninho: 'PC-TT-2026-099', especie: 'tracaja', data_encontro: '2026-06-01',
    }], true);
  });

  const card = page.locator('.bio-nfc').first();
  await expect(card).toBeVisible();
  const botoes = card.locator('.bio-nfc-acoes .bio-btn-sm');
  await expect(botoes).toHaveCount(6);

  const overflow = await card.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1); // tolerância de arredondamento de subpixel
});
