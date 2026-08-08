// ── SIGUC Biomonitor — Equipamentos em cautela (tela-equipamentos) ──
// Cadastro do bem é feito na mesa (biomonitor-equipamentos.html); aqui
// o monitor só assina a cautela (recebimento) de um ou mais itens.
// Devolução é só pela mesa (decisão de produto).
// Usa o cliente isolado (bioSupabase) e a fila offline do Biomonitor
// — a cautela entra no IndexedDB e sincroniza via bioSyncCautelas.

let _bioEquipPasso = 'lista' // 'lista' | 'nova' | 'ocorrencia'
let _bioEquipTermo  = null
let _bioEquipSel    = new Set()
let _bioEquipOcorrenciaAlvo = null // { equipamentoId, descricao }
let _bioEquipOcorrenciaFoto = null

const PRAZO_OPCOES = [7, 15, 30]

const TIPO_OCORRENCIA_LABEL = { dano: 'Dano', defeito: 'Defeito', extravio: 'Extravio', perda: 'Perda', outro: 'Outro' }

async function bioEquipIniciar() {
  _bioEquipPasso = 'lista'
  await bioEquipRender()
}

async function bioEquipRender() {
  const corpo = document.getElementById('bio-equip-corpo')
  if (!corpo) return
  if (_bioEquipPasso === 'nova') { await bioEquipRenderNova(corpo); return }
  if (_bioEquipPasso === 'ocorrencia') { await bioEquipRenderOcorrencia(corpo); return }
  await bioEquipRenderLista(corpo)
}

function bioEquipPrazoInfo(c) {
  if (!c.data_prevista_devolucao) return ''
  const hoje = new Date().toISOString().slice(0, 10)
  const venceu = c.data_prevista_devolucao < hoje
  const dataFmt = new Date(c.data_prevista_devolucao + 'T00:00:00').toLocaleDateString('pt-BR')
  return `<p style="margin:4px 0 0;font-size:11px;font-weight:700;color:${venceu ? '#DC2626' : '#9CA3AF'}">
    ${venceu ? 'Prazo vencido — devolução prevista' : 'Devolução prevista'} para ${dataFmt}
  </p>`
}

async function bioEquipRenderLista(corpo) {
  corpo.innerHTML = '<p style="color:#9CA3AF">Carregando...</p>'
  const cautelas = await bioOfflineListarCautelas()

  corpo.innerHTML = `
    <button class="bio-btn-config-item" id="bio-btn-nova-cautela" type="button" style="margin-bottom:16px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Registrar nova cautela
    </button>
    ${!cautelas.length ? '<p style="color:#9CA3AF;font-size:13px">Nenhum equipamento em cautela.</p>' : cautelas.map(c => `
      <div class="bio-config-card" style="align-items:flex-start;text-align:left;flex-direction:column;gap:6px">
        <div style="width:100%">
          <strong style="font-size:13px">${(c.equipamentos_desc || []).join(', ')}</strong>
          <p style="margin:4px 0 0;font-size:11px;color:#9CA3AF">
            Assinado em ${new Date(c.criado_em).toLocaleString('pt-BR')}
            · ${c.status_sync === 'confirmado' ? 'Sincronizado' : c.status_sync === 'erro' ? 'Erro ao sincronizar' : 'Pendente de envio'}
          </p>
          ${bioEquipPrazoInfo(c)}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;width:100%">
          ${(c.equipamento_ids || []).map((eqId, i) => `
            <button class="bio-chip-cfg bio-equip-btn-ocorrencia" data-eq="${eqId}" data-desc="${esc(c.equipamentos_desc?.[i] || '')}" type="button" style="font-size:11px">
              Reportar problema — ${esc(c.equipamentos_desc?.[i] || 'item')}
            </button>`).join('')}
        </div>
      </div>`).join('')}
  `
  document.getElementById('bio-btn-nova-cautela')?.addEventListener('click', async () => {
    _bioEquipPasso = 'nova'
    await bioEquipRender()
  })
  corpo.querySelectorAll('.bio-equip-btn-ocorrencia').forEach(btn => {
    btn.addEventListener('click', async () => {
      _bioEquipOcorrenciaAlvo = { equipamentoId: btn.dataset.eq, descricao: btn.dataset.desc }
      _bioEquipPasso = 'ocorrencia'
      await bioEquipRender()
    })
  })
}

async function bioEquipRenderNova(corpo) {
  corpo.innerHTML = '<p style="color:#9CA3AF">Carregando equipamentos disponíveis...</p>'
  _bioEquipSel = new Set()

  // Catálogo: tenta atualizar online (só o do grupo do monitor — a RPC
  // de cautela não aceita equipamento de outro grupo), sempre lê do
  // cache local (IndexedDB) por baixo.
  const grupoId = (typeof BioApp !== 'undefined' && BioApp.monitor?.grupo_id) || null
  if (typeof bioSyncCacheEquipamentos === 'function') { try { await bioSyncCacheEquipamentos(grupoId) } catch (_) {} }
  const equipamentos = await bioOfflineListarEquipamentos()

  // Termo vigente: precisa estar disponível para poder assinar. Sem
  // conexão na primeira vez, cacheia no config (mesmo padrão do aviso
  // de campo — js/lgpd-campo.js) para funcionar offline depois.
  _bioEquipTermo = await bioEquipObterTermo()

  if (!equipamentos.length) {
    corpo.innerHTML = `
      <button class="bio-btn-back-inline" id="bio-equip-voltar-lista" type="button" style="background:none;border:none;color:var(--bio-prim);font-size:13px;margin-bottom:12px;cursor:pointer">‹ Voltar</button>
      <p style="color:#9CA3AF;font-size:13px">Nenhum equipamento disponível para cautela no momento.</p>`
    document.getElementById('bio-equip-voltar-lista')?.addEventListener('click', async () => { _bioEquipPasso = 'lista'; await bioEquipRender() })
    return
  }

  if (!_bioEquipTermo) {
    corpo.innerHTML = `
      <button class="bio-btn-back-inline" id="bio-equip-voltar-lista" type="button" style="background:none;border:none;color:var(--bio-prim);font-size:13px;margin-bottom:12px;cursor:pointer">‹ Voltar</button>
      <p style="color:#9CA3AF;font-size:13px">Termo de responsabilidade indisponível offline. Conecte-se à internet uma vez para liberar a assinatura de cautela.</p>`
    document.getElementById('bio-equip-voltar-lista')?.addEventListener('click', async () => { _bioEquipPasso = 'lista'; await bioEquipRender() })
    return
  }

  corpo.innerHTML = `
    <button class="bio-btn-back-inline" id="bio-equip-voltar-lista" type="button" style="background:none;border:none;color:var(--bio-prim);font-size:13px;margin-bottom:12px;cursor:pointer">‹ Voltar</button>
    <p style="font-size:13px;font-weight:700;margin:0 0 8px">Selecione o(s) equipamento(s) recebido(s)</p>
    <div id="bio-equip-lista-sel" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${equipamentos.map(e => `
        <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;padding:10px;border:1px solid var(--borda,#E5E7EB);border-radius:10px">
          <input type="checkbox" class="bio-equip-chk" value="${e.id}" style="width:auto">
          <span>${(e.descricao || '').replace(/</g, '&lt;')}${e.codigo ? ` <span style="color:#9CA3AF">(${e.codigo})</span>` : ''}</span>
        </label>`).join('')}
    </div>
    <p style="font-size:13px;font-weight:700;margin:0 0 8px">Prazo para devolução</p>
    <div id="bio-equip-prazo-row" style="display:flex;gap:8px;margin-bottom:16px">
      ${PRAZO_OPCOES.map((d, i) => `<button class="bio-chip-cfg${i === 1 ? ' ativo' : ''}" data-dias="${d}" type="button">${d} dias</button>`).join('')}
    </div>
    <div style="border:1px solid var(--borda,#E5E7EB);border-radius:10px;padding:12px;max-height:220px;overflow-y:auto;font-size:12px;line-height:1.6;margin-bottom:14px" id="bio-equip-termo-texto">
      ${bioEquipMarkdownSimples(_bioEquipTermo.conteudo_md)}
    </div>
    <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;cursor:pointer;margin-bottom:16px">
      <input type="checkbox" id="bio-equip-concordo" style="width:auto;margin-top:2px">
      Li e concordo com o termo de responsabilidade acima.
    </label>
    <button class="bio-btn-config-item" id="bio-btn-assinar-cautela" type="button" style="justify-content:center;font-weight:700">
      Assinar cautela
    </button>
  `
  document.getElementById('bio-equip-voltar-lista')?.addEventListener('click', async () => { _bioEquipPasso = 'lista'; await bioEquipRender() })
  document.getElementById('bio-btn-assinar-cautela')?.addEventListener('click', bioEquipAssinarCautela)
  document.querySelectorAll('#bio-equip-prazo-row .bio-chip-cfg').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bio-equip-prazo-row .bio-chip-cfg').forEach(b => b.classList.remove('ativo'))
      btn.classList.add('ativo')
    })
  })
}

// Markdown → HTML mínimo (sem depender de lgpdMarkdown, que usa o
// cliente `db` do SIGUC principal — Biomonitor só usa o cliente isolado).
function bioEquipMarkdownSimples(md) {
  if (!md) return ''
  return String(md)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^# (.*)$/gm, '<strong>$1</strong>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
}

async function bioEquipObterTermo() {
  const CHAVE = 'termo_equipamento_cache'
  if (navigator.onLine) {
    try {
      const { data, error } = await bioSupabase()
        .from('vw_lgpd_documentos_vigentes')
        .select('versao_id,conteudo_md,versao')
        .eq('tipo', 'termo_equipamento')
        .maybeSingle()
      if (!error && data) {
        await bioOfflineSetConfig(CHAVE, data)
        return data
      }
    } catch (_) {}
  }
  return bioOfflineGetConfig(CHAVE)
}

async function bioEquipAssinarCautela() {
  const ids = Array.from(document.querySelectorAll('.bio-equip-chk:checked')).map(c => c.value)
  if (!ids.length) { bioToast?.('Selecione ao menos um equipamento', 'err'); return }
  if (!document.getElementById('bio-equip-concordo')?.checked) {
    bioToast?.('É preciso concordar com o termo para assinar', 'err'); return
  }
  const diasPrazo = parseInt(document.querySelector('#bio-equip-prazo-row .bio-chip-cfg.ativo')?.dataset.dias || PRAZO_OPCOES[1], 10)

  const btn = document.getElementById('bio-btn-assinar-cautela')
  btn.disabled = true; btn.textContent = 'Assinando...'

  try {
    const equipamentosCache = await bioOfflineListarEquipamentos()
    const descricoes = ids.map(id => equipamentosCache.find(e => e.id === id)?.descricao).filter(Boolean)
    const dataPrevista = new Date(Date.now() + diasPrazo * 86400000).toISOString().slice(0, 10)

    const cautela = {
      uuid_cliente:      bioUuid(),
      equipamento_ids:   ids,
      equipamentos_desc: descricoes,
      termo_versao_id:   _bioEquipTermo.versao_id,
      dias_prazo:        diasPrazo,
      data_prevista_devolucao: dataPrevista,
      lat: null, lng: null,
      status_sync: 'pendente',
      criado_em: new Date().toISOString(),
    }
    await bioOfflineSalvarCautela(cautela)
    bioToast?.('Cautela registrada — sincronizando...', 'ok')

    if (typeof bioSyncTudo === 'function' && typeof BioApp !== 'undefined') {
      bioSyncTudo({ monitorId: BioApp.monitor?.id })
    }

    _bioEquipPasso = 'lista'
    await bioEquipRender()
  } catch (e) {
    bioToast?.(e.message || 'Erro ao assinar cautela', 'err')
    btn.disabled = false; btn.textContent = 'Assinar cautela'
  }
}

// ── Reportar ocorrência em equipamento (a qualquer momento) ────
async function bioEquipRenderOcorrencia(corpo) {
  _bioEquipOcorrenciaFoto = null
  const alvo = _bioEquipOcorrenciaAlvo
  corpo.innerHTML = `
    <button class="bio-btn-back-inline" id="bio-equip-voltar-lista" type="button" style="background:none;border:none;color:var(--bio-prim);font-size:13px;margin-bottom:12px;cursor:pointer">‹ Voltar</button>
    <p style="font-size:13px;font-weight:700;margin:0 0 8px">Reportar problema — ${esc(alvo?.descricao || 'equipamento')}</p>
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap" id="bio-equip-ocorr-tipo-row">
      ${Object.entries(TIPO_OCORRENCIA_LABEL).map(([v, l], i) => `<button class="bio-chip-cfg${i === 0 ? ' ativo' : ''}" data-tipo="${v}" type="button">${l}</button>`).join('')}
    </div>
    <textarea class="bio-form-control" id="bio-equip-ocorr-descricao" rows="3" placeholder="Descreva o que aconteceu" style="width:100%;margin-bottom:14px"></textarea>
    <input type="file" accept="image/*" id="bio-equip-ocorr-foto" style="margin-bottom:16px">
    <button class="bio-btn-config-item" id="bio-btn-enviar-ocorrencia" type="button" style="justify-content:center;font-weight:700">
      Enviar
    </button>
  `
  document.getElementById('bio-equip-voltar-lista')?.addEventListener('click', async () => {
    _bioEquipOcorrenciaAlvo = null; _bioEquipPasso = 'lista'; await bioEquipRender()
  })
  document.querySelectorAll('#bio-equip-ocorr-tipo-row .bio-chip-cfg').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bio-equip-ocorr-tipo-row .bio-chip-cfg').forEach(b => b.classList.remove('ativo'))
      btn.classList.add('ativo')
    })
  })
  document.getElementById('bio-equip-ocorr-foto')?.addEventListener('change', ev => {
    const file = ev.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { _bioEquipOcorrenciaFoto = reader.result }
    reader.readAsDataURL(file)
  })
  document.getElementById('bio-btn-enviar-ocorrencia')?.addEventListener('click', bioEquipEnviarOcorrencia)
}

async function bioEquipEnviarOcorrencia() {
  const alvo = _bioEquipOcorrenciaAlvo
  if (!alvo) return
  const tipo = document.querySelector('#bio-equip-ocorr-tipo-row .bio-chip-cfg.ativo')?.dataset.tipo || 'outro'
  const descricao = document.getElementById('bio-equip-ocorr-descricao')?.value.trim()
  if (!descricao) { bioToast?.('Descreva o problema', 'err'); return }

  const btn = document.getElementById('bio-btn-enviar-ocorrencia')
  btn.disabled = true; btn.textContent = 'Enviando...'

  try {
    const ocorrencia = {
      uuid_cliente:    bioUuid(),
      equipamento_id:  alvo.equipamentoId,
      equipamento_desc: alvo.descricao,
      tipo, descricao,
      fotos: _bioEquipOcorrenciaFoto ? [_bioEquipOcorrenciaFoto] : [],
      status_sync: 'pendente',
      criado_em: new Date().toISOString(),
    }
    await bioOfflineSalvarOcorrenciaEquipamento(ocorrencia)
    bioToast?.('Ocorrência registrada — sincronizando...', 'ok')

    if (typeof bioSyncTudo === 'function' && typeof BioApp !== 'undefined') {
      bioSyncTudo({ monitorId: BioApp.monitor?.id })
    }

    _bioEquipOcorrenciaAlvo = null
    _bioEquipPasso = 'lista'
    await bioEquipRender()
  } catch (e) {
    bioToast?.(e.message || 'Erro ao registrar ocorrência', 'err')
    btn.disabled = false; btn.textContent = 'Enviar'
  }
}
