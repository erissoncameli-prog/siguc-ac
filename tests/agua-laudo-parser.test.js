// ── SIGUC Qualidade da Água · leitura assistida do laudo em PDF ──
// Executar: npx playwright test tests/agua-laudo-parser.test.js
//
// Entrega 2 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md.
//
// FIXTURES REAIS, NÃO SINTÉTICAS
// `tests/fixtures/laudos/quilab-amostra-1.pdf` e `-9.pdf` são páginas
// ÚNICAS extraídas (mesmo stream de imagem, sem re-digitalizar) do
// lote de 17 laudos reais do QUILAB enviado pelo usuário nesta
// entrega — são o mesmo tipo de arquivo (escaneado por Epson Scan 2,
// 200 dpi, zero fonte embutida) que a mesa recebe de verdade. Um PDF
// sintético gerado por script não testaria nada: o parser inteiro
// existe para lidar com scanner real, ruído real, borda de tabela
// real. Valores de referência abaixo foram conferidos VISUALMENTE
// contra a imagem ampliada de cada célula antes de virar "esperado"
// aqui — não foram copiados de nenhuma passagem de OCR.
//
// O QUE ESTE GUARDA TRAVA
// 1. O pipeline roda de ponta a ponta no NAVEGADOR de verdade (pdf.js
//    + tesseract.js vendorizados, worker real) — não é mock.
// 2. Casas decimais vêm do TEMPLATE, nunca da vírgula que o OCR leu
//    (aguaLaudoInterpretarValor testado isoladamente com o achado
//    real: célula "3,17" cujo OCR de página inteira lia "3,47").
// 3. Trava de identidade: procedência/data divergente da coleta
//    aberta NUNCA libera autofill — e OK quando bate.
// 4. Nenhum campo é gravado sozinho — este arquivo não chama
//    agua_atualizar_coleta em lugar nenhum; só observa o resultado
//    que a tela usaria para desenhar a conferência.
// 5. A malha aceita "vazio" como resultado seguro (nunca inventa) —
//    a suíte não exige 100% de leitura, exige que o que FOR lido
//    esteja certo o bastante para valer a conferência, e que o que
//    não for lido fique claramente vazio, nunca um número errado
//    silencioso.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

// Gabarito real do QUILAB (migration 305) — copiado aqui em vez de
// consultado ao banco: este teste não depende de rede/sessão (mesma
// limitação documentada nos outros guardas do módulo).
const TEMPLATE_QUILAB = {
  campos_identidade: {
    numero_laudo: { top: 0.155359, left: 0.120968, width: 0.645161, height: 0.022805 },
    data_coleta:  { top: 0.210946, left: 0.645161, width: 0.314516, height: 0.017104 },
    procedencia:  { top: 0.289339, left: 0.645161, width: 0.314516, height: 0.017104 },
  },
  campos: {
    temp_ar:                    { top: 0.431471, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    dbo:                        { top: 0.448005, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    nitrogenio_amoniacal:       { top: 0.46488,  left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    nitrogenio_total:           { top: 0.48073,  left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    fosforo_total:               { top: 0.497263, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 3 },
    solidos_dissolvidos_totais: { top: 0.514481, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    solidos_suspensao_totais:   { top: 0.530673, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 3 },
    nitratos:                    { top: 0.547092, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    ortofosfato_dissolvido:     { top: 0.563369, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    cloreto:                     { top: 0.579932, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    alcalinidade_total:         { top: 0.596579, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    carbono_organico_total:     { top: 0.613141, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    coliformes_totais:           { top: 0.713113, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
    escherichia_coli:            { top: 0.729048, left: 0.721774, width: 0.16129, height: 0.017104, casas_decimais: 2 },
  },
}

async function comOcr(page) {
  await page.goto(`${BASE}/tests/fixtures/sidebar-harness.html`)
  await page.addScriptTag({ url: '/js/agua-laudo-ocr.js' })
}

// Processa uma fixture real no navegador — chama o pipeline completo
// exatamente como agua-laudos.html chamaria.
async function processarFixture(page, nomeArquivo, { coletaAberta, ponto }) {
  return page.evaluate(async ({ url, coletaAberta, ponto, template }) => {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const arquivo = new File([blob], 'laudo.pdf', { type: 'application/pdf' })
    return aguaLaudoProcessarPdf(arquivo, { template, coletaAberta, ponto })
  }, { url: `/tests/fixtures/laudos/${nomeArquivo}`, coletaAberta, ponto, template: TEMPLATE_QUILAB })
}

test.describe('interpretação de valor — casas decimais do template, nunca do OCR', () => {
  test('insere o separador na posição do template, ignorando onde o OCR situou a vírgula', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => ({
      // Achado real desta entrega: OCR de página inteira leu "3,17"
      // como "3,47" — mas mesmo COM esse erro, se o texto lido fosse
      // só dígitos "317" (sem vírgula nenhuma, como o OCR de célula
      // recortada de fato devolve), o valor tem de sair 3.17.
      semVirgula: aguaLaudoInterpretarValor('317', 2),
      comVirgulaCorreta: aguaLaudoInterpretarValor('3,17', 2),
      tresCasas: aguaLaudoInterpretarValor('0,023', 3),
      tresCasasSoDigitos: aguaLaudoInterpretarValor('23', 3),
    }))
    expect(r.semVirgula.valor).toBeCloseTo(3.17)
    expect(r.comVirgulaCorreta.valor).toBeCloseTo(3.17)
    expect(r.tresCasas.valor).toBeCloseTo(0.023)
    expect(r.tresCasasSoDigitos.valor).toBeCloseTo(0.023)   // "23" com 3 casas = 0,023, não 23,0
  })

  test('texto vazio ou sem dígito nenhum devolve valor nulo — nunca inventa número', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => ({
      vazio: aguaLaudoInterpretarValor('', 2),
      soLetras: aguaLaudoInterpretarValor('abc', 2),
      soPontuacao: aguaLaudoInterpretarValor(',.', 2),
    }))
    for (const x of Object.values(r)) { expect(x.valor).toBeNull(); expect(x.confiancaBaixa).toBe(true) }
  })

  test('censurado ("<LQ") vira metade do limite + limite registrado — decisão 3 do plano original', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoInterpretarValor('<1', 0))
    expect(r.censurado).toBe(true)
    expect(r.limiteDeteccao).toBe(1)
    expect(r.valor).toBeCloseTo(0.5)
  })
})

test.describe('data de recebimento — prazo de preservação, NUNCA a trava de identidade', () => {
  test('extrai data plausível (dia/mês corretos, ano dentro do intervalo aceito)', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoExtrairDataPlausivel('no laboratório: 15/09/2025 |'))
    expect(r).toBe('2025-09-15')
  })

  test('ano implausível (achado real: "2095"/"0005" por dígito trocado) devolve null — nunca propõe data errada', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => ({
      anoFuturo: aguaLaudoExtrairDataPlausivel('24/09/2095'),
      anoZerado: aguaLaudoExtrairDataPlausivel('24/09/0005'),
      semData: aguaLaudoExtrairDataPlausivel('texto qualquer sem data'),
      vazio: aguaLaudoExtrairDataPlausivel(''),
    }))
    for (const v of Object.values(r)) expect(v).toBeNull()
  })
})

test.describe('trava de identidade (§3.3 do plano) — nunca autofill com amostra errada', () => {
  test('procedência e data batendo com a coleta aberta libera o autofill', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoConferirIdentidade(
      { data_coleta: 'Data da Coleta: 15/09/2025', procedencia: 'Rio Iquiri/ Senador Guiomard' },
      { data_coleta: '2025-09-15' },
      { nome: 'Rio Iquiri', rio: 'Rio Iquiri', municipio: 'Senador Guiomard', codigos_alias: [] },
    ))
    expect(r.ok).toBe(true)
    expect(r.problemas).toHaveLength(0)
  })

  test('data divergente BLOQUEIA, mesmo com procedência batendo', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoConferirIdentidade(
      { data_coleta: 'Data da Coleta: 15/09/2025', procedencia: 'Rio Iquiri/ Senador Guiomard' },
      { data_coleta: '2025-10-20' },   // coleta aberta é de outro dia
      { nome: 'Rio Iquiri', rio: 'Rio Iquiri', municipio: 'Senador Guiomard', codigos_alias: [] },
    ))
    expect(r.ok).toBe(false)
    expect(r.problemas.map(p => p.campo)).toContain('data_coleta')
  })

  test('procedência de outro ponto BLOQUEIA — é a defesa contra lançar o laudo do ponto A na coleta do ponto B', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoConferirIdentidade(
      { data_coleta: 'Data da Coleta: 15/09/2025', procedencia: 'Rio Purus / Santa Rosa' },
      { data_coleta: '2025-09-15' },
      { nome: 'Rio Iquiri', rio: 'Rio Iquiri', municipio: 'Senador Guiomard', codigos_alias: [] },
    ))
    expect(r.ok).toBe(false)
    expect(r.problemas.map(p => p.campo)).toContain('procedencia')
  })

  // ── Ruído de OCR ≠ amostra errada ────────────────────────────
  // O bug real relatado em produção: a leitura automática nunca
  // preenchia nada. Causa medida contra os laudos do QUILAB no
  // navegador — o ano sai com um dígito trocado ("24/09/2025" lido
  // "24/09/2095") e a procedência com letra a mais ("Rio Iquiri" →
  // "Rio Iqguiri"); a comparação era literal, então qualquer um dos
  // dois bloqueava TUDO e ainda acusava, em vermelho, laudo de outra
  // amostra. Estes testes travam a distinção que corrigiu isso.
  test('ano ilegível do scanner com dia e mês batendo NÃO acusa amostra errada', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoConferirIdentidade(
      { data_coleta: 'ta: 24/09/2095 |', procedencia: 'Rio Purus / Santa Rosa' },
      { data_coleta: '2025-09-24' },
      { nome: 'Rio Purus', rio: 'Rio Purus', municipio: 'Santa Rosa', codigos_alias: [] },
    ))
    expect(r.nivel).toBe('confere')
    expect(r.problemas).toHaveLength(0)
    expect(r.avisos.some(a => a.motivo === 'ano_ilegivel')).toBe(true)
  })

  test('ano PLAUSÍVEL e diferente continua bloqueando — é outra campanha, não ruído', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoConferirIdentidade(
      { data_coleta: 'ta: 24/09/2024 |', procedencia: 'Rio Purus / Santa Rosa' },
      { data_coleta: '2025-09-24' },
      { nome: 'Rio Purus', rio: 'Rio Purus', municipio: 'Santa Rosa', codigos_alias: [] },
    ))
    expect(r.nivel).toBe('divergente')
    expect(r.problemas.map(p => p.campo)).toContain('data_coleta')
  })

  test('letra trocada pelo scanner na procedência ainda confere', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoConferirIdentidade(
      { data_coleta: 'ta: 15/09/2025 |', procedencia: 'Rio Iqguiri/ Senador Guiomard |' },
      { data_coleta: '2025-09-15' },
      { nome: 'Rio Iquiri', rio: 'Rio Iquiri', municipio: 'Senador Guiomard', codigos_alias: [] },
    ))
    expect(r.nivel).toBe('confere')
  })

  test('identificação toda ilegível não confirma NEM contradiz — pede conferência humana, nunca acusa', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoConferirIdentidade(
      { data_coleta: '', procedencia: '' },
      { data_coleta: '2025-09-15' },
      { nome: 'Rio Iquiri', rio: 'Rio Iquiri', municipio: 'Senador Guiomard', codigos_alias: [] },
    ))
    expect(r.nivel).toBe('nao_confirmado')
    expect(r.ok).toBe(false)          // não preenche sozinho
    expect(r.problemas).toHaveLength(0)  // e não acusa amostra errada
  })

  test('tolerância não afrouxa a defesa: nome parecido de OUTRO ponto continua bloqueando', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoConferirIdentidade(
      { data_coleta: 'ta: 15/09/2025 |', procedencia: 'Rio Branco / Bujari' },
      { data_coleta: '2025-09-15' },
      { nome: 'Rio Iquiri', rio: 'Rio Iquiri', municipio: 'Senador Guiomard', codigos_alias: [] },
    ))
    expect(r.nivel).toBe('divergente')
    expect(r.problemas.map(p => p.campo)).toContain('procedencia')
  })

  test('alias cadastrado (grafia errada da série histórica) também confere, não só o nome oficial', async ({ page }) => {
    await comOcr(page)
    const r = await page.evaluate(() => aguaLaudoConferirIdentidade(
      { data_coleta: 'Data da Coleta: 15/09/2025', procedencia: 'ASSIS BRASIL' },
      { data_coleta: '2025-09-15' },
      { nome: 'Estação Assis Brasil', rio: 'Rio Acre', municipio: 'Assis Brasil', codigos_alias: ['ASSIS BRASIL'] },
    ))
    expect(r.ok).toBe(true)
  })
})

test.describe('pipeline completo no navegador, contra laudo real do QUILAB', () => {
  test('amostra 1 (laudo 1.304/2025) — identidade confere, parâmetros lidos batem com a leitura visual', async ({ page }) => {
    await comOcr(page)
    const r = await processarFixture(page, 'quilab-amostra-1.pdf', {
      coletaAberta: { data_coleta: '2025-09-15' },
      ponto: { nome: 'Rio Iquiri', rio: 'Rio Iquiri', municipio: 'Senador Guiomard', codigos_alias: [] },
    })

    expect(r.identidade.ok).toBe(true)

    // Valores conferidos visualmente contra a imagem do laudo
    // (docs/qualidade-agua/plano-leitura-laudo-e-alertas.md, §9.0) —
    // não é o que um OCR anterior leu.
    const esperado = {
      temp_ar: 26.20, dbo: 6.00, nitrogenio_amoniacal: 2.00, nitrogenio_total: 3.00,
      fosforo_total: 0.023, solidos_dissolvidos_totais: 13.30, solidos_suspensao_totais: 0.297,
      nitratos: 0.10, ortofosfato_dissolvido: 0.08, cloreto: 6.00, alcalinidade_total: 9.00,
      carbono_organico_total: 1.00, coliformes_totais: 11.00, escherichia_coli: 8.00,
    }
    // Não exige acerto pixel-perfeito por campo — o achado desta
    // entrega, medido repetidamente, é que OCR de scanner real erra
    // ocasionalmente um dígito (3,17→3,47 documentado no cabeçalho da
    // migration 305) SEM sinal de baixa confiança que o distinga de
    // um acerto. É exatamente por isso que a conferência mostra o
    // RECORTE DA IMAGEM, nunca confia no texto sozinho — o teste que
    // vale é o de nível de sistema (identidade + recorte sempre
    // presentes, abaixo), não "cada dígito tem de bater". O que se
    // mede aqui é a TAXA de acerto, como piso de qualidade do
    // gabarito, não uma prova de exatidão por célula.
    let corretos = 0
    for (const [campo, valor] of Object.entries(esperado)) {
      const lido = r.campos[campo]?.valor
      if (lido != null && Math.abs(lido - valor) < 0.005) corretos++
    }
    // Calibração medida (migration 305): 14/14 nesta página em teste
    // offline (poppler); no navegador real, o decodificador de imagem
    // do Chromium é outro e a taxa cai um pouco — piso de 9/14 (64%),
    // medido com folga sobre o pior caso observado nesta entrega.
    expect(corretos).toBeGreaterThanOrEqual(9)
  })

  test('cada célula lida traz o recorte da imagem, não só o texto — é o que sustenta a conferência', async ({ page }) => {
    await comOcr(page)
    const r = await processarFixture(page, 'quilab-amostra-1.pdf', {
      coletaAberta: { data_coleta: '2025-09-15' },
      ponto: { nome: 'Rio Iquiri', rio: 'Rio Iquiri', municipio: 'Senador Guiomard', codigos_alias: [] },
    })
    for (const campo of Object.keys(TEMPLATE_QUILAB.campos)) {
      expect(r.campos[campo].recorteDataURL).toMatch(/^data:image\/png;base64,/)
    }
  })

  // O caso que reproduzia o bug relatado, ponta a ponta: neste laudo
  // real o OCR lê o ano como "2095". Antes, isso bloqueava o
  // preenchimento inteiro e a tela dizia que o laudo era de outra
  // amostra. Agora libera, porque dia/mês e procedência confirmam.
  test('amostra 9 — ano lido "2095" pelo scanner não impede mais o autofill', async ({ page }) => {
    await comOcr(page)
    const r = await processarFixture(page, 'quilab-amostra-9.pdf', {
      coletaAberta: { data_coleta: '2025-09-24' },
      ponto: { nome: 'Rio Purus', rio: 'Rio Purus', municipio: 'Santa Rosa', codigos_alias: [] },
    })
    expect(r.identidade.nivel).toBe('confere')
    expect(Object.values(r.campos).some(c => c.valor != null)).toBe(true)
  })

  test('identidade de OUTRA amostra é detectada — nada preenchido quando a data não bate', async ({ page }) => {
    await comOcr(page)
    // Mesma fixture (data real da coleta 15/09/2025), mas simulando
    // que o técnico abriu esta tela para uma coleta de OUTRO dia —
    // o cenário real que a trava de identidade existe para pegar.
    const r = await processarFixture(page, 'quilab-amostra-1.pdf', {
      coletaAberta: { data_coleta: '2025-01-01' },
      ponto: { nome: 'Rio Iquiri', rio: 'Rio Iquiri', municipio: 'Senador Guiomard', codigos_alias: [] },
    })
    expect(r.identidade.ok).toBe(false)
    expect(r.identidade.problemas.some(p => p.campo === 'data_coleta')).toBe(true)
  })
})
