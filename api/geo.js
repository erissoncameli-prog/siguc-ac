// SIGUC-AC · Proxy geoespacial consolidado — /api/geo?svc=tile|meteo|overpass|wayback
// Um único Serverless Function roteia os proxies (MapBiomas, Open-Meteo,
// Overpass, Esri Wayback) para caber no limite de funções do plano da Vercel. Tudo same-origin,
// resolvendo CORS/CSP/service-worker no aparelho.

// ── MapBiomas: uso e cobertura do solo POR ANO (Coleção 11, 1985–2025) ──
// GET /api/geo?svc=tile&ano=AAAA&z&x&y → PNG 256×256 de paleta, cores oficiais.
// Antes buscava `collection-8/lclu/coverage/{z}/{x}/{y}.png`, caminho que NÃO
// existe no bucket da MapBiomas (404 em todo pedido → tile vazio em silêncio).
// O desenho a partir do COG oficial vive em api/_mapbiomas-cog.js.
// `c` (coleção) dos chamadores antigos é ignorado; sem `ano` = o mais recente.
const MB = require('./_mapbiomas-cog.js');
const TILE_VAZIO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function tileVazio(res, motivo) {
  res.status(200).setHeader('Content-Type', 'image/png').setHeader('Cache-Control', 'public, max-age=300')
     .setHeader('X-Mapbiomas-Status', motivo).send(TILE_VAZIO);
}

async function handleTile(req, res) {
  const { z, x, y } = req.query;
  const zi = parseInt(z, 10), xi = parseInt(x, 10), yi = parseInt(y, 10);
  if (!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi) ||
      zi < 0 || zi > 22 || xi < 0 || yi < 0 || xi >= 2 ** zi || yi >= 2 ** zi) {
    res.status(400).json({ error: 'z/x/y inválidos' }); return;
  }
  const ano = req.query.ano === undefined ? MB.LEGENDA.ano_max : parseInt(req.query.ano, 10);
  if (!MB.anoValido(ano)) { res.status(400).json({ error: `ano fora da série (${MB.LEGENDA.ano_min}–${MB.LEGENDA.ano_max})` }); return; }
  // acima do zoom 13 o pixel de 30 m já é maior que o do tile: o Leaflet amplia
  // o tile do 13 (maxNativeZoom) e nunca pede este — recusa, por garantia.
  if (zi > 14) { tileVazio(res, 'zoom-acima-do-nativo'); return; }
  try {
    const png = await MB.mbTilePng(ano, zi, xi, yi);
    res.status(200)
       .setHeader('Content-Type', 'image/png')
       // ano publicado não muda dentro da coleção → cache longo na borda
       .setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable')
       .send(png);
  } catch (err) {
    const motivo = String((err && err.message) || 'erro').replace(/[^\w.-]/g, '-').slice(0, 60);
    console.error('[geo] mapbiomas', ano, zi, xi, yi, motivo);
    tileVazio(res, motivo);
  }
}

// ── Open-Meteo: elevação e vento (forecast/archive) ──────────────────────
const METEO_HOSTS = {
  elevation: 'https://api.open-meteo.com/v1/elevation',
  forecast:  'https://api.open-meteo.com/v1/forecast',
  archive:   'https://archive-api.open-meteo.com/v1/archive',
};
const METEO_PARAMS = {
  latitude:      /^-?\d{1,3}(\.\d+)?(,-?\d{1,3}(\.\d+)?)*$/,
  longitude:     /^-?\d{1,3}(\.\d+)?(,-?\d{1,3}(\.\d+)?)*$/,
  start_date:    /^\d{4}-\d{2}-\d{2}$/,
  end_date:      /^\d{4}-\d{2}-\d{2}$/,
  past_days:     /^\d{1,3}$/,
  forecast_days: /^\d{1,2}$/,
  timezone:      /^[A-Za-z0-9_\/+-]{1,40}$/,
  hourly:        /^[a-z0-9_,]{1,120}$/,
};

async function handleMeteo(req, res) {
  const base = METEO_HOSTS[String(req.query.service || '')];
  if (!base) { res.status(400).json({ error: 'service inválido' }); return; }
  const qs = new URLSearchParams();
  for (const [k, rx] of Object.entries(METEO_PARAMS)) {
    const v = req.query[k];
    if (v == null) continue;
    if (typeof v !== 'string' || !rx.test(v)) { res.status(400).json({ error: `parâmetro inválido: ${k}` }); return; }
    qs.set(k, v);
  }
  try {
    const r = await fetch(`${base}?${qs.toString()}`, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' } });
    const body = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', 'public, max-age=3600').send(body);
  } catch (_) {
    res.status(504).json({ error: 'timeout' });
  }
}

// ── Overpass (OSM): barreiras (hidrografia + estradas), com espelhos ──────
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function handleOverpass(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'use POST' }); return; }
  let ql = '';
  if (req.body && typeof req.body === 'object' && typeof req.body.data === 'string') ql = req.body.data;
  else if (typeof req.body === 'string') {
    const m = /(?:^|&)data=([^&]*)/.exec(req.body);
    ql = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : req.body;
  }
  if (!ql || ql.length > 8000) { res.status(400).json({ error: 'consulta inválida' }); return; }
  for (const url of OVERPASS_MIRRORS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
        body: 'data=' + encodeURIComponent(ql),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) continue;
      const body = await r.text();
      res.status(200).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', 'public, max-age=1800').send(body);
      return;
    } catch (_) { /* próximo espelho */ }
  }
  res.status(504).json({ error: 'todos os espelhos Overpass falharam' });
}

// ── Esri World Imagery Wayback: versões publicadas da foto de satélite ──
// GET /api/geo?svc=wayback&op=lista → [{num, data}] (mais recente primeiro)
// GET /api/geo?svc=wayback&op=mudancas&lat&lng&z → só as versões em que a foto
//   DAQUELE ponto mudou, com a data de captura quando a Esri informa.
// Passa pelo servidor porque o CSP do site não libera esses domínios em
// connect-src (e não deve — são de terceiro); os tiles em si vão direto
// pelo <img> (img-src https:). Gratuito, sem chave.
const WB_CONFIG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const WB_TILEMAP = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap';
let _wbCache = null;

async function wbVersoes() {
  if (_wbCache && Date.now() - _wbCache.em < 6 * 3600e3) return _wbCache.lista;
  const r = await fetch(WB_CONFIG, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`wb-config-${r.status}`);
  const cfg = await r.json();
  const lista = Object.entries(cfg).map(([num, v]) => {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(v.itemTitle || '');
    return { num: Number(num), data: m ? m[1] : null, meta: v.metadataLayerUrl || null };
  }).filter(v => v.data).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.num - a.num));
  _wbCache = { em: Date.now(), lista };
  return lista;
}

function wbTileXY(lat, lng, z) {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return { x: Math.floor((lng + 180) / 360 * n), y: Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n) };
}

// Data de captura no ponto (camada de metadados da própria versão). O
// serviço tem uma subcamada por zoom — id = 23 − zoom (0 = zoom 23, o mais
// detalhado), como no app Wayback da Esri; em área remota a subcamada do zoom
// pode vir vazia, então tenta as vizinhas (mais grossas primeiro).
async function wbCaptura(metaUrl, lat, lng, z) {
  if (!metaUrl) return null;
  const q = 'query?f=json&returnGeometry=false&spatialRel=esriSpatialRelIntersects&geometryType=esriGeometryPoint'
    + `&inSR=4326&geometry=${lng},${lat}&outFields=*`;
  const base = Math.max(0, Math.min(13, 23 - z));
  const camadas = [base, base + 1, base + 2, base - 1, base + 3].filter(c => c >= 0 && c <= 13);
  for (const camada of camadas) {
    try {
      const r = await fetch(`${metaUrl}/${camada}/${q}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const a = j && j.features && j.features[0] && j.features[0].attributes;
      if (!a) continue;
      const bruto = a.SRC_DATE2 ?? a.SRC_DATE ?? a.src_date2 ?? a.src_date;
      let data = null;
      if (typeof bruto === 'number') data = new Date(bruto).toISOString().slice(0, 10);
      else if (typeof bruto === 'string' && /^\d{8}$/.test(bruto)) data = `${bruto.slice(0, 4)}-${bruto.slice(4, 6)}-${bruto.slice(6, 8)}`;
      if (!data) continue;
      const res = a.SAMP_RES ?? a.SRC_RES;
      return { data, fonte: a.NICE_DESC || a.SRC_DESC || a.NICE_NAME || null, resolucao_m: typeof res === 'number' ? res : null };
    } catch (_) { /* tenta a próxima subcamada */ }
  }
  return null;
}

async function handleWayback(req, res) {
  try {
    const lista = await wbVersoes();
    if (req.query.op !== 'mudancas') {
      res.status(200).setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600')
         .json({ disponivel: true, versoes: lista.map(({ num, data }) => ({ num, data })) });
      return;
    }
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    const z = Math.min(17, Math.max(10, parseInt(req.query.z, 10) || 14));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
      res.status(400).json({ error: 'lat/lng inválidos' }); return;
    }
    const { x, y } = wbTileXY(lat, lng, z);
    // Mesmo método do app Wayback da Esri: a tilemap de uma versão diz em QUAL
    // versão aquele tile foi publicado pela última vez (select). Pula direto
    // para a versão anterior a essa — poucas chamadas, uma por troca de foto.
    const mudancas = [];
    let i = 0, guarda = 0;
    while (i < lista.length && guarda++ < 60) {
      const v = lista[i];
      const r = await fetch(`${WB_TILEMAP}/${v.num}/${z}/${y}/${x}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`wb-tilemap-${r.status}`);
      const j = await r.json();
      if (!j || !Array.isArray(j.data) || j.data[0] !== 1) break;          // sem foto aqui daqui para trás
      const num = Array.isArray(j.select) && j.select[0] ? Number(j.select[0]) : v.num;
      const k = lista.findIndex(w => w.num === num);
      const dono = k >= 0 ? lista[k] : v;
      if (!mudancas.some(m => m.num === dono.num)) mudancas.push(dono);
      i = (k >= 0 ? k : i) + 1;
    }
    const comCaptura = await Promise.all(mudancas.map(async m => ({
      num: m.num, data: m.data, captura: await wbCaptura(m.meta, lat, lng, z),
    })));
    res.status(200).setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
       .json({ disponivel: true, z, mudancas: comCaptura });
  } catch (err) {
    const motivo = String((err && err.message) || 'erro').slice(0, 80);
    console.error('[geo] wayback', motivo);
    res.status(200).setHeader('Cache-Control', 'public, max-age=120').json({ disponivel: false, motivo });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const svc = String(req.query.svc || '');
  if (svc === 'tile')     return handleTile(req, res);
  if (svc === 'meteo')    return handleMeteo(req, res);
  if (svc === 'overpass') return handleOverpass(req, res);
  if (svc === 'wayback')  return handleWayback(req, res);
  res.status(400).json({ error: 'svc inválido (use tile|meteo|overpass|wayback)' });
};
