// ── SIGUC — Motor de guias de introdução / treinamento ─────────
// Fonte ÚNICA da interface de treinamento do sistema (mesma lição de
// js/frota-consumo.js e js/mapa-recorte.js): nenhuma página desenha
// overlay de guia, navegação de passos, destaque de elemento ou
// marcação de "já visto" por conta própria. A página só declara o
// CONTEÚDO (guiaDefinir) e chama guiaAbrirCentral()/guiaAbrir().
//
// Regras que mandam neste arquivo:
//  • NADA bloqueia. Todo guia é dispensável, todo passo tem "Pular",
//    Esc fecha. Treinamento não é gate (diferente do aceite de LGPD).
//  • Funciona OFFLINE: conteúdo vem do código, progresso em
//    localStorage. O registro no banco é melhor-esforço e nunca
//    impede nada (fail-open, retenta na próxima abertura).
//  • Degrada em silêncio: passo cujo elemento-alvo não existe é
//    PULADO, nunca deixa o destaque apontando para o vazio.
//  • Acessibilidade: foco preso no diálogo, :focus-visible, alvos
//    ≥24px, prefers-reduced-motion desliga a animação do destaque.

let _guiaCat  = null   // catálogo declarado pela página
let _guiaEst  = null   // estado da sessão de leitura em curso
const _GUIA_PENDENTE = 'siguc_guia_pendentes'   // conclusões ainda não enviadas

// ── Catálogo ──────────────────────────────────────────────────
// cat = { escopo, titulo, guias:[{slug,titulo,resumo,icone,versao,
//         passos:[{titulo,texto,icone,alvo,tela,lista:[]}]}],
//         verbetes:{chave:{titulo,texto}}, aoTrocarTela(idTela) }
function guiaDefinir(cat) {
  _guiaCat = cat
  _guiaEnviarPendentes()
  // Topbar das telas de mesa (js/layout.js): o botão nasce escondido e
  // só aparece onde há catálogo declarado.
  const btn = typeof document !== 'undefined' && document.getElementById('topbar-guia')
  if (btn) {
    btn.hidden = false
    if (!btn.dataset.ligado) {
      btn.dataset.ligado = '1'
      btn.addEventListener('click', () => guiaAbrirCentral())
    }
  }
  return cat
}

function guiaCatalogo() { return _guiaCat }

// Nas telas de MESA o layout (e com ele a topbar) é injetado por
// gerarLayout() dentro de um init assíncrono — declarar o catálogo no
// <head> encontraria a topbar ainda inexistente e o botão "Ajuda"
// nunca apareceria. Isto declara já e reaplica quando o botão surgir,
// para que cada página precise de uma linha só, idêntica em todas.
function guiaAutoDefinir(cat) {
  guiaDefinir(cat)
  if (typeof document === 'undefined' || document.getElementById('topbar-guia')) return cat
  const obs = new MutationObserver(() => {
    if (document.getElementById('topbar-guia')) { obs.disconnect(); guiaDefinir(cat) }
  })
  const iniciar = () => obs.observe(document.body, { childList: true, subtree: true })
  if (document.body) iniciar()
  else document.addEventListener('DOMContentLoaded', iniciar, { once: true })
  return cat
}

function _guiaPorSlug(slug) {
  return (_guiaCat?.guias || []).find(g => g.slug === slug) || null
}

// ── Progresso (local; o banco é registro secundário) ───────────
function _guiaChave() { return 'siguc_guia_' + (_guiaCat?.escopo || 'geral') }

function _guiaLerProgresso() {
  try { return JSON.parse(localStorage.getItem(_guiaChave()) || '{}') || {} }
  catch { return {} }
}

function _guiaGravarProgresso(p) {
  try { localStorage.setItem(_guiaChave(), JSON.stringify(p)) } catch {}
}

// Concluído vale só para a MESMA versão do guia: texto reescrito
// volta a valer como novidade, sem apagar o histórico do banco.
function guiaConcluido(slug) {
  const g = _guiaPorSlug(slug)
  const p = _guiaLerProgresso()[slug]
  return !!p && (!g || p.versao === (g.versao || 1))
}

function guiaAlgumConcluido() {
  return (_guiaCat?.guias || []).some(g => guiaConcluido(g.slug))
}

function _guiaMarcarConcluido(slug) {
  const g = _guiaPorSlug(slug); if (!g) return
  const p = _guiaLerProgresso()
  p[slug] = { versao: g.versao || 1, em: new Date().toISOString() }
  _guiaGravarProgresso(p)
  _guiaRegistrarNoBanco(slug, g.versao || 1)
}

// ── Registro no banco (melhor esforço, nunca bloqueia) ─────────
function _guiaDb() {
  if (typeof window !== 'undefined' && window._bioDB_client) return window._bioDB_client
  if (typeof db !== 'undefined' && db) return db
  return (typeof window !== 'undefined' && window.db) || null
}

function _guiaFilaPendentes() {
  try { return JSON.parse(localStorage.getItem(_GUIA_PENDENTE) || '[]') || [] }
  catch { return [] }
}

function _guiaGravarPendentes(lista) {
  try { localStorage.setItem(_GUIA_PENDENTE, JSON.stringify(lista.slice(-100))) } catch {}
}

async function _guiaRegistrarNoBanco(slug, versao) {
  const item = { escopo: _guiaCat?.escopo || 'geral', slug, versao,
                 em: new Date().toISOString() }
  const fila = _guiaFilaPendentes()
  fila.push(item)
  _guiaGravarPendentes(fila)
  _guiaEnviarPendentes()
}

async function _guiaEnviarPendentes() {
  const cliente = _guiaDb()
  const fila = _guiaFilaPendentes()
  if (!cliente || !fila.length) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  const restantes = []
  for (const item of fila) {
    try {
      const { error } = await cliente.rpc('capacitacao_registrar_conclusao', {
        p_escopo: item.escopo, p_guia: item.slug,
        p_versao: item.versao, p_concluido_em: item.em
      })
      if (error) restantes.push(item)
    } catch { restantes.push(item) }
  }
  _guiaGravarPendentes(restantes)
}

// ── Utilidades de desenho ─────────────────────────────────────
function _guiaEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Negrito leve (**texto**) — o conteúdo é escrito por nós, mas passa
// por escape ANTES, então nunca há HTML vindo do texto do guia.
function _guiaTexto(s) {
  return _guiaEsc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

function _guiaIcone(nome) {
  if (typeof bico === 'function' && nome) { try { return bico(nome) } catch {} }
  return ''
}

function _guiaRaiz() {
  let el = document.getElementById('guia-raiz')
  if (!el) {
    el = document.createElement('div')
    el.id = 'guia-raiz'
    el.className = 'guia-raiz'
    el.hidden = true
    document.body.appendChild(el)
  }
  return el
}

// ── Central de guias (lista) ──────────────────────────────────
function guiaAbrirCentral() {
  if (!_guiaCat) return
  const total = _guiaCat.guias.length
  const feitos = _guiaCat.guias.filter(g => guiaConcluido(g.slug)).length
  const itens = _guiaCat.guias.map(g => `
    <button class="guia-item" type="button" data-guia="${_guiaEsc(g.slug)}">
      <span class="guia-item-ic">${_guiaIcone(g.icone || 'help')}</span>
      <span class="guia-item-txt">
        <strong>${_guiaEsc(g.titulo)}</strong>
        <span>${_guiaEsc(g.resumo || '')}</span>
      </span>
      <span class="guia-item-estado">${guiaConcluido(g.slug)
        ? `<span class="guia-chip-ok">${_guiaIcone('check')}Concluído</span>`
        : `<span class="guia-chip-n">${(g.passos || []).length} passos</span>`}</span>
    </button>`).join('')

  _guiaAbrirPainel(`
    <div class="guia-cab">
      <h2 class="guia-titulo">${_guiaEsc(_guiaCat.titulo || 'Ajuda e treinamento')}</h2>
      <button class="guia-fechar" type="button" data-guia-fechar aria-label="Fechar">${_guiaIcone('x') || '✕'}</button>
    </div>
    <p class="guia-progresso">${feitos} de ${total} guias concluídos</p>
    <div class="guia-lista">${itens}</div>
    <p class="guia-rodape">Você pode sair de qualquer guia a qualquer momento — nada aqui interrompe o trabalho.</p>
  `, { modo: 'central' })

  _guiaRaiz().querySelectorAll('[data-guia]').forEach(b => {
    b.addEventListener('click', () => guiaAbrir(b.dataset.guia))
  })
}

// ── Leitura de um guia ────────────────────────────────────────
function guiaAbrir(slug, opts = {}) {
  const g = _guiaPorSlug(slug); if (!g) return
  _guiaEst = { slug, guia: g, i: Math.max(0, opts.passo || 0), voltarCentral: opts.voltarCentral !== false }
  _guiaRenderPasso()
}

// Índice do próximo passo que tem o que mostrar.
//
// Alvo ausente NÃO descarta o passo: ele vira cartão de texto, sem
// destaque. Só é pulado o passo marcado `soTour`, que existe apenas
// para apontar um elemento e não diz nada sozinho.
//
// (Achado pelo teste, não por leitura: com a regra anterior — pular
// todo passo de alvo invisível — o guia "Fazer uma coleta", cujos
// passos todos apontam para campos do formulário, ficava VAZIO ao ser
// lido em Configurações e se marcava como concluído sem exibir nada.)
function _guiaProximoValido(i, dir) {
  const passos = _guiaEst.guia.passos || []
  while (i >= 0 && i < passos.length) {
    const p = passos[i]
    if (!p.soTour || _guiaAlvoVisivel(p.alvo)) return i
    i += dir
  }
  return -1
}

// Alvo escondido conta como AUSENTE: destacar um elemento de tela
// fechada devolve retângulo 0x0 e o recorte apareceria no canto
// superior esquerdo, apontando para nada. Assim o mesmo guia lido em
// Configurações vira cartão de texto, e lido dentro da tela certa
// vira tour com destaque — sem duas versões do conteúdo.
function _guiaAlvoVisivel(seletor) {
  const el = document.querySelector(seletor)
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function _guiaRenderPasso() {
  const { guia } = _guiaEst
  const passos = guia.passos || []
  // Levar à tela certa ANTES de procurar o alvo (o app é single-page).
  const alvoPasso = passos[_guiaEst.i]
  if (alvoPasso?.tela && typeof _guiaCat.aoTrocarTela === 'function') {
    try { _guiaCat.aoTrocarTela(alvoPasso.tela) } catch {}
  }
  const i = _guiaProximoValido(_guiaEst.i, 1)
  if (i < 0) { _guiaConcluir(); return }
  _guiaEst.i = i
  const p = passos[i]
  const ultimo = _guiaProximoValido(i + 1, 1) < 0

  const lista = (p.lista || []).map(x => `<li>${_guiaTexto(x)}</li>`).join('')
  _guiaAbrirPainel(`
    <div class="guia-cab">
      <span class="guia-migalha">${_guiaEsc(guia.titulo)}</span>
      <button class="guia-fechar" type="button" data-guia-fechar aria-label="Fechar">${_guiaIcone('x') || '✕'}</button>
    </div>
    <div class="guia-passo">
      <span class="guia-passo-ic">${_guiaIcone(p.icone || guia.icone || 'help')}</span>
      <h2 class="guia-titulo">${_guiaEsc(p.titulo)}</h2>
      <p class="guia-corpo">${_guiaTexto(p.texto || '')}</p>
      ${lista ? `<ul class="guia-lista-itens">${lista}</ul>` : ''}
      ${p.nota ? `<p class="guia-nota">${_guiaTexto(p.nota)}</p>` : ''}
    </div>
    <div class="guia-pontos" aria-hidden="true">${passos.map((_, k) =>
      `<span class="guia-ponto${k === i ? ' ativo' : ''}"></span>`).join('')}</div>
    <div class="guia-acoes">
      <button class="guia-btn guia-btn-sec" type="button" data-guia-ant
        ${_guiaProximoValido(i - 1, -1) < 0 ? 'disabled' : ''}>Anterior</button>
      <button class="guia-btn guia-btn-prim" type="button" data-guia-prox>${ultimo ? 'Concluir' : 'Próximo'}</button>
    </div>
    <button class="guia-pular" type="button" data-guia-fechar>Pular por agora</button>
  `, { modo: 'passo', alvo: p.alvo })

  const raiz = _guiaRaiz()
  raiz.querySelector('[data-guia-prox]')?.addEventListener('click', () => {
    if (ultimo) { _guiaConcluir(); return }
    _guiaEst.i = i + 1; _guiaRenderPasso()
  })
  raiz.querySelector('[data-guia-ant]')?.addEventListener('click', () => {
    const a = _guiaProximoValido(i - 1, -1)
    if (a >= 0) { _guiaEst.i = a; _guiaRenderPasso() }
  })
}

function _guiaConcluir() {
  const slug = _guiaEst?.slug
  const voltar = _guiaEst?.voltarCentral
  if (slug) _guiaMarcarConcluido(slug)
  if (voltar) guiaAbrirCentral(); else guiaFechar()
}

// ── Verbetes ("?" ao lado do campo) ───────────────────────────
function guiaVerbete(chave) {
  const v = (_guiaCat?.verbetes || {})[chave]; if (!v) return
  _guiaEst = null
  _guiaAbrirPainel(`
    <div class="guia-cab">
      <span class="guia-migalha">Ajuda</span>
      <button class="guia-fechar" type="button" data-guia-fechar aria-label="Fechar">${_guiaIcone('x') || '✕'}</button>
    </div>
    <div class="guia-passo">
      <h2 class="guia-titulo">${_guiaEsc(v.titulo)}</h2>
      <p class="guia-corpo">${_guiaTexto(v.texto || '')}</p>
      ${(v.lista || []).length ? `<ul class="guia-lista-itens">${
        v.lista.map(x => `<li>${_guiaTexto(x)}</li>`).join('')}</ul>` : ''}
    </div>
    ${v.guia ? `<div class="guia-acoes"><button class="guia-btn guia-btn-prim" type="button"
       data-guia-ir="${_guiaEsc(v.guia)}">Ver o guia completo</button></div>` : ''}
  `, { modo: 'verbete' })
  _guiaRaiz().querySelector('[data-guia-ir]')?.addEventListener('click', ev => {
    guiaAbrir(ev.currentTarget.dataset.guiaIr, { voltarCentral: false })
  })
}

// Botão "?" para colar ao lado de um rótulo de campo.
function guiaAjudaBtnHTML(chave, rotulo) {
  return `<button type="button" class="guia-ajuda-btn" data-guia-verbete="${_guiaEsc(chave)}"
    aria-label="Ajuda sobre ${_guiaEsc(rotulo || chave)}">?</button>`
}

// Delegação única: qualquer [data-guia-verbete] da página funciona,
// inclusive em HTML injetado depois (as telas remontam o tempo todo).
document.addEventListener('click', ev => {
  const b = ev.target.closest?.('[data-guia-verbete]')
  if (b) { ev.preventDefault(); guiaVerbete(b.dataset.guiaVerbete) }
})

// ── Painel + destaque ─────────────────────────────────────────
function _guiaAbrirPainel(html, opts = {}) {
  const raiz = _guiaRaiz()
  if (!raiz.dataset.pronto) {
    raiz.dataset.pronto = '1'
    raiz.addEventListener('click', ev => {
      if (ev.target.closest('[data-guia-fechar]')) { guiaFechar(); return }
      if (ev.target === raiz) guiaFechar()   // clique no fundo fecha
    })
  }
  if (!_guiaEscListener) {
    _guiaEscListener = ev => {
      if (ev.key === 'Escape' && !_guiaRaiz().hidden) guiaFechar()
      else if (ev.key === 'Tab' && !_guiaRaiz().hidden) _guiaPrenderFoco(ev)
    }
    document.addEventListener('keydown', _guiaEscListener)
  }
  raiz.innerHTML = `<div class="guia-spot" hidden></div>
    <div class="guia-painel" role="dialog" aria-modal="true" aria-label="Guia">${html}</div>`
  raiz.hidden = false
  document.body.classList.add('guia-aberto')
  _guiaDestacar(opts.alvo)
  const foco = raiz.querySelector('.guia-btn-prim, .guia-item, .guia-fechar')
  foco?.focus()
}

let _guiaEscListener = null

function _guiaPrenderFoco(ev) {
  const foco = _guiaRaiz().querySelectorAll(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  if (!foco.length) return
  const pri = foco[0], ult = foco[foco.length - 1]
  if (ev.shiftKey && document.activeElement === pri) { ev.preventDefault(); ult.focus() }
  else if (!ev.shiftKey && document.activeElement === ult) { ev.preventDefault(); pri.focus() }
}

// Recorte claro sobre o elemento real. Sem `transform` no elemento nem
// em ancestral (mesma armadilha da barra do app Frota) — posiciona por
// top/left, e o escurecimento é box-shadow, não um segundo overlay.
function _guiaDestacar(seletor) {
  const raiz = _guiaRaiz()
  const spot = raiz.querySelector('.guia-spot')
  const painel = raiz.querySelector('.guia-painel')
  // Alvo em tela fechada tem retângulo 0×0: destacá-lo poria o recorte
  // no canto da tela apontando para nada — melhor não destacar.
  const el = (seletor && _guiaAlvoVisivel(seletor)) ? document.querySelector(seletor) : null
  raiz.classList.toggle('com-alvo', !!el)
  if (!el) { spot.hidden = true; painel?.classList.remove('guia-painel-baixo'); return }
  try { el.scrollIntoView({ block: 'center', behavior: 'auto' }) } catch {}
  const r = el.getBoundingClientRect()
  const m = 6
  spot.style.top    = (r.top - m) + 'px'
  spot.style.left   = (r.left - m) + 'px'
  spot.style.width  = (r.width + m * 2) + 'px'
  spot.style.height = (r.height + m * 2) + 'px'
  spot.hidden = false
  // Painel vai para o lado oposto do alvo, para não cobri-lo.
  painel?.classList.toggle('guia-painel-baixo', r.top + r.height / 2 < window.innerHeight / 2)
}

function guiaFechar() {
  const raiz = document.getElementById('guia-raiz')
  if (raiz) { raiz.hidden = true; raiz.innerHTML = ''; raiz.classList.remove('com-alvo') }
  document.body.classList.remove('guia-aberto')
  _guiaEst = null
}

// ── Convite de primeiro acesso (dispensável para sempre) ───────
function guiaConvite(opts = {}) {
  if (!_guiaCat || guiaAlgumConcluido()) return
  const chave = _guiaChave() + '_convite'
  try { if (localStorage.getItem(chave) === 'dispensado') return } catch {}
  const alvo = opts.container ? document.querySelector(opts.container) : document.body
  if (!alvo || document.getElementById('guia-convite')) return
  const div = document.createElement('div')
  div.id = 'guia-convite'
  div.className = 'guia-convite'
  div.innerHTML = `
    <span class="guia-convite-ic">${_guiaIcone('help')}</span>
    <div class="guia-convite-txt">
      <strong>${_guiaEsc(opts.titulo || 'Primeira vez por aqui?')}</strong>
      <span>${_guiaEsc(opts.texto || 'Um guia rápido mostra como registrar uma coleta.')}</span>
    </div>
    <button class="guia-btn guia-btn-prim guia-btn-sm" type="button" data-guia-abrir>Ver guia</button>
    <button class="guia-convite-x" type="button" data-guia-dispensar aria-label="Dispensar">${_guiaIcone('x') || '✕'}</button>`
  alvo.prepend(div)
  div.querySelector('[data-guia-abrir]').addEventListener('click', () => {
    guiaAbrir(opts.guia || _guiaCat.guias[0]?.slug)
  })
  div.querySelector('[data-guia-dispensar]').addEventListener('click', () => {
    try { localStorage.setItem(chave, 'dispensado') } catch {}
    div.remove()
  })
}

if (typeof window !== 'undefined') {
  window.guiaDefinir = guiaDefinir
  window.guiaAutoDefinir = guiaAutoDefinir
  window.guiaAbrir = guiaAbrir
  window.guiaAbrirCentral = guiaAbrirCentral
  window.guiaFechar = guiaFechar
  window.guiaVerbete = guiaVerbete
  window.guiaAjudaBtnHTML = guiaAjudaBtnHTML
  window.guiaConvite = guiaConvite
  window.guiaConcluido = guiaConcluido
  window.guiaCatalogo = guiaCatalogo
  window.addEventListener('online', () => _guiaEnviarPendentes())
  window.addEventListener('resize', () => {
    const raiz = document.getElementById('guia-raiz')
    if (raiz && !raiz.hidden && _guiaEst) {
      const p = (_guiaEst.guia.passos || [])[_guiaEst.i]
      if (p?.alvo) _guiaDestacar(p.alvo)
    }
  })
}
