// ── SIGUC Qualidade da Água — monta o www/ do app nativo ──────
// Fonte única: os mesmos arquivos servidos em siguc-ac.vercel.app.
// Molde de app/scripts/build-www.mjs (Brigadas) — mesmas 3 diferenças
// aplicadas para o app:
//   1. Supabase JS embarcado (sem CDN — funciona offline desde o 1º uso)
//   2. Fontes DM Sans / DM Mono / Fraunces embarcadas (sem Google Fonts)
//   3. Sem manifest PWA (o shell nativo substitui o service worker)

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const APP  = dirname(dirname(fileURLToPath(import.meta.url)))   // app-agua/
const RAIZ = dirname(APP)                                        // raiz do repo
const WWW  = join(APP, 'www')

// ── Transpila JS para rodar em WebViews antigas (aparelhos de campo) ──
// Mesmo motivo do Brigadas/Biomonitor: minSdk 24 pode ter WebView com
// Chrome ~58-84, que não entende ?. ?? ||= &&= das libs modernas.
const ALVO_JS = 'es2017'
function copiarJsTranspilado (src, dest) {
  const code = readFileSync(src, 'utf8')
  const out  = transformSync(code, { target: ALVO_JS, loader: 'js', legalComments: 'none' }).code
  writeFileSync(dest, out)
}

rmSync(WWW, { recursive: true, force: true })
mkdirSync(join(WWW, 'css'),          { recursive: true })
mkdirSync(join(WWW, 'js/vendor'),    { recursive: true })
mkdirSync(join(WWW, 'vendor/fonts'), { recursive: true })

// ── JS compartilhado (transpilado para ES2017) ────────────────
for (const f of ['config.js', 'fotos-privadas.js', 'lgpd.js', 'lgpd-campo.js', 'qrcode-generator.js', 'agua-offline.js', 'agua-sync.js', 'brigada-captura.js', 'agua-iqa-visual.js', 'agua-rio.js', 'config-sistema.js', 'biomonitor-pdf-fonts.js', 'relatorio-cabecalho-pdf.js', 'agua-relatorio-dados.js', 'agua-relatorio-pdf.js', 'compartilhar-arquivo.js']) {
  copiarJsTranspilado(join(RAIZ, 'js', f), join(WWW, 'js', f))
}
// js/vendor/ — jsPDF + jspdf-autotable, carregados sob demanda por
// _agpdfCarregarLibs() (js/agua-relatorio-pdf.js) só quando a ficha de
// coleta é exportada. Caminho relativo '../js/vendor/…' resolve certo
// mesmo com index.html na raiz do app nativo (RFC 3986 colapsa o '../'
// excedente em vez de estourar acima da raiz — conferido).
for (const f of ['jspdf-2.5.2.umd.min.js', 'jspdf-autotable-3.8.4.min.js']) {
  copiarJsTranspilado(join(RAIZ, 'js/vendor', f), join(WWW, 'js/vendor', f))
}

// ── Imagens referenciadas pelo HTML ───────────────────────────
// O emblema das 4 telas de bloqueio vem de /pwa/icons/. No site esse
// caminho é servido pela Vercel; dentro do shell nativo não existe nada
// fora de www/, então sem esta cópia o app abriria com imagem quebrada
// no login. A trava de sanidade lá embaixo pega o esquecimento se outra
// imagem for referenciada no futuro.
mkdirSync(join(WWW, 'pwa/icons'), { recursive: true })
for (const f of ['icon-agua-512.png']) {
  cpSync(join(RAIZ, 'pwa/icons', f), join(WWW, 'pwa/icons', f))
}

// ── CSS (remove @import do Google Fonts — fontes são locais) ──
let css = readFileSync(join(RAIZ, 'css', 'agua-app.css'), 'utf8')
css = css.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);?\n?/g, '')
writeFileSync(join(WWW, 'css', 'agua-app.css'), css)

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

// ── HTML: agua-app.html → index.html com rewrites do app ──────
let html = readFileSync(join(RAIZ, 'pages', 'agua-app.html'), 'utf8')

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
    console.error(`ERRO: padrão não encontrado em agua-app.html: ${padrao}`)
    process.exit(1)
  }
  html = html.replace(padrao, sub)
}

// Carimbo de versão (exibido na tela Config do app; lido por versaoAtualApp)
const versao = process.env.APP_VERSION_NAME ?? 'dev'
html = html.replace('</head>', `<script>window.AGUA_BUILD='v${versao} (app)'</script>\n</head>`)

// ── Credenciais Supabase embarcadas no build (login offline-first) ──
// Mesmo motivo do Brigadas/Biomonitor: o app roda em https://localhost e
// não alcança /api/env do próprio bundle; buscamos a config pública UMA
// vez no build (o runner tem internet) e embarcamos como window.__SIGUC_ENV.
async function obterEnvPublico () {
  const fontes = [
    process.env.SIGUC_ENV_URL,
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
for (const f of ['index.html', 'vendor/supabase.js', 'vendor/fonts.css', 'css/agua-app.css', 'js/config.js', 'js/fotos-privadas.js', 'js/lgpd.js', 'js/lgpd-campo.js', 'js/qrcode-generator.js', 'js/agua-offline.js', 'js/agua-sync.js', 'js/brigada-captura.js', 'js/agua-iqa-visual.js', 'js/agua-rio.js', 'js/config-sistema.js', 'js/biomonitor-pdf-fonts.js', 'js/relatorio-cabecalho-pdf.js', 'js/agua-relatorio-dados.js', 'js/agua-relatorio-pdf.js', 'js/compartilhar-arquivo.js', 'js/vendor/jspdf-2.5.2.umd.min.js', 'js/vendor/jspdf-autotable-3.8.4.min.js']) {
  if (!existsSync(join(WWW, f))) { console.error(`ERRO: faltando www/${f}`); process.exit(1) }
}
const indexFinal = readFileSync(join(WWW, 'index.html'), 'utf8')
// Todo <script src="/js/…"> referenciado precisa ter sido embarcado — senão
// vira 404 silencioso na WebView e a funcionalidade morre em campo (mesma
// trava do app/scripts/build-www.mjs do Brigadas).
for (const m of indexFinal.matchAll(/<script src="\/js\/([^"]+)"/g)) {
  if (!existsSync(join(WWW, 'js', m[1]))) {
    console.error(`ERRO: index.html referencia /js/${m[1]}, mas o arquivo não foi embarcado (adicione à lista de cópia)`)
    process.exit(1)
  }
}
// Mesma trava para imagens: <img src="/…"> não embarcada vira imagem
// quebrada na WebView, sem erro que apareça para ninguém.
for (const m of indexFinal.matchAll(/<img[^>]+src="\/([^"]+)"/g)) {
  if (!existsSync(join(WWW, m[1]))) {
    console.error(`ERRO: index.html referencia /${m[1]}, mas o arquivo não foi embarcado (adicione à lista de cópia)`)
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
// quebravam libs modernas em WebViews < 85.
for (const f of ['vendor/supabase.js', 'js/config.js', 'js/fotos-privadas.js', 'js/lgpd.js', 'js/lgpd-campo.js', 'js/qrcode-generator.js', 'js/agua-offline.js', 'js/agua-sync.js', 'js/brigada-captura.js', 'js/agua-iqa-visual.js', 'js/agua-rio.js', 'js/config-sistema.js', 'js/biomonitor-pdf-fonts.js', 'js/relatorio-cabecalho-pdf.js', 'js/agua-relatorio-dados.js', 'js/agua-relatorio-pdf.js', 'js/compartilhar-arquivo.js', 'js/vendor/jspdf-2.5.2.umd.min.js', 'js/vendor/jspdf-autotable-3.8.4.min.js']) {
  const js = readFileSync(join(WWW, f), 'utf8')
  const proibidos = js.match(/\|\|=|&&=|\?\?=/g)
  if (proibidos) {
    console.error(`ERRO: ${f} ainda contém operadores ES2021 após transpilar (${[...new Set(proibidos)].join(' ')}) — quebraria em WebView antiga`)
    process.exit(1)
  }
}
console.log(`www/ (agua) montado com sucesso (offline-first, sem CDN, login embarcado, JS transpilado p/ ${ALVO_JS}).`)
