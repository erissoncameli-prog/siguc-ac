// ── Acesso por organograma · js/config.js popula appState.permissoes ──
// Executar: npx playwright test tests/permissao-organograma.test.js
// (precisa de um servidor estático na raiz do repo — http://localhost:5500,
//  igual ao tests/sidebar-grupos.test.js)
//
// POR QUE ESTE TESTE EXISTE: docs/acesso-por-organograma.md desenha o
// acesso por setor em cima de `nivel_efetivo()`/`minhas_permissoes` (banco)
// e de `appState.permissoes` (cliente, js/config.js:carregarUsuario —
// frente 6b). A metade em SQL (nivel_efetivo_calc, alcance_por_lotacao,
// credenciamento_vigente, teto_do_perfil, a cadeia de hash de
// trilha_auditoria) foi verificada linha a linha contra produção durante
// as migrations 262–269 (herança 4/4, credenciamento 7/7, snapshot
// 1656/1656 sem divergência, trilha 9/9 sem quebra) mas em transações com
// ROLLBACK — não existe guarda automatizada de banco no repo hoje (não há
// runner de SQL em tests/, só Playwright). Este arquivo cobre a metade que
// DÁ pra automatizar sem banco real: a busca de `minhas_permissoes` dentro
// de `carregarUsuario()`, e a regra dela ser FAIL-OPEN (indisponibilidade
// de rede não pode apagar a sidebar inteira — ver comentário no próprio
// config.js). Quebrar isso silenciosamente é fácil: basta alguém trocar o
// `try/catch` por um `await` direto numa refatoração futura.
//
// `js/layout.js` ainda NÃO consome `appState.permissoes` (§1.4b do plano —
// os itens de menu não têm correspondência 1:1 com módulo do catálogo, e
// os 3 candidatos com match exato têm drift catálogo×realidade). Por isso
// não há teste aqui de "sidebar muda com a permissão" — seria testar
// comportamento que não existe ainda.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

const GLOBAL_CSS = fs.readFileSync(path.join(__dirname, '../css/global.css'), 'utf8')
  .replace(/@import[^;]+;/, '');

const USUARIO_STUB = {
  id: 'u-teste', nome_completo: 'Teste', email: 'teste@x.invalid',
  perfil: 'gestor', ativo: true,
};

// Monta o cliente Supabase falso ANTES de carregar config.js: `loadEnv`
// precisa devolver supabaseUrl/supabaseKey verdadeiros, senão config.js
// deixa `db` como `undefined` (é o que acontece numa página real sem
// /api/env acessível — o mesmo erro "Cannot read properties of undefined
// (reading 'auth')" visto ao testar outras frentes deste plano num
// servidor estático sem env configurado).
async function montarStub(page, { permissoesData = null, permissoesErro = false } = {}) {
  await page.goto(`${BASE}/tests/fixtures/sidebar-harness.html`);
  await page.addScriptTag({
    content: `
      window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
      window.__PERMISSOES_STUB = ${JSON.stringify(permissoesData)};
      window.__PERMISSOES_ERRO = ${permissoesErro};
      window.supabase = {
        createClient: () => ({
          auth: {
            getSession: async () => ({ data: { session: { user: { id: 'u-teste' } } } }),
          },
          from: (tabela) => {
            if (tabela === 'usuarios') {
              return { select: () => ({ eq: () => ({ single: async () => ({ data: ${JSON.stringify(USUARIO_STUB)} }) }) }) };
            }
            if (tabela === 'minhas_permissoes') {
              return {
                select: async () => {
                  if (window.__PERMISSOES_ERRO) throw new Error('falha de rede simulada');
                  return { data: window.__PERMISSOES_STUB };
                },
              };
            }
            return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
          },
        }),
      };
    `,
  });
  await page.addScriptTag({ url: '/js/config.js' });
  await page.addStyleTag({ content: GLOBAL_CSS });
}

test('carregarUsuario() popula appState.permissoes a partir de minhas_permissoes', async ({ page }) => {
  await montarStub(page, {
    permissoesData: [
      { chave: 'agua', nivel: 'editar' },
      { chave: 'frota', nivel: 'visualizar' },
    ],
  });

  const resultado = await page.evaluate(async () => {
    const usuario = await carregarUsuario();
    return { usuario, permissoes: appState.permissoes };
  });

  expect(resultado.usuario?.perfil).toBe('gestor');
  expect(resultado.permissoes).toEqual({ agua: 'editar', frota: 'visualizar' });
});

test('falha ao buscar minhas_permissoes cai em fail-open — sidebar não pode sumir por instabilidade de rede', async ({ page }) => {
  await montarStub(page, { permissoesErro: true });

  const resultado = await page.evaluate(async () => {
    const usuario = await carregarUsuario();
    return { usuarioCarregou: !!usuario, permissoes: appState.permissoes };
  });

  // O ponto central: uma falha na busca de permissões não pode impedir
  // o login nem deixar appState.permissoes num estado que quebre quem
  // vier a consumi-lo (undefined/null) — precisa ser um objeto vazio.
  expect(resultado.usuarioCarregou).toBe(true);
  expect(resultado.permissoes).toEqual({});
});

test('appState nasce com permissoes = {} antes de qualquer carregarUsuario()', async ({ page }) => {
  await montarStub(page, { permissoesData: [] });
  const inicial = await page.evaluate(() => appState.permissoes);
  expect(inicial).toEqual({});
});
