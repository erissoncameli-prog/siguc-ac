// ── SIGUC-AC · Query Logger Supabase (Regra 5) ───────────────────
// Wraps the Supabase client para logar tempo e classificar queries.
// Deve ser carregado DEPOIS de observability.js e config.js (antes de db ser usado).

function createInstrumentedDb(client) {
  const SLOW_MS     = 50;
  const CRITICAL_MS = 200;

  function _classify(ms) {
    if (ms > CRITICAL_MS) return 'CRITICAL';
    if (ms > SLOW_MS)     return 'SLOW';
    return 'FAST';
  }

  function _sanitizeParams(params) {
    if (!params) return params;
    const SENSITIVE = /password|senha|token|secret|key|cpf|credit/i;
    if (Array.isArray(params)) return params.map(p => (typeof p === 'string' && SENSITIVE.test(p) ? '[REDACTED]' : p));
    if (typeof params === 'object') {
      return Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : v])
      );
    }
    return params;
  }

  function _wrapPromise(promise, meta) {
    const start = performance.now();
    return promise.then(result => {
      const ms     = Math.round(performance.now() - start);
      const cls    = _classify(ms);
      const level  = cls === 'CRITICAL' ? 'warn' : cls === 'SLOW' ? 'warn' : 'debug';
      const status = result.error ? 500 : 200;

      Observability.logger[level]('DB Query', {
        table:      meta.table,
        operation:  meta.operation,
        ms,
        classification: cls,
        error:      result.error?.message || null,
        params:     _sanitizeParams(meta.params),
        requestId:  Observability.getRequestId(),
      });

      Observability.recordLatency(`db:${meta.table}:${meta.operation}`, ms, status);

      if (cls === 'CRITICAL') {
        Observability._sendAlert('SLOW_QUERY', `Query CRÍTICA ${ms}ms — ${meta.table}.${meta.operation}`);
      }

      return result;
    });
  }

  // Proxy sobre client.from() para interceptar operações terminais
  const originalFrom = client.from.bind(client);
  client.from = function(table) {
    const builder = originalFrom(table);

    const TERMINALS = ['select', 'insert', 'update', 'upsert', 'delete'];
    for (const op of TERMINALS) {
      const original = builder[op]?.bind(builder);
      if (!original) continue;
      builder[op] = function(...args) {
        const qb = original(...args);
        // qb é um PostgrestFilterBuilder que também é uma Promise
        const originalThen = qb.then?.bind(qb);
        if (originalThen) {
          const meta = { table, operation: op, params: args[0] };
          qb.then = function(resolve, reject) {
            return _wrapPromise(originalThen ? { then: originalThen } : qb, meta)
              .then(resolve, reject);
          };
          // Garantir que await funciona sem chamar .then() explicitamente
          qb[Symbol.toStringTag] = 'Promise';
        }
        return qb;
      };
    }
    return builder;
  };

  return client;
}
