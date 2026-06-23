// ── SIGUC Biomonitor — Lógica do App Quelônios ────────────────
// Gerencia: auth Supabase, PIN, telas, formulários de ninho,
// transferência, eclosão, fila de sync e aba Dados.
// Depende de: biomonitor-offline.js, biomonitor-sync.js

function bioHaversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

/* ════════════════════════════════════════════════════════════
   ESTADO GLOBAL
   ════════════════════════════════════════════════════════════ */
const BioApp = {
  monitor:      null,   // dados do monitor (RPC bio_monitor_atual)
  praiaAtual:   null,   // praia selecionada na home
  gpsLat:       null,
  gpsLng:       null,
  gpsPrecisao:  null,
  sessaoId:     null,
  // Formulário em edição
  formNinho:    null,
  formTipo:     null,   // 'ninho' | 'transferencia' | 'eclosao'
  formNinhoAtualizar: null,  // ninho sendo atualizado
}

// Espécies de quelônios com sigla, nome e cor
const BIO_ESPECIES = [
  { id: 'tracaja',   sigla: 'TR',  nome: 'Tracajá',            nome_cientifico: 'Podocnemis unifilis' },
  { id: 'tartaruga', sigla: 'TA',  nome: 'Tartaruga',          nome_cientifico: 'Podocnemis expansa' },
  { id: 'cabecudo',  sigla: 'R',   nome: 'Cabeçudo',           nome_cientifico: 'Podocnemis sextuberculata' },
  { id: 'pitiU',     sigla: 'C',   nome: 'Pitiú/Cupido',       nome_cientifico: 'Podocnemis erythrocephala' },
  { id: 'cupido',    sigla: 'CP',  nome: 'Cupido',             nome_cientifico: 'Podocnemis cayennensis' },
  { id: 'mucua',     sigla: 'M',   nome: 'Muçuã',              nome_cientifico: 'Kinosternon scorpioides' },
  { id: 'jabuti_pe_elefante', sigla: 'JP', nome: 'Jabuti',     nome_cientifico: 'Chelonoidis denticulatus' },
  { id: 'outro',     sigla: '?',   nome: 'Outro / Não sei',    nome_cientifico: '' },
]

/* ════════════════════════════════════════════════════════════
   TELAS
   ════════════════════════════════════════════════════════════ */
function bioMostrarTela(id) {
  document.querySelectorAll('.bio-tela').forEach(t => t.classList.remove('ativa'))
  const el = document.getElementById(id)
  if (el) { el.classList.add('ativa'); el.scrollTop = 0 }

  // Nav: ativa o botão correspondente
  const mapa = {
    'tela-home':       'nav-home',
    'tela-fila':       'nav-fila',
    'tela-dados':      'nav-dados',
    'tela-config':     'nav-config',
  }
  document.querySelectorAll('.bio-pill-btn').forEach(b => b.classList.remove('ativa'))
  const navId = mapa[id]
  if (navId) document.getElementById(navId)?.classList.add('ativa')

  // Oculta nav em telas de autenticação
  const lockTelas = ['tela-login', 'tela-trocar-senha', 'tela-config-pin', 'tela-bloqueio']
  const nav = document.getElementById('bio-pill-nav')
  if (nav) nav.hidden = lockTelas.includes(id)
}

/* ════════════════════════════════════════════════════════════
   AUTH — LOGIN / PIN
   ════════════════════════════════════════════════════════════ */
async function bioIniciar() {
  await bioOfflinePersistir()

  const { data: { session } } = await bioSupabase().auth.getSession()

  if (!session) {
    bioMostrarTela('tela-login')
    bioIniciarTelaLogin()
    return
  }

  // Verifica se é monitor ativo
  const { data: monitor } = await bioSupabase().rpc('bio_monitor_atual')
  if (!monitor) {
    bioMostrarTela('tela-login')
    document.getElementById('bio-login-erro').textContent =
      'Usuário não vinculado a nenhum grupo de monitoramento.'
    document.getElementById('bio-login-erro').hidden = false
    return
  }

  BioApp.monitor = monitor

  // Precisa trocar senha?
  if (monitor.deve_trocar_senha) {
    bioMostrarTela('tela-trocar-senha')
    return
  }

  // Salva dados do monitor offline
  await bioOfflineSetConfig('monitor', monitor)
  await bioOfflineSetConfig('ultima_sessao', new Date().toISOString())

  // Tem PIN?
  const temPin = await bioOfflineTemPin()
  if (!temPin) {
    bioMostrarTela('tela-config-pin')
    bioIniciarTelaConfigPin()
    return
  }

  bioMostrarTela('tela-bloqueio')
  bioIniciarTelaBloqueio()
}

// ── Login com e-mail/senha ─────────────────────────────────────
function bioIniciarTelaLogin() {
  document.getElementById('bio-btn-login').addEventListener('click', async () => {
    const email = document.getElementById('bio-login-email').value.trim()
    const senha = document.getElementById('bio-login-senha').value
    const erroEl = document.getElementById('bio-login-erro')
    erroEl.hidden = true

    if (!email || !senha) { erroEl.textContent = 'Preencha e-mail e senha.'; erroEl.hidden = false; return }

    const btn = document.getElementById('bio-btn-login')
    btn.disabled = true; btn.textContent = 'Entrando…'

    const { error } = await bioSupabase().auth.signInWithPassword({ email, password: senha })
    btn.disabled = false; btn.textContent = 'Entrar'

    if (error) { erroEl.textContent = 'E-mail ou senha incorretos.'; erroEl.hidden = false; return }

    await bioIniciar()
  })

  document.getElementById('bio-login-senha').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('bio-btn-login').click()
  })

  document.getElementById('bio-btn-toggle-senha')?.addEventListener('click', () => {
    const inp = document.getElementById('bio-login-senha')
    inp.type = inp.type === 'password' ? 'text' : 'password'
  })
}

// ── Trocar senha (1º acesso) ───────────────────────────────────
function bioIniciarTelaTrocarSenha() {
  document.getElementById('bio-btn-trocar-senha').addEventListener('click', async () => {
    const s1 = document.getElementById('bio-troca-senha1').value
    const s2 = document.getElementById('bio-troca-senha2').value
    const erroEl = document.getElementById('bio-troca-erro')
    erroEl.hidden = true

    if (s1.length < 6) { erroEl.textContent = 'A senha deve ter pelo menos 6 caracteres.'; erroEl.hidden = false; return }
    if (s1 !== s2)     { erroEl.textContent = 'As senhas não conferem.'; erroEl.hidden = false; return }

    const { error } = await bioSupabase().auth.updateUser({ password: s1 })
    if (error) { erroEl.textContent = 'Erro ao salvar senha. Tente novamente.'; erroEl.hidden = false; return }

    await bioMostrarTelaPostLogin()
  })
}

async function bioMostrarTelaPostLogin() {
  const temPin = await bioOfflineTemPin()
  if (!temPin) {
    bioMostrarTela('tela-config-pin')
    bioIniciarTelaConfigPin()
  } else {
    bioMostrarTela('tela-bloqueio')
    bioIniciarTelaBloqueio()
  }
}

// ── Configurar PIN ─────────────────────────────────────────────
function bioIniciarTelaConfigPin() {
  bioIniciarKeypad('pin-setup', async (pin) => {
    await bioOfflineSetPin(pin)
    await bioEntrarNaHome()
  })
}

// ── Tela de bloqueio (PIN) ─────────────────────────────────────
function bioIniciarTelaBloqueio() {
  const monitor = BioApp.monitor ?? {}
  const nomeEl  = document.getElementById('bio-lock-nome')
  if (nomeEl) nomeEl.textContent = monitor.nome_completo?.split(' ')[0] ?? 'Monitor'

  bioIniciarKeypad('pin-lock', async (pin) => {
    const ok = await bioOfflineVerificarPin(pin)
    if (ok) {
      await bioEntrarNaHome()
    } else {
      const erroEl = document.getElementById('bio-lock-erro')
      if (erroEl) { erroEl.textContent = 'PIN incorreto. Tente novamente.'; erroEl.hidden = false }
      setTimeout(() => { if (erroEl) erroEl.hidden = true }, 2500)
    }
  })

  document.getElementById('bio-btn-esqueci-pin')?.addEventListener('click', () => {
    bioSupabase().auth.signOut()
    bioMostrarTela('tela-login')
  })
}

// ── Keypad genérico (usado em bloqueio e setup de PIN) ─────────
function bioIniciarKeypad(prefixo, onConfirmar) {
  const digits = []
  const dotEls = document.querySelectorAll(`#${prefixo}-display .bio-pin-dot`)

  function atualizar() {
    dotEls.forEach((d, i) => d.classList.toggle('ativo', i < digits.length))
  }

  function reiniciar() {
    digits.length = 0; atualizar()
    document.getElementById(`${prefixo}-erro`)?.setAttribute('hidden', '')
  }

  document.querySelectorAll(`#${prefixo}-keypad .bio-pin-key`).forEach(btn => {
    btn.addEventListener('click', async () => {
      const v = btn.dataset.v
      if (v !== undefined && digits.length < 4) {
        digits.push(v); atualizar()
        if (digits.length === 4) {
          await onConfirmar(digits.join(''))
          reiniciar()
        }
      } else if (btn.classList.contains('bio-pin-clear')) {
        digits.pop(); atualizar()
      }
    })
  })
}

/* ════════════════════════════════════════════════════════════
   HOME
   ════════════════════════════════════════════════════════════ */
async function bioEntrarNaHome() {
  const monitor = BioApp.monitor ?? await bioOfflineGetConfig('monitor')
  if (!monitor) { bioMostrarTela('tela-login'); return }
  BioApp.monitor = monitor

  // Preenche nome/grupo
  const hora  = new Date().getHours()
  const sauda = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
  document.getElementById('bio-home-saudacao').textContent = sauda
  document.getElementById('bio-home-nome').textContent     = monitor.nome_completo?.split(' ')[0] ?? ''
  document.getElementById('bio-home-grupo').textContent    = monitor.grupo_nome ?? ''
  document.getElementById('bio-home-programa').textContent = monitor.programa_nome ?? ''

  // Avatar
  const avatarEl = document.getElementById('bio-home-avatar')
  if (monitor.foto_url) {
    avatarEl.style.backgroundImage = `url(${monitor.foto_url})`
    document.getElementById('bio-home-avatar-letra').textContent = ''
  } else {
    avatarEl.style.backgroundImage = ''
    document.getElementById('bio-home-avatar-letra').textContent = (monitor.nome_completo ?? 'M')[0].toUpperCase()
  }

  // Inicia GPS
  bioIniciarGPS()

  // Conectividade
  bioAtualizarChipConexao()
  window.addEventListener('online',  bioAtualizarChipConexao)
  window.addEventListener('offline', bioAtualizarChipConexao)

  // Carrega praias (cache offline + busca do servidor)
  await bioCarregarPraiasHome()

  // Sessão no servidor
  try {
    const { data } = await bioSupabase().rpc('bio_monitor_iniciar_sessao', {
      p_dispositivo: navigator.userAgent.substring(0, 200),
      p_app_versao:  '1.0.0',
    })
    BioApp.sessaoId = data
  } catch (_) { /* offline — sem problema */ }

  // Preenche card de config
  const cfgNome  = document.getElementById('bio-config-nome')
  const cfgGrupo = document.getElementById('bio-config-grupo')
  if (cfgNome)  cfgNome.textContent  = monitor.nome_completo ?? '—'
  if (cfgGrupo) cfgGrupo.textContent = monitor.grupo_nome ?? ''
  const cfgAvatarEl = document.getElementById('bio-config-avatar')
  if (cfgAvatarEl) {
    if (monitor.foto_url) {
      cfgAvatarEl.style.backgroundImage = `url(${monitor.foto_url})`
      cfgAvatarEl.textContent = ''
    } else {
      cfgAvatarEl.textContent = (monitor.nome_completo ?? 'M')[0].toUpperCase()
    }
  }

  // Listeners da home
  bioIniciarListenersHome()

  // Fila
  await bioAtualizarBadgeFila()

  // Sync automático
  bioSyncTudo({
    monitorId:   monitor.id,
    onConcluido: () => bioAtualizarBadgeFila(),
    onErro:      (e) => console.warn('biomonitor sync:', e),
  })

  bioMostrarTela('tela-home')
  bioMostrarTela('tela-home')  // força re-renderização
}

function bioAtualizarChipConexao() {
  const chip  = document.getElementById('bio-conn-chip')
  const texto = document.getElementById('bio-conn-texto')
  if (!chip) return
  if (navigator.onLine) {
    chip.classList.add('on'); chip.classList.remove('off')
    if (texto) texto.textContent = 'Online'
  } else {
    chip.classList.remove('on'); chip.classList.add('off')
    if (texto) texto.textContent = 'Offline'
  }
}

async function bioCarregarPraiasHome() {
  // Busca do servidor (não bloqueia)
  bioSyncCachePraias(BioApp.monitor?.grupo_id).catch(() => {})

  const praias = await bioOfflineListarPraias()
  if (!praias.length) return

  // Se já tem praia salva, restaura
  const praiaId = await bioOfflineGetConfig('praia_selecionada')
  const praia   = praias.find(p => p.id === praiaId) ?? praias[0]
  bioSelecionarPraia(praia)
}

function bioSelecionarPraia(praia) {
  BioApp.praiaAtual = praia
  bioOfflineSetConfig('praia_selecionada', praia.id)
  document.getElementById('bio-praia-nome').textContent    = praia.nome
  document.getElementById('bio-praia-cod').textContent     = praia.codigo
  document.getElementById('bio-praia-detalhe').textContent = [praia.comunidade, praia.municipio].filter(Boolean).join(' — ')
}

function bioIniciarListenersHome() {
  // Seletor de praia
  document.getElementById('bio-praia-seletor')?.addEventListener('click', bioAbrirSheetPraias)

  // Botões de ação
  document.getElementById('bio-btn-registrar')?.addEventListener('click', () => {
    if (!BioApp.praiaAtual) { bioToast('Selecione uma praia primeiro.', 'err'); return }
    BioApp.formTipo = 'ninho'
    BioApp.formNinho = null
    bioAbrirFormNinho()
  })
  document.getElementById('bio-btn-abertos')?.addEventListener('click', bioAbrirTelaAbertos)
  document.getElementById('bio-btn-historico')?.addEventListener('click', bioAbrirTelaHistorico)
  document.getElementById('bio-btn-sync-home')?.addEventListener('click', () => {
    bioSyncTudo({
      monitorId:   BioApp.monitor?.id,
      onConcluido: () => { bioAtualizarBadgeFila(); bioToast('Sincronizado!', 'ok') },
      onErro:      () => bioToast('Falha na sincronização.', 'err'),
    })
  })

  // Nav
  document.getElementById('nav-home')?.addEventListener('click',    () => bioMostrarTela('tela-home'))
  document.getElementById('nav-abertos')?.addEventListener('click', () => bioAbrirTelaAbertos())
  document.getElementById('nav-fila')?.addEventListener('click',    () => bioCarregarTelaSincronizacao())
  document.getElementById('nav-dados')?.addEventListener('click',   () => bioCarregarTelaDados())
  document.getElementById('nav-config')?.addEventListener('click',  () => bioMostrarTela('tela-config'))

  // Botão central nav = novo ninho
  document.getElementById('bio-nav-cam')?.addEventListener('click', () => {
    if (!BioApp.praiaAtual) { bioToast('Selecione uma praia.', 'err'); return }
    BioApp.formTipo = 'ninho'
    BioApp.formNinho = null
    bioAbrirFormNinho()
  })
}

// ── Sheet de seleção de praias ─────────────────────────────────
async function bioAbrirSheetPraias() {
  const praias  = await bioOfflineListarPraias()
  const sheetEl = document.getElementById('bio-sheet-praias')
  const lista   = document.getElementById('bio-sheet-praias-lista')
  lista.innerHTML = ''
  praias.forEach(p => {
    const item = document.createElement('div')
    item.className = 'bio-sheet-item'
    item.innerHTML = `
      <span class="bio-sheet-item-cod">${p.codigo}</span>
      <div class="bio-sheet-item-info">
        <strong>${p.nome}</strong>
        <span>${[p.comunidade, p.municipio].filter(Boolean).join(' — ')}</span>
      </div>`
    item.addEventListener('click', () => {
      bioSelecionarPraia(p)
      sheetEl.hidden = true
    })
    lista.appendChild(item)
  })
  sheetEl.hidden = false
}

/* ════════════════════════════════════════════════════════════
   GPS
   ════════════════════════════════════════════════════════════ */
function bioIniciarGPS() {
  if (!navigator.geolocation) return
  navigator.geolocation.watchPosition(
    pos => {
      BioApp.gpsLat      = pos.coords.latitude
      BioApp.gpsLng      = pos.coords.longitude
      BioApp.gpsPrecisao = pos.coords.accuracy
      const coordsEl = document.getElementById('bio-gps-coords')
      const accEl    = document.getElementById('bio-gps-acc')
      if (coordsEl) coordsEl.textContent = `${BioApp.gpsLat.toFixed(5)}, ${BioApp.gpsLng.toFixed(5)}`
      if (accEl)    accEl.textContent    = `±${Math.round(pos.coords.accuracy)}m`
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  )
}

/* ════════════════════════════════════════════════════════════
   FORMULÁRIO — NINHO (Encontro)
   ════════════════════════════════════════════════════════════ */
function bioAbrirFormNinho() {
  const praia = BioApp.praiaAtual
  document.getElementById('bio-form-praia-label').textContent = praia?.nome ?? '—'
  document.getElementById('bio-form-data').value = new Date().toISOString().slice(0, 10)
  document.getElementById('bio-form-numero').value = ''
  document.getElementById('bio-form-obs').value   = ''
  document.getElementById('bio-form-foto-count').textContent = '(0/3)'

  // Limpa seleção de espécie
  document.querySelectorAll('.bio-especie-chip').forEach(c => c.classList.remove('sel'))

  // Limpa campos de ovos
  document.getElementById('bio-form-qtd-ovos').value        = ''
  document.getElementById('bio-form-ovos-integros').value   = ''
  document.getElementById('bio-form-ovos-descartados').value = ''

  // Limpa distância ao rio
  document.getElementById('bio-form-dist-rio').value = ''
  document.getElementById('bio-btn-marcar-rio-txt').textContent = 'Marcar ponto do Rio'
  document.getElementById('bio-dist-gps-dica').textContent =
    'Vá até a margem do rio e toque o botão acima — o app calcula a distância automaticamente.'
  BioApp.distRioMetodo = 'tracker'
  BioApp.distRioLatRio = null
  BioApp.distRioLngRio = null
  document.querySelectorAll('.bio-dist-chip').forEach(c => {
    c.classList.toggle('ativo', c.dataset.metodo === 'tracker')
  })
  document.getElementById('bio-dist-medir-gps').style.display = ''

  // Coords GPS
  bioAtualizarGpsForm()

  BioApp.formNinho = {
    uuid_cliente: bioUuid(),
    praia_id:     praia?.id ?? null,
    uc_id:        BioApp.monitor?.uc_id ?? null,
    grupo_id:     BioApp.monitor?.grupo_id ?? null,
    foto_urls:    [],
    status_sync:  'pendente',
    criado_em:    new Date().toISOString(),
  }

  bioMostrarTela('tela-form-ninho')
}

function bioAtualizarGpsForm() {
  const el = document.getElementById('bio-form-gps-coords')
  if (!el) return
  if (BioApp.gpsLat != null) {
    el.textContent = `${BioApp.gpsLat.toFixed(5)}, ${BioApp.gpsLng.toFixed(5)}`
  } else {
    el.textContent = 'Aguardando GPS…'
  }
}

async function bioSalvarNinho() {
  const numero  = document.getElementById('bio-form-numero').value.trim()
  const data    = document.getElementById('bio-form-data').value
  const obs     = document.getElementById('bio-form-obs').value.trim()
  const especie = document.querySelector('.bio-especie-chip.sel')?.dataset.esp

  if (!numero)  { bioToast('Informe o número do ninho (placa).', 'err'); return }
  if (!data)    { bioToast('Informe a data de encontro.', 'err'); return }
  if (!especie) { bioToast('Selecione a espécie.', 'err'); return }

  const parseNum = id => { const v = parseInt(document.getElementById(id).value); return isNaN(v) ? null : v }
  const distVal  = parseFloat(document.getElementById('bio-form-dist-rio').value)

  const ninho = {
    ...BioApp.formNinho,
    numero_ninho:     numero,
    especie,
    data_encontro:    data,
    observacoes:      obs || null,
    lat:              BioApp.gpsLat,
    lng:              BioApp.gpsLng,
    precisao_gps_m:   BioApp.gpsPrecisao,
    status:           'encontrado',
    status_validacao: 'pendente',
    qtd_ovos:         parseNum('bio-form-qtd-ovos'),
    ovos_integros:    parseNum('bio-form-ovos-integros'),
    ovos_descartados: parseNum('bio-form-ovos-descartados'),
    dist_rio_m:       isNaN(distVal) ? null : distVal,
    dist_rio_metodo:  document.getElementById('bio-form-dist-rio').value ? (BioApp.distRioMetodo ?? 'estimativa') : null,
  }

  await bioOfflineSalvarNinho(ninho)
  await bioAtualizarBadgeFila()

  // Tenta sync imediato
  bioSyncTudo({
    monitorId:   BioApp.monitor?.id,
    onConcluido: () => bioAtualizarBadgeFila(),
  })

  bioToast('Ninho registrado!', 'ok')
  bioMostrarTela('tela-home')
}

// ── Fotos no formulário de ninho ──────────────────────────────
function bioIniciarFotosForm() {
  const grid   = document.getElementById('bio-form-foto-grid')
  const btnCam = document.getElementById('bio-form-btn-camera')
  const inp    = document.getElementById('bio-form-input-foto')

  function atualizarGrid() {
    const fotos = BioApp.formNinho?.foto_urls ?? []
    document.getElementById('bio-form-foto-count').textContent = `(${fotos.length}/3)`
    grid.innerHTML = ''
    fotos.forEach((url, i) => {
      const img = document.createElement('img')
      img.src = url
      img.addEventListener('click', () => {
        if (confirm('Remover esta foto?')) {
          BioApp.formNinho.foto_urls.splice(i, 1)
          atualizarGrid()
        }
      })
      grid.appendChild(img)
    })
  }

  btnCam?.addEventListener('click', () => inp?.click())
  inp?.addEventListener('change', async () => {
    const fotos = BioApp.formNinho?.foto_urls ?? []
    for (const file of Array.from(inp.files ?? [])) {
      if (fotos.length >= 3) break
      const url = await new Promise(res => {
        const reader = new FileReader()
        reader.onload = e => res(e.target.result)
        reader.readAsDataURL(file)
      })
      fotos.push(url)
    }
    if (BioApp.formNinho) BioApp.formNinho.foto_urls = fotos
    atualizarGrid()
    inp.value = ''
  })
}

/* ════════════════════════════════════════════════════════════
   FORMULÁRIO — TRANSFERÊNCIA
   ════════════════════════════════════════════════════════════ */
async function bioAbrirFormTransf(ninho) {
  BioApp.formNinhoAtualizar = ninho
  document.getElementById('bio-transf-ninho-num').textContent = ninho.numero_ninho
  document.getElementById('bio-transf-especie').textContent   = BIO_ESPECIES.find(e => e.id === ninho.especie)?.nome ?? ninho.especie
  document.getElementById('bio-transf-data').value            = new Date().toISOString().slice(0, 10)
  document.getElementById('bio-transf-ovos').value            = ''
  document.getElementById('bio-transf-local').value           = ''
  document.getElementById('bio-transf-obs').value             = ''
  bioMostrarTela('tela-form-transf')
}

async function bioSalvarTransf() {
  const ninho = BioApp.formNinhoAtualizar
  const data  = document.getElementById('bio-transf-data').value
  const ovos  = parseInt(document.getElementById('bio-transf-ovos').value)
  const local = document.getElementById('bio-transf-local').value.trim()
  const obs   = document.getElementById('bio-transf-obs').value.trim()

  if (!data)           { bioToast('Informe a data da transferência.', 'err'); return }
  if (isNaN(ovos) || ovos < 0) { bioToast('Informe o número de ovos.', 'err'); return }

  const transf = {
    uuid_cliente:       bioUuid(),
    ninho_uuid:         ninho.uuid_cliente,
    ninho_numero:       ninho.numero_ninho,
    data_transferencia: data,
    qtd_ovos:           ovos,
    local_destino:      local || null,
    observacoes:        obs || null,
    status_sync:        'pendente',
    criado_em:          new Date().toISOString(),
  }

  // Atualiza status do ninho localmente
  await bioOfflineSalvarNinho({ ...ninho, status: 'transferido' })
  await bioOfflineSalvarTransf(transf)
  await bioAtualizarBadgeFila()

  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast('Transferência registrada!', 'ok')
  bioMostrarTela('tela-home')
}

/* ════════════════════════════════════════════════════════════
   FORMULÁRIO — ECLOSÃO
   ════════════════════════════════════════════════════════════ */
async function bioAbrirFormEclosao(ninho) {
  BioApp.formNinhoAtualizar = ninho
  document.getElementById('bio-ecl-ninho-num').textContent  = ninho.numero_ninho
  document.getElementById('bio-ecl-especie').textContent    = BIO_ESPECIES.find(e => e.id === ninho.especie)?.nome ?? ninho.especie
  document.getElementById('bio-ecl-data').value             = new Date().toISOString().slice(0, 10)

  // Contadores
  bioSetContador('bio-ecl-vivos',    0)
  bioSetContador('bio-ecl-mortos',   0)
  bioSetContador('bio-ecl-nao-nasc', 0)

  // Predação
  document.querySelectorAll('.bio-pred-opt').forEach(o => o.classList.remove('sel'))
  document.querySelector('.bio-pred-opt[data-pred="nenhuma"]')?.classList.add('sel')

  bioMostrarTela('tela-form-eclosao')
}

function bioSetContador(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

function bioIniciarContadores() {
  ;[
    { idValor: 'bio-ecl-vivos',    min: 0 },
    { idValor: 'bio-ecl-mortos',   min: 0 },
    { idValor: 'bio-ecl-nao-nasc', min: 0 },
  ].forEach(({ idValor, min }) => {
    const valEl  = document.getElementById(idValor)
    const plusEl = document.getElementById(`${idValor}-plus`)
    const minEl  = document.getElementById(`${idValor}-minus`)
    plusEl?.addEventListener('click',  () => { const v = parseInt(valEl.textContent) + 1; valEl.textContent = v })
    minEl?.addEventListener('click',   () => { const v = Math.max(min, parseInt(valEl.textContent) - 1); valEl.textContent = v })
  })

  // Predação
  document.querySelectorAll('.bio-pred-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.bio-pred-opt').forEach(o => o.classList.remove('sel', 'perigo'))
      opt.classList.add('sel')
      if (opt.dataset.pred !== 'nenhuma') opt.classList.add('perigo')
    })
  })
}

async function bioSalvarEclosao() {
  const ninho       = BioApp.formNinhoAtualizar
  const data        = document.getElementById('bio-ecl-data').value
  const vivos       = parseInt(document.getElementById('bio-ecl-vivos').textContent)    || 0
  const mortos      = parseInt(document.getElementById('bio-ecl-mortos').textContent)   || 0
  const naoNascidos = parseInt(document.getElementById('bio-ecl-nao-nasc').textContent) || 0
  const predacao    = document.querySelector('.bio-pred-opt.sel')?.dataset.pred ?? 'nenhuma'

  if (!data)  { bioToast('Informe a data de nascimento.', 'err'); return }

  const ecl = {
    uuid_cliente:      bioUuid(),
    ninho_uuid:        ninho.uuid_cliente,
    ninho_numero:      ninho.numero_ninho,
    data_nascimento:   data,
    filhotes_vivos:    vivos,
    filhotes_mortos:   mortos,
    ovos_nao_nascidos: naoNascidos,
    predacao,
    foto_urls:         [],
    status_sync:       'pendente',
    criado_em:         new Date().toISOString(),
  }

  await bioOfflineSalvarNinho({ ...ninho, status: 'eclodido' })
  await bioOfflineSalvarEclosao(ecl)
  await bioAtualizarBadgeFila()

  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast('Eclosão registrada!', 'ok')
  bioMostrarTela('tela-home')
}

/* ════════════════════════════════════════════════════════════
   NINHOS ABERTOS / HISTÓRICO
   ════════════════════════════════════════════════════════════ */
async function bioAbrirTelaAbertos() {
  const praiaId = BioApp.praiaAtual?.id
  let ninhos = await bioOfflineListarNinhos({ praiaId })
  ninhos = ninhos.filter(n => n.status !== 'eclodido' && n.status !== 'perdido')
  bioRenderizarListaNinhos('bio-lista-abertos', ninhos, true)
  bioMostrarTela('tela-abertos')
}

async function bioAbrirTelaHistorico() {
  const praiaId = BioApp.praiaAtual?.id
  const ninhos  = await bioOfflineListarNinhos({ praiaId })
  bioRenderizarListaNinhos('bio-lista-historico', ninhos, false)
  bioMostrarTela('tela-historico')
}

function bioRenderizarListaNinhos(containerId, ninhos, mostrarAcoes) {
  const el = document.getElementById(containerId)
  if (!el) return
  if (!ninhos.length) {
    el.innerHTML = '<p style="text-align:center;color:#9CA3AF;padding:24px">Nenhum ninho encontrado.</p>'
    return
  }
  el.innerHTML = ''
  ninhos.forEach(n => {
    const esp    = BIO_ESPECIES.find(e => e.id === n.especie)
    const card   = document.createElement('div')
    card.className = 'bio-ninho-card'
    card.innerHTML = `
      <div class="bio-ninho-card-header">
        <span class="bio-ninho-num">${n.numero_ninho}</span>
        <span class="bio-ninho-status ${n.status}">${bioLabels.status[n.status] ?? n.status}</span>
      </div>
      <div class="bio-ninho-card-meta">
        <span>${esp?.sigla ?? '?'} — ${esp?.nome ?? n.especie}</span>
        <span>${new Date(n.data_encontro).toLocaleDateString('pt-BR')}</span>
        ${n.status_validacao === 'rejeitado' ? '<span style="color:#dc2626">Rejeitado: ' + (n.motivo_rejeicao ?? '') + '</span>' : ''}
      </div>
      ${mostrarAcoes ? `
        <div style="display:flex;gap:8px;margin-top:10px">
          ${n.status === 'encontrado' || n.status === 'transferido' ? `<button class="bio-btn-sm prim" data-acao="transferencia">+ Transferência</button>` : ''}
          ${n.status !== 'eclodido' && n.status !== 'perdido' ? `<button class="bio-btn-sm ghost" data-acao="eclosao">Registrar Eclosão</button>` : ''}
        </div>` : ''}
    `

    card.querySelectorAll('[data-acao]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        if (btn.dataset.acao === 'transferencia') bioAbrirFormTransf(n)
        if (btn.dataset.acao === 'eclosao')       bioAbrirFormEclosao(n)
      })
    })

    el.appendChild(card)
  })
}

/* ════════════════════════════════════════════════════════════
   FILA DE SINCRONIZAÇÃO
   ════════════════════════════════════════════════════════════ */
async function bioCarregarTelaSincronizacao() {
  const [ninhos, transfs, ecls] = await Promise.all([
    bioOfflineListarNinhos(),
    bioOfflineTransfPendentes(),
    bioOfflineEclosoesPendentes(),
  ])

  const total = ninhos.length + transfs.length + ecls.length
  document.getElementById('bio-fila-total').textContent      = total
  document.getElementById('bio-fila-pendentes').textContent  = ninhos.filter(n => n.status_sync === 'pendente').length
  document.getElementById('bio-fila-confirmados').textContent = ninhos.filter(n => n.status_sync === 'confirmado').length

  const container = document.getElementById('bio-sync-queue')
  container.innerHTML = ''

  const tudo = [
    ...ninhos.map(n => ({ ...n, _tipo: 'ninho' })),
    ...transfs.map(t => ({ ...t, _tipo: 'transferencia' })),
    ...ecls.map(e => ({ ...e, _tipo: 'eclosao' })),
  ].sort((a, b) => b.criado_em.localeCompare(a.criado_em))

  tudo.slice(0, 30).forEach(item => {
    const div  = document.createElement('div')
    div.className = 'bio-sync-item'
    const tipo  = item._tipo
    const tipoLabel = { ninho: 'Ninho', transferencia: 'Transferência', eclosao: 'Eclosão' }[tipo]
    const num   = item.numero_ninho ?? item.ninho_numero ?? '—'
    div.innerHTML = `
      <div class="bio-sync-dot ${item.status_sync ?? 'pendente'}"></div>
      <div class="bio-sync-info">
        <span class="bio-sync-tipo ${tipo}">${tipoLabel}</span>
        <strong>${num}</strong>
        <span>${new Date(item.criado_em).toLocaleString('pt-BR')}</span>
      </div>`
    container.appendChild(div)
  })

  bioMostrarTela('tela-fila')
}

async function bioAtualizarBadgeFila() {
  const total = await bioOfflineContarPendentes()
  const badge = document.getElementById('bio-nav-fila-badge')
  if (badge) {
    badge.textContent = total > 0 ? total : ''
    badge.style.display = total > 0 ? '' : 'none'
  }
  const card  = document.getElementById('bio-fila-card')
  const count = document.getElementById('bio-fila-count')
  if (card) card.hidden = total === 0
  if (count) count.textContent = `${total} registro${total !== 1 ? 's' : ''}`
}

/* ════════════════════════════════════════════════════════════
   ABA DADOS
   ════════════════════════════════════════════════════════════ */
async function bioCarregarTelaDados() {
  bioMostrarTela('tela-dados')

  // Busca do servidor via RPC
  if (navigator.onLine) {
    try {
      const { data } = await bioSupabase().rpc('bio_meus_dados')
      if (data) bioRenderizarKPIs(data)
    } catch (_) {}
  }

  // Fallback local
  const ninhos = await bioOfflineListarNinhos()
  const totalLocal = ninhos.length
  const eclodidosLocal = ninhos.filter(n => n.status === 'eclodido').length
  document.getElementById('bio-kpi-ninhos-local').textContent    = totalLocal
  document.getElementById('bio-kpi-eclodidos-local').textContent = eclodidosLocal
}

function bioRenderizarKPIs(dados) {
  const mapa = {
    'bio-kpi-ninhos':      dados.grupo_ninhos,
    'bio-kpi-eclodidos':   dados.eclodidos,
    'bio-kpi-filhotes':    dados.filhotes_vivos,
    'bio-kpi-taxa':        dados.taxa_eclosao_pct != null ? dados.taxa_eclosao_pct + '%' : '—',
  }
  Object.entries(mapa).forEach(([id, val]) => {
    const el = document.getElementById(id)
    if (el && val != null) el.textContent = val
  })
}

/* ════════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════════ */
function bioIniciarConfig() {
  document.getElementById('bio-config-nome')?.textContent  // preenchido na home
  document.getElementById('bio-btn-alterar-pin')?.addEventListener('click', async () => {
    bioMostrarTela('tela-config-pin')
    bioIniciarTelaConfigPin()
  })
  document.getElementById('bio-btn-zerar-fila')?.addEventListener('click', async () => {
    if (!confirm('Zerar a fila apaga todos os registros locais não enviados. Continuar?')) return
    await bioOfflineZerarFila()
    await bioAtualizarBadgeFila()
    bioToast('Fila zerada.', 'ok')
  })
  document.getElementById('bio-btn-sair')?.addEventListener('click', async () => {
    if (!confirm('Encerrar sessão?')) return
    await bioSupabase().auth.signOut()
    await bioOfflineDelConfig('pin_hash')
    await bioOfflineDelConfig('monitor')
    bioMostrarTela('tela-login')
  })
}

/* ════════════════════════════════════════════════════════════
   TOAST
   ════════════════════════════════════════════════════════════ */
let _bioToastTimer = null
function bioToast(msg, tipo = '') {
  const el = document.getElementById('bio-toast')
  if (!el) return
  el.textContent = msg
  el.className   = 'bio-toast show ' + tipo
  clearTimeout(_bioToastTimer)
  _bioToastTimer = setTimeout(() => el.classList.remove('show'), 2800)
}

/* ════════════════════════════════════════════════════════════
   LABELS
   ════════════════════════════════════════════════════════════ */
const bioLabels = {
  status: {
    encontrado:  'Encontrado',
    transferido: 'Transferido',
    eclodido:    'Eclodido',
    perdido:     'Perdido',
  },
}

/* ════════════════════════════════════════════════════════════
   INICIALIZAÇÃO
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // Inicializa sub-componentes
  bioIniciarTelaTrocarSenha()
  bioIniciarFotosForm()
  bioIniciarContadores()
  bioIniciarConfig()

  // Back buttons
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const destino = btn.dataset.back
      bioMostrarTela(destino)
    })
  })

  // Salvar botões
  document.getElementById('bio-btn-salvar-ninho')?.addEventListener('click', bioSalvarNinho)
  document.getElementById('bio-btn-salvar-transf')?.addEventListener('click', bioSalvarTransf)
  document.getElementById('bio-btn-salvar-eclosao')?.addEventListener('click', bioSalvarEclosao)

  // Chips de espécie
  document.querySelectorAll('.bio-especie-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.bio-especie-chip').forEach(c => c.classList.remove('sel'))
      chip.classList.add('sel')
    })
  })

  // Chips de método de distância (tracker / estimativa)
  document.querySelectorAll('.bio-dist-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.bio-dist-chip').forEach(c => c.classList.remove('ativo'))
      chip.classList.add('ativo')
      BioApp.distRioMetodo = chip.dataset.metodo
      document.getElementById('bio-dist-medir-gps').style.display =
        chip.dataset.metodo === 'tracker' ? '' : 'none'
    })
  })

  // Botão "Marcar ponto do Rio" — captura GPS atual e calcula distância ao ninho
  document.getElementById('bio-btn-marcar-rio')?.addEventListener('click', () => {
    const btn  = document.getElementById('bio-btn-marcar-rio')
    const txt  = document.getElementById('bio-btn-marcar-rio-txt')
    const dica = document.getElementById('bio-dist-gps-dica')
    txt.textContent = 'Capturando GPS…'
    btn.disabled = true
    navigator.geolocation.getCurrentPosition(
      pos => {
        const latRio = pos.coords.latitude
        const lngRio = pos.coords.longitude
        BioApp.distRioLatRio = latRio
        BioApp.distRioLngRio = lngRio
        const latNinho = BioApp.gpsLat
        const lngNinho = BioApp.gpsLng
        if (latNinho != null && lngNinho != null) {
          const dist = bioHaversineM(latNinho, lngNinho, latRio, lngRio)
          document.getElementById('bio-form-dist-rio').value = dist.toFixed(1)
          txt.textContent = 'Rio marcado ✓'
          dica.textContent = `Distância calculada: ${dist.toFixed(1)} m (precisão GPS: ±${Math.round(pos.coords.accuracy)} m)`
        } else {
          txt.textContent = 'Marcar ponto do Rio'
          dica.textContent = 'GPS do ninho não disponível — insira a distância manualmente.'
          document.getElementById('bio-form-dist-rio').focus()
        }
        btn.disabled = false
      },
      () => {
        txt.textContent = 'Marcar ponto do Rio'
        dica.textContent = 'Não foi possível obter GPS. Insira a distância manualmente.'
        btn.disabled = false
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  })

  // Sheet overlay fecha ao clicar fora
  document.getElementById('bio-sheet-praias')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true
  })

  // Foto viewer
  document.getElementById('bio-foto-viewer-fechar')?.addEventListener('click', () => {
    document.getElementById('bio-foto-viewer').hidden = true
  })

  // Sincronização em background (listeners online/offline)
  bioSyncIniciarListeners({
    monitorId:   null,  // preenchido após login
    onConcluido: () => bioAtualizarBadgeFila(),
  })

  // Entrar
  await bioIniciar()
})
