// ══════════════════════════════════════════════════════════════
// SIGUC-AC · Recorte geográfico do mapa — helper ÚNICO
// ══════════════════════════════════════════════════════════════
// Responde a duas perguntas, e só a elas:
//   1. este ponto está dentro do Acre?
//   2. este ponto está dentro de qual UC?
//
// Existe porque a mesma resposta era calculada (e errada) em dois
// lugares: pages/mapa.html e pages/alertas-ambientais.html tinham
// cada um sua cópia de _pipGeom, e NENHUM dos dois testava o limite
// do estado — por isso focos de calor do Peru, da Bolívia, do
// Amazonas e de Rondônia apareciam no mapa das UCs. Mesma lição do
// js/frota-consumo.js e do js/fotos-privadas.js: cálculo em UM lugar
// só, nunca reimplementado na página.
//
// POR QUE O RECORTE É NECESSÁRIO NO CLIENTE: as duas ingestões
// (supabase/functions/ingest-focos e monitorar-alertas) pedem os
// dados por BOUNDING BOX retangular — um retângulo em volta do Acre
// engloba pedaços de AM, RO, Ucayali (Peru) e Pando (Bolívia). A
// migration 239 passou a barrar isso na origem, mas o cliente segue
// filtrando: é a camada que garante a tela certa mesmo com dado
// antigo em cache ou vindo de outra rota.
//
// Desempenho: o polígono das UCs tem ~49 mil vértices em 21
// features. Testar ponto-em-polígono direto, por ponto e por render,
// com milhares de focos, trava a página. Duas defesas:
//   • bbox pré-calculada por anel — rejeita a esmagadora maioria dos
//     testes com 4 comparações numéricas, antes de tocar no anel;
//   • classificação feita UMA VEZ, na carga do dado (geoClassificar),
//     carimbada no próprio registro; o render só lê o campo pronto.
// ══════════════════════════════════════════════════════════════

// Índices pré-processados: { aneis:[{ring, minX, minY, maxX, maxY}], ... }
let _geoAcre = null      // { aneis } — limite do estado
let _geoUCs  = null      // [{ nome, aneis }] — uma entrada por UC
let _geoMunicipios = null // [{ nome, aneis }] — uma entrada por município
let _geoAcrePromise = null

// ── Ponto em polígono (ray-casting) ───────────────────────────

function _geoPipRing(x, y, ring) {
  let dentro = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) dentro = !dentro
  }
  return dentro
}

// Achata Polygon/MultiPolygon em uma lista de anéis com bbox própria.
// Guarda TODOS os anéis (inclusive buracos): manter a paridade do
// ray-casting é o que faz um ponto dentro de um buraco contar como
// fora do polígono, como deve ser.
function _geoIndexarGeom(geom) {
  if (!geom) return []
  const aneis = geom.type === 'Polygon' ? geom.coordinates
    : geom.type === 'MultiPolygon' ? geom.coordinates.flat(1)
    : []
  return aneis.filter(r => Array.isArray(r) && r.length > 2).map(ring => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of ring) {
      if (c[0] < minX) minX = c[0]
      if (c[0] > maxX) maxX = c[0]
      if (c[1] < minY) minY = c[1]
      if (c[1] > maxY) maxY = c[1]
    }
    return { ring, minX, minY, maxX, maxY }
  })
}

function _geoPipIndexado(x, y, aneis) {
  let dentro = false
  for (const a of aneis) {
    if (x < a.minX || x > a.maxX || y < a.minY || y > a.maxY) continue
    if (_geoPipRing(x, y, a.ring)) dentro = !dentro
  }
  return dentro
}

// ── Limite do estado ──────────────────────────────────────────

// Carrega e indexa data/acre_estado.geojson. Idempotente e seguro
// para chamadas concorrentes (as duas camadas do mapa chamam junto).
function geoAcreCarregar(base = '../data/') {
  if (_geoAcre) return Promise.resolve(_geoAcre)
  if (_geoAcrePromise) return _geoAcrePromise
  _geoAcrePromise = fetch(base + 'acre_estado.geojson')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    .then(gj => {
      const aneis = []
      for (const f of (gj.features || [])) aneis.push(..._geoIndexarGeom(f.geometry))
      _geoAcre = { aneis }
      return _geoAcre
    })
    .catch(e => {
      // FAIL-OPEN: sem o limite carregado, geoNoAcre devolve true e o
      // mapa mostra tudo — nunca uma tela vazia por falha de rede.
      console.warn('[mapa-recorte] limite do Acre indisponível:', e.message)
      _geoAcre = null
      _geoAcrePromise = null
      return null
    })
  return _geoAcrePromise
}

// true = dentro do Acre. Sem o limite carregado, devolve true
// (fail-open — ver geoAcreCarregar).
function geoNoAcre(lat, lng) {
  if (!_geoAcre) return true
  if (!isFinite(lat) || !isFinite(lng)) return false
  return _geoPipIndexado(lng, lat, _geoAcre.aneis)
}

function geoAcreCarregado() { return !!_geoAcre }

// ── Unidades de Conservação ───────────────────────────────────

// Indexa o GeoJSON das UCs já carregado pela página (não busca de
// novo: uc_acre.geojson tem 4,7 MB e a página já o tem em memória).
function geoUCsPreparar(geojson) {
  if (!geojson?.features) { _geoUCs = null; return }
  _geoUCs = geojson.features.map(f => ({
    nome:  f.properties?.nome || f.properties?.NAME || f.properties?.name || '',
    aneis: _geoIndexarGeom(f.geometry)
  })).filter(u => u.aneis.length)
}

function geoUCsPreparadas() { return !!_geoUCs }

// Nome da UC que contém o ponto, ou null. Considera TODAS as UCs —
// o filtro de quais estão visíveis é decisão de render, feita com
// um Set de nomes, sem refazer geometria.
function geoUCEm(lat, lng) {
  if (!_geoUCs || !isFinite(lat) || !isFinite(lng)) return null
  for (const u of _geoUCs) {
    if (_geoPipIndexado(lng, lat, u.aneis)) return u.nome
  }
  return null
}

// ── Municípios ─────────────────────────────────────────────────
// Mesmo mecanismo de geoUCsPreparar/geoUCEm, para um segundo
// conjunto de polígonos (data/municipios_acre.geojson). Existe porque
// o boletim hidrometeorológico (rh-boletim.html) precisa de "focos de
// calor por município" e `focos_calor.municipio` nunca é preenchido
// na ingestão (achado ao construir o boletim: 0 de 291 linhas com o
// campo) — a classificação sempre foi feita por quem monta o boletim
// manualmente, olhando o mapa. Nunca uma segunda implementação de PIP:
// reaproveita _geoIndexarGeom/_geoPipIndexado, só guarda um índice
// nomeado a mais.
function geoMunicipiosPreparar(geojson) {
  if (!geojson?.features) { _geoMunicipios = null; return }
  _geoMunicipios = geojson.features.map(f => ({
    nome:  f.properties?.nome || f.properties?.NM_MUN || f.properties?.NAME || f.properties?.name || '',
    aneis: _geoIndexarGeom(f.geometry)
  })).filter(m => m.aneis.length)
}

function geoMunicipiosPreparados() { return !!_geoMunicipios }

function geoMunicipioEm(lat, lng) {
  if (!_geoMunicipios || !isFinite(lat) || !isFinite(lng)) return null
  for (const m of _geoMunicipios) {
    if (_geoPipIndexado(lng, lat, m.aneis)) return m.nome
  }
  return null
}

// ── Classificação em lote ─────────────────────────────────────

// Carimba _noAcre e _ucNome em cada item da lista, UMA vez, na carga
// do dado. O render depois só lê os campos — é o que mantém o mapa
// fluido com milhares de focos.
// getLatLng: (item) => [lat, lng] | null
// Devolve { total, dentroAcre, foraAcre, emUC, foraUC }.
function geoClassificar(lista, getLatLng) {
  const r = { total: 0, dentroAcre: 0, foraAcre: 0, emUC: 0, foraUC: 0 }
  for (const item of (lista || [])) {
    r.total++
    const c = getLatLng(item)
    const lat = c ? Number(c[0]) : NaN
    const lng = c ? Number(c[1]) : NaN
    if (!isFinite(lat) || !isFinite(lng)) {
      item._noAcre = false
      item._ucNome = null
      r.foraAcre++
      continue
    }
    item._lat = lat
    item._lng = lng
    item._noAcre = geoNoAcre(lat, lng)
    item._ucNome = item._noAcre ? geoUCEm(lat, lng) : null
    if (item._noAcre) {
      r.dentroAcre++
      if (item._ucNome) r.emUC++; else r.foraUC++
    } else {
      r.foraAcre++
    }
  }
  return r
}

// Extrai [lat, lng] de uma coluna geometry do PostGIS servida pelo
// PostgREST — vem como GeoJSON (objeto) ou como texto 'POINT(lng lat)'.
// Os dois formatos aparecem no projeto conforme a coluna/view.
function geoLatLngDeGeom(geom) {
  if (!geom) return null
  try {
    if (typeof geom === 'object' && Array.isArray(geom.coordinates)) {
      return [Number(geom.coordinates[1]), Number(geom.coordinates[0])]
    }
    const m = String(geom).match(/POINT\s*\(([^ ]+) ([^ )]+)\)/i)
    if (m) return [parseFloat(m[2]), parseFloat(m[1])]
  } catch { /* geometria ilegível — trata como sem coordenada */ }
  return null
}

window.geoAcreCarregar   = geoAcreCarregar
window.geoAcreCarregado  = geoAcreCarregado
window.geoNoAcre         = geoNoAcre
window.geoUCsPreparar    = geoUCsPreparar
window.geoUCsPreparadas  = geoUCsPreparadas
window.geoUCEm           = geoUCEm
window.geoMunicipiosPreparar   = geoMunicipiosPreparar
window.geoMunicipiosPreparados = geoMunicipiosPreparados
window.geoMunicipioEm          = geoMunicipioEm
window.geoClassificar    = geoClassificar
window.geoLatLngDeGeom   = geoLatLngDeGeom
