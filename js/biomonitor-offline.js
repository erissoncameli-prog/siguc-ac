// ── SIGUC Biomonitor — IndexedDB (offline durável) ────────────
// DB isolado do app Brigadas. Stores:
//   ninhos       — ninhos_quelonios (principal)
//   transferencias — transferencias_ninho
//   eclosoes     — eclosoes_ninho
//   praias       — cache de praias_monitoramento
//   config       — chave-valor (PIN, dados do monitor, etc.)
// Estados da fila: pendente → enviando → confirmado
// Confirmados retidos 7 dias; pendentes nunca apagados.

const BIO_DB_NAME    = 'siguc_biomonitor_v1'
const BIO_DB_VERSION = 2
let _bioDB = null

// ── Inicialização ──────────────────────────────────────────────
function bioOfflineInit() {
  return new Promise((resolve, reject) => {
    if (_bioDB) { resolve(_bioDB); return }
    const req = indexedDB.open(BIO_DB_NAME, BIO_DB_VERSION)

    req.onupgradeneeded = ev => {
      const db = ev.target.result

      if (!db.objectStoreNames.contains('ninhos')) {
        const s = db.createObjectStore('ninhos', { keyPath: 'uuid_cliente' })
        s.createIndex('status',       'status')
        s.createIndex('status_sync',  'status_sync')
        s.createIndex('praia_id',     'praia_id')
        s.createIndex('criado_em',    'criado_em')
      }

      if (!db.objectStoreNames.contains('transferencias')) {
        const t = db.createObjectStore('transferencias', { keyPath: 'uuid_cliente' })
        t.createIndex('ninho_uuid',   'ninho_uuid')
        t.createIndex('status_sync',  'status_sync')
      }

      if (!db.objectStoreNames.contains('eclosoes')) {
        const e = db.createObjectStore('eclosoes', { keyPath: 'uuid_cliente' })
        e.createIndex('ninho_uuid',   'ninho_uuid')
        e.createIndex('status_sync',  'status_sync')
      }

      if (!db.objectStoreNames.contains('praias')) {
        const p = db.createObjectStore('praias', { keyPath: 'id' })
        p.createIndex('uc_id',        'uc_id')
        p.createIndex('programa_id',  'programa_id')
      }

      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config')
      }

      if (!db.objectStoreNames.contains('visitas')) {
        const v = db.createObjectStore('visitas', { keyPath: 'uuid_cliente' })
        v.createIndex('ninho_uuid',  'ninho_uuid')
        v.createIndex('status_sync', 'status_sync')
      }
    }

    req.onsuccess = ev => { _bioDB = ev.target.result; resolve(_bioDB) }
    req.onerror   = ev => reject(ev.target.error)
  })
}

// ── Config (chave-valor) ───────────────────────────────────────
async function bioOfflineGetConfig(chave) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('config', 'readonly')
    const req = tx.objectStore('config').get(chave)
    req.onsuccess = () => res(req.result ?? null)
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineSetConfig(chave, valor) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('config', 'readwrite')
    const req = tx.objectStore('config').put(valor, chave)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineDelConfig(chave) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('config', 'readwrite')
    const req = tx.objectStore('config').delete(chave)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

// ── Praias (cache para uso offline) ───────────────────────────
async function bioOfflineSalvarPraias(lista) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx = db.transaction('praias', 'readwrite')
    const st = tx.objectStore('praias')
    lista.forEach(p => st.put(p))
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

async function bioOfflineListarPraias(grupoProgramaId) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('praias', 'readonly')
    const req = tx.objectStore('praias').getAll()
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineGetPraia(id) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('praias', 'readonly')
    const req = tx.objectStore('praias').get(id)
    req.onsuccess = () => res(req.result ?? null)
    req.onerror   = () => rej(req.error)
  })
}

// ── Ninhos ────────────────────────────────────────────────────
async function bioOfflineSalvarNinho(ninho) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('ninhos', 'readwrite')
    const req = tx.objectStore('ninhos').put(ninho)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineGetNinho(uuid) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('ninhos', 'readonly')
    const req = tx.objectStore('ninhos').get(uuid)
    req.onsuccess = () => res(req.result ?? null)
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineListarNinhos({ praiaId, status, statusSync } = {}) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('ninhos', 'readonly')
    const req = tx.objectStore('ninhos').getAll()
    req.onsuccess = () => {
      let lista = req.result
      if (praiaId)    lista = lista.filter(n => n.praia_id === praiaId)
      if (status)     lista = lista.filter(n => n.status === status)
      if (statusSync) lista = lista.filter(n => n.status_sync === statusSync)
      lista.sort((a, b) => b.criado_em.localeCompare(a.criado_em))
      res(lista)
    }
    req.onerror = () => rej(req.error)
  })
}

async function bioOfflineNinhosPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('ninhos', 'readonly')
    const idx = tx.objectStore('ninhos').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Transferências ────────────────────────────────────────────
async function bioOfflineSalvarTransf(transf) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('transferencias', 'readwrite')
    const req = tx.objectStore('transferencias').put(transf)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineTransfDoNinho(ninhoUuid) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('transferencias', 'readonly')
    const idx = tx.objectStore('transferencias').index('ninho_uuid')
    const req = idx.getAll(ninhoUuid)
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineTransfPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('transferencias', 'readonly')
    const idx = tx.objectStore('transferencias').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Eclosões ──────────────────────────────────────────────────
async function bioOfflineSalvarEclosao(ecl) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('eclosoes', 'readwrite')
    const req = tx.objectStore('eclosoes').put(ecl)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineEclosaoDoNinho(ninhoUuid) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('eclosoes', 'readonly')
    const idx = tx.objectStore('eclosoes').index('ninho_uuid')
    const req = idx.getAll(ninhoUuid)
    req.onsuccess = () => res(req.result[0] ?? null)
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineEclosoesPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('eclosoes', 'readonly')
    const idx = tx.objectStore('eclosoes').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Visitas de acompanhamento ─────────────────────────────────
async function bioOfflineSalvarVisita(visita) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('visitas', 'readwrite')
    const req = tx.objectStore('visitas').put(visita)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineVisitasDoNinho(ninhoUuid) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('visitas', 'readonly')
    const idx = tx.objectStore('visitas').index('ninho_uuid')
    const req = idx.getAll(ninhoUuid)
    req.onsuccess = () => {
      const lista = req.result
      lista.sort((a, b) => b.data_visita.localeCompare(a.data_visita))
      res(lista)
    }
    req.onerror = () => rej(req.error)
  })
}

async function bioOfflineVisitasPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('visitas', 'readonly')
    const idx = tx.objectStore('visitas').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Contagem de itens pendentes ────────────────────────────────
async function bioOfflineContarPendentes() {
  const [n, t, e, v] = await Promise.all([
    bioOfflineNinhosPendentes(),
    bioOfflineTransfPendentes(),
    bioOfflineEclosoesPendentes(),
    bioOfflineVisitasPendentes(),
  ])
  return n.length + t.length + e.length + v.length
}

// ── Atualizar status_sync de um item ──────────────────────────
async function bioOfflineAtualizarSync(store, uuid, novoStatus, serverId) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, 'readwrite')
    const st  = tx.objectStore(store)
    const req = st.get(uuid)
    req.onsuccess = () => {
      const item = req.result
      if (!item) { res(); return }
      item.status_sync   = novoStatus
      if (serverId) item.server_id = serverId
      if (novoStatus === 'confirmado') item.sincronizado_em = new Date().toISOString()
      st.put(item)
      tx.oncomplete = () => res()
    }
    req.onerror = () => rej(req.error)
  })
}

// ── Limpar confirmados antigos (> 7 dias) ──────────────────────
async function bioOfflineLimparConfirmados() {
  const db     = await bioOfflineInit()
  const limite = new Date(Date.now() - 7 * 86400 * 1000).toISOString()
  const stores = ['ninhos', 'transferencias', 'eclosoes', 'visitas']
  let removidos = 0

  for (const nome of stores) {
    const lista = await new Promise((res, rej) => {
      const tx  = db.transaction(nome, 'readonly')
      const idx = tx.objectStore(nome).index('status_sync')
      const req = idx.getAll('confirmado')
      req.onsuccess = () => res(req.result)
      req.onerror   = () => rej(req.error)
    })
    const antigos = lista.filter(i => (i.sincronizado_em ?? '') < limite)
    for (const item of antigos) {
      await new Promise((res, rej) => {
        const tx  = db.transaction(nome, 'readwrite')
        const req = tx.objectStore(nome).delete(item.uuid_cliente)
        req.onsuccess = () => res()
        req.onerror   = () => rej(req.error)
      })
      removidos++
    }
  }
  return removidos
}

// ── Quota de armazenamento ─────────────────────────────────────
async function bioOfflineQuota() {
  if (!navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return {
    usado: e.usage ?? 0,
    total: e.quota ?? 0,
    pct: e.quota ? Math.round((e.usage / e.quota) * 100) : 0,
  }
}

async function bioOfflinePersistir() {
  if (!navigator.storage?.persist) return false
  const ok = await navigator.storage.persist()
  await bioOfflineSetConfig('persistencia_concedida', ok)
  return ok
}

// ── PIN (hash SHA-256 simples) ─────────────────────────────────
async function bioOfflinePinHash(pin) {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode('bio:' + pin)
  )
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function bioOfflineSetPin(pin) {
  await bioOfflineSetConfig('pin_hash', await bioOfflinePinHash(pin))
}

async function bioOfflineVerificarPin(pin) {
  const hash    = await bioOfflinePinHash(pin)
  const salvo   = await bioOfflineGetConfig('pin_hash')
  return hash === salvo
}

async function bioOfflineTemPin() {
  const h = await bioOfflineGetConfig('pin_hash')
  return !!h
}

// ── Zerar fila (suporte à Config → Zerar fila) ────────────────
async function bioOfflineZerarFila() {
  const db     = await bioOfflineInit()
  const stores = ['ninhos', 'transferencias', 'eclosoes', 'visitas']
  for (const nome of stores) {
    await new Promise((res, rej) => {
      const tx  = db.transaction(nome, 'readwrite')
      const req = tx.objectStore(nome).clear()
      req.onsuccess = () => res()
      req.onerror   = () => rej(req.error)
    })
  }
}

// ── UUID v4 ────────────────────────────────────────────────────
function bioUuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}
