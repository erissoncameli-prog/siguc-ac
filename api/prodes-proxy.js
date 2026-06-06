// SIGUC-AC · Proxy PRODES/INPE — POST /api/prodes-proxy
// Resolve CORS: busca polígonos de desmatamento do TerraBrasilis server-side.

const PRODES_BASE = 'https://terrabrasilis.dpi.inpe.br/geoserver/prodes-amazonia-nb/wfs';
const TYPE_ANUAL  = 'prodes-amazonia-nb:yearly_deforestation_biome';
const TYPE_HIST   = 'prodes-amazonia-nb:accumulated_deforestation_biome';
const TIMEOUT_MS  = 30000;
const MAX_FEAT    = 2000;

async function fetchWFS(typeName, bbox){
  const [x0, y0, x1, y1] = bbox;
  const url = `${PRODES_BASE}?service=WFS&version=2.0.0&request=GetFeature`
    + `&typeNames=${typeName}&outputFormat=application/json`
    + `&BBOX=${x0},${y0},${x1},${y1},EPSG:4326&count=${MAX_FEAT}`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
  });
  if(!r.ok) throw new Error(`TerraBrasilis HTTP ${r.status} para ${typeName}`);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if(req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if(req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }

  const { bbox } = req.body || {};
  if(!Array.isArray(bbox) || bbox.length !== 4){
    res.status(400).json({ error: 'bbox inválido — esperado [minLon, minLat, maxLon, maxLat]' });
    return;
  }

  try {
    const [anual, historico] = await Promise.allSettled([
      fetchWFS(TYPE_ANUAL, bbox),
      fetchWFS(TYPE_HIST,  bbox),
    ]);

    res.status(200)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'public, max-age=86400') // 24h — dados PRODES mudam anualmente
       .json({
         anual:     anual.status     === 'fulfilled' ? anual.value     : { features: [], error: anual.reason?.message },
         historico: historico.status === 'fulfilled' ? historico.value : { features: [], error: historico.reason?.message },
       });
  } catch(err) {
    res.status(502).json({ error: `Falha ao contatar TerraBrasilis: ${err.message}` });
  }
};
