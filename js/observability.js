// ── SIGUC-AC · Observabilidade (Regras 1-3, 6-7, 9) ──────────────

const Observability = (() => {
  // ── Thresholds configuráveis (Regra 9) ───────────────────────
  const THRESHOLDS = {
    ERROR_RATE:        parseFloat(window.__ENV?.ALERT_ERROR_RATE_THRESHOLD  || '0.05'),
    LATENCY_P99_MS:    parseInt(window.__ENV?.ALERT_LATENCY_P99_THRESHOLD   || '2000'),
    MEMORY_RATIO:      parseFloat(window.__ENV?.ALERT_MEMORY_THRESHOLD      || '0.85'),
    CACHE_MISS_MAX:    parseFloat(window.__ENV?.ALERT_CACHE_MISS_THRESHOLD  || '0.40'),
    WEBHOOK_URL:       window.__ENV?.ALERT_WEBHOOK_URL || null,
  };

  // ── Regra 1 — Request ID único ────────────────────────────────
  function _uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  let _requestId = _uuid();
  const getRequestId = () => _requestId;
  const newRequestId = () => { _requestId = _uuid(); return _requestId; };

  // ── Regra 3 — Logger JSON estruturado ─────────────────────────
  const _logBuffer = [];
  const MAX_BUFFER = 500;

  function _log(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'siguc-ac',
      requestId: getRequestId(),
      message,
      ...data,
    };
    _logBuffer.push(entry);
    if (_logBuffer.length > MAX_BUFFER) _logBuffer.shift();

    const fn = (level === 'error' || level === 'fatal') ? console.error
             : level === 'warn'  ? console.warn
             : level === 'debug' ? console.debug
             : console.info;
    fn(JSON.stringify(entry));
  }

  const logger = {
    debug: (msg, d) => _log('debug', msg, d),
    info:  (msg, d) => _log('info',  msg, d),
    warn:  (msg, d) => _log('warn',  msg, d),
    error: (msg, d) => _log('error', msg, d),
    fatal: (msg, d) => _log('fatal', msg, d),
    getLogs: () => [..._logBuffer],
  };

  // ── Regra 2 — Handler global de erros + stack trace ───────────
  function _setupErrorHandlers() {
    window.onerror = (message, source, lineno, colno, error) => {
      logger.error('Uncaught error', {
        message,
        source: source?.split('/').slice(-2).join('/'),
        lineno,
        colno,
        stack: error?.stack?.substring(0, 800),
      });
      _checkErrorRate();
    };

    window.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason;
      logger.error('Unhandled promise rejection', {
        reason: reason?.message || String(reason),
        stack:  reason?.stack?.substring(0, 800),
      });
      _checkErrorRate();
    });
  }

  // ── Regra 7 — Métricas de performance ────────────────────────
  const metrics = {
    requests: { total: 0, errors: 0 },
    latencySamples: [], // { route, ms, status, ts }
  };

  function recordLatency(route, ms, statusCode) {
    metrics.requests.total++;
    if (statusCode >= 400) metrics.requests.errors++;
    metrics.latencySamples.push({ route, ms, status: statusCode, ts: Date.now() });
    if (metrics.latencySamples.length > 200) metrics.latencySamples.shift();

    const p99 = _percentile(metrics.latencySamples.map(s => s.ms), 99);
    if (p99 > THRESHOLDS.LATENCY_P99_MS) {
      _sendAlert('HIGH_LATENCY_P99', `P99 ${p99}ms excede limite ${THRESHOLDS.LATENCY_P99_MS}ms — rota: ${route}`);
    }
  }

  function _percentile(arr, p) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.ceil((p / 100) * sorted.length) - 1];
  }

  function _collectMemory() {
    if (!performance?.memory) return;
    const m = performance.memory;
    const ratio = m.usedJSHeapSize / m.jsHeapSizeLimit;
    logger.debug('Memory metrics', {
      usedMB:  (m.usedJSHeapSize  / 1024 / 1024).toFixed(1),
      totalMB: (m.totalJSHeapSize / 1024 / 1024).toFixed(1),
      ratio:   ratio.toFixed(2),
    });
    if (ratio > THRESHOLDS.MEMORY_RATIO) {
      _sendAlert('HIGH_MEMORY', `Heap em ${(ratio * 100).toFixed(0)}% do limite`);
    }
  }

  function getMetricsSummary() {
    const samples = metrics.latencySamples.map(s => s.ms);
    return {
      requestsTotal:  metrics.requests.total,
      requestsErrors: metrics.requests.errors,
      errorRate:      metrics.requests.total ? (metrics.requests.errors / metrics.requests.total).toFixed(3) : '0',
      latencyP50:     _percentile(samples, 50),
      latencyP95:     _percentile(samples, 95),
      latencyP99:     _percentile(samples, 99),
      cacheHits:      cacheStats.hits,
      cacheMisses:    cacheStats.misses,
      cacheHitRate:   _cacheHitRate().toFixed(2),
    };
  }

  // ── Regra 6 — Cache hit/miss tracking ────────────────────────
  const _memCache = new Map();
  const cacheStats = { hits: 0, misses: 0 };

  function cacheGet(key) {
    const entry = _memCache.get(key);
    if (entry && entry.expires > Date.now()) {
      cacheStats.hits++;
      _logCacheStats();
      return entry.value;
    }
    if (entry) _memCache.delete(key);
    cacheStats.misses++;
    _logCacheStats();
    return null;
  }

  function cacheSet(key, value, ttlMs = 60_000) {
    _memCache.set(key, { value, expires: Date.now() + ttlMs });
    setTimeout(() => _memCache.delete(key), ttlMs);
  }

  function cacheClear(key) {
    if (key) _memCache.delete(key);
    else _memCache.clear();
  }

  function _cacheHitRate() {
    const total = cacheStats.hits + cacheStats.misses;
    return total ? cacheStats.hits / total : 1;
  }

  function _logCacheStats() {
    const total = cacheStats.hits + cacheStats.misses;
    if (total > 0 && total % 20 === 0) {
      const hitRate = _cacheHitRate();
      logger.info('Cache stats', { hits: cacheStats.hits, misses: cacheStats.misses, hitRate: hitRate.toFixed(2) });
      if (1 - hitRate > THRESHOLDS.CACHE_MISS_MAX) {
        _sendAlert('HIGH_CACHE_MISS', `Miss rate ${((1 - hitRate) * 100).toFixed(0)}% excede limite ${(THRESHOLDS.CACHE_MISS_MAX * 100)}%`);
      }
    }
  }

  // ── Regra 9 — Alertas ────────────────────────────────────────
  const _alertCooldowns = new Map();
  const ALERT_COOLDOWN_MS = 60_000;

  function _sendAlert(name, message) {
    const lastSent = _alertCooldowns.get(name) || 0;
    if (Date.now() - lastSent < ALERT_COOLDOWN_MS) return;
    _alertCooldowns.set(name, Date.now());

    logger.fatal(`ALERT: ${name}`, { alertName: name, message });

    if (THRESHOLDS.WEBHOOK_URL) {
      fetch(THRESHOLDS.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `🚨 [SIGUC-AC] ${name}: ${message}` }),
      }).catch(() => {});
    }
  }

  function _checkErrorRate() {
    if (!metrics.requests.total) return;
    const rate = metrics.requests.errors / metrics.requests.total;
    if (rate > THRESHOLDS.ERROR_RATE) {
      _sendAlert('HIGH_ERROR_RATE', `Taxa de erro ${(rate * 100).toFixed(1)}% excede limite ${(THRESHOLDS.ERROR_RATE * 100)}%`);
    }
  }

  // ── Init (idempotente) ────────────────────────────────────────
  let _initialized = false;
  function init() {
    if (_initialized) return;
    _initialized = true;
    _setupErrorHandlers();
    setInterval(_collectMemory, 30_000);
    logger.info('Observability initialized', { thresholds: THRESHOLDS });
  }

  return {
    init,
    logger,
    getRequestId,
    newRequestId,
    cacheGet,
    cacheSet,
    cacheClear,
    cacheStats,
    recordLatency,
    getMetricsSummary,
    _sendAlert,
  };
})();
