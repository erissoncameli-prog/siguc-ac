// ── SIGUC Frota — Sync Engine ──────────────────────────────────
// Fila de ações do motorista (checkout/checkin/abrir viagem direta,
// abastecimento, comunicado de defeito).
//
// Todas as RPCs de destino são idempotentes por uuid_cliente
// (migrations 173, 175, 193 e 198): reenviar uma ação já aplicada
// devolve o registro existente, sem erro e sem repetir efeito. Isso é
// o que impede a "pílula envenenada" — a ação que COMMITOU no
// servidor mas cuja resposta se perdeu no caminho, e que antes ficava
// reenviando para sempre porque a RPC recusava a transição repetida.
//
// Para o que a idempotência não cobre — erro de regra de negócio que
// nunca vai passar (leitura de hodômetro menor que a última, veículo
// errado, janela de 120 min) — existe o limite de tentativas com
// backoff: depois de F_MAX_TENTATIVAS o item vai para
// `falha_permanente`, sai do laço de reenvio e aparece na tela de
// fila do app com o motivo, para o motorista descartar ou tentar de
// novo por conta própria.

const F_MAX_TENTATIVAS = 5
// Espera antes da próxima tentativa, por número de falhas acumuladas.
const F_BACKOFF_MS = [60e3, 2 * 60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3]

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
    // Destrava o que ficou em 'enviando' de uma execução interrompida
    // (app fechado no meio do envio) antes de montar a lista.
    await fOfflineRecuperarEnviando()

    // Prontas = pendentes cujo backoff já venceu. Se há pendentes mas
    // nenhuma pronta, não vale acordar a rede — só esperar.
    const pendentes = await fOfflineListarProntas()
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
  const pendentes = await fOfflineListarProntas()
  if (!pendentes.length) return

  let ok = 0, erros = 0, desistiu = 0
  fSyncEmitir('sync-start', { total: pendentes.length })

  for (const acao of pendentes) {
    const r = await fSyncUma(acao)
    if (r === 'ok') ok++
    else if (r === 'falha_permanente') desistiu++
    else erros++
    fSyncEmitir('sync-progresso', { ok, erros, desistiu, total: pendentes.length })
  }

  await fOfflinePurgar()
  fSyncEmitir('sync-fim', { ok, erros, desistiu, total: pendentes.length })
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

// Sobe um arquivo, tolerando o caso "já está lá".
//
// As políticas dos buckets do Frota permitem INSERT ao motorista ativo,
// mas UPDATE só a quem tem pode_editar('frota') — que o motorista não
// tem. Com upsert, reenviar para um caminho que já existe vira UPDATE e
// é NEGADO. Isso acontece quando o upload commitou no Storage mas a
// resposta se perdeu: o objeto está lá, o cliente não soube, e toda
// tentativa seguinte batia na política e a ação nunca sincronizava.
//
// Aqui o caminho é determinístico (uuid da ação + qual foto), então se
// o upload falhar basta conferir se o objeto já existe e reaproveitar a
// URL. Só relança o erro quando o arquivo realmente não subiu.
async function fSyncUploadOuRecuperar(bucket, path, blob, rotulo) {
  const { error } = await db.storage
    .from(bucket)
    .upload(path, blob, { upsert: false, contentType: blob.type ?? 'image/jpeg' })

  if (error) {
    const barra = path.lastIndexOf('/')
    const pasta = path.slice(0, barra)
    const nome  = path.slice(barra + 1)
    let existe = false
    try {
      const { data } = await db.storage.from(bucket).list(pasta)
      existe = (data || []).some(o => o.name === nome)
    } catch (e) { /* sem rede/sem permissão de listagem: cai no throw abaixo */ }
    if (!existe) {
      throw new Error(`Falha no upload da foto (${rotulo}): ${error.message || error.error || JSON.stringify(error)}`)
    }
  }

  const { data: { publicUrl } } = db.storage.from(bucket).getPublicUrl(path)
  return publicUrl
}

// Upload de uma foto do abastecimento (cupom/hodômetro) para o Storage.
// Usado tanto pelo caminho online direto (frota-app.html) quanto pelo
// sync da fila offline — dataUrl já vem em base64 (evita Blob detachment
// em iOS/PWA, mesmo motivo da conversão em brigada-offline.js).
async function fSyncUploadFotoAbastecimento(dataUrl, uuidCliente, qual) {
  const blob = fSyncBase64ParaBlob(dataUrl)
  const ext  = blob.type?.includes('png') ? 'png' : 'jpg'
  return fSyncUploadOuRecuperar('frota-abastecimentos', `${uuidCliente}/${qual}.${ext}`, blob, qual)
}

// Upload de uma foto do comunicado de defeito (bucket frota-manutencao,
// migration 194) — mesmo molde de fSyncUploadFotoAbastecimento.
async function fSyncUploadFotoDefeito(dataUrl, uuidCliente, indice) {
  const blob = fSyncBase64ParaBlob(dataUrl)
  const ext  = blob.type?.includes('png') ? 'png' : 'jpg'
  return fSyncUploadOuRecuperar('frota-manutencao', `${uuidCliente}/${indice}.${ext}`, blob, `foto ${indice + 1}`)
}

// Sobe as fotos do checklist e devolve as URLs para dentro do
// p_inspecao. As fotos vêm indexadas pela POSIÇÃO do item
// ({ '0': dataUrl, '3': dataUrl }), que é como o app as guarda — assim
// o sync casa cada URL de volta no item certo sem depender de id.
// Reaproveita o bucket frota-manutencao, que é o destino natural: o
// item reprovado vira comunicado de defeito.
//
// `jaEnviadas` permite ao reenvio pular o que já subiu (mesma lição da
// Fase 2: repetir upload no mesmo caminho vira UPDATE e é negado ao
// motorista).
async function fSubirFotosInspecao(payload, fotos, uuidCliente, jaEnviadas) {
  const enviadas = { ...(jaEnviadas || {}) }
  const base = uuidCliente || payload.p_uuid_cliente || _fUuid()
  for (const idx of Object.keys(fotos)) {
    if (!enviadas[idx]) {
      enviadas[idx] = await fSyncUploadFotoDefeito(fotos[idx], `insp-${base}`, Number(idx))
    }
    if (payload.p_inspecao?.itens?.[Number(idx)]) {
      payload.p_inspecao.itens[Number(idx)].foto_url = enviadas[idx]
    }
  }
  return enviadas
}

// Retorna 'ok' | 'erro' | 'falha_permanente'.
async function fSyncUma(acao) {
  if (!db) return 'erro'
  await fOfflineMarcar(acao.uuid_cliente, 'enviando')
  // URLs de fotos que já subiram numa tentativa anterior. Sem isso, um
  // reenvio re-envia a mesma foto para o mesmo caminho, o que o
  // Storage trata como UPDATE — e a política de UPDATE do bucket exige
  // pode_editar('frota'), que o motorista não tem. O upload seria
  // negado e a ação nunca sincronizaria.
  const enviadas = { ...(acao.fotos_enviadas || {}) }
  try {
    let error
    if (acao.tipo === 'checkout' || acao.tipo === 'checkin') {
      const payload = JSON.parse(JSON.stringify(acao.payload))
      if (acao.fotos?.inspecao) {
        const novas = await fSubirFotosInspecao(payload, acao.fotos.inspecao, acao.uuid_cliente, enviadas.inspecao)
        enviadas.inspecao = novas
        await fOfflineMarcar(acao.uuid_cliente, 'enviando', { fotos_enviadas: enviadas })
      }
      const rpc = acao.tipo === 'checkout' ? 'frota_checkout_viagem' : 'frota_checkin_viagem'
      ;({ error } = await db.rpc(rpc, payload))
    } else if (acao.tipo === 'abrir_direta') {
      ;({ error } = await db.rpc('frota_abrir_viagem_direta', acao.payload))
    } else if (acao.tipo === 'abastecimento') {
      const payload = { ...acao.payload }
      if (acao.fotos?.cupom && !enviadas.cupom) {
        enviadas.cupom = await fSyncUploadFotoAbastecimento(acao.fotos.cupom, acao.uuid_cliente, 'cupom')
        await fOfflineMarcar(acao.uuid_cliente, 'enviando', { fotos_enviadas: enviadas })
      }
      if (acao.fotos?.hodometro && !enviadas.hodometro) {
        enviadas.hodometro = await fSyncUploadFotoAbastecimento(acao.fotos.hodometro, acao.uuid_cliente, 'hodometro')
        await fOfflineMarcar(acao.uuid_cliente, 'enviando', { fotos_enviadas: enviadas })
      }
      payload.p_foto_cupom_url = enviadas.cupom ?? null
      payload.p_foto_hodometro_url = enviadas.hodometro ?? null
      ;({ error } = await db.rpc('frota_registrar_abastecimento', payload))
    } else if (acao.tipo === 'defeito') {
      const payload = { ...acao.payload }
      if (acao.fotos?.lista?.length) {
        enviadas.lista = enviadas.lista || []
        for (let i = 0; i < acao.fotos.lista.length; i++) {
          if (enviadas.lista[i]) continue
          enviadas.lista[i] = await fSyncUploadFotoDefeito(acao.fotos.lista[i], acao.uuid_cliente, i)
          await fOfflineMarcar(acao.uuid_cliente, 'enviando', { fotos_enviadas: enviadas })
        }
        payload.p_fotos_urls = enviadas.lista
      }
      ;({ error } = await db.rpc('frota_reportar_defeito', payload))
    } else {
      error = new Error('Tipo de ação desconhecido: ' + acao.tipo)
    }
    if (error) throw error

    await fOfflineMarcar(acao.uuid_cliente, 'confirmado', {
      sincronizado_em: new Date().toISOString(), erro: null, fotos_enviadas: enviadas,
    })
    fSyncEmitir('confirmado', { uuid: acao.uuid_cliente, tipo: acao.tipo })
    return 'ok'
  } catch (e) {
    const msg = e.message || 'Erro ao sincronizar'
    const tentativas = (acao.tentativas || 0) + 1
    const desistir = tentativas >= F_MAX_TENTATIVAS

    if (desistir) {
      await fOfflineMarcar(acao.uuid_cliente, 'falha_permanente', {
        erro: msg, tentativas, proxima_tentativa: null, fotos_enviadas: enviadas,
      })
      fSyncEmitir('falha-permanente', { uuid: acao.uuid_cliente, tipo: acao.tipo, err: msg })
      return 'falha_permanente'
    }

    const espera = F_BACKOFF_MS[Math.min(tentativas - 1, F_BACKOFF_MS.length - 1)]
    await fOfflineMarcar(acao.uuid_cliente, 'pendente', {
      erro: msg, tentativas, fotos_enviadas: enviadas,
      proxima_tentativa: new Date(Date.now() + espera).toISOString(),
    })
    fSyncEmitir('erro', { uuid: acao.uuid_cliente, err: msg, tentativas })
    return 'erro'
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
