// ── SIGUC-AC · Health Check Endpoint (Regra 4) ───────────────────
// Vercel Serverless Function: GET /api/health
// Retorna 200 (healthy), 207 (degraded) ou 503 (unhealthy).

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
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

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
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
