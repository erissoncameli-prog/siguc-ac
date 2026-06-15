// ── SIGUC Brigadas — Medição de área por GPS (offline) ────────
// Dois modos que compartilham o mesmo cálculo:
//   • vertices  → o brigadista anda até cada canto e toca "adicionar"
//   • perimetro → grava pontos automaticamente enquanto caminha em volta
// Cálculo geodésico (área de anel esférico + haversine), 100% no
// cliente — não depende de internet nem de tiles de mapa.

let _areaPontos = []          // [{ lat, lng, acc }]
let _areaModo   = 'vertices'  // 'vertices' | 'perimetro'
let _areaWatchId = null
let _areaMinDist = 4          // m mínimos entre pontos no modo perímetro

const _R_TERRA = 6378137      // raio da Terra (m, WGS84)
const _D2R = Math.PI / 180

// ── Estado ────────────────────────────────────────────────────
function bAreaPontos()  { return _areaPontos.slice() }
function bAreaModo()    { return _areaModo }
function bAreaSetModo(m){ if (m === 'vertices' || m === 'perimetro') _areaModo = m }
function bAreaLimpar()  { _areaPontos = [] }
function bAreaDesfazer(){ _areaPontos.pop() }
function bAreaTemPoligono() { return _areaPontos.length >= 3 }

// ── Geometria ─────────────────────────────────────────────────
// Área do anel (m²) — fórmula esférica usada por Leaflet/OpenLayers.
function _areaM2(pts) {
  if (pts.length < 3) return 0
  let soma = 0
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length]
    soma += (p2.lng - p1.lng) * _D2R *
            (2 + Math.sin(p1.lat * _D2R) + Math.sin(p2.lat * _D2R))
  }
  return Math.abs(soma * _R_TERRA * _R_TERRA / 2)
}

// Distância entre dois pontos (m) — haversine.
function _distM(p1, p2) {
  const dLat = (p2.lat - p1.lat) * _D2R
  const dLng = (p2.lng - p1.lng) * _D2R
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(p1.lat * _D2R) * Math.cos(p2.lat * _D2R) * Math.sin(dLng / 2) ** 2
  return 2 * _R_TERRA * Math.asin(Math.min(1, Math.sqrt(a)))
}

function _perimetroM(pts) {
  if (pts.length < 2) return 0
  let p = 0
  for (let i = 0; i < pts.length; i++) p += _distM(pts[i], pts[(i + 1) % pts.length])
  return p
}

// Resultado pronto para a UI.
function bAreaCalcular() {
  const n = _areaPontos.length
  const m2 = _areaM2(_areaPontos)
  const accPior = n ? Math.max(..._areaPontos.map(p => p.acc || 0)) : 0
  return {
    n,
    areaHa:     m2 / 10000,
    areaM2:     m2,
    perimetroM: _perimetroM(_areaPontos),
    accPiorM:   accPior,
    completo:   n >= 3,
  }
}

// GeoJSON Polygon fechado (1º ponto repetido no fim) ou null.
function bAreaGeoJSON() {
  if (_areaPontos.length < 3) return null
  const anel = _areaPontos.map(p => [p.lng, p.lat])
  anel.push([_areaPontos[0].lng, _areaPontos[0].lat])
  return { type: 'Polygon', coordinates: [anel] }
}

// ── Captura de pontos ─────────────────────────────────────────
// Lê uma posição de alta precisão (uma vez). Reaproveita o GPS do
// brigada-captura.js quando possível; senão usa a Geolocation API.
async function _lerPosicao() {
  if (typeof bGpsUmaLeitura === 'function') return bGpsUmaLeitura()
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('GPS indisponível')); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 15000 }
    )
  })
}

// Modo vértices: adiciona o ponto atual (um toque = um canto).
async function bAreaAddVertice() {
  const p = await _lerPosicao()
  _areaPontos.push({ lat: p.lat, lng: p.lng, acc: p.acc ?? null })
  return p
}

// Modo perímetro: grava pontos automaticamente enquanto caminha.
// Só registra quando o brigadista se afasta _areaMinDist do último
// ponto, para reduzir o "zigue-zague" do GPS parado.
function bAreaIniciarPerimetro(onAtualizar) {
  if (!('geolocation' in navigator)) return false
  bAreaPararPerimetro()
  _areaWatchId = navigator.geolocation.watchPosition(
    pos => {
      const novo = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }
      const ult = _areaPontos[_areaPontos.length - 1]
      if (!ult || _distM(ult, novo) >= _areaMinDist) {
        _areaPontos.push(novo)
        if (onAtualizar) onAtualizar(bAreaCalcular())
      }
    },
    err => console.warn('[brigada-area] perímetro GPS:', err),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  )
  return true
}

function bAreaPararPerimetro() {
  if (_areaWatchId != null) { navigator.geolocation.clearWatch(_areaWatchId); _areaWatchId = null }
}

function bAreaPerimetroAtivo() { return _areaWatchId != null }

// ── Desenho do polígono (sem mapa/tiles) ──────────────────────
// Esboço dos pontos num canvas, escalado para caber — só para o
// brigadista conferir o formato. Não é um mapa georreferenciado.
function bAreaDesenhar(canvas) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height, pad = 16
  ctx.clearRect(0, 0, W, H)
  const pts = _areaPontos
  if (!pts.length) return

  // Projeta lat/lng para metros locais (equiretangular no centro).
  const latc = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const cosL = Math.cos(latc * _D2R)
  const xy = pts.map(p => ({ x: p.lng * cosL, y: -p.lat }))
  const xs = xy.map(p => p.x), ys = xy.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const escala = Math.min(
    (W - pad * 2) / Math.max(1e-9, maxX - minX),
    (H - pad * 2) / Math.max(1e-9, maxY - minY)
  )
  const offX = (W - (maxX - minX) * escala) / 2
  const offY = (H - (maxY - minY) * escala) / 2
  const px = p => offX + (p.x - minX) * escala
  const py = p => offY + (p.y - minY) * escala

  // Polígono
  if (pts.length >= 2) {
    ctx.beginPath()
    xy.forEach((p, i) => { const X = px(p), Y = py(p); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y) })
    if (pts.length >= 3) ctx.closePath()
    ctx.fillStyle = 'rgba(18,166,106,.18)'
    ctx.strokeStyle = '#12A66A'
    ctx.lineWidth = 2
    if (pts.length >= 3) ctx.fill()
    ctx.stroke()
  }
  // Vértices
  xy.forEach((p, i) => {
    ctx.beginPath()
    ctx.arc(px(p), py(p), i === 0 ? 5 : 4, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? '#C9A84C' : '#0F1A13'
    ctx.fill()
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke()
  })
}

// ── Formatação ────────────────────────────────────────────────
function bAreaFmtArea(ha) {
  if (ha == null) return '—'
  if (ha < 1) return `${Math.round(ha * 10000)} m²`
  return `${ha.toFixed(2)} ha`
}
function bAreaFmtDist(m) {
  if (m == null) return '—'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}
