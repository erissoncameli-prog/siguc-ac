// ── SIGUC Frota — Sync Engine ──────────────────────────────────
// Fila de ações do motorista (checkout/checkin/abrir viagem direta).
// As RPCs de destino (frota_checkout_viagem etc.) só transicionam a
// viagem se ela ainda estiver no status esperado — reenviar uma ação
// já aplicada falha com erro do banco em vez de duplicar o efeito.

let _fSyncRunning = false

// ── Renovar sessão antes de sincronizar (mesmo problema do Brigadas:
// PWA no iOS suspende autoRefreshToken em background) ────────────
async function fSyncGarantirSessao() {
  try {
    const { data: { session } } = await db.auth.getSession()
    if (!session) return 'sem_sessao'
    const expiresAt = (session.expires_at ?? 0) * 1000
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const { error } = await db.auth.refreshSession()
      if (error) { console.warn('[frota-sync] refresh falhou:', error.message); return 'refresh_falhou' }
    }
    return 'ok'
  } catch (e) {
    console.warn('[frota-sync] garantirSessao:', e.message)
    return 'refresh_falhou'
  }
}

// ── Teste real de conectividade (navigator.onLine não é confiável) ─
async function fSyncTemConexao() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: SUPABASE_ANON_KEY },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return r.status < 500
  } catch { return false }
}

// ── Ponto de entrada público ───────────────────────────────────
async function fSyncRodar() {
  if (_fSyncRunning || !db) return 'ocupado'
  _fSyncRunning = true
  try {
    const pendentes = await fOfflineListarPendentes()
    if (!pendentes.length) return 'vazio'

    if (!await fSyncTemConexao()) return 'sem_conexao'

    const sessao = await fSyncGarantirSessao()
    if (sessao === 'sem_sessao') {
      fSyncEmitir('erro', { uuid: null, err: 'Sessão expirada — faça login novamente' })
      return 'sem_sessao'
    }

    await fSyncExecutar()
    return 'ok'
  } finally {
    _fSyncRunning = false
  }
}

async function fSyncExecutar() {
  const pendentes = await fOfflineListarPendentes()
  if (!pendentes.length) return

  let ok = 0, erros = 0
  fSyncEmitir('sync-start', { total: pendentes.length })

  for (const acao of pendentes) {
    const sucesso = await fSyncUma(acao)
    if (sucesso) ok++; else erros++
    fSyncEmitir('sync-progresso', { ok, erros, total: pendentes.length })
  }

  await fOfflinePurgar()
  fSyncEmitir('sync-fim', { ok, erros, total: pendentes.length })
}

// base64 data-URL → Blob (upload após recuperar do IndexedDB)
function fSyncBase64ParaBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

// Upload de uma foto do abastecimento (cupom/hodômetro) para o Storage.
// Usado tanto pelo caminho online direto (frota-app.html) quanto pelo
// sync da fila offline — dataUrl já vem em base64 (evita Blob detachment
// em iOS/PWA, mesmo motivo da conversão em brigada-offline.js).
async function fSyncUploadFotoAbastecimento(dataUrl, uuidCliente, qual) {
  const blob = fSyncBase64ParaBlob(dataUrl)
  const ext  = blob.type?.includes('png') ? 'png' : 'jpg'
  const path = `${uuidCliente}/${qual}.${ext}`
  const { error } = await db.storage
    .from('frota-abastecimentos')
    .upload(path, blob, { upsert: true, contentType: blob.type ?? 'image/jpeg' })
  if (error) throw new Error(`Falha no upload da foto (${qual}): ${error.message || error.error || JSON.stringify(error)}`)
  const { data: { publicUrl } } = db.storage.from('frota-abastecimentos').getPublicUrl(path)
  return publicUrl
}

// Upload de uma foto do comunicado de defeito (bucket frota-manutencao,
// migration 194) — mesmo molde de fSyncUploadFotoAbastecimento.
async function fSyncUploadFotoDefeito(dataUrl, uuidCliente, indice) {
  const blob = fSyncBase64ParaBlob(dataUrl)
  const ext  = blob.type?.includes('png') ? 'png' : 'jpg'
  const path = `${uuidCliente}/${indice}.${ext}`
  const { error } = await db.storage
    .from('frota-manutencao')
    .upload(path, blob, { upsert: true, contentType: blob.type ?? 'image/jpeg' })
  if (error) throw new Error(`Falha no upload da foto ${indice + 1}: ${error.message || error.error || JSON.stringify(error)}`)
  const { data: { publicUrl } } = db.storage.from('frota-manutencao').getPublicUrl(path)
  return publicUrl
}

async function fSyncUma(acao) {
  if (!db) return false
  await fOfflineMarcar(acao.uuid_cliente, 'enviando')
  try {
    let error
    if (acao.tipo === 'checkout') {
      ;({ error } = await db.rpc('frota_checkout_viagem', acao.payload))
    } else if (acao.tipo === 'checkin') {
      ;({ error } = await db.rpc('frota_checkin_viagem', acao.payload))
    } else if (acao.tipo === 'abrir_direta') {
      ;({ error } = await db.rpc('frota_abrir_viagem_direta', acao.payload))
    } else if (acao.tipo === 'abastecimento') {
      const payload = { ...acao.payload }
      if (acao.fotos?.cupom) payload.p_foto_cupom_url = await fSyncUploadFotoAbastecimento(acao.fotos.cupom, acao.uuid_cliente, 'cupom')
      if (acao.fotos?.hodometro) payload.p_foto_hodometro_url = await fSyncUploadFotoAbastecimento(acao.fotos.hodometro, acao.uuid_cliente, 'hodometro')
      ;({ error } = await db.rpc('frota_registrar_abastecimento', payload))
    } else if (acao.tipo === 'defeito') {
      const payload = { ...acao.payload }
      if (acao.fotos?.lista?.length) {
        payload.p_fotos_urls = await Promise.all(
          acao.fotos.lista.map((f, i) => fSyncUploadFotoDefeito(f, acao.uuid_cliente, i))
        )
      }
      ;({ error } = await db.rpc('frota_reportar_defeito', payload))
    } else {
      error = new Error('Tipo de ação desconhecido: ' + acao.tipo)
    }
    if (error) throw error

    await fOfflineMarcar(acao.uuid_cliente, 'confirmado', { sincronizado_em: new Date().toISOString() })
    fSyncEmitir('confirmado', { uuid: acao.uuid_cliente, tipo: acao.tipo })
    return true
  } catch (e) {
    await fOfflineMarcar(acao.uuid_cliente, 'pendente', { erro: e.message || 'Erro ao sincronizar' })
    fSyncEmitir('erro', { uuid: acao.uuid_cliente, err: e.message || 'Erro ao sincronizar' })
    return false
  }
}

// ── Barramento de eventos simples ──────────────────────────────
const _fSyncListeners = {}
function fSyncOn(event, fn) {
  (_fSyncListeners[event] ??= []).push(fn)
}
function fSyncEmitir(event, detail) {
  (_fSyncListeners[event] || []).forEach(fn => { try { fn(detail) } catch (e) { console.error(e) } })
}
