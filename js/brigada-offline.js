// ── SIGUC Brigadas — IndexedDB (offline durável) ──────────────
// Estados: pendente → enviando → confirmado
// Confirmados retidos 7 dias como backup; pendentes nunca apagados.

const DB_NAME    = 'siguc_brigadas_v1'
const DB_VERSION = 1
let _db = null

// ── Inicialização ─────────────────────────────────────────────
function bOfflineInit() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = ev => {
      const db = ev.target.result

      // Fila principal de registros de campo
      if (!db.objectStoreNames.contains('registros')) {
        const s = db.createObjectStore('registros', { keyPath: 'uuid_cliente' })
        s.createIndex('status', 'status')
        s.createIndex('criado_em', 'criado_em')
      }

      // Sub-registros de fauna (ligados a uuid_cliente do registro pai)
      if (!db.objectStoreNames.contains('fauna')) {
        const f = db.createObjectStore('fauna', { keyPath: 'id', autoIncrement: true })
        f.createIndex('registro_uuid', 'registro_uuid')
      }

      // Catálogo offline de espécies (JSON cacheado)
      if (!db.objectStoreNames.contains('especies')) {
        db.createObjectStore('especies', { keyPath: 'id' })
      }

      // Configurações do app (PIN hash, dados do brigadista/brigada, última sync)
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config')
      }
    }

    req.onsuccess = ev => { _db = ev.target.result; resolve(_db) }
    req.onerror   = ev => reject(ev.target.error)
  })
}

// ── Persistência de armazenamento ─────────────────────────────
async function bOfflinePersistir() {
  if (!navigator.storage?.persist) return false
  const ok = await navigator.storage.persist()
  await bOfflineSetConfig('persistencia_concedida', ok)
  return ok
}

async function bOfflineQuota() {
  if (!navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return {
    usado: e.usage ?? 0,
    total: e.quota ?? 0,
    pct: e.quota ? Math.round((e.usage / e.quota) * 100) : 0,
  }
}

// ── Config (chave-valor) ──────────────────────────────────────
async function bOfflineGetConfig(chave) {
  const db = await bOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('config', 'readonly')
    const req = tx.objectStore('config').get(chave)
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

async function bOfflineSetConfig(chave, valor) {
  const db = await bOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('config', 'readwrite')
    const req = tx.objectStore('config').put(valor, chave)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

// ── Blob → base64 data-URL (compatível com IndexedDB no iOS) ─
function bOfflineBlobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ── Salvar registro (escrita atômica) ─────────────────────────
// Fotos salvas como base64 para evitar Blob detachment no iOS:
// Blobs do IndexedDB ficam inválidos após o app ir para background.
async function bOfflineSalvar(registro) {
  const db = await bOfflineInit()

  // Converter Blobs para base64 antes de persistir (iOS Blob detachment fix)
  const toBs64 = b => (b instanceof Blob) ? bOfflineBlobParaBase64(b) : Promise.resolve(b)

  const fotos64 = await Promise.all((registro.fotos_blobs ?? []).map(toBs64))

  // Converter fotos de fauna também
  const faunaRaw = registro._fauna ?? []
  const fauna64  = await Promise.all(faunaRaw.map(async f => {
    const ff = await Promise.all((f.fotos_blobs ?? []).map(toBs64))
    return { ...f, fotos_blobs: ff }
  }))

  return new Promise((res, rej) => {
    const tx = db.transaction(['registros', 'fauna'], 'readwrite')

    const payload = {
      ...registro,
      status:    'pendente',
      criado_em: new Date().toISOString(),
      fotos_blobs: fotos64,
    }
    delete payload._fauna

    const r1 = tx.objectStore('registros').put(payload)

    // Fauna: remove entradas antigas do mesmo uuid_cliente e reinsere
    const fStore = tx.objectStore('fauna')
    const idx    = fStore.index('registro_uuid')
    const cursor = idx.openCursor(IDBKeyRange.only(registro.uuid_cliente))
    cursor.onsuccess = ev => {
      const c = ev.target.result
      if (c) { c.delete(); c.continue() }
    }

    fauna64.forEach(f => fStore.add({ ...f, registro_uuid: registro.uuid_cliente }))

    tx.oncomplete = () => res(payload)
    tx.onerror    = () => rej(tx.error)
  })
}

// ── Leitura ───────────────────────────────────────────────────
async function bOfflineListarPendentes() {
  const db = await bOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('registros', 'readonly')
    const req = tx.objectStore('registros').index('status').getAll(IDBKeyRange.bound('pendente', 'pendente'))
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

async function bOfflineListarTodos() {
  const db = await bOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('registros', 'readonly')
    const req = tx.objectStore('registros').getAll()
    req.onsuccess = () => res((req.result || []).sort((a,b) => b.criado_em.localeCompare(a.criado_em)))
    req.onerror   = () => rej(req.error)
  })
}

async function bOfflineFaunaDeRegistro(uuid_cliente) {
  const db = await bOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('fauna', 'readonly')
    const req = tx.objectStore('fauna').index('registro_uuid').getAll(uuid_cliente)
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Atualização de status ─────────────────────────────────────
async function bOfflineMarcar(uuid_cliente, status, extra = {}) {
  const db = await bOfflineInit()
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
async function bOfflinePurgar() {
  const db     = await bOfflineInit()
  const limite = new Date(Date.now() - 7 * 86400 * 1000).toISOString()
  return new Promise((res, rej) => {
    const tx  = db.transaction(['registros', 'fauna'], 'readwrite')
    const req = tx.objectStore('registros').index('status').openCursor(IDBKeyRange.only('confirmado'))
    req.onsuccess = ev => {
      const c = ev.target.result
      if (!c) return
      if (c.value.sincronizado_em && c.value.sincronizado_em < limite) {
        const uuid = c.value.uuid_cliente
        c.delete()
        tx.objectStore('fauna').index('registro_uuid').openCursor(IDBKeyRange.only(uuid)).onsuccess = fc => {
          const fc2 = fc.target.result; if (fc2) { fc2.delete(); fc2.continue() }
        }
      }
      c.continue()
    }
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

// ── Reset de 'enviando' → 'pendente' ─────────────────────────
// Chamado no início de cada ciclo de sync para recuperar registros
// que ficaram presos como 'enviando' se o app fechar durante a sync.
async function bOfflineResetEnviando() {
  const db = await bOfflineInit()
  return new Promise((res, rej) => {
    const tx    = db.transaction('registros', 'readwrite')
    const store = tx.objectStore('registros')
    const req   = store.index('status').openCursor(IDBKeyRange.only('enviando'))
    req.onsuccess = ev => {
      const c = ev.target.result
      if (!c) return
      store.put({ ...c.value, status: 'pendente', ultimo_erro: 'Sync interrompida — tentando novamente' })
      c.continue()
    }
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

// ── Zera todos os registros e fauna (reset de fila) ──────────
async function bOfflineZerarFila() {
  const db = await bOfflineInit()
  return new Promise((res, rej) => {
    const tx = db.transaction(['registros', 'fauna'], 'readwrite')
    tx.objectStore('registros').clear()
    tx.objectStore('fauna').clear()
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

// ── Export manual (arquivo JSON para WhatsApp/Drive) ──────────
async function bOfflineExportar() {
  const pendentes = await bOfflineListarPendentes()
  if (!pendentes.length) return null
  const dados = pendentes.map(r => {
    const { fotos_blobs, ...rest } = r
    return { ...rest, fotos_count: (fotos_blobs ?? []).length }
  })
  const blob = new Blob([JSON.stringify({ exportado_em: new Date().toISOString(), registros: dados }, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `brigada-pendentes-${new Date().toISOString().slice(0,10)}.json`,
  })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return dados.length
}

// ── Catálogo de espécies ──────────────────────────────────────
async function bOfflineSalvarEspecies(lista) {
  const db = await bOfflineInit()
  return new Promise((res, rej) => {
    const tx = db.transaction('especies', 'readwrite')
    lista.forEach(e => tx.objectStore('especies').put(e))
    tx.oncomplete = () => res(lista.length)
    tx.onerror    = () => rej(tx.error)
  })
}

async function bOfflineBuscarEspecies(query) {
  const db = await bOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('especies', 'readonly')
    const req = tx.objectStore('especies').getAll()
    req.onsuccess = () => {
      const q = (query || '').toLowerCase()
      if (!q) { res([]); return }
      res((req.result || []).filter(e =>
        e.nome_cientifico?.toLowerCase().includes(q) ||
        (e.nomes_populares || []).some(n => n.toLowerCase().includes(q))
      ).slice(0, 10))
    }
    req.onerror = () => rej(req.error)
  })
}
