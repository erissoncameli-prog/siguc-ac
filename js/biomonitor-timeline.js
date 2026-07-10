// ── SIGUC Biomonitor — Timeline de ocorrências do ninho ────────
// Monta e ordena (por DATA + HORA) os eventos de um ninho, desde o
// encontro da postura até a soltura, calculando o saldo de ovos
// viáveis após cada evento. Compartilhado entre o app de campo
// (cards de "Ninhos abertos", js/biomonitor-quelonios.js) e a
// página de validação (pages/biomonitor-validacao.html).
// Depende de: esc() (js/config.js)

const BIO_VISITA_STATUS_LBL = {
  integro: 'íntegro', perturbado: 'perturbado',
  parcial_predado: 'parc. predado', destruido: 'destruído', alagado: 'alagado',
}

// Combina data (YYYY-MM-DD) + hora (HH:MM[:SS]) num timestamp ordenável.
// Sem hora registrada, ancora ao meio-dia (mesma convenção de janela
// crítica usada nas migrations 081/092 para eventos sem hora).
function bioDataHoraKey(data, hora) {
  if (!data) return ''
  return `${data}T${(hora || '12:00:00').slice(0, 8)}`
}

function bioEventoVisita(r) {
  const perda = (r.ovos_predados_n || 0) + (r.ovos_perdidos_alagamento || 0)
    + (r.ovos_perdidos_erosao || 0) + (r.ovos_perdidos_humana || 0)
  return {
    tipo: 'visita', data: r.data_visita, hora: r.hora_visita,
    delta: perda,                                   // ovos perdidos nesta visita
    destruido: r.status_ninho === 'destruido',      // baixa total dos viáveis
    txt: ['Visita',
      r.status_ninho ? BIO_VISITA_STATUS_LBL[r.status_ninho] : null,
      r.temperatura_substrato_c != null ? `${r.temperatura_substrato_c}°C`
        : r.temperatura_ar_c != null ? `${r.temperatura_ar_c}°C` : null,
    ].filter(Boolean).join(' · '),
    detalhe: r,                                     // registro bruto p/ botão "Detalhes"
  }
}

// Registro (id incremental → registro bruto da visita) consultado pelo
// botão "Detalhes" — evita colocar JSON inline no HTML dos cards.
const BioDetalhesVisita = {}
let _bioDetVisSeq = 0

const BIO_VISITA_PREDACAO_LBL = {
  por_animais: 'por animais', por_pessoas: 'por pessoas', desconhecida: 'desconhecida',
}
const BIO_VISITA_CAUSA_LBL = {
  predacao: 'predação', alagamento: 'alagamento', erosao: 'erosão/apodrecimento',
  humana: 'humana', outro: 'outra',
}

// Abre (criando se preciso) o modal com os dados completos de uma visita.
function bioAbrirDetalhesVisita(id) {
  const r = BioDetalhesVisita[id]
  if (!r) return

  let ov = document.getElementById('bio-detvis-overlay')
  if (!ov) {
    ov = document.createElement('div')
    ov.id = 'bio-detvis-overlay'
    ov.className = 'bio-detvis-overlay'
    ov.innerHTML = `
      <div class="bio-detvis-card" onclick="event.stopPropagation()">
        <div class="bio-detvis-head">
          <strong>Detalhes da visita</strong>
          <button type="button" class="bio-detvis-fechar" aria-label="Fechar">&times;</button>
        </div>
        <div class="bio-detvis-corpo" id="bio-detvis-corpo"></div>
      </div>`
    ov.addEventListener('click', () => ov.remove())
    ov.querySelector('.bio-detvis-fechar').addEventListener('click', () => ov.remove())
    document.body.appendChild(ov)
  }

  const fd = iso => iso ? new Date(iso + 'T12:00').toLocaleDateString('pt-BR') : '—'
  const linha = (l, v) => v != null && v !== ''
    ? `<div><span>${esc(l)}</span><strong>${esc(String(v))}</strong></div>` : ''

  const perdas = [
    r.ovos_predados_n > 0 ? linha(`Predação${r.predacao_incubacao ? ' (' + (BIO_VISITA_PREDACAO_LBL[r.predacao_incubacao] || r.predacao_incubacao) + ')' : ''}`, r.ovos_predados_n) : '',
    r.ovos_perdidos_alagamento > 0 ? linha('Alagamento', r.ovos_perdidos_alagamento) : '',
    r.ovos_perdidos_erosao > 0 ? linha('Erosão/apodrecimento', r.ovos_perdidos_erosao) : '',
    r.ovos_perdidos_humana > 0 ? linha('Dano humano', r.ovos_perdidos_humana) : '',
  ].join('')

  const corpo = [
    linha('Data', fd(r.data_visita) + (r.hora_visita ? ` · ${r.hora_visita.slice(0, 5)}` : '')),
    linha('Status', r.status_ninho ? (BIO_VISITA_STATUS_LBL[r.status_ninho] || r.status_ninho) : null),
    linha('Temp. substrato', r.temperatura_substrato_c != null ? `${r.temperatura_substrato_c}°C` : null),
    linha('Temp. ar', r.temperatura_ar_c != null ? `${r.temperatura_ar_c}°C` : null),
    linha('Umidade', r.umidade),
    r.status_ninho === 'destruido'
      ? linha('Causa da destruição', r.causa_destruicao ? (BIO_VISITA_CAUSA_LBL[r.causa_destruicao] || r.causa_destruicao) : null)
      : perdas,
    linha('Sinal de alagamento', r.sinal_alagamento ? 'Sim' : null),
    linha('Intervenção realizada', r.intervencao),
  ].filter(Boolean).join('')

  document.getElementById('bio-detvis-corpo').innerHTML = corpo
    + (r.observacoes ? `<div class="bio-detvis-obs">${esc(r.observacoes)}</div>` : '')
}

// Busca no servidor os eventos (transferência, visita, berçário, soltura)
// dos ninhos informados (cada um precisa de `.id` e `.uuid_cliente`).
// Retorna um mapa uuid_cliente → [eventos]. Localização (postura) e
// eclosão não entram aqui — são derivadas dos campos do próprio ninho
// em bioMontarHistoricoNinho.
async function bioBuscarEventosServidor(sb, ninhos) {
  const mapa = {}
  ninhos.forEach(n => { mapa[n.uuid_cliente] = [] })

  const idMap = {}
  ninhos.forEach(n => { if (n.id) idMap[n.id] = n.uuid_cliente })
  const serverIds = Object.keys(idMap)
  if (!serverIds.length) return mapa

  try {
    const [rTransf, rVisita, rLote, rSol] = await Promise.all([
      sb.from('vw_transferencias_praia')
        .select('ninho_id,data_transferencia,hora_transferencia,praia_destino_nome,local_destino')
        .in('ninho_id', serverIds),
      sb.from('visitas_ninho')
        .select('ninho_id,data_visita,hora_visita,status_ninho,temperatura_substrato_c,temperatura_ar_c,umidade,predacao_incubacao,ovos_predados_n,ovos_perdidos_alagamento,ovos_perdidos_erosao,ovos_perdidos_humana,causa_destruicao,sinal_alagamento,intervencao,observacoes')
        .in('ninho_id', serverIds),
      sb.from('lotes_bercario')
        .select('ninho_id,data_entrada,hora_entrada,qtd_entrada,bercario_nome')
        .in('ninho_id', serverIds),
      sb.from('solturas_filhotes')
        .select('ninho_id,data_soltura,hora_soltura,qtd_soltada,mortalidade,via_bercario,local_descricao')
        .in('ninho_id', serverIds),
    ])

    const pushRows = (res, tipo, fn) => {
      ;(res.data ?? []).forEach(r => {
        const uuid = idMap[r.ninho_id]
        if (uuid && mapa[uuid]) mapa[uuid].push({ tipo, ...fn(r) })
      })
    }

    pushRows(rTransf, 'transf', r => ({
      data: r.data_transferencia, hora: r.hora_transferencia,
      txt: `Transferido${r.praia_destino_nome ? ' → ' + r.praia_destino_nome
        : r.local_destino ? ' → ' + r.local_destino : ''}`,
    }))
    pushRows(rVisita, 'visita', bioEventoVisita)
    pushRows(rLote, 'bercario', r => ({
      data: r.data_entrada, hora: r.hora_entrada,
      txt: `Berçário · ${r.qtd_entrada} filh.${r.bercario_nome ? ' → ' + r.bercario_nome : ''}`,
    }))
    pushRows(rSol, 'soltura', r => ({
      data: r.data_soltura, hora: r.hora_soltura,
      txt: [`Soltura · ${r.qtd_soltada} filh.`,
        r.mortalidade ? `${r.mortalidade} mort.` : null,
        r.via_bercario ? '(via berçário)' : null,
        r.local_descricao || null,
      ].filter(Boolean).join(' · '),
    }))
  } catch (e) {
    console.warn('[biomonitor timeline]', e)
  }

  return mapa
}

// Fecha o histórico de UM ninho: ancora a LOCALIZAÇÃO (postura) no
// topo, acrescenta a ECLOSÃO (derivada dos campos já carregados no
// ninho), ordena tudo por data+hora e calcula o saldo de OVOS
// VIÁVEIS após cada evento — a base viva para as ocorrências seguintes.
// `eventosServidor` = array retornado por bioBuscarEventosServidor
// (mais eventuais eventos locais/offline já mesclados pelo chamador).
function bioMontarHistoricoNinho(n, eventosServidor) {
  const evs = [...(eventosServidor || [])]

  if (n.data_encontro && n.qtd_ovos != null) {
    const registro = n.ovos_descartados || 0
    evs.push({
      tipo: 'localizacao', data: n.data_encontro, hora: n.hora_desova, registro,
      txt: `Localização · ${n.qtd_ovos} ovos na postura`
        + (registro > 0 ? ` · ${registro} descartados no registro` : ''),
    })
  }

  if (n.data_nascimento) {
    evs.push({
      tipo: 'eclosao', data: n.data_nascimento,
      txt: ['Eclosão',
        n.filhotes_vivos   != null ? `${n.filhotes_vivos} vivos`      : null,
        n.filhotes_mortos          ? `${n.filhotes_mortos} mortos`     : null,
        n.ovos_nao_nascidos        ? `${n.ovos_nao_nascidos} não nasc.`: null,
      ].filter(Boolean).join(' · '),
    })
  }

  evs.sort((a, b) => {
    if (a.tipo === 'localizacao' && b.tipo !== 'localizacao') return -1
    if (b.tipo === 'localizacao' && a.tipo !== 'localizacao') return 1
    const ka = bioDataHoraKey(a.data, a.hora), kb = bioDataHoraKey(b.data, b.hora)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })

  // Saldo de viáveis após cada evento
  let saldo = n.qtd_ovos != null ? n.qtd_ovos : null
  evs.forEach(ev => {
    if (ev.tipo === 'localizacao') {
      saldo = n.qtd_ovos != null ? Math.max(n.qtd_ovos - (ev.registro || 0), 0) : null
    } else if (ev.destruido && saldo != null) {
      ev.delta = saldo; saldo = 0
    } else if (ev.delta > 0 && saldo != null) {
      saldo = Math.max(saldo - ev.delta, 0)
    }
    ev.saldo = saldo
  })

  return evs
}

// Renderiza o bloco colapsável de histórico (toggle + linha do tempo).
// `evs` já deve vir ordenado (bioMontarHistoricoNinho).
function bioTimelineHtml(evs) {
  if (!evs || !evs.length) return ''
  const fd = iso => new Date(iso + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const rows = evs.map(ev => {
    const cls   = ev.destruido ? 'destruido' : ev.tipo
    const delta = ev.delta > 0 ? `<span class="bio-nfc-hist-delta">−${ev.delta}</span>` : ''
    const saldo = ev.saldo != null
      ? `<span class="bio-nfc-hist-saldo">${ev.saldo}<i>viáveis</i></span>` : ''
    let detBtn = ''
    if (ev.tipo === 'visita' && ev.detalhe) {
      const id = ++_bioDetVisSeq
      BioDetalhesVisita[id] = ev.detalhe
      detBtn = `<button class="bio-nfc-hist-det" data-nh-detalhe="${id}" type="button">Detalhes</button>`
    }
    return `
    <div class="bio-nfc-hist-ev ev-${cls}">
      <div class="bio-nfc-hist-dot"></div>
      <span class="bio-nfc-hist-data">${fd(ev.data)}</span>
      <span class="bio-nfc-hist-txt">${esc(ev.txt)}${delta}</span>
      ${detBtn}
      ${saldo}
    </div>`
  }).join('')
  return `<button class="bio-nfc-hist-toggle" data-nh-toggle type="button">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    ${evs.length} evento${evs.length !== 1 ? 's' : ''}
  </button>
  <div class="bio-nfc-hist" data-nh-hist>${rows}</div>`
}

// Liga os toggles "N eventos" de todos os cards dentro de `container`.
function bioLigarTogglesHistorico(container) {
  container.querySelectorAll('[data-nh-toggle]').forEach(btn => {
    if (btn._nhLigado) return
    btn._nhLigado = true
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const card = btn.closest('.bio-nfc') || btn.parentElement
      const hist = card ? card.querySelector('[data-nh-hist]') : null
      if (!hist) return
      const vis = hist.classList.toggle('vis')
      btn.classList.toggle('aberto', vis)
    })
  })
}
