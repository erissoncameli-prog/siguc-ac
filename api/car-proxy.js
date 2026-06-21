// SIGUC-AC · Proxy CAR/SICAR — GET /api/car-proxy
// Resolve CORS: o browser chama este endpoint, que chama o geoserver.car.gov.br server-side.

const TIMEOUT_MS = 55000; // 55s — dentro do maxDuration de 60s configurado no Vercel

const ALLOWED_HOSTS = [
  'geoserver.car.gov.br',
  'geocar.car.gov.br',
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'Parâmetro url ausente' }); return; }

  let parsed;
  try { parsed = new URL(url); } catch { res.status(400).json({ error: 'URL inválida' }); return; }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    res.status(403).json({ error: `Host não permitido: ${parsed.hostname}` });
    return;
  }

  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const body = await upstream.text();

    res.status(upstream.status)
       .setHeader('Content-Type', contentType)
       .setHeader('Cache-Control', 'public, max-age=3600')
       .end(body);
  } catch (err) {
    res.status(502).json({ error: `Falha ao contatar SICAR: ${err.message}` });
  }
};
