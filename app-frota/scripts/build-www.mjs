// ── SIGUC Frota — monta o www/ do app nativo ───────────────────
// Fonte única: os mesmos arquivos servidos em siguc-ac.vercel.app.
// Diferenças aplicadas para o app:
//   1. Supabase JS embarcado (sem CDN — funciona offline desde o 1º uso)
//   2. Fontes Archivo/Inter (tema Frota) + DM Sans/DM Mono/Fraunces (base
//      global.css) embarcadas (sem Google Fonts)
//   3. Sem manifest PWA (o shell nativo substitui o service worker)

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))   // app-frota/
const RAIZ = dirname(APP)                                        // raiz do repo
const WWW  = join(APP, 'www')

// ── Transpila JS para rodar em WebViews antigas (aparelhos de campo) ──
// Mesmo motivo do app Brigadas/Biomonitor: minSdk 24 pode trazer WebView
// antiga (Chrome ~58–84), que quebra com sintaxe ES2020/ES2021 (?. ?? ||=
// &&=) usada pela lib @supabase/supabase-js moderna e pelo nosso próprio JS.
const ALVO_JS = 'es2017'
function copiarJsTranspilado (src, dest) {
  const code = readFileSync(src, 'utf8')
  const out  = transformSync(code, { target: ALVO_JS, loader: 'js', legalComments: 'none' }).code
  writeFileSync(dest, out)
}

rmSync(WWW, { recursive: true, force: true })
mkdirSync(join(WWW, 'css'),          { recursive: true })
mkdirSync(join(WWW, 'js'),           { recursive: true })
mkdirSync(join(WWW, 'vendor/fonts'), { recursive: true })

// ── JS compartilhado (transpilado para ES2017) ─────────────────
// Lista derivada de todo <script src="../js/..."> em pages/frota-app.html.
const ARQUIVOS_JS = [
  'observability.js', 'queryLogger.js', 'config.js', 'lgpd.js', 'lgpd-campo.js',
  'qrcode-generator.js', 'frota-offline.js', 'frota-sync.js', 'frota-notif-local.js', 'layout.js',
  'frota-wise.js', 'fotos-privadas.js', 'frota-consumo.js', 'frota-passageiros.js',
  'frota-viagens-status.js',
]
for (const f of ARQUIVOS_JS) {
  copiarJsTranspilado(join(RAIZ, 'js', f), join(WWW, 'js', f))
}

// ── Logo do Frota (telas de login/bloqueio, se usado) ──────────
mkdirSync(join(WWW, 'pwa/icons'), { recursive: true })
cpSync(join(RAIZ, 'pwa/icons/logo-frota.png'), join(WWW, 'pwa/icons/logo-frota.png'))

// ── CSS (remove @import do Google Fonts — fontes são locais) ──
// Lista derivada de todo <link rel="stylesheet" href="../css/..."> em
// pages/frota-app.html.
const ARQUIVOS_CSS = ['global.css', 'frota-wise-theme.css']
for (const f of ARQUIVOS_CSS) {
  let css = readFileSync(join(RAIZ, 'css', f), 'utf8')
  css = css.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);?\n?/g, '')
  writeFileSync(join(WWW, 'css', f), css)
}

// ── Vendor: Supabase UMD (transpilado para ES2017) + fontes ────
copiarJsTranspilado(join(APP, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), join(WWW, 'vendor/supabase.js'))

// global.css usa DM Sans/DM Mono/Fraunces (base do design system);
// frota-wise-theme.css usa Archivo/Inter (tema próprio do app Frota).
const FONTES = [
  ['@fontsource/dm-sans',  'dm-sans',  'DM Sans',  [300, 400, 500, 600]],
  ['@fontsource/dm-mono',  'dm-mono',  'DM Mono',  [400, 500]],
  ['@fontsource/fraunces', 'fraunces', 'Fraunces', [600, 700]],
  ['@fontsource/archivo',  'archivo',  'Archivo',  [700, 800, 900]],
  ['@fontsource/inter',    'inter',    'Inter',    [400, 500, 600, 700]],
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

// ── HTML: frota-app.html → index.html com rewrites do app ──────
let html = readFileSync(join(RAIZ, 'pages', 'frota-app.html'), 'utf8')

const rewrites = [
  // manifest PWA não se aplica dentro do shell nativo
  [/\s*<link rel="manifest"[^>]*>/, ''],
  // Google Fonts → fontes locais (injeta antes do 1º <link rel="stylesheet">)
  [/<link rel="stylesheet" href="\.\.\/css\/global\.css">/, '<link rel="stylesheet" href="/vendor/fonts.css">\n<link rel="stylesheet" href="/css/global.css">'],
  // Supabase CDN → bundle embarcado
  [/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"[^>]*>/, '<script src="/vendor/supabase.js">'],
]
for (const [padrao, sub] of rewrites) {
  if (!padrao.test(html)) {
    console.error(`ERRO: padrão não encontrado em frota-app.html: ${padrao}`)
    process.exit(1)
  }
  html = html.replace(padrao, sub)
}

// Reescreve os caminhos relativos (../css/, ../js/) para absolutos (/css/, /js/)
// já que index.html vive na raiz do www/, não em pages/.
html = html.replace(/(src|href)="\.\.\/(css|js)\//g, '$1="/$2/')

// Carimbo de versão (exibido na tela Config do app, se lido futuramente)
const versao = process.env.APP_VERSION_NAME ?? 'dev'
html = html.replace('</head>', `<script>window.FROTA_BUILD='v${versao} (app)'</script>\n</head>`)

// ── Credenciais Supabase embarcadas no build (login offline-first) ──
// Mesmo motivo do Biomonitor/Brigadas: o app nativo roda em https://localhost
// e buscar /api/env em runtime na produção se mostrou frágil (WebView pode
// bloquear a chamada cross-origin, travando o login em "Entrando…"). Aqui
// buscamos a config pública (URL + anon key) UMA vez, no build — o runner
// tem internet — e embarcamos como window.__SIGUC_ENV, lido por config.js.
// São credenciais públicas (as mesmas servidas a qualquer visitante do site).
async function obterEnvPublico () {
  const fontes = [
    process.env.SIGUC_ENV_URL,                    // override opcional
    process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
      ? { supabaseUrl: process.env.SUPABASE_URL, supabaseKey: process.env.SUPABASE_ANON_KEY }
      : null,
    'https://siguc-ac.vercel.app/api/env',
  ].filter(Boolean)
  for (const fonte of fontes) {
    try {
      if (typeof fonte === 'object') return fonte
      const r = await fetch(fonte)
      if (!r.ok) continue
      const cfg = await r.json()
      if (cfg && cfg.supabaseUrl && cfg.supabaseKey) return cfg
    } catch { /* tenta a próxima fonte */ }
  }
  return null
}

const env = await obterEnvPublico()
if (!env) {
  console.error('ERRO: não foi possível obter as credenciais públicas do Supabase (/api/env).')
  console.error('      APK abortado para não gerar um build que abre "offline" no login.')
  process.exit(1)
}
const envJson = JSON.stringify({ supabaseUrl: env.supabaseUrl, supabaseKey: env.supabaseKey })
html = html.replace('</head>', `<script>window.__SIGUC_ENV=${envJson}</script>\n</head>`)

writeFileSync(join(WWW, 'index.html'), html)

// ── Sanidade ───────────────────────────────────────────────────
const ARQUIVOS_ESPERADOS = [
  'index.html', 'vendor/supabase.js', 'vendor/fonts.css',
  ...ARQUIVOS_CSS.map(f => `css/${f}`),
  ...ARQUIVOS_JS.map(f => `js/${f}`),
  'pwa/icons/logo-frota.png',
]
for (const f of ARQUIVOS_ESPERADOS) {
  if (!existsSync(join(WWW, f))) { console.error(`ERRO: faltando www/${f}`); process.exit(1) }
}
const indexFinal = readFileSync(join(WWW, 'index.html'), 'utf8')
// Todo <script src="/js/…"> referenciado precisa ter sido embarcado — senão
// vira 404 silencioso na WebView e a funcionalidade morre em campo (mesma
// trava do build-www.mjs do Brigadas/Biomonitor).
for (const m of indexFinal.matchAll(/<script src="\/js\/([^"]+)"/g)) {
  if (!existsSync(join(WWW, 'js', m[1]))) {
    console.error(`ERRO: index.html referencia /js/${m[1]}, mas o arquivo não foi embarcado (adicione à lista ARQUIVOS_JS)`)
    process.exit(1)
  }
}
for (const m of indexFinal.matchAll(/<link rel="stylesheet" href="\/css\/([^"]+)"/g)) {
  if (!existsSync(join(WWW, 'css', m[1]))) {
    console.error(`ERRO: index.html referencia /css/${m[1]}, mas o arquivo não foi embarcado (adicione à lista ARQUIVOS_CSS)`)
    process.exit(1)
  }
}
if (/cdn\.jsdelivr|fonts\.googleapis/.test(indexFinal)) {
  console.error('ERRO: index.html ainda referencia CDN externo')
  process.exit(1)
}
if (!/window\.__SIGUC_ENV=\{.*supabaseUrl.*supabaseKey/.test(indexFinal)) {
  console.error('ERRO: credenciais do Supabase não foram embarcadas no index.html')
  process.exit(1)
}
// Garante que a transpilação removeu os operadores ES2021 (||= &&= ??=) que
// quebravam scripts em WebViews < 85. São sinais confiáveis (não aparecem em
// strings do app), então servem de trava contra regressão do alvo de
// transpilação. O esbuild também baixa ?. e ?? (ES2020) no mesmo passo.
for (const f of ['vendor/supabase.js', ...ARQUIVOS_JS.map(x => `js/${x}`)]) {
  const js = readFileSync(join(WWW, f), 'utf8')
  const proibidos = js.match(/\|\|=|&&=|\?\?=/g)
  if (proibidos) {
    console.error(`ERRO: ${f} ainda contém operadores ES2021 após transpilar (${[...new Set(proibidos)].join(' ')}) — quebraria em WebView antiga`)
    process.exit(1)
  }
}
console.log(`www/ (frota) montado com sucesso (offline-first, sem CDN, login embarcado, JS transpilado p/ ${ALVO_JS}).`)
