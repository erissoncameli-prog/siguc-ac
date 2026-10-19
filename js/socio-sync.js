// ── SIGUC-AC · Diagnóstico Socioeconômico — fila de envio ─────────────
//
// Para cada ficha pronta no aparelho:
//   1. sobe as fotos para socio-fotos/<uuid_cliente da ficha>/<uuid da foto>.<ext>
//      (arquivo que já está lá = sucesso: reenvio depois de queda no meio);
//   2. chama socio_enviar_ficha (migration 362c), idempotente por
//      uuid_cliente — mandar de novo nunca duplica.
//
// Erro do banco no formato 'socio:<codigo>: <texto>' é de CONTEÚDO (fora do
// período, sem permissão…): a ficha vai para `erro`, com o texto, e continua
// no aparelho até alguém resolver. Qualquer outro erro (rede, sessão) deixa a
// ficha `pendente` e a próxima rodada tenta de novo. Nada aqui apaga ficha.

let _sSyncRodando = false

function sSyncEmitir(tipo, detalhe) {
  try { window.dispatchEvent(new CustomEvent('socio-sync', { detail: Object.assign({ tipo }, detalhe || {}) })) } catch (_) {}
}

// navigator.onLine mente (Wi-Fi sem internet, dados desligados): pergunta ao servidor
async function sSyncTemConexao() {
  if (typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL) return false
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD', headers: { apikey: SUPABASE_ANON_KEY }, cache: 'no-store', signal: ctrl.signal,
    })
    clearTimeout(t)
    return r.status < 500
  } catch (_) { return false }
}

async function sSyncGarantirSessao() {
  try {
    const { data: { session } } = await db.auth.getSession()
    if (!session) return false
    if (Date.now() > (session.expires_at || 0) * 1000 - 5 * 60 * 1000) {
      const { error } = await db.auth.refreshSession()
      if (error) return false
    }
    return true
  } catch (_) { return false }
}

// texto legível de um erro do banco ('socio:codigo: texto' → 'texto')
function sSyncMsg(e) {
  const m = String((e && (e.message || e.error_description || e.error)) || e || 'erro desconhecido')
  const r = m.match(/socio:[a-z_]+:\s*(.*)$/s)
  return r ? r[1] : m
}
function sSyncCodigo(e) {
  const r = String((e && e.message) || e || '').match(/socio:([a-z_]+)/)
  return r ? r[1] : null
}

// Monta o p_ficha da RPC a partir da ficha do aparelho. Identificação só
// vai quando o instrumento pede — o banco recusa o que não pediu.
function sSyncPayload(f) {
  const ident = ((f.questionario || {}).estrutura || {}).identificacao || {}
  const p = {
    uuid_cliente: f.uuid_cliente, codigo: f.codigo, questionario_id: f.questionario.id,
    campanha_id: f.campanha ? f.campanha.id : null, treino: !!f.treino,
    cd_mun: f.cd_mun || null, uc_id: f.uc_id || null,
    comunidade_id: f.comunidade_id || null, comunidade_nova: f.comunidade_id ? null : (f.comunidade_nova || null),
    dt_entrevista: f.dt_entrevista, iniciada_em: f.iniciada_em, finalizada_em: f.finalizada_em,
    aviso_lido: !!f.aviso_lido, aceitou_participar: !!f.aceitou_participar,
    fotos_autorizadas: f.aceitou_participar ? (f.fotos_autorizadas === true) : null,
    respostas: f.aceitou_participar ? (f.respostas_norm || {}) : {},
    obs_localizacao: f.obs_localizacao || null,
    app_versao: f.app_versao || null, dispositivo_id: f.dispositivo_id || null,
  }
  if (ident.nome === 'opcional' && f.aceitou_participar && f.entrevistado_nome) p.entrevistado_nome = f.entrevistado_nome
  if (ident.gps === 'opcional' && f.aceitou_participar && f.gps) {
    p.lat = f.gps.lat; p.lon = f.gps.lon; p.gps_precisao_m = f.gps.acc; p.gps_em = f.gps.em
  }
  return p
}

function sSyncUrlPublica(caminho) {
  // a coluna guarda o ENDEREÇO (bucket + caminho), não um link de acesso:
  // o bucket é privado e a leitura sempre passa por URL assinada
  return `${SUPABASE_URL}/storage/v1/object/public/socio-fotos/${caminho}`
}

async function sSyncSubirFotos(f) {
  const fotos = await sOfflineFotosDaFicha(f.uuid_cliente)
  const lista = []
  for (const foto of fotos) {
    if (!foto.enviada) {
      const ext = (foto.tipo || '').includes('webp') ? 'webp' : (foto.tipo || '').includes('png') ? 'png' : 'jpg'
      const caminho = `${f.uuid_cliente}/${foto.uuid_cliente}.${ext}`
      const { error } = await db.storage.from('socio-fotos')
        .upload(caminho, sOfflineFotoBlob(foto), { contentType: foto.tipo || 'image/jpeg', upsert: false })
      if (error && !(String(error.statusCode) === '409' || /exist|duplicate/i.test(error.message || ''))) throw error
      foto.enviada = true
      foto.caminho = caminho
      await sOfflineSalvarFoto(foto)
    }
    lista.push({
      uuid_cliente: foto.uuid_cliente, tema: foto.tema || 'outro', legenda: foto.legenda || null,
      pergunta_chave: foto.pergunta_chave || null, arquivo_url: sSyncUrlPublica(foto.caminho),
      tirada_em: foto.tirada_em || null, lat: foto.lat ?? null, lon: foto.lon ?? null,
      gps_precisao_m: foto.acc ?? null,
    })
  }
  return lista
}

// gera outro código para a mesma ficha (colisão rara entre aparelhos)
async function sSyncNovoCodigo(f) {
  const d = new Date(f.finalizada_em)
  const aammdd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  const seq = await sOfflineProximoSeq(aammdd)
  f.codigo = SocioRegras.gerarCodigo(f.treino ? 'TRE' : f.instrumento.codigo, d, f.dispositivo_id, seq)
  await sOfflineSalvarFicha(f)
}

async function sSyncUma(uuid) {
  let f = await sOfflineFicha(uuid)
  if (!f || (f.estado !== 'pendente' && f.estado !== 'enviando')) return false
  await sOfflineMarcar(uuid, 'enviando')
  try {
    const fotos = f.aceitou_participar && f.fotos_autorizadas ? await sSyncSubirFotos(f) : []
    let r = await db.rpc('socio_enviar_ficha', { p_ficha: sSyncPayload(f), p_linhas: f.aceitou_participar ? (f.linhas || []) : [], p_fotos: fotos })
    if (r.error && sSyncCodigo(r.error) === 'codigo_duplicado') {
      await sSyncNovoCodigo(f)
      f = await sOfflineFicha(uuid)
      r = await db.rpc('socio_enviar_ficha', { p_ficha: sSyncPayload(f), p_linhas: f.aceitou_participar ? (f.linhas || []) : [], p_fotos: fotos })
    }
    if (r.error) throw r.error
    await sOfflineMarcar(uuid, 'enviada', {
      enviado_em: new Date().toISOString(), ultimo_erro: null,
      servidor: { id: r.data.id, codigo: r.data.codigo, status: r.data.status, alertas: r.data.alertas || [] },
    })
    sSyncEmitir('enviada', { uuid })
    return true
  } catch (e) {
    const codigo = sSyncCodigo(e)
    await sOfflineMarcar(uuid, codigo ? 'erro' : 'pendente', { ultimo_erro: sSyncMsg(e), erro_codigo: codigo })
    sSyncEmitir('erro', { uuid, msg: sSyncMsg(e), permanente: !!codigo })
    return false
  }
}

// Ponto de entrada. Devolve 'vazio' | 'sem_conexao' | 'sem_sessao' | 'ocupado' | {ok, erros}
async function sSyncRodar() {
  if (_sSyncRodando || !db) return 'ocupado'
  _sSyncRodando = true
  try {
    const pend = await sOfflineListarPendentes()
    if (!pend.length) return 'vazio'
    if (!await sSyncTemConexao()) return 'sem_conexao'
    if (!await sSyncGarantirSessao()) { sSyncEmitir('sem_sessao'); return 'sem_sessao' }
    sSyncEmitir('inicio', { total: pend.length })
    let ok = 0, erros = 0
    for (const f of pend) { if (await sSyncUma(f.uuid_cliente)) ok++; else erros++ }
    sSyncEmitir('fim', { ok, erros })
    return { ok, erros }
  } finally {
    _sSyncRodando = false
  }
}

// devolve uma ficha com erro à fila (depois de corrigida, ou só para tentar de novo)
async function sSyncReenfileirar(uuid) {
  const f = await sOfflineFicha(uuid)
  if (!f || (f.estado !== 'erro' && f.estado !== 'enviando')) return false
  await sOfflineMarcar(uuid, 'pendente', { ultimo_erro: null, erro_codigo: null })
  return true
}
