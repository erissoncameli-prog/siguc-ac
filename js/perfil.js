// ── SIGUC · Modal "Meu Perfil" (mesa) ──────────────────────────
//
// Abre pelo bloco do nome no topo da sidebar (js/layout.js). Reúne o
// que antes eram dois links soltos no rodapé — "Meus Dados" e "Alterar
// Senha" — e acrescenta o que faltava: a pessoa editar o próprio
// cadastro e a própria foto.
//
// Carregado dinamicamente por carregarUsuario() (js/config.js), pelo
// MESMO motivo do gate de LGPD: pendurar um <script> em cada uma das
// 45 páginas de mesa faria toda página nova nascer sem o modal, uma
// falha invisível. Como carregarUsuario() é o bootstrap obrigatório de
// qualquer tela de mesa, amarrar aqui dá cobertura automática.
//
// ── A FOTO É UMA SÓ ───────────────────────────────────────────
// Sobe para o bucket privado `avatares` (migration 261), em
// `<uid>/<timestamp>.jpg`, e a RPC `perfil_atualizar_foto` propaga o
// endereço para brigadistas / frota_motoristas / monitores_biodiversidade
// da mesma conta — ver o cabeçalho da migration para o porquê de copiar
// em vez de resolver por join (os apps de campo são offline-first).
//
// A imagem é reduzida para 512 px e reencodada em JPEG antes de subir:
// foto de celular chega com 4-8 MB e o avatar é exibido a 34 px na
// sidebar. Se o canvas não conseguir decodificar (HEIC em navegador que
// não suporta), sobe o arquivo original — o bucket aceita heic.
//
// Bucket privado não serve pela URL pública: quem exibe assina na hora
// com js/fotos-privadas.js (regra do sistema, migrations 200/210), que
// este arquivo carrega sob demanda porque as telas de mesa não o
// incluem por padrão.

const PERFIL_FOTO_MAX = 512

let _perfilAba = 'perfil'
let _perfilSalvando = false

// ── carregamento sob demanda do assinador de fotos ────────────
function _perfilCarregarFotos() {
  if (typeof assinarFotos === 'function') return Promise.resolve(true)
  if (window._perfilFotosPromise) return window._perfilFotosPromise
  window._perfilFotosPromise = new Promise(resolve => {
    const s = document.createElement('script')
    s.src = '/js/fotos-privadas.js'
    s.onload = () => resolve(true)
    s.onerror = () => { console.warn('[perfil] não foi possível carregar fotos-privadas.js'); resolve(false) }
    document.head.appendChild(s)
  })
  return window._perfilFotosPromise
}

// Moldura + menu "Ver foto / Trocar foto" únicos (js/avatar-foto.js +
// css/avatar-foto.css) — mesmo carregamento sob demanda de
// _perfilCarregarFotos, mesmo motivo (não pendurar em 45 páginas).
function _perfilCarregarAvatarFoto() {
  if (!document.getElementById('avatar-foto-css')) {
    const l = document.createElement('link')
    l.id = 'avatar-foto-css'
    l.rel = 'stylesheet'
    l.href = '/css/avatar-foto.css'
    document.head.appendChild(l)
  }
  if (typeof avatarFotoClicar === 'function') return Promise.resolve(true)
  if (window._perfilAvatarFotoPromise) return window._perfilAvatarFotoPromise
  window._perfilAvatarFotoPromise = new Promise(resolve => {
    const s = document.createElement('script')
    s.src = '/js/avatar-foto.js'
    s.onload = () => resolve(true)
    s.onerror = () => { console.warn('[perfil] não foi possível carregar avatar-foto.js'); resolve(false) }
    document.head.appendChild(s)
  })
  return window._perfilAvatarFotoPromise
}

// Avatar da sidebar: iniciais por padrão, foto quando houver. Chamado
// no fim do bootstrap de cada página e de novo após salvar, para a
// troca aparecer sem recarregar.
async function perfilAtualizarAvatarSidebar(tentativa) {
  const el = document.getElementById('sidebar-avatar')
  const u = appState.usuario
  // Corrida real: carregarUsuario() dispara o carregamento deste arquivo
  // ANTES de a página montar o gerarLayout(), então na primeira chamada a
  // sidebar pode ainda não existir. carregarLogosSidebar() chama de novo
  // depois de renderizar, mas só se este arquivo já tiver chegado — as
  // duas ordens são possíveis, e a espera curta cobre as duas.
  if (!el) {
    const n = (tentativa || 0) + 1
    if (n <= 20) setTimeout(() => perfilAtualizarAvatarSidebar(n), 150)
    return
  }
  if (!u) return
  const ini = iniciais(u.nome_completo)
  if (!u.foto_url) { el.textContent = ini; el.style.backgroundImage = ''; return }
  const ok = await _perfilCarregarFotos()
  if (!ok) { el.textContent = ini; return }
  const url = await fotoUrlAssinada(u.foto_url)
  if (!url) { el.textContent = ini; return }
  el.textContent = ''
  el.style.backgroundImage = `url("${url}")`
  el.style.backgroundSize = 'cover'
  el.style.backgroundPosition = 'center'
}

// ── abrir / fechar ────────────────────────────────────────────
function abrirPerfil(aba) {
  const u = appState.usuario
  if (!u) return
  _perfilAba = aba || 'perfil'

  let ov = document.getElementById('perfil-overlay')
  if (!ov) {
    ov = document.createElement('div')
    ov.id = 'perfil-overlay'
    ov.className = 'perfil-overlay'
    document.body.appendChild(ov)
    // Fecha ao clicar fora — este É um diálogo que exige decisão, então
    // overlay de tela cheia é o certo aqui (diferente do painel-resumo
    // do mapa, ver CLAUDE.md).
    ov.addEventListener('click', e => { if (e.target === ov) fecharPerfil() })
  }
  ov.innerHTML = _perfilHTML(u)
  ov.classList.add('aberto')
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', _perfilEsc)
  perfilIr(_perfilAba)
  if (u.foto_url) _perfilCarregarFotos().then(ok => { if (ok) _perfilPintarFoto(u.foto_url) })
  _perfilCarregarAvatarFoto().then(ok => { if (ok) _perfilRegistrarAvatar() })
  _perfilCarregarAcessos()
}

function fecharPerfil() {
  const ov = document.getElementById('perfil-overlay')
  if (!ov) return
  ov.classList.remove('aberto')
  ov.innerHTML = ''
  document.body.style.overflow = ''
  document.removeEventListener('keydown', _perfilEsc)
}

function _perfilEsc(e) { if (e.key === 'Escape') fecharPerfil() }

function perfilIr(aba) {
  _perfilAba = aba
  document.querySelectorAll('.pf-tab').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba))
  document.querySelectorAll('.pf-painel').forEach(p => p.classList.toggle('ativo', p.dataset.aba === aba))
  const rodape = document.getElementById('pf-rodape')
  const acoes  = document.getElementById('pf-acoes')
  if (!rodape || !acoes) return
  if (aba === 'perfil') {
    rodape.textContent = 'Alterações valem para todos os apps do sistema'
    acoes.innerHTML = `<button class="btn btn-secondary" onclick="fecharPerfil()">Cancelar</button>
      <button class="btn btn-primary" onclick="perfilSalvar()">Salvar</button>`
  } else if (aba === 'senha') {
    rodape.textContent = 'Você continua conectado após trocar a senha'
    acoes.innerHTML = `<button class="btn btn-secondary" onclick="fecharPerfil()">Cancelar</button>
      <button class="btn btn-primary" onclick="perfilTrocarSenha()">Alterar senha</button>`
  } else {
    rodape.textContent = ''
    acoes.innerHTML = `<button class="btn btn-secondary" onclick="fecharPerfil()">Fechar</button>`
  }
}

// ── HTML ──────────────────────────────────────────────────────
function _perfilHTML(u) {
  const ini = iniciais(u.nome_completo)
  const perfilLabel = t(`perfis.${u.perfil}`) || u.perfil || ''
  const temFoto = !!u.foto_url
  // O avatar nasce com as iniciais e vira foto em _perfilPintarFoto,
  // depois que o assinador de URL chegou. Não dá para usar fotoAttr()
  // aqui: fotos-privadas.js é carregado sob demanda e pode não existir
  // no instante em que este HTML é montado.

  return `<div class="perfil-modal" role="dialog" aria-modal="true" aria-label="Meu perfil">
    <div class="pf-head">
      <button class="pf-close" onclick="fecharPerfil()" aria-label="Fechar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="pf-ident">
        <div class="pf-avatar">
          <div class="avatar-foto-anel"></div>
          <div class="pf-foto" id="pf-foto" onclick="avatarFotoClicar('pf-foto')" role="button" tabindex="0" aria-label="Ver ou trocar foto">${esc(ini)}</div>
          <button class="pf-cam" onclick="perfilEscolherFoto()" title="Trocar foto" aria-label="Trocar foto">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
          <input type="file" id="pf-file" accept="image/*" hidden onchange="perfilFotoEscolhida(this)">
        </div>
        <div class="pf-ident-txt">
          <div class="pf-nome" id="pf-nome-topo">${esc(u.nome_completo || 'Usuário')}</div>
          <div class="pf-sub">${esc(u.email || '')}</div>
          <div class="pf-chips">
            <span class="pf-chip">${esc(perfilLabel)}</span>
            ${u.cargo ? `<span class="pf-chip neutro" id="pf-chip-cargo">${esc(u.cargo)}</span>` : ''}
          </div>
        </div>
      </div>
    </div>

    <div class="pf-tabs">
      <button class="pf-tab" data-aba="perfil" onclick="perfilIr('perfil')">Perfil</button>
      <button class="pf-tab" data-aba="senha" onclick="perfilIr('senha')">Senha</button>
      <button class="pf-tab" data-aba="privacidade" onclick="perfilIr('privacidade')">Privacidade</button>
    </div>

    <div class="pf-body">
      ${_perfilPainelDados(u, temFoto)}
      ${_perfilPainelSenha()}
      ${_perfilPainelPrivacidade()}
    </div>

    <div class="pf-footer">
      <span class="pf-rodape" id="pf-rodape"></span>
      <div class="pf-acoes" id="pf-acoes"></div>
    </div>
  </div>`
}

function _perfilPainelDados(u, temFoto) {
  return `<div class="pf-painel" data-aba="perfil">
    <div class="pf-sec">Foto de perfil</div>
    <div class="pf-nota">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <div>
        Uma foto só, usada em todo o sistema — ao trocar aqui, ela substitui seu avatar
        nos apps de campo em que você tem cadastro vinculado (Brigadas, Biomonitor,
        Frota e Qualidade da Água). É opcional: você pode remover quando quiser.
        <div class="pf-foto-acoes">
          <button class="btn btn-secondary btn-sm" onclick="perfilEscolherFoto()">
            ${temFoto ? 'Trocar foto' : 'Enviar foto'}
          </button>
          ${temFoto ? `<button class="btn btn-ghost btn-sm" onclick="perfilRemoverFoto()">Remover</button>` : ''}
        </div>
      </div>
    </div>

    <div class="pf-sec">Dados que você edita</div>
    <div class="pf-campo">
      <label class="pf-lbl" for="pf-nome">Nome completo</label>
      <input class="pf-inp" id="pf-nome" value="${esc(u.nome_completo || '')}" maxlength="120">
    </div>
    <div class="pf-grid2">
      <div class="pf-campo">
        <label class="pf-lbl" for="pf-tel">Telefone</label>
        <input class="pf-inp" id="pf-tel" value="${esc(u.telefone || '')}" maxlength="20" placeholder="(68) 90000-0000">
      </div>
      <div class="pf-campo">
        <label class="pf-lbl" for="pf-cargo">Cargo</label>
        <input class="pf-inp" id="pf-cargo" value="${esc(u.cargo || '')}" maxlength="80" placeholder="Ex.: Analista Ambiental">
      </div>
    </div>

    <div class="pf-sec">Definido pela administração</div>
    <div class="pf-grid2">
      <div class="pf-campo">
        <label class="pf-lbl">E-mail de acesso</label>
        <input class="pf-inp" value="${esc(u.email || '')}" readonly>
        <div class="pf-ajuda">Troca de e-mail é feita em Usuários.</div>
      </div>
      <div class="pf-campo">
        <label class="pf-lbl">Perfil de acesso</label>
        <input class="pf-inp" value="${esc(t(`perfis.${u.perfil}`) || u.perfil || '')}" readonly>
        <div class="pf-ajuda">Define o que você enxerga no sistema.</div>
      </div>
    </div>
  </div>`
}

function _perfilPainelSenha() {
  return `<div class="pf-painel" data-aba="senha">
    <div class="pf-campo">
      <label class="pf-lbl" for="pf-s0">Senha atual</label>
      <input class="pf-inp" type="password" id="pf-s0" autocomplete="current-password">
    </div>
    <div class="pf-campo">
      <label class="pf-lbl" for="pf-s1">Nova senha</label>
      <input class="pf-inp" type="password" id="pf-s1" autocomplete="new-password" oninput="perfilForca()">
      <div class="pf-forca"><i id="pf-forca-barra"></i></div>
      <ul class="pf-reqs" id="pf-reqs">
        <li data-req="tam">8 caracteres ou mais</li>
        <li data-req="mai">1 letra maiúscula</li>
        <li data-req="num">1 número</li>
        <li data-req="sim">1 símbolo</li>
      </ul>
    </div>
    <div class="pf-campo">
      <label class="pf-lbl" for="pf-s2">Confirmar nova senha</label>
      <input class="pf-inp" type="password" id="pf-s2" autocomplete="new-password">
    </div>
    <div class="pf-nota aviso">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 17h.01"/></svg>
      <div>Isto muda a senha de login. O PIN dos apps de campo é outro código, alterado dentro de cada app.</div>
    </div>
    <div class="pf-sec">Acessos recentes</div>
    <div id="pf-acessos" class="pf-acessos"><span class="pf-ajuda">Carregando…</span></div>
  </div>`
}

function _perfilPainelPrivacidade() {
  return `<div class="pf-painel" data-aba="privacidade">
    <a class="pf-link" href="/pages/meus-dados.html">
      <div>
        <div class="pf-link-t">Meus dados</div>
        <div class="pf-link-d">Tudo o que o sistema guarda sobre você e os termos que você aceitou</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </a>
    <a class="pf-link" href="/pages/meus-dados.html#solicitacao">
      <div>
        <div class="pf-link-t">Solicitar acesso, correção ou exclusão</div>
        <div class="pf-link-d">Canal do titular — Art. 18 da LGPD</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </a>
    <a class="pf-link" href="/pages/privacidade.html" target="_blank" rel="noopener">
      <div>
        <div class="pf-link-t">Política de Privacidade</div>
        <div class="pf-link-d">Documento público, com o canal do Encarregado</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </a>
    <div class="pf-ajuda" style="margin-top:14px">
      A foto de perfil é o único dado do seu cadastro baseado em consentimento —
      remover a foto apaga o arquivo, não só o vínculo.
    </div>
  </div>`
}

// ── aba Perfil ────────────────────────────────────────────────
async function perfilSalvar() {
  if (_perfilSalvando) return
  const nome  = document.getElementById('pf-nome').value.trim()
  const tel   = document.getElementById('pf-tel').value.trim()
  const cargo = document.getElementById('pf-cargo').value.trim()
  if (nome.length < 3) { toast('Informe seu nome completo.', 'error'); return }

  _perfilSalvando = true
  try {
    // Só os três campos editáveis. `perfil`, `ativo`, `uc_id` e `email`
    // nem chegam aqui — e o trigger da migration 261 garante que não
    // adiantaria mandar.
    const { error } = await db.from('usuarios')
      .update({ nome_completo: nome, telefone: tel || null, cargo: cargo || null })
      .eq('id', appState.usuario.id)
    if (error) throw error

    Object.assign(appState.usuario, { nome_completo: nome, telefone: tel || null, cargo: cargo || null })
    const elNome = document.getElementById('sidebar-nome')
    if (elNome) elNome.textContent = nome
    document.getElementById('pf-nome-topo').textContent = nome
    perfilAtualizarAvatarSidebar()
    toast('Perfil atualizado.', 'success')
    fecharPerfil()
  } catch (e) {
    toast(e.message || 'Não foi possível salvar.', 'error')
  } finally { _perfilSalvando = false }
}

// ── foto ──────────────────────────────────────────────────────
function _perfilRegistrarAvatar() {
  avatarFotoRegistrar('pf-foto', {
    temFoto: () => !!appState.usuario?.foto_url,
    verFoto: async () => {
      const u = appState.usuario?.foto_url
      if (!u) return null
      await _perfilCarregarFotos()
      return await fotoUrlAssinada(u)
    },
    trocarFoto: () => perfilEscolherFoto(),
  })
}

function perfilEscolherFoto() { document.getElementById('pf-file')?.click() }

async function perfilFotoEscolhida(input) {
  const arq = input.files?.[0]
  input.value = ''
  if (!arq) return
  // arq.type vem vazio em alguns navegadores para HEIC/HEIF (iOS) — o
  // <input accept="image/*"> já filtrou a escolha, então só um MIME
  // reconhecido e explicitamente NÃO-imagem é rejeitado aqui.
  if (arq.size > 5 * 1024 * 1024 || (arq.type && !/^image\//.test(arq.type))) {
    toast('Escolha uma imagem de até 5 MB.', 'error'); return
  }
  toast('Enviando foto…', 'info')
  try {
    const blob = await _perfilReduzir(arq)
    const uid  = appState.usuario.id
    const ext  = blob.type === 'image/jpeg' ? 'jpg' : (arq.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${uid}/${Date.now()}.${ext}`

    const { error: upErr } = await db.storage.from('avatares')
      .upload(path, blob, { contentType: blob.type || arq.type, upsert: false })
    if (upErr) throw upErr

    const { data: pub } = db.storage.from('avatares').getPublicUrl(path)
    // O endereço público é gravado como ENDEREÇO (bucket + caminho); o
    // bucket é privado, então ele não serve o arquivo — quem exibe
    // assina. Mesmo padrão do resto do sistema (js/fotos-privadas.js).
    const { error: rpcErr } = await db.rpc('perfil_atualizar_foto', { p_url: pub.publicUrl })
    if (rpcErr) throw rpcErr

    const antiga = appState.usuario.foto_url
    appState.usuario.foto_url = pub.publicUrl
    _perfilApagarObjeto(antiga)          // sem await: limpeza, não bloqueia a tela
    await _perfilPintarFoto(pub.publicUrl)
    perfilAtualizarAvatarSidebar()
    toast('Foto atualizada em todos os apps.', 'success')
  } catch (e) {
    toast(e.message || 'Não foi possível enviar a foto.', 'error')
  }
}

async function perfilRemoverFoto() {
  if (!confirm('Remover sua foto de perfil? Ela deixará de aparecer em todos os apps e o arquivo será apagado.')) return
  const antiga = appState.usuario.foto_url
  try {
    const { error } = await db.rpc('perfil_atualizar_foto', { p_url: null })
    if (error) throw error
    appState.usuario.foto_url = null
    await _perfilApagarObjeto(antiga)
    await _perfilPintarFoto(null)
    perfilAtualizarAvatarSidebar()
    toast('Foto removida.', 'success')
  } catch (e) { toast(e.message || 'Não foi possível remover a foto.', 'error') }
}

// Apaga o objeto no Storage. A LGPD pede que remover a foto apague o
// arquivo, não só o endereço — e trocar de foto deixaria a anterior
// para trás sem isto. Falha aqui não é erro para o usuário: o endereço
// já saiu do banco e a foto já não aparece em lugar nenhum.
async function _perfilApagarObjeto(url) {
  if (!url) return
  const m = url.match(/\/object\/(?:public\/)?avatares\/(.+)$/)
  if (!m) return
  try { await db.storage.from('avatares').remove([decodeURIComponent(m[1].split('?')[0])]) }
  catch (e) { console.warn('[perfil] foto antiga não pôde ser apagada', e?.message || e) }
}

async function _perfilPintarFoto(url) {
  const el = document.getElementById('pf-foto')
  if (!el) return
  if (!url) {
    el.style.backgroundImage = ''
    el.textContent = iniciais(appState.usuario.nome_completo)
  } else {
    await _perfilCarregarFotos()
    const assinada = await fotoUrlAssinada(url)
    if (assinada) { el.textContent = ''; el.style.backgroundImage = `url("${assinada}")` }
  }
  // Reabre a aba para o botão "Remover" aparecer/sumir junto.
  const painel = document.querySelector('.pf-painel[data-aba="perfil"]')
  if (painel) {
    const acoes = painel.querySelector('.pf-foto-acoes')
    if (acoes) acoes.innerHTML =
      `<button class="btn btn-secondary btn-sm" onclick="perfilEscolherFoto()">${url ? 'Trocar foto' : 'Enviar foto'}</button>` +
      (url ? `<button class="btn btn-ghost btn-sm" onclick="perfilRemoverFoto()">Remover</button>` : '')
  }
}

// Reduz para PERFIL_FOTO_MAX px no maior lado e reencoda em JPEG.
// Devolve o arquivo original se o navegador não souber decodificar
// (HEIC do iPhone em navegador sem suporte) — o bucket aceita heic.
function _perfilReduzir(arq) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(arq)
    const img = new Image()
    img.onload = () => {
      try {
        const escala = Math.min(1, PERFIL_FOTO_MAX / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width  = Math.round(img.width * escala)
        c.height = Math.round(img.height * escala)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        c.toBlob(b => { URL.revokeObjectURL(url); resolve(b || arq) }, 'image/jpeg', 0.85)
      } catch (e) { URL.revokeObjectURL(url); resolve(arq) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(arq) }
    img.src = url
  })
}

// ── aba Senha ─────────────────────────────────────────────────
function perfilForca() {
  const v = document.getElementById('pf-s1').value
  const regras = {
    tam: v.length >= 8,
    mai: /[A-ZÀ-Þ]/.test(v),
    num: /\d/.test(v),
    sim: /[^\w\s]/.test(v)
  }
  let atendidas = 0
  document.querySelectorAll('#pf-reqs li').forEach(li => {
    const ok = !!regras[li.dataset.req]
    li.classList.toggle('ok', ok)
    if (ok) atendidas++
  })
  const barra = document.getElementById('pf-forca-barra')
  barra.style.width = `${(atendidas / 4) * 100}%`
  barra.style.background = atendidas >= 4 ? 'var(--sucesso)' : atendidas >= 2 ? 'var(--aviso)' : 'var(--erro)'
}

async function perfilTrocarSenha() {
  if (_perfilSalvando) return
  const s0 = document.getElementById('pf-s0').value
  const s1 = document.getElementById('pf-s1').value
  const s2 = document.getElementById('pf-s2').value
  if (!s0)             { toast('Informe sua senha atual.', 'error'); return }
  if (s1.length < 8)   { toast('A nova senha precisa de ao menos 8 caracteres.', 'error'); return }
  if (s1 !== s2)       { toast('As senhas não coincidem.', 'error'); return }
  if (s1 === s0)       { toast('A nova senha precisa ser diferente da atual.', 'error'); return }

  _perfilSalvando = true
  try {
    // Reautentica para provar posse da senha atual — mesmo caminho que
    // pages/trocar-senha.html já usava no modo voluntário.
    const { data: { user } } = await db.auth.getUser()
    const { error: loginErr } = await db.auth.signInWithPassword({ email: user.email, password: s0 })
    if (loginErr) { toast('Senha atual incorreta.', 'error'); return }

    const { error } = await db.auth.updateUser({ password: s1 })
    if (error) throw error
    await db.from('usuarios').update({ deve_trocar_senha: false }).eq('id', appState.usuario.id)
    toast('Senha alterada.', 'success')
    fecharPerfil()
  } catch (e) {
    toast(e.message || 'Não foi possível alterar a senha.', 'error')
  } finally { _perfilSalvando = false }
}

// Últimos logins do próprio usuário (policy auditoria_self_select, já
// em produção desde a migration 002).
async function _perfilCarregarAcessos() {
  const el = document.getElementById('pf-acessos')
  if (!el) return
  try {
    const { data, error } = await db.from('auditoria_acessos')
      .select('created_at, sucesso, tipo_evento, user_agent')
      .eq('usuario_id', appState.usuario.id)
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) throw error
    if (!data?.length) { el.innerHTML = `<span class="pf-ajuda">Nenhum acesso registrado ainda.</span>`; return }
    el.innerHTML = data.map(a => `<div class="pf-acesso">
      <span class="pf-acesso-quando">${esc(_perfilQuando(a.created_at))}</span>
      <span class="pf-acesso-onde">${esc(_perfilNavegador(a.user_agent))}</span>
      ${a.sucesso === false ? '<span class="pf-acesso-falha">falhou</span>' : ''}
    </div>`).join('')
  } catch (e) {
    el.innerHTML = `<span class="pf-ajuda">Não foi possível carregar os acessos.</span>`
  }
}

// formatData() (js/config.js) devolve só a data — num histórico de
// acesso a HORA é o que importa (dois logins do mesmo dia).
function _perfilQuando(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function _perfilNavegador(ua) {
  if (!ua) return '—'
  if (/SIGUC|Capacitor/i.test(ua)) return 'App de campo'
  if (/Edg\//.test(ua))     return 'Edge'
  if (/OPR|Opera/.test(ua)) return 'Opera'
  if (/Chrome/.test(ua))    return 'Chrome'
  if (/Firefox/.test(ua))   return 'Firefox'
  if (/Safari/.test(ua))    return 'Safari'
  return 'Navegador'
}
