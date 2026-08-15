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
const { PDFParse } = require('pdf-parse');
const JSZip = require('jszip');

// pdf-parse v2: API por classe (getInfo/getText), não a função v1.
async function extrairTextoPdf(buf) {
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
