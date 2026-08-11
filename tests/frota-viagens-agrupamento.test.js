// ── Frota · status efetivo e agrupamento das viagens ─────────────
// Executar: npx playwright test tests/frota-viagens-agrupamento.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual ao tests/frota-passageiros.test.js)
//
// Guarda de js/frota-viagens-status.js, o arquivo único que as quatro
// superfícies usam (frota-app.html nos 3 modos, frota-solicitar.html,
// frota-viagens.html e frota-dashboard.html). Roda dentro da PÁGINA
// REAL, como os outros testes do módulo.
//
// O que ele trava:
//  - viagem aprovada que passou do retorno previsto SEM check-out
//    conta como "não realizada" e cai no bloco de passadas, mesmo
//    antes de o cron da migration 241 materializar o status no banco;
//  - a mesma regra vale para a solicitação nunca respondida, com
//    motivo diferente (sem_aprovacao × sem_inicio);
//  - o que a view já resolveu (status_efetivo) tem precedência sobre a
//    derivação do cliente — senão as duas verdades divergem;
//  - viagem em andamento vencida continua EM ANDAMENTO (o veículo está
//    na rua, só atrasado) — é o caso da migration 201, não o desta;
//  - ordem dos blocos: próximas em ordem crescente (a mais próxima
//    primeiro), passadas em decrescente.

const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

test('status efetivo e agrupamento de viagens', async ({ page }) => {
  await page.goto(`${BASE}/pages/frota-app.html`);
  await page.waitForFunction(() => typeof window.fvAgrupar === 'function', null, { timeout: 15_000 });

  const r = await page.evaluate(() => {
    const dia = 86400 * 1000;
    const iso = ms => new Date(Date.now() + ms).toISOString();

    const vencidaAprovada = {
      id: 'a', status: 'aprovada',
      data_saida_prevista: iso(-3 * dia), data_retorno_prevista: iso(-2 * dia),
    };
    const vencidaSolicitada = {
      id: 'b', status: 'solicitada',
      data_saida_prevista: iso(-5 * dia), data_retorno_prevista: iso(-4 * dia),
    };
    const proximaLonge = {
      id: 'c', status: 'aprovada',
      data_saida_prevista: iso(10 * dia), data_retorno_prevista: iso(11 * dia),
    };
    const proximaPerto = {
      id: 'd', status: 'solicitada',
      data_saida_prevista: iso(2 * dia), data_retorno_prevista: iso(3 * dia),
    };
    const emAndamentoAtrasada = {
      id: 'e', status: 'em_andamento',
      data_saida_prevista: iso(-2 * dia), data_retorno_prevista: iso(-1 * dia),
    };
    const concluidaOntem = {
      id: 'f', status: 'concluida',
      data_saida_prevista: iso(-1 * dia), data_retorno_prevista: iso(-0.5 * dia),
    };
    // A view mandou: mesmo com data futura, vale o que o banco disse.
    const daView = {
      id: 'g', status: 'aprovada', status_efetivo: 'cancelada',
      data_saida_prevista: iso(4 * dia), data_retorno_prevista: iso(5 * dia),
    };

    const todas = [vencidaAprovada, vencidaSolicitada, proximaLonge, proximaPerto,
                   emAndamentoAtrasada, concluidaOntem, daView];
    const g = fvAgrupar(todas);

    return {
      statusVencidaAprovada: fvStatus(vencidaAprovada),
      statusVencidaSolicitada: fvStatus(vencidaSolicitada),
      motivoAprovada: fvMotivoNaoRealizacao(vencidaAprovada),
      motivoSolicitada: fvMotivoNaoRealizacao(vencidaSolicitada),
      statusDaView: fvStatus(daView),
      statusAndamento: fvStatus(emAndamentoAtrasada),
      atrasada: fvAtrasada(emAndamentoAtrasada),
      atrasadaProxima: fvAtrasada(proximaPerto),
      grupos: {
        andamento: g.andamento.map(v => v.id),
        futura: g.futura.map(v => v.id),
        passada: g.passada.map(v => v.id),
      },
      ativas: fvAtivas(todas),
      labelApp: fvLabel(vencidaAprovada, 'app'),
      labelMesa: fvLabel(vencidaAprovada),
      explicacaoSemInicio: fvExplicacao(vencidaAprovada),
      explicacaoSemAprovacao: fvExplicacao(vencidaSolicitada),
      explicacaoConcluida: fvExplicacao(concluidaOntem),
    };
  });

  // Vencida sem check-out = não realizada, com o motivo certo.
  expect(r.statusVencidaAprovada).toBe('nao_realizada');
  expect(r.statusVencidaSolicitada).toBe('nao_realizada');
  expect(r.motivoAprovada).toBe('sem_inicio');
  expect(r.motivoSolicitada).toBe('sem_aprovacao');

  // O que a view calculou manda.
  expect(r.statusDaView).toBe('cancelada');

  // Em andamento vencida continua em andamento — é atraso, não ausência.
  expect(r.statusAndamento).toBe('em_andamento');
  expect(r.atrasada).toBe(true);
  expect(r.atrasadaProxima).toBe(false);

  // Blocos e ordem.
  expect(r.grupos.andamento).toEqual(['e']);
  expect(r.grupos.futura).toEqual(['d', 'c']);          // crescente: a mais próxima primeiro
  expect(r.grupos.passada).toEqual(['g', 'f', 'a', 'b']); // decrescente pela saída prevista
  expect(r.ativas).toBe(3);                              // 1 em andamento + 2 futuras

  // Rótulos e explicação.
  expect(r.labelApp).toBe('Não realizada');
  expect(r.labelMesa).toBe('Não realizada');
  expect(r.explicacaoSemInicio).toContain('não foi iniciada');
  expect(r.explicacaoSemAprovacao).toContain('não foi aprovada');
  expect(r.explicacaoConcluida).toBe('');
});
