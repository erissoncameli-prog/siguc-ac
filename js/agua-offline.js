// ── SIGUC Qualidade da Água — IndexedDB (offline durável) ─────
// Molde de js/brigada-offline.js, simplificado: uma coleta não tem
// filhos (fauna/participantes do Brigadas) — é uma linha só, campo e
// laboratório juntos (mesmo desenho de agua_coletas, migration 248).
// Estados: pendente → enviando → confirmado. Confirmados retidos 7
// dias como backup; pendentes nunca apagados.

const DB_NAME    = 'siguc_agua_v1'
const DB_VERSION = 1
let _db = null

// ── Inicialização ─────────────────────────────────────────────
function aOfflineInit() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = ev => {
      const db = ev.target.result

      // Fila principal de coletas
      if (!db.objectStoreNames.contains('registros')) {
        const s = db.createObjectStore('registros', { keyPath: 'uuid_cliente' })
        s.createIndex('status', 'status')
        s.createIndex('criado_em', 'criado_em')
      }

      // Cache offline dos pontos de coleta (agua_pontos_coleta)
      if (!db.objectStoreNames.contains('pontos')) {
        db.createObjectStore('pontos', { keyPath: 'id' })
      }

      // Configurações do app (PIN hash, dados do coletor, última sync, logos)
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config')
      }
    }

    req.onsuccess = ev => { _db = ev.target.result; resolve(_db) }
    req.onerror   = ev => reject(ev.target.error)
  })
}

// ── Persistência de armazenamento ─────────────────────────────
async function aOfflinePersistir() {
  if (!navigator.storage?.persist) return false
  const ok = await navigator.storage.persist()
  await aOfflineSetConfig('persistencia_concedida', ok)
  return ok
}

async function aOfflineQuota() {
  if (!navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return {
    usado: e.usage ?? 0,
    total: e.quota ?? 0,
    pct: e.quota ? Math.round((e.usage / e.quota) * 100) : 0,
  }
}

// ── Config (chave-valor) ──────────────────────────────────────
async function aOfflineGetConfig(chave) {
  const db = await aOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('config', 'readonly')
    const req = tx.objectStore('config').get(chave)
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

async function aOfflineSetConfig(chave, valor) {
  const db = await aOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('config', 'readwrite')
    const req = tx.objectStore('config').put(valor, chave)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

// ── Blob → base64 data-URL (compatível com IndexedDB no iOS) ─
// Mesma lição do Brigadas: Blobs do IndexedDB ficam inválidos depois
// que o app vai para background — nunca persistir Blob cru.
function aOfflineBlobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ── Salvar coleta ──────────────────────────────────────────────
async function aOfflineSalvar(registro) {
  const db = await aOfflineInit()
  const foto64 = (registro.foto_blob instanceof Blob)
    ? await aOfflineBlobParaBase64(registro.foto_blob)
    : (registro.foto_blob || null)

  const payload = {
    ...registro,
    status:    'pendente',
    criado_em: new Date().toISOString(),
    foto_blob: foto64,
  }

  return new Promise((res, rej) => {
    const tx  = db.transaction('registros', 'readwrite')
    tx.objectStore('registros').put(payload)
    tx.oncomplete = () => res(payload)
    tx.onerror    = () => rej(tx.error)
  })
}

// ── Leitura ───────────────────────────────────────────────────
async function aOfflineListarPendentes() {
  const db = await aOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('registros', 'readonly')
    const req = tx.objectStore('registros').index('status').getAll(IDBKeyRange.bound('pendente', 'pendente'))
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

async function aOfflineListarTodos() {
  const db = await aOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('registros', 'readonly')
    const req = tx.objectStore('registros').getAll()
    req.onsuccess = () => res((req.result || []).sort((a, b) => b.criado_em.localeCompare(a.criado_em)))
    req.onerror   = () => rej(req.error)
  })
}

// ── Atualização de status ─────────────────────────────────────
async function aOfflineMarcar(uuid_cliente, status, extra = {}) {
  const db = await aOfflineInit()
  return new Promise((res, rej) => {
    const tx    = db.transaction('registros', 'readwrite')
    const store = tx.objectStore('registros')
    const get   = store.get(uuid_cliente)
    get.onsuccess = () => {
      if (!get.result) { res(); return }
      store.put({ ...get.result, status, ...extra })
    }
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

// ── Purga: remove confirmados com > 7 dias ────────────────────
async function aOfflinePurgar() {
  const db     = await aOfflineInit()
  const limite = new Date(Date.now() - 7 * 86400 * 1000).toISOString()
  return new Promise((res, rej) => {
    const tx  = db.transaction('registros', 'readwrite')
    const req = tx.objectStore('registros').index('status').openCursor(IDBKeyRange.only('confirmado'))
    req.onsuccess = ev => {
      const c = ev.target.result
      if (!c) return
      if (c.value.sincronizado_em && c.value.sincronizado_em < limite) c.delete()
      c.continue()
    }
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

// ── Zera a fila (reset) ───────────────────────────────────────
async function aOfflineZerarFila() {
  const db = await aOfflineInit()
  return new Promise((res, rej) => {
    const tx = db.transaction('registros', 'readwrite')
    tx.objectStore('registros').clear()
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

// ── Cache offline dos pontos de coleta ────────────────────────
async function aOfflineSalvarPontos(lista) {
  const db = await aOfflineInit()
  return new Promise((res, rej) => {
    const tx = db.transaction('pontos', 'readwrite')
    tx.objectStore('pontos').clear()
    lista.forEach(p => tx.objectStore('pontos').put(p))
    tx.oncomplete = () => res(lista.length)
    tx.onerror    = () => rej(tx.error)
  })
}

async function aOfflineListarPontos() {
  const db = await aOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('pontos', 'readonly')
    const req = tx.objectStore('pontos').getAll()
    req.onsuccess = () => res((req.result || []).sort((a, b) => (a.nome || '').localeCompare(b.nome || '')))
    req.onerror   = () => rej(req.error)
  })
}
