const { chromium } = require('playwright');

const USUARIO_STUB = { id: 'u-teste', nome_completo: 'Técnica de Teste', email: 't@x.invalid', perfil: 'gestor', ativo: true };

function initScript({ statusRows, filaRows, quarentenaRows, usuario }) {
  window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
  const consulta = (linhas) => {
    const q = {
      _linhas: linhas,
      eq(col, val) { q._linhas = q._linhas.filter(l => l[col] === val); return q },
      order() { return q },
      then(res) { return Promise.resolve({ data: q._linhas, error: null }).then(res) },
    };
    return q;
  };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u-teste' } } } }), signOut: async () => ({}) },
      rpc: async (nome) => (nome === 'nivel_efetivo' ? { data: 'editar' } : { data: null }),
      from: (tabela) => {
        if (tabela === 'usuarios') return { select: () => ({ eq: () => ({ single: async () => ({ data: usuario }) }) }) };
        if (tabela === 'minhas_permissoes') return { select: async () => ({ data: [{ chave: 'agua', nivel: 'editar' }] }) };
        if (tabela === 'vw_agua_coletas_detalhe') return { select: () => consulta(filaRows.slice()) };
        if (tabela === 'agua_coletas') {
          // atende TANTO a lista filtrada (quarentena) QUANTO a leitura
          // crua de status — a mesma tabela, dois selects diferentes,
          // igual à página real.
          return { select: () => consulta(statusRows.slice()) };
        }
        if (tabela === 'agua_laboratorios') return { select: () => consulta([]) };
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
      },
    }),
  };
}

function fixtureStatus() {
  // 20 aguardando_lab, 300 completo, 45 quarentena — proporção parecida
  // com a série real (450 linhas, maioria completo). As linhas de
  // quarentena vêm com os campos completos (o stub reaproveita esta
  // mesma lista para a query filtrada da tela de Conferência).
  const hoje = Date.now();
  const dias = d => new Date(hoje - d * 86400000).toISOString().slice(0, 10);
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ status: 'aguardando_lab' });
  for (let i = 0; i < 300; i++) rows.push({ status: 'completo' });
  for (let i = 0; i < 45; i++) {
    rows.push({
      status: 'quarentena', linha_origem_planilha: 100 + i, codigo_amostra: `AM-Q${i}`,
      data_coleta: dias(10 + i * 3), quarentena_motivo: 'pH fora de 0-14',
      agua_pontos_coleta: { nome: `Ponto ${i}`, codigo_ana: `1${i}000000` },
      agua_campanhas: { ano: 2022 + (i % 3), ordem: i % 2 ? 'segunda' : 'primeira' },
    })
  }
  return rows;
}

function fixtureFila() {
  const hoje = Date.now();
  const dias = d => new Date(hoje - d * 86400000).toISOString().slice(0, 10);
  return [
    { id: 'c1', status: 'aguardando_lab', ponto_nome: 'Rio Acre — Porto Acre', codigo_ana: '15544000', data_coleta: dias(5), codigo_amostra: 'AM-001', campanha_ano: 2026, campanha_ordem: 'primeira', laudo_url: null, laboratorio_id: null, observacoes: null, data_recebimento_laboratorio: null },
    { id: 'c2', status: 'aguardando_lab', ponto_nome: 'Rio Branco — Centro', codigo_ana: '15600000', data_coleta: dias(42), codigo_amostra: 'AM-002', campanha_ano: 2026, campanha_ordem: 'primeira', laudo_url: null, laboratorio_id: null, observacoes: null, data_recebimento_laboratorio: null },
  ];
}

function fixtureQuarentena() {
  const hoje = Date.now();
  const dias = d => new Date(hoje - d * 86400000).toISOString().slice(0, 10);
  return [
    { id: 'q1', linha_origem_planilha: 271, codigo_amostra: 'AM-Q1', data_coleta: dias(120), quarentena_motivo: 'pH fora de 0-14', agua_pontos_coleta: { nome: 'Rio Iaco', codigo_ana: '15200000' }, agua_campanhas: { ano: 2022, ordem: 'primeira' } },
    { id: 'q2', linha_origem_planilha: 88, codigo_amostra: 'AM-Q2', data_coleta: dias(30), quarentena_motivo: 'Sólidos em suspensão com unidade suspeita', agua_pontos_coleta: { nome: 'Rio Purus', codigo_ana: '15300000' }, agua_campanhas: { ano: 2023, ordem: 'segunda' } },
  ];
}

(async () => {
  const browser = await chromium.launch();
  const base = 'http://127.0.0.1:5500';

  for (const [nome, url, args] of [
    ['agua-laudos', `${base}/pages/agua-laudos.html`, { statusRows: fixtureStatus(), filaRows: fixtureFila(), quarentenaRows: [], usuario: USUARIO_STUB }],
    ['agua-conferencia', `${base}/pages/agua-conferencia.html`, { statusRows: fixtureStatus(), filaRows: [], quarentenaRows: fixtureQuarentena(), usuario: USUARIO_STUB }],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
    await page.addInitScript(initScript, args);
    const erros = [];
    page.on('pageerror', e => erros.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
    await page.goto(url);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${__dirname}/${nome}.png`, fullPage: true });
    console.log(`== ${nome} ==`);
    console.log('erros:', erros.filter(e => !/favicon/.test(e)));
    const kpiHtml = await page.evaluate((sel) => document.querySelector(sel)?.innerHTML?.length || 0, nome === 'agua-laudos' ? '#lz-kpis' : '#ag-kpis');
    console.log('tamanho html do bloco de kpis:', kpiHtml);
    await page.close();
  }

  await browser.close();
})();
