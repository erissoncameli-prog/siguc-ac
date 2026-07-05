// SIGUC-AC · Proxy geoespacial consolidado — /api/geo?svc=tile|meteo|overpass
// Um único Serverless Function roteia os três proxies (MapBiomas, Open-Meteo,
// Overpass) para caber no limite de funções do plano da Vercel. Tudo same-origin,
// resolvendo CORS/CSP/service-worker no aparelho.

// ── MapBiomas: tiles de uso do solo (GCS), para classificar combustível ──
const MB_BASE = 'https://storage.googleapis.com/mapbiomas-public/brasil';
const TILE_VAZIO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function handleTile(req, res) {
  const { z, x, y, c } = req.query;
  const zi = parseInt(z, 10), xi = parseInt(x, 10), yi = parseInt(y, 10);
  if (!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi) ||
      zi < 0 || zi > 22 || xi < 0 || yi < 0) {
    res.status(400).json({ error: 'z/x/y inválidos' }); return;
  }
  const col = (typeof c === 'string' && /^\d{1,2}$/.test(c)) ? c : '8';
  const url = `${MB_BASE}/collection-${col}/lclu/coverage/${zi}/${xi}/${yi}.png`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' } });
    if (!r.ok) {
      res.status(200).setHeader('Content-Type', 'image/png').setHeader('Cache-Control', 'public, max-age=300').send(TILE_VAZIO); return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200)
       .setHeader('Content-Type', r.headers.get('content-type') || 'image/png')
       .setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable')
       .send(buf);
  } catch (_) {
    res.status(200).setHeader('Content-Type', 'image/png').setHeader('Cache-Control', 'public, max-age=300').send(TILE_VAZIO);
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const svc = String(req.query.svc || '');
  if (svc === 'tile')     return handleTile(req, res);
  if (svc === 'meteo')    return handleMeteo(req, res);
  if (svc === 'overpass') return handleOverpass(req, res);
  res.status(400).json({ error: 'svc inválido (use tile|meteo|overpass)' });
};
