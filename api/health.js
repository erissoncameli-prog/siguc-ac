// ── SIGUC-AC · Health Check + Metrics Endpoint (Regras 4 e 7) ────
// Vercel Serverless Function: GET /api/health
// Retorna 200 (healthy), 207 (degraded) ou 503 (unhealthy).
// /api/metrics (via rewrite no vercel.json) também cai aqui — mesma
// consolidação já usada para /api/health/live, para não ultrapassar
// o limite de Serverless Functions do plano Hobby na Vercel.

// Fallback igual aos proxies (focos-proxy/dof-proxy): se a Vercel não
// tiver as env vars configuradas, usa os valores públicos (URL + chave
// anon — a mesma já exposta em js/config.js). NUNCA usar service_role aqui.
const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://atqtybcsvepdabsvgaly.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cXR5YmNzdmVwZGFic3ZnYWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjMzNzgsImV4cCI6MjA5NTk5OTM3OH0.hWx1AB2rK7xdco1Dgagm0XUOBPQbxZVE614SW4SKoLk';
const CHECK_TIMEOUT_MS  = 5000;
const VERSION           = process.env.npm_package_version || '1.0.0';

async function checkWithTimeout(fn, name) {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)),
    ]);
    return { status: 'healthy', latency: Date.now() - start };
  } catch (err) {
    return { status: 'unhealthy', latency: Date.now() - start, error: err.message };
  }
}

async function checkDatabase() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios?select=id&limit=1`,
    {
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function checkSupabaseAuth() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
    headers: { apikey: SUPABASE_ANON_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Métricas (ex-api/metrics.js) — snapshots enviados pelo cliente ─
const _metricsStore = { snapshots: [] };

async function handleMetrics(req, res) {
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const snapshot = JSON.parse(body);
      _metricsStore.snapshots.push({ ...snapshot, receivedAt: new Date().toISOString() });
      if (_metricsStore.snapshots.length > 100) _metricsStore.snapshots.shift();
      res.status(202).json({ ok: true });
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
    }
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      snapshots: _metricsStore.snapshots.slice(-10),
      total: _metricsStore.snapshots.length,
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = async (req, res) => {
  const path = req.url.split('?')[0];

  if (path.endsWith('/metrics')) {
    await handleMetrics(req, res);
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // /api/health/live (via rewrite no vercel.json) — só confirma que o
  // processo está vivo, sem checar dependências externas.
  if (path.endsWith('/live')) {
    res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
    return;
  }

  const startAll = Date.now();

  const [database, auth] = await Promise.all([
    checkWithTimeout(checkDatabase,     'database'),
    checkWithTimeout(checkSupabaseAuth, 'auth'),
  ]);

  const checks = { database, auth };

  const allHealthy  = Object.values(checks).every(c => c.status === 'healthy');
  const anyHealthy  = Object.values(checks).some(c  => c.status === 'healthy');
  const overallStatus = allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy';

  const httpStatus = allHealthy ? 200 : anyHealthy ? 207 : 503;

  res.status(httpStatus).json({
    status:  overallStatus,
    version: VERSION,
    uptime:  Math.floor(process.uptime()),
    totalLatency: Date.now() - startAll,
    checks,
    timestamp: new Date().toISOString(),
  });
};
