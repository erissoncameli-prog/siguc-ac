// ── App Frota · editor de passageiros da viagem ──────────────────
// Executar: npx playwright test tests/frota-passageiros.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual ao tests/frota-app-barra.test.js)
//
// Guarda de js/frota-passageiros.js, o arquivo único que as três
// superfícies usam (frota-solicitar.html, frota-app.html e
// frota-viagens.html). O teste roda dentro da PÁGINA REAL, e não num
// DOM sintético, porque o módulo depende de helpers globais do
// projeto (esc, toast, bIconsAplicar) — carregá-lo isolado testaria
// outra coisa.
//
// O que ele trava:
//  - o nº de passageiros passa a ser derivado da lista;
//  - o nome é escapado (a lista é montada com innerHTML e o nome vem
//    digitado por um servidor, mas pode vir de uma viagem repetida);
//  - a leitura cai no texto livre da migration 184 quando a viagem é
//    antiga e não tem linhas estruturadas (migration 235);
//  - o alerta de necessidade específica — a razão de o dado existir —
//    só aparece quando há necessidade declarada.

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

test('editor de passageiros: adiciona, remove, sincroniza contagem e monta payload', async ({ page }) => {
  await page.goto(`${BASE}/pages/frota-app.html`);
  await page.waitForFunction(() => typeof window.fpFormHTML === 'function', null, { timeout: 15_000 });
  await page.locator('#tela-login-frota').waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => { document.getElementById('tela-login-frota').hidden = true; });

  const r = await page.evaluate(() => {
    // Só o campo de contagem + o editor: reproduz de propósito um
    // formulário PARCIAL, para garantir que o módulo não quebre quando
    // um pedaço da tela do solicitante não está montado.
    const box = document.createElement('div');
    box.innerHTML = '<input id="f-passageiros" type="number">' + fpFormHTML({ compacto: true });
    document.body.appendChild(box);
    fpLimpar();
    const vazio = document.getElementById('fp-lista').textContent.trim();

    document.getElementById('fp-nome').value = ' Maria da Silva ';
    document.getElementById('fp-sexo').value = 'feminino';
    document.getElementById('fp-tem-nec').checked = true;
    fpToggleNecessidade();
    document.getElementById('fp-nec').value = 'Cadeira de rodas';
    fpAdicionar();

    const necEscondida = document.getElementById('fp-nec-campo').style.display;
    document.getElementById('fp-nome').value = 'João <b>XSS</b>';
    fpAdicionar();

    const html = document.getElementById('fp-lista').innerHTML;
    const contagem = document.getElementById('f-passageiros').value;
    const payload = fpPayload();
    fpRemover(0);
    const depoisRemover = fpPayload().length;

    const viagem = { passageiros_lista: [{ nome: 'Ana', sexo: 'feminino', necessidade_especifica: 'Gestante' }] };
    const antiga = { lista_passageiros: 'Carlos\nBeatriz', passageiros_lista: [] };

    return {
      vazio, necEscondida, contagem, payload, depoisRemover,
      escapou: !html.includes('<b>XSS</b>') && html.includes('&lt;b&gt;'),
      alerta: fpAlertaNecessidadesHTML(viagem),
      semAlerta: fpAlertaNecessidadesHTML(antiga),
      fallbackAntigo: fpTextoPassageiros(antiga),
      resumo: fpResumoHTML(viagem),
    };
  });

  expect(r.vazio).toBe('Nenhum passageiro adicionado');
  expect(r.necEscondida).toBe('none');          // o campo reseta depois de adicionar
  expect(r.contagem).toBe('2');                 // nº de passageiros derivado da lista
  expect(r.payload).toEqual([
    { nome: 'Maria da Silva', sexo: 'feminino', necessidade_especifica: 'Cadeira de rodas' },
    { nome: 'João <b>XSS</b>', sexo: null, necessidade_especifica: null },
  ]);
  expect(r.depoisRemover).toBe(1);
  expect(r.escapou).toBe(true);
  expect(r.alerta).toContain('1 passageiro(s) com necessidade específica');
  expect(r.alerta).toContain('Gestante');
  expect(r.semAlerta).toBe('');
  expect(r.fallbackAntigo).toBe('Carlos, Beatriz');   // viagem da migration 184
  expect(r.resumo).toContain('Ana');
});
