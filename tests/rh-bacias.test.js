// ── DERHQA · Painel das Bacias Hidrográficas (Fase B) ────────────
// Executar: npx playwright test tests/rh-bacias.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual às outras suítes da Água)
//
// POR QUE ESTE TESTE EXISTE: pages/rh-bacias.html é a primeira tela do
// subgrupo "Bacias Hidrográficas" e nasce com uma restrição que é fácil
// perder de vista numa edição futura — **não existe polígono de bacia
// no sistema**. A divisão por bacia vem do campo de texto
// `agua_pontos_coleta.bacia`, e a tela precisa dizer isso na cara do
// usuário (o aviso do topo) em vez de fingir um recorte geográfico que
// não foi feito. Além disso:
// (1) a comparação ENTRE bacias é a razão de existir da página — o
//     painel de Relatórios sempre olha UM recorte; escolher uma bacia
//     aqui destaca, mas NUNCA esconde as outras da tabela;
// (2) IQA médio de bacia é número, nunca faixa — classificar uma média
//     seria recalcular no cliente o que agua_iqa_faixa() faz no banco;
// (3) coleta em quarentena entra marcada, nunca escondida (mesma
//     cautela do mapa e do painel).
const { test, expect } = require('@playwright/test');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const PAGINA = `${BASE}/pages/rh-bacias.html`;

const USUARIO_STUB = { id: 'u-teste', nome_completo: 'Técnica de Teste', email: 't@x.invalid', perfil: 'gestor', ativo: true };

// Três bacias com perfis diferentes de propósito: Purus (2 pontos, com
// quarentena e violação), Juruá (1 ponto, tudo conforme) e uma coleta
// sem bacia definida (o caso real do Rio Iquiri).
function fixtureColetas() {
  const b = { classe_enquadramento: 'classe_2', uc_id: null };
  return [
    { ...b, ponto_bacia: 'Purus', ponto_id: 'p-rb', ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Acre',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-10',
      status: 'completo', iqa: 80.0, iqa_faixa: 'Ótima', conama_violacoes: [] },
    { ...b, ponto_bacia: 'Purus', ponto_id: 'p-rb', ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Acre',
      campanha_id: 'c2', campanha_ano: 2024, campanha_ordem: 'segunda', data_coleta: '2024-09-12',
      status: 'quarentena', iqa: 40.0, iqa_faixa: 'Ruim', conama_violacoes: ['turbidez'] },
    { ...b, ponto_bacia: 'Purus', ponto_id: 'p-sm', ponto_nome: 'Sena Madureira', codigo_ana: '13470000', ponto_municipio: 'Sena Madureira', ponto_rio: 'Rio Iaco',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-11',
      status: 'completo', iqa: 60.0, iqa_faixa: 'Boa', conama_violacoes: ['turbidez', 'od'] },
    { ...b, ponto_bacia: 'Juruá', ponto_id: 'p-cz', ponto_nome: 'Cruzeiro do Sul', codigo_ana: '12500000', ponto_municipio: 'Cruzeiro do Sul', ponto_rio: 'Rio Juruá',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-12',
      status: 'completo', iqa: 70.0, iqa_faixa: 'Boa', conama_violacoes: [] },
    { ...b, ponto_bacia: null, ponto_id: 'p-iq', ponto_nome: 'Rio Iquiri', codigo_ana: null, ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Iquiri',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-13',
      status: 'completo', iqa: 50.0, iqa_faixa: 'Regular', conama_violacoes: null },
  ];
}

const PONTOS_GEOM = [
  { id: 'p-rb', geom: { type: 'Point', coordinates: [-67.81, -9.97] }, ativo: true },
  { id: 'p-sm', geom: { type: 'Point', coordinates: [-68.66, -9.06] }, ativo: true },
  { id: 'p-cz', geom: { type: 'Point', coordinates: [-72.75, -7.63] }, ativo: true },
  { id: 'p-iq', geom: { type: 'Point', coordinates: [-67.20, -9.60] }, ativo: true },
];

async function abrirPagina(page, coletas = fixtureColetas(), pontosGeom = PONTOS_GEOM) {
  // Mesmo cuidado das outras suítes da Água: o supabase-js do CDN
  // sobrescreveria o stub em máquina com internet e a página cairia no
  // redirect do login; o Leaflet (unpkg) precisa carregar de verdade.
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());
  // Leaflet servido do próprio repositório (tests/fixtures/vendor):
  // unpkg.com oscila na política de rede deste tipo de ambiente, e sem
  // o Leaflet a metade do mapa destes testes vira flake — não é o que
  // está sob teste. A PÁGINA continua carregando do CDN em produção.
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', route =>
    route.fulfill({ path: path.join(__dirname, 'fixtures/vendor/leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', route =>
    route.fulfill({ path: path.join(__dirname, 'fixtures/vendor/leaflet.css'), contentType: 'text/css' }));

  await page.addInitScript(({ coletas, usuario, pontosGeom }) => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const consulta = (linhas) => {
      const q = {
        _linhas: linhas,
        eq(col, val) { q._linhas = q._linhas.filter(l => l[col] === val); return q },
        is(col, val) { q._linhas = q._linhas.filter(l => l[col] === val); return q },
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
        rpc: async (nome) => (nome === 'nivel_efetivo' ? { data: 'editar' } : { data: null }),
        from: (tabela) => {
          if (tabela === 'usuarios') return { select: () => ({ eq: () => ({ single: async () => ({ data: usuario }) }) }) };
          if (tabela === 'minhas_permissoes') return { select: async () => ({ data: [{ chave: 'bacias', nivel: 'editar' }, { chave: 'agua', nivel: 'editar' }] }) };
          if (tabela === 'vw_agua_coletas_detalhe') return { select: () => consulta(coletas.slice()) };
          if (tabela === 'agua_pontos_coleta') return { select: () => consulta(pontosGeom.slice()) };
          return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
        },
      }),
    };
  }, { coletas, usuario: USUARIO_STUB, pontosGeom });

  await page.goto(PAGINA);
  await page.waitForSelector('.rhb-bacias, .adash-vazio', { timeout: 15_000 });
}

// ── Agregação (pura, sem render) ─────────────────────────────────
test.describe('aguaRelPorBacia — comparativo entre bacias', () => {
  test('uma linha por bacia, com pontos/coletas/IQA/conformidade, e "sem bacia" por último', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelPorBacia === 'function');

    const bacias = await page.evaluate((coletas) => window.aguaRelPorBacia(coletas), fixtureColetas());

    expect(bacias.map(b => b.label)).toEqual(['Purus', 'Juruá', 'Sem bacia definida']);

    const purus = bacias[0];
    expect(purus).toMatchObject({ nPontos: 2, nColetas: 3, nRios: 2, quarentena: 1 });
    expect(purus.iqaMedio).toBeCloseTo(60.0, 5);      // (80 + 40 + 60) / 3
    expect(purus.pctConforme).toBeCloseTo(100 / 3, 5); // 1 conforme de 3 avaliadas
    expect(purus.rios).toEqual(['Rio Acre', 'Rio Iaco']);
    expect(purus.ultimaCampanha).toBe('2024 · 2ª campanha');

    // "Sem bacia definida" nunca é descartada — é lacuna de cadastro
    // (Rio Iquiri, caso real), e some da tela seria pior que aparecer.
    const sem = bacias[2];
    expect(sem.semBacia).toBe(true);
    expect(sem.nColetas).toBe(1);
    // conama_violacoes null = ponto sem limites cadastrados para a
    // classe: não conta como conforme NEM como violação.
    expect(sem.comConama).toBe(0);
    expect(sem.pctConforme).toBeNull();
  });

  test('série da bacia é o IQA MÉDIO por campanha, sem faixa (média nunca é classificada)', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelSerieBacia === 'function');

    const serie = await page.evaluate((coletas) => window.aguaRelSerieBacia(coletas, 'Purus'), fixtureColetas());
    expect(serie).toHaveLength(2);
    expect(serie[0]).toMatchObject({ label: '2024·1ª', iqa: 70, faixa: null, status: 'completo' });   // (80+60)/2
    expect(serie[1]).toMatchObject({ label: '2024·2ª', iqa: 40, faixa: null, status: 'quarentena' }); // só a quarentenada
  });
});

// ── Render de ponta a ponta ──────────────────────────────────────
test.describe('painel das bacias — render', () => {
  test('um card por bacia, com os números reais e o selo de conferência', async ({ page }) => {
    await abrirPagina(page);

    await expect(page.locator('.rhb-bacia-card')).toHaveCount(3);
    const purus = page.locator('.rhb-bacia-card', { hasText: 'Purus' });
    await expect(purus.locator('.rhb-bacia-iqa strong')).toHaveText('60.0');
    await expect(purus).toContainText('2 rios monitorados');
    await expect(purus.locator('.rhb-quarentena')).toHaveText('1 em conferência');

    // Tabela comparativa traz as três, sempre.
    await expect(page.locator('.rhb-tab tbody tr')).toHaveCount(3);
    await expect(page.locator('.rhb-tab tbody tr').first()).toContainText('Purus');
  });

  test('o aviso de que NÃO há polígono oficial de bacia é visível — a divisão vem do cadastro do ponto', async ({ page }) => {
    await abrirPagina(page);

    const aviso = page.locator('.rhb-aviso');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('ainda vem do cadastro do ponto, não de um polígono oficial');
    await expect(aviso).toContainText('ottobacias da ANA');
  });

  test('escolher uma bacia destaca e recorta o MAPA, mas nunca some com as outras da comparação', async ({ page }) => {
    await abrirPagina(page);

    await expect(page.locator('.adash-mapa-pin')).toHaveCount(4);

    await page.locator('.rhb-bacia-card', { hasText: 'Juruá' }).click();
    await expect(page.locator('.rhb-bacia-card.ativo')).toContainText('Juruá');
    await expect(page.locator('.adash-mapa-pin')).toHaveCount(1); // só Cruzeiro do Sul
    // A comparação continua inteira — é a razão de existir da tela.
    await expect(page.locator('.rhb-tab tbody tr')).toHaveCount(3);
    await expect(page.locator('.rhb-bacia-card')).toHaveCount(3);

    // Clicar de novo volta ao Acre inteiro.
    await page.locator('.rhb-bacia-card', { hasText: 'Juruá' }).click();
    await expect(page.locator('.rhb-bacia-card.ativo')).toHaveCount(0);
    await expect(page.locator('.adash-mapa-pin')).toHaveCount(4);
  });

  test('rede hidrográfica e limites ficam visíveis também no mapa de RUAS (referenciaSempre) — diferente do painel de Relatórios', async ({ page }) => {
    await abrirPagina(page);

    // Rótulo de município aparece sem precisar trocar para satélite.
    await expect(page.locator('.adash-mapa-mun-label').first()).toBeVisible({ timeout: 10_000 });
    // E a legenda não promete "só satélite" nesta tela.
    const legenda = page.locator('.adash-mapa-legenda');
    await expect(legenda).toContainText('Camadas de referência');
    await expect(legenda).not.toContainText('só satélite');
  });

  test('IQA médio por bacia sai como NÚMERO, nunca como faixa classificada', async ({ page }) => {
    await abrirPagina(page);

    const barras = page.locator('svg[aria-label^="Barras"]');
    await expect(barras).toBeVisible();
    await expect(barras).toContainText('60.0'); // Purus
    await expect(barras).toContainText('70.0'); // Juruá
    // Nenhum rótulo de faixa colado na média (a faixa só existe por coleta).
    await expect(barras).not.toContainText('Ótima');
    await expect(barras).not.toContainText('Regular');
  });

  test('violações CONAMA aparecem por bacia; bacia sem limites cadastrados não vira "conforme"', async ({ page }) => {
    await abrirPagina(page);

    const card = page.locator('.adash-card', { hasText: 'Parâmetros fora do limite CONAMA' });
    await expect(card.locator('.adash-lista-linha', { hasText: 'Purus' })).toContainText('Turbidez (2)');
    await expect(card.locator('.adash-lista-linha', { hasText: 'Juruá' })).toContainText('Nenhuma violação');
    // Sem bacia definida: 1 coleta, sem limites → nem conforme nem violação.
    await expect(page.locator('.rhb-tab tbody tr', { hasText: 'Sem bacia definida' })).toContainText('—');
  });

  test('sem coleta nenhuma, a tela diz isso — nunca quebra', async ({ page }) => {
    await abrirPagina(page, []);
    await expect(page.locator('.adash-vazio')).toContainText('Nenhuma coleta cadastrada');
  });
});
