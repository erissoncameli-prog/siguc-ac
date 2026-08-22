const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());
  await page.addInitScript((coletas) => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const consulta = (linhas) => {
      const q = { _linhas: linhas, eq(c, v) { q._linhas = q._linhas.filter(l => l[c] === v); return q }, order() { return q }, then(res) { return Promise.resolve({ data: q._linhas, error: null }).then(res) } };
      return q;
    };
    window.supabase = {
      createClient: () => ({
        auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }), signOut: async () => ({}) },
        rpc: async (n) => (n === 'nivel_efetivo' ? { data: 'editar' } : { data: null }),
        from: (t) => {
          if (t === 'usuarios') return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'u', nome_completo: 'T', email: 't@x', perfil: 'gestor', ativo: true } }) }) }) };
          if (t === 'minhas_permissoes') return { select: async () => ({ data: [{ chave: 'agua', nivel: 'editar' }] }) };
          if (t === 'vw_agua_coletas_detalhe') return { select: () => consulta(coletas) };
          if (t === 'agua_pontos_coleta') return { select: () => consulta([]) };
          if (t === 'config_sistema') return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
          return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
        },
      }),
    };
  }, [
    { ponto_id: 'p1', ponto_nome: 'Rio Branco', ponto_bacia: 'Rio Acre', ponto_rio: 'Rio Acre', ponto_municipio: 'Rio Branco', codigo_ana: '13601000',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-10', status: 'completo', iqa: 78.4, iqa_faixa: 'Boa', conama_violacoes: [] },
  ]);
  await page.goto('http://127.0.0.1:5500/pages/agua-relatorios.html');
  await page.waitForTimeout(1500);
  await page.click('#rl-btn-export');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'verif-export-menu.png' });
  const box = await page.locator('#rl-btn-xlsx').boundingBox();
  const visible = await page.locator('#rl-btn-xlsx').isVisible();
  console.log('xlsx button box:', box, 'visible:', visible);
  const menuBox = await page.locator('#rl-export-menu').boundingBox();
  console.log('menu box:', menuBox);
  await browser.close();
})();
