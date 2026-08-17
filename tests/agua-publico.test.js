// ── Qualidade da Água · Painel PÚBLICO (link para o site da SEMA) ────
// Executar: npx playwright test tests/agua-publico.test.js
// (precisa de um servidor estático na raiz do repo, igual aos demais
//  testes do módulo — ver cabeçalho de tests/agua-relatorios.test.js)
//
// O que este arquivo trava, além do que tests/agua-relatorios.test.js
// já cobre para o painel de mesa (os cards são os MESMOS — desenhados
// por js/agua-painel.js, testado ali):
//
//  1. A LISTA DE COLUNAS que supabase/migrations/297_agua_painel_publico.sql
//     devolve para `anon` — a garantia dura contra vazar coletor/GPS/
//     foto/laudo/observações por descuido futuro (guarda estrutural,
//     sem precisar de sessão de banco: lê o texto da migration);
//  2. pages/agua-publico.html NUNCA chama `.from()` nem `db.auth` — só
//     as três RPCs `agua_publico_*` (SECURITY DEFINER, migration 297).
//     Um stub de `db` sem `from`/`auth` prova isso: se a página
//     tentasse usar qualquer um dos dois, o teste quebraria com
//     "... is not a function", não silenciosamente;
//  3. a página renderiza o painel de ponta a ponta sem login (sem
//     redirecionar para index.html, sem gate de LGPD/perfil — nenhum
//     dos dois é alcançável, porque nenhum vive fora de
//     carregarUsuario(), nunca chamada aqui);
//  4. o PDF/PPTX público usa um protocolo FIXO — nunca chama
//     `gerar_protocolo_relatorio` (que incrementaria uma sequência
//     institucional compartilhada por todos os relatórios do sistema).
//  5. o card "Base Legal e Conformidade" e o popup "Entenda o cálculo
//     do IQA" (js/agua-painel.js, pedido do usuário) aparecem nos dois
//     painéis (mesa e público) com os MESMOS números reais de
//     agua_calcular_iqa()/agua_iqa_faixa() — nunca um texto solto,
//     divergente do que o banco calcula de verdade.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const PAGINA = `${BASE}/pages/agua-publico.html`;
const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '297_agua_painel_publico.sql');
const MIGRATION_298 = path.join(__dirname, '..', 'supabase', 'migrations', '298_agua_base_legal_publico.sql');
const MIGRATION_299 = path.join(__dirname, '..', 'supabase', 'migrations', '299_modulo_departamento_cabecalho.sql');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

// ── Fixture no formato que agua_publico_coletas() devolve (migration
// 297) — mesmas 2 bacias/3 campanhas de tests/agua-relatorios.test.js,
// só que já no formato "achatado" da RPC pública (sem os campos que a
// função nunca expõe: coletor, GPS, foto, laudo, observações...).
function fixtureColetasPublicas() {
  const base = { ponto_bacia: 'Rio Acre' };
  return [
    { ...base, ponto_id: 'p-rb', ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Acre',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-10',
      status: 'completo', iqa: 78.4, iqa_faixa: 'Boa', conama_violacoes: [] },
    { ...base, ponto_id: 'p-rb', ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Acre',
      campanha_id: 'c3', campanha_ano: 2025, campanha_ordem: 'primeira', data_coleta: '2025-03-08',
      status: 'quarentena', iqa: 12.5, iqa_faixa: 'Péssima', conama_violacoes: ['ph', 'od'] },
    { ...base, ponto_id: 'p-pa', ponto_nome: 'Porto Acre', codigo_ana: '13488000', ponto_municipio: 'Porto Acre', ponto_rio: 'Rio Acre',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-11',
      status: 'completo', iqa: 82.1, iqa_faixa: 'Ótima', conama_violacoes: [] },
  ];
}

const PONTOS_PUBLICOS = [
  { id: 'p-rb', nome: 'Rio Branco', lat: -9.975, lng: -67.810 },
  { id: 'p-pa', nome: 'Porto Acre', lat: -9.590, lng: -67.550 },
];

const CABECALHO_PUBLICO = {
  secretaria: 'Secretaria de Estado do Meio Ambiente do Acre', siglaSecr: 'SEMA-AC',
  diretoria: 'Diretoria de Meio Ambiente', siglaDiret: 'DIMA',
  departamento: 'Departamento de Unidades de Conservação',
  logoGoverno: null, logoSecr: null,
};

// Stub deliberadamente SEM `.from` e SEM `.auth` — só `.rpc`, as três
// funções que a migration 297 abre para `anon`. Qualquer tentativa da
// página de usar `.from()` ou `db.auth.*` estoura "is not a function"
// (ver item 2 do cabeçalho).
async function abrirPainelPublicoComStub(page, { coletas, pontos, cabecalho } = {}) {
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());

  await page.addInitScript(({ coletas, pontos, cabecalho }) => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-anon-key' });
    window.supabase = {
      createClient: () => ({
        rpc: async (nome) => {
          if (nome === 'agua_publico_coletas') return { data: coletas, error: null };
          if (nome === 'agua_publico_pontos') return { data: pontos, error: null };
          if (nome === 'agua_publico_cabecalho') return { data: cabecalho, error: null };
          throw new Error('RPC inesperada no painel público: ' + nome);
        },
      }),
    };
  }, { coletas: coletas || fixtureColetasPublicas(), pontos: pontos || PONTOS_PUBLICOS, cabecalho: cabecalho || CABECALHO_PUBLICO });

  await page.goto(PAGINA);
  await page.waitForSelector('.adash-grid, .adash-vazio', { timeout: 15_000 });
}

test.describe('migration 297 — whitelist de colunas do painel público', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');

  function corpoDaFuncao(nome) {
    const inicio = sql.indexOf(`FUNCTION ${nome}(`);
    expect(inicio, `função ${nome} não encontrada na migration`).toBeGreaterThan(-1);
    const fimMarcador = '\n$$;';
    const fim = sql.indexOf(fimMarcador, inicio);
    return sql.slice(inicio, fim);
  }

  test('agua_publico_coletas() nunca devolve coletor, GPS do aparelho, foto, laudo ou observações', () => {
    const corpo = corpoDaFuncao('agua_publico_coletas');
    const proibidas = [
      'coletor_id', 'coletor_nome', 'criado_por', 'localizacao', 'gps_confirmacao',
      'foto_url', 'laudo_url', 'observacoes', 'quarentena_motivo',
      'linha_origem_planilha', 'laboratorio_id', 'laboratorio_nome',
      'exclusao_justificativa', 'excluido_por', 'uuid_cliente',
    ];
    proibidas.forEach(col => {
      expect(corpo, `coluna proibida "${col}" apareceu em agua_publico_coletas()`).not.toMatch(new RegExp(`\\b${col}\\b`));
    });
    // E filtra soft-delete — mesma regra de vw_agua_coletas_detalhe.
    expect(corpo).toMatch(/excluido_em IS NULL/);
  });

  test('agua_publico_pontos() devolve só id/nome/lat/lng — nada de dado de cadastro interno', () => {
    const corpo = corpoDaFuncao('agua_publico_pontos');
    expect(corpo).not.toMatch(/observacoes|criado_em|atualizado_em|coordenada_observacao/);
  });

  test('as três funções são SECURITY DEFINER com search_path fixo e GRANT explícito para anon', () => {
    ['agua_publico_coletas', 'agua_publico_pontos', 'agua_publico_cabecalho'].forEach(nome => {
      const corpo = corpoDaFuncao(nome);
      expect(corpo).toMatch(/SECURITY DEFINER/);
      expect(corpo).toMatch(/SET search_path = public/);
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${nome}\\(\\)\\s+TO anon`));
    });
  });

  test('cabeçalho público não expõe endereço/telefone/e-mail nem responsáveis técnicos', () => {
    const corpo = corpoDaFuncao('agua_publico_cabecalho');
    expect(corpo).not.toMatch(/endereco|telefone|email|responsaveis_tecnicos/);
  });
});

test.describe('migration 298 — base legal adicional no cabeçalho público', () => {
  const sql298 = fs.readFileSync(MIGRATION_298, 'utf8');

  test('baseLegal vem de config_sistema.dados.agua.base_legal, nunca hardcoded, com fallback []', () => {
    expect(sql298).toMatch(/'baseLegal',\s*COALESCE\(dados->'agua'->'base_legal', '\[\]'::jsonb\)/);
    // Não deve haver nenhum ato ESTADUAL fabricado embutido no SQL — a
    // migration só REPASSA o que já está em config_sistema, nunca
    // INSERTa um valor fixo (titulo/orgao/ementa/data de um ato
    // específico). A Resolução CONAMA 357/2005, federal e pública, é
    // texto fixo no CLIENTE (js/agua-painel.js), só citada em comentário
    // aqui — nunca gravada como dado dentro do corpo SQL da função.
    expect(sql298).not.toMatch(/jsonb_build_object\(\s*'titulo'/i);
    expect(sql298).not.toMatch(/jsonb_build_array/i);
  });

  test('mantém a mesma assinatura (zero parâmetros) — CREATE OR REPLACE seguro', () => {
    expect(sql298).toMatch(/CREATE OR REPLACE FUNCTION agua_publico_cabecalho\(\)/);
  });
});

test.describe('migration 299 — departamento por módulo (organograma), não mais campo genérico', () => {
  const sql299 = fs.readFileSync(MIGRATION_299, 'utf8');

  test('modulo_departamento() é SECURITY DEFINER com REVOKE explícito de anon — achado real (ALTER DEFAULT PRIVILEGES concede por nome)', () => {
    expect(sql299).toMatch(/CREATE OR REPLACE FUNCTION modulo_departamento\(p_modulo_chave text\)/);
    expect(sql299).toMatch(/SECURITY DEFINER/);
    expect(sql299).toMatch(/SET search_path = public/);
    // O REVOKE FROM PUBLIC sozinho não fechava `anon` neste projeto
    // (confirmado testando como anon de verdade) — precisa do REVOKE
    // explícito do papel, por nome, ANTES do GRANT para authenticated.
    expect(sql299).toMatch(/REVOKE EXECUTE ON FUNCTION modulo_departamento\(text\) FROM anon/);
    expect(sql299).toMatch(/GRANT EXECUTE ON FUNCTION modulo_departamento\(text\) TO authenticated/);
  });

  test('agua_publico_cabecalho() passa a derivar departamento de modulo_departamento(\'agua\'), com fallback pro campo genérico', () => {
    expect(sql299).toMatch(/COALESCE\(\(SELECT nome FROM modulo_departamento\('agua'\)\),\s*dados->'departamento'->>'nome'/);
  });

  test('corrige o nome do DERHQA (estava só com a sigla, nunca por extenso)', () => {
    expect(sql299).toMatch(/nome = 'Departamento de Recursos Hídricos e Qualidade Ambiental'/);
    expect(sql299).toMatch(/WHERE sigla = 'DERHQA'/);
  });
});

test.describe('painel público — render sem sessão, só com as RPCs anon', () => {
  test('monta o painel de ponta a ponta chamando SÓ agua_publico_* — sem login, sem redirecionar', async ({ page }) => {
    const erros = [];
    page.on('pageerror', e => erros.push(e.message));

    await abrirPainelPublicoComStub(page);

    expect(page.url()).toContain('agua-publico.html'); // nunca foi para index.html
    await expect(page.locator('.adash-card-escuro .adash-num')).toHaveText('57.7'); // (78.4+12.5+82.1)/3
    await expect(page.locator('.adash-tabela-linha')).toHaveCount(2);
    expect(erros, 'erro de JS na página: ' + erros.join(' | ')).toHaveLength(0);
  });

  test('coleta em quarentena aparece MARCADA no painel público, nunca escondida', async ({ page }) => {
    await abrirPainelPublicoComStub(page);
    await expect(page.locator('.adash-aviso')).toContainText('em quarentena');
    await expect(page.locator('.adash-aviso')).toContainText('dado preliminar');
    await expect(page.locator('.adash-tabela-linha', { hasText: 'Rio Branco' }).locator('.badge')).toHaveText('quarentena');
  });

  test('mapa desenha os pontos vindos de agua_publico_pontos() (lat/lng já prontos, sem parsear geom)', async ({ page }) => {
    await abrirPainelPublicoComStub(page);
    await page.waitForFunction(() => document.querySelectorAll('#rl-mapa .adash-mapa-pin').length >= 2, null, { timeout: 10_000 });
    await expect(page.locator('#rl-mapa .adash-mapa-pin')).toHaveCount(2);
  });

  test('clicar num pino abre o detalhe da coleta, SEM coletor/laboratório (ausentes da RPC pública, migration 300)', async ({ page }) => {
    await abrirPainelPublicoComStub(page);
    await page.waitForFunction(() => document.querySelectorAll('#rl-mapa .adash-mapa-pin').length >= 2, null, { timeout: 10_000 });
    await page.click('#rl-mapa .adash-mapa-pin >> nth=0');

    await expect(page.locator('#adet-modal')).toHaveClass(/aberto/);
    await expect(page.locator('#adet-btn-exportar')).toBeVisible();
    // Ausência de coluna (RPC pública não devolve), nunca "—" de campo vazio.
    await expect(page.locator('#adet-modal')).not.toContainText('Coletor');
    await expect(page.locator('#adet-modal')).not.toContainText('Laboratório');

    await page.click('#adet-modal .modal-close');
    await expect(page.locator('#adet-modal')).not.toHaveClass(/aberto/);
  });

  test('mapa tem os componentes cartográficos oficiais: rosa dos ventos, escala, legenda (IQA+CONAMA) e alternância de satélite', async ({ page }) => {
    await abrirPainelPublicoComStub(page);
    await page.waitForFunction(() => document.querySelectorAll('#rl-mapa .adash-mapa-pin').length >= 2, null, { timeout: 10_000 });

    // Rosa dos ventos — MESMO componente de pages/mapa.html.
    await expect(page.locator('.rosa-norte svg')).toBeVisible();
    // Escala nativa do Leaflet.
    await expect(page.locator('.leaflet-control-scale')).toBeVisible();
    // Legenda oficial: mesmas categorias de pages/agua-mapa.html.
    const legenda = page.locator('.adash-mapa-legenda');
    await expect(legenda).toContainText('IQA (preenchimento)');
    await expect(legenda).toContainText('Ótima');
    await expect(legenda).toContainText('CONAMA (borda)');
    await expect(legenda).toContainText('Conforme');
    await expect(legenda).toContainText('Violação');
    await expect(legenda).toContainText('em conferência');
    await expect(legenda).toContainText('Camadas de referência');

    // Alternância Mapa/Satélite: nasce em "Mapa", clique troca o ativo
    // e não quebra os marcadores já desenhados.
    await expect(page.locator('.adash-mapa-sat-btn.ativo')).toHaveText('Mapa');
    await page.click('.adash-mapa-sat-btn:has-text("Satélite")');
    await expect(page.locator('.adash-mapa-sat-btn.ativo')).toHaveText('Satélite');
    await expect(page.locator('#rl-mapa .adash-mapa-pin')).toHaveCount(2);
  });

  test('mapa já nasce com limite do Acre, municípios (rotulados) e hidrografia — sem precisar ligar nada (mesmo em satélite, que não tem esses rótulos)', async ({ page }) => {
    await abrirPainelPublicoComStub(page);
    await page.waitForFunction(() => document.querySelectorAll('#rl-mapa .adash-mapa-pin').length >= 2, null, { timeout: 10_000 });

    await page.waitForFunction(() => document.querySelectorAll('.adash-mapa-mun-label').length > 0, null, { timeout: 10_000 });
    await expect(page.locator('.adash-mapa-mun-label').first()).toBeVisible();

    // Troca pra satélite (onde o basemap não tem nenhum rótulo) — as
    // camadas de referência continuam visíveis, sem depender do toggle.
    await page.click('.adash-mapa-sat-btn:has-text("Satélite")');
    await expect(page.locator('.adash-mapa-mun-label').first()).toBeVisible();
  });

  test('painel "Configurar camadas" também no público: trocar espessura do limite do Acre e ocultar nomes dos municípios', async ({ page }) => {
    await abrirPainelPublicoComStub(page);
    await page.waitForFunction(() => document.querySelectorAll('.adash-mapa-mun-label').length > 0, null, { timeout: 10_000 });

    await page.click('.adash-mapa-config-btn');
    await expect(page.locator('.adash-mapa-config-painel')).toBeVisible();

    await page.locator('.amcfg-acre-peso').evaluate(el => { el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })) })
    await expect(page.locator('.amcfg-acre-peso-val')).toHaveText('5')

    await page.uncheck('.amcfg-mun-nomes');
    await expect(page.locator('.adash-mapa-mun-label').first()).toBeHidden();
  });

  test('cabeçalho institucional usa agua_publico_cabecalho() — logos exibidas quando existem', async ({ page }) => {
    await abrirPainelPublicoComStub(page, {
      cabecalho: { ...CABECALHO_PUBLICO, logoGoverno: 'https://exemplo.test/gov.png', logoSecr: 'https://exemplo.test/sema.png' },
    });
    await expect(page.locator('#apub-logo-gov')).toHaveAttribute('src', 'https://exemplo.test/gov.png');
    await expect(page.locator('#apub-logo-secr')).toHaveAttribute('src', 'https://exemplo.test/sema.png');
  });

  test('bacia no cabeçalho e filtros da gaveta funcionam igual à tela de mesa (mesmo agua-painel.js)', async ({ page }) => {
    await abrirPainelPublicoComStub(page);
    await expect(page.locator('#rl-bacia option:checked')).toContainText('Acre todo');

    await page.click('#rl-btn-filtros');
    await page.selectOption('#rl-status', 'completo');
    await expect(page.locator('#rl-filtros-n')).toHaveText('1');
    await expect(page.locator('.adash-tabela-linha')).toHaveCount(2); // só as 2 completas, quarentena fora
  });

  test('sem coleta no recorte mostra vazio, nunca erro — export desabilitado', async ({ page }) => {
    await abrirPainelPublicoComStub(page, { coletas: [] });
    await expect(page.locator('.adash-vazio')).toBeVisible();
    await expect(page.locator('#rl-btn-export')).toBeDisabled();
  });

  test('card "Base Legal e Conformidade" mostra a CONAMA 357/2005 SEMPRE — inclusive sem coleta no recorte', async ({ page }) => {
    await abrirPainelPublicoComStub(page, { coletas: [] });
    await expect(page.locator('.adash-legal-norma').first()).toContainText('CONAMA nº 357');
  });

  test('atos adicionais cadastrados em Configurações (config_sistema.dados.agua.base_legal) aparecem junto da CONAMA', async ({ page }) => {
    await abrirPainelPublicoComStub(page, {
      cabecalho: { ...CABECALHO_PUBLICO, baseLegal: [{ titulo: 'Portaria SEMA-AC nº 12/2026', orgao: 'SEMA-AC', data: '2026-02-10', ementa: 'Ato de teste.', link: '' }] },
    });
    const itens = page.locator('.adash-legal-item');
    await expect(itens).toHaveCount(2); // CONAMA fixa + o ato cadastrado
    await expect(itens.nth(1)).toContainText('Portaria SEMA-AC nº 12/2026');
  });

  test('botão "Entenda o cálculo" abre o popup com os pesos REAIS de agua_calcular_iqa() e as faixas de agua_iqa_faixa()', async ({ page }) => {
    await abrirPainelPublicoComStub(page);
    await expect(page.locator('#rl-iqa-modal')).not.toHaveClass(/aberto/);

    await page.click('button:has-text("Entenda o cálculo")');
    await expect(page.locator('#rl-iqa-modal')).toHaveClass(/aberto/);
    await expect(page.locator('#rl-iqa-modal')).toContainText('Oxigênio Dissolvido');
    await expect(page.locator('#rl-iqa-modal')).toContainText('17%'); // peso do OD, migration 249
    await expect(page.locator('#rl-iqa-modal')).toContainText('Péssima');
    await expect(page.locator('#rl-iqa-modal')).toContainText('< 19'); // faixa Péssima, agua_iqa_faixa()

    await page.locator('#rl-iqa-modal .modal-close').click();
    await expect(page.locator('#rl-iqa-modal')).not.toHaveClass(/aberto/);
  });
});

test.describe('exportação pública — protocolo fixo, nunca a RPC institucional', () => {
  test('PDF gerado usa "Acesso público — não protocolado", nunca chama gerar_protocolo_relatorio', async ({ page }) => {
    test.setTimeout(60_000);
    const chamadasRpc = [];
    await page.addInitScript(() => {
      window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-anon-key' });
      window.__RPC_CHAMADAS__ = [];
      window.supabase = {
        createClient: () => ({
          rpc: async (nome) => {
            window.__RPC_CHAMADAS__.push(nome);
            if (nome === 'agua_publico_coletas') return { data: [], error: null };
            if (nome === 'agua_publico_pontos') return { data: [], error: null };
            if (nome === 'agua_publico_cabecalho') return {
              data: { secretaria: 'Secretaria de Estado do Meio Ambiente do Acre', siglaSecr: 'SEMA-AC',
                       diretoria: 'Diretoria de Meio Ambiente', siglaDiret: 'DIMA',
                       departamento: 'Departamento de Unidades de Conservação', logoGoverno: null, logoSecr: null },
              error: null,
            };
            throw new Error('RPC inesperada: ' + nome);
          },
        }),
      };
    });
    await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
    await page.route('**/tile.openstreetmap.org/**', route => route.abort());
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPdf === 'function');

    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, {});
      const cab = { secretaria: 'Secretaria de Estado do Meio Ambiente do Acre', siglaSecr: 'SEMA-AC',
        diretoria: 'Diretoria de Meio Ambiente', siglaDiret: 'DIMA', departamento: 'Departamento de Unidades de Conservação',
        logoGoverno: null, logoSecr: null };
      const pdf = await window.aguaRelMontarPdf(relatorio, 'Rio Acre', '2024 · 1ª campanha', cab, 'Acesso público — não protocolado')
      const blob = pdf.output('blob')
      const buf = await blob.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      return btoa(binary)
    }, fixtureColetasPublicas());

    const buf = Buffer.from(base64, 'base64');
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buf });
    const texto = (await parser.getText()).text;
    await parser.destroy();

    expect(texto).toContain('Acesso público');
    expect(texto).not.toMatch(/Prot\. SIGUC-\d{4}-\d{4}/); // nunca um protocolo gerado de verdade

    const chamadas = await page.evaluate(() => window.__RPC_CHAMADAS__);
    expect(chamadas).not.toContain('gerar_protocolo_relatorio');
  });
});
