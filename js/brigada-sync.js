// ── SIGUC Brigadas — Sync Engine ──────────────────────────────
// Estratégia 2 fases: upload fotos → upsert registro → confirmar
// Idempotência via uuid_cliente (UNIQUE no banco)

const SYNC_BACKOFF = [2000, 4000, 8000, 16000]
let _syncRunning = false

// ── Ponto de entrada público ──────────────────────────────────
async function bSyncRodar() {
  if (_syncRunning || !db) return
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

  let ok = 0, erros = 0
  bSyncEmitir('sync-start', { total: pendentes.length })

  for (const reg of pendentes) {
    const sucesso = await bSyncUm(reg)
    if (sucesso) ok++; else erros++
    bSyncEmitir('sync-progresso', { ok, erros, total: pendentes.length })
  }

  await bOfflinePurgar()
  bSyncEmitir('sync-fim', { ok, erros, total: pendentes.length })
}

async function bSyncUm(reg) {
  if (!db) return false
  await bOfflineMarcar(reg.uuid_cliente, 'enviando')

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
      const { data: rc, error: errId } = await db
        .from('registros_campo')
        .select('id')
        .eq('uuid_cliente', reg.uuid_cliente)
        .single()
      if (errId) throw errId

      await db.from('registro_fauna').delete().eq('registro_campo_id', rc.id)
      const faunaPayload = fauna.map(f => bSyncMontarFaunaPayload(f, rc.id))
      const { error: errF } = await db.from('registro_fauna').insert(faunaPayload)
      if (errF) throw errF
    }

    await bOfflineMarcar(reg.uuid_cliente, 'confirmado', {
      sincronizado_em: new Date().toISOString(),
    })
    bSyncEmitir('confirmado', { uuid: reg.uuid_cliente })
    return true

  } catch (err) {
    const msg = [err?.message, err?.details, err?.hint, err?.code, err?.error]
      .filter(Boolean).join(' | ')
      || (err && typeof err === 'object' ? JSON.stringify(err) : String(err))
    console.warn('[brigada-sync] erro em', reg.uuid_cliente, err)
    await bOfflineMarcar(reg.uuid_cliente, 'pendente', { ultimo_erro: msg })
    bSyncEmitir('erro', { uuid: reg.uuid_cliente, err: msg })
    return false
  }
}

// ── Upload de fotos para Supabase Storage ─────────────────────
async function bSyncUploadFotos(reg) {
  const blobs = reg.fotos_blobs ?? []
  if (!blobs.length) return []

  const urls = []
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i]
    if (typeof blob === 'string') { urls.push(blob); continue }

    const ext  = blob.type?.includes('png') ? 'png' : 'jpg'
    const path = `${reg.uuid_cliente}/${i}.${ext}`

    let ok = false
    let lastStorageErr = null
    for (let t = 0; t <= SYNC_BACKOFF.length; t++) {
      const { error } = await db.storage
        .from('registros-campo')
        .upload(path, blob, { upsert: true, contentType: blob.type ?? 'image/jpeg' })

      if (!error) { ok = true; break }
      lastStorageErr = error
      if (t < SYNC_BACKOFF.length) await bSyncSleep(SYNC_BACKOFF[t])
    }

    if (!ok) {
      const detail = lastStorageErr
        ? (lastStorageErr.message || lastStorageErr.error || JSON.stringify(lastStorageErr))
        : 'sem detalhe'
      throw new Error(`Falha no upload da foto ${i}: ${detail}`)
    }

    const { data: { publicUrl } } = db.storage
      .from('registros-campo')
      .getPublicUrl(path)
    urls.push(publicUrl)
  }
  return urls
}

// ── Monta payload do registro de campo ───────────────────────
// Mapeia os campos internos do IndexedDB para as colunas do banco.
function bSyncMontarPayload(reg, fotosUrls) {
  // Desestrutura e descarta campos internos + campos que precisam de conversão
  const {
    fotos_blobs, status, _fauna, ultimo_erro,
    lat, lng,          // → localizacao (PostGIS)
    n_equipe,          // → equipe (text)
    area_ha,           // → area_estimada_ha
    observacoes,       // → descricao
    duracao_horas,     // sem coluna no banco
    criado_em,         // → data_inicio + data_hora_evento
    ...rest
  } = reg

  const ts = criado_em ?? new Date().toISOString()

  return {
    ...rest,
    fotos_urls:       fotosUrls.length ? fotosUrls : null,
    // Geometria enviada como GeoJSON; PostgREST converte via ST_GeomFromGeoJSON
    localizacao:      (lat != null && lng != null)
                        ? { type: 'Point', coordinates: [lng, lat] }
                        : null,
    equipe:           n_equipe != null ? String(n_equipe) : null,
    area_estimada_ha: area_ha  ?? null,
    descricao:        observacoes ?? null,
    data_inicio:      ts.slice(0, 10),
    data_hora_evento: ts,
  }
}

// ── Monta payload de fauna ────────────────────────────────────
function bSyncMontarFaunaPayload(f, registroCampoId) {
  const {
    id, _id, registro_uuid,
    especie_nome_cientifico,  // → nome_cientifico
    causa,                    // → causa_aparente
    ...rest
  } = f
  return {
    ...rest,
    registro_campo_id: registroCampoId,
    nome_cientifico:   especie_nome_cientifico ?? null,
    causa_aparente:    causa ?? null,
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
