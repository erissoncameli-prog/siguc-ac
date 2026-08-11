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
    { nome: 'Maria da Silva', sexo: 'feminino', necessidade_especifica: 'Cadeira de rodas', usuario_id: null },
    { nome: 'João <b>XSS</b>', sexo: null, necessidade_especifica: null, usuario_id: null },
  ]);
  expect(r.depoisRemover).toBe(1);
  expect(r.escapou).toBe(true);
  expect(r.alerta).toContain('1 passageiro(s) com necessidade específica');
  expect(r.alerta).toContain('Gestante');
  expect(r.semAlerta).toBe('');
  expect(r.fallbackAntigo).toBe('Carlos, Beatriz');   // viagem da migration 184
  expect(r.resumo).toContain('Ana');
});

// Busca de passageiro na base de usuários (migration 236). `db.from`
// é substituído por um dublê no próprio teste — não bate na rede de
// verdade — só pra confirmar que o módulo liga os resultados da busca
// ao formulário certo. A policy de leitura de `usuarios` em produção
// já é aberta a qualquer autenticado (ver cabeçalho da migration 236),
// então não há RPC privilegiada nova pra testar aqui.
test('busca de passageiro: preenche nome e guarda o vínculo, sem copiar telefone', async ({ page }) => {
  await page.goto(`${BASE}/pages/frota-app.html`);
  await page.waitForFunction(() => typeof window.fpFormHTML === 'function', null, { timeout: 15_000 });
  await page.locator('#tela-login-frota').waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => { document.getElementById('tela-login-frota').hidden = true; });

  const r = await page.evaluate(async () => {
    const box = document.createElement('div');
    box.innerHTML = '<input id="f-passageiros" type="number">' + fpFormHTML({ compacto: true });
    document.body.appendChild(box);
    fpLimpar();

    // `db` é `let` no escopo do script (js/config.js), inicializado só
    // depois de loadEnv() resolver — sem rede de verdade (servidor
    // estático deste teste) isso nunca acontece. Substitui a variável
    // inteira em vez de mutar uma propriedade seria mutar `undefined`.
    db = {
      from: (tabela) => {
        if (tabela !== 'usuarios') throw new Error('tabela inesperada: ' + tabela);
        return {
          select: () => ({ eq: () => ({ ilike: () => ({ order: () => ({ limit: () => Promise.resolve({
            data: [{ id: '11111111-1111-1111-1111-111111111111', nome_completo: 'Zeca Testado', telefone: '(68) 99999-0000' }],
            error: null,
          }) }) }) }) }),
        };
      },
    };

    await fpBuscarUsuarios('zeca');
    const dropdownAberto = document.getElementById('fp-resultados').style.display;
    const itemMostrado = document.getElementById('fp-resultados').textContent.includes('Zeca Testado');

    fpEscolherUsuario(0);
    const nomePreenchido = document.getElementById('fp-nome').value;
    const dropdownFechado = document.getElementById('fp-resultados').style.display;

    fpAdicionar();
    const payload = fpPayload();

    return { dropdownAberto, itemMostrado, nomePreenchido, dropdownFechado, payload };
  });

  expect(r.dropdownAberto).toBe('');                 // visível (display vazio = regra do CSS)
  expect(r.itemMostrado).toBe(true);
  expect(r.nomePreenchido).toBe('Zeca Testado');
  expect(r.dropdownFechado).toBe('none');
  expect(r.payload).toEqual([
    { nome: 'Zeca Testado', sexo: null, necessidade_especifica: null, usuario_id: '11111111-1111-1111-1111-111111111111' },
  ]);
  // telefone não aparece em lugar nenhum do payload — é resolvido ao
  // vivo pela view, nunca copiado pra cá.
  expect(JSON.stringify(r.payload)).not.toContain('99999');
});

// Distribuição/remanejo na divisão em vários veículos (migration 236,
// par obrigatório frota-viagens.html ⇄ frota-app.html modo gestor).
test('divisão em vários veículos: distribui igualmente e permite remanejar', async ({ page }) => {
  await page.goto(`${BASE}/pages/frota-app.html`);
  await page.waitForFunction(() => typeof window.fpDistribuirLinhas === 'function', null, { timeout: 15_000 });

  const r = await page.evaluate(() => {
    const viagem = {
      passageiros: 6,
      passageiros_lista: [
        { id: 'p1', nome: 'Pax 1' }, { id: 'p2', nome: 'Pax 2' }, { id: 'p3', nome: 'Pax 3' },
        { id: 'p4', nome: 'Pax 4' }, { id: 'p5', nome: 'Pax 5' }, { id: 'p6', nome: 'Pax 6' },
      ],
    };
    const linhas = [
      { veiculo_id: 'v1', motorista_id: 'm1', passageiros: 0 },
      { veiculo_id: 'v2', motorista_id: 'm2', passageiros: 0 },
    ];
    fpDistribuirLinhas(linhas, viagem);
    const distribuicaoInicial = linhas.map(l => l.passageiros);
    // Round-robin: linha 0 = [p1,p3,p5], linha 1 = [p2,p4,p6].
    const distribuicaoRoundRobin = linhas.map(l => l.passageiro_ids.slice());

    fpMoverPassageiro(linhas, 'p1', 1);   // move Pax 1 (estava na linha 0) pra linha 1
    const aposMover = linhas.map(l => l.passageiro_ids.length);
    const linha0TemP1 = linhas[0].passageiro_ids.includes('p1');
    const linha1TemP1 = linhas[1].passageiro_ids.includes('p1');

    const chipsLinha1 = fpChipsLinhaHTML(linhas, 1, viagem, 'moverFn');
    const chipsTemSelectComOnchange = chipsLinha1.includes("moverFn('p1'");

    // Sem lista nomeada — só a contagem, distribuída em partes iguais.
    const linhasSemNomes = [{ passageiros: 0 }, { passageiros: 0 }, { passageiros: 0 }];
    fpDistribuirLinhas(linhasSemNomes, { passageiros: 7 });
    const semNomesInalterado = linhasSemNomes.map(l => l.passageiros);   // não distribui headcount puro (fora do escopo)

    // Remover linha 0 (com passageiros) joga eles pra linha 0 remanescente.
    const linhasParaRemover = [
      { passageiro_ids: ['a', 'b'], passageiros: 2 },
      { passageiro_ids: ['c'], passageiros: 1 },
    ];
    fpRemoverLinhaComPassageiros(linhasParaRemover, 0);
    const sobrouUmaLinha = linhasParaRemover.length === 1;
    const herdouOrfaos = linhasParaRemover[0].passageiro_ids.sort().join(',');

    return {
      distribuicaoInicial, distribuicaoRoundRobin, aposMover, linha0TemP1, linha1TemP1,
      chipsTemSelectComOnchange, semNomesInalterado, sobrouUmaLinha, herdouOrfaos,
    };
  });

  expect(r.distribuicaoInicial).toEqual([3, 3]);      // 6 passageiros, 3 em cada — o pedido literal
  expect(r.distribuicaoRoundRobin).toEqual([['p1', 'p3', 'p5'], ['p2', 'p4', 'p6']]);
  expect(r.aposMover).toEqual([2, 4]);
  expect(r.linha0TemP1).toBe(false);
  expect(r.linha1TemP1).toBe(true);
  expect(r.chipsTemSelectComOnchange).toBe(true);
  expect(r.semNomesInalterado).toEqual([0, 0, 0]);    // sem lista estruturada, fpDistribuirLinhas não mexe
  expect(r.sobrouUmaLinha).toBe(true);
  expect(r.herdouOrfaos).toBe('a,b,c');
});

// Migration 242: a aprovação passa a abrir JÁ dividida quando o grupo
// não cabe em um veículo, e a distribuição dos nomes respeita a cota
// que o banco reservou para cada veículo (antes o round-robin cego
// podia pôr 3 nomes num carro de 2 lugares).
test('divisão respeita a cota de cada veículo e parte o grupo quando não há sugestão', async ({ page }) => {
  await page.goto(`${BASE}/pages/frota-app.html`);
  await page.waitForFunction(() => typeof window.fpDistribuirLinhas === 'function', null, { timeout: 15_000 });

  const r = await page.evaluate(() => {
    const viagem = {
      passageiros: 6,
      passageiros_lista: [
        { id: 'p1', nome: 'Pax 1' }, { id: 'p2', nome: 'Pax 2' }, { id: 'p3', nome: 'Pax 3' },
        { id: 'p4', nome: 'Pax 4' }, { id: 'p5', nome: 'Pax 5' }, { id: 'p6', nome: 'Pax 6' },
      ],
    };

    // Cotas desiguais, como frota_sugerir_alocacao devolve quando os
    // veículos escalados têm capacidades diferentes (van 4 + carro 2).
    const desiguais = [
      { veiculo_id: 'v1', passageiros: 4 },
      { veiculo_id: 'v2', passageiros: 2 },
    ];
    fpDistribuirLinhas(desiguais, viagem);
    const respeitouCota = desiguais.map(l => l.passageiro_ids.length);

    // Dois veículos de igual capacidade: o caso do dia a dia — 3 e 3.
    const iguais = [{ veiculo_id: 'v1', passageiros: 3 }, { veiculo_id: 'v2', passageiros: 3 }];
    fpDistribuirLinhas(iguais, viagem);
    const meioAMeio = iguais.map(l => l.passageiro_ids.length);

    // Frota não cobre o grupo: o excedente ainda é distribuído (não
    // pode sumir da tela), e o gestor vê o estouro pelos avisos.
    const insuficiente = [{ veiculo_id: 'v1', passageiros: 2 }, { veiculo_id: 'v2', passageiros: 2 }];
    fpDistribuirLinhas(insuficiente, viagem);
    const ninguemSumiu = insuficiente.reduce((s, l) => s + l.passageiro_ids.length, 0);

    // Sem veículo disponível nenhum: linhas vazias já partem o grupo.
    const vazias = fpLinhasVazias(6);
    fpDistribuirLinhas(vazias, viagem);

    return {
      respeitouCota, meioAMeio, ninguemSumiu,
      vaziasSemVeiculo: vazias.every(l => !l.veiculo_id),
      vaziasDivididas: vazias.map(l => l.passageiros),
      avisoUmVeiculo: fpAvisoDivisaoHTML(1, 4, 4),
      avisoDois: fpAvisoDivisaoHTML(2, 6, 8),
      avisoNaoCabe: fpAvisoDivisaoHTML(2, 10, 8),
    };
  });

  expect(r.respeitouCota).toEqual([4, 2]);        // nunca 3 e 3 num par 4+2
  expect(r.meioAMeio).toEqual([3, 3]);            // 6 passageiros, 3 em cada
  expect(r.ninguemSumiu).toBe(6);
  expect(r.vaziasSemVeiculo).toBe(true);
  expect(r.vaziasDivididas).toEqual([3, 3]);      // e não [6, 0], o bug original
  expect(r.avisoUmVeiculo).toBe('');              // um veículo basta: nada a avisar
  expect(r.avisoDois).toContain('2 veículos');
  expect(r.avisoDois).not.toContain('faltam lugares');
  expect(r.avisoNaoCabe).toContain('faltam lugares para 2');
});
