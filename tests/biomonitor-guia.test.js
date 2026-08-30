// ── SIGUC Biomonitor · guias de introdução e modo treinamento ───
// Executar: npx playwright test tests/biomonitor-guia.test.js
//
// Reaproveita o mesmo motor genérico do app da Água (js/guia-app.js) —
// a parte testada aqui é o conteúdo (js/biomonitor-guias.js) e,
// principalmente, o ISOLAMENTO do modo treinamento
// (js/biomonitor-offline.js + guard em js/biomonitor-sync.js), que é
// bem mais arriscado neste app: o fluxo tem 15+ pontos de gravação
// (ninho, visita, transferência, eclosão, berçário, soltura,
// biometria, ocorrência, equipamento) contra 1 único no app da Água.
// O desenho escolhido por isso é diferente: banco IndexedDB inteiro
// SEPARADO (siguc_biomonitor_treino_v1), escolhido num ÚNICO ponto
// (bioOfflineInit) — nenhum dos 15+ call sites de gravação precisou
// ser tocado. A segunda camada é o guard em bioSyncTudo(), que nunca
// roda com o treino ligado.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

// Tabelas que os 12 uploaders de bioSyncTudo() gravam de verdade —
// é ISSO que nunca pode ser tocado com o treino ligado. bio_monitor_
// iniciar_sessao (ping de presença) e lgpd_aviso_campo continuam
// disparando durante o treino, DE PROPÓSITO: são sinal de "a pessoa
// está usando o app agora", não dado de treino — não são o vazamento
// que este arquivo existe pra travar.
const BIO_TABELAS_SINCRONIZADAS = [
  'ninhos_quelonios', 'descartes_ovos', 'transferencias_ninho', 'eclosoes_ninho',
  'visitas_ninho', 'lotes_bercario', 'solturas_filhotes', 'ocorrencias_bercario',
  'filhotes_bercario', 'biometrias_individuais', 'biomonitor_equipamentos',
  'biomonitor_cautelas', 'biomonitor_equipamento_ocorrencias',
]

async function rotearEnv(page) {
  await page.route('**/api/env', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: 'https://stub.supabase.co', supabaseKey: 'chave-stub' }),
  }));
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
}

async function abrirApp(page) {
  await rotearEnv(page);
  await page.goto(`${BASE}/pages/biomonitor.html`);
  await page.locator('#tela-login').waitFor({ state: 'visible', timeout: 20_000 });
}

// Entra na Home sem passar pelo login de verdade — mesmo atalho de
// tests/agua-guia.test.js (App.coletor lá, BioApp.monitor aqui).
// Instala um cliente Supabase de MENTIRA que CONTA toda chamada, para
// os testes de isolamento provarem que o modo treinamento nunca a usa.
async function entrarHomeDeTeste(page, { comClienteContador = false } = {}) {
  await page.evaluate(async (comClienteContador) => {
    if (comClienteContador) {
      window.__rpcChamadas = []
      window.__fromChamadas = []
      window.__uploadChamado = false
      window._bioDB_client = {
        auth: { getSession: async () => ({ data: { session: { user: { id: 'u-teste' } } } }) },
        rpc: async (nome, args) => { window.__rpcChamadas.push({ nome, args }); return { data: null, error: null } },
        from: (tabela) => {
          window.__fromChamadas.push(tabela)
          const q = { select() { return q }, eq() { return q }, in() { return q }, order() { return q },
            limit: async () => ({ data: [], error: null }),
            then: r => Promise.resolve({ data: [], error: null }).then(r) }
          return q
        },
        storage: { from: () => ({ upload: async () => { window.__uploadChamado = true; return { data: null, error: null } } }) },
      }
    }
    await bioOfflineInit()
    BioApp.monitor = { id: 'monitor-teste', nome_completo: 'Teste Guia', grupo_id: 'grupo-teste', grupo_nome: 'Grupo Teste' }
    await bioEntrarNaHome()
    // bioEntrarNaHome() dispara bioSyncTudo() em paralelo, SEM esperar
    // (fire-and-forget) — com o treino ainda desligado nesse momento,
    // é sync de verdade contra o cliente-stub. Espera terminar antes
    // de zerar os contadores, senão uma chamada tardia desse sync
    // legítimo vaza pro período que os testes de isolamento medem.
    for (let i = 0; i < 100 && typeof _bioSyncEmAndamento !== 'undefined' && _bioSyncEmAndamento; i++) {
      await new Promise(r => setTimeout(r, 20))
    }
    if (comClienteContador) { window.__rpcChamadas = []; window.__fromChamadas = []; window.__uploadChamado = false }
  }, comClienteContador)
  await page.locator('#tela-home').waitFor({ state: 'visible', timeout: 10_000 })
}

test.afterEach(async ({ page }) => {
  // Nunca deixar o modo treinamento vazando de um teste para o outro
  // (o app real usa localStorage, que teoricamente é isolado por
  // contexto de teste, mas o banco de treino em disco não é limpo
  // sozinho por padrão).
  await page.evaluate(async () => {
    try { if (typeof bioModoTreinoDesativar === 'function') await bioModoTreinoDesativar() } catch {}
  }).catch(() => {})
})

test('o guia abre e navega passo a passo sem rede e sem sessão', async ({ page }) => {
  await abrirApp(page)
  await page.evaluate(() => {
    guiaDefinir({ ...BIOMONITOR_GUIAS, aoTrocarTela: () => {} })
    guiaAbrir('primeiros-passos', { voltarCentral: false })
  })
  const painel = page.locator('.guia-painel')
  await expect(painel).toBeVisible()
  const primeiro = await painel.locator('.guia-titulo').textContent()
  await painel.locator('[data-guia-prox]').click()
  expect(await painel.locator('.guia-titulo').textContent()).not.toBe(primeiro)
})

test('todo seletor de alvo declarado no conteúdo existe no HTML', async ({ page }) => {
  await abrirApp(page)
  const faltando = await page.evaluate(() => {
    const fora = []
    for (const g of BIOMONITOR_GUIAS.guias) {
      for (const p of (g.passos || [])) {
        if (p.alvo && !document.querySelector(p.alvo)) fora.push(`${g.slug}: ${p.alvo}`)
      }
    }
    return fora
  })
  expect(faltando).toEqual([])
})

test('todo botão "Ajuda desta tela" aponta para um guia que existe', async ({ page }) => {
  await abrirApp(page)
  const orfaos = await page.evaluate(() => {
    const slugs = BIOMONITOR_GUIAS.guias.map(g => g.slug)
    return [...document.querySelectorAll('[data-guia-tela]')]
      .map(b => b.dataset.guiaTela)
      .filter(s => !slugs.includes(s))
  })
  expect(orfaos).toEqual([])
})

test('todo "?" de campo referencia um verbete existente, e vice-versa não é exigido', async ({ page }) => {
  await abrirApp(page)
  const orfaos = await page.evaluate(() => {
    const chaves = Object.keys(BIOMONITOR_GUIAS.verbetes || {})
    return [...document.querySelectorAll('[data-guia-verbete]')]
      .map(b => b.dataset.guiaVerbete)
      .filter(c => !chaves.includes(c))
  })
  expect(orfaos).toEqual([])
})

test('tour: "Ajuda desta tela" no formulário de ninho destaca o campo real', async ({ page }) => {
  await abrirApp(page)
  await entrarHomeDeTeste(page)
  await page.evaluate(() => {
    guiaDefinir({ ...BIOMONITOR_GUIAS, aoTrocarTela: id => { if (!BIO_GUIA_TELAS_CRUAS.has(id)) bioMostrarTela(id) } })
    bioMostrarTela('tela-form-ninho')
  })
  await page.locator('#tela-form-ninho.ativa [data-guia-tela]').click()
  await expect(page.locator('.guia-spot')).toBeVisible()
})

test('faixa de treino nunca aparece nas telas de autenticação', async ({ page }) => {
  await abrirApp(page)
  await page.evaluate(async () => {
    await bioOfflineInit()
    await bioModoTreinoAtivar()
    bioPintarModoTreino()
  })
  // Ainda na tela de login (nunca entramos na Home) — a faixa não
  // pode aparecer, mesmo com o modo ligado.
  await expect(page.locator('#bio-treino-faixa')).toBeHidden()
})

// ═══════════════════════════════════════════════════════════════
// ISOLAMENTO DO MODO TREINAMENTO — a parte que não pode falhar
// ═══════════════════════════════════════════════════════════════

test('ativar o treino copia praias/berçários/equipamentos do banco real, sem tocar o servidor', async ({ page }) => {
  await abrirApp(page)
  await entrarHomeDeTeste(page, { comClienteContador: true })

  const r = await page.evaluate(async () => {
    // Semeia o banco REAL (flag ainda desligado) com uma praia de mentira.
    await bioOfflineSalvarPraias([{ id: 'praia-real-1', nome: 'Praia Teste', programa_id: 'p1' }])

    await bioModoTreinoAtivar()   // deve ler o real e escrever no treino

    const praiasNoTreino = await bioOfflineListarPraias()   // já está em treino
    return {
      praiasNoTreino: praiasNoTreino.map(p => p.id),
      rpcChamadas: window.__rpcChamadas,
      fromChamadas: window.__fromChamadas,
    }
  })

  expect(r.praiasNoTreino).toContain('praia-real-1')
  // Ativar o treino é operação 100% local — nenhuma chamada ao servidor.
  expect(r.rpcChamadas).toEqual([])
  expect(r.fromChamadas).toEqual([])
})

test('um ninho salvo em treino nunca existe no banco real, e a fila real fica vazia', async ({ page }) => {
  await abrirApp(page)
  await entrarHomeDeTeste(page, { comClienteContador: true })

  const r = await page.evaluate(async () => {
    // Confirma o banco real vazio ANTES de qualquer coisa (baseline).
    const antes = await bioOfflineListarNinhos()

    await bioModoTreinoAtivar()
    await bioOfflineSalvarNinho({
      uuid_cliente: 'treino-ninho-1', numero_ninho: 'TR-TREINO-01',
      especie: 'tracaja', status: 'encontrado', status_sync: 'pendente',
      praia_id: 'praia-real-1', criado_em: new Date().toISOString(),
    })

    // Enquanto em treino, a leitura ENXERGA o ninho — é o que permite
    // visitar/transferir/eclodir ele depois, dentro do próprio treino.
    const duranteTreino = (await bioOfflineListarNinhos()).map(n => n.uuid_cliente)

    // "Sair" sem passar por bioModoTreinoDesativar (que apagaria o
    // banco de treino) — só derruba a CHAVE, pra inspecionar o banco
    // real diretamente com os mesmos helpers que o app usa.
    localStorage.removeItem('siguc_bio_modo_treinamento')
    const noBancoReal = (await bioOfflineListarNinhos()).map(n => n.uuid_cliente)

    return { antes: antes.length, duranteTreino, noBancoReal }
  })

  expect(r.antes).toBe(0)
  expect(r.duranteTreino).toContain('treino-ninho-1')
  // A prova central: o ninho de treino NUNCA chega ao banco real.
  expect(r.noBancoReal).not.toContain('treino-ninho-1')
  expect(r.noBancoReal.length).toBe(0)
})

test('bioSyncTudo() nunca roda com o treino ligado — nem RPC, nem upload de foto', async ({ page }) => {
  await abrirApp(page)
  await entrarHomeDeTeste(page, { comClienteContador: true })

  const r = await page.evaluate(async () => {
    await bioModoTreinoAtivar()
    await bioOfflineSalvarNinho({
      uuid_cliente: 'treino-ninho-2', numero_ninho: 'TR-TREINO-02',
      especie: 'tracaja', status: 'encontrado', status_sync: 'pendente',
      foto_urls_local: ['data:image/png;base64,AAAA'],
      criado_em: new Date().toISOString(),
    })
    await bioSyncTudo({ monitorId: 'monitor-teste' })
    return {
      rpcChamadas: window.__rpcChamadas,
      fromChamadas: window.__fromChamadas,
      uploadChamado: window.__uploadChamado,
    }
  })

  expect(r.rpcChamadas).toEqual([])
  expect(r.fromChamadas).toEqual([])
  expect(r.uploadChamado).toBe(false)
})

test('entrar na Home com o treino ligado também não dispara o auto-sync', async ({ page }) => {
  await abrirApp(page)
  // Ativa o treino ANTES de entrar — bioEntrarNaHome() dispara sync
  // automático de propósito (mesma linha que roda em uso normal), e
  // é exatamente esse gatilho automático que a guarda tem de conter.
  await page.evaluate(async () => {
    window.__rpcChamadas = []; window.__fromChamadas = []
    window._bioDB_client = {
      auth: { getSession: async () => ({ data: { session: null } }) },
      rpc: async (nome, args) => { window.__rpcChamadas.push({ nome, args }); return { data: null, error: null } },
      from: (t) => { window.__fromChamadas.push(t); const q = { select(){return q}, eq(){return q}, order(){return q}, limit: async()=>({data:[],error:null}), then:r=>Promise.resolve({data:[],error:null}).then(r) }; return q },
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
    }
    await bioOfflineInit()
    await bioModoTreinoAtivar()
  })
  await entrarHomeDeTeste(page)   // já em treino; bioEntrarNaHome chama bioSyncTudo sozinho

  const r = await page.evaluate(() => ({ rpc: window.__rpcChamadas, from: window.__fromChamadas }))
  // O ping de sessão e o aviso LGPD continuam disparando (não são o
  // que a garantia cobre — ver BIO_TABELAS_SINCRONIZADAS acima); o que
  // NUNCA pode aparecer é alguma das tabelas que o sync grava.
  expect(r.from.filter(t => BIO_TABELAS_SINCRONIZADAS.includes(t))).toEqual([])
  await expect(page.locator('#bio-treino-faixa')).toBeVisible()
})

test('sair do modo treinamento apaga o banco de treino e devolve o app ao real', async ({ page }) => {
  await abrirApp(page)
  await entrarHomeDeTeste(page)

  await page.evaluate(async () => {
    await bioModoTreinoAtivar()
    await bioOfflineSalvarNinho({
      uuid_cliente: 'treino-ninho-3', numero_ninho: 'TR-TREINO-03',
      status: 'encontrado', status_sync: 'pendente', criado_em: new Date().toISOString(),
    })
  })
  expect(await page.evaluate(() => bioModoTreinoAtivo())).toBe(true)

  await page.evaluate(async () => { await bioModoTreinoDesativar() })
  expect(await page.evaluate(() => bioModoTreinoAtivo())).toBe(false)

  // Reativar depois de desligar tem que funcionar de novo, do zero —
  // prova que "sair" não deixa o mecanismo quebrado pra próxima vez.
  const r = await page.evaluate(async () => {
    await bioModoTreinoAtivar()
    const ninhos = await bioOfflineListarNinhos()
    return ninhos.map(n => n.uuid_cliente)
  })
  // O banco de treino foi recriado do zero — o ninho da rodada anterior
  // (que já tinha "vazado" pro treino antes de desligar) não voltou.
  expect(r).not.toContain('treino-ninho-3')
})
