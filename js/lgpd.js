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
