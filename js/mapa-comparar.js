// ── SIGUC — Comparação de imagens (divisor arrastável) ─────────────
// Duas imagens lado a lado no Mapa das UCs: Planet/NICFI mensal,
// Sentinel-2 (época seca do ano ou cena do dia) e PRODES anual. Fonte
// única (prefixo `cmp`); a página só chama cmpMontar(mapa, opts). Ideia
// vista no jurema-webgis (Cardeal Map) — nenhum código dele.
// Plano: docs/mapa-ucs/plano-medicao-comparacao.md (Fase 2).
//
// Regras que seguram o módulo:
// - As camadas saem das fábricas de js/mapa-camadas.js (mapaPlanetLayer,
//   mapaSentinelLayer, mapaProdesLayer) — nunca uma URL nova aqui.
// - Duas panes próprias ACIMA do tilePane (base + imagens do painel) e
//   ABAIXO das camadas vetoriais: UC, CAR e alertas seguem por cima dos
//   dois lados, que é o que dá sentido a comparar dentro da UC.
// - Recorte com `clip: rect()` na pane, em coordenada de CAMADA: as panes
//   andam com o pan do mapa (transform do map pane), então o retângulo é
//   convertido por containerPointToLayerPoint a cada move/zoom. `clip`
//   (e não clip-path) porque a pane é uma caixa 0×0 — clip-path recorta
//   pela caixa do elemento; clip vale para qualquer elemento absoluto.
// - Decisão do usuário (24/10/2026): camada de imagem ligada no painel
//   NUNCA é mexida. O comparador só AVISA que ela ficou por baixo; o aviso
//   some sozinho quando o usuário a desliga.
// - Arrastar o divisor desliga o arrasto do mapa só durante o gesto.

const CMP_PANE = { esq: 'cmpEsquerda', dir: 'cmpDireita' }
const CMP_FONTES = {
  planet:   'Planet / NICFI (mensal)',
  sentinel: 'Sentinel-2',
  prodes:   'PRODES — desmatamento anual',
}
const CMP_S2_ANO_MIN = 2017     // mesmo piso da linha do tempo (TL_S2_ANO_MIN)
const CMP_PRODES_ANO_MIN = 2008

const _cmp = {
  mapa: null, opts: {}, ativo: false, pos: 0.5,
  lados: { esq: null, dir: null },   // { fonte, valor, layer, carregando, ok, erros }
  el: {},                             // divisor, painel, botão
  planet: null, prodesAnos: null, cenas: null,
  arrasto: null,
}

function cmpAtivo() { return _cmp.ativo }

// ── Montagem ────────────────────────────────────────────────────────
function cmpMontar(mapa, opts = {}) {
  if (!mapa || typeof L === 'undefined' || _cmp.mapa === mapa) return
  _cmp.mapa = mapa
  _cmp.opts = opts
  _cmpEstilos()
  for (const k of ['esq', 'dir']) {
    if (!mapa.getPane(CMP_PANE[k])) mapa.createPane(CMP_PANE[k])
    mapa.getPane(CMP_PANE[k]).style.zIndex = 250   // tilePane = 200, overlayPane = 400
  }
  const Ctrl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'cmp-ctrl')
      div.innerHTML = `<button type="button" class="cmp-abrir" aria-pressed="false" title="Comparar imagens (lado a lado)" aria-label="Comparar imagens">${typeof bico === 'function' ? bico('swap') : '⇆'}</button>`
      L.DomEvent.disableClickPropagation(div)
      div.addEventListener('click', ev => {
        ev.stopPropagation()
        if (ev.target.closest('.cmp-abrir')) cmpAtivo() ? cmpSair() : cmpAbrir()
      })
      return div
    },
  })
  _cmp.el.ctrl = new Ctrl()
  mapa.addControl(_cmp.el.ctrl)
  _cmp.el.botao = _cmp.el.ctrl.getContainer().querySelector('.cmp-abrir')
  document.addEventListener('keydown', _cmpTecla, true)
}

// ── Listas de datas ─────────────────────────────────────────────────
async function _cmpCarregarListas() {
  if (!_cmp.planet) _cmp.planet = typeof mapaPlanetMosaicos === 'function'
    ? await mapaPlanetMosaicos() : { disponivel: false, mosaicos: [] }
  if (!_cmp.prodesAnos) {
    let anos = []
    try { anos = (await (_cmp.opts.prodesAnos ? _cmp.opts.prodesAnos() : [])) || [] } catch (_) {}
    if (!anos.length) {                    // sem o resumo do banco: série conhecida até o ano passado
      for (let a = new Date().getFullYear() - 1; a >= CMP_PRODES_ANO_MIN; a--) anos.push(a)
    }
    _cmp.prodesAnos = [...new Set(anos.map(Number))].sort((a, b) => b - a)
  }
}

function _cmpPlanetOk() { return !!(_cmp.planet && _cmp.planet.disponivel && _cmp.planet.mosaicos && _cmp.planet.mosaicos.length) }

// Opções do 2º seletor de cada fonte: [{ valor, rotulo, grupo? }]
function _cmpOpcoes(fonte) {
  if (fonte === 'planet') {
    return _cmpPlanetOk() ? _cmp.planet.mosaicos.map(m => ({ valor: m.name, rotulo: m.label })) : []
  }
  if (fonte === 'sentinel') {
    const op = []
    const hoje = new Date(), atual = hoje.getFullYear()
    // a época seca do proxy vai de 1º/mai a 31/out: antes de fechar, o ano é parcial
    const parcial = hoje < new Date(atual, 10, 1)
    for (let a = atual; a >= CMP_S2_ANO_MIN; a--) op.push({ valor: `ano:${a}`,
      rotulo: `Época seca ${a}${a === atual && parcial ? ' (parcial)' : ''}`, grupo: 'Composição do ano (mai–out, menos nuvem)' })
    if (_cmp.cenas && _cmp.cenas.datas) _cmp.cenas.datas.forEach(d => op.push({ valor: `data:${d.data}`,
      rotulo: `${_cmpDataBR(d.data)} — nuvens ${Math.round(d.nuvem)}%`, grupo: 'Cenas recentes na área visível' }))
    return op
  }
  if (fonte === 'prodes') return _cmp.prodesAnos.map(a => ({ valor: String(a), rotulo: `Desmatamento ${a}` }))
  return []
}

function _cmpDataBR(iso) { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}` }

function _cmpRotuloCurto(lado) {
  const l = _cmp.lados[lado]; if (!l) return ''
  if (l.fonte === 'planet') {
    const m = _cmpPlanetOk() && _cmp.planet.mosaicos.find(x => x.name === l.valor)
    return `Planet · ${m ? m.label : l.valor}`
  }
  if (l.fonte === 'sentinel') {
    return l.valor.startsWith('ano:') ? `Sentinel-2 · seca ${l.valor.slice(4)}` : `Sentinel-2 · ${_cmpDataBR(l.valor.slice(5))}`
  }
  return `PRODES ${l.valor}`
}

// Padrão: Planet mais recente × o mesmo mês 2 anos antes; sem Planet,
// Sentinel do ano passado × 4 anos antes.
function _cmpPadrao() {
  if (_cmpPlanetOk()) {
    const ms = _cmp.planet.mosaicos   // mais recente primeiro
    const dir = ms[0]
    const alvo = dir.data ? `${Number(dir.data.slice(0, 4)) - 2}${dir.data.slice(4, 7)}` : null
    const esq = (alvo && ms.find(m => (m.data || '').slice(0, 7) === alvo)) || ms[Math.min(ms.length - 1, 24)]
    return { esq: { fonte: 'planet', valor: esq.name }, dir: { fonte: 'planet', valor: dir.name } }
  }
  const a = new Date().getFullYear() - 1
  return { esq: { fonte: 'sentinel', valor: `ano:${a - 4}` }, dir: { fonte: 'sentinel', valor: `ano:${a}` } }
}

// ── Abrir / sair ────────────────────────────────────────────────────
async function cmpAbrir() {
  if (_cmp.ativo || !_cmp.mapa) return
  _cmp.ativo = true
  _cmp.el.botao.classList.add('ativo')
  _cmp.el.botao.setAttribute('aria-pressed', 'true')
  await _cmpCarregarListas()
  if (!_cmp.ativo) return               // saiu enquanto carregava
  const p = _cmpPadrao()
  _cmp.lados.esq = { ...p.esq }
  _cmp.lados.dir = { ...p.dir }
  _cmp.pos = 0.5
  _cmpMontarDom()
  _cmpAplicar('esq'); _cmpAplicar('dir')
  _cmp.mapa.on('move zoom zoomend resize viewreset', _cmpRecortar)
  _cmp.mapa.on('layeradd layerremove', _cmpAvisos)
  _cmpRecortar()
  _cmpAvisos()
}

function cmpSair() {
  if (!_cmp.ativo) return
  _cmp.ativo = false
  const m = _cmp.mapa
  m.off('move zoom zoomend resize viewreset', _cmpRecortar)
  m.off('layeradd layerremove', _cmpAvisos)
  _cmpFimArrasto()
  for (const k of ['esq', 'dir']) {
    const l = _cmp.lados[k]
    if (l && l.layer) m.removeLayer(l.layer)
    _cmp.lados[k] = null
    const pane = m.getPane(CMP_PANE[k]); if (pane) pane.style.clip = ''
  }
  for (const k of ['divisor', 'painel']) { if (_cmp.el[k]) _cmp.el[k].remove(); _cmp.el[k] = null }
  _cmp.el.botao.classList.remove('ativo')
  _cmp.el.botao.setAttribute('aria-pressed', 'false')
  _cmp.el.botao.focus({ preventScroll: true })
}

// CART.imprimir chama antes de montar a folha: o recorte por `clip` não
// acompanha a folha A4 nesta fase, então a comparação sai antes.
function cmpSairParaImprimir() {
  if (!_cmp.ativo) return false
  cmpSair()
  if (typeof toast === 'function') toast('A comparação de imagens foi encerrada para imprimir o mapa.', 'info')
  return true
}

// ── Camada de cada lado ─────────────────────────────────────────────
function _cmpCriarCamada(lado) {
  const l = _cmp.lados[lado]
  const pane = CMP_PANE[lado]
  if (l.fonte === 'planet') return mapaPlanetLayer(L, l.valor, 100, { pane })
  if (l.fonte === 'sentinel') {
    return l.valor.startsWith('ano:')
      ? mapaSentinelLayer(L, { ano: Number(l.valor.slice(4)), opacidade: 100, pane })
      : mapaSentinelLayer(L, { data: l.valor.slice(5), nuvem: 100, opacidade: 100, pane })
  }
  return mapaProdesLayer(L, { ano: Number(l.valor), opacidade: 85, pane })
}

function _cmpAplicar(lado) {
  const l = _cmp.lados[lado]; if (!l) return
  if (l.layer) _cmp.mapa.removeLayer(l.layer)
  l.carregando = true; l.ok = 0; l.erros = 0
  if (!l.valor) { l.layer = null; l.carregando = false; _cmpStatus(lado); return }
  const lay = _cmpCriarCamada(lado)
  lay.on('loading', () => { l.carregando = true; _cmpStatus(lado) })
  lay.on('tileload', () => { l.ok++ })
  lay.on('tileerror', () => { l.erros++ })
  lay.on('load', () => { l.carregando = false; _cmpStatus(lado) })
  l.layer = lay.addTo(_cmp.mapa)
  _cmpStatus(lado)
  _cmpRotulos()
  _cmpAvisos()
}

// ── DOM: divisor + painel ───────────────────────────────────────────
function _cmpMontarDom() {
  const cont = _cmp.mapa.getContainer()
  const d = document.createElement('div')
  d.className = 'cmp-divisor'
  d.setAttribute('role', 'slider')
  d.tabIndex = 0
  d.setAttribute('aria-label', 'Divisor da comparação de imagens')
  d.setAttribute('aria-orientation', 'horizontal')
  d.setAttribute('aria-valuemin', '2')
  d.setAttribute('aria-valuemax', '98')
  d.innerHTML = `<span class="cmp-linha" aria-hidden="true"></span>
    <span class="cmp-pega" aria-hidden="true">‹ ›</span>
    <span class="cmp-tag cmp-tag-esq" aria-hidden="true"></span>
    <span class="cmp-tag cmp-tag-dir" aria-hidden="true"></span>`
  L.DomEvent.disableClickPropagation(d)
  L.DomEvent.disableScrollPropagation(d)
  d.addEventListener('pointerdown', _cmpInicioArrasto)
  d.addEventListener('pointermove', _cmpMoverArrasto)
  d.addEventListener('pointerup', _cmpFimArrasto)
  d.addEventListener('pointercancel', _cmpFimArrasto)
  d.addEventListener('lostpointercapture', _cmpFimArrasto)
  d.addEventListener('keydown', ev => {
    const v = ev.key === 'ArrowLeft' ? _cmp.pos - 0.02 : ev.key === 'ArrowRight' ? _cmp.pos + 0.02
      : ev.key === 'Home' ? 0.02 : ev.key === 'End' ? 0.98 : null
    if (v === null) return
    ev.preventDefault(); ev.stopPropagation()
    _cmpMoverPara(v)
  })
  cont.appendChild(d)
  _cmp.el.divisor = d

  const p = document.createElement('section')
  p.className = 'cmp-painel'
  p.setAttribute('aria-label', 'Comparar imagens')
  p.innerHTML = `<div class="cmp-cab"><strong>Comparar imagens</strong>
      <button type="button" class="cmp-acao" data-cmp-acao="inverter" title="Trocar os lados">Inverter</button>
      <button type="button" class="cmp-acao cmp-acao-sair" data-cmp-acao="sair">Sair da comparação</button></div>
    <div class="cmp-lados">${['esq', 'dir'].map(k => `
      <div class="cmp-lado" data-lado="${k}">
        <div class="cmp-lado-tit">${k === 'esq' ? 'Esquerda' : 'Direita'}</div>
        <select class="cmp-sel" data-cmp-fonte="${k}" aria-label="Fonte da imagem — ${k === 'esq' ? 'esquerda' : 'direita'}">
          ${Object.entries(CMP_FONTES).map(([f, r]) => `<option value="${f}"${f === 'planet' && !_cmpPlanetOk() ? ' disabled' : ''}>${r}${f === 'planet' && !_cmpPlanetOk() ? ' (indisponível)' : ''}</option>`).join('')}
        </select>
        <select class="cmp-sel" data-cmp-valor="${k}" aria-label="Data da imagem — ${k === 'esq' ? 'esquerda' : 'direita'}"></select>
        <div class="cmp-status" data-cmp-status="${k}" role="status" aria-live="polite"></div>
      </div>`).join('')}</div>
    <div class="cmp-avisos" role="status" aria-live="polite"></div>`
  L.DomEvent.disableClickPropagation(p)
  L.DomEvent.disableScrollPropagation(p)
  p.addEventListener('click', ev => {
    ev.stopPropagation()
    const b = ev.target.closest('[data-cmp-acao]'); if (!b) return
    if (b.dataset.cmpAcao === 'sair') cmpSair()
    else if (b.dataset.cmpAcao === 'inverter') _cmpInverter()
  })
  p.addEventListener('change', ev => {
    const f = ev.target.dataset.cmpFonte, v = ev.target.dataset.cmpValor
    if (f) _cmpTrocarFonte(f, ev.target.value)
    else if (v) { _cmp.lados[v].valor = ev.target.value; _cmpAplicar(v) }
  })
  cont.appendChild(p)
  _cmp.el.painel = p
  for (const k of ['esq', 'dir']) _cmpSincSeletores(k)
}

function _cmpSincSeletores(lado) {
  const p = _cmp.el.painel; if (!p) return
  const l = _cmp.lados[lado]
  p.querySelector(`[data-cmp-fonte="${lado}"]`).value = l.fonte
  const sel = p.querySelector(`[data-cmp-valor="${lado}"]`)
  const op = _cmpOpcoes(l.fonte)
  let h = '', grupo = null
  op.forEach(o => {
    if (o.grupo !== grupo) { if (grupo) h += '</optgroup>'; if (o.grupo) h += `<optgroup label="${_cmpEsc(o.grupo)}">`; grupo = o.grupo }
    h += `<option value="${_cmpEsc(o.valor)}">${_cmpEsc(o.rotulo)}</option>`
  })
  if (grupo) h += '</optgroup>'
  if (l.fonte === 'sentinel' && !_cmp.cenas) h += '<option disabled>Buscando cenas recentes…</option>'
  sel.innerHTML = h || '<option value="">— sem imagem —</option>'
  if (l.valor && op.some(o => o.valor === l.valor)) sel.value = l.valor
}

function _cmpEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }

async function _cmpTrocarFonte(lado, fonte) {
  const l = _cmp.lados[lado]
  l.fonte = fonte
  const op = _cmpOpcoes(fonte)
  // Sentinel abre no último ano FECHADO; o corrente fica na lista como parcial
  const s2Padrao = `ano:${new Date().getFullYear() - 1}`
  l.valor = fonte === 'sentinel' && op.some(o => o.valor === s2Padrao) ? s2Padrao : (op.length ? op[0].valor : '')
  _cmpSincSeletores(lado)
  _cmpAplicar(lado)
  if (fonte === 'sentinel' && !_cmp.cenas && typeof mapaSentinelCenas === 'function') {
    const b = _cmp.mapa.getBounds()
    _cmp.cenas = await mapaSentinelCenas([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    if (_cmp.ativo) for (const k of ['esq', 'dir']) if (_cmp.lados[k] && _cmp.lados[k].fonte === 'sentinel') _cmpSincSeletores(k)
  }
}

function _cmpInverter() {
  const a = _cmp.lados.esq, b = _cmp.lados.dir
  for (const l of [a, b]) if (l.layer) _cmp.mapa.removeLayer(l.layer)
  _cmp.lados.esq = { fonte: b.fonte, valor: b.valor }
  _cmp.lados.dir = { fonte: a.fonte, valor: a.valor }
  for (const k of ['esq', 'dir']) { _cmpSincSeletores(k); _cmpAplicar(k) }
}

// ── Status e avisos ─────────────────────────────────────────────────
function _cmpStatus(lado) {
  const p = _cmp.el.painel; if (!p) return
  const l = _cmp.lados[lado]
  const el = p.querySelector(`[data-cmp-status="${lado}"]`)
  let t = '', cls = ''
  if (!l.valor) { t = 'Sem imagem disponível para esta fonte.'; cls = 'erro' }
  else if (l.carregando) t = 'Carregando imagem…'
  else if (l.erros && !l.ok) { t = 'Imagem indisponível nesta área. Escolha outro período.'; cls = 'erro' }
  else if (l.erros) { t = 'Parte da área visível está sem imagem.'; cls = 'aviso' }
  else if (l.fonte === 'prodes') t = 'Polígonos sobre o mapa base (transparente fora deles).'
  el.textContent = t
  el.className = 'cmp-status' + (cls ? ' ' + cls : '')
}

function _cmpAvisos() {
  const p = _cmp.el.painel; if (!p || !_cmp.ativo) return
  const av = []
  const a = _cmp.lados.esq, b = _cmp.lados.dir
  if (a && b && a.fonte === b.fonte && a.valor === b.valor) av.push('Mesma imagem nos dois lados.')
  let baixo = []
  try { baixo = (_cmp.opts.camadasPorBaixo && _cmp.opts.camadasPorBaixo()) || [] } catch (_) {}
  if (baixo.length) av.push(`Ligadas no painel e por baixo da comparação (aparecem só onde a imagem não cobre): ${baixo.join(', ')}. Ajuste em Cobertura Vegetal, se quiser.`)
  p.querySelector('.cmp-avisos').innerHTML = av.map(t => `<p>${_cmpEsc(t)}</p>`).join('')
}

// ── Recorte e divisor ───────────────────────────────────────────────
function _cmpRecortar() {
  if (!_cmp.ativo || !_cmp.el.divisor) return
  const m = _cmp.mapa
  const t = m.getSize()
  const nw = m.containerPointToLayerPoint([0, 0])
  const se = m.containerPointToLayerPoint([t.x, t.y])
  const x = nw.x + t.x * _cmp.pos
  m.getPane(CMP_PANE.esq).style.clip = `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`
  m.getPane(CMP_PANE.dir).style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`
  const d = _cmp.el.divisor
  d.style.left = `${t.x * _cmp.pos}px`
  const pct = Math.round(_cmp.pos * 100)
  d.setAttribute('aria-valuenow', String(pct))
  d.setAttribute('aria-valuetext', `${pct}% à esquerda`)
  _cmpRotulos()
}

function _cmpRotulos() {
  const d = _cmp.el.divisor; if (!d) return
  d.querySelector('.cmp-tag-esq').textContent = _cmpRotuloCurto('esq')
  d.querySelector('.cmp-tag-dir').textContent = _cmpRotuloCurto('dir')
}

function _cmpMoverPara(v) {
  _cmp.pos = Math.min(0.98, Math.max(0.02, v))
  _cmpRecortar()
}

function _cmpMoverPonteiro(ev) {
  const r = _cmp.mapa.getContainer().getBoundingClientRect()
  if (r.width > 0) _cmpMoverPara((ev.clientX - r.left) / r.width)
}

function _cmpInicioArrasto(ev) {
  if (!ev.isPrimary || ev.button !== 0 || _cmp.arrasto) return
  ev.preventDefault(); ev.stopPropagation()
  const d = ev.currentTarget
  d.focus({ preventScroll: true })
  d.setPointerCapture(ev.pointerId)
  _cmp.arrasto = { id: ev.pointerId, alvo: d, arrastava: _cmp.mapa.dragging.enabled() }
  _cmp.mapa.dragging.disable()
  _cmpMoverPonteiro(ev)
}

function _cmpMoverArrasto(ev) {
  if (!_cmp.arrasto || _cmp.arrasto.id !== ev.pointerId) return
  ev.preventDefault(); ev.stopPropagation()
  _cmpMoverPonteiro(ev)
}

function _cmpFimArrasto(ev) {
  const a = _cmp.arrasto; if (!a) return
  if (ev && ev.pointerId !== undefined && ev.pointerId !== a.id) return
  _cmp.arrasto = null
  if (a.arrastava) _cmp.mapa.dragging.enable()
  try { if (a.alvo.hasPointerCapture(a.id)) a.alvo.releasePointerCapture(a.id) } catch (_) {}
}

// Esc encerra a comparação — em captura, antes de o imersivo tratar o Esc.
// A medição (js/mapa-medicao.js) também escuta em captura e foi registrada
// antes: com uma ferramenta de medição ligada, o Esc é dela.
function _cmpTecla(ev) {
  if (!_cmp.ativo || ev.key !== 'Escape') return
  if (typeof medFerramentaAtiva === 'function' && medFerramentaAtiva()) return
  const tag = (ev.target && ev.target.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || ev.target?.isContentEditable) return
  ev.preventDefault(); ev.stopPropagation()
  cmpSair()
}

// ── Estilo ──────────────────────────────────────────────────────────
function _cmpEstilos() {
  if (document.getElementById('cmp-estilos')) return
  const st = document.createElement('style')
  st.id = 'cmp-estilos'
  st.textContent = `
.cmp-abrir{width:34px;height:34px;padding:0;border:0;border-radius:8px;background:#fff;color:#1F4E2C;box-shadow:0 1px 5px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;}
.cmp-abrir:hover{background:#f4f6f5;}
.cmp-abrir.ativo{background:#1F4E2C;color:#fff;}
.cmp-abrir:focus-visible,.cmp-acao:focus-visible,.cmp-sel:focus-visible{outline:2px solid #C9A84C;outline-offset:2px;}
.cmp-divisor{position:absolute;top:0;bottom:0;width:28px;margin-left:-14px;z-index:650;cursor:ew-resize;touch-action:none;}
.cmp-divisor:focus-visible{outline:none;}
.cmp-divisor:focus-visible .cmp-pega{outline:3px solid #C9A84C;outline-offset:2px;}
.cmp-linha{position:absolute;left:13px;top:0;bottom:0;width:2px;background:#fff;box-shadow:0 0 0 1px rgba(10,26,15,.55);}
.cmp-pega{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:30px;height:30px;padding:0 6px;border-radius:15px;background:#fff;color:#0A1A0F;font:700 13px/30px 'DM Sans',sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.4);}
.cmp-tag{position:absolute;top:56px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(10,26,15,.86);color:#fff;font:600 11px/1 'DM Sans',sans-serif;padding:5px 8px;border-radius:5px;pointer-events:none;}
.cmp-tag-esq{right:20px;}
.cmp-tag-dir{left:20px;}
.cmp-tag:empty{display:none;}
.cmp-painel{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);z-index:1050;width:min(560px,calc(100% - 24px));background:rgba(255,255,255,.97);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.3);padding:10px 12px;font:12px/1.4 'DM Sans',sans-serif;color:#1f2937;}
.cmp-cab{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.cmp-cab strong{flex:1;color:#1F4E2C;font-size:12.5px;}
.cmp-acao{min-height:28px;padding:3px 10px;border:1px solid #cbd5d0;border-radius:6px;background:#fff;color:#1F4E2C;font:inherit;font-size:11px;font-weight:600;cursor:pointer;}
.cmp-acao-sair{background:#1F4E2C;border-color:#1F4E2C;color:#fff;}
.cmp-lados{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.cmp-lado{display:flex;flex-direction:column;gap:5px;min-width:0;}
.cmp-lado-tit{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#4b5563;}
.cmp-sel{width:100%;min-height:28px;font:inherit;font-size:11.5px;padding:3px 6px;border:1px solid #cbd5d0;border-radius:6px;background:#fff;}
.cmp-status{font-size:10.5px;color:#4b5563;min-height:14px;}
.cmp-status.erro{color:#B91C1C;}
.cmp-status.aviso{color:#92400E;}
.cmp-avisos p{margin:6px 0 0;padding:5px 8px;border-radius:6px;background:#FEF3C7;color:#78350F;font-size:11px;}
.cmp-avisos:empty{display:none;}
@media (max-width:560px){.cmp-lados{grid-template-columns:1fr;}.cmp-painel{bottom:12px;}}
@media print{.cmp-ctrl,.cmp-divisor,.cmp-painel{display:none!important;}}
`
  document.head.appendChild(st)
}
