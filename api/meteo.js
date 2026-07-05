// SIGUC-AC · Proxy Open-Meteo — GET /api/meteo?service=elevation|forecast|archive&...
// Roteia as chamadas de vento/elevação pela MESMA ORIGEM, evitando qualquer
// bloqueio de cross-origin/CSP/service-worker no aparelho. Sem chave (API
// pública). Só repassa parâmetros de uma allowlist (evita SSRF).

const HOSTS = {
  elevation: 'https://api.open-meteo.com/v1/elevation',
  forecast:  'https://api.open-meteo.com/v1/forecast',
  archive:   'https://archive-api.open-meteo.com/v1/archive',
};

// Parâmetro → validador. Só o que os fetchers do app usam.
const PARAMS = {
  latitude:      /^-?\d{1,3}(\.\d+)?(,-?\d{1,3}(\.\d+)?)*$/,
  longitude:     /^-?\d{1,3}(\.\d+)?(,-?\d{1,3}(\.\d+)?)*$/,
  start_date:    /^\d{4}-\d{2}-\d{2}$/,
  end_date:      /^\d{4}-\d{2}-\d{2}$/,
  past_days:     /^\d{1,3}$/,
  forecast_days: /^\d{1,2}$/,
  timezone:      /^[A-Za-z0-9_\/+-]{1,40}$/,
  hourly:        /^[a-z0-9_,]{1,120}$/,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const service = String(req.query.service || '');
  const base = HOSTS[service];
  if (!base) { res.status(400).json({ error: 'service inválido' }); return; }

  const qs = new URLSearchParams();
  for (const [k, rx] of Object.entries(PARAMS)) {
    const v = req.query[k];
    if (v == null) continue;
    if (typeof v !== 'string' || !rx.test(v)) { res.status(400).json({ error: `parâmetro inválido: ${k}` }); return; }
    qs.set(k, v);
  }

  try {
    const r = await fetch(`${base}?${qs.toString()}`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
    });
    const body = await r.text();
    res.status(r.status)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'public, max-age=3600')
       .send(body);
  } catch (_) {
    res.status(504).json({ error: 'timeout' });
  }
};
