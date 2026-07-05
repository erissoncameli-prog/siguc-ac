// SIGUC-AC · Proxy MapBiomas coverage tiles — GET /api/mapbiomas-tile?z={z}&x={x}&y={y}&c={colecao}
// Reserve o tile de uso do solo do MapBiomas (GeoServer/Google Cloud Storage)
// na MESMA ORIGEM, para o navegador ler os pixels (classificar combustível)
// sem barreira de CORS. É o mesmo caminho de tiles já usado no mapa de UCs.

const BASE = 'https://storage.googleapis.com/mapbiomas-public/brasil';

// PNG 1×1 transparente — devolvido quando o tile não existe, para o cliente
// tratar como "sem dado" (não exclui nada) em vez de quebrar.
const TILE_VAZIO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function tileVazio(res, motivo){
  res.status(200)
     .setHeader('Content-Type', 'image/png')
     .setHeader('Cache-Control', 'public, max-age=300')
     .setHeader('X-Mapbiomas-Status', motivo)
     .send(TILE_VAZIO);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if(req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if(req.method !== 'GET'){ res.status(405).json({ error: 'Method not allowed' }); return; }

  const { z, x, y, c } = req.query;
  const zi = parseInt(z, 10), xi = parseInt(x, 10), yi = parseInt(y, 10);
  if(!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi) ||
     zi < 0 || zi > 22 || xi < 0 || yi < 0){
    res.status(400).json({ error: 'Parâmetros z/x/y inválidos' }); return;
  }
  // Coleção: só dígitos (evita SSRF/path traversal). Default 8 (a que já roda no mapa).
  const col = (typeof c === 'string' && /^\d{1,2}$/.test(c)) ? c : '8';

  const url = `${BASE}/collection-${col}/lclu/coverage/${zi}/${xi}/${yi}.png`;

  try {
    const r = await fetch(url, {
      signal:  AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
    });
    if(!r.ok){ tileVazio(res, `upstream-${r.status}`); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200)
       .setHeader('Content-Type', r.headers.get('content-type') || 'image/png')
       // Cobertura anual é imutável → cache longo na borda.
       .setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable')
       .send(buf);
  } catch(_){
    tileVazio(res, 'timeout');
  }
};
