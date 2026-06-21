// SIGUC-AC · Proxy PRODES/INPE — POST /api/prodes-proxy
// Resolve CORS: busca polígonos de desmatamento do TerraBrasilis server-side.
//
// Layers corretos (verificados via GetCapabilities):
//   yearly_deforestation_biome          → desmatamento anual 2008–hoje
//   accumulated_deforestation_2007_biome → acumulado até 2007 (histórico)
// Workspace: prodes-amazon-nb  (não "amazonia")
// Endpoint:  /geoserver/wfs    (global, não workspace-specific)

const WFS_BASE    = 'https://terrabrasilis.dpi.inpe.br/geoserver/wfs';
const TYPE_ANUAL  = 'prodes-amazon-nb:yearly_deforestation_biome';
const TYPE_HIST   = 'prodes-amazon-nb:accumulated_deforestation_2007_biome';
const TIMEOUT_MS  = 55000; // 55s — dentro do maxDuration de 60s configurado no Vercel
const MAX_FEAT    = 2000;

async function fetchWFS(typeName, bbox){
  // WFS 1.1.0 + CRS:84 → ordem lon,lat explícita, sem ambiguidade
  const [x0, y0, x1, y1] = bbox;
  const params = new URLSearchParams({
    service:      'WFS',
    version:      '1.1.0',
    request:      'GetFeature',
    typeName,
    outputFormat: 'application/json',
    srsName:      'CRS:84',
    BBOX:         `${x0},${y0},${x1},${y1},CRS:84`,
    maxFeatures:  MAX_FEAT,
  });
  const url = `${WFS_BASE}?${params}`;
  const r = await fetch(url, {
    signal:  AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
  });
  const text = await r.text();
  // GeoServer retorna XML quando há erro (ex: layer não existe)
  if(text.trimStart().startsWith('<')){
    const match = text.match(/<ows:ExceptionText[^>]*>([\s\S]*?)<\/ows:ExceptionText>/);
    throw new Error(match ? match[1].trim().substring(0,200) : `HTTP ${r.status} — resposta XML inesperada`);
  }
  const json = JSON.parse(text);
  if(!Array.isArray(json.features)) throw new Error('GeoJSON sem features array');
  return json;
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

  const [anualResult, histResult] = await Promise.allSettled([
    fetchWFS(TYPE_ANUAL, bbox),
    fetchWFS(TYPE_HIST,  bbox),
  ]);

  const anual     = anualResult.status === 'fulfilled'
    ? anualResult.value
    : { features: [], _error: anualResult.reason?.message };
  const historico = histResult.status === 'fulfilled'
    ? histResult.value
    : { features: [], _error: histResult.reason?.message };

  res.status(200)
     .setHeader('Content-Type', 'application/json')
     .setHeader('Cache-Control', 'public, max-age=86400')
     .json({ anual, historico });
};
