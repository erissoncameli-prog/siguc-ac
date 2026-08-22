const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());
  await page.addInitScript(() => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-anon-key' });
    window.supabase = {
      createClient: () => ({
        rpc: async (nome) => {
          if (nome === 'agua_publico_coletas') return { data: [], error: null };
          if (nome === 'agua_publico_pontos') return { data: [], error: null };
          if (nome === 'agua_publico_cabecalho') return { data: {secretaria:'x',siglaSecr:'x',diretoria:'x',siglaDiret:'x',departamento:'x',logoGoverno:null,logoSecr:null}, error: null };
          throw new Error('RPC inesperada: ' + nome);
        },
      }),
    };
  });
  page.on('console', m => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', String(e)));
  page.on('requestfailed', r => console.log('[reqfailed]', r.url(), r.failure()?.errorText));
  await page.goto('http://127.0.0.1:5500/pages/agua-publico.html');
  await page.waitForTimeout(6000);
  console.log('bodytext(200):', (await page.locator('#app').innerText().catch(()=> 'N/A')).slice(0,200));
  await browser.close();
})();
