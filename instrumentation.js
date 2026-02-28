// instrumentation.js
// Запускается Next.js один раз при старте сервера (до обработки первого запроса).
// Прогреваем пул PostgreSQL заранее — чтобы первый запрос пользователя не ждал
// установки TCP-соединения с БД (устраняет задержку 1-3 сек при обновлении страницы).

export async function register() {
  // Запускаем только на сервере, не в edge runtime
  if (process.env.NEXT_RUNTIME === 'edge') return;

  // Небольшая задержка чтобы сервер успел стартовать полностью
  await new Promise(r => setTimeout(r, 500));

  try {
    const fs = await import('fs');
    const path = await import('path');

    const DATA_DIR    = path.join(process.cwd(), 'data');
    const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
    const PG_ENV_FILE = path.join(DATA_DIR, 'pg-env.json');

    // Читаем конфиг подключения (тот же порядок что и в store.js)
    let cfg = null;
    if (process.env.DATABASE_URL) {
      cfg = { connectionString: process.env.DATABASE_URL };
    } else if (process.env.PG_HOST) {
      cfg = {
        host: process.env.PG_HOST,
        port: parseInt(process.env.PG_PORT) || 5432,
        database: process.env.PG_DATABASE || process.env.PG_DB || 'postgres',
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        ssl: process.env.PG_SSL === 'true',
      };
    } else {
      for (const f of [PG_CFG_FILE, PG_ENV_FILE]) {
        try {
          if (fs.existsSync(f)) {
            const c = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (c && (c.host || c.connectionString)) { cfg = c; break; }
          }
        } catch {}
      }
    }

    if (!cfg) {
      console.warn('[instrumentation] Конфиг PostgreSQL не найден, прогрев пропущен');
      return;
    }

    // Прогреваем пул: создаём соединение заранее и сохраняем в globalThis
    // чтобы store.js переиспользовал его без пересоздания
    const { Pool } = await import('pg');
    const { source, ...poolCfg } = cfg;

    const opts = poolCfg.connectionString
      ? {
          connectionString: poolCfg.connectionString,
          ssl: { rejectUnauthorized: false },
          max: 20, min: 1,
          connectionTimeoutMillis: 10000,
          idleTimeoutMillis: 600000,
          allowExitOnIdle: false,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        }
      : {
          host: poolCfg.host, port: poolCfg.port || 5432,
          database: poolCfg.database, user: poolCfg.user, password: poolCfg.password,
          ssl: poolCfg.ssl ? { rejectUnauthorized: false } : false,
          max: 20, min: 1,
          connectionTimeoutMillis: 10000,
          idleTimeoutMillis: 600000,
          allowExitOnIdle: false,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        };

    const pool = new Pool(opts);
    const cfgKey = JSON.stringify(poolCfg);

    pool.on('error', (err) => {
      console.error('[PG Pool] Ошибка idle-клиента:', err.message);
      const fatal = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.message?.includes('Connection terminated unexpectedly');
      if (fatal && globalThis._pgPool === pool) {
        globalThis._pgReady = false;
        globalThis._pgPool = null;
        globalThis._pgLastError = Date.now();
      }
    });

    // Устанавливаем соединение и проверяем БД
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    // Сохраняем в globalThis — store.js найдёт готовый пул и не будет создавать новый
    globalThis._pgPool    = pool;
    globalThis._pgPoolKey = cfgKey;
    globalThis._pgReady   = true;
    globalThis._tableEnsured = true;
    if (poolCfg.connectionString) globalThis._savedConnStr = poolCfg.connectionString;
    if (poolCfg.host) globalThis._savedPgCfg = { ...poolCfg };

    console.warn('[instrumentation] PostgreSQL пул прогрет успешно ✓');
  } catch (e) {
    console.error('[instrumentation] Не удалось прогреть пул PostgreSQL:', e.message);
    // Не критично — store.js создаст пул при первом запросе
  }
}
