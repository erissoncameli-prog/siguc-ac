// ── SIGUC-AC · Metrics Endpoint (Regra 7) ────────────────────────
// GET /api/metrics — expõe métricas coletadas pelo cliente (enviadas via POST)

const _store = { snapshots: [] };

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    // O cliente envia seu snapshot de métricas
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const snapshot = JSON.parse(body);
      _store.snapshots.push({ ...snapshot, receivedAt: new Date().toISOString() });
      if (_store.snapshots.length > 100) _store.snapshots.shift();
      res.status(202).json({ ok: true });
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
    }
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      snapshots: _store.snapshots.slice(-10),
      total: _store.snapshots.length,
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
