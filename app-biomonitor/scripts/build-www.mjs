// ── SIGUC Biomonitor — monta o www/ do app nativo ─────────────
// Fonte única: os mesmos arquivos servidos em siguc-ac.vercel.app.
// Diferenças aplicadas para o app:
//   1. Supabase JS embarcado (sem CDN — funciona offline desde o 1º uso)
//   2. Fontes DM Sans / DM Mono / Fraunces embarcadas (sem Google Fonts)
//   3. Sem manifest PWA (o shell nativo substitui o service worker)

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))   // app-biomonitor/
const RAIZ = dirname(APP)                                        // raiz do repo
const WWW  = join(APP, 'www')

// ── Transpila JS para rodar em WebViews antigas (aparelhos de campo) ──
// O app suporta Android 7+ (minSdk 24), cujo "Android System WebView" pode
// estar em versões antigas (Chrome ~58–84) se o usuário nunca o atualizou.
// A lib @supabase/supabase-js moderna usa sintaxe ES2020/ES2021 (?. ?? ||= &&=)
// e QUEBRA ao ser carregada nessas WebViews: o parse falha, window.supabase
// fica como stub e o login trava mostrando "Sem conexão". Baixamos toda a
// sintaxe para ES2017 (Chrome 58+) — inclui a lib e o nosso próprio JS, que
// também usa ?. e ?? — para o app abrir e logar nesses aparelhos.
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

// ── JS compartilhado (transpilado para ES2017) ────────────────
for (const f of ['config.js', 'fotos-privadas.js', 'avatar-foto.js', 'lgpd.js', 'lgpd-campo.js', 'qrcode-generator.js', 'biomonitor-offline.js', 'biomonitor-sync.js', 'biomonitor-alertas.js', 'brigada-captura.js', 'biomonitor-timeline.js', 'biomonitor-pdf-fonts.js', 'biomonitor-relatorio-ninho.js', 'compartilhar-arquivo.js', 'biomonitor-relatorio-campo.js', 'biomonitor-equipamentos.js', 'biomonitor-quelonios.js']) {
  copiarJsTranspilado(join(RAIZ, 'js', f), join(WWW, 'js', f))
}

// ── Logo do Biomonitor (telas de login/bloqueio) ──────────────
mkdirSync(join(WWW, 'pwa/icons'), { recursive: true })
cpSync(join(RAIZ, 'pwa/icons/biomonitor-logo.png'), join(WWW, 'pwa/icons/biomonitor-logo.png'))

// ── CSS (remove @import do Google Fonts — fontes são locais) ──
let css = readFileSync(join(RAIZ, 'css', 'biomonitor.css'), 'utf8')
css = css.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);?\n?/g, '')
writeFileSync(join(WWW, 'css', 'biomonitor.css'), css)
cpSync(join(RAIZ, 'css', 'avatar-foto.css'), join(WWW, 'css', 'avatar-foto.css'))

// ── Vendor: Supabase UMD (transpilado para ES2017) + fontes ────
copiarJsTranspilado(join(APP, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), join(WWW, 'vendor/supabase.js'))

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

// ── HTML: biomonitor.html → index.html com rewrites do app ────
let html = readFileSync(join(RAIZ, 'pages', 'biomonitor.html'), 'utf8')

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
    console.error(`ERRO: padrão não encontrado em biomonitor.html: ${padrao}`)
    process.exit(1)
  }
  html = html.replace(padrao, sub)
}

// Carimbo de versão (exibido na tela Config do app; lido por bioVersaoBuild)
const versao = process.env.APP_VERSION_NAME ?? 'dev'
html = html.replace('</head>', `<script>window.BIO_BUILD='v${versao} (app)'</script>\n</head>`)

// ── Credenciais Supabase embarcadas no build (login offline-first) ──
// O app nativo roda em https://localhost e não alcança o /api/env do próprio
// bundle; buscar em runtime na produção se mostrou frágil (a WebView pode
// bloquear a chamada cross-origin, deixando o login travado em "Entrando…").
// Aqui buscamos a config pública (URL + anon key) UMA vez, no build — o runner
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
for (const f of ['index.html', 'vendor/supabase.js', 'vendor/fonts.css', 'css/biomonitor.css', 'css/avatar-foto.css', 'js/config.js', 'js/fotos-privadas.js', 'js/avatar-foto.js', 'js/lgpd.js', 'js/lgpd-campo.js', 'js/qrcode-generator.js', 'js/biomonitor-timeline.js', 'js/biomonitor-pdf-fonts.js', 'js/biomonitor-relatorio-ninho.js', 'js/compartilhar-arquivo.js', 'js/biomonitor-relatorio-campo.js', 'js/biomonitor-equipamentos.js', 'js/biomonitor-quelonios.js', 'pwa/icons/biomonitor-logo.png']) {
  if (!existsSync(join(WWW, f))) { console.error(`ERRO: faltando www/${f}`); process.exit(1) }
}
const indexFinal = readFileSync(join(WWW, 'index.html'), 'utf8')
// Todo <script src="/js/…"> referenciado precisa ter sido embarcado — senão
// vira 404 silencioso na WebView e a funcionalidade morre em campo (mesma
// trava do app/scripts/build-www.mjs do Brigadas — foi exatamente a falta
// dela aqui que deixou fotos-privadas.js/lgpd.js/lgpd-campo.js/
// qrcode-generator.js de fora por várias entregas sem o build quebrar).
for (const m of indexFinal.matchAll(/<script src="\/js\/([^"]+)"/g)) {
  if (!existsSync(join(WWW, 'js', m[1]))) {
    console.error(`ERRO: index.html referencia /js/${m[1]}, mas o arquivo não foi embarcado (adicione à lista de cópia)`)
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
// quebravam o supabase.js em WebViews < 85. São sinais confiáveis (não
// aparecem em strings do app), então servem de trava contra regressão do
// alvo de transpilação. O esbuild também baixa ?. e ?? (ES2020) no mesmo passo.
for (const f of ['vendor/supabase.js', 'js/config.js', 'js/fotos-privadas.js', 'js/avatar-foto.js', 'js/lgpd.js', 'js/lgpd-campo.js', 'js/qrcode-generator.js', 'js/biomonitor-quelonios.js', 'js/biomonitor-sync.js', 'js/biomonitor-offline.js', 'js/biomonitor-alertas.js', 'js/brigada-captura.js', 'js/biomonitor-timeline.js', 'js/biomonitor-pdf-fonts.js', 'js/biomonitor-relatorio-ninho.js', 'js/compartilhar-arquivo.js', 'js/biomonitor-relatorio-campo.js', 'js/biomonitor-equipamentos.js']) {
  const js = readFileSync(join(WWW, f), 'utf8')
  const proibidos = js.match(/\|\|=|&&=|\?\?=/g)
  if (proibidos) {
    console.error(`ERRO: ${f} ainda contém operadores ES2021 após transpilar (${[...new Set(proibidos)].join(' ')}) — quebraria em WebView antiga`)
    process.exit(1)
  }
}
console.log(`www/ (biomonitor) montado com sucesso (offline-first, sem CDN, login embarcado, JS transpilado p/ ${ALVO_JS}).`)
