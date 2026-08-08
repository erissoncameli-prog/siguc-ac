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
    try {
      if (fotoUrls.some(f => f.startsWith('data:'))) {
        fotoUrls = await bioSyncUploadFotos(fotoUrls, `ninhos/${ninho.uuid_cliente}`)
      }
    } catch (e) { await bioOfflineMarcarErroSync('ninhos', ninho.uuid_cliente, 'fotos: ' + (e.message || e)); continue }

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
      // Registro local antigo pode não ter grupo — cai para o grupo do
      // monitor logado; nulo o trigger do servidor deriva do monitor_id
      grupo_id:         ninho.grupo_id
        || (typeof BioApp !== 'undefined' ? BioApp.monitor?.grupo_id : null)
        || null,
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
      sincronizado_em:  new Date().toISOString(),
    }

    await bioOfflineAtualizarSync('ninhos', ninho.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('ninhos_quelonios')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineMarcarErroSync('ninhos', ninho.uuid_cliente, error.message)
      continue
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
    try {
      if (fotoUrls.some(f => f.startsWith('data:'))) {
        fotoUrls = await bioSyncUploadFotos(fotoUrls, `transferencias/${t.uuid_cliente}`)
      }
    } catch (e) { await bioOfflineMarcarErroSync('transferencias', t.uuid_cliente, 'fotos: ' + (e.message || e)); continue }

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
      sincronizado_em:     new Date().toISOString(),
    }

    await bioOfflineAtualizarSync('transferencias', t.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('transferencias_ninho')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      // Número duplicado no destino (guard de integridade, mig. 119) é
      // rejeição definitiva — avisa. Demais erros: marca e segue (nunca
      // aborta a fila).
      if (error.code === '23505' || /ocupado/i.test(error.message || '')) {
        try { bioToast?.(`Transferência do ninho ${t.ninho_numero ?? ''}: número já ocupado no destino.`, 'err') } catch (_) {}
      }
      await bioOfflineMarcarErroSync('transferencias', t.uuid_cliente, error.message)
      continue
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
    try {
      if (fotoUrls.some(f => f.startsWith('data:'))) {
        fotoUrls = await bioSyncUploadFotos(fotoUrls, `eclosoes/${e.uuid_cliente}`)
      }
    } catch (er) { await bioOfflineMarcarErroSync('eclosoes', e.uuid_cliente, 'fotos: ' + (er.message || er)); continue }

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
      sincronizado_em:    new Date().toISOString(),
    }

    await bioOfflineAtualizarSync('eclosoes', e.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('eclosoes_ninho')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineMarcarErroSync('eclosoes', e.uuid_cliente, error.message)
      continue
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
    try {
      if (fotoUrls.some(f => f.startsWith('data:'))) {
        fotoUrls = await bioSyncUploadFotos(fotoUrls, `visitas/${v.uuid_cliente}`)
      }
    } catch (e) { await bioOfflineMarcarErroSync('visitas', v.uuid_cliente, 'fotos: ' + (e.message || e)); continue }

    const payload = {
      uuid_cliente:            v.uuid_cliente,
      ninho_id:                ninhoServId,
      data_visita:             v.data_visita,
      hora_visita:             v.hora_visita             || null,
      status_ninho:            v.status_ninho,
      temperatura_substrato_c: v.temperatura_substrato_c ?? null,
      temperatura_ar_c:        v.temperatura_ar_c        ?? null,
      umidade:                 v.umidade                 || null,
      predacao_incubacao:      v.predacao_incubacao      ?? 'nenhuma',
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
      sincronizado_em:         new Date().toISOString(),
    }

    await bioOfflineAtualizarSync('visitas', v.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('visitas_ninho')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineMarcarErroSync('visitas', v.uuid_cliente, error.message)
      continue
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
      sincronizado_em: new Date().toISOString(),
    }

    await bioOfflineAtualizarSync('lotes', l.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('lotes_bercario')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineMarcarErroSync('lotes', l.uuid_cliente, error.message)
      continue
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
    try {
      if (fotoUrlsSol.some(f => f.startsWith('data:'))) {
        fotoUrlsSol = await bioSyncUploadFotos(fotoUrlsSol, `solturas/${s.uuid_cliente}`)
      }
    } catch (e) { await bioOfflineMarcarErroSync('solturas', s.uuid_cliente, 'fotos: ' + (e.message || e)); continue }

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
      sincronizado_em:  new Date().toISOString(),
    }

    await bioOfflineAtualizarSync('solturas', s.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('solturas_filhotes')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineMarcarErroSync('solturas', s.uuid_cliente, error.message)
      continue
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

    let individuoServId = null
    if (oc.individuo_uuid) {
      const indLocal = await bioOfflineGetIndividuo(oc.individuo_uuid)
      individuoServId = indLocal?.server_id ?? null
      if (!individuoServId) continue  // indivíduo ainda não sincronizado
    }

    let fotoUrlsOc = oc.foto_urls ?? []
    try {
      if (fotoUrlsOc.some(f => f.startsWith('data:'))) {
        fotoUrlsOc = await bioSyncUploadFotos(fotoUrlsOc, `ocorrencias-bercario/${oc.uuid_cliente}`)
      }
    } catch (e) { await bioOfflineMarcarErroSync('ocorrencias', oc.uuid_cliente, 'fotos: ' + (e.message || e)); continue }

    const payload = {
      uuid_cliente:         oc.uuid_cliente,
      lote_id:              loteServId,
      individuo_id:         individuoServId,
      tipo:                 oc.tipo,
      data_ocorrencia:      oc.data_ocorrencia,
      hora_ocorrencia:      oc.hora_ocorrencia      || null,
      comprimento_medio_cm: oc.comprimento_medio_cm ?? null,
      peso_medio_g:         oc.peso_medio_g         ?? null,
      n_amostrados:         oc.n_amostrados         ?? null,
      qtd_afetados:         oc.qtd_afetados         ?? 0,
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
      await bioOfflineMarcarErroSync('ocorrencias', oc.uuid_cliente, error.message)
      continue
    }

    await bioOfflineAtualizarSync('ocorrencias', oc.uuid_cliente, 'confirmado', data.id)
    n++
  }
  return n
}

// ── Sincronizar filhotes individuais do berçário pendentes ────
async function bioSyncIndividuos(monitorId, onProgresso) {
  const pendentes = await bioOfflineIndividuosPendentes()
  let n = 0
  for (const ind of pendentes) {
    onProgresso?.(`Filhote #${ind.numero}…`)

    const loteLocal  = await bioOfflineGetLote(ind.lote_uuid)
    const loteServId = loteLocal?.server_id
    if (!loteServId) continue  // lote ainda não sincronizado; tenta no próximo sync

    const payload = {
      uuid_cliente:  ind.uuid_cliente,
      lote_id:       loteServId,
      numero:        ind.numero,
      status:        ind.status || 'ativo',
      doente:        ind.doente        ?? false,
      data_obito:    ind.data_obito    || null,
      causa_obito:   ind.causa_obito   || null,
      observacoes:   ind.observacoes   || null,
      monitor_id:    monitorId,
      sincronizado_em: new Date().toISOString(),
    }

    await bioOfflineAtualizarSync('individuos', ind.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('filhotes_bercario')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineMarcarErroSync('individuos', ind.uuid_cliente, error.message)
      continue
    }

    await bioOfflineAtualizarSync('individuos', ind.uuid_cliente, 'confirmado', data.id)
    n++
  }
  return n
}

// ── Sincronizar biometrias individuais pendentes ──────────────
async function bioSyncBiometriasInd(monitorId, onProgresso) {
  const pendentes = await bioOfflineBiometriasIndPendentes()
  let n = 0
  for (const b of pendentes) {
    onProgresso?.(`Biometria individual…`)

    const indLocal  = await bioOfflineGetIndividuo(b.individuo_uuid)
    const indServId = indLocal?.server_id
    if (!indServId) continue  // indivíduo ainda não sincronizado; tenta no próximo sync

    const payload = {
      uuid_cliente:            b.uuid_cliente,
      individuo_id:            indServId,
      data_medicao:            b.data_medicao,
      hora_medicao:            b.hora_medicao            || null,
      comprimento_cm:          b.comprimento_cm          ?? null,
      largura_carapaca_cm:     b.largura_carapaca_cm     ?? null,
      comprimento_plastrao_cm: b.comprimento_plastrao_cm ?? null,
      peso_g:                  b.peso_g                  ?? null,
      observacoes:             b.observacoes             || null,
      monitor_id:      monitorId,
      sincronizado_em: new Date().toISOString(),
    }

    await bioOfflineAtualizarSync('biometrias_ind', b.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase()
      .from('biometrias_individuais')
      .upsert(payload, { onConflict: 'uuid_cliente' })
      .select('id')
      .single()

    if (error) {
      await bioOfflineMarcarErroSync('biometrias_ind', b.uuid_cliente, error.message)
      continue
    }

    await bioOfflineAtualizarSync('biometrias_ind', b.uuid_cliente, 'confirmado', data.id)
    n++
  }
  return n
}

// ── Sincronizar cautelas de equipamento pendentes ──────────────
// Ao contrário das demais entidades (upsert direto na tabela), a
// cautela só pode ser gravada via RPC — a tabela não tem policy de
// INSERT para o cliente (mesmo padrão de lgpd_aceites/frota_inspecoes,
// migration 227). RPC é idempotente por uuid_cliente.
async function bioSyncCautelas(monitorId, onProgresso) {
  const pendentes = await bioOfflineCautelasPendentes()
  let n = 0
  for (const c of pendentes) {
    onProgresso?.('Cautela de equipamento…')

    await bioOfflineAtualizarSync('cautelas', c.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase().rpc('biomonitor_registrar_cautela', {
      p_uuid_cliente:     c.uuid_cliente,
      p_equipamento_ids:  c.equipamento_ids,
      p_termo_versao_id:  c.termo_versao_id,
      p_dias_prazo:       c.dias_prazo,
      p_lat: c.lat ?? null,
      p_lng: c.lng ?? null,
    })

    if (error) {
      await bioOfflineMarcarErroSync('cautelas', c.uuid_cliente, error.message)
      continue
    }

    await bioOfflineAtualizarSync('cautelas', c.uuid_cliente, 'confirmado', data)
    n++
  }
  return n
}

// ── Sincronizar ocorrências de equipamento pendentes ────────────
// Mesmo padrão de bioSyncCautelas: só via RPC (idempotente por
// uuid_cliente), sem policy de INSERT direto na tabela.
async function bioSyncOcorrenciasEquipamento(monitorId, onProgresso) {
  const pendentes = await bioOfflineOcorrenciasEquipamentoPendentes()
  let n = 0
  for (const o of pendentes) {
    onProgresso?.('Ocorrência de equipamento…')

    let fotoUrls = o.fotos || []
    try {
      if (fotoUrls.some(f => f.startsWith('data:'))) {
        fotoUrls = await bioSyncUploadFotos(fotoUrls, `equipamento_ocorrencias/${o.uuid_cliente}`)
      }
    } catch (e) { await bioOfflineMarcarErroSync('ocorrencias_equipamento', o.uuid_cliente, 'fotos: ' + (e.message || e)); continue }

    await bioOfflineAtualizarSync('ocorrencias_equipamento', o.uuid_cliente, 'enviando')

    const { data, error } = await bioSupabase().rpc('biomonitor_reportar_ocorrencia_equipamento', {
      p_uuid_cliente:    o.uuid_cliente,
      p_equipamento_id:  o.equipamento_id,
      p_tipo:            o.tipo,
      p_descricao:       o.descricao,
      p_fotos_urls:      fotoUrls.length ? fotoUrls : null,
    })

    if (error) {
      await bioOfflineMarcarErroSync('ocorrencias_equipamento', o.uuid_cliente, error.message)
      continue
    }

    await bioOfflineAtualizarSync('ocorrencias_equipamento', o.uuid_cliente, 'confirmado', data)
    n++
  }
  return n
}

// ── Cache de equipamentos disponíveis para cautela ─────────────
// Filtra pelo grupo do monitor: a RPC de cautela (migration 228) só
// aceita equipamento do mesmo grupo, então mostrar os de outros
// grupos no app só confundiria o monitor.
async function bioSyncCacheEquipamentos(grupoId) {
  if (!navigator.onLine || !grupoId) return
  const { data, error } = await bioSupabase()
    .from('biomonitor_equipamentos')
    .select('id,codigo,plaqueta,descricao,categoria,foto_url,status')
    .eq('status', 'disponivel')
    .eq('grupo_id', grupoId)
  if (error || !data) return
  await bioOfflineSalvarEquipamentos(data)
}

// ── Sincronização completa ────────────────────────────────────
async function bioSyncTudo({ monitorId, onProgresso, onConcluido, onErro } = {}) {
  if (_bioSyncEmAndamento) return
  if (!navigator.onLine)   return

  _bioSyncEmAndamento = true
  _bioSyncAbortCtrl   = new AbortController()

  try {
    // Cada categoria é isolada: uma falha inesperada numa não aborta as
    // seguintes (ninhos → filhos). A resiliência por registro fica dentro
    // de cada função (marca 'erro' e segue).
    const cat = async fn => { try { return await fn(monitorId, onProgresso) } catch (e) { console.warn('[sync]', fn.name, e); return 0 } }
    const n  = await cat(bioSyncNinhos)
    const t  = await cat(bioSyncTransferencias)
    const e  = await cat(bioSyncEclosoes)
    const v  = await cat(bioSyncVisitas)
    const l  = await cat(bioSyncLotes)
    const ind = await cat(bioSyncIndividuos)
    const s  = await cat(bioSyncSolturas)
    const oc = await cat(bioSyncOcorrencias)
    const bi = await cat(bioSyncBiometriasInd)
    const ct = await cat(bioSyncCautelas)
    const oe = await cat(bioSyncOcorrenciasEquipamento)
    // Pull: traz de volta mudanças do servidor (ex.: validação/correção
    // feita pelo gestor) para o IndexedDB.
    const grupoId = (typeof BioApp !== 'undefined' && BioApp.monitor?.grupo_id) || null
    bioSyncCacheEquipamentos(grupoId).catch(() => {})
    if (grupoId) {
      try { await bioSyncPullNinhos(grupoId) } catch (_) {}
      // Berçário é compartilhado pela equipe — traz lotes/filhotes/biometrias
      // de outros monitores do mesmo grupo para o IndexedDB local.
      try { await bioSyncPullLotes(grupoId) } catch (_) {}
      try { await bioSyncPullIndividuos(grupoId) } catch (_) {}
      try { await bioSyncPullBiometriasInd(grupoId) } catch (_) {}
      // Histórico completo (soltura + ocorrências) — visível para toda a
      // equipe desde a 140_solturas_ocorrencias_compartilhadas.
      try { await bioSyncPullSolturas(grupoId) } catch (_) {}
      try { await bioSyncPullOcorrencias(grupoId) } catch (_) {}
    }
    await bioOfflineLimparConfirmados()
    onConcluido?.({ ninhos: n, transferencias: t, eclosoes: e, visitas: v, lotes: l, individuos: ind, solturas: s, ocorrencias: oc, biometrias: bi, cautelas: ct, ocorrenciasEquipamento: oe })
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

// ── Pull: busca lotes de berçário do GRUPO (equipe) inteiro ───
// Berçário é físico e compartilhado — sem isso, cada aparelho só via os
// lotes que ele mesmo criou, nunca os de outro monitor da mesma equipe.
async function bioSyncPullLotes(grupoId) {
  if (!navigator.onLine) return

  const { data, error } = await bioSupabase()
    .from('lotes_bercario')
    .select(`
      id, uuid_cliente, bercario_id, bercario_nome, temporada_id, data_entrada, hora_entrada,
      qtd_entrada, status, observacoes, monitor_id, criado_em, sincronizado_em,
      ninho:ninhos_quelonios(uuid_cliente, numero_ninho, especie)
    `)
    .eq('grupo_id', grupoId)
    .order('data_entrada', { ascending: false })
    .limit(200)

  if (error || !data) return

  for (const l of data) {
    await bioOfflineSalvarLote({
      uuid_cliente:  l.uuid_cliente,
      ninho_uuid:    l.ninho?.uuid_cliente ?? null,
      ninho_numero:  l.ninho?.numero_ninho ?? null,
      especie:       l.ninho?.especie      ?? null,
      bercario_id:   l.bercario_id,
      bercario_nome: l.bercario_nome,
      temporada_id:  l.temporada_id ?? null,
      data_entrada:  l.data_entrada,
      hora_entrada:  l.hora_entrada,
      qtd_entrada:   l.qtd_entrada,
      status:        l.status,
      observacoes:   l.observacoes,
      server_id:     l.id,
      status_sync:   'confirmado',
      criado_em:     l.criado_em,
      sincronizado_em: l.sincronizado_em ?? new Date().toISOString(),
    })
  }
}

// ── Pull: filhotes individuais dos lotes do grupo ─────────────
async function bioSyncPullIndividuos(grupoId) {
  if (!navigator.onLine) return

  const { data, error } = await bioSupabase()
    .from('filhotes_bercario')
    .select(`
      id, uuid_cliente, numero, status, doente, data_obito, causa_obito, observacoes,
      monitor_id, criado_em, sincronizado_em,
      lote:lotes_bercario!inner(uuid_cliente, grupo_id)
    `)
    .eq('lote.grupo_id', grupoId)
    .order('numero')
    .limit(2000)

  if (error || !data) return

  for (const ind of data) {
    if (!ind.lote?.uuid_cliente) continue
    await bioOfflineSalvarIndividuo({
      uuid_cliente: ind.uuid_cliente,
      lote_uuid:    ind.lote.uuid_cliente,
      numero:       ind.numero,
      status:       ind.status,
      doente:       ind.doente,
      data_obito:   ind.data_obito,
      causa_obito:  ind.causa_obito,
      observacoes:  ind.observacoes,
      server_id:    ind.id,
      status_sync:  'confirmado',
      criado_em:    ind.criado_em,
      sincronizado_em: ind.sincronizado_em ?? new Date().toISOString(),
    })
  }
}

// ── Pull: biometrias individuais dos filhotes do grupo ────────
async function bioSyncPullBiometriasInd(grupoId) {
  if (!navigator.onLine) return

  const { data, error } = await bioSupabase()
    .from('biometrias_individuais')
    .select(`
      id, uuid_cliente, data_medicao, hora_medicao, comprimento_cm,
      largura_carapaca_cm, comprimento_plastrao_cm, peso_g,
      observacoes, monitor_id, criado_em, sincronizado_em,
      individuo:filhotes_bercario!inner(uuid_cliente, grupo_id)
    `)
    .eq('individuo.grupo_id', grupoId)
    .order('data_medicao', { ascending: false })
    .limit(2000)

  if (error || !data) return

  for (const b of data) {
    if (!b.individuo?.uuid_cliente) continue
    await bioOfflineSalvarBiometriaInd({
      uuid_cliente:            b.uuid_cliente,
      individuo_uuid:          b.individuo.uuid_cliente,
      data_medicao:            b.data_medicao,
      hora_medicao:            b.hora_medicao,
      comprimento_cm:          b.comprimento_cm,
      largura_carapaca_cm:     b.largura_carapaca_cm,
      comprimento_plastrao_cm: b.comprimento_plastrao_cm,
      peso_g:                  b.peso_g,
      observacoes:             b.observacoes,
      server_id:      b.id,
      status_sync:    'confirmado',
      criado_em:      b.criado_em,
      sincronizado_em: b.sincronizado_em ?? new Date().toISOString(),
    })
  }
}

// ── Pull: solturas do grupo (histórico de entrada até soltura,
//    visível para toda a equipe — 140_solturas_ocorrencias_compartilhadas) ──
async function bioSyncPullSolturas(grupoId) {
  if (!navigator.onLine) return

  const { data, error } = await bioSupabase()
    .from('solturas_filhotes')
    .select(`
      id, uuid_cliente, data_soltura, hora_soltura, qtd_soltada, mortalidade,
      local_descricao, predacao_soltura, observacoes, foto_urls, via_bercario,
      monitor_id, criado_em, sincronizado_em,
      ninho:ninhos_quelonios(uuid_cliente, numero_ninho),
      lote:lotes_bercario(uuid_cliente)
    `)
    .eq('grupo_id', grupoId)
    .order('data_soltura', { ascending: false })
    .limit(200)

  if (error || !data) return

  for (const s of data) {
    await bioOfflineSalvarSoltura({
      uuid_cliente:     s.uuid_cliente,
      ninho_uuid:       s.ninho?.uuid_cliente ?? null,
      ninho_numero:     s.ninho?.numero_ninho ?? null,
      lote_uuid:        s.lote?.uuid_cliente ?? null,
      via_bercario:     s.via_bercario,
      data_soltura:     s.data_soltura,
      hora_soltura:     s.hora_soltura,
      qtd_soltada:      s.qtd_soltada,
      mortalidade:      s.mortalidade,
      local_descricao:  s.local_descricao,
      predacao_soltura: s.predacao_soltura,
      observacoes:      s.observacoes,
      foto_urls:        s.foto_urls ?? [],
      server_id:        s.id,
      status_sync:      'confirmado',
      criado_em:        s.criado_em,
      sincronizado_em:  s.sincronizado_em ?? new Date().toISOString(),
    })
  }
}

// ── Pull: ocorrências de berçário do grupo (alimentação/mortalidade/
//    biometria/etc — visível para toda a equipe) ─────────────────
async function bioSyncPullOcorrencias(grupoId) {
  if (!navigator.onLine) return

  const { data, error } = await bioSupabase()
    .from('ocorrencias_bercario')
    .select(`
      id, uuid_cliente, tipo, data_ocorrencia, hora_ocorrencia,
      comprimento_medio_cm, peso_medio_g, n_amostrados, qtd_afetados, causa,
      descricao, foto_urls, monitor_id, criado_em, sincronizado_em,
      lote:lotes_bercario(uuid_cliente),
      individuo:filhotes_bercario(uuid_cliente)
    `)
    .eq('grupo_id', grupoId)
    .order('data_ocorrencia', { ascending: false })
    .limit(500)

  if (error || !data) return

  for (const oc of data) {
    if (!oc.lote?.uuid_cliente) continue
    await bioOfflineSalvarOcorrencia({
      uuid_cliente:         oc.uuid_cliente,
      lote_uuid:            oc.lote.uuid_cliente,
      individuo_uuid:       oc.individuo?.uuid_cliente ?? null,
      tipo:                 oc.tipo,
      data_ocorrencia:      oc.data_ocorrencia,
      hora_ocorrencia:      oc.hora_ocorrencia,
      comprimento_medio_cm: oc.comprimento_medio_cm,
      peso_medio_g:         oc.peso_medio_g,
      n_amostrados:         oc.n_amostrados,
      qtd_afetados:         oc.qtd_afetados,
      causa:                oc.causa,
      descricao:            oc.descricao,
      foto_urls:            oc.foto_urls ?? [],
      server_id:            oc.id,
      status_sync:          'confirmado',
      criado_em:            oc.criado_em,
      sincronizado_em:      oc.sincronizado_em ?? new Date().toISOString(),
    })
  }
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
