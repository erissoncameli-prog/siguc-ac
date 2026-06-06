// SIGUC-AC · Proxy Focos de Calor — POST /api/focos-proxy
// Combina histórico (Supabase PostGIS) com NRT recente (FIRMS NASA).
//
// Histórico: RPC focos_por_ano + focos_pontos_poligono via Supabase
// NRT:       FIRMS /usfs/api/area/csv/{MAP_KEY}/VIIRS_SNPP_NRT/{bbox}/10
//            Requer FIRMS_MAP_KEY em env vars (registro gratuito em
//            https://firms.modaps.eosdis.nasa.gov/api/)
//
// Body: { bbox: [minLon,minLat,maxLon,maxLat], geojson_poly: <GeoJSON geometry> }
// Response: { porAno, pontos, nrt, total, temHistorico, temFirmsKey }

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_ANON    = process.env.SUPABASE_ANON_KEY;
const FIRMS_MAP_KEY    = process.env.FIRMS_MAP_KEY;
const TIMEOUT_SUPA_MS  = 20000;
const TIMEOUT_FIRMS_MS = 12000;

async function rpcSupabase(fn, body) {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_SUPA_MS),
  });
  if (!r.ok) return null;
  return r.json();
}

async function queryFirmsNRT(bbox) {
  if (!FIRMS_MAP_KEY) return [];
  const [w, s, e, n] = bbox;
  const url = `https://firms.modaps.eosdis.nasa.gov/usfs/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${w},${s},${e},${n}/10`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_FIRMS_MS) });
  if (!r.ok) return [];

  const text = await r.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  const idx = (name) => headers.indexOf(name);
  const iLat  = idx('latitude');
  const iLon  = idx('longitude');
  const iDate = idx('acq_date');
  const iTime = idx('acq_time');
  const iSat  = idx('satellite');

  return lines.slice(1).map(line => {
    const c = line.split(',');
    const lat = parseFloat(c[iLat]);
    const lon = parseFloat(c[iLon]);
    if (isNaN(lat) || isNaN(lon)) return null;
    const acqDate = c[iDate] || '';
    const acqTime = c[iTime] || '';
    return {
      lat,
      lon,
      data_hora: acqDate ? `${acqDate}T${acqTime.padStart(4,'0').replace(/(\d{2})(\d{2})/, '$1:$2')}:00Z` : null,
      satelite:  c[iSat] || 'VIIRS',
      fonte:     'FIRMS_NRT',
      ano:       acqDate ? parseInt(acqDate.slice(0, 4)) : null,
    };
  }).filter(Boolean);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { bbox, geojson_poly } = req.body || {};
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    res.status(400).json({ error: 'bbox inválido — esperado [minLon, minLat, maxLon, maxLat]' });
    return;
  }

  const polyStr = geojson_poly
    ? (typeof geojson_poly === 'string' ? geojson_poly : JSON.stringify(geojson_poly))
    : null;

  const [porAnoResult, pontosResult, nrtResult] = await Promise.allSettled([
    polyStr ? rpcSupabase('focos_por_ano',         { geojson_poly: polyStr }) : Promise.resolve([]),
    polyStr ? rpcSupabase('focos_pontos_poligono',  { geojson_poly: polyStr, limite: 500 }) : Promise.resolve([]),
    queryFirmsNRT(bbox),
  ]);

  const porAno  = (porAnoResult.status  === 'fulfilled' && Array.isArray(porAnoResult.value))  ? porAnoResult.value  : [];
  const pontos  = (pontosResult.status  === 'fulfilled' && Array.isArray(pontosResult.value))  ? pontosResult.value  : [];
  const nrt     = (nrtResult.status     === 'fulfilled' && Array.isArray(nrtResult.value))     ? nrtResult.value     : [];
  const total   = porAno.reduce((s, r) => s + Number(r.total || 0), 0);

  res.status(200)
     .setHeader('Content-Type', 'application/json')
     .setHeader('Cache-Control', 'public, max-age=3600')
     .json({
       porAno,
       pontos,
       nrt,
       total,
       temHistorico: porAno.length > 0,
       temFirmsKey:  !!FIRMS_MAP_KEY,
     });
};
