// ── SIGUC Brigadas — Sync Engine ──────────────────────────────
// Estratégia 2 fases: upload fotos → upsert registro → confirmar
// Idempotência via uuid_cliente (UNIQUE no banco)

const SYNC_BACKOFF = [2000, 4000, 8000, 16000]
let _syncRunning = false

// ── Renovar sessão antes de sincronizar ───────────────────────
// PWA no iOS suspende os timers de autoRefreshToken quando o app vai
// para background. O token de 1h expira sem renovação automática.
// Retornos: 'ok' | 'sem_sessao' | 'refresh_falhou'
// 'refresh_falhou' não aborta a sync: o refresh pode ter falhado por
// rede e o token atual ainda pode estar válido — tentamos mesmo assim.
async function bSyncGarantirSessao() {
  try {
    const { data: { session } } = await db.auth.getSession()
    if (!session) return 'sem_sessao'

    // Renovar se expirado ou expira nos próximos 5 min
    const expiresAt = (session.expires_at ?? 0) * 1000
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const { error } = await db.auth.refreshSession()
      if (error) { console.warn('[brigada-sync] refresh falhou:', error.message); return 'refresh_falhou' }
    }
    return 'ok'
  } catch (e) {
    console.warn('[brigada-sync] garantirSessao:', e.message)
    return 'refresh_falhou'
  }
}

// ── Teste real de conectividade ───────────────────────────────
// navigator.onLine e o evento 'online' NÃO são confiáveis na WebView
// do app nativo (ficam obsoletos após ciclos de modo avião). A única
// fonte de verdade é tentar alcançar o servidor.
async function bSyncTemConexao() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    // REST com apikey: exatamente o mesmo caminho (gateway + CORS) que o
    // tráfego real da sincronização usa — se isto responde, dá para enviar.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: SUPABASE_ANON_KEY },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    clearTimeout(t)
    // Qualquer resposta < 500 prova conectividade; o service worker da
    // versão web responde 503 sintético quando offline.
    return r.status < 500
  } catch { return false }
}

// ── Ponto de entrada público ──────────────────────────────────
// Retorna: 'ok' | 'vazio' | 'sem_conexao' | 'sem_sessao' | 'ocupado'
async function bSyncRodar() {
  if (_syncRunning || !db) return 'ocupado'
  _syncRunning = true
  try {
    const pendentes = await bOfflineListarPendentes()
    if (!pendentes.length) return 'vazio'

    if (!await bSyncTemConexao()) return 'sem_conexao'

    const sessao = await bSyncGarantirSessao()
    if (sessao === 'sem_sessao') {
      bSyncEmitir('erro', { uuid: null, err: 'Sessão expirada — abra o app e faça login novamente' })
      return 'sem_sessao'
    }

    await bSyncExecutar()
    return 'ok'
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
      const faunaPayload = await Promise.all(
        fauna.map(async (f, idx) => {
          const fotosF = await bSyncUploadFotosFauna(f, reg.uuid_cliente, idx)
          return bSyncMontarFaunaPayload(f, rc.id, fotosF)
        })
      )
      const { error: errF } = await db.from('registro_fauna').insert(faunaPayload)
      if (errF) throw errF
    }

    await bOfflineMarcar(reg.uuid_cliente, 'confirmado', {
      sincronizado_em: new Date().toISOString(),
      ultimo_erro: null,
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

// base64 data-URL → Blob (usado pelo upload após recuperar do IndexedDB)
function bSyncBase64ParaBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

// ── Upload de fotos para Supabase Storage ─────────────────────
async function bSyncUploadFotos(reg) {
  const fotos = reg.fotos_blobs ?? []
  if (!fotos.length) return []

  const urls = []
  for (let i = 0; i < fotos.length; i++) {
    const item = fotos[i]

    // URL remota já enviada anteriormente
    if (typeof item === 'string' && item.startsWith('http')) { urls.push(item); continue }

    // Converter base64 → Blob (novo formato) ou usar Blob direto (legado)
    const blob = (typeof item === 'string')
      ? bSyncBase64ParaBlob(item)
      : item

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
    fotos_blobs, status, _fauna, ultimo_erro, _reconstruido,
    lat, lng,          // → localizacao (PostGIS)
    n_equipe,          // legado: ignorado (equipe agora vem de equipe_id)
    area_ha,           // → area_estimada_ha
    perimetro_geojson, // → perimetro_geom (PostGIS); área recalculada por trigger
    observacoes,       // → descricao
    criado_em,         // → data_inicio + data_hora_evento
    ...rest            // inclui equipe_id, duracao_horas, hora_inicio, hora_fim, area_metodo, area_medida_ha
  } = reg

  const ts = criado_em ?? new Date().toISOString()

  return {
    ...rest,
    fotos_urls:       fotosUrls.length ? fotosUrls : null,
    // Geometria enviada como GeoJSON; PostgREST converte via ST_GeomFromGeoJSON
    localizacao:      (lat != null && lng != null)
                        ? { type: 'Point', coordinates: [lng, lat] }
                        : null,
    perimetro_geom:   perimetro_geojson ?? null,
    area_estimada_ha: area_ha  ?? null,
    descricao:        observacoes ?? null,
    data_inicio:      ts.slice(0, 10),
    data_hora_evento: ts,
  }
}

// ── Upload de fotos de fauna para Storage ─────────────────────
async function bSyncUploadFotosFauna(f, registroUuid, faunaIdx) {
  const fotos = f.fotos_blobs ?? []
  if (!fotos.length) return []

  const urls = []
  for (let i = 0; i < fotos.length; i++) {
    const item = fotos[i]
    if (typeof item === 'string' && item.startsWith('http')) { urls.push(item); continue }

    const blob = (typeof item === 'string') ? bSyncBase64ParaBlob(item) : item
    const ext  = blob.type?.includes('png') ? 'png' : 'jpg'
    const path = `${registroUuid}/fauna_${faunaIdx}_${i}.${ext}`

    let ok = false, lastErr = null
    for (let t = 0; t <= SYNC_BACKOFF.length; t++) {
      const { error } = await db.storage
        .from('registros-campo')
        .upload(path, blob, { upsert: true, contentType: blob.type ?? 'image/jpeg' })
      if (!error) { ok = true; break }
      lastErr = error
      if (t < SYNC_BACKOFF.length) await bSyncSleep(SYNC_BACKOFF[t])
    }
    if (!ok) {
      const detail = lastErr ? (lastErr.message || lastErr.error || JSON.stringify(lastErr)) : 'sem detalhe'
      throw new Error(`Falha no upload fauna ${faunaIdx}/${i}: ${detail}`)
    }
    const { data: { publicUrl } } = db.storage.from('registros-campo').getPublicUrl(path)
    urls.push(publicUrl)
  }
  return urls
}

// ── Poll: busca correções/rejeições pendentes no servidor ─────
// Usa app_correcoes_pendentes() (SECURITY DEFINER, sem precisar de
// UUIDs locais) — funciona mesmo após a fila ter sido zerada.
// • Registros presentes no IndexedDB → atualiza status_validacao
// • Registros ausentes (fila zerada) → reconstrói skeleton local
// Retorna número de registros novos ou atualizados.
async function bSyncPollValidacao() {
  if (!db) return 0
  try {
    const { data, error } = await db.rpc('app_correcoes_pendentes')
    if (error || !data) return 0

    const todos    = await bOfflineListarTodos()
    const localMap = Object.fromEntries(todos.map(r => [r.uuid_cliente, r]))

    let mudancas = 0
    for (const row of data) {
      const local = localMap[row.uuid_cliente]

      if (local) {
        // Registro existe: atualiza status e motivo se mudou
        if (local.status_validacao !== row.status_validacao ||
            local.motivo_rejeicao  !== row.motivo_rejeicao) {
          await bOfflineMarcar(row.uuid_cliente, local.status, {
            status_validacao: row.status_validacao,
            motivo_rejeicao:  row.motivo_rejeicao ?? null,
          })
          mudancas++
        }
      } else {
        // Registro não existe (fila zerada): reconstrói do servidor
        await bOfflineRestaurar({
          uuid_cliente:       row.uuid_cliente,
          brigadista_id:      row.brigadista_id,
          brigada_id:         row.brigada_id,
          equipe_id:          row.equipe_id,
          uc_id:              row.uc_id,
          regional:           row.regional,
          municipio:          row.municipio,
          natureza:           row.natureza,
          atividade:          row.atividade,
          hora_inicio:        row.hora_inicio,
          hora_fim:           row.hora_fim,
          duracao_horas:      row.duracao_horas,
          area_ha:            row.area_estimada_ha,
          pessoas_alcancadas: row.pessoas_alcancadas,
          observacoes:        row.descricao,
          origem_acionamento: row.origem_acionamento,
          integrada_cbmac:    row.integrada_cbmac,
          criado_em:          row.data_hora_evento,
          sincronizado_em:    row.sincronizado_em,
          status:             'confirmado',
          status_validacao:   row.status_validacao,
          motivo_rejeicao:    row.motivo_rejeicao ?? null,
          fotos_blobs:        [],
          _reconstruido:      true,
        })
        mudancas++
      }
    }

    if (mudancas > 0) bSyncEmitir('validacao-atualizada', { mudancas })
    return mudancas
  } catch (e) {
    console.warn('[brigada-sync] pollValidacao:', e)
    return 0
  }
}

// ── Monta payload de fauna ────────────────────────────────────
function bSyncMontarFaunaPayload(f, registroCampoId, fotosUrls = []) {
  const {
    id, _id, registro_uuid, fotos_blobs,
    especie_nome_cientifico,  // → nome_cientifico
    causa,                    // → causa_aparente
    ...rest
  } = f
  return {
    ...rest,
    registro_campo_id: registroCampoId,
    nome_cientifico:   especie_nome_cientifico ?? null,
    causa_aparente:    causa ?? null,
    fotos_urls:        fotosUrls.length ? fotosUrls : null,
  }
}

// ── Background Sync via Service Worker ───────────────────────
async function bSyncRegistrarBackground() {
  // App nativo (Capacitor): sem service worker — o retry periódico do
  // app cobre o reenvio. Sem este guard, navigator.serviceWorker.ready
  // nunca resolve e a promise fica pendurada para sempre.
  if (window.Capacitor) return false
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
