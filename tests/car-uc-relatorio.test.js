// ── SIGUC · Relatório "CAR na UC" (Gestão › Relatórios) ─────────────
// Executar: npx playwright test tests/car-uc-relatorio.test.js
//
// O QUE ESTE GUARDA TRAVA
// 1. Enquadramento por CATEGORIA e por ZONA sai de regra, não de texto
//    livre: proteção integral = conflito; "Uso Restrito" é proteção
//    (palavra de proteção testada ANTES da de uso).
// 2. O vínculo zona↔UC do arquivo padrão é pelo CÓDIGO da UC: "São
//    Francisco" do arquivo é a APA Igarapé São Francisco, nunca a FLONA
//    homônima. Arquivo padrão tem prioridade sobre camada enviada.
// 3. Só entra no relatório imóvel que se sobrepõe à UC; o que está fora
//    nunca chega à RPC de cadastro — e é essa RPC que grava o log LGPD,
//    então mandar código a mais seria registrar acesso a titular que o
//    relatório nem mostra.
// 4. CPF/CNPJ: a tela, o CSV e o PDF só mostram o que a RPC devolveu
//    (mascarado no servidor). O número inteiro não aparece em lugar
//    nenhum.
// 5. Dados ambientais só são pedidos quando marcados.
//
// Página real com cliente Supabase stubado (mesmo contorno de
// tests/agua-conferencia-filtros.test.js) e o WFS do SICAR respondido
// por page.route — a rede externa é bloqueada nas sessões de teste.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

const caruc = require('../js/car-uc-relatorio.js');
const cmapa = require('../js/car-uc-mapa.js');

// ── Funções puras ─────────────────────────────────────────────────────
test('categoria: proteção integral é conflito; RESEX verificar; APA admitido', () => {
  expect(caruc.carucEnquadrarCategoria({ sigla: 'PARES', grupo: 'protecao_integral' }).nivel).toBe('conflito');
  expect(caruc.carucEnquadrarCategoria({ sigla: 'ESEC' }).nivel).toBe('conflito');
  expect(caruc.carucEnquadrarCategoria({ sigla: 'RESEX', grupo: 'uso_sustentavel' }).nivel).toBe('verificar');
  expect(caruc.carucEnquadrarCategoria({ sigla: 'FLOES' }).nivel).toBe('verificar');
  expect(caruc.carucEnquadrarCategoria({ sigla: 'APA' }).nivel).toBe('admitido');
  expect(caruc.carucEnquadrarCategoria({ sigla: 'ARIE' }).nivel).toBe('admitido');
});

test('zona: código decide; sem código, palavra de proteção vence a de uso', () => {
  expect(caruc.carucEnquadrarZona('ZP', '').nivel).toBe('protecao');
  expect(caruc.carucEnquadrarZona('ZPO', '').nivel).toBe('uso');
  expect(caruc.carucEnquadrarZona('ZOA', '').nivel).toBe('amortecimento');
  expect(caruc.carucEnquadrarZona(null, 'Zona de Uso Restrito').nivel).toBe('protecao');
  expect(caruc.carucEnquadrarZona(null, 'Zona de Uso Moderado').nivel).toBe('uso');
  expect(caruc.carucEnquadrarZona('ZUEP', 'Zona de Uso Extrativista e de Pesca').nivel).toBe('uso');
  expect(caruc.carucEnquadrarZona(null, 'Zona de Proteção').nivel).toBe('protecao');
});

test('zonas do arquivo padrão casam pelo código da UC, nunca pelo nome', () => {
  const arquivo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'uc_zonas_acre.geojson'), 'utf8'));
  const apa = caruc.carucZonasDaUC({ id: 'a', codigo: 'UC-012' }, arquivo, []);
  const flona = caruc.carucZonasDaUC({ id: 'f', codigo: 'UC-006' }, arquivo, []);
  expect(apa.za.length).toBeGreaterThan(0);     // os ZOA de "São Francisco" são da APA
  expect(flona.zonas.length + flona.za.length).toBe(0);
  const chandless = caruc.carucZonasDaUC({ id: 'c', codigo: 'UC-008' }, arquivo, []);
  expect(chandless.zonas.map(z => z.properties.codigo).sort()).toEqual(expect.arrayContaining(['ZI', 'ZP', 'ZUE', 'ZOT']));
});

test('arquivo padrão tem prioridade sobre camada; camada entra quando não há arquivo', () => {
  const arquivo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'uc_zonas_acre.geojson'), 'utf8'));
  const quadrado = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
  const camadaLib = { nome: 'FE Rio Liberdade - Zoneamento', uc_id: 'lib', geojson: { features: [{ type: 'Feature', geometry: quadrado, properties: { Zona_1: 'Zona de Caça' } }] } };
  const lib = caruc.carucZonasDaUC({ id: 'lib', codigo: 'UC-019' }, arquivo, [camadaLib]);
  expect(lib.fonteZonas).toMatch(/Arquivo/);
  expect(lib.zonas.some(z => z.properties.nome === 'Zona de Caça')).toBe(false);

  const camadaArie = { nome: 'ARIE -  Zoneamento', uc_id: 'arie', geojson: { features: [
    { type: 'Feature', geometry: quadrado, properties: { Zona: 'ZOP', 'Descriçã': 'Proteção', SubZonas: '3.1' } },
  ] } };
  const arie = caruc.carucZonasDaUC({ id: 'arie', codigo: 'UC-021' }, arquivo, [camadaArie]);
  expect(arie.zonas).toHaveLength(1);
  expect(arie.zonas[0].properties).toMatchObject({ codigo: 'ZOP', nome: 'Zona de Proteção', sub: '3.1' });
  expect(arie.fonteZonas).toContain('ARIE - Zoneamento');
});

test('pontos de atenção saem de regra', () => {
  const resex = { sigla: 'RESEX', data_criacao: '1990-03-12' };
  const enq = caruc.carucEnquadrarCategoria(resex);
  const a = caruc.carucAtencoes({ local: 'uc', tipo_imovel: 'IRU', data_inscricao: '2015-05-01', zonas: [], status: 'Ativo', situacao: 'Ativo' }, resex, enq);
  expect(a).toEqual(expect.arrayContaining(['Imóvel particular (IRU) em UC de domínio público', 'Inscrito após a criação da UC']));
  const pct = caruc.carucAtencoes({ local: 'uc', tipo_imovel: 'PCT', data_inscricao: '1989-01-01', zonas: [], status: '', situacao: '' }, resex, enq);
  expect(pct).toEqual([]);
  const za = caruc.carucAtencoes({ local: 'za', tipo_imovel: 'IRU', data_inscricao: '2015-05-01', zonas: [], status: '', situacao: 'Cancelado' }, resex, enq);
  expect(za).toEqual(['CAR cancelado ou suspenso']);   // fora da UC não acusa inscrição/domínio
});

test('focos no período somam só os anos pedidos', () => {
  expect(caruc.carucFocosNoPeriodo({ 2010: 5, 2012: 3, 2020: 4, 2024: 1 }, 2012, 2020)).toBe(7);
});

test('CSV: BOM, ponto e vírgula, vírgula decimal e CPF só como veio', () => {
  const rel = {
    opcoes: { focos: true, focosDe: 2020, focosAte: 2024 },
    imoveis: [{ cod: 'AC-1', local: 'uc', nome_imovel: 'Sítio; Bom', titular: 'Fulano', documento: '***.456.789-**',
      area_total_ha: 1234.5, area_analise_ha: 10.25, pct_analise: 50, zonas: [], atencoes: [], ambiental: { focos_periodo: 3 } }],
  };
  const csv = caruc.carucCsv(rel);
  expect(csv.charCodeAt(0)).toBe(0xFEFF);
  expect(csv).toContain('"Sítio; Bom"');
  expect(csv).toContain(';1234,50;10,25;50,0;');
  expect(csv).toContain('***.456.789-**');
  expect(csv.split('\r\n')[0]).toContain('Focos 2020–2024');
});

test('enriquecer: grupo de titular, fracionamento só com CPF, homônimo, faixa e divergência', () => {
  const uc = { sigla: 'RESEX', data_criacao: '2000-01-01' };
  const base = { local: 'uc', zonas: [], situacao: 'Ativo', status: 'Ativo', na_planilha: true };
  const im = [
    { ...base, cod: 'A', titular: 'João da Silva', titular_grupo: 1, titular_tipo_doc: 'cpf', titular_cars_estado: 4, modulos: 3, tipo_imovel: 'IRU', pct_analise: 100, area_declarada_ha: 100, area_total_ha: 100, data_inscricao: '2010-01-01' },
    { ...base, cod: 'B', titular: 'JOÃO DA SILVA', titular_grupo: 1, titular_tipo_doc: 'cpf', titular_cars_estado: 4, modulos: 2, tipo_imovel: 'IRU', pct_analise: 5, area_declarada_ha: 100, area_total_ha: 130, data_inscricao: '1999-01-01' },
    { ...base, cod: 'C', titular: 'Joao da Silva', titular_grupo: 2, titular_tipo_doc: 'cpf', titular_cars_estado: 1, modulos: 1, tipo_imovel: 'PCT', pct_analise: 60 },
    { ...base, cod: 'D', titular: 'INCRA', titular_grupo: 3, titular_tipo_doc: 'cnpj', titular_cars_estado: 4030, modulos: 1, tipo_imovel: 'AST', pct_analise: 30 },
    { ...base, cod: 'E', titular: 'INCRA', titular_grupo: 3, titular_tipo_doc: 'cnpj', titular_cars_estado: 4030, modulos: 4, tipo_imovel: 'AST', pct_analise: 30 },
  ];
  caruc.carucEnriquecer(im, uc, caruc.carucEnquadrarCategoria(uc));
  const [A, B, C, D] = im;
  expect(A.titular_cars_relatorio).toBe(2);
  expect(A.fracionamento).toBe(true);          // 3 + 2 > 4, todos ≤ 4, CPF
  expect(D.fracionamento).toBe(false);         // CNPJ (órgão) nunca
  expect(A.homonimo).toBe(true);               // C tem o mesmo nome (sem acento/caixa) e outro grupo
  expect(D.homonimo).toBe(false);              // mesmo nome E mesmo grupo = mesma pessoa, não homônimo
  expect(A.faixa_uc).toBe('Integral (95% ou mais)');
  expect(B.faixa_uc).toBe('Borda (menos de 10%)');
  expect(B.area_divergente).toBe(true);
  expect(A.area_divergente).toBe(false);
  expect(A.inscricao_vs_uc).toBe('depois');
  expect(A.prioridade.nivel).toBe('media');
  expect(A.prioridade.motivos).toEqual(expect.arrayContaining(['imóvel particular em UC de domínio público', 'possível fracionamento']));
  expect(C.prioridade.nivel).toBe('baixa');
});

test('prioridade Alta exige proteção E dano; motivo sempre escrito', () => {
  const pi = caruc.carucEnquadrarCategoria({ sigla: 'PARES' });
  const alta = caruc.carucPrioridade({ local: 'uc', zonas: [], ambiental: { deter_alertas: 2 } }, pi);
  expect(alta).toEqual({ nivel: 'alta', motivos: ['UC de proteção integral', '2 alerta(s) DETER'] });
  const semDano = caruc.carucPrioridade({ local: 'uc', zonas: [] }, pi);
  expect(semDano.nivel).toBe('media');
  const apa = caruc.carucEnquadrarCategoria({ sigla: 'APA' });
  const danoSemProtecao = caruc.carucPrioridade({ local: 'uc', zonas: [], prodes: { pos_marco_ha: 10 } }, apa);
  expect(danoSemProtecao.nivel).toBe('baixa');
});

test('filtros: facetas contam dentro dos outros filtros e descrição sai legível', () => {
  const im = [
    { cod: '1', municipio: 'Xapuri', classe: 'Verde', atencoes: [], zonas: [], prioridade: { nivel: 'baixa' } },
    { cod: '2', municipio: 'Xapuri', classe: 'Vermelho', atencoes: ['Alerta DETER'], zonas: [], prioridade: { nivel: 'alta' } },
    { cod: '3', municipio: 'Brasiléia', classe: 'Vermelho', atencoes: [], zonas: [], prioridade: { nivel: 'media' } },
  ];
  expect(caruc.carucFiltrar(im, { classe: 'Vermelho' }).map(i => i.cod)).toEqual(['2', '3']);
  expect(caruc.carucFiltrar(im, { classe: 'Vermelho', municipio: 'Xapuri' }).map(i => i.cod)).toEqual(['2']);
  const ops = caruc.carucOpcoesFiltro(im, { classe: 'Vermelho' });
  expect(ops.find(o => o.chave === 'municipio').opcoes).toEqual([{ valor: 'Brasiléia', n: 1 }, { valor: 'Xapuri', n: 1 }]);
  // dentro de "Vermelho" não há imóvel Baixa: a opção nem aparece (nunca promete recorte vazio)
  expect(ops.find(o => o.chave === 'prioridade').opcoes.map(o => o.valor)).toEqual(['Alta', 'Média']);
  // sem filtro, a ordem é a da gravidade, não a da contagem
  expect(caruc.carucOpcoesFiltro(im, {}).find(o => o.chave === 'prioridade').opcoes.map(o => o.valor)).toEqual(['Alta', 'Média', 'Baixa']);
  expect(caruc.carucDescreverFiltros({ classe: 'Vermelho' }, ' xapuri ')).toEqual(['Classe SICAR: Vermelho', 'Busca: "xapuri"']);
});

test('agrupar por titular: maior grupo primeiro, sem titular por último, rótulo legível', () => {
  const im = [
    { cod: 'X', titular_grupo: 2, titular: 'Ana', documento: '***.1-**', titular_cars_relatorio: 1, titular_cars_estado: 1, area_analise_ha: 900 },
    { cod: 'S', titular_grupo: null, area_analise_ha: 10 },
    { cod: 'A', titular_grupo: 1, titular: 'Bia', documento: '***.2-**', titular_cars_relatorio: 2, titular_cars_estado: 7, area_analise_ha: 10.5 },
    { cod: 'B', titular_grupo: 1, titular: 'Bia', documento: '***.2-**', titular_cars_relatorio: 2, titular_cars_estado: 7, area_analise_ha: 20 },
  ];
  const g = caruc.carucAgruparPorTitular(im);
  expect(g.map(x => x.grupo)).toEqual([1, 2, null]);            // quantidade vence área
  expect(g[0].imoveis.map(i => i.cod)).toEqual(['B', 'A']);      // dentro do grupo, maior área primeiro
  expect(caruc.carucGrupoRotulo(g[0])).toBe('Titular nº 1 · Bia · ***.2-** · 2 CAR(s) nesta UC · 7 no Acre · 30,50 ha');
  expect(caruc.carucGrupoRotulo(g[2])).toBe('Sem titular identificado na planilha local · 1 imóvel(is)');
  // agrupar reordena, nunca perde nem duplica
  const r = caruc.carucRelFiltrado({ imoveis: im, uc: {} }, {}, '', { agrupar: true });
  expect(r.imoveis.map(i => i.cod)).toEqual(['B', 'A', 'X', 'S']);
  expect(r.filtros).toContain('Agrupado por titular');
});

test('mapa: vista enquadra a bbox sem distorcer e numera os polígonos como a tabela', () => {
  const v = cmapa.carucMapaVista([-70, -10, -69.9, -9.9], 600, 340);
  const [x0, y0] = v.proj(-70, -9.9), [x1, y1] = v.proj(-69.9, -10);
  for (const [x, y] of [[x0, y0], [x1, y1]]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(600); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(340); }
  // quadrado de 0,1° no Acre fica quase quadrado (Mercator), nunca esticado para 600×340
  expect(Math.abs((x1 - x0) - (y1 - y0)) / (x1 - x0)).toBeLessThan(0.02);
  const g = { grupo: 1, imoveis: [{ cod: 'A', _mapa: quad(-69.99, -9.99, -69.97, -9.97) }, { cod: 'SEM' }, { cod: 'C', _mapa: quad(-69.98, -9.985, -69.96, -9.965) }],
    fora: [{ cod: 'F', _mapa: quad(-68.6, -9.1, -68.58, -9.08) }, { cod: 'G' }] };
  expect(cmapa.carucMapaGrupoTemMapa(g)).toBe(true);
  expect(cmapa.carucMapaGrupoTemMapa({ ...g, imoveis: g.imoveis.slice(0, 2) })).toBe(false);   // 1 polígono só: sem mapa
  const d = cmapa.carucMapaDadosGrupo({ geo: { uc: UC_GEOM, zonas: [] } }, g, null);
  expect(d.cars.map(c => c.rot + c.cod)).toEqual(['1A', '2C']);   // sem polígono não ganha número (a tabela também não)
  expect(d.fora.map(c => c.rot + c.cod)).toEqual(['F1F']);        // F2 (sem polígono) fica só na lista
  const svg = cmapa.carucMapaSVGs(d, cmapa.carucMapaVistas(d), { fundo: 'sem' });
  expect((svg.zoom.match(/<title>\d · /g) || []).length).toBe(2);
  expect(svg.zoom).not.toContain('<image');
  expect(svg.uc).toContain('Área ampliada no 1º quadro');          // a UC inteira marca onde está o zoom
  // o zoom enquadra os CARs, não a UC: o polígono ocupa boa parte do quadro
  // (na escala da UC, um CAR de 50 ha tinha 2–3 px e sumia atrás do número)
  const vz = cmapa.carucMapaVistas(d).zoom;
  const [ax, ay] = vz.proj(-69.99, -9.97), [bx, by] = vz.proj(-69.97, -9.99);
  expect(bx - ax).toBeGreaterThan(80);
  expect(by - ay).toBeGreaterThan(80);
  expect(svg.acre).toContain('F1 · F');
  const sat = cmapa.carucMapaSVGs(d, cmapa.carucMapaVistas(d), { fundo: 'satelite', imagemUC: 'data:image/jpeg;base64,AA', imagemAcre: 'data:image/jpeg;base64,AA' });
  expect(sat.uc).toContain('<image');
});

// ── Página real ───────────────────────────────────────────────────────
const UC = { id: 'uc-teste', codigo: 'UC-999', nome: 'RESEX de Teste', sigla: 'RESEX', categoria: 'RESEX', grupo: 'uso_sustentavel', esfera: 'estadual', area_ha: 12000, data_criacao: '2000-01-01' };
const quad = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const UC_GEOM = quad(-70, -10, -69.9, -9.9);
const CAMADAS = [{ nome: 'Teste - Zoneamento', uc_id: UC.id, geojson: { features: [
  { type: 'Feature', geometry: quad(-70, -10, -69.95, -9.9), properties: { zona_codigo: 'ZP', zona_nome: 'Zona Primitiva' } },
  { type: 'Feature', geometry: quad(-69.95, -10, -69.9, -9.9), properties: { zona_codigo: 'ZEX', zona_nome: 'Zona de Extrativismo' } },
] } }];
// AC-C cruza AC-A (≈ 180 ha) e é do MESMO titular (grupo 1): os dois
// têm até 4 MF e somam mais de 4 → possível fracionamento. AC-B tem o
// mesmo NOME de A com outro documento → homônimo a verificar.
const WFS = { type: 'FeatureCollection', totalFeatures: 4, features: [
  { type: 'Feature', geometry: quad(-69.98, -9.985, -69.96, -9.965), properties: { cod_imovel: 'AC-C', condicao: 'Ativo', tipo_imovel: 'IRU', municipio: 'Epitaciolândia', area: 480 } },
  { type: 'Feature', geometry: quad(-69.99, -9.99, -69.97, -9.97), properties: { cod_imovel: 'AC-A', condicao: 'Ativo', tipo_imovel: 'IRU', municipio: 'Xapuri', area: 480 } },
  { type: 'Feature', geometry: quad(-69.92, -9.99, -69.88, -9.97), properties: { cod_imovel: 'AC-B', condicao: 'Ativo', tipo_imovel: 'PCT', municipio: 'Xapuri', area: 960 } },
  { type: 'Feature', geometry: quad(-69.5, -9.5, -69.4, -9.4), properties: { cod_imovel: 'AC-FORA', condicao: 'Ativo', tipo_imovel: 'IRU', municipio: 'Xapuri', area: 100 } },
] };
const CADASTRO = {
  'AC-A': { cod_imovel: 'AC-A', nom_imovel: 'Colocação Alfa', nome_compl: 'Maria Teste', cpf_cnpj_mascarado: '***.456.789-**', num_area_i: 480, num_modulo: 3, nom_munici: 'Xapuri', condicao_i: 'Ativo', nome_class: 'Vermelho', dat_criaca: '2015-06-01', titular_grupo: 1, titular_cars_estado: 5, titular_tipo_doc: 'cpf' },
  'AC-B': { cod_imovel: 'AC-B', nom_imovel: 'Comunidade Beta', nome_compl: 'Maria Teste', cpf_cnpj_mascarado: '**.345.678/****-**', num_area_i: 960, num_modulo: 1, nom_munici: 'Xapuri', condicao_i: 'Ativo', nome_class: 'Verde', dat_criaca: '1999-01-01', titular_grupo: 2, titular_cars_estado: 1, titular_tipo_doc: 'cnpj' },
  'AC-C': { cod_imovel: 'AC-C', nom_imovel: 'Colocação Gama', nome_compl: 'Maria Teste', cpf_cnpj_mascarado: '***.456.789-**', num_area_i: 480, num_modulo: 2.5, nom_munici: 'Epitaciolândia', condicao_i: 'Ativo', nome_class: 'Verde', dat_criaca: '1998-01-01', titular_grupo: 1, titular_cars_estado: 5, titular_tipo_doc: 'cpf' },
};

// CARs do titular nº 1 fora da UC: F1 tem polígono no SICAR, F2 não.
const FORA = [
  { titular_grupo: 1, cod_imovel: 'AC-FORA-1', nom_imovel: 'Sítio Longe', nom_munici: 'Sena Madureira', condicao_i: 'Ativo', ind_status: 'AT', num_area_i: 50 },
  { titular_grupo: 1, cod_imovel: 'AC-FORA-2', nom_imovel: 'Sítio Sem Mapa', nom_munici: 'Feijó', condicao_i: 'Ativo', ind_status: 'AT', num_area_i: 30 },
];
const FORA_GEOM = { 'AC-FORA-1': quad(-68.6, -9.1, -68.58, -9.08) };
// Ladrilho de satélite falso (1×1 verde) com CORS liberado, como a Esri responde.
const TILE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADgQF/e4nZ2AAAAABJRU5ErkJggg==', 'base64');

async function abrir(page) {
  page.__tiles = 0;
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/server.arcgisonline.com/**', route => { page.__tiles++; route.fulfill({ contentType: 'image/png', body: TILE_PNG, headers: { 'Access-Control-Allow-Origin': '*' } }); });
  await page.route('**/api/car-proxy**', route => {
    const alvo = decodeURIComponent(new URL(route.request().url()).searchParams.get('url') || '');
    if (/CQL_FILTER/.test(alvo)) {
      const feats = Object.entries(FORA_GEOM).filter(([c]) => alvo.includes(`'${c}'`))
        .map(([c, g]) => ({ type: 'Feature', geometry: g, properties: { cod_imovel: c } }));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: feats }) });
    }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(WFS) });
  });
  await page.addInitScript(([usuario, uc, ucGeom, camadas, cadastro, fora]) => {
    window.__rpc = [];
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' });
    const consulta = (tabela) => {
      const f = {};
      const q = {
        select: (c) => { f.select = c; return q }, order: () => q, limit: () => q, in: () => q, is: () => q, or: () => q,
        eq: (col, val) => { f[col] = val; return q },
        single: async () => {
          if (tabela === 'unidades_conservacao') return { data: { geom: ucGeom }, error: null };
          if (tabela === 'config_sistema') return { data: { dados: {} }, error: null };
          return { data: usuario, error: null };
        },
        maybeSingle: async () => ({ data: usuario, error: null }),
        then: (r) => {
          let data = [];
          if (tabela === 'unidades_conservacao') data = [uc];
          if (tabela === 'camadas_mapa') data = camadas;
          return Promise.resolve({ data, error: null }).then(r);
        },
      };
      return q;
    };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: usuario.id } } } }),
          getUser: async () => ({ data: { user: { id: usuario.id } } }),
          signOut: async () => ({}), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        rpc: async (nome, args) => {
          window.__rpc.push({ nome, args });
          if (nome === 'car_relatorio_uc_cadastro') return { data: args.p_cod_imoveis.map(c => cadastro[c]).filter(Boolean), error: null };
          if (nome === 'car_relatorio_uc_fora') return { data: fora, error: null };
          if (nome === 'car_relatorio_uc_ambiental') return { data: args.p_imoveis.map(i => ({ cod_imovel: i.cod, focos_por_ano: { 2019: 9, 2023: 2, 2024: 3 }, focos_total: 14, deter_alertas: i.cod === 'AC-A' ? 1 : 0, deter_ha: i.cod === 'AC-A' ? 2.5 : 0, deter_ultimo: null })), error: null };
          if (nome === 'gerar_protocolo_relatorio') return { data: 'SIGUC-2026-0001', error: null };
          if (nome === 'nivel_efetivo') return { data: 'editar', error: null };
          return { data: null, error: null };
        },
        from: (tabela) => consulta(tabela),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      }),
    };
  }, [{ id: 'u1', nome_completo: 'Gestora Teste', email: 'g@x.invalid', perfil: 'gestor', ativo: true }, UC, UC_GEOM, CAMADAS, CADASTRO, FORA]);
  await page.goto(`${BASE}/pages/relatorios.html#car`);
  await page.locator('#caruc-uc option[value="uc-teste"]').waitFor({ state: 'attached', timeout: 20_000 });
}

// Só linhas de imóvel na UC — cabeçalho de grupo, mapa do titular e a
// lista dos CARs de fora são outras <tr> e não podem entrar na contagem.
const LINHAS = '#caruc-tabela tbody tr.caruc-imovel-tr';

// Linha pelo nº do CAR na 2ª célula — filtrar por texto pegaria também
// a linha que só CITA o código ("Sobrepõe: AC-A").
const linhaCar = (page, cod) => page.locator('#caruc-tabela tbody tr')
  .filter({ has: page.locator('.caruc-cod', { hasText: new RegExp('^' + cod + '$') }) });

async function gerar(page, marcar = []) {
  await page.selectOption('#caruc-uc', 'uc-teste');
  await expect(page.locator('#caruc-gerar')).toBeEnabled();
  for (const id of marcar) await page.check('#' + id);
  await page.click('#caruc-gerar');
  await page.locator('#caruc-tabela tbody tr').first().waitFor({ timeout: 20_000 });
}

test('lista só os imóveis que se sobrepõem à UC, com zonas e atenção', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#aba-car')).toBeVisible();
  await page.selectOption('#caruc-uc', 'uc-teste');
  await expect(page.locator('#caruc-uc-info')).toContainText('Teste - Zoneamento');
  await expect(page.locator('#caruc-za')).toBeDisabled();   // sem ZA cadastrada, a opção não engana
  await gerar(page);

  const linhas = page.locator(LINHAS);
  await expect(linhas).toHaveCount(3);
  await expect(page.locator('#caruc-tabela')).not.toContainText('AC-FORA');

  const cad = await page.evaluate(() => window.__rpc.filter(r => r.nome === 'car_relatorio_uc_cadastro'));
  expect(cad).toHaveLength(1);
  expect(cad[0].args.p_uc_id).toBe('uc-teste');
  expect(cad[0].args.p_cod_imoveis.sort()).toEqual(['AC-A', 'AC-B', 'AC-C']);   // o de fora nunca gera log LGPD; e vai numa chamada só (o grupo de titular vale por chamada)

  const a = linhaCar(page, 'AC-A');
  await expect(a).toContainText('Zona Primitiva');
  await expect(a).toContainText('Atinge zona de proteção');
  await expect(a).toContainText('Imóvel particular (IRU) em UC de domínio público');
  await expect(a).toContainText('***.456.789-**');
  await expect(a).toContainText('Titular nº 1 · 2 CAR(s) nesta UC · 5 no Acre');
  await expect(a).toContainText('Possível fracionamento');
  await expect(a).toContainText('Sobreposição com outro CAR');
  await expect(a).toContainText(/Sobrepõe: AC-C \(1\d\d,\d ha, mesmo titular\)/);
  await expect(a.locator('.caruc-prio')).toHaveText('Média');   // sem PRODES/DETER no relatório, Alta não existe

  const b = linhaCar(page, 'AC-B');
  await expect(b).toContainText('Zona de Extrativismo');
  await expect(b).toContainText('mesmo nome de outro titular — verificar');
  // metade do imóvel B está fora da UC
  await expect(b.locator('td.num .caruc-nota').first()).toHaveText(/^50(,\d)?% do imóvel$/);

  await expect(page.locator('#caruc-resultado')).toContainText('Uso sustentável');
  const ambiental = await page.evaluate(() => window.__rpc.filter(r => r.nome === 'car_relatorio_uc_ambiental').length);
  expect(ambiental).toBe(0);   // não marcado → não pedido
});

test('dados ambientais entram quando marcados e respeitam o período', async ({ page }) => {
  await abrir(page);
  await page.selectOption('#caruc-focos-de', '2020');
  await page.selectOption('#caruc-focos-ate', '2024');
  await gerar(page, ['caruc-focos', 'caruc-deter']);
  const a = linhaCar(page, 'AC-A');
  await expect(a.locator('td').nth(9)).toHaveText('5');           // 2023 + 2024; 2019 fica fora
  await expect(a).toContainText('Alerta DETER');
  // zona primitiva + alerta DETER = Alta, com o motivo escrito
  await expect(a.locator('.caruc-prio')).toHaveText('Alta');
  await expect(a).toContainText('Zona Primitiva; 1 alerta(s) DETER');
  await expect(page.locator('#caruc-tabela thead')).toContainText('Focos 2020–2024');
});

test('filtros por atributo combinam entre si e com a busca; resumo segue o recorte', async ({ page }) => {
  await abrir(page);
  await gerar(page);
  await page.click('#caruc-btn-filtros');
  await expect(page.locator('#caruc-f-municipio option')).toHaveText(['Todos', 'Xapuri (2)', 'Epitaciolândia (1)']);

  await page.selectOption('#caruc-f-titular', 'Possível fracionamento');
  await expect(page.locator(LINHAS)).toHaveCount(2);
  await expect(page.locator('#caruc-chips')).toContainText('Titular: Possível fracionamento');
  // o contador do botão tem de estar VISÍVEL na mesma linha (regra global de .btn span o jogava para fora)
  await expect(page.locator('#caruc-filtros-n')).toBeVisible();
  await expect(page.locator('#caruc-filtros-n')).toHaveText('1');
  // a cor vem de variável do design system; variável inexistente (--verde-c) deixava o
  // fundo transparente e o número branco invisível — medido, não suposto.
  const cores = await page.evaluate(() => [getComputedStyle(document.getElementById('caruc-filtros-n')).backgroundColor,
    getComputedStyle(document.getElementById('aba-btn-car')).borderBottomColor])
  expect(cores[0]).not.toBe('rgba(0, 0, 0, 0)');
  expect(cores[1]).not.toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('#caruc-recorte')).toContainText('Filtrado: 2 de 3');
  // facetas: com o titular escolhido, o município conta só dentro do recorte
  await expect(page.locator('#caruc-f-municipio option')).toHaveText(['Todos', 'Epitaciolândia (1)', 'Xapuri (1)']);   // empate: alfabética

  await page.selectOption('#caruc-f-municipio', 'Xapuri');
  await expect(page.locator(LINHAS)).toHaveCount(1);
  await expect(page.locator('.caruc-kpis')).toContainText('Imóveis na UC1');

  await page.fill('#caruc-busca', 'gama');   // contradiz o município: vazio, não "um vence"
  await expect(page.locator('#caruc-tabela tbody')).toContainText('Nenhum imóvel com esses filtros');

  await page.click('.caruc-chip:has-text("Município")');
  await expect(page.locator(LINHAS)).toHaveCount(1);
  await expect(page.locator('#caruc-tabela tbody')).toContainText('AC-C');

  await page.click('#caruc-limpar');
  await expect(page.locator(LINHAS)).toHaveCount(3);
  await expect(page.locator('#caruc-recorte')).toContainText('3 imóveis, sem filtro');
});

test('exportação sai com o recorte filtrado e diz quais filtros', async ({ page }) => {
  await abrir(page);
  await gerar(page);
  await page.click('#caruc-btn-filtros');
  await page.selectOption('#caruc-f-titular', 'Possível fracionamento');

  const [dCsv] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("CSV")')]);
  expect(dCsv.suggestedFilename()).toMatch(/_filtrado\.csv$/);
  const csv = fs.readFileSync(await dCsv.path(), 'utf8');
  expect(csv).toContain('AC-A');
  expect(csv).toContain('AC-C');
  expect(csv).not.toContain('AC-B');
  expect(csv.split('\r\n')[0]).toContain('Titular nº (neste relatório)');
  expect(csv).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);   // nenhum CPF inteiro

  const [dX] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.click('button:has-text("Excel")')]);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(await dX.path()));
  const strings = await zip.file('xl/sharedStrings.xml').async('string');
  expect(strings).toContain('Titular: Possível fracionamento');
  expect(strings).not.toContain('Comunidade Beta');
});

test('PDF e Excel saem com o CPF mascarado e a relação completa', async ({ page }) => {
  await abrir(page);
  await gerar(page, ['caruc-focos']);

  const [dPdf] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.click('button:has-text("PDF")')]);
  const pdfBuf = fs.readFileSync(await dPdf.path());
  const { PDFParse } = require('pdf-parse');
  const texto = (await new PDFParse({ data: pdfBuf }).getText()).text;
  expect(texto).toContain('RESEX de Teste');
  expect(texto).toContain('AC-A');
  expect(texto).toContain('***.456.789-**');
  expect(texto).toContain('Zona Primitiva');
  expect(texto).not.toContain('AC-FORA');

  const [dX] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.click('button:has-text("Excel")')]);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(await dX.path()));
  const strings = await zip.file('xl/sharedStrings.xml').async('string');
  expect(strings).toContain('Nº do CAR');
  expect(strings).toContain('Colocação Alfa');
  expect(strings).toContain('**.345.678/****-**');
});

test('celular (390px): filtros abertos e tabela sem rolagem lateral da página', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await abrir(page);
  await gerar(page, ['caruc-focos', 'caruc-deter']);
  await page.click('#caruc-btn-filtros');
  await expect(page.locator('#caruc-filtros-grid')).toBeVisible();
  const vaza = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(vaza).toBeLessThanOrEqual(0);   // a tabela rola dentro do .table-wrap, nunca a página
  const chip = await page.locator('#caruc-btn-filtros').boundingBox();
  expect(chip.height).toBeGreaterThanOrEqual(24);
  // com o mapa do titular aberto, a página continua sem rolagem lateral
  await page.locator('#caruc-conteudo [data-fk="titular"][data-fv="Mais de um CAR nesta UC"]').first().click();
  await expect(page.locator('.caruc-mapas[data-grupo="1"] svg')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

// ── Resumo clicável (rodada 3) ────────────────────────────────────────
test('todo número clicável do resumo leva exatamente a esse número de imóveis', async ({ page }) => {
  await abrir(page);
  await gerar(page, ['caruc-focos', 'caruc-deter']);
  const alvos = await page.locator('#caruc-conteudo [data-fk]:not(.caruc-clic-zero)').evaluateAll(els =>
    els.filter(e => !e.closest('#caruc-tabela')).map(e => ({ fk: e.dataset.fk, fv: e.dataset.fv, n: +e.dataset.n })));
  expect(alvos.length).toBeGreaterThan(8);
  for (const a of alvos) {
    const el = page.locator(`#caruc-conteudo [data-fk="${a.fk}"][data-fv="${a.fv}"]`).first();
    await el.click();
    await expect(page.locator(LINHAS), `${a.fk} = ${a.fv}`).toHaveCount(a.n);
    await expect(page.locator(`#caruc-conteudo [data-fk="${a.fk}"][data-fv="${a.fv}"]`).first()).toHaveAttribute('aria-pressed', 'true');
    // clicar de novo desliga
    await page.locator(`#caruc-conteudo [data-fk="${a.fk}"][data-fv="${a.fv}"]`).first().click();
    await expect(page.locator(LINHAS)).toHaveCount(3);
  }
});

test('clicar em "titulares com mais de um CAR" filtra, rola até a relação e agrupa', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await abrir(page);
  await gerar(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const topoAntes = await page.locator('#caruc-tabela-card').evaluate(e => e.getBoundingClientRect().top);
  expect(topoAntes).toBeGreaterThan(600);   // a relação começa fora da tela

  await page.locator('#caruc-conteudo [data-fk="titular"][data-fv="Mais de um CAR nesta UC"]').first().click();
  await expect(page.locator(LINHAS)).toHaveCount(2);
  await expect.poll(() => page.locator('#caruc-tabela-card').evaluate(e => e.getBoundingClientRect().top)).toBeLessThan(200);
  await expect(page.locator('#caruc-tabela-titulo')).toBeFocused();
  await expect(page.locator('#caruc-chips')).toContainText('Mais de um CAR nesta UC');

  // agrupamento liga sozinho com esse filtro, com o cabeçalho do titular
  await expect(page.locator('#caruc-agrupar')).toBeChecked();
  await expect(page.locator('#caruc-tabela tr.caruc-grupo-tr')).toHaveCount(1);
  await expect(page.locator('#caruc-tabela tr.caruc-grupo-tr')).toContainText('Titular nº 1 · Maria Teste · ***.456.789-** · 2 CAR(s) nesta UC · 5 no Acre');

  // desmarcar é escolha da pessoa e vale enquanto o filtro estiver lá
  await page.uncheck('#caruc-agrupar');
  await expect(page.locator('#caruc-tabela tr.caruc-grupo-tr')).toHaveCount(0);
  await expect(page.locator(LINHAS)).toHaveCount(2);

  // agrupar sem filtro nenhum: todos os titulares, cada um com seu cabeçalho
  await page.click('#caruc-limpar');
  await expect(page.locator('#caruc-agrupar')).not.toBeChecked();
  await page.check('#caruc-agrupar');
  await expect(page.locator('#caruc-tabela tr.caruc-grupo-tr')).toHaveCount(2);
  await expect(page.locator(LINHAS)).toHaveCount(3);
});

test('teclado: Enter liga o filtro do resumo', async ({ page }) => {
  await abrir(page);
  await gerar(page);
  await page.locator('#caruc-conteudo [data-fk="titular"][data-fv="Possível fracionamento"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(LINHAS)).toHaveCount(2);
});

test('exportação segue o filtro do clique e o agrupamento por titular', async ({ page }) => {
  await abrir(page);
  await gerar(page);
  await page.locator('#caruc-conteudo [data-fk="titular"][data-fv="Mais de um CAR nesta UC"]').first().click();
  await expect(page.locator(LINHAS)).toHaveCount(2);

  const [dCsv] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("CSV")')]);
  const csv = fs.readFileSync(await dCsv.path(), 'utf8');
  expect(csv).not.toContain('AC-B');
  expect(csv).toMatch(/AC-[AC][\s\S]*AC-[AC]/);

  const [dPdf] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.click('button:has-text("PDF")')]);
  const { PDFParse } = require('pdf-parse');
  const texto = (await new PDFParse({ data: fs.readFileSync(await dPdf.path()) }).getText()).text;
  expect(texto).toContain('Titular nº 1');
  expect(texto).toContain('Agrupado por titular');
  expect(texto).not.toContain('Comunidade Beta');

  const [dX] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.click('button:has-text("Excel")')]);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(await dX.path()));
  const wb = await zip.file('xl/workbook.xml').async('string');
  expect(wb).toContain('name="Titulares"');
  const strings = await zip.file('xl/sharedStrings.xml').async('string');
  expect(strings).toContain('Titular: Mais de um CAR nesta UC');
  expect(strings).not.toContain('Comunidade Beta');
});

// ── Mapa por titular (rodada 4) ───────────────────────────────────────
async function agruparMulti(page) {
  await page.locator('#caruc-conteudo [data-fk="titular"][data-fv="Mais de um CAR nesta UC"]').first().click();
  await expect(page.locator('#caruc-agrupar')).toBeChecked();
}

test('mapa do titular: polígonos numerados como as linhas, com satélite e crédito', async ({ page }) => {
  await abrir(page);
  await gerar(page);
  await agruparMulti(page);
  const mapa = page.locator('.caruc-mapas[data-grupo="1"]');
  await expect(mapa.locator('svg')).toHaveCount(2);            // sem CARs de fora pedidos: zoom + UC inteira
  await expect(mapa.locator('svg').first().locator('title')).toHaveText([/^1 · AC-[AC]$/, /^2 · AC-[AC]$/]);
  await expect.poll(() => mapa.locator('svg image').count()).toBe(2);   // satélite entrou nos dois
  expect(page.__tiles).toBeGreaterThan(0);
  await expect(page.locator('.caruc-mapa-cred').first()).toContainText('Esri World Imagery');
  // o nº do polígono é o nº da linha: o 1 é o imóvel de maior área no recorte
  const pinos = await page.locator(LINHAS).evaluateAll(trs => trs.map(tr => [tr.querySelector('.caruc-pino')?.textContent, tr.querySelector('.caruc-cod')?.textContent]));
  const titulos = await mapa.locator('svg').first().locator('title').allTextContents();
  for (const [n, cod] of pinos) expect(titulos).toContain(`${n} · ${cod}`);
  // sem "Agrupar por titular", nenhum mapa
  await page.uncheck('#caruc-agrupar');
  await expect(page.locator('.caruc-mapas')).toHaveCount(0);
});

test('"Sem fundo" desenha só o vetor e não baixa ladrilho nenhum', async ({ page }) => {
  await abrir(page);
  await page.locator('label', { has: page.locator('#caruc-fundo-sem') }).click();
  await gerar(page);
  await agruparMulti(page);
  const mapa = page.locator('.caruc-mapas[data-grupo="1"]');
  await expect(mapa.locator('svg').first().locator('title')).toHaveCount(2);
  await page.waitForTimeout(300);
  await expect(mapa.locator('svg image')).toHaveCount(0);
  expect(page.__tiles).toBe(0);
  await expect(page.locator('.caruc-mapa-cred').first()).toContainText('Sem imagem de fundo');
});

test('CARs do mesmo titular fora da UC: só quando pedidos, no mapa do Acre e numa lista à parte', async ({ page }) => {
  await abrir(page);
  await gerar(page);
  expect(await page.evaluate(() => window.__rpc.filter(r => r.nome === 'car_relatorio_uc_fora').length)).toBe(0);   // não marcado → não consulta (nem registra acesso)

  await page.check('#caruc-fora');
  await page.click('#caruc-gerar');
  await page.locator(LINHAS).first().waitFor();
  const rpc = await page.evaluate(() => window.__rpc.filter(r => r.nome === 'car_relatorio_uc_fora'));
  expect(rpc).toHaveLength(1);
  expect(rpc[0].args.p_cod_imoveis.sort()).toEqual(['AC-A', 'AC-B', 'AC-C']);   // a MESMA lista do cadastro: a numeração casa
  await expect(page.locator('#caruc-resultado')).toContainText('1 CAR(s) do mesmo titular fora da UC não vieram do SICAR');

  await agruparMulti(page);
  const mapa = page.locator('.caruc-mapas[data-grupo="1"]');
  await expect(mapa.locator('svg')).toHaveCount(3);            // zoom + UC inteira + Acre
  await expect(mapa.locator('svg').nth(2).locator('title')).toContainText(['F1 · AC-FORA-1']);
  await expect(page.locator('tr.caruc-fora-tr')).toContainText('2 CAR(s)');
  await expect(page.locator('tr.caruc-fora-linha')).toHaveCount(2);
  await expect(page.locator('tr.caruc-fora-linha').nth(1)).toContainText('sem polígono no SICAR');
  // os de fora nunca entram nos totais da UC
  await expect(page.locator(LINHAS)).toHaveCount(2);
  await expect(page.locator('.caruc-kpis')).toContainText('Imóveis na UC2');
});

test('PDF e Excel levam o mapa do titular e os CARs de fora', async ({ page }) => {
  await abrir(page);
  await page.check('#caruc-fora');
  await gerar(page);
  await agruparMulti(page);
  await expect.poll(() => page.locator('.caruc-mapas[data-grupo="1"] svg image').count()).toBe(3);

  const [dPdf] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('button:has-text("PDF")')]);
  const buf = fs.readFileSync(await dPdf.path());
  expect((buf.toString('latin1').match(/\/Subtype \/Image/g) || []).length).toBeGreaterThanOrEqual(3);   // os três quadros
  const { PDFParse } = require('pdf-parse');
  const texto = (await new PDFParse({ data: buf }).getText()).text;
  // tabela de leitura: titular/CPF só no cabeçalho do grupo; texto longo em linha própria
  expect(texto).toContain('Situação / classe');
  expect(texto).not.toContain('CPF/CNPJ (mascarado)');
  expect(texto).toMatch(/Motivo: /);
  expect(texto).toContain('AC-FORA-1');
  expect(texto).toContain('Esri World Imagery');
  expect(texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);

  const [dX] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.click('button:has-text("Excel")')]);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(await dX.path()));
  expect(await zip.file('xl/workbook.xml').async('string')).toContain('name="Fora da UC"');
  expect(await zip.file('xl/sharedStrings.xml').async('string')).toContain('AC-FORA-2');
});

test('PDF sem fundo: mapa entra sem imagem de satélite e sem crédito', async ({ page }) => {
  await abrir(page);
  await page.locator('label', { has: page.locator('#caruc-fundo-sem') }).click();
  await gerar(page);
  await agruparMulti(page);
  const [dPdf] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('button:has-text("PDF")')]);
  const buf = fs.readFileSync(await dPdf.path());
  expect((buf.toString('latin1').match(/\/Subtype \/Image/g) || []).length).toBeGreaterThanOrEqual(1);
  const { PDFParse } = require('pdf-parse');
  const texto = (await new PDFParse({ data: buf }).getText()).text;
  expect(texto).toContain('Situação / classe');
  expect(texto).not.toContain('Esri World Imagery');
  expect(page.__tiles).toBe(0);
});
