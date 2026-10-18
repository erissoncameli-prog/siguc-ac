// ── SIGUC-AC · Diagnóstico Socioeconômico — mesa: fichas e validação (Fase 4) ──
//
// Aba "Fichas" do questionário em pages/socio-questionarios.html.
// Usa os utilitários da página (rpc, esc, bico, badge, fmtDia, fmtMomento,
// msgErro, socAbrir/socFechar, confirmar, catPorId, _sel, renderSub) e os de
// js/socio-campanhas.js (_camps, socTerritorio, comAbrir).
//
// Leitura (364): socio_fichas_lista e socio_ficha_detalhe — a identificação
// (nome, GPS, colunas restritas da lista) e as fotos só chegam a quem o banco
// deixa ver; aqui a tela só desenha o que veio. Escrita: socio_mudar_status
// (362c) e socio_vincular_comunidade (364). O desenho das respostas lê a
// estrutura da VERSÃO aplicada na ficha, nunca a versão atual.

let _fFiltro = { campanha: '', status: 'enviada', treino: false, busca: '' }
let _fLista = [], _fDet = null

const SIT_FICHA = {
  rascunho: ['badge-cinza', 'Rascunho'], enviada: ['badge-ouro', 'Aguardando validação'],
  devolvida: ['badge-erro', 'Devolvida'], validada: ['badge-verde', 'Validada'], descartada: ['badge-cinza', 'Descartada'],
}
const TEMA_FOTO = { moradia: 'Moradia', entorno: 'Entorno', producao: 'Produção', agua: 'Água', saneamento: 'Saneamento', outro: 'Outro' }

function _semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }

// abre a aba Fichas já filtrada por uma campanha (botão "Ver fichas")
async function fichasDaCampanha(id) {
  _fFiltro = Object.assign({}, _fFiltro, { campanha: id, status: '' })
  await mudarSub('fichas')
}

async function fichasHTML() {
  const c = catPorId(_sel)
  const [camps] = await Promise.all([rpc('socio_campanhas_resumo', { p_instrumento: _sel }), socTerritorio()])
  _camps = camps || []
  if (_fFiltro.campanha && !_camps.some(k => k.id === _fFiltro.campanha)) _fFiltro.campanha = ''
  const veTreino = c.pode_gerir || c.pode_aplicar
  if (!veTreino) _fFiltro.treino = false
  _fLista = await rpc('socio_fichas_lista', {
    p_instrumento: _sel, p_campanha: _fFiltro.campanha || null,
    p_status: _fFiltro.status || null, p_treino: !!_fFiltro.treino,
  }) || []
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel === v ? ' selected' : ''}>${esc(t)}</option>`
  const quem = c.pode_gerir ? 'Você valida, devolve ao entrevistador com o motivo ou descarta.'
    : c.pode_ler_fichas ? 'Leitura sem identificação: nome, GPS e fotos ficam só com o gestor e com quem entrevistou.'
    : 'Aqui aparecem as fichas que você mesmo enviou.'
  return `<p class="soc-intro">Fichas que chegaram do app de campo. ${quem}</p>
    <div class="filter-bar soc-filtros">
      <label class="soc-filtro"><span>Campanha</span><select class="form-control" id="fi-camp" onchange="fichasFiltrar()">
        ${opt('', 'Todas', _fFiltro.campanha)}${_camps.map(k => opt(k.id, k.nome, _fFiltro.campanha)).join('')}</select></label>
      <label class="soc-filtro"><span>Situação</span><select class="form-control" id="fi-sit" onchange="fichasFiltrar()">
        ${opt('', 'Todas', _fFiltro.status)}${['enviada', 'devolvida', 'validada', 'descartada'].map(s => opt(s, SIT_FICHA[s][1], _fFiltro.status)).join('')}</select></label>
      ${veTreino ? `<label class="soc-papel"><input type="checkbox" id="fi-treino" ${_fFiltro.treino ? 'checked' : ''} onchange="fichasFiltrar()"><span>Fichas de treino</span></label>` : ''}
      <label class="soc-filtro soc-filtro-busca"><span>Buscar</span><input class="form-control" id="fi-busca" type="search"
        placeholder="Código, entrevistador, comunidade…" value="${esc(_fFiltro.busca)}" oninput="fichasBuscar()"></label>
    </div>
    <div class="card"><div class="table-wrap"><table class="soc-tab"><thead><tr>
      <th>Ficha</th><th>Entrevista</th><th>Onde</th><th>Entrevistador</th><th>Situação</th><th>Conferir</th><th><span class="sr-only">Ações</span></th>
    </tr></thead><tbody id="fi-corpo">${_fichasLinhas()}</tbody></table></div></div>`
}

function _fichasLinhas() {
  const t = _semAcento(_fFiltro.busca.trim())
  const ls = t ? _fLista.filter(f => _semAcento([f.codigo, f.entrevistador_nome, f.comunidade_nome, f.comunidade_nova,
    f.municipio_nome, f.uc_nome, f.campanha_nome].join(' ')).includes(t)) : _fLista
  if (!ls.length) {
    const msg = _fLista.length ? 'Nenhuma ficha bate com a busca.'
      : _fFiltro.status === 'enviada' ? 'Nenhuma ficha aguardando validação.' : 'Nenhuma ficha com estes filtros.'
    return `<tr><td colspan="7"><div class="empty-state">${msg}</div></td></tr>`
  }
  return ls.map(f => {
    const [cls, txt] = SIT_FICHA[f.status] || ['badge-cinza', f.status]
    const onde = [f.municipio_nome, f.uc_nome].filter(Boolean).join(' · ')
    const com = f.comunidade_nome || (f.comunidade_nova ? `${f.comunidade_nova} (nova)` : '')
    const conf = []
    if (!f.aceitou_participar) conf.push('recusou participar')
    if (f.n_pendentes) conf.push(`${f.n_pendentes} em branco`)
    const outros = f.n_alertas - f.n_pendentes - (f.comunidade_nova && !f.comunidade_nome ? 1 : 0) - (f.usou_carencia ? 1 : 0)
    if (outros > 0) conf.push(`${outros} alerta(s)`)
    if (f.comunidade_nova && !f.comunidade_nome) conf.push('comunidade a cadastrar')
    if (f.usou_carencia) conf.push('na carência')
    return `<tr><td><div class="soc-cod">${esc(f.codigo)}</div><div class="soc-sub">${esc(f.campanha_nome || 'Treino')} · v${f.versao}</div></td>
      <td class="soc-num">${fmtDia(f.dt_entrevista)}<div class="soc-sub">enviada ${fmtMomento(f.enviado_em)}</div></td>
      <td>${esc(onde || '—')}${com ? `<div class="soc-sub">${esc(com)}</div>` : ''}</td>
      <td>${esc(f.entrevistador_nome || '—')}</td>
      <td>${badge(cls, txt)}${f.status === 'devolvida' && f.motivo_devolucao ? `<div class="soc-sub">${esc(f.motivo_devolucao)}</div>` : ''}</td>
      <td>${conf.length ? `<span class="soc-sub soc-conf">${esc(conf.join(' · '))}</span>` : '<span class="soc-sub">nada a conferir</span>'}</td>
      <td><div class="soc-acoes"><button class="btn btn-secondary btn-sm" type="button" onclick="fichaAbrir('${f.id}')">Abrir</button></div></td></tr>`
  }).join('')
}

function fichasFiltrar() {
  _fFiltro.campanha = document.getElementById('fi-camp').value
  _fFiltro.status = document.getElementById('fi-sit').value
  const tr = document.getElementById('fi-treino')
  _fFiltro.treino = !!(tr && tr.checked)
  _fFiltro.busca = document.getElementById('fi-busca').value
  return renderSub()
}
let _fBuscaT = null
function fichasBuscar() {
  clearTimeout(_fBuscaT)
  _fBuscaT = setTimeout(() => {
    _fFiltro.busca = document.getElementById('fi-busca').value
    const corpo = document.getElementById('fi-corpo')
    if (corpo) corpo.innerHTML = _fichasLinhas()
  }, 200)
}

// ── detalhe ──
function _fichaModal() {
  if (document.getElementById('modal-ficha')) return
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="modal-ficha" role="dialog" aria-modal="true" aria-labelledby="fd-titulo">
    <div class="modal soc-ficha-modal">
      <div class="modal-header"><div class="modal-title" id="fd-titulo">Ficha</div>
        <button class="modal-close" type="button" aria-label="Fechar" onclick="socFechar('ficha')">×</button></div>
      <div class="modal-body" id="fd-corpo"></div>
      <div class="modal-footer" id="fd-acoes"></div>
    </div>
  </div>`)
}

async function fichaAbrir(id) {
  _fichaModal()
  document.getElementById('fd-titulo').textContent = 'Ficha'
  document.getElementById('fd-corpo').innerHTML = skeletonBlocoHTML(6)
  document.getElementById('fd-acoes').innerHTML = `<button class="btn btn-secondary" type="button" onclick="socFechar('ficha')">Fechar</button>`
  socAbrir('ficha')
  try {
    _fDet = await rpc('socio_ficha_detalhe', { p_ficha: id })
    _fichaRender()
  } catch (e) {
    document.getElementById('fd-corpo').innerHTML = `<div class="soc-aviso" role="alert">${bico('alert-triangle')}<div>${esc(msgErro(e))}</div></div>`
  }
}

function _rotOpcao(p, v) { const o = (p.opcoes || []).find(x => x.v === v); return o ? o.r : v }

function _valorHTML(p, resp, aplic) {
  const k = p.chave
  const v = resp[k]
  if (!aplic.has(k)) return '<span class="soc-pv-vazio">não se aplica</span>'
  if (v === SocioRegras.NR) return '<em class="soc-nr">Não respondeu</em>'
  if (v === undefined || v === null || v === '') return '<span class="soc-falta">em branco</span>'
  let txt
  if (Array.isArray(v)) txt = v.map(x => esc(_rotOpcao(p, x))).join('<br>')
  else if (typeof v === 'boolean') txt = v ? 'Sim' : 'Não'
  else txt = esc(p.opcoes ? _rotOpcao(p, v) : v)
  const outro = resp[k + '_outro']
  return txt + (outro ? `<div class="soc-sub">Outro: ${esc(outro)}</div>` : '')
}

function _listaHTML(est, linhas, identLinhas, veIdent) {
  const l = est.lista
  if (!l) return ''
  const porOrdem = {}
  ;(identLinhas || []).forEach(x => { porOrdem[x.ordem] = x })
  const cols = (l.colunas || []).filter(c => !c.identificacao || veIdent)
  const ocultas = (l.colunas || []).some(c => c.identificacao) && !veIdent
  const cel = (c, row) => {
    const v = row[c.chave]
    if (v === undefined || v === null || v === '') return '<span class="soc-pv-vazio">—</span>'
    if (v === SocioRegras.NR) return '<em class="soc-nr">NR</em>'
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
    return esc(c.opcoes ? _rotOpcao(c, v) : v)
  }
  const corpo = (linhas || []).slice().sort((a, b) => a.ordem - b.ordem).map(m => {
    const row = Object.assign({}, m, porOrdem[m.ordem] || {})
    return `<tr><td class="soc-num">${m.ordem}${m.e_entrevistado ? ' <span class="soc-pv-tag">entrevistado</span>' : ''}</td>${cols.map(c => `<td>${cel(c, row)}</td>`).join('')}</tr>`
  }).join('')
  return `<div class="table-wrap soc-pv-lista"><table><thead><tr><th scope="col">#</th>${cols.map(c => `<th scope="col">${esc(c.rotulo || c.chave)}</th>`).join('')}</tr></thead>
    <tbody>${corpo || `<tr><td colspan="${cols.length + 1}"><span class="soc-pv-vazio">Lista vazia.</span></td></tr>`}</tbody></table></div>
    ${ocultas ? '<p class="soc-pv-nota">Colunas de identificação ocultas para o seu acesso.</p>' : ''}`
}

function _respostasHTML(d) {
  const f = d.ficha, est = (d.questionario || {}).estrutura || {}
  if (!f.aceitou_participar) return '<div class="soc-aviso">' + bico('info') + '<div><strong>A pessoa não aceitou participar.</strong>Não há respostas — a ficha registra só a abordagem.</div></div>'
  const resp = f.respostas || {}
  let aplic
  try { aplic = new Set(SocioRegras.aplicaveis(est, resp)) } catch (_) { aplic = new Set(Object.keys(resp)) }
  const ident = d.identificacao
  return (est.blocos || []).map(b => `<section class="soc-fd-bloco"><h4>${esc(b.titulo || b.id)}</h4><dl class="soc-fd-resp">
    ${(b.perguntas || []).map(p => {
      const num = SocioRegras.numero(p)
      if (p.tipo === 'tabela') return `<div class="soc-fd-linha soc-fd-larga"><dt><span class="soc-pv-num">${esc(num)}</span> ${esc(p.texto)}</dt>
        <dd>${_listaHTML(est, f.linhas, ident && ident.linhas, !!d.ve_identificacao)}</dd></div>`
      return `<div class="soc-fd-linha${aplic.has(p.chave) ? '' : ' soc-fd-pulada'}"><dt><span class="soc-pv-num">${esc(num)}</span> ${esc(p.texto)}${p.derivada ? ' <span class="soc-pv-tag">calculada</span>' : ''}</dt>
        <dd>${_valorHTML(p, resp, aplic)}</dd></div>`
    }).join('')}</dl></section>`).join('')
}

function _fichaRender() {
  const d = _fDet, f = d.ficha, est = (d.questionario || {}).estrutura || {}
  const [cls, txt] = SIT_FICHA[f.status] || ['badge-cinza', f.status]
  document.getElementById('fd-titulo').textContent = 'Ficha ' + f.codigo
  const meta = [
    ['Situação', badge(cls, txt) + (f.treino ? ' ' + badge('badge-blue', 'Treino') : '')],
    ['Campanha', esc(d.campanha_nome || '—')],
    ['Versão aplicada', `v${esc(d.questionario.versao)} <span class="soc-sub" title="${esc(d.questionario.hash || '')}">SHA-256 ${esc(String(d.questionario.hash || '').slice(0, 12))}…</span>`],
    ['Entrevista', fmtDia(f.dt_entrevista)],
    ['Enviada', fmtMomento(f.enviado_em) + (f.usou_carencia ? ' <span class="soc-sub">(na carência)</span>' : '')],
    ['Entrevistador', esc(d.entrevistador_nome || '—')],
    ['Município', esc(d.municipio_nome || '—')],
    ['UC', esc(d.uc_nome || '—')],
    ['Comunidade', esc(d.comunidade_nome || (f.comunidade_nova ? f.comunidade_nova + ' (nome digitado)' : '—'))],
    ['Fotos autorizadas', f.aceitou_participar ? (f.fotos_autorizadas ? 'Sim' : 'Não') : '—'],
  ]
  if (f.status === 'validada' && f.validado_em) meta.push(['Validada', `${fmtMomento(f.validado_em)} por ${esc(d.validado_por_nome || '—')}`])
  if (f.status === 'devolvida' && f.motivo_devolucao) meta.push(['Motivo da devolução', esc(f.motivo_devolucao)])

  const alertas = (f.alertas || []).map(a => `<li>${esc(SocioRegras.descreverAlerta(a, est))}</li>`).join('')
  const comNova = d.pode_gerir && f.comunidade_nova && !f.comunidade_id && f.status !== 'descartada'
  const ident = d.identificacao
    ? `<section class="soc-fd-bloco"><h4>Identificação</h4><dl class="soc-fd-resp">
        <div class="soc-fd-linha"><dt>Entrevistado</dt><dd>${esc(d.identificacao.entrevistado_nome || '—')}</dd></div>
        <div class="soc-fd-linha"><dt>Localização</dt><dd>${d.identificacao.lat != null
          ? `<span class="soc-num">${Number(d.identificacao.lat).toFixed(6)}, ${Number(d.identificacao.lon).toFixed(6)}</span>${d.identificacao.gps_precisao_m != null ? ` <span class="soc-sub">± ${Math.round(d.identificacao.gps_precisao_m)} m</span>` : ''}`
          : '—'}${d.identificacao.obs_localizacao ? `<div class="soc-sub">${esc(d.identificacao.obs_localizacao)}</div>` : ''}</dd></div></dl></section>`
    : `<div class="soc-aviso">${bico('shield')}<div><strong>Identificação oculta.</strong>Nome, localização e fotos ficam só com o gestor do questionário e com quem entrevistou.</div></div>`
  const fotos = d.fotos == null ? '' : `<section class="soc-fd-bloco"><h4>Fotos (${d.fotos.length})</h4>${d.fotos.length
    ? `<div class="soc-fd-fotos">${d.fotos.map(ft => `<figure><img ${fotoAttr(ft.arquivo_url, '')} alt="Foto: ${esc(TEMA_FOTO[ft.tema] || ft.tema)}" loading="lazy">
        <figcaption>${esc(TEMA_FOTO[ft.tema] || ft.tema)}${ft.legenda ? ' — ' + esc(ft.legenda) : ''}</figcaption></figure>`).join('')}</div>`
    : '<p class="soc-sub">Nenhuma foto.</p>'}</section>`
  const hist = (d.historico || []).length ? `<section class="soc-fd-bloco"><h4>Histórico</h4><ol class="soc-fd-hist">
    ${d.historico.map(h => `<li><span class="soc-num">${fmtMomento(h.em)}</span> — ${esc(h.por_nome || 'sistema')}:
      ${esc((SIT_FICHA[h.status_de] || [, h.status_de || 'nova'])[1])} → <strong>${esc((SIT_FICHA[h.status_para] || [, h.status_para])[1])}</strong>
      ${h.motivo ? `<div class="soc-sub">${esc(h.motivo)}</div>` : ''}</li>`).join('')}</ol></section>` : ''

  document.getElementById('fd-corpo').innerHTML = `
    <dl class="soc-fd-meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${comNova ? `<div class="soc-aviso">${bico('pin')}<div><strong>Comunidade nova: “${esc(f.comunidade_nova)}”</strong>
        Ligue a ficha a uma comunidade do cadastro ou cadastre esta.
        <div class="soc-fd-vinc"><select class="form-control" id="fd-com" aria-label="Comunidade do cadastro">${_opcoesComunidade(f)}</select>
        <button class="btn btn-secondary btn-sm" type="button" id="fd-vinc" onclick="fichaVincular()">Ligar</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="fichaCadastrarComunidade()">Cadastrar “${esc(f.comunidade_nova)}”</button></div></div></div>` : ''}
    ${alertas ? `<section class="soc-fd-bloco"><h4>Para conferir</h4><ul class="soc-fd-alertas">${alertas}</ul></section>` : ''}
    ${ident}${_respostasHTML(d)}${fotos}${hist}`
  if (d.fotos && d.fotos.length && typeof assinarFotos === 'function') assinarFotos(document.getElementById('fd-corpo'))

  const ac = [`<button class="btn btn-secondary" type="button" onclick="socFechar('ficha')">Fechar</button>`]
  if (d.pode_gerir && !f.treino) {
    if (f.status === 'enviada' || f.status === 'devolvida') ac.unshift(`<button class="btn btn-ghost" type="button" onclick="fichaStatus('descartada')">Descartar</button>`)
    if (f.status === 'enviada' || f.status === 'validada') ac.unshift(`<button class="btn btn-secondary" type="button" onclick="fichaStatus('devolvida')">Devolver ao entrevistador</button>`)
    if (f.status === 'enviada') ac.unshift(`<button class="btn btn-primary" type="button" id="fd-validar" onclick="fichaStatus('validada')">Validar</button>`)
  }
  document.getElementById('fd-acoes').innerHTML = ac.join('')
}

function _opcoesComunidade(f) {
  const coms = ((_terr || {}).comunidades || []).filter(c => c.cd_mun === f.cd_mun).sort((a, b) => a.nome.localeCompare(b.nome))
  if (!coms.length) return '<option value="">Nenhuma comunidade deste município no cadastro</option>'
  const alvo = _semAcento(f.comunidade_nova)
  return '<option value="">Escolha…</option>' + coms.map(c =>
    `<option value="${esc(c.id)}"${_semAcento(c.nome) === alvo ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')
}

async function _fichaRecarregar() {
  _fDet = await rpc('socio_ficha_detalhe', { p_ficha: _fDet.ficha.id })
  _fichaRender()
  if (_subAba === 'fichas') await renderSub()
}

async function fichaStatus(sit) {
  const f = _fDet.ficha
  let motivo = null
  if (sit === 'validada') {
    const pend = (f.alertas || []).filter(a => a.tipo === 'pendente').length
    const ok = await confirmar({ titulo: 'Validar a ficha?', ok: 'Validar',
      texto: `A ficha <strong>${esc(f.codigo)}</strong> passa a contar nos indicadores.` +
        (pend ? ` Ainda há <strong>${pend} pergunta(s) em branco</strong> — se faltou perguntar, devolva ao entrevistador.` : '') })
    if (!ok) return
  } else {
    motivo = await confirmar({
      titulo: sit === 'devolvida' ? 'Devolver ao entrevistador' : 'Descartar a ficha',
      texto: sit === 'devolvida' ? 'O entrevistador recebe o aviso com o motivo e corrige no app.'
        : 'A ficha sai dos indicadores e não pode voltar. Use para entrevista duplicada ou feita por engano.',
      ok: sit === 'devolvida' ? 'Devolver' : 'Descartar', perigo: sit === 'descartada', campo: 'Motivo', minimo: 5,
    })
    if (!motivo) return
  }
  try {
    await rpc('socio_mudar_status', { p_ficha_id: f.id, p_status: sit, p_motivo: motivo })
    toast({ validada: 'Ficha validada.', devolvida: 'Ficha devolvida ao entrevistador.', descartada: 'Ficha descartada.' }[sit], 'success')
    await _fichaRecarregar()
  } catch (e) { toast(msgErro(e), 'error') }
}

async function _vincular(comId) {
  await rpc('socio_vincular_comunidade', { p_ficha: _fDet.ficha.id, p_comunidade: comId })
  toast('Ficha ligada à comunidade.', 'success')
  await _fichaRecarregar()
}

async function fichaVincular() {
  const id = document.getElementById('fd-com').value
  if (!id) return toast('Escolha a comunidade.', 'warning')
  const pronto = btnEspera(document.getElementById('fd-vinc'))
  try { await _vincular(id) } catch (e) { toast(msgErro(e), 'error') } finally { pronto() }
}

function fichaCadastrarComunidade() {
  const f = _fDet.ficha
  comAbrir(null, { nome: f.comunidade_nova, cd_mun: f.cd_mun }, async id => {
    try { await _vincular(id) } catch (e) { toast(msgErro(e), 'error') }
  })
}
