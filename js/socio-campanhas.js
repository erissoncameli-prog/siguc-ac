// ── SIGUC-AC · Diagnóstico Socioeconômico — mesa: campanhas (Fase 4) ───
//
// Aba "Campanhas" do questionário em pages/socio-questionarios.html.
// Usa os utilitários da página (rpc, esc, bico, badge, fmtDia, msgErro,
// socAbrir/socFechar, confirmar, catPorId, _sel, carregarVersoes/_versoes).
//
// Toda escrita é por RPC (362c): socio_salvar_campanha,
// socio_situacao_campanha, socio_definir_aplicador, socio_salvar_comunidade.
// Leituras montadas no banco (364): socio_campanhas_resumo (contagens, para
// quem vê o questionário) e socio_campanha_equipe (só gestor). A tela só
// esconde botão: quem decide é o banco.

let _camps = [], _campEd = null, _campEquipe = null, _terr = null, _comEd = null

const SIT_CAMP = {
  planejada: ['badge-ouro', 'Planejada'], aberta: ['badge-verde', 'Aberta'], encerrada: ['badge-cinza', 'Encerrada'],
}

// municípios, UCs e comunidades: o mesmo pacote que o app de campo usa
async function socTerritorio(forcar) {
  if (_terr && !forcar) return _terr
  const p = await rpc('socio_app_pacote')
  _terr = { municipios: p.municipios || [], ucs: p.ucs || [], comunidades: p.comunidades || [] }
  return _terr
}

function _campTerritorioTxt(c) {
  const t = _terr || { municipios: [], ucs: [] }
  const mun = (c.municipios || []).length
    ? c.municipios.map(cd => (t.municipios.find(m => m.cd_ibge === cd) || {}).nome || cd).join(', ')
    : 'qualquer município'
  const uc = (c.ucs || []).length ? `${c.ucs.length} UC(s)` : (c.exige_uc ? 'qualquer UC' : '')
  const exige = [c.exige_municipio ? 'município obrigatório' : '', c.exige_uc ? 'UC obrigatória' : ''].filter(Boolean).join(' · ')
  return `${esc(mun)}${uc ? ' · ' + esc(uc) : ''}${exige ? `<div class="soc-sub">${esc(exige)}</div>` : ''}`
}

async function campanhasHTML() {
  const c = catPorId(_sel)
  const g = c.pode_gerir
  const [lista] = await Promise.all([rpc('socio_campanhas_resumo', { p_instrumento: _sel }), socTerritorio(), carregarVersoes()])
  _camps = lista || []
  const publicadas = _versoes.filter(v => v.status === 'publicado')
  const topo = g ? `<div class="filter-bar" style="justify-content:flex-end">
      ${publicadas.length ? `<button class="btn btn-primary" type="button" onclick="campAbrir(null)">${bico('plus')} Nova campanha</button>`
        : '<span class="soc-sub">Publique uma versão do questionário antes de criar campanha.</span>'}</div>` : ''
  const tabela = `<div class="card" style="margin-bottom:16px"><div class="table-wrap"><table class="soc-tab"><thead><tr>
      <th>Campanha</th><th>Período</th><th>Situação</th><th>Versão</th><th>Onde</th><th>Equipe</th><th>Fichas</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>
    ${_camps.length ? _camps.map(k => {
      const [cls, txt] = SIT_CAMP[k.situacao] || ['badge-cinza', k.situacao]
      const venceu = k.situacao === 'aberta' && k.fim < hojeAcre()
      const ac = []
      if (g) {
        if (k.situacao !== 'encerrada') ac.push(`<button class="btn btn-secondary btn-sm" type="button" onclick="campAbrir('${k.id}')">Editar</button>`)
        ac.push(`<button class="btn btn-secondary btn-sm" type="button" onclick="campEquipe('${k.id}')">Equipe</button>`)
        if (k.situacao === 'planejada') ac.push(`<button class="btn btn-primary btn-sm" type="button" onclick="campSituacao('${k.id}','aberta')">Abrir</button>`)
        if (k.situacao !== 'encerrada') ac.push(`<button class="btn btn-ghost btn-sm" type="button" onclick="campSituacao('${k.id}','encerrada')">Encerrar</button>`)
        else ac.push(`<button class="btn btn-ghost btn-sm" type="button" onclick="campSituacao('${k.id}','aberta')">Reabrir</button>`)
      }
      ac.push(`<button class="btn btn-ghost btn-sm" type="button" onclick="fichasDaCampanha('${k.id}')">Ver fichas</button>`)
      return `<tr><td><div class="soc-tit">${esc(k.nome)}</div></td>
        <td class="soc-num">${fmtDia(k.inicio)} a ${fmtDia(k.fim)}${venceu ? '<div class="soc-sub">período acabou — só envio (15 dias)</div>' : ''}</td>
        <td>${badge(cls, txt)}</td><td class="soc-num">v${k.versao}</td><td>${_campTerritorioTxt(k)}</td>
        <td class="soc-num">${k.n_aplicadores}</td>
        <td class="soc-num" title="aguardando · devolvidas · validadas · descartadas">${k.n_enviadas} aguardando · ${k.n_devolvidas} devolvidas · ${k.n_validadas} validadas${k.n_descartadas ? ' · ' + k.n_descartadas + ' descartadas' : ''}</td>
        <td><div class="soc-acoes">${ac.join('')}</div></td></tr>`
    }).join('') : `<tr><td colspan="8"><div class="empty-state">${g ? 'Nenhuma campanha ainda. Crie a primeira, monte a equipe e abra — só então o app de campo mostra o questionário.'
      : 'Nenhuma campanha ainda.'}</div></td></tr>`}</tbody></table></div></div>`
  return `<p class="soc-intro">Campanha = quando, onde e com quem o questionário vai a campo. O app de campo só mostra campanhas
      <strong>abertas</strong> a quem está na <strong>equipe</strong> dela; fichas concluídas a tempo ainda sobem até 15 dias depois do fim.</p>`
    + topo + tabela + (g ? comunidadesHTML() : '')
}

// ── campanha: criar / editar ──
function _campModal() {
  if (document.getElementById('modal-campanha')) return
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="modal-campanha" role="dialog" aria-modal="true" aria-labelledby="cp-titulo">
    <div class="modal" style="max-width:720px">
      <div class="modal-header"><div class="modal-title" id="cp-titulo">Campanha</div>
        <button class="modal-close" type="button" aria-label="Fechar" onclick="socFechar('campanha')">×</button></div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label" for="cp-nome">Nome <span class="obrig">*</span></label>
          <input class="form-control" id="cp-nome" maxlength="150" placeholder="Ex.: Campanha 2026 — Alto Juruá"></div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label" for="cp-ini">Início <span class="obrig">*</span></label><input class="form-control" id="cp-ini" type="date"></div>
          <div class="form-group"><label class="form-label" for="cp-fim">Fim <span class="obrig">*</span></label><input class="form-control" id="cp-fim" type="date"></div>
        </div>
        <div class="form-group"><label class="form-label" for="cp-versao">Versão do questionário <span class="obrig">*</span></label>
          <select class="form-control" id="cp-versao"></select>
          <div class="form-hint" id="cp-versao-dica">Só versões publicadas. Com fichas já enviadas, a versão e o início não mudam.</div></div>
        <fieldset class="form-group" style="border:none;padding:0;margin:0 0 12px"><legend class="form-label">O que o entrevistador informa</legend>
          <label class="soc-papel"><input type="checkbox" id="cp-ex-mun"><span>Município é obrigatório</span></label>
          <label class="soc-papel"><input type="checkbox" id="cp-ex-uc"><span>Unidade de conservação é obrigatória</span></label></fieldset>
        <fieldset class="form-group" style="border:none;padding:0;margin:0 0 12px"><legend class="form-label">Municípios da campanha</legend>
          <div class="form-hint">Nenhum marcado = qualquer município do Acre.</div>
          <div class="soc-checks" id="cp-muns"></div></fieldset>
        <fieldset class="form-group" style="border:none;padding:0;margin:0"><legend class="form-label">Unidades de conservação</legend>
          <div class="form-hint">Nenhuma marcada = qualquer UC (ou nenhuma, se não for obrigatória).</div>
          <div class="soc-checks soc-checks-alto" id="cp-ucs"></div></fieldset>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" onclick="socFechar('campanha')">Cancelar</button>
        <button class="btn btn-primary" type="button" id="cp-salvar" onclick="campSalvar()">Salvar</button>
      </div>
    </div>
  </div>`)
}

async function campAbrir(id) {
  _campModal()
  await socTerritorio()
  const k = id ? _camps.find(x => x.id === id) : null
  _campEd = id
  const temFichas = k && (k.n_enviadas + k.n_devolvidas + k.n_validadas + k.n_descartadas) > 0
  document.getElementById('cp-titulo').textContent = k ? 'Editar campanha' : 'Nova campanha'
  document.getElementById('cp-nome').value = k ? k.nome : ''
  document.getElementById('cp-ini').value = k ? k.inicio : hojeAcre()
  document.getElementById('cp-fim').value = k ? k.fim : somarDias(hojeAcre(), 30)
  const pubs = _versoes.filter(v => v.status === 'publicado')
  const sel = document.getElementById('cp-versao')
  sel.innerHTML = pubs.map(v => `<option value="${v.id}">v${v.versao} — publicada em ${fmtDia(v.publicado_em)}</option>`).join('')
  sel.value = k ? k.questionario_id : (pubs[0] || {}).id
  sel.disabled = !!temFichas
  document.getElementById('cp-ini').disabled = false
  document.getElementById('cp-ex-mun').checked = k ? k.exige_municipio : true
  document.getElementById('cp-ex-uc').checked = k ? k.exige_uc : false
  const muns = new Set(k ? k.municipios : []), ucs = new Set(k ? k.ucs : [])
  document.getElementById('cp-muns').innerHTML = _terr.municipios.map(m =>
    `<label class="soc-papel"><input type="checkbox" value="${esc(m.cd_ibge)}" ${muns.has(m.cd_ibge) ? 'checked' : ''}><span>${esc(m.nome)}</span></label>`).join('')
  document.getElementById('cp-ucs').innerHTML = _terr.ucs.map(u =>
    `<label class="soc-papel"><input type="checkbox" value="${esc(u.id)}" ${ucs.has(u.id) ? 'checked' : ''}><span>${esc(u.nome)}</span></label>`).join('')
    || '<span class="soc-sub">Nenhuma UC cadastrada.</span>'
  socAbrir('campanha')
}

async function campSalvar() {
  const marcados = id => Array.from(document.querySelectorAll(`#${id} input:checked`)).map(i => i.value)
  const dados = {
    p_id: _campEd, p_instrumento: _sel, p_questionario: document.getElementById('cp-versao').value,
    p_nome: document.getElementById('cp-nome').value.trim(),
    p_inicio: document.getElementById('cp-ini').value, p_fim: document.getElementById('cp-fim').value,
    p_exige_municipio: document.getElementById('cp-ex-mun').checked, p_exige_uc: document.getElementById('cp-ex-uc').checked,
    p_municipios: marcados('cp-muns'), p_ucs: marcados('cp-ucs'),
  }
  if (dados.p_nome.length < 3) return toast('Dê um nome à campanha.', 'warning')
  if (!dados.p_inicio || !dados.p_fim) return toast('Informe início e fim.', 'warning')
  if (dados.p_fim < dados.p_inicio) return toast('O fim não pode ser antes do início.', 'warning')
  if (!dados.p_questionario) return toast('Escolha a versão do questionário.', 'warning')
  const pronto = btnEspera(document.getElementById('cp-salvar'))
  try {
    await rpc('socio_salvar_campanha', dados)
    socFechar('campanha')
    toast(_campEd ? 'Campanha atualizada.' : 'Campanha criada. Monte a equipe e abra quando for a campo.', 'success')
    await renderSub()
  } catch (e) { toast(msgErro(e), 'error') } finally { pronto() }
}

async function campSituacao(id, sit) {
  const k = _camps.find(x => x.id === id)
  const textos = {
    aberta: k.situacao === 'encerrada'
      ? `Reabrir <strong>${esc(k.nome)}</strong>? A equipe volta a ver o questionário no app.`
      : `Abrir <strong>${esc(k.nome)}</strong>? A equipe passa a ver o questionário no app e pode entrevistar até ${fmtDia(k.fim)}.`,
    encerrada: `Encerrar <strong>${esc(k.nome)}</strong>? Ninguém começa entrevista nova. Fichas concluídas no período ainda podem subir por 15 dias.`,
  }
  const ok = await confirmar({ titulo: sit === 'aberta' ? 'Abrir campanha' : 'Encerrar campanha', texto: textos[sit],
    ok: sit === 'aberta' ? (k.situacao === 'encerrada' ? 'Reabrir' : 'Abrir') : 'Encerrar', perigo: sit === 'encerrada' })
  if (!ok) return
  try {
    await rpc('socio_situacao_campanha', { p_id: id, p_situacao: sit })
    toast(sit === 'aberta' ? 'Campanha aberta.' : 'Campanha encerrada.', 'success')
    await renderSub()
  } catch (e) { toast(msgErro(e), 'error') }
}

// ── equipe da campanha ──
function _equipeModal() {
  if (document.getElementById('modal-equipe-camp')) return
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="modal-equipe-camp" role="dialog" aria-modal="true" aria-labelledby="eq-titulo">
    <div class="modal" style="max-width:640px">
      <div class="modal-header"><div class="modal-title" id="eq-titulo">Equipe da campanha</div>
        <button class="modal-close" type="button" aria-label="Fechar" onclick="socFechar('equipe-camp')">×</button></div>
      <div class="modal-body" id="eq-corpo"></div>
      <div class="modal-footer"><button class="btn btn-secondary" type="button" onclick="socFechar('equipe-camp')">Fechar</button></div>
    </div>
  </div>`)
}

const ORIGEM_EQ = { departamento: 'do departamento', acesso: 'acesso de aplicador aprovado', sem_acesso: 'perdeu o acesso de aplicador' }

async function campEquipe(id) {
  _equipeModal()
  _campEquipe = id
  const k = _camps.find(x => x.id === id)
  document.getElementById('eq-titulo').textContent = 'Equipe — ' + k.nome
  document.getElementById('eq-corpo').innerHTML = skeletonBlocoHTML(3)
  socAbrir('equipe-camp')
  await _equipeRender()
}

async function _equipeRender() {
  const el = document.getElementById('eq-corpo')
  try {
    const pessoas = await rpc('socio_campanha_equipe', { p_campanha: _campEquipe }) || []
    el.innerHTML = `<p class="soc-intro">Só entra quem é <strong>aplicador</strong> do questionário (aba Equipe) ou tem acesso de aplicador aprovado.
        Tirar da equipe não apaga nada: as fichas que a pessoa já fez continuam.</p>
      ${pessoas.length ? `<div class="table-wrap"><table class="soc-tab"><thead><tr><th>Na equipe</th><th>Pessoa</th><th>Fichas</th></tr></thead><tbody>
        ${pessoas.map(p => `<tr><td><label class="soc-papel"><input type="checkbox" ${p.na_equipe ? 'checked' : ''} ${!p.pode_aplicar && !p.na_equipe ? 'disabled' : ''}
            onchange="campDefinirAplicador('${p.usuario_id}', this)" aria-label="Na equipe: ${esc(p.nome)}"><span class="sr-only">Na equipe</span></label></td>
          <td><div class="soc-tit">${esc(p.nome)}</div><div class="soc-sub">${esc(p.email || '')} · ${esc(ORIGEM_EQ[p.origem] || p.origem)}</div></td>
          <td class="soc-num">${p.n_fichas}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty-state">Ninguém pode ser escalado ainda. Dê o papel <strong>Aplicador</strong> a alguém do departamento na aba Equipe.</div>'}`
  } catch (e) {
    el.innerHTML = `<div class="soc-aviso" role="alert">${bico('alert-triangle')}<div>${esc(msgErro(e))}</div></div>`
  }
}

async function campDefinirAplicador(uid, caixa) {
  const incluir = caixa.checked
  caixa.disabled = true
  try {
    await rpc('socio_definir_aplicador', { p_campanha: _campEquipe, p_usuario: uid, p_incluir: incluir })
    toast(incluir ? 'Incluído na equipe.' : 'Retirado da equipe.', 'success')
    await _equipeRender()
    const k = _camps.find(x => x.id === _campEquipe)
    if (k) k.n_aplicadores += incluir ? 1 : -1
  } catch (e) { caixa.checked = !incluir; caixa.disabled = false; toast(msgErro(e), 'error') }
}

// ── comunidades (cadastro comum a todos os questionários) ──
function comunidadesHTML() {
  const t = _terr || { comunidades: [], municipios: [] }
  const nomeMun = cd => (t.municipios.find(m => m.cd_ibge === cd) || {}).nome || cd
  const coms = t.comunidades.slice().sort((a, b) => nomeMun(a.cd_mun).localeCompare(nomeMun(b.cd_mun)) || a.nome.localeCompare(b.nome))
  return `<div class="card"><div class="card-header"><div class="card-title">Comunidades</div>
      <button class="btn btn-secondary btn-sm" type="button" onclick="comAbrir(null)">${bico('plus')} Nova comunidade</button></div>
    <div class="soc-corpo"><p class="soc-intro" style="margin:0 0 12px">Cadastro comum a todos os questionários da SEMA. O entrevistador escolhe da lista;
      se a comunidade não estiver nela, ele digita o nome e você liga a ficha à comunidade certa na aba Fichas.</p>
    <div class="table-wrap"><table class="soc-tab"><thead><tr><th>Comunidade</th><th>Município</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>
    ${coms.length ? coms.map(c => `<tr><td>${esc(c.nome)}</td><td>${esc(nomeMun(c.cd_mun))}</td>
      <td><div class="soc-acoes"><button class="btn btn-ghost btn-sm" type="button" onclick="comAbrir('${c.id}')">Editar</button></div></td></tr>`).join('')
      : '<tr><td colspan="3"><div class="empty-state">Nenhuma comunidade cadastrada.</div></td></tr>'}</tbody></table></div></div></div>`
}

function _comModal() {
  if (document.getElementById('modal-comunidade')) return
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="modal-comunidade" role="dialog" aria-modal="true" aria-labelledby="cm-titulo">
    <div class="modal" style="max-width:520px">
      <div class="modal-header"><div class="modal-title" id="cm-titulo">Comunidade</div>
        <button class="modal-close" type="button" aria-label="Fechar" onclick="socFechar('comunidade')">×</button></div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label" for="cm-nome">Nome <span class="obrig">*</span></label><input class="form-control" id="cm-nome" maxlength="150"></div>
        <div class="form-group"><label class="form-label" for="cm-mun">Município <span class="obrig">*</span></label><select class="form-control" id="cm-mun"></select></div>
        <div class="form-group"><label class="form-label" for="cm-uc">Unidade de conservação</label><select class="form-control" id="cm-uc"></select></div>
        <label class="soc-papel" id="cm-ativo-grupo"><input type="checkbox" id="cm-ativo" checked><span>Ativa (aparece no app)</span></label>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" onclick="socFechar('comunidade')">Cancelar</button>
        <button class="btn btn-primary" type="button" id="cm-salvar" onclick="comSalvar()">Salvar</button>
      </div>
    </div>
  </div>`)
}

// `pre` (opcional): {nome, cd_mun} — usado ao cadastrar a partir de uma ficha
let _comDepois = null
async function comAbrir(id, pre, depois) {
  _comModal()
  await socTerritorio()
  const c = id ? _terr.comunidades.find(x => x.id === id) : null
  _comEd = id
  _comDepois = depois || null
  document.getElementById('cm-titulo').textContent = c ? 'Editar comunidade' : 'Nova comunidade'
  document.getElementById('cm-nome').value = c ? c.nome : ((pre && pre.nome) || '')
  const cd = c ? c.cd_mun : ((pre && pre.cd_mun) || '')
  document.getElementById('cm-mun').innerHTML = '<option value="">Escolha…</option>' + _terr.municipios.map(m =>
    `<option value="${esc(m.cd_ibge)}" ${m.cd_ibge === cd ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')
  document.getElementById('cm-uc').innerHTML = '<option value="">Fora de UC</option>' + _terr.ucs.map(u =>
    `<option value="${esc(u.id)}" ${c && u.id === c.uc_id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')
  document.getElementById('cm-ativo').checked = true
  document.getElementById('cm-ativo-grupo').hidden = !c
  socAbrir('comunidade')
}

async function comSalvar() {
  const nome = document.getElementById('cm-nome').value.trim()
  const cd = document.getElementById('cm-mun').value
  if (nome.length < 2) return toast('Escreva o nome da comunidade.', 'warning')
  if (!cd) return toast('Escolha o município.', 'warning')
  const pronto = btnEspera(document.getElementById('cm-salvar'))
  try {
    const id = await rpc('socio_salvar_comunidade', {
      p_nome: nome, p_cd_mun: cd, p_uc_id: document.getElementById('cm-uc').value || null,
      p_id: _comEd, p_ativo: document.getElementById('cm-ativo').checked,
    })
    socFechar('comunidade')
    toast('Comunidade salva.', 'success')
    await socTerritorio(true)
    if (_comDepois) await _comDepois(id)
    else if (_subAba === 'campanhas') await renderSub()
  } catch (e) { toast(msgErro(e), 'error') } finally { pronto() }
}
