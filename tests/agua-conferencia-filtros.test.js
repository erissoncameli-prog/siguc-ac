// ── SIGUC Qualidade da Água · filtros da tela de conferência ────
// Executar: npx playwright test tests/agua-conferencia-filtros.test.js
//
// A conferência de quarentena lista ~230 coletas e tinha uma busca de
// texto só. Pedido do usuário: filtrar por ano, rio e demais atributos.
//
// O QUE ESTE GUARDA TRAVA
// 1. Os filtros COMBINAM entre si e com a busca de texto — nunca um
//    substitui o outro (é o modo de falha típico de filtro novo em
//    tela que já tinha busca).
// 2. Cada select lista só o que EXISTE na quarentena carregada, e a
//    escolha sobrevive a um novo render (agPreencherSelect preserva o
//    valor; recriar as opções sem isso apagaria o filtro aplicado).
// 3. A categoria do motivo é DERIVADA por palavra-chave e nada mais —
//    motivo desconhecido cai em 'Outro' e a linha continua visível.
//    Sumir com linha por não saber rotulá-la seria perder trabalho de
//    conferência, que é justamente o que esta tela existe para não
//    deixar acontecer.
// 4. Lista vazia por FILTRO diz outra coisa que lista vazia por
//    quarentena zerada — as duas frases não podem se confundir.
//
// A página real é exercitada (não uma cópia da lógica), com o cliente
// Supabase stubado: mesmo contorno de tests/agua-guia-mesa.test.js —
// sem bloquear o CDN, o supabase-js real sobrescreve o stub e a página
// cai no login.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

const USUARIO_STUB = { id: 'u-conf', nome_completo: 'Técnica de Teste', email: 't@x.invalid', perfil: 'gestor', ativo: true };

// Fixture com a variedade que os filtros precisam separar: dois anos,
// duas campanhas, duas bacias, três rios, e os motivos reais da
// migration 253 (a frase carrega o valor medido — por isso a categoria
// é derivada, nunca agrupada pelo texto cru).
const COLETAS = [
  { id: 'c1', linha_origem_planilha: 11, codigo_amostra: 'COL-2021-0001', data_coleta: '2021-03-10', status: 'quarentena',
    quarentena_motivo: 'Sólidos em suspensão preenchidos (0.321 mg/L) — incoerente com a mediana da série; suspeita de mistura de unidade g/L×mg/L.',
    agua_pontos_coleta: { nome: 'Rio Branco', codigo_ana: '13600002', rio: 'Rio Acre', bacia: 'Purus', municipio: 'Rio Branco' },
    agua_campanhas: { ano: 2021, ordem: 'primeira' } },
  { id: 'c2', linha_origem_planilha: 12, codigo_amostra: 'COL-2021-0002', data_coleta: '2021-09-10', status: 'quarentena',
    quarentena_motivo: 'OD 27.0 mg/L muito acima da saturação calculada para a temperatura da amostra.',
    agua_pontos_coleta: { nome: 'Xapuri', codigo_ana: '13600004', rio: 'Rio Acre', bacia: 'Purus', municipio: 'Xapuri' },
    agua_campanhas: { ano: 2021, ordem: 'segunda' } },
  { id: 'c3', linha_origem_planilha: 13, codigo_amostra: 'COL-2022-0003', data_coleta: '2022-04-01', status: 'quarentena',
    quarentena_motivo: 'Ano da campanha (2022) diverge em mais de 1 ano da data da coleta.',
    agua_pontos_coleta: { nome: 'Santa Rosa', codigo_ana: '13650000', rio: 'Rio Purus', bacia: 'Purus', municipio: 'Santa Rosa do Purus' },
    agua_campanhas: { ano: 2022, ordem: 'primeira' } },
  { id: 'c4', linha_origem_planilha: 14, codigo_amostra: 'COL-2022-0004', data_coleta: '2022-10-01', status: 'quarentena',
    quarentena_motivo: 'Motivo que nenhuma palavra-chave conhece — precisa continuar visível.',
    agua_pontos_coleta: { nome: 'Cruzeiro do Sul', codigo_ana: '12550000', rio: 'Rio Juruá', bacia: 'Juruá', municipio: 'Cruzeiro do Sul' },
    agua_campanhas: { ano: 2022, ordem: 'segunda' } },
];

async function abrirConferencia(page) {
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.addInitScript(([usuario, coletas]) => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const consulta = (tabela) => {
      let filtroStatus = null;
      const q = {
        select: () => q, in: () => q, is: () => q, order: () => q, limit: () => q,
        eq: (col, val) => { if (col === 'status') filtroStatus = val; return q },
        single: async () => ({ data: usuario, error: null }),
        maybeSingle: async () => ({ data: usuario, error: null }),
        then: (r) => {
          let data = [];
          if (tabela === 'agua_coletas') data = filtroStatus === 'quarentena' ? coletas : coletas.map(c => ({ status: c.status }));
          return Promise.resolve({ data, error: null }).then(r);
        },
      };
      return q;
    };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: usuario.id } } } }),
          getUser: async () => ({ data: { user: { id: usuario.id } } }),
          signOut: async () => ({}),
        },
        rpc: async (nome) => (nome === 'nivel_efetivo' ? { data: 'editar', error: null } : { data: null, error: null }),
        from: (tabela) => consulta(tabela),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      }),
    };
  }, [USUARIO_STUB, COLETAS]);

  await page.goto(`${BASE}/pages/agua-conferencia.html`);
  await page.locator('#ag-f-ano').waitFor({ state: 'visible', timeout: 20_000 });
  await expect(page.locator('#tbody-ag tr')).toHaveCount(COLETAS.length);
}

const linhas = (page) => page.locator('#tbody-ag tr td:first-child');

test('cada select nasce só com o que existe na quarentena', async ({ page }) => {
  await abrirConferencia(page);
  const opcoes = (id) => page.locator(`#${id} option`).allInnerTexts();

  expect(await opcoes('ag-f-ano')).toEqual(['Todos os anos', '2022', '2021']);   // mais recente primeiro
  expect(await opcoes('ag-f-bacia')).toEqual(['Todas as bacias', 'Juruá', 'Purus']);
  expect(await opcoes('ag-f-rio')).toEqual(['Todos os rios', 'Rio Acre', 'Rio Juruá', 'Rio Purus']);
  expect((await opcoes('ag-f-municipio')).length).toBe(5);   // 4 municípios distintos + "Todos"
  expect((await opcoes('ag-f-ponto')).length).toBe(5);
});

test('filtrar por ano recorta a lista e o contador diz que está filtrado', async ({ page }) => {
  await abrirConferencia(page);
  await page.selectOption('#ag-f-ano', '2021');
  await expect(linhas(page)).toHaveText(['11', '12']);
  await expect(page.locator('#ag-contador')).toContainText('2 de 4');
  await expect(page.locator('#ag-contador')).toContainText('filtrado');
});

test('filtrar por rio funciona e COMBINA com o filtro de campanha', async ({ page }) => {
  await abrirConferencia(page);
  await page.selectOption('#ag-f-rio', 'Rio Acre');
  await expect(linhas(page)).toHaveText(['11', '12']);

  // O segundo filtro não pode substituir o primeiro — é o modo de
  // falha clássico de filtro novo numa tela que já filtrava.
  await page.selectOption('#ag-f-campanha', 'segunda');
  await expect(linhas(page)).toHaveText(['12']);
});

test('filtro por atributo COMBINA com a busca de texto, nos dois sentidos', async ({ page }) => {
  await abrirConferencia(page);
  await page.fill('#ag-filtro', 'xapuri');
  await expect(linhas(page)).toHaveText(['12']);

  await page.selectOption('#ag-f-ano', '2022');   // texto e ano se contradizem: resultado vazio, não "um vence"
  await expect(page.locator('#tbody-ag')).toContainText('com esses filtros');

  await page.fill('#ag-filtro', '');
  await expect(linhas(page)).toHaveText(['13', '14']);
});

test('busca de texto passou a achar pelo código da amostra', async ({ page }) => {
  await abrirConferencia(page);
  await page.fill('#ag-filtro', 'col-2022-0004');
  await expect(linhas(page)).toHaveText(['14']);
});

test('categoria do motivo é derivada; motivo desconhecido vira "Outro" e nunca some', async ({ page }) => {
  await abrirConferencia(page);
  const rotulos = await page.locator('#ag-f-motivo option').allInnerTexts();
  expect(rotulos.join(' | ')).toContain('Sólidos em suspensão');
  expect(rotulos.join(' | ')).toContain('OD acima da saturação');
  expect(rotulos.join(' | ')).toContain('Ano da campanha divergente');
  expect(rotulos.join(' | ')).toContain('Outro motivo');

  await page.selectOption('#ag-f-motivo', 'solidos');
  await expect(linhas(page)).toHaveText(['11']);

  // A linha de motivo desconhecido continua alcançável — o objetivo é
  // nunca esconder trabalho de conferência por falta de rótulo.
  await page.selectOption('#ag-f-motivo', 'outro');
  await expect(linhas(page)).toHaveText(['14']);
});

test('a escolha do filtro sobrevive a um novo render da lista', async ({ page }) => {
  await abrirConferencia(page);
  await page.selectOption('#ag-f-bacia', 'Purus');
  await page.evaluate(() => renderLista());
  expect(await page.locator('#ag-f-bacia').inputValue()).toBe('Purus');
  await expect(linhas(page)).toHaveText(['11', '12', '13']);
});

test('"Limpar filtros" só aparece com filtro ativo e devolve a lista inteira', async ({ page }) => {
  await abrirConferencia(page);
  await expect(page.locator('#ag-limpar')).toBeHidden();

  await page.selectOption('#ag-f-municipio', 'Xapuri');
  await page.fill('#ag-filtro', '12');
  await expect(page.locator('#ag-limpar')).toBeVisible();

  await page.locator('#ag-limpar').click();
  await expect(linhas(page)).toHaveCount(COLETAS.length);
  await expect(page.locator('#ag-limpar')).toBeHidden();
  expect(await page.locator('#ag-filtro').inputValue()).toBe('');
});

test('lista vazia por filtro não se confunde com quarentena zerada', async ({ page }) => {
  await abrirConferencia(page);
  await page.selectOption('#ag-f-rio', 'Rio Juruá');
  await page.selectOption('#ag-f-ano', '2021');   // combinação sem nenhuma coleta
  const vazio = page.locator('#tbody-ag');
  await expect(vazio).toContainText('com esses filtros');
  await expect(vazio).not.toContainText('Nenhuma coleta em quarentena<');
});
