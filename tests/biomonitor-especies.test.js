// ── SIGUC-AC · Biomonitor — nome de espécie vem do catálogo ───────
// Executar: npx playwright test tests/biomonitor-especies.test.js
//
// A SEMA renomeou o pitiú para Iaçá em Administrar › Espécies e metade do
// sistema continuou mostrando "Pitiú": cada tela tinha sua lista fixa.
// js/biomonitor-especies.js virou a fonte única. Estes testes travam:
//   1. a reserva já diz Iaçá (sem banco, sem cache);
//   2. o catálogo carregado troca o nome em TODO mapa registrado — também
//      nos que foram registrados antes da consulta voltar;
//   3. espécie DESATIVADA continua com nome (ninho antigo);
//   4. o cache em localStorage vale na primeira pintura da próxima página;
//   5. nenhuma tela/módulo volta a escrever "Pitiú" fixo.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}
const HARNESS = `${BASE}/tests/fixtures/biomonitor-especies-harness.html`;

const CATALOGO = [
  { codigo: 'tracaja', nome_popular: 'Tracajá', sigla_placa: 'TR', ativo: true, ordem: 1 },
  { codigo: 'pitiU', nome_popular: 'Iaçá', sigla_placa: 'IA', nome_cientifico: 'Podocnemis sextuberculata', ativo: true, ordem: 4 },
  { codigo: 'cabecudo', nome_popular: 'Cabeçudo do catálogo', sigla_placa: 'R', ativo: false, ordem: 3 },
];

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('reserva sem banco e sem cache já diz Iaçá / IA', async ({ page }) => {
  const r = await page.evaluate(() => {
    const m = bioEspNomes({ pitiU: 'Pitiú' })   // mapa antigo de uma página
    return { mapa: m.pitiU, nome: bioEspecieNome('pitiU'), sigla: bioEspecieSigla('pitiU'), cru: bioEspecieNome('xpto') }
  });
  // O mapa da página só é reserva do NOME QUE A PÁGINA TINHA; sem catálogo
  // carregado ele fica como veio — por isso todo mapa foi corrigido para Iaçá.
  expect(r.nome).toBe('Iaçá');
  expect(r.sigla).toBe('IA');
  expect(r.cru).toBe('xpto');
});

test('catálogo carregado troca o nome em todo mapa registrado, inclusive desativada', async ({ page }) => {
  const r = await page.evaluate(async (cat) => {
    const antes = bioEspNomes({ pitiU: 'Pitiú', cabecudo: 'Cabeçudo' })   // registrado ANTES
    const cliente = { from: () => ({ select: () => ({ order: async () => ({ data: cat, error: null }) }) }) }
    await bioEspCarregar(cliente)
    const depois = bioEspNomes({ pitiU: 'Pitiú' })                          // registrado DEPOIS
    return { antes: antes.pitiU, desativada: antes.cabecudo, depois: depois.pitiU,
             cache: JSON.parse(localStorage.getItem('siguc_bio_especies_catalogo')).pitiU.nome }
  }, CATALOGO);
  expect(r.antes).toBe('Iaçá');
  expect(r.depois).toBe('Iaçá');
  expect(r.desativada).toBe('Cabeçudo do catálogo');
  expect(r.cache).toBe('Iaçá');
});

test('cache vale na primeira pintura da próxima página, sem rede', async ({ page }) => {
  await page.evaluate((cat) => bioEspDefinir(cat.map(e => ({ ...e, nome_popular: e.codigo === 'pitiU' ? 'Iaçá (cache)' : e.nome_popular }))), CATALOGO);
  await page.reload();
  const nome = await page.evaluate(() => bioEspNomes({ pitiU: 'Pitiú' }).pitiU);
  expect(nome).toBe('Iaçá (cache)');
});

test('falha do banco nunca quebra: segue com o cache/reserva', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const cliente = { from: () => ({ select: () => ({ order: async () => { throw new Error('offline') } }) }) }
    await bioEspCarregar(cliente)
    return bioEspecieNome('pitiU')
  });
  expect(r).toBe('Iaçá');
});

test('nenhuma tela ou módulo do Biomonitor escreve "Pitiú" fixo', () => {
  const raiz = path.join(__dirname, '..');
  const alvos = [
    ...fs.readdirSync(path.join(raiz, 'pages')).filter(f => f.endsWith('.html')).map(f => path.join('pages', f)),
    ...fs.readdirSync(path.join(raiz, 'js')).filter(f => f.endsWith('.js')).map(f => path.join('js', f)),
  ];
  const achados = [];
  for (const rel of alvos) {
    const linhas = fs.readFileSync(path.join(raiz, rel), 'utf8').split('\n');
    linhas.forEach((l, i) => {
      const codigo = l.replace(/\/\/.*$/, '');   // comentário pode citar o nome antigo
      if (/['"`]Piti[uú]/.test(codigo)) achados.push(`${rel}:${i + 1}`);
    });
  }
  expect(achados).toEqual([]);
});
