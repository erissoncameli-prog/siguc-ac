// ── SIGUC · Diagnóstico Socioeconômico · tela de questionários (Fase 2) ─
// Executar: npx playwright test tests/socio-questionarios.test.js
//
// A regra de acesso mora no BANCO (fn_socio_pode_de, migration 362) e é
// testada lá (supabase/tests/socio/rodar.sh). Aqui o que se trava é a
// TELA: que ela mostre a cada um o que o catálogo do banco diz que ele
// pode, chame a RPC certa com os argumentos certos e nunca deixe a
// pessoa num beco (sem lotação, pedido pendente, JSON quebrado).
//
// Página real, cliente Supabase stubado por um "banco" em memória que
// registra cada RPC chamada. O CDN do supabase-js é bloqueado — senão o
// cliente real sobrescreve o stub e a página cai no login.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

const EU = { id: 'u-eu', nome_completo: 'Técnica do DEUC', email: 'eu@x.invalid', perfil: 'tecnico', ativo: true };
const DEUC = 'dep-deuc', DEBIO = 'dep-debio';

function cenario(over) {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Rio_Branco' }).format(new Date());
  const base = {
    hoje,
    deps: [{ unidade_org_id: DEUC, sigla: 'DEUC', nome: 'Departamento de UCs', origem: 'lotacao' }],
    cat: [
      { id: 'i-dsa', codigo: 'DSA', titulo: 'Diagnóstico de domicílios', finalidade: 'Conhecer as famílias das UCs.', unidade_analise: 'domicilio',
        ativo: true, unidade_org_id: DEUC, departamento_sigla: 'DEUC', departamento_nome: 'Departamento de UCs', versao_publicada: 1,
        pode_ver: true, pode_ler_fichas: true, pode_aplicar: false, pode_gerir: true, sou_admin: false, do_meu_departamento: true,
        pedidos_pendentes: [], acessos_vigentes: [] },
      { id: 'i-pesca', codigo: 'PESCA', titulo: 'Pesca artesanal', finalidade: 'Mapear a pesca de subsistência.', unidade_analise: 'pessoa',
        ativo: true, unidade_org_id: DEBIO, departamento_sigla: 'DEBIO', departamento_nome: 'Departamento de Biodiversidade', versao_publicada: 2,
        pode_ver: false, pode_ler_fichas: false, pode_aplicar: false, pode_gerir: false, sou_admin: false, do_meu_departamento: false,
        pedidos_pendentes: [], acessos_vigentes: [] },
    ],
    versoes: [
      { id: 'q-1', instrumento_id: 'i-dsa', versao: 1, status: 'publicado', publicado_em: '2026-10-10T12:00:00Z', hash_sha256: 'a'.repeat(64),
        criado_em: '2026-10-09T12:00:00Z', atualizado_em: '2026-10-10T12:00:00Z', aviso_entrevistado: 'Aviso lido ao entrevistado antes de começar.',
        estrutura: { blocos: [{ id: 'agua', titulo: 'Água', perguntas: [
          { n: 1, chave: 'agua_fonte', tipo: 'unica', texto: 'De onde vem a água?', opcoes: [{ v: 'rio', r: 'Rio' }, { v: 'poco', r: 'Poço' }] },
          { n: 2, chave: 'agua_trata', tipo: 'unica', texto: 'É tratada?', opcoes: [{ v: 'sim', r: 'Sim' }, { v: 'nao', r: 'Não' }],
            mostrar_se: { se: 'agua_fonte', op: '=', valor: 'rio' } }] }] } },
    ],
    acessos: [
      { id: 'a-1', instrumento_id: 'i-dsa', usuario_id: 'u-debio', nivel: 'leitor', justificativa: 'Cruzar com o monitoramento de fauna.',
        data_fim: '2099-12-31', status: 'pendente', parecer: null, criado_em: '2026-10-17T12:00:00Z',
        solicitante: { nome_completo: 'Bióloga do DEBIO', email: 'debio@x.invalid' } },
    ],
    pessoas: [
      { usuario_id: 'u-chefe', nome: 'Chefe do DEUC', email: 'chefe@x.invalid', papeis: [], e_chefe: true },
      { usuario_id: EU.id, nome: EU.nome_completo, email: EU.email, papeis: ['gestor'], e_chefe: false },
    ],
  };
  return Object.assign(base, over || {});
}

async function abrir(page, over) {
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.addInitScript(([usuario, est]) => {
    window.__rpc = [];
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const q = (tabela) => {
      const filtros = {};
      const o = {
        select: () => o, order: () => o, limit: () => o, in: () => o, is: () => o,
        eq: (c, v) => { filtros[c] = v; return o },
        single: async () => ({ data: usuario, error: null }),
        maybeSingle: async () => ({ data: usuario, error: null }),
        then: (r) => {
          let data = [];
          if (tabela === 'socio_acessos') data = est.acessos;
          if (tabela === 'socio_questionarios') data = est.versoes.filter(v => v.instrumento_id === filtros.instrumento_id)
            .sort((a, b) => b.versao - a.versao);
          return Promise.resolve({ data, error: null }).then(r);
        },
      };
      return o;
    };
    const erro = (m) => ({ data: null, error: { message: m } });
    const rpcs = {
      socio_catalogo: () => est.cat,
      socio_meus_departamentos: () => est.deps,
      socio_pessoas_do_departamento: () => est.pessoas,
      fn_socio_validar_estrutura: (a) => (a.p && Array.isArray(a.p.blocos) ? [] : ['a estrutura precisa de "blocos" com ao menos um bloco']),
      socio_pedir_acesso: (a) => {
        const c = est.cat.find(x => x.id === a.p_instrumento); c.pedidos_pendentes = [a.p_nivel];
        est.acessos.unshift({ id: 'a-novo', instrumento_id: a.p_instrumento, usuario_id: usuario.id, nivel: a.p_nivel,
          justificativa: a.p_justificativa, data_fim: a.p_data_fim, status: 'pendente', criado_em: new Date().toISOString(), solicitante: usuario });
        return 'a-novo';
      },
      socio_salvar_versao: (a) => {
        let v = a.p_questionario_id && est.versoes.find(x => x.id === a.p_questionario_id);
        if (!v) { v = { id: 'q-' + (est.versoes.length + 1), instrumento_id: a.p_instrumento, status: 'rascunho', hash_sha256: 'b'.repeat(64),
          versao: Math.max(0, ...est.versoes.filter(x => x.instrumento_id === a.p_instrumento).map(x => x.versao)) + 1 }; est.versoes.push(v); }
        v.estrutura = a.p_estrutura; v.aviso_entrevistado = a.p_aviso;
        return { id: v.id, versao: v.versao, status: 'rascunho', erros: [] };
      },
      socio_publicar_versao: (a) => { const v = est.versoes.find(x => x.id === a.p_questionario_id); v.status = 'publicado'; return { id: v.id, versao: v.versao } },
      socio_decidir_acesso: (a) => { const x = est.acessos.find(y => y.id === a.p_acesso); x.status = a.p_aprovar ? 'aprovado' : 'recusado'; x.parecer = a.p_parecer; return null },
      socio_definir_papel: () => null,
      socio_criar_instrumento: (a) => {
        if (est.cat.some(c => c.codigo === a.p_codigo)) return { __erro: 'socio:codigo_em_uso: já existe instrumento com o código ' + a.p_codigo };
        est.cat.push({ id: 'i-novo', codigo: a.p_codigo, titulo: a.p_titulo, finalidade: a.p_finalidade, unidade_analise: a.p_unidade_analise,
          ativo: true, unidade_org_id: a.p_unidade_org_id, departamento_sigla: 'DEUC', departamento_nome: 'Departamento de UCs', versao_publicada: null,
          pode_ver: true, pode_ler_fichas: true, pode_aplicar: false, pode_gerir: true, sou_admin: false, do_meu_departamento: true,
          pedidos_pendentes: [], acessos_vigentes: [] });
        return 'i-novo';
      },
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
          if (!rpcs[nome]) return { data: null, error: null };
          const r = rpcs[nome](args || {});
          return r && r.__erro ? erro(r.__erro) : { data: JSON.parse(JSON.stringify(r === undefined ? null : r)), error: null };
        },
        from: (t) => q(t),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      }),
    };
  }, [EU, cenario(over)]);
  await page.goto(`${BASE}/pages/socio-questionarios.html`);
  await page.locator('#soc-conteudo').waitFor({ state: 'visible', timeout: 20_000 });
}
const chamadas = (page, nome) => page.evaluate(n => window.__rpc.filter(r => r.nome === n), nome);

test('menu lateral tem o grupo e a página abre na aba do departamento', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('a[href$="socio-questionarios.html"]')).toHaveCount(1);
  await expect(page.locator('#soc-tbody tr')).toHaveCount(1);          // só o DSA é "meu"
  await expect(page.locator('#soc-tbody')).toContainText('DSA');
  await expect(page.locator('#soc-tbody')).toContainText('Gestor');
});

test('catálogo mostra o de outro departamento só com "Pedir acesso", e o pedido vai ao banco', async ({ page }) => {
  await abrir(page);
  await page.click('#aba-catalogo');
  const pesca = page.locator('#soc-tbody tr', { hasText: 'PESCA' });
  await expect(pesca.getByRole('button', { name: 'Abrir' })).toHaveCount(0);
  await pesca.getByRole('button', { name: 'Pedir acesso' }).click();
  await expect(page.locator('#modal-pedir')).toHaveClass(/aberto/);
  await page.check('input[name="pd-nivel"][value="leitor"]');
  await page.fill('#pd-just', 'curto');
  await page.click('#pd-enviar');
  expect(await chamadas(page, 'socio_pedir_acesso')).toHaveLength(0);   // barrado na tela: < 20 caracteres
  await page.fill('#pd-just', 'Cruzar a pesca com o uso das UCs estaduais.');
  await page.click('#pd-enviar');
  await expect(page.locator('#modal-pedir')).not.toHaveClass(/aberto/);
  const [c] = await chamadas(page, 'socio_pedir_acesso');
  expect(c.args).toMatchObject({ p_instrumento: 'i-pesca', p_nivel: 'leitor', p_justificativa: 'Cruzar a pesca com o uso das UCs estaduais.' });
  expect(c.args.p_data_fim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('#soc-tbody tr', { hasText: 'PESCA' })).toContainText('aguardando');
  await expect(page.locator('#soc-tbody tr', { hasText: 'PESCA' }).getByRole('button', { name: 'Pedir acesso' })).toHaveCount(0);
});

test('sem lotação: avisa o porquê, não oferece criar, e o catálogo continua usável', async ({ page }) => {
  await abrir(page, { deps: [], cat: [] });
  await expect(page.locator('.soc-aviso')).toContainText('não está lotado');
  await expect(page.getByRole('button', { name: /Novo questionário/ })).toHaveCount(0);
  await page.click('#aba-catalogo');
  await expect(page.locator('#soc-tbody')).toContainText('Nenhum questionário');
});

test('editor: modelo na nova versão, pré-visualização com salto em português, JSON quebrado avisado, salvar envia o objeto', async ({ page }) => {
  await abrir(page);
  await page.locator('#soc-tbody tr', { hasText: 'DSA' }).getByRole('button', { name: 'Abrir' }).click();
  // versão publicada: abre só para leitura, salto escrito por extenso
  await page.locator('#soc-sub tr', { hasText: 'v1' }).getByRole('button', { name: 'Ver' }).click();
  await expect(page.locator('#ed-json')).toHaveJSProperty('readOnly', true);
  await expect(page.locator('#ed-previa')).toContainText('Só aparece se P1 é “Rio”');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-editor')).not.toHaveClass(/aberto/);

  await page.getByRole('button', { name: /Nova versão/ }).click();
  await expect(page.locator('#ed-titulo')).toContainText('a partir da v1');
  await expect(page.locator('#ed-aviso')).toHaveValue('Aviso lido ao entrevistado antes de começar.');   // aviso vem da v1
  await page.fill('#ed-json', '{ "blocos": [ ');
  await expect(page.locator('#ed-erros')).toContainText('não é um JSON válido');
  await page.click('#ed-salvar');
  expect(await chamadas(page, 'socio_salvar_versao')).toHaveLength(0);
  await page.getByRole('button', { name: 'Usar modelo' }).click();
  await page.locator('#modal-confirmar #cf-ok').click();
  await expect(page.locator('#ed-previa')).toContainText('Quem mora no domicílio');
  await expect(page.locator('#ed-previa')).toContainText('Só aparece se P3 não é “Rede pública”');
  await page.fill('#ed-aviso', 'Somos da SEMA. A entrevista é voluntária e você pode parar quando quiser.');
  await expect(page.locator('#ed-erros')).toContainText('Sem pendências');
  await page.click('#ed-salvar');
  await expect(page.locator('#ed-estado')).toContainText('Salvo');
  const [s] = await chamadas(page, 'socio_salvar_versao');
  expect(s.args.p_instrumento).toBe('i-dsa');
  expect(s.args.p_questionario_id).toBeNull();
  expect(Array.isArray(s.args.p_estrutura.blocos)).toBe(true);          // objeto, nunca o texto cru
  await page.click('#ed-rodape .btn-secondary');                        // Fechar (sem alteração pendente)
  await expect(page.locator('#modal-editor')).not.toHaveClass(/aberto/);
  // rascunho novo aparece com Publicar; publicar pede confirmação
  const v2 = page.locator('#soc-sub tr', { hasText: 'v2' });
  await expect(v2).toContainText('Rascunho');
  await v2.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.locator('#cf-texto')).toContainText('não pode mais ser alterada');
  await page.click('#cf-ok');
  await expect.poll(async () => (await chamadas(page, 'socio_publicar_versao')).length).toBe(1);
});

test('fechar o editor com alteração não salva pede confirmação', async ({ page }) => {
  await abrir(page);
  await page.locator('#soc-tbody tr', { hasText: 'DSA' }).getByRole('button', { name: 'Abrir' }).click();
  await page.getByRole('button', { name: /Nova versão/ }).click();
  await page.fill('#ed-aviso', 'Texto novo do aviso, ainda não salvo.');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-confirmar')).toHaveClass(/aberto/);
  await page.keyboard.press('Escape');                                   // Esc fecha só a confirmação
  await expect(page.locator('#modal-editor')).toHaveClass(/aberto/);
  await expect(page.locator('#ed-aviso')).toHaveValue('Texto novo do aviso, ainda não salvo.');
});

test('pedidos: contador na aba, recusa exige parecer, decisão chama o banco', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#aba-pedidos .soc-contador')).toHaveText('1');
  await page.click('#aba-pedidos');
  await page.getByRole('button', { name: 'Decidir' }).click();
  await page.check('input[name="dc-dec"][value="nao"]');
  await page.click('#dc-confirmar');
  expect(await chamadas(page, 'socio_decidir_acesso')).toHaveLength(0);
  await page.fill('#dc-parecer', 'O estudo de fauna não precisa de ficha individual.');
  await page.click('#dc-confirmar');
  await expect.poll(async () => (await chamadas(page, 'socio_decidir_acesso')).length).toBe(1);
  const [d] = await chamadas(page, 'socio_decidir_acesso');
  expect(d.args).toMatchObject({ p_acesso: 'a-1', p_aprovar: false, p_data_fim: null });
  await expect(page.locator('#aba-pedidos .soc-contador')).toHaveCount(0);
});

test('equipe: chefe é gestor nato (caixa travada) e marcar papel chama o banco', async ({ page }) => {
  await abrir(page);
  await page.locator('#soc-tbody tr', { hasText: 'DSA' }).getByRole('button', { name: 'Abrir' }).click();
  await page.click('#sub-equipe');
  const chefe = page.locator('#soc-sub tr', { hasText: 'Chefe do DEUC' });
  await expect(chefe.getByRole('checkbox', { name: /Gestor/ })).toBeDisabled();
  await expect(chefe.getByRole('checkbox', { name: /Gestor/ })).toBeChecked();
  await chefe.getByRole('checkbox', { name: /Aplicador/ }).check();
  await expect.poll(async () => (await chamadas(page, 'socio_definir_papel')).length).toBe(1);
  const [p] = await chamadas(page, 'socio_definir_papel');
  expect(p.args).toMatchObject({ p_instrumento: 'i-dsa', p_usuario: 'u-chefe', p_papel: 'aplicador', p_ativo: true, p_justificativa: null });
});

test('novo questionário: código repetido mostra o texto do banco, sem o prefixo técnico', async ({ page }) => {
  await abrir(page);
  await page.getByRole('button', { name: /Novo questionário/ }).click();
  await page.fill('#nv-codigo', 'dsa');
  await expect(page.locator('#nv-codigo')).toHaveValue('DSA');
  await page.fill('#nv-titulo', 'Outro');
  await page.fill('#nv-finalidade', 'Finalidade qualquer para teste.');
  await page.click('#nv-salvar');
  const toastTxt = page.locator('div', { hasText: /^já existe instrumento com o código DSA$/ });
  await expect(toastTxt).toHaveCount(1);
  await expect(page.locator('#modal-novo')).toHaveClass(/aberto/);
});

test('celular (390px): a página não rola de lado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await abrir(page);
  await page.click('#aba-catalogo');
  const largura = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(largura).toBeLessThanOrEqual(390);
});
