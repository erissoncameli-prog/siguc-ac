// ── SIGUC Brigadas — Service Worker ───────────────────────────
const CACHE = 'siguc-brigadas-v240'

const APP_SHELL = [
  '/pages/brigada.html',
  '/css/brigada.css',
  '/css/global.css',
  '/js/config.js',
  '/js/brigada-offline.js',
  '/js/brigada-sync.js',
  '/js/brigada-captura.js',
  '/js/brigada-area.js',
  '/js/brigada-fauna.js',
  '/js/brigada-participantes.js',
  '/pages/frota-app.html',
  '/js/frota-offline.js',
  '/js/frota-sync.js',
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
]

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

// ── Activate: remove caches antigos ─────────────────────────
self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
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

  // App shell: cache-first, atualiza em background
  ev.respondWith(
    caches.match(ev.request).then(cached => {
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
    self.registration.showNotification(data.title ?? 'SIGUC Brigadas', {
      body: data.body ?? '',
      icon: '/pwa/icons/icon-192.png',
      badge: '/pwa/icons/icon-192.png',
      data: data.url ?? '/pages/brigada.html',
    })
  )
})

self.addEventListener('notificationclick', ev => {
  ev.notification.close()
  ev.waitUntil(self.clients.openWindow(ev.notification.data))
})
