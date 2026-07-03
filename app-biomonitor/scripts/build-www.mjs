// ── SIGUC Biomonitor — monta o www/ do app nativo ─────────────
// Fonte única: os mesmos arquivos servidos em siguc-ac.vercel.app.
// Diferenças aplicadas para o app:
//   1. Supabase JS embarcado (sem CDN — funciona offline desde o 1º uso)
//   2. Fontes DM Sans / DM Mono / Fraunces embarcadas (sem Google Fonts)
//   3. Sem manifest PWA (o shell nativo substitui o service worker)

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))   // app-biomonitor/
const RAIZ = dirname(APP)                                        // raiz do repo
const WWW  = join(APP, 'www')

rmSync(WWW, { recursive: true, force: true })
mkdirSync(join(WWW, 'css'),          { recursive: true })
mkdirSync(join(WWW, 'js'),           { recursive: true })
mkdirSync(join(WWW, 'vendor/fonts'), { recursive: true })

// ── JS compartilhado (idêntico ao site) ───────────────────────
for (const f of ['config.js', 'biomonitor-offline.js', 'biomonitor-sync.js', 'biomonitor-alertas.js', 'brigada-captura.js', 'biomonitor-quelonios.js']) {
  cpSync(join(RAIZ, 'js', f), join(WWW, 'js', f))
}

// ── Logo do Biomonitor (telas de login/bloqueio) ──────────────
mkdirSync(join(WWW, 'pwa/icons'), { recursive: true })
cpSync(join(RAIZ, 'pwa/icons/biomonitor-logo.png'), join(WWW, 'pwa/icons/biomonitor-logo.png'))

// ── CSS (remove @import do Google Fonts — fontes são locais) ──
let css = readFileSync(join(RAIZ, 'css', 'biomonitor.css'), 'utf8')
css = css.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);?\n?/g, '')
writeFileSync(join(WWW, 'css', 'biomonitor.css'), css)

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

writeFileSync(join(WWW, 'index.html'), html)

// ── Sanidade ───────────────────────────────────────────────────
for (const f of ['index.html', 'vendor/supabase.js', 'vendor/fonts.css', 'css/biomonitor.css', 'js/config.js', 'js/biomonitor-quelonios.js', 'pwa/icons/biomonitor-logo.png']) {
  if (!existsSync(join(WWW, f))) { console.error(`ERRO: faltando www/${f}`); process.exit(1) }
}
if (/cdn\.jsdelivr|fonts\.googleapis/.test(readFileSync(join(WWW, 'index.html'), 'utf8'))) {
  console.error('ERRO: index.html ainda referencia CDN externo')
  process.exit(1)
}
console.log('www/ (biomonitor) montado com sucesso (offline-first, sem CDN).')
