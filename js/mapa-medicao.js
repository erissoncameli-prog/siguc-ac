// ── SIGUC — Ferramentas de medição do Mapa das UCs ─────────────────
// Coordenada (graus + UTM SIRGAS 2000), distância e área/perímetro
// geodésicos. Fonte única (prefixo `med`): a página só chama
// medMontar(mapa). Ideia vista no jurema-webgis (Cardeal Map); nenhum
// código dele — aqui é Leaflet, lá é Cesium. Diferença de cota ficou de
// fora: sem superfície 3D não há o que medir, e a tela não promete.
//
// Regras que seguram o módulo (plano em docs/mapa-ucs/plano-medicao-comparacao.md):
// - Clique de medição NUNCA abre popup de UC/CAR/alerta. Enquanto mede, o
//   container ganha `.med-ativa`, que tira o pointer-events das camadas
//   (SVG `.leaflet-interactive` E o <canvas> do CAR, que trata o clique
//   pelo próprio elemento). O clique cai no mapa, que é o que medimos.
// - Duplo clique conclui; por isso o zoom por duplo clique fica desligado
//   só durante a medição e volta como estava.
// - Nada é gravado (banco ou localStorage): medição é de sessão.
// - turf (área/comprimento) e proj4 (UTM) já são vendorizados na página;
//   sem eles, distância cai no haversine e o UTM some — nunca quebra.

const MED_RAIO_M = 6371008.8   // mesmo raio do turf, para os dois caminhos baterem
const MED_COR = '#F0CB6A'      // --ouro-c: legível sobre satélite e sobre ruas
const MED_PANE = 'medicaoPane'

// ── Funções puras ───────────────────────────────────────────────────
function _medNum(v, casas) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

function medFormatarDistancia(m) {
  if (!Number.isFinite(m)) return '—'
  if (m < 1000) return `${_medNum(m, m < 100 ? 1 : 0)} m`
  return `${_medNum(m / 1000, m < 100000 ? 2 : 1)} km`
}

function medFormatarArea(m2) {
  if (!Number.isFinite(m2)) return '—'
  if (m2 < 10000) return `${_medNum(m2, 0)} m²`
  const ha = m2 / 10000
  if (ha < 10000) return `${_medNum(ha, ha < 100 ? 2 : 1)} ha`
  return `${_medNum(m2 / 1e6, 1)} km² (${_medNum(ha, 0)} ha)`
}

// pts = [[lat, lng], ...]
function medDistanciaM(pts) {
  if (!pts || pts.length < 2) return 0
  if (typeof turf !== 'undefined') {
    return turf.length(turf.lineString(pts.map(([la, lo]) => [lo, la])), { units: 'kilometers' }) * 1000
  }
  const rad = Math.PI / 180
  let tot = 0
  for (let i = 1; i < pts.length; i++) {
    const [la1, lo1] = pts[i - 1], [la2, lo2] = pts[i]
    const a = Math.sin((la2 - la1) * rad / 2) ** 2 +
      Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin((lo2 - lo1) * rad / 2) ** 2
    tot += 2 * MED_RAIO_M * Math.asin(Math.min(1, Math.sqrt(a)))
  }
  return tot
}

// Área e perímetro de um anel aberto (sem repetir o 1º vértice).
function medAreaPerimetro(pts) {
  if (!pts || pts.length < 3) return { areaM2: 0, perimetroM: 0 }
  const perimetroM = medDistanciaM([...pts, pts[0]])
  if (typeof turf === 'undefined') return { areaM2: NaN, perimetroM }
  const anel = [...pts, pts[0]].map(([la, lo]) => [lo, la])
  return { areaM2: turf.area(turf.polygon([anel])), perimetroM }
}

// SIRGAS 2000 / UTM da zona do ponto. Mesma zona e EPSG da moldura
// (moldUtmZona/moldEpsgUtm, js/mapa-moldura.js) — a grade impressa e o
// número da medição nunca discordam.
function medCoordenada(lat, lng) {
  const r = { lat, lng, zona: null, hemisferio: null, e: null, n: null, epsg: null }
  if (typeof proj4 === 'undefined') return r
  const zona = Math.floor((lng + 180) / 6) + 1
  const sul = lat < 0
  const def = `+proj=utm +zone=${zona}${sul ? ' +south' : ''} +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`
  const [e, n] = proj4('EPSG:4326', def, [lng, lat])
  return { ...r, zona, hemisferio: sul ? 'S' : 'N', e, n, epsg: sul ? 31960 + zona : null }   // Acre é todo hemisfério sul
}

function medCoordenadaTexto(c) {
  const g = `${_medNum(c.lat, 6)}, ${_medNum(c.lng, 6)}`
  if (c.e == null) return g
  return `${g}\nUTM ${c.zona}${c.hemisferio} · E ${_medNum(c.e, 0)} · N ${_medNum(c.n, 0)}`
}

// ── Ícones (traço 24×24, mesmo estilo de BICON_PATHS) ───────────────
function _medIco(nome) {
  return typeof bico === 'function' ? bico(nome) : ''
}

// ── Estilo (injetado uma vez, como em js/mapa-cartografia.js) ───────
function _medEstilos() {
  if (document.getElementById('med-estilos')) return
  const st = document.createElement('style')
  st.id = 'med-estilos'
  st.textContent = `
.med-ctrl{display:flex;align-items:flex-start;gap:6px;font-family:'DM Sans',sans-serif;}
.med-bar{display:flex;flex-direction:column;background:#fff;border-radius:8px;box-shadow:0 1px 5px rgba(0,0,0,.4);overflow:hidden;}
.med-btn{width:32px;height:32px;padding:0;border:0;border-bottom:1px solid #e5e7eb;background:#fff;color:#1F4E2C;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:17px;}
.med-btn:last-child{border-bottom:0;}
.med-btn:hover{background:#f4f6f5;}
.med-btn.ativo{background:#1F4E2C;color:#fff;}
.med-btn:focus-visible,.med-acao:focus-visible{outline:2px solid #C9A84C;outline-offset:-2px;}
.med-btn:disabled{color:#b6bcc6;background:#fff;cursor:not-allowed;}
.med-painel{width:236px;background:rgba(255,255,255,.97);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);padding:8px 10px;font-size:12px;line-height:1.4;color:#1f2937;}
.med-painel[hidden]{display:none;}
.med-titulo,.med-res-tit{font-weight:700;color:#1F4E2C;margin-bottom:2px;}
.med-dica{color:#4b5563;font-size:11px;}
.med-valor{font-weight:600;font-variant-numeric:tabular-nums;margin-top:4px;}
.med-nota{color:#6b7280;font-size:10.5px;margin-top:4px;}
.med-resultado{margin-top:6px;padding-top:6px;border-top:1px solid #e5e7eb;}
.med-painel>.med-resultado:first-child{margin-top:0;padding-top:0;border-top:0;}
.med-acoes{display:flex;gap:6px;margin-top:6px;}
.med-acao{min-height:26px;padding:3px 10px;border:1px solid #cbd5d0;border-radius:6px;background:#fff;color:#1F4E2C;font:inherit;font-size:11px;font-weight:600;cursor:pointer;margin-top:6px;}
.med-acoes .med-acao{margin-top:0;}
.med-acao-principal{background:#1F4E2C;border-color:#1F4E2C;color:#fff;}
.med-acao:disabled{opacity:.45;cursor:not-allowed;}
.leaflet-container.med-ativa{cursor:crosshair;}
/* clique de medição não abre popup: camadas SVG e o canvas do CAR ficam transparentes ao ponteiro */
.leaflet-container.med-ativa .leaflet-pane .leaflet-interactive,
.leaflet-container.med-ativa .leaflet-pane canvas{pointer-events:none!important;}
.med-rotulo{background:rgba(10,26,15,.88);color:#fff;border:0;border-radius:5px;font:600 11px/1.35 'DM Sans',sans-serif;padding:3px 7px;box-shadow:0 1px 4px rgba(0,0,0,.35);white-space:nowrap;font-variant-numeric:tabular-nums;}
.med-rotulo::before{border-top-color:rgba(10,26,15,.88);}
@media print{.med-ctrl{display:none!important;}}
`
  document.head.appendChild(st)
}

// ── Estado e interação ──────────────────────────────────────────────
const _med = {
  mapa: null, ctrl: null, painel: null,
  ferramenta: null,      // 'coord' | 'dist' | 'area' | null
  pontos: [],            // vértices do desenho em curso ([lat,lng])
  grupo: null,           // medições concluídas
  rascunho: null,        // desenho em curso (linha/polígono + vértices)
  elastico: null,        // trecho do último vértice até o ponteiro
  dblZoomAntes: null,
  ultimo: null,          // resultado mostrado no painel
}

const MED_FERRAMENTAS = {
  coord: { rotulo: 'Coordenada', icone: 'crosshair',
    dica: 'Clique no mapa para ler a coordenada. Esc encerra.' },
  dist:  { rotulo: 'Distância', icone: 'ruler',
    dica: 'Clique para marcar os pontos. Duplo clique ou Enter conclui · Backspace desfaz · Esc cancela.' },
  area:  { rotulo: 'Área', icone: 'polygon',
    dica: 'Clique para marcar os vértices (mínimo 3). Duplo clique ou Enter conclui · Backspace desfaz · Esc cancela.' },
}

function medFerramentaAtiva() { return _med.ferramenta }

function medMontar(mapa) {
  if (!mapa || typeof L === 'undefined' || _med.mapa === mapa) return
  _med.mapa = mapa
  _medEstilos()
  if (!mapa.getPane(MED_PANE)) {
    mapa.createPane(MED_PANE)
    mapa.getPane(MED_PANE).style.zIndex = 640   // acima de marcadores (600), abaixo de popups (700)
  }
  _med.grupo = L.layerGroup().addTo(mapa)

  const Ctrl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'med-ctrl')
      div.innerHTML =
        `<div class="med-bar" role="toolbar" aria-label="Ferramentas de medição">` +
        Object.entries(MED_FERRAMENTAS).map(([k, f]) =>
          `<button type="button" class="med-btn" data-med="${k}" aria-pressed="false" title="Medir: ${f.rotulo}" aria-label="Medir ${f.rotulo.toLowerCase()}">${_medIco(f.icone)}</button>`).join('') +
        `<button type="button" class="med-btn" data-med-acao="limpar" title="Apagar medições" aria-label="Apagar medições" disabled>${_medIco('trash')}</button>` +
        `</div><div class="med-painel" hidden role="status" aria-live="polite"></div>`
      L.DomEvent.disableClickPropagation(div)
      L.DomEvent.disableScrollPropagation(div)
      div.addEventListener('click', ev => {
        // Para AQUI: o painel é redesenhado pelo próprio clique, e o Leaflet
        // só reconhece clique de controle subindo pelos pais do alvo — com o
        // botão já fora da página, contaria como clique no mapa (vértice novo).
        ev.stopPropagation()
        const b = ev.target.closest('button'); if (!b || b.disabled) return
        if (b.dataset.med) medAlternar(b.dataset.med)
        else if (b.dataset.medAcao === 'limpar') medLimpar()
        else if (b.dataset.medAcao === 'concluir') _medConcluir()
        else if (b.dataset.medAcao === 'desfazer') _medDesfazer()
        else if (b.dataset.medAcao === 'copiar') _medCopiar(b)
      })
      return div
    },
  })
  _med.ctrl = new Ctrl()
  mapa.addControl(_med.ctrl)
  _med.painel = _med.ctrl.getContainer().querySelector('.med-painel')

  mapa.on('click', _medClique)
  mapa.on('dblclick', _medDuplo)
  mapa.on('mousemove', _medMover)
  // Captura: Esc não pode também fechar a tela cheia nem painéis da página
  document.addEventListener('keydown', _medTecla, true)
}

function medAlternar(ferramenta) {
  if (_med.ferramenta === ferramenta) { medDesativar(); return }
  _medCancelarRascunho()
  const m = _med.mapa
  if (!_med.ferramenta) {
    _med.dblZoomAntes = m.doubleClickZoom.enabled()
    m.doubleClickZoom.disable()
    m.closePopup()
  }
  _med.ferramenta = ferramenta
  m.getContainer().classList.add('med-ativa')
  _medSincBotoes()
  _medPainel()
}

function medDesativar() {
  if (!_med.ferramenta) return
  _medCancelarRascunho()
  _med.ferramenta = null
  const m = _med.mapa
  m.getContainer().classList.remove('med-ativa')
  if (_med.dblZoomAntes) m.doubleClickZoom.enable()
  _med.dblZoomAntes = null
  _medSincBotoes()
  _medPainel()
}

function medLimpar() {
  _medCancelarRascunho()
  _med.grupo && _med.grupo.clearLayers()
  _med.ultimo = null
  _medSincBotoes()
  _medPainel()
}

function _medSincBotoes() {
  const c = _med.ctrl && _med.ctrl.getContainer(); if (!c) return
  c.querySelectorAll('[data-med]').forEach(b => {
    const on = b.dataset.med === _med.ferramenta
    b.classList.toggle('ativo', on)
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
  const limpar = c.querySelector('[data-med-acao="limpar"]')
  if (limpar) limpar.disabled = !(_med.grupo && _med.grupo.getLayers().length) && !_med.pontos.length
}

// Painel abaixo da barra: instrução da ferramenta + resultado.
function _medPainel() {
  const p = _med.painel; if (!p) return
  const f = _med.ferramenta && MED_FERRAMENTAS[_med.ferramenta]
  const u = _med.ultimo
  if (!f && !u) { p.hidden = true; p.innerHTML = ''; return }
  let h = ''
  if (f) h += `<div class="med-titulo">${f.rotulo}</div><div class="med-dica">${f.dica}</div>`
  const n = _med.pontos.length
  if (f && n) {
    const parcial = _med.ferramenta === 'area' && n >= 3
      ? (() => { const a = medAreaPerimetro(_med.pontos); return `Área ${medFormatarArea(a.areaM2)} · perímetro ${medFormatarDistancia(a.perimetroM)}` })()
      : `Total ${medFormatarDistancia(medDistanciaM(_med.pontos))}`
    const podeConcluir = _med.ferramenta === 'dist' ? n >= 2 : n >= 3
    h += `<div class="med-valor">${parcial}</div><div class="med-acoes">` +
      `<button type="button" class="med-acao" data-med-acao="desfazer">Desfazer</button>` +
      `<button type="button" class="med-acao med-acao-principal" data-med-acao="concluir"${podeConcluir ? '' : ' disabled'}>Concluir</button></div>`
  } else if (u) {
    h += `<div class="med-resultado"><div class="med-res-tit">${u.titulo}</div>` +
      u.linhas.map(l => `<div class="med-valor">${l}</div>`).join('') +
      (u.nota ? `<div class="med-nota">${u.nota}</div>` : '') +
      (u.copiar ? `<button type="button" class="med-acao" data-med-acao="copiar" data-texto="${_medAttr(u.copiar)}">Copiar</button>` : '') +
      `</div>`
  }
  p.innerHTML = h
  p.hidden = false
}

function _medAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }

function _medCopiar(btn) {
  const t = btn.dataset.texto || ''
  const ok = () => { btn.textContent = 'Copiado'; setTimeout(() => { btn.textContent = 'Copiar' }, 1500) }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, () => {})
}

// Clique que repete o último ponto (o 1º clique do duplo clique) não vira vértice.
function _medPertoDoUltimo(ll) {
  const u = _med.pontos[_med.pontos.length - 1]; if (!u) return false
  const a = _med.mapa.latLngToContainerPoint(ll), b = _med.mapa.latLngToContainerPoint(L.latLng(u[0], u[1]))
  return a.distanceTo(b) < 4
}

function _medClique(ev) {
  if (!_med.ferramenta) return
  const ll = ev.latlng
  if (_med.ferramenta === 'coord') { _medMarcarCoordenada(ll); return }
  if (_medPertoDoUltimo(ll)) return
  _med.pontos.push([ll.lat, ll.lng])
  _medDesenharRascunho()
  _medSincBotoes()
  _medPainel()
}

function _medDuplo() { if (_med.ferramenta && _med.ferramenta !== 'coord') _medConcluir() }

function _medMover(ev) {
  if (!_med.ferramenta || _med.ferramenta === 'coord' || !_med.pontos.length) return
  const u = _med.pontos[_med.pontos.length - 1]
  const trecho = [[u[0], u[1]], [ev.latlng.lat, ev.latlng.lng]]
  if (_med.ferramenta === 'area' && _med.pontos.length >= 2) trecho.push(_med.pontos[0])
  if (!_med.elastico) {
    _med.elastico = L.polyline(trecho, { pane: MED_PANE, interactive: false, color: MED_COR, weight: 2, dashArray: '4 6', opacity: 0.9 }).addTo(_med.mapa)
  } else _med.elastico.setLatLngs(trecho)
}

function _medTecla(ev) {
  if (!_med.ferramenta) return
  const tag = (ev.target && ev.target.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target?.isContentEditable) return
  if (ev.key === 'Escape') {
    ev.preventDefault(); ev.stopPropagation()
    if (_med.pontos.length) { _medCancelarRascunho(); _medSincBotoes(); _medPainel() }
    else medDesativar()
  } else if (ev.key === 'Enter' && _med.pontos.length) {
    ev.preventDefault(); ev.stopPropagation(); _medConcluir()
  } else if (ev.key === 'Backspace' && _med.pontos.length) {
    ev.preventDefault(); ev.stopPropagation(); _medDesfazer()
  }
}

function _medDesfazer() {
  _med.pontos.pop()
  if (!_med.pontos.length) _medCancelarRascunho()
  else _medDesenharRascunho()
  _medSincBotoes()
  _medPainel()
}

function _medVertices(pts) {
  return pts.map(([la, lo]) => L.circleMarker([la, lo], {
    pane: MED_PANE, interactive: false, radius: 4, color: '#0A1A0F', weight: 1.5, fillColor: MED_COR, fillOpacity: 1,
  }))
}

function _medDesenharRascunho() {
  if (_med.rascunho) _med.mapa.removeLayer(_med.rascunho)
  const pts = _med.pontos
  const forma = _med.ferramenta === 'area' && pts.length >= 3
    ? L.polygon(pts, { pane: MED_PANE, interactive: false, color: MED_COR, weight: 2.5, fillColor: MED_COR, fillOpacity: 0.15 })
    : L.polyline(pts, { pane: MED_PANE, interactive: false, color: MED_COR, weight: 2.5 })
  _med.rascunho = L.layerGroup([forma, ..._medVertices(pts)]).addTo(_med.mapa)
}

function _medCancelarRascunho() {
  if (_med.rascunho) _med.mapa.removeLayer(_med.rascunho)
  if (_med.elastico) _med.mapa.removeLayer(_med.elastico)
  _med.rascunho = null; _med.elastico = null; _med.pontos = []
}

function _medRotulo(latlng, texto) {
  return L.tooltip({ permanent: true, direction: 'top', className: 'med-rotulo', offset: [0, -6], interactive: false })
    .setLatLng(latlng).setContent(texto)
}

function _medConcluir() {
  const pts = _med.pontos.slice()
  const tipo = _med.ferramenta
  if ((tipo === 'dist' && pts.length < 2) || (tipo === 'area' && pts.length < 3)) return
  _medCancelarRascunho()
  const camadas = []
  if (tipo === 'dist') {
    const d = medDistanciaM(pts)
    camadas.push(L.polyline(pts, { pane: MED_PANE, interactive: false, color: MED_COR, weight: 3 }), ..._medVertices(pts),
      _medRotulo(pts[pts.length - 1], medFormatarDistancia(d)))
    _med.ultimo = { titulo: 'Distância medida', linhas: [medFormatarDistancia(d), `${pts.length - 1} trecho(s)`],
      nota: 'Distância geodésica sobre o elipsoide, sem relevo.' }
  } else {
    const a = medAreaPerimetro(pts)
    const pol = L.polygon(pts, { pane: MED_PANE, interactive: false, color: MED_COR, weight: 3, fillColor: MED_COR, fillOpacity: 0.18 })
    camadas.push(pol, ..._medVertices(pts), _medRotulo(pol.getBounds().getCenter(), medFormatarArea(a.areaM2)))
    _med.ultimo = { titulo: 'Área medida', linhas: [`Área ${medFormatarArea(a.areaM2)}`, `Perímetro ${medFormatarDistancia(a.perimetroM)}`],
      nota: 'Medida no mapa — não registral (não substitui memorial nem CAR).' }
  }
  _med.grupo.addLayer(L.layerGroup(camadas))
  _medSincBotoes()
  _medPainel()
}

function _medMarcarCoordenada(ll) {
  const c = medCoordenada(ll.lat, ll.lng)
  const texto = medCoordenadaTexto(c)
  _med.grupo.addLayer(L.layerGroup([..._medVertices([[ll.lat, ll.lng]]), _medRotulo(ll, texto.replace('\n', '<br>'))]))
  const linhas = [`${_medNum(c.lat, 6)}, ${_medNum(c.lng, 6)} (graus decimais)`]
  if (c.e != null) linhas.push(`UTM ${c.zona}${c.hemisferio} · E ${_medNum(c.e, 0)} m · N ${_medNum(c.n, 0)} m`)
  _med.ultimo = { titulo: 'Coordenada', linhas,
    nota: c.e != null ? `SIRGAS 2000${c.epsg ? ` · EPSG:${c.epsg}` : ''}` : 'SIRGAS 2000 (UTM indisponível)', copiar: texto }
  _medSincBotoes()
  _medPainel()
}
