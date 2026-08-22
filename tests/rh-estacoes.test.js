// ── DERHQA · Plataformas de Coleta (Fase C) ──────────────────────
// Executar: npx playwright test tests/rh-estacoes.test.js
// (servidor estático na raiz do repo, por padrão http://localhost:5500)
//
// POR QUE ESTE TESTE EXISTE: a tela mostra dado de cheia, e as três
// regras que não podem quebrar numa edição futura são:
// (1) SITUAÇÃO DE COTA NÃO É CALCULADA NO CLIENTE — vem pronta de
//     `vw_rh_estacoes_detalhe` (migration 306), que compara a leitura
//     com as cotas cadastradas da estação. A página só rotula/colore.
// (2) Estação SEM cota cadastrada não é "normal" — é "sem cota
//     cadastrada" (mesma distinção de conama_violacoes nulo na Água).
//     Dizer "normal" para um rio que ninguém sabe classificar é o pior
//     erro possível numa tela de cheia.
// (3) O parser de planilha aceita as grafias reais (HidroWeb e planilha
//     do estado não usam o mesmo cabeçalho) e nunca inventa data:
//     linha sem data válida é descartada e CONTADA, nunca silenciada.
const { test, expect } = require('@playwright/test');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const PAGINA = `${BASE}/pages/rh-estacoes.html`;

const USUARIO_STUB = { id: 'u-teste', nome_completo: 'Técnica de Teste', email: 't@x.invalid', perfil: 'gestor', ativo: true };

const AGORA = Date.now();
const hAtras = h => new Date(AGORA - h * 3600 * 1000).toISOString();

// Três estações de propósito: uma em alerta com leitura recente, uma
// normal, e uma SEM cota cadastrada (o caso que não pode virar
// "normal"). A quarta não tem leitura nenhuma — silêncio de estação é
// informação, não some da lista.
function fixtureEstacoes() {
  return [
    { id: 'e1', nome: 'Rio Branco — Ponte', codigo_ana: '13600002', tipo: 'fluviopluviometrica', situacao: 'operante',
      telemetrica: true, operadora: 'ANA', rio: 'Rio Acre', bacia: 'Purus', municipio: 'Rio Branco',
      lat: -9.97, lng: -67.81, cota_atencao_cm: 1200, cota_alerta_cm: 1370, cota_inundacao_cm: 1420,
      ultima_leitura: hAtras(2), nivel_atual_cm: 1395, variacao_24h_cm: 295, chuva_24h: 50.5, chuva_7d: 120.5,
      situacao_cota: 'alerta', ativo: true },
    { id: 'e2', nome: 'Sena Madureira', codigo_ana: '13470000', tipo: 'fluviometrica', situacao: 'operante',
      telemetrica: false, operadora: 'CPRM', rio: 'Rio Iaco', bacia: 'Purus', municipio: 'Sena Madureira',
      lat: -9.06, lng: -68.66, cota_atencao_cm: 900, cota_alerta_cm: 1000, cota_inundacao_cm: 1100,
      ultima_leitura: hAtras(6), nivel_atual_cm: 640, variacao_24h_cm: -25, chuva_24h: 0, chuva_7d: 18,
      situacao_cota: 'normal', ativo: true },
    { id: 'e3', nome: 'Cruzeiro do Sul', codigo_ana: '12500000', tipo: 'pluviometrica', situacao: 'operante',
      telemetrica: true, operadora: 'SEMA-AC', rio: 'Rio Juruá', bacia: 'Juruá', municipio: 'Cruzeiro do Sul',
      lat: -7.63, lng: -72.75, cota_atencao_cm: null, cota_alerta_cm: null, cota_inundacao_cm: null,
      ultima_leitura: hAtras(3), nivel_atual_cm: 810, variacao_24h_cm: 12, chuva_24h: 8, chuva_7d: 44,
      situacao_cota: null, ativo: true },
    { id: 'e4', nome: 'Xapuri — régua', codigo_ana: null, tipo: 'fluviometrica', situacao: 'intermitente',
      telemetrica: false, operadora: 'Defesa Civil', rio: 'Rio Acre', bacia: 'Purus', municipio: 'Xapuri',
      lat: -10.65, lng: -68.5, cota_atencao_cm: 800, cota_alerta_cm: 900, cota_inundacao_cm: 1000,
      ultima_leitura: null, nivel_atual_cm: null, variacao_24h_cm: null, chuva_24h: null, chuva_7d: null,
      situacao_cota: null, ativo: true },
  ];
}

function fixtureDiario() {
  return [
    { rio: 'Rio Acre', bacia: 'Purus', n_estacoes: 2, nivel_medio_cm: 1290, nivel_max_cm: 1395,
      variacao_cm: 215, chuva_total_mm: 50.5, chuva_max_mm: 30, estacoes_em_cota: 1, pior_situacao: 'alerta',
      detalhe: [{ estacao_id: 'e1', nome: 'Rio Branco — Ponte', nivel_ini_cm: 1180, nivel_fim_cm: 1395, variacao_cm: 215, amplitude_cm: 215, chuva_mm: 50.5, situacao: 'alerta' }] },
    { rio: 'Rio Iaco', bacia: 'Purus', n_estacoes: 1, nivel_medio_cm: 640, nivel_max_cm: 650,
      variacao_cm: -25, chuva_total_mm: 0, chuva_max_mm: 0, estacoes_em_cota: 0, pior_situacao: 'normal',
      detalhe: [{ estacao_id: 'e2', nome: 'Sena Madureira', nivel_ini_cm: 665, nivel_fim_cm: 640, variacao_cm: -25, amplitude_cm: 25, chuva_mm: 0, situacao: 'normal' }] },
  ];
}

async function abrirPagina(page, { estacoes = fixtureEstacoes(), diario = fixtureDiario(), medicoes = [] } = {}) {
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());
  // Leaflet do próprio repositório — unpkg oscila na política de rede
  // deste tipo de ambiente (a PÁGINA continua no CDN em produção).
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', route =>
    route.fulfill({ path: path.join(__dirname, 'fixtures/vendor/leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', route =>
    route.fulfill({ path: path.join(__dirname, 'fixtures/vendor/leaflet.css'), contentType: 'text/css' }));

  await page.addInitScript(({ estacoes, diario, medicoes, usuario }) => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    window.__rpcChamadas = [];
    const consulta = (linhas) => {
      const q = {
        _linhas: linhas,
        eq(col, val) { q._linhas = q._linhas.filter(l => l[col] === val); return q },
        is(col, val) { q._linhas = q._linhas.filter(l => l[col] === val); return q },
        gte() { return q },
        order() { return q },
        then(res) { return Promise.resolve({ data: q._linhas, error: null }).then(res) },
      };
      return q;
    };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-teste' } } } }),
          signOut: async () => ({}),
        },
        rpc: async (nome, args) => {
          window.__rpcChamadas.push({ nome, args });
          if (nome === 'nivel_efetivo') return { data: 'editar' };
          if (nome === 'rh_relatorio_diario') return { data: diario };
          if (nome === 'rh_registrar_medicoes') return { data: (args?.p_medicoes || []).length };
          return { data: null };
        },
        from: (tabela) => {
          if (tabela === 'usuarios') return { select: () => ({ eq: () => ({ single: async () => ({ data: usuario }) }) }) };
          if (tabela === 'minhas_permissoes') return { select: async () => ({ data: [{ chave: 'bacias', nivel: 'editar' }] }) };
          if (tabela === 'vw_rh_estacoes_detalhe') return { select: () => consulta(estacoes.slice()) };
          if (tabela === 'rh_medicoes') return { select: () => consulta(medicoes.slice()) };
          return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
        },
      }),
    };
  }, { estacoes, diario, medicoes, usuario: USUARIO_STUB });

  await page.goto(PAGINA);
  await page.waitForSelector('.rhe-kpis .rhe-kpi, .rhe-vazio', { timeout: 15_000 });
}

// ── Funções puras ────────────────────────────────────────────────
test.describe('js/rh-hidro.js — rótulos, resumo e planilha', () => {
  test('estação SEM cota cadastrada nunca vira "normal"', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.rhCotaLabel === 'function');

    const r = await page.evaluate(() => ({
      semCota: window.rhCotaLabel(null),
      normal: window.rhCotaLabel('normal'),
      alerta: window.rhCotaLabel('alerta'),
      corSemCota: window.rhCotaCor(null),
      corAlerta: window.rhCotaCor('alerta'),
    }));
    expect(r.semCota).toBe('Sem cota cadastrada');
    expect(r.normal).toBe('Normal');
    expect(r.alerta).toBe('Alerta');
    expect(r.corSemCota).not.toBe(r.corAlerta);
  });

  test('resumo conta telemétricas, leitura recente e pior situação do conjunto', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.rhResumoEstacoes === 'function');

    const r = await page.evaluate((est) => window.rhResumoEstacoes(est), fixtureEstacoes());
    expect(r.total).toBe(4);
    expect(r.telemetricas).toBe(2);
    expect(r.comLeituraRecente).toBe(3);   // e4 nunca teve leitura
    expect(r.semLeitura).toBe(1);
    expect(r.emCota).toBe(1);              // só e1
    expect(r.pior).toBe('alerta');
    expect(r.bacias).toEqual(['Juruá', 'Purus']);
  });

  test('parser de planilha aceita as grafias reais e descarta linha sem data — contando', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.rhParseCsvMedicoes === 'function');

    // Cabeçalho no estilo da planilha brasileira: ';' como separador,
    // vírgula decimal, data dd/mm/aaaa, coluna "cota" em vez de nível.
    const csv = [
      'Data;Cota;Chuva',
      '10/03/2026 08:00;1.180,5;12,5',
      '10/03/2026 14:00;1.305,0;30,0',
      'sem data;900;1',
    ].join('\n');
    const r = await page.evaluate((txt) => window.rhParseCsvMedicoes(txt), csv);
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas[0].nivel_cm).toBe(1180.5);
    expect(r.linhas[0].chuva_mm).toBe(12.5);
    expect(r.linhas[0].data_hora.startsWith('2026-03-10T08:00')).toBe(true);
    expect(r.erros.join(' ')).toContain('1 linha(s) sem data válida');
  });

  test('CSV sai com BOM e ponto-e-vírgula (o que o Excel pt-BR abre direto)', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.rhCsvEstacoes === 'function');

    const csv = await page.evaluate((est) => window.rhCsvEstacoes(est), fixtureEstacoes());
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv.split('\r\n')[0]).toContain('Código ANA;Nome');
    expect(csv).toContain('Sem cota cadastrada');   // e3/e4 nunca aparecem como "Normal"
  });

  test('hidrograma desenha nível, chuva e as linhas de cota rotuladas', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.rhHidrogramaHTML === 'function');

    const html = await page.evaluate(() => window.rhHidrogramaHTML([
      { data_hora: '2026-03-10T03:00:00Z', nivel_cm: 1180, chuva_mm: 12.5 },
      { data_hora: '2026-03-10T09:00:00Z', nivel_cm: 1305, chuva_mm: 30 },
      { data_hora: '2026-03-10T15:00:00Z', nivel_cm: 1395, chuva_mm: 8 },
    ], { cotas: { atencao: 1200, alerta: 1370, inundacao: 1420 } }));

    expect(html).toContain('<polyline');        // linha do nível
    expect(html).toContain('<rect');            // barras de chuva
    expect(html).toContain('Cota de alerta');   // rótulo, não só a cor
    expect(html).toContain('Nível do rio (cm)');
    // Sem leitura nenhuma: mensagem, nunca gráfico vazio quebrado.
    const vazio = await page.evaluate(() => window.rhHidrogramaHTML([], {}));
    expect(vazio).toContain('Sem leituras no período');
  });
});

// ── Render ───────────────────────────────────────────────────────
test.describe('tela das plataformas — render', () => {
  test('KPIs, lista e mapa saem do dado da view', async ({ page }) => {
    await abrirPagina(page);

    await expect(page.locator('.rhe-kpi').first()).toContainText('4');
    await expect(page.locator('.rhe-kpi', { hasText: 'Acima de alguma cota' })).toContainText('Alerta');
    // #rhe-lista escopa: a tabela do relatório diário usa a MESMA classe.
    await expect(page.locator('#rhe-lista .rhe-tab tbody tr')).toHaveCount(4);
    // Estação sem leitura continua na lista (silêncio é informação).
    await expect(page.locator('#rhe-lista tbody tr', { hasText: 'Xapuri' })).toContainText('sem leitura');
    // Um marcador por estação com coordenada.
    await expect(page.locator('.leaflet-marker-pane, .leaflet-overlay-pane path')).not.toHaveCount(0);
  });

  test('a coluna de cota mostra "Sem cota cadastrada" — nunca "Normal" — para estação sem cota', async ({ page }) => {
    await abrirPagina(page);

    const linha = page.locator('#rhe-lista tbody tr', { hasText: 'Cruzeiro do Sul' });
    await expect(linha.locator('.rhe-cota')).toHaveText('Sem cota cadastrada');
    await expect(page.locator('#rhe-lista tbody tr', { hasText: 'Sena Madureira' }).locator('.rhe-cota')).toHaveText('Normal');
  });

  test('relatório diário por rio aparece com variação e estações em cota', async ({ page }) => {
    await abrirPagina(page);

    const bloco = page.locator('.adash-card', { hasText: 'Relatório diário por rio' });
    await expect(bloco.locator('tbody tr')).toHaveCount(2);
    await expect(bloco.locator('tbody tr', { hasText: 'Rio Acre' })).toContainText('+215 cm');
    await expect(bloco.locator('tbody tr', { hasText: 'Rio Acre' }).locator('.rhe-cota')).toHaveText('Alerta');
    // Rio sem estação em cota não mostra chip nenhum.
    await expect(bloco.locator('tbody tr', { hasText: 'Rio Iaco' }).locator('.rhe-cota')).toHaveCount(0);
    // A RPC é chamada com a data escolhida — a tela nunca agrega sozinha.
    const chamadas = await page.evaluate(() => window.__rpcChamadas.filter(c => c.nome === 'rh_relatorio_diario'));
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas[0].args.p_data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('clicar numa estação abre o hidrograma com as cotas dela', async ({ page }) => {
    await abrirPagina(page, {
      medicoes: [
        { estacao_id: 'e1', data_hora: hAtras(30), nivel_cm: 1180, chuva_mm: 12.5, origem: 'telemetria' },
        { estacao_id: 'e1', data_hora: hAtras(20), nivel_cm: 1305, chuva_mm: 30, origem: 'telemetria' },
        { estacao_id: 'e1', data_hora: hAtras(2), nivel_cm: 1395, chuva_mm: 8, origem: 'telemetria' },
      ],
    });

    await page.locator('#rhe-lista tbody tr', { hasText: 'Rio Branco' }).click();
    const modal = page.locator('#rhe-modal');
    await expect(modal).toHaveClass(/aberto/);
    await expect(modal).toContainText('Rio Branco — Ponte');
    await expect(modal.locator('svg[aria-label^="Hidrograma"]')).toBeVisible();
    await expect(modal).toContainText('Cota de alerta');
    await expect(modal).toContainText('3 leitura(s) no período');
  });

  test('estação sem cota avisa no detalhe que o sistema não classifica', async ({ page }) => {
    await abrirPagina(page, { medicoes: [{ estacao_id: 'e3', data_hora: hAtras(4), nivel_cm: 810, chuva_mm: 8, origem: 'telemetria' }] });

    await page.locator('#rhe-lista tbody tr', { hasText: 'Cruzeiro do Sul' }).click();
    await expect(page.locator('#rhe-modal')).toContainText('não tem cota cadastrada');
  });

  test('importação usa a RPC idempotente, nunca INSERT direto', async ({ page }) => {
    await abrirPagina(page);

    await page.locator('button', { hasText: 'Importar leituras' }).click();
    await expect(page.locator('#rhe-modal')).toContainText('Importar leituras');

    const csv = 'Data;Cota;Chuva\n10/03/2026 08:00;1180;12,5\n10/03/2026 14:00;1305;30';
    await page.setInputFiles('#f-imp-arquivo', { name: 'leituras.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await page.locator('button', { hasText: 'Importar' }).last().click();

    await expect(page.locator('#rhe-imp-msg')).toContainText('2 leitura(s) gravada(s)');
    const chamada = await page.evaluate(() => window.__rpcChamadas.find(c => c.nome === 'rh_registrar_medicoes'));
    expect(chamada).toBeTruthy();
    expect(chamada.args.p_medicoes).toHaveLength(2);
    expect(chamada.args.p_medicoes[0].estacao_id).toBeTruthy();
  });

  test('sem estação nenhuma, a tela orienta em vez de mostrar tabela vazia', async ({ page }) => {
    await abrirPagina(page, { estacoes: [], diario: [] });
    await expect(page.locator('#rhe-lista .rhe-vazio')).toContainText('Nenhuma estação cadastrada');
    await expect(page.locator('#rhe-diario .rhe-vazio')).toContainText('Nenhuma leitura registrada');
  });
});
