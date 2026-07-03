// ── SIGUC Brigadas — monta o www/ do app nativo ───────────────
// Fonte única: os mesmos arquivos servidos em siguc-ac.vercel.app.
// Diferenças aplicadas para o app:
//   1. Supabase JS embarcado (sem CDN — funciona offline desde o 1º uso)
//   2. Fontes DM Sans / DM Mono / Fraunces embarcadas (sem Google Fonts)
//   3. Sem manifest PWA (o shell nativo substitui o service worker)
//   4. Credenciais Supabase embarcadas — no APK a WebView roda em
//      https://localhost e /api/env NÃO existe (é função serverless da
//      Vercel). Sem isso, config.js não obtém URL/anon key, `db` fica
//      null e o login mostra "Sem conexão" mesmo online. São valores
//      PÚBLICOS (anon key), os mesmos já servidos ao navegador.

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Env Supabase para embarcar (override por variável de ambiente no CI;
// fallback = valores públicos já presentes em vercel.json / config.js).
const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://atqtybcsvepdabsvgaly.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cXR5YmNzdmVwZGFic3ZnYWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjMzNzgsImV4cCI6MjA5NTk5OTM3OH0.hWx1AB2rK7xdco1Dgagm0XUOBPQbxZVE614SW4SKoLk'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))   // app/
const RAIZ = dirname(APP)                                        // raiz do repo
const WWW  = join(APP, 'www')

rmSync(WWW, { recursive: true, force: true })
mkdirSync(join(WWW, 'css'),          { recursive: true })
mkdirSync(join(WWW, 'js'),           { recursive: true })
mkdirSync(join(WWW, 'vendor/fonts'), { recursive: true })

// ── JS compartilhado (idêntico ao site) ───────────────────────
for (const f of ['config.js', 'brigada-offline.js', 'brigada-sync.js', 'brigada-captura.js', 'brigada-area.js', 'brigada-fauna.js', 'brigada-participantes.js']) {
  cpSync(join(RAIZ, 'js', f), join(WWW, 'js', f))
}

// ── Mascote (faixa institucional, telas de bloqueio e vídeo) ──
mkdirSync(join(WWW, 'pwa/icons'), { recursive: true })
cpSync(join(RAIZ, 'pwa/icons/mascote.png'), join(WWW, 'pwa/icons/mascote.png'))
cpSync(join(RAIZ, 'pwa/icons/mascote-copa.png'), join(WWW, 'pwa/icons/mascote-copa.png'))
cpSync(join(RAIZ, 'pwa/icons/cbmac.jpg'), join(WWW, 'pwa/icons/cbmac.jpg'))
cpSync(join(RAIZ, 'pwa/mascote-video.mp4'), join(WWW, 'pwa/mascote-video.mp4'))

// ── Figuras da fauna amazônica (seletor de classe) ────────────
mkdirSync(join(WWW, 'pwa/icons/fauna'), { recursive: true })
for (const f of ['mamifero', 'ave', 'reptil', 'anfibio', 'peixe', 'invertebrado']) {
  cpSync(join(RAIZ, `pwa/icons/fauna/${f}.png`), join(WWW, `pwa/icons/fauna/${f}.png`))
}

// ── Municípios do Acre (município no card de GPS, offline) ────
mkdirSync(join(WWW, 'data'), { recursive: true })
cpSync(join(RAIZ, 'data/municipios_acre.geojson'), join(WWW, 'data/municipios_acre.geojson'))

// ── CSS (remove @import do Google Fonts — fontes são locais) ──
let css = readFileSync(join(RAIZ, 'css', 'brigada.css'), 'utf8')
css = css.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);?\n?/g, '')
writeFileSync(join(WWW, 'css', 'brigada.css'), css)

// ── Vendor: Supabase UMD + fontes ──────────────────────────────
cpSync(join(APP, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), join(WWW, 'vendor/supabase.js'))

const FONTES = [
  ['@fontsource/dm-sans',  'dm-sans',  'DM Sans',  [400, 500, 600, 700]],
  ['@fontsource/dm-mono',  'dm-mono',  'DM Mono',  [400, 500]],
  ['@fontsource/fraunces', 'fraunces', 'Fraunces', [700]],
]
let fontsCss = '/* Fontes embarcadas — geradas por build-www.mjs */\n'
for (const [pkg, slug, familia, pesos] of FONTES) {
  for (const peso of pesos) {
    const arquivo = `${slug}-latin-${peso}-normal.woff2`
    cpSync(join(APP, 'node_modules', pkg, 'files', arquivo), join(WWW, 'vendor/fonts', arquivo))
    fontsCss += `@font-face{font-family:'${familia}';font-style:normal;font-weight:${peso};font-display:swap;src:url('/vendor/fonts/${arquivo}') format('woff2')}\n`
  }
}
writeFileSync(join(WWW, 'vendor/fonts.css'), fontsCss)

// ── HTML: brigada.html → index.html com rewrites do app ───────
let html = readFileSync(join(RAIZ, 'pages', 'brigada.html'), 'utf8')

const rewrites = [
  // manifest PWA não se aplica dentro do shell nativo
  [/\s*<link rel="manifest"[^>]*>/, ''],
  // Google Fonts → fontes locais
  [/\s*<link rel="preconnect"[^>]*fonts\.googleapis\.com[^>]*>/, ''],
  [/<link href="https:\/\/fonts\.googleapis\.com[^"]*"[^>]*>/, '<link rel="stylesheet" href="/vendor/fonts.css">'],
  // Supabase CDN → bundle embarcado
  [/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"[^>]*>/, '<script src="/vendor/supabase.js">'],
]
for (const [padrao, sub] of rewrites) {
  if (!padrao.test(html)) {
    console.error(`ERRO: padrão não encontrado em brigada.html: ${padrao}`)
    process.exit(1)
  }
  html = html.replace(padrao, sub)
}

// Env Supabase embarcado: pré-resolve _sigucEnvPromise ANTES de config.js
// (scripts do <head> rodam antes dos do <body>), evitando o fetch('/api/env')
// que falha na WebView do APK (https://localhost, sem serverless).
const envInject =
  `<script>window._sigucEnvPromise=Promise.resolve(` +
  `{supabaseUrl:${JSON.stringify(SUPABASE_URL)},supabaseKey:${JSON.stringify(SUPABASE_ANON_KEY)}});</script>`

// Carimbo de versão (exibido na tela Config do app)
const versao = process.env.APP_VERSION_NAME ?? 'dev'
html = html.replace('</head>', `${envInject}\n<script>window.BRIGADA_BUILD='v${versao} (app)'</script>\n</head>`)

writeFileSync(join(WWW, 'index.html'), html)

// ── Sanidade ───────────────────────────────────────────────────
for (const f of ['index.html', 'vendor/supabase.js', 'vendor/fonts.css', 'css/brigada.css', 'js/config.js']) {
  if (!existsSync(join(WWW, f))) { console.error(`ERRO: faltando www/${f}`); process.exit(1) }
}
const idxFinal = readFileSync(join(WWW, 'index.html'), 'utf8')
// Todo <script src="/js/…"> referenciado precisa ter sido embarcado — senão
// vira 404 silencioso na WebView e a funcionalidade morre em campo (ex.: o
// "Medir área" quando brigada-area.js ficou de fora da lista de cópia).
for (const m of idxFinal.matchAll(/<script src="\/js\/([^"]+)"/g)) {
  if (!existsSync(join(WWW, 'js', m[1]))) {
    console.error(`ERRO: index.html referencia /js/${m[1]}, mas o arquivo não foi embarcado (adicione à lista de cópia)`)
    process.exit(1)
  }
}
if (/cdn\.jsdelivr|fonts\.googleapis/.test(idxFinal)) {
  console.error('ERRO: index.html ainda referencia CDN externo')
  process.exit(1)
}
if (!idxFinal.includes('_sigucEnvPromise') || !idxFinal.includes(SUPABASE_URL)) {
  console.error('ERRO: credenciais Supabase não foram embarcadas no index.html')
  process.exit(1)
}
console.log('www/ montado com sucesso (offline-first, sem CDN, env embarcado).')
