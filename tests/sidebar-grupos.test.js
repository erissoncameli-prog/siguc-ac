// ── Sidebar · grupos recolhíveis (acordeão) ──────────────────────
// Executar: npx playwright test tests/sidebar-grupos.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual ao tests/frota-app-barra.test.js)
//
// POR QUE ESTE TESTE EXISTE: js/layout.js é a fonte única do menu das
// 45 páginas de mesa (gerarLayout). A entrega que dividiu a sidebar em
// grupos recolhíveis por acordeão (Principal / Diretoria Técnica —
// Gestão, Brigadas, Biomonitor, Água / Administrativo — Frota /
// Sistema) tem duas regras fáceis de quebrar numa edição futura:
// (1) o grupo da página atual sempre nasce aberto, senão o usuário
//     chega numa página e não acha o próprio link na sidebar;
// (2) o corpo do grupo colapsa por grid-template-rows, NUNCA por
//     transform/max-height com transform — um transform num ancestral
//     da nav vira containing block de descendentes position:fixed
//     (mesma armadilha documentada na barra do app Frota).
//
// Nenhuma página de mesa real serve de base: todas já declaram seu
// próprio `let db` (o mesmo identificador que js/config.js declara no
// topo), e `let`/`const` de scripts <script> separados dividem o mesmo
// escopo léxico global — a segunda declaração quebra o parse da página
// inteira. Em vez disso, os arquivos são carregados numa página vazia,
// dedicada só a este teste (tests/fixtures/sidebar-harness.html).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';

// css/global.css abre com @import de fonte do Google — bloqueado na
// rede da sandbox de teste (e irrelevante pro que este teste verifica).
// Injeta o CSS como conteúdo inline, sem esse @import, em vez de
// carregar a folha por URL (que fica pendurada esperando a rede).
const GLOBAL_CSS = fs.readFileSync(path.join(__dirname, '../css/global.css'), 'utf8')
  .replace(/@import[^;]+;/, '');

async function montarSidebar(page, paginaAtiva, { perfil = 'super_admin', permissoes = {} } = {}) {
  await page.goto(`${BASE}/tests/fixtures/sidebar-harness.html`);
  // js/config.js espera o global `supabase` do CDN (@supabase/supabase-js)
  // — bloqueado nesta sandbox de teste. Um stub mínimo basta: o alvo
  // aqui é gerarLayout(), que não chama nada do banco.
  await page.addScriptTag({ content: 'window.supabase = { createClient: () => ({ auth: {}, from: () => ({}), rpc: async () => ({}) }) };' });
  await page.addScriptTag({ url: '/js/config.js' });
  await page.addScriptTag({ url: '/js/layout.js' });
  await page.addStyleTag({ content: GLOBAL_CSS });
  return page.evaluate(({ paginaAtivaArg, perfilArg, permissoesArg }) => {
    appState.usuario = { nome_completo: 'Teste', perfil: perfilArg };
    appState.permissoes = permissoesArg;
    const html = gerarLayout('Página de teste', paginaAtivaArg);
    document.body.insertAdjacentHTML('beforeend', html);
  }, { paginaAtivaArg: paginaAtiva, perfilArg: perfil, permissoesArg: permissoes });
}

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/tests/fixtures/sidebar-harness.html`);
  await page.evaluate(() => localStorage.removeItem('siguc_nav_grupos'));
});

test('grupo da página ativa nasce aberto; os demais, fechados', async ({ page }) => {
  await montarSidebar(page, 'frota-viagens');

  const frotaAberto = await page.locator('.nav-grupo[data-grupo="frota"]').getAttribute('class');
  expect(frotaAberto).toContain('aberto');

  const aguaAberto = await page.locator('.nav-grupo[data-grupo="agua"]').getAttribute('class');
  expect(aguaAberto).not.toContain('aberto');

  // O link da página ativa está presente e marcado — não escondido
  // atrás de um grupo fechado.
  await expect(page.locator('a.nav-item.ativo')).toHaveCount(1);
  await expect(page.locator('a.nav-item.ativo > span:last-child')).toHaveText('Agenda de Viagens');
});

test('superbloco "Administrativo" cerca só o grupo Frota; "Diretoria Técnica" cerca os 4 outros', async ({ page }) => {
  await montarSidebar(page, 'dashboard');

  const rotulos = await page.evaluate(() => {
    return [...document.querySelectorAll('#sidebar-nav > *')].map(el => ({
      tipo: el.classList.contains('nav-super') ? 'super' : (el.dataset.grupo || null),
      texto: el.classList.contains('nav-super') ? el.textContent.trim() : null,
    }));
  });

  // Só duas ocorrências de nav-super no total (uma por superbloco) —
  // não uma por grupo dentro dele.
  const supers = rotulos.filter(r => r.tipo === 'super');
  expect(supers.map(s => s.texto)).toEqual(['Diretoria Técnica', 'Administrativo']);

  const ordem = rotulos.map(r => r.tipo === 'super' ? `super:${r.texto}` : r.tipo);
  expect(ordem).toEqual([
    'principal',
    'super:Diretoria Técnica', 'gestao', 'brigadas', 'biomonitor', 'agua',
    'super:Administrativo', 'frota',
    'sistema',
  ]);
});

test('clicar no cabeçalho alterna o grupo e persiste a escolha entre renderizações', async ({ page }) => {
  await montarSidebar(page, 'dashboard');

  const grupoAgua = page.locator('.nav-grupo[data-grupo="agua"]');
  await expect(grupoAgua).not.toHaveClass(/aberto/);

  await page.locator('.nav-grupo[data-grupo="agua"] .nav-section-toggle').click();
  await expect(grupoAgua).toHaveClass(/aberto/);
  await expect(page.locator('.nav-grupo[data-grupo="agua"] .nav-section-toggle')).toHaveAttribute('aria-expanded', 'true');

  const salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('siguc_nav_grupos') || '{}'));
  expect(salvo.agua).toBe(true);

  // Re-renderiza para uma página ativa diferente (não é mais 'agua' o
  // grupo ativo) — a preferência salva continua valendo.
  await page.evaluate(() => document.querySelector('.app-layout')?.remove());
  await page.evaluate((paginaAtiva) => {
    document.body.insertAdjacentHTML('beforeend', gerarLayout('Outra página', paginaAtiva));
  }, 'unidades');

  await expect(page.locator('.nav-grupo[data-grupo="agua"]')).toHaveClass(/aberto/);
});

test('corpo do grupo colapsa por grid-template-rows, sem transform em nenhum ancestral da nav', async ({ page }) => {
  await montarSidebar(page, 'dashboard');

  const transforms = await page.evaluate(() => {
    const seletores = ['.sidebar', '#sidebar-nav', '.nav-grupo[data-grupo="agua"]', '.nav-grupo-corpo'];
    return seletores.map(sel => {
      const el = document.querySelector(sel);
      return { sel, transform: el ? getComputedStyle(el).transform : null };
    });
  });
  for (const { sel, transform } of transforms) {
    expect(transform, `${sel} não deveria ter transform`).toBe('none');
  }

  // O corpo fechado usa grid-template-rows: 0fr (a mecânica de
  // colapso), não display:none nem max-height. O Chromium resolve a
  // unidade fr para px no computed style — "0fr" vira "0px" — então a
  // asserção compara o fechado (0px) contra o mesmo grupo aberto
  // (altura real do conteúdo), em vez de comparar a string literal.
  const corpo = page.locator('.nav-grupo[data-grupo="agua"] .nav-grupo-corpo');
  const fechadoPx = await corpo.evaluate(el => parseFloat(getComputedStyle(el).gridTemplateRows));
  expect(fechadoPx).toBe(0);

  await page.locator('.nav-grupo[data-grupo="agua"] .nav-section-toggle').click();
  await page.waitForTimeout(250); // transição de 0,22s do grid-template-rows
  const abertoPx = await corpo.evaluate(el => parseFloat(getComputedStyle(el).gridTemplateRows));
  expect(abertoPx).toBeGreaterThan(0);
});

test('grupo Biomonitor some quando minhas_permissoes diz sem_acesso, mesmo com o perfil na lista antiga', async ({ page }) => {
  // tecnico está nos arrays `perfis:` de todo item do grupo Biomonitor
  // (js/layout.js) — sem o gate por `modulo`, o grupo apareceria mesmo
  // sem lotação no DEBIO. Este é o cenário real do usuário "Teste"
  // (perfil tecnico, sem lotação) depois da migration 275.
  await montarSidebar(page, 'dashboard', {
    perfil: 'tecnico',
    permissoes: { biomonitor: 'sem_acesso' },
  });

  await expect(page.locator('.nav-grupo[data-grupo="biomonitor"]')).toHaveCount(0);
  // Outro grupo sem `modulo` declarado continua imune ao gate — não é
  // uma checagem geral, só onde o catálogo bate 1:1 com a sidebar.
  await expect(page.locator('.nav-grupo[data-grupo="gestao"]')).toHaveCount(1);
});

test('grupo Biomonitor aparece quando minhas_permissoes libera (lotado no DEBIO)', async ({ page }) => {
  await montarSidebar(page, 'dashboard', {
    perfil: 'tecnico',
    permissoes: { biomonitor: 'editar' },
  });

  await expect(page.locator('.nav-grupo[data-grupo="biomonitor"]')).toHaveCount(1);
});

test('appState.permissoes vazio (fail-open) não esconde o grupo Biomonitor', async ({ page }) => {
  await montarSidebar(page, 'dashboard', { perfil: 'tecnico', permissoes: {} });

  await expect(page.locator('.nav-grupo[data-grupo="biomonitor"]')).toHaveCount(1);
});
