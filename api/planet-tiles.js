// SIGUC-AC · Proxy Planet/NICFI Basemaps — GET /api/planet-tiles?z={z}&x={x}&y={y}&m={mosaico}
// A chave PLANET_API_KEY fica SOMENTE no servidor; o front nunca a recebe.
// Mosaicos são estáticos (1 por mês) → cache agressivo na borda da Vercel.
//
// Uso no Leaflet (template — o L substitui {z}/{x}/{y}):
//   L.tileLayer('/api/planet-tiles?z={z}&x={x}&y={y}&m=planet_medres_visual_2026-05_mosaic')

const PLANET_KEY = process.env.PLANET_API_KEY;
const TILES_BASE = 'https://tiles.planet.com/basemaps/v1/planet-tiles';

// PNG 1×1 transparente — devolvido quando não há chave ou tile indisponível,
// para o mapa nunca quebrar (mostra "vazio" em vez de erro).
const TILE_VAZIO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function tileVazio(res, motivo){
  res.status(200)
     .setHeader('Content-Type', 'image/png')
     .setHeader('Cache-Control', 'public, max-age=300')   // erro/sem-chave: cache curto
     .setHeader('X-Planet-Status', motivo)
     .send(TILE_VAZIO);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if(req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if(req.method !== 'GET'){ res.status(405).json({ error: 'Method not allowed' }); return; }

  if(!PLANET_KEY){ tileVazio(res, 'sem-chave'); return; }

  const { z, x, y, m } = req.query;

  // Validação estrita — evita SSRF / path traversal no nome do mosaico.
  const zi = parseInt(z, 10), xi = parseInt(x, 10), yi = parseInt(y, 10);
  if(!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi) ||
     zi < 0 || zi > 22 || xi < 0 || yi < 0){
    res.status(400).json({ error: 'Parâmetros z/x/y inválidos' }); return;
  }
  if(typeof m !== 'string' || !/^[a-z0-9_\-]{3,80}$/i.test(m)){
    res.status(400).json({ error: 'Nome de mosaico inválido' }); return;
  }

  const url = `${TILES_BASE}/${m}/gmap/${zi}/${xi}/${yi}.png?api_key=${encodeURIComponent(PLANET_KEY)}`;

  try {
    const r = await fetch(url, {
      signal:  AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
    });
    if(!r.ok){ tileVazio(res, `upstream-${r.status}`); return; }

    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200)
       .setHeader('Content-Type', r.headers.get('content-type') || 'image/png')
       // Mosaico é imutável por mês → pode cachear por muito tempo na borda.
       .setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable')
       .send(buf);
  } catch(_){
    tileVazio(res, 'timeout');
  }
};
