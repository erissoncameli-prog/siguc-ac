// ── SIGUC · Diagnóstico Socioeconômico · app de campo (Fase 3) ─────────
// Executar: npx playwright test tests/socio-app.test.js
//
// O que o banco decide (quem aplica, período, território, idempotência)
// é testado no banco (supabase/tests/socio/rodar.sh). Aqui se trava o APP:
//   - nada impede o trabalho de campo: a entrevista inteira roda sem rede
//     e fica guardada no aparelho a cada passo;
//   - o formulário segue a estrutura (salto, lista, derivada, especifique);
//   - a fila sobe as fotos e chama socio_enviar_ficha UMA vez por ficha
//     (reenvio não duplica), e erro do banco vira ficha "com problema",
//     nunca some;
//   - treino e recusa vão com o formato que o banco exige.
//
// Página real; cliente Supabase stubado (o CDN é bloqueado) e o teste de
// conexão (HEAD em <SUPABASE_URL>/rest/v1/) respondido por page.route,
// que liga e desliga a "internet".

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5500';
const FOTO = path.join(__dirname, 'fixtures', 'agua-teste.jpg');
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
test.use({ geolocation: { latitude: -9.97, longitude: -67.81 }, permissions: ['geolocation'] });

const ESTRUTURA = {
  identificacao: { nome: 'opcional', gps: 'nao' },
  lista: { titulo: 'Moradores', max_linhas: 6, minimo: 1, marca_entrevistado: true, colunas: [
    { chave: 'nome', rotulo: 'Nome', tipo: 'texto', max_len: 40, identificacao: true },
    { chave: 'idade', rotulo: 'Idade', tipo: 'inteiro', min: 0, max: 120 }] },
  coerencia: [{ tipo: 'igual_total_linhas', chave: 'qtd' }],
  blocos: [
    { id: 'casa', titulo: 'Casa', perguntas: [
      { n: 1, chave: 'qtd', tipo: 'inteiro', texto: 'Quantas pessoas moram aqui?', min: 1, max: 30 },
      { n: 2, chave: 'moradores', tipo: 'tabela', texto: 'Quem mora aqui' },
      { n: 3, chave: 'tem_crianca', tipo: 'unica', texto: 'Há criança?', opcoes: [{ v: 'sim', r: 'Sim' }, { v: 'nao', r: 'Não' }],
        derivada: { tipo: 'existe_linha', onde: { coluna: 'idade', op: 'entre', valor: [0, 11] } } },
      { n: 4, chave: 'escola', tipo: 'unica', texto: 'As crianças vão à escola?', opcoes: [{ v: 'sim', r: 'Sim' }, { v: 'nao', r: 'Não' }],
        mostrar_se: { se: 'tem_crianca', op: '=', valor: 'sim' } }] },
    { id: 'agua', titulo: 'Água', perguntas: [
      { n: 5, chave: 'agua', tipo: 'unica', texto: 'De onde vem a água?',
        opcoes: [{ v: 'rio', r: 'Rio' }, { v: 'poco', r: 'Poço' }, { v: 'outro', r: 'Outro', especificar: true }] },
      { n: 6, chave: 'obs', tipo: 'texto_longo', texto: 'Observações' }] }],
};

function hojeAcre() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Rio_Branco' }).format(new Date()) }
function somaDias(iso, d) { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }

function pacote() {
  const hoje = hojeAcre()
  const q = { id: 'q-1', versao: 1, status: 'publicado', estrutura: ESTRUTURA, aviso: 'Este aviso é lido para a pessoa antes de começar a entrevista.', hash: 'a'.repeat(64) }
  return {
    gerado_em: new Date().toISOString(), hoje,
    usuario: { id: 'u-1', nome: 'Aplicadora de Campo' },
    campanhas: [{ id: 'c-1', nome: 'Campanha Juruá 2026', inicio: somaDias(hoje, -3), fim: somaDias(hoje, 20), situacao: 'aberta',
      exige_municipio: true, exige_uc: false, municipios: ['1200401'], ucs: [], aceita_nova: true,
      instrumento: { id: 'i-dsa', codigo: 'DSA', titulo: 'Diagnóstico de domicílios', unidade_analise: 'domicilio' }, questionario: q }],
    treino: [{ instrumento: { id: 'i-dsa', codigo: 'DSA', titulo: 'Diagnóstico de domicílios', unidade_analise: 'domicilio' }, questionario: q }],
    comunidades: [{ id: 'com-1', nome: 'Vila Boa Esperança', cd_mun: '1200401', uc_id: null }],
    municipios: [{ cd_ibge: '1200401', nome: 'Rio Branco' }, { cd_ibge: '1200203', nome: 'Cruzeiro do Sul' }],
    ucs: [{ id: 'uc-1', nome: 'APA Lago do Amapá', sigla: 'APA' }],
    minhas_fichas: [],
  }
}

// abre o app com o "servidor" falso; `rede` liga/desliga a internet
async function abrir(page, opts = {}) {
  const rede = { on: opts.online !== false }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort())
  await page.route('http://fake.test/**', r => rede.on ? r.fulfill({ status: 200, body: '' }) : r.abort())
  await page.addInitScript(([pac]) => {
    window.__srv = Object.assign({ chamadas: [], uploads: [], falhaRede: 0, erroBanco: null, pacote: pac, sessao: false }, window.__srvExtra || {})
    window.loadEnv = () => Promise.resolve({ supabaseUrl: 'http://fake.test', supabaseKey: 'fake-key' })
    const S = window.__srv
    const sessao = () => S.sessao ? { user: { id: 'u-1' }, expires_at: Math.floor(Date.now() / 1000) + 3600 } : null
    const cliente = {
      auth: {
        getSession: async () => ({ data: { session: sessao() } }),
        refreshSession: async () => ({ error: null }),
        signInWithPassword: async ({ password }) => {
          if (password !== 'senha-certa') return { data: null, error: { status: 400 } }
          S.sessao = true
          return { data: { session: sessao() }, error: null }
        },
        signOut: async () => { S.sessao = false; return {} },
        updateUser: async () => ({ error: null }),
      },
      from: () => {
        const o = { select: () => o, eq: () => o, update: () => o,
          maybeSingle: async () => ({ data: { id: 'u-1', nome_completo: 'Aplicadora de Campo', ativo: true, deve_trocar_senha: false }, error: null }),
          then: r => Promise.resolve({ data: null, error: null }).then(r) }
        return o
      },
      rpc: async (nome, args) => {
        S.chamadas.push({ nome, args: JSON.parse(JSON.stringify(args || {})) })
        if (nome === 'socio_app_pacote') return { data: S.pacote, error: null }
        if (nome === 'socio_enviar_ficha') {
          if (S.falhaRede > 0) { S.falhaRede--; throw new TypeError('Failed to fetch') }
          if (S.erroBanco) return { data: null, error: { message: S.erroBanco } }
          return { data: { id: 'srv-' + args.p_ficha.uuid_cliente.slice(0, 8), codigo: args.p_ficha.codigo, status: 'enviada', alertas: [] }, error: null }
        }
        return { data: null, error: null }
      },
      storage: { from: bucket => ({ upload: async (caminho, blob, o) => { S.uploads.push({ bucket, caminho, tam: blob.size, tipo: o.contentType }); return { data: {}, error: null } } }) },
    }
    window.supabase = { createClient: () => cliente }
  }, [opts.pacote || pacote()])
  const erros = []
  page.on('pageerror', e => erros.push(String(e)))
  await page.goto(`${BASE}/pages/socio-app.html`)
  return { rede, erros }
}

// espera a rodada em curso (concluir já dispara uma) e roda a fila de novo
async function filaRodar(page) {
  await page.waitForFunction(() => !_filaRodando, null, { timeout: 8000 })
  await page.evaluate(() => rodarFila())
}

async function digitarPin(page, pin) {
  for (const d of pin) await page.locator(`#pin-keypad [data-v="${d}"]`).click()
}

// 1º acesso: senha → cria PIN → início
async function primeiroAcesso(page) {
  await page.locator('#tela-login').waitFor({ state: 'visible' })
  await page.fill('#login-email', 'aplicadora@sema.invalid')
  await page.fill('#login-senha', 'senha-certa')
  await page.click('#btn-login')
  await page.locator('#tela-pin').waitFor({ state: 'visible' })
  await expect(page.locator('#pin-dica')).toContainText('Crie')
  await digitarPin(page, '1234')
  await expect(page.locator('#pin-dica')).toContainText('mesmo PIN')
  await digitarPin(page, '1234')
  await page.locator('#tela-home').waitFor({ state: 'visible' })
}

// entrevista completa, do início à revisão
async function entrevistar(page) {
  await page.click('[data-nova="0"]')
  await page.locator('#tela-ficha').waitFor({ state: 'visible' })
  // onde e quando: a campanha exige município — sem ele não avança
  await page.click('#btn-ficha-avancar')
  await expect(page.locator('#local-msg')).toContainText('município')
  await page.selectOption('select[data-f="cd_mun"]', '1200401')
  await page.selectOption('select[data-f="comunidade_id"]', 'com-1')
  await page.click('#btn-ficha-avancar')
  // aviso
  await expect(page.locator('.aviso-texto')).toContainText('Este aviso é lido')
  await page.check('input[data-f="aviso_lido"]')
  await page.click('[data-sn="aceitou_participar"][data-v="1"]')
  await page.click('[data-sn="fotos_autorizadas"][data-v="1"]')
  await page.click('#btn-ficha-avancar')
  // bloco Casa: a pergunta da escola só aparece se a lista tiver criança
  await expect(page.locator('.bloco-tit')).toHaveText('Casa')
  await page.fill('[data-k="qtd"]', '3')
  await page.click('[data-acao="adicionar-linha"]')
  await page.fill('#sl-0-nome', 'Ana')
  await page.fill('#sl-0-idade', '40')
  await page.locator('#sl-0-idade').press('Tab')
  await expect(page.locator('[data-chave="escola"]')).toHaveCount(0)
  await page.click('[data-acao="adicionar-linha"]')
  await page.fill('#sl-1-idade', '8')
  await page.locator('#sl-1-idade').press('Tab')
  await expect(page.locator('[data-chave="tem_crianca"] .sq-calc')).toContainText('Sim')
  await expect(page.locator('[data-chave="escola"]')).toHaveCount(1)
  await page.click('[data-chave="escola"] input[value="sim"]')
  await page.click('#btn-ficha-avancar')
  // bloco Água: "Outro" pede o especifique
  await page.click('[data-chave="agua"] input[value="outro"]')
  await page.fill('[data-k="agua_outro"]', 'Cacimba')
  await page.click('#btn-ficha-avancar')
  // identificação (nome opcional) e fotos
  await page.fill('input[data-f="entrevistado_nome"]', 'Ana da Silva')
  await page.click('#btn-ficha-avancar')
  await page.setInputFiles('#in-galeria', FOTO)
  await expect(page.locator('.foto-item')).toHaveCount(1)
  await page.click('#btn-ficha-avancar')
  await expect(page.locator('#ficha-passo')).toContainText('Revisão')
}

test('1º acesso: login, PIN, campanhas do pacote', async ({ page }) => {
  const { erros } = await abrir(page)
  await primeiroAcesso(page)
  await expect(page.locator('#home-campanhas')).toContainText('Diagnóstico de domicílios')
  await expect(page.locator('#home-campanhas')).toContainText('Campanha Juruá 2026')
  await expect(page.locator('#home-treino-sec')).toBeVisible()
  expect(erros).toEqual([])
})

test('entrevista inteira sem rede, guardada a cada passo, e enviada uma vez só', async ({ page }) => {
  const { rede, erros } = await abrir(page)
  await primeiroAcesso(page)
  rede.on = false
  await entrevistar(page)
  // a revisão aponta o que diverge da lista (qtd 3 × 2 listados) e o que ficou em branco
  await expect(page.locator('#ficha-corpo')).toContainText('diz 3, mas a lista tem 2')
  await expect(page.locator('#ficha-corpo')).toContainText('P6 em branco')
  await page.click('#btn-ficha-avancar')       // Concluir e enviar
  await page.locator('#tela-fila').waitFor({ state: 'visible' })
  await expect(page.locator('#fila-lista')).toContainText('Aguardando envio')

  const local = await page.evaluate(async () => (await sOfflineListarFichas())[0])
  expect(local.estado).toBe('pendente')
  expect(local.codigo).toMatch(/^DSA-\d{6}-[A-Z0-9]{4}-01$/)
  expect(local.respostas_norm).toMatchObject({ qtd: 3, tem_crianca: 'sim', escola: 'sim', agua: 'outro', agua_outro: 'Cacimba' })
  expect(local.linhas).toHaveLength(2)
  expect(local.linhas[0]).toMatchObject({ ordem: 1, nome: 'Ana', idade: 40, e_entrevistado: true })
  expect(await page.evaluate(() => __srv.chamadas.filter(c => c.nome === 'socio_enviar_ficha').length)).toBe(0)

  // volta a internet: sobe a foto e chama a RPC uma vez; a 1ª tentativa cai
  await page.evaluate(() => { __srv.falhaRede = 1 })
  rede.on = true
  await filaRodar(page)
  expect((await page.evaluate(async () => (await sOfflineListarFichas())[0])).estado).toBe('pendente')
  await filaRodar(page)
  await expect.poll(async () => (await page.evaluate(async () => (await sOfflineListarFichas())[0])).estado).toBe('enviada')

  const srv = await page.evaluate(() => __srv)
  const envios = srv.chamadas.filter(c => c.nome === 'socio_enviar_ficha')
  expect(envios).toHaveLength(2)                                    // a que caiu + a que valeu
  const p = envios[1].args
  expect(p.p_ficha.uuid_cliente).toBe(local.uuid_cliente)
  expect(p.p_ficha.codigo).toBe(local.codigo)
  expect(p.p_ficha).toMatchObject({ campanha_id: 'c-1', questionario_id: 'q-1', treino: false, cd_mun: '1200401',
    comunidade_id: 'com-1', aceitou_participar: true, fotos_autorizadas: true, entrevistado_nome: 'Ana da Silva' })
  expect(p.p_ficha.lat).toBeUndefined()                             // o questionário não pede GPS
  expect(p.p_linhas).toHaveLength(2)
  expect(srv.uploads).toHaveLength(1)
  expect(srv.uploads[0].bucket).toBe('socio-fotos')
  expect(srv.uploads[0].caminho.startsWith(local.uuid_cliente + '/')).toBe(true)
  expect(p.p_fotos).toHaveLength(1)
  expect(p.p_fotos[0].arquivo_url).toContain('/socio-fotos/' + srv.uploads[0].caminho)

  // rodar de novo não reenvia nada
  await filaRodar(page)
  expect(await page.evaluate(() => __srv.chamadas.filter(c => c.nome === 'socio_enviar_ficha').length)).toBe(2)
  expect(await page.evaluate(() => __srv.uploads.length)).toBe(1)
  expect(erros).toEqual([])
})

test('sair no meio guarda a entrevista; ela continua de onde parou', async ({ page }) => {
  const { rede } = await abrir(page)
  await primeiroAcesso(page)
  rede.on = false
  await page.click('[data-nova="0"]')
  await page.selectOption('select[data-f="cd_mun"]', '1200401')
  await page.click('#btn-ficha-sair')
  await page.locator('#tela-home').waitFor({ state: 'visible' })
  await expect(page.locator('#home-avisos')).toContainText('em andamento')
  await page.reload()
  // reabre pelo PIN, sem rede
  await page.locator('#tela-pin').waitFor({ state: 'visible' })
  await digitarPin(page, '1234')
  await page.locator('#tela-home').waitFor({ state: 'visible' })
  await expect(page.locator('#home-campanhas')).toContainText('Campanha Juruá 2026')   // pacote guardado no aparelho
  await page.click('[data-tela="tela-fila"]')
  await page.click('[data-continuar]')
  await expect(page.locator('select[data-f="cd_mun"]')).toHaveValue('1200401')
})

test('erro do banco deixa a ficha "com problema", visível e corrigível — nunca some', async ({ page }) => {
  const { rede } = await abrir(page)
  await primeiroAcesso(page)
  rede.on = false
  await entrevistar(page)
  await page.evaluate(() => { __srv.erroBanco = 'socio:fora_do_periodo: a entrevista foi concluída fora do período da campanha' })
  await page.click('#btn-ficha-avancar')
  await page.locator('#tela-fila').waitFor({ state: 'visible' })
  rede.on = true
  await filaRodar(page)
  await expect(page.locator('#fila-lista')).toContainText('Com problema')
  await expect(page.locator('#fila-lista .fila-erro')).toHaveText('a entrevista foi concluída fora do período da campanha')
  const f = await page.evaluate(async () => (await sOfflineListarFichas())[0])
  expect(f.estado).toBe('erro')
  // corrigir reabre a mesma ficha (mesmo uuid e código) e reenvia
  await page.evaluate(() => { __srv.erroBanco = null })
  await page.click('[data-corrigir]')
  await page.locator('#tela-ficha').waitFor({ state: 'visible' })
  for (let i = 0; i < 8; i++) {
    const t = await page.locator('#ficha-passo').innerText()
    if (t.includes('Revisão')) break
    await page.click('#btn-ficha-avancar')
    await expect.poll(() => page.locator('#ficha-passo').innerText()).not.toBe(t)
  }
  await page.click('#btn-ficha-avancar')
  await page.locator('#tela-fila').waitFor({ state: 'visible' })
  await filaRodar(page)
  const envios = await page.evaluate(() => __srv.chamadas.filter(c => c.nome === 'socio_enviar_ficha').map(c => c.args.p_ficha))
  expect(envios.at(-1).uuid_cliente).toBe(f.uuid_cliente)
  expect(envios.at(-1).codigo).toBe(f.codigo)
  expect(envios.at(-1).finalizada_em).toBe(f.finalizada_em)        // a hora da entrevista não muda na correção
  expect((await page.evaluate(async () => (await sOfflineListarFichas())[0])).estado).toBe('enviada')
})

test('treino com recusa: código TRE-, sem campanha e sem nenhuma resposta', async ({ page }) => {
  await abrir(page)
  await primeiroAcesso(page)
  await page.click('[data-treino="0"]')
  await expect(page.locator('#ficha-passo .selo-treino')).toBeVisible()
  await page.click('#btn-ficha-avancar')
  await page.check('input[data-f="aviso_lido"]')
  await page.click('[data-sn="aceitou_participar"][data-v="0"]')
  await page.click('#btn-ficha-avancar')
  await expect(page.locator('#btn-ficha-avancar')).toHaveText('Registrar recusa')
  await page.click('#btn-ficha-avancar')
  await page.locator('#tela-fila').waitFor({ state: 'visible' })
  await filaRodar(page)
  const p = await page.evaluate(() => __srv.chamadas.filter(c => c.nome === 'socio_enviar_ficha').at(-1).args)
  expect(p.p_ficha.codigo).toMatch(/^TRE-/)
  expect(p.p_ficha.treino).toBe(true)
  expect(p.p_ficha.campanha_id).toBeNull()
  expect(p.p_ficha.aceitou_participar).toBe(false)
  expect(p.p_ficha.respostas).toEqual({})
  expect(p.p_linhas).toEqual([])
  expect(p.p_fotos).toEqual([])
})

test('ficha devolvida pelo gestor volta para correção com o motivo', async ({ page }) => {
  const { rede } = await abrir(page)
  await primeiroAcesso(page)
  rede.on = false
  await entrevistar(page)
  await page.click('#btn-ficha-avancar')
  await page.locator('#tela-fila').waitFor({ state: 'visible' })
  rede.on = true
  await filaRodar(page)
  const f = await page.evaluate(async () => (await sOfflineListarFichas())[0])
  await page.evaluate((u) => {
    __srv.pacote = Object.assign({}, __srv.pacote, { minhas_fichas: [{ uuid_cliente: u, codigo: 'X', status: 'devolvida', motivo_devolucao: 'Faltou a idade da 2ª pessoa' }] })
  }, f.uuid_cliente)
  await page.evaluate(() => baixarPacote())
  await page.click('[data-tela="tela-fila"]')
  await expect(page.locator('#fila-lista')).toContainText('Faltou a idade da 2ª pessoa')
  await expect(page.locator('[data-corrigir]')).toHaveText('Corrigir e reenviar')
})

test('PIN errado não abre; sem rede o PIN abre com os dados do aparelho', async ({ page }) => {
  const { rede } = await abrir(page)
  await primeiroAcesso(page)
  rede.on = false
  await page.reload()
  await page.locator('#tela-pin').waitFor({ state: 'visible' })
  await digitarPin(page, '9999')
  await expect(page.locator('#pin-erro')).toHaveText('PIN incorreto.')
  await expect(page.locator('#tela-home')).toBeHidden()
  await digitarPin(page, '1234')
  await page.locator('#tela-home').waitFor({ state: 'visible' })
  await expect(page.locator('#chip-con')).toHaveText('Offline')
})

test('alvos de toque e página sem rolagem lateral no celular', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const { rede } = await abrir(page)
  await primeiroAcesso(page)
  rede.on = false
  await entrevistar(page)
  const larg = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(larg).toBeLessThanOrEqual(360)
  await page.click('#btn-ficha-voltar'); await page.click('#btn-ficha-voltar'); await page.click('#btn-ficha-voltar'); await page.click('#btn-ficha-voltar')
  await expect(page.locator('.bloco-tit')).toHaveText('Casa')
  const pequenos = await page.evaluate(() => Array.from(document.querySelectorAll('#tela-ficha button, #tela-ficha input:not([type=radio]):not([type=checkbox]), #tela-ficha select, .sq-op'))
    .filter(el => el.offsetParent).map(el => el.getBoundingClientRect()).filter(r => r.width < 24 || r.height < 24).length)
  expect(pequenos).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})
