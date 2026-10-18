// ── SIGUC-AC · Diagnóstico Socioeconômico — armazenamento no aparelho ──
//
// IndexedDB próprio do app de campo (pages/socio-app.html). Três stores:
//   config  → chave-valor (pacote do servidor, PIN, dispositivo, contadores)
//   fichas  → uma por entrevista, keyPath uuid_cliente. `estado`:
//             rascunho → pendente → (enviando) → enviada | erro
//   fotos   → bytes da foto (ArrayBuffer, NUNCA Blob: Blob no IndexedDB
//             volta vazio no Safari do iPhone — lição do Diagnóstico do
//             dima-plataforma), keyPath uuid_cliente, índice ficha_uuid.
//
// Nada aqui apaga ficha que não foi enviada. Rascunho só sai por escolha
// explícita de quem entrevistou; ficha enviada há mais de 120 dias sai na
// limpeza (o servidor já tem a cópia).

const SOCIO_DB_NOME = 'siguc_socio_v1'
const SOCIO_DB_VERSAO = 1
let _socioDb = null

function sOfflineInit() {
  if (_socioDb) return Promise.resolve(_socioDb)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SOCIO_DB_NOME, SOCIO_DB_VERSAO)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('config')) d.createObjectStore('config')
      if (!d.objectStoreNames.contains('fichas')) d.createObjectStore('fichas', { keyPath: 'uuid_cliente' })
      if (!d.objectStoreNames.contains('fotos')) {
        const f = d.createObjectStore('fotos', { keyPath: 'uuid_cliente' })
        f.createIndex('ficha_uuid', 'ficha_uuid')
      }
    }
    req.onsuccess = () => { _socioDb = req.result; resolve(_socioDb) }
    req.onerror = () => reject(req.error)
  })
}

// pede ao navegador para não despejar o banco em falta de espaço
function sOfflinePersistir() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist() } catch (_) {}
}

function _sTx(store, modo, fn) {
  return sOfflineInit().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(store, modo)
    const st = tx.objectStore(store)
    let res
    const r = fn(st)
    if (r && 'onsuccess' in r) r.onsuccess = () => { res = r.result }
    tx.oncomplete = () => resolve(res)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

// ── config ─────────────────────────────────────────────────────────────
function sOfflineGetConfig(chave) { return _sTx('config', 'readonly', st => st.get(chave)) }
function sOfflineSetConfig(chave, valor) { return _sTx('config', 'readwrite', st => st.put(valor, chave)) }

// identificador curto do aparelho (vai no código da ficha): 4 caracteres
async function sOfflineDispositivo() {
  let d = await sOfflineGetConfig('dispositivo')
  if (!d) {
    const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const b = new Uint8Array(4)
    crypto.getRandomValues(b)
    d = Array.from(b, x => alfa[x % alfa.length]).join('')
    await sOfflineSetConfig('dispositivo', d)
  }
  return d
}

// próximo número do dia neste aparelho (01, 02…) — só cresce
async function sOfflineProximoSeq(aammdd) {
  const chave = 'seq_' + aammdd
  const n = ((await sOfflineGetConfig(chave)) || 0) + 1
  await sOfflineSetConfig(chave, n)
  return n
}

// ── fichas ─────────────────────────────────────────────────────────────
function sOfflineSalvarFicha(f) {
  f.atualizado_em = new Date().toISOString()
  return _sTx('fichas', 'readwrite', st => st.put(f))
}
function sOfflineFicha(uuid) { return _sTx('fichas', 'readonly', st => st.get(uuid)) }
function sOfflineListarFichas() {
  return _sTx('fichas', 'readonly', st => st.getAll()).then(l =>
    (l || []).sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em))))
}
async function sOfflineListarPendentes() {
  return (await sOfflineListarFichas()).filter(f => f.estado === 'pendente' || f.estado === 'enviando')
}
async function sOfflineMarcar(uuid, estado, extra) {
  const f = await sOfflineFicha(uuid)
  if (!f) return
  Object.assign(f, extra || {}, { estado })
  await sOfflineSalvarFicha(f)
}
// descartar rascunho: só rascunho (nunca ficha pronta para envio)
async function sOfflineDescartarRascunho(uuid) {
  const f = await sOfflineFicha(uuid)
  if (!f || f.estado !== 'rascunho') return false
  const fotos = await sOfflineFotosDaFicha(uuid)
  await _sTx('fotos', 'readwrite', st => { fotos.forEach(x => st.delete(x.uuid_cliente)); return null })
  await _sTx('fichas', 'readwrite', st => st.delete(uuid))
  return true
}
// limpeza: ficha enviada há mais de 120 dias (o servidor tem a cópia)
async function sOfflineLimpar() {
  const corte = Date.now() - 120 * 864e5
  const velhas = (await sOfflineListarFichas())
    .filter(f => f.estado === 'enviada' && f.enviado_em && Date.parse(f.enviado_em) < corte)
  for (const f of velhas) {
    const fotos = await sOfflineFotosDaFicha(f.uuid_cliente)
    await _sTx('fotos', 'readwrite', st => { fotos.forEach(x => st.delete(x.uuid_cliente)); return null })
    await _sTx('fichas', 'readwrite', st => st.delete(f.uuid_cliente))
  }
  return velhas.length
}

// ── fotos ──────────────────────────────────────────────────────────────
function sOfflineSalvarFoto(foto) { return _sTx('fotos', 'readwrite', st => st.put(foto)) }
function sOfflineFoto(uuid) { return _sTx('fotos', 'readonly', st => st.get(uuid)) }
function sOfflineRemoverFoto(uuid) { return _sTx('fotos', 'readwrite', st => st.delete(uuid)) }
function sOfflineFotosDaFicha(fichaUuid) {
  return _sTx('fotos', 'readonly', st => st.index('ficha_uuid').getAll(fichaUuid)).then(l =>
    (l || []).sort((a, b) => String(a.tirada_em).localeCompare(String(b.tirada_em))))
}
// bytes → Blob só na hora de mostrar ou enviar
function sOfflineFotoBlob(foto) { return new Blob([foto.bytes], { type: foto.tipo || 'image/jpeg' }) }
