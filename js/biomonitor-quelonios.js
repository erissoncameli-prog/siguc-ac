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

function _bioRingContains(ring, x, y) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

// Returns true (dentro), false (fora) ou null (sem polígono)
function bioPointInPolygon(lat, lng, geom) {
  if (!geom) return null
  try {
    const g = typeof geom === 'string' ? JSON.parse(geom) : geom
    if (g.type === 'Polygon') return _bioRingContains(g.coordinates[0], lng, lat)
    if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) { if (_bioRingContains(poly[0], lng, lat)) return true }
      return false
    }
  } catch { /* geom inválida */ }
  return null
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
  formNinho:        null,
  formTipo:         null,   // 'ninho' | 'transferencia' | 'eclosao'
  formNinhoAtualizar: null, // ninho sendo atualizado
  formGpsCapturado: null,   // {lat, lng, precisao_m} da média; null = usa leitura em tempo real
  // Filtros de aba
  abertosStatusFiltro: null,      // null = todos; 'encontrado'|'transferido'|'eclodido'|'perdido'
  abertosFiltroPraia: undefined,  // undefined = usar praiaAtual; null = todas
  filaFiltroPraia:    undefined,  // undefined = todas; null = todas (explícito)
  // GPS proximidade
  _praiaProxima:      null,       // praia dentro de BIO_PROX_RAIO_M
  _sheetPraiaOnSelect: null,      // callback temporário do sheet de praias
  // Configurações de GPS (carregadas do IndexedDB na init)
  cfgFormatoCoords: 'decimal',    // 'decimal' | 'dms'
  cfgGpsModo:       'padrao',     // 'padrao' | 'alta' | 'maxima'
  formBercarioSelecionado: null,  // { id, nome, capacidade_max } selecionado no picker
  loteAtual: null,                // lote em detalhe/ocorrência
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
  { id: 'outro',     sigla: 'OUT', nome: 'Outro / Não sei',    nome_cientifico: '' },
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

  // Oculta nav e faixa em telas de autenticação
  const lockTelas = ['tela-login', 'tela-trocar-senha', 'tela-config-pin', 'tela-bloqueio']
  const nav   = document.getElementById('bio-pill-nav')
  const faixa = document.getElementById('bio-faixa-global')
  if (nav)   nav.hidden   = lockTelas.includes(id)
  if (faixa) {
    faixa.hidden = lockTelas.includes(id)
    const mascote = faixa.querySelector('.bio-faixa-mascote')
    if (mascote) mascote.hidden = id !== 'tela-home'
  }
}

/* ════════════════════════════════════════════════════════════
   AUTH — LOGIN / PIN
   ════════════════════════════════════════════════════════════ */
// ── Logos institucionais na lock screen ───────────────────────
function renderBioLogos(c) {
  const aplicar = (sel, dado) => {
    if (!dado) return
    document.querySelectorAll(sel).forEach(chip => {
      chip.querySelector('img').src = dado
      chip.hidden = false
    })
  }
  aplicar('.bio-faixa-logo-chip.gov', c?.gov)
  aplicar('.bio-faixa-logo-chip.sec', c?.sec)
}

async function bioBuscarLogos() {
  try {
    const cache = await bioOfflineGetConfig('bio_logos_cache_v1')
    if (cache) renderBioLogos(cache)

    if (!navigator.onLine) return
    const { data } = await bioSupabase().from('config_sistema').select('dados').eq('id', 1).single()
    const logos = data?.dados?.logos
    if (!logos) return

    const baixar = async url => {
      if (!url) return null
      try { const r = await fetch(url); return r.ok ? await r.blob() : null } catch { return null }
    }
    const blobParaBase64 = blob => new Promise((res, rej) => {
      const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob)
    })
    const logoParaBranco = async blob => {
      const img = new Image()
      const bUrl = URL.createObjectURL(blob)
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = bUrl })
      const cv = document.createElement('canvas')
      cv.width = img.naturalWidth; cv.height = img.naturalHeight
      const ctx = cv.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, cv.width, cv.height)
      const p = d.data
      for (let i = 0; i < p.length; i += 4) {
        const lum = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) / 255
        const tinta = (1 - lum) * (p[i + 3] / 255)
        p[i] = p[i + 1] = p[i + 2] = 255
        p[i + 3] = Math.round(255 * Math.min(1, tinta * 1.25))
      }
      ctx.putImageData(d, 0, 0)
      URL.revokeObjectURL(bUrl)
      return new Promise(res => cv.toBlob(b => res(b), 'image/png'))
    }
    const preparar = async (urlBranca, urlColorida) => {
      const oficial = await baixar(urlBranca)
      if (oficial) return blobParaBase64(oficial)
      const colorida = await baixar(urlColorida)
      if (!colorida) return null
      return blobParaBase64(await logoParaBranco(colorida))
    }
    const novo = {
      gov: await preparar(logos.governo_branca_url,    logos.governo_url),
      sec: await preparar(logos.secretaria_branca_url, logos.secretaria_url),
    }
    if (novo.gov || novo.sec) {
      await bioOfflineSetConfig('bio_logos_cache_v1', novo)
      renderBioLogos(novo)
    }
  } catch (e) { console.warn('[bio-logos]', e) }
}

async function bioIniciar() {
  await bioOfflinePersistir()

  // Aguarda o cliente Supabase isolado ser criado (depende de /api/env)
  if (typeof _bioReady !== 'undefined') await _bioReady

  bioBuscarLogos()  // best-effort, não bloqueia o fluxo de login

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
  await bioAtualizarCardCorrecao()

  // Sync automático
  bioSyncTudo({
    monitorId:   monitor.id,
    onConcluido: () => { bioAtualizarBadgeFila(); bioAtualizarCardCorrecao() },
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
  // Atualiza o cache de praias e berçários (aguarda se online para garantir dados na 1ª abertura)
  if (navigator.onLine) {
    await Promise.all([
      bioSyncCachePraias(BioApp.monitor?.grupo_id).catch(() => {}),
      bioSyncCacheBercarios().catch(() => {}),
      (typeof bioSyncCacheParametros === 'function' ? bioSyncCacheParametros() : Promise.resolve()).catch(() => {}),
      (typeof bioSyncCacheTemporada === 'function' ? bioSyncCacheTemporada(BioApp.monitor?.grupo_id) : Promise.resolve()).catch(() => {}),
    ])
  } else {
    bioSyncCachePraias(BioApp.monitor?.grupo_id).catch(() => {})
    bioSyncCacheBercarios().catch(() => {})
  }

  // Temporada atual (cacheada) → usada na numeração e exibida na home
  BioApp.temporadaAtual = await bioOfflineGetConfig('temporada_atual')
  BioApp.temporadaMetas = (await bioOfflineGetConfig('temporada_praias_meta')) || {}
  bioRenderTemporadaChip()

  const praias = await bioOfflineListarPraias()
  if (!praias.length) return

  // Se já tem praia salva, restaura; senão usa a primeira da lista
  const praiaId = await bioOfflineGetConfig('praia_selecionada')
  const praia   = praias.find(p => p.id === praiaId) ?? praias[0]
  bioSelecionarPraia(praia)
}

function bioRenderTemporadaChip() {
  const chip = document.getElementById('bio-temporada-chip')
  if (!chip) return
  const t = BioApp.temporadaAtual
  if (t && (t.nome || t.ano_base)) {
    chip.textContent = t.ano_base ? `Temporada ${t.ano_base}` : t.nome
    chip.hidden = false
  } else {
    chip.hidden = true
  }
}

function bioSelecionarPraia(praia) {
  BioApp.praiaAtual = praia
  bioOfflineSetConfig('praia_selecionada', praia.id)
  document.getElementById('bio-praia-nome').textContent    = praia.nome
  document.getElementById('bio-praia-cod').textContent     = praia.codigo
  document.getElementById('bio-praia-detalhe').textContent = [praia.comunidade, praia.municipio].filter(Boolean).join(' — ')
  bioRenderPraiaMeta(praia)
}

// Ninho pertence à temporada t? (por temporada_id; fallback por data)
function bioNinhoNaTemporada(n, t) {
  if (!t) return true
  if (n.temporada_id && t.id) return n.temporada_id === t.id
  const d = n.data_encontro
  if (!d || !t.data_inicio || !t.data_fim) return true
  return d >= t.data_inicio && d <= t.data_fim
}

// Progresso "X/Y ninhos nesta temporada" no seletor de praia (offline)
async function bioRenderPraiaMeta(praia) {
  const el = document.getElementById('bio-praia-meta')
  if (!el) return
  if (!praia) { el.hidden = true; return }
  const t = BioApp.temporadaAtual
  let count = 0
  try {
    const ninhos = await bioOfflineListarNinhos()
    count = ninhos.filter(n => n.praia_id === praia.id && bioNinhoNaTemporada(n, t)).length
  } catch (_) {}
  const meta = BioApp.temporadaMetas?.[praia.id]
  if (meta != null && meta > 0) {
    const pct = Math.min(100, Math.round(100 * count / meta))
    el.classList.toggle('atingida', count >= meta)
    el.innerHTML = `<span>${count}/${meta} ninhos nesta temporada${count >= meta ? ' ✓' : ''}</span>` +
      `<div class="bio-praia-meta-bar"><div style="width:${pct}%"></div></div>`
  } else {
    el.classList.remove('atingida')
    el.innerHTML = `<span>${count} ninho${count === 1 ? '' : 's'} nesta temporada</span>`
  }
  el.hidden = false
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
  document.getElementById('bio-correcao-card')?.addEventListener('click', bioAbrirCorrecoes)
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

/* ════════════════════════════════════════════════════════════
   GPS — FORMATAÇÃO E PRECISÃO
   ════════════════════════════════════════════════════════════ */

function _bioDDtoDMS(dd, isLat) {
  const abs  = Math.abs(dd)
  const grau = Math.floor(abs)
  const minF = (abs - grau) * 60
  const min  = Math.floor(minF)
  const seg  = (minF - min) * 60
  const dir  = isLat ? (dd >= 0 ? 'N' : 'S') : (dd >= 0 ? 'L' : 'O')
  return `${grau}° ${min}' ${seg.toFixed(2)}" ${dir}`
}

function bioFormatarCoords(lat, lng) {
  if (lat == null || lng == null) return 'Aguardando GPS…'
  if (BioApp.cfgFormatoCoords === 'dms') {
    return `${_bioDDtoDMS(lat, true)}  ${_bioDDtoDMS(lng, false)}`
  }
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

function _bioMediana(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function _bioDesvioPadrao(arr) {
  const med = arr.reduce((s, v) => s + v, 0) / arr.length
  return Math.sqrt(arr.reduce((s, v) => s + (v - med) ** 2, 0) / arr.length)
}

// Coleta N leituras GPS com intervalo fixo, filtra outliers e retorna a média.
// onProgresso(atual, total) é chamado a cada leitura coletada.
function bioCapturarPosicaoMedia(nLeituras, intervaloMs, onProgresso) {
  return new Promise((resolve, reject) => {
    const leituras = []

    function proxima() {
      navigator.geolocation.getCurrentPosition(
        pos => {
          leituras.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy })
          onProgresso?.(leituras.length, nLeituras)
          if (leituras.length >= nLeituras) {
            const lats = leituras.map(l => l.lat)
            const lngs = leituras.map(l => l.lng)
            const medLat = _bioMediana(lats)
            const medLng = _bioMediana(lngs)
            const stdLat = _bioDesvioPadrao(lats) || 9999
            const stdLng = _bioDesvioPadrao(lngs) || 9999
            const filtradas = leituras.filter(l =>
              Math.abs(l.lat - medLat) <= 2 * stdLat &&
              Math.abs(l.lng - medLng) <= 2 * stdLng
            )
            const base = filtradas.length >= 2 ? filtradas : leituras
            resolve({
              lat:        base.reduce((s, l) => s + l.lat, 0) / base.length,
              lng:        base.reduce((s, l) => s + l.lng, 0) / base.length,
              precisao_m: Math.min(...base.map(l => l.acc)),
            })
          } else {
            setTimeout(proxima, intervaloMs)
          }
        },
        err => reject(err),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      )
    }
    proxima()
  })
}

function _bioIniciarCapturaGps(n, intervaloMs) {
  const coordsEl    = document.getElementById('bio-form-gps-coords')
  const progressoEl = document.getElementById('bio-form-gps-progresso')
  const barraEl     = document.getElementById('bio-form-gps-barra')
  const barraFill   = document.getElementById('bio-form-gps-barra-fill')

  if (coordsEl)    coordsEl.style.display    = 'none'
  if (progressoEl) { progressoEl.style.display = ''; progressoEl.textContent = `Coletando 0/${n}…` }
  if (barraEl)     { barraEl.style.display = ''; if (barraFill) barraFill.style.width = '0%' }

  bioCapturarPosicaoMedia(n, intervaloMs, (atual, total) => {
    if (progressoEl) progressoEl.textContent  = `Coletando ${atual}/${total}…`
    if (barraFill)   barraFill.style.width     = `${(atual / total) * 100}%`
  })
  .then(({ lat, lng, precisao_m }) => {
    BioApp.formGpsCapturado = { lat, lng, precisao_m }
    if (progressoEl) progressoEl.style.display = 'none'
    if (barraEl)     barraEl.style.display     = 'none'
    if (coordsEl) {
      coordsEl.style.display = ''
      coordsEl.textContent   = `${bioFormatarCoords(lat, lng)}  ±${Math.round(precisao_m)}m`
    }
    bioVerificarPerimetroNinho()
  })
  .catch(() => {
    if (progressoEl) progressoEl.style.display = 'none'
    if (barraEl)     barraEl.style.display     = 'none'
    if (coordsEl)    coordsEl.style.display    = ''
    bioToast('Não foi possível coletar média GPS. Usando leitura atual.', 'warn')
  })
}

function bioIniciarGPS() {
  if (!navigator.geolocation) return
  navigator.geolocation.watchPosition(
    pos => {
      BioApp.gpsLat      = pos.coords.latitude
      BioApp.gpsLng      = pos.coords.longitude
      BioApp.gpsPrecisao = pos.coords.accuracy
      const coordsEl    = document.getElementById('bio-gps-coords')
      const accEl       = document.getElementById('bio-gps-acc')
      const solCoordsEl = document.getElementById('bio-sol-gps-coords')
      const formatted   = bioFormatarCoords(BioApp.gpsLat, BioApp.gpsLng)
      if (coordsEl)    coordsEl.textContent    = formatted
      if (accEl)       accEl.textContent       = `±${Math.round(pos.coords.accuracy)}m`
      if (solCoordsEl) solCoordsEl.textContent = formatted
      bioVerificarPraiaProxima(pos.coords.latitude, pos.coords.longitude)
      clearTimeout(_bioPerimTimer)
      _bioPerimTimer = setTimeout(bioVerificarPerimetroNinho, 5000)
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  )
}

let _bioPerimTimer = null
async function bioVerificarPerimetroNinho() {
  const aviso = document.getElementById('bio-form-perimetro-aviso')
  if (!aviso) return
  const praiaId = BioApp.formNinho?.praia_id
  if (!praiaId) { aviso.hidden = true; return }
  const lat = BioApp.formGpsCapturado?.lat ?? BioApp.gpsLat
  const lng = BioApp.formGpsCapturado?.lng ?? BioApp.gpsLng
  if (lat == null || lng == null) { aviso.hidden = true; return }
  const praias = await bioOfflineListarPraias()
  const praia  = praias.find(p => p.id === praiaId)
  if (!praia?.area_geojson) { aviso.hidden = true; return }
  aviso.hidden = bioPointInPolygon(lat, lng, praia.area_geojson) !== false
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
// campo = 'numero_ninho' (placa de origem, na criação) | 'numero_atual'
// (placa na praia de destino, na transferência). A sigla da praia já
// fica embutida no prefixo, então varrer por prefixo equivale a varrer
// só aquela praia.
async function bioGerarNumeroNinho(praiaId, especie, campo = 'numero_ninho') {
  const esp    = BIO_ESPECIES.find(e => e.id === especie)
  const praias = await bioOfflineListarPraias()
  const praia  = praias.find(p => p.id === praiaId)
  const cod    = praia?.sigla ?? 'XX'
  const sig    = esp?.sigla   ?? '?'
  // Numeração reinicia por temporada: inclui o ano-base da temporada atual
  const ano    = BioApp.temporadaAtual?.ano_base ?? new Date().getFullYear()
  const prefix = `${cod}-${sig}-${ano}-`

  let maxSeq = 0
  const todos = await bioOfflineListarNinhos({})
  todos.forEach(n => {
    const val = campo === 'numero_atual' ? (n.numero_atual ?? n.numero_ninho) : n.numero_ninho
    if (val?.startsWith(prefix)) {
      const seq = parseInt(val.slice(prefix.length)) || 0
      if (seq > maxSeq) maxSeq = seq
    }
  })

  if (navigator.onLine && window._bioDB_client) {
    try {
      const { data } = await bioSupabase()
        .from('ninhos_quelonios')
        .select(campo)
        .like(campo, `${prefix}%`)
      ;(data ?? []).forEach(n => {
        const seq = parseInt(n[campo]?.slice(prefix.length)) || 0
        if (seq > maxSeq) maxSeq = seq
      })
    } catch (_) {}
  }

  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}

/* ════════════════════════════════════════════════════════════
   FORMULÁRIO — NINHO (Encontro)
   ════════════════════════════════════════════════════════════ */
window.bioTrocarPraiaNoForm = function() {
  bioAbrirSheetPraias(praia => {
    BioApp.formNinho.praia_id = praia.id
    document.getElementById('bio-form-praia-label').textContent = praia.nome
    bioVerificarPerimetroNinho()
    bioAtualizarNumeroNinhoAuto()
  })
}

// (Re)gera o número do ninho automaticamente (praia + espécie + temporada),
// exceto quando o usuário optou por editar manualmente.
async function bioAtualizarNumeroNinhoAuto() {
  if (BioApp.numeroManual) return
  const campo = document.getElementById('bio-form-numero')
  if (!campo) return
  const esp     = document.querySelector('.bio-especie-chip.sel')?.dataset.esp
  const praiaId = BioApp.formNinho?.praia_id ?? BioApp.praiaAtual?.id
  if (!esp || !praiaId) return
  try { campo.value = await bioGerarNumeroNinho(praiaId, esp) } catch (_) {}
}

function bioAbrirFormNinho() {
  BioApp.editandoNinho = null
  document.getElementById('bio-form-ninho-titulo').textContent = 'Novo Ninho'
  document.getElementById('bio-btn-salvar-ninho').textContent  = 'Salvar Ninho'
  const cbox = document.getElementById('bio-form-correcao-box')
  if (cbox) cbox.hidden = true
  const praia = BioApp.praiaAtual
  document.getElementById('bio-form-praia-label').textContent = praia?.nome ?? '—'
  document.getElementById('bio-form-data').value = new Date().toISOString().slice(0, 10)
  document.getElementById('bio-form-hora-desova').value = ''
  // Número do ninho em modo automático (gerado ao escolher a espécie)
  BioApp.numeroManual = false
  const _numEl = document.getElementById('bio-form-numero')
  _numEl.value = ''
  _numEl.readOnly = true
  _numEl.placeholder = 'Escolha a espécie…'
  document.getElementById('bio-form-obs').value   = ''
  document.getElementById('bio-form-foto-count').textContent = '(0/3)'

  // Limpa seleção de espécie
  document.querySelectorAll('.bio-especie-chip').forEach(c => c.classList.remove('sel'))

  // Limpa campos de ovos
  document.getElementById('bio-form-qtd-ovos').value        = ''
  document.getElementById('bio-form-ovos-integros').value   = ''
  document.getElementById('bio-form-ovos-descartados').value = ''
  document.getElementById('bio-form-desc-natural').value    = ''
  document.getElementById('bio-form-desc-predacao').value   = ''
  document.getElementById('bio-form-desc-humana').value     = ''
  bioAtualizarDescarteBox()

  // Limpa condições do ninho
  document.getElementById('bio-form-temperatura').value   = ''
  document.getElementById('bio-form-umidade').value       = ''
  document.getElementById('bio-form-profundidade').value  = ''
  const _alNinho = document.getElementById('bio-form-alertas')
  if (_alNinho) _alNinho.innerHTML = ''

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
  BioApp.formGpsCapturado = null

  bioMostrarTela('tela-form-ninho')
  bioVerificarPerimetroNinho()

  const modo = BioApp.cfgGpsModo ?? 'padrao'
  if (modo === 'alta')   _bioIniciarCapturaGps(5,  3000)
  if (modo === 'maxima') _bioIniciarCapturaGps(10, 4000)
}

// Abre o formulário de ninho em modo CORREÇÃO: pré-preenche os dados do
// ninho que o gestor devolveu (status_validacao = em_correcao) para o
// monitor ajustar e reenviar. Ao salvar volta para 'pendente'.
function bioAbrirCorrecaoNinho(ninho) {
  BioApp.editandoNinho = ninho
  document.getElementById('bio-form-ninho-titulo').textContent = 'Corrigir Ninho'
  document.getElementById('bio-btn-salvar-ninho').textContent  = 'Reenviar correção'

  const cbox = document.getElementById('bio-form-correcao-box')
  const cmsg = document.getElementById('bio-form-correcao-motivo')
  if (cbox) cbox.hidden = false
  if (cmsg) cmsg.textContent = ninho.motivo_rejeicao || 'Sem motivo informado.'

  document.getElementById('bio-form-praia-label').textContent = ninho.praia_nome ?? '—'
  document.getElementById('bio-form-data').value         = ninho.data_encontro ?? ''
  document.getElementById('bio-form-hora-desova').value  = ninho.hora_desova ?? ''
  // Edição/correção: mantém o número já atribuído (não regenerar)
  BioApp.numeroManual = true
  const _numEdit = document.getElementById('bio-form-numero')
  _numEdit.value    = ninho.numero_ninho ?? ''
  _numEdit.readOnly = true
  document.getElementById('bio-form-obs').value          = ninho.observacoes ?? ''

  // Espécie
  document.querySelectorAll('.bio-especie-chip').forEach(c =>
    c.classList.toggle('sel', c.dataset.esp === ninho.especie))

  // Ovos
  document.getElementById('bio-form-qtd-ovos').value        = ninho.qtd_ovos        ?? ''
  document.getElementById('bio-form-ovos-integros').value   = ninho.ovos_integros   ?? ''
  document.getElementById('bio-form-ovos-descartados').value = ninho.ovos_descartados ?? ''
  // Quebra do descarte por causa (vem da view)
  document.getElementById('bio-form-desc-natural').value  = ninho.descartados_natural  || ''
  document.getElementById('bio-form-desc-predacao').value = ninho.descartados_predacao || ''
  document.getElementById('bio-form-desc-humana').value   = ninho.descartados_humana   || ''
  bioAtualizarDescarteBox()

  // Condições
  document.getElementById('bio-form-temperatura').value   = ninho.temperatura_c   ?? ''
  document.getElementById('bio-form-umidade').value       = ninho.umidade_pct      ?? ''
  document.getElementById('bio-form-profundidade').value  = ninho.profundidade_cm  ?? ''

  // Distância ao rio
  document.getElementById('bio-form-dist-rio').value = ninho.dist_rio_m ?? ''
  BioApp.distRioMetodo = ninho.dist_rio_metodo ?? 'tracker'
  BioApp.distRioLatRio = null
  BioApp.distRioLngRio = null
  document.querySelectorAll('.bio-dist-chip').forEach(c =>
    c.classList.toggle('ativo', c.dataset.metodo === BioApp.distRioMetodo))
  document.getElementById('bio-dist-medir-gps').style.display = ''
  document.getElementById('bio-btn-marcar-rio-txt').textContent = 'Marcar ponto do Rio'

  // Estado do form preservando identidade do ninho
  BioApp.formNinho = {
    uuid_cliente:  ninho.uuid_cliente,
    server_id:     ninho.server_id ?? ninho.id ?? null,
    praia_id:      ninho.praia_id ?? null,
    praia_atual_id: ninho.praia_atual_id ?? null,
    numero_atual:  ninho.numero_atual ?? null,
    uc_id:         ninho.uc_id ?? BioApp.monitor?.uc_id ?? null,
    grupo_id:      ninho.grupo_id ?? BioApp.monitor?.grupo_id ?? null,
    status:        ninho.status ?? 'encontrado',
    foto_urls:     Array.isArray(ninho.foto_urls) ? [...ninho.foto_urls] : [],
    criado_em:     ninho.criado_em ?? new Date().toISOString(),
  }
  // GPS já capturado do ninho
  BioApp.formGpsCapturado = (ninho.lat != null && ninho.lng != null)
    ? { lat: ninho.lat, lng: ninho.lng, precisao_m: ninho.precisao_gps_m ?? null }
    : null
  document.getElementById('bio-form-gps-coords').textContent =
    bioFormatarCoords(ninho.lat, ninho.lng)

  // Atualiza miniatura de fotos
  document.getElementById('bio-form-foto-count').textContent =
    `(${BioApp.formNinho.foto_urls.length}/3)`

  bioMostrarTela('tela-form-ninho')
  if (typeof bioIniciarFotosForm === 'function') {
    const grid = document.getElementById('bio-form-foto-grid')
    if (grid) {
      grid.innerHTML = ''
      BioApp.formNinho.foto_urls.forEach(url => {
        const img = document.createElement('img'); img.src = url; grid.appendChild(img)
      })
    }
  }
  bioVerificarPerimetroNinho()
}

function bioAtualizarGpsForm() {
  const el = document.getElementById('bio-form-gps-coords')
  if (!el || el.style.display === 'none') return  // durante captura de média, não sobrescreve
  el.textContent = bioFormatarCoords(BioApp.gpsLat, BioApp.gpsLng)
}

// Mostra/oculta a quebra do descarte por causa e valida a soma.
function bioAtualizarDescarteBox() {
  const box   = document.getElementById('bio-form-descarte-box')
  const aviso = document.getElementById('bio-form-descarte-aviso')
  if (!box) return
  const total = parseInt(document.getElementById('bio-form-ovos-descartados').value) || 0
  if (total <= 0) { box.hidden = true; if (aviso) aviso.hidden = true; return }
  box.hidden = false
  document.getElementById('bio-form-descarte-total').textContent = total
  const soma = ['bio-form-desc-natural', 'bio-form-desc-predacao', 'bio-form-desc-humana']
    .reduce((s, id) => s + (parseInt(document.getElementById(id).value) || 0), 0)
  if (aviso) {
    if (soma !== total) {
      aviso.textContent = `A soma das causas (${soma}) deve ser igual a ${total}.`
      aviso.hidden = false
    } else {
      aviso.hidden = true
    }
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

  // Alertas científicos: confirmação consciente se houver faixa crítica
  let _alertaCampoNinho = null
  if (typeof bioAvaliarQuelonio === 'function') {
    const _al = bioAvaliarQuelonio(bioAlertaContextoNinho())
    if (!bioConfirmarCriticos(_al)) return
    _alertaCampoNinho = bioAlertaSnapshot(_al)
  }

  // Descarte de ovos: se houver descartados, a quebra por causa é
  // obrigatória e a soma tem que bater com o total.
  const descTotal = parseInt(document.getElementById('bio-form-ovos-descartados').value) || 0
  const descNat   = parseInt(document.getElementById('bio-form-desc-natural').value)  || 0
  const descPred  = parseInt(document.getElementById('bio-form-desc-predacao').value) || 0
  const descHum   = parseInt(document.getElementById('bio-form-desc-humana').value)   || 0
  if (descTotal > 0 && (descNat + descPred + descHum) !== descTotal) {
    bioToast(`Informe o motivo dos descartes: a soma das causas (${descNat + descPred + descHum}) deve ser igual a ${descTotal}.`, 'err')
    return
  }

  const parseNum  = id => { const v = parseInt(document.getElementById(id).value);   return isNaN(v) ? null : v }
  const parseNum2 = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v }
  const distVal   = parseFloat(document.getElementById('bio-form-dist-rio').value)

  const editando = BioApp.editandoNinho

  // Avisa se não há GPS — não bloqueia, mas exige confirmação consciente
  const _temGPS = (BioApp.formGpsCapturado?.lat ?? BioApp.gpsLat) != null
  if (!_temGPS && !editando) {
    if (!confirm(
      'GPS não disponível\n\n' +
      'Este ninho será salvo SEM localização no mapa.\n\n' +
      'Aguarde o sinal GPS travar e tente novamente, ou toque em OK para continuar sem GPS.'
    )) return
  }

  const ninho = {
    ...BioApp.formNinho,
    numero_ninho:     numero,
    especie,
    data_encontro:    data,
    hora_desova:      document.getElementById('bio-form-hora-desova').value || null,
    observacoes:      obs || null,
    lat:              BioApp.formGpsCapturado?.lat       ?? BioApp.gpsLat,
    lng:              BioApp.formGpsCapturado?.lng       ?? BioApp.gpsLng,
    precisao_gps_m:   BioApp.formGpsCapturado?.precisao_m ?? BioApp.gpsPrecisao,
    // No reenvio de correção preserva o status do ciclo (encontrado/
    // transferido) e devolve a validação para 'pendente', limpando o motivo.
    status:           editando ? (BioApp.formNinho.status ?? 'encontrado') : 'encontrado',
    status_validacao: 'pendente',
    motivo_rejeicao:  null,
    reenvio_correcao: editando ? true : (BioApp.formNinho.reenvio_correcao ?? false),
    status_sync:      'pendente',
    descartes_dirty:  true,   // sinaliza o sync a reconciliar os eventos de descarte
    qtd_ovos:         parseNum('bio-form-qtd-ovos'),
    ovos_integros:    parseNum('bio-form-ovos-integros'),
    ovos_descartados: parseNum('bio-form-ovos-descartados'),
    dist_rio_m:       isNaN(distVal) ? null : distVal,
    dist_rio_metodo:  document.getElementById('bio-form-dist-rio').value ? (BioApp.distRioMetodo ?? 'estimativa') : null,
    temperatura_c:    parseNum2('bio-form-temperatura'),
    umidade_pct:      parseNum2('bio-form-umidade'),
    profundidade_cm:  parseNum2('bio-form-profundidade'),
    alerta_campo:     _alertaCampoNinho,
    // Carimba a temporada atual (preserva a existente em edição)
    temporada_id:     BioApp.formNinho?.temporada_id ?? BioApp.temporadaAtual?.id ?? null,
  }

  await bioOfflineSalvarNinho(ninho)

  // Regrava os eventos de descarte (etapa registro): apaga os antigos e
  // recria pelos valores atuais. O sync reconcilia no servidor.
  await bioOfflineRemoverDescartesDoNinho(ninho.uuid_cliente, 'registro')
  for (const [motivo, qtd] of [['natural', descNat], ['predacao', descPred], ['humana', descHum]]) {
    if (qtd > 0) {
      await bioOfflineSalvarDescarte({
        uuid_cliente:  bioUuid(),
        ninho_uuid:    ninho.uuid_cliente,
        qtd, motivo,
        etapa:         'registro',
        data_descarte: data,
        status_sync:   'pendente',
        criado_em:     new Date().toISOString(),
      })
    }
  }

  await bioAtualizarBadgeFila()
  await bioAtualizarCardCorrecao()

  // Tenta sync imediato
  bioSyncTudo({
    monitorId:   BioApp.monitor?.id,
    onConcluido: () => { bioAtualizarBadgeFila(); bioAtualizarCardCorrecao() },
  })

  bioToast(editando ? 'Correção reenviada!' : 'Ninho registrado!', 'ok')
  BioApp.editandoNinho = null
  bioMostrarTela('tela-home')
  bioRenderPraiaMeta(BioApp.praiaAtual)
}

// ── Captura de fotos com marca d'água (genérico) ──────────────
// cfg: { prefixo, max, getState, setFotos }
// Wires up câmera button + file input + grid de preview para qualquer form.
// Se brigada-captura.js estiver carregado, aplica watermark automaticamente.
function bioIniciarFotosGenerica({ prefixo, max, getState, setFotos }) {
  const grid    = document.getElementById(`bio-${prefixo}-foto-grid`)
  const btnCam  = document.getElementById(`bio-${prefixo}-btn-camera`)
  const inp     = document.getElementById(`bio-${prefixo}-input-foto`)
  const countEl = document.getElementById(`bio-${prefixo}-foto-count`)
  if (!grid || !btnCam || !inp || !countEl) return null

  function atualizarGrid() {
    const fotos = getState() ?? []
    countEl.textContent = `(${fotos.length}/${max})`
    grid.innerHTML = ''
    fotos.forEach((url, i) => {
      const img = document.createElement('img')
      img.src = url
      img.addEventListener('click', () => {
        if (confirm('Remover esta foto?')) {
          const f = getState()
          f.splice(i, 1)
          setFotos(f)
          atualizarGrid()
        }
      })
      grid.appendChild(img)
    })
  }

  btnCam.addEventListener('click', () => inp.click())
  inp.addEventListener('change', async () => {
    const fotos = getState() ?? []
    const monitor = BioApp.monitor
    const gps = typeof bGpsAtual === 'function' ? bGpsAtual() : null
    for (const file of Array.from(inp.files ?? [])) {
      if (fotos.length >= max) break
      let dataUrl
      if (typeof bCapturaProcessarArquivo === 'function') {
        try {
          const blob = await bCapturaProcessarArquivo(
            file,
            { nome: monitor?.nome_completo ?? 'Monitor' },
            gps,
            { brigada: monitor?.grupo_nome ?? null }
          )
          dataUrl = await new Promise(res => {
            const r = new FileReader()
            r.onload = e => res(e.target.result)
            r.readAsDataURL(blob)
          })
        } catch {
          dataUrl = await new Promise(res => {
            const r = new FileReader()
            r.onload = e => res(e.target.result)
            r.readAsDataURL(file)
          })
        }
      } else {
        dataUrl = await new Promise(res => {
          const r = new FileReader()
          r.onload = e => res(e.target.result)
          r.readAsDataURL(file)
        })
      }
      fotos.push(dataUrl)
    }
    setFotos(fotos)
    atualizarGrid()
    inp.value = ''
  })

  return { atualizarGrid }
}

// ── Fotos no formulário de ninho ──────────────────────────────
function bioIniciarFotosForm() {
  bioIniciarFotosGenerica({
    prefixo:  'form',
    max:      3,
    getState: () => BioApp.formNinho?.foto_urls ?? [],
    setFotos: f  => { if (BioApp.formNinho) BioApp.formNinho.foto_urls = f },
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
  // Limite de ovos transferidos = íntegros encontrados (fallback: total).
  // Não se pode transferir mais ovos do que foram encontrados no ninho.
  const limiteOvos = ninho.ovos_integros ?? ninho.qtd_ovos ?? null
  const ovosInp    = document.getElementById('bio-transf-ovos')
  const ovosHint   = document.getElementById('bio-transf-ovos-hint')
  if (limiteOvos != null) {
    ovosInp.max = limiteOvos
    const base = ninho.ovos_integros != null ? 'íntegros' : 'encontrados'
    ovosHint.textContent = `Máximo ${limiteOvos} ovos (${base} no ninho).`
    ovosHint.hidden = false
  } else {
    ovosInp.removeAttribute('max')
    ovosHint.hidden = true
  }
  document.getElementById('bio-transf-local').value           = ''
  document.getElementById('bio-transf-obs').value             = ''
  document.getElementById('bio-transf-motivo').value          = ''
  document.getElementById('bio-transf-numero').value          = ''
  // Fotos
  BioApp._fotosTransf = []
  const _trCount = document.getElementById('bio-transf-foto-count')
  const _trGrid  = document.getElementById('bio-transf-foto-grid')
  if (_trCount) _trCount.textContent = '(0/3)'
  if (_trGrid)  _trGrid.innerHTML = ''
  // Destino: limpa seleção anterior
  BioApp.transfPraiaDestino = null
  const nomeEl = document.getElementById('bio-transf-praia-nome')
  nomeEl.textContent = 'Selecionar praia…'
  nomeEl.style.opacity = '.6'
  document.getElementById('bio-transf-praia-id').value = ''
  // Hora do reenterro: padrão = agora
  document.getElementById('bio-transf-hora').value = new Date().toTimeString().slice(0, 5)
  bioAtualizarSemaforoJanela()
  bioMostrarTela('tela-form-transf')
}

// Abre o sheet de praias para escolher o DESTINO da transferência
function bioEscolherPraiaDestino() {
  bioAbrirSheetPraias(async praia => {
    BioApp.transfPraiaDestino = praia
    document.getElementById('bio-transf-praia-id').value = praia.id
    const nomeEl = document.getElementById('bio-transf-praia-nome')
    nomeEl.textContent = praia.experimental ? `${praia.nome} (experimental)` : praia.nome
    nomeEl.style.opacity = '1'
    // Sugere a placa do ninho NA PRAIA DE DESTINO (editável): a praia
    // receptora pode já ter esse número ocupado, então geramos a próxima
    // placa livre da sequência dela.
    const inp   = document.getElementById('bio-transf-numero')
    const ninho = BioApp.formNinhoAtualizar
    if (inp && ninho) {
      inp.value = '…'
      inp.value = await bioGerarNumeroNinho(praia.id, ninho.especie, 'numero_atual')
    }
  })
}

// ── Janela crítica de translocação ────────────────────────────
// Horas entre a desova (data_encontro + hora_desova) e o reenterro
// (data + hora da transferência). 06:00 é a hora-âncora quando a
// hora exata não foi registrada. Retorna null se faltar a data.
function bioCalcularJanelaHoras(ninho, dataTransf, horaTransf) {
  if (!ninho?.data_encontro || !dataTransf) return null
  const hDesova = (ninho.hora_desova || '06:00').slice(0, 5)
  const hReent  = (horaTransf || '06:00').slice(0, 5)
  const desova   = new Date(`${ninho.data_encontro}T${hDesova}:00`)
  const reenterro = new Date(`${dataTransf}T${hReent}:00`)
  if (isNaN(desova) || isNaN(reenterro)) return null
  return (reenterro - desova) / 3600000
}

function bioAtualizarSemaforoJanela() {
  const el = document.getElementById('bio-transf-janela')
  if (!el) return
  const ninho = BioApp.formNinhoAtualizar
  const dataT = document.getElementById('bio-transf-data').value
  const horaT = document.getElementById('bio-transf-hora').value
  const h = bioCalcularJanelaHoras(ninho, dataT, horaT)
  if (h == null) { el.style.display = 'none'; return }

  const estimada = !ninho?.hora_desova || !horaT
  let bg, cor, txt
  if (h < 0) {
    bg = '#fdf4e3'; cor = '#9a6b00'; txt = 'Verifique as datas: o reenterro está antes da desova.'
  } else if (h <= 6) {
    bg = '#e6f4ec'; cor = '#1b7a4b'; txt = `Janela segura — ~${h.toFixed(1)} h desde a desova.`
  } else if (h <= 12) {
    bg = '#fdf4e3'; cor = '#9a6b00'; txt = `Atenção — ~${h.toFixed(1)} h. Transfira o quanto antes.`
  } else {
    bg = '#fbe9e9'; cor = '#b3261e'; txt = `Fora da janela segura (~${h.toFixed(1)} h) — risco de mortalidade do embrião.`
  }
  if (estimada && h >= 0) txt += ' (hora estimada — registre a hora da desova p/ maior precisão)'
  el.style.background = bg
  el.style.color = cor
  el.textContent = txt
  el.style.display = 'block'
}

async function bioSalvarTransf() {
  const ninho = BioApp.formNinhoAtualizar
  const data   = document.getElementById('bio-transf-data').value
  const ovos   = parseInt(document.getElementById('bio-transf-ovos').value)
  const local  = document.getElementById('bio-transf-local').value.trim()
  const obs    = document.getElementById('bio-transf-obs').value.trim()
  const motivo = document.getElementById('bio-transf-motivo').value || null
  const hora   = document.getElementById('bio-transf-hora').value || null
  const numeroAtual = document.getElementById('bio-transf-numero').value.trim()
  const destino = BioApp.transfPraiaDestino

  if (!data)           { bioToast('Informe a data da transferência.', 'err'); return }
  if (isNaN(ovos) || ovos < 0) { bioToast('Informe o número de ovos.', 'err'); return }
  // Não pode transferir mais ovos do que os íntegros encontrados no ninho
  // (fallback: total encontrado). Sem essa referência, não há como validar.
  const limiteOvos = ninho?.ovos_integros ?? ninho?.qtd_ovos ?? null
  if (limiteOvos != null && ovos > limiteOvos) {
    const base = ninho?.ovos_integros != null ? 'íntegros' : 'encontrados'
    bioToast(`Máximo ${limiteOvos} ovos (${base} no ninho). Não é possível transferir mais do que foi encontrado.`, 'err')
    return
  }
  if (!destino)        { bioToast('Selecione a praia de destino.', 'err'); return }
  if (!numeroAtual)    { bioToast('Informe o número do ninho no destino.', 'err'); return }

  // Janela crítica: alerta (não bloqueia) se passou de 12 h desde a desova
  const janela = bioCalcularJanelaHoras(ninho, data, hora)
  if (janela != null && janela > 12) {
    if (!confirm(`Esta transferência está ~${janela.toFixed(1)} h após a desova, fora da janela segura (~12 h). `
      + `O embrião pode já estar aderido à casca e morrer com o manuseio.\n\nRegistrar mesmo assim?`)) return
  }

  const transf = {
    uuid_cliente:       bioUuid(),
    ninho_uuid:         ninho.uuid_cliente,
    ninho_numero:       ninho.numero_ninho,
    data_transferencia: data,
    hora_transferencia: hora,
    qtd_ovos:           ovos,
    praia_destino_id:   destino.id,
    praia_destino_nome: destino.nome,
    numero_atual:       numeroAtual,
    motivo:             motivo,
    local_destino:      local || null,
    observacoes:        obs || null,
    foto_urls:          BioApp._fotosTransf?.length ? [...BioApp._fotosTransf] : [],
    status_sync:        'pendente',
    criado_em:          new Date().toISOString(),
  }

  // Atualiza status, localização atual e placa do ninho localmente
  await bioOfflineSalvarNinho({
    ...ninho,
    server_id:        ninho.server_id ?? ninho.id ?? null,
    status:           'transferido',
    praia_atual_id:   destino.id,
    praia_atual_nome: destino.nome,
    numero_atual:     numeroAtual,
  })
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

  // Fotos
  BioApp._fotosEcl = []
  const _eclCount = document.getElementById('bio-ecl-foto-count')
  const _eclGrid  = document.getElementById('bio-ecl-foto-grid')
  if (_eclCount) _eclCount.textContent = '(0/3)'
  if (_eclGrid)  _eclGrid.innerHTML = ''

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
  if (el) el.value = val
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
    plusEl?.addEventListener('click',  () => { valEl.value = parseInt(valEl.value || 0) + 1 })
    minEl?.addEventListener('click',   () => { valEl.value = Math.max(min, parseInt(valEl.value || 0) - 1) })
    valEl?.addEventListener('blur',    () => { let v = parseInt(valEl.value); if (isNaN(v) || v < min) v = min; valEl.value = v })
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
  const vivos       = parseInt(document.getElementById('bio-ecl-vivos').value)    || 0
  const mortos      = parseInt(document.getElementById('bio-ecl-mortos').value)   || 0
  const naoNascidos = parseInt(document.getElementById('bio-ecl-nao-nasc').value) || 0
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
    foto_urls:         BioApp._fotosEcl?.length ? [...BioApp._fotosEcl] : [],
    status_sync:       'pendente',
    criado_em:         new Date().toISOString(),
  }

  await bioOfflineSalvarNinho({ ...ninho, server_id: ninho.server_id ?? ninho.id ?? null, status: 'eclodido' })
  await bioOfflineSalvarEclosao(ecl)
  await bioAtualizarBadgeFila()

  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast('Eclosão registrada!', 'ok')
  bioAbrirTelaDestino({ ...ninho, status: 'eclodido' }, vivos)
}

/* ════════════════════════════════════════════════════════════
   DESTINO PÓS-ECLOSÃO
   ════════════════════════════════════════════════════════════ */
function bioAbrirTelaDestino(ninho, filhotesVivos) {
  BioApp.formDestinoCtx = { ninho, filhotesVivos: filhotesVivos ?? 0 }
  document.getElementById('bio-dest-ninho-num').textContent = ninho.numero_ninho
  document.getElementById('bio-dest-especie').textContent   = BIO_ESPECIES.find(e => e.id === ninho.especie)?.nome ?? ninho.especie
  document.getElementById('bio-dest-filhotes').textContent  = filhotesVivos ?? 0
  bioMostrarTela('tela-destino-filhotes')
}

/* ════════════════════════════════════════════════════════════
   FORMULÁRIO — ENTRADA NO BERÇÁRIO
   ════════════════════════════════════════════════════════════ */
function bioAbrirFormEntradaBercario() {
  const { ninho, filhotesVivos } = BioApp.formDestinoCtx ?? {}
  if (!ninho) return
  document.getElementById('bio-berc-ninho-num').textContent = ninho.numero_ninho
  document.getElementById('bio-berc-especie').textContent   = BIO_ESPECIES.find(e => e.id === ninho.especie)?.nome ?? ninho.especie
  BioApp.formBercarioSelecionado = null
  const nomeSpan = document.getElementById('bio-berc-nome-txt')
  if (nomeSpan) nomeSpan.textContent = 'Selecionar berçário…'
  document.getElementById('bio-berc-data').value  = new Date().toISOString().slice(0, 10)
  document.getElementById('bio-berc-hora').value  = new Date().toTimeString().slice(0, 5)
  document.getElementById('bio-berc-obs').value   = ''
  bioSetContador('bio-berc-qtd', filhotesVivos ?? 0)
  bioMostrarTela('tela-form-entrada-bercario')
}

async function bioSalvarEntradaBercario() {
  const { ninho } = BioApp.formDestinoCtx ?? {}
  if (!ninho) return
  const berc = BioApp.formBercarioSelecionado
  const data = document.getElementById('bio-berc-data').value
  const qtd  = parseInt(document.getElementById('bio-berc-qtd').value) || 0

  if (!berc) { bioToast('Selecione um berçário.', 'err'); return }
  if (!data) { bioToast('Informe a data de entrada.', 'err'); return }
  if (qtd <= 0) { bioToast('Quantidade deve ser maior que zero.', 'err'); return }

  const lote = {
    uuid_cliente:  bioUuid(),
    ninho_uuid:    ninho.uuid_cliente,
    ninho_numero:  ninho.numero_ninho,
    especie:       ninho.especie,
    bercario_id:   berc.id,
    bercario_nome: berc.nome,
    data_entrada:  data,
    hora_entrada:  document.getElementById('bio-berc-hora').value || null,
    qtd_entrada:   qtd,
    status:        'ativo',
    observacoes:   document.getElementById('bio-berc-obs').value.trim() || null,
    status_sync:   'pendente',
    criado_em:     new Date().toISOString(),
  }

  await bioOfflineSalvarLote(lote)
  await bioAtualizarBadgeFila()
  await bioAtualizarBadgeBercario()

  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast('Entrada no berçário registrada!', 'ok')
  bioMostrarTela('tela-home')
}

/* ════════════════════════════════════════════════════════════
   FORMULÁRIO — SOLTURA DE FILHOTES
   ════════════════════════════════════════════════════════════ */
// ctx: { ninho, filhotesVivos, lote? }
// Se lote presente → via_bercario = true; back vai para tela-bercarios
function bioAbrirFormSoltura(ctx) {
  BioApp.formSolturaCtx = ctx
  const { ninho, filhotesVivos, lote } = ctx

  document.getElementById('bio-sol-ninho-num').textContent = ninho.numero_ninho
  document.getElementById('bio-sol-especie').textContent   = BIO_ESPECIES.find(e => e.id === ninho.especie)?.nome ?? ninho.especie
  document.getElementById('bio-sol-data').value            = new Date().toISOString().slice(0, 10)
  document.getElementById('bio-sol-hora').value            = new Date().toTimeString().slice(0, 5)
  document.getElementById('bio-sol-local').value           = ''
  document.getElementById('bio-sol-obs').value             = ''
  document.getElementById('bio-sol-predacao').checked      = false
  bioSetContador('bio-sol-qtd',  filhotesVivos ?? 0)
  bioSetContador('bio-sol-mort', 0)

  const infoEl    = document.getElementById('bio-sol-bercario-info')
  const mortLabel = document.getElementById('bio-sol-mort-label')
  const tituloEl  = document.getElementById('bio-soltura-titulo')
  const backBtn   = document.getElementById('bio-soltura-back')

  if (lote) {
    infoEl.textContent = `Berçário: ${lote.bercario_nome} · Entrada: ${lote.qtd_entrada} filhotes`
    infoEl.hidden      = false
    mortLabel.textContent = '(no berçário)'
    tituloEl.textContent  = 'Soltura do Berçário'
    backBtn.dataset.back  = 'tela-bercarios'
  } else {
    infoEl.hidden         = true
    mortLabel.textContent = '(pós-eclosão)'
    tituloEl.textContent  = 'Soltura de Filhotes'
    backBtn.dataset.back  = 'tela-destino-filhotes'
  }

  // GPS
  const coordsEl = document.getElementById('bio-sol-gps-coords')
  if (coordsEl) coordsEl.textContent = bioFormatarCoords(BioApp.gpsLat, BioApp.gpsLng)

  // Fotos
  BioApp._fotosSol = []
  const _solCount = document.getElementById('bio-sol-foto-count')
  const _solGrid  = document.getElementById('bio-sol-foto-grid')
  if (_solCount) _solCount.textContent = '(0/3)'
  if (_solGrid)  _solGrid.innerHTML = ''

  bioMostrarTela('tela-form-soltura')
}

async function bioSalvarSoltura() {
  const { ninho, lote } = BioApp.formSolturaCtx ?? {}
  if (!ninho) return

  const data = document.getElementById('bio-sol-data').value
  const qtd  = parseInt(document.getElementById('bio-sol-qtd').value)  || 0
  const mort = parseInt(document.getElementById('bio-sol-mort').value) || 0

  if (!data)    { bioToast('Informe a data da soltura.', 'err'); return }
  if (qtd <= 0) { bioToast('Informe a quantidade soltada.', 'err'); return }

  const sol = {
    uuid_cliente:    bioUuid(),
    ninho_uuid:      ninho.uuid_cliente,
    ninho_numero:    ninho.numero_ninho,
    lote_uuid:       lote?.uuid_cliente ?? null,
    via_bercario:    !!lote,
    data_soltura:    data,
    hora_soltura:    document.getElementById('bio-sol-hora').value || null,
    qtd_soltada:     qtd,
    mortalidade:     mort,
    lat:             BioApp.gpsLat,
    lng:             BioApp.gpsLng,
    local_descricao: document.getElementById('bio-sol-local').value.trim() || null,
    predacao_soltura: document.getElementById('bio-sol-predacao').checked,
    observacoes:     document.getElementById('bio-sol-obs').value.trim() || null,
    foto_urls:       BioApp._fotosSol?.length ? [...BioApp._fotosSol] : [],
    status_sync:     'pendente',
    criado_em:       new Date().toISOString(),
  }

  // Marca lote como soltado se aplicável
  if (lote) {
    await bioOfflineSalvarLote({ ...lote, status: 'soltado' })
  }

  await bioOfflineSalvarSoltura(sol)
  await bioAtualizarBadgeFila()
  await bioAtualizarBadgeBercario()

  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast('Soltura registrada!', 'ok')
  bioMostrarTela('tela-home')
}

/* ════════════════════════════════════════════════════════════
   TELA BERÇÁRIOS — LOTES ATIVOS
   ════════════════════════════════════════════════════════════ */
async function bioAbrirTelaBercarios() {
  bioMostrarTela('tela-bercarios')
  await bioCarregarBercarios()
}

async function bioCarregarBercarios() {
  const estadoEl = document.getElementById('bio-bercarios-estado')
  const listaEl  = document.getElementById('bio-lista-lotes')
  if (estadoEl) { estadoEl.textContent = 'Carregando…'; estadoEl.hidden = false }
  if (listaEl)  listaEl.innerHTML = ''

  const lotes = await bioOfflineLotesAtivos()

  if (!lotes.length) {
    if (estadoEl) { estadoEl.textContent = 'Nenhum lote em berçário no momento.'; estadoEl.hidden = false }
    return
  }
  if (estadoEl) estadoEl.hidden = true

  // Agrupa por bercario_id (ou 'sem-bercario')
  const grupos = {}
  lotes.forEach(l => {
    const chave = l.bercario_id ?? 'sem-bercario'
    if (!grupos[chave]) grupos[chave] = { nome: l.bercario_nome ?? 'Berçário não identificado', lotes: [] }
    grupos[chave].lotes.push(l)
  })

  Object.values(grupos).forEach(grupo => {
    const totalFilhotes = grupo.lotes.reduce((s, l) => s + (l.qtd_entrada || 0), 0)

    const header = document.createElement('div')
    header.className = 'bio-berc-grupo-header'
    header.innerHTML = `
      <span>${grupo.nome}</span>
      <span class="bio-berc-grupo-stats">${grupo.lotes.length} lote${grupo.lotes.length !== 1 ? 's' : ''} · ${totalFilhotes} filhotes</span>
    `
    listaEl.appendChild(header)

    grupo.lotes.forEach(l => {
      const card = document.createElement('div')
      card.className = 'bio-nfc'
      const espNome = BIO_ESPECIES.find(e => e.id === l.especie)?.nome ?? l.especie ?? '—'
      const diasStr = _bioDiasDesde(l.data_entrada)
      card.innerHTML = `
        <div class="bio-nfc-header">
          <span class="bio-nfc-num">Ninho #${l.ninho_numero ?? '—'}</span>
          <span class="bio-nfc-status-badge encontrado">${diasStr}</span>
        </div>
        <div class="bio-nfc-especie">${espNome}</div>
        <div class="bio-nfc-row">
          <span style="font-size:12px"><strong>${l.qtd_entrada}</strong> filhotes</span>
          <span class="bio-nfc-data">Entrada: ${_bioFormatarData(l.data_entrada)}</span>
        </div>
        <div class="bio-nfc-acoes">
          <button class="bio-btn-sm prim" data-acao="detalhe-lote">Ver detalhe</button>
          <button class="bio-btn-sm prim" data-acao="soltar-lote">Soltar</button>
        </div>
      `
      card.querySelector('[data-acao="detalhe-lote"]')?.addEventListener('click', () => {
        bioAbrirTelaDetalheLote(l)
      })
      card.querySelector('[data-acao="soltar-lote"]')?.addEventListener('click', async () => {
        const ninho = await bioOfflineGetNinho(l.ninho_uuid)
        if (!ninho) { bioToast('Ninho não encontrado no cache.', 'err'); return }
        bioAbrirFormSoltura({ ninho, filhotesVivos: l.qtd_entrada, lote: l })
      })
      listaEl.appendChild(card)
    })
  })
}

async function bioAbrirSeletorBercario(callback) {
  const lista = await bioOfflineListarBercarios()
  const selEl  = document.getElementById('bio-lista-bercarios-sel')
  const vazioEl = document.getElementById('bio-bercarios-vazio')
  if (selEl) selEl.innerHTML = ''

  if (!lista.length) {
    if (vazioEl)  vazioEl.hidden = false
    if (selEl)    selEl.hidden   = true
  } else {
    if (vazioEl)  vazioEl.hidden = true
    if (selEl) {
      selEl.hidden = false
      const TIPO_LABEL = { tanque_fibra: 'Tanque de fibra', piscina_alvenaria: 'Piscina de alvenaria', viveiro: 'Viveiro', outro: 'Outro' }
      lista.forEach(b => {
        const card = document.createElement('div')
        card.className = 'bio-berc-sel-card'
        card.innerHTML = `
          <div class="bio-berc-sel-info">
            <div class="bio-berc-sel-nome">${b.nome}</div>
            <div class="bio-berc-sel-meta">${TIPO_LABEL[b.tipo] ?? b.tipo}</div>
          </div>
          ${b.capacidade_max ? `<span class="bio-berc-sel-cap">Máx. ${b.capacidade_max}</span>` : ''}
        `
        card.addEventListener('click', () => {
          callback(b)
        })
        selEl.appendChild(card)
      })
    }
  }

  document.getElementById('bio-sel-berc-back')?.addEventListener('click', () => {
    bioMostrarTela('tela-form-entrada-bercario')
  }, { once: true })

  bioMostrarTela('tela-seletor-bercario')
}

function bioAbrirTelaDetalheLote(lote) {
  BioApp.loteAtual = lote
  const espNome = BIO_ESPECIES.find(e => e.id === lote.especie)?.nome ?? lote.especie ?? '—'
  const diasNum = Math.floor((Date.now() - new Date(lote.data_entrada)) / 86400000)

  const el = id => document.getElementById(id)
  if (el('bio-det-ninho-num'))  el('bio-det-ninho-num').textContent  = lote.ninho_numero ?? '—'
  if (el('bio-det-especie'))    el('bio-det-especie').textContent    = espNome
  if (el('bio-det-bercario'))   el('bio-det-bercario').textContent   = lote.bercario_nome ?? '—'
  if (el('bio-det-qtd'))        el('bio-det-qtd').textContent        = lote.qtd_entrada ?? '—'
  if (el('bio-det-dias'))       el('bio-det-dias').textContent       = diasNum >= 0 ? diasNum : '—'

  bioCarregarTimelineLote(lote)
  bioMostrarTela('tela-detalhe-lote')
}

async function bioCarregarTimelineLote(lote) {
  const timelineEl = document.getElementById('bio-det-timeline')
  if (!timelineEl) return

  const ocorrencias = await bioOfflineOcorrenciasDoLote(lote.uuid_cliente)

  if (!ocorrencias.length) {
    timelineEl.innerHTML = `<div class="bio-tl-vazio">Nenhuma ocorrência registrada.</div>`
    return
  }

  const TIPO_ICONE = {
    alimentacao: `<path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/>`,
    biometria:   `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
    mortalidade: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="12" x2="15" y2="12"/>`,
    doenca:      `<path d="M8 2h8l4 4v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
    tratamento:  `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
    observacao:  `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
  }
  const TIPO_NOME = { alimentacao: 'Alimentação', biometria: 'Biometria', mortalidade: 'Mortalidade', doenca: 'Doença', tratamento: 'Tratamento', observacao: 'Observação' }

  timelineEl.innerHTML = ocorrencias.map(oc => {
    const icone = TIPO_ICONE[oc.tipo] ?? TIPO_ICONE.observacao
    const detalhes = []
    if (oc.comprimento_medio_cm != null) detalhes.push(`Comp.: ${oc.comprimento_medio_cm} cm`)
    if (oc.peso_medio_g != null)         detalhes.push(`Peso: ${oc.peso_medio_g} g`)
    if (oc.n_amostrados != null)         detalhes.push(`Amostrados: ${oc.n_amostrados}`)
    if (oc.qtd_afetados != null)         detalhes.push(`Afetados: ${oc.qtd_afetados}`)
    if (oc.causa)                        detalhes.push(`Causa: ${oc.causa}`)
    if (oc.descricao)                    detalhes.push(oc.descricao)
    const dataFmt = _bioFormatarData(oc.data_ocorrencia) + (oc.hora_ocorrencia ? ` às ${oc.hora_ocorrencia}` : '')
    return `
      <div class="bio-tl-item">
        <div class="bio-tl-icone">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icone}</svg>
        </div>
        <div class="bio-tl-body">
          <div class="bio-tl-tipo">${TIPO_NOME[oc.tipo] ?? oc.tipo}</div>
          <div class="bio-tl-data">${dataFmt}</div>
          ${detalhes.length ? `<div class="bio-tl-detalhe">${detalhes.join(' · ')}</div>` : ''}
        </div>
      </div>
    `
  }).join('')
}

function bioAbrirFormOcorrencia(lote) {
  BioApp.loteAtual = lote
  document.getElementById('bio-oc-data').value = new Date().toISOString().slice(0, 10)
  document.getElementById('bio-oc-hora').value = new Date().toTimeString().slice(0, 5)
  document.getElementById('bio-oc-comp').value = ''
  document.getElementById('bio-oc-peso').value = ''
  document.getElementById('bio-oc-amostrados').value = ''
  document.getElementById('bio-oc-causa').value = ''
  document.getElementById('bio-oc-descricao').value = ''
  document.getElementById('bio-oc-afetados').value = 0

  // Fotos
  BioApp._fotosOc = []
  const _ocCount = document.getElementById('bio-oc-foto-count')
  const _ocGrid  = document.getElementById('bio-oc-foto-grid')
  if (_ocCount) _ocCount.textContent = '(0/2)'
  if (_ocGrid)  _ocGrid.innerHTML = ''

  document.querySelectorAll('#bio-oc-tipo-grid .bio-oc-chip').forEach((chip, i) => {
    chip.classList.toggle('ativo', i === 0)
  })
  bioAtualizarCamposOcorrencia('alimentacao')
  bioMostrarTela('tela-form-ocorrencia')
}

function bioAtualizarCamposOcorrencia(tipo) {
  const show = id => { const el = document.getElementById(id); if (el) el.hidden = false }
  const hide = id => { const el = document.getElementById(id); if (el) el.hidden = true  }

  hide('bio-oc-sec-biometria')
  hide('bio-oc-sec-mortalidade')
  hide('bio-oc-sec-causa')

  if (tipo === 'biometria') {
    show('bio-oc-sec-biometria')
    show('bio-oc-sec-descricao')
  } else if (tipo === 'mortalidade' || tipo === 'doenca') {
    show('bio-oc-sec-mortalidade')
    show('bio-oc-sec-causa')
    show('bio-oc-sec-descricao')
  } else {
    show('bio-oc-sec-descricao')
  }
}

async function bioSalvarOcorrencia() {
  const lote = BioApp.loteAtual
  if (!lote) return

  const tipoChip = document.querySelector('#bio-oc-tipo-grid .bio-oc-chip.ativo')
  const tipo = tipoChip?.dataset.tipo ?? 'observacao'
  const data = document.getElementById('bio-oc-data').value
  if (!data) { bioToast('Informe a data da ocorrência.', 'err'); return }

  const oc = {
    uuid_cliente:         bioUuid(),
    lote_uuid:            lote.uuid_cliente,
    tipo,
    data_ocorrencia:      data,
    hora_ocorrencia:      document.getElementById('bio-oc-hora').value  || null,
    comprimento_medio_cm: parseFloat(document.getElementById('bio-oc-comp').value)         || null,
    peso_medio_g:         parseFloat(document.getElementById('bio-oc-peso').value)         || null,
    n_amostrados:         parseInt(document.getElementById('bio-oc-amostrados').value)     || null,
    qtd_afetados:         parseInt(document.getElementById('bio-oc-afetados').value) || null,
    causa:                document.getElementById('bio-oc-causa').value.trim()             || null,
    descricao:            document.getElementById('bio-oc-descricao').value.trim()         || null,
    foto_urls:            BioApp._fotosOc?.length ? [...BioApp._fotosOc] : [],
    status_sync:          'pendente',
    criado_em:            new Date().toISOString(),
  }

  await bioOfflineSalvarOcorrencia(oc)
  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast('Ocorrência registrada!', 'ok')
  bioAbrirTelaDetalheLote(lote)
}

function _bioDiasDesde(dataStr) {
  if (!dataStr) return '—'
  const dias = Math.floor((Date.now() - new Date(dataStr)) / 86400000)
  if (dias === 0) return 'Hoje'
  if (dias === 1) return '1 dia'
  return `${dias} dias`
}

function _bioFormatarData(dataStr) {
  if (!dataStr) return '—'
  const [y, m, d] = dataStr.split('-')
  return `${d}/${m}/${y}`
}

async function bioAtualizarBadgeBercario() {
  const lotes  = await bioOfflineLotesAtivos()
  const badge  = document.getElementById('bio-bercarios-badge')
  const label  = document.getElementById('bio-bercarios-label')
  const count  = lotes.length
  const totalFilhotes = lotes.reduce((s, l) => s + (l.qtd_entrada || 0), 0)
  if (badge)  { badge.textContent = count; badge.hidden = count === 0 }
  if (label)  label.textContent = count > 0
    ? `${count} lote${count > 1 ? 's' : ''} · ${totalFilhotes} filhotes`
    : 'Filhotes em berçário'
}

function bioIniciarPosEclosao() {
  // Destino: botões de escolha
  document.getElementById('bio-dest-rio')?.addEventListener('click', () => {
    const { ninho, filhotesVivos } = BioApp.formDestinoCtx ?? {}
    if (!ninho) return
    bioAbrirFormSoltura({ ninho, filhotesVivos })
  })
  document.getElementById('bio-dest-bercario')?.addEventListener('click', bioAbrirFormEntradaBercario)

  // Seletor de berçário no form de entrada
  document.getElementById('bio-berc-nome-btn')?.addEventListener('click', () => {
    bioAbrirSeletorBercario(b => {
      BioApp.formBercarioSelecionado = b
      const nomeSpan = document.getElementById('bio-berc-nome-txt')
      if (nomeSpan) nomeSpan.textContent = b.nome
      bioMostrarTela('tela-form-entrada-bercario')
    })
  })

  // Contadores berçário
  const bercQtdEl = document.getElementById('bio-berc-qtd')
  document.getElementById('bio-berc-qtd-plus')?.addEventListener('click',  () => { bercQtdEl.value = parseInt(bercQtdEl.value || 0) + 1 })
  document.getElementById('bio-berc-qtd-minus')?.addEventListener('click', () => { bercQtdEl.value = Math.max(0, parseInt(bercQtdEl.value || 0) - 1) })
  bercQtdEl?.addEventListener('blur', () => { let v = parseInt(bercQtdEl.value); if (isNaN(v) || v < 0) v = 0; bercQtdEl.value = v })

  // Contadores soltura
  const solQtdEl  = document.getElementById('bio-sol-qtd')
  const solMortEl = document.getElementById('bio-sol-mort')
  document.getElementById('bio-sol-qtd-plus')?.addEventListener('click',   () => { solQtdEl.value  = parseInt(solQtdEl.value  || 0) + 1 })
  document.getElementById('bio-sol-qtd-minus')?.addEventListener('click',  () => { solQtdEl.value  = Math.max(0, parseInt(solQtdEl.value  || 0) - 1) })
  document.getElementById('bio-sol-mort-plus')?.addEventListener('click',  () => { solMortEl.value = parseInt(solMortEl.value || 0) + 1 })
  document.getElementById('bio-sol-mort-minus')?.addEventListener('click', () => { solMortEl.value = Math.max(0, parseInt(solMortEl.value || 0) - 1) })
  solQtdEl?.addEventListener('blur',  () => { let v = parseInt(solQtdEl.value);  if (isNaN(v) || v < 0) v = 0; solQtdEl.value  = v })
  solMortEl?.addEventListener('blur', () => { let v = parseInt(solMortEl.value); if (isNaN(v) || v < 0) v = 0; solMortEl.value = v })

  // Contador afetados (ocorrência)
  const ocAffEl = document.getElementById('bio-oc-afetados')
  document.getElementById('bio-oc-aff-plus')?.addEventListener('click',  () => { if (ocAffEl) ocAffEl.value = parseInt(ocAffEl.value || 0) + 1 })
  document.getElementById('bio-oc-aff-minus')?.addEventListener('click', () => { if (ocAffEl) ocAffEl.value = Math.max(0, parseInt(ocAffEl.value || 0) - 1) })
  ocAffEl?.addEventListener('blur', () => { let v = parseInt(ocAffEl.value); if (isNaN(v) || v < 0) v = 0; ocAffEl.value = v })

  // Chips de tipo de ocorrência
  document.getElementById('bio-oc-tipo-grid')?.addEventListener('click', e => {
    const chip = e.target.closest('.bio-oc-chip')
    if (!chip) return
    document.querySelectorAll('#bio-oc-tipo-grid .bio-oc-chip').forEach(c => c.classList.remove('ativo'))
    chip.classList.add('ativo')
    bioAtualizarCamposOcorrencia(chip.dataset.tipo)
  })

  // Detalhe do lote: botões de ação
  document.getElementById('bio-btn-nova-ocorrencia')?.addEventListener('click', () => {
    if (BioApp.loteAtual) bioAbrirFormOcorrencia(BioApp.loteAtual)
  })
  document.getElementById('bio-btn-salvar-ocorrencia')?.addEventListener('click', bioSalvarOcorrencia)
  document.getElementById('bio-btn-soltar-lote')?.addEventListener('click', async () => {
    const lote = BioApp.loteAtual
    if (!lote) return
    const ninho = await bioOfflineGetNinho(lote.ninho_uuid)
    if (!ninho) { bioToast('Ninho não encontrado no cache.', 'err'); return }
    bioAbrirFormSoltura({ ninho, filhotesVivos: lote.qtd_entrada, lote })
  })

  // Voltar da tela de ocorrência para detalhe
  document.getElementById('bio-oc-back')?.addEventListener('click', () => {
    if (BioApp.loteAtual) bioAbrirTelaDetalheLote(BioApp.loteAtual)
    else bioMostrarTela('tela-bercarios')
  })

  // Botão salvar
  document.getElementById('bio-btn-salvar-entrada-bercario')?.addEventListener('click', bioSalvarEntradaBercario)
  document.getElementById('bio-btn-salvar-soltura')?.addEventListener('click',           bioSalvarSoltura)
  document.getElementById('bio-btn-reload-bercarios')?.addEventListener('click',         bioCarregarBercarios)
  document.getElementById('bio-btn-bercarios')?.addEventListener('click',                bioAbrirTelaBercarios)

  // GPS em tempo real na tela de soltura
  // (reutiliza o watchPosition já ativo; atualiza coordsEl no próximo tick de GPS)
}

/* ════════════════════════════════════════════════════════════
   FORMULÁRIO — VISITA DE ACOMPANHAMENTO
   ════════════════════════════════════════════════════════════ */
async function bioAbrirFormVisita(ninho) {
  BioApp.formNinhoAtualizar = ninho
  document.getElementById('bio-vis-ninho-num').textContent = ninho.numero_ninho
  document.getElementById('bio-vis-especie').textContent   = BIO_ESPECIES.find(e => e.id === ninho.especie)?.nome ?? ninho.especie
  document.getElementById('bio-vis-data').value            = new Date().toISOString().slice(0, 10)
  document.getElementById('bio-vis-hora').value            = new Date().toTimeString().slice(0, 5)
  document.getElementById('bio-vis-temp-sub').value        = ''
  document.getElementById('bio-vis-temp-ar').value         = ''
  document.getElementById('bio-vis-intervencao').value     = ''
  document.getElementById('bio-vis-obs').value             = ''
  document.getElementById('bio-vis-alagamento').checked    = false
  bioSetContador('bio-vis-ovos-pred', 0)
  document.getElementById('bio-vis-ovos-pred-wrap').style.display = 'none'

  // Status: íntegro por padrão
  document.querySelectorAll('#bio-vis-status-grid .bio-chip-sel').forEach(c => {
    c.classList.toggle('ativo', c.dataset.val === 'integro')
  })

  // Umidade: sem seleção
  document.querySelectorAll('#bio-vis-umidade-grid .bio-chip-sel').forEach(c => {
    c.classList.toggle('ativo', c.dataset.val === '')
  })

  // Predação: nenhuma
  document.querySelectorAll('#bio-vis-pred-grid .bio-pred-opt').forEach(o => {
    o.classList.remove('sel', 'perigo')
    if (o.dataset.pred === 'nenhuma') o.classList.add('sel')
  })

  const _alVis = document.getElementById('bio-vis-alertas')
  if (_alVis) _alVis.innerHTML = ''
  if (typeof bioAtualizarAlertasVisita === 'function') bioAtualizarAlertasVisita()

  // Fotos
  BioApp._fotosVis = []
  const _visCount = document.getElementById('bio-vis-foto-count')
  const _visGrid  = document.getElementById('bio-vis-foto-grid')
  if (_visCount) _visCount.textContent = '(0/3)'
  if (_visGrid)  _visGrid.innerHTML = ''

  bioMostrarTela('tela-form-visita')
}

async function bioSalvarVisita() {
  const ninho = BioApp.formNinhoAtualizar
  const data  = document.getElementById('bio-vis-data').value
  const hora  = document.getElementById('bio-vis-hora').value || null

  if (!data) { bioToast('Informe a data da visita.', 'err'); return }

  // Alertas científicos: confirmação consciente se houver faixa crítica
  let _alertaCampoVisita = null
  if (typeof bioAvaliarQuelonio === 'function') {
    const _al = bioAvaliarQuelonio(bioAlertaContextoVisita())
    if (!bioConfirmarCriticos(_al)) return
    _alertaCampoVisita = bioAlertaSnapshot(_al)
  }

  const statusNinho  = document.querySelector('#bio-vis-status-grid .bio-chip-sel.ativo')?.dataset.val ?? 'integro'
  const umidade      = document.querySelector('#bio-vis-umidade-grid .bio-chip-sel.ativo')?.dataset.val || null
  const predacao     = document.querySelector('#bio-vis-pred-grid .bio-pred-opt.sel')?.dataset.pred    ?? 'nenhuma'
  const ovosPredados = predacao !== 'nenhuma'
    ? (parseInt(document.getElementById('bio-vis-ovos-pred').value) || 0)
    : null

  const visita = {
    uuid_cliente:            bioUuid(),
    ninho_uuid:              ninho.uuid_cliente,
    ninho_numero:            ninho.numero_ninho,
    data_visita:             data,
    hora_visita:             hora,
    status_ninho:            statusNinho,
    temperatura_substrato_c: parseFloat(document.getElementById('bio-vis-temp-sub').value) || null,
    temperatura_ar_c:        parseFloat(document.getElementById('bio-vis-temp-ar').value)  || null,
    umidade,
    predacao_incubacao:      predacao,
    ovos_predados_n:         ovosPredados,
    sinal_alagamento:        document.getElementById('bio-vis-alagamento').checked,
    intervencao:             document.getElementById('bio-vis-intervencao').value.trim() || null,
    observacoes:             document.getElementById('bio-vis-obs').value.trim()         || null,
    foto_urls:               BioApp._fotosVis?.length ? [...BioApp._fotosVis] : [],
    alerta_campo:            _alertaCampoVisita,
    status_sync:             'pendente',
    criado_em:               new Date().toISOString(),
  }

  await bioOfflineSalvarVisita(visita)
  await bioAtualizarBadgeFila()

  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast('Visita registrada!', 'ok')
  bioMostrarTela('tela-abertos')
}

function bioIniciarFormVisita() {
  // Chip de status
  document.querySelectorAll('#bio-vis-status-grid .bio-chip-sel').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bio-vis-status-grid .bio-chip-sel').forEach(b => b.classList.remove('ativo'))
      btn.classList.add('ativo')
    })
  })

  // Chip de umidade
  document.querySelectorAll('#bio-vis-umidade-grid .bio-chip-sel').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bio-vis-umidade-grid .bio-chip-sel').forEach(b => b.classList.remove('ativo'))
      btn.classList.add('ativo')
    })
  })

  // Predação + toggle de ovos predados
  document.querySelectorAll('#bio-vis-pred-grid .bio-pred-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#bio-vis-pred-grid .bio-pred-opt').forEach(o => o.classList.remove('sel', 'perigo'))
      opt.classList.add('sel')
      if (opt.dataset.pred !== 'nenhuma') opt.classList.add('perigo')
      const wrap = document.getElementById('bio-vis-ovos-pred-wrap')
      if (wrap) wrap.style.display = opt.dataset.pred !== 'nenhuma' ? '' : 'none'
    })
  })

  // Contador de ovos predados
  const valEl  = document.getElementById('bio-vis-ovos-pred')
  document.getElementById('bio-vis-ovos-plus')?.addEventListener('click',  () => { valEl.value = parseInt(valEl.value || 0) + 1 })
  document.getElementById('bio-vis-ovos-minus')?.addEventListener('click', () => { valEl.value = Math.max(0, parseInt(valEl.value || 0) - 1) })
  valEl?.addEventListener('blur', () => { let v = parseInt(valEl.value); if (isNaN(v) || v < 0) v = 0; valEl.value = v })

  document.getElementById('bio-btn-salvar-visita')?.addEventListener('click', bioSalvarVisita)
}

/* ════════════════════════════════════════════════════════════
   NINHOS ABERTOS / HISTÓRICO
   ════════════════════════════════════════════════════════════ */
async function bioAbrirTelaAbertos() {
  BioApp.abertosSoCorrecao = false
  // Inicializa filtro com a praia atual (se não definido ainda)
  if (BioApp.abertosFiltroPraia === undefined) BioApp.abertosFiltroPraia = BioApp.praiaAtual ?? null
  bioMostrarTela('tela-abertos')
  bioAtualizarLabelFiltro('abertos')
  bioMostrarGeoSugTab('abertos')
  await bioCarregarAbertos()
}

// Abre a lista filtrando apenas os ninhos devolvidos para correção
// (todas as praias), a partir do card da home.
async function bioAbrirCorrecoes() {
  BioApp.abertosFiltroPraia = null
  BioApp.abertosSoCorrecao  = true
  bioMostrarTela('tela-abertos')
  bioAtualizarLabelFiltro('abertos')
  bioMostrarGeoSugTab('abertos')
  await bioCarregarAbertos()
}

// Preenche praia_nome (origem) e praia_atual_nome (onde incuba agora)
// num ninho local, a partir da lista de praias. Mantém o que já vier.
function bioMapNinhoPraias(n, praias) {
  const praiaAtualId = n.praia_atual_id ?? n.praia_id
  const orig = praias.find(p => p.id === n.praia_id)
  const atual = praias.find(p => p.id === praiaAtualId)
  return {
    ...n,
    praia_atual_id:   praiaAtualId,
    praia_nome:       n.praia_nome       ?? orig?.nome,
    praia_atual_nome: n.praia_atual_nome ?? atual?.nome ?? orig?.nome,
    numero_atual:     n.numero_atual     ?? n.numero_ninho,
  }
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
    : n.status !== 'perdido'

  let ninhos = []

  if (navigator.onLine && BioApp.monitor?.grupo_id) {
    try {
      let q = bioSupabase()
        .from('vw_ninhos_validacao')
        .select('id,uuid_cliente,numero_ninho,numero_atual,especie,data_encontro,hora_desova,status,status_validacao,motivo_rejeicao,qtd_ovos,ovos_integros,ovos_descartados,descartados_natural,descartados_predacao,descartados_humana,dist_rio_m,dist_rio_metodo,temperatura_c,umidade_pct,profundidade_cm,observacoes,foto_urls,lat,lng,precisao_gps_m,criado_em,praia_id,praia_nome,praia_atual_id,praia_atual_nome,monitor_id,monitor_nome,data_nascimento,filhotes_vivos,filhotes_mortos,ovos_nao_nascidos')
        .eq('grupo_id', BioApp.monitor.grupo_id)
        .order('numero_atual', { ascending: false })
      if (filtroStatus) {
        q = q.eq('status', filtroStatus)
      } else {
        q = q.neq('status', 'perdido')
      }
      // Filtra pela praia onde o ninho está incubando AGORA (praia atual)
      if (filtroPraia) q = q.eq('praia_atual_id', filtroPraia.id)
      const { data, error } = await q
      if (error) throw error

      // Mescla: inclui ninhos locais pendentes que ainda não chegaram no servidor
      const localPend = await bioOfflineListarNinhos(filtroPraia ? { praiaAtualId: filtroPraia.id } : {})
      const uuidsServ = new Set((data ?? []).map(n => n.uuid_cliente).filter(Boolean))
      const praias    = await bioOfflineListarPraias()
      const locaisSo  = localPend
        .filter(n => !uuidsServ.has(n.uuid_cliente) && estaAberto(n))
        .map(n => ({ ...bioMapNinhoPraias(n, praias), monitor_nome: BioApp.monitor?.nome_completo, _local: true }))

      ninhos = [...locaisSo, ...(data ?? [])]
      estadoEl.hidden = true
    } catch (e) {
      console.warn('[biomonitor abertos]', e)
      estadoEl.textContent = 'Sem conexão — exibindo dados locais'
      const praias   = await bioOfflineListarPraias()
      const localAll = await bioOfflineListarNinhos(filtroPraia ? { praiaAtualId: filtroPraia.id } : {})
      ninhos = localAll.filter(estaAberto).map(n => bioMapNinhoPraias(n, praias))
    }
  } else {
    estadoEl.textContent = 'Offline — exibindo dados locais'
    const praias   = await bioOfflineListarPraias()
    const localAll = await bioOfflineListarNinhos(filtroPraia ? { praiaAtualId: filtroPraia.id } : {})
    ninhos = localAll.filter(estaAberto).map(n => bioMapNinhoPraias(n, praias))
  }

  // Card "precisam de correção": restringe aos devolvidos pelo gestor
  if (BioApp.abertosSoCorrecao) {
    ninhos = ninhos.filter(n => n.status_validacao === 'em_correcao')
  }

  if (!ninhos.length) {
    estadoEl.textContent = BioApp.abertosSoCorrecao
      ? 'Nenhum ninho aguardando correção.'
      : filtroPraia
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

  const corrHtml = n.status_validacao === 'em_correcao'
    ? `<div class="bio-nfc-rejeicao" style="background:#eef2ff;color:#4338ca">Correção solicitada: ${n.motivo_rejeicao ?? ''}</div>`
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

  // Resumo da eclosão (quando o ninho já eclodiu)
  const eclosaoHtml = (n.status === 'eclodido' && (n.filhotes_vivos != null || n.filhotes_mortos != null || n.data_nascimento)) ? `
    <div class="bio-nfc-ovos">
      <span style="background:rgba(82,183,136,.18);color:#1E6B4A">Eclosão${n.data_nascimento ? ' ' + new Date(n.data_nascimento + 'T12:00').toLocaleDateString('pt-BR') : ''}</span>
      ${n.filhotes_vivos    != null ? `<span style="background:rgba(82,183,136,.12);color:#1E6B4A">${n.filhotes_vivos} vivos</span>` : ''}
      ${n.filhotes_mortos             ? `<span style="background:rgba(220,38,38,.1);color:#DC2626">${n.filhotes_mortos} mortos</span>` : ''}
      ${n.ovos_nao_nascidos           ? `<span style="background:rgba(127,127,127,.12);color:#6B7280">${n.ovos_nao_nascidos} não nasc.</span>` : ''}
    </div>` : ''

  const localChip = n._local
    ? '<span class="bio-nfc-ev-chip" style="background:#a78bfa22;color:#7c3aed">pendente</span>'
    : ''

  // Número e praia ATUAIS (onde o ninho está incubando agora)
  const numExib   = n.numero_atual ?? n.numero_ninho ?? '—'
  const praiaExib = n.praia_atual_nome ?? n.praia_nome
  const transferido =
    (n.praia_atual_id && n.praia_id && n.praia_atual_id !== n.praia_id) ||
    (n.numero_atual && n.numero_ninho && n.numero_atual !== n.numero_ninho)
  const origemHtml = transferido
    ? `<div class="bio-nfc-origem" style="margin-top:5px;font-size:12px;font-weight:600;color:#7c3aed;background:#7c3aed14;border-radius:6px;padding:3px 8px;display:inline-block">Transferido de ${n.praia_nome ?? '—'}${n.numero_ninho ? ` · nº lá: ${n.numero_ninho}` : ''}</div>`
    : ''

  const acoesHtml = mostrarAcoes ? `
    <div class="bio-nfc-acoes">
      ${n.status_validacao === 'em_correcao' ? `<button class="bio-btn-sm prim" data-acao="corrigir">Corrigir</button>` : ''}
      ${status === 'encontrado' || status === 'transferido' ? `<button class="bio-btn-sm prim" data-acao="transferencia">+ Transferência</button>` : ''}
      ${status !== 'eclodido' && status !== 'perdido' ? `<button class="bio-btn-sm ghost" data-acao="eclosao">Eclosão</button>` : ''}
      ${status === 'eclodido' ? `<button class="bio-btn-sm prim" data-acao="soltar">Soltar</button>` : ''}
      ${status !== 'perdido' ? `<button class="bio-btn-sm ghost" data-acao="visita">Visita</button>` : ''}
    </div>` : ''

  return `
    <div class="bio-nfc-header">
      <span class="bio-nfc-num">#${numExib}</span>
      <span class="bio-nfc-status-badge ${status}">${bioLabels.status[status] ?? status}</span>
    </div>
    <div class="bio-nfc-especie">${esp ? `<strong>${esp.sigla}</strong> ${esp.nome}` : (n.especie ?? '—')}</div>
    <div class="bio-nfc-row">
      ${praiaExib ? `<span class="bio-nfc-praia">${praiaExib}</span>` : ''}
      <span class="bio-nfc-data">${data}</span>
    </div>
    ${origemHtml}
    ${rejHtml}
    ${corrHtml}
    ${ovosHtml}
    ${condicoesHtml}
    ${eclosaoHtml}
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
        if (btn.dataset.acao === 'corrigir')      bioAbrirCorrecaoNinho(n)
        if (btn.dataset.acao === 'transferencia') bioAbrirFormTransf(n)
        if (btn.dataset.acao === 'eclosao')       bioAbrirFormEclosao(n)
        if (btn.dataset.acao === 'visita')        bioAbrirFormVisita(n)
        if (btn.dataset.acao === 'soltar')        bioAbrirTelaDestino(n, null)
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
    const praia    = praias.find(p => p.id === (n.praia_atual_id ?? n.praia_id))
    const numExib  = n.numero_atual ?? n.numero_ninho
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
        <span class="bio-nfc-num">#${numExib ?? '—'}</span>
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

// Card na home: ninhos devolvidos pelo gestor para correção.
async function bioAtualizarCardCorrecao() {
  const card  = document.getElementById('bio-correcao-card')
  const count = document.getElementById('bio-correcao-count')
  if (!card) return
  let n = 0
  try {
    const todos = await bioOfflineListarNinhos({})
    n = todos.filter(x => x.status_validacao === 'em_correcao'
      && x.status !== 'eclodido' && x.status !== 'perdido').length
  } catch (_) {}
  card.hidden = n === 0
  if (count) count.textContent = `${n} ninho${n !== 1 ? 's' : ''}`
}

/* ════════════════════════════════════════════════════════════
   ABA DADOS — Chart.js + KPIs + taxas científicas
   ════════════════════════════════════════════════════════════ */

let _bioCharts = {}

function _bioDestruirCharts() {
  Object.values(_bioCharts).forEach(c => { try { c.destroy() } catch (_) {} })
  _bioCharts = {}
}

async function _bioCarregarChartJS() {
  if (window.Chart) return window.Chart
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js'
    s.onload = () => res(window.Chart)
    s.onerror = rej
    document.head.appendChild(s)
  })
}

function _bioSetText(id, val, suffix) {
  const el = document.getElementById(id)
  if (el) el.textContent = val != null ? val + (suffix || '') : '—'
}

function _bioSetRate(elId, barId, pct) {
  const el  = document.getElementById(elId)
  const bar = document.getElementById(barId)
  if (el)  el.textContent    = pct != null ? pct + '%' : '—'
  if (bar) bar.style.width   = pct != null ? Math.min(Math.max(pct, 0), 100) + '%' : '0%'
}

function _bioDonut(canvasId, labels, data, cores, Chart) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  _bioCharts[canvasId]?.destroy()
  _bioCharts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: cores, borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }] },
    options: {
      cutout: '62%',
      animation: { duration: 700 },
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } } }
    }
  })
}

function _bioBarsV(canvasId, labels, datasets, Chart) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  _bioCharts[canvasId]?.destroy()
  _bioCharts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: { legend: { display: datasets.length > 1, labels: { font: { size: 11 }, usePointStyle: true } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: 'rgba(0,0,0,.06)' }, ticks: { font: { size: 11 } }, beginAtZero: true }
      }
    }
  })
}

function _bioBarsH(canvasId, labels, data, cor, Chart) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  _bioCharts[canvasId]?.destroy()
  _bioCharts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: cor, borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,.06)' }, ticks: { font: { size: 11 } }, beginAtZero: true },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  })
}

function _bioLinha(canvasId, labels, datasets, Chart) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  _bioCharts[canvasId]?.destroy()
  _bioCharts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: { legend: { display: datasets.length > 1, labels: { font: { size: 11 }, usePointStyle: true } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: 'rgba(0,0,0,.06)' }, ticks: { font: { size: 11 } }, beginAtZero: true }
      },
      elements: { line: { tension: 0.35 }, point: { radius: 3, hoverRadius: 5 } }
    }
  })
}

function _bioRenderizarGraficos(d, Chart) {
  // ── Desfecho dos ovos (rosca – Tab Taxas)
  const df = d.desfecho_ovos || {}
  _bioDonut('chart-desfecho',
    ['Filhotes vivos', 'Filhotes mortos', 'Não nascidos', 'Descartados'],
    [df.filhotes_vivos || 0, df.filhotes_mortos || 0, df.ovos_nao_nascidos || 0, df.ovos_descartados || 0],
    ['#2A9D6F', '#DC2626', '#D97706', '#9CA3AF'],
    Chart
  )

  // ── Status dos ninhos (rosca – Tab Ninhos)
  const ps = d.por_status || {}
  _bioDonut('chart-status',
    ['Encontrado', 'Transferido', 'Eclodido', 'Perdido'],
    [ps.encontrado || 0, ps.transferido || 0, ps.eclodido || 0, ps.perdido || 0],
    ['#7ECEE8', '#C9A84C', '#2A9D6F', '#DC2626'],
    Chart
  )

  // ── Ninhos por espécie (barras verticais – Tab Ninhos)
  const esp = d.por_especie || []
  if (esp.length) {
    _bioBarsV('chart-especies',
      esp.map(e => e.especie || '?'),
      [{ data: esp.map(e => e.total || 0), backgroundColor: '#1A6B8C', borderRadius: 5, label: 'Ninhos' }],
      Chart
    )
  }

  // ── Ninhos por mês (linha – Tab Ninhos)
  const mes = d.por_mes || []
  if (mes.length) {
    _bioLinha('chart-mensal',
      mes.map(m => m.mes || ''),
      [
        { label: 'Ninhos',   data: mes.map(m => m.ninhos   || 0), borderColor: '#1A6B8C', backgroundColor: 'rgba(26,107,140,.12)', fill: true },
        { label: 'Filhotes', data: mes.map(m => m.filhotes || 0), borderColor: '#2A9D6F', backgroundColor: 'rgba(42,157,111,.10)', fill: true }
      ],
      Chart
    )
  }

  // ── Top praias (barras horizontais – Tab Ninhos)
  const pr = d.top_praias || []
  if (pr.length) {
    const wrapPraias = document.getElementById('chart-praias')?.closest('.bio-chart-wrap')
    if (wrapPraias) wrapPraias.style.height = (pr.length * 36 + 40) + 'px'
    _bioBarsH('chart-praias',
      pr.map(p => p.praia_nome || '?'),
      pr.map(p => p.total || 0),
      '#C9A84C',
      Chart
    )
  }

  // ── Destino dos filhotes (rosca – Tab Berçário)
  _bioDonut('chart-destino',
    ['Soltos direto ao rio', 'Via berçário'],
    [d.solturas_direto_rio || 0, d.solturas_via_bercario || 0],
    ['#1A6B8C', '#2A9D6F'],
    Chart
  )

  // ── Ocorrências no berçário por tipo (barras – Tab Berçário)
  const oc = d.ocorrencias_tipos || []
  if (oc.length) {
    _bioBarsV('chart-ocorrencias',
      oc.map(o => o.tipo || '?'),
      [{ data: oc.map(o => o.total || 0), backgroundColor: '#7ECEE8', borderRadius: 5, label: 'Ocorrências' }],
      Chart
    )
  }

  // ── Biometria ao longo do tempo (linha dupla – Tab Berçário)
  const bio = d.biometria_serie || []
  if (bio.length) {
    _bioLinha('chart-biometria',
      bio.map(b => b.data || ''),
      [
        { label: 'Comprimento (cm)', data: bio.map(b => b.comp_medio), borderColor: '#1A6B8C', backgroundColor: 'rgba(26,107,140,.08)', fill: false },
        { label: 'Peso (g)',          data: bio.map(b => b.peso_medio),  borderColor: '#C9A84C', backgroundColor: 'rgba(201,168,76,.08)',  fill: false }
      ],
      Chart
    )
  }
}

async function bioCarregarTelaDados() {
  bioMostrarTela('tela-dados')

  // Wire tab switching (idempotente)
  const tabsEl = document.querySelector('.bio-dados-tabs')
  if (tabsEl && !tabsEl._wired) {
    tabsEl._wired = true
    tabsEl.addEventListener('click', e => {
      const btn = e.target.closest('.bio-dados-tab')
      if (!btn) return
      tabsEl.querySelectorAll('.bio-dados-tab').forEach(b => b.classList.remove('ativa'))
      btn.classList.add('ativa')
      const tabId = btn.dataset.dtab
      document.querySelectorAll('#tela-dados [id^="bio-dtab-"]').forEach(d => {
        d.hidden = d.id !== 'bio-dtab-' + tabId && d.id !== 'bio-dtab-local'
      })
    })
  }

  // Seletor de temporada (default: atual). Popula 1x quando online.
  const selTemp = document.getElementById('bio-dados-temporada')
  if (selTemp && !selTemp._wired) {
    selTemp._wired = true
    selTemp.addEventListener('change', () => bioCarregarTelaDados())
  }
  if (selTemp && !selTemp.dataset.populado && navigator.onLine) {
    try {
      const prog = BioApp.temporadaAtual?.programa_id
      let q = bioSupabase().from('temporadas_biomonitor').select('id,nome,ano_base,is_atual').order('ano_base', { ascending: false })
      if (prog) q = q.eq('programa_id', prog)
      const { data: temps } = await q
      if (temps?.length) {
        const atualId = BioApp.temporadaAtual?.id
        selTemp.innerHTML = temps.map(t =>
          `<option value="${t.id}"${(t.is_atual || t.id === atualId) ? ' selected' : ''}>${t.nome || ('Temporada ' + t.ano_base)}</option>`).join('')
        selTemp.dataset.populado = '1'
      }
    } catch (_) {}
  }
  const _tempDados = selTemp?.value || BioApp.temporadaAtual?.id || null

  // Dados locais (sempre disponíveis)
  const ninhos = await bioOfflineListarNinhos()
  _bioSetText('bio-kpi-ninhos-local', ninhos.length)
  _bioSetText('bio-kpi-eclodidos-local', ninhos.filter(n => n.status === 'eclodido').length)

  const statusEl = document.getElementById('bio-dados-status')

  if (!navigator.onLine) {
    if (statusEl) statusEl.textContent = 'offline'
    return
  }

  if (statusEl) statusEl.textContent = 'carregando…'

  try {
    const { data, error } = await bioSupabase().rpc('bio_dados_aba', { p_temporada_id: _tempDados })
    if (error || !data) {
      if (statusEl) statusEl.textContent = error ? 'erro' : 'sem dados'
      return
    }

    if (statusEl) statusEl.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

    // KPIs — Tab Taxas
    _bioSetText('bio-kpi-ninhos',    data.grupo_ninhos)
    _bioSetText('bio-kpi-filhotes',  data.filhotes_vivos)
    _bioSetText('bio-kpi-incubacao', data.incubacao_media_dias, ' d')

    // KPIs — Tab Ninhos
    const ps = data.por_status || {}
    _bioSetText('bio-kpi2-eclodidos', ps.eclodido ?? data.eclodidos)
    _bioSetText('bio-kpi2-perdidos',  ps.perdido)
    _bioSetText('bio-kpi2-transf',    ps.transferido)

    // KPIs — Tab Berçário
    _bioSetText('bio-kpi-berc-entrada', data.bercario_total_entrada)
    _bioSetText('bio-kpi-berc-soltado', data.bercario_total_soltado)
    _bioSetText('bio-kpi-berc-mortos',  data.bercario_mortalidade)

    // Taxas científicas
    _bioSetRate('bio-r-eclosao',       'bio-rb-eclosao',       data.taxa_eclosao_pct)
    _bioSetRate('bio-r-sucesso',       'bio-rb-sucesso',       data.taxa_sucesso_nidificacao_pct)
    _bioSetRate('bio-r-fertilidade',   'bio-rb-fertilidade',   data.taxa_fertilidade_pct)
    _bioSetRate('bio-r-eficiencia',    'bio-rb-eficiencia',    data.eficiencia_ninho_pct)
    _bioSetRate('bio-r-predacao',      'bio-rb-predacao',      data.taxa_predacao_pct)
    _bioSetRate('bio-r-transferencia', 'bio-rb-transferencia', data.taxa_transferencia_pct)
    _bioSetRate('bio-r-sobrev-berc',   'bio-rb-sobrev-berc',   data.taxa_sobrevivencia_bercario_pct)
    _bioSetRate('bio-r-mort-berc',     'bio-rb-mort-berc',     data.taxa_mortalidade_bercario_pct)

    // Gráficos (carrega Chart.js lazily na primeira vez)
    const Chart = await _bioCarregarChartJS()
    _bioRenderizarGraficos(data, Chart)

  } catch (err) {
    if (statusEl) statusEl.textContent = 'erro ao carregar'
  }
}

/* ════════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════════ */
const BIO_VERSAO = '1.2.0'
const BIO_INSTALL_URL = 'https://siguc-ac.vercel.app/pages/instalar-biomonitor.html'

// Número real do build = versão declarada no sw.js do servidor (sempre atual).
// Fallback: maior cache instalado no aparelho.
async function bioVersaoBuild() {
  try {
    const r = await fetch('/pwa/sw.js', { cache: 'no-store' })
    const txt = await r.text()
    const m = txt.match(/siguc-brigadas-v(\d+)/)
    if (m) return 'v' + m[1]
  } catch (_) {}
  try {
    if (!('caches' in window)) return null
    const keys = await caches.keys()
    const vers = keys
      .map(k => (k.match(/siguc-brigadas-v(\d+)/) || [])[1])
      .filter(Boolean)
      .map(Number)
    if (vers.length) return 'v' + Math.max(...vers)
  } catch (_) {}
  return null
}

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

  // SW já instalado em waiting → atualização pronta, só precisa ativar
  if (reg.waiting) {
    bioToast('Atualização disponível — aplicando…', 'ok')
    reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload())
    return
  }

  // Busca nova versão no servidor
  let achou = false
  reg.addEventListener('updatefound', () => {
    achou = true
    const nw = reg.installing
    if (!nw) return
    nw.addEventListener('statechange', () => {
      if (nw.state === 'installed' && navigator.serviceWorker.controller) {
        // Nova versão baixada e pronta
        bioToast('Atualização baixada — aplicando…', 'ok')
        nw.postMessage({ type: 'SKIP_WAITING' })
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload())
      } else if (nw.state === 'installed') {
        // Primeira instalação (sem SW anterior) — reload normal
        location.reload()
      }
    })
  })

  try { await reg.update() } catch (e) { console.warn('[bio-update]', e) }

  // Se em 4 s nenhum updatefound → versão instalada é a mais recente
  setTimeout(() => {
    if (!achou) {
      const buildAtual = document.getElementById('bio-app-versao')?.textContent ?? ''
      bioToast(`Tudo certo — ${buildAtual.trim() || 'app atualizado'}`, 'ok')
    }
  }, 4000)
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

async function bioCarregarConfigGPS() {
  BioApp.cfgFormatoCoords = await bioOfflineGetConfig('gps_formato_coords') ?? 'decimal'
  BioApp.cfgGpsModo       = await bioOfflineGetConfig('gps_modo')           ?? 'padrao'

  function ativarChips(grupoId, valorAtual, chaveConfig, appProp) {
    document.querySelectorAll(`#${grupoId} .bio-chip-cfg`).forEach(btn => {
      btn.classList.toggle('ativo', btn.dataset.val === valorAtual)
      btn.addEventListener('click', async () => {
        BioApp[appProp] = btn.dataset.val
        await bioOfflineSetConfig(chaveConfig, btn.dataset.val)
        document.querySelectorAll(`#${grupoId} .bio-chip-cfg`).forEach(b =>
          b.classList.toggle('ativo', b === btn)
        )
      })
    })
  }

  ativarChips('bio-cfg-formato-coords', BioApp.cfgFormatoCoords, 'gps_formato_coords', 'cfgFormatoCoords')
  ativarChips('bio-cfg-gps-modo',       BioApp.cfgGpsModo,       'gps_modo',           'cfgGpsModo')
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
  // Fotos com marca d'água nos demais formulários
  bioIniciarFotosGenerica({ prefixo:'ecl',   max:3, getState:() => BioApp._fotosEcl ?? [],   setFotos:f => { BioApp._fotosEcl = f } })
  bioIniciarFotosGenerica({ prefixo:'vis',   max:3, getState:() => BioApp._fotosVis ?? [],   setFotos:f => { BioApp._fotosVis = f } })
  bioIniciarFotosGenerica({ prefixo:'transf',max:3, getState:() => BioApp._fotosTransf ?? [],setFotos:f => { BioApp._fotosTransf = f } })
  bioIniciarFotosGenerica({ prefixo:'sol',   max:3, getState:() => BioApp._fotosSol ?? [],   setFotos:f => { BioApp._fotosSol = f } })
  bioIniciarFotosGenerica({ prefixo:'oc',    max:2, getState:() => BioApp._fotosOc ?? [],    setFotos:f => { BioApp._fotosOc = f } })
  bioIniciarContadores()
  bioIniciarFormVisita()
  bioIniciarPosEclosao()
  bioIniciarConfig()
  bioCarregarConfigGPS()

  // Alertas científicos de incubação (avaliação ao vivo, offline)
  if (typeof bioCarregarLimiaresCache === 'function') bioCarregarLimiaresCache()
  if (typeof bioIniciarAlertasNinho  === 'function') bioIniciarAlertasNinho()
  if (typeof bioIniciarAlertasVisita === 'function') bioIniciarAlertasVisita()

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
  document.getElementById('bio-transf-praia-btn')?.addEventListener('click', bioEscolherPraiaDestino)
  document.getElementById('bio-transf-data')?.addEventListener('input', bioAtualizarSemaforoJanela)
  document.getElementById('bio-transf-hora')?.addEventListener('input', bioAtualizarSemaforoJanela)
  document.getElementById('bio-btn-salvar-eclosao')?.addEventListener('click', bioSalvarEclosao)

  // Descarte de ovos: mostra a quebra por causa quando há descartados
  ;['bio-form-ovos-descartados','bio-form-desc-natural','bio-form-desc-predacao','bio-form-desc-humana']
    .forEach(id => document.getElementById(id)?.addEventListener('input', bioAtualizarDescarteBox))

  // Chips de espécie
  document.querySelectorAll('.bio-especie-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.bio-especie-chip').forEach(c => c.classList.remove('sel'))
      chip.classList.add('sel')
    })
    // Auto-numeração: (re)gera o número ao escolher/trocar a espécie
    chip.addEventListener('click', () => { bioAtualizarNumeroNinhoAuto() })
  })

  // Botão "Editar" → libera a edição manual do número do ninho
  document.getElementById('bio-form-numero-edit')?.addEventListener('click', () => {
    BioApp.numeroManual = true
    const campo = document.getElementById('bio-form-numero')
    if (campo) { campo.readOnly = false; campo.focus() }
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

  // Versão exibida = número do cache do service worker (sobe automaticamente
  // a cada deploy, sem manutenção manual). Fallback: constante BIO_VERSAO.
  const versaoEl = document.getElementById('bio-app-versao')
  if (versaoEl) {
    const build = await bioVersaoBuild()
    versaoEl.textContent = build
      ? `Biomonitor Quelônios · ${build}`
      : `Biomonitor Quelônios v${BIO_VERSAO}`
  }
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
