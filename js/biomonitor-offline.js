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
const BIO_DB_VERSION = 6
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

      if (!db.objectStoreNames.contains('lotes')) {
        const l = db.createObjectStore('lotes', { keyPath: 'uuid_cliente' })
        l.createIndex('ninho_uuid',  'ninho_uuid')
        l.createIndex('status_sync', 'status_sync')
        l.createIndex('status',      'status')
      }

      if (!db.objectStoreNames.contains('solturas')) {
        const s = db.createObjectStore('solturas', { keyPath: 'uuid_cliente' })
        s.createIndex('ninho_uuid',  'ninho_uuid')
        s.createIndex('lote_uuid',   'lote_uuid')
        s.createIndex('status_sync', 'status_sync')
      }

      if (!db.objectStoreNames.contains('bercarios_cache')) {
        const bc = db.createObjectStore('bercarios_cache', { keyPath: 'id' })
        bc.createIndex('status', 'status')
      }

      if (!db.objectStoreNames.contains('ocorrencias')) {
        const oc = db.createObjectStore('ocorrencias', { keyPath: 'uuid_cliente' })
        oc.createIndex('lote_uuid',   'lote_uuid')
        oc.createIndex('status_sync', 'status_sync')
      }

      if (!db.objectStoreNames.contains('descartes')) {
        const d = db.createObjectStore('descartes', { keyPath: 'uuid_cliente' })
        d.createIndex('ninho_uuid',  'ninho_uuid')
        d.createIndex('status_sync', 'status_sync')
      }

      if (!db.objectStoreNames.contains('individuos')) {
        const i = db.createObjectStore('individuos', { keyPath: 'uuid_cliente' })
        i.createIndex('lote_uuid',   'lote_uuid')
        i.createIndex('status_sync', 'status_sync')
        i.createIndex('status',      'status')
      }

      if (!db.objectStoreNames.contains('biometrias_ind')) {
        const bi = db.createObjectStore('biometrias_ind', { keyPath: 'uuid_cliente' })
        bi.createIndex('individuo_uuid', 'individuo_uuid')
        bi.createIndex('status_sync',    'status_sync')
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

async function bioOfflineListarNinhos({ praiaId, praiaAtualId, status, statusSync } = {}) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('ninhos', 'readonly')
    const req = tx.objectStore('ninhos').getAll()
    req.onsuccess = () => {
      let lista = req.result
      if (praiaId)      lista = lista.filter(n => n.praia_id === praiaId)
      // praia onde incuba agora (com fallback p/ origem em registros antigos)
      if (praiaAtualId) lista = lista.filter(n => (n.praia_atual_id ?? n.praia_id) === praiaAtualId)
      if (status)       lista = lista.filter(n => n.status === status)
      if (statusSync)   lista = lista.filter(n => n.status_sync === statusSync)
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

// ── Descartes de ovos (com motivo) ────────────────────────────
async function bioOfflineSalvarDescarte(descarte) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('descartes', 'readwrite')
    const req = tx.objectStore('descartes').put(descarte)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineDescartesDoNinho(ninhoUuid, etapa) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('descartes', 'readonly')
    const idx = tx.objectStore('descartes').index('ninho_uuid')
    const req = idx.getAll(ninhoUuid)
    req.onsuccess = () => {
      let lista = req.result ?? []
      if (etapa) lista = lista.filter(d => d.etapa === etapa)
      res(lista)
    }
    req.onerror = () => rej(req.error)
  })
}

async function bioOfflineDescartesPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('descartes', 'readonly')
    const idx = tx.objectStore('descartes').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// Remove os descartes locais de um ninho numa etapa (usado ao reeditar:
// apaga o conjunto antigo antes de regravar o novo).
async function bioOfflineRemoverDescartesDoNinho(ninhoUuid, etapa) {
  const lista = await bioOfflineDescartesDoNinho(ninhoUuid, etapa)
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx = db.transaction('descartes', 'readwrite')
    const st = tx.objectStore('descartes')
    lista.forEach(d => st.delete(d.uuid_cliente))
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

// ── Lotes em berçário ─────────────────────────────────────────
async function bioOfflineSalvarLote(lote) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('lotes', 'readwrite')
    const req = tx.objectStore('lotes').put(lote)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineGetLote(uuid) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('lotes', 'readonly')
    const req = tx.objectStore('lotes').get(uuid)
    req.onsuccess = () => res(req.result ?? null)
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineLotesAtivos() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('lotes', 'readonly')
    const idx = tx.objectStore('lotes').index('status')
    const req = idx.getAll('ativo')
    req.onsuccess = () => {
      const lista = req.result
      lista.sort((a, b) => b.data_entrada.localeCompare(a.data_entrada))
      res(lista)
    }
    req.onerror = () => rej(req.error)
  })
}

async function bioOfflineLotesPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('lotes', 'readonly')
    const idx = tx.objectStore('lotes').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Solturas de filhotes ──────────────────────────────────────
async function bioOfflineSalvarSoltura(sol) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('solturas', 'readwrite')
    const req = tx.objectStore('solturas').put(sol)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineSolturasPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('solturas', 'readonly')
    const idx = tx.objectStore('solturas').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Berçários (cache do servidor) ─────────────────────────────
async function bioOfflineSalvarBercarios(lista) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx = db.transaction('bercarios_cache', 'readwrite')
    const st = tx.objectStore('bercarios_cache')
    lista.forEach(b => st.put(b))
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

async function bioOfflineListarBercarios() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('bercarios_cache', 'readonly')
    const req = tx.objectStore('bercarios_cache').getAll()
    req.onsuccess = () => res(req.result.filter(b => b.status === true))
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineGetBercario(id) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('bercarios_cache', 'readonly')
    const req = tx.objectStore('bercarios_cache').get(id)
    req.onsuccess = () => res(req.result ?? null)
    req.onerror   = () => rej(req.error)
  })
}

// ── Ocorrências do berçário ────────────────────────────────────
async function bioOfflineSalvarOcorrencia(oc) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('ocorrencias', 'readwrite')
    const req = tx.objectStore('ocorrencias').put(oc)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineOcorrenciasDoLote(loteUuid) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('ocorrencias', 'readonly')
    const idx = tx.objectStore('ocorrencias').index('lote_uuid')
    const req = idx.getAll(loteUuid)
    req.onsuccess = () => {
      const lista = req.result
      lista.sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? ''))
      res(lista)
    }
    req.onerror = () => rej(req.error)
  })
}

async function bioOfflineOcorrenciasPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('ocorrencias', 'readonly')
    const idx = tx.objectStore('ocorrencias').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Filhotes individuais do berçário ───────────────────────────
async function bioOfflineSalvarIndividuo(ind) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('individuos', 'readwrite')
    const req = tx.objectStore('individuos').put(ind)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

// Gera e salva N indivíduos numerados 1..qtd para um lote recém-criado.
async function bioOfflineGerarIndividuosDoLote(loteUuid, qtd, monitorId) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx = db.transaction('individuos', 'readwrite')
    const st = tx.objectStore('individuos')
    for (let numero = 1; numero <= qtd; numero++) {
      st.put({
        uuid_cliente: bioUuid(),
        lote_uuid:    loteUuid,
        numero,
        status:       'ativo',
        monitor_id:   monitorId,
        status_sync:  'pendente',
        criado_em:    new Date().toISOString(),
      })
    }
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

async function bioOfflineGetIndividuo(uuid) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('individuos', 'readonly')
    const req = tx.objectStore('individuos').get(uuid)
    req.onsuccess = () => res(req.result ?? null)
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineIndividuosDoLote(loteUuid) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('individuos', 'readonly')
    const idx = tx.objectStore('individuos').index('lote_uuid')
    const req = idx.getAll(loteUuid)
    req.onsuccess = () => {
      const lista = req.result
      lista.sort((a, b) => a.numero - b.numero)
      res(lista)
    }
    req.onerror = () => rej(req.error)
  })
}

async function bioOfflineIndividuosPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('individuos', 'readonly')
    const idx = tx.objectStore('individuos').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Biometria individual ───────────────────────────────────────
async function bioOfflineSalvarBiometriaInd(b) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('biometrias_ind', 'readwrite')
    const req = tx.objectStore('biometrias_ind').put(b)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

async function bioOfflineBiometriasDoIndividuo(individuoUuid) {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('biometrias_ind', 'readonly')
    const idx = tx.objectStore('biometrias_ind').index('individuo_uuid')
    const req = idx.getAll(individuoUuid)
    req.onsuccess = () => {
      const lista = req.result
      lista.sort((a, b) => (b.data_medicao + (b.hora_medicao || '')).localeCompare(a.data_medicao + (a.hora_medicao || '')))
      res(lista)
    }
    req.onerror = () => rej(req.error)
  })
}

async function bioOfflineBiometriasIndPendentes() {
  const db = await bioOfflineInit()
  return new Promise((res, rej) => {
    const tx  = db.transaction('biometrias_ind', 'readonly')
    const idx = tx.objectStore('biometrias_ind').index('status_sync')
    const req = idx.getAll('pendente')
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

// ── Contagem de itens pendentes ────────────────────────────────
async function bioOfflineContarPendentes() {
  const [n, t, e, v, l, s, oc, ind, bi] = await Promise.all([
    bioOfflineNinhosPendentes(),
    bioOfflineTransfPendentes(),
    bioOfflineEclosoesPendentes(),
    bioOfflineVisitasPendentes(),
    bioOfflineLotesPendentes(),
    bioOfflineSolturasPendentes(),
    bioOfflineOcorrenciasPendentes(),
    bioOfflineIndividuosPendentes(),
    bioOfflineBiometriasIndPendentes(),
  ])
  const erros = await bioOfflineTodosComErro()
  return n.length + t.length + e.length + v.length + l.length + s.length + oc.length
    + ind.length + bi.length + erros.length
}

// Stores com fila de sync (label amigável do tipo de registro)
const _BIO_STORES_SYNC = {
  ninhos: 'Ninho', transferencias: 'Transferência', eclosoes: 'Eclosão',
  visitas: 'Visita', lotes: 'Berçário', solturas: 'Soltura', ocorrencias: 'Ocorrência',
  individuos: 'Filhote', biometrias_ind: 'Biometria individual',
}

// Varre todos os stores e devolve os registros marcados como 'erro'
// (falharam 3+ vezes), com o tipo e o motivo — para a tela de Fila.
async function bioOfflineTodosComErro() {
  const db = await bioOfflineInit()
  const out = []
  for (const store of Object.keys(_BIO_STORES_SYNC)) {
    if (!db.objectStoreNames.contains(store)) continue
    const items = await new Promise((res) => {
      const tx  = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).getAll()
      req.onsuccess = () => res((req.result || []).filter(x => x.status_sync === 'erro'))
      req.onerror   = () => res([])
    })
    items.forEach(it => out.push({ store, tipo: _BIO_STORES_SYNC[store], item: it }))
  }
  return out
}

// Reenfileira todos os registros em 'erro' (volta a 'pendente').
async function bioOfflineReenfileirarErros() {
  const erros = await bioOfflineTodosComErro()
  for (const { store, item } of erros) await bioOfflineReenfileirar(store, item.uuid_cliente)
  return erros.length
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
      if (novoStatus === 'confirmado') {
        item.sincronizado_em = new Date().toISOString()
        item.sync_erro = null            // limpa erro anterior ao confirmar
        item.sync_tentativas = 0
      }
      st.put(item)
      tx.oncomplete = () => res()
    }
    req.onerror = () => rej(req.error)
  })
}

// Marca um registro que falhou no envio: guarda o motivo e conta as
// tentativas. Após 3 falhas vira 'erro' (para de tentar sozinho e fica
// visível na fila com o motivo + "tentar de novo"); antes disso volta a
// 'pendente' e o sync tenta de novo (recupera falha passageira). NUNCA
// lança — o chamador segue para o próximo registro.
async function bioOfflineMarcarErroSync(store, uuid, motivo) {
  const db = await bioOfflineInit()
  return new Promise((res) => {
    const tx  = db.transaction(store, 'readwrite')
    const st  = tx.objectStore(store)
    const req = st.get(uuid)
    req.onsuccess = () => {
      const item = req.result
      if (!item) { res(); return }
      item.sync_tentativas = (item.sync_tentativas || 0) + 1
      item.sync_erro       = String(motivo || 'falha no envio').slice(0, 300)
      item.status_sync     = item.sync_tentativas >= 3 ? 'erro' : 'pendente'
      st.put(item)
      tx.oncomplete = () => res()
    }
    req.onerror = () => res()
  })
}

// Reenfileira um registro em 'erro' (botão "tentar de novo"): volta a
// 'pendente' e zera o contador de tentativas.
async function bioOfflineReenfileirar(store, uuid) {
  const db = await bioOfflineInit()
  return new Promise((res) => {
    const tx  = db.transaction(store, 'readwrite')
    const st  = tx.objectStore(store)
    const req = st.get(uuid)
    req.onsuccess = () => {
      const item = req.result
      if (!item) { res(); return }
      item.status_sync = 'pendente'
      item.sync_tentativas = 0
      st.put(item)
      tx.oncomplete = () => res()
    }
    req.onerror = () => res()
  })
}

// ── Limpar confirmados antigos (> 7 dias) ──────────────────────
async function bioOfflineLimparConfirmados() {
  const db     = await bioOfflineInit()
  const limite = new Date(Date.now() - 7 * 86400 * 1000).toISOString()
  const stores = ['ninhos', 'transferencias', 'eclosoes', 'visitas', 'lotes', 'solturas', 'ocorrencias', 'descartes']
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
  const stores = ['ninhos', 'transferencias', 'eclosoes', 'visitas', 'lotes', 'solturas', 'ocorrencias', 'descartes']
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
