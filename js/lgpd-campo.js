// ── SIGUC · Aviso de Privacidade dos apps de campo ─────────────
//
// Brigadista, monitor e motorista são a população de maior risco do
// sistema — a geolocalização e a foto são deles. Este é o aviso do
// Art. 9º da LGPD para eles, exibido dentro do próprio app.
//
// REGRA QUE MANDA EM TODO O ARQUIVO: nada aqui pode impedir o
// trabalho de campo.
// Os três apps são offline-first e rodam onde muitas vezes não há
// sinal. Um aviso de privacidade que trave o registro de uma
// ocorrência de incêndio por falta de rede causa um dano real e
// imediato, muito maior do que o atraso na coleta de uma ciência. Por
// isso:
//   · o texto é CACHEADO em localStorage e reexibido sem rede;
//   · a ciência é gravada LOCALMENTE primeiro e sincronizada depois;
//   · se a sincronização falhar, fica pendente e tenta de novo na
//     próxima abertura — sem nunca reexibir o aviso nem barrar nada;
//   · qualquer erro inesperado é engolido com aviso no console (o app
//     segue normal).
//
// Por que localStorage e não a fila do IndexedDB de cada app: são três
// filas diferentes (brigada-offline, biomonitor-offline,
// frota-offline), cada uma com esquema próprio, e este é um registro
// único por usuário — não um lote de dados de campo. Uma chave de
// localStorage resolve nos três sem tocar em nenhuma fila.
//
// CADA APP TEM SEU PRÓPRIO AVISO (migration 223) — antes era um texto
// genérico, o mesmo nos 3 apps, listando atividades que não se
// aplicavam a quem lia (ex.: monitor lendo sobre abastecimento). Cada
// HTML declara `window.LGPD_CAMPO_APP` ('brigadas'/'biomonitor'/
// 'frota') ANTES de carregar este script; é esse valor que escolhe o
// texto certo na RPC e evita que dois apps abertos no mesmo aparelho
// (mesmo localStorage, mesma origem) leiam/sobrescrevam o cache um do
// outro.

const LGPD_CAMPO_DOC    = `siguc-lgpd-aviso-doc:${window.LGPD_CAMPO_APP || 'generico'}`
const LGPD_CAMPO_ESTADO = `siguc-lgpd-aviso-estado:${window.LGPD_CAMPO_APP || 'generico'}`

function _lgpdCampoLer(chave) {
  try { return JSON.parse(localStorage.getItem(chave) || 'null') } catch (e) { return null }
}
function _lgpdCampoGravar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)) } catch (e) { /* cota cheia: segue sem cache */ }
}

function _lgpdCampoDb() {
  if (typeof sigucDb === 'function') return sigucDb()
  if (window._bioDB_client) return window._bioDB_client
  if (typeof db !== 'undefined' && db) return db
  return window.db || null
}

// ── Entrada única, chamada pelos apps ao abrir a home ──────────
// Não retorna nada que o app precise aguardar.
//
// Roda no máximo uma vez por carga da página: no Frota o gancho é
// entrarModo(), que dispara a cada troca de modo
// (motorista/gestor/solicitante) — sem esta trava seria uma chamada de
// rede a cada troca, sem necessidade nenhuma.
let _lgpdCampoJaRodou = false

async function lgpdCampoIniciar() {
  if (_lgpdCampoJaRodou) return
  _lgpdCampoJaRodou = true
  if (!window.LGPD_CAMPO_APP) {
    // Cada HTML tem que declarar LGPD_CAMPO_APP antes de carregar este
    // arquivo — sem isso não dá pra saber qual dos 3 avisos mostrar.
    // Fail-open: loga e segue sem aviso, nunca bloqueia o app.
    console.warn('[lgpd-campo] window.LGPD_CAMPO_APP não definido — aviso não será exibido')
    return
  }
  try {
    const doc = await _lgpdCampoSincronizar()
    if (!doc) return                       // sem texto (1º uso offline): nada a exibir

    const estado = _lgpdCampoLer(LGPD_CAMPO_ESTADO)
    const jaCiente = estado && estado.hash === doc.hash_sha256

    if (jaCiente) {
      // Ciência dada, mas pode não ter chegado ao servidor.
      if (!estado.enviado) _lgpdCampoEnviarCiencia(doc, estado)
      return
    }
    _lgpdCampoMostrar(doc)
  } catch (e) {
    console.warn('[lgpd-campo] ignorado:', e?.message || e)
  }
}

// Busca a versão vigente e atualiza o cache. Offline, devolve o que
// estiver cacheado — é o que permite reexibir o aviso em campo.
async function _lgpdCampoSincronizar() {
  const cache = _lgpdCampoLer(LGPD_CAMPO_DOC)
  const sb = _lgpdCampoDb()
  if (!sb || navigator.onLine === false) return cache

  try {
    const { data, error } = await sb.rpc('lgpd_aviso_campo', { p_app: window.LGPD_CAMPO_APP })
    if (error) throw error
    const doc = Array.isArray(data) ? data[0] : data
    if (!doc) return cache

    _lgpdCampoGravar(LGPD_CAMPO_DOC, doc)

    // O servidor é a fonte da verdade sobre a ciência: se o usuário já
    // deu ciência em outro aparelho, não se pergunta de novo aqui.
    if (doc.ja_ciente) {
      _lgpdCampoGravar(LGPD_CAMPO_ESTADO, {
        hash: doc.hash_sha256, versao_id: doc.versao_id, enviado: true,
      })
    }
    return doc
  } catch (e) {
    console.warn('[lgpd-campo] sem rede para atualizar o aviso:', e?.message || e)
    return cache
  }
}

// Grava a ciência local (o que vale para não reexibir) e tenta
// sincronizar. A falha de envio NÃO é erro para o usuário.
function _lgpdCampoRegistrar(doc) {
  const estado = { hash: doc.hash_sha256, versao_id: doc.versao_id, enviado: false, em: Date.now() }
  _lgpdCampoGravar(LGPD_CAMPO_ESTADO, estado)
  _lgpdCampoEnviarCiencia(doc, estado)
}

async function _lgpdCampoEnviarCiencia(doc, estado) {
  const sb = _lgpdCampoDb()
  if (!sb || navigator.onLine === false) return
  try {
    const { error } = await sb.rpc('lgpd_registrar_aceite', {
      p_versao_id:  doc.versao_id || estado.versao_id,
      p_user_agent: navigator.userAgent,
    })
    if (error) throw error
    _lgpdCampoGravar(LGPD_CAMPO_ESTADO, { ...estado, enviado: true })
  } catch (e) {
    // Continua pendente; tenta de novo na próxima abertura do app.
    console.warn('[lgpd-campo] ciência pendente de envio:', e?.message || e)
  }
}

// ── Modal ──────────────────────────────────────────────────────
// Sem botão de fechar: a saída é o "Entendi". Isso não conflita com a
// regra de não bloquear o trabalho — o botão está sempre disponível e
// não depende de rede alguma.
function _lgpdCampoMostrar(doc, somenteLeitura) {
  if (document.getElementById('lgpd-campo-ov')) return
  _lgpdCampoCss()

  const corpo = (typeof lgpdMarkdown === 'function')
    ? lgpdMarkdown(doc.conteudo_md)
    : `<pre style="white-space:pre-wrap">${String(doc.conteudo_md || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`

  const ov = document.createElement('div')
  ov.id = 'lgpd-campo-ov'
  ov.className = 'lgpdc-ov'
  ov.innerHTML = `
    <div class="lgpdc-box" role="dialog" aria-modal="true">
      <div class="lgpdc-body"><div class="lgpdc-doc">${corpo}</div></div>
      <div class="lgpdc-foot">
        <button class="lgpdc-btn" id="lgpdc-ok">${somenteLeitura ? 'Fechar' : 'Entendi'}</button>
      </div>
    </div>`
  document.body.appendChild(ov)

  ov.querySelector('#lgpdc-ok').addEventListener('click', () => {
    if (!somenteLeitura) _lgpdCampoRegistrar(doc)
    ov.remove()
  })
}

// Reabrir pela tela de Configurações do app. Funciona offline, do
// cache — é o "posso reler quando quiser" que o aviso promete.
async function lgpdCampoAbrir() {
  const doc = await _lgpdCampoSincronizar()
  if (!doc) {
    if (typeof toast === 'function') toast('Aviso indisponível offline', 'erro')
    return
  }
  _lgpdCampoMostrar(doc, true)
}

function _lgpdCampoCss() {
  if (document.getElementById('lgpdc-css')) return
  const s = document.createElement('style')
  s.id = 'lgpdc-css'
  s.textContent = `
.lgpdc-ov { position:fixed; inset:0; background:rgba(10,26,15,.86); z-index:99999;
  display:flex; align-items:flex-end; justify-content:center; padding:0 }
.lgpdc-box { background:#fff; width:100%; max-width:560px; max-height:92vh;
  border-radius:18px 18px 0 0; display:flex; flex-direction:column; overflow:hidden }
.lgpdc-body { overflow-y:auto; padding:22px 20px 8px; -webkit-overflow-scrolling:touch }
.lgpdc-foot { padding:12px 20px calc(16px + env(safe-area-inset-bottom,0px));
  border-top:1px solid #E5E0D5; background:#fff }
.lgpdc-btn { width:100%; padding:14px; border:0; border-radius:12px; font-size:1rem;
  font-weight:700; background:#1F4E2C; color:#fff; cursor:pointer }
.lgpdc-btn:active { background:#163a20 }
.lgpdc-doc { font-size:.94rem; line-height:1.6; color:#1f2937 }
.lgpdc-doc h1 { font-size:1.2rem; margin:0 0 12px; color:#0A1A0F }
.lgpdc-doc h2 { font-size:1rem; margin:20px 0 7px; color:#1F4E2C }
.lgpdc-doc p { margin:0 0 10px }
.lgpdc-doc ul { margin:0 0 12px; padding-left:20px }
.lgpdc-doc li { margin:6px 0 }
.lgpdc-doc strong { color:#0A1A0F }
@media (min-width:600px) {
  .lgpdc-ov { align-items:center; padding:20px }
  .lgpdc-box { border-radius:16px }
}
`
  document.head.appendChild(s)
}
