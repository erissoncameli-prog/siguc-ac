// ── SIGUC — Service Worker (compartilhado por Brigadas, Biomonitor e
// Frota) ─────────────────────────────────────────────────────────
// Um único arquivo, mas cache e versão isolados por app: cada página
// registra este script com um `scope` próprio (ver registerServiceWorker
// em cada .html), e o SW usa esse scope para decidir de qual app se
// trata. Assim, subir a versão de UM app não invalida o cache dos
// outros dois — cada um só apaga caches com o próprio prefixo.

const SCOPE = self.registration.scope
const APP = SCOPE.includes('/pages/biomonitor.html') ? 'biomonitor'
  : SCOPE.includes('/pages/frota-app.html') ? 'frota'
  : 'brigadas'

// Ao concluir uma implementação que toque arquivos web de um app,
// incrementar SÓ o número daquele app (vN → vN+1) — não precisa mexer
// nos outros dois.
const VERSOES = { brigadas: 258, biomonitor: 25, frota: 74 }
const CACHE = `siguc-${APP}-v${VERSOES[APP]}`

const SHELLS = {
  brigadas: [
    '/pages/brigada.html',
    '/css/brigada.css',
    '/css/global.css',
    '/js/config.js',
    '/js/fotos-privadas.js',
    '/js/lgpd.js',
    '/js/lgpd-campo.js',
    '/js/qrcode-generator.js',
    '/js/brigada-offline.js',
    '/js/brigada-sync.js',
    '/js/brigada-captura.js',
    '/js/brigada-area.js',
    '/js/brigada-fauna.js',
    '/js/brigada-participantes.js',
    '/pwa/icons/mascote.png',
    '/pwa/icons/mascote-copa.png',
    '/pwa/icons/cbmac.jpg',
    '/data/municipios_acre.geojson',
    '/pwa/icons/fauna/mamifero.png',
    '/pwa/icons/fauna/ave.png',
    '/pwa/icons/fauna/reptil.png',
    '/pwa/icons/fauna/anfibio.png',
    '/pwa/icons/fauna/peixe.png',
    '/pwa/icons/fauna/invertebrado.png',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  ],
  biomonitor: [
    '/pages/biomonitor.html',
    '/css/biomonitor.css',
    '/js/config.js',
    '/js/fotos-privadas.js',
    '/js/lgpd.js',
    '/js/lgpd-campo.js',
    '/js/qrcode-generator.js',
    '/js/biomonitor-offline.js',
    '/js/biomonitor-sync.js',
    '/js/biomonitor-alertas.js',
    '/js/brigada-captura.js',
    '/js/biomonitor-timeline.js',
    '/js/biomonitor-pdf-fonts.js',
    '/js/biomonitor-relatorio-ninho.js',
    '/js/biomonitor-relatorio-campo.js',
    '/js/biomonitor-equipamentos.js',
    '/js/biomonitor-quelonios.js',
    '/pwa/icons/biomonitor-logo.png',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  ],
  frota: [
    '/pages/frota-app.html',
    '/pwa/icons/logo-frota.png',
    '/css/global.css',
    '/css/frota-wise-theme.css',
    '/js/observability.js',
    '/js/queryLogger.js',
    '/js/config.js',
    '/js/qrcode-generator.js',
    '/js/layout.js',
    '/js/frota-wise.js',
    '/js/frota-offline.js',
    '/js/frota-sync.js',
    '/js/frota-notif-local.js',
    '/js/fotos-privadas.js',
    '/js/lgpd.js',
    '/js/lgpd-campo.js',
    '/js/frota-consumo.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  ],
}
const APP_SHELL = SHELLS[APP]

// ── Install: pré-cache do app shell (resiliente a falhas de CDN) ─
self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(APP_SHELL.map(url => c.add(url)))
    ).then(() => self.skipWaiting())
  )
})

// ── Mensagem do app: ativar nova versão imediatamente ───────
self.addEventListener('message', ev => {
  if (ev.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// ── Activate: remove só caches antigos DESTE app (não mexe no
// cache dos outros dois, que compartilham o mesmo Cache Storage
// de origem) ─────────────────────────────────────────────────
self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(`siguc-${APP}-`) && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

// ── Fetch: cache-first para assets; network-first para API ───
self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url)

  // Supabase, config de ambiente e chamadas dinâmicas de API (ex.: POST
  // /api/overpass): network-first sem cache. Tiles GET de /api/ seguem no
  // fluxo cache-first abaixo (bom para /api/mapbiomas-tile e /api/meteo).
  if (url.hostname.endsWith('.supabase.co') || url.pathname === '/api/env'
      || (url.pathname.startsWith('/api/') && ev.request.method !== 'GET')) {
    ev.respondWith(
      fetch(ev.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )
    return
  }

  // App shell: cache-first, atualiza em background.
  // IMPORTANTE: caches.match(request) sem escopo procura em TODOS os
  // Caches da origem (inclusive dos outros 2 apps, que cacheiam as
  // mesmas URLs compartilhadas como /js/config.js) — isso quebrava o
  // isolamento por app documentado no topo do arquivo, podendo servir
  // um asset velho de um app desatualizado para outro já atualizado.
  // Restringe a busca só ao cache da versão atual DESTE app.
  ev.respondWith(
    caches.open(CACHE).then(c => c.match(ev.request)).then(cached => {
      const network = fetch(ev.request).then(resp => {
        if (resp.ok && ev.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(ev.request, resp.clone()))
        }
        return resp
      })
      return cached || network
    })
  )
})

// ── Background Sync: dispara sync nos clientes ───────────────
self.addEventListener('sync', ev => {
  if (ev.tag === 'sync-registros') {
    ev.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then(clients =>
        clients.forEach(c => c.postMessage({ type: 'BACKGROUND_SYNC' }))
      )
    )
  }
})

// ── Push (futuro: notificações de alertas CIGMA) ─────────────
self.addEventListener('push', ev => {
  const data = ev.data?.json() ?? {}
  ev.waitUntil(
    self.registration.showNotification(data.title ?? 'SIGUC', {
      body: data.body ?? '',
      icon: '/pwa/icons/icon-192.png',
      badge: '/pwa/icons/icon-192.png',
      data: { url: data.url ?? '/', notif: data.notif ?? null, meta: data.meta ?? null },
    })
  )
})

// Clique na notificação: se o app já estiver aberto, FOCA a janela e manda
// a notificação por postMessage (o app roteia pelo tipo, sem abrir aba nova
// nem cair no login). Só abre janela nova quando não há app aberto.
// Compat: versões antigas guardavam só a string da URL em `data`.
self.addEventListener('notificationclick', ev => {
  ev.notification.close()
  const d = ev.notification.data
  const url = (d && typeof d === 'object' ? d.url : d) || '/'
  const notif = (d && typeof d === 'object') ? d.notif : null
  const meta = (d && typeof d === 'object') ? d.meta : null
  const base = String(url).split('?')[0]
  ev.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const alvo = wins.find(c => c.url.includes(base))
    if (alvo) {
      await alvo.focus()
      alvo.postMessage({ type: 'NOTIF_OPEN', notif, meta, url })
      return
    }
    await self.clients.openWindow(url)
  })())
})
