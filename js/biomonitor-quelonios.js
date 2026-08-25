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
  ocorrenciaIndividuoCtx: null,   // { individuo, tipo } quando a ocorrência vem de marcar doente/óbito
  transfPraiaDestino: null,       // praia de destino selecionada na transferência
  transfOcupacao: null,           // { ocupados[], seq_min, seq_max, proximo_livre, parcial }
}

// Espécies de quelônios (sigla, nome, científico). Vem do catálogo
// editável (tabela especies_quelonio_catalogo, aba "Espécies" em
// admin-biomonitor.html) — este array só serve de fallback caso o
// app abra offline antes de ter cache local salvo.
let BIO_ESPECIES = [
  { id: 'tracaja',   sigla: 'TR',  nome: 'Tracajá',            nome_cientifico: 'Podocnemis unifilis',       incubacao_dias: 68 },
  { id: 'tartaruga', sigla: 'TA',  nome: 'Tartaruga',          nome_cientifico: 'Podocnemis expansa',        incubacao_dias: 55 },
  { id: 'cabecudo',  sigla: 'R',   nome: 'Cabeçudo',           nome_cientifico: 'Podocnemis sextuberculata', incubacao_dias: 52 },
  { id: 'pitiU',     sigla: 'C',   nome: 'Pitiú',              nome_cientifico: 'Podocnemis erythrocephala', incubacao_dias: 70 },
  { id: 'mucua',     sigla: 'MU',  nome: 'Muçuã',              nome_cientifico: 'Kinosternon scorpioides',   incubacao_dias: 135 },
  { id: 'jabuti_pe_elefante', sigla: 'JE', nome: 'Jabuti-pé-de-elefante', nome_cientifico: 'Chelonoidis denticulatus', incubacao_dias: 140 },
  { id: 'jabuti_piranga',     sigla: 'JP', nome: 'Jabuti-piranga',       nome_cientifico: 'Chelonoidis carbonarius',  incubacao_dias: 140 },
  { id: 'outro',     sigla: 'OU',  nome: 'Outro',              nome_cientifico: '',                          incubacao_dias: 65 },
]

// ── Catálogo de espécies (editável) ──────────────────────────
async function bioCarregarEspecies() {
  try {
    const { data, error } = await bioSupabase()
      .from('especies_quelonio_catalogo')
      .select('codigo,nome_popular,nome_cientifico,sigla_placa,ordem,incubacao_dias_media')
      .eq('ativo', true)
      .order('ordem')
    if (error) throw error
    if (data?.length) {
      BIO_ESPECIES = data.map(e => ({
        id: e.codigo, sigla: e.sigla_placa || '?', nome: e.nome_popular, nome_cientifico: e.nome_cientifico || '',
        incubacao_dias: e.incubacao_dias_media ?? 65,
      }))
      await bioOfflineSetConfig('especies_quelonio_catalogo', BIO_ESPECIES)
    }
  } catch {
    const cache = await bioOfflineGetConfig('especies_quelonio_catalogo').catch(() => null)
    if (cache?.length) BIO_ESPECIES = cache
  }
  bioRenderEspecieChips()
}

function bioRenderEspecieChips() {
  const grid = document.getElementById('bio-especie-grid')
  if (!grid) return
  const selecionada = grid.querySelector('.bio-especie-chip.sel')?.dataset.esp
  grid.innerHTML = BIO_ESPECIES.map(e => `
    <button class="bio-especie-chip${e.id === selecionada ? ' sel' : ''}" data-esp="${e.id}" type="button">
      <div class="bio-esp-ico"><span class="bio-esp-sigla">${esc(e.sigla)}</span></div>
      ${esc(e.nome)}
    </button>`).join('')
}

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

    if (!window._bioDB_client) {
      btn.disabled = false; btn.textContent = 'Entrar'
      erroEl.textContent = 'Sem conexão com o servidor. Verifique sua internet e tente novamente.'
      erroEl.hidden = false
      return
    }

    let error
    try {
      ({ error } = await bioSupabase().auth.signInWithPassword({ email, password: senha }))
    } catch (e) {
      console.error('[biomonitor] falha no login:', e)
      btn.disabled = false; btn.textContent = 'Entrar'
      erroEl.textContent = 'Não foi possível conectar. Verifique sua internet e tente novamente.'
      erroEl.hidden = false
      return
    }
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

    const btn = document.getElementById('bio-btn-trocar-senha')
    const btnTextoOriginal = btn.textContent
    btn.disabled = true; btn.textContent = 'Salvando…'

    const { error } = await bioSupabase().auth.updateUser({ password: s1 })
    if (error) {
      btn.disabled = false; btn.textContent = btnTextoOriginal
      erroEl.textContent = error.message || 'Erro ao salvar senha. Tente novamente.'; erroEl.hidden = false
      return
    }

    if (BioApp.monitor?.id) {
      await bioSupabase().from('monitores_biodiversidade')
        .update({ deve_trocar_senha: false })
        .eq('id', BioApp.monitor.id)
      BioApp.monitor.deve_trocar_senha = false
    }

    btn.disabled = false; btn.textContent = btnTextoOriginal
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
  let primeiroPin = null
  const dicaEl = document.getElementById('bio-pin-setup-dica')
  const erroEl = document.getElementById('pin-setup-erro')

  bioIniciarKeypad('pin-setup', async (pin) => {
    if (!primeiroPin) {
      primeiroPin = pin
      if (dicaEl) dicaEl.textContent = 'Confirme seu PIN de 4 dígitos'
      return
    }
    if (pin !== primeiroPin) {
      if (erroEl) { erroEl.textContent = 'PINs não coincidem. Tente novamente.'; erroEl.hidden = false }
      primeiroPin = null
      if (dicaEl) dicaEl.textContent = 'Escolha um PIN de 4 dígitos'
      return
    }
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

  document.getElementById('bio-btn-esqueci-pin')?.addEventListener('click', async () => {
    if (!confirm('Descartar o PIN deste aparelho e entrar novamente com e-mail e senha? É necessário ter internet.')) return
    await bioOfflineDelConfig('pin_hash')
    await bioOfflineDelConfig('monitor')
    BioApp.monitor = null
    try { await bioSupabase().auth.signOut() } catch {}
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
  const letraEl  = document.getElementById('bio-home-avatar-letra')
  const inicial  = (monitor.nome_completo ?? 'M')[0].toUpperCase()
  avatarEl.style.backgroundImage = ''
  letraEl.textContent = inicial
  // Bucket privado (migration 210): a foto exige assinar, que exige
  // rede. Offline — o estado normal deste app — fica a inicial.
  if (monitor.foto_url) {
    fotoUrlAssinada(monitor.foto_url).then(u => {
      if (!u) return
      avatarEl.style.backgroundImage = `url("${u}")`
      letraEl.textContent = ''
    })
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
    cfgAvatarEl.style.backgroundImage = ''
    cfgAvatarEl.textContent = (monitor.nome_completo ?? 'M')[0].toUpperCase()
    if (monitor.foto_url) {
      fotoUrlAssinada(monitor.foto_url).then(u => {
        if (!u) return
        cfgAvatarEl.style.backgroundImage = `url("${u}")`
        cfgAvatarEl.textContent = ''
      })
    }
  }
  // Moldura/menu "Ver foto / Trocar foto" únicos (js/avatar-foto.js) —
  // antes o card ia direto para o seletor de arquivo, sem opção de ver.
  if (typeof avatarFotoRegistrar === 'function') {
    avatarFotoRegistrar('bio-config-avatar', {
      temFoto: () => !!BioApp.monitor?.foto_url,
      verFoto: async () => BioApp.monitor?.foto_url ? await fotoUrlAssinada(BioApp.monitor.foto_url) : null,
      trocarFoto: () => bioAlterarFotoMonitor(),
    })
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

  // Aviso de privacidade do app (LGPD Art. 9º, migration 213) —
  // offline-safe, ver js/lgpd-campo.js.
  lgpdCampoIniciar()
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

  // Método de contagem de ovos — default 'contado' em todo ninho novo
  BioApp.contagemOvosMetodo = 'contado'
  document.querySelectorAll('.bio-metodo-ovos-chip').forEach(c =>
    c.classList.toggle('ativo', c.dataset.metodoOvos === 'contado'))
  const _dicaOvos = document.getElementById('bio-ovos-metodo-dica')
  if (_dicaOvos) _dicaOvos.hidden = true

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

  // Método de contagem de ovos — preserva o que já foi salvo (correção
  // não recomeça a decisão contado/estimado do zero)
  BioApp.contagemOvosMetodo = ninho.contagem_ovos_metodo ?? 'contado'
  document.querySelectorAll('.bio-metodo-ovos-chip').forEach(c =>
    c.classList.toggle('ativo', c.dataset.metodoOvos === BioApp.contagemOvosMetodo))
  const _dicaOvosEdit = document.getElementById('bio-ovos-metodo-dica')
  if (_dicaOvosEdit) _dicaOvosEdit.hidden = BioApp.contagemOvosMetodo !== 'estimado'

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
      BioApp.formNinho.foto_urls.forEach(async url => {
        const img = document.createElement('img')
        img.src = await fotoUrlAssinada(url) || url
        grid.appendChild(img)
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
    contagem_ovos_metodo: BioApp.contagemOvosMetodo ?? 'contado',
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
// Nome da praia do ninho em edição/contexto atual, para a marca d'água.
function bioNomePraiaDoNinhoAtual() {
  const ninho = BioApp.formNinhoAtualizar
  const nome = ninho?.praia_atual_nome ?? ninho?.praia_nome
  return nome ? `Praia: ${nome}` : null
}

function bioIniciarFotosGenerica({ prefixo, max, getState, setFotos, getContexto }) {
  const grid    = document.getElementById(`bio-${prefixo}-foto-grid`)
  const btnCam  = document.getElementById(`bio-${prefixo}-btn-camera`)
  const inp     = document.getElementById(`bio-${prefixo}-input-foto`)
  const countEl = document.getElementById(`bio-${prefixo}-foto-count`)
  if (!grid || !btnCam || !inp || !countEl) return null
  // Galeria é opcional — só forms que tiverem o par botão+input ganham a
  // opção (hoje só o cadastro de ninho, prefixo 'form'). Mesma marca
  // d'água/pipeline da câmera: o arquivo entra pelo MESMO processarArquivos.
  const btnGal = document.getElementById(`bio-${prefixo}-btn-galeria`)
  const inpGal = document.getElementById(`bio-${prefixo}-input-foto-galeria`)

  function atualizarGrid() {
    const fotos = getState() ?? []
    countEl.textContent = `(${fotos.length}/${max})`
    grid.innerHTML = ''
    fotos.forEach(async (url, i) => {
      const img = document.createElement('img')
      img.src = await fotoUrlAssinada(url) || url
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

  async function processarArquivos(fileList, inputEl) {
    const fotos = getState() ?? []
    const monitor = BioApp.monitor
    const gps = typeof bGpsAtual === 'function' ? bGpsAtual() : null
    const logos = await bioOfflineGetConfig('bio_logos_cache_v1').catch(() => null)
    const ctxExtra = typeof getContexto === 'function' ? (getContexto() ?? {}) : {}
    for (const file of Array.from(fileList ?? [])) {
      if (fotos.length >= max) break
      let dataUrl
      if (typeof bCapturaProcessarArquivo === 'function') {
        try {
          const blob = await bCapturaProcessarArquivo(
            file,
            { nome: monitor?.nome_completo ?? 'Monitor' },
            gps,
            {
              brigada: monitor?.grupo_nome ?? null,
              tipoOcorrencia: ctxExtra.tipoOcorrencia ?? null,
              local: ctxExtra.local ?? null,
              logos,
            }
          )
          dataUrl = await new Promise(res => {
            const r = new FileReader()
            r.onload = e => res(e.target.result)
            r.readAsDataURL(blob)
          })
        } catch (err) {
          console.warn('[biomonitor] falha ao aplicar marca d\'água, salvando foto original:', err)
          bioToast(`Falha na marca d'água (foto salva sem marca): ${err?.message || err}`, 'err')
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
    inputEl.value = ''
  }

  btnCam.addEventListener('click', () => inp.click())
  inp.addEventListener('change', () => processarArquivos(inp.files, inp))
  if (btnGal && inpGal) {
    btnGal.addEventListener('click', () => inpGal.click())
    inpGal.addEventListener('change', () => processarArquivos(inpGal.files, inpGal))
  }

  return { atualizarGrid }
}

// ── Fotos no formulário de ninho ──────────────────────────────
function bioIniciarFotosForm() {
  bioIniciarFotosGenerica({
    prefixo:  'form',
    max:      3,
    getState: () => BioApp.formNinho?.foto_urls ?? [],
    setFotos: f  => { if (BioApp.formNinho) BioApp.formNinho.foto_urls = f },
    getContexto: () => ({
      tipoOcorrencia: 'Encontro de Ninho',
      local: BioApp.praiaAtual?.nome ? `Praia: ${BioApp.praiaAtual.nome}` : null,
    }),
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
  // Não se pode transferir mais ovos do que foram encontrados no ninho
  // — EXCETO quando a postura foi ESTIMADA: aqui é onde os ovos são de
  // fato contados um a um, então divergir é o esperado, não um erro
  // (ver "Regra do sistema — postura de ovos por estimativa").
  const estimado   = ninho.contagem_ovos_metodo === 'estimado'
  const limiteOvos = ninho.ovos_integros ?? ninho.qtd_ovos ?? null
  const ovosInp    = document.getElementById('bio-transf-ovos')
  const ovosHint   = document.getElementById('bio-transf-ovos-hint')
  if (limiteOvos != null) {
    if (!estimado) ovosInp.max = limiteOvos
    else ovosInp.removeAttribute('max')
    const base = ninho.ovos_integros != null ? 'íntegros' : 'encontrados'
    ovosHint.textContent = estimado
      ? `Postura estimada em ${limiteOvos} ovos (${base}) — conte os ovos ao transferir; a postura do ninho será corrigida para o número real.`
      : `Máximo ${limiteOvos} ovos (${base} no ninho).`
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
  BioApp.transfOcupacao = null
  const nomeEl = document.getElementById('bio-transf-praia-nome')
  nomeEl.textContent = 'Selecionar praia…'
  nomeEl.style.opacity = '.6'
  document.getElementById('bio-transf-praia-id').value = ''
  bioResetOcupacaoPainel()
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

    const inp   = document.getElementById('bio-transf-numero')
    const ninho = BioApp.formNinhoAtualizar
    if (inp) inp.value = '…'

    // Inteligência na transferência: consulta os ninhos já cadastrados na
    // praia de destino para a temporada/espécie, mostra ocupados, intervalo
    // e sugere o próximo número livre (pré-preenchido, editável).
    const oc = await bioCarregarOcupacaoDestino(praia, ninho?.especie)
    BioApp.transfOcupacao = oc
    bioRenderOcupacaoPainel(oc)
    if (inp) inp.value = oc?.proximo_livre
      ?? await bioGerarNumeroNinho(praia.id, ninho.especie, 'numero_atual')
    bioValidarNumeroDestino()
  })
}

/* ════════════════════════════════════════════════════════════
   OCUPAÇÃO DA PRAIA DE DESTINO (inteligência na transferência)
   ════════════════════════════════════════════════════════════ */
// Devolve { ocupados:[{numero_atual, seq, especie, status}], seq_min,
// seq_max, proximo_livre, parcial }. Online usa a RPC bio_ninhos_ocupados
// (enxerga berçários de outros grupos); offline cai para o IndexedDB local.
async function bioCarregarOcupacaoDestino(praia, especie) {
  const temporadaId = BioApp.temporadaAtual?.id ?? null
  // Online: fonte de verdade (destino costuma ser de outro grupo)
  if (navigator.onLine && window._bioDB_client) {
    try {
      const { data, error } = await bioSupabase().rpc('bio_ninhos_ocupados', {
        p_praia_id: praia.id, p_temporada_id: temporadaId, p_especie: especie ?? null,
      })
      if (!error && data) return { ...data, parcial: false }
    } catch { /* cai para offline */ }
  }
  // Offline: só enxerga ninhos do próprio grupo → lista parcial
  const locais = await bioOfflineListarNinhos({ praiaAtualId: praia.id })
  const ocupados = locais
    .filter(n => (!especie || n.especie === especie)
      && !['perdido', 'soltado'].includes(n.status)
      && (!temporadaId || (n.temporada_id ?? temporadaId) === temporadaId))
    .map(n => {
      const num = n.numero_atual ?? n.numero_ninho ?? ''
      const seq = parseInt((num.split('-').pop()) || '', 10)
      return { ninho_id: n.server_id ?? n.id ?? null, numero_atual: num,
        seq: Number.isFinite(seq) ? seq : null, especie: n.especie, status: n.status }
    })
    .sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9))
  const seqs = ocupados.map(o => o.seq).filter(Number.isFinite)
  return {
    ocupados,
    seq_min: seqs.length ? Math.min(...seqs) : null,
    seq_max: seqs.length ? Math.max(...seqs) : null,
    proximo_livre: await bioGerarNumeroNinho(praia.id, especie, 'numero_atual'),
    parcial: true,
  }
}

/* ════════════════════════════════════════════════════════════
   PREVISÃO DE ECLOSÃO (por espécie)
   ════════════════════════════════════════════════════════════ */
// Usa a data prevista armazenada (vw_ninhos_validacao) quando existe;
// senão calcula localmente com data_encontro + incubação da espécie
// (offline-safe). Devolve { dataTxt, dias, faixa, texto } ou null.
function bioPrevisaoEclosao(n) {
  if (!n?.data_encontro) return null
  let prevista = n.data_prevista_eclosao
  if (!prevista) {
    const esp  = BIO_ESPECIES.find(e => e.id === n.especie)
    const dias = n.incubacao_dias_previstos ?? esp?.incubacao_dias ?? 65
    const d = new Date(n.data_encontro + 'T12:00')
    if (isNaN(d)) return null
    d.setDate(d.getDate() + dias)
    prevista = d.toISOString().slice(0, 10)
  }
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0)
  const alvo = new Date(prevista + 'T12:00')
  if (isNaN(alvo)) return null
  const dias = Math.round((alvo - hoje) / 86400000)
  let faixa, texto
  if (dias < 0)       { faixa = 'atrasado'; texto = `atrasada há ${-dias} dia(s)` }
  else if (dias === 0){ faixa = 'hoje';     texto = 'prevista para hoje' }
  else if (dias <= 7) { faixa = 'atencao';  texto = `faltam ${dias} dia(s)` }
  else                { faixa = 'normal';   texto = `faltam ${dias} dias` }
  return { dataTxt: alvo.toLocaleDateString('pt-BR'), dias, faixa, texto }
}

function bioResetOcupacaoPainel() {
  const wrap = document.getElementById('bio-transf-ocupacao-wrap')
  if (wrap) wrap.hidden = true
  const alerta = document.getElementById('bio-transf-numero-alerta')
  if (alerta) alerta.style.display = 'none'
  const busca = document.getElementById('bio-transf-ocupacao-busca')
  if (busca) busca.value = ''
}

function bioRenderOcupacaoPainel(oc, filtro = '') {
  const wrap = document.getElementById('bio-transf-ocupacao-wrap')
  if (!wrap || !oc) return
  wrap.hidden = false
  const total = oc.total ?? oc.ocupados?.length ?? 0
  const intervalo = (oc.seq_min != null && oc.seq_max != null)
    ? `${String(oc.seq_min).padStart(3, '0')}–${String(oc.seq_max).padStart(3, '0')}`
    : '—'
  const resumo = document.getElementById('bio-transf-ocupacao-resumo')
  if (resumo) {
    resumo.innerHTML =
      `<b>${total}</b> ninho(s) na praia · intervalo <b>${intervalo}</b>` +
      (oc.proximo_livre ? ` · próximo livre <b>${esc(oc.proximo_livre)}</b>` : '') +
      (oc.parcial ? ` <span style="color:#9a6b00">(lista parcial — offline)</span>` : '')
  }
  const q = (filtro || '').trim().toLowerCase()
  const lista = (oc.ocupados || []).filter(o =>
    !q || String(o.numero_atual).toLowerCase().includes(q) || String(o.seq ?? '').includes(q))
  const listaEl = document.getElementById('bio-transf-ocupacao-lista')
  if (listaEl) {
    listaEl.innerHTML = lista.length
      ? lista.map(o => `<span class="bio-ocupacao-chip" title="${esc(o.status || '')}">${esc(o.numero_atual)}</span>`).join('')
      : `<span style="opacity:.6;font-size:13px">Nenhum ninho ${q ? 'encontrado' : 'nesta praia ainda'}.</span>`
  }
}

// Retorna o número ocupado que colide com `num`, ou null se estiver livre.
function bioNumeroOcupado(num) {
  const alvo = (num || '').trim()
  if (!alvo || !BioApp.transfOcupacao?.ocupados) return null
  const ninho = BioApp.formNinhoAtualizar
  const hit = BioApp.transfOcupacao.ocupados.find(o =>
    o.numero_atual === alvo && o.ninho_id !== (ninho?.server_id ?? ninho?.id))
  return hit ? hit.numero_atual : null
}

// Valida em tempo real o número digitado; sinaliza duplicidade e oferece
// o próximo livre com 1 clique.
function bioValidarNumeroDestino() {
  const alerta = document.getElementById('bio-transf-numero-alerta')
  const inp    = document.getElementById('bio-transf-numero')
  if (!alerta || !inp) return
  const ocupado = bioNumeroOcupado(inp.value)
  if (ocupado) {
    const livre = BioApp.transfOcupacao?.proximo_livre
    alerta.style.display = 'block'
    alerta.innerHTML =
      `Número <b>${esc(ocupado)}</b> já está em uso nesta praia.` +
      (livre ? ` <button type="button" id="bio-transf-usar-livre" class="bio-btn-sm prim" style="margin-left:6px">Usar ${esc(livre)}</button>` : '')
    document.getElementById('bio-transf-usar-livre')?.addEventListener('click', () => {
      inp.value = livre
      bioValidarNumeroDestino()
    })
    inp.style.borderColor = '#b3261e'
  } else {
    alerta.style.display = 'none'
    inp.style.borderColor = ''
  }
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
  // (fallback: total encontrado) — EXCETO quando a postura foi ESTIMADA:
  // aqui é onde os ovos são de fato contados um a um, então divergir é
  // esperado e corrige a postura (abaixo), nunca bloqueia (ver "Regra do
  // sistema — postura de ovos por estimativa").
  const estimado   = ninho?.contagem_ovos_metodo === 'estimado'
  const limiteOvos = ninho?.ovos_integros ?? ninho?.qtd_ovos ?? null
  if (!estimado && limiteOvos != null && ovos > limiteOvos) {
    const base = ninho?.ovos_integros != null ? 'íntegros' : 'encontrados'
    bioToast(`Máximo ${limiteOvos} ovos (${base} no ninho). Não é possível transferir mais do que foi encontrado.`, 'err')
    return
  }
  if (!destino)        { bioToast('Selecione a praia de destino.', 'err'); return }
  if (!numeroAtual)    { bioToast('Informe o número do ninho no destino.', 'err'); return }

  // Validação inteligente: número já ocupado no destino → bloqueia e
  // sugere o próximo livre (o botão de aceite fica no alerta inline).
  const ocupado = bioNumeroOcupado(numeroAtual)
  if (ocupado) {
    bioValidarNumeroDestino()
    const livre = BioApp.transfOcupacao?.proximo_livre
    bioToast(`Número ${ocupado} já está em uso na praia de destino.` +
      (livre ? ` Sugerido: ${livre}.` : ''), 'err')
    return
  }

  // Janela crítica: alerta (não bloqueia) se passou de 12 h desde a desova
  const janela = bioCalcularJanelaHoras(ninho, data, hora)
  if (janela != null && janela > 12) {
    if (!confirm(`Esta transferência está ~${janela.toFixed(1)} h após a desova, fora da janela segura (~12 h). `
      + `O embrião pode já estar aderido à casca e morrer com o manuseio.\n\nRegistrar mesmo assim?`)) return
  }

  // Postura estimada: a contagem feita ao transferir corrige a postura
  // do ninho (mesmo mecanismo da eclosão) — só quando diverge do que
  // estava estimado, para não gerar correção redundante idêntica.
  const posturaCorrigida = (estimado && ovos !== ninho.qtd_ovos) ? ovos : null

  const transf = {
    uuid_cliente:       bioUuid(),
    ninho_uuid:         ninho.uuid_cliente,
    ninho_numero:       ninho.numero_ninho,
    data_transferencia: data,
    hora_transferencia: hora,
    qtd_ovos:           ovos,
    postura_corrigida:  posturaCorrigida,
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
    ...(posturaCorrigida != null ? {
      qtd_ovos_estimado_original: ninho.qtd_ovos_estimado_original ?? ninho.qtd_ovos,
      qtd_ovos:                   posturaCorrigida,
      contagem_ovos_metodo:       'confirmado_eclosao',
    } : {}),
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
  bioSetContador('bio-ecl-anomalia', 0)
  bioSetContador('bio-ecl-mortos',   0)
  bioSetContador('bio-ecl-nao-nasc', 0)

  // Predação
  document.querySelectorAll('.bio-pred-opt:not(.bio-anom-opt)').forEach(o => o.classList.remove('sel'))
  document.querySelector('.bio-pred-opt[data-pred="nenhuma"]')?.classList.add('sel')

  // Tipos de anomalia
  document.querySelectorAll('.bio-anom-opt').forEach(o => o.classList.remove('sel'))

  // Ovos viáveis do ninho (postura − baixas nas visitas): referência
  // para o total de filhotes/ovos não nascidos informado.
  const viavEl = document.getElementById('bio-ecl-viaveis')
  if (viavEl) {
    const viaveis = bioOvosViaveisNinho(ninho)
    BioApp._eclViaveis = viaveis
    if (viaveis != null) {
      const perdas = (ninho.descartados_natural || 0) + (ninho.descartados_predacao || 0) + (ninho.descartados_humana || 0)
      viavEl.innerHTML = `Ovos viáveis do ninho: <b>${viaveis}</b>`
        + (perdas > 0 ? ` <span style="opacity:.75">(postura ${ninho.qtd_ovos} − ${perdas} baixados)</span>` : '')
      viavEl.hidden = false
    } else {
      viavEl.hidden = true
    }
  }

  // Postura estimada: oferece corrigir com um toque a partir do total
  // apurado nesta eclosão — ver "Regra do sistema — postura de ovos
  // por estimativa". Não aparece para ninho 'contado'.
  const posturaBox = document.getElementById('bio-ecl-postura-box')
  if (posturaBox) {
    posturaBox.hidden = ninho.contagem_ovos_metodo !== 'estimado'
    const ckConfirmar = document.getElementById('bio-ecl-postura-confirmar')
    if (ckConfirmar) ckConfirmar.checked = true
    const origEl = document.getElementById('bio-ecl-postura-original')
    if (origEl) origEl.textContent = ninho.qtd_ovos_estimado_original ?? ninho.qtd_ovos ?? '—'
    bioAtualizarPosturaEclosaoBox()
  }

  bioMostrarTela('tela-form-eclosao')
}

// Recalcula o total apurado (vivos + mortos + não nascidos) e mantém
// o campo de correção da postura pré-preenchido com esse valor.
function bioAtualizarPosturaEclosaoBox() {
  const ninho = BioApp.formNinhoAtualizar
  const box   = document.getElementById('bio-ecl-postura-box')
  if (!box || box.hidden || !ninho || ninho.contagem_ovos_metodo !== 'estimado') return
  const vivos    = parseInt(document.getElementById('bio-ecl-vivos').value)    || 0
  const mortos   = parseInt(document.getElementById('bio-ecl-mortos').value)   || 0
  const naoNasc  = parseInt(document.getElementById('bio-ecl-nao-nasc').value) || 0
  const apurado  = vivos + mortos + naoNasc
  const apEl = document.getElementById('bio-ecl-postura-apurado')
  if (apEl) apEl.textContent = apurado
  const inp = document.getElementById('bio-ecl-postura-corrigir')
  if (inp) inp.value = apurado
}

function bioSetContador(id, val) {
  const el = document.getElementById(id)
  if (el) el.value = val
}

function bioIniciarContadores() {
  ;[
    { idValor: 'bio-ecl-vivos',    min: 0 },
    { idValor: 'bio-ecl-anomalia', min: 0 },
    { idValor: 'bio-ecl-mortos',   min: 0 },
    { idValor: 'bio-ecl-nao-nasc', min: 0 },
  ].forEach(({ idValor, min }) => {
    const valEl  = document.getElementById(idValor)
    const plusEl = document.getElementById(`${idValor}-plus`)
    const minEl  = document.getElementById(`${idValor}-minus`)
    plusEl?.addEventListener('click',  () => { valEl.value = parseInt(valEl.value || 0) + 1; bioAtualizarPosturaEclosaoBox() })
    minEl?.addEventListener('click',   () => { valEl.value = Math.max(min, parseInt(valEl.value || 0) - 1); bioAtualizarPosturaEclosaoBox() })
    valEl?.addEventListener('blur',    () => { let v = parseInt(valEl.value); if (isNaN(v) || v < min) v = min; valEl.value = v; bioAtualizarPosturaEclosaoBox() })
  })

  // Predação
  document.querySelectorAll('.bio-pred-opt:not(.bio-anom-opt)').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.bio-pred-opt:not(.bio-anom-opt)').forEach(o => o.classList.remove('sel', 'perigo'))
      opt.classList.add('sel')
      if (opt.dataset.pred !== 'nenhuma') opt.classList.add('perigo')
    })
  })

  // Tipos de anomalia — múltipla escolha (toggle, não exclusivo como predação)
  document.querySelectorAll('.bio-anom-opt').forEach(opt => {
    opt.addEventListener('click', () => opt.classList.toggle('sel'))
  })
}

async function bioSalvarEclosao() {
  const ninho       = BioApp.formNinhoAtualizar
  const data        = document.getElementById('bio-ecl-data').value
  const vivos       = parseInt(document.getElementById('bio-ecl-vivos').value)    || 0
  const anomalia    = parseInt(document.getElementById('bio-ecl-anomalia').value) || 0
  const mortos      = parseInt(document.getElementById('bio-ecl-mortos').value)   || 0
  const naoNascidos = parseInt(document.getElementById('bio-ecl-nao-nasc').value) || 0
  const predacao    = document.querySelector('.bio-pred-opt:not(.bio-anom-opt).sel')?.dataset.pred ?? 'nenhuma'
  const anomaliaTipos = [...document.querySelectorAll('.bio-anom-opt.sel')].map(o => o.dataset.anom)

  if (!data)  { bioToast('Informe a data de nascimento.', 'err'); return }

  // Anomalia é subconjunto de vivos — nunca pode superar o total de vivos.
  if (anomalia > vivos) {
    bioToast('Filhotes com anomalia não pode ser maior que filhotes vivos.', 'err')
    return
  }

  // Alerta de consistência: o total apurado (filhotes vivos + mortos +
  // ovos não nascidos) não deveria superar os ovos viáveis do ninho
  // (postura − baixas das visitas). Só para ninho 'contado' — num
  // ninho 'estimado' superar a postura é o esperado (é exatamente o
  // que a correção abaixo existe para capturar), não um erro a avisar.
  const totalApurado = vivos + mortos + naoNascidos
  if (ninho.contagem_ovos_metodo !== 'estimado') {
    const viaveis = BioApp._eclViaveis ?? bioOvosViaveisNinho(ninho)
    if (viaveis != null && totalApurado > viaveis) {
      const msg = `O total informado (${totalApurado}: ${vivos} vivos + ${mortos} mortos + ${naoNascidos} não nasc.) `
        + `supera os ${viaveis} ovos viáveis do ninho.\n\nConfirmar assim mesmo?`
      if (!confirm(msg)) return
    }
  }

  // Postura estimada: se o monitor confirmou a correção com um toque,
  // o valor apurado nesta eclosão vira a postura oficial do ninho —
  // aplicado pelo trigger do banco, nunca recalculado no cliente.
  let posturaCorrigida = null
  if (ninho.contagem_ovos_metodo === 'estimado') {
    const ckConfirmar = document.getElementById('bio-ecl-postura-confirmar')
    if (ckConfirmar?.checked) {
      const v = parseInt(document.getElementById('bio-ecl-postura-corrigir').value)
      posturaCorrigida = isNaN(v) ? totalApurado : v
    }
  }

  const ecl = {
    uuid_cliente:      bioUuid(),
    ninho_uuid:        ninho.uuid_cliente,
    ninho_numero:      ninho.numero_ninho,
    data_nascimento:   data,
    filhotes_vivos:    vivos,
    filhotes_anomalia: anomalia,
    anomalia_tipos:    anomaliaTipos.length ? anomaliaTipos : null,
    filhotes_mortos:   mortos,
    ovos_nao_nascidos: naoNascidos,
    predacao,
    postura_corrigida: posturaCorrigida,
    foto_urls:         BioApp._fotosEcl?.length ? [...BioApp._fotosEcl] : [],
    status_sync:       'pendente',
    criado_em:         new Date().toISOString(),
  }

  await bioOfflineSalvarNinho({
    ...ninho,
    server_id: ninho.server_id ?? ninho.id ?? null,
    status:    'eclodido',
    // Reflete a correção localmente sem esperar o sync — o trigger do
    // banco faz o mesmo ao lado do servidor (ver migration 322).
    ...(posturaCorrigida != null ? {
      qtd_ovos_estimado_original: ninho.qtd_ovos_estimado_original ?? ninho.qtd_ovos,
      qtd_ovos:                   posturaCorrigida,
      contagem_ovos_metodo:       'confirmado_eclosao',
    } : {}),
  })
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
  const _indCk = document.getElementById('bio-berc-individual')
  if (_indCk) _indCk.checked = false
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

  // Guarda final: reconfirma que o berçário não mudou de espécie entre a
  // seleção e o salvar (ex.: outro monitor sincronizou nesse intervalo).
  const temporadaNinho = ninho.temporada_id ?? BioApp.temporadaAtual?.id ?? null
  const especieAtual = bioBercarioEspecieAtual(berc.id, await bioOfflineLotesAtivos(), temporadaNinho)
  if (especieAtual && ninho.especie && especieAtual !== ninho.especie) {
    const espNome = BIO_ESPECIES.find(e => e.id === especieAtual)?.nome ?? especieAtual
    alert(`Este berçário já está em uso com a espécie "${espNome}".\nNão é possível misturar espécies diferentes ali.\n\nEscolha outro berçário.`)
    bioAbrirSeletorBercario(b => {
      BioApp.formBercarioSelecionado = b
      const nomeSpan = document.getElementById('bio-berc-nome-txt')
      if (nomeSpan) nomeSpan.textContent = b.nome
      bioMostrarTela('tela-form-entrada-bercario')
    }, ninho.especie, temporadaNinho)
    return
  }

  const lote = {
    uuid_cliente:  bioUuid(),
    ninho_uuid:    ninho.uuid_cliente,
    ninho_numero:  ninho.numero_ninho,
    especie:       ninho.especie,
    bercario_id:   berc.id,
    bercario_nome: berc.nome,
    temporada_id:  ninho.temporada_id ?? BioApp.temporadaAtual?.id ?? null,
    data_entrada:  data,
    hora_entrada:  document.getElementById('bio-berc-hora').value || null,
    qtd_entrada:   qtd,
    status:        'ativo',
    observacoes:   document.getElementById('bio-berc-obs').value.trim() || null,
    status_sync:   'pendente',
    criado_em:     new Date().toISOString(),
  }

  const { ninho: ninhoBerc } = BioApp.formDestinoCtx ?? {}
  if (ninhoBerc) {
    await bioOfflineSalvarNinho({ ...ninhoBerc, status: 'em_bercario', status_sync: 'pendente' })
  }
  await bioOfflineSalvarLote(lote)

  const individual = document.getElementById('bio-berc-individual')?.checked
  if (individual) {
    await bioOfflineGerarIndividuosDoLote(lote.uuid_cliente, qtd, BioApp.monitor?.id)
  }

  await bioAtualizarBadgeFila()
  await bioAtualizarBadgeBercario()

  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast(individual
    ? `Entrada registrada com ${qtd} filhotes numerados!`
    : 'Entrada no berçário registrada!', 'ok')
  bioMostrarTela('tela-home')
}

// Mortes canônicas de um lote: individual (se rastreado) senão ocorrências
// agregadas de mortalidade — mesma regra do vw_lotes_bercario_mortalidade
// no banco, aplicada aqui localmente para funcionar offline.
async function bioMortesCanonicasDoLote(lote) {
  const individuos = await bioOfflineIndividuosDoLote(lote.uuid_cliente)
  if (individuos.length) return individuos.filter(i => i.status === 'morto').length
  const ocorrencias = await bioOfflineOcorrenciasDoLote(lote.uuid_cliente)
  return ocorrencias
    .filter(o => o.tipo === 'mortalidade')
    .reduce((soma, o) => soma + (o.qtd_afetados || 0), 0)
}

// Vivos atuais de cada lote ATIVO de um berçário (entrada - mortes
// canônicas), e o total somado — usado no card do berçário e na
// soltura em bloco.
async function bioVivosPorLoteDoBercario(bercarioId, temporadaId) {
  const lotes = (await bioOfflineLotesDoBercario(bercarioId, temporadaId)).filter(l => l.status === 'ativo')
  const comVivos = await Promise.all(lotes.map(async l => ({
    ...l, vivos: Math.max((l.qtd_entrada || 0) - await bioMortesCanonicasDoLote(l), 0),
  })))
  return { lotes: comVivos, total: comVivos.reduce((s, l) => s + l.vivos, 0) }
}

/* ════════════════════════════════════════════════════════════
   FORMULÁRIO — SOLTURA DE FILHOTES
   ════════════════════════════════════════════════════════════ */
// Dois modos:
//  - direto (pós-eclosão, sem berçário): ctx = { ninho, filhotesVivos, mortesIniciais? }
//  - berçário (soltura em bloco, todos os lotes ativos de uma vez):
//    ctx = { bercario: {id, nome}, especie, lotesComVivos, totalVivos }
//    A quantidade vem pronta (soma dos vivos de cada lote) — não é
//    editável, porque os animais estão misturados no tanque e a
//    mortalidade já é rastreada por outros meios (individual/ocorrência).
function bioAbrirFormSoltura(ctx) {
  BioApp.formSolturaCtx = ctx
  const { ninho, filhotesVivos, mortesIniciais, bercario, especie, lotesComVivos, totalVivos } = ctx

  const infoEl      = document.getElementById('bio-sol-bercario-info')
  const ctxLabelEl  = document.getElementById('bio-sol-ctx-label')
  const numPrefixEl = document.getElementById('bio-sol-num-prefix')
  const mortSecEl   = document.getElementById('bio-sol-mort-sec')
  const qtdInput    = document.getElementById('bio-sol-qtd')
  const qtdMinus    = document.getElementById('bio-sol-qtd-minus')
  const qtdPlus     = document.getElementById('bio-sol-qtd-plus')
  const tituloEl    = document.getElementById('bio-soltura-titulo')
  const backBtn     = document.getElementById('bio-soltura-back')

  document.getElementById('bio-sol-data').value       = new Date().toISOString().slice(0, 10)
  document.getElementById('bio-sol-hora').value       = new Date().toTimeString().slice(0, 5)
  document.getElementById('bio-sol-local').value      = ''
  document.getElementById('bio-sol-obs').value        = ''
  document.getElementById('bio-sol-predacao').checked = false

  if (bercario) {
    if (ctxLabelEl)  ctxLabelEl.textContent = 'Berçário'
    if (numPrefixEl) numPrefixEl.hidden     = true
    document.getElementById('bio-sol-ninho-num').textContent = bercario.nome
    document.getElementById('bio-sol-especie').textContent   = BIO_ESPECIES.find(e => e.id === especie)?.nome ?? especie ?? ''
    infoEl.textContent = `${lotesComVivos.length} lote${lotesComVivos.length !== 1 ? 's' : ''} · ${totalVivos} filhotes vivos`
    infoEl.hidden = false
    if (mortSecEl) mortSecEl.hidden = true
    bioSetContador('bio-sol-qtd', totalVivos)
    if (qtdInput) qtdInput.readOnly = true
    qtdMinus?.setAttribute('disabled', 'disabled')
    qtdPlus?.setAttribute('disabled', 'disabled')
    tituloEl.textContent = 'Soltura do Berçário'
    backBtn.dataset.back = 'tela-bercarios'
  } else {
    if (ctxLabelEl)  ctxLabelEl.textContent = 'Ninho'
    if (numPrefixEl) numPrefixEl.hidden     = false
    document.getElementById('bio-sol-ninho-num').textContent = ninho.numero_ninho
    document.getElementById('bio-sol-especie').textContent   = BIO_ESPECIES.find(e => e.id === ninho.especie)?.nome ?? ninho.especie
    infoEl.hidden = true
    if (mortSecEl) mortSecEl.hidden = false
    bioSetContador('bio-sol-qtd', filhotesVivos ?? 0)
    bioSetContador('bio-sol-mort', mortesIniciais ?? 0)
    if (qtdInput) qtdInput.readOnly = false
    qtdMinus?.removeAttribute('disabled')
    qtdPlus?.removeAttribute('disabled')
    tituloEl.textContent = 'Soltura de Filhotes'
    backBtn.dataset.back = 'tela-destino-filhotes'
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

// Abre a soltura em bloco de TODO o berçário — soma os lotes ativos e
// pré-calcula quantos filhotes saem de cada um (vivos = entrada - mortes).
async function bioAbrirSolturaBercario(bercarioId, nome, temporadaId) {
  const { lotes, total } = await bioVivosPorLoteDoBercario(bercarioId, temporadaId)
  if (!lotes.length) { bioToast('Nenhum lote ativo neste berçário.', 'err'); return }
  if (total <= 0) { bioToast('Nenhum filhote vivo para soltar neste berçário.', 'err'); return }
  bioAbrirFormSoltura({
    bercario: { id: bercarioId, nome },
    especie: lotes[0]?.especie,
    lotesComVivos: lotes,
    totalVivos: total,
  })
}

async function bioSalvarSoltura() {
  const ctx = BioApp.formSolturaCtx ?? {}
  const { ninho, bercario } = ctx
  if (!ninho && !bercario) return

  const data     = document.getElementById('bio-sol-data').value
  const hora     = document.getElementById('bio-sol-hora').value || null
  const local    = document.getElementById('bio-sol-local').value.trim() || null
  const predacao = document.getElementById('bio-sol-predacao').checked
  const obs      = document.getElementById('bio-sol-obs').value.trim() || null
  const fotos    = BioApp._fotosSol?.length ? [...BioApp._fotosSol] : []

  if (!data) { bioToast('Informe a data da soltura.', 'err'); return }

  if (bercario) {
    const lotes = ctx.lotesComVivos || []
    for (const lote of lotes) {
      if (lote.vivos <= 0) continue
      const sol = {
        uuid_cliente:    bioUuid(),
        ninho_uuid:      lote.ninho_uuid,
        ninho_numero:    lote.ninho_numero,
        lote_uuid:       lote.uuid_cliente,
        via_bercario:    true,
        data_soltura:    data,
        hora_soltura:    hora,
        qtd_soltada:     lote.vivos,
        mortalidade:     0,
        lat:             BioApp.gpsLat,
        lng:             BioApp.gpsLng,
        local_descricao: local,
        predacao_soltura: predacao,
        observacoes:     obs,
        foto_urls:       fotos,
        status_sync:     'pendente',
        criado_em:       new Date().toISOString(),
      }
      await bioOfflineSalvarSoltura(sol)
      await bioOfflineSalvarLote({ ...lote, status: 'soltado', status_sync: 'pendente' })

      const ninhoLote = await bioOfflineGetNinho(lote.ninho_uuid)
      if (ninhoLote) await bioOfflineSalvarNinho({ ...ninhoLote, status: 'soltado', status_sync: 'pendente' })

      const individuos = await bioOfflineIndividuosDoLote(lote.uuid_cliente)
      for (const ind of individuos) {
        if (ind.status !== 'ativo') continue
        await bioOfflineSalvarIndividuo({ ...ind, status: 'soltado', status_sync: 'pendente' })
      }
    }

    await bioAtualizarBadgeFila()
    await bioAtualizarBadgeBercario()
    bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
    bioToast('Berçário solto com sucesso!', 'ok')
    bioMostrarTela('tela-bercarios')
    await bioCarregarBercarios()
    return
  }

  // Modo direto: soltura pós-eclosão, sem passar pelo berçário
  const qtd  = parseInt(document.getElementById('bio-sol-qtd').value)  || 0
  const mort = parseInt(document.getElementById('bio-sol-mort').value) || 0
  if (qtd <= 0) { bioToast('Informe a quantidade soltada.', 'err'); return }

  const sol = {
    uuid_cliente:    bioUuid(),
    ninho_uuid:      ninho.uuid_cliente,
    ninho_numero:    ninho.numero_ninho,
    lote_uuid:       null,
    via_bercario:    false,
    data_soltura:    data,
    hora_soltura:    hora,
    qtd_soltada:     qtd,
    mortalidade:     mort,
    lat:             BioApp.gpsLat,
    lng:             BioApp.gpsLng,
    local_descricao: local,
    predacao_soltura: predacao,
    observacoes:     obs,
    foto_urls:       fotos,
    status_sync:     'pendente',
    criado_em:       new Date().toISOString(),
  }

  await bioOfflineSalvarNinho({ ...ninho, status: 'soltado', status_sync: 'pendente' })
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
// Cor fixa por berçário (deriva do id — mesma cor sempre, diferencia
// visualmente cada berçário na lista sem precisar de cadastro extra).
const BIO_BERC_PALETA = ['#1A6B8C', '#C9A84C', '#7C3AED', '#0891B2', '#DC6803', '#2A9D6F', '#BE185D', '#4338CA']
function bioBercarioCor(bercarioId) {
  if (!bercarioId) return '#6B7280'
  let h = 0
  for (let i = 0; i < bercarioId.length; i++) h = (h * 31 + bercarioId.charCodeAt(i)) >>> 0
  return BIO_BERC_PALETA[h % BIO_BERC_PALETA.length]
}

// Espécie que atualmente ocupa um berçário (regra: 1 espécie por vez,
// enquanto houver lote ativo; libera quando todos forem soltos).
// temporadaId opcional: quando informado (mesmo null), só considera
// lotes da mesma temporada — um lote esquecido ativo de uma temporada
// anterior não deve travar a espécie da temporada nova.
function bioBercarioEspecieAtual(bercarioId, lotesAtivos, temporadaId) {
  let doTanque = lotesAtivos.filter(l => l.bercario_id === bercarioId && l.especie)
  if (temporadaId !== undefined) {
    doTanque = doTanque.filter(l => (l.temporada_id ?? null) === (temporadaId ?? null))
  }
  return doTanque[0]?.especie ?? null
}

async function bioAbrirTelaBercarios() {
  bioMostrarTela('tela-bercarios')
  BioApp.bercarioFiltro = ''
  BioApp.bercarioStatusFiltro = 'ativo'
  document.querySelectorAll('#bio-berc-status-toggle .bio-oc-chip').forEach(btn => {
    btn.classList.toggle('ativo', btn.dataset.status === 'ativo')
  })
  await bioCarregarBercarios()
}

async function bioCarregarBercarios() {
  const estadoEl = document.getElementById('bio-bercarios-estado')
  const listaEl  = document.getElementById('bio-lista-lotes')
  const chipsEl  = document.getElementById('bio-berc-chips')
  if (estadoEl) { estadoEl.textContent = 'Carregando…'; estadoEl.hidden = false }
  if (listaEl)  listaEl.innerHTML = ''

  const statusFiltro = BioApp.bercarioStatusFiltro || 'ativo'
  const lotes = await bioOfflineLotesPorStatus(statusFiltro)

  if (!lotes.length) {
    if (chipsEl) chipsEl.innerHTML = ''
    const msgVazio = statusFiltro === 'soltado' ? 'Nenhum berçário solto encontrado.' : 'Nenhum lote em berçário no momento.'
    if (estadoEl) { estadoEl.textContent = msgVazio; estadoEl.hidden = false }
    return
  }

  // Agrupa por (bercario_id, temporada_id) — o berçário é uma estrutura
  // física reaproveitada ano após ano; um lote esquecido ativo de uma
  // temporada anterior aparece como um grupo À PARTE (flagado), sem se
  // misturar com a ocupação da temporada atual.
  const grupos = {}
  lotes.forEach(l => {
    const temporadaId = l.temporada_id ?? null
    const chave = `${l.bercario_id ?? 'sem-bercario'}:${temporadaId ?? 'sem-temporada'}`
    if (!grupos[chave]) grupos[chave] = { id: l.bercario_id, temporadaId, nome: l.bercario_nome ?? 'Berçário não identificado', lotes: [] }
    grupos[chave].lotes.push(l)
  })

  // Chips: "Todos" + um por berçário com lote ativo
  if (chipsEl) {
    const filtro = BioApp.bercarioFiltro || ''
    chipsEl.innerHTML = [
      `<button type="button" class="bio-oc-chip${!filtro ? ' ativo' : ''}" data-filtro="">Todos</button>`,
      ...Object.values(grupos).map(g => `
        <button type="button" class="bio-oc-chip${filtro === g.nome ? ' ativo' : ''}" data-filtro="${esc(g.nome)}">${esc(g.nome)}</button>
      `),
    ].join('')
    chipsEl.querySelectorAll('[data-filtro]').forEach(btn => {
      btn.addEventListener('click', () => {
        BioApp.bercarioFiltro = btn.dataset.filtro
        const buscaEl = document.getElementById('bio-berc-busca')
        if (buscaEl) buscaEl.value = btn.dataset.filtro
        bioCarregarBercarios()
      })
    })
  }

  const termo = (BioApp.bercarioFiltro || '').trim().toLowerCase()
  const gruposVisiveis = Object.values(grupos).filter(g => !termo || g.nome.toLowerCase().includes(termo))

  if (!gruposVisiveis.length) {
    if (estadoEl) { estadoEl.textContent = 'Nenhum berçário encontrado para essa busca.'; estadoEl.hidden = false }
    return
  }
  if (estadoEl) estadoEl.hidden = true

  // Um card por BERÇÁRIO (não mais um por lote/ninho) — os filhotes se
  // misturam fisicamente no tanque assim que dividem o mesmo berçário,
  // então não faz mais sentido navegar por ninho na lista. O histórico
  // de quais ninhos entraram fica dentro do detalhe do berçário.
  const temporadaAtualId = BioApp.temporadaAtual?.id ?? null

  // Estatísticas por grupo (vivos/mortos/soltos, datas, ocupação,
  // doentes) — tudo offline, calculado em paralelo antes de montar os
  // cards, para alimentar a rosca e os detalhes de cada um.
  const statsPorGrupo = await Promise.all(gruposVisiveis.map(async grupo => {
    const totalEntrada = grupo.lotes.reduce((s, l) => s + (l.qtd_entrada || 0), 0)
    const mortes = (await Promise.all(grupo.lotes.map(l => bioMortesCanonicasDoLote(l))))
      .reduce((s, m) => s + m, 0)
    const datasEntrada = [...new Set(grupo.lotes.map(l => l.data_entrada).filter(Boolean))].sort()

    let soltos = 0, datasSoltura = []
    if (statusFiltro === 'soltado' && grupo.id) {
      const solturas = await bioOfflineSolturasDoBercario(grupo.id, grupo.temporadaId)
      soltos = solturas.reduce((s, x) => s + (x.qtd_soltada || 0), 0)
      datasSoltura = [...new Set(solturas.map(x => x.data_soltura).filter(Boolean))].sort()
    }

    const bercario   = grupo.id ? await bioOfflineGetBercario(grupo.id) : null
    const individuos = grupo.id ? await bioOfflineIndividuosDoBercario(grupo.id, grupo.temporadaId) : []
    const doentes    = individuos.filter(i => i.doente && i.status === 'ativo').length

    return { grupo, totalEntrada, mortes, datasEntrada, soltos, datasSoltura, bercario, doentes }
  }))

  const _bercFmtIntervalo = datas => {
    if (!datas.length) return '—'
    if (datas.length === 1) return _bioFormatarData(datas[0])
    return `${_bioFormatarData(datas[0])} – ${_bioFormatarData(datas[datas.length - 1])}`
  }

  let _precisaChart = false

  statsPorGrupo.forEach(st => {
    const { grupo, totalEntrada, mortes, datasEntrada, soltos, datasSoltura, bercario, doentes } = st
    const especieAtual = bioBercarioEspecieAtual(grupo.id, grupo.lotes)
    const espLabel = especieAtual ? (BIO_ESPECIES.find(e => e.id === especieAtual)?.nome ?? especieAtual) : null
    const temporadaAnterior = grupo.temporadaId != null && grupo.temporadaId !== temporadaAtualId

    const header = document.createElement('div')
    header.className = 'bio-berc-grupo-header'
    header.style.borderLeft = `4px solid ${bioBercarioCor(grupo.id)}`
    header.style.paddingLeft = '12px'
    header.innerHTML = `
      <span>${grupo.nome}${espLabel ? ` <span class="bio-berc-grupo-especie">${espLabel}</span>` : ''}${temporadaAnterior ? ` <span class="bio-berc-grupo-temporada-antiga">Temporada anterior</span>` : ''}</span>
      <span class="bio-berc-grupo-stats">${grupo.lotes.length} lote${grupo.lotes.length !== 1 ? 's' : ''} · ${totalEntrada} filhotes</span>
    `
    listaEl.appendChild(header)

    const mortalidadePct = totalEntrada ? Math.round((mortes / totalEntrada) * 1000) / 10 : null
    const donutId = `berc-donut-${grupo.id ?? 'x'}-${grupo.temporadaId ?? 'x'}`
    const temDados = totalEntrada > 0

    let linhasStats
    if (statusFiltro === 'soltado') {
      const vivosNoTanque = Math.max(totalEntrada - mortes - soltos, 0)
      linhasStats = `
        <div>Soltura: <strong>${_bercFmtIntervalo(datasSoltura)}</strong></div>
        <div>Soltos: <strong style="color:#0891B2">${soltos}</strong> · Mortos: <strong style="color:var(--bio-perigo)">${mortes}</strong>${vivosNoTanque ? ` · Ainda no tanque: <strong>${vivosNoTanque}</strong>` : ''}</div>
        <div class="bio-berc-stat-mortalidade">Mortalidade: ${mortalidadePct != null ? mortalidadePct + '%' : '—'}</div>
      `
    } else {
      const vivos = Math.max(totalEntrada - mortes, 0)
      const ocupacaoTxt = bercario?.capacidade_max ? ` · Ocupação: ${vivos}/${bercario.capacidade_max}` : ''
      linhasStats = `
        <div>Entrada: <strong>${_bercFmtIntervalo(datasEntrada)}</strong></div>
        <div>Vivos: <strong style="color:var(--bio-verde)">${vivos}</strong> · Mortos: <strong style="color:var(--bio-perigo)">${mortes}</strong>${ocupacaoTxt}</div>
        <div class="bio-berc-stat-mortalidade">Mortalidade: ${mortalidadePct != null ? mortalidadePct + '%' : '—'}</div>
        ${doentes ? `<span class="bio-berc-doente-badge">${doentes} doente${doentes !== 1 ? 's' : ''}</span>` : ''}
      `
    }

    if (temDados) _precisaChart = true

    const card = document.createElement('div')
    card.className = 'bio-nfc'
    card.innerHTML = `
      <div class="bio-berc-card-body">
        <div class="bio-berc-donut-wrap">
          ${temDados ? `<canvas id="${donutId}"></canvas>` : `<div class="bio-berc-donut-vazio">—</div>`}
        </div>
        <div class="bio-berc-stats">${linhasStats}</div>
      </div>
      <div class="bio-nfc-acoes">
        <button class="bio-btn-sm prim" data-acao="ver-bercario">Ver berçário</button>
        ${statusFiltro === 'soltado' ? '' : `<button class="bio-btn-sm prim" data-acao="soltar-bercario" style="background:var(--bio-verde)">Soltar berçário</button>`}
      </div>
    `
    card.querySelector('[data-acao="ver-bercario"]')?.addEventListener('click', () => {
      bioAbrirDetalheBercario(grupo)
    })
    card.querySelector('[data-acao="soltar-bercario"]')?.addEventListener('click', () => {
      bioAbrirSolturaBercario(grupo.id, grupo.nome, grupo.temporadaId)
    })
    listaEl.appendChild(card)

    if (temDados) {
      card.dataset.donutId = donutId
      card.dataset.donutDados = statusFiltro === 'soltado'
        ? JSON.stringify({ labels: ['Soltos', 'Mortos'], data: [soltos, mortes], cores: ['#0891B2', '#DC2626'] })
        : JSON.stringify({ labels: ['Vivos', 'Mortos'], data: [Math.max(totalEntrada - mortes, 0), mortes], cores: ['#2A9D6F', '#DC2626'] })
    }
  })

  if (_precisaChart) {
    const Chart = await _bioCarregarChartJS()
    listaEl.querySelectorAll('[data-donut-id]').forEach(card => {
      const { labels, data, cores } = JSON.parse(card.dataset.donutDados)
      _bioDonutMini(card.dataset.donutId, labels, data, cores, Chart)
    })
  }
}

// especieNova: espécie do ninho sendo registrado. Berçários já ocupados
// com espécie diferente NA MESMA TEMPORADA aparecem desabilitados — 1
// espécie por vez; um lote esquecido ativo de temporada anterior não conta.
async function bioAbrirSeletorBercario(callback, especieNova, temporadaId) {
  const temporadaAtual = temporadaId ?? BioApp.temporadaAtual?.id ?? null
  const lista = await bioOfflineListarBercarios()
  const lotesAtivos = await bioOfflineLotesAtivos()
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
        const especieAtual = bioBercarioEspecieAtual(b.id, lotesAtivos, temporadaAtual)
        const bloqueado = !!(especieAtual && especieNova && especieAtual !== especieNova)
        const espNome = especieAtual ? (BIO_ESPECIES.find(e => e.id === especieAtual)?.nome ?? especieAtual) : null
        const card = document.createElement('div')
        card.className = 'bio-berc-sel-card' + (bloqueado ? ' bloqueado' : '')
        card.innerHTML = `
          <div class="bio-berc-sel-info">
            <div class="bio-berc-sel-nome">${b.nome}</div>
            <div class="bio-berc-sel-meta">${TIPO_LABEL[b.tipo] ?? b.tipo}${espNome ? ` · ${bloqueado ? 'Ocupado com' : 'Em uso —'} ${espNome}` : ''}</div>
          </div>
          ${b.capacidade_max ? `<span class="bio-berc-sel-cap">Máx. ${b.capacidade_max}</span>` : ''}
        `
        card.addEventListener('click', () => {
          if (bloqueado) {
            bioToast(`Berçário ocupado com ${espNome} — solte esses filhotes antes ou escolha outro berçário.`, 'err')
            return
          }
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

// grupo: { id, temporadaId, nome, lotes } — todos os lotes ATIVOS
// daquele berçário físico NAQUELA TEMPORADA (vindo de
// bioCarregarBercarios). Os filhotes se misturam no tanque, então o
// detalhe é do BERÇÁRIO inteiro (na temporada do grupo), não de um
// lote/ninho isolado — a grade de filhotes agrupa todos os lotes que
// já passaram por ali NA MESMA TEMPORADA (bioOfflineIndividuosDoBercario),
// e o "histórico de ninhos" abaixo mantém a rastreabilidade de quem
// veio de onde, sem misturar com temporadas anteriores.
async function bioAbrirDetalheBercario(grupo) {
  BioApp.bercarioAtual = grupo
  const el = id => document.getElementById(id)

  const todosLotes = await bioOfflineLotesDoBercario(grupo.id, grupo.temporadaId)
  const especieAtual = bioBercarioEspecieAtual(grupo.id, grupo.lotes)
  const espNome = especieAtual ? (BIO_ESPECIES.find(e => e.id === especieAtual)?.nome ?? especieAtual) : '—'
  const totalEntrada = grupo.lotes.reduce((s, l) => s + (l.qtd_entrada || 0), 0)

  if (el('bio-det-ninho-num'))  el('bio-det-ninho-num').textContent  = grupo.nome
  if (el('bio-det-especie'))    el('bio-det-especie').textContent    = espNome
  if (el('bio-det-bercario'))   el('bio-det-bercario').textContent   = `${grupo.lotes.length} lote${grupo.lotes.length !== 1 ? 's' : ''} ativo${grupo.lotes.length !== 1 ? 's' : ''}`
  if (el('bio-det-qtd'))        el('bio-det-qtd').textContent        = totalEntrada
  if (el('bio-det-dias'))       el('bio-det-dias').textContent       = todosLotes.length

  // "Soltar Berçário" só faz sentido enquanto houver lote ativo — um
  // berçário já totalmente solto não tem mais nada pra soltar.
  const btnSoltar = el('bio-btn-soltar-lote')
  if (btnSoltar) btnSoltar.hidden = !todosLotes.some(l => l.status === 'ativo')

  const mortesPorLote = await Promise.all(grupo.lotes.map(l => bioMortesCanonicasDoLote(l)))
  const mortesTotal = mortesPorLote.reduce((s, m) => s + m, 0)
  const wrap = el('bio-det-vivos-wrap')
  if (wrap) {
    if (mortesTotal > 0) {
      wrap.hidden = false
      if (el('bio-det-vivos')) el('bio-det-vivos').textContent = Math.max(totalEntrada - mortesTotal, 0)
    } else {
      wrap.hidden = true
    }
  }

  bioCarregarTimelineBercario(grupo.id, grupo.temporadaId)
  bioRenderizarFilhotesDoBercario(grupo.id, grupo.temporadaId)
  bioRenderizarHistoricoNinhos(todosLotes)
  bioRenderizarSolturasDoBercario(grupo.id, grupo.temporadaId)
  bioMostrarTela('tela-detalhe-lote')
}

// ── Filhotes individuais do berçário (pool único, não por ninho) ──
async function bioRenderizarFilhotesDoBercario(bercarioId, temporadaId) {
  const sec  = document.getElementById('bio-det-filhotes-sec')
  const grid = document.getElementById('bio-det-filhotes-lista')
  const btnSeq = document.getElementById('bio-btn-biometria-seq')
  if (!sec || !grid) return

  const individuos = await bioOfflineIndividuosDoBercario(bercarioId, temporadaId)
  if (!individuos.length) { sec.hidden = true; return }
  sec.hidden = false

  const ativos = individuos.filter(i => i.status === 'ativo')
  if (btnSeq) btnSeq.hidden = ativos.length === 0

  // Última biometria de cada indivíduo (para exibir no chip)
  const ultimas = await Promise.all(
    individuos.map(i => bioOfflineBiometriasDoIndividuo(i.uuid_cliente))
  )

  const STATUS_LABEL = { morto: 'óbito', soltado: 'solto' }
  grid.innerHTML = individuos.map((ind, i) => {
    const ult = ultimas[i][0]
    const bioTxt = ult
      ? [ult.comprimento_cm != null ? `${ult.comprimento_cm}cm` : null,
         ult.peso_g != null ? `${ult.peso_g}g` : null].filter(Boolean).join(' · ')
      : 'sem biometria'
    const classeExtra = ind.status !== 'ativo' ? ` ${ind.status}` : ''
    const classeCor = ind.status === 'morto' ? ' num-morto' : ind.doente ? ' num-doente' : ind.anomalia ? ' num-anomalia' : ' num-vivo'
    const bioLabel = ind.status === 'ativo' && ind.doente ? 'doente'
      : ind.status === 'ativo' && ind.anomalia ? 'anomalia'
      : STATUS_LABEL[ind.status] ?? bioTxt
    return `
      <div class="bio-filhote-chip${classeExtra}" data-individuo-uuid="${ind.uuid_cliente}">
        <span class="bio-filhote-num${classeCor}">#${ind.numero}</span>
        <span class="bio-filhote-bio">${bioLabel}</span>
      </div>`
  }).join('')
}

// ── Histórico de ninhos que já passaram por este berçário ─────
function bioRenderizarHistoricoNinhos(lotes) {
  const wrap = document.getElementById('bio-det-historico-ninhos')
  const lista = document.getElementById('bio-det-historico-lista')
  if (!wrap || !lista) return
  if (!lotes.length) { wrap.hidden = true; return }
  wrap.hidden = false

  const STATUS_LBL = { ativo: 'No berçário', soltado: 'Solto', cancelado: 'Cancelado' }
  lista.innerHTML = lotes.map(l => {
    const espNome = BIO_ESPECIES.find(e => e.id === l.especie)?.nome ?? l.especie ?? '—'
    return `
      <div class="bio-hist-ninho-item">
        <div>
          <strong>Ninho #${l.ninho_numero ?? '—'}</strong> · ${espNome}
          <div class="bio-hist-ninho-meta">Entrada: ${_bioFormatarData(l.data_entrada)} · ${l.qtd_entrada} filhotes</div>
        </div>
        <span class="bio-nfc-status-badge ${l.status === 'ativo' ? 'em_bercario' : l.status === 'soltado' ? 'soltado' : ''}">${STATUS_LBL[l.status] ?? l.status}</span>
      </div>`
  }).join('')
}

// ── Visualizador de foto em tela cheia (histórico: ocorrências/soltura) ──
// Bucket biomonitor-fotos é privado (migration 210). `|| url` cobre a
// foto ainda não sincronizada (dataURL da fila offline), que não é
// endereço de Storage e portanto não tem o que assinar.
async function bioAbrirFotoTelaCheia(url) {
  const viewer = document.getElementById('bio-foto-viewer')
  const img    = document.getElementById('bio-foto-viewer-img')
  if (!viewer || !img || !url) return
  img.src = await fotoUrlAssinada(url) || url
  viewer.hidden = false
}

function bioFecharFotoTelaCheia() {
  const viewer = document.getElementById('bio-foto-viewer')
  if (viewer) viewer.hidden = true
}

// Grade de miniaturas clicáveis (abre bioAbrirFotoTelaCheia ao tocar) —
// usada no histórico de ocorrências e de soltura.
function _bioFotosGridHtml(fotoUrls) {
  if (!fotoUrls?.length) return ''
  return `<div class="bio-foto-grid">${
    fotoUrls.map(u => `<img class="bio-foto-clicavel" ${fotoAttr(u)} data-foto-url="${esc(u)}" loading="lazy">`).join('')
  }</div>`
}

// ── Histórico de soltura do berçário (data, quantidade, local,
//    predação, observações e fotos) — desde a entrada até a soltura.
async function bioRenderizarSolturasDoBercario(bercarioId, temporadaId) {
  const wrap  = document.getElementById('bio-det-solturas-sec')
  const lista = document.getElementById('bio-det-solturas-lista')
  if (!wrap || !lista) return

  const solturas = await bioOfflineSolturasDoBercario(bercarioId, temporadaId)
  if (!solturas.length) { wrap.hidden = true; return }
  wrap.hidden = false

  lista.innerHTML = solturas.map(s => {
    const dataFmt = _bioFormatarData(s.data_soltura) + (s.hora_soltura ? ` às ${s.hora_soltura}` : '')
    const meta = [
      `${s.qtd_soltada ?? 0} filhotes soltos`,
      s.mortalidade ? `${s.mortalidade} mortes` : null,
      s.predacao_soltura ? 'predação observada' : null,
      s.local_descricao || null,
    ].filter(Boolean).join(' · ')
    return `
      <div class="bio-sol-hist-item">
        <strong>${dataFmt}</strong>
        <div class="bio-sol-hist-meta">${esc(meta)}</div>
        ${s.observacoes ? `<div class="bio-sol-hist-obs">${esc(s.observacoes)}</div>` : ''}
        ${_bioFotosGridHtml(s.foto_urls)}
      </div>`
  }).join('')
  assinarFotos(lista)
}

function bioAbrirTelaDetalheIndividuo(individuo) {
  BioApp.individuoAtual = individuo
  const el = id => document.getElementById(id)
  const STATUS_LBL = { ativo: 'Ativo', morto: 'Morto', soltado: 'Solto' }
  if (el('bio-ind-numero')) el('bio-ind-numero').textContent = individuo.numero
  if (el('bio-ind-status')) el('bio-ind-status').textContent = STATUS_LBL[individuo.status] ?? individuo.status

  const obitoRow = el('bio-ind-obito-row')
  const btnObito = el('bio-btn-obito-individuo')
  if (individuo.status === 'morto') {
    if (obitoRow) { obitoRow.hidden = false; el('bio-ind-obito').textContent = _bioFormatarData(individuo.data_obito) }
    if (btnObito) btnObito.hidden = true
  } else {
    if (obitoRow) obitoRow.hidden = true
    if (btnObito) btnObito.hidden = individuo.status === 'soltado'
  }

  if (el('bio-ind-doenca')) el('bio-ind-doenca').textContent = individuo.doente ? 'Sim' : 'Não'
  const btnDoenca = el('bio-btn-doenca-individuo')
  if (btnDoenca) {
    btnDoenca.hidden = individuo.status !== 'ativo'
    btnDoenca.textContent = individuo.doente ? 'Remover doença' : 'Marcar doente'
  }

  // Anomalia é congênita (conhecida desde a eclosão) — toggle direto, sem
  // abrir formulário de ocorrência (diferente de doença/óbito, que registram
  // um evento durante o cuidado em berçário).
  if (el('bio-ind-anomalia')) el('bio-ind-anomalia').textContent = individuo.anomalia ? 'Sim' : 'Não'
  const btnAnomalia = el('bio-btn-anomalia-individuo')
  if (btnAnomalia) {
    btnAnomalia.textContent = individuo.anomalia ? 'Remover anomalia' : 'Marcar anomalia'
  }

  bioCarregarTimelineIndividuo(individuo)
  bioMostrarTela('tela-detalhe-individuo')
}

async function bioCarregarTimelineIndividuo(individuo) {
  const timelineEl = document.getElementById('bio-ind-timeline')
  if (!timelineEl) return

  const medicoes = await bioOfflineBiometriasDoIndividuo(individuo.uuid_cliente)
  if (!medicoes.length) {
    timelineEl.innerHTML = `<div class="bio-tl-vazio">Nenhuma biometria registrada.</div>`
    return
  }

  timelineEl.innerHTML = medicoes.map(m => {
    const detalhes = [
      m.comprimento_cm != null ? `Comp.: ${m.comprimento_cm} cm` : null,
      m.largura_carapaca_cm != null ? `Larg. carapaça: ${m.largura_carapaca_cm} cm` : null,
      m.comprimento_plastrao_cm != null ? `Compr. plastrão: ${m.comprimento_plastrao_cm} cm` : null,
      m.peso_g != null ? `Peso: ${m.peso_g} g` : null,
      m.observacoes || null,
    ].filter(Boolean).join(' · ')
    const dataFmt = _bioFormatarData(m.data_medicao) + (m.hora_medicao ? ` às ${m.hora_medicao}` : '')
    return `
      <div class="bio-tl-item">
        <div class="bio-tl-icone">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div class="bio-tl-body">
          <div class="bio-tl-tipo">Biometria</div>
          <div class="bio-tl-data">${dataFmt}</div>
          ${detalhes ? `<div class="bio-tl-detalhe">${detalhes}</div>` : ''}
        </div>
      </div>`
  }).join('')
}

// Remover a marcação de doente é só voltar ao normal — não abre o
// formulário de ocorrência (marcar doente/óbito é que abre, ver
// bioAbrirFormOcorrenciaIndividuo).
async function bioAlternarDoencaIndividuo(individuo) {
  const atualizado = {
    ...individuo,
    doente: !individuo.doente,
    status_sync: 'pendente',
  }
  await bioOfflineSalvarIndividuo(atualizado)
  BioApp.individuoAtual = atualizado
  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast('Doença removida do filhote #' + individuo.numero + '.', 'ok')
  bioAbrirTelaDetalheIndividuo(atualizado)
}

// Anomalia é congênita (conhecida desde a eclosão, não um evento durante o
// cuidado) — toggle direto nos dois sentidos, sem passar por ocorrência
// (diferente de doença/óbito, que registram causa/data de verdade).
async function bioAlternarAnomaliaIndividuo(individuo) {
  const atualizado = {
    ...individuo,
    anomalia: !individuo.anomalia,
    status_sync: 'pendente',
  }
  await bioOfflineSalvarIndividuo(atualizado)
  BioApp.individuoAtual = atualizado
  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast(atualizado.anomalia ? 'Anomalia marcada no filhote #' + individuo.numero + '.' : 'Anomalia removida do filhote #' + individuo.numero + '.', 'ok')
  bioAbrirTelaDetalheIndividuo(atualizado)
}

// ── Biometria individual (modo único ou sequencial) ───────────
function bioAbrirFormBiometriaInd(individuo, opts = {}) {
  BioApp.individuoAtual = individuo
  BioApp._bioSeqOpts = opts
  const el = id => document.getElementById(id)
  if (el('bio-bio-ind-numero')) el('bio-bio-ind-numero').textContent = individuo.numero
  if (el('bio-bio-ind-comp'))     el('bio-bio-ind-comp').value = ''
  if (el('bio-bio-ind-largura'))  el('bio-bio-ind-largura').value = ''
  if (el('bio-bio-ind-plastrao')) el('bio-bio-ind-plastrao').value = ''
  if (el('bio-bio-ind-peso'))     el('bio-bio-ind-peso').value = ''
  if (el('bio-bio-ind-obs'))    el('bio-bio-ind-obs').value  = ''
  if (el('bio-bio-ind-data'))   el('bio-bio-ind-data').value = new Date().toISOString().slice(0, 10)
  if (el('bio-bio-ind-hora'))   el('bio-bio-ind-hora').value = new Date().toTimeString().slice(0, 5)

  const progEl = el('bio-bio-ind-progresso')
  const pularBtn = el('bio-btn-pular-biometria-ind')
  if (opts.sequencial) {
    if (progEl) { progEl.hidden = false; progEl.textContent = `Filhote ${opts.indexAtual + 1} de ${opts.total}` }
    if (pularBtn) pularBtn.hidden = false
  } else {
    if (progEl) progEl.hidden = true
    if (pularBtn) pularBtn.hidden = true
  }

  bioMostrarTela('tela-biometria-individual')
}

// Ninhada de indivíduos ainda por medir na sequência atual
function bioAvancarSequenciaBiometria() {
  const opts = BioApp._bioSeqOpts
  if (!opts?.sequencial) { bioAbrirTelaDetalheIndividuo(BioApp.individuoAtual); return }

  const proximoIndex = opts.indexAtual + 1
  if (proximoIndex >= opts.fila.length) {
    bioToast(`Sequência concluída! ${opts.fila.length} filhote(s) medido(s)/revisado(s).`, 'ok')
    if (BioApp.bercarioAtual) bioAbrirDetalheBercario(BioApp.bercarioAtual)
    return
  }
  bioAbrirFormBiometriaInd(opts.fila[proximoIndex], { ...opts, indexAtual: proximoIndex })
}

async function bioIniciarBiometriaSequencial(bercarioId, temporadaId) {
  const individuos = await bioOfflineIndividuosDoBercario(bercarioId, temporadaId)
  const ativos = individuos.filter(i => i.status === 'ativo')
  if (!ativos.length) { bioToast('Nenhum filhote ativo neste berçário.', 'err'); return }
  bioAbrirFormBiometriaInd(ativos[0], { sequencial: true, indexAtual: 0, total: ativos.length, fila: ativos })
}

async function bioSalvarBiometriaInd() {
  const individuo = BioApp.individuoAtual
  if (!individuo) return

  const data = document.getElementById('bio-bio-ind-data').value
  if (!data) { bioToast('Informe a data da biometria.', 'err'); return }

  const comp     = parseFloat(document.getElementById('bio-bio-ind-comp').value) || null
  const largura  = parseFloat(document.getElementById('bio-bio-ind-largura').value) || null
  const plastrao = parseFloat(document.getElementById('bio-bio-ind-plastrao').value) || null
  const peso     = parseFloat(document.getElementById('bio-bio-ind-peso').value) || null
  if (comp == null && largura == null && plastrao == null && peso == null) {
    bioToast('Informe ao menos uma medida.', 'err'); return
  }

  const b = {
    uuid_cliente:           bioUuid(),
    individuo_uuid:         individuo.uuid_cliente,
    data_medicao:           data,
    hora_medicao:           document.getElementById('bio-bio-ind-hora').value || null,
    comprimento_cm:         comp,
    largura_carapaca_cm:    largura,
    comprimento_plastrao_cm: plastrao,
    peso_g:                 peso,
    observacoes:            document.getElementById('bio-bio-ind-obs').value.trim() || null,
    status_sync:            'pendente',
    criado_em:              new Date().toISOString(),
  }

  await bioOfflineSalvarBiometriaInd(b)
  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast(`Biometria salva — filhote #${individuo.numero}.`, 'ok')
  bioAvancarSequenciaBiometria()
}

async function bioCarregarTimelineBercario(bercarioId, temporadaId) {
  const timelineEl = document.getElementById('bio-det-timeline')
  if (!timelineEl) return

  const lotes = await bioOfflineLotesDoBercario(bercarioId, temporadaId)
  const porLote = await Promise.all(lotes.map(l => bioOfflineOcorrenciasDoLote(l.uuid_cliente)))
  const ocorrencias = porLote.flat().sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? ''))

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
          ${_bioFotosGridHtml(oc.foto_urls)}
        </div>
      </div>
    `
  }).join('')
  assinarFotos(timelineEl)
}

function bioAbrirFormOcorrencia(lote) {
  BioApp.loteAtual = lote
  BioApp.ocorrenciaIndividuoCtx = null
  document.getElementById('bio-form-ocorrencia-titulo').textContent = 'Nova Ocorrência'
  document.getElementById('bio-oc-tipo-secao').hidden = false
  document.getElementById('bio-oc-tipo-fixo-wrap').hidden = true
  document.getElementById('bio-oc-aff-minus').hidden = false
  document.getElementById('bio-oc-aff-plus').hidden = false
  document.getElementById('bio-oc-data').value = new Date().toISOString().slice(0, 10)
  document.getElementById('bio-oc-hora').value = new Date().toTimeString().slice(0, 5)
  document.getElementById('bio-oc-comp').value = ''
  document.getElementById('bio-oc-peso').value = ''
  document.getElementById('bio-oc-amostrados').value = ''
  document.getElementById('bio-oc-causa').value = ''
  document.getElementById('bio-oc-causa').placeholder = 'Descreva a causa…'
  document.getElementById('bio-oc-descricao').value = ''
  document.getElementById('bio-oc-afetados').value = 0
  document.getElementById('bio-oc-afetados').readOnly = false

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

// Abre o mesmo formulário de ocorrência, travado no tipo doença/mortalidade
// e vinculado a um filhote específico — usado por "Marcar doente" e
// "Marcar óbito" na tela do indivíduo, para registrar o histórico de
// verdade (causa, data, hora) em vez de só trocar um status.
const BIO_OC_TIPO_NOME_FIXO = { doenca: 'Doença', mortalidade: 'Mortalidade' }

async function bioAbrirFormOcorrenciaIndividuo(individuo, tipo) {
  const lote = await bioOfflineGetLote(individuo.lote_uuid)
  if (!lote) { bioToast('Lote do filhote não encontrado.', 'err'); return }

  bioAbrirFormOcorrencia(lote)
  BioApp.ocorrenciaIndividuoCtx = { individuo, tipo }

  document.getElementById('bio-form-ocorrencia-titulo').textContent =
    tipo === 'doenca' ? 'Registrar Doença' : 'Registrar Óbito'
  document.getElementById('bio-oc-tipo-secao').hidden = true
  document.getElementById('bio-oc-tipo-fixo-wrap').hidden = false
  document.getElementById('bio-oc-tipo-fixo-txt').textContent = BIO_OC_TIPO_NOME_FIXO[tipo] ?? tipo
  bioAtualizarCamposOcorrencia(tipo)

  document.getElementById('bio-oc-afetados').value = 1
  document.getElementById('bio-oc-afetados').readOnly = true
  document.getElementById('bio-oc-aff-minus').hidden = true
  document.getElementById('bio-oc-aff-plus').hidden = true

  document.getElementById('bio-oc-descricao').value = `Filhote #${individuo.numero}`
  document.getElementById('bio-oc-causa').placeholder =
    tipo === 'doenca' ? 'Sintomas / causa da doença…' : 'Causa do óbito…'
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

  const ctx  = BioApp.ocorrenciaIndividuoCtx
  const tipo = ctx ? ctx.tipo : (document.querySelector('#bio-oc-tipo-grid .bio-oc-chip.ativo')?.dataset.tipo ?? 'observacao')
  const data = document.getElementById('bio-oc-data').value
  if (!data) { bioToast('Informe a data da ocorrência.', 'err'); return }

  const causa = document.getElementById('bio-oc-causa').value.trim() || null
  if (ctx && !causa) { bioToast('Informe a causa.', 'err'); return }

  const oc = {
    uuid_cliente:         bioUuid(),
    lote_uuid:            lote.uuid_cliente,
    individuo_uuid:       ctx?.individuo.uuid_cliente ?? null,
    tipo,
    data_ocorrencia:      data,
    hora_ocorrencia:      document.getElementById('bio-oc-hora').value  || null,
    comprimento_medio_cm: parseFloat(document.getElementById('bio-oc-comp').value)         || null,
    peso_medio_g:         parseFloat(document.getElementById('bio-oc-peso').value)         || null,
    n_amostrados:         parseInt(document.getElementById('bio-oc-amostrados').value)     || null,
    qtd_afetados:         ctx ? 1 : (parseInt(document.getElementById('bio-oc-afetados').value) || 0),
    causa,
    descricao:            document.getElementById('bio-oc-descricao').value.trim()         || null,
    foto_urls:            BioApp._fotosOc?.length ? [...BioApp._fotosOc] : [],
    status_sync:          'pendente',
    criado_em:            new Date().toISOString(),
  }

  await bioOfflineSalvarOcorrencia(oc)

  if (ctx) {
    const atualizado = ctx.tipo === 'doenca'
      ? { ...ctx.individuo, doente: true, status_sync: 'pendente' }
      : { ...ctx.individuo, status: 'morto', data_obito: data, causa_obito: causa, status_sync: 'pendente' }
    await bioOfflineSalvarIndividuo(atualizado)
  }

  bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: () => bioAtualizarBadgeFila() })
  bioToast('Ocorrência registrada!', 'ok')

  if (ctx) {
    BioApp.ocorrenciaIndividuoCtx = null
    const indAtualizado = await bioOfflineGetIndividuo(ctx.individuo.uuid_cliente)
    bioAbrirTelaDetalheIndividuo(indAtualizado)
  } else if (BioApp.bercarioAtual) {
    bioAbrirDetalheBercario(BioApp.bercarioAtual)
  }
}

// Lote ativo mais recente do berçário — usado como destino padrão de
// uma nova ocorrência (ocorrencias_bercario exige um lote específico).
function _bioLoteParaOcorrencia(bercarioAtual) {
  const ativos = (bercarioAtual?.lotes || []).filter(l => l.status === 'ativo')
  if (!ativos.length) return null
  return ativos.reduce((mais, l) => (l.data_entrada > mais.data_entrada ? l : mais), ativos[0])
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
    const _ninhoDest = BioApp.formDestinoCtx?.ninho
    bioAbrirSeletorBercario(b => {
      BioApp.formBercarioSelecionado = b
      const nomeSpan = document.getElementById('bio-berc-nome-txt')
      if (nomeSpan) nomeSpan.textContent = b.nome
      bioMostrarTela('tela-form-entrada-bercario')
    }, _ninhoDest?.especie, _ninhoDest?.temporada_id ?? BioApp.temporadaAtual?.id ?? null)
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

  // Detalhe do berçário: botões de ação
  document.getElementById('bio-btn-nova-ocorrencia')?.addEventListener('click', () => {
    const lote = _bioLoteParaOcorrencia(BioApp.bercarioAtual)
    if (!lote) { bioToast('Nenhum lote ativo neste berçário.', 'err'); return }
    bioAbrirFormOcorrencia(lote)
  })
  document.getElementById('bio-btn-salvar-ocorrencia')?.addEventListener('click', bioSalvarOcorrencia)
  document.getElementById('bio-btn-soltar-lote')?.addEventListener('click', () => {
    const berc = BioApp.bercarioAtual
    if (!berc) return
    bioAbrirSolturaBercario(berc.id, berc.nome, berc.temporadaId)
  })

  // Voltar da tela de ocorrência para detalhe (do lote, ou do indivíduo
  // quando veio de "Marcar doente"/"Marcar óbito")
  document.getElementById('bio-oc-back')?.addEventListener('click', () => {
    if (BioApp.ocorrenciaIndividuoCtx) {
      const individuo = BioApp.ocorrenciaIndividuoCtx.individuo
      BioApp.ocorrenciaIndividuoCtx = null
      bioAbrirTelaDetalheIndividuo(individuo)
      return
    }
    if (BioApp.bercarioAtual) bioAbrirDetalheBercario(BioApp.bercarioAtual)
    else bioMostrarTela('tela-bercarios')
  })

  // Filhotes individuais: abrir detalhe ao tocar num chip
  document.getElementById('bio-det-filhotes-lista')?.addEventListener('click', async e => {
    const chip = e.target.closest('.bio-filhote-chip')
    if (!chip) return
    const individuo = await bioOfflineGetIndividuo(chip.dataset.individuoUuid)
    if (individuo) bioAbrirTelaDetalheIndividuo(individuo)
  })
  document.getElementById('bio-btn-biometria-seq')?.addEventListener('click', () => {
    if (BioApp.bercarioAtual) bioIniciarBiometriaSequencial(BioApp.bercarioAtual.id, BioApp.bercarioAtual.temporadaId)
  })

  // Fotos do histórico (ocorrências/soltura): tocar abre em tela cheia
  document.getElementById('tela-detalhe-lote')?.addEventListener('click', e => {
    const foto = e.target.closest('.bio-foto-clicavel')
    if (foto) bioAbrirFotoTelaCheia(foto.dataset.fotoUrl)
  })
  document.getElementById('bio-foto-viewer-fechar')?.addEventListener('click', bioFecharFotoTelaCheia)
  document.getElementById('bio-foto-viewer')?.addEventListener('click', e => {
    if (e.target.id === 'bio-foto-viewer') bioFecharFotoTelaCheia()
  })

  // Detalhe do indivíduo
  document.getElementById('bio-ind-back')?.addEventListener('click', () => {
    if (BioApp.bercarioAtual) bioAbrirDetalheBercario(BioApp.bercarioAtual)
    else bioMostrarTela('tela-bercarios')
  })
  document.getElementById('bio-btn-nova-biometria-ind')?.addEventListener('click', () => {
    if (BioApp.individuoAtual) bioAbrirFormBiometriaInd(BioApp.individuoAtual, { sequencial: false })
  })
  document.getElementById('bio-btn-obito-individuo')?.addEventListener('click', () => {
    const ind = BioApp.individuoAtual
    if (ind) bioAbrirFormOcorrenciaIndividuo(ind, 'mortalidade')
  })
  document.getElementById('bio-btn-doenca-individuo')?.addEventListener('click', () => {
    const ind = BioApp.individuoAtual
    if (!ind) return
    if (ind.doente) { bioAlternarDoencaIndividuo(ind); return }
    bioAbrirFormOcorrenciaIndividuo(ind, 'doenca')
  })
  document.getElementById('bio-btn-anomalia-individuo')?.addEventListener('click', () => {
    const ind = BioApp.individuoAtual
    if (!ind) return
    bioAlternarAnomaliaIndividuo(ind)
  })

  // Biometria individual
  document.getElementById('bio-bio-ind-back')?.addEventListener('click', () => {
    const opts = BioApp._bioSeqOpts
    if (opts?.sequencial) { if (BioApp.bercarioAtual) bioAbrirDetalheBercario(BioApp.bercarioAtual) }
    else if (BioApp.individuoAtual) bioAbrirTelaDetalheIndividuo(BioApp.individuoAtual)
  })
  document.getElementById('bio-btn-salvar-biometria-ind')?.addEventListener('click', bioSalvarBiometriaInd)
  document.getElementById('bio-btn-pular-biometria-ind')?.addEventListener('click', bioAvancarSequenciaBiometria)

  // Botão salvar
  document.getElementById('bio-btn-salvar-entrada-bercario')?.addEventListener('click', bioSalvarEntradaBercario)
  document.getElementById('bio-btn-salvar-soltura')?.addEventListener('click',           bioSalvarSoltura)
  document.getElementById('bio-btn-reload-bercarios')?.addEventListener('click',         bioCarregarBercarios)
  document.getElementById('bio-btn-bercarios')?.addEventListener('click',                bioAbrirTelaBercarios)
  document.getElementById('bio-berc-busca')?.addEventListener('input', e => {
    BioApp.bercarioFiltro = e.target.value
    bioCarregarBercarios()
  })
  document.getElementById('bio-berc-status-toggle')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-status]')
    if (!btn) return
    document.querySelectorAll('#bio-berc-status-toggle .bio-oc-chip').forEach(b => b.classList.remove('ativo'))
    btn.classList.add('ativo')
    BioApp.bercarioStatusFiltro = btn.dataset.status
    bioCarregarBercarios()
  })

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

  // Danos aos ovos: zera os campos por causa e a causa de destruição
  ;['bio-vis-perda-predacao','bio-vis-perda-alagamento','bio-vis-perda-erosao','bio-vis-perda-humana']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
  const _pt = document.getElementById('bio-vis-predacao-tipo'); if (_pt) _pt.value = 'desconhecida'
  const _cd = document.getElementById('bio-vis-causa-destruicao'); if (_cd) _cd.value = 'predacao'

  // Status: íntegro por padrão
  document.querySelectorAll('#bio-vis-status-grid .bio-chip-sel').forEach(c => {
    c.classList.toggle('ativo', c.dataset.val === 'integro')
  })
  bioAtualizarDanosVisita()

  // Umidade: sem seleção
  document.querySelectorAll('#bio-vis-umidade-grid .bio-chip-sel').forEach(c => {
    c.classList.toggle('ativo', c.dataset.val === '')
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

/* ════════════════════════════════════════════════════════════
   DANOS AOS OVOS NA VISITA
   ════════════════════════════════════════════════════════════ */
// Ovos viáveis = postura − todas as baixas conhecidas do ninho.
function bioOvosViaveisNinho(n) {
  if (!n || n.qtd_ovos == null) return null
  const perdas = (n.descartados_natural || 0) + (n.descartados_predacao || 0) + (n.descartados_humana || 0)
  return Math.max(n.qtd_ovos - perdas, 0)
}

// Mostra/oculta os blocos de dano conforme o status; calcula o viável,
// limita os campos e valida a soma.
function bioAtualizarDanosVisita() {
  const status  = document.querySelector('#bio-vis-status-grid .bio-chip-sel.ativo')?.dataset.val ?? 'integro'
  const ninho   = BioApp.formNinhoAtualizar
  const viavel  = bioOvosViaveisNinho(ninho)
  const danos   = document.getElementById('bio-vis-danos-wrap')
  const destr   = document.getElementById('bio-vis-destruicao-wrap')
  const comDano = ['perturbado', 'parcial_predado', 'alagado'].includes(status)

  if (destr) destr.hidden = status !== 'destruido'
  if (danos) danos.hidden = !comDano

  if (status === 'destruido') {
    const info = document.getElementById('bio-vis-destruicao-info')
    if (info) info.textContent = viavel != null
      ? `Os ${viavel} ovo(s) viável(is) restantes serão baixados e o ninho marcado como perdido.`
      : 'Os ovos viáveis restantes serão baixados e o ninho marcado como perdido.'
    return
  }
  if (!comDano) return

  const info = document.getElementById('bio-vis-viavel-info')
  if (info) info.innerHTML = viavel != null
    ? `Ovos viáveis agora: <b>${viavel}</b>. Não é possível perder mais do que isso.`
    : 'Informe quantos ovos foram perdidos por causa.'

  const ids = ['bio-vis-perda-predacao','bio-vis-perda-alagamento','bio-vis-perda-erosao','bio-vis-perda-humana']
  let soma = 0
  ids.forEach(id => {
    const el = document.getElementById(id)
    if (!el) return
    if (viavel != null) el.max = viavel
    soma += parseInt(el.value) || 0
  })
  // Subtipo de predação só quando há predação
  const pTipo = document.getElementById('bio-vis-predacao-tipo-wrap')
  if (pTipo) pTipo.hidden = (parseInt(document.getElementById('bio-vis-perda-predacao')?.value) || 0) <= 0

  const aviso = document.getElementById('bio-vis-danos-aviso')
  if (aviso) {
    if (viavel != null && soma > viavel) {
      aviso.style.display = 'block'
      aviso.textContent = `A soma das perdas (${soma}) passa dos ${viavel} ovos viáveis. Ajuste os valores.`
    } else {
      aviso.style.display = 'none'
    }
  }
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

  const statusNinho = document.querySelector('#bio-vis-status-grid .bio-chip-sel.ativo')?.dataset.val ?? 'integro'
  const umidade     = document.querySelector('#bio-vis-umidade-grid .bio-chip-sel.ativo')?.dataset.val || null

  // ── Danos aos ovos ──────────────────────────────────────────
  const _intVal = id => Math.max(parseInt(document.getElementById(id)?.value) || 0, 0)
  const viavel  = bioOvosViaveisNinho(ninho)
  const destruido = statusNinho === 'destruido'

  let perdaPred = 0, perdaAlag = 0, perdaEros = 0, perdaHum = 0, causaDestr = null, predTipo = null
  if (destruido) {
    causaDestr = document.getElementById('bio-vis-causa-destruicao')?.value || 'outro'
    if (!confirm(`Destruição total: os ${viavel ?? ''} ovo(s) viável(is) restantes serão baixados e o ninho marcado como PERDIDO. Confirmar?`)) return
  } else {
    perdaPred = _intVal('bio-vis-perda-predacao')
    perdaAlag = _intVal('bio-vis-perda-alagamento')
    perdaEros = _intVal('bio-vis-perda-erosao')
    perdaHum  = _intVal('bio-vis-perda-humana')
    const soma = perdaPred + perdaAlag + perdaEros + perdaHum
    if (viavel != null && soma > viavel) {
      bioToast(`A soma das perdas (${soma}) passa dos ${viavel} ovos viáveis.`, 'err'); return
    }
    if (perdaPred > 0) predTipo = document.getElementById('bio-vis-predacao-tipo')?.value || 'desconhecida'
  }

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
    predacao_incubacao:      predTipo,
    ovos_predados_n:         perdaPred || null,
    ovos_perdidos_alagamento: perdaAlag || null,
    ovos_perdidos_erosao:    perdaEros || null,
    ovos_perdidos_humana:    perdaHum  || null,
    causa_destruicao:        causaDestr,
    sinal_alagamento:        document.getElementById('bio-vis-alagamento').checked,
    intervencao:             document.getElementById('bio-vis-intervencao').value.trim() || null,
    observacoes:             document.getElementById('bio-vis-obs').value.trim()         || null,
    foto_urls:               BioApp._fotosVis?.length ? [...BioApp._fotosVis] : [],
    alerta_campo:            _alertaCampoVisita,
    status_sync:             'pendente',
    criado_em:               new Date().toISOString(),
  }

  await bioOfflineSalvarVisita(visita)
  // Destruição total: reflete localmente o ninho como perdido (o trigger
  // faz o mesmo no servidor ao sincronizar).
  if (destruido) {
    await bioOfflineSalvarNinho({
      ...ninho, server_id: ninho.server_id ?? ninho.id ?? null, status: 'perdido',
    }).catch(() => {})
  }
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
      bioAtualizarDanosVisita()
    })
  })

  // Campos de dano aos ovos → revalida viável/soma ao vivo
  ;['bio-vis-perda-predacao','bio-vis-perda-alagamento','bio-vis-perda-erosao','bio-vis-perda-humana']
    .forEach(id => document.getElementById(id)?.addEventListener('input', bioAtualizarDanosVisita))

  // Chip de umidade
  document.querySelectorAll('#bio-vis-umidade-grid .bio-chip-sel').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bio-vis-umidade-grid .bio-chip-sel').forEach(b => b.classList.remove('ativo'))
      btn.classList.add('ativo')
    })
  })

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

// Monta o histórico de cada ninho (postura → transferência(s) → visitas →
// berçário → soltura → eclosão), ordenado por data+hora, com saldo de
// ovos viáveis — via js/biomonitor-timeline.js (compartilhado com a
// página de validação). Aqui só mescla as visitas locais (IndexedDB),
// pendentes de sync ou registradas offline.
async function bioCarregarEventosNinhos(ninhos) {
  const mapa = {}
  ninhos.forEach(n => { mapa[n.uuid_cliente] = [] })

  // Mescla as visitas locais (IndexedDB) no histórico, para que apareçam
  // mesmo offline ou antes de sincronizar. `somentePendentes` evita
  // duplicar as que já subiram e voltam do servidor.
  const mesclarVisitasLocais = async (somentePendentes) => {
    for (const n of ninhos) {
      const arr = mapa[n.uuid_cliente]; if (!arr) continue
      const locais = await bioOfflineVisitasDoNinho(n.uuid_cliente).catch(() => [])
      locais
        .filter(v => !somentePendentes || v.status_sync !== 'confirmado')
        .forEach(v => arr.push(bioEventoVisita(v)))
    }
  }

  if (!navigator.onLine) {
    await mesclarVisitasLocais(false)   // offline: todas as visitas locais
    ninhos.forEach(n => { n._eventos = bioMontarHistoricoNinho(n, mapa[n.uuid_cliente]) })
    return
  }

  const mapaServidor = await bioBuscarEventosServidor(bioSupabase(), ninhos)
  Object.keys(mapaServidor).forEach(uuid => { mapa[uuid].push(...mapaServidor[uuid]) })

  // Visitas locais ainda não sincronizadas (recém-registradas) — para
  // aparecerem no histórico imediatamente, sem esperar o sync.
  await mesclarVisitasLocais(true)

  ninhos.forEach(n => { n._eventos = bioMontarHistoricoNinho(n, mapa[n.uuid_cliente]) })
}

async function bioCarregarAbertos() {
  const filtroPraia  = BioApp.abertosFiltroPraia
  const filtroStatus = BioApp.abertosStatusFiltro
  const estadoEl = document.getElementById('bio-abertos-estado')
  const listaEl  = document.getElementById('bio-lista-abertos')
  estadoEl.textContent = 'Carregando do servidor…'; estadoEl.hidden = false
  listaEl.innerHTML = ''

  // "Eclodido" agrega os status pós-eclosão — depois da eclosão o ninho
  // avança para em_bercario/soltado e sumia do filtro
  const POS_ECLOSAO = ['eclodido', 'em_bercario', 'soltado']
  const estaAberto = n => filtroStatus
    ? (filtroStatus === 'eclodido' ? POS_ECLOSAO.includes(n.status) : n.status === filtroStatus)
    : n.status !== 'perdido'

  let ninhos = []

  if (navigator.onLine && BioApp.monitor?.grupo_id) {
    try {
      let q = bioSupabase()
        .from('vw_ninhos_validacao')
        .select('id,uuid_cliente,numero_ninho,numero_atual,especie,data_encontro,hora_desova,status,status_validacao,motivo_rejeicao,qtd_ovos,ovos_integros,ovos_descartados,descartados_natural,descartados_predacao,descartados_humana,ovos_viaveis,ovos_perdidos_total,dist_rio_m,dist_rio_metodo,temperatura_c,umidade_pct,profundidade_cm,observacoes,foto_urls,lat,lng,precisao_gps_m,criado_em,praia_id,praia_nome,praia_atual_id,praia_atual_nome,monitor_id,monitor_nome,data_nascimento,filhotes_vivos,filhotes_mortos,ovos_nao_nascidos,incubacao_dias_previstos,data_prevista_eclosao,dias_para_eclosao,contagem_ovos_metodo,qtd_ovos_estimado_original')
        .eq('grupo_id', BioApp.monitor.grupo_id)
        .order('numero_atual', { ascending: false })
      // Escopa à temporada atual — sem isso, ninhos de temporadas encerradas
      // (ex.: histórico lançado no sistema) aparecem misturados na lista.
      if (BioApp.temporadaAtual?.id) q = q.eq('temporada_id', BioApp.temporadaAtual.id)
      if (filtroStatus === 'eclodido') {
        q = q.in('status', POS_ECLOSAO)
      } else if (filtroStatus) {
        q = q.eq('status', filtroStatus)
      } else {
        q = q.neq('status', 'perdido')
      }
      // Filtra pela praia onde o ninho está incubando AGORA (praia atual)
      if (filtroPraia) q = q.eq('praia_atual_id', filtroPraia.id)
      const { data, error } = await q
      if (error) throw error

      // Mescla: inclui ninhos locais pendentes que ainda não chegaram no servidor
      const localPend = (await bioOfflineListarNinhos(filtroPraia ? { praiaAtualId: filtroPraia.id } : {}))
        .filter(n => bioNinhoNaTemporada(n, BioApp.temporadaAtual))
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
      const localAll = (await bioOfflineListarNinhos(filtroPraia ? { praiaAtualId: filtroPraia.id } : {}))
        .filter(n => bioNinhoNaTemporada(n, BioApp.temporadaAtual))
      ninhos = localAll.filter(estaAberto).map(n => bioMapNinhoPraias(n, praias))
    }
  } else {
    estadoEl.textContent = 'Offline — exibindo dados locais'
    const praias   = await bioOfflineListarPraias()
    const localAll = (await bioOfflineListarNinhos(filtroPraia ? { praiaAtualId: filtroPraia.id } : {}))
      .filter(n => bioNinhoNaTemporada(n, BioApp.temporadaAtual))
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

  await bioCarregarEventosNinhos(ninhos)
  bioRenderizarListaNinhos('bio-lista-abertos', ninhos, true)
}

async function bioAbrirTelaHistorico() {
  const praiaId = BioApp.praiaAtual?.id
  const ninhos  = (await bioOfflineListarNinhos({ praiaId }))
    .filter(n => bioNinhoNaTemporada(n, BioApp.temporadaAtual))
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

  // Ovos viáveis = postura − todas as baixas (registro/visita/eclosão).
  // Fonte canônica: vw_ninhos_validacao.ovos_viaveis (mesma do mapa e
  // dos painéis). Ninhos ainda locais/não sincronizados não têm essa
  // coluna — cai no cálculo a partir dos descartes já mesclados.
  const _perdas   = (n.descartados_natural || 0) + (n.descartados_predacao || 0) + (n.descartados_humana || 0)
  const _viaveis  = n.ovos_viaveis ?? (n.qtd_ovos != null ? Math.max(n.qtd_ovos - _perdas, 0) : null)
  const _perdidoTotal = n.ovos_perdidos_total ?? _perdas
  // Postura estimada — ver "Regra do sistema — postura de ovos por
  // estimativa". 'estimado' aguarda confirmação; 'confirmado_eclosao'
  // já foi corrigido e mostra o número original ao lado.
  const posturaBadgeHtml = n.contagem_ovos_metodo === 'estimado'
    ? `<span style="background:rgba(201,168,76,.2);color:#8a6d1f">Postura estimada</span>`
    : n.contagem_ovos_metodo === 'confirmado_eclosao'
      ? `<span style="background:rgba(82,183,136,.18);color:#1E6B4A">Estimado ${n.qtd_ovos_estimado_original ?? '—'} → confirmado ${n.qtd_ovos ?? '—'}</span>`
      : ''

  const ovosHtml = (n.qtd_ovos != null || n.ovos_integros != null || n.ovos_descartados != null) ? `
    <div class="bio-nfc-ovos">
      ${n.qtd_ovos         != null ? `<span>${n.qtd_ovos} ovos</span>` : ''}
      ${posturaBadgeHtml}
      ${n.ovos_integros    != null ? `<span>${n.ovos_integros} ínt. na postura</span>` : ''}
      ${n.ovos_descartados != null ? `<span>${n.ovos_descartados} desc. na postura</span>` : ''}
      ${_perdidoTotal > 0 ? `<span style="background:rgba(248,113,113,.18);color:#B91C1C">${_perdidoTotal} perdidos depois</span>` : ''}
      ${(_viaveis != null && (n.ovos_perdidos_total > 0 || _perdas > 0)) ? `<span style="background:rgba(82,183,136,.18);color:#1E6B4A">${_viaveis} viáveis</span>` : ''}
    </div>` : ''

  const condicoesHtml = (n.temperatura_c != null || n.umidade_pct != null || n.profundidade_cm != null) ? `
    <div class="bio-nfc-ovos">
      ${n.temperatura_c  != null ? `<span>${n.temperatura_c}°C</span>` : ''}
      ${n.umidade_pct    != null ? `<span>${n.umidade_pct}% hum.</span>` : ''}
      ${n.profundidade_cm != null ? `<span>${n.profundidade_cm} cm prof.</span>` : ''}
    </div>` : ''

  // Resumo da eclosão (quando o ninho já eclodiu)
  // Previsão de eclosão — só para ninhos ainda em incubação
  const prev = ['encontrado', 'transferido'].includes(n.status) ? bioPrevisaoEclosao(n) : null
  const previsaoHtml = prev ? `
    <div class="bio-nfc-previsao faixa-${prev.faixa}">
      <span class="bio-nfc-prev-ico" aria-hidden="true"></span>
      <span><b>Eclosão prevista:</b> ${prev.dataTxt} · ${esc(prev.texto)}</span>
    </div>` : ''

  const eclosaoHtml = (['eclodido', 'em_bercario', 'soltado'].includes(n.status) && (n.filhotes_vivos != null || n.filhotes_mortos != null || n.data_nascimento)) ? `
    <div class="bio-nfc-ovos">
      <span style="background:rgba(82,183,136,.18);color:#1E6B4A">Eclosão${n.data_nascimento ? ' ' + new Date(n.data_nascimento + 'T12:00').toLocaleDateString('pt-BR') : ''}</span>
      ${n.filhotes_vivos    != null ? `<span style="background:rgba(82,183,136,.12);color:#1E6B4A">${n.filhotes_vivos} vivos</span>` : ''}
      ${n.filhotes_mortos             ? `<span style="background:rgba(220,38,38,.1);color:#DC2626">${n.filhotes_mortos} mortos</span>` : ''}
      ${n.ovos_nao_nascidos           ? `<span style="background:rgba(127,127,127,.12);color:#6B7280">${n.ovos_nao_nascidos} não nasc.</span>` : ''}
    </div>` : ''

  // Destino dos filhotes (pós-eclosão): berçário ou rio, derivado do
  // status + eventos do servidor (lote de berçário / soltura via_bercario)
  let destinoHtml = ''
  if (['eclodido', 'em_bercario', 'soltado'].includes(status)) {
    const evs = n._eventos || []
    const foiBercario = status === 'em_bercario' || evs.some(ev => ev.tipo === 'bercario')
    const soltoDireto = evs.some(ev => ev.tipo === 'soltura' && ev.via_bercario === false)
    let txt, cor, bg
    if (status === 'em_bercario') {
      txt = 'Filhotes no berçário';  cor = '#7c3aed'; bg = '#7c3aed14'
    } else if (status === 'soltado') {
      txt = foiBercario ? 'Berçário → soltos no rio'
          : soltoDireto ? 'Soltos direto no rio'
          : 'Filhotes soltos no rio'
      cor = '#1A6B8C'; bg = '#1A6B8C14'
    } else {
      txt = 'Aguardando destino dos filhotes'; cor = '#B45309'; bg = '#D9770614'
    }
    destinoHtml = `<div style="margin-top:5px;font-size:12px;font-weight:600;color:${cor};background:${bg};border-radius:6px;padding:3px 8px;display:inline-block">${txt}</div>`
  }

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
      ${['encontrado', 'transferido'].includes(status) ? `<button class="bio-btn-sm ghost" data-acao="eclosao">Eclosão</button>` : ''}
      ${status === 'eclodido' ? `<button class="bio-btn-sm prim" data-acao="soltar">Soltar</button>` : ''}
      ${status !== 'perdido' ? `<button class="bio-btn-sm ghost" data-acao="visita">Visita</button>` : ''}
      <button class="bio-btn-sm ghost" data-acao="pdf" ${navigator.onLine ? '' : 'disabled title="Requer conexão"'}>Gerar PDF</button>
    </div>` : ''

  const histHtml = bioTimelineHtml(n._eventos)

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
    ${previsaoHtml}
    ${eclosaoHtml}
    ${destinoHtml}
    ${histHtml}
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
        if (btn.dataset.acao === 'pdf')           bioGerarPDFCampo(n)
      })
    })
    card.querySelectorAll('[data-nh-toggle]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const hist = card.querySelector('[data-nh-hist]')
        if (!hist) return
        const vis = hist.classList.toggle('vis')
        btn.classList.toggle('aberto', vis)
      })
    })
    card.querySelectorAll('[data-nh-detalhe]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        bioAbrirDetalhesVisita(btn.dataset.nhDetalhe)
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
  let ninhos    = (await bioOfflineListarNinhos(filtroPraia ? { praiaId: filtroPraia.id } : {}))
    .filter(n => bioNinhoNaTemporada(n, BioApp.temporadaAtual))

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

  // Registros que falharam no envio (3+ tentativas) — de qualquer tipo.
  const erros = await bioOfflineTodosComErro().catch(() => [])
  if (erros.length) {
    const box = document.createElement('div')
    box.className = 'bio-sync-erros'
    box.innerHTML = `
      <div class="bio-sync-erros-head">
        <b>${erros.length} registro(s) não enviado(s)</b>
        <button type="button" id="bio-sync-retry" class="bio-btn-sm prim">Tentar de novo</button>
      </div>
      ${erros.map(er => `
        <div class="bio-sync-erro-item">
          <span class="bio-sync-erro-tipo">${er.tipo}${er.item.ninho_numero ? ' · ' + esc(er.item.ninho_numero) : (er.item.numero_ninho ? ' · ' + esc(er.item.numero_ninho) : '')}</span>
          <span class="bio-sync-erro-msg">${esc(er.item.sync_erro || 'falha no envio')}</span>
        </div>`).join('')}`
    container.appendChild(box)
    box.querySelector('#bio-sync-retry')?.addEventListener('click', async () => {
      const btn = box.querySelector('#bio-sync-retry')
      if (btn) { btn.disabled = true; btn.textContent = 'Reenviando…' }
      await bioOfflineReenfileirarErros()
      bioSyncTudo({ monitorId: BioApp.monitor?.id, onConcluido: async () => {
        await bioAtualizarBadgeFila(); await bioCarregarFilaLocal()
      } })
    })
  }

  if (!ninhos.length) {
    if (!erros.length) container.innerHTML = '<p style="text-align:center;color:#9CA3AF;padding:32px 16px">Nenhum ninho registrado localmente.</p>'
    return
  }

  ninhos.forEach(n => {
    const esp      = BIO_ESPECIES.find(e => e.id === n.especie)
    const praia    = praias.find(p => p.id === (n.praia_atual_id ?? n.praia_id))
    const numExib  = n.numero_atual ?? n.numero_ninho
    const syncOk   = n.status_sync === 'confirmado'
    const syncErro = n.status_sync === 'erro'
    const dotCor   = syncOk ? 'var(--bio-verde)' : syncErro ? '#DC2626' : '#F59E0B'
    const dotTit   = syncOk ? 'Enviado' : syncErro ? ('Não enviado: ' + (n.sync_erro || 'erro')) : 'Pendente'
    const temEcl   = eclosMap[n.uuid_cliente]
    const nTransf  = transfMap[n.uuid_cliente] ?? 0
    const status   = n.status ?? 'encontrado'

    const ovosHtml = (n.qtd_ovos != null || n.ovos_integros != null || n.ovos_descartados != null) ? `
      <div class="bio-nfc-ovos">
        ${n.qtd_ovos        != null ? `<span>${n.qtd_ovos} ovos</span>` : ''}
        ${n.contagem_ovos_metodo === 'estimado' ? `<span style="background:rgba(201,168,76,.2);color:#8a6d1f">estimado</span>` : ''}
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
        <span class="bio-nfc-sync-dot" title="${esc(dotTit)}" style="background:${dotCor}"></span>
      </div>
      ${syncErro ? `<div class="bio-nfc-sync-erro">${esc(n.sync_erro || 'falha no envio')}</div>` : ''}
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
      && x.status !== 'eclodido' && x.status !== 'perdido'
      && bioNinhoNaTemporada(x, BioApp.temporadaAtual)).length
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

// Cores categóricas por espécie (mesma identidade da página web de
// relatórios — cor segue a espécie, ordem fixa, nunca cíclica).
const BIO_ESP_COR = {
  tracaja: '#2A9D6F', tartaruga: '#1A6B8C', cabecudo: '#C9A84C',
  pitiU: '#7ECEE8', cupido: '#D97706', mucua: '#EC4899',
  jabuti_pe_elefante: '#6366F1', jabuti_piranga: '#8B5CF6', outro: '#9CA3AF',
}
const bioEspCor  = id => BIO_ESP_COR[id] || '#9CA3AF'
const bioEspNome = id => (BIO_ESPECIES.find(e => e.id === id)?.nome) || id || '—'

// Estado vazio de um card de gráfico: esconde o canvas e mostra a msg.
// Retorna true quando vazio (para o chamador dar early-return).
function _bioChartVazio(cardId, vazio, msg) {
  const card = document.getElementById(cardId)
  if (!card) return vazio
  const wrap = card.querySelector('.bio-chart-wrap')
  let v = card.querySelector('.bio-chart-vazio')
  if (vazio) {
    if (wrap) wrap.style.display = 'none'
    if (!v) {
      v = document.createElement('p')
      v.className = 'bio-chart-vazio'
      v.style.cssText = 'font-size:12px;color:#9CA3AF;text-align:center;padding:24px 8px;margin:0'
      card.appendChild(v)
    }
    v.textContent = msg
    v.hidden = false
  } else {
    if (wrap) wrap.style.display = ''
    if (v) v.hidden = true
  }
  return vazio
}

// Barra horizontal com cor por barra (cada categoria tem sua própria cor).
function _bioBarsHCor(canvasId, labels, data, cores, Chart, opts = {}) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  _bioCharts[canvasId]?.destroy()
  _bioCharts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: cores, borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: opts.tooltip || {},
      },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,.06)' }, ticks: { font: { size: 11 } }, beginAtZero: true, suggestedMax: opts.max },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  })
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

// Rosca pequena sem legenda (card de berçário na lista) — as cores já
// são explicadas pelos números coloridos no texto ao lado, então a
// legenda do Chart.js só ocuparia espaço à toa num card compacto.
function _bioDonutMini(canvasId, labels, data, cores, Chart) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  _bioCharts[canvasId]?.destroy()
  _bioCharts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: cores, borderWidth: 2, borderColor: '#fff' }] },
    options: {
      cutout: '64%',
      animation: { duration: 500 },
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.formattedValue}` } },
      },
    },
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

  // ── Status dos ninhos (rosca – Tab Ninhos) — inclui os status
  // pós-eclosão (em berçário / soltado), senão o ninho some da rosca
  const ps = d.por_status || {}
  _bioDonut('chart-status',
    ['Encontrado', 'Transferido', 'Eclodido', 'Em berçário', 'Soltado', 'Perdido'],
    [ps.encontrado || 0, ps.transferido || 0, ps.eclodido || 0, ps.em_bercario || 0, ps.soltado || 0, ps.perdido || 0],
    ['#7ECEE8', '#C9A84C', '#2A9D6F', '#8B5CF6', '#1A6B8C', '#DC2626'],
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

  // ── Berçário: soltura e crescimento por espécie ───────────────
  _bioRenderizarBercario(d, Chart)
}

// Gráficos da aba Berçário que distinguem a espécie: soltos por espécie,
// taxa de soltura (por berçário e por espécie), curvas de crescimento
// (comprimento e peso) e ganho por berçário. Cada um com estado vazio.
function _bioRenderizarBercario(d, Chart) {
  // KPI: taxa de soltura geral (soltados ÷ entrados) — reusa a taxa canônica
  _bioSetText('bio-kpi-berc-taxasolt',
    d.taxa_sobrevivencia_bercario_pct != null ? d.taxa_sobrevivencia_bercario_pct : null,
    d.taxa_sobrevivencia_bercario_pct != null ? '%' : '')

  // ── Filhotes soltos por espécie (barra horizontal empilhada) ──
  const se = d.bercario_soltos_por_especie || []
  if (!_bioChartVazio('card-soltos-esp', !se.length, 'Nenhuma soltura registrada nesta temporada.')) {
    const canvas = document.getElementById('chart-soltos-esp')
    if (canvas) {
      _bioCharts['chart-soltos-esp']?.destroy()
      _bioCharts['chart-soltos-esp'] = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: se.map(s => bioEspNome(s.especie)),
          datasets: [
            { label: 'Via berçário', data: se.map(s => s.via_bercario || 0), backgroundColor: '#2A9D6F', borderRadius: 4 },
            { label: 'Direto no rio', data: se.map(s => s.direto_rio || 0), backgroundColor: '#1A6B8C', borderRadius: 4 },
          ]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, usePointStyle: true } } },
          scales: {
            x: { stacked: true, grid: { color: 'rgba(0,0,0,.06)' }, ticks: { font: { size: 11 } }, beginAtZero: true },
            y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } }
          }
        }
      })
    }
  }

  // ── Taxa de soltura por berçário (h-bar colorida por espécie) ──
  const tb = d.taxa_soltura_por_bercario || []
  if (!_bioChartVazio('card-taxa-solt-berc', !tb.length, 'Nenhum lote em berçário nesta temporada.')) {
    _bioBarsHCor('chart-taxa-solt-berc',
      tb.map(t => t.bercario_nome || '—'),
      tb.map(t => t.taxa_pct || 0),
      tb.map(t => bioEspCor(t.especie)),
      Chart,
      { max: 100, tooltip: { callbacks: { label: c => {
        const t = tb[c.dataIndex]
        return ` ${bioEspNome(t.especie)}: ${t.taxa_pct ?? 0}% (${t.soltos}/${t.entrada})`
      } } } }
    )
  }

  // ── Taxa de soltura por espécie (h-bar colorida por espécie) ──
  const te = d.taxa_soltura_por_especie || []
  if (!_bioChartVazio('card-taxa-solt-esp', !te.length, 'Nenhum lote em berçário nesta temporada.')) {
    _bioBarsHCor('chart-taxa-solt-esp',
      te.map(t => bioEspNome(t.especie)),
      te.map(t => t.taxa_pct || 0),
      te.map(t => bioEspCor(t.especie)),
      Chart,
      { max: 100, tooltip: { callbacks: { label: c => {
        const t = te[c.dataIndex]
        return ` ${t.taxa_pct ?? 0}% (${t.soltos}/${t.entrada})`
      } } } }
    )
  }

  // ── Curvas de crescimento por espécie (comprimento e peso) ────
  const cr = d.crescimento_por_especie || []
  _bioRenderCrescimento('card-cresc-comp', 'chart-cresc-comp', cr, 'comp_medio', Chart)
  _bioRenderCrescimento('card-cresc-peso', 'chart-cresc-peso', cr, 'peso_medio', Chart)

  // ── Ganho por berçário (Δ comprimento e Δ peso) ───────────────
  const gb = d.ganho_por_bercario || []
  const gbComp = gb.filter(g => g.delta_comp != null && g.n_comp > 0)
  const gbPeso = gb.filter(g => g.delta_peso != null && g.n_peso > 0)
  if (!_bioChartVazio('card-ganho-comp', !gbComp.length, 'Faça 2+ medições do mesmo filhote para ver o ganho.')) {
    _bioBarsHCor('chart-ganho-comp',
      gbComp.map(g => g.bercario_nome || '—'),
      gbComp.map(g => g.delta_comp),
      gbComp.map(g => bioEspCor(g.especie)),
      Chart,
      { tooltip: { callbacks: { label: c => {
        const g = gbComp[c.dataIndex]
        return ` ${bioEspNome(g.especie)}: +${g.delta_comp} cm (${g.n_comp} filhote${g.n_comp !== 1 ? 's' : ''})`
      } } } }
    )
  }
  if (!_bioChartVazio('card-ganho-peso', !gbPeso.length, 'Faça 2+ medições do mesmo filhote para ver o ganho.')) {
    _bioBarsHCor('chart-ganho-peso',
      gbPeso.map(g => g.bercario_nome || '—'),
      gbPeso.map(g => g.delta_peso),
      gbPeso.map(g => bioEspCor(g.especie)),
      Chart,
      { tooltip: { callbacks: { label: c => {
        const g = gbPeso[c.dataIndex]
        return ` ${bioEspNome(g.especie)}: +${g.delta_peso} g (${g.n_peso} filhote${g.n_peso !== 1 ? 's' : ''})`
      } } } }
    )
  }
}

// Curva de crescimento: uma linha por espécie, alinhada num eixo X de
// datas compartilhado (spanGaps preenche as datas sem medição da espécie).
function _bioRenderCrescimento(cardId, canvasId, serie, campo, Chart) {
  const pts = (serie || []).filter(s => s[campo] != null)
  if (_bioChartVazio(cardId, !pts.length, 'Sem medições de biometria nesta temporada.')) return
  const datas = [...new Set(pts.map(s => s.data))].sort()
  const especies = [...new Set(pts.map(s => s.especie))]
  const datasets = especies.map(esp => {
    const cor = bioEspCor(esp)
    return {
      label: bioEspNome(esp),
      data: datas.map(dt => {
        const p = pts.find(s => s.especie === esp && s.data === dt)
        return p ? p[campo] : null
      }),
      borderColor: cor,
      backgroundColor: cor + '22',
      spanGaps: true,
      fill: false,
    }
  })
  _bioLinha(canvasId, datas.map(dt => dt.slice(5)), datasets, Chart)
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

  // Dados locais (sempre disponíveis) — escopados à temporada selecionada
  const ninhos = (await bioOfflineListarNinhos())
    .filter(n => !_tempDados || n.temporada_id === _tempDados)
  _bioSetText('bio-kpi-ninhos-local', ninhos.length)
  _bioSetText('bio-kpi-eclodidos-local', ninhos.filter(n => ['eclodido', 'em_bercario', 'soltado'].includes(n.status)).length)

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
    _bioSetText('bio-kpi-anomalia',  data.filhotes_anomalia)

    // KPIs — Tab Ninhos ("Eclodidos" = pós-eclosão: eclodido +
    // em berçário + soltado, agregado no servidor)
    const ps = data.por_status || {}
    _bioSetText('bio-kpi2-eclodidos', data.eclodidos ?? ps.eclodido)
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

    // Postura estimada — só aparece quando há algum ninho estimado
    // (pendente ou já confirmado) na temporada selecionada.
    const _rowPostura = document.getElementById('bio-kpi-row-postura-estimada')
    const _temPostura = (data.postura_estimada_pendente_confirmacao > 0) || (data.postura_confirmada_total > 0)
    if (_rowPostura) _rowPostura.hidden = !_temPostura
    if (_temPostura) {
      _bioSetText('bio-kpi-postura-pendente',   data.postura_estimada_pendente_confirmacao)
      _bioSetText('bio-kpi-postura-confirmada', data.postura_confirmada_total)
    }

    // Ovos viáveis/perdidos (base canônica) nos KPIs
    bioSupabase().rpc('bio_ovos_resumo', { p_temporada_id: _tempDados || null }).then(({ data: ov }) => {
      if (!ov) return
      _bioSetText('bio-kpi-ovos-postura',  ov.postura)
      _bioSetText('bio-kpi-ovos-viaveis',  ov.viaveis)
      _bioSetText('bio-kpi-ovos-perdidos', ov.perdidos)
    }).catch(() => {})

    // Painéis de eclosão e dashboard por praia (RPCs próprias)
    bioRenderPainelEclosao(_tempDados)
    bioRenderDashboardPraias(_tempDados)

    // Gráficos (carrega Chart.js lazily na primeira vez)
    const Chart = await _bioCarregarChartJS()
    _bioRenderizarGraficos(data, Chart)

  } catch (err) {
    if (statusEl) statusEl.textContent = 'erro ao carregar'
  }
}

/* ════════════════════════════════════════════════════════════
   PAINEL DE ECLOSÃO (seção 3) — bio_monitoramento_eclosao
   ════════════════════════════════════════════════════════════ */
async function bioRenderPainelEclosao(temporadaId) {
  let data
  try {
    const r = await bioSupabase().rpc('bio_monitoramento_eclosao', { p_temporada_id: temporadaId || null })
    if (r.error) throw r.error
    data = r.data
  } catch { return }
  const vazio = document.getElementById('bio-ecl-vazio')
  if (!data) { if (vazio) vazio.hidden = false; return }

  const c = data.contadores || {}
  _bioSetText('bio-ecl-kpi-hoje',      c.hoje ?? 0)
  _bioSetText('bio-ecl-kpi-proximos',  c.proximos_7d ?? 0)
  _bioSetText('bio-ecl-kpi-atrasados', c.atrasados ?? 0)
  if (vazio) vazio.hidden = (c.em_incubacao ?? 0) > 0

  const nomeEsp = cod => BIO_ESPECIES.find(e => e.id === cod)?.nome ?? cod
  const item = (n, cls) => `
    <div class="bio-ecl-item ${cls}">
      <span class="bio-ecl-num">#${esc(n.numero ?? '—')}</span>
      <span class="bio-ecl-meta">${esc(nomeEsp(n.especie))}${n.praia ? ' · ' + esc(n.praia) : ''}</span>
      <span class="bio-ecl-sit">${esc(n.situacao ?? '')}</span>
    </div>`
  const secao = (titulo, arr, cls) => (arr && arr.length)
    ? `<p class="bio-ecl-sec">${titulo} (${arr.length})</p>` + arr.map(n => item(n, cls)).join('')
    : ''
  const listas = document.getElementById('bio-ecl-listas')
  if (listas) {
    listas.innerHTML =
      secao('Atrasados', data.atrasados, 'atrasado') +
      secao('Próximos', data.proximos, 'atencao') ||
      '<p style="font-size:13px;color:#9CA3AF;padding:8px 0">Nenhuma eclosão prevista para os próximos dias.</p>'
  }

  const esps = data.por_especie || []
  const ov   = data.ovos || {}
  const espEl = document.getElementById('bio-ecl-especies')
  if (espEl) {
    const totais = (ov.postura != null) ? `
      <div class="bio-ecl-esp-row" style="font-weight:700">
        <span>Ovos (postura ${ov.postura ?? 0})</span>
        <span><b style="color:#1E6B4A">${ov.viaveis ?? 0} viáveis</b>${ov.perdidos ? ` · <b style="color:#b3261e">${ov.perdidos} perdidos</b>` : ''}</span>
      </div>` : ''
    espEl.innerHTML = totais + (esps.length ? esps.map(s => `
      <div class="bio-ecl-esp-row">
        <span>${esc(nomeEsp(s.especie))}</span>
        <span>prev. ${s.incubacao_prevista_media ?? '—'} d · real ${s.incubacao_real_media ?? '—'} d
          ${s.taxa_sucesso_pct != null ? `· ${s.taxa_sucesso_pct}% sucesso` : ''}
          ${s.ovos_viaveis != null ? `· ${s.ovos_viaveis} viáveis` : ''}</span>
      </div>`).join('')
      : (totais ? '' : '<span style="color:#9CA3AF">Sem eclosões registradas ainda.</span>'))
  }
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD POR PRAIA (seção 4) — bio_dashboard_praias
   ════════════════════════════════════════════════════════════ */
// Popula os selects de UC/município/comunidade a partir das praias
// retornadas (1x). Preserva a opção já escolhida.
function bioPopularFiltrosDashboard(praias) {
  const preenche = (id, pares, rotuloTodos) => {
    const el = document.getElementById(id)
    if (!el || el.dataset.populado) return
    const vistos = new Map()
    pares.forEach(([v, txt]) => { if (v != null && v !== '' && !vistos.has(v)) vistos.set(v, txt ?? v) })
    if (!vistos.size) return
    const atual = el.value
    el.innerHTML = `<option value="">${rotuloTodos}</option>` +
      [...vistos].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR'))
        .map(([v, txt]) => `<option value="${esc(v)}">${esc(txt)}</option>`).join('')
    if (atual) el.value = atual
    el.dataset.populado = '1'
  }
  preenche('bio-dash-uc',        praias.map(p => [p.uc_id, p.uc_nome]),        'Todas as UCs')
  preenche('bio-dash-municipio', praias.map(p => [p.municipio, p.municipio]), 'Todos os municípios')
  preenche('bio-dash-comunidade',praias.map(p => [p.comunidade, p.comunidade]),'Todas as comunidades')
}

async function bioRenderDashboardPraias(temporadaId) {
  const $ = id => document.getElementById(id)
  const tempAtual = () => document.getElementById('bio-dados-temporada')?.value || BioApp.temporadaAtual?.id || null

  // Espécie: opções fixas do catálogo (1x)
  const selEsp = $('bio-dash-especie')
  if (selEsp && !selEsp.dataset.populado) {
    selEsp.innerHTML = '<option value="">Todas as espécies</option>' +
      BIO_ESPECIES.filter(e => e.id !== 'outro').map(e => `<option value="${e.id}">${esc(e.nome)}</option>`).join('')
    selEsp.dataset.populado = '1'
  }

  // Liga os controles de filtro (1x) — qualquer mudança recarrega
  const wireEl = $('bio-dash-praias')
  if (wireEl && !wireEl.dataset.wired) {
    wireEl.dataset.wired = '1'
    ;['bio-dash-especie','bio-dash-uc','bio-dash-municipio','bio-dash-comunidade',
      'bio-dash-data-inicio','bio-dash-data-fim'].forEach(id =>
      $(id)?.addEventListener('change', () => bioRenderDashboardPraias(tempAtual())))
    $('bio-dash-limpar')?.addEventListener('click', () => {
      ['bio-dash-especie','bio-dash-uc','bio-dash-municipio','bio-dash-comunidade',
       'bio-dash-data-inicio','bio-dash-data-fim'].forEach(id => { const el = $(id); if (el) el.value = '' })
      bioRenderDashboardPraias(tempAtual())
    })
  }

  const filtros = {
    p_temporada_id: temporadaId || null,
    p_especie:      selEsp?.value || null,
    p_uc_id:        $('bio-dash-uc')?.value || null,
    p_municipio:    $('bio-dash-municipio')?.value || null,
    p_comunidade:   $('bio-dash-comunidade')?.value || null,
    p_data_inicio:  $('bio-dash-data-inicio')?.value || null,
    p_data_fim:     $('bio-dash-data-fim')?.value || null,
  }

  let praias
  try {
    const r = await bioSupabase().rpc('bio_dashboard_praias', filtros)
    if (r.error) throw r.error
    praias = r.data
  } catch { return }

  // Popula UC/município/comunidade 1x, a partir de um retorno SEM filtros
  // (mantém as opções estáveis mesmo depois de filtrar). Só na 1ª carga
  // sem nenhum filtro aplicado além da temporada.
  const semFiltros = !filtros.p_especie && !filtros.p_uc_id && !filtros.p_municipio
    && !filtros.p_comunidade && !filtros.p_data_inicio && !filtros.p_data_fim
  if (semFiltros && Array.isArray(praias)) bioPopularFiltrosDashboard(praias)

  const wrap  = $('bio-dash-praias')
  const vazio = $('bio-dash-vazio')
  if (!Array.isArray(praias) || !praias.length) {
    if (wrap) wrap.innerHTML = ''
    if (vazio) vazio.hidden = false
    return
  }
  if (vazio) vazio.hidden = true

  const card = p => {
    const stat = (v, lbl, cor) => `<div class="bio-dash-stat"><b${cor ? ` style="color:${cor}"` : ''}>${v ?? 0}</b><span>${lbl}</span></div>`
    return `
      <div class="bio-dash-card">
        <div class="bio-dash-head">
          <b>${esc(p.praia)}</b>${p.experimental ? ' <span class="bio-dash-tag">exp.</span>' : ''}
          <span class="bio-dash-sucesso">${p.sucesso_pct != null ? p.sucesso_pct + '% sucesso' : '—'}</span>
        </div>
        <div class="bio-dash-grid">
          ${stat(p.total, 'Total')}
          ${stat(p.ativos, 'Ativos', '#1a6b8c')}
          ${stat(p.transferidos, 'Transf.')}
          ${stat(p.eclodidos, 'Eclodidos', '#1E6B4A')}
          ${stat(p.proximos_eclosao, 'Próx. ecl.', '#9a6b00')}
          ${stat(p.perdidos, 'Perdidos', '#b3261e')}
          ${stat(p.predados, 'Predados', '#b3261e')}
          ${stat(p.inundados, 'Inundados', '#b3261e')}
          ${stat(p.falha_eclosao, 'Falha ecl.', '#b3261e')}
          ${stat(p.filhotes_produzidos, 'Filhotes', '#1E6B4A')}
          ${stat(p.ovos_monitorados, 'Postura')}
          ${stat(p.ovos_viaveis, 'Viáveis', '#1E6B4A')}
          ${stat(p.ovos_perdidos, 'Perdidos', '#b3261e')}
        </div>
        ${(p.ovos_perdidos > 0) ? `<div class="bio-dash-perdas">Perdas: ${[
          p.perdas_predacao   ? `${p.perdas_predacao} predação`     : null,
          p.perdas_alagamento ? `${p.perdas_alagamento} alagamento` : null,
          p.perdas_erosao     ? `${p.perdas_erosao} erosão`         : null,
          p.perdas_humana     ? `${p.perdas_humana} humano`         : null,
        ].filter(Boolean).join(' · ') || '—'}</div>` : ''}
      </div>`
  }
  if (wrap) wrap.innerHTML = praias.map(card).join('')
}

/* ════════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════════ */
const BIO_VERSAO = '1.2.0'
const BIO_INSTALL_URL = 'https://siguc-ac.vercel.app/pages/instalar-biomonitor.html'
const BIO_GH_RELEASES = 'https://api.github.com/repos/erissoncameli-prog/siguc-ac/releases'

// Número real do build. No APK (Capacitor) = carimbo window.BIO_BUILD do build
// nativo. Na web = versão declarada no sw.js do servidor (sempre atual).
// Fallback: maior cache instalado no aparelho.
async function bioVersaoBuild() {
  if (window.BIO_BUILD) return window.BIO_BUILD
  try {
    const r = await fetch('/pwa/sw.js', { cache: 'no-store' })
    const txt = await r.text()
    const m = txt.match(/siguc-biomonitor-v(\d+)/)
    if (m) return 'v' + m[1]
  } catch (_) {}
  try {
    if (!('caches' in window)) return null
    const keys = await caches.keys()
    const vers = keys
      .map(k => (k.match(/siguc-biomonitor-v(\d+)/) || [])[1])
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
    // Bucket único `avatares` + RPC perfil_atualizar_foto — mesma
    // sincronização de Brigadas/Frota (migrations 261/289). Antes
    // gravava direto em `biomonitor-fotos`/monitores_biodiversidade e a
    // troca não voltava para usuarios nem para os outros apps.
    const fotoUrl = await avatarSincronizarFotoPropria(bioSupabase(), quadrada)
    // Redundante com o que a RPC já fez quando a conta é vinculada, mas
    // é o que atualiza a própria linha para monitor PIN-only (sem
    // usuario_id) — a RPC não tem o que propagar nesse caso.
    await bioSupabase().from('monitores_biodiversidade').update({ foto_url: fotoUrl }).eq('id', monitor.id)

    BioApp.monitor.foto_url = fotoUrl
    await bioOfflineSetConfig('monitor', BioApp.monitor)
    const avatarEl = document.getElementById('bio-config-avatar')
    if (avatarEl) {
      const assinada = await fotoUrlAssinada(fotoUrl)
      avatarEl.style.backgroundImage = `url("${assinada || fotoUrl}")`
      avatarEl.textContent = ''
    }
    bioToast('Foto atualizada em todos os seus apps!', 'ok')
  } catch (e) {
    bioToast('Erro ao enviar foto: ' + (e.message || e), 'err')
  }
}

function bioCmpVersao(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

function bioVersaoNumApp() {
  const m = String(window.BIO_BUILD || '').match(/(\d+\.\d+\.\d+)/)
  return m ? m[1] : null
}

// APK (Capacitor): compara com o último Release biomonitor-v* e oferece o .apk
async function bioVerificarUpdateAndroid() {
  bioToast('Verificando atualização…', 'info')
  const atual = bioVersaoNumApp()
  try {
    const resp = await fetch(`${BIO_GH_RELEASES}?per_page=10`, { headers: { Accept: 'application/vnd.github+json' } })
    const lista = await resp.json()
    const rel = (lista || []).find(r => !r.draft && !r.prerelease && /^biomonitor-v\d/.test(r.tag_name || ''))
    if (!rel) { bioToast('Não foi possível verificar agora', 'warn'); return }
    const ultima = rel.tag_name.replace('biomonitor-v', '')
    if (atual && bioCmpVersao(ultima, atual) > 0) {
      const apk = rel.assets?.find(a => a.name?.endsWith('.apk'))?.browser_download_url || rel.html_url
      if (confirm(`Nova versão ${ultima} disponível.\nVocê está na ${atual}.\n\nBaixar agora?`)) {
        window.open(apk, '_blank')
      }
    } else {
      bioToast(`Você já está na versão mais recente (${atual || ultima})`, 'ok')
    }
  } catch (e) {
    console.warn('[bio-update]', e)
    bioToast('Sem conexão para verificar', 'warn')
  }
}

async function bioVerificarAtualizacao() {
  if (window.Capacitor) return bioVerificarUpdateAndroid()
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
  try {
    const qr = gerarQRDataURL(BIO_INSTALL_URL)
    const img  = document.getElementById('bio-qr-img')
    const link = document.getElementById('bio-qr-link')
    const ov   = document.getElementById('bio-qr-overlay')
    if (img)  img.src = qr
    if (link) link.textContent = BIO_INSTALL_URL
    if (ov)   ov.hidden = false
  } catch (e) {
    console.error('[bio-qr]', e)
    bioToast('Erro ao gerar QR: ' + (e?.message || e), 'err')
  }
}

// ── Registro central de sincronizações de "cache de referência" ─
// Cada entrada é um catálogo do tipo espelho-do-servidor (ver
// bioOfflineSubstituirCacheReferencia em biomonitor-offline.js).
// Adicionar um catálogo novo no futuro é só acrescentar uma linha
// aqui — nunca reimplementar fetch+substituição na mão em outro
// lugar, senão o bug de "cache nunca esvazia" (praias/berçários,
// jul/2026) volta a acontecer pro catálogo novo.
const BIO_SYNCS_REFERENCIA = [
  { nome: 'Praias',    fn: () => bioSyncCachePraias(BioApp.monitor?.grupo_id) },
  { nome: 'Berçários', fn: () => bioSyncCacheBercarios() },
  { nome: 'Temporada', fn: () => typeof bioSyncCacheTemporada  === 'function' ? bioSyncCacheTemporada(BioApp.monitor?.grupo_id) : Promise.resolve() },
  { nome: 'Parâmetros de incubação', fn: () => typeof bioSyncCacheParametros === 'function' ? bioSyncCacheParametros() : Promise.resolve() },
]

async function bioSincronizarDadosReferencia() {
  if (!navigator.onLine) { bioToast('Sem conexão.', 'err'); return }
  bioToast('Sincronizando dados…', 'info')

  // Cada item roda isolado: um catálogo falhando (ex.: rede caiu no
  // meio) não impede os outros de sincronizar nem trava o botão.
  const resultados = await Promise.all(BIO_SYNCS_REFERENCIA.map(async ({ nome, fn }) => {
    try { await fn(); return { nome, ok: true } }
    catch (e) { console.error('[bio-sync-referencia]', nome, e); return { nome, ok: false } }
  }))

  await bioCarregarPraiasHome()

  const falhas = resultados.filter(r => !r.ok)
  if (!falhas.length) {
    bioToast('Dados sincronizados!', 'ok')
  } else {
    bioToast(`Falhou: ${falhas.map(f => f.nome).join(', ')}. Os demais foram atualizados.`, 'err')
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
  document.getElementById('bio-config-avatar-btn')?.addEventListener('click', () => {
    if (typeof avatarFotoClicar === 'function') avatarFotoClicar('bio-config-avatar')
    else bioAlterarFotoMonitor()
  })
  document.getElementById('bio-input-foto-perfil')?.addEventListener('change', () => {})

  document.getElementById('bio-toggle-campo')?.addEventListener('change', async ev => {
    document.body.classList.toggle('field-mode', ev.target.checked)
    await bioOfflineSetConfig('campo_field_mode', ev.target.checked)
  })

  document.getElementById('bio-btn-aviso-privacidade')?.addEventListener('click', lgpdCampoAbrir)
  document.getElementById('bio-btn-meus-dados')?.addEventListener('click', lgpdAbrirMeusDados)
  document.getElementById('bio-btn-meus-equipamentos')?.addEventListener('click', () => {
    bioMostrarTela('tela-equipamentos')
    if (typeof bioEquipIniciar === 'function') bioEquipIniciar()
  })

  document.getElementById('bio-btn-alterar-pin')?.addEventListener('click', async () => {
    bioMostrarTela('tela-config-pin')
    bioIniciarTelaConfigPin()
  })
  document.getElementById('bio-btn-sincronizar-praias')?.addEventListener('click', bioSincronizarDadosReferencia)
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
    em_bercario: 'Em berçário',
    soltado:     'Soltado',
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
  bioIniciarFotosGenerica({
    prefixo: 'ecl', max: 3,
    getState: () => BioApp._fotosEcl ?? [], setFotos: f => { BioApp._fotosEcl = f },
    getContexto: () => ({
      tipoOcorrencia: 'Eclosão',
      local: bioNomePraiaDoNinhoAtual(),
    }),
  })
  bioIniciarFotosGenerica({
    prefixo: 'vis', max: 3,
    getState: () => BioApp._fotosVis ?? [], setFotos: f => { BioApp._fotosVis = f },
    getContexto: () => ({
      tipoOcorrencia: 'Visita de Monitoramento',
      local: bioNomePraiaDoNinhoAtual(),
    }),
  })
  bioIniciarFotosGenerica({
    prefixo: 'transf', max: 3,
    getState: () => BioApp._fotosTransf ?? [], setFotos: f => { BioApp._fotosTransf = f },
    getContexto: () => {
      const origem  = BioApp.formNinhoAtualizar?.praia_nome
      const destino = document.getElementById('bio-transf-praia-nome')?.textContent?.trim()
      const subLocal = document.getElementById('bio-transf-local')?.value?.trim()
      const partes = []
      if (origem) partes.push(`Praia: ${origem}`)
      if (destino && destino !== 'Selecionar praia…') partes.push(`→ ${destino}`)
      if (subLocal) partes.push(subLocal)
      return { tipoOcorrencia: 'Transferência de Ninho', local: partes.length ? partes.join(' ') : null }
    },
  })
  bioIniciarFotosGenerica({
    prefixo: 'sol', max: 3,
    getState: () => BioApp._fotosSol ?? [], setFotos: f => { BioApp._fotosSol = f },
    getContexto: () => {
      const ctx = BioApp.formSolturaCtx
      if (ctx?.bercario) return { tipoOcorrencia: 'Soltura de Filhotes', local: `Berçário: ${ctx.bercario.nome}` }
      const local = document.getElementById('bio-sol-local')?.value?.trim()
      return { tipoOcorrencia: 'Soltura de Filhotes', local: local || bioNomePraiaDoNinhoAtual() }
    },
  })
  bioIniciarFotosGenerica({
    prefixo: 'oc', max: 2,
    getState: () => BioApp._fotosOc ?? [], setFotos: f => { BioApp._fotosOc = f },
    getContexto: () => {
      const chip = document.querySelector('#bio-oc-tipo-grid .bio-oc-chip.ativo')
      const tipoTxt = chip?.textContent?.trim()
      return {
        tipoOcorrencia: tipoTxt ? `Berçário · ${tipoTxt}` : 'Ocorrência de Berçário',
        local: BioApp.loteAtual?.bercario_nome ? `Berçário: ${BioApp.loteAtual.bercario_nome}` : null,
      }
    },
  })
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
  document.getElementById('bio-transf-numero')?.addEventListener('input', bioValidarNumeroDestino)
  document.getElementById('bio-transf-ocupacao-busca')?.addEventListener('input', (e) =>
    bioRenderOcupacaoPainel(BioApp.transfOcupacao, e.target.value))
  document.getElementById('bio-btn-salvar-eclosao')?.addEventListener('click', bioSalvarEclosao)

  // Descarte de ovos: mostra a quebra por causa quando há descartados
  ;['bio-form-ovos-descartados','bio-form-desc-natural','bio-form-desc-predacao','bio-form-desc-humana']
    .forEach(id => document.getElementById(id)?.addEventListener('input', bioAtualizarDescarteBox))

  // Chips de espécie — delegado no container pois os chips são
  // renderizados dinamicamente pelo catálogo (bioCarregarEspecies)
  document.getElementById('bio-especie-grid')?.addEventListener('click', e => {
    const chip = e.target.closest('.bio-especie-chip')
    if (!chip) return
    document.querySelectorAll('.bio-especie-chip').forEach(c => c.classList.remove('sel'))
    chip.classList.add('sel')
    // Auto-numeração: (re)gera o número ao escolher/trocar a espécie
    bioAtualizarNumeroNinhoAuto()
  })
  bioCarregarEspecies()

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

  // Chips de método de contagem de ovos (contado / estimado) — ver
  // "Regra do sistema — postura de ovos por estimativa".
  document.querySelectorAll('.bio-metodo-ovos-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.bio-metodo-ovos-chip').forEach(c => c.classList.remove('ativo'))
      chip.classList.add('ativo')
      BioApp.contagemOvosMetodo = chip.dataset.metodoOvos
      const dica = document.getElementById('bio-ovos-metodo-dica')
      if (dica) dica.hidden = chip.dataset.metodoOvos !== 'estimado'
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
