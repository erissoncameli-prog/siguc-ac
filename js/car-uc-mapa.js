// ── SIGUC-AC · Relatório "CAR na UC" — mapa por titular ──────────────
// Com "Agrupar por titular" ligado, cada titular com 2+ CARs no recorte
// ganha um mapa logo abaixo do cabeçalho do grupo: a UC (limite + zonas)
// com os polígonos dele numerados como as linhas da tabela, e — quando a
// consulta pediu os CARs do mesmo CPF/CNPJ fora da UC — um 2º painel com
// o Acre inteiro mostrando onde estão os de fora (um CAR em outro
// município deixaria a UC minúscula se coubesse tudo num quadro só).
//
// Fonte ÚNICA do desenho: a tela usa o SVG daqui e o PDF rasteriza o
// MESMO SVG (carucMapaSvgParaImagem) — tela e documento nunca divergem.
//
// Fundo de satélite = Esri World Imagery, montado em canvas a partir dos
// ladrilhos. É a fonte que deixa copiar para o PDF (responde com CORS);
// o híbrido do Google do Mapa das UCs não deixa (o canvas fica
// "contaminado" e toDataURL falha). Se o satélite falhar (rede, CORS),
// o mapa cai para o desenho sem fundo e diz isso — nunca some.
//
// Projeção Web Mercator (a mesma dos ladrilhos), para o vetor casar com
// a imagem pixel a pixel.

const CARUC_MAPA_TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const CARUC_MAPA_CREDITO = 'Imagem de fundo: Esri World Imagery (Esri, Maxar, Earthstar Geographics)'
const CARUC_MAPA_UC = { w: 600, h: 340 }
const CARUC_MAPA_ACRE = { w: 300, h: 340 }
const CARUC_MAPA_MIN_CARS = 2          // decisão do usuário: 2 ou mais CARs no recorte
const CARUC_MAPA_MAX_TILES = 48
const CARUC_MAPA_ROTULOS_FORA = 15     // acima disso, os de fora viram só pontos (sem "F12" empilhado)

const CARUC_MAPA_COR = {
  satelite: { uc: '#FFFFFF', zona: 'rgba(255,255,255,.55)', zonaFill: ['rgba(255,255,255,.10)', 'rgba(255,255,255,.04)'],
    car: '#FACC15', carFill: 'rgba(250,204,21,.30)', rotFundo: '#0A1A0F', rotTexto: '#FACC15',
    fora: '#F59E0B', foraBorda: '#FFFFFF', texto: '#FFFFFF', acreFill: 'none' },
  sem: { fundo: '#EEF1EA', uc: '#0A1A0F', zona: 'rgba(10,26,15,.55)', zonaFill: ['#B7D7C1', '#DCEBC9'],
    car: '#9A3412', carFill: 'rgba(234,88,12,.35)', rotFundo: '#FFFFFF', rotTexto: '#9A3412',
    fora: '#B45309', foraBorda: '#FFFFFF', texto: '#0A1A0F', acreFill: '#FFFFFF' },
}

// ── Projeção ─────────────────────────────────────────────────────────
function carucMercX(lon) { return (lon + 180) / 360 }
function carucMercY(lat) {
  const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}

function _carucMapaCoords(geom, cb) {
  if (!geom) return
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []
  for (const p of polys) for (const anel of p) for (const c of anel) cb(c[0], c[1])
}

function carucMapaBbox(geoms) {
  let b = null
  for (const g of geoms) _carucMapaCoords(g, (x, y) => {
    if (!b) b = [x, y, x, y]
    else { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y }
  })
  return b
}

// Enquadra a bbox num quadro w×h preservando a proporção (sobra vira
// margem, nunca distorção) e devolve a vista — a mesma que posiciona os
// ladrilhos do satélite.
function carucMapaVista(bbox, w, h, folga = 0.06) {
  const x0 = carucMercX(bbox[0]), x1 = carucMercX(bbox[2])
  const y0 = carucMercY(bbox[3]), y1 = carucMercY(bbox[1])
  const mw = Math.max(x1 - x0, 1e-9), mh = Math.max(y1 - y0, 1e-9)
  const escala = Math.min(w * (1 - 2 * folga) / mw, h * (1 - 2 * folga) / mh)
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const vista = { w, h, escala, mx0: cx - w / escala / 2, my0: cy - h / escala / 2, latCentro: (bbox[1] + bbox[3]) / 2 }
  vista.proj = (lon, lat) => [(carucMercX(lon) - vista.mx0) * escala, (carucMercY(lat) - vista.my0) * escala]
  return vista
}

function _carucMapaPath(geom, proj) {
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : []
  let d = ''
  for (const p of polys) for (const anel of p) {
    anel.forEach((c, k) => { const [x, y] = proj(c[0], c[1]); d += (k ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1) })
    d += 'Z'
  }
  return d
}

// Ponto do rótulo: centro da bbox do MAIOR anel externo (o centróide de
// um polígono em "C" cairia fora dele; a bbox do anel maior basta para
// um número de 18 px).
function _carucMapaCentro(geom, proj) {
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : []
  let melhor = null, area = -1
  for (const p of polys) {
    const b = carucMapaBbox([{ type: 'Polygon', coordinates: [p[0]] }])
    if (!b) continue
    const a = (b[2] - b[0]) * (b[3] - b[1])
    if (a > area) { area = a; melhor = b }
  }
  return melhor ? proj((melhor[0] + melhor[2]) / 2, (melhor[1] + melhor[3]) / 2) : null
}

function _carucMapaEsc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// Barra de escala com comprimento "redondo" (1, 2, 5 × 10^n) perto de 80 px.
function _carucMapaEscala(vista, cor) {
  const mPorPx = 40075016.686 * Math.cos(vista.latCentro * Math.PI / 180) / vista.escala
  const alvo = mPorPx * 80
  const p10 = Math.pow(10, Math.floor(Math.log10(alvo)))
  const m = [1, 2, 5, 10].map(k => k * p10).reduce((a, b) => Math.abs(b - alvo) < Math.abs(a - alvo) ? b : a)
  const px = m / mPorPx
  const rot = m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR')} km` : `${m} m`
  return `<g transform="translate(14,${vista.h - 14})"><rect width="${px.toFixed(1)}" height="4" fill="${cor}"/>`
    + `<text y="-5" font-size="10" font-family="DM Sans,Arial,sans-serif" fill="${cor}">0 · ${rot}</text></g>`
}

function _carucMapaNorte(vista, cor) {
  return `<g transform="translate(${vista.w - 22},26)"><path d="M0,-13 L6,6 L0,2 L-6,6 Z" fill="${cor}"/>`
    + `<text y="19" text-anchor="middle" font-size="10" font-weight="700" font-family="DM Sans,Arial,sans-serif" fill="${cor}">N</text></g>`
}

function _carucMapaAbrir(vista, fundo, cores, rotulo) {
  const base = fundo
    ? `<image href="${fundo}" xlink:href="${fundo}" x="0" y="0" width="${vista.w}" height="${vista.h}" preserveAspectRatio="none"/>`
    : `<rect width="${vista.w}" height="${vista.h}" fill="${cores.fundo || '#EEF1EA'}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${vista.w} ${vista.h}" width="${vista.w}" height="${vista.h}" role="img" aria-label="${_carucMapaEsc(rotulo)}">${base}`
}

// ── Os dois quadros de um titular ────────────────────────────────────
// dados = { uc: geometry, zonas: [geometry], cars: [{ rot, cod, geom }],
//           fora: [{ rot, cod, geom }], acre: geometry|null }
// Devolve as vistas (para o satélite) — o SVG sai de carucMapaSVGs.
function carucMapaVistas(dados) {
  const geomsUC = [dados.uc, ...dados.cars.map(c => c.geom)].filter(Boolean)
  const bUC = carucMapaBbox(geomsUC)
  const vistas = { uc: bUC ? carucMapaVista(bUC, CARUC_MAPA_UC.w, CARUC_MAPA_UC.h) : null, acre: null }
  if (dados.fora?.length) {
    const bA = carucMapaBbox([dados.acre, dados.uc, ...dados.fora.map(f => f.geom)].filter(Boolean))
    if (bA) vistas.acre = carucMapaVista(bA, CARUC_MAPA_ACRE.w, CARUC_MAPA_ACRE.h, 0.05)
  }
  return vistas
}

function carucMapaSVGs(dados, vistas, opts = {}) {
  const sat = opts.fundo === 'satelite'
  const fundoUC = sat ? opts.imagemUC : null
  const fundoAcre = sat ? opts.imagemAcre : null
  const out = { uc: null, acre: null }

  if (vistas.uc) {
    const v = vistas.uc, cor = CARUC_MAPA_COR[fundoUC ? 'satelite' : 'sem']
    let s = _carucMapaAbrir(v, fundoUC, cor, `Mapa da UC com ${dados.cars.length} CAR(s) do titular`)
    dados.zonas.forEach((z, k) => {
      s += `<path d="${_carucMapaPath(z, v.proj)}" fill="${cor.zonaFill[k % 2]}" fill-rule="evenodd" stroke="${cor.zona}" stroke-width="1" stroke-dasharray="5 4"/>`
    })
    if (dados.uc) s += `<path d="${_carucMapaPath(dados.uc, v.proj)}" fill="none" stroke="${cor.uc}" stroke-width="2.6" fill-rule="evenodd"/>`
    // CARs de fora que caem no quadro da UC (vizinhos dela) também aparecem aqui.
    for (const f of (dados.fora || [])) {
      s += `<path d="${_carucMapaPath(f.geom, v.proj)}" fill="none" stroke="${cor.fora}" stroke-width="1.6" stroke-dasharray="3 3"><title>${_carucMapaEsc(f.rot + ' · ' + f.cod)} (fora da UC)</title></path>`
    }
    for (const c of dados.cars) {
      s += `<path d="${_carucMapaPath(c.geom, v.proj)}" fill="${cor.carFill}" fill-rule="evenodd" stroke="${cor.car}" stroke-width="2"><title>${_carucMapaEsc(c.rot + ' · ' + c.cod)}</title></path>`
    }
    for (const c of dados.cars) {
      const p = _carucMapaCentro(c.geom, v.proj)
      if (!p) continue
      s += `<g><circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="10" fill="${cor.rotFundo}" stroke="${cor.car}" stroke-width="1.5"/>`
        + `<text x="${p[0].toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" font-family="DM Sans,Arial,sans-serif" fill="${cor.rotTexto}">${_carucMapaEsc(c.rot)}</text></g>`
    }
    s += _carucMapaNorte(v, cor.texto) + _carucMapaEscala(v, cor.texto) + '</svg>'
    out.uc = s
  }

  if (vistas.acre) {
    const v = vistas.acre, cor = CARUC_MAPA_COR[fundoAcre ? 'satelite' : 'sem']
    let s = _carucMapaAbrir(v, fundoAcre, cor, `Acre com ${dados.fora.length} CAR(s) do titular fora da UC`)
    if (dados.acre) s += `<path d="${_carucMapaPath(dados.acre, v.proj)}" fill="${cor.acreFill}" stroke="${cor.uc}" stroke-width="1.6"/>`
    if (dados.uc) s += `<path d="${_carucMapaPath(dados.uc, v.proj)}" fill="${cor.carFill}" stroke="${cor.car}" stroke-width="1.4"><title>UC</title></path>`
    const rotular = dados.fora.length <= CARUC_MAPA_ROTULOS_FORA
    for (const f of dados.fora) {
      s += `<path d="${_carucMapaPath(f.geom, v.proj)}" fill="${cor.fora}" stroke="${cor.fora}" stroke-width="1"/>`
      const p = _carucMapaCentro(f.geom, v.proj)
      if (!p) continue
      // Na escala do estado o imóvel some: o ponto é o que se vê.
      s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="${cor.fora}" stroke="${cor.foraBorda}" stroke-width="1.2"><title>${_carucMapaEsc(f.rot + ' · ' + f.cod)}</title></circle>`
      if (rotular) s += `<text x="${(p[0] + 6).toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" font-size="10" font-weight="700" font-family="DM Sans,Arial,sans-serif" fill="${cor.texto}" stroke="${fundoAcre ? '#000' : '#fff'}" stroke-width="2.5" paint-order="stroke">${_carucMapaEsc(f.rot)}</text>`
    }
    s += _carucMapaNorte(v, cor.texto) + '</svg>'
    out.acre = s
  }
  return out
}

// ── Satélite (Esri) ──────────────────────────────────────────────────
const _carucFundoCache = new Map()

function _carucCarregarTile(url, ms = 10000) {
  return new Promise(res => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const t = setTimeout(() => { img.src = ''; res(null) }, ms)
    img.onload = () => { clearTimeout(t); res(img) }
    img.onerror = () => { clearTimeout(t); res(null) }
    img.src = url
  })
}

// Monta o fundo de satélite da vista em resolução `fator`× (o PDF usa a
// mesma imagem, então nasce nítida). Devolve dataURL JPEG ou null.
async function carucMapaFundoSatelite(vista, fator = 2) {
  const W = Math.round(vista.w * fator), H = Math.round(vista.h * fator)
  const mw = vista.w / vista.escala
  let z = Math.max(1, Math.min(18, Math.ceil(Math.log2(W / (256 * mw)))))
  const contar = zz => {
    const mundo = 256 * 2 ** zz
    return (Math.floor((vista.mx0 + mw) * mundo / 256) - Math.floor(vista.mx0 * mundo / 256) + 1)
      * (Math.floor((vista.my0 + vista.h / vista.escala) * mundo / 256) - Math.floor(vista.my0 * mundo / 256) + 1)
  }
  while (z > 1 && contar(z) > CARUC_MAPA_MAX_TILES) z--
  const chave = [z, W, H, vista.mx0.toFixed(9), vista.my0.toFixed(9), vista.escala.toFixed(3)].join('|')
  if (_carucFundoCache.has(chave)) return _carucFundoCache.get(chave)

  const prom = (async () => {
    const mundo = 256 * 2 ** z
    const s = W / (mw * mundo)               // px de saída por px do ladrilho
    const px0 = vista.mx0 * mundo, py0 = vista.my0 * mundo
    const tx0 = Math.floor(px0 / 256), tx1 = Math.floor((px0 + mw * mundo) / 256)
    const ty0 = Math.max(0, Math.floor(py0 / 256)), ty1 = Math.min(2 ** z - 1, Math.floor((py0 + H / s) / 256))
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#1d2b20'; ctx.fillRect(0, 0, W, H)
    const pedidos = []
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const txw = ((tx % 2 ** z) + 2 ** z) % 2 ** z
      const url = CARUC_MAPA_TILE.replace('{z}', z).replace('{y}', ty).replace('{x}', txw)
      pedidos.push(_carucCarregarTile(url).then(img => ({ img, tx, ty })))
    }
    const tiles = await Promise.all(pedidos)
    let ok = 0
    for (const { img, tx, ty } of tiles) {
      if (!img) continue
      ok++
      ctx.drawImage(img, (tx * 256 - px0) * s, (ty * 256 - py0) * s, 256 * s + 0.5, 256 * s + 0.5)
    }
    if (!ok) return null
    try { return canvas.toDataURL('image/jpeg', 0.82) } catch { return null } // sem CORS: canvas contaminado
  })()
  _carucFundoCache.set(chave, prom)
  const r = await prom
  if (!r) _carucFundoCache.delete(chave)   // falha não fica em cache: a próxima tentativa refaz
  return r
}

// ── Limite do Acre (painel dos CARs de fora) ─────────────────────────
let _carucAcrePromise = null
function carucMapaAcre() {
  if (_carucAcrePromise) return _carucAcrePromise
  _carucAcrePromise = fetch('../data/acre_estado.geojson')
    .then(r => r.ok ? r.json() : null)
    .then(gj => {
      const f = gj?.features?.[0] || gj
      const g = f?.geometry || null
      return g && typeof turf !== 'undefined' && turf.simplify
        ? turf.simplify({ type: 'Feature', geometry: g, properties: {} }, { tolerance: 0.005 }).geometry
        : g
    })
    .catch(() => { _carucAcrePromise = null; return null })
  return _carucAcrePromise
}

// ── Monta os dados de um grupo (titular) ─────────────────────────────
function carucMapaGrupoTemMapa(g) {
  return g?.grupo != null && g.imoveis.filter(i => i._mapa).length >= CARUC_MAPA_MIN_CARS
}

function carucMapaDadosGrupo(rel, g, acre) {
  return {
    uc: rel.geo?.uc || null,
    zonas: rel.geo?.zonas || [],
    // Numeração = a das linhas da tabela (só quem tem polígono ganha nº).
    cars: g.imoveis.filter(i => i._mapa).map((i, k) => ({ rot: String(k + 1), cod: i.cod, geom: i._mapa })),
    // F1, F2… seguem a ordem da lista de fora (que mostra todos, com ou sem polígono).
    fora: (g.fora || []).map((f, k) => ({ rot: 'F' + (k + 1), cod: f.cod, geom: f._mapa })).filter(f => f.geom),
    acre: acre || null,
  }
}

// Desenha um grupo: vetor na hora; com satélite, devolve depois a versão
// com fundo (ou o vetor com `semSatelite = true` se a imagem falhou).
async function carucMapaGrupo(rel, g, fundo, acre) {
  const dados = carucMapaDadosGrupo(rel, g, acre)
  const vistas = carucMapaVistas(dados)
  let imagemUC = null, imagemAcre = null, semSatelite = false
  if (fundo === 'satelite') {
    ;[imagemUC, imagemAcre] = await Promise.all([
      vistas.uc ? carucMapaFundoSatelite(vistas.uc) : null,
      vistas.acre ? carucMapaFundoSatelite(vistas.acre) : null,
    ])
    semSatelite = (vistas.uc && !imagemUC) || (vistas.acre && !imagemAcre)
  }
  return { ...carucMapaSVGs(dados, vistas, { fundo, imagemUC, imagemAcre }), dados, semSatelite }
}

// Rasteriza o SVG (o MESMO da tela) para o PDF. Satélite sai JPEG (foto);
// sem fundo, PNG (traço nítido).
function carucMapaSvgParaImagem(svg, fator = 2, jpeg = false) {
  return new Promise((res, rej) => {
    const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
    const w = Number(m?.[1] || 600), h = Number(m?.[2] || 340)
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = w * fator; c.height = h * fator
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      try { res({ dataUrl: c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.85), w, h }) } catch (e) { rej(e) }
    }
    img.onerror = () => rej(new Error('Falha ao desenhar o mapa do titular.'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
}

if (typeof module !== 'undefined') {
  module.exports = {
    carucMercX, carucMercY, carucMapaBbox, carucMapaVista, carucMapaVistas, carucMapaSVGs,
    carucMapaGrupoTemMapa, carucMapaDadosGrupo, CARUC_MAPA_MIN_CARS,
  }
}
