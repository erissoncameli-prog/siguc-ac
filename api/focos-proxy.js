// SIGUC-AC · Proxy Focos de Calor — POST /api/focos-proxy
//
// Fontes:
//   alertas_ambientais — dados operacionais coletados diariamente pela
//     Edge Function monitorar-alertas (FIRMS + BDQueimadas + DETER)
//   focos_calor        — histórico bulk importado manualmente (pré-cron)
//
// Body: { bbox: [minLon,minLat,maxLon,maxLat], geojson_poly: <GeoJSON geometry> }
// Response: { porAno, pontos, total, temDados }

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const TIMEOUT_MS    = 20000;

async function rpc(fn, body) {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) return null;
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { geojson_poly } = req.body || {};
  if (!geojson_poly) {
    res.status(400).json({ error: 'geojson_poly obrigatório' });
    return;
  }

  const polyStr = typeof geojson_poly === 'string'
    ? geojson_poly
    : JSON.stringify(geojson_poly);

  const [porAnoResult, pontosResult] = await Promise.allSettled([
    rpc('focos_por_ano_poligono',   { geojson_poly: polyStr }),
    rpc('focos_pontos_poligono_v2', { geojson_poly: polyStr, limite: 500 }),
  ]);

  // Agrupa por ano somando alertas + histórico
  const rawAnos = (porAnoResult.status === 'fulfilled' && Array.isArray(porAnoResult.value))
    ? porAnoResult.value : [];
  const porAno = Object.values(
    rawAnos.reduce((acc, r) => {
      const k = r.ano;
      acc[k] = acc[k] || { ano: k, total: 0 };
      acc[k].total += Number(r.total || 0);
      return acc;
    }, {})
  ).sort((a, b) => a.ano - b.ano);

  const pontos = (pontosResult.status === 'fulfilled' && Array.isArray(pontosResult.value))
    ? pontosResult.value : [];
  const total  = porAno.reduce((s, r) => s + r.total, 0);

  res.status(200)
     .setHeader('Content-Type', 'application/json')
     .setHeader('Cache-Control', 'public, max-age=3600')
     .json({ porAno, pontos, total, temDados: total > 0 });
};
