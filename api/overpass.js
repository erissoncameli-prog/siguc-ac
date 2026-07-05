// SIGUC-AC · Proxy Overpass (OpenStreetMap) — POST /api/overpass  body: data=<QL>
// Roteia a consulta Overpass pela MESMA ORIGEM (evita cross-origin/CSP/SW no
// aparelho) e tenta VÁRIOS espelhos no servidor — o overpass-api.de vive
// sobrecarregado (429/504). Devolve o primeiro que responder OK.

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Corpo: aceita { data } (JSON) ou body cru "data=...".
  let ql = '';
  if (req.body && typeof req.body === 'object' && typeof req.body.data === 'string') {
    ql = req.body.data;
  } else if (typeof req.body === 'string') {
    const m = /(?:^|&)data=([^&]*)/.exec(req.body);
    ql = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : req.body;
  }
  if (!ql || ql.length > 8000) { res.status(400).json({ error: 'consulta inválida' }); return; }

  for (const url of MIRRORS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
        body: 'data=' + encodeURIComponent(ql),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) continue;                       // espelho ocupado → tenta o próximo
      const body = await r.text();
      res.status(200)
         .setHeader('Content-Type', 'application/json')
         .setHeader('Cache-Control', 'public, max-age=1800')
         .send(body);
      return;
    } catch (_) { /* tenta o próximo espelho */ }
  }
  res.status(504).json({ error: 'todos os espelhos Overpass falharam' });
};
