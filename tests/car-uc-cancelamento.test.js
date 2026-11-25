// ── SIGUC · CAR na UC → pedido ao IMAC (migration 368) ──────────────
// Executar: npx playwright test tests/car-uc-cancelamento.test.js
//
// O QUE ESTE GUARDA TRAVA
// 1. Nunca pedir cancelamento para tudo: a regra (carucDossieTipo) muda
//    com a categoria da UC, o tipo do imóvel e o % dentro da UC — APA/
//    ARIE não geram pedido, PCT em RESEX é o cadastro esperado, CAR já
//    cancelado e imóvel só na ZA também não.
// 2. Os 3 modelos jurídicos da migration, preenchidos, não deixam
//    nenhum {{campo}} cru no texto.
// 3. O dossiê NÃO leva nome nem CPF/CNPJ do titular (nem o snapshot
//    gravado, nem o PDF); leva o nº do CAR, a área e o % na UC, o
//    dispositivo do SNUC da categoria e o aviso de MINUTA.
// 4. O hash gravado é o SHA-256 do PDF que foi baixado.
// 5. "Quantos CARs por situação e por data": quadro ano × status.
// 6. A aba "Solicitações ao IMAC" lista, atualiza e mostra os modelos.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });

const caruc = require('../js/car-uc-relatorio.js');
global.carucEnquadrarCategoria = caruc.carucEnquadrarCategoria;
global.carucNorm = caruc.carucNorm;
global.carucTipoImovel = caruc.carucTipoImovel;
global.carucEmbargosVigentes = caruc.carucEmbargosVigentes;
global.carucEmbargoRotulo = caruc.carucEmbargoRotulo;
const cd = require('../js/car-uc-cancelamento.js');

// Os textos REAIS da migration (blocos $t$…$t$).
const MIG = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '368_car_solicitacoes_imac.sql'), 'utf8');
const MODELOS = [...MIG.matchAll(/\('([a-z_]+)', 1, '([^']+)',\n\$t\$([\s\S]*?)\$t\$\)/g)].map(m => ({ chave: m[1], titulo: m[2], texto: m[3] }));

const im = (o) => ({ local: 'uc', status: 'Ativo', situacao: 'Aguardando análise', tipo_imovel: 'IRU', area_analise_ha: 50, pct_analise: 100, ...o });

test('regra do pedido: categoria, tipo de imóvel e % na UC decidem', () => {
  const esec = { sigla: 'ESEC', grupo: 'protecao_integral' }
  const resex = { sigla: 'RESEX', grupo: 'uso_sustentavel' }
  const apa = { sigla: 'APA', grupo: 'uso_sustentavel' }
  expect(cd.carucDossieTipo(im({ pct_analise: 98 }), esec).tipo).toBe('cancelamento')
  expect(cd.carucDossieTipo(im({ pct_analise: 60 }), esec).tipo).toBe('retificacao_perimetro')
  expect(cd.carucDossieTipo(im({ pct_analise: 4 }), esec).tipo).toBe('retificacao_perimetro')      // borda = divisa
  expect(cd.carucDossieTipo(im({ pct_analise: 80 }), resex).tipo).toBe('retificacao_uso_sustentavel')
  expect(cd.carucDossieTipo(im({ pct_analise: 30 }), resex).tipo).toBe('retificacao_perimetro')
  expect(cd.carucDossieTipo(im({ tipo_imovel: 'PCT' }), resex).permitido).toBe(false)              // PCT é o esperado
  expect(cd.carucDossieTipo(im(), apa).permitido).toBe(false)                                      // APA admite propriedade privada
  expect(cd.carucDossieTipo(im({ status: 'Cancelado' }), esec).permitido).toBe(false)
  expect(cd.carucDossieTipo(im({ local: 'za' }), esec).permitido).toBe(false)
  expect(cd.carucDossieTipo(im({ area_analise_ha: 0.001 }), esec).permitido).toBe(false)
})

test('os 3 modelos da migration, preenchidos, não deixam {{campo}} cru', () => {
  expect(MODELOS.map(m => m.chave).sort()).toEqual(['cancelamento_protecao_integral', 'retificacao_perimetro', 'retificacao_uso_sustentavel'])
  const rel = { uc: { id: 'u', nome: 'ESEC Teste', sigla: 'ESEC', area_ha: 1000, data_criacao: '1985-06-01', ato_criacao: 'Decreto nº 1/1985' }, opcoes: {}, enquadramento: caruc.carucEnquadrarCategoria({ sigla: 'ESEC' }), gerado_em: '2026-11-25T12:00:00Z' }
  const sn = cd.carucDossieSnapshot(im({ cod: 'AC-1', area_total_ha: 51, data_inscricao: '2016-01-01', inscricao_vs_uc: 'depois', zonas: [] }), rel)
  const vars = cd.carucDossieVariaveis(sn)
  expect(vars.dispositivo_snuc).toBe('Lei nº 9.985/2000, art. 9º, § 1º')
  expect(vars.uc_categoria).toBe('Estação Ecológica (ESEC)')
  for (const m of MODELOS) {
    const t = cd.carucPreencherModelo(m.texto, vars)
    expect(t, m.chave).not.toMatch(/\{\{/)
    expect(t).toContain('AC-1')
    expect(t).toContain('Instituto de Meio Ambiente do Acre')
    expect(t).toMatch(/Lei nº 12\.651\/2012, art\. 29/)
  }
  expect(cd.carucPreencherModelo('{{nao_existe}} x', vars)).toBe('— x')
})

test('snapshot não carrega nome nem documento do titular', () => {
  const rel = { uc: { id: 'u', nome: 'X', sigla: 'RESEX', area_ha: 10 }, opcoes: {}, gerado_em: 'x' }
  const sn = cd.carucDossieSnapshot(im({ cod: 'AC-9', titular: 'Maria Teste', documento: '***.456.789-**', nome_imovel: 'Sítio' }), rel)
  const json = JSON.stringify(sn)
  expect(json).not.toContain('Maria Teste')
  expect(json).not.toContain('456.789')
  expect(sn.cod_imovel).toBe('AC-9')
})

test('série de inscrições: ano × status, anos vazios no meio e cancelados no ano', () => {
  const s = caruc.carucSerieInscricoes([
    { data_inscricao: '2015-03-01', status: 'Ativo', inscricao_vs_uc: 'depois' },
    { data_inscricao: '2015-09-01', status: 'Cancelado', data_cancelamento: '2025-02-17', inscricao_vs_uc: 'depois' },
    { data_inscricao: '2017-01-01', status: 'Pendente', inscricao_vs_uc: 'depois' },
    { status: 'Ativo' },
  ], { data_criacao: '2000-01-01' })
  expect(s.anos.map(a => a.ano)).toEqual(['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'])
  expect(s.anos[0].por).toMatchObject({ Ativo: 1, Cancelado: 1 })
  expect(s.anos.find(a => a.ano === '2025').cancelados_no_ano).toBe(1)
  expect(s.sem_data).toBe(1)
  expect(s.totais).toMatchObject({ Ativo: 2, Cancelado: 1, Pendente: 1 })
  expect(s.depois).toBe(3)
  const svg = caruc.carucSerieSVG(s)
  expect((svg.match(/data-gt-ponto/g) || []).length).toBe(11)       // um ponto de teclado por ano, não por segmento
  expect(svg).toContain('Criação da UC')  // ano anterior ao 1º da série: linha na borda
})

// ── Página real ───────────────────────────────────────────────────────
const UC = { id: 'uc-teste', codigo: 'UC-999', nome: 'RESEX de Teste', sigla: 'RESEX', categoria: 'RESEX', grupo: 'uso_sustentavel', esfera: 'estadual', area_ha: 12000, data_criacao: '2000-01-01', ato_criacao: 'Decreto Estadual nº 9.999/2000' };
const quad = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const UC_GEOM = quad(-70, -10, -69.9, -9.9);
const WFS = { type: 'FeatureCollection', totalFeatures: 3, features: [
  { type: 'Feature', geometry: quad(-69.99, -9.99, -69.97, -9.97), properties: { cod_imovel: 'AC-A', status_imovel: 'AT', condicao: 'Aguardando análise', tipo_imovel: 'IRU', municipio: 'Xapuri', area: 480 } },
  { type: 'Feature', geometry: quad(-69.92, -9.99, -69.88, -9.97), properties: { cod_imovel: 'AC-B', status_imovel: 'AT', condicao: 'Ativo', tipo_imovel: 'PCT', municipio: 'Xapuri', area: 960 } },
  { type: 'Feature', geometry: quad(-69.905, -9.95, -69.85, -9.93), properties: { cod_imovel: 'AC-P', status_imovel: 'PE', condicao: 'Pendente', tipo_imovel: 'IRU', municipio: 'Xapuri', area: 600 } },
] };
const CADASTRO = {
  'AC-A': { cod_imovel: 'AC-A', nom_imovel: 'Colocação Alfa', nome_compl: 'Maria Teste', cpf_cnpj_mascarado: '***.456.789-**', num_area_i: 480, num_modulo: 3, nom_munici: 'Xapuri', dat_criaca: '2015-06-01', titular_grupo: 1, titular_cars_estado: 1 },
  'AC-B': { cod_imovel: 'AC-B', nom_imovel: 'Comunidade Beta', nome_compl: 'Associação', cpf_cnpj_mascarado: '**.345.678/****-**', num_area_i: 960, nom_munici: 'Xapuri', dat_criaca: '2016-01-01', titular_grupo: 2, titular_cars_estado: 1 },
  'AC-P': { cod_imovel: 'AC-P', nom_imovel: 'Sítio Pê', nome_compl: 'João Teste', cpf_cnpj_mascarado: '***.111.222-**', num_area_i: 600, nom_munici: 'Xapuri', dat_criaca: '2016-03-01', titular_grupo: 3, titular_cars_estado: 1 },
};
const SOLS = [{ id: 's1', protocolo: 'SOLCAR-2026-0007', uc_id: 'uc-teste', uc_nome: 'RESEX de Teste', uc_sigla: 'RESEX', cod_imovel: 'AC-Z', tipo_pedido: 'cancelamento', status: 'emitido',
  modelo_versao: 1, modelo_situacao: 'minuta', area_uc_ha: 12.5, pct_uc: 99, pdf_path: 'uc-teste/s1.pdf', pdf_sha256: 'a'.repeat(64), situacao_sicar_emissao: 'Ativo', situacao_sicar_atual: 'Ativo', emitido_em: '2026-11-20T12:00:00Z', emitido_por_nome: 'Gestora Teste' }];

async function abrir(page, hash = '#car') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/server.arcgisonline.com/**', route => route.abort());
  await page.route('**/api/car-proxy**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(WFS) }));
  await page.addInitScript(([usuario, uc, ucGeom, cadastro, modelos, sols]) => {
    window.__rpc = []; window.__upload = []; window.__sols = sols;
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const consulta = (tabela) => {
      const q = {
        select: () => q, order: () => q, limit: () => q, in: () => q, is: () => q, or: () => q, eq: () => q,
        single: async () => tabela === 'unidades_conservacao' ? { data: { geom: ucGeom }, error: null } : { data: tabela === 'config_sistema' ? { dados: {} } : usuario, error: null },
        maybeSingle: async () => ({ data: usuario, error: null }),
        then: (r) => {
          let data = []
          if (tabela === 'unidades_conservacao') data = [uc]
          if (tabela === 'minhas_permissoes') data = [{ chave: 'monitoramento', nivel: 'editar' }]
          if (tabela === 'car_fundamentacao_modelos') data = modelos.map((m, k) => ({ id: 'm' + k, versao: 1, situacao: 'minuta', hash_sha256: 'f'.repeat(64), ...m }))
          if (tabela === 'vw_car_solicitacoes_imac') data = window.__sols
          return Promise.resolve({ data, error: null }).then(r)
        },
      }
      return q
    }
    window.supabase = { createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: usuario.id } } } }), getUser: async () => ({ data: { user: { id: usuario.id } } }), signOut: async () => ({}), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      rpc: async (nome, args) => {
        window.__rpc.push({ nome, args })
        if (nome === 'car_relatorio_uc_cadastro') return { data: args.p_cod_imoveis.map(c => cadastro[c]).filter(Boolean), error: null }
        if (nome === 'car_solicitacao_emitir') return { data: [{ id: '11111111-2222-3333-4444-555555555555', protocolo: 'SOLCAR-2026-0001' }], error: null }
        return { data: null, error: null }
      },
      from: consulta,
      storage: { from: (b) => ({
        upload: async (p, blob) => { window.__upload.push({ b, p, tam: blob.size }); return { data: { path: p }, error: null } },
        createSignedUrl: async () => ({ data: { signedUrl: 'about:blank' }, error: null }),
      }) },
    }) }
  }, [{ id: 'u1', nome_completo: 'Gestora Teste', email: 'g@x.invalid', perfil: 'gestor', ativo: true }, UC, UC_GEOM, CADASTRO, MODELOS, SOLS]);
  await page.goto(`${BASE}/pages/relatorios.html${hash}`);
}

async function gerar(page) {
  await page.locator('#caruc-uc option[value="uc-teste"]').waitFor({ state: 'attached', timeout: 20_000 });
  await page.selectOption('#caruc-uc', 'uc-teste');
  await expect(page.locator('#caruc-gerar')).toBeEnabled();
  await page.click('#caruc-gerar');
  await page.locator('#caruc-tabela tbody tr').first().waitFor({ timeout: 20_000 });
}

test('quadro de inscrições por ano × status, com legenda clicável', async ({ page }) => {
  await abrir(page);
  await gerar(page);
  const card = page.locator('#caruc-inscricoes');
  await expect(card).toContainText('Inscrições no CAR por ano e status');
  await expect(card.locator('svg [data-gt-ponto]')).toHaveCount(2)    // 2015 e 2016
  await card.locator('[data-fk="status"][data-fv="Pendente"]').click()
  await expect(page.locator('#caruc-tabela tbody tr.caruc-imovel-tr')).toHaveCount(1)
})

test('botão só onde cabe pedido; PCT em RESEX não ganha botão', async ({ page }) => {
  await abrir(page);
  await gerar(page);
  const linha = cod => page.locator('#caruc-tabela tbody tr').filter({ has: page.locator('.caruc-cod', { hasText: new RegExp('^' + cod + '$') }) })
  await expect(linha('AC-A').locator('[data-dossie]')).toHaveCount(1)
  await expect(linha('AC-B').locator('[data-dossie]')).toHaveCount(0)
})

test('emitir: PDF sem dado do titular, com minuta e SNUC; hash = SHA-256 do arquivo', async ({ page }) => {
  test.setTimeout(60_000);
  await abrir(page);
  await gerar(page);
  await page.locator('[data-dossie="AC-A"]').click()
  const modal = page.locator('#cd-modal')
  await expect(modal).toContainText('Retificação (adequar a PCT ou excluir a área)')
  await expect(modal).toContainText('minuta')
  await expect(modal).not.toContainText('Maria Teste')
  // Sem conferir, não emite.
  await modal.locator('#cd-emitir').click()
  expect(await page.evaluate(() => window.__rpc.filter(r => r.nome === 'car_solicitacao_emitir').length)).toBe(0)
  await modal.locator('#cd-conferi').check()
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 40_000 }), modal.locator('#cd-emitir').click()])
  const buf = fs.readFileSync(await dl.path())
  await expect(modal).toHaveCount(0, { timeout: 20_000 })

  const rpc = await page.evaluate(() => window.__rpc)
  const em = rpc.find(r => r.nome === 'car_solicitacao_emitir').args
  expect(em.p_tipo).toBe('retificacao_uso_sustentavel')
  expect(em.p_cod_imovel).toBe('AC-A')
  expect(em.p_assinante_nome).toBe('Gestora Teste')
  expect(JSON.stringify(em.p_snapshot)).not.toMatch(/Maria Teste|456\.789/)
  expect(em.p_snapshot.pct_uc).toBeGreaterThan(99)
  expect(em.p_fundamentacao).not.toMatch(/\{\{/)
  const reg = rpc.find(r => r.nome === 'car_solicitacao_registrar_pdf').args
  expect(reg.p_sha256).toBe(crypto.createHash('sha256').update(buf).digest('hex'))
  expect(reg.p_path).toBe('uc-teste/11111111-2222-3333-4444-555555555555.pdf')
  const up = await page.evaluate(() => window.__upload)
  expect(up[0]).toMatchObject({ b: 'car-dossies', p: reg.p_path, tam: buf.length })

  const { PDFParse } = require('pdf-parse');
  const texto = (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, ' ')
  expect(texto).toContain('SOLCAR-2026-0001')
  expect(texto).toContain('MINUTA')
  expect(texto).toContain('AC-A')
  expect(texto).toContain('Instituto de Meio Ambiente do Acre')
  expect(texto).toContain('Reserva Extrativista (RESEX)')
  expect(texto).toContain('art. 18, § 1º')
  expect(texto).toContain('Decreto Estadual nº 9.999/2000')
  expect(texto).toContain('Gestora Teste')
  expect(texto).not.toContain('Maria Teste')
  expect(texto).not.toContain('456.789')
})

test('aba Solicitações: lista, atualiza situação e mostra os modelos com as marcas [CONFERIR]', async ({ page }) => {
  await abrir(page, '#sol');
  const aba = page.locator('#aba-sol')
  await expect(aba).toContainText('SOLCAR-2026-0007', { timeout: 20_000 })
  await expect(aba).toContainText('minuta')
  await expect(aba.locator('#carsol-modelos tbody tr')).toHaveCount(3)
  await expect(aba.locator('#carsol-modelos button:has-text("Validar")').first()).toBeDisabled()   // ainda há [CONFERIR]
  await aba.locator('[data-acao="status"]').click()
  await page.fill('#carsol-doc', 'Ofício nº 12/2026')
  await page.click('#carsol-salvar')
  await expect(page.locator('#carsol-modal-status')).toHaveCount(0)
  const st = await page.evaluate(() => window.__rpc.find(r => r.nome === 'car_solicitacao_mudar_status').args)
  expect(st).toMatchObject({ p_id: 's1', p_status: 'enviado_imac', p_documento_ref: 'Ofício nº 12/2026' })
})
