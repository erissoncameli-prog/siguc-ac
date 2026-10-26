// ── SIGUC — ZEE Fase III sobre imóveis do CAR ───────────────────────
// Fonte ÚNICA (prefixo `zim`) da pergunta "em que zona, subzona e unidade de
// manejo do ZEE Fase III este imóvel cai?". Usada pelo relatório "CAR na UC"
// (js/car-uc-relatorio.js) e pelo relatório do imóvel aberto pelo Mapa
// (js/relatorio-car.js) — nenhum dos dois recorta o ZEE por conta própria.
//
// - Dado: data/zee/fase3_gestao.geojson (o mesmo da aba ZEE do Mapa; se a
//   aba já baixou, reaproveita). Falha ao baixar = `null`, e o relatório diz
//   que o ZEE não foi conferido — nunca "fora do ZEE".
// - Desempenho: o arquivo tem ~716 mil vértices (raster vetorizado). O ZEE é
//   recortado UMA vez pelo retângulo da área do relatório e partido numa
//   grade (`zimPreparar`); cada imóvel só cruza os pedaços que tocam o
//   retângulo dele.
// - Área = do desenho (turf), em hectares; o ZEE é 1:250 mil e foi
//   simplificado: o resultado orienta, não substitui a análise do imóvel.
// - Situação legal: a Fase III é subsídio aprovado pelo CEMAF, sem lei.

const ZIM_URL = (typeof ZEE_DATA_URL !== 'undefined' ? ZEE_DATA_URL : '../data/zee/') + 'fase3_gestao.geojson'
const ZIM_HA_MIN = 0.01
const ZIM_SITUACAO = 'ZEE Fase III (2020) — aprovado pelo CEMAF, sem lei estadual; subsídio, escala regional'
let _zimPromessa = null

async function zimCarregar() {
  if (typeof _zee !== 'undefined' && _zee.cache && _zee.cache.fase3_gestao) return _zee.cache.fase3_gestao.gj
  if (!_zimPromessa) {
    _zimPromessa = fetch(ZIM_URL).then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(gj => { if (!gj) _zimPromessa = null; return gj })
  }
  return _zimPromessa
}

function _zimBbSobrepoe(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

// bboxClip deixa anéis com menos de 4 pontos e polígonos sem contorno
// externo (o turf.intersect recusa a geometria inteira por um deles): limpa
// e devolve null quando não sobra nada.
function _zimLimpar(f) {
  const g = f && f.geometry
  if (!g) return null
  const anel = r => r && r.length >= 4
  const poli = rs => { if (!anel(rs[0])) return null; return rs.filter(anel) }
  const polis = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).map(poli).filter(Boolean)
  if (!polis.length) return null
  return { type: 'Feature', properties: {}, geometry: polis.length === 1 ? { type: 'Polygon', coordinates: polis[0] } : { type: 'MultiPolygon', coordinates: polis } }
}

// Recorta o ZEE pelo retângulo e parte em células de `passo` graus.
function zimPreparar(gj, bbox, passo = 0.05) {
  const pecas = []
  if (!gj || !bbox) return { pecas }
  const [x0, y0, x1, y1] = bbox
  const base = []
  for (const f of gj.features || []) {
    try {
      if (!_zimBbSobrepoe(turf.bbox(f), bbox)) continue
      const c = _zimLimpar(turf.bboxClip(f, bbox))
      if (c) base.push({ f: c, bb: turf.bbox(c), p: f.properties || {} })
    } catch (_) {}
  }
  for (let x = x0; x < x1; x += passo) {
    for (let y = y0; y < y1; y += passo) {
      const cel = [x, y, Math.min(x + passo, x1), Math.min(y + passo, y1)]
      for (const b of base) {
        if (!_zimBbSobrepoe(b.bb, cel)) continue
        try {
          const c = _zimLimpar(turf.bboxClip(b.f, cel))
          if (c) pecas.push({ f: c, bb: turf.bbox(c), p: b.p })
        } catch (_) {}
      }
    }
  }
  return { pecas }
}

// Classes do ZEE Fase III que o polígono atinge (da mais fina: unidade de
// manejo, senão subzona), com área e % do polígono, maior primeiro.
function zimDoImovel(geom, prep) {
  if (!geom || !prep) return []
  let feat, bb, total
  try {
    feat = geom.type === 'Feature' ? geom : { type: 'Feature', geometry: geom, properties: {} }
    bb = turf.bbox(feat)
    total = turf.area(feat) / 10000
  } catch (_) { return [] }
  const por = new Map()
  for (const pc of prep.pecas) {
    if (!_zimBbSobrepoe(pc.bb, bb)) continue
    let ha = 0
    try { const i = turf.intersect(feat, pc.f); ha = i ? turf.area(i) / 10000 : 0 } catch (_) { ha = 0 }
    if (ha < ZIM_HA_MIN) continue
    const p = pc.p, cod = p.unidade || p.subzona || p.zona_cod
    const ja = por.get(cod)
    if (ja) ja.ha += ha
    else por.set(cod, {
      cod, zona_cod: p.zona_cod, zona: p.zona, subzona: p.subzona, subzona_nome: p.subzona_nome,
      unidade: p.unidade || null, unidade_nome: p.unidade_nome || null, ha,
    })
  }
  return [...por.values()].map(c => ({ ...c, pct: total ? Math.min(100, c.ha / total * 100) : null }))
    .sort((a, b) => b.ha - a.ha)
}

// Rótulo de uma classe: "Unidade 1.1.1 — Áreas com alto potencial…".
function zimRotulo(c) {
  if (c.unidade) return `Unidade ${c.unidade}${c.unidade_nome ? ' — ' + c.unidade_nome : ''}`
  if (c.subzona) return `Subzona ${c.subzona}${c.subzona_nome ? ' — ' + c.subzona_nome : ''}`
  return c.zona || 'Zona ' + c.zona_cod
}

const _zimNum = (v, casas) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

// Texto curto para planilha/CSV: "1.1.1 (12,30 ha · 45,0%); 2.3 (…)".
function zimTexto(lista) {
  return (lista || []).map(c => `${c.cod} (${_zimNum(c.ha, 2)} ha${c.pct != null ? ' · ' + _zimNum(c.pct, 1) + '%' : ''})`).join('; ')
}

// Texto com nomes (PDF, tela): "Unidade 1.1.1 — … (12,30 ha · 45,0%)".
function zimTextoLongo(lista) {
  return (lista || []).map(c => `${zimRotulo(c)} (${_zimNum(c.ha, 2)} ha${c.pct != null ? ' · ' + _zimNum(c.pct, 1) + '%' : ''})`).join('; ')
}
