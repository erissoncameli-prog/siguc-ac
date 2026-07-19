// ── SIGUC Frota — IndexedDB (offline durável) ──────────────────
// Fila de ações do motorista (check-out/check-in/viagem direta),
// não de documentos: cada ação referencia uma viagem já existente
// no servidor (exceto abrir_direta, que cria a viagem no momento
// da sincronização). Estados: pendente → enviando → confirmado.

const F_DB_NAME    = 'siguc_frota_v1'
const F_DB_VERSION = 1
let _fDb = null

function fOfflineInit() {
  return new Promise((resolve, reject) => {
    if (_fDb) { resolve(_fDb); return }
    const req = indexedDB.open(F_DB_NAME, F_DB_VERSION)

    req.onupgradeneeded = ev => {
      const db = ev.target.result

      // Fila de ações pendentes (checkout/checkin/abrir_direta)
      if (!db.objectStoreNames.contains('acoes')) {
        const s = db.createObjectStore('acoes', { keyPath: 'uuid_cliente' })
        s.createIndex('status', 'status')
        s.createIndex('criado_em', 'criado_em')
      }

      // Configurações do app (última lista de viagens cacheada, etc.)
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config')
      }
    }

    req.onsuccess = ev => { _fDb = ev.target.result; resolve(_fDb) }
    req.onerror   = ev => reject(ev.target.error)
  })
}

// ── Config (chave-valor) ──────────────────────────────────────
async function fOfflineGetConfig(chave) {
  const db = await fOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('config', 'readonly')
    const req = tx.objectStore('config').get(chave)
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

async function fOfflineSetConfig(chave, valor) {
  const db = await fOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('config', 'readwrite')
    const req = tx.objectStore('config').put(valor, chave)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

// ── Cache local de "minhas viagens" (leitura offline) ──────────
async function fOfflineCacheViagens(lista) {
  return fOfflineSetConfig('viagens_cache', { lista, salvo_em: new Date().toISOString() })
}
async function fOfflineViagensCache() {
  const c = await fOfflineGetConfig('viagens_cache')
  return c?.lista || []
}

// ── Fila de ações ───────────────────────────────────────────────
function _fUuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'f-' + Date.now() + '-' + Math.random().toString(16).slice(2)
}

// tipo: 'checkout' | 'checkin' | 'abrir_direta' | 'abastecimento'
// fotos (só usado por 'abastecimento'): { cupom, hodometro } em base64
// data-URL — sobem para o Storage no sync, antes da chamada da RPC.
async function fOfflineEnfileirar(tipo, payload, fotos) {
  const db = await fOfflineInit()
  const acao = {
    uuid_cliente: payload.p_uuid_cliente || _fUuid(),
    tipo,
    payload,
    fotos: fotos || null,
    status: 'pendente',
    criado_em: new Date().toISOString(),
  }
  return new Promise((res, rej) => {
    const tx  = db.transaction('acoes', 'readwrite')
    tx.objectStore('acoes').put(acao)
    tx.oncomplete = () => res(acao)
    tx.onerror    = () => rej(tx.error)
  })
}

async function fOfflineListarPendentes() {
  const db = await fOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('acoes', 'readonly')
    const req = tx.objectStore('acoes').index('status').getAll(IDBKeyRange.only('pendente'))
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

async function fOfflineListarTodos() {
  const db = await fOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('acoes', 'readonly')
    const req = tx.objectStore('acoes').getAll()
    req.onsuccess = () => res((req.result || []).sort((a,b) => b.criado_em.localeCompare(a.criado_em)))
    req.onerror   = () => rej(req.error)
  })
}

async function fOfflineContarPendentes() {
  const pend = await fOfflineListarPendentes()
  return pend.length
}

async function fOfflineMarcar(uuid_cliente, status, extra = {}) {
  const db = await fOfflineInit()
  return new Promise((res, rej) => {
    const tx    = db.transaction('acoes', 'readwrite')
    const store = tx.objectStore('acoes')
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
async function fOfflinePurgar() {
  const db     = await fOfflineInit()
  const limite = new Date(Date.now() - 7 * 86400 * 1000).toISOString()
  return new Promise((res, rej) => {
    const tx  = db.transaction('acoes', 'readwrite')
    const req = tx.objectStore('acoes').index('status').openCursor(IDBKeyRange.only('confirmado'))
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

// ── Zera fila local (Config → "Zerar fila") ───────────────────
async function fOfflineZerarFila() {
  const db = await fOfflineInit()
  return new Promise((res, rej) => {
    const tx = db.transaction('acoes', 'readwrite')
    tx.objectStore('acoes').clear()
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}
