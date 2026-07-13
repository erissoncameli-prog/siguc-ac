// SIGUC-AC · Lista datas com cena Sentinel-2 disponível — GET /api/sentinel-dates?bbox=w,s,e,n
// Consulta a Catalog API (Copernicus Data Space Ecosystem) server-side
// (credenciais protegidas) e devolve, por dia, a menor cobertura de nuvem
// encontrada na área visível — já formatado para o seletor de data do mapa.

const CDSE_CLIENT_ID     = process.env.CDSE_CLIENT_ID;
const CDSE_CLIENT_SECRET = process.env.CDSE_CLIENT_SECRET;

const TOKEN_URL   = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const CATALOG_URL = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search';

const DIAS_JANELA = 60; // procura cenas nos últimos N dias

let _tokenCache = { token: null, expira: 0 };
async function _obterToken(){
  if(_tokenCache.token && Date.now() < _tokenCache.expira) return _tokenCache.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CDSE_CLIENT_ID,
    client_secret: CDSE_CLIENT_SECRET,
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if(!r.ok) throw new Error(`token-http-${r.status}`);
  const json = await r.json();
  _tokenCache = { token: json.access_token, expira: Date.now() + (json.expires_in - 60) * 1000 };
  return _tokenCache.token;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if(req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if(req.method !== 'GET'){ res.status(405).json({ error: 'Method not allowed' }); return; }

  if(!CDSE_CLIENT_ID || !CDSE_CLIENT_SECRET){
    res.status(200)
       .setHeader('Cache-Control', 'public, max-age=300')
       .json({ disponivel: false, motivo: 'sem-credenciais', datas: [] });
    return;
  }

  const partes = String(req.query.bbox || '').split(',').map(Number);
  if(partes.length !== 4 || partes.some(n => !Number.isFinite(n))){
    res.status(400).json({ error: 'Parâmetro bbox inválido (use oeste,sul,leste,norte)' }); return;
  }
  const [w, s, e, n] = partes;
  if(w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n){
    res.status(400).json({ error: 'bbox fora dos limites geográficos' }); return;
  }

  try {
    const token = await _obterToken();
    const fim = new Date();
    const inicio = new Date(fim.getTime() - DIAS_JANELA * 86400000);
    const payload = {
      collections: ['sentinel-2-l2a'],
      bbox: [w, s, e, n],
      datetime: `${inicio.toISOString()}/${fim.toISOString()}`,
      limit: 100,
      fields: {
        include: ['properties.datetime', 'properties.eo:cloud_cover'],
        exclude: ['geometry', 'assets', 'links'],
      },
    };
    const r = await fetch(CATALOG_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if(!r.ok) throw new Error(`catalog-http-${r.status}`);
    const json = await r.json();
    const features = Array.isArray(json.features) ? json.features : [];

    // Agrupa por dia (YYYY-MM-DD), guardando a menor cobertura de nuvem do dia.
    const porDia = {};
    features.forEach(f => {
      const dt = f.properties?.datetime;
      const nuvemPct = f.properties?.['eo:cloud_cover'];
      if(!dt || typeof nuvemPct !== 'number') return;
      const dia = dt.slice(0, 10);
      if(!(dia in porDia) || nuvemPct < porDia[dia]) porDia[dia] = nuvemPct;
    });
    const datas = Object.entries(porDia)
      .map(([data, nuvem]) => ({ data, nuvem }))
      .sort((a, b) => b.data.localeCompare(a.data));

    res.status(200)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800') // 30min
       .json({ disponivel: datas.length > 0, dias: DIAS_JANELA, datas });
  } catch(err){
    res.status(200)
       .setHeader('Cache-Control', 'public, max-age=120')
       .json({ disponivel: false, motivo: String(err.message || err), datas: [] });
  }
};
