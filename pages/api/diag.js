// pages/api/diag.js — полная диагностика производительности
// GET /api/diag — собирает все метрики и возвращает JSON

import fs from 'fs';
import path from 'path';

const g = globalThis;

export default async function handler(req, res) {
  const t0 = Date.now();
  const timeline = [];
  const mark = (label) => timeline.push({ label, ms: Date.now() - t0 });

  // ── 1. Состояние процесса ───────────────────────────────────────────────
  mark('start');
  const mem = process.memoryUsage();
  const processInfo = {
    uptime: Math.round(process.uptime()) + 's',
    uptimeMs: Math.round(process.uptime() * 1000),
    pid: process.pid,
    nodeVersion: process.version,
    env: process.env.NODE_ENV || 'unknown',
    memory: {
      heapUsed:  Math.round(mem.heapUsed  / 1024 / 1024) + 'MB',
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
      rss:       Math.round(mem.rss       / 1024 / 1024) + 'MB',
      external:  Math.round(mem.external  / 1024 / 1024) + 'MB',
    },
  };
  mark('process_info');

  // ── 2. Состояние пула PostgreSQL ────────────────────────────────────────
  const poolState = {
    exists:       !!g._pgPool,
    ready:        !!g._pgReady,
    initPending:  !!g._pgInitPromise,
    warmupStarted:!!g._pgWarmupStarted,
    tableEnsured: !!g._tableEnsured,
    poolKey:      g._pgPoolKey ? 'set' : null,
    lastError:    g._pgLastError ? new Date(g._pgLastError).toISOString() : null,
    lastErrorAgo: g._pgLastError ? (Date.now() - g._pgLastError) + 'ms' : null,
    dataVersion:  g._dataVersion || null,
    cacheValid:   !!(g._allCache && Date.now() < g._allCacheExpiry),
    cacheExpiry:  g._allCacheExpiry ? Math.max(0, g._allCacheExpiry - Date.now()) + 'ms' : null,
  };

  // Активные соединения в пуле
  if (g._pgPool) {
    try {
      poolState.totalCount   = g._pgPool.totalCount;
      poolState.idleCount    = g._pgPool.idleCount;
      poolState.waitingCount = g._pgPool.waitingCount;
    } catch {}
  }
  mark('pool_state');

  // ── 3. Пинг БД ─────────────────────────────────────────────────────────
  let dbPing = null;
  let dbPingError = null;
  let dbVersion = null;
  if (g._pgPool && g._pgReady) {
    try {
      const t1 = Date.now();
      const r = await g._pgPool.query('SELECT version() as v, NOW() as ts');
      dbPing = Date.now() - t1;
      dbVersion = r.rows[0]?.v?.split(' ').slice(0, 2).join(' ') || null;
    } catch(e) {
      dbPingError = e.message;
    }
  } else {
    dbPingError = g._pgInitPromise ? 'pool initializing' : 'pool not ready';
  }
  mark('db_ping');

  // ── 4. Размер данных в БД ───────────────────────────────────────────────
  let dbStats = null;
  if (g._pgPool && g._pgReady && !dbPingError) {
    try {
      const r = await g._pgPool.query(`
        SELECT
          COUNT(*) as key_count,
          SUM(LENGTH(value)) as total_value_bytes,
          pg_size_pretty(pg_database_size(current_database())) as db_size,
          pg_database_size(current_database()) as db_size_bytes
        FROM kv
      `);
      const row = r.rows[0];
      dbStats = {
        keyCount:        parseInt(row.key_count),
        totalValueBytes: parseInt(row.total_value_bytes) || 0,
        totalValueKB:    Math.round((parseInt(row.total_value_bytes) || 0) / 1024) + 'KB',
        dbSize:          row.db_size,
        dbSizeBytes:     parseInt(row.db_size_bytes),
      };

      // Топ самых тяжёлых ключей
      const heavy = await g._pgPool.query(`
        SELECT key, LENGTH(value) as bytes
        FROM kv
        ORDER BY bytes DESC
        LIMIT 10
      `);
      dbStats.heaviestKeys = heavy.rows.map(r => ({
        key: r.key,
        kb: Math.round(parseInt(r.bytes) / 1024 * 10) / 10 + 'KB',
        bytes: parseInt(r.bytes),
      }));
    } catch(e) {
      dbStats = { error: e.message };
    }
  }
  mark('db_stats');

  // ── 5. Холодный старт пула (если пул не готов — замеряем время инициализации) ──
  let coldStartMs = null;
  if (!g._pgPool || !g._pgReady) {
    try {
      const storeModule = await import('./store.js');
      const tPool = Date.now();
      // Вызываем getPool через handler
      await new Promise((resolve) => {
        const mockReq = { method: 'POST', body: { action: 'version' }, query: {} };
        const mockRes = { status: () => mockRes, end: resolve, setHeader: () => {}, json: resolve };
        storeModule.default(mockReq, mockRes).catch(resolve);
      });
      coldStartMs = Date.now() - tPool;
    } catch {}
  }
  mark('cold_start_check');

  // ── 6. Файловая система ─────────────────────────────────────────────────
  const DATA_DIR = path.join(process.cwd(), 'data');
  const fsInfo = {
    cwd: process.cwd(),
    dataDir: DATA_DIR,
    hasPgConfig: fs.existsSync(path.join(DATA_DIR, 'pg-config.json')),
    hasPgEnv:    fs.existsSync(path.join(DATA_DIR, 'pg-env.json')),
    hasStoreJson:fs.existsSync(path.join(DATA_DIR, 'store.json')),
  };
  if (fsInfo.hasStoreJson) {
    try {
      const stat = fs.statSync(path.join(DATA_DIR, 'store.json'));
      fsInfo.storeJsonBytes = stat.size;
      fsInfo.storeJsonKB = Math.round(stat.size / 1024) + 'KB';
    } catch {}
  }
  mark('fs_info');

  // ── 7. ENV-переменные (без значений) ───────────────────────────────────
  const envInfo = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    PG_HOST:      !!process.env.PG_HOST,
    PG_PORT:      process.env.PG_PORT || null,
    NODE_ENV:     process.env.NODE_ENV || null,
    PORT:         process.env.PORT || null,
    HOSTNAME:     process.env.HOSTNAME || null,
  };
  mark('env_info');

  // ── 8. Итог ─────────────────────────────────────────────────────────────
  const totalMs = Date.now() - t0;

  // Диагноз и рекомендации
  const issues = [];
  const recommendations = [];

  if (!poolState.exists || !poolState.ready) {
    issues.push({ severity: 'critical', msg: 'Пул PostgreSQL не инициализирован — каждый запрос ждёт холодного старта (~2-5s)' });
    recommendations.push('Убедитесь что instrumentation.js запускается при старте сервера (experimental.instrumentationHook: true в next.config.js)');
  }
  if (dbPing !== null && dbPing > 100) {
    issues.push({ severity: 'warning', msg: `Высокий latency БД: ${dbPing}ms. Норма < 20ms` });
    recommendations.push('БД находится далеко от сервера. Используйте БД в том же регионе/датацентре.');
  }
  if (dbPing !== null && dbPing > 500) {
    issues.push({ severity: 'critical', msg: `Критически высокий latency БД: ${dbPing}ms` });
  }
  if (dbStats && dbStats.totalValueBytes > 500 * 1024) {
    issues.push({ severity: 'warning', msg: `Большой объём данных в kv: ${dbStats.totalValueKB}. getAll тянет всё за раз` });
    recommendations.push('Разбейте данные на части или добавьте серверный кэш с TTL > 1s');
  }
  if (dbStats && dbStats.heaviestKeys?.length > 0 && dbStats.heaviestKeys[0].bytes > 100 * 1024) {
    issues.push({ severity: 'warning', msg: `Самый тяжёлый ключ: ${dbStats.heaviestKeys[0].key} = ${dbStats.heaviestKeys[0].kb}` });
  }
  if (processInfo.uptimeMs < 5000) {
    issues.push({ severity: 'info', msg: `Сервер только что запустился (${processInfo.uptime}). Первые запросы всегда медленнее.` });
  }
  if (!poolState.warmupStarted) {
    issues.push({ severity: 'warning', msg: 'Прогрев пула не запускался. Проверьте instrumentation.js' });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    totalDiagMs: totalMs,
    timeline,
    process: processInfo,
    pool: poolState,
    db: {
      ping: dbPing !== null ? dbPing + 'ms' : null,
      pingMs: dbPing,
      error: dbPingError,
      version: dbVersion,
      coldStartMs,
      ...dbStats,
    },
    fs: fsInfo,
    env: envInfo,
    diagnosis: {
      issues,
      recommendations,
      score: issues.filter(i => i.severity === 'critical').length === 0
        ? (issues.filter(i => i.severity === 'warning').length === 0 ? 'healthy' : 'degraded')
        : 'critical',
    },
  });
}
