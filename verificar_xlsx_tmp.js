const { chromium } = require('playwright');
const fs = require('fs');

function fixtureMesa() {
  const base = { ponto_bacia: 'Rio Acre', classe_enquadramento: 'classe_2' };
  return [
    { ...base, ponto_id: 'p-rb', ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Acre',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-10', hora_coleta: '09:15:00',
      codigo_amostra: 'AM-0001', status: 'completo', iqa: 78.4, iqa_faixa: 'Boa', conama_violacoes: [],
      ph: 7.1, temp_ar: 27.5, temp_amostra: 26.8, od: 7.9, turbidez: 12.3, condutividade_eletrica: 88,
      dbo: 2.1, laboratorio_nome: 'QUILAB Laboratório', coletor_nome: 'Técnica de Teste', observacoes: 'Coleta de rotina' },
    { ...base, ponto_id: 'p-rb', ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Acre',
      campanha_id: 'c3', campanha_ano: 2025, campanha_ordem: 'primeira', data_coleta: '2025-03-08', hora_coleta: '10:00:00',
      codigo_amostra: 'AM-0002', status: 'quarentena', iqa: 12.5, iqa_faixa: 'Péssima', conama_violacoes: ['ph', 'od'],
      ph: 16.36, temp_ar: 28, temp_amostra: 27, od: 1.2, turbidez: 500, condutividade_eletrica: 90,
      dbo: 9, laboratorio_nome: 'QUILAB Laboratório', coletor_nome: 'Técnica de Teste', quarentena_motivo: 'pH impossível' },
  ];
}
function fixturePublica() {
  // Mesmas colunas que agua_publico_coletas() devolve — SEM hora_coleta,
  // codigo_amostra, coletor_nome, laboratorio_nome, observacoes, quarentena_motivo.
  return fixtureMesa().map(({ hora_coleta, codigo_amostra, coletor_nome, laboratorio_nome, observacoes, quarentena_motivo, ...resto }) => resto);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e)));
  page.on('console', m => { if (m.type() === 'error') console.log('[console:error]', m.text()); });

  // Página em branco só para carregar os scripts na ordem certa (sem
  // precisar do gate de login) — mesmo espírito de smoke test.
  await page.goto('http://127.0.0.1:5500/pages/agua-publico.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForFunction(() => typeof window.aguaRelMontarXlsx === 'function', { timeout: 15000 });

  for (const [nome, coletas] of [['mesa', fixtureMesa()], ['publico', fixturePublica()]]) {
    const base64 = await page.evaluate(async (coletas) => {
      const rel = window.aguaRelMontar(coletas, {});
      const buf = await window.aguaRelMontarXlsx(rel, 'Rio Acre', '2024·1ª — 2025·1ª',
        { secretaria: 'SEMA-AC' }, 'SIGUC-2026-TESTE');
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }, coletas);
    const out = `verif-${nome}.xlsx`;
    fs.writeFileSync(out, Buffer.from(base64, 'base64'));
    console.log(nome, '->', out, Buffer.from(base64, 'base64').length, 'bytes');
  }

  await browser.close();
})();
