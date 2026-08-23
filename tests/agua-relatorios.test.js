// ── Qualidade da Água · Relatórios por bacia (Fase 5) ────────────
// Executar: npx playwright test tests/agua-relatorios.test.js
// (precisa de um servidor estático na raiz do repo — por padrão
//  http://localhost:5500, igual aos demais testes do módulo)
//
// A página exige sessão Supabase para a tela completa (mesma limitação
// documentada em tests/agua-mapa.test.js); aqui o alvo são as funções
// de agregação (js/agua-relatorio-dados.js) e os DOIS geradores de
// arquivo (js/agua-relatorio-pdf.js, js/agua-relatorio-pptx.js) —
// carregados como <script src> incondicionais, antes do IIFE de
// autenticação da página, então ficam disponíveis mesmo sem sessão.
//
// O que este arquivo trava:
//  - IQA/CONAMA nunca são recalculados aqui — os testes usam valores
//    já prontos, como a view vw_agua_coletas_detalhe entregaria;
//  - bacia NULA (ex.: Rio Iquiri, pendência de conferência) vira
//    "Sem bacia definida" e NÃO quebra nenhum dos dois geradores;
//  - coleta em quarentena aparece MARCADA no PDF e no resumo, nunca
//    escondida nem apresentada como dado completo;
//  - os dois arquivos gerados são de verdade: o PDF é aberto com
//    pdf-parse (texto extraído) e a PPTX com jszip (XML dos slides) —
//    não é só "não lançou exceção".

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

// pdf-parse v2: API por classe (getInfo/getText), não a função v1.
// `require` PREGUIÇOSO de propósito: o pdfjs por trás do pacote precisa
// de @napi-rs/canvas (binding nativo) e não carrega em toda máquina —
// no topo do arquivo, uma falha dele derrubava a coleta inteira ("No
// tests found"), levando junto os testes de agregação e de painel, que
// não têm nada a ver com PDF.
async function extrairTextoPdf(buf) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buf });
  const info = await parser.getInfo();
  const texto = await parser.getText();
  await parser.destroy();
  return { numpages: info.total, text: texto.text };
}

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const PAGINA = `${BASE}/pages/agua-relatorios.html`;
const OUT_DIR = path.join(__dirname, '..', 'test-results', 'agua-relatorios');

// O binário headless_shell que o Playwright pediria não está pré-instalado
// neste ambiente — mesmo contorno já usado em tests/agua-app-fluxo.test.js.
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

test.beforeAll(() => { fs.mkdirSync(OUT_DIR, { recursive: true }); });

// Fixture no formato de vw_agua_coletas_detalhe (migration 249/260) —
// 2 pontos da bacia "Rio Acre", 3 campanhas; o Porto Acre não tem
// coleta na 2ª campanha de 2025 (testa o gap/série incompleta) e uma
// coleta de Rio Branco está em quarentena com violação CONAMA.
function fixtureColetasRioAcre() {
  const base = {
    ponto_bacia: 'Rio Acre', classe_enquadramento: 'classe_2', uc_id: null,
  };
  return [
    { ...base, ponto_id: 'p-rb', ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Acre',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-10',
      status: 'completo', iqa: 78.4, iqa_faixa: 'Boa', conama_violacoes: [] },
    { ...base, ponto_id: 'p-rb', ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Acre',
      campanha_id: 'c2', campanha_ano: 2024, campanha_ordem: 'segunda', data_coleta: '2024-09-12',
      status: 'completo', iqa: 61.2, iqa_faixa: 'Regular', conama_violacoes: ['turbidez'] },
    { ...base, ponto_id: 'p-rb', ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_municipio: 'Rio Branco', ponto_rio: 'Rio Acre',
      campanha_id: 'c3', campanha_ano: 2025, campanha_ordem: 'primeira', data_coleta: '2025-03-08',
      status: 'quarentena', iqa: 12.5, iqa_faixa: 'Péssima', conama_violacoes: ['ph', 'od'] },
    { ...base, ponto_id: 'p-pa', ponto_nome: 'Porto Acre', codigo_ana: '13488000', ponto_municipio: 'Porto Acre', ponto_rio: 'Rio Acre',
      campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-03-11',
      status: 'completo', iqa: 82.1, iqa_faixa: 'Ótima', conama_violacoes: [] },
    // Porto Acre sem coleta em c2 (2024/segunda) — testa o gap na série.
    { ...base, ponto_id: 'p-pa', ponto_nome: 'Porto Acre', codigo_ana: '13488000', ponto_municipio: 'Porto Acre', ponto_rio: 'Rio Acre',
      campanha_id: 'c3', campanha_ano: 2025, campanha_ordem: 'primeira', data_coleta: '2025-03-09',
      status: 'completo', iqa: 74.0, iqa_faixa: 'Boa', conama_violacoes: null },
  ];
}

// Bacia "Purus" de verdade tem 3 rios (Rio Acre/Rio Iaco/Rio Purus,
// confirmado contra produção antes de desenhar o filtro) — fixture com
// 1 ponto por rio, pra testar que "filtrar por rio" refina DENTRO da
// bacia, não é redundante com ela.
function fixtureColetasPurusMultiRio() {
  const base = { ponto_bacia: 'Purus', classe_enquadramento: 'classe_2', uc_id: null, campanha_id: 'c1', campanha_ano: 2024, campanha_ordem: 'primeira', data_coleta: '2024-04-01' };
  return [
    { ...base, ponto_id: 'p-ac', ponto_nome: 'Xapuri', ponto_rio: 'Rio Acre', ponto_municipio: 'Xapuri',
      status: 'completo', iqa: 70.0, iqa_faixa: 'Boa', conama_violacoes: [] },
    { ...base, ponto_id: 'p-ia', ponto_nome: 'Sena Madureira', ponto_rio: 'Rio Iaco', ponto_municipio: 'Sena Madureira',
      status: 'aguardando_lab', iqa: null, iqa_faixa: null, conama_violacoes: null },
    { ...base, ponto_id: 'p-pu', ponto_nome: 'Manoel Urbano', ponto_rio: 'Rio Purus', ponto_municipio: 'Manoel Urbano',
      status: 'completo', iqa: 40.0, iqa_faixa: 'Ruim', conama_violacoes: ['turbidez', 'od'] },
  ];
}

// Bacia grande (12 pontos × 2 campanhas) — usada para provar que a capa
// cheia não produz página em branco e que o gráfico de barras se limita
// aos 10 primeiros pontos sem quebrar o layout.
function fixtureColetasMuitosPontos() {
  const linhas = [];
  for (let p = 1; p <= 12; p++) {
    for (const [cid, ano, ordem] of [['c1', 2024, 'primeira'], ['c2', 2024, 'segunda']]) {
      const iqa = 40 + p * 3;
      linhas.push({
        ponto_bacia: 'Rio Acre', ponto_id: `pt-${p}`, ponto_nome: `Ponto ${p}`, codigo_ana: `1360${p}`,
        ponto_rio: 'Rio Acre', ponto_municipio: `Município ${p}`, classe_enquadramento: 'classe_2', uc_id: null,
        campanha_id: cid, campanha_ano: ano, campanha_ordem: ordem,
        data_coleta: `${ano}-0${ordem === 'primeira' ? 3 : 9}-10`,
        status: p === 1 ? 'quarentena' : 'completo',
        iqa, iqa_faixa: iqa >= 79 ? 'Ótima' : iqa >= 51 ? 'Boa' : 'Regular',
        conama_violacoes: p % 3 === 0 ? ['turbidez'] : [],
      });
    }
  }
  return linhas;
}

function fixtureColetasSemBacia() {
  return [
    { ponto_bacia: null, ponto_id: 'p-iq', ponto_nome: 'Senador Guiomard', codigo_ana: '99999000',
      ponto_municipio: 'Senador Guiomard', ponto_rio: 'Rio Iquiri', classe_enquadramento: 'classe_2', uc_id: null,
      campanha_id: 'c1', campanha_ano: 2023, campanha_ordem: 'primeira', data_coleta: '2023-05-01',
      status: 'completo', iqa: 55.0, iqa_faixa: 'Regular', conama_violacoes: [] },
  ];
}

test.describe('agregação (js/agua-relatorio-dados.js) — pura, sem rede', () => {
  test('lista bacias, trata bacia NULA como "Sem bacia definida"', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelListarBacias === 'function');

    const bacias = await page.evaluate((coletas) => window.aguaRelListarBacias(coletas), [...fixtureColetasRioAcre(), ...fixtureColetasSemBacia()]);
    expect(bacias.find(b => b.bacia === 'Rio Acre')).toMatchObject({ label: 'Rio Acre', nPontos: 2, nColetas: 5 });
    const semBacia = bacias.find(b => b.label === 'Sem bacia definida');
    expect(semBacia).toBeTruthy();
    expect(semBacia.nPontos).toBe(1);
  });

  test('aguaRelMontar recorta por campanha, agrupa por ponto e resume — quarentena e CONAMA contados certo', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontar === 'function');

    const relatorio = await page.evaluate((coletas) => window.aguaRelMontar(coletas, {}), fixtureColetasRioAcre());
    expect(relatorio.campanhas).toHaveLength(3);
    expect(relatorio.pontos).toHaveLength(2);
    expect(relatorio.resumo.totalColetas).toBe(5);
    expect(relatorio.resumo.quarentena).toBe(1);
    expect(relatorio.resumo.comConama).toBe(4); // 5 coletas - 1 com conama_violacoes null
    expect(relatorio.resumo.conforme).toBe(2);  // rb/c1 e pa/c1 sem violação

    // Recorte: só a 1ª campanha.
    const so1a = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { campanhaAteId: 'c1' }), fixtureColetasRioAcre());
    expect(so1a.campanhas).toHaveLength(1);
    expect(so1a.resumo.totalColetas).toBe(2);
  });

  test('filtros de busca: rio, status, faixa do IQA e conformidade CONAMA refinam DENTRO da bacia', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontar === 'function' && typeof window.aguaRelRiosDe === 'function' && typeof window.aguaRelFiltrosTxt === 'function');

    const rios = await page.evaluate((coletas) => window.aguaRelRiosDe(coletas), fixtureColetasPurusMultiRio());
    expect(rios).toEqual(['Rio Acre', 'Rio Iaco', 'Rio Purus']); // ordenado, os 3 rios da bacia real

    // Rio: só o ponto do Rio Iaco entra.
    const porRio = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { rio: 'Rio Iaco' }), fixtureColetasPurusMultiRio());
    expect(porRio.pontos.map(p => p.nome)).toEqual(['Sena Madureira']);
    expect(porRio.filtros).toMatchObject({ rio: 'Rio Iaco', status: null, iqaFaixa: null, conamaStatus: null });

    // Status: só o ponto aguardando_lab (Rio Iaco) entra.
    const porStatus = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { status: 'aguardando_lab' }), fixtureColetasPurusMultiRio());
    expect(porStatus.pontos.map(p => p.nome)).toEqual(['Sena Madureira']);

    // Faixa do IQA: só o ponto "Ruim" (Rio Purus) entra.
    const porFaixa = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { iqaFaixa: 'Ruim' }), fixtureColetasPurusMultiRio());
    expect(porFaixa.pontos.map(p => p.nome)).toEqual(['Manoel Urbano']);

    // Conformidade CONAMA: 'violacao' pega só o Rio Purus, 'sem_limites' só o Rio Iaco (conama_violacoes null).
    const porViolacao = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { conamaStatus: 'violacao' }), fixtureColetasPurusMultiRio());
    expect(porViolacao.pontos.map(p => p.nome)).toEqual(['Manoel Urbano']);
    const porSemLimites = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { conamaStatus: 'sem_limites' }), fixtureColetasPurusMultiRio());
    expect(porSemLimites.pontos.map(p => p.nome)).toEqual(['Sena Madureira']);

    // Filtros combinam com "E", não "OU".
    const combinado = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { rio: 'Rio Purus', status: 'completo' }), fixtureColetasPurusMultiRio());
    expect(combinado.pontos.map(p => p.nome)).toEqual(['Manoel Urbano']);
    const combinadoVazio = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { rio: 'Rio Purus', status: 'aguardando_lab' }), fixtureColetasPurusMultiRio());
    expect(combinadoVazio.pontos).toHaveLength(0);

    // Texto legível dos filtros ativos, reaproveitado pela tela e pelos dois geradores.
    const txt = await page.evaluate(() => window.aguaRelFiltrosTxt({ rio: 'Rio Iaco', status: 'completo', iqaFaixa: null, conamaStatus: null }));
    expect(txt).toBe('Rio: Rio Iaco · Status: Completo');
    expect(await page.evaluate(() => window.aguaRelFiltrosTxt({ rio: null, status: null, iqaFaixa: null, conamaStatus: null }))).toBe('');
  });

  test('opts.bacia filtra DENTRO de um conjunto com várias bacias — o escopo "Acre todo"', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontar === 'function');

    // aguaRelBuscarTodasColetas junta bacias diferentes num array só;
    // opts.bacia é o filtro que recorta isso client-side, sem nova ida
    // ao banco — mesma chave que aguaRelListarBacias/aguaRelChaveBacia
    // já usam (AGUA_REL_SEM_BACIA para bacia nula).
    const todas = [...fixtureColetasRioAcre(), ...fixtureColetasPurusMultiRio(), ...fixtureColetasSemBacia()];

    const semFiltro = await page.evaluate((coletas) => window.aguaRelMontar(coletas, {}), todas);
    expect(semFiltro.pontos).toHaveLength(6); // 2 (Rio Acre) + 3 (Purus) + 1 (sem bacia)

    const soPurus = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { bacia: 'Purus' }), todas);
    expect(soPurus.pontos.map(p => p.nome).sort()).toEqual(['Manoel Urbano', 'Sena Madureira', 'Xapuri']);
    expect(soPurus.filtros.bacia).toBe('Purus');

    const soRioAcre = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { bacia: 'Rio Acre' }), todas);
    expect(soRioAcre.pontos.map(p => p.nome).sort()).toEqual(['Porto Acre', 'Rio Branco']);

    const semBacia = await page.evaluate((coletas) => window.aguaRelMontar(coletas, { bacia: AGUA_REL_SEM_BACIA }), todas);
    expect(semBacia.pontos.map(p => p.nome)).toEqual(['Senador Guiomard']);

    // Texto legível dos filtros inclui a bacia quando o filtro está ativo.
    const txt = await page.evaluate(() => window.aguaRelFiltrosTxt({ bacia: 'Purus', rio: null, status: null, iqaFaixa: null, conamaStatus: null }));
    expect(txt).toBe('Bacia: Purus');
    const txtSemBacia = await page.evaluate(() => window.aguaRelFiltrosTxt({ bacia: AGUA_REL_SEM_BACIA, rio: null, status: null, iqaFaixa: null, conamaStatus: null }));
    expect(txtSemBacia).toBe('Bacia: Sem bacia definida');
  });

  test('aguaRelBuscarTodasColetas busca sem filtro de bacia nenhum — o escopo "Acre todo"', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelBuscarTodasColetas === 'function');

    const chamada = await page.evaluate(async (coletas) => {
      const chamados = [];
      const dbFalso = {
        from(tabela) {
          chamados.push('from:' + tabela)
          return {
            select() {
              chamados.push('select')
              return { order() { chamados.push('order'); return Promise.resolve({ data: coletas, error: null }) } }
            },
          }
        },
      };
      const resultado = await window.aguaRelBuscarTodasColetas(dbFalso)
      return { resultado, chamados }
    }, fixtureColetasRioAcre());

    // NUNCA chama .eq()/.is() de bacia — é o que distingue de
    // aguaRelBuscarColetasDaBacia (que sempre filtra por UMA).
    expect(chamada.chamados).toEqual(['from:vw_agua_coletas_detalhe', 'select', 'order']);
    expect(chamada.resultado).toHaveLength(5);
  });

  test('aguaRelSerieIQA preenche gap com null, nunca omite a campanha', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontar === 'function' && typeof window.aguaRelSerieIQA === 'function');

    const serie = await page.evaluate((coletas) => {
      const rel = window.aguaRelMontar(coletas, {});
      const portoAcre = rel.pontos.find(p => p.ponto_id === 'p-pa');
      return window.aguaRelSerieIQA(portoAcre, rel.campanhas);
    }, fixtureColetasRioAcre());

    expect(serie).toHaveLength(3);
    expect(serie[0].iqa).toBe(82.1);
    expect(serie[1].iqa).toBeNull(); // gap: Porto Acre não coletou na campanha c2
    expect(serie[2].iqa).toBe(74.0);
  });
});

test.describe('geração real dos arquivos — PDF e PPTX', () => {
  test('PDF: gera de verdade, abre com pdf-parse e traz os dados certos (bacia com histórico)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPdf === 'function' && typeof window.aguaRelMontar === 'function');

    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, {});
      const cab = {
        secretaria: 'Secretaria de Estado do Meio Ambiente do Acre', siglaSecr: 'SEMA-AC',
        diretoria: 'Diretoria de Meio Ambiente', siglaDiret: 'DIMA', departamento: 'Departamento de Unidades de Conservação',
        logoGoverno: null, logoSecr: null,
      };
      const pdf = await window.aguaRelMontarPdf(relatorio, 'Rio Acre', '2024 · 1ª campanha — 2025 · 1ª campanha', cab, 'SIGUC-2026-TESTE');
      const blob = pdf.output('blob');
      const buf = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }, fixtureColetasRioAcre());

    const buf = Buffer.from(base64, 'base64');
    expect(buf.length).toBeGreaterThan(15_000); // documento real com fonte embutida, não um esqueleto vazio
    fs.writeFileSync(path.join(OUT_DIR, 'rio-acre.pdf'), buf);

    const parsed = await extrairTextoPdf(buf);
    expect(parsed.numpages).toBeGreaterThanOrEqual(2); // capa + ao menos 1 ponto
    const texto = parsed.text;
    expect(texto).toContain('Rio Acre');
    expect(texto).toContain('Rio Branco');
    expect(texto).toContain('Porto Acre');
    expect(texto).toContain('SEMA-AC');
    expect(texto).toContain('SIGUC-2026-TESTE');
    expect(texto).toMatch(/Quarentena/i);

    // Primeira página = o mesmo painel da tela. Os quatro blocos de
    // gráfico têm de estar lá, com os números que a tela mostraria.
    expect(texto).toContain('DISTRIBUIÇÃO POR FAIXA DO IQA');
    expect(texto).toContain('CONFORMIDADE CONAMA');
    expect(texto).toContain('PARÂMETROS QUE MAIS VIOLARAM');
    expect(texto).toContain('IQA MÉDIO POR PONTO DE COLETA');
    expect(texto).toContain('EVOLUÇÃO DO IQA MÉDIO DA BACIA POR CAMPANHA');
    // Legenda da distribuição traz a contagem ao lado da cor (a cor
    // nunca carrega o dado sozinha), com a faixa que veio do banco.
    // `(?!\d)` e não `\b`: no texto extraído a legenda sai colada na
    // próxima ("…Boa 2Regular 1…"), e entre '2' e 'R' — dois caracteres
    // de palavra — não existe borda \b.
    expect(texto).toMatch(/Boa\s*2(?!\d)/);       // 2 coletas 'Boa' na fixture
    expect(texto).toMatch(/Péssima\s*1(?!\d)/);   // a quarentenada, contada e não escondida
    // Ranking de violações substituiu o parágrafo de texto corrido.
    expect(texto).toMatch(/Turbidez/);
    // Barras do IQA por ponto: média de cada ponto, rotulada.
    expect(texto).toContain('78.0');          // Porto Acre (82.1 + 74.0)/2
    expect(texto).toContain('50.7');          // Rio Branco (78.4+61.2+12.5)/3
    // Medidor de conformidade: 2 conformes de 4 avaliadas.
    expect(texto).toMatch(/2 conforme · 2 com violação/);
  });

  test('PDF: cabeçalho institucional em TRÊS linhas — Secretaria, Diretoria e Departamento separados (js/relatorio-cabecalho-pdf.js)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPdf === 'function' && typeof window.aguaRelMontar === 'function');

    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, {});
      // departamento vem de modulo_departamento('agua') em produção — aqui
      // simulado direto no objeto cab, como getCabecalhoRelatorio('agua')
      // devolveria (ver js/config-sistema.js).
      const cab = {
        secretaria: 'Secretaria de Estado do Meio Ambiente do Acre', siglaSecr: 'SEMA-AC',
        diretoria: 'Diretoria de Meio Ambiente', siglaDiret: 'DIMA',
        departamento: 'Departamento de Recursos Hídricos e Qualidade Ambiental', siglaDep: 'DERHQA',
        logoGoverno: null, logoSecr: null,
      };
      const pdf = await window.aguaRelMontarPdf(relatorio, 'Rio Acre', '2024 · 1ª campanha', cab, 'SIGUC-2026-CABECALHO');
      const blob = pdf.output('blob');
      const buf = await blob.arrayBuffer();
      let binary = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }, fixtureColetasRioAcre());

    const texto = (await extrairTextoPdf(Buffer.from(base64, 'base64'))).text;
    // As TRÊS linhas aparecem separadas — nunca mais "Diretoria ·
    // Departamento · Módulo" numa string só (formato antigo).
    expect(texto).toContain('Secretaria de Estado do Meio Ambiente do Acre — SEMA-AC');
    expect(texto).toContain('Diretoria de Meio Ambiente');
    expect(texto).toContain('Departamento de Recursos Hídricos e Qualidade Ambiental');
    expect(texto).toContain('Qualidade da Água');
    // Nunca mais o departamento genérico (DEUC) na Água — era o bug relatado.
    expect(texto).not.toMatch(/Departamento de Unidades de Conserva/);
  });

  test('PDF: capa não gera página em branco quando a nota de quarentena empurra o conteúdo', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPdf === 'function');

    // Bacia com muitos pontos: a capa fica cheia e a nota de quarentena
    // pode cair na página seguinte — o documento não pode ganhar uma
    // folha vazia por causa disso.
    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, {});
      const cab = { secretaria: 'SEMA-AC', siglaSecr: 'SEMA-AC', diretoria: 'DIMA', siglaDiret: 'DIMA', departamento: 'DEUC', logoGoverno: null, logoSecr: null };
      const pdf = await window.aguaRelMontarPdf(relatorio, 'Rio Acre', 'período', cab, 'SIGUC-2026-CHEIO');
      const buf = await pdf.output('blob').arrayBuffer();
      let b = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
      return btoa(b);
    }, fixtureColetasMuitosPontos());

    const parsed = await extrairTextoPdf(Buffer.from(base64, 'base64'));
    // 3 páginas exatas: painel + 2 de detalhamento. Se a capa cheia
    // provocasse a folha em branco, viriam 4 — é essa a regressão que
    // o número guarda.
    expect(parsed.numpages).toBe(3);
    expect(parsed.text).toContain('IQA MÉDIO POR PONTO DE COLETA');
    expect(parsed.text).toMatch(/Ponto 12/);
    // 12 pontos, gráfico limitado aos 10 melhores — e o título diz isso.
    // (Os títulos de bloco/seção saem em CAIXA ALTA no documento.)
    expect(parsed.text).toContain('(10 DE 12)');
    // O recorte é SÓ do gráfico: o detalhamento continua trazendo os 12.
    for (let p = 1; p <= 12; p++) expect(parsed.text).toContain(`PONTO ${p} —`);
  });

  test('PDF: bacia sem dado cadastrado (Rio Iquiri, NULL) não quebra o fluxo', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPdf === 'function');

    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, {});
      const cab = { secretaria: 'SEMA-AC', siglaSecr: 'SEMA-AC', diretoria: 'DIMA', siglaDiret: 'DIMA', departamento: 'DEUC', logoGoverno: null, logoSecr: null };
      const pdf = await window.aguaRelMontarPdf(relatorio, 'Sem bacia definida', '2023 · 1ª campanha', cab, 'SIGUC-2026-TESTE2');
      const blob = pdf.output('blob');
      const buf = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }, fixtureColetasSemBacia());

    const buf = Buffer.from(base64, 'base64');
    expect(buf.length).toBeGreaterThan(15_000);
    const parsed = await extrairTextoPdf(buf);
    expect(parsed.text).toContain('Sem bacia definida');
  });

  test('PDF: com filtro de rio ativo, a capa avisa "Filtros aplicados" e o ponto de fora do filtro não aparece', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPdf === 'function' && typeof window.aguaRelMontar === 'function');

    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, { rio: 'Rio Iaco' });
      const cab = { secretaria: 'SEMA-AC', siglaSecr: 'SEMA-AC', diretoria: 'DIMA', siglaDiret: 'DIMA', departamento: 'DEUC', logoGoverno: null, logoSecr: null };
      const pdf = await window.aguaRelMontarPdf(relatorio, 'Purus', '2024 · 1ª campanha', cab, 'SIGUC-2026-FILTRO1');
      const buf = await pdf.output('blob').arrayBuffer();
      let binary = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }, fixtureColetasPurusMultiRio());

    const buf = Buffer.from(base64, 'base64');
    const parsed = await extrairTextoPdf(buf);
    expect(parsed.text).toMatch(/Filtros aplicados.*Rio: Rio Iaco/);
    expect(parsed.text).toContain('Sena Madureira'); // ponto do rio filtrado
    expect(parsed.text).not.toContain('Manoel Urbano'); // ponto de outro rio da mesma bacia — fora do filtro
    expect(parsed.text).not.toContain('Xapuri');
  });

  test('PPTX: com filtro de status ativo, a capa avisa "Filtros aplicados"', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPptx === 'function' && typeof window.aguaRelMontar === 'function');

    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, { status: 'completo' });
      const blob = await window.aguaRelMontarPptx(relatorio, 'Purus', '2024 · 1ª campanha', 'SIGUC-2026-FILTRO2');
      const buf = await blob.arrayBuffer();
      let binary = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }, fixtureColetasPurusMultiRio());

    const buf = Buffer.from(base64, 'base64');
    const zip = await JSZip.loadAsync(buf);
    const nomesSlides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const textoTodosSlides = (await Promise.all(nomesSlides.map(n => zip.files[n].async('text')))).join('\n');
    expect(textoTodosSlides).toMatch(/Filtros aplicados.*Status: Completo/);
  });

  test('PPTX: gera de verdade, é um zip válido com slides e traz os dados certos', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPptx === 'function' && typeof window.aguaRelMontar === 'function');

    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, {});
      const blob = await window.aguaRelMontarPptx(relatorio, 'Rio Acre', '2024 · 1ª campanha — 2025 · 1ª campanha', 'SIGUC-2026-TESTE');
      const buf = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }, fixtureColetasRioAcre());

    const buf = Buffer.from(base64, 'base64');
    expect(buf.length).toBeGreaterThan(20_000);
    fs.writeFileSync(path.join(OUT_DIR, 'rio-acre.pptx'), buf);

    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([
      '[Content_Types].xml', 'ppt/presentation.xml',
    ]));
    const nomesSlides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(nomesSlides.length).toBeGreaterThanOrEqual(4); // capa, resumo, evolução, conama

    const textoTodosSlides = (await Promise.all(nomesSlides.map(n => zip.files[n].async('text')))).join('\n');
    expect(textoTodosSlides).toContain('Rio Acre');
    expect(textoTodosSlides).toContain('SEMA-AC');
    expect(textoTodosSlides).toContain('SIGUC-2026-TESTE');
  });

  test('PPTX: slide 2 é o painel, com os gráficos NATIVOS (editáveis no PowerPoint)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPptx === 'function');

    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, {});
      const blob = await window.aguaRelMontarPptx(relatorio, 'Rio Acre', 'período', 'SIGUC-2026-PAINEL');
      const buf = await blob.arrayBuffer();
      let b = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
      return btoa(b);
    }, fixtureColetasRioAcre());

    const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'));
    const slide2 = await zip.files['ppt/slides/slide2.xml'].async('text');
    const rels2 = await zip.files['ppt/slides/_rels/slide2.xml.rels'].async('text');

    // Gráfico NATIVO, não imagem: o slide referencia 3 partes de chart
    // (distribuição por faixa, rosca CONAMA, barras por ponto). É a
    // diferença deliberada para o PDF, que desenha a mesma leitura.
    expect((rels2.match(/charts\/chart\d+\.xml/g) || []).length).toBe(3);
    expect(slide2).toContain('Painel do período');
    expect(slide2).toContain('DISTRIBUIÇÃO POR FAIXA DO IQA');
    expect(slide2).toContain('CONFORMIDADE CONAMA');
    expect(slide2).toContain('IQA MÉDIO POR PONTO DE COLETA');
    expect(slide2).toContain('61.6'); // KPI do IQA médio da fixture

    const nomesCharts = Object.keys(zip.files).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    const xmlCharts = (await Promise.all(nomesCharts.map(n => zip.files[n].async('text')))).join('\n');
    // A faixa vem do banco e a cor, da paleta única de agua-iqa-visual.js
    // — inclusive a 'Péssima' da coleta em quarentena, que não some.
    expect(xmlCharts).toContain('<c:v>Péssima</c:v>');
    expect(xmlCharts).toContain('86198F'); // Péssima (paleta corrigida)
    expect(xmlCharts).toContain('059669'); // Boa
    // Rosca CONAMA com os TRÊS estados — "sem limites" nunca somado a conforme.
    expect(xmlCharts).toContain('Sem limites cadastrados');
  });

  test('PPTX: bacia sem dado cadastrado (Rio Iquiri, NULL) não quebra o fluxo', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPptx === 'function');

    const base64 = await page.evaluate(async (coletas) => {
      const relatorio = window.aguaRelMontar(coletas, {});
      const blob = await window.aguaRelMontarPptx(relatorio, 'Sem bacia definida', '2023 · 1ª campanha', 'SIGUC-2026-TESTE2');
      const buf = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }, fixtureColetasSemBacia());

    const buf = Buffer.from(base64, 'base64');
    expect(buf.length).toBeGreaterThan(15_000);
    const zip = await JSZip.loadAsync(buf);
    const nomesSlides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const textoTodosSlides = (await Promise.all(nomesSlides.map(n => zip.files[n].async('text')))).join('\n');
    expect(textoTodosSlides).toContain('Sem bacia definida');
  });

  // Ficha de UMA coleta (js/agua-relatorio-pdf.js, aguaRelMontarPdfColeta) —
  // usada pelo botão "Exportar PDF" do detalhe da coleta em
  // pages/agua-app.html. Mesma técnica das duas primeiras: chama o
  // gerador de verdade e abre o PDF com pdf-parse, não é só "não
  // lançou exceção".
  test('Ficha de coleta: gera de verdade, traz IQA, CONAMA (com o parâmetro violado) e observações', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPdfColeta === 'function');

    const base64 = await page.evaluate(async () => {
      const coleta = {
        ponto_nome: 'Rio Branco', codigo_ana: '13601000', ponto_rio: 'Rio Acre', ponto_municipio: 'Rio Branco',
        classe_enquadramento: 'classe_2', campanha_ano: 2024, campanha_ordem: 'segunda',
        data_coleta: '2024-06-25', hora_coleta: '09:30', coletor_nome: 'Técnico de Teste',
        laboratorio_nome: 'Laboratório Central', status: 'completo', quarentena_motivo: null,
        iqa: 69.66, iqa_faixa: 'Boa', conama_violacoes: ['dbo'],
        od: 7.26, dbo: 9.0, turbidez: 26.56, ph: 7.43, fosforo_total: 0.029, coliformes_termotolerantes: 54,
        observacoes: 'Nível do rio baixo, coleta na margem direita.',
        codigo_amostra: 'AM-2024-0099',
      };
      const cab = {
        secretaria: 'Secretaria de Estado do Meio Ambiente do Acre', siglaSecr: 'SEMA-AC',
        diretoria: 'Diretoria de Meio Ambiente', siglaDiret: 'DIMA', departamento: 'Departamento de Unidades de Conservação',
        logoGoverno: null, logoSecr: null,
      };
      const pdf = await window.aguaRelMontarPdfColeta(coleta, cab, 'SIGUC-2026-FICHA1');
      const blob = pdf.output('blob');
      const buf = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    });

    const buf = Buffer.from(base64, 'base64');
    expect(buf.length).toBeGreaterThan(15_000);
    fs.writeFileSync(path.join(OUT_DIR, 'ficha-coleta.pdf'), buf);

    const parsed = await extrairTextoPdf(buf);
    expect(parsed.numpages).toBe(1); // ficha de 1 coleta cabe numa página
    const texto = parsed.text;
    expect(texto).toContain('Rio Branco');
    expect(texto).toContain('13601000');
    expect(texto).toContain('SEMA-AC');
    expect(texto).toContain('SIGUC-2026-FICHA1');
    expect(texto).toContain('69.7'); // IQA arredondado (jsPDF quebra o "," do pt-BR em espaço/nada)
    expect(texto).toMatch(/Boa/);
    expect(texto).toMatch(/1 viola/); // "1 violação(ões)"
    expect(texto).toMatch(/DBO/);
    expect(texto).toContain('Nível do rio baixo');
    expect(texto).toContain('AM-2024-0099');
  });

  test('Ficha de coleta: quarentena e sem parâmetros ainda não quebra o fluxo', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelMontarPdfColeta === 'function');

    const base64 = await page.evaluate(async () => {
      const coleta = {
        ponto_nome: 'Senador Guiomard', codigo_ana: '99999000', ponto_rio: 'Rio Iquiri', ponto_municipio: 'Senador Guiomard',
        classe_enquadramento: 'classe_2', campanha_ano: 2026, campanha_ordem: 'primeira',
        data_coleta: '2026-08-10', hora_coleta: null, coletor_nome: 'Técnico de Teste',
        laboratorio_nome: null, status: 'quarentena', quarentena_motivo: 'pH fora da faixa plausível',
        iqa: null, iqa_faixa: null, conama_violacoes: null,
        observacoes: null, codigo_amostra: null,
      };
      const cab = { secretaria: 'SEMA-AC', siglaSecr: 'SEMA-AC', diretoria: 'DIMA', siglaDiret: 'DIMA', departamento: 'DEUC', logoGoverno: null, logoSecr: null };
      const pdf = await window.aguaRelMontarPdfColeta(coleta, cab, 'SIGUC-2026-FICHA2');
      const blob = pdf.output('blob');
      const buf = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    });

    const buf = Buffer.from(base64, 'base64');
    expect(buf.length).toBeGreaterThan(15_000);
    const parsed = await extrairTextoPdf(buf);
    expect(parsed.text).toContain('Senador Guiomard');
    expect(parsed.text).toMatch(/pH fora da faixa plaus/);
    expect(parsed.text).toMatch(/aguardando laudo/i);
  });
});

// ── Agregações novas do painel ────────────────────────────────────
test.describe('agregações do painel (pura, sem rede)', () => {
  test('aguaRelPorCampanha / aguaRelVariacaoIQA / aguaRelDistribuicaoFaixas / aguaRelIqaPorPonto', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelPorCampanha === 'function');

    const out = await page.evaluate((coletas) => {
      const rel = window.aguaRelMontar(coletas, {});
      const porCampanha = window.aguaRelPorCampanha(rel);
      return {
        porCampanha,
        variacao: window.aguaRelVariacaoIQA(porCampanha),
        dist: window.aguaRelDistribuicaoFaixas(rel.coletas),
        porPonto: window.aguaRelIqaPorPonto(rel),
        ranking: window.aguaRelViolacoesRanking(rel.resumo, 6),
      };
    }, fixtureColetasRioAcre());

    // Uma linha por campanha do recorte, em ordem cronológica.
    expect(out.porCampanha.map(c => c.labelCurto)).toEqual(['2024·1ª', '2024·2ª', '2025·1ª']);
    expect(out.porCampanha[0].nColetas).toBe(2);
    expect(out.porCampanha[0].iqaMedio).toBeCloseTo((78.4 + 82.1) / 2, 4);

    // Variação = duas ÚLTIMAS campanhas com índice (2024·2ª → 2025·1ª).
    expect(out.variacao.delta).toBeCloseTo((12.5 + 74.0) / 2 - 61.2, 4);
    expect(out.variacao.labelAnterior).toBe('2024 · 2ª campanha');

    // Distribuição usa a faixa que veio do banco — nunca derivada aqui.
    expect(out.dist.contagem).toEqual({ Boa: 2, Regular: 1, 'Péssima': 1, 'Ótima': 1 });
    expect(out.dist.semIQA).toBe(0);
    expect(out.dist.predominante).toBe('Boa');

    // Pontos ordenados do melhor IQA médio para o pior; quarentena marcada.
    expect(out.porPonto.map(p => p.nome)).toEqual(['Porto Acre', 'Rio Branco']);
    expect(out.porPonto[1].quarentena).toBe(true);

    // Ranking de violações, do mais frequente para o menos.
    expect(out.ranking[0].n).toBe(1);
    expect(out.ranking.map(v => v.parametro).sort()).toEqual(['od', 'ph', 'turbidez']);
  });

  test('variação é null com menos de duas campanhas com índice — nunca inventa tendência', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelVariacaoIQA === 'function');
    const v = await page.evaluate((coletas) => {
      const rel = window.aguaRelMontar(coletas, {});
      return window.aguaRelVariacaoIQA(window.aguaRelPorCampanha(rel));
    }, fixtureColetasPurusMultiRio()); // 1 campanha só
    expect(v).toBeNull();
  });

  test('aguaRelSerieIQA carrega faixa e status da linha do banco (para o gráfico colorir sem classificar)', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelSerieIQA === 'function');
    const serie = await page.evaluate((coletas) => {
      const rel = window.aguaRelMontar(coletas, {});
      return window.aguaRelSerieIQA(rel.pontos.find(p => p.ponto_id === 'p-rb'), rel.campanhas);
    }, fixtureColetasRioAcre());
    expect(serie[2]).toMatchObject({ iqa: 12.5, faixa: 'Péssima', status: 'quarentena' });
  });
});

// ── Painel renderizado de ponta a ponta ──────────────────────────
// A tela exige sessão Supabase; o cliente é substituído por um stub
// ANTES de qualquer script da página (addInitScript), mesmo padrão de
// tests/permissao-organograma.test.js — aqui aplicado à página real,
// não a um harness, porque o que está sob teste é o render.
const USUARIO_STUB = { id: 'u-teste', nome_completo: 'Técnica de Teste', email: 't@x.invalid', perfil: 'gestor', ativo: true };

async function abrirPainelComStub(page, coletas, opts = {}) {
  // O supabase-js do CDN sobrescreveria window.supabase (o stub abaixo)
  // em máquina com internet, e aí a página tentaria uma sessão de
  // verdade e cairia no redirect para o login. Bloquear o CDN é o que
  // torna o teste igual em máquina online e offline.
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  // Os ladrilhos do OSM não importam para o que estes testes verificam
  // (dado e estrutura, não pixel do mapa) — abortar evita tempo de rede
  // e flakiness. O Leaflet em si (unpkg) continua carregando de
  // verdade: bloqueá-lo quebraria a página inteira ("L is not defined").
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());

  const pontosGeom = opts.pontosGeom || [];

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
          if (tabela === 'minhas_permissoes') return { select: async () => ({ data: [{ chave: 'agua', nivel: 'editar' }] }) };
          if (tabela === 'vw_agua_coletas_detalhe') return { select: () => consulta(coletas.slice()) };
          if (tabela === 'agua_pontos_coleta') return { select: () => consulta(pontosGeom.slice()) };
          return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
        },
      }),
    };
  }, { coletas, usuario: USUARIO_STUB, pontosGeom });

  await page.goto(PAGINA);
  // "Acre todo" é o escopo padrão: o painel carrega sozinho, sem exigir
  // escolha de bacia antes (pedido do usuário) — por isso não há mais
  // um selectOption aqui. `.adash-vazio` cobre o caso do recorte sem
  // nenhuma coleta (também um resultado válido, não um erro).
  await page.waitForSelector('.adash-grid, .adash-vazio', { timeout: 15_000 });
}

test.describe('painel (dashboard) — render com dado real da view', () => {
  test('monta os cards do painel a partir da bacia escolhida', async ({ page }) => {
    await abrirPainelComStub(page, fixtureColetasRioAcre());

    // KPI de IQA médio: (78.4+61.2+12.5+82.1+74.0)/5 = 61.64
    await expect(page.locator('.adash-card-escuro .adash-num')).toHaveText('61.6');
    // Chip de variação vs. campanha anterior existe (3 campanhas na fixture).
    await expect(page.locator('.adash-card-escuro .adash-delta')).toBeVisible();

    // Medidor CONAMA: 2 conformes de 4 avaliadas = 50%.
    await expect(page.locator('.adash-card svg[aria-label*="limite cadastrado"]')).toBeVisible();
    await expect(page.locator('.adash-card svg[aria-label*="limite cadastrado"]')).toContainText('50%');

    // Barras: uma por ponto, com o valor rotulado (média do ponto).
    const barras = page.locator('.adash-barras-plot svg[aria-label^="Barras"]');
    await expect(barras).toBeVisible();
    await expect(barras).toContainText('78.0'); // Porto Acre (82.1 + 74.0)/2
    await expect(barras).toContainText('50.7'); // Rio Branco (78.4+61.2+12.5)/3

    // Ranking de violações e tabela de pontos.
    await expect(page.locator('.adash-lista-linha')).toHaveCount(3); // turbidez, ph, od
    await expect(page.locator('.adash-tabela-linha')).toHaveCount(2);
  });

  test('coleta em quarentena aparece MARCADA, nunca escondida', async ({ page }) => {
    await abrirPainelComStub(page, fixtureColetasRioAcre());

    await expect(page.locator('.adash-aviso')).toContainText('1 coleta(s) deste período em quarentena');
    // O ponto com quarentena continua na tabela, com selo.
    await expect(page.locator('.adash-tabela-linha', { hasText: 'Rio Branco' }).locator('.badge')).toHaveText('quarentena');
    // E a faixa "Péssima" da coleta quarentenada continua contada na distribuição.
    await expect(page.locator('.adash-card', { hasText: 'Distribuição por faixa' })).toContainText('Péssima');
  });

  test('chip de campanha recorta só a EXIBIÇÃO da distribuição, sem mexer no relatório exportado', async ({ page }) => {
    await abrirPainelComStub(page, fixtureColetasRioAcre());
    const cardDist = page.locator('.adash-card', { hasText: 'Distribuição por faixa' });
    const rosca = cardDist.locator('[data-total]');

    await expect(rosca).toHaveAttribute('data-total', '5'); // período inteiro
    await cardDist.getByRole('button', { name: '2024·1ª' }).click();
    await expect(rosca).toHaveAttribute('data-total', '2'); // só a 1ª campanha de 2024

    // O KPI do período (e portanto o que o PDF exporta) NÃO mudou.
    await expect(page.locator('.adash-card-escuro .adash-num')).toHaveText('61.6');
  });

  test('painel de filtros abre pela pílula e o contador reflete os filtros ativos', async ({ page }) => {
    await abrirPainelComStub(page, fixtureColetasRioAcre());

    await expect(page.locator('#rl-filtros')).toBeHidden();
    await page.click('#rl-btn-filtros');
    await expect(page.locator('#rl-filtros')).toBeVisible();

    await expect(page.locator('#rl-filtros-n')).toBeHidden();
    await page.selectOption('#rl-status', 'completo');
    await expect(page.locator('#rl-filtros-n')).toHaveText('1');
    await expect(page.locator('.alert-info')).toContainText('Status: Completo');

    // Exportar continua habilitado enquanto houver coleta no recorte.
    await expect(page.locator('#rl-btn-export')).toBeEnabled();
    await page.selectOption('#rl-iqa-faixa', 'Ótima');
    await page.selectOption('#rl-status', 'quarentena'); // combinação vazia
    await expect(page.locator('#rl-btn-export')).toBeDisabled();
    await expect(page.locator('#rl-conteudo')).toContainText('Nenhuma coleta encontrada');
  });

  test('distribuição por faixa é uma ROSCA (donut), não mais barra — mesmo dado, novo desenho', async ({ page }) => {
    await abrirPainelComStub(page, fixtureColetasRioAcre());
    const cardDist = page.locator('.adash-card', { hasText: 'Distribuição por faixa' });
    await expect(cardDist.locator('svg[aria-label^="Distribuição por faixa do IQA"]')).toBeVisible();
    // A cor nunca carrega o dado sozinha — legenda com rótulo + número
    // continua obrigatória, igual valia para a barra antiga.
    await expect(cardDist).toContainText('Péssima');
    await expect(cardDist).toContainText('Ótima');
  });

  test('"Acre todo" é o escopo padrão — o painel mostra dado sem exigir escolha de bacia', async ({ page }) => {
    await abrirPainelComStub(page, fixtureColetasRioAcre());
    // Nenhum selectOption foi chamado: os dados vieram do carregamento
    // automático no boot. O cabeçalho nasce em "Acre todo".
    await expect(page.locator('#rl-bacia')).toHaveValue('');
    await expect(page.locator('#rl-bacia option:checked')).toContainText('Acre todo');
    await expect(page.locator('.adash-grid')).toBeVisible();
    await expect(page.locator('.adash-card-escuro .adash-num')).toHaveText('61.6');
    await expect(page.locator('#rl-btn-export')).toBeEnabled();
  });

  test('escolher uma bacia no cabeçalho recorta os dados e desabilita o filtro de bacia da gaveta', async ({ page }) => {
    const duasBacias = [...fixtureColetasRioAcre(), ...fixtureColetasPurusMultiRio()];
    await abrirPainelComStub(page, duasBacias);

    // Em "Acre todo", as duas bacias entram — 5 pontos de tabela (2 + 3).
    await expect(page.locator('.adash-tabela-linha')).toHaveCount(5);
    await page.click('#rl-btn-filtros');
    await expect(page.locator('#rl-bacia-filtro')).toBeEnabled();

    await page.selectOption('#rl-bacia', 'Purus');
    await expect(page.locator('.adash-tabela-linha')).toHaveCount(3); // só a bacia Purus
    // Filtrar por bacia de novo na gaveta seria redundante — desabilita.
    await expect(page.locator('#rl-bacia-filtro')).toBeDisabled();
  });

  test('filtro de bacia na gaveta narrows "Acre todo" sem voltar ao cabeçalho', async ({ page }) => {
    const duasBacias = [...fixtureColetasRioAcre(), ...fixtureColetasPurusMultiRio()];
    await abrirPainelComStub(page, duasBacias);

    await page.click('#rl-btn-filtros');
    await expect(page.locator('#rl-bacia-filtro')).toBeEnabled();
    await page.selectOption('#rl-bacia-filtro', 'Purus');

    await expect(page.locator('.adash-tabela-linha')).toHaveCount(3);
    await expect(page.locator('.alert-info')).toContainText('Bacia: Purus');
    await expect(page.locator('#rl-filtros-n')).toHaveText('1');
    // O cabeçalho continua em "Acre todo" — só a gaveta recortou.
    await expect(page.locator('#rl-bacia')).toHaveValue('');

    await page.click('.adash-filtros-limpar');
    await expect(page.locator('.adash-tabela-linha')).toHaveCount(5);
  });

  test('mapa mostra um marcador por ponto do recorte, colorido pela coleta mais recente', async ({ page }) => {
    const pontosGeom = [
      { id: 'p-rb', ativo: true, geom: { type: 'Point', coordinates: [-67.810, -9.975] } },
      { id: 'p-pa', ativo: true, geom: { type: 'Point', coordinates: [-67.550, -9.590] } },
    ];
    await abrirPainelComStub(page, fixtureColetasRioAcre(), { pontosGeom });

    await page.waitForFunction(() => document.querySelectorAll('#rl-mapa .adash-mapa-pin').length >= 2, null, { timeout: 10_000 });
    await expect(page.locator('#rl-mapa .adash-mapa-pin')).toHaveCount(2);
    await expect(page.locator('#rl-mapa-sub')).toContainText('2 pontos no recorte atual');
  });

  test('mapa tem os componentes cartográficos oficiais (rosa dos ventos, escala, legenda, alternância de satélite) — mesmo js/agua-painel.js do painel público', async ({ page }) => {
    const pontosGeom = [{ id: 'p-rb', ativo: true, geom: { type: 'Point', coordinates: [-67.810, -9.975] } }];
    await abrirPainelComStub(page, fixtureColetasRioAcre(), { pontosGeom });
    await page.waitForFunction(() => document.querySelectorAll('#rl-mapa .adash-mapa-pin').length >= 1, null, { timeout: 10_000 });

    await expect(page.locator('.rosa-norte svg')).toBeVisible();
    await expect(page.locator('.leaflet-control-scale')).toBeVisible();
    await expect(page.locator('.adash-mapa-legenda')).toContainText('CONAMA (borda)');
    await expect(page.locator('.adash-mapa-legenda')).toContainText('Camadas de referência');
    await expect(page.locator('.adash-mapa-sat-btn.ativo')).toHaveText('Mapa');
    await page.click('.adash-mapa-sat-btn:has-text("Satélite")');
    await expect(page.locator('.adash-mapa-sat-btn.ativo')).toHaveText('Satélite');
  });

  test('limite do Acre e municípios ficam OCULTOS no mapa de ruas — só aparecem ao trocar pra satélite', async ({ page }) => {
    const pontosGeom = [{ id: 'p-rb', ativo: true, geom: { type: 'Point', coordinates: [-67.810, -9.975] } }];
    await abrirPainelComStub(page, fixtureColetasRioAcre(), { pontosGeom });
    await page.waitForFunction(() => document.querySelectorAll('#rl-mapa .adash-mapa-pin').length >= 1, null, { timeout: 10_000 });
    // Dá tempo dos dois geojson (limite do Acre + municípios) carregarem
    // de fato — eles nascem OCULTOS por padrão (mapa de ruas), então não
    // dá pra esperar por um seletor visível como sinal de "carregou".
    await page.waitForTimeout(1500);

    await expect(page.locator('.adash-mapa-mun-label')).toHaveCount(0);

    await page.click('.adash-mapa-sat-btn:has-text("Satélite")');
    // Limite do Acre e polígonos de municípios são desenhados como
    // path SVG do Leaflet (fill:false/quase transparente, então não
    // contam como marcador) — junto do rótulo permanente com o nome.
    await page.waitForFunction(() => document.querySelectorAll('.adash-mapa-mun-label').length > 0, null, { timeout: 10_000 });
    await expect(page.locator('.adash-mapa-mun-label').first()).toBeVisible();

    // Volta pro mapa de ruas — as camadas de referência somem de novo.
    await page.click('.adash-mapa-sat-btn:has-text("Mapa")');
    await expect(page.locator('.adash-mapa-mun-label')).toHaveCount(0);
    // Hidrografia (WMS do IBGE) é verificada à parte, fora da suíte
    // automatizada (stub de L, mesma técnica dos outros componentes
    // cartográficos) — pedir a tile de verdade aqui dependeria de rede
    // externa que este sandbox de testes já bloqueia.
  });

  test('painel "Configurar camadas": trocar cor/espessura atualiza o mapa e a legenda; desmarcar nomes esconde os rótulos', async ({ page }) => {
    const pontosGeom = [{ id: 'p-rb', ativo: true, geom: { type: 'Point', coordinates: [-67.810, -9.975] } }];
    await abrirPainelComStub(page, fixtureColetasRioAcre(), { pontosGeom });
    // As delimitações só aparecem na visão satélite.
    await page.click('.adash-mapa-sat-btn:has-text("Satélite")');
    await page.waitForFunction(() => document.querySelectorAll('.adash-mapa-mun-label').length > 0, null, { timeout: 10_000 });

    await page.click('.adash-mapa-config-btn');
    await expect(page.locator('.adash-mapa-config-painel')).toBeVisible();

    // input[type=color] não é preenchível por .fill() (Playwright recusa
    // — não tem teclado nativo) — seta o valor e dispara o evento à mão.
    await page.locator('.amcfg-mun-cor').evaluate(el => { el.value = '#ff00aa'; el.dispatchEvent(new Event('input', { bubbles: true })) })
    // A cor entra no atributo style de um chip, não em texto visível —
    // toContainText não enxerga isso, por isso lê o innerHTML direto.
    await expect.poll(() => page.locator('.adash-mapa-legenda').innerHTML()).toContain('#ff00aa');

    await page.uncheck('.amcfg-mun-nomes');
    await expect(page.locator('.adash-mapa-mun-label').first()).toBeHidden();

    // Persiste por navegador — recarregar a página mantém a preferência.
    await page.reload();
    await page.waitForFunction(() => typeof window.aguaRelMontar === 'function');
  });

  test('mapa não quebra quando um ponto não tem coordenada cadastrada — fica de fora, sem travar os outros', async ({ page }) => {
    // Só o Rio Branco tem geom; Porto Acre não — a regra é "sem geom não
    // desenha", nunca "sem geom quebra o mapa inteiro".
    const pontosGeom = [{ id: 'p-rb', ativo: true, geom: { type: 'Point', coordinates: [-67.810, -9.975] } }];
    await abrirPainelComStub(page, fixtureColetasRioAcre(), { pontosGeom });

    await page.waitForFunction(() => document.querySelectorAll('#rl-mapa .adash-mapa-pin').length >= 1, null, { timeout: 10_000 });
    await expect(page.locator('#rl-mapa .adash-mapa-pin')).toHaveCount(1);
    // O resto do painel (que não depende de geom) segue normal.
    await expect(page.locator('.adash-card-escuro .adash-num')).toHaveText('61.6');
  });

  test('clicar num pino abre o detalhe da coleta mais recente, com opção de exportar só esse ponto', async ({ page }) => {
    const pontosGeom = [{ id: 'p-rb', ativo: true, geom: { type: 'Point', coordinates: [-67.810, -9.975] } }];
    await abrirPainelComStub(page, fixtureColetasRioAcre(), { pontosGeom });

    await page.waitForFunction(() => document.querySelectorAll('#rl-mapa .adash-mapa-pin').length >= 1, null, { timeout: 10_000 });
    await page.click('#rl-mapa .adash-mapa-pin');

    await expect(page.locator('#adet-modal')).toHaveClass(/aberto/);
    await expect(page.locator('#adet-modal .modal-title')).toContainText('Rio Branco');
    await expect(page.locator('#adet-modal .adet-card-tit')).toContainText(['IQA', 'CONAMA']);
    // Fixture não traz os ~21 parâmetros brutos (só IQA/CONAMA já
    // calculados) — o popup mostra a mensagem de "aguardando laudo",
    // nunca uma lista vazia sem explicação.
    await expect(page.locator('#adet-modal .adet-hint').last()).toContainText('aguardando laudo');
    await expect(page.locator('#adet-btn-exportar')).toBeVisible();

    await page.click('#adet-modal .modal-close');
    await expect(page.locator('#adet-modal')).not.toHaveClass(/aberto/);
  });
});

// ══════════════════════════════════════════════════════════════════
// MODO "Comparar bacias" — fundido do antigo tests/rh-bacias.test.js
// quando pages/rh-bacias.html virou um MODO desta mesma tela (pedido
// do usuário: painel e comparativo são só duas formas de olhar o
// mesmo relatório, sem razão pra viver em páginas separadas).
//
// O QUE ESTE BLOCO TRAVA (herdado do arquivo antigo): não existe
// polígono de bacia no sistema — a divisão vem do campo de texto
// `agua_pontos_coleta.bacia`, e o aviso do topo precisa dizer isso na
// cara do usuário. Além disso: (1) a comparação ENTRE bacias é a razão
// de existir do modo — escolher uma bacia destaca, mas NUNCA esconde
// as outras da tabela; (2) IQA médio de bacia é número, nunca faixa;
// (3) coleta em quarentena entra marcada, nunca escondida. E, NOVO
// nesta fusão: o segmented control troca de modo sem recarregar a
// página, e cada modo só é acessível a quem tem o módulo
// correspondente ('agua' e/ou 'bacias').
// ══════════════════════════════════════════════════════════════════

function fixtureColetasComparativoBacias() {
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

const PONTOS_GEOM_COMPARATIVO = [
  { id: 'p-rb', geom: { type: 'Point', coordinates: [-67.81, -9.97] }, ativo: true },
  { id: 'p-sm', geom: { type: 'Point', coordinates: [-68.66, -9.06] }, ativo: true },
  { id: 'p-cz', geom: { type: 'Point', coordinates: [-72.75, -7.63] }, ativo: true },
  { id: 'p-iq', geom: { type: 'Point', coordinates: [-67.20, -9.60] }, ativo: true },
];

// `niveis` deixa cada teste simular acesso só a 'agua', só a 'bacias'
// ou aos dois — o merge introduziu essa dimensão nova (antes eram duas
// páginas com um `nivel_efetivo` cada, sempre 'editar' no stub).
async function abrirPaginaComparar(page, { coletas = fixtureColetasComparativoBacias(), pontosGeom = PONTOS_GEOM_COMPARATIVO, niveis = { agua: 'editar', bacias: 'editar' }, visao = 'bacias' } = {}) {
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.js', route =>
    route.fulfill({ path: path.join(__dirname, 'fixtures/vendor/leaflet.js'), contentType: 'application/javascript' }));
  await page.route('**/unpkg.com/leaflet@1.9.4/dist/leaflet.css', route =>
    route.fulfill({ path: path.join(__dirname, 'fixtures/vendor/leaflet.css'), contentType: 'text/css' }));

  await page.addInitScript(({ coletas, usuario, pontosGeom, niveis }) => {
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
        rpc: async (nome, args) => {
          if (nome === 'nivel_efetivo') return { data: niveis[args?.p_modulo_chave] ?? 'sem_acesso' };
          return { data: null };
        },
        from: (tabela) => {
          if (tabela === 'usuarios') return { select: () => ({ eq: () => ({ single: async () => ({ data: usuario }) }) }) };
          if (tabela === 'minhas_permissoes') return { select: async () => ({ data: Object.entries(niveis).map(([chave, nivel]) => ({ chave, nivel })) }) };
          if (tabela === 'vw_agua_coletas_detalhe') return { select: () => consulta(coletas.slice()) };
          if (tabela === 'agua_pontos_coleta') return { select: () => consulta(pontosGeom.slice()) };
          return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
        },
      }),
    };
  }, { coletas, usuario: USUARIO_STUB, pontosGeom, niveis });

  await page.goto(visao ? `${PAGINA}?visao=${visao}` : PAGINA);
  // Três desfechos possíveis: o modo Comparar renderizou, o modo Painel
  // renderizou, ou nenhum módulo libera acesso e `document.body.innerHTML`
  // é substituído pela mensagem de bloqueio (remove #app inteiro — por
  // isso não dá pra esperar só "#app tem filhos", que já é verdade no
  // HTML estático antes de qualquer script rodar).
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return (app && app.children.length > 0) || !app;
  }, null, { timeout: 15_000 });
}

test.describe('aguaRelPorBacia — comparativo entre bacias (agregação, pura)', () => {
  test('uma linha por bacia, com pontos/coletas/IQA/conformidade, e "sem bacia" por último', async ({ page }) => {
    await page.goto(PAGINA);
    await page.waitForFunction(() => typeof window.aguaRelPorBacia === 'function');

    const bacias = await page.evaluate((coletas) => window.aguaRelPorBacia(coletas), fixtureColetasComparativoBacias());

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

    const serie = await page.evaluate((coletas) => window.aguaRelSerieBacia(coletas, 'Purus'), fixtureColetasComparativoBacias());
    expect(serie).toHaveLength(2);
    expect(serie[0]).toMatchObject({ label: '2024·1ª', iqa: 70, faixa: null, status: 'completo' });   // (80+60)/2
    expect(serie[1]).toMatchObject({ label: '2024·2ª', iqa: 40, faixa: null, status: 'quarentena' }); // só a quarentenada
  });
});

test.describe('modo Comparar bacias — render de ponta a ponta', () => {
  test('?visao=bacias abre a página direto no modo Comparar, com o segmented control marcado', async ({ page }) => {
    await abrirPaginaComparar(page);

    await expect(page.locator('#bloco-comparar')).toBeVisible();
    await expect(page.locator('#bloco-painel')).toBeHidden();
    await expect(page.locator('.adash-modo-btn[data-modo="comparar"]')).toHaveClass(/ativo/);

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
    await abrirPaginaComparar(page);

    const aviso = page.locator('.rhb-aviso');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('ainda vem do cadastro do ponto, não de um polígono oficial');
    await expect(aviso).toContainText('ottobacias da ANA');
  });

  test('escolher uma bacia destaca e recorta o MAPA, mas nunca some com as outras da comparação', async ({ page }) => {
    await abrirPaginaComparar(page);

    await expect(page.locator('#rhb-mapa .adash-mapa-pin')).toHaveCount(4);

    await page.locator('.rhb-bacia-card', { hasText: 'Juruá' }).click();
    await expect(page.locator('.rhb-bacia-card.ativo')).toContainText('Juruá');
    await expect(page.locator('#rhb-mapa .adash-mapa-pin')).toHaveCount(1); // só Cruzeiro do Sul
    // A comparação continua inteira — é a razão de existir do modo.
    await expect(page.locator('.rhb-tab tbody tr')).toHaveCount(3);
    await expect(page.locator('.rhb-bacia-card')).toHaveCount(3);

    // Clicar de novo volta ao Acre inteiro.
    await page.locator('.rhb-bacia-card', { hasText: 'Juruá' }).click();
    await expect(page.locator('.rhb-bacia-card.ativo')).toHaveCount(0);
    await expect(page.locator('#rhb-mapa .adash-mapa-pin')).toHaveCount(4);
  });

  test('rede hidrográfica e limites ficam visíveis também no mapa de RUAS (referenciaSempre) — diferente do modo Painel', async ({ page }) => {
    await abrirPaginaComparar(page);

    // Rótulo de município aparece sem precisar trocar para satélite.
    await expect(page.locator('#bloco-comparar .adash-mapa-mun-label').first()).toBeVisible({ timeout: 10_000 });
    // E a legenda não promete "só satélite" neste modo.
    const legenda = page.locator('#bloco-comparar .adash-mapa-legenda');
    await expect(legenda).toContainText('Camadas de referência');
    await expect(legenda).not.toContainText('só satélite');
  });

  test('IQA médio por bacia sai como NÚMERO, nunca como faixa classificada', async ({ page }) => {
    await abrirPaginaComparar(page);

    const barras = page.locator('#bloco-comparar svg[aria-label^="Barras"]');
    await expect(barras).toBeVisible();
    await expect(barras).toContainText('60.0'); // Purus
    await expect(barras).toContainText('70.0'); // Juruá
    // Nenhum rótulo de faixa colado na média (a faixa só existe por coleta).
    await expect(barras).not.toContainText('Ótima');
    await expect(barras).not.toContainText('Regular');
  });

  test('violações CONAMA aparecem por bacia; bacia sem limites cadastrados não vira "conforme"', async ({ page }) => {
    await abrirPaginaComparar(page);

    const card = page.locator('#bloco-comparar .adash-card', { hasText: 'Parâmetros fora do limite CONAMA' });
    await expect(card.locator('.adash-lista-linha', { hasText: 'Purus' })).toContainText('Turbidez (2)');
    await expect(card.locator('.adash-lista-linha', { hasText: 'Juruá' })).toContainText('Nenhuma violação');
    // Sem bacia definida: 1 coleta, sem limites → nem conforme nem violação.
    await expect(page.locator('.rhb-tab tbody tr', { hasText: 'Sem bacia definida' })).toContainText('—');
  });

  test('sem coleta nenhuma, o modo diz isso — nunca quebra', async ({ page }) => {
    await abrirPaginaComparar(page, { coletas: [] });
    await expect(page.locator('#rhb-conteudo .adash-vazio')).toContainText('Nenhuma coleta cadastrada');
  });
});

test.describe('alternância entre modos e acesso por módulo', () => {
  test('com os dois módulos liberados, o segmented control aparece e troca de modo sem recarregar', async ({ page }) => {
    await abrirPaginaComparar(page); // abre em Comparar (?visao=bacias)
    await expect(page.locator('#modo-tabs')).toBeVisible();

    await page.click('.adash-modo-btn[data-modo="painel"]');
    await expect(page.locator('#bloco-painel')).toBeVisible();
    await expect(page.locator('#bloco-comparar')).toBeHidden();
    await expect(page.locator('.adash-modo-btn[data-modo="painel"]')).toHaveClass(/ativo/);
    // O painel carrega de verdade ao ser aberto pela 1ª vez (lazy init).
    await expect(page.locator('.adash-titulo')).toContainText('Painel da Qualidade da Água');

    await page.click('.adash-modo-btn[data-modo="comparar"]');
    await expect(page.locator('#bloco-comparar')).toBeVisible();
    // Voltar ao modo Comparar não perde o estado (sem recarregar dado).
    await expect(page.locator('.rhb-bacia-card')).toHaveCount(3);
  });

  test('só com acesso a "bacias" (sem "agua"), a página abre direto no modo Comparar e sem o segmented control', async ({ page }) => {
    await abrirPaginaComparar(page, { niveis: { agua: 'sem_acesso', bacias: 'editar' }, visao: null });

    await expect(page.locator('#modo-tabs')).toBeHidden();
    await expect(page.locator('#bloco-comparar')).toBeVisible();
    await expect(page.locator('#bloco-painel')).toBeHidden();
  });

  test('só com acesso a "agua" (sem "bacias"), ?visao=bacias é ignorado e a página abre no modo Painel', async ({ page }) => {
    await abrirPaginaComparar(page, { niveis: { agua: 'editar', bacias: 'sem_acesso' }, visao: 'bacias' });

    await expect(page.locator('#modo-tabs')).toBeHidden();
    await expect(page.locator('#bloco-painel')).toBeVisible();
    await expect(page.locator('#bloco-comparar')).toBeHidden();
  });

  test('sem acesso a nenhum dos dois módulos, a página barra com uma mensagem só', async ({ page }) => {
    await abrirPaginaComparar(page, { niveis: { agua: 'sem_acesso', bacias: 'sem_acesso' } });
    await expect(page.locator('body')).toContainText('Você não tem acesso a este painel');
  });
});
