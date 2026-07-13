// SIGUC-AC · Proxy Sentinel-2 L2A (Copernicus Data Space Ecosystem) —
// GET /api/sentinel-tiles?z={z}&x={x}&y={y}&data=AAAA-MM-DD&nuvem=30
// As credenciais CDSE_CLIENT_ID/CDSE_CLIENT_SECRET ficam SOMENTE no servidor;
// o front nunca as recebe. Renderiza cor real (B04/B03/B02) via Process API,
// filtrando pela data exata escolhida pelo usuário (ver /api/sentinel-dates
// para a lista de datas com cena disponível).
//
// Uso no Leaflet (template — o L substitui {z}/{x}/{y}):
//   L.tileLayer('/api/sentinel-tiles?z={z}&x={x}&y={y}&data=2026-07-10&nuvem=30')

const CDSE_CLIENT_ID     = process.env.CDSE_CLIENT_ID;
const CDSE_CLIENT_SECRET = process.env.CDSE_CLIENT_SECRET;

const TOKEN_URL   = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

const TILE_SIZE = 256;

// PNG 1×1 transparente — devolvido quando não há credenciais ou tile
// indisponível, para o mapa nunca quebrar (mostra "vazio" em vez de erro).
const TILE_VAZIO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function tileVazio(res, motivo){
  res.status(200)
     .setHeader('Content-Type', 'image/png')
     .setHeader('Cache-Control', 'public, max-age=300')
     .setHeader('X-Sentinel-Status', motivo)
     .send(TILE_VAZIO);
}

// Cache do token em memória (dura enquanto a função serverless ficar "quente").
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

// Converte tile z/x/y (slippy map) em bbox EPSG:3857 [minX,minY,maxX,maxY].
function _tileParaBBox3857(z, x, y){
  const ORIGEM = 20037508.342789244;
  const tamanho = (ORIGEM * 2) / Math.pow(2, z);
  const minX = x * tamanho - ORIGEM;
  const maxX = (x + 1) * tamanho - ORIGEM;
  const maxY = ORIGEM - y * tamanho;
  const minY = ORIGEM - (y + 1) * tamanho;
  return [minX, minY, maxX, maxY];
}

const EVALSCRIPT_COR_REAL = `//VERSION=3
function setup() {
  return { input: ["B02","B03","B04"], output: { bands: 3 } };
}
function evaluatePixel(s) {
  return [s.B04 * 2.5, s.B03 * 2.5, s.B02 * 2.5];
}`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if(req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if(req.method !== 'GET'){ res.status(405).json({ error: 'Method not allowed' }); return; }

  if(!CDSE_CLIENT_ID || !CDSE_CLIENT_SECRET){ tileVazio(res, 'sem-credenciais'); return; }

  const { z, x, y, data, nuvem } = req.query;

  // Validação estrita — evita SSRF / parâmetros inválidos no corpo do POST.
  const zi = parseInt(z, 10), xi = parseInt(x, 10), yi = parseInt(y, 10);
  if(!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi) ||
     zi < 0 || zi > 20 || xi < 0 || yi < 0){
    res.status(400).json({ error: 'Parâmetros z/x/y inválidos' }); return;
  }
  if(typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)){
    res.status(400).json({ error: 'Parâmetro data inválido (use AAAA-MM-DD)' }); return;
  }
  const nuvemMax = Math.min(100, Math.max(0, parseInt(nuvem, 10) || 30));

  try {
    const token = await _obterToken();
    const bbox = _tileParaBBox3857(zi, xi, yi);
    const payload = {
      input: {
        bounds: {
          bbox,
          properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/3857' },
        },
        data: [{
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: { from: `${data}T00:00:00Z`, to: `${data}T23:59:59Z` },
            maxCloudCoverage: nuvemMax,
          },
        }],
      },
      output: {
        width: TILE_SIZE,
        height: TILE_SIZE,
        responses: [{ identifier: 'default', format: { type: 'image/png' } }],
      },
      evalscript: EVALSCRIPT_COR_REAL,
    };

    const r = await fetch(PROCESS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    if(!r.ok){ tileVazio(res, `upstream-${r.status}`); return; }

    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200)
       .setHeader('Content-Type', 'image/png')
       // Cena de um dia específico é imutável → cache longo na borda.
       .setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable')
       .send(buf);
  } catch(_){
    tileVazio(res, 'erro');
  }
};
