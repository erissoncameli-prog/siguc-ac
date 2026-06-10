// ── SIGUC Brigadas — Sync Engine ──────────────────────────────
// Estratégia 2 fases: upload fotos → upsert registro → confirmar
// Idempotência via uuid_cliente (UNIQUE no banco)

const SYNC_BACKOFF = [2000, 4000, 8000, 16000]
let _syncRunning = false

// ── Ponto de entrada público ──────────────────────────────────
async function bSyncRodar() {
  if (_syncRunning) return
  _syncRunning = true
  try {
    await bSyncExecutar()
  } finally {
    _syncRunning = false
  }
}

async function bSyncExecutar() {
  const pendentes = await bOfflineListarPendentes()
  if (!pendentes.length) return

  for (const reg of pendentes) {
    await bSyncUm(reg)
  }

  await bOfflinePurgar()
}

async function bSyncUm(reg) {
  await bOfflineMarcar(reg.uuid_cliente, 'enviando')
  bSyncEmitir('progress', { uuid: reg.uuid_cliente, fase: 'inicio' })

  try {
    // Fase 1: upload de fotos
    const fotosUrls = await bSyncUploadFotos(reg)

    // Fase 2: upsert do registro principal
    const payload = bSyncMontarPayload(reg, fotosUrls)
    const { error: errReg } = await db
      .from('registros_campo')
      .upsert(payload, { onConflict: 'uuid_cliente' })

    if (errReg) throw errReg

    // Fase 3: fauna (delete + reinsert)
    const fauna = await bOfflineFaunaDeRegistro(reg.uuid_cliente)
    if (fauna.length) {
      // Recupera o id do registro recém inserido
      const { data: rc, error: errId } = await db
        .from('registros_campo')
        .select('id')
        .eq('uuid_cliente', reg.uuid_cliente)
        .single()
      if (errId) throw errId

      await db.from('registro_fauna').delete().eq('registro_campo_id', rc.id)
      const faunaPayload = fauna.map(f => {
        // eslint-disable-next-line no-unused-vars
        const { id, registro_uuid, ...rest } = f
        return { ...rest, registro_campo_id: rc.id }
      })
      const { error: errF } = await db.from('registro_fauna').insert(faunaPayload)
      if (errF) throw errF
    }

    await bOfflineMarcar(reg.uuid_cliente, 'confirmado', {
      sincronizado_em: new Date().toISOString(),
    })
    bSyncEmitir('confirmado', { uuid: reg.uuid_cliente })

  } catch (err) {
    console.warn('[brigada-sync] erro em', reg.uuid_cliente, err)
    await bOfflineMarcar(reg.uuid_cliente, 'pendente', { ultimo_erro: String(err) })
    bSyncEmitir('erro', { uuid: reg.uuid_cliente, err: String(err) })
  }
}

// ── Upload de fotos para Supabase Storage ─────────────────────
async function bSyncUploadFotos(reg) {
  const blobs = reg.fotos_blobs ?? []
  if (!blobs.length) return []

  const urls = []
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i]
    if (typeof blob === 'string') { urls.push(blob); continue } // já é URL

    const ext  = blob.type?.includes('png') ? 'png' : 'jpg'
    const path = `${reg.uuid_cliente}/${i}.${ext}`

    let ok = false
    for (let t = 0; t <= SYNC_BACKOFF.length; t++) {
      const { error } = await db.storage
        .from('registros-campo')
        .upload(path, blob, { upsert: true, contentType: blob.type ?? 'image/jpeg' })

      if (!error) { ok = true; break }
      if (t < SYNC_BACKOFF.length) await bSyncSleep(SYNC_BACKOFF[t])
    }

    if (!ok) throw new Error(`Falha no upload da foto ${i}`)

    const { data: { publicUrl } } = db.storage
      .from('registros-campo')
      .getPublicUrl(path)
    urls.push(publicUrl)
  }
  return urls
}

// ── Monta payload sem campos internos do IndexedDB ────────────
function bSyncMontarPayload(reg, fotosUrls) {
  // eslint-disable-next-line no-unused-vars
  const { fotos_blobs, criado_em, ultimo_erro, status, _fauna, ...rest } = reg
  return {
    ...rest,
    fotos_urls: fotosUrls,
    // gps vem como { lat, lng } — converter para WKT Point
    gps: reg.lat != null
      ? `POINT(${reg.lng} ${reg.lat})`
      : undefined,
  }
}

// ── Background Sync via Service Worker ───────────────────────
async function bSyncRegistrarBackground() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return false
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.sync.register('sync-registros')
    return true
  } catch { return false }
}

// Escuta mensagens do SW (Background Sync dispara BACKGROUND_SYNC)
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', ev => {
    if (ev.data?.type === 'BACKGROUND_SYNC') bSyncRodar()
  })
}

// ── Eventos para a UI ─────────────────────────────────────────
const _syncListeners = {}

function bSyncOn(event, fn) {
  if (!_syncListeners[event]) _syncListeners[event] = []
  _syncListeners[event].push(fn)
}

function bSyncEmitir(event, detail) {
  ;(_syncListeners[event] || []).forEach(fn => fn(detail))
}

// ── Utilitário ────────────────────────────────────────────────
function bSyncSleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Contagem de pendentes para badge ─────────────────────────
async function bSyncContarPendentes() {
  const lista = await bOfflineListarPendentes()
  return lista.length
}
