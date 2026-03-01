// pages/api/health.js — диагностика состояния пула БД в реальном времени
const g = globalThis;

export default async function handler(req, res) {
  const t0 = Date.now();

  // Состояние пула до запроса
  const before = {
    pgPool:        !!g._pgPool,
    pgReady:       !!g._pgReady,
    pgInitPromise: !!g._pgInitPromise,
    pgLastError:   g._pgLastError ? new Date(g._pgLastError).toISOString() : null,
    pgLastErrorMs: g._pgLastError ? (Date.now() - g._pgLastError) + 'ms ago' : null,
    warmupStarted: !!g._pgWarmupStarted,
    tableEnsured:  !!g._tableEnsured,
    dataVersion:   g._dataVersion || null,
  };

  // Пробуем выполнить быстрый запрос к БД
  let dbPing = null;
  let dbError = null;
  try {
    if (g._pgPool && g._pgReady) {
      const t1 = Date.now();
      await g._pgPool.query('SELECT 1');
      dbPing = (Date.now() - t1) + 'ms';
    } else {
      dbError = 'pool not ready';
    }
  } catch(e) {
    dbError = e.message;
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    pool: before,
    dbPing,
    dbError,
    totalMs: Date.now() - t0,
  });
}
