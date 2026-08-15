// ── SIGUC · LGPD — documentos, aceite e visualização ───────────
//
// Cobre a Fase 2 do plano de adequação (migrations 211/212):
//   · renderiza a Política de Privacidade e o Termo de Uso, que ficam
//     versionados no banco (lgpd_documento_versoes), não em HTML;
//   · bloqueia o primeiro acesso até o usuário dar ciência;
//   · permite reler os documentos depois, em Configurações.
//
// ONDE O BLOQUEIO ENTRA
// O gate é disparado por carregarUsuario() (js/config.js), que é o
// bootstrap das 38 páginas de mesa. Os três apps de campo (brigada,
// biomonitor, frota-app) NÃO chamam carregarUsuario — e isso é
// proposital: eles são offline-first, e um bloqueio que depende de
// rede poderia deixar um brigadista sem registrar ocorrência no meio
// do mato. O aviso de privacidade dos apps de campo é uma entrega
// própria, desenhada para funcionar sem conexão.
//
// FAIL-OPEN, DE PROPÓSITO
// Se a consulta de pendências falhar (offline, erro de rede, RPC
// indisponível), o gate NÃO aparece e o sistema segue normal. Travar o
// acesso de todo mundo por causa de uma falha de rede seria um dano
// maior do que o atraso na coleta da ciência — que reaparece no acesso
// seguinte, já que o aceite é verificado toda vez até ser registrado.

// ── Markdown mínimo e seguro ───────────────────────────────────
// O conteúdo vem do banco, escrito pela administração — ainda assim é
// escapado ANTES de qualquer transformação, para que nenhuma tag
// sobreviva. Suporta só o que os documentos usam: títulos, negrito,
// itálico, listas, tabelas, código inline e parágrafos.
function lgpdMarkdown(md) {
  if (!md) return ''
  const esc_ = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const inline = s => esc_(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Link externo (http/s): abre em aba nova, rel=noopener por segurança.
    // Link interno (relativo, começa com /): navega na MESMA aba — nada
    // de target=_blank aqui. window.close() numa aba nova é bloqueado
    // silenciosamente por muitos navegadores/PWAs instalados mesmo com
    // window.opener presente (o clique não fazia nada); o botão "Estou
    // ciente, fechar" de pages/privacidade.html usa history.back(), que
    // sempre funciona porque a navegação ficou na mesma aba.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[([^\]]+)\]\((\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')

  const linhas = md.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0

  // Buffer de parágrafo: linhas soltas consecutivas viram um <p> só,
  // preservando a quebra de linha do texto original como espaço.
  let par = []
  const fecharPar = () => {
    if (par.length) { out.push(`<p>${inline(par.join(' '))}</p>`); par = [] }
  }

  while (i < linhas.length) {
    const l = linhas[i]

    // Título
    const h = l.match(/^(#{1,4})\s+(.*)$/)
    if (h) { fecharPar(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }

    // Tabela: linha de cabeçalho seguida de separador |---|
    if (/^\s*\|/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1] || '')) {
      fecharPar()
      const celulas = ln => ln.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const head = celulas(l)
      i += 2
      const corpo = []
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) { corpo.push(celulas(linhas[i])); i++ }
      out.push(
        '<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        corpo.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>'
      )
      continue
    }

    // Lista (numerada ou não). Itens podem continuar na linha seguinte
    // com recuo — o texto dos documentos é quebrado em 80 colunas.
    const li = l.match(/^\s*([-*]|\d+\.)\s+(.*)$/)
    if (li) {
      fecharPar()
      const ordenada = /\d/.test(li[1])
      const itens = []
      while (i < linhas.length) {
        const m = linhas[i].match(/^\s*([-*]|\d+\.)\s+(.*)$/)
        if (m) { itens.push(m[2]); i++ }
        else if (/^\s+\S/.test(linhas[i]) && itens.length) { itens[itens.length - 1] += ' ' + linhas[i].trim(); i++ }
        else break
      }
      const tag = ordenada ? 'ol' : 'ul'
      out.push(`<${tag}>` + itens.map(t => `<li>${inline(t)}</li>`).join('') + `</${tag}>`)
      continue
    }

    if (!l.trim()) { fecharPar(); i++; continue }

    par.push(l.trim())
    i++
  }
  fecharPar()
  return out.join('\n')
}

// ── CSS do visualizador e do gate ──────────────────────────────
// Injetado uma vez por página. Usa as variáveis do design system —
// nenhuma cor nova é introduzida.
function lgpdInjetarCss() {
  if (document.getElementById('lgpd-css')) return
  const s = document.createElement('style')
  s.id = 'lgpd-css'
  s.textContent = `
.lgpd-doc { font-size:.9rem; line-height:1.65; color:var(--cinza-800,#1f2937) }
.lgpd-doc h1 { font-size:1.35rem; margin:0 0 14px }
.lgpd-doc h2 { font-size:1.05rem; margin:22px 0 8px; color:var(--musgo,#1F4E2C) }
.lgpd-doc h3 { font-size:.95rem; margin:16px 0 6px }
.lgpd-doc p, .lgpd-doc ul, .lgpd-doc ol { margin:0 0 10px }
.lgpd-doc ul, .lgpd-doc ol { padding-left:22px }
.lgpd-doc li { margin:3px 0 }
.lgpd-doc code { background:rgba(0,0,0,.06); padding:1px 5px; border-radius:4px; font-size:.85em }
.lgpd-doc a { color:var(--musgo,#1F4E2C); text-decoration:underline; font-weight:600 }
.lgpd-doc table { border-collapse:collapse; width:100%; margin:10px 0; font-size:.84rem; display:block; overflow-x:auto }
.lgpd-doc th, .lgpd-doc td { border:1px solid var(--borda,#D9D0BE); padding:6px 9px; text-align:left; vertical-align:top }
.lgpd-doc th { background:rgba(31,78,44,.07); font-weight:600 }
.lgpd-gate-ov { position:fixed; inset:0; background:rgba(10,26,15,.72); backdrop-filter:blur(3px);
  z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px }
.lgpd-gate { background:#fff; border-radius:14px; max-width:820px; width:100%; max-height:92vh;
  display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.35); overflow:hidden }
.lgpd-gate-head { padding:18px 22px 12px; border-bottom:1px solid var(--borda,#D9D0BE) }
.lgpd-gate-head h2 { margin:0 0 4px; font-size:1.1rem; color:var(--floresta,#0A1A0F) }
.lgpd-gate-head p { margin:0; font-size:.82rem; color:var(--cinza-500,#6b7280) }
.lgpd-gate-body { overflow-y:auto; padding:18px 22px; flex:1 }
.lgpd-gate-doc + .lgpd-gate-doc { margin-top:26px; padding-top:22px; border-top:2px solid var(--borda,#D9D0BE) }
.lgpd-gate-foot { padding:14px 22px 18px; border-top:1px solid var(--borda,#D9D0BE); background:#FAF8F4 }
.lgpd-gate-check { display:flex; gap:9px; align-items:flex-start; font-size:.86rem; cursor:pointer; margin-bottom:12px }
.lgpd-gate-check input { margin-top:3px; width:16px; height:16px; flex-shrink:0; cursor:pointer }
.lgpd-gate-btn { width:100%; padding:11px; border:0; border-radius:9px; font-size:.92rem; font-weight:600;
  background:var(--musgo,#1F4E2C); color:#fff; cursor:pointer }
.lgpd-gate-btn:disabled { background:var(--cinza-300,#d1d5db); color:var(--cinza-500,#6b7280); cursor:not-allowed }
.lgpd-gate-hash { font-size:.68rem; color:var(--cinza-400,#9ca3af); margin-top:9px; text-align:center;
  word-break:break-all; font-family:ui-monospace,monospace }
.lgpd-md-secao { margin-bottom:22px }
.lgpd-md-secao:last-child { margin-bottom:0 }
.lgpd-md-secao h3 { font-size:.92rem; margin:0 0 10px; color:var(--musgo,#1F4E2C) }
.lgpd-md-dl { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; font-size:.85rem; margin:0 }
.lgpd-md-dl dt { color:var(--cinza-500,#6b7280); font-weight:600 }
.lgpd-md-dl dd { margin:0 }
.lgpd-md-lista { display:flex; flex-direction:column; gap:8px }
.lgpd-md-item { display:flex; justify-content:space-between; gap:10px; font-size:.83rem;
  padding:8px 10px; background:rgba(0,0,0,.03); border-radius:8px }
.lgpd-md-item-data { color:var(--cinza-500,#6b7280); font-size:.78rem; white-space:nowrap }
.lgpd-md-vazio { font-size:.83rem; color:var(--cinza-500,#6b7280); margin:0 }
.lgpd-md-solic { padding:10px 12px; background:rgba(0,0,0,.03); border-radius:9px }
.lgpd-md-solic-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:.85rem }
.lgpd-md-solic-desc { margin:6px 0 0; font-size:.83rem; color:var(--cinza-800,#1f2937) }
.lgpd-md-solic-resp { margin-top:8px; font-size:.82rem; padding:8px 10px; background:rgba(31,78,44,.07); border-radius:7px }
.lgpd-md-solic-prazo { margin-top:6px; font-size:.76rem; color:var(--cinza-500,#6b7280) }
.lgpd-md-form { display:flex; flex-direction:column; gap:8px }
.lgpd-md-form label { font-size:.8rem; font-weight:600; color:var(--cinza-500,#6b7280) }
.lgpd-md-form select, .lgpd-md-form textarea {
  font: inherit; font-size:.86rem; padding:8px 10px; border:1px solid var(--borda,#D9D0BE);
  border-radius:8px; resize:vertical; width:100%
}
.lgpd-md-form .lgpd-gate-btn { margin-top:2px }
.lgpd-md-hint { font-size:.76rem; color:var(--cinza-500,#6b7280) }
.lgpd-md-carregando, .lgpd-md-erro { text-align:center; padding:30px 10px; font-size:.85rem; color:var(--cinza-500,#6b7280) }
.lgpd-md-erro { color:#b91c1c }
.lgpd-md-badge { display:inline-flex; align-items:center; font-size:10px; font-weight:700; padding:3px 9px;
  border-radius:99px; white-space:nowrap; text-transform:uppercase; letter-spacing:.05em; line-height:1.4 }
.lgpd-md-badge-verde  { background:#DCFCE7; color:#166534 }
.lgpd-md-badge-ouro   { background:#FEF3C7; color:#92400E }
.lgpd-md-badge-erro   { background:#FEE2E2; color:#991B1B }
.lgpd-md-badge-cinza  { background:#F3F4F6; color:#4B5563 }
`
  document.head.appendChild(s)
}

// ── Leitura de documento vigente ───────────────────────────────
// Funciona autenticado ou não: a política é pública (RLS deixa anon
// ver só ela); o termo de uso exige sessão.
async function lgpdDocumentoVigente(tipo) {
  const { data, error } = await db
    .from('vw_lgpd_documentos_vigentes')
    .select('versao_id,tipo,titulo,versao,conteudo_md,hash_sha256,vigente_desde')
    .eq('tipo', tipo)
    .maybeSingle()
  if (error) { console.warn('[lgpd] falha ao ler documento', tipo, error.message); return null }
  return data
}

// ── Gate de primeiro acesso ────────────────────────────────────
// Chamado por carregarUsuario(). Não retorna promessa que a página
// precise aguardar: o overlay cobre a tela por conta própria.
async function lgpdVerificarAceite() {
  let pendentes
  try {
    const { data, error } = await db.rpc('lgpd_pendencias_aceite')
    if (error) throw error
    pendentes = data || []
  } catch (e) {
    // Fail-open — ver cabeçalho do arquivo.
    console.warn('[lgpd] não foi possível verificar pendências de aceite:', e?.message || e)
    return
  }
  if (!pendentes.length) return
  lgpdMostrarGate(pendentes)
}

function lgpdMostrarGate(pendentes) {
  if (document.getElementById('lgpd-gate')) return
  lgpdInjetarCss()

  const ov = document.createElement('div')
  ov.className = 'lgpd-gate-ov'
  ov.id = 'lgpd-gate'
  ov.innerHTML = `
    <div class="lgpd-gate" role="dialog" aria-modal="true" aria-labelledby="lgpd-gate-titulo">
      <div class="lgpd-gate-head">
        <h2 id="lgpd-gate-titulo">Antes de continuar</h2>
        <p>Leia os documentos abaixo. Sua ciência fica registrada e é solicitada uma única vez,
           até que haja nova versão.</p>
      </div>
      <div class="lgpd-gate-body">
        ${pendentes.map(d => `
          <div class="lgpd-gate-doc">
            <div class="lgpd-doc">${lgpdMarkdown(d.conteudo_md)}</div>
          </div>`).join('')}
      </div>
      <div class="lgpd-gate-foot">
        <label class="lgpd-gate-check">
          <input type="checkbox" id="lgpd-gate-ok">
          <span>Declaro que li e estou ciente ${pendentes.length > 1 ? 'dos documentos acima' : 'do documento acima'}.</span>
        </label>
        <button class="lgpd-gate-btn" id="lgpd-gate-btn" disabled>Registrar ciência e continuar</button>
        ${pendentes.map(d => `<div class="lgpd-gate-hash">${esc(d.titulo)} v${esc(d.versao)} · SHA-256 ${esc(String(d.hash_sha256).slice(0, 16))}…</div>`).join('')}
      </div>
    </div>`
  document.body.appendChild(ov)
  document.body.style.overflow = 'hidden'

  const chk = ov.querySelector('#lgpd-gate-ok')
  const btn = ov.querySelector('#lgpd-gate-btn')
  chk.addEventListener('change', () => { btn.disabled = !chk.checked })

  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = 'Registrando…'
    try {
      // Um aceite por documento pendente. Sequencial e não paralelo:
      // se um falhar, os anteriores já ficaram gravados e o gate volta
      // a pedir só o que faltou.
      for (const d of pendentes) {
        const { error } = await db.rpc('lgpd_registrar_aceite', {
          p_versao_id: d.versao_id,
          p_user_agent: navigator.userAgent,
        })
        if (error) throw error
      }
      ov.remove()
      document.body.style.overflow = ''
      if (typeof toast === 'function') toast('Ciência registrada', 'sucesso')
    } catch (e) {
      console.error('[lgpd] falha ao registrar aceite:', e)
      btn.disabled = false
      btn.textContent = 'Registrar ciência e continuar'
      if (typeof toast === 'function') toast('Não foi possível registrar. Tente novamente.', 'erro')
    }
  })
}

// ── "Meus dados" — canal do titular (Art. 18, migration 214) ──
//
// Serve as 5 populações de titular do sistema (servidor, brigadista,
// monitor, motorista, pesquisador) com uma única RPC agregadora
// (lgpd_meus_dados) e uma única tabela de solicitações
// (lgpd_solicitacoes_titular). O conteúdo é o mesmo em toda
// superfície; só a casca muda — página inteira na mesa
// (pages/meus-dados.html), modal nos 3 apps de campo.
//
// A RPC devolve só as seções que existirem para o usuário logado
// (uma pessoa pode ter mais de uma — ex.: um servidor que também é
// brigadista) — cada seção aqui é omitida se vier null/vazia.

const LGPD_TIPO_SOLIC_LABEL = {
  acesso: 'Acesso aos meus dados',
  correcao: 'Correção de dados',
  exclusao: 'Exclusão / anonimização',
  portabilidade: 'Portabilidade dos dados',
  compartilhamento: 'Com quem meus dados são compartilhados',
  revogacao_consentimento: 'Revogar consentimento (foto de perfil, notificação push)',
  outro: 'Outro assunto',
}
const LGPD_STATUS_SOLIC_LABEL = {
  recebida: 'Recebida', em_analise: 'Em análise', respondida: 'Respondida', indeferida: 'Indeferida',
}
const LGPD_STATUS_SOLIC_BADGE = {
  recebida: 'lgpd-md-badge-cinza', em_analise: 'lgpd-md-badge-ouro',
  respondida: 'lgpd-md-badge-verde', indeferida: 'lgpd-md-badge-erro',
}

function _lgpdMdLinha(label, valor, isDate) {
  if (valor === null || valor === undefined || valor === '') return ''
  let v
  if (typeof valor === 'boolean') v = valor ? 'Sim' : 'Não'
  else if (isDate) v = formatData(valor)
  else v = esc(String(valor))
  return `<dt>${esc(label)}</dt><dd>${v}</dd>`
}

function _lgpdMdSecao(titulo, obj, campos) {
  if (!obj) return ''
  const linhas = campos.map(([chave, label, isDate]) => _lgpdMdLinha(label, obj[chave], isDate)).join('')
  if (!linhas) return ''
  return `<div class="lgpd-md-secao"><h3>${esc(titulo)}</h3><dl class="lgpd-md-dl">${linhas}</dl></div>`
}

function _lgpdMdMarkup(dados) {
  const d = dados || {}

  const secoes = [
    _lgpdMdSecao('Conta de acesso', d.usuario, [
      ['nome_completo', 'Nome completo'], ['email', 'E-mail'], ['telefone', 'Telefone'],
      ['perfil', 'Perfil de acesso'], ['ativo', 'Conta ativa'], ['criado_em', 'Cadastro criado em', true],
    ]),
    _lgpdMdSecao('Cadastro de brigadista', d.brigadista, [
      ['nome_completo', 'Nome completo'], ['cpf', 'CPF'], ['rg', 'RG'],
      ['data_nascimento', 'Data de nascimento', true], ['telefone', 'Telefone'], ['email', 'E-mail'],
      ['cnh', 'CNH'], ['funcao', 'Função'], ['status', 'Status'],
      ['contato_emergencia_nome', 'Contato de emergência'],
      ['contato_emergencia_telefone', 'Telefone de emergência'],
      ['brigada_nome', 'Brigada'], ['equipe_nome', 'Equipe'],
    ]),
    _lgpdMdSecao('Cadastro de monitor de biodiversidade', d.monitor, [
      ['nome_completo', 'Nome completo'], ['cpf', 'CPF'], ['rg', 'RG'],
      ['data_nascimento', 'Data de nascimento', true], ['telefone', 'Telefone'], ['email', 'E-mail'],
      ['funcao', 'Função'], ['status', 'Status'], ['grupo_nome', 'Grupo'],
    ]),
    _lgpdMdSecao('Cadastro de motorista', d.motorista, [
      ['nome', 'Nome'], ['cpf', 'CPF'], ['matricula', 'Matrícula'], ['telefone', 'Telefone'],
      ['cnh_numero', 'CNH nº'], ['cnh_categoria', 'Categoria CNH'],
      ['cnh_validade', 'CNH válida até', true], ['status', 'Status'], ['ativo', 'Ativo'],
    ]),
    _lgpdMdSecao('Cadastro de pesquisador', d.pesquisador, [
      ['nome_completo', 'Nome completo'], ['cpf', 'CPF'], ['rg', 'RG'], ['email', 'E-mail'],
      ['telefone', 'Telefone'], ['instituicao', 'Instituição'], ['titulacao', 'Titulação'], ['ativo', 'Ativo'],
    ]),
  ].filter(Boolean).join('')

  const aceites = d.aceites || []
  const aceitesHtml = aceites.length ? `
    <div class="lgpd-md-secao">
      <h3>Documentos que você já aceitou</h3>
      <div class="lgpd-md-lista">
        ${aceites.map(a => `<div class="lgpd-md-item">
          <span>${esc(a.documento)} — v${esc(a.versao)}</span>
          <span class="lgpd-md-item-data">${formatData(a.aceito_em)}</span>
        </div>`).join('')}
      </div>
    </div>` : ''

  const solicitacoes = d.solicitacoes || []
  const solicitacoesHtml = `
    <div class="lgpd-md-secao">
      <h3>Minhas solicitações</h3>
      ${!solicitacoes.length ? '<p class="lgpd-md-vazio">Nenhuma solicitação enviada ainda.</p>' : `
      <div class="lgpd-md-lista">
        ${solicitacoes.map(s => `
          <div class="lgpd-md-solic">
            <div class="lgpd-md-solic-head">
              <span class="lgpd-md-badge ${LGPD_STATUS_SOLIC_BADGE[s.status] || 'lgpd-md-badge-cinza'}">${esc(LGPD_STATUS_SOLIC_LABEL[s.status] || s.status)}</span>
              <strong>${esc(LGPD_TIPO_SOLIC_LABEL[s.tipo] || s.tipo)}</strong>
              <span class="lgpd-md-item-data">${formatData(s.criado_em)}</span>
            </div>
            <p class="lgpd-md-solic-desc">${esc(s.descricao)}</p>
            ${s.resposta ? `<div class="lgpd-md-solic-resp"><strong>Resposta:</strong> ${esc(s.resposta)}</div>` : `
              <div class="lgpd-md-solic-prazo">Prazo de resposta: até ${formatData(s.prazo_em)}</div>`}
          </div>`).join('')}
      </div>`}
    </div>`

  const formHtml = `
    <div class="lgpd-md-secao" id="solicitacao">
      <h3>Nova solicitação</h3>
      <form id="lgpd-md-form" class="lgpd-md-form">
        <label>Tipo de solicitação</label>
        <select id="lgpd-md-tipo">
          ${Object.entries(LGPD_TIPO_SOLIC_LABEL).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
        </select>
        <label>Descreva seu pedido</label>
        <textarea id="lgpd-md-desc" rows="3" placeholder="Explique o que você precisa..." required></textarea>
        <button type="submit" class="lgpd-gate-btn">Enviar solicitação</button>
        <div class="lgpd-md-hint">Prazo de resposta: 15 dias.</div>
      </form>
    </div>`

  return `<div class="lgpd-md">${secoes}${aceitesHtml}${solicitacoesHtml}${formHtml}</div>`
}

// Busca, renderiza e liga o formulário dentro de `root` (elemento ou
// id). Reutilizável tanto pela página de mesa (injeta direto num card)
// quanto pelo modal dos apps de campo — a única diferença é a casca.
async function lgpdMontarMeusDados(root) {
  const alvo = (typeof root === 'string' ? document.getElementById(root) : root)
  if (!alvo) return
  alvo.innerHTML = '<div class="lgpd-md-carregando">Carregando seus dados…</div>'

  // sigucDb(), nunca `db` direto — esta função é chamada pelos 3 apps de
  // campo (ver comentário de lgpdAbrirMeusDados) e o Biomonitor nunca
  // reatribui `db`, só `window._bioDB_client`; usar `db` aqui chamava a
  // RPC pelo cliente de mesa sem sessão, sempre falhando no app nativo
  // do Biomonitor.
  const sb = sigucDb()

  let dados
  try {
    // "Meus dados" exige sessão viva (não é dado cacheável offline). Nos
    // 3 apps de campo o desbloqueio do dia a dia é por PIN local — não
    // passa pelo Supabase Auth de novo — então se o token da última
    // sessão expirou nesse meio tempo, getSession() pode devolver null
    // sem tentar renovar. Força um refreshSession() antes de desistir, e
    // só então mostra uma mensagem específica (em vez do genérico "tente
    // mais tarde", que sugere problema no servidor quando na verdade é
    // falta de sessão).
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data: renovada } = await sb.auth.refreshSession().catch(() => ({ data: null }))
      session = renovada?.session || null
    }
    if (!session) {
      alvo.innerHTML = '<div class="lgpd-md-erro">Sua sessão expirou. Use "Sair / Trocar conta" e entre de novo (e-mail e senha) para consultar seus dados.</div>'
      return
    }

    const { data, error } = await sb.rpc('lgpd_meus_dados')
    if (error) throw error
    dados = data
  } catch (e) {
    console.error('[lgpd] falha ao carregar meus dados:', e)
    alvo.innerHTML = '<div class="lgpd-md-erro">Não foi possível carregar seus dados agora. Tente novamente mais tarde.</div>'
    return
  }

  alvo.innerHTML = _lgpdMdMarkup(dados)
  const form = alvo.querySelector('#lgpd-md-form')
  if (!form) return

  form.addEventListener('submit', async e => {
    e.preventDefault()
    const tipo = alvo.querySelector('#lgpd-md-tipo').value
    const descricao = alvo.querySelector('#lgpd-md-desc').value.trim()
    if (!descricao) return

    const btn = form.querySelector('button[type=submit]')
    btn.disabled = true
    btn.textContent = 'Enviando…'
    try {
      // usuario_id tem DEFAULT auth.uid() (migration 215) — não
      // precisa ser informado, e a policy de INSERT rejeitaria um
      // valor diferente do da própria sessão de qualquer forma.
      const { error } = await sb.from('lgpd_solicitacoes_titular').insert({ tipo, descricao })
      if (error) throw error
      if (typeof toast === 'function') toast('Solicitação enviada', 'sucesso')
      await lgpdMontarMeusDados(alvo) // re-renderiza com a nova solicitação na lista
    } catch (e) {
      console.error('[lgpd] falha ao enviar solicitação:', e)
      btn.disabled = false
      btn.textContent = 'Enviar solicitação'
      if (typeof toast === 'function') toast('Não foi possível enviar. Tente novamente.', 'erro')
    }
  })
}

// Modal — usado pelos 3 apps de campo (mesa usa lgpdMontarMeusDados
// direto num card da própria página, sem overlay).
function lgpdAbrirMeusDados() {
  lgpdInjetarCss()
  if (document.getElementById('lgpd-md-ov')) return

  const ov = document.createElement('div')
  ov.className = 'lgpd-gate-ov'
  ov.id = 'lgpd-md-ov'
  ov.innerHTML = `
    <div class="lgpd-gate" role="dialog" aria-modal="true">
      <div class="lgpd-gate-head">
        <h2>Meus dados</h2>
        <p>O que o SIGUC guarda sobre você, e o canal para pedir acesso, correção ou exclusão.</p>
      </div>
      <div class="lgpd-gate-body" id="lgpd-md-corpo"></div>
      <div class="lgpd-gate-foot">
        <button class="lgpd-gate-btn" data-fechar style="background:var(--cinza-500,#6b7280)">Fechar</button>
      </div>
    </div>`
  document.body.appendChild(ov)
  document.body.style.overflow = 'hidden'
  const fechar = () => { ov.remove(); document.body.style.overflow = '' }
  ov.querySelector('[data-fechar]').addEventListener('click', fechar)
  ov.addEventListener('click', e => { if (e.target === ov) fechar() })

  lgpdMontarMeusDados(ov.querySelector('#lgpd-md-corpo'))
}

// ── Visualizador avulso (Configurações) ────────────────────────
async function lgpdAbrirDocumento(tipo) {
  lgpdInjetarCss()
  const doc = await lgpdDocumentoVigente(tipo)
  if (!doc) { if (typeof toast === 'function') toast('Documento indisponível', 'erro'); return }

  const ov = document.createElement('div')
  ov.className = 'lgpd-gate-ov'
  ov.innerHTML = `
    <div class="lgpd-gate" role="dialog" aria-modal="true">
      <div class="lgpd-gate-head">
        <h2>${esc(doc.titulo)}</h2>
        <p>Versão ${esc(doc.versao)} · em vigor desde ${formatData(doc.vigente_desde)}</p>
      </div>
      <div class="lgpd-gate-body"><div class="lgpd-doc">${lgpdMarkdown(doc.conteudo_md)}</div></div>
      <div class="lgpd-gate-foot">
        <button class="lgpd-gate-btn" data-fechar>Fechar</button>
        <div class="lgpd-gate-hash">SHA-256 ${esc(doc.hash_sha256)}</div>
      </div>
    </div>`
  document.body.appendChild(ov)
  document.body.style.overflow = 'hidden'
  const fechar = () => { ov.remove(); document.body.style.overflow = '' }
  ov.querySelector('[data-fechar]').addEventListener('click', fechar)
  ov.addEventListener('click', e => { if (e.target === ov) fechar() })
}
