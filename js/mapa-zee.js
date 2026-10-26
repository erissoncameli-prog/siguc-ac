// ── SIGUC — ZEE do Acre no Mapa das UCs ──────────────────────────────
// Plano em docs/mapa-ucs/plano-zee.md. Fonte única (prefixo `zee`); a página
// só chama zeeMontar / zeePainelHTML / zeeLigarPainel / zeeItensLegenda.
//
// Dados:
// - data/zee/manifesto.json + data/zee/<camada>.geojson, gerados SÓ por
//   scripts/zee_acre.py (workflow .github/workflows/zee-acre.yml). Sem
//   manifesto = o arquivo vetorial ainda não chegou: o painel DIZ isso e
//   continua oferecendo os documentos — nunca fica em branco.
// - data/zee/documentos.json: lista de documentos para baixar (links
//   públicos; documento novo = uma linha no JSON, sem código).
//
// Regras:
// - Fase II e Fase III nunca ao mesmo tempo no mapa: as zonas têm a mesma
//   cor e os polígonos se sobrepõem — juntas, não se lê nenhuma das duas.
// - Situação legal SEMPRE escrita (painel e popup): só a Fase II tem lei
//   (nº 1.904/2007). A Fase III é subsídio aprovado pelo CEMAF.
// - Escala regional (1:250 mil): o popup diz que não substitui a análise do
//   imóvel.
// - Pane própria acima do Meio Físico e abaixo das camadas vetoriais (UC,
//   TI, CAR por cima — a Zona 2 coincide com UCs e TIs, e o contorno delas
//   é o que o usuário precisa ler).
// - Cor por ZONA em Okabe-Ito (legível em daltonismo); subzona = tons da cor
//   da zona dela, nunca uma paleta solta.
// - Popup reaproveita js/mapa-camadas-config.js (ccfPopupHTML).

const ZEE_BASE = (typeof ZEE_DATA_URL !== 'undefined' ? ZEE_DATA_URL : '../data/zee/')
const ZEE_PANE = 'zeePane'

const ZEE_CAMADAS = {
  fase2_gestao: {
    rotulo: 'Fase II — Mapa de Gestão Territorial', curto: 'ZEE Fase II',
    situacao: 'Em vigor — Lei Estadual nº 1.904, de 5/6/2007', vigente: true, escala: '1:250.000',
  },
  fase3_gestao: {
    rotulo: 'Fase III — Mapa de Subsídio à Gestão Territorial e Ambiental', curto: 'ZEE Fase III',
    situacao: 'Aprovado pelo CEMAF, sem lei estadual que o institua — use como subsídio', vigente: false, escala: null,
  },
}

// Camadas COMPLEMENTARES: ligam junto com qualquer fase (não são zoneamento,
// são a base que o ZEE usou). Cada uma com a sua chave liga/desliga.
// Base fundiária da Fase III: gerada por `zee_acre.py --fundiario`, SÓ com
// campos públicos (sem proprietário, matrícula, certificação, código SIGEF;
// no imóvel rural nem o nome) — a regra mora no script, a tela só lê.
const ZEE_COMPLEMENTARES = {
  fase3_fundiario: {
    rotulo: 'Base fundiária do ZEE Fase III', curto: 'Fundiário ZEE III',
    nota: 'Situação fundiária que o ZEE Fase III usou (INCRA, ITERACRE, SIGEF/SNCI, FUNAI, ICMBio, IMAC). Camadas sobrepostas; imóvel rural sem nome nem titular.',
    campoCor: 'tipo', campoRotulo: 'tipo_rotulo',
    cores: { ASSENTAMENTO: '#D55E00', GLEBEST: '#56B4E9', GLEBFED: '#0072B2', IRU: '#E69F00', TI: '#CC79A7', UCPI: '#009E73', UCUS: '#8C6D1F' },
    popup: {
      titulo: '_titulo',
      campos: [
        { campo: 'tipo_rotulo', rotulo: 'Tipo' },
        { campo: 'subtipo', rotulo: 'Subtipo' },
        { campo: 'orgao', rotulo: 'Órgão' },
        { campo: 'fonte', rotulo: 'Fonte' },
        { campo: 'situacao', rotulo: 'Situação' },
        { campo: 'sobreposicao', rotulo: 'Sobreposição' },
        { campo: 'zona', rotulo: 'Zona (ZEE III)' },
        { campo: 'subzona', rotulo: 'Subzona (ZEE III)' },
        { campo: 'area_ha', rotulo: 'Área do desenho', sufixo: ' ha', casas: 1 },
      ],
    },
  },
}
const ZEE_COMP_PANE = 'zeeCompPane'

// Okabe-Ito: produção laranja · proteção verde-azulado · ordenamento rosa ·
// cidades azul. Os nomes das zonas vêm do arquivo (scripts/zee_acre.py).
const ZEE_ZONA_COR = { 1: '#E69F00', 2: '#009E73', 3: '#CC79A7', 4: '#0072B2' }
const ZEE_COR_SEM = '#9CA3AF'

const _zee = { mapa: null, aoMudar: null, manifesto: undefined, docs: undefined, cache: {}, ativa: null, layer: null, pref: {}, comp: {} }

function _zeeEsc(s) { return typeof ccfEsc === 'function' ? ccfEsc(s) : String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function _zeeIcone(n) { return typeof bico === 'function' ? bico(n) : '' }

function _zeePrefCarregar() {
  try { _zee.pref = JSON.parse(localStorage.getItem('siguc_zee') || '{}') || {} } catch (_) { _zee.pref = {} }
  if (!ZEE_CAMADAS[_zee.pref.ativa]) _zee.pref.ativa = null
  if (_zee.pref.colorir !== 'subzona') _zee.pref.colorir = 'zona'
  if (typeof _zee.pref.opacidade !== 'number') _zee.pref.opacidade = 0.4
  _zee.pref.comp = Array.isArray(_zee.pref.comp) ? _zee.pref.comp.filter(id => ZEE_COMPLEMENTARES[id]) : []
}
function _zeePrefSalvar() {
  try { localStorage.setItem('siguc_zee', JSON.stringify({ ativa: _zee.ativa, colorir: _zee.pref.colorir, opacidade: _zee.pref.opacidade, comp: Object.keys(_zee.comp) })) } catch (_) {}
}

function zeeMontar(mapa, opts = {}) {
  if (!mapa || typeof L === 'undefined' || _zee.mapa === mapa) return
  _zee.mapa = mapa
  _zee.aoMudar = opts.aoMudar || null
  if (!mapa.getPane(ZEE_PANE)) {
    mapa.createPane(ZEE_PANE)
    mapa.getPane(ZEE_PANE).style.zIndex = 360 // meio físico 350 < aqui < overlayPane 400
  }
  if (!mapa.getPane(ZEE_COMP_PANE)) {
    mapa.createPane(ZEE_COMP_PANE)
    mapa.getPane(ZEE_COMP_PANE).style.zIndex = 365 // por cima das zonas, abaixo de UC/TI/CAR
  }
  _zeePrefCarregar()
  if (_zee.pref.ativa) zeeAlternar(_zee.pref.ativa, true)
  _zee.pref.comp.forEach(id => zeeComplementar(id, true))
}

// undefined = ainda não perguntou; null = não há manifesto (dado não chegou)
async function zeeManifesto() {
  if (_zee.manifesto !== undefined) return _zee.manifesto
  try {
    const r = await fetch(ZEE_BASE + 'manifesto.json', { cache: 'no-cache' })
    _zee.manifesto = r.ok ? ((await r.json()).camadas || {}) : null
  } catch (_) { _zee.manifesto = null }
  return _zee.manifesto
}

async function zeeDocumentos() {
  if (_zee.docs !== undefined) return _zee.docs
  try {
    const r = await fetch(ZEE_BASE + 'documentos.json')
    const j = r.ok ? await r.json() : null
    _zee.docs = j ? { acervo: j.acervo || null, grupos: (j.grupos || []).filter(g => (g.documentos || []).length) } : null
  } catch (_) { _zee.docs = null }
  return _zee.docs
}

function zeeDisponivel(id) { return !!(_zee.manifesto && _zee.manifesto[id]) }

function _zeeEscala(id) {
  const e = (_zee.manifesto && _zee.manifesto[id] && _zee.manifesto[id].escala) || ZEE_CAMADAS[id].escala
  return e ? `escala ${e}` : 'escala não informada pela fonte'
}

// Tom da cor da zona: i-ésima subzona de n, do mais escuro ao mais claro.
function _zeeTom(hex, i, n) {
  if (n <= 1) return hex
  const t = -0.35 + 0.7 * (i / (n - 1)) // −35% (escurece) … +35% (clareia)
  const c = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16))
  const m = c.map(v => Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t))
  return '#' + m.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// Mapa subzona → cor, a partir das subzonas que existem no arquivo.
function _zeeCoresSubzona(gj) {
  const porZona = {}
  for (const f of gj.features || []) {
    const p = f.properties || {}
    if (!p.subzona) continue
    ;(porZona[p.zona_cod] = porZona[p.zona_cod] || new Set()).add(p.subzona)
  }
  const out = {}
  Object.entries(porZona).forEach(([z, set]) => {
    const subs = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    subs.forEach((s, i) => { out[s] = _zeeTom(ZEE_ZONA_COR[z] || ZEE_COR_SEM, i, subs.length) })
  })
  return out
}

function zeeCor(props, coresSub) {
  const p = props || {}
  if (_zee.pref.colorir === 'subzona' && p.subzona && coresSub && coresSub[p.subzona]) return coresSub[p.subzona]
  return ZEE_ZONA_COR[p.zona_cod] || ZEE_COR_SEM
}

function _zeeRotuloSubzona(p) {
  if (p.unidade) return `Unidade de manejo ${p.unidade}${(p.unidade_nome || p.subzona_nome) ? ' — ' + (p.unidade_nome || p.subzona_nome) : ''}`
  if (p.subzona) return `Subzona ${p.subzona}${p.subzona_nome ? ' — ' + p.subzona_nome : ''}`
  return p.zona || 'Zona não informada'
}

async function _zeeCarregar(id) {
  if (_zee.cache[id]) return _zee.cache[id]
  const arq = (_zee.manifesto && _zee.manifesto[id] && _zee.manifesto[id].arquivo) || (id + '.geojson')
  const r = await fetch(ZEE_BASE + arq)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const gj = await r.json()
  ;(gj.features || []).forEach(f => { f.properties = f.properties || {}; f.properties._titulo = _zeeRotuloSubzona(f.properties) })
  _zee.cache[id] = { gj, coresSub: _zeeCoresSubzona(gj) }
  return _zee.cache[id]
}

const _ZEE_POPUP = {
  titulo: '_titulo',
  campos: [
    { campo: 'zona', rotulo: 'Zona' },
    { campo: 'subzona', rotulo: 'Subzona' },
    { campo: 'subzona_nome', rotulo: 'Nome da subzona' },
    { campo: 'unidade', rotulo: 'Unidade de manejo' },
    { campo: 'unidade_nome', rotulo: 'Indicação da unidade' },
    { campo: 'diretriz', rotulo: 'Diretriz de uso' },
  ],
}

function zeePopupHTML(id, feature) {
  const cfg = ZEE_CAMADAS[id]
  const reg = _zee.cache[id]
  const c = { id: 'zee-' + id, nome: cfg.curto, cor: zeeCor(feature.properties, reg && reg.coresSub), geojson: null, style_config: { popup: _ZEE_POPUP } }
  const corpo = typeof ccfPopupHTML === 'function'
    ? ccfPopupHTML(c, feature, {})
    : `<div class="camada-popup"><div class="cp-layer-nome">${_zeeEsc(feature.properties._titulo)}</div></div>`
  const man = (_zee.manifesto && _zee.manifesto[id]) || {}
  return corpo + `<div class="zee-fonte">
    <div class="zee-sit ${cfg.vigente ? 'zee-vigente' : 'zee-subsidio'}">${_zeeEsc(cfg.situacao)}</div>
    ${_zeeEsc(man.fonte || 'SEMA-AC — Zoneamento Ecológico-Econômico')} · ${_zeeEsc(_zeeEscala(id))}.
    Zoneamento regional — não substitui a análise do imóvel.</div>`
}

function _zeeDesenhar() {
  if (_zee.layer) { _zee.mapa.removeLayer(_zee.layer); _zee.layer = null }
  const id = _zee.ativa
  const reg = id && _zee.cache[id]
  if (!reg) return
  const op = _zee.pref.opacidade
  _zee.layer = L.geoJSON(reg.gj, {
    pane: ZEE_PANE,
    style: f => { const cor = zeeCor(f.properties, reg.coresSub); return { color: cor, weight: 0.8, opacity: 0.95, fillColor: cor, fillOpacity: op } },
    onEachFeature: (f, layer) => layer.bindPopup(() => zeePopupHTML(id, f), { className: 'camada-popup-wrap', maxWidth: 380 }),
  }).addTo(_zee.mapa)
}

// Liga uma camada (desliga a outra fase) ou desliga.
async function zeeAlternar(id, ligar) {
  if (!ZEE_CAMADAS[id] || !_zee.mapa) return
  if (!ligar) {
    if (_zee.ativa === id) { _zee.ativa = null; _zeeDesenhar() }
    _zeeStatus(id, ''); _zeePrefSalvar(); _zeeSincPainel(); _zee.aoMudar && _zee.aoMudar()
    return
  }
  const anterior = _zee.ativa
  _zee.ativa = id
  if (anterior && anterior !== id) { _zeeStatus(anterior, ''); _zeeDesenhar() }
  _zeeSincPainel()
  _zeeStatus(id, 'Carregando…')
  await zeeManifesto()
  try {
    if (!zeeDisponivel(id)) throw new Error('sem-dado')
    const reg = await _zeeCarregar(id)
    if (_zee.ativa !== id) return // trocou ou desligou enquanto baixava
    _zeeDesenhar()
    _zeeStatus(id, `${(reg.gj.features || []).length.toLocaleString('pt-BR')} polígonos`)
  } catch (e) {
    if (_zee.ativa === id) _zee.ativa = null
    _zeeStatus(id, e.message === 'sem-dado' ? 'Arquivo ainda não recebido.' : 'Não foi possível carregar o arquivo.', true)
    _zeeSincPainel()
  }
  _zeePrefSalvar(); _zee.aoMudar && _zee.aoMudar()
}

function zeeColorirPor(modo) {
  _zee.pref.colorir = modo === 'subzona' ? 'subzona' : 'zona'
  _zeeDesenhar(); _zeePrefSalvar(); _zee.aoMudar && _zee.aoMudar()
}

function zeeDefinirOpacidade(v) {
  _zee.pref.opacidade = v
  if (_zee.layer) _zee.layer.setStyle({ fillOpacity: v })
  _zeePrefSalvar()
}

function zeeAtiva() { return _zee.ativa && _zee.layer ? _zee.ativa : null }

// ── camadas complementares (ex.: base fundiária) ──
function _zeeCompCor(id, p) {
  const cfg = ZEE_COMPLEMENTARES[id]
  return cfg.cores[(p || {})[cfg.campoCor]] || ZEE_COR_SEM
}

function zeeCompPopupHTML(id, feature) {
  const cfg = ZEE_COMPLEMENTARES[id]
  const c = { id: 'zee-' + id, nome: cfg.curto, cor: _zeeCompCor(id, feature.properties), geojson: null, style_config: { popup: cfg.popup } }
  const corpo = typeof ccfPopupHTML === 'function'
    ? ccfPopupHTML(c, feature, {})
    : `<div class="camada-popup"><div class="cp-layer-nome">${_zeeEsc(feature.properties._titulo)}</div></div>`
  const man = (_zee.manifesto && _zee.manifesto[id]) || {}
  return corpo + `<div class="zee-fonte">${_zeeEsc(man.fonte || cfg.rotulo)}.
    ${feature.properties.tipo === 'IRU' ? 'Imóvel rural: nome e titular não são exibidos. ' : ''}Não substitui certidão, matrícula ou registro.</div>`
}

async function zeeComplementar(id, ligar) {
  const cfg = ZEE_COMPLEMENTARES[id]
  if (!cfg || !_zee.mapa) return
  if (!ligar) {
    if (_zee.comp[id]) { _zee.mapa.removeLayer(_zee.comp[id]); delete _zee.comp[id] }
    _zeeStatus(id, ''); _zeePrefSalvar(); _zeeSincPainel(); _zee.aoMudar && _zee.aoMudar()
    return
  }
  if (_zee.comp[id]) return
  _zeeStatus(id, 'Carregando…')
  await zeeManifesto()
  try {
    if (!zeeDisponivel(id)) throw new Error('sem-dado')
    if (!_zee.cache[id]) {
      const arq = _zee.manifesto[id].arquivo || (id + '.geojson')
      const r = await fetch(ZEE_BASE + arq)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const gj = await r.json()
      ;(gj.features || []).forEach(f => { const p = f.properties = f.properties || {}; p._titulo = p.nome || p[cfg.campoRotulo] || cfg.curto })
      _zee.cache[id] = { gj }
    }
    const gj = _zee.cache[id].gj
    _zee.comp[id] = L.geoJSON(gj, {
      pane: ZEE_COMP_PANE,
      style: f => { const cor = _zeeCompCor(id, f.properties); return { color: cor, weight: 1.2, opacity: 0.95, fillColor: cor, fillOpacity: 0.12 } },
      onEachFeature: (f, layer) => layer.bindPopup(() => zeeCompPopupHTML(id, f), { className: 'camada-popup-wrap', maxWidth: 380 }),
    }).addTo(_zee.mapa)
    _zeeStatus(id, `${(gj.features || []).length.toLocaleString('pt-BR')} polígonos`)
  } catch (e) {
    _zeeStatus(id, e.message === 'sem-dado' ? 'Arquivo ainda não recebido.' : 'Não foi possível carregar o arquivo.', true)
  }
  _zeePrefSalvar(); _zeeSincPainel(); _zee.aoMudar && _zee.aoMudar()
}

function zeeComplementaresAtivas() { return Object.keys(_zee.comp) }

// Legenda (tela e impressão): por zona, ou por subzona (sem teto: cada
// subzona tem a sua cor — "outros" esconderia a que o usuário procura).
function zeeItensLegenda() {
  return _zeeItensLegendaFase().concat(_zeeItensLegendaComp())
}

function _zeeItensLegendaComp() {
  const out = []
  Object.keys(_zee.comp).forEach(id => {
    const cfg = ZEE_COMPLEMENTARES[id], reg = _zee.cache[id]
    if (!reg) return
    const tipos = new Map()
    ;(reg.gj.features || []).forEach(f => { const p = f.properties; if (!tipos.has(p[cfg.campoCor])) tipos.set(p[cfg.campoCor], p[cfg.campoRotulo]) })
    Object.keys(cfg.cores).filter(t => tipos.has(t)).forEach(t => out.push({ simbolo: 'rect', cor: cfg.cores[t], opacidade: 0.12, label: `${cfg.curto} — ${tipos.get(t) || t}` }))
  })
  return out
}

function _zeeItensLegendaFase() {
  const id = zeeAtiva(); if (!id) return []
  const reg = _zee.cache[id], op = _zee.pref.opacidade, nome = ZEE_CAMADAS[id].curto
  const feats = reg.gj.features || []
  if (_zee.pref.colorir === 'subzona') {
    const vistos = new Map()
    feats.forEach(f => { const p = f.properties; if (p.subzona && !vistos.has(p.subzona)) vistos.set(p.subzona, p.subzona_nome) })
    const subs = [...vistos.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    if (subs.length) return subs.map(s => ({ simbolo: 'rect', cor: reg.coresSub[s], opacidade: op, label: `${nome} — Subzona ${s}${vistos.get(s) ? ' (' + vistos.get(s) + ')' : ''}` }))
  }
  const zonas = new Map()
  feats.forEach(f => { const p = f.properties; if (!zonas.has(p.zona_cod)) zonas.set(p.zona_cod, p.zona) })
  return [...zonas.keys()].sort().map(z => ({ simbolo: 'rect', cor: ZEE_ZONA_COR[z] || ZEE_COR_SEM, opacidade: op, label: `${nome} — ${zonas.get(z) || 'Zona ' + z}` }))
}

function _zeeStatus(id, txt, erro) {
  const el = document.querySelector(`[data-zee-camada="${id}"] .zee-status, [data-zee-comp="${id}"] .zee-status`)
  if (el) { el.textContent = txt; el.classList.toggle('zee-erro', !!erro) }
}

function _zeeSincPainel() {
  document.querySelectorAll('[data-zee-camada]').forEach(box => {
    const chk = box.querySelector('[data-zee-acao="ligar"]')
    if (chk) chk.checked = box.dataset.zeeCamada === _zee.ativa
  })
  document.querySelectorAll('[data-zee-comp]').forEach(box => {
    const chk = box.querySelector('[data-zee-acao="comp"]')
    if (chk) chk.checked = !!_zee.comp[box.dataset.zeeComp]
  })
}

function _zeeCamadasHTML() {
  const semDado = _zee.manifesto === null || (_zee.manifesto && !Object.keys(_zee.manifesto).length)
  const html = Object.entries(ZEE_CAMADAS).map(([id, t]) => {
    const disp = zeeDisponivel(id)
    const man = (_zee.manifesto && _zee.manifesto[id]) || {}
    const reg = _zee.cache[id]
    const status = _zee.manifesto === undefined ? 'Verificando…'
      : !disp ? 'Arquivo ainda não recebido.'
        : (_zee.ativa === id && reg ? `${reg.gj.features.length.toLocaleString('pt-BR')} polígonos` : '')
    return `<div class="zee-camada${disp ? '' : ' zee-indisp'}" data-zee-camada="${id}">
      <label class="zee-cab"><input type="checkbox" data-zee-acao="ligar"${_zee.ativa === id ? ' checked' : ''}${disp ? '' : ' disabled'}>
        <span class="zee-nome">${_zeeEsc(t.rotulo)}</span>
        <span class="zee-status${!disp && _zee.manifesto !== undefined ? ' zee-erro' : ''}" role="status" aria-live="polite">${_zeeEsc(status)}</span></label>
      <div class="zee-sit ${t.vigente ? 'zee-vigente' : 'zee-subsidio'}">${_zeeEsc(t.situacao)}</div>
      <div class="zee-meta">${_zeeEsc(_zeeEscala(id))}${man.gerado_em ? ' · arquivo de ' + _zeeEsc(man.gerado_em.split('-').reverse().join('/')) : ''}</div>
    </div>`
  }).join('')
  const aviso = semDado ? `<div class="zee-aviso" role="note">O arquivo vetorial do Mapa de Gestão ainda não foi recebido da SEMA.
    Enquanto isso, os documentos do ZEE estão disponíveis abaixo para consulta e download.</div>` : ''
  // O arquivo da Fase II recebido em 26/10/2026 só tem as 4 zonas: sem
  // subzona no manifesto, "Colorir por subzona" seria uma opção que não faz nada.
  const temSub = Object.values(_zee.manifesto || {}).some(m => m.subzonas > 0)
  const ctrl = `<div class="zee-ctrl">
    ${temSub ? `<label>Colorir por <select data-zee-acao="colorir">
      <option value="zona"${_zee.pref.colorir === 'zona' ? ' selected' : ''}>Zona</option>
      <option value="subzona"${_zee.pref.colorir === 'subzona' ? ' selected' : ''}>Subzona</option></select></label>` : ''}
    <label>Opacidade <input type="range" min="0" max="100" step="5" value="${Math.round(_zee.pref.opacidade * 100)}" data-zee-acao="opacidade" aria-label="Opacidade do ZEE"></label>
  </div>`
  const comp = Object.entries(ZEE_COMPLEMENTARES).filter(([id]) => zeeDisponivel(id)).map(([id, t]) => {
    const reg = _zee.cache[id]
    const status = _zee.comp[id] && reg ? `${reg.gj.features.length.toLocaleString('pt-BR')} polígonos` : ''
    return `<div class="zee-camada" data-zee-comp="${id}">
      <label class="zee-cab"><input type="checkbox" data-zee-acao="comp"${_zee.comp[id] ? ' checked' : ''}>
        <span class="zee-nome">${_zeeEsc(t.rotulo)}</span>
        <span class="zee-status" role="status" aria-live="polite">${_zeeEsc(status)}</span></label>
      <div class="zee-meta">${_zeeEsc(t.nota)}</div>
    </div>`
  }).join('')
  return aviso + html + (semDado || _zee.manifesto === undefined ? '' : ctrl) +
    (comp ? `<div class="zee-sec-tit">Camadas complementares</div>${comp}` : '')
}

const _ZEE_DOC_ICONE = { pasta: 'paperclip', pdf: 'download', lei: 'file-text', pagina: 'file-text' }

function _zeeDocHTML(d) {
  return `<li><a href="${_zeeEsc(d.url)}" target="_blank" rel="noopener noreferrer" class="zee-doc">
      <span class="zee-doc-ico">${_zeeIcone(_ZEE_DOC_ICONE[d.tipo] || 'file-text')}</span>
      <span class="zee-doc-txt"><strong>${_zeeEsc(d.titulo)}</strong>
        ${d.descricao ? `<span>${_zeeEsc(d.descricao)}</span>` : ''}</span></a></li>`
}

// Acervo (pasta inteira) no topo; grupos recolhidos, com contagem — são
// ~70 documentos, e uma lista corrida empurraria as camadas para fora.
function _zeeDocsHTML() {
  if (_zee.docs === undefined) return '<div class="zee-meta">Carregando documentos…</div>'
  if (!_zee.docs) return '<div class="zee-meta zee-erro">Não foi possível carregar a lista de documentos.</div>'
  const { acervo, grupos } = _zee.docs
  return (acervo ? `<ul class="zee-docs">${_zeeDocHTML(acervo)}</ul>` : '') +
    grupos.map(g => `<details class="zee-grupo"><summary>${_zeeEsc(g.titulo)} <span class="zee-grupo-n">${g.documentos.length}</span></summary>
      <ul class="zee-docs">${g.documentos.map(_zeeDocHTML).join('')}</ul></details>`).join('') +
    '<div class="zee-meta">Os arquivos abrem no site oficial da SEMA (ou na pasta da SEMA no Drive), em nova aba.</div>'
}

// Corpo da aba "ZEE" da barra de camadas. Desenha o que já se sabe e
// zeeLigarPainel completa (manifesto e documentos chegam por fetch).
function zeePainelHTML() {
  return `<div class="zee-sec" id="zee-camadas">${_zeeCamadasHTML()}</div>
    <div class="zee-sec-tit">Documentos do ZEE</div>
    <div class="zee-sec" id="zee-docs">${_zeeDocsHTML()}</div>
    <div class="zee-nota">Zoneamento Ecológico-Econômico do Estado do Acre (SEMA-AC). Zoneamento regional: orienta o
      planejamento, mas não substitui a análise do imóvel nem o licenciamento.</div>`
}

// Delegação no contêiner da aba (o HTML é refeito a cada abertura).
async function zeeLigarPainel(el) {
  if (!el) return
  if (!el._zeeLigado) {
    el._zeeLigado = true
    el.addEventListener('change', ev => {
      const t = ev.target
      if (t.dataset.zeeAcao === 'ligar') zeeAlternar(t.closest('[data-zee-camada]').dataset.zeeCamada, t.checked)
      else if (t.dataset.zeeAcao === 'comp') zeeComplementar(t.closest('[data-zee-comp]').dataset.zeeComp, t.checked)
      else if (t.dataset.zeeAcao === 'colorir') zeeColorirPor(t.value)
    })
    el.addEventListener('input', ev => {
      if (ev.target.dataset.zeeAcao === 'opacidade') zeeDefinirOpacidade(Number(ev.target.value) / 100)
    })
  }
  await Promise.all([zeeManifesto(), zeeDocumentos()])
  const cam = el.querySelector('#zee-camadas'), docs = el.querySelector('#zee-docs')
  if (cam) cam.innerHTML = _zeeCamadasHTML()
  if (docs) docs.innerHTML = _zeeDocsHTML()
}

function zeeEstilos() {
  if (document.getElementById('zee-estilos')) return
  const st = document.createElement('style')
  st.id = 'zee-estilos'
  st.textContent = `
.zee-sec{display:flex;flex-direction:column;gap:8px;}
.zee-sec-tit{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--cinza-600,#4b5563);margin-top:4px;}
.zee-camada{border:1px solid var(--borda,#e5e7eb);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;}
.zee-indisp .zee-nome{color:var(--cinza-500,#6b7280);}
.zee-cab{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;cursor:pointer;min-height:24px;}
.zee-indisp .zee-cab{cursor:default;}
.zee-cab input{width:14px;height:14px;accent-color:#1F4E2C;flex-shrink:0;}
.zee-nome{flex:1;min-width:0;}
.zee-status{font-size:10.5px;font-weight:500;color:var(--cinza-500,#6b7280);text-align:right;}
.zee-erro{color:#B91C1C;}
.zee-sit{font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:4px;align-self:flex-start;}
.zee-vigente{background:#ECFDF5;color:#065F46;}
.zee-subsidio{background:#FFFBEB;color:#92400E;}
.zee-meta,.zee-nota{font-size:10.5px;color:var(--cinza-500,#6b7280);}
.zee-aviso{font-size:11px;line-height:1.45;background:#F8FAFC;border:1px dashed var(--cinza-300,#cbd5e1);border-radius:8px;padding:8px 10px;color:var(--cinza-700,#374151);}
.zee-ctrl{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--cinza-600,#4b5563);}
.zee-ctrl label{display:flex;align-items:center;gap:6px;}
.zee-ctrl select{min-height:26px;font-size:11px;border:1px solid var(--borda,#d1d5db);border-radius:5px;background:#fff;}
.zee-ctrl input[type=range]{width:90px;accent-color:#1F4E2C;}
.zee-docs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;}
.zee-doc{display:flex;gap:8px;align-items:flex-start;padding:7px 9px;border:1px solid var(--borda,#e5e7eb);border-radius:8px;text-decoration:none;color:inherit;min-height:24px;}
.zee-doc:hover{background:#F8FAFC;border-color:var(--cinza-300,#cbd5e1);}
.zee-doc-ico{flex-shrink:0;width:16px;height:16px;margin-top:1px;color:#1F4E2C;}
.zee-doc-ico svg{width:16px;height:16px;}
.zee-doc-txt{display:flex;flex-direction:column;gap:2px;font-size:11px;min-width:0;}
.zee-doc-txt strong{font-size:11.5px;color:var(--cinza-800,#1f2937);}
.zee-doc-txt span{color:var(--cinza-600,#4b5563);}
.zee-grupo{border:1px solid var(--borda,#e5e7eb);border-radius:8px;padding:0 9px;}
.zee-grupo summary{cursor:pointer;font-size:11.5px;font-weight:600;color:var(--cinza-800,#1f2937);min-height:32px;display:flex;align-items:center;gap:6px;}
.zee-grupo[open] summary{border-bottom:1px solid var(--borda,#e5e7eb);margin-bottom:6px;}
.zee-grupo[open] .zee-docs{padding-bottom:8px;}
.zee-grupo-n{font-size:10px;font-weight:600;background:#F1F5F9;color:var(--cinza-600,#4b5563);border-radius:999px;padding:1px 7px;}
.zee-grupo summary:focus-visible{outline:2px solid #C9A84C;outline-offset:1px;border-radius:4px;}
.zee-cab input:focus-visible,.zee-ctrl select:focus-visible,.zee-ctrl input:focus-visible,.zee-doc:focus-visible{outline:2px solid #C9A84C;outline-offset:1px;}
.zee-fonte{font-size:10.5px;color:var(--cinza-500,#6b7280);margin:6px 12px 8px;display:flex;flex-direction:column;gap:4px;}
`
  document.head.appendChild(st)
}
