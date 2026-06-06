// SIGUC-AC · Proxy Focos de Calor — GET /api/focos-proxy
// Histórico: consulta focos_calor_ac no Supabase via RPC (bbox do CAR)
// Recentes:  FIRMS VIIRS NRT últimos 3 dias

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://atqtybcsvepdabsvgaly.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const FIRMS_KEY    = '66690c20b8bf3f13bb21f8706e3a75d5';
const FIRMS_BASE   = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if(req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if(req.method !== 'GET'){ res.status(405).json({ error: 'Method not allowed' }); return; }

  const { minLon, minLat, maxLon, maxLat } = req.query;
  if(!minLon || !minLat || !maxLon || !maxLat){
    res.status(400).json({ error: 'Parâmetros: minLon, minLat, maxLon, maxLat' });
    return;
  }

  const x0 = parseFloat(minLon), y0 = parseFloat(minLat);
  const x1 = parseFloat(maxLon), y1 = parseFloat(maxLat);

  // ── 1. Histórico via RPC Supabase ─────────────────────────────────────
  let historico = [];
  try {
    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/focos_por_ano`, {
      method:  'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify({ p_min_lon: x0, p_min_lat: y0, p_max_lon: x1, p_max_lat: y1 }),
      signal: AbortSignal.timeout(10000),
    });
    if(sbRes.ok) historico = await sbRes.json();
  } catch(_){}

  // ── 2. Focos recentes — FIRMS VIIRS NRT (últimos 3 dias) ──────────────
  const bbox = `${x0},${y0},${x1},${y1}`;
  let recentes = { total: 0, focos: [] };
  try {
    const nrtRes = await fetch(
      `${FIRMS_BASE}/${FIRMS_KEY}/VIIRS_NOAA20_NRT/${bbox}/3`,
      { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'SIGUC-AC/1.0' } }
    );
    if(nrtRes.ok){
      const txt  = await nrtRes.text();
      const rows = txt.trim().split('\n').filter(Boolean);
      if(rows.length > 1){
        const h   = rows[0].split(',');
        const idx = k => h.indexOf(k);
        rows.slice(1).forEach(l => {
          const c = l.split(',');
          recentes.focos.push({
            lat:        parseFloat(c[idx('latitude')]),
            lon:        parseFloat(c[idx('longitude')]),
            acq_date:   c[idx('acq_date')],
            confidence: c[idx('confidence')],
            frp:        parseFloat(c[idx('frp')]) || null,
          });
        });
        recentes.total = recentes.focos.length;
      }
    }
  } catch(_){}

  res.status(200)
     .setHeader('Content-Type', 'application/json')
     .setHeader('Cache-Control', 'public, max-age=3600')
     .json({ historico, recentes });
};
