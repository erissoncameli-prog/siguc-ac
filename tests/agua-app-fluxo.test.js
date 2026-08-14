// ── SIGUC Qualidade da Água · app de campo — fluxo offline→fila→sync ──
// Executar: npx playwright test tests/agua-app-fluxo.test.js
//
// Fase 3 do plano em docs/qualidade-agua/plano.md. Mesmo padrão dos
// outros guardas de app de campo (tests/frota-app-barra.test.js): abre
// a página real contra um servidor estático local, sem depender de
// rede real para Supabase (o ambiente de execução bloqueia
// cdn.jsdelivr.net/supabase.co pelo proxy — confirmado por curl antes
// de escrever este teste). O login/PIN reais não são exercitados aqui
// (exigiriam usuário de auth.users e rede) — o que este teste garante é
// a MECÂNICA client-side: salvar offline (IndexedDB), aparecer na fila,
// e a sincronização (com um cliente Supabase stub) mover pendente →
// confirmado, upando a foto e montando o payload esperado por
// agua_coletas. O contrato do lado do banco (que esse payload realmente
// aparece em vw_agua_coletas_detalhe com status='aguardando_lab' e na
// fila de agua-laudos.html) é conferido à parte, via execute_sql direto
// contra produção — documentado no PR/commit, não neste arquivo.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const FOTO_FIXTURE = path.join(__dirname, 'fixtures', 'agua-teste.jpg');

// O binário headless_shell que o Playwright 1.61 pediria não está
// pré-instalado neste ambiente (só a build completa do Chromium, ver
// /root/.ccr/README.md) — mesmo contorno documentado no system prompt
// para outros projetos: aponta o launch para o executável real.
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

async function abrirAppSemLogin(page) {
  const erros = [];
  page.on('pageerror', e => erros.push(String(e)));
  page.on('console', msg => {
    if (msg.type() === 'error') erros.push(msg.text());
  });

  await page.goto(`${BASE}/pages/agua-app.html`);
  // boot() é assíncrono e termina em mostrarTela('tela-login') quando não
  // há sessão nem PIN cacheado — mesma corrida documentada no teste do
  // Frota. Espera a tela de login assentar antes de mexer no DOM.
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
  return erros;
}

// Simula um login já concluído (sem exercitar auth real, indisponível
// neste ambiente — ver cabeçalho) e entra na Home com um ponto de
// coleta cacheado, exatamente como sincronizarPontos() deixaria.
async function entrarComoColetorDeTeste(page) {
  await page.evaluate(async () => {
    await aOfflineInit();
    const ponto = {
      id: 'ponto-teste-0001',
      codigo_ana: '12345678',
      nome: 'Rio Teste — Ponte Nova',
      municipio: 'Rio Branco',
      rio: 'Rio Teste',
      geom: { type: 'Point', coordinates: [-67.8243, -9.9754] },
    };
    await aOfflineSalvarPontos([ponto]);
    App.coletor = { id: 'coletor-teste-0001', nome_completo: 'Teste Coletor' };
    App.pontos = [ponto];
    await entrarHome();
  });
  await page.locator('#tela-home').waitFor({ state: 'visible', timeout: 10_000 });
}

test('salva uma coleta offline e ela aparece na fila como pendente', async ({ page }) => {
  const erros = await abrirAppSemLogin(page);
  await entrarComoColetorDeTeste(page);

  await page.locator('#btn-nova-coleta').click();
  await page.locator('#tela-form').waitFor({ state: 'visible' });

  await page.selectOption('#f-ponto', 'ponto-teste-0001');
  await page.fill('#f-data', '2026-08-14');
  await page.fill('#f-hora', '09:30');
  await page.fill('#f-temp-ar', '27.5');
  await page.fill('#f-temp-amostra', '26.1');
  await page.fill('#f-ph', '7.2');
  await page.fill('#f-od', '6.8');
  await page.fill('#f-turbidez', '12.4');
  await page.fill('#f-condutividade', '48.3');
  await page.fill('#f-codigo-amostra', 'AM-TESTE-001');
  await page.fill('#f-obs', 'Coleta de teste automatizado — não é dado real.');

  // Foto: caminho web (input capture) — bCapturaProcessarArquivo aplica
  // marca d'água via canvas real do Chromium headless.
  await page.setInputFiles('#input-foto-camera', FOTO_FIXTURE);
  // bCapturaProcessarArquivo é assíncrono (FileReader + Image + canvas);
  // espera a galeria de preview mostrar 1 foto antes de prosseguir.
  await page.locator('#foto-grid .foto-thumb').waitFor({ state: 'visible', timeout: 10_000 });

  await page.locator('#btn-salvar').click();
  await page.locator('#tela-home').waitFor({ state: 'visible', timeout: 10_000 });

  // O registro tem que estar na fila do IndexedDB, pendente, com o
  // payload que o formulário montou — inclusive foto convertida para
  // base64 (nunca Blob cru — regressão do iOS documentada no Brigadas).
  const pendentes = await page.evaluate(() => aOfflineListarPendentes());
  expect(pendentes).toHaveLength(1);
  const r = pendentes[0];
  expect(r.status).toBe('pendente');
  expect(r.ponto_id).toBe('ponto-teste-0001');
  expect(r.data_coleta).toBe('2026-08-14');
  expect(r.campanha_ano).toBe(2026);
  expect(r.campanha_ordem).toBe('segunda'); // mês 8 > 6 → segunda campanha
  expect(r.temp_ar).toBeCloseTo(27.5);
  expect(r.temp_amostra).toBeCloseTo(26.1);
  expect(r.ph).toBeCloseTo(7.2);
  expect(r.od).toBeCloseTo(6.8);
  expect(r.turbidez).toBeCloseTo(12.4);
  expect(r.condutividade_eletrica).toBeCloseTo(48.3);
  expect(r.codigo_amostra).toBe('AM-TESTE-001');
  expect(r.observacoes).toContain('Coleta de teste automatizado');
  expect(typeof r.foto_blob).toBe('string');
  expect(r.foto_blob.startsWith('data:image/')).toBe(true); // base64, não Blob
  expect(r.uuid_cliente).toBeTruthy();

  // Badge da fila e tela da fila em si
  const badge = page.locator('#nav-badge');
  await expect(badge).toHaveText('1');
  await expect(badge).toBeVisible();

  await page.locator('[data-tela="tela-fila"]').click();
  await page.locator('#tela-fila').waitFor({ state: 'visible' });
  await expect(page.locator('#stat-pendentes')).toHaveText('1');
  await expect(page.locator('#fila-lista .sync-item.sync-pendente')).toHaveCount(1);
  await expect(page.locator('#fila-lista')).toContainText('Rio Teste — Ponte Nova');

  const errosRelevantes = erros.filter(e =>
    !/cdn\.jsdelivr|supabase\.co|Failed to load resource|fonts\.googleapis|ERR_/i.test(e)
    // Service-Worker-Allowed: / (vercel.json) só existe em produção — o
    // servidor estático de teste não manda esse header, então o registro
    // do SW com scope /pages/agua-app.html é legitimamente rejeitado
    // aqui (mesma restrição de escopo que /pwa/sw.js documenta no
    // cabeçalho). Não é um erro do app.
    && !/not under the max scope allowed/i.test(e));
  expect(errosRelevantes, `Erros de console inesperados:\n${errosRelevantes.join('\n')}`).toEqual([]);
});

test('sincronização move pendente → confirmado e monta o payload esperado', async ({ page }) => {
  await abrirAppSemLogin(page);
  await entrarComoColetorDeTeste(page);

  // Salva uma coleta mínima (sem foto, para isolar o teste de sync do
  // teste de captura de foto acima).
  await page.evaluate(async () => {
    App.gpsAtual = { lat: -9.976, lng: -67.826, acc: 8 } // ~250m do ponto — não dispara aviso
    const registro = {
      uuid_cliente: crypto.randomUUID(),
      ponto_id: 'ponto-teste-0001',
      campanha_ano: 2026,
      campanha_ordem: 'segunda',
      data_coleta: '2026-08-14',
      hora_coleta: '10:00',
      coletor_id: App.coletor.id,
      temp_ar: 28, temp_amostra: 27, ph: 7.0, od: 6.5, turbidez: 10, condutividade_eletrica: 40,
      codigo_amostra: null,
      observacoes: null,
      lat: App.gpsAtual.lat, lng: App.gpsAtual.lng,
      foto_blob: null,
    }
    await aOfflineSalvar(registro)
  });

  // Stub do cliente Supabase — captura exatamente o payload que
  // aSyncMontarPayload monta, sem rede real (bloqueada neste ambiente).
  const payloadCapturado = await page.evaluate(async () => {
    let capturado = null
    window.db = {
      auth: {
        getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
        refreshSession: async () => ({ error: null }),
      },
      from: (tabela) => ({
        upsert: (payload, opts) => {
          if (tabela === 'agua_campanhas') {
            return { select: () => ({ single: async () => ({ data: { id: 'campanha-teste-0001' }, error: null }) }) }
          }
          if (tabela === 'agua_coletas') {
            capturado = payload
            return Promise.resolve({ error: null })
          }
          throw new Error('upsert inesperado em ' + tabela)
        },
      }),
      storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/agua-fotos-campo/foo.jpg' } }) }) },
    }
    db = window.db // `db` é `let` no escopo global do script da página

    // aSyncRodar já aguarda aSyncExecutar() (que emite 'sync-fim' antes de
    // retornar) internamente — não há por que esperar o evento de novo
    // depois: o listener seria registrado DEPOIS do emit já ter disparado.
    const r = await aSyncRodar()
    return { capturado, resultado: r }
  });

  expect(payloadCapturado.resultado).toBe('ok');
  const p = payloadCapturado.capturado;
  expect(p.campanha_id).toBe('campanha-teste-0001');
  expect(p.ponto_id).toBe('ponto-teste-0001');
  expect(p.data_coleta).toBe('2026-08-14');
  expect(p.temp_ar).toBe(28);
  expect(p.ph).toBe(7.0);
  expect(p.localizacao).toBe('SRID=4326;POINT(-67.826 -9.976)');
  expect(p.foto_url).toBeNull();
  // Campos internos do IndexedDB não podem vazar para o payload do banco
  expect(p.foto_blob).toBeUndefined();
  expect(p.status).toBeUndefined();
  expect(p.campanha_ano).toBeUndefined();
  expect(p.campanha_ordem).toBeUndefined();
  expect(p.lat).toBeUndefined();
  expect(p.lng).toBeUndefined();

  const todos = await page.evaluate(() => aOfflineListarTodos());
  expect(todos).toHaveLength(1);
  expect(todos[0].status).toBe('confirmado');
  expect(todos[0].sincronizado_em).toBeTruthy();

  await expect(page.locator('#nav-badge')).toBeHidden();
});

test('Histórico: gráfico por ponto e lista de minhas coletas', async ({ page }) => {
  await abrirAppSemLogin(page);
  await entrarComoColetorDeTeste(page);

  // Stub do cliente Supabase para as duas consultas da aba Histórico —
  // mesma técnica do teste de sync: sem rede real neste ambiente.
  await page.evaluate(() => {
    const HIST_PONTO = [
      { id: 'c1', data_coleta: '2024-03-10', campanha_ano: 2024, campanha_ordem: 'primeira', status: 'completo', iqa: 82, iqa_faixa: 'Ótima', conama_conforme: true },
      { id: 'c2', data_coleta: '2024-09-14', campanha_ano: 2024, campanha_ordem: 'segunda', status: 'quarentena', iqa: 61, iqa_faixa: 'Regular', conama_conforme: false, conama_violacoes: ['dbo', 'turbidez'] },
      { id: 'c3', data_coleta: '2025-03-12', campanha_ano: 2025, campanha_ordem: 'primeira', status: 'aguardando_lab', iqa: null, iqa_faixa: null, conama_conforme: null },
    ]
    const MINHAS = [
      { id: 'm1', ponto_nome: 'Rio Teste', codigo_ana: '12345678', data_coleta: '2026-08-10', campanha_ano: 2026, campanha_ordem: 'segunda', status: 'aguardando_lab', iqa: null, iqa_faixa: null, conama_conforme: null, codigo_amostra: 'AM-01' },
      { id: 'm2', ponto_nome: 'Rio Teste', codigo_ana: '12345678', data_coleta: '2026-01-05', campanha_ano: 2026, campanha_ordem: 'primeira', status: 'completo', iqa: 74, iqa_faixa: 'Boa', conama_conforme: true, codigo_amostra: null },
    ]
    window.db = {
      from: (tabela) => ({
        select: () => ({
          eq: (campo, valor) => {
            const chain = {
              _filtros: { [campo]: valor },
              eq(c2, v2) { this._filtros[c2] = v2; return this },
              order() { return this },
              async then(resolve) {
                if (tabela !== 'vw_agua_coletas_detalhe') return resolve({ data: [], error: null })
                if ('ponto_id' in this._filtros) return resolve({ data: HIST_PONTO, error: null })
                if ('coletor_id' in this._filtros) return resolve({ data: MINHAS, error: null })
                resolve({ data: [], error: null })
              },
              limit() { return this },
            }
            return chain
          },
        }),
      }),
    }
    db = window.db
  })

  await page.locator('[data-tela="tela-historico"]').click()
  await page.locator('#tela-historico').waitFor({ state: 'visible' })

  // "Minhas coletas" carrega sozinho ao abrir a aba
  await expect(page.locator('#h-minhas-lista .sync-item')).toHaveCount(2)
  await expect(page.locator('#h-minhas-lista')).toContainText('Aguardando laudo')
  await expect(page.locator('#h-minhas-lista')).toContainText('74 · Boa')
  await expect(page.locator('#h-minhas-lista')).toContainText('AM-01')

  // Histórico por ponto: escolher o ponto dispara o gráfico + lista
  await page.selectOption('#h-ponto', 'ponto-teste-0001')
  await page.locator('#h-ponto-grafico svg').waitFor({ state: 'visible', timeout: 10_000 })

  // 2 pontos com IQA (círculos preenchidos, um deles em quarentena — mesma
  // cautela do mapa: nunca esconder, só marcar preenchimento fraco) + 1
  // vazado (aguardando_lab, sem IQA ainda, tracejado)
  const circulosPreenchidos = page.locator('#h-ponto-grafico circle[stroke="#fff"]')
  await expect(circulosPreenchidos).toHaveCount(2)
  const circuloQuarentena = page.locator('#h-ponto-grafico circle[fill-opacity="0.5"]')
  await expect(circuloQuarentena).toHaveCount(1)
  const circuloVazado = page.locator('#h-ponto-grafico circle[stroke-dasharray]')
  await expect(circuloVazado).toHaveCount(1)
  await expect(page.locator('#h-ponto-grafico')).toContainText('ainda em conferência')

  // Legenda mostra as 5 faixas, sempre com o nome em texto (nunca só cor)
  for (const faixa of ['Ótima', 'Boa', 'Regular', 'Ruim', 'Péssima']) {
    await expect(page.locator('#h-ponto-grafico')).toContainText(faixa)
  }

  await expect(page.locator('#h-ponto-lista .sync-item')).toHaveCount(3)
  await expect(page.locator('#h-ponto-lista')).toContainText('82 · Ótima')
  await expect(page.locator('#h-ponto-lista')).toContainText('61 · Regular · em conferência')
  await expect(page.locator('#h-ponto-lista')).toContainText('Fora do limite: DBO, Turbidez')
  await expect(page.locator('#h-ponto-lista')).toContainText('Aguardando laudo')
});
