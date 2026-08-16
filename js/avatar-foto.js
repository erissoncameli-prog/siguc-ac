// ── SIGUC · Avatar clicável — "Ver foto" / "Trocar foto" ──────────
//
// Moldura + menu (bottom sheet) + visualizador em tela cheia, ÚNICOS
// para qualquer tela que mostre uma foto de perfil (cadastro de
// usuário na mesa, modal "Meu Perfil", apps de campo) — mesma lição de
// js/frota-consumo.js: nenhuma tela reimplementa isto.
//
// Cada chamador só monta o HTML (`.avatar-foto-wrap`, ver
// css/global.css) com `onclick="avatarFotoClicar('<id>')"` e registra,
// uma vez, o que "ver" e "trocar" significam ali:
//
//   avatarFotoRegistrar('adm-foto', {
//     temFoto:   () => !!algumaCoisa.foto_url,
//     verFoto:   async () => await fotoUrlAssinada(algumaCoisa.foto_url),
//     trocarFoto: () => document.getElementById('meu-input-file').click(),
//   })
//
// Sem foto ainda: tocar já abre direto o seletor de arquivo (não há o
// que visualizar) — mesmo comportamento que brigada.html já usa.

function avatarFotoRegistrar(idBase, cfg) {
  window._avFotoRegistros = window._avFotoRegistros || {}
  window._avFotoRegistros[idBase] = cfg
}

function avatarFotoClicar(idBase) {
  const cfg = window._avFotoRegistros?.[idBase]
  if (!cfg) return
  if (!cfg.temFoto()) { cfg.trocarFoto(); return }
  window._avFotoAtivo = cfg
  _avatarMenuAbrir()
}

function _avatarMenuAbrir() {
  let ov = document.getElementById('avatar-menu-overlay')
  if (!ov) {
    ov = document.createElement('div')
    ov.id = 'avatar-menu-overlay'
    ov.className = 'avatar-menu-overlay'
    ov.innerHTML = `<div class="avatar-menu-card">
      <button class="avatar-menu-item" onclick="_avatarMenuVer()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        Ver foto em tela cheia
      </button>
      <button class="avatar-menu-item" onclick="_avatarMenuTrocar()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        Trocar foto
      </button>
      <button class="avatar-menu-item sutil" onclick="_avatarMenuFechar()">Cancelar</button>
    </div>`
    ov.addEventListener('click', e => { if (e.target === ov) _avatarMenuFechar() })
    document.body.appendChild(ov)
  }
  ov.classList.add('aberto')
}

function _avatarMenuFechar() { document.getElementById('avatar-menu-overlay')?.classList.remove('aberto') }

async function _avatarMenuVer() {
  _avatarMenuFechar()
  const cfg = window._avFotoAtivo
  const url = await cfg?.verFoto()
  if (!url) { if (typeof toast === 'function') toast('Foto indisponível agora.', 'error'); return }
  _avatarViewerAbrir(url)
}

function _avatarMenuTrocar() {
  _avatarMenuFechar()
  window._avFotoAtivo?.trocarFoto()
}

function _avatarViewerAbrir(url) {
  let ov = document.getElementById('avatar-viewer-overlay')
  if (!ov) {
    ov = document.createElement('div')
    ov.id = 'avatar-viewer-overlay'
    ov.className = 'avatar-viewer-overlay'
    ov.innerHTML = `<button class="avatar-viewer-fechar" onclick="_avatarViewerFechar()" aria-label="Fechar">✕</button><img id="avatar-viewer-img" alt="Foto de perfil">`
    ov.addEventListener('click', e => { if (e.target === ov) _avatarViewerFechar() })
    document.body.appendChild(ov)
  }
  document.getElementById('avatar-viewer-img').src = url
  ov.classList.add('aberto')
}

function _avatarViewerFechar() {
  document.getElementById('avatar-viewer-overlay')?.classList.remove('aberto')
  const img = document.getElementById('avatar-viewer-img')
  if (img) img.src = ''
}

// Recorte quadrado + redução a `max` px + reencode JPEG — mesma conta
// que já existia copiada em js/perfil.js (_perfilReduzir) e em cada
// app de campo (fotoQuadrada/fmFotoQuadrada/bioFotoQuadrada). As cópias
// dos apps de campo já fazem recorte quadrado central (avatar 1:1); esta
// versão só reduz proporcional, igual à de js/perfil.js — quem quiser
// recorte quadrado usa `avatarFotoQuadrada` em vez desta.
function avatarFotoReduzir(arq, max) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(arq)
    const img = new Image()
    img.onload = () => {
      try {
        const escala = Math.min(1, max / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * escala)
        c.height = Math.round(img.height * escala)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        c.toBlob(b => { URL.revokeObjectURL(url); resolve(b || arq) }, 'image/jpeg', 0.85)
      } catch (e) { URL.revokeObjectURL(url); resolve(arq) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(arq) }
    img.src = url
  })
}

function avatarFotoQuadrada(arq, tam) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arq)
    const img = new Image()
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

// ── Sincronização — upload único no bucket `avatares/<uid>/…` + RPC
// perfil_atualizar_foto (migrations 261/289). Qualquer tela em que a
// PRÓPRIA pessoa troca a foto (mesa ou apps de campo) deve subir por
// aqui, nunca gravar direto no bucket/tabela do módulo — senão a troca
// fica presa num app só. `clienteDb` é o cliente Supabase da página
// (cada app tem o seu — ver "CLIENTE SUPABASE" no CLAUDE.md).
async function avatarSincronizarFotoPropria(clienteDb, blob) {
  const { data: { user } } = await clienteDb.auth.getUser()
  if (!user?.id) throw new Error('Sessão não autenticada')
  const path = `${user.id}/${Date.now()}.jpg`
  const { error: upErr } = await clienteDb.storage.from('avatares')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw upErr
  const { data: pub } = clienteDb.storage.from('avatares').getPublicUrl(path)
  const { error: rpcErr } = await clienteDb.rpc('perfil_atualizar_foto', { p_url: pub.publicUrl })
  if (rpcErr) throw rpcErr
  return pub.publicUrl
}
