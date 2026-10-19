// ── SIGUC-AC · Diagnóstico Socioeconômico — mesa: indicadores e exportação (Fase 5) ──
//
// Aba "Indicadores" do questionário em pages/socio-questionarios.html.
// Usa os utilitários da página (rpc, esc, bico, badge, msgErro, confirmar,
// catPorId, _sel) e os de js/socio-campanhas.js (_camps, socTerritorio).
//
// Os números vêm PRONTOS de socio_indicadores (migration 365): só fichas
// validadas, fora do treino, e nada por pergunta abaixo de 5 fichas no
// recorte (supressão decidida no banco — a tela nunca recalcula nem
// "completa" o que veio nulo). Texto livre nunca aparece aqui.
//
// Exportação: socio_exportar devolve as fichas JÁ filtradas para quem pede
// (leitor sem texto livre; identificação só para o gestor que pedir) e
// grava o registro da exportação na mesma chamada. A planilha é montada
// aqui com ExcelJS (js/vendor, carregado só no clique — nunca SheetJS).

let _indFiltro = { campanha: '', cd_mun: '', uc: '' }
let _indDados = null

const IND_COR = 'var(--verde-medio)'

function _indFmt(n, casas) {
  if (n === null || n === undefined || n === '') return '—'
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casas ?? 1 })
}
function _indPct(n, base) { return base ? Math.round((n / base) * 1000) / 10 : 0 }

// barras horizontais, uma série só (sem legenda: o título do card nomeia).
// Cada barra tem <title> — é o que o tooltip de mouse, o teclado e a
// tabela alternativa de js/grafico-teclado.js leem.
function _indBarrasSVG(opcoes, base) {
  const L = 560, rot = 200, alt = 26, gap = 6, larg = L - rot - 90
  const h = opcoes.length * (alt + gap)
  const corpo = opcoes.map((o, i) => {
    const y = i * (alt + gap)
    const p = _indPct(o.n, base)
    const w = Math.max(o.n ? 4 : 0, Math.round((p / 100) * larg))
    const txt = `${o.r}: ${o.n} (${_indFmt(p)}%)`
    return `<g><title>${esc(txt)}</title>
      <text x="${rot - 8}" y="${y + alt / 2 + 4}" text-anchor="end" class="soc-ind-rot">${esc(String(o.r).length > 30 ? String(o.r).slice(0, 29) + '…' : o.r)}</text>
      <rect x="${rot}" y="${y + 4}" width="${larg}" height="${alt - 8}" rx="4" class="soc-ind-trilho"/>
      ${w ? `<rect x="${rot}" y="${y + 4}" width="${w}" height="${alt - 8}" rx="4" fill="${IND_COR}"/>` : ''}
      <text x="${rot + larg + 8}" y="${y + alt / 2 + 4}" class="soc-ind-val">${o.n} · ${_indFmt(p)}%</text></g>`
  }).join('')
  return `<svg viewBox="0 0 ${L} ${h}" width="100%" role="img" class="soc-ind-svg" preserveAspectRatio="xMinYMin meet">${corpo}</svg>`
}

function _indGrafico(titulo, opcoes, base) {
  const svg = _indBarrasSVG(opcoes, base)
  return typeof graficoTecladoEnvolver === 'function' ? graficoTecladoEnvolver(svg, { rotulo: titulo }) : svg
}

function _indEstatHTML(e) {
  if (!e) return '<p class="soc-sub">Nenhum número informado.</p>'
  return `<dl class="soc-ind-estat">
    <div><dt>Média</dt><dd>${_indFmt(e.media, 2)}</dd></div>
    <div><dt>Mediana</dt><dd>${_indFmt(e.mediana, 2)}</dd></div>
    <div><dt>Metade central</dt><dd>${_indFmt(e.q1, 2)} a ${_indFmt(e.q3, 2)}</dd></div>
    <div><dt>Responderam</dt><dd>${_indFmt(e.n, 0)}</dd></div></dl>
    <p class="soc-sub">Mínimo e máximo não são mostrados: o extremo costuma ser uma casa só.</p>`
}

function _indPerguntaHTML(p) {
  const num = p.rotulo || p.n
  const cab = `<div class="soc-ind-cab"><span class="soc-pv-num">${esc(num == null ? '' : 'P' + num)}</span>
    <span class="soc-tit">${esc(p.texto)}</span>${p.derivada ? ' <span class="soc-pv-tag">calculada</span>' : ''}</div>`
  const rodape = `<p class="soc-sub">${p.n_respostas} responderam${p.n_nr ? ` · ${p.n_nr} não responderam` : ''}${p.tipo === 'multipla' ? ' · podia marcar mais de uma, os percentuais somam mais de 100%' : ''}</p>`
  let corpo
  if (p.opcoes) corpo = _indGrafico(p.texto, p.opcoes, p.n_respostas)
  else if (p.estat !== undefined) corpo = _indEstatHTML(p.estat)
  else corpo = '<p class="soc-sub">Resposta em texto livre — não aparece nos indicadores (pode identificar quem respondeu). Leia nas fichas.</p>'
  return `<article class="soc-ind-perg">${cab}${corpo}${rodape}</article>`
}

async function indicadoresHTML() {
  const c = catPorId(_sel)
  const [camps] = await Promise.all([rpc('socio_campanhas_resumo', { p_instrumento: _sel }), socTerritorio()])
  _camps = camps || []
  if (_indFiltro.campanha && !_camps.some(k => k.id === _indFiltro.campanha)) _indFiltro.campanha = ''
  _indDados = await rpc('socio_indicadores', {
    p_instrumento: _sel, p_campanha: _indFiltro.campanha || null,
    p_cd_mun: _indFiltro.cd_mun || null, p_uc: _indFiltro.uc || null,
  })
  const d = _indDados || {}
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel === v ? ' selected' : ''}>${esc(t)}</option>`
  const filtros = `<div class="filter-bar soc-filtros">
      <label class="soc-filtro"><span>Campanha</span><select class="form-control" id="in-camp" onchange="indFiltrar()">
        ${opt('', 'Todas', _indFiltro.campanha)}${_camps.map(k => opt(k.id, k.nome, _indFiltro.campanha)).join('')}</select></label>
      <label class="soc-filtro"><span>Município</span><select class="form-control" id="in-mun" onchange="indFiltrar()">
        ${opt('', 'Todos', _indFiltro.cd_mun)}${(_terr.municipios || []).map(m => opt(m.cd_ibge, m.nome, _indFiltro.cd_mun)).join('')}</select></label>
      <label class="soc-filtro"><span>Unidade de conservação</span><select class="form-control" id="in-uc" onchange="indFiltrar()">
        ${opt('', 'Todas', _indFiltro.uc)}${(_terr.ucs || []).map(u => opt(u.id, u.nome, _indFiltro.uc)).join('')}</select></label>
    </div>`
  const kpi = (n, r, sub) => `<div class="soc-kpi"><div class="soc-kpi-num">${_indFmt(n, 0)}</div><div class="soc-kpi-rot">${esc(r)}</div>${sub ? `<div class="soc-sub">${esc(sub)}</div>` : ''}</div>`
  const kpis = `<div class="soc-kpis">${kpi(d.n_fichas, 'fichas validadas', 'entram nos números')}
    ${kpi(d.n_recusas, 'recusaram a entrevista')}${kpi(d.n_aguardando, 'aguardando validação', 'ainda fora dos números')}</div>`
  const muns = (d.por_municipio || []).length && !_indFiltro.cd_mun
    ? `<div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title">Fichas por município</div></div>
        <div class="soc-corpo">${_indGrafico('Fichas por município', d.por_municipio.map(m => ({ r: m.nome, n: m.n })), d.n_fichas)}
        <p class="soc-sub">Município com menos de ${d.minimo} fichas entra em "Outros municípios" (e some se mesmo assim não chegar a ${d.minimo}).</p></div></div>` : ''
  let corpo
  if (d.suprimido) {
    corpo = `<div class="soc-aviso">${bico('shield')}<div><strong>Menos de ${d.minimo} fichas validadas neste recorte.</strong>
      Os números por pergunta ficam ocultos para que ninguém seja identificado pelas respostas. Amplie o recorte (outra campanha, todos os municípios) ou valide mais fichas.</div></div>`
  } else {
    const blocos = []
    ;(d.perguntas || []).forEach(p => {
      let b = blocos.find(x => x.titulo === p.bloco)
      if (!b) { b = { titulo: p.bloco, itens: [] }; blocos.push(b) }
      b.itens.push(p)
    })
    corpo = blocos.map(b => `<section class="soc-ind-bloco"><h3 class="soc-ind-bloco-tit">${esc(b.titulo)}</h3>
        <div class="soc-ind-grade">${b.itens.map(_indPerguntaHTML).join('')}</div></section>`).join('')
    if (d.lista) {
      corpo += `<section class="soc-ind-bloco"><h3 class="soc-ind-bloco-tit">${esc(d.lista.titulo)} <span class="soc-sub">(${d.lista.n_linhas} linhas)</span></h3>
        <div class="soc-ind-grade">${d.lista.colunas.map(col => `<article class="soc-ind-perg"><div class="soc-ind-cab"><span class="soc-tit">${esc(col.rotulo)}</span></div>
          ${col.opcoes ? _indGrafico(col.rotulo, col.opcoes, d.lista.n_linhas) : _indEstatHTML(col.estat)}</article>`).join('')}</div>
        <p class="soc-sub">Colunas de identificação e de texto livre da lista não entram nos indicadores.</p></section>`
    }
  }
  const podeExp = c.pode_ler_fichas || c.pode_gerir
  const exp = podeExp ? `<div class="card" style="margin-top:16px"><div class="card-header"><div class="card-title">Exportar fichas validadas</div></div>
      <div class="soc-corpo"><p class="soc-intro" style="margin:0 0 12px">Planilha com uma linha por ficha validada${_indFiltro.campanha ? ' da campanha escolhida acima' : ''}.
        ${c.pode_gerir ? 'Sem identificação por padrão; marque abaixo só se precisar do nome e da localização.' : 'Sai sem identificação e sem as respostas em texto livre, que podem trazer nomes.'}
        Toda exportação fica registrada com o seu nome e a data.</p>
      <div class="soc-acoes" style="justify-content:flex-start">
        ${c.pode_gerir ? '<label class="soc-papel"><input type="checkbox" id="in-ident"><span>Incluir identificação (nome do entrevistado e localização)</span></label>' : ''}
        <button class="btn btn-primary" type="button" id="in-exportar" onclick="indExportar()">${bico('download')} Exportar planilha</button></div></div></div>` : ''
  return `<p class="soc-intro">Números das fichas <strong>validadas</strong>, sem treino. Abaixo de ${d.minimo || 5} fichas no recorte,
      só a contagem aparece. Versão de referência das perguntas: v${esc(d.versao_referencia ?? '—')}.</p>` + filtros + kpis + muns + corpo + exp
}

function indFiltrar() {
  _indFiltro = {
    campanha: document.getElementById('in-camp').value,
    cd_mun: document.getElementById('in-mun').value,
    uc: document.getElementById('in-uc').value,
  }
  return renderSub()
}

// ── exportação ──
let _indLibPromise = null
function _indCarregarExcel() {
  if (window.ExcelJS) return Promise.resolve()
  if (_indLibPromise) return _indLibPromise
  _indLibPromise = new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = '../js/vendor/exceljs-4.4.0.bare.min.js'
    s.onload = res
    s.onerror = () => { _indLibPromise = null; rej(new Error('Não foi possível carregar a biblioteca da planilha.')) }
    document.head.appendChild(s)
  })
  return _indLibPromise
}

// valor de uma resposta como texto de planilha (rótulo da opção, nunca o código)
function indValorCelula(p, v) {
  if (v === undefined || v === null) return ''
  if (v === '_nr') return 'Não respondeu'
  const rot = x => { const o = (p.opcoes || []).find(y => y.v === x); return o ? o.r : x }
  if (Array.isArray(v)) return v.map(rot).join('; ')
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  return p.opcoes ? rot(v) : v
}

// colunas da aba Fichas a partir da estrutura (pergunta de texto livre
// fica de fora quando o banco a omitiu — o leitor não recebe)
function indColunasFichas(dados) {
  const omit = new Set(dados.colunas_omitidas || [])
  const fixas = [['codigo', 'Código'], ['campanha', 'Campanha'], ['versao', 'Versão'], ['dt_entrevista', 'Data da entrevista'],
    ['municipio', 'Município'], ['uc', 'UC'], ['comunidade', 'Comunidade']]
  if ((dados.fichas || []).some(f => f.entrevistador)) fixas.push(['entrevistador', 'Entrevistador'])
  fixas.push(['aceitou_participar', 'Aceitou participar'], ['validado_em', 'Validada em'])
  if (dados.identificada) fixas.push(['entrevistado_nome', 'Entrevistado'], ['lat', 'Latitude'], ['lon', 'Longitude'])
  const cols = fixas.map(([k, r]) => ({ cab: r, valor: f => k === 'aceitou_participar' ? (f[k] ? 'Sim' : 'Não') : (f[k] ?? '') }))
  ;((dados.estrutura || {}).blocos || []).forEach(b => (b.perguntas || []).forEach(p => {
    if (p.tipo === 'tabela' || omit.has(p.chave)) return
    const num = p.rotulo || p.n
    cols.push({ cab: `P${num} ${p.texto}`, valor: f => indValorCelula(p, (f.respostas || {})[p.chave]) })
    if (!dados.sem_texto && (p.opcoes || []).some(o => o.v === 'outro'))
      cols.push({ cab: `P${num} (outro, qual)`, valor: f => (f.respostas || {})[p.chave + '_outro'] || '' })
  }))
  return cols
}

async function indExportar() {
  const c = catPorId(_sel)
  const ident = !!(document.getElementById('in-ident') || {}).checked
  const ok = await confirmar({
    titulo: 'Exportar fichas', ok: 'Exportar', perigo: ident,
    texto: ident ? 'A planilha vai ter <strong>nome e localização</strong> dos entrevistados. Guarde em local restrito e não envie por e-mail aberto. A exportação fica registrada com o seu nome.'
      : 'A exportação fica registrada com o seu nome e a data.',
  })
  if (!ok) return
  const pronto = btnEspera(document.getElementById('in-exportar'))
  try {
    const [dados] = await Promise.all([
      rpc('socio_exportar', { p_instrumento: _sel, p_campanha: _indFiltro.campanha || null, p_identificada: ident }),
      _indCarregarExcel(),
    ])
    if (!dados.n_fichas) { toast('Nenhuma ficha validada para exportar neste recorte.', 'warning'); return }
    const wb = new window.ExcelJS.Workbook()
    wb.creator = 'SIGUC-AC'
    const cabecalho = ws => {
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A4F' } }
      ws.views = [{ state: 'frozen', ySplit: 1 }]
    }
    const cols = indColunasFichas(dados)
    const ws = wb.addWorksheet('Fichas')
    ws.addRow(cols.map(x => x.cab))
    dados.fichas.forEach(f => ws.addRow(cols.map(x => x.valor(f))))
    cols.forEach((_, i) => { ws.getColumn(i + 1).width = i < 10 ? 18 : 28 })
    cabecalho(ws)

    const lista = (dados.estrutura || {}).lista
    if (lista && (dados.linhas || []).length) {
      const omit = new Set(dados.colunas_omitidas || [])
      const lc = (lista.colunas || []).filter(col => !omit.has(col.chave) && (dados.identificada || !col.identificacao))
      const wl = wb.addWorksheet(String(lista.titulo || 'Lista').slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))
      wl.addRow(['Código da ficha', 'Linha', ...(lista.marca_entrevistado ? ['É o entrevistado'] : []), ...lc.map(col => col.rotulo || col.chave)])
      dados.linhas.forEach(l => wl.addRow([l.codigo, l.ordem, ...(lista.marca_entrevistado ? [l.e_entrevistado ? 'Sim' : ''] : []),
        ...lc.map(col => indValorCelula(col, l[col.chave]))]))
      cabecalho(wl)
    }

    const camp = _camps.find(k => k.id === _indFiltro.campanha)
    const wsob = wb.addWorksheet('Sobre')
    ;[['Questionário', `${c.codigo} — ${c.titulo}`], ['Departamento', `${c.departamento_sigla} — ${c.departamento_nome}`],
      ['Campanha', camp ? camp.nome : 'Todas'], ['Fichas', dados.n_fichas], ['Gerado em', fmtMomento(dados.gerado_em)],
      ['Registro da exportação', dados.exportacao_id],
      ['Identificação', dados.identificada ? 'INCLUÍDA — guardar em local restrito' : 'Não incluída'],
      ['Texto livre', dados.sem_texto ? 'Não incluído (acesso de leitura)' : 'Incluído'],
      ['Só entram', 'Fichas validadas, fora do treino'],
      ['"Não respondeu"', 'a pessoa preferiu não responder; célula vazia = a pergunta não se aplicava ou ficou em branco'],
    ].forEach(r => wsob.addRow(r))
    wsob.getColumn(1).width = 24; wsob.getColumn(2).width = 80; wsob.getColumn(1).font = { bold: true }

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${c.codigo}_fichas${camp ? '_' + camp.nome.replace(/[^\w-]+/g, '_').slice(0, 40) : ''}${dados.identificada ? '_IDENTIFICADA' : ''}.xlsx`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    toast(`Planilha com ${dados.n_fichas} fichas gerada.`, 'success')
  } catch (e) { toast(msgErro(e), 'error') } finally { pronto() }
}
