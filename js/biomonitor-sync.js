// ── SIGUC Biomonitor — Motor de Sincronização ─────────────────
// Envia ninhos, transferências e eclosões pendentes para o Supabase.
// Suporta retry com backoff e sincronização de fotos via Storage.
// Requer biomonitor-offline.js e um cliente Supabase em window._bioDB_client.

let _bioSyncEmAndamento = false
let _bioSyncAbortCtrl   = null
const BIO_BUCKET = 'biomonitor-fotos'  // bucket no Supabase Storage

// ── Cliente Supabase compartilhado (injetado pelo HTML) ────────
// O HTML do app define window._bioDB_client = supabase.createClient(...)
// com sessão em localStorage (não compartilha sessão com o SIGUC principal).
function bioSupabase() {
  if (!window._bioDB_client) throw new Error('biomonitor: cliente Supabase não inicializado')
  return window._bioDB_client
}

// ── Upload de foto para o Storage ──────────────────────────────
async function bioSyncUploadFoto(dataUrl, nomeArquivo) {
  const sb = bioSupabase()

  // Converte dataURL → Blob
  const arr  = dataUrl.split(',')
  const mime = arr[0].match(/:(.*?);/)[1]
  const bstr = atob(arr[1])
  const u8   = new Uint8Array(bstr.length)
  for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i)
  const blob = new Blob([u8], { type: mime })

  const { data, error } = await sb.storage
    .from(BIO_BUCKET)
    .upload(nomeArquivo, blob, { upsert: true })

  if (error) throw error

  const { data: { publicUrl } } = sb.storage.from(BIO_BUCKET).getPublicUrl(nomeArquivo)
  return publicUrl
}

// ── Upload de todas as fotos de um item ───────────────────────
async function bioSyncUploadFotos(fotos, prefixo) {
  if (!fotos || !fotos.length) return []
  const urls = []
  for (let i = 0; i < fotos.length; i++) {
    const foto = fotos[i]
    // Fotos já com URL pública (sync anterior ou importadas) passam direto
    if (foto.startsWith('http')) { urls.push(foto); continue }
    const ext  = foto.includes('image/png') ? 'png' : 'jpg'
    const nome = `${prefixo}_${i}.${ext}`
    const url  = await bioSyncUploadFoto(foto, nome)
    urls.push(url)
  }
  return urls
}

// ── Sincronizar ninhos pendentes ──────────────────────────────
async function bioSyncNinhos(monitorId, onProgresso) {
  const pendentes = await bioOfflineNinhosPendentes()
  let n = 0
  for (const ninho of pendentes) {
    onProgresso?.(`Ninho ${ninho.numero_ninho}…`)

    // Upload das fotos antes do upsert
    let fotoUrls = ninho.foto_urls ?? []
    if (fotoUrls.some(f => f.startsWith('data:'))) {
      fotoUrls = await bioSyncUploadFotos(fotoUrls, `ninhos/${ninho.uuid_cliente}`)
    }

    const payload = {
      uuid_cliente:     ninho.uuid_cliente,
      numero_ninho:     ninho.numero_ninho,
      // Só ninhos pendentes de envio chegam aqui (novo ou reenvio de
      // correção): em ambos a validação é 'pendente' e sem motivo. Enviar
      // garante que o reenvio devolva o ninho à fila do gestor.
      status_validacao: ninho.status_validacao || 'pendente',
      motivo_rejeicao:  ninho.motivo_rejeicao  ?? null,
      praia_id:         ninho.praia_id         || null,
      uc_id:            ninho.uc_id            || null,
      municipio:        ninho.municipio        || null,
      especie:          ninho.especie,
      data_encontro:    ninho.data_encontro,
      hora_desova:      ninho.hora_desova      || null,
      foto_urls:        fotoUrls,
      observacoes:      ninho.observacoes      || null,
      monitor_id:       monitorId,
      grupo_id:         ninho.grupo_id         || null,
      localizacao:      ninho.lat != null && ninho.lng != null
        ? `POINT(${ninho.lng} ${ninho.lat})`
        : null,
      precisao_gps_m:   ninho.precisao_gps_m  || null,
      qtd_ovos:         ninho.qtd_ovos         ?? null,
      ovos_integros:    ninho.ovos_integros    ?? null,
      ovos_descartados: ninho.ovos_descartados ?? null,
      dist_rio_m:       ninho.dist_rio_m       ?? null,
      dist_rio_metodo:  ninho.dist_rio_metodo  || null,
      temperatura_c:    ninho.temperatura_c    ?? null,
      umidade_pct:      ninho.umidade_pct      ?? null,
      profundidade_cm:  ninho.profundidade_cm  ?? null,
      alerta_campo:     ninho.alerta_campo     ?? null,
      temporada_id:     ninho.temporada_id     ?? null,
    }

    await bioOfflineAtualizarSync('ninhos', ninho.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('ninhos_quelonios')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineAtualizarSync('ninhos', ninho.uuid_cliente, 'pendente')
      throw error
    }

    await bioOfflineAtualizarSync('ninhos', ninho.uuid_cliente, 'confirmado', data.id)

    // Reconcilia os eventos de descarte de ovos do ninho no servidor.
    if (ninho.descartes_dirty) {
      try { await bioSyncReconciliarDescartes(ninho.uuid_cliente, data.id, monitorId) } catch (_) {}
    }
    n++
  }
  return n
}

// Reconcilia os descartes (etapa registro) de um ninho: apaga os do
// servidor e reinsere o conjunto local — garante consistência mesmo
// quando o monitor edita e remove causas no reenvio de correção.
async function bioSyncReconciliarDescartes(ninhoUuid, ninhoServId, monitorId) {
  await bioSupabase()
    .from('descartes_ovos')
    .delete()
    .eq('ninho_id', ninhoServId)
    .eq('etapa', 'registro')

  const locais = await bioOfflineDescartesDoNinho(ninhoUuid, 'registro')
  for (const d of locais) {
    const { error } = await bioSupabase()
      .from('descartes_ovos')
      .upsert({
        uuid_cliente:  d.uuid_cliente,
        ninho_id:      ninhoServId,
        qtd:           d.qtd,
        motivo:        d.motivo,
        etapa:         'registro',
        data_descarte: d.data_descarte,
        monitor_id:    monitorId,
      }, { onConflict: 'uuid_cliente' })
    if (!error) await bioOfflineAtualizarSync('descartes', d.uuid_cliente, 'confirmado')
  }
}

// Resolve o id do ninho no servidor de forma robusta:
// server_id local → id (herdado da view do servidor) → busca no banco
// por uuid_cliente. Persiste o server_id no registro local para os
// próximos syncs. Evita que filhos (transferência/eclosão/visita…)
// fiquem presos em "pendente" quando o server_id foi perdido.
async function bioResolverNinhoServId(ninhoUuid) {
  if (!ninhoUuid) return null
  const local = await bioOfflineGetNinho(ninhoUuid)
  let servId  = local?.server_id ?? local?.id ?? null
  if (!servId && navigator.onLine) {
    try {
      const { data } = await bioSupabase()
        .from('ninhos_quelonios').select('id').eq('uuid_cliente', ninhoUuid).maybeSingle()
      servId = data?.id ?? null
    } catch (_) {}
  }
  if (servId && local && local.server_id !== servId) {
    try { await bioOfflineAtualizarSync('ninhos', ninhoUuid, local.status_sync || 'confirmado', servId) } catch (_) {}
  }
  return servId
}

// ── Sincronizar transferências pendentes ──────────────────────
async function bioSyncTransferencias(monitorId, onProgresso) {
  const pendentes = await bioOfflineTransfPendentes()
  let n = 0
  for (const t of pendentes) {
    onProgresso?.(`Transferência do ninho ${t.ninho_numero ?? ''}…`)

    // Resolve o id do ninho no servidor (robusto)
    const ninhoServId = await bioResolverNinhoServId(t.ninho_uuid)
    if (!ninhoServId) continue  // ninho ainda não no banco; tenta no próximo sync

    let fotoUrls = t.foto_urls ?? []
    if (fotoUrls.some(f => f.startsWith('data:'))) {
      fotoUrls = await bioSyncUploadFotos(fotoUrls, `transferencias/${t.uuid_cliente}`)
    }

    const payload = {
      uuid_cliente:        t.uuid_cliente,
      ninho_id:            ninhoServId,
      data_transferencia:  t.data_transferencia,
      hora_transferencia:  t.hora_transferencia || null,
      qtd_ovos:            t.qtd_ovos,
      praia_destino_id:    t.praia_destino_id  || null,
      numero_atual:        t.numero_atual      || null,
      motivo:              t.motivo            || null,
      local_destino:       t.local_destino     || null,
      observacoes:         t.observacoes       || null,
      foto_urls:           fotoUrls,
      monitor_id:          monitorId,
    }

    await bioOfflineAtualizarSync('transferencias', t.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('transferencias_ninho')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineAtualizarSync('transferencias', t.uuid_cliente, 'pendente')
      // Número duplicado no destino (guard de integridade, mig. 119): é uma
      // rejeição não-recuperável por reenvio. Não aborta a fila inteira —
      // registra o aviso e segue para as próximas transferências.
      if (error.code === '23505' || /ocupado/i.test(error.message || '')) {
        try { bioToast?.(`Transferência do ninho ${t.ninho_numero ?? ''}: número já ocupado no destino.`, 'err') } catch (_) {}
        continue
      }
      throw error
    }

    await bioOfflineAtualizarSync('transferencias', t.uuid_cliente, 'confirmado', data.id)
    n++
  }
  return n
}

// ── Sincronizar eclosões pendentes ────────────────────────────
async function bioSyncEclosoes(monitorId, onProgresso) {
  const pendentes = await bioOfflineEclosoesPendentes()
  let n = 0
  for (const e of pendentes) {
    onProgresso?.(`Eclosão do ninho ${e.ninho_numero ?? ''}…`)

    const ninhoServId = await bioResolverNinhoServId(e.ninho_uuid)
    if (!ninhoServId) continue

    let fotoUrls = e.foto_urls ?? []
    if (fotoUrls.some(f => f.startsWith('data:'))) {
      fotoUrls = await bioSyncUploadFotos(fotoUrls, `eclosoes/${e.uuid_cliente}`)
    }

    const payload = {
      uuid_cliente:       e.uuid_cliente,
      ninho_id:           ninhoServId,
      data_nascimento:    e.data_nascimento,
      filhotes_vivos:     e.filhotes_vivos,
      filhotes_mortos:    e.filhotes_mortos,
      ovos_nao_nascidos:  e.ovos_nao_nascidos,
      predacao:           e.predacao,
      foto_urls:          fotoUrls,
      observacoes:        e.observacoes || null,
      monitor_id:         monitorId,
    }

    await bioOfflineAtualizarSync('eclosoes', e.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('eclosoes_ninho')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineAtualizarSync('eclosoes', e.uuid_cliente, 'pendente')
      throw error
    }

    await bioOfflineAtualizarSync('eclosoes', e.uuid_cliente, 'confirmado', data.id)
    n++
  }
  return n
}

// ── Sincronizar visitas de acompanhamento pendentes ───────────
async function bioSyncVisitas(monitorId, onProgresso) {
  const pendentes = await bioOfflineVisitasPendentes()
  let n = 0
  for (const v of pendentes) {
    onProgresso?.(`Visita do ninho ${v.ninho_numero ?? ''}…`)

    const ninhoServId = await bioResolverNinhoServId(v.ninho_uuid)
    if (!ninhoServId) continue

    let fotoUrls = v.foto_urls ?? []
    if (fotoUrls.some(f => f.startsWith('data:'))) {
      fotoUrls = await bioSyncUploadFotos(fotoUrls, `visitas/${v.uuid_cliente}`)
    }

    const payload = {
      uuid_cliente:            v.uuid_cliente,
      ninho_id:                ninhoServId,
      data_visita:             v.data_visita,
      hora_visita:             v.hora_visita             || null,
      status_ninho:            v.status_ninho,
      temperatura_substrato_c: v.temperatura_substrato_c ?? null,
      temperatura_ar_c:        v.temperatura_ar_c        ?? null,
      umidade:                 v.umidade                 || null,
      predacao_incubacao:      v.predacao_incubacao      ?? null,
      ovos_predados_n:         v.ovos_predados_n         ?? null,
      ovos_perdidos_alagamento: v.ovos_perdidos_alagamento ?? null,
      ovos_perdidos_erosao:    v.ovos_perdidos_erosao    ?? null,
      ovos_perdidos_humana:    v.ovos_perdidos_humana    ?? null,
      causa_destruicao:        v.causa_destruicao        ?? null,
      sinal_alagamento:        v.sinal_alagamento        ?? false,
      intervencao:             v.intervencao             || null,
      observacoes:             v.observacoes             || null,
      foto_urls:               fotoUrls,
      alerta_campo:            v.alerta_campo            ?? null,
      monitor_id:              monitorId,
    }

    await bioOfflineAtualizarSync('visitas', v.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('visitas_ninho')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineAtualizarSync('visitas', v.uuid_cliente, 'pendente')
      throw error
    }

    await bioOfflineAtualizarSync('visitas', v.uuid_cliente, 'confirmado', data.id)
    n++
  }
  return n
}

// ── Sincronizar lotes em berçário pendentes ───────────────────
async function bioSyncLotes(monitorId, onProgresso) {
  const pendentes = await bioOfflineLotesPendentes()
  let n = 0
  for (const l of pendentes) {
    onProgresso?.(`Lote berçário — ninho ${l.ninho_numero ?? ''}…`)

    const ninhoServId = await bioResolverNinhoServId(l.ninho_uuid)
    if (!ninhoServId) continue

    const payload = {
      uuid_cliente:  l.uuid_cliente,
      ninho_id:      ninhoServId,
      bercario_id:   l.bercario_id   || null,
      bercario_nome: l.bercario_nome,
      data_entrada:  l.data_entrada,
      hora_entrada:  l.hora_entrada  || null,
      qtd_entrada:   l.qtd_entrada,
      status:        l.status,
      observacoes:   l.observacoes   || null,
      monitor_id:    monitorId,
    }

    await bioOfflineAtualizarSync('lotes', l.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('lotes_bercario')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineAtualizarSync('lotes', l.uuid_cliente, 'pendente')
      throw error
    }

    await bioOfflineAtualizarSync('lotes', l.uuid_cliente, 'confirmado', data.id)
    n++
  }
  return n
}

// ── Sincronizar solturas de filhotes pendentes ────────────────
async function bioSyncSolturas(monitorId, onProgresso) {
  const pendentes = await bioOfflineSolturasPendentes()
  let n = 0
  for (const s of pendentes) {
    onProgresso?.(`Soltura — ninho ${s.ninho_numero ?? ''}…`)

    const ninhoServId = await bioResolverNinhoServId(s.ninho_uuid)
    if (!ninhoServId) continue

    let loteServId = null
    if (s.via_bercario && s.lote_uuid) {
      const loteLocal = await bioOfflineGetLote(s.lote_uuid)
      loteServId = loteLocal?.server_id ?? null
      if (!loteServId) continue  // lote ainda não sincronizado
    }

    let fotoUrlsSol = s.foto_urls ?? []
    if (fotoUrlsSol.some(f => f.startsWith('data:'))) {
      fotoUrlsSol = await bioSyncUploadFotos(fotoUrlsSol, `solturas/${s.uuid_cliente}`)
    }

    const payload = {
      uuid_cliente:     s.uuid_cliente,
      ninho_id:         ninhoServId,
      lote_bercario_id: loteServId,
      via_bercario:     s.via_bercario,
      data_soltura:     s.data_soltura,
      hora_soltura:     s.hora_soltura     || null,
      qtd_soltada:      s.qtd_soltada,
      mortalidade:      s.mortalidade      ?? 0,
      ponto_soltura:    s.lat != null && s.lng != null
        ? `POINT(${s.lng} ${s.lat})`
        : null,
      local_descricao:  s.local_descricao  || null,
      predacao_soltura: s.predacao_soltura ?? false,
      observacoes:      s.observacoes      || null,
      foto_urls:        fotoUrlsSol,
      monitor_id:       monitorId,
    }

    await bioOfflineAtualizarSync('solturas', s.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('solturas_filhotes')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineAtualizarSync('solturas', s.uuid_cliente, 'pendente')
      throw error
    }

    await bioOfflineAtualizarSync('solturas', s.uuid_cliente, 'confirmado', data.id)
    n++
  }
  return n
}

// ── Sincronizar ocorrências de berçário pendentes ─────────────
async function bioSyncOcorrencias(monitorId, onProgresso) {
  const pendentes = await bioOfflineOcorrenciasPendentes()
  let n = 0
  for (const oc of pendentes) {
    onProgresso?.(`Ocorrência berçário…`)

    const loteLocal = await bioOfflineGetLote(oc.lote_uuid)
    const loteServId = loteLocal?.server_id
    if (!loteServId) continue

    let fotoUrlsOc = oc.foto_urls ?? []
    if (fotoUrlsOc.some(f => f.startsWith('data:'))) {
      fotoUrlsOc = await bioSyncUploadFotos(fotoUrlsOc, `ocorrencias-bercario/${oc.uuid_cliente}`)
    }

    const payload = {
      uuid_cliente:         oc.uuid_cliente,
      lote_id:              loteServId,
      tipo:                 oc.tipo,
      data_ocorrencia:      oc.data_ocorrencia,
      hora_ocorrencia:      oc.hora_ocorrencia      || null,
      comprimento_medio_cm: oc.comprimento_medio_cm ?? null,
      peso_medio_g:         oc.peso_medio_g         ?? null,
      n_amostrados:         oc.n_amostrados         ?? null,
      qtd_afetados:         oc.qtd_afetados         ?? null,
      causa:                oc.causa                || null,
      descricao:            oc.descricao            || null,
      foto_urls:            fotoUrlsOc,
      monitor_id:           monitorId,
      sincronizado_em:      new Date().toISOString(),
    }

    await bioOfflineAtualizarSync('ocorrencias', oc.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('ocorrencias_bercario')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineAtualizarSync('ocorrencias', oc.uuid_cliente, 'pendente')
      throw error
    }

    await bioOfflineAtualizarSync('ocorrencias', oc.uuid_cliente, 'confirmado', data.id)
    n++
  }
  return n
}

// ── Sincronização completa ────────────────────────────────────
async function bioSyncTudo({ monitorId, onProgresso, onConcluido, onErro } = {}) {
  if (_bioSyncEmAndamento) return
  if (!navigator.onLine)   return

  _bioSyncEmAndamento = true
  _bioSyncAbortCtrl   = new AbortController()

  try {
    const n  = await bioSyncNinhos(monitorId, onProgresso)
    const t  = await bioSyncTransferencias(monitorId, onProgresso)
    const e  = await bioSyncEclosoes(monitorId, onProgresso)
    const v  = await bioSyncVisitas(monitorId, onProgresso)
    const l  = await bioSyncLotes(monitorId, onProgresso)
    const s  = await bioSyncSolturas(monitorId, onProgresso)
    const oc = await bioSyncOcorrencias(monitorId, onProgresso)
    // Pull: traz de volta mudanças do servidor (ex.: validação/correção
    // feita pelo gestor) para o IndexedDB.
    const grupoId = (typeof BioApp !== 'undefined' && BioApp.monitor?.grupo_id) || null
    if (grupoId) { try { await bioSyncPullNinhos(grupoId) } catch (_) {} }
    await bioOfflineLimparConfirmados()
    onConcluido?.({ ninhos: n, transferencias: t, eclosoes: e, visitas: v, lotes: l, solturas: s, ocorrencias: oc })
  } catch (err) {
    onErro?.(err)
  } finally {
    _bioSyncEmAndamento = false
    _bioSyncAbortCtrl   = null
  }
}

// ── Cache de berçários do servidor ───────────────────────────
async function bioSyncCacheBercarios() {
  if (!navigator.onLine) return

  const { data, error } = await bioSupabase()
    .from('bercarios')
    .select('id,nome,tipo,capacidade_max,localizacao_descricao,uc_id,status')
    .eq('status', true)

  if (error || !data) return
  await bioOfflineSalvarBercarios(data)
}

// ── Cache da temporada atual (do programa do grupo) ───────────
async function bioSyncCacheTemporada(grupoId) {
  if (!navigator.onLine || !grupoId) return
  const { data: g } = await bioSupabase()
    .from('grupos_biomonitor').select('programa_id').eq('id', grupoId).maybeSingle()
  if (!g?.programa_id) return
  const { data: t } = await bioSupabase()
    .from('temporadas_biomonitor')
    .select('id,nome,ano_base,data_inicio,data_fim,programa_id,is_atual')
    .eq('programa_id', g.programa_id).eq('is_atual', true).maybeSingle()
  if (t) {
    await bioOfflineSetConfig('temporada_atual', t)
    // Metas de ninhos por praia (da temporada atual) — para mostrar no campo
    const { data: tp } = await bioSupabase()
      .from('temporada_praias').select('praia_id,meta_ninhos').eq('temporada_id', t.id)
    const metas = {}
    ;(tp || []).forEach(r => { if (r.meta_ninhos != null) metas[r.praia_id] = r.meta_ninhos })
    await bioOfflineSetConfig('temporada_praias_meta', metas)
  }
}

// ── Cache de praias do servidor ───────────────────────────────
async function bioSyncCachePraias(grupoId) {
  if (!navigator.onLine) return

  const { data, error } = await bioSupabase()
    .from('praias_monitoramento')
    .select(`
      id, codigo, sigla, nome, comunidade, municipio, ativa, experimental,
      periodo_inicio, periodo_fim,
      ponto_acesso,
      area_geom,
      programa_id,
      uc_id
    `)
    .eq('ativa', true)
    .order('nome')

  if (error || !data) return

  // Extrai lat/lng do ponto_acesso (retornado como WKT ou GeoJSON)
  const praias = data.map(p => {
    let lat = null, lng = null
    if (p.ponto_acesso) {
      // Formato: { type: "Point", coordinates: [lng, lat] }
      if (typeof p.ponto_acesso === 'object' && p.ponto_acesso.coordinates) {
        lng = p.ponto_acesso.coordinates[0]
        lat = p.ponto_acesso.coordinates[1]
      }
    }
    return { ...p, lat, lng, area_geojson: p.area_geom || null }
  })

  await bioOfflineSalvarPraias(praias)
  await bioOfflineSetConfig('praias_ultima_sync', new Date().toISOString())
}

// ── Pull: busca ninhos do servidor para atualizar o IndexedDB ─
async function bioSyncPullNinhos(grupoId) {
  if (!navigator.onLine) return

  const { data, error } = await bioSupabase()
    .from('ninhos_quelonios')
    .select(`
      id, uuid_cliente, numero_ninho, numero_atual, especie, data_encontro,
      status, status_validacao, motivo_rejeicao,
      foto_urls, observacoes, praia_id, praia_atual_id, uc_id, grupo_id, monitor_id,
      sincronizado_em, criado_em
    `)
    .eq('grupo_id', grupoId)
    .order('data_encontro', { ascending: false })
    .limit(200)

  if (error || !data) return

  for (const n of data) {
    const local = await bioOfflineGetNinho(n.uuid_cliente)
    if (!local) {
      // Ninho registrado por outro monitor do grupo — adiciona localmente
      await bioOfflineSalvarNinho({
        ...n,
        server_id:  n.id,
        status_sync: 'confirmado',
        sincronizado_em: n.sincronizado_em ?? new Date().toISOString(),
      })
    } else {
      // Atualiza status/validação e a localização atual (praia + placa)
      // se mudou no servidor — ex.: transferência feita por outro monitor.
      if (local.status !== n.status ||
          local.status_validacao !== n.status_validacao ||
          local.praia_atual_id !== n.praia_atual_id ||
          local.numero_atual !== n.numero_atual) {
        await bioOfflineSalvarNinho({
          ...local,
          status:           n.status,
          status_validacao: n.status_validacao,
          motivo_rejeicao:  n.motivo_rejeicao,
          praia_atual_id:   n.praia_atual_id ?? local.praia_atual_id,
          numero_atual:     n.numero_atual   ?? local.numero_atual,
        })
      }
    }
  }

  await bioOfflineSetConfig('ninhos_ultima_sync', new Date().toISOString())
}

// ── Online/offline listeners ──────────────────────────────────
function bioSyncIniciarListeners(ctx) {
  window.addEventListener('online',  () => bioSyncTudo(ctx))
  window.addEventListener('offline', () => {
    const el = document.getElementById('bio-conn-chip')
    if (el) { el.classList.remove('on'); el.classList.add('off') }
    const tx = document.getElementById('bio-conn-texto')
    if (tx) tx.textContent = 'Offline'
  })
}
