// ── SIGUC · Diagnóstico Socioeconômico · mesa: campanhas e fichas (Fase 4) ─
// Executar: npx playwright test tests/socio-mesa-fase4.test.js
//
// Regra de acesso, transições de situação e o que a identificação esconde
// moram no BANCO (migrations 362c/364, testadas em supabase/tests/socio).
// Aqui se trava a TELA: chama a RPC certa, mostra só o que o banco
// devolveu e nunca deixa a validação passar sem o motivo exigido.
//
// Página real, cliente Supabase stubado por um "banco" em memória.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

const EU = { id: 'u-eu', nome_completo: 'Técnica do DEUC', email: 'eu@x.invalid', perfil: 'tecnico', ativo: true };
const ESTRUTURA = {
  identificacao: { nome: 'opcional', gps: 'opcional' },
  lista: { titulo: 'Moradores', max_linhas: 30, marca_entrevistado: true, colunas: [
    { chave: 'idade', rotulo: 'Idade', tipo: 'inteiro', min: 0, max: 120 },
    { chave: 'apelido', rotulo: 'Apelido', tipo: 'texto', identificacao: true },
  ] },
  blocos: [{ id: 'agua', titulo: 'Água', perguntas: [
    { n: 1, chave: 'agua_fonte', tipo: 'unica', texto: 'De onde vem a água?', opcoes: [{ v: 'rio', r: 'Rio' }, { v: 'poco', r: 'Poço' }, { v: 'outro', r: 'Outro' }] },
    { n: 2, chave: 'agua_trata', tipo: 'unica', texto: 'É tratada?', opcoes: [{ v: 'sim', r: 'Sim' }, { v: 'nao', r: 'Não' }],
      mostrar_se: { se: 'agua_fonte', op: '=', valor: 'rio' } },
    { n: 3, chave: 'renda', tipo: 'inteiro', texto: 'Renda mensal?' },
    { n: 4, chave: 'moradores', tipo: 'tabela', texto: 'Quem mora' },
  ] }],
};

function cenario(gestor) {
  return {
    gestor,
    cat: [{ id: 'i-dsa', codigo: 'DSA', titulo: 'Diagnóstico de domicílios', finalidade: 'Conhecer as famílias.', unidade_analise: 'domicilio',
      ativo: true, unidade_org_id: 'dep', departamento_sigla: 'DEUC', departamento_nome: 'Departamento de UCs', versao_publicada: 1,
      pode_ver: true, pode_ler_fichas: true, pode_aplicar: false, pode_gerir: gestor, sou_admin: false, do_meu_departamento: true,
      pedidos_pendentes: [], acessos_vigentes: [] }],
    versoes: [{ id: 'q-1', instrumento_id: 'i-dsa', versao: 1, status: 'publicado', publicado_em: '2026-10-10T12:00:00Z', hash_sha256: 'a'.repeat(64),
      criado_em: '2026-10-09T12:00:00Z', atualizado_em: '2026-10-10T12:00:00Z', aviso_entrevistado: 'Aviso.', estrutura: ESTRUTURA }],
    camps: [{ id: 'c-1', nome: 'Campanha Juruá', inicio: '2026-10-01', fim: '2099-12-31', situacao: 'planejada', questionario_id: 'q-1', versao: 1,
      exige_municipio: true, exige_uc: false, municipios: ['1200203'], ucs: [], n_aplicadores: 1, n_enviadas: 1, n_devolvidas: 0, n_validadas: 0,
      n_descartadas: 0, criado_em: '2026-10-01T12:00:00Z' }],
    equipe: [
      { usuario_id: 'u-apl', nome: 'Aplicadora', email: 'apl@x.invalid', origem: 'departamento', pode_aplicar: true, na_equipe: true, n_fichas: 1 },
      { usuario_id: 'u-out', nome: 'Outro aplicador', email: 'out@x.invalid', origem: 'acesso', pode_aplicar: true, na_equipe: false, n_fichas: 0 },
    ],
    pacote: {
      municipios: [{ cd_ibge: '1200203', nome: 'Cruzeiro do Sul' }, { cd_ibge: '1200401', nome: 'Rio Branco' }],
      ucs: [{ id: 'uc-1', nome: 'Resex Riozinho', sigla: 'RRL' }],
      comunidades: [{ id: 'com-1', nome: 'Vila Assis', cd_mun: '1200203', uc_id: null }, { id: 'com-2', nome: 'Bairro Novo', cd_mun: '1200401', uc_id: null }],
      campanhas: [], treino: [], minhas_fichas: [],
    },
    fichas: [{ id: 'f-1', codigo: 'DSA-261015-AB12-01', status: 'enviada', treino: false, campanha_id: 'c-1', campanha_nome: 'Campanha Juruá', versao: 1,
      dt_entrevista: '2026-10-15', enviado_em: '2026-10-15T18:00:00Z', entrevistador_id: 'u-apl', entrevistador_nome: 'Aplicadora',
      cd_mun: '1200203', municipio_nome: 'Cruzeiro do Sul', uc_nome: null, comunidade_nome: null, comunidade_nova: 'Vila do Assis',
      aceitou_participar: true, n_alertas: 2, n_pendentes: 1, n_fotos: 1, usou_carencia: false, motivo_devolucao: null, validado_em: null }],
  };
}

function detalhe(gestor) {
  return {
    ficha: { id: 'f-1', codigo: 'DSA-261015-AB12-01', status: 'enviada', treino: false, instrumento_id: 'i-dsa', campanha_id: 'c-1', cd_mun: '1200203',
      uc_id: null, comunidade_id: null, comunidade_nova: 'Vila do Assis', dt_entrevista: '2026-10-15', enviado_em: '2026-10-15T18:00:00Z',
      aceitou_participar: true, fotos_autorizadas: true, respostas: { agua_fonte: 'outro', agua_fonte_outro: 'Cacimba', renda: '_nr' },
      linhas: [{ ordem: 1, idade: 41, e_entrevistado: true }, { ordem: 2, idade: 9 }],
      alertas: [{ tipo: 'pendente', chave: 'x_inexistente', n: 9 }, { tipo: 'comunidade_nova' }],
      motivo_devolucao: null, validado_em: null, usou_carencia: false },
    questionario: { versao: 1, estrutura: ESTRUTURA, hash: 'a'.repeat(64) },
    campanha_nome: 'Campanha Juruá', municipio_nome: 'Cruzeiro do Sul', uc_nome: null, comunidade_nome: null,
    entrevistador_nome: 'Aplicadora', validado_por_nome: null, pode_gerir: gestor, ve_identificacao: gestor,
    identificacao: gestor ? { entrevistado_nome: 'Maria Entrevistada', lat: -7.63, lon: -72.67, gps_precisao_m: 8, obs_localizacao: null,
      linhas: [{ ordem: 1, apelido: 'Dona Maria' }] } : null,
    fotos: gestor ? [{ id: 'ft-1', tema: 'moradia', legenda: 'Frente', arquivo_url: 'http://fake.test/storage/v1/object/public/socio-fotos/u/f.jpg' }] : null,
    historico: [{ status_de: null, status_para: 'enviada', motivo: null, por_nome: 'Aplicadora', em: '2026-10-15T18:00:00Z' }],
  };
}

async function abrir(page, gestor = true) {
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.addInitScript(([usuario, est, det]) => {
    window.__rpc = [];
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const q = (tabela) => {
      const o = {
        select: () => o, order: () => o, limit: () => o, in: () => o, is: () => o, eq: () => o,
        single: async () => ({ data: usuario, error: null }), maybeSingle: async () => ({ data: usuario, error: null }),
        then: (r) => Promise.resolve({ data: tabela === 'socio_questionarios' ? est.versoes : [], error: null }).then(r),
      };
      return o;
    };
    const rpcs = {
      socio_catalogo: () => est.cat,
      socio_meus_departamentos: () => [{ unidade_org_id: 'dep', sigla: 'DEUC', nome: 'Departamento de UCs', origem: 'lotacao' }],
      socio_app_pacote: () => est.pacote,
      socio_campanhas_resumo: () => est.camps,
      socio_campanha_equipe: () => est.equipe,
      socio_fichas_lista: (a) => est.fichas.filter(f => (!a.p_status || f.status === a.p_status) && (!a.p_campanha || f.campanha_id === a.p_campanha)),
      socio_ficha_detalhe: () => det,
      socio_salvar_campanha: () => 'c-novo',
      socio_situacao_campanha: (a) => { est.camps.find(c => c.id === a.p_id).situacao = a.p_situacao; return null },
      socio_definir_aplicador: (a) => { const p = est.equipe.find(x => x.usuario_id === a.p_usuario); p.na_equipe = a.p_incluir; return null },
      socio_mudar_status: (a) => { det.ficha.status = a.p_status; est.fichas[0].status = a.p_status; return null },
      socio_vincular_comunidade: (a) => { det.ficha.comunidade_id = a.p_comunidade; det.comunidade_nome = 'Vila Assis'; return null },
    };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: usuario.id } } } }),
          getUser: async () => ({ data: { user: { id: usuario.id } } }),
          signOut: async () => ({}),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        rpc: async (nome, args) => {
          window.__rpc.push({ nome, args });
          const r = rpcs[nome] ? rpcs[nome](args || {}) : null;
          return { data: JSON.parse(JSON.stringify(r === undefined ? null : r)), error: null };
        },
        from: (t) => q(t),
        storage: { from: () => ({ createSignedUrls: async (paths) => ({ data: paths.map(path => ({ path, signedUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#' + path })), error: null }), createSignedUrl: async () => ({ data: null, error: null }) }) },
      }),
    };
  }, [EU, cenario(gestor), detalhe(gestor)]);
  await page.goto(`${BASE}/pages/socio-questionarios.html`);
  await page.locator('#soc-tbody tr', { hasText: 'DSA' }).getByRole('button', { name: 'Abrir' }).click();
}
const chamadas = (page, nome) => page.evaluate(n => window.__rpc.filter(r => r.nome === n), nome);

test('campanhas: nova campanha envia território marcado e abrir pede confirmação', async ({ page }) => {
  await abrir(page);
  await page.click('#sub-campanhas');
  const linha = page.locator('#soc-sub tr', { hasText: 'Campanha Juruá' });
  await expect(linha).toContainText('Cruzeiro do Sul');
  await expect(linha).toContainText('Planejada');

  await page.getByRole('button', { name: /Nova campanha/ }).click();
  await page.fill('#cp-nome', 'Campanha Rio Branco');
  await page.locator('#cp-muns label', { hasText: 'Rio Branco' }).locator('input').check();
  await page.fill('#cp-fim', '2026-01-01');
  await page.fill('#cp-ini', '2026-02-01');
  await page.click('#cp-salvar');
  expect(await chamadas(page, 'socio_salvar_campanha')).toHaveLength(0);     // fim antes do início: barrado na tela
  await page.fill('#cp-fim', '2026-12-31');
  await page.click('#cp-salvar');
  await expect.poll(async () => (await chamadas(page, 'socio_salvar_campanha')).length).toBe(1);
  const [s] = await chamadas(page, 'socio_salvar_campanha');
  expect(s.args).toMatchObject({ p_id: null, p_instrumento: 'i-dsa', p_questionario: 'q-1', p_nome: 'Campanha Rio Branco',
    p_municipios: ['1200401'], p_ucs: [], p_exige_municipio: true });

  await linha.getByRole('button', { name: 'Abrir' }).click();
  await expect(page.locator('#cf-texto')).toContainText('A equipe passa a ver');
  await page.click('#cf-ok');
  await expect.poll(async () => (await chamadas(page, 'socio_situacao_campanha')).length).toBe(1);
  await expect(page.locator('#soc-sub tr', { hasText: 'Campanha Juruá' })).toContainText('Aberta');
});

test('equipe da campanha: incluir aplicador chama o banco', async ({ page }) => {
  await abrir(page);
  await page.click('#sub-campanhas');
  await page.locator('#soc-sub tr', { hasText: 'Campanha Juruá' }).getByRole('button', { name: 'Equipe' }).click();
  await page.getByRole('checkbox', { name: 'Na equipe: Outro aplicador' }).check();
  await expect.poll(async () => (await chamadas(page, 'socio_definir_aplicador')).length).toBe(1);
  const [a] = await chamadas(page, 'socio_definir_aplicador');
  expect(a.args).toMatchObject({ p_campanha: 'c-1', p_usuario: 'u-out', p_incluir: true });
});

test('fichas: "Ver fichas" filtra pela campanha; detalhe do gestor mostra identificação, salto, NR e "outro"', async ({ page }) => {
  await abrir(page);
  await page.click('#sub-campanhas');
  await page.locator('#soc-sub tr', { hasText: 'Campanha Juruá' }).getByRole('button', { name: 'Ver fichas' }).click();
  await expect(page.locator('#sub-fichas')).toHaveAttribute('aria-selected', 'true');
  const ult = (await chamadas(page, 'socio_fichas_lista')).pop();
  expect(ult.args).toMatchObject({ p_instrumento: 'i-dsa', p_campanha: 'c-1', p_status: null, p_treino: false });
  const linha = page.locator('#fi-corpo tr', { hasText: 'DSA-261015-AB12-01' });
  await expect(linha).toContainText('comunidade a cadastrar');
  await linha.getByRole('button', { name: 'Abrir' }).click();
  const corpo = page.locator('#fd-corpo');
  await expect(corpo).toContainText('Maria Entrevistada');
  await expect(corpo).toContainText('Dona Maria');                          // coluna de identificação da lista
  await expect(corpo).toContainText('Cacimba');                             // especifique
  await expect(corpo.locator('.soc-fd-linha', { hasText: 'É tratada?' })).toContainText('não se aplica');
  await expect(corpo.locator('.soc-fd-linha', { hasText: 'Renda mensal?' })).toContainText('Não respondeu');
  await expect(corpo.locator('.soc-fd-fotos img')).toHaveAttribute('src', /#u\/f\.jpg$/);   // sempre assinada
});

test('validação: devolver exige motivo; validar chama o banco', async ({ page }) => {
  await abrir(page);
  await page.click('#sub-fichas');
  await page.locator('#fi-corpo tr', { hasText: 'DSA-261015-AB12-01' }).getByRole('button', { name: 'Abrir' }).click();
  await page.getByRole('button', { name: 'Devolver ao entrevistador' }).click();
  await expect(page.locator('#cf-ok')).toBeDisabled();
  await page.fill('#cf-campo', 'oi');
  await expect(page.locator('#cf-ok')).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await chamadas(page, 'socio_mudar_status')).toHaveLength(0);
  await expect(page.locator('#modal-ficha')).toHaveClass(/aberto/);       // Esc fechou só a confirmação

  await page.getByRole('button', { name: 'Validar' }).click();
  await expect(page.locator('#cf-texto')).toContainText('em branco');
  await page.click('#cf-ok');
  await expect.poll(async () => (await chamadas(page, 'socio_mudar_status')).length).toBe(1);
  const [m] = await chamadas(page, 'socio_mudar_status');
  expect(m.args).toMatchObject({ p_ficha_id: 'f-1', p_status: 'validada', p_motivo: null });
  await expect(page.locator('#fd-corpo')).toContainText('Validada');
  await expect(page.getByRole('button', { name: 'Validar' })).toHaveCount(0);
});

test('comunidade nova: sugere a do mesmo município e liga a ficha', async ({ page }) => {
  await abrir(page);
  await page.click('#sub-fichas');
  await page.locator('#fi-corpo tr', { hasText: 'DSA-261015-AB12-01' }).getByRole('button', { name: 'Abrir' }).click();
  const opcoes = await page.locator('#fd-com option').allTextContents();
  expect(opcoes).toContain('Vila Assis');
  expect(opcoes).not.toContain('Bairro Novo');                             // outro município
  await page.selectOption('#fd-com', 'com-1');
  await page.click('#fd-vinc');
  await expect.poll(async () => (await chamadas(page, 'socio_vincular_comunidade')).length).toBe(1);
  const [v] = await chamadas(page, 'socio_vincular_comunidade');
  expect(v.args).toMatchObject({ p_ficha: 'f-1', p_comunidade: 'com-1' });
  await expect(page.locator('#fd-com')).toHaveCount(0);
});

test('leitor: sem identificação, sem fotos, sem botões de validação nem de campanha', async ({ page }) => {
  await abrir(page, false);
  await page.click('#sub-campanhas');
  await expect(page.getByRole('button', { name: /Nova campanha/ })).toHaveCount(0);
  await expect(page.locator('#soc-sub tr', { hasText: 'Campanha Juruá' }).getByRole('button', { name: 'Abrir' })).toHaveCount(0);
  await page.click('#sub-fichas');
  await expect(page.locator('#fi-treino')).toHaveCount(0);
  await page.locator('#fi-corpo tr', { hasText: 'DSA-261015-AB12-01' }).getByRole('button', { name: 'Abrir' }).click();
  const corpo = page.locator('#fd-corpo');
  await expect(corpo).toContainText('Identificação oculta');
  await expect(corpo).not.toContainText('Maria Entrevistada');
  await expect(corpo).toContainText('Colunas de identificação ocultas');
  await expect(corpo.locator('img')).toHaveCount(0);
  await expect(page.locator('#fd-com')).toHaveCount(0);
  await expect(page.locator('#fd-acoes button')).toHaveCount(1);          // só Fechar
});

test('celular (390px): ficha aberta não faz a página rolar de lado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await abrir(page);
  await page.click('#sub-fichas');
  await page.locator('#fi-corpo tr', { hasText: 'DSA-261015-AB12-01' }).getByRole('button', { name: 'Abrir' }).click();
  await expect(page.locator('#fd-corpo')).toContainText('Maria Entrevistada');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
