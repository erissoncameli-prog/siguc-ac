// ── SIGUC Biomonitor · Relatório Científico da Temporada ──────────────
// Executar: npx playwright test tests/biomonitor-relatorio-cientifico.test.js
//
// Revisão de 10/2026 (migration 359 + js/biomonitor-analise*.js). O que
// este arquivo trava — cada item foi um defeito real medido contra a
// temporada 2026/2027 em produção:
// 1. "Perdas & predação" dizia 0 com 26 ovos perdidos no registro —
//    a seção de perdas tem de bater com a de ovos.
// 2. Fase por terços do calendário: 568 ninhos de agosto/setembro
//    caíam no "meio" com o cartão "postura" vazio. Agora a fase sai
//    dos eventos.
// 3. Praias de proteção (destino da transferência) entravam como
//    praias de desova, com densidade 0.
// 4. Taxas de eclosão no padrão da literatura (eclosão × emergência
//    sobre ovos incubados), com IC 95% de Wilson.
// 5. Número de KPI nunca em Fraunces nem monoespaçado (regra do sistema).
// 6. Sem rolagem lateral da página em 390 px.
//
// A página REAL é exercitada, com o cliente Supabase stubado e o CDN
// bloqueado (mesmo contorno de tests/agua-conferencia-filtros.test.js).
// Os dados do stub são os números reais devolvidos pelas RPCs em
// 10/10/2026 (reduzidos onde a lista é longa).

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

const USUARIO = { id: 'u-bio', nome_completo: 'Bióloga de Teste', email: 'b@x.invalid', perfil: 'gestor', ativo: true };
const TEMP = { id: 't-26', nome: 'Quelônios 2026/2027', is_atual: true }

const KPIS = { total_ninhos: 568, total_ovos_postura: 12451, total_ovos_viaveis: 12425, perdidos: 0, taxa_eclosao_pct: null }
const POR_ESPECIE = [
  { especie: 'tracaja', total: 561, media_ovos_postura: 21.6 },
  { especie: 'pitiU', total: 5, media_ovos_postura: 16.8 },
  { especie: 'tartaruga', total: 2, media_ovos_postura: 127 },
]
const DET_BASE = {
  ovos: { total_postura: 12451, total_integros: 12425, total_descartados: 26, media_postura: 21.9, n_posturas: 568, taxa_fertilidade_pct: 99.8,
    descartes_por_causa: [{ causa: 'predacao', qtd: 12 }, { causa: 'natural', qtd: 11 }, { causa: 'humana', qtd: 3 }] },
  eclosao: { vivos: 0, mortos: 0, nao_nascidos: 0, ninhos_abertos: 0, ovos_incubados: 0, taxa_eclosao_pct: null,
    taxa_sucesso_eclosao_pct: null, taxa_emergencia_pct: null, taxa_ovos_nao_eclodidos_pct: null, taxa_mortalidade_filhote_ninho_pct: null },
  perdas: { ovos_alagamento: 0, ovos_erosao: 0, ovos_humana: 3, ovos_predacao: 12, ovos_natural: 11, ninhos_perdidos: 0 },
  predacao_fases: { incubacao: { animais: 0, pessoas: 0, desconhecida: 0 }, eclosao: { por_animais: 0, por_pessoas: 0 }, soltura: { com: 0, sem: 0 } },
  incubacao: { n: 0 }, bercario_tempo: { n: 0 }, crescimento: { n_biometrias: 0 },
}
// 3 ninhos abertos (simulação conferida à mão contra a RPC real dentro
// de uma transação desfeita): 163 vivos, 6 mortos, 6 não eclodidos.
const ECLOSAO_ABERTA = { vivos: 163, mortos: 6, nao_nascidos: 6, ninhos_abertos: 3, ovos_incubados: 175, taxa_eclosao_pct: 93.1,
  taxa_sucesso_eclosao_pct: 96.6, taxa_emergencia_pct: 93.1, taxa_ovos_nao_eclodidos_pct: 3.4, taxa_mortalidade_filhote_ninho_pct: 3.6 }

const PRAIA = (id, nome, total, recebidos, km, ha, exp) => ({ id, nome, ninhos_total: total, ninhos_recebidos: recebidos,
  comprimento_m: km, area_ha: ha, experimental: !!exp, tipo_localizacao: 'margem_livre',
  densidade_ninhos_km: km ? Math.round(1000 * total / km * 100) / 100 : null, densidade_ninhos_ha: ha ? Math.round(total / ha * 100) / 100 : null })
const PRAIAS = {
  resumo: { total_praias: 4, comprimento_total_m: 456, area_total_ha: 0.86 },
  praias: [
    PRAIA('p1', 'Praia do Condado', 48, 0, 160.11, 0.1478),
    PRAIA('p2', 'Praia Alta', 41, 0, 130.57, 0.277),
    PRAIA('b2', 'Praia Berçário 02 FA', 0, 364, 65.59, 0.1438, true),
    PRAIA('b1', 'Praia Berçário 01 JE', 0, 204, 38.14, 0.0674, true),
  ],
  alertas: { contagens: {}, praias_sem_dimensoes: [], praias_periodo_desalinhado: null, praias_sem_ninho: null },
}
const COMP = {
  eventos: { ninhos: 568, postura_ini: '2026-08-11', postura_fim: '2026-09-30', ninhos_abertos: 0, ninhos_pendentes: 568,
    ninhos_perdidos: 0, previsao_ini: '2026-10-18', previsao_fim: '2026-12-07', eclosao_ini: null, eclosao_fim: null, soltura_ini: null },
  funil: { postura: 12451, viaveis: 12425, em_incubacao: 12425, incubados_abertos: 0, eclodidos: 0, emergidos: 0, soltos: 0 },
  protecao: [
    { id: 'b2', nome: 'Praia Berçário 02 FA', ninhos: 364, recebidos: 364, area_m2: 1438, m2_por_ninho: 4, abertos: 0, incubados: 0, vivos: 0, mortos: 0, nao_nasc: 0 },
    { id: 'b1', nome: 'Praia Berçário 01 JE', ninhos: 204, recebidos: 204, area_m2: 674, m2_por_ninho: 3.3, abertos: 0, incubados: 0, vivos: 0, mortos: 0, nao_nasc: 0 },
  ],
  postura: [
    { especie: 'tracaja', qtd: 9, n: 1 }, { especie: 'tracaja', qtd: 21, n: 400 }, { especie: 'tracaja', qtd: 25, n: 159 }, { especie: 'tracaja', qtd: 42, n: 1 },
    { especie: 'pitiU', qtd: 16, n: 4 }, { especie: 'pitiU', qtd: 20, n: 1 },
    { especie: 'tartaruga', qtd: 125, n: 1 }, { especie: 'tartaruga', qtd: 129, n: 1 },
  ],
  transferencia: { n: 568, com_hora: 7, mesmo_dia: 335, um_dia: 207, dois_tres: 3, quatro_mais: 9, negativo: 14 },
  calendario: [
    { semana: '2026-10-19', especie: 'tracaja', ninhos: 156, ajustados: 0 },
    { semana: '2026-10-26', especie: 'tracaja', ninhos: 195, ajustados: 0 },
    { semana: '2026-10-26', especie: 'pitiU', ninhos: 2, ajustados: 0 },
    { semana: '2026-11-02', especie: 'tracaja', ninhos: 158, ajustados: 0 },
  ],
  eclosao_especie: null,
  completude: { ninhos: 568, validados: 568, gps_campo: 0, gps_estimado: 502, sem_localizacao: 66, com_hora_desova: 539,
    com_temp_encontro: 0, ovos_contados: 568, visitas: 1, ninhos_com_visita: 1, visitas_com_temp: 0, transferidos: 568,
    transf_com_hora: 7, ninhos_abertos: 0, praias_usadas: 41, praias_sem_poligono: 6 },
}
const ANA = {
  temporada: { id: 't-26', nome: 'Quelônios 2026/2027', ano_base: 2026, data_inicio: '2026-03-27', data_fim: '2027-02-27', fase_atual: 'meio', pct_decorrido: 58 },
  temperatura: { n_amostras: 0, histograma: [] },
  clima: { ninhos_alagados: 0, ovos_perdidos_alagamento: 0, visitas_alagamento: 0, serie_mensal: [{ mes: '2026-08', ninhos: 508, temp_media: null }] },
}

async function abrir(page, { eclosao } = {}) {
  await page.clock.setFixedTime(new Date('2026-10-10T12:00:00-05:00'))
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort())
  const det = eclosao ? { ...DET_BASE, eclosao: ECLOSAO_ABERTA } : DET_BASE
  const comp = eclosao ? {
    ...COMP,
    eventos: { ...COMP.eventos, ninhos_abertos: 3, ninhos_pendentes: 565, eclosao_ini: '2026-10-08', eclosao_fim: '2026-10-09' },
    funil: { ...COMP.funil, incubados_abertos: 175, eclodidos: 169, emergidos: 163, em_incubacao: 12250 },
    protecao: [{ ...COMP.protecao[0], abertos: 3, incubados: 175, vivos: 163, mortos: 6, nao_nasc: 6 }, COMP.protecao[1]],
    eclosao_especie: [{ especie: 'tartaruga', ninhos: 1, incubados: 129, vivos: 125, mortos: 2, nao_nasc: 2 },
      { especie: 'tracaja', ninhos: 2, incubados: 46, vivos: 38, mortos: 4, nao_nasc: 4 }],
  } : COMP
  const rpcs = {
    bio_relatorio_completo: { kpis: KPIS, por_especie: POR_ESPECIE, por_mes: [{ mes: '2026-08', ninhos: 508 }, { mes: '2026-09', ninhos: 60 }], por_ano: [{ ano: 2026, ninhos: 568 }] },
    bio_analise_cientifica: ANA,
    bio_analise_detalhada: det,
    bio_analise_praias: PRAIAS,
    bio_analise_complementar: comp,
    nivel_efetivo: 'editar',
  }
  await page.addInitScript(([usuario, temporada, rpcs]) => {
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' })
    window._rpcChamadas = []
    const consulta = (tabela) => {
      const q = {
        select: () => q, in: () => q, order: () => q, limit: () => q, is: () => q, eq: () => q,
        single: async () => ({ data: usuario, error: null }),
        maybeSingle: async () => ({ data: usuario, error: null }),
        then: (r) => Promise.resolve({ data: tabela === 'temporadas_biomonitor' ? [temporada] : [], error: null }).then(r),
      }
      return q
    }
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: usuario.id } } } }),
          getUser: async () => ({ data: { user: { id: usuario.id } } }),
          signOut: async () => ({}),
        },
        rpc: async (nome) => { window._rpcChamadas.push(nome); return { data: rpcs[nome] ?? null, error: null } },
        from: (tabela) => consulta(tabela),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      }),
    }
  }, [USUARIO, TEMP, rpcs])
  await page.goto(`${BASE}/pages/analise-cientifica-biomonitor.html`)
  await page.locator('#ac-resumo').waitFor({ state: 'visible', timeout: 20_000 })
}

test('perdas por causa batem com os descartes da seção de ovos (nunca zero com perda registrada)', async ({ page }) => {
  await abrir(page)
  const perdas = page.locator('#ac-perdas')
  await expect(perdas).toContainText('12')
  await expect(perdas.locator('.ac-kpi', { hasText: 'predação' }).locator('.ac-kpi-v')).toHaveText('12')
  await expect(perdas.locator('.ac-kpi', { hasText: 'ação humana' }).locator('.ac-kpi-v')).toHaveText('3')
  await expect(perdas.locator('.ac-kpi', { hasText: 'causa natural' }).locator('.ac-kpi-v')).toHaveText('11')
  await expect(page.locator('#ac-resumo')).toContainText('26 ovos perdidos')
  await expect(page.locator('#ac-resumo')).not.toContainText('sem perdas registradas')
  expect(await page.evaluate(() => window._rpcChamadas)).toContain('bio_analise_complementar')
})

test('fase vem dos eventos: postura concluída e incubação agora, com a janela cadastrada só como referência', async ({ page }) => {
  await abrir(page)
  const fases = page.locator('#ac-fases')
  await expect(fases.locator('.ac-etapa-feito')).toContainText('Postura')
  await expect(fases.locator('.ac-etapa-feito')).toContainText('11/08/2026 a 30/09/2026')
  await expect(fases.locator('.ac-etapa-atual')).toContainText('Incubação')
  await expect(fases.locator('.ac-etapa-previsto')).toContainText('18/10/2026 a 07/12/2026')
  await expect(page.locator('.ac-doc-meta')).toContainText('Fase de incubação')
})

test('praias de proteção saem da rede de desova e ganham tabela própria com m² por ninho', async ({ page }) => {
  await abrir(page)
  const desova = page.locator('#ac-praias')
  await expect(desova).toContainText('Praia do Condado')
  await expect(desova).not.toContainText('Berçário')
  await expect(desova.locator('.ac-kpi').first()).toContainText('de 2 monitoradas')
  const prot = page.locator('#ac-protecao')
  await expect(prot.locator('tbody tr')).toHaveCount(2)
  await expect(prot.locator('tbody tr').first()).toContainText('Praia Berçário 02 FA')
  await expect(prot.locator('tbody tr').first()).toContainText('364')
  await expect(prot.locator('tbody tr').first()).toContainText('aguardando')
})

test('sem ninho aberto a eclosão diz o que falta, não mostra zero', async ({ page }) => {
  await abrir(page)
  await expect(page.locator('#ac-eclosao .ac-flag')).toContainText('Nenhum ninho aberto ainda')
  await expect(page.locator('#ac-eclosao .ac-flag')).toContainText('18/10/2026')
  await expect(page.locator('#ac-resumo .ac-kpi').last()).toContainText('aguardando eclosões')
  // funil: etapa sem evento tracejada, nunca barra de zero
  await expect(page.locator('#ac-funil svg rect[stroke-dasharray]')).toHaveCount(1)
})

test('com ninhos abertos: eclosão e emergência sobre ovos incubados, com IC 95% de Wilson', async ({ page }) => {
  await abrir(page, { eclosao: true })
  const ecl = page.locator('#ac-eclosao')
  await expect(ecl.locator('.ac-kpi', { hasText: 'sucesso de eclosão' }).locator('.ac-kpi-v')).toHaveText('96,6%')
  await expect(ecl.locator('.ac-kpi', { hasText: 'sucesso de emergência' }).locator('.ac-kpi-v')).toHaveText('93,1%')
  // Wilson 163/175 = 93,1% (88,4–96,0)
  await expect(ecl).toContainText('IC 95%: 88,4–96,0')
  await expect(ecl.locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('#ac-protecao tbody tr').first()).toContainText('93,1%')
  await expect(page.locator('#ac-funil')).toContainText('163')
})

test('número de KPI em DM Sans, nunca Fraunces nem monoespaçada', async ({ page }) => {
  await abrir(page)
  const fontes = await page.locator('.ac-kpi-v').evaluateAll(els => els.map(e => getComputedStyle(e).fontFamily))
  expect(fontes.length).toBeGreaterThan(10)
  for (const f of fontes) {
    expect(f).toContain('DM Sans')
    expect(f).not.toMatch(/Fraunces|monospace/)
  }
})

test('postura × referência: SVG com um ponto por espécie, legível por teclado', async ({ page }) => {
  await abrir(page)
  const fig = page.locator('#ac-especies .ac-fig')
  await expect(fig.locator('circle[data-gt-ponto]')).toHaveCount(3)
  await expect(fig.locator('circle[data-gt-ponto] title').first()).toContainText('média observada')
  await expect(fig.locator('[data-gt] [tabindex="0"]')).toHaveCount(1)
  // 1 tracajá com 42 ovos fica acima da faixa da literatura (3–40)
  await expect(page.locator('#ac-especies .ac-esp-card').first()).toContainText('1 ninho(s) acima da faixa')
})

test('completude e transferências com data invertida aparecem para a equipe corrigir', async ({ page }) => {
  await abrir(page)
  await expect(page.locator('#ac-completude')).toContainText('502 posições são estimadas')
  await expect(page.locator('#ac-tempos .ac-row-alert')).toContainText('14')
  await expect(page.locator('#ac-recomendacoes')).toContainText('Datas a revisar')
})

test('índice lista as seções e cada link aponta para uma seção que existe', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await abrir(page)
  const hrefs = await page.locator('.ac-indice a').evaluateAll(as => as.map(a => a.getAttribute('href')))
  expect(hrefs.length).toBeGreaterThan(12)
  for (const h of hrefs) expect(await page.locator(h).count()).toBe(1)
})

test('página sem rolagem lateral em 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await abrir(page)
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sobra).toBeLessThanOrEqual(0)
})

test('funções puras: Wilson e fase pelos eventos', async () => {
  const a = require(path.join(__dirname, '..', 'js', 'biomonitor-analise-ciencia.js'))
  expect(a.accWilson(163, 175)).toEqual({ p: 93.1, lo: 88.4, hi: 96, n: 175 })
  expect(a.accWilson(0, 0)).toBeNull()
  expect(a.accWilson(3, 3).hi).toBe(100)
  const ev = COMP.eventos
  expect(a.accFaseBiologica(ev, '2026-10-03').atual).toBe('postura')      // até 7 dias após o último encontro
  expect(a.accFaseBiologica(ev, '2026-10-10').atual).toBe('incubacao')
  expect(a.accFaseBiologica(ev, '2026-10-20').atual).toBe('eclosao')      // previsão de eclosão já começou
  expect(a.accFaseBiologica({ ninhos: 0 }, '2026-10-10').atual).toBeNull()
})
