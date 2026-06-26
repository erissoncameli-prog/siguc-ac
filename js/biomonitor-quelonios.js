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
  // Filtros de aba
  abertosStatusFiltro: null,      // null = todos; 'encontrado'|'transferido'|'eclodido'|'perdido'
  abertosFiltroPraia: undefined,  // undefined = usar praiaAtual; null = todas
  filaFiltroPraia:    undefined,  // undefined = todas; null = todas (explícito)
  // GPS proximidade
  _praiaProxima:      null,       // praia dentro de BIO_PROX_RAIO_M
  _sheetPraiaOnSelect: null,      // callback temporário do sheet de praias
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

  // Aguarda o cliente Supabase isolado ser criado (depende de /api/env)
  if (typeof _bioReady !== 'undefined') await _bioReady

  if (!window._bioDB_client) {
    bioMostrarTela('tela-login')
    bioIniciarTelaLogin()
    const erroEl = document.getElementById('bio-login-erro')
    if (erroEl) { erroEl.textContent = 'Sem conexão com o servidor. Verifique sua internet.'; erroEl.hidden = false }
    return
  }

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
  // Atualiza o cache de praias (aguarda se online para garantir dados na 1ª abertura)
  if (navigator.onLine) {
    await bioSyncCachePraias(BioApp.monitor?.grupo_id).catch(() => {})
  } else {
    bioSyncCachePraias(BioApp.monitor?.grupo_id).catch(() => {})
  }

  const praias = await bioOfflineListarPraias()
  if (!praias.length) return

  // Se já tem praia salva, restaura; senão usa a primeira da lista
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

  document.getElementById('bio-btn-usar-sugestao')?.addEventListener('click', () => {
    const chip = document.getElementById('bio-praia-sugestao')
    const praia = chip?._praiaProxima
    if (!praia) return
    bioSelecionarPraia(praia)
    chip.hidden = true
  })

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
  document.getElementById('nav-config')?.addEventListener('click',  () => { bioMostrarTela('tela-config'); bioCarregarConfig() })

  // ── Filtros da aba Abertos ──
  document.getElementById('bio-btn-reload-abertos')?.addEventListener('click', bioCarregarAbertos)
  document.getElementById('bio-abertos-praia-btn')?.addEventListener('click', () =>
    bioAbrirSheetPraias(p => {
      BioApp.abertosFiltroPraia = p
      bioAtualizarLabelFiltro('abertos')
      document.getElementById('bio-abertos-geo-sug').hidden = true
      bioCarregarAbertos()
    })
  )
  document.getElementById('bio-abertos-todas')?.addEventListener('click', () => {
    BioApp.abertosFiltroPraia = null
    bioAtualizarLabelFiltro('abertos')
    document.getElementById('bio-abertos-geo-sug').hidden = true
    bioCarregarAbertos()
  })
  document.getElementById('bio-abertos-geo-usar')?.addEventListener('click', () => {
    const prox = BioApp._praiaProxima
    if (!prox) return
    BioApp.abertosFiltroPraia = prox
    bioAtualizarLabelFiltro('abertos')
    document.getElementById('bio-abertos-geo-sug').hidden = true
    bioCarregarAbertos()
  })

  // ── Filtros da aba Fila/Meus Ninhos ──
  document.getElementById('bio-fila-praia-btn')?.addEventListener('click', () =>
    bioAbrirSheetPraias(p => {
      BioApp.filaFiltroPraia = p
      bioAtualizarLabelFiltro('fila')
      document.getElementById('bio-fila-geo-sug').hidden = true
      bioCarregarFilaLocal()
    })
  )
  document.getElementById('bio-fila-todas')?.addEventListener('click', () => {
    BioApp.filaFiltroPraia = null
    bioAtualizarLabelFiltro('fila')
    document.getElementById('bio-fila-geo-sug').hidden = true
    bioCarregarFilaLocal()
  })
  document.getElementById('bio-fila-geo-usar')?.addEventListener('click', () => {
    const prox = BioApp._praiaProxima
    if (!prox) return
    BioApp.filaFiltroPraia = prox
    bioAtualizarLabelFiltro('fila')
    document.getElementById('bio-fila-geo-sug').hidden = true
    bioCarregarFilaLocal()
  })

  // Botão central nav = novo ninho
  document.getElementById('bio-nav-cam')?.addEventListener('click', () => {
    if (!BioApp.praiaAtual) { bioToast('Selecione uma praia.', 'err'); return }
    BioApp.formTipo = 'ninho'
    BioApp.formNinho = null
    bioAbrirFormNinho()
  })
}

// ── Sheet de seleção de praias ─────────────────────────────────
// onSelect(praia): se fornecido, chama o callback; caso contrário seleciona globalmente
async function bioAbrirSheetPraias(onSelect) {
  BioApp._sheetPraiaOnSelect = onSelect ?? null
  const praias  = await bioOfflineListarPraias()
  const sheetEl = document.getElementById('bio-sheet-praias')
  const lista   = document.getElementById('bio-sheet-praias-lista')
  const busca   = document.getElementById('bio-sheet-praias-busca')

  // Calcula distâncias se GPS disponível
  const temGPS = BioApp.gpsLat != null && BioApp.gpsLng != null
  const comDist = praias.map(p => {
    const dist = (temGPS && p.lat != null && p.lng != null)
      ? bioHaversineM(BioApp.gpsLat, BioApp.gpsLng, p.lat, p.lng)
      : null
    return { ...p, _dist: dist }
  })

  // Ordena: mais próxima primeiro; sem GPS mantém ordem alfabética
  comDist.sort((a, b) => {
    if (a._dist == null && b._dist == null) return 0
    if (a._dist == null) return 1
    if (b._dist == null) return -1
    return a._dist - b._dist
  })

  function renderLista(filtro) {
    const q = (filtro ?? '').trim().toLowerCase()
    const filtradas = q
      ? comDist.filter(p =>
          p.nome.toLowerCase().includes(q) ||
          p.codigo.toLowerCase().includes(q) ||
          (p.comunidade ?? '').toLowerCase().includes(q))
      : comDist

    lista.innerHTML = ''
    if (!filtradas.length) {
      lista.innerHTML = `<p style="text-align:center;color:#9CA3AF;padding:24px 16px">${
        q ? 'Nenhuma praia encontrada.' : 'Nenhuma praia disponível. Verifique a conexão.'
      }</p>`
      return
    }

    filtradas.forEach(p => {
      const item = document.createElement('div')
      item.className = 'bio-sheet-item'
      const distBadge = p._dist != null
        ? `<span class="bio-sheet-dist ${p._dist <= BIO_PROX_RAIO_M ? 'proxima' : ''}">${p._dist < 1000 ? Math.round(p._dist) + ' m' : (p._dist / 1000).toFixed(1) + ' km'}</span>`
        : ''
      item.innerHTML = `
        <span class="bio-sheet-item-cod">${p.codigo}</span>
        <div class="bio-sheet-item-info">
          <strong>${p.nome}</strong>
          <span>${[p.comunidade, p.municipio].filter(Boolean).join(' — ')}</span>
        </div>
        ${distBadge}`
      item.addEventListener('click', () => {
        sheetEl.hidden = true
        if (busca) busca.value = ''
        if (BioApp._sheetPraiaOnSelect) {
          BioApp._sheetPraiaOnSelect(p)
          BioApp._sheetPraiaOnSelect = null
        } else {
          bioSelecionarPraia(p)
          const chip = document.getElementById('bio-praia-sugestao')
          if (chip) chip.hidden = true
        }
      })
      lista.appendChild(item)
    })
  }

  if (busca) {
    busca.value = ''
    busca.oninput = () => renderLista(busca.value)
    setTimeout(() => busca.focus(), 120)
  }

  renderLista('')
  sheetEl.hidden = false
}

/* ════════════════════════════════════════════════════════════
   GPS
   ════════════════════════════════════════════════════════════ */
const BIO_PROX_RAIO_M = 500   // raio de sugestão de praia

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
      bioVerificarPraiaProxima(pos.coords.latitude, pos.coords.longitude)
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  )
}

let _bioProxTimer = null
async function bioVerificarPraiaProxima(lat, lng) {
  // Debounce: só reavalia a cada 15 s para não bater em IndexedDB toda atualização de GPS
  clearTimeout(_bioProxTimer)
  _bioProxTimer = setTimeout(async () => {
    const praias = await bioOfflineListarPraias()
    let melhor = null, menorDist = Infinity
    for (const p of praias) {
      if (p.lat == null || p.lng == null) continue
      const d = bioHaversineM(lat, lng, p.lat, p.lng)
      if (d < menorDist) { menorDist = d; melhor = p }
    }

    const chip    = document.getElementById('bio-praia-sugestao')
    const nomeEl  = document.getElementById('bio-sugestao-nome')
    const distEl  = document.getElementById('bio-sugestao-dist')
    if (!chip) return

    if (melhor && menorDist <= BIO_PROX_RAIO_M) {
      BioApp._praiaProxima = { ...melhor, _dist: menorDist }
    } else {
      BioApp._praiaProxima = null
    }

    // Home chip
    if (chip) {
      if (melhor && menorDist <= BIO_PROX_RAIO_M && melhor.id !== BioApp.praiaAtual?.id) {
        nomeEl.textContent = melhor.nome
        distEl.textContent = `${Math.round(menorDist)} m`
        chip.hidden = false
        chip._praiaProxima = melhor
      } else {
        chip.hidden = true
        chip._praiaProxima = null
      }
    }
  }, 15000)
}

/* ════════════════════════════════════════════════════════════
   AUTO-NUMERAÇÃO
   ════════════════════════════════════════════════════════════ */
async function bioGerarNumeroNinho(praiaId, especie) {
  const esp    = BIO_ESPECIES.find(e => e.id === especie)
  const praias = await bioOfflineListarPraias()
  const praia  = praias.find(p => p.id === praiaId)
  const cod    = praia?.codigo ?? 'XX'
  const sig    = esp?.sigla   ?? '?'
  const prefix = `${cod}-${sig}-`

  let maxSeq = 0
  const todos = await bioOfflineListarNinhos({})
  todos.forEach(n => {
    if (n.numero_ninho?.startsWith(prefix)) {
      const seq = parseInt(n.numero_ninho.slice(prefix.length)) || 0
      if (seq > maxSeq) maxSeq = seq
    }
  })

  if (navigator.onLine && window._bioDB_client) {
    try {
      const { data } = await bioSupabase()
        .from('ninhos_quelonios')
        .select('numero_ninho')
        .like('numero_ninho', `${prefix}%`)
      ;(data ?? []).forEach(n => {
        const seq = parseInt(n.numero_ninho?.slice(prefix.length)) || 0
        if (seq > maxSeq) maxSeq = seq
      })
    } catch (_) {}
  }

  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
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

  // Limpa condições do ninho
  document.getElementById('bio-form-temperatura').value   = ''
  document.getElementById('bio-form-umidade').value       = ''
  document.getElementById('bio-form-profundidade').value  = ''

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

  const parseNum  = id => { const v = parseInt(document.getElementById(id).value);   return isNaN(v) ? null : v }
  const parseNum2 = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v }
  const distVal   = parseFloat(document.getElementById('bio-form-dist-rio').value)

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
    temperatura_c:    parseNum2('bio-form-temperatura'),
    umidade_pct:      parseNum2('bio-form-umidade'),
    profundidade_cm:  parseNum2('bio-form-profundidade'),
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
  // Inicializa filtro com a praia atual (se não definido ainda)
  if (BioApp.abertosFiltroPraia === undefined) BioApp.abertosFiltroPraia = BioApp.praiaAtual ?? null
  bioMostrarTela('tela-abertos')
  bioAtualizarLabelFiltro('abertos')
  bioMostrarGeoSugTab('abertos')
  await bioCarregarAbertos()
}

async function bioCarregarAbertos() {
  const filtroPraia  = BioApp.abertosFiltroPraia
  const filtroStatus = BioApp.abertosStatusFiltro
  const estadoEl = document.getElementById('bio-abertos-estado')
  const listaEl  = document.getElementById('bio-lista-abertos')
  estadoEl.textContent = 'Carregando do servidor…'; estadoEl.hidden = false
  listaEl.innerHTML = ''

  const estaAberto = n => filtroStatus
    ? n.status === filtroStatus
    : (n.status !== 'eclodido' && n.status !== 'perdido')

  let ninhos = []

  if (navigator.onLine && BioApp.monitor?.grupo_id) {
    try {
      let q = bioSupabase()
        .from('vw_ninhos_validacao')
        .select('id,uuid_cliente,numero_ninho,especie,data_encontro,status,status_validacao,motivo_rejeicao,qtd_ovos,ovos_integros,ovos_descartados,dist_rio_m,criado_em,praia_id,praia_nome,monitor_id,monitor_nome')
        .eq('grupo_id', BioApp.monitor.grupo_id)
        .order('numero_ninho', { ascending: false })
      if (filtroStatus) {
        q = q.eq('status', filtroStatus)
      } else {
        q = q.not('status', 'in', '(eclodido,perdido)')
      }
      if (filtroPraia) q = q.eq('praia_id', filtroPraia.id)
      const { data, error } = await q
      if (error) throw error

      // Mescla: inclui ninhos locais pendentes que ainda não chegaram no servidor
      const localPend = await bioOfflineListarNinhos(filtroPraia ? { praiaId: filtroPraia.id } : {})
      const uuidsServ = new Set((data ?? []).map(n => n.uuid_cliente).filter(Boolean))
      const praias    = await bioOfflineListarPraias()
      const locaisSo  = localPend
        .filter(n => !uuidsServ.has(n.uuid_cliente) && estaAberto(n))
        .map(n => {
          const pr = praias.find(p => p.id === n.praia_id)
          return { ...n, praia_nome: pr?.nome, monitor_nome: BioApp.monitor?.nome_completo, _local: true }
        })

      ninhos = [...locaisSo, ...(data ?? [])]
      estadoEl.hidden = true
    } catch (e) {
      console.warn('[biomonitor abertos]', e)
      estadoEl.textContent = 'Sem conexão — exibindo dados locais'
      const localAll = await bioOfflineListarNinhos(filtroPraia ? { praiaId: filtroPraia.id } : {})
      ninhos = localAll.filter(estaAberto)
    }
  } else {
    estadoEl.textContent = 'Offline — exibindo dados locais'
    const localAll = await bioOfflineListarNinhos(filtroPraia ? { praiaId: filtroPraia.id } : {})
    ninhos = localAll.filter(estaAberto)
  }

  if (!ninhos.length) {
    estadoEl.textContent = filtroPraia
      ? `Nenhum ninho aberto em ${filtroPraia.nome}.`
      : 'Nenhum ninho aberto encontrado.'
    estadoEl.hidden = false
  } else {
    estadoEl.hidden = true
  }

  bioRenderizarListaNinhos('bio-lista-abertos', ninhos, true)
}

async function bioAbrirTelaHistorico() {
  const praiaId = BioApp.praiaAtual?.id
  const ninhos  = await bioOfflineListarNinhos({ praiaId })
  bioRenderizarListaNinhos('bio-lista-historico', ninhos, false)
  bioMostrarTela('tela-historico')
}

// ── Helpers de filtro de praia nos tabs ───────────────────────
function bioAtualizarLabelFiltro(tab) {
  const praia = tab === 'abertos' ? BioApp.abertosFiltroPraia : BioApp.filaFiltroPraia
  const labelId = tab === 'abertos' ? 'bio-abertos-praia-label' : 'bio-fila-praia-label'
  const el = document.getElementById(labelId)
  if (el) el.textContent = praia ? praia.nome : 'Todas as praias'
}

function bioMostrarGeoSugTab(tab) {
  const prox   = BioApp._praiaProxima
  const filtro = tab === 'abertos' ? BioApp.abertosFiltroPraia : BioApp.filaFiltroPraia
  const sugId  = `bio-${tab}-geo-sug`
  const nomeId = `bio-${tab}-geo-nome`
  const distId = `bio-${tab}-geo-dist`
  const sug = document.getElementById(sugId)
  if (!sug) return
  if (prox && prox.id !== filtro?.id) {
    document.getElementById(nomeId).textContent = prox.nome
    document.getElementById(distId).textContent = `${Math.round(prox._dist)} m`
    sug.hidden = false
  } else {
    sug.hidden = true
  }
}

function bioNinhoCardInner(n, opts = {}) {
  const { mostrarAcoes = false } = opts
  const esp    = BIO_ESPECIES.find(e => e.id === n.especie)
  const status = n.status ?? 'encontrado'
  const data   = n.data_encontro
    ? new Date(n.data_encontro + 'T12:00').toLocaleDateString('pt-BR')
    : '—'

  const rejHtml = n.status_validacao === 'rejeitado'
    ? `<div class="bio-nfc-rejeicao">Rejeitado: ${n.motivo_rejeicao ?? ''}</div>`
    : ''

  const ovosHtml = (n.qtd_ovos != null || n.ovos_integros != null || n.ovos_descartados != null) ? `
    <div class="bio-nfc-ovos">
      ${n.qtd_ovos         != null ? `<span>${n.qtd_ovos} ovos</span>` : ''}
      ${n.ovos_integros    != null ? `<span>${n.ovos_integros} ínt.</span>` : ''}
      ${n.ovos_descartados != null ? `<span>${n.ovos_descartados} desc.</span>` : ''}
    </div>` : ''

  const condicoesHtml = (n.temperatura_c != null || n.umidade_pct != null || n.profundidade_cm != null) ? `
    <div class="bio-nfc-ovos">
      ${n.temperatura_c  != null ? `<span>${n.temperatura_c}°C</span>` : ''}
      ${n.umidade_pct    != null ? `<span>${n.umidade_pct}% hum.</span>` : ''}
      ${n.profundidade_cm != null ? `<span>${n.profundidade_cm} cm prof.</span>` : ''}
    </div>` : ''

  const localChip = n._local
    ? '<span class="bio-nfc-ev-chip" style="background:#a78bfa22;color:#7c3aed">pendente</span>'
    : ''

  const acoesHtml = mostrarAcoes ? `
    <div class="bio-nfc-acoes">
      ${status === 'encontrado' || status === 'transferido' ? `<button class="bio-btn-sm prim" data-acao="transferencia">+ Transferência</button>` : ''}
      ${status !== 'eclodido' && status !== 'perdido' ? `<button class="bio-btn-sm ghost" data-acao="eclosao">Eclosão</button>` : ''}
    </div>` : ''

  return `
    <div class="bio-nfc-header">
      <span class="bio-nfc-num">#${n.numero_ninho ?? '—'}</span>
      <span class="bio-nfc-status-badge ${status}">${bioLabels.status[status] ?? status}</span>
    </div>
    <div class="bio-nfc-especie">${esp ? `<strong>${esp.sigla}</strong> ${esp.nome}` : (n.especie ?? '—')}</div>
    <div class="bio-nfc-row">
      ${n.praia_nome ? `<span class="bio-nfc-praia">${n.praia_nome}</span>` : ''}
      <span class="bio-nfc-data">${data}</span>
    </div>
    ${rejHtml}
    ${ovosHtml}
    ${condicoesHtml}
    ${localChip ? `<div class="bio-nfc-eventos">${localChip}</div>` : ''}
    ${acoesHtml}
  `
}

function bioRenderizarListaNinhos(containerId, ninhos, mostrarAcoes) {
  const el = document.getElementById(containerId)
  if (!el) return
  el.innerHTML = ''
  if (!ninhos.length) {
    el.innerHTML = '<p style="text-align:center;color:#9CA3AF;padding:24px">Nenhum ninho encontrado.</p>'
    return
  }
  ninhos.forEach(n => {
    const status = n.status ?? 'encontrado'
    const card   = document.createElement('div')
    card.className = `bio-nfc status-${status}`
    card.innerHTML = bioNinhoCardInner(n, { mostrarAcoes })
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
   MEUS NINHOS (FILA LOCAL)
   ════════════════════════════════════════════════════════════ */
async function bioCarregarTelaSincronizacao() {
  if (BioApp.filaFiltroPraia === undefined) BioApp.filaFiltroPraia = null
  bioMostrarTela('tela-fila')
  bioAtualizarLabelFiltro('fila')
  bioMostrarGeoSugTab('fila')
  await bioCarregarFilaLocal()
}

async function bioCarregarFilaLocal() {
  const filtroPraia = BioApp.filaFiltroPraia
  const praias  = await bioOfflineListarPraias()
  let ninhos    = await bioOfflineListarNinhos(filtroPraia ? { praiaId: filtroPraia.id } : {})

  // Busca eventos vinculados para enriquecer o status exibido
  const [transfs, ecls] = await Promise.all([
    bioOfflineTransfPendentes(),
    bioOfflineEclosoesPendentes(),
  ])
  const transfMap = {}
  transfs.forEach(t => { transfMap[t.ninho_uuid] = (transfMap[t.ninho_uuid] ?? 0) + 1 })
  const eclosMap = {}
  ecls.forEach(e => { eclosMap[e.ninho_uuid] = true })

  // Stats
  const pendentes   = ninhos.filter(n => n.status_sync === 'pendente').length
  const confirmados = ninhos.filter(n => n.status_sync === 'confirmado').length
  document.getElementById('bio-fila-total').textContent      = ninhos.length
  document.getElementById('bio-fila-pendentes').textContent  = pendentes
  document.getElementById('bio-fila-confirmados').textContent = confirmados

  // Ordena: pendentes primeiro, depois por data decrescente
  ninhos.sort((a, b) => {
    const pa = a.status_sync === 'pendente' ? 0 : 1
    const pb = b.status_sync === 'pendente' ? 0 : 1
    if (pa !== pb) return pa - pb
    return (b.criado_em ?? '').localeCompare(a.criado_em ?? '')
  })

  const container = document.getElementById('bio-sync-queue')
  container.innerHTML = ''

  if (!ninhos.length) {
    container.innerHTML = '<p style="text-align:center;color:#9CA3AF;padding:32px 16px">Nenhum ninho registrado localmente.</p>'
    return
  }

  ninhos.forEach(n => {
    const esp      = BIO_ESPECIES.find(e => e.id === n.especie)
    const praia    = praias.find(p => p.id === n.praia_id)
    const syncOk   = n.status_sync === 'confirmado'
    const temEcl   = eclosMap[n.uuid_cliente]
    const nTransf  = transfMap[n.uuid_cliente] ?? 0
    const status   = n.status ?? 'encontrado'

    const ovosHtml = (n.qtd_ovos != null || n.ovos_integros != null || n.ovos_descartados != null) ? `
      <div class="bio-nfc-ovos">
        ${n.qtd_ovos        != null ? `<span>${n.qtd_ovos} ovos</span>` : ''}
        ${n.ovos_integros   != null ? `<span>${n.ovos_integros} íntegros</span>` : ''}
        ${n.ovos_descartados != null ? `<span>${n.ovos_descartados} desc.</span>` : ''}
      </div>` : ''

    const eventosHtml = (nTransf > 0 || temEcl) ? `
      <div class="bio-nfc-eventos">
        ${nTransf > 0 ? `<span class="bio-nfc-ev-chip transf">${nTransf} transf.</span>` : ''}
        ${temEcl       ? `<span class="bio-nfc-ev-chip ecl">eclosão</span>` : ''}
      </div>` : ''

    const card = document.createElement('div')
    card.className = `bio-nfc status-${status}`
    card.innerHTML = `
      <div class="bio-nfc-header">
        <span class="bio-nfc-num">#${n.numero_ninho ?? '—'}</span>
        <span class="bio-nfc-status-badge ${status}">${bioLabels.status[status] ?? status}</span>
        <span class="bio-nfc-sync-dot" title="${syncOk ? 'Enviado' : 'Pendente'}" style="background:${syncOk ? 'var(--bio-verde)' : '#F59E0B'}"></span>
      </div>
      <div class="bio-nfc-especie">${esp ? `<strong>${esp.sigla}</strong> ${esp.nome}` : (n.especie ?? '—')}</div>
      <div class="bio-nfc-row">
        <span class="bio-nfc-praia">${praia?.nome ?? '—'}</span>
        <span class="bio-nfc-data">${new Date(n.data_encontro ?? n.criado_em).toLocaleDateString('pt-BR')}</span>
      </div>
      ${ovosHtml}
      ${eventosHtml}
      ${BioApp.monitor?.nome_completo ? `<div class="bio-nfc-monitor">${BioApp.monitor.nome_completo}</div>` : ''}
    `
    container.appendChild(card)
  })
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
    'bio-kpi-ninhos':            dados.grupo_ninhos,
    'bio-kpi-eclodidos':         dados.eclodidos,
    'bio-kpi-filhotes':          dados.filhotes_vivos,
    'bio-kpi-taxa':              dados.taxa_eclosao_pct != null ? dados.taxa_eclosao_pct + '%' : '—',
    'bio-kpi-ovos-total':        dados.total_ovos_postura ?? '—',
    'bio-kpi-ovos-integros':     dados.total_ovos_integros ?? '—',
    'bio-kpi-ovos-descartados':  dados.total_ovos_descartados ?? '—',
    'bio-kpi-dist-rio':          dados.dist_rio_media_m    != null ? dados.dist_rio_media_m    + ' m'  : '—',
    'bio-kpi-temp-media':        dados.temp_media_c        != null ? dados.temp_media_c        + '°C'  : '—',
    'bio-kpi-umidade-media':     dados.umidade_media_pct   != null ? dados.umidade_media_pct   + '%'   : '—',
    'bio-kpi-prof-media':        dados.profundidade_media_cm != null ? dados.profundidade_media_cm + ' cm' : '—',
  }
  Object.entries(mapa).forEach(([id, val]) => {
    const el = document.getElementById(id)
    if (el && val != null) el.textContent = val
  })
}

/* ════════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════════ */
const BIO_VERSAO = '1.1.0'
const BIO_INSTALL_URL = 'https://siguc-ac.vercel.app/pages/instalar-biomonitor.html'

async function bioQuotaArmazenamento() {
  if (!navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return {
    usado: e.usage ?? 0,
    total: e.quota ?? 0,
    pct: e.quota ? Math.round((e.usage / e.quota) * 100) : 0,
  }
}

function bioFotoQuadrada(blob, tam) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      const lado = Math.min(img.naturalWidth, img.naturalHeight)
      const sx = (img.naturalWidth  - lado) / 2
      const sy = (img.naturalHeight - lado) / 2
      const c = document.createElement('canvas')
      c.width = c.height = tam
      c.getContext('2d').drawImage(img, sx, sy, lado, lado, 0, 0, tam, tam)
      URL.revokeObjectURL(url)
      c.toBlob(b => resolve(b), 'image/jpeg', 0.85)
    }
    img.onerror = reject
    img.src = url
  })
}

async function bioAlterarFotoMonitor() {
  const monitor = BioApp.monitor
  if (!monitor?.id) return
  if (!navigator.onLine) {
    bioToast('Sem conexão — altere a foto quando houver internet', 'warn')
    return
  }
  const blob = await new Promise(res => {
    const inp = document.getElementById('bio-input-foto-perfil')
    inp.value = ''
    inp.onchange = () => res(inp.files[0] || null)
    inp.click()
  })
  if (!blob) return

  bioToast('Enviando foto…', 'info')
  try {
    const quadrada = await bioFotoQuadrada(blob, 512)
    const path = `${monitor.id}/perfil.jpg`
    const { error: upErr } = await bioSupabase().storage.from('biomonitor-fotos')
      .upload(path, quadrada, { upsert: true, contentType: 'image/jpeg' })
    if (upErr) throw upErr

    const { data: { publicUrl } } = bioSupabase().storage.from('biomonitor-fotos').getPublicUrl(path)
    const fotoUrl = `${publicUrl}?t=${Date.now()}`

    const { error: updErr } = await bioSupabase()
      .from('monitores_biodiversidade')
      .update({ foto_url: fotoUrl })
      .eq('id', monitor.id)
    if (updErr) throw updErr

    BioApp.monitor.foto_url = fotoUrl
    await bioOfflineSetConfig('monitor', BioApp.monitor)
    const avatarEl = document.getElementById('bio-config-avatar')
    if (avatarEl) {
      avatarEl.style.backgroundImage = `url(${fotoUrl})`
      avatarEl.textContent = ''
    }
    bioToast('Foto atualizada!', 'ok')
  } catch (e) {
    bioToast('Erro ao enviar foto: ' + (e.message || e), 'err')
  }
}

async function bioVerificarAtualizacao() {
  if (!('serviceWorker' in navigator)) { location.reload(); return }
  bioToast('Verificando atualização…', 'info')
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) { location.reload(); return }
  let achou = false
  reg.addEventListener('updatefound', () => {
    achou = true
    const nw = reg.installing
    if (!nw) return
    nw.addEventListener('statechange', () => {
      if (nw.state === 'installed') {
        bioToast('Atualização encontrada — recarregando…', 'ok')
        setTimeout(() => location.reload(), 900)
      }
    })
  })
  try { await reg.update() } catch (e) { console.warn('[bio-update]', e) }
  setTimeout(() => { if (!achou) bioToast('App já está atualizado', 'ok') }, 2500)
}

function bioAbrirQRInstalacao() {
  const qr = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(BIO_INSTALL_URL)}&size=320x320&format=png&margin=12`
  const img  = document.getElementById('bio-qr-img')
  const link = document.getElementById('bio-qr-link')
  const ov   = document.getElementById('bio-qr-overlay')
  if (img)  img.src = qr
  if (link) link.textContent = BIO_INSTALL_URL
  if (ov)   ov.hidden = false
}

async function bioSincronizarPraias() {
  if (!navigator.onLine) { bioToast('Sem conexão.', 'err'); return }
  bioToast('Sincronizando praias…', 'info')
  try {
    await bioSyncCachePraias(BioApp.monitor?.grupo_id)
    await bioCarregarPraiasHome()
    bioToast('Praias atualizadas!', 'ok')
  } catch (e) {
    bioToast('Erro ao sincronizar praias.', 'err')
  }
}

async function bioCarregarConfig() {
  // Quota
  const quota = await bioQuotaArmazenamento()
  if (quota) {
    const fill = document.getElementById('bio-quota-fill')
    const txt  = document.getElementById('bio-quota-txt')
    if (fill) fill.style.width = quota.pct + '%'
    if (txt) {
      const usadoMb = (quota.usado / 1024 / 1024).toFixed(1)
      const totalMb = (quota.total / 1024 / 1024).toFixed(0)
      txt.textContent = `${usadoMb} MB / ${totalMb} MB`
    }
  }

  // Modo Campo — restaura estado salvo
  const campoCk = document.getElementById('bio-toggle-campo')
  if (campoCk) campoCk.checked = document.body.classList.contains('field-mode')
}

function bioIniciarConfig() {
  document.getElementById('bio-config-avatar-btn')?.addEventListener('click', bioAlterarFotoMonitor)
  document.getElementById('bio-input-foto-perfil')?.addEventListener('change', () => {})

  document.getElementById('bio-toggle-campo')?.addEventListener('change', async ev => {
    document.body.classList.toggle('field-mode', ev.target.checked)
    await bioOfflineSetConfig('campo_field_mode', ev.target.checked)
  })

  document.getElementById('bio-btn-alterar-pin')?.addEventListener('click', async () => {
    bioMostrarTela('tela-config-pin')
    bioIniciarTelaConfigPin()
  })
  document.getElementById('bio-btn-sincronizar-praias')?.addEventListener('click', bioSincronizarPraias)
  document.getElementById('bio-btn-qr-instalar')?.addEventListener('click', bioAbrirQRInstalacao)
  document.getElementById('bio-btn-verificar-update')?.addEventListener('click', bioVerificarAtualizacao)
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
  document.getElementById('bio-qr-fechar')?.addEventListener('click', () => {
    document.getElementById('bio-qr-overlay').hidden = true
  })
  document.getElementById('bio-qr-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true
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
    // Auto-numeração: preenche número ao selecionar espécie (só se campo vazio)
    chip.addEventListener('click', async () => {
      const campo = document.getElementById('bio-form-numero')
      if (!campo || campo.value.trim()) return
      const esp     = chip.dataset.esp
      const praiaId = BioApp.praiaAtual?.id
      if (!esp || !praiaId) return
      try {
        campo.value = await bioGerarNumeroNinho(praiaId, esp)
      } catch (_) {}
    })
  })

  // Filtros de status na aba Abertos
  document.querySelectorAll('.bio-sfil-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bio-sfil-btn').forEach(b => b.classList.remove('ativa'))
      btn.classList.add('ativa')
      BioApp.abertosStatusFiltro = btn.dataset.sfil || null
      bioCarregarAbertos()
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

  // Sheet overlay fecha ao clicar fora (limpa busca)
  document.getElementById('bio-sheet-praias')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) {
      e.currentTarget.hidden = true
      const busca = document.getElementById('bio-sheet-praias-busca')
      if (busca) busca.value = ''
    }
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

  // Versão e créditos dinâmicos
  const versaoEl = document.getElementById('bio-app-versao')
  if (versaoEl) versaoEl.textContent = `Biomonitor Quelônios v${BIO_VERSAO}`
  const copyEl = document.getElementById('bio-app-copyright')
  if (copyEl) copyEl.innerHTML = 'SIGUC-AC — Desenvolvido por <strong>Erisson Cameli Santiago</strong>'

  // Restaura Modo Campo salvo
  const campoBool = await bioOfflineGetConfig('campo_field_mode')
  if (campoBool) document.body.classList.add('field-mode')

  // Entrar
  try {
    await bioIniciar()
  } catch (err) {
    console.error('[biomonitor] erro na inicialização:', err)
    bioMostrarTela('tela-login')
    bioIniciarTelaLogin()
    const erroEl = document.getElementById('bio-login-erro')
    if (erroEl) { erroEl.textContent = 'Erro ao iniciar o app. Recarregue a página.'; erroEl.hidden = false }
  }
})
