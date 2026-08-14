// ── SIGUC Qualidade da Água — Sync Engine ─────────────────────
// Molde de js/brigada-sync.js, simplificado: agua_coletas não tem
// filhos (fauna/participantes do Brigadas) — upload da foto (se
// houver) → resolve a campanha (ano+ordem) → upsert da coleta →
// confirmar. Sem poll de correções: agua_coletas não tem fluxo de
// validação/rejeição como registros_campo.
//
// Idempotência via uuid_cliente (UNIQUE parcial, migration 257) —
// mesmo padrão do Brigadas (upsert simples), não a RPC SECURITY
// DEFINER do Frota: quem grava aqui já é o mesmo usuário de mesa com
// pode_editar('agua'), não há elevação de privilégio a proteger.

const SYNC_BACKOFF = [2000, 4000, 8000, 16000]
let _aSyncRunning = false

// ── Renovar sessão antes de sincronizar ───────────────────────
async function aSyncGarantirSessao() {
  try {
    const { data: { session } } = await db.auth.getSession()
    if (!session) return 'sem_sessao'
    const expiresAt = (session.expires_at ?? 0) * 1000
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const { error } = await db.auth.refreshSession()
      if (error) { console.warn('[agua-sync] refresh falhou:', error.message); return 'refresh_falhou' }
    }
    return 'ok'
  } catch (e) {
    console.warn('[agua-sync] garantirSessao:', e.message)
    return 'refresh_falhou'
  }
}

// ── Teste real de conectividade ───────────────────────────────
// navigator.onLine não é confiável na WebView do app nativo — a única
// fonte de verdade é tentar alcançar o servidor.
async function aSyncTemConexao() {
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

// ── Ponto de entrada público ──────────────────────────────────
// Retorna: 'ok' | 'vazio' | 'sem_conexao' | 'sem_sessao' | 'ocupado'
async function aSyncRodar() {
  if (_aSyncRunning || !db) return 'ocupado'
  _aSyncRunning = true
  try {
    const pendentes = await aOfflineListarPendentes()
    if (!pendentes.length) return 'vazio'

    if (!await aSyncTemConexao()) return 'sem_conexao'

    const sessao = await aSyncGarantirSessao()
    if (sessao === 'sem_sessao') {
      aSyncEmitir('erro', { uuid: null, err: 'Sessão expirada — abra o app e faça login novamente' })
      return 'sem_sessao'
    }

    await aSyncExecutar()
    return 'ok'
  } finally {
    _aSyncRunning = false
  }
}

async function aSyncExecutar() {
  const pendentes = await aOfflineListarPendentes()
  if (!pendentes.length) return

  let ok = 0, erros = 0
  aSyncEmitir('sync-start', { total: pendentes.length })

  for (const reg of pendentes) {
    const sucesso = await aSyncUm(reg)
    if (sucesso) ok++; else erros++
    aSyncEmitir('sync-progresso', { ok, erros, total: pendentes.length })
  }

  await aOfflinePurgar()
  aSyncEmitir('sync-fim', { ok, erros, total: pendentes.length })
}

// ── Resolve (ou cria) a campanha do ano/ordem — UNIQUE(ano,ordem)
// já existe (migration 248). SEM ignoreDuplicates: com ele, o
// PostgREST vira "ON CONFLICT DO NOTHING" e não devolve a linha
// existente no RETURNING (o .select().single() falharia com "no rows"
// sempre que a campanha já existisse — é exatamente o caso comum,
// campanhas de anos passados). O upsert padrão faz DO UPDATE sobre as
// próprias colunas do conflito (no-op de valor, já que reenviamos
// ano/ordem iguais) e SEMPRE devolve a linha.
async function aSyncResolverCampanha(ano, ordem) {
  const { data, error } = await db
    .from('agua_campanhas')
    .upsert({ ano, ordem }, { onConflict: 'ano,ordem' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function aSyncUm(reg) {
  if (!db) return false
  await aOfflineMarcar(reg.uuid_cliente, 'enviando')

  try {
    const campanhaId = await aSyncResolverCampanha(reg.campanha_ano, reg.campanha_ordem)
    const fotoUrl = await aSyncUploadFoto(reg)

    const payload = aSyncMontarPayload(reg, campanhaId, fotoUrl)
    const { error } = await db
      .from('agua_coletas')
      .upsert(payload, { onConflict: 'uuid_cliente' })
    if (error) throw error

    await aOfflineMarcar(reg.uuid_cliente, 'confirmado', {
      sincronizado_em: new Date().toISOString(),
      ultimo_erro: null,
    })
    aSyncEmitir('confirmado', { uuid: reg.uuid_cliente })
    return true

  } catch (err) {
    const msg = [err?.message, err?.details, err?.hint, err?.code]
      .filter(Boolean).join(' | ')
      || (err && typeof err === 'object' ? JSON.stringify(err) : String(err))
    console.warn('[agua-sync] erro em', reg.uuid_cliente, err)
    await aOfflineMarcar(reg.uuid_cliente, 'pendente', { ultimo_erro: msg })
    aSyncEmitir('erro', { uuid: reg.uuid_cliente, err: msg })
    return false
  }
}

// base64 data-URL → Blob
function aSyncBase64ParaBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

// ── Upload da foto do ponto (bucket privado agua-fotos-campo,
// migration 258) ──────────────────────────────────────────────
async function aSyncUploadFoto(reg) {
  const item = reg.foto_blob
  if (!item) return null
  if (typeof item === 'string' && item.startsWith('http')) return item

  const blob = (typeof item === 'string') ? aSyncBase64ParaBlob(item) : item
  const ext  = blob.type?.includes('png') ? 'png' : 'jpg'
  const path = `${reg.uuid_cliente}/foto.${ext}`

  let ok = false, lastErr = null
  for (let t = 0; t <= SYNC_BACKOFF.length; t++) {
    const { error } = await db.storage
      .from('agua-fotos-campo')
      .upload(path, blob, { upsert: true, contentType: blob.type ?? 'image/jpeg' })
    if (!error) { ok = true; break }
    lastErr = error
    if (t < SYNC_BACKOFF.length) await aSyncSleep(SYNC_BACKOFF[t])
  }
  if (!ok) {
    const detail = lastErr ? (lastErr.message || lastErr.error || JSON.stringify(lastErr)) : 'sem detalhe'
    throw new Error(`Falha no upload da foto: ${detail}`)
  }
  const { data: { publicUrl } } = db.storage.from('agua-fotos-campo').getPublicUrl(path)
  return publicUrl
}

// ── Monta payload de agua_coletas a partir do registro local ──
function aSyncMontarPayload(reg, campanhaId, fotoUrl) {
  const {
    foto_blob, status, ultimo_erro, sincronizado_em,
    campanha_ano, campanha_ordem, // → campanha_id (resolvido acima)
    lat, lng,                     // → localizacao (PostGIS)
    criado_em,
    ...rest // ponto_id, data_coleta, hora_coleta, coletor_id, codigo_amostra,
            // temp_ar, temp_amostra, ph, od, turbidez, condutividade_eletrica,
            // observacoes, uuid_cliente
  } = reg

  return {
    ...rest,
    campanha_id: campanhaId,
    foto_url:    fotoUrl ?? null,
    localizacao: (lat != null && lng != null)
      ? `SRID=4326;POINT(${lng} ${lat})`
      : null,
  }
}

// ── Eventos para a UI ─────────────────────────────────────────
const _aSyncListeners = {}

function aSyncOn(event, fn) {
  if (!_aSyncListeners[event]) _aSyncListeners[event] = []
  _aSyncListeners[event].push(fn)
}

function aSyncEmitir(event, detail) {
  ;(_aSyncListeners[event] || []).forEach(fn => fn(detail))
}

function aSyncSleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function aSyncContarPendentes() {
  const lista = await aOfflineListarPendentes()
  return lista.length
}

// ── Background Sync via Service Worker ───────────────────────
// Mesma tag 'sync-registros' que pwa/sw.js já escuta (o handler só
// avisa os clientes com BACKGROUND_SYNC — não distingue app; cada app
// reage à mensagem com o próprio *SyncRodar).
async function aSyncRegistrarBackground() {
  if (window.Capacitor) return false
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return false
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.sync.register('sync-registros')
    return true
  } catch { return false }
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', ev => {
    if (ev.data?.type === 'BACKGROUND_SYNC') aSyncRodar()
  })
}
