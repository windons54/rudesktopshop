// pages/api/store.js
// Хранение данных: PostgreSQL (pg Pool) с fallback на JSON-файл.
// Порядок подключения: DATABASE_URL (env) → PG_HOST (env) → data/pg-config.json

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Отправляет JSON с компрессией если браузер объявил поддержку в заголовке запроса.
// ВАЖНО: мы читаем accept-encoding из HTTP-заголовка запроса (который браузер ставит сам),
// а не из JS-хедера fetch — чтобы избежать проблем с Safari, который не принимает
// gzip-ответы когда Accept-Encoding выставлен вручную в fetch().
function sendCompressed(req, res, payload) {
  const json = JSON.stringify(payload);
  // Читаем реальный accept-encoding, выставленный браузером/ОС — не JS
  const ae = req.headers?.['accept-encoding'] || '';
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Content-Type', 'application/json');

  if (ae.includes('br')) {
    // Brotli — лучшее сжатие, поддерживается всеми современными браузерами включая Safari 15.4+
    zlib.brotliCompress(Buffer.from(json, 'utf8'), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }, (err, compressed) => {
      if (err) { res.end(json); return; }
      res.setHeader('Content-Encoding', 'br');
      res.end(compressed);
    });
  } else if (ae.includes('gzip')) {
    zlib.gzip(Buffer.from(json, 'utf8'), { level: 6 }, (err, compressed) => {
      if (err) { res.end(json); return; }
      res.setHeader('Content-Encoding', 'gzip');
      res.end(compressed);
    });
  } else {
    res.end(json);
  }
}

const DATA_DIR    = path.join(process.cwd(), 'data');
const STORE_FILE  = path.join(DATA_DIR, 'store.json');
const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
const PG_ENV_FILE = path.join(DATA_DIR, 'pg-env.json');   // резервная копия, переживает деплой
const PG_GIT_FILE = path.join(process.cwd(), 'pg.env');   // главный файл — в git, не сбрасывается ✅
const PG_CFG_KEY  = '__pg_config__';

// Парсит KEY=VALUE файл (pg.env)
function parseDotEnv(content) {
  const r = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    r[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return r;
}

// ── JSON fallback ──────────────────────────────────────────────────────────
let _lock = Promise.resolve();
const lock = fn => { const r = _lock.then(fn); _lock = r.catch(() => {}); return r; };
const ensureDir = () => {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
};
function readJSON() {
  try { ensureDir(); if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch {}
  return {};
}
function writeJSON(data) {
  try { ensureDir(); fs.writeFileSync(STORE_FILE, JSON.stringify(data), 'utf8'); } catch (e) { console.error(e); }
}

// ── Читаем конфиг PG ───────────────────────────────────────────────────────
// Порядок: pg.env (git) → DATABASE_URL → PG_HOST env → pg-config.json → pg-env.json → store.json
function readPgConfig() {
  // 1. pg.env в корне репозитория — главный источник, не сбрасывается при деплоях
  try {
    if (fs.existsSync(PG_GIT_FILE)) {
      const vars = parseDotEnv(fs.readFileSync(PG_GIT_FILE, 'utf8'));
      if (vars.DATABASE_URL)
        return { connectionString: vars.DATABASE_URL, ssl: { rejectUnauthorized: false }, source: 'pg_env_file' };
      if (vars.PG_HOST)
        return { host: vars.PG_HOST, port: parseInt(vars.PG_PORT) || 5432,
          database: vars.PG_DATABASE || vars.PG_DB || 'postgres',
          user: vars.PG_USER, password: vars.PG_PASSWORD,
          ssl: vars.PG_SSL === 'true', source: 'pg_env_file' };
    }
  } catch {}
  if (process.env.DATABASE_URL)
    return { connectionString: process.env.DATABASE_URL, source: 'env_url' };
  if (process.env.PG_HOST)
    return { host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT) || 5432,
      database: process.env.PG_DATABASE || process.env.PG_DB || 'postgres',
      user: process.env.PG_USER, password: process.env.PG_PASSWORD,
      ssl: process.env.PG_SSL === 'true', source: 'env_host' };
  // Проверяем pg-config.json (создаётся при сохранении через UI)
  try {
    if (fs.existsSync(PG_CFG_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8'));
      if (c && (c.host || c.connectionString)) return { ...c, source: 'file' };
    }
  } catch {}
  // Проверяем pg-env.json (резервная копия, переживает git deploy при наличии volume)
  try {
    if (fs.existsSync(PG_ENV_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_ENV_FILE, 'utf8'));
      if (c && (c.host || c.connectionString)) {
        // Восстанавливаем pg-config.json
        try { ensureDir(); fs.writeFileSync(PG_CFG_FILE, JSON.stringify(c), 'utf8'); } catch {}
        return { ...c, source: 'env_file' };
      }
    }
  } catch {}
  // Fallback: читаем из store.json (переживает git deploy если data/ — persistent volume)
  try {
    const store = readJSON();
    if (store[PG_CFG_KEY]) {
      const c = store[PG_CFG_KEY];
      if (c && (c.host || c.connectionString)) {
        // Восстанавливаем pg-config.json из store.json
        try { ensureDir(); fs.writeFileSync(PG_CFG_FILE, JSON.stringify(c), 'utf8'); } catch {}
        return { ...c, source: 'store_json' };
      }
    }
  } catch {}
  return null;
}

// ── Попытка получить конфиг из самой БД (устойчиво к деплоям) ─────────────
// Если pg-config.json удалён после деплоя с GitHub, пробуем подключиться
// используя сохранённый в БД конфиг (bootstrapping через временный пул)
async function tryBootstrapFromDb() {
  if (g._bootstrapDone) return;
  g._bootstrapDone = true;
  // Уже есть конфиг — ничего не делаем
  if (readPgConfig()) return;
  // Нет конфига — ищем сохранённые данные подключения в globalThis
  const saved = g._savedConnStr;
  const savedCfg = g._savedPgCfg;
  if (!saved && !savedCfg) return;
  try {
    const { Pool } = await import('pg');
    const opts = saved
      ? { connectionString: saved, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 5000 }
      : { host: savedCfg.host, port: savedCfg.port || 5432, database: savedCfg.database,
          user: savedCfg.user, password: savedCfg.password,
          ssl: savedCfg.ssl ? { rejectUnauthorized: false } : false,
          max: 1, connectionTimeoutMillis: 5000 };
    const pool = new Pool(opts);
    await pool.query('SELECT 1');
    // Читаем конфиг из kv таблицы
    const r = await pool.query(`SELECT value FROM kv WHERE key = $1`, [PG_CFG_KEY]);
    if (r.rows.length) {
      const cfg = JSON.parse(r.rows[0].value);
      if (cfg && (cfg.host || cfg.connectionString)) {
        ensureDir();
        fs.writeFileSync(PG_CFG_FILE, JSON.stringify(cfg), 'utf8');
        fs.writeFileSync(PG_ENV_FILE, JSON.stringify(cfg), 'utf8');
        console.log('[Store] Конфиг БД восстановлен из kv-таблицы');
      }
    }
    await pool.end();
  } catch {}
}

// ── pg Pool singleton — хранится в globalThis чтобы пережить hot-reload ──
// В Next.js каждый API route может переиспользовать один process,
// поэтому globalThis._pgPool живёт между запросами.
const g = globalThis;


async function getPool() {
  // Если конфига нет — пробуем восстановить из БД (после git deploy)
  if (!readPgConfig()) {
    await tryBootstrapFromDb();
  }

  const cfg = readPgConfig();
  if (!cfg) return null;

  const { source, ...poolCfg } = cfg;
  const cfgKey = JSON.stringify(poolCfg);

  // Переиспользуем существующий пул если конфиг не изменился
  if (g._pgPool && g._pgPoolKey === cfgKey && g._pgReady) {
    return g._pgPool;
  }

  // Если уже идёт инициализация — ждём её завершения
  if (g._pgInitPromise && g._pgPoolKey === cfgKey) {
    return g._pgInitPromise;
  }

  // Cooldown после ошибки: не пытаемся переподключиться чаще раза в 3 секунды
  const now = Date.now();
  // Cooldown 1s — минимальная пауза между попытками переподключения.
  // Раньше было 10s — слишком долго для пользователя ждущего загрузки страницы.
  if (g._pgLastError && g._pgPoolKey === cfgKey && (now - g._pgLastError) < 1000) {
    return null;
  }

  // Создаём новый пул
  g._pgPoolKey = cfgKey;
  g._pgReady = false;

  g._pgInitPromise = (async () => {
    let newPool = null;
    try {
      const { Pool } = await import('pg');
      if (g._pgPool) { try { await g._pgPool.end(); } catch {} g._pgPool = null; }

      // ИСПРАВЛЕНИЕ: idleTimeoutMillis увеличен с 30s до 600s (10 минут).
      // При 30s пул закрывал все соединения в период бездействия, и при обновлении
      // страницы требовалось заново устанавливать TCP-соединение с БД — отсюда
      // задержка 3-5 секунд. С 10 минутами соединение остаётся живым между визитами.
      // min:1 — одно соединение всегда готово, исключает холодный старт первого запроса.
      const opts = poolCfg.connectionString
        ? { connectionString: poolCfg.connectionString,
            ssl: { rejectUnauthorized: false },
            max: 20,
            min: 1,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 600000,
            allowExitOnIdle: false,
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000 }
        : { host: poolCfg.host, port: poolCfg.port || 5432,
            database: poolCfg.database, user: poolCfg.user, password: poolCfg.password,
            ssl: poolCfg.ssl ? { rejectUnauthorized: false } : false,
            max: 20,
            min: 1,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 600000,
            allowExitOnIdle: false,
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000 };

      newPool = new Pool(opts);

      // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: обработчик ошибок idle-соединений.
      // Без него Node.js выбрасывает необработанное исключение при обрыве соединения
      // с БД (например, когда облачный PostgreSQL закрывает idle-подключения),
      // что может привести к падению сервера.
      newPool.on('error', (err) => {
        // Ошибки отдельных idle-соединений не должны уничтожать весь пул —
        // pg автоматически удалит сломанный клиент из пула и создаст новый.
        // Мы только логируем. Обнуляем пул лишь при фатальных ошибках (ECONNREFUSED и т.п.)
        console.error('[PG Pool] Ошибка idle-клиента:', err.message);
        const fatal = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.message?.includes('Connection terminated unexpectedly');
        if (fatal && g._pgPool === newPool) {
          g._pgReady = false;
          g._pgPool = null;
          g._pgLastError = Date.now();
        }
      });

      // ИСПРАВЛЕНИЕ: пул помечается как готовый ДО SELECT 1 и CREATE TABLE.
      // Это убирает задержку 1-3 RTT из критического пути первого запроса.
      // SELECT 1 + CREATE TABLE выполняются в фоне — они нужны только для проверки
      // и создания таблицы, но не блокируют основные запросы.
      g._pgPool = newPool;
      g._pgReady = true;
      g._pgInitPromise = null;

      // Фоновая проверка + создание таблицы (не блокирует первый запрос)
      (async () => {
        try {
          await newPool.query('SELECT 1');
          if (!g._tableEnsured) {
            await newPool.query(`CREATE TABLE IF NOT EXISTS kv (
              key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
            )`);
            g._tableEnsured = true;
          }
        } catch (e) {
          console.error('[PG Pool] Фоновая проверка не прошла:', e.message);
          if (g._pgPool === newPool) {
            g._pgReady = false;
            g._pgPool = null;
            g._pgLastError = Date.now();
          }
        }
      })();
      // Кэшируем данные подключения для bootstrap после деплоя
      if (poolCfg.connectionString) g._savedConnStr = poolCfg.connectionString;
      if (poolCfg.host) g._savedPgCfg = { ...poolCfg };
      return g._pgPool;
    } catch (e) {
      console.error('[PG Pool] Ошибка инициализации:', e.message);
      // ИСПРАВЛЕНИЕ: закрываем pool при ошибке чтобы не было утечки соединений
      if (newPool) { try { newPool.end(); } catch {} }
      g._pgPool = null;
      g._pgReady = false;
      g._pgInitPromise = null;
      g._pgLastError = Date.now();
      return null;
    }
  })();

  return g._pgInitPromise;
}

// Прогрев пула при первой загрузке модуля (серверный контекст).
// Запускаем сразу и сохраняем промис — getPool() будет ждать его если пул ещё не готов.
// ВАЖНО: не используем setImmediate — он выполняется ПОСЛЕ первого запроса,
// из-за чего первый getAll получал pg_unavailable и клиент ждал 500ms+.
if (!g._pgWarmupStarted) {
  g._pgWarmupStarted = true;
  getPool().catch(() => {});
}

// ── Версия данных для polling (ETag) ───────────────────────────────────────
// Инкрементируется при каждом set/delete/setMany — клиент не тянет данные если версия не изменилась
if (!g._dataVersion) g._dataVersion = Date.now();
const bumpVersion = () => { g._dataVersion = Date.now(); g._allCache = null; g._allCacheExpiry = 0; };

// ── Серверный кэш getAll (1 секунда TTL) ──────────────────────────────────
// При 100 пользователях polling каждые 5 секунд = ~20 запросов/сек на getAll
// Кэш избегает 20 одинаковых запросов к БД в секунду
if (!g._allCache) g._allCache = null;
if (!g._allCacheExpiry) g._allCacheExpiry = 0;
const ALL_CACHE_TTL = 30000; // 30 секунд — при обновлении страницы почти всегда попадём в кэш

// ── Утилиты ────────────────────────────────────────────────────────────────
const serialize   = v => typeof v === 'string' ? v : JSON.stringify(v);
const deserialize = raw => { if (raw == null) return null; try { return JSON.parse(raw); } catch { return raw; } };

// ── CRUD ────────────────────────────────────────────────────────────────────
const pgKv = {
  async get(pool, key) {
    const r = await pool.query('SELECT value FROM kv WHERE key=$1', [key]);
    return r.rows.length ? deserialize(r.rows[0].value) : null;
  },
  async set(pool, key, value) {
    await pool.query(
      `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [key, serialize(value)]
    );
    bumpVersion();
  },
  async delete(pool, key) {
    await pool.query('DELETE FROM kv WHERE key=$1', [key]);
    bumpVersion();
  },
  async getAll(pool) {
    const r = await pool.query(`SELECT key,value FROM kv WHERE key!=$1 ORDER BY key`, [PG_CFG_KEY]);
    const out = {};
    r.rows.forEach(({ key, value }) => {
      const parsed = deserialize(value);
      // ОПТИМИЗАЦИЯ: вырезаем base64-картинки из cm_appearance при getAll.
      // Они хранятся отдельно в cm_images и загружаются клиентом один раз через localStorage.
      // Это режет cm_appearance с ~715KB до ~5KB.
      if (key === 'cm_appearance' && parsed && typeof parsed === 'object') {
        const slim = { ...parsed };
        if (slim.logo && slim.logo.startsWith('data:')) slim.logo = '__stored__';
        if (slim.banner && slim.banner.image && slim.banner.image.startsWith('data:')) slim.banner = { ...slim.banner, image: '__stored__' };
        if (slim.currency && slim.currency.logo && slim.currency.logo.startsWith('data:')) slim.currency = { ...slim.currency, logo: '__stored__' };
        if (slim.seo && slim.seo.favicon && slim.seo.favicon.startsWith('data:')) slim.seo = { ...slim.seo, favicon: '__stored__' };
        out[key] = slim;
      } else {
        out[key] = parsed;
      }
    });
    return out;
  },
  async setMany(pool, data) {
    if (!Object.keys(data || {}).length) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(data)) {
        await client.query(
          `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
          [key, serialize(value)]
        );
      }
      await client.query('COMMIT');
      bumpVersion();
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  },
};

// ── Сохранение конфига ─────────────────────────────────────────────────────
async function persistPgConfig(cfg) {
  ensureDir();
  if (cfg) {
    fs.writeFileSync(PG_CFG_FILE, JSON.stringify(cfg), 'utf8');
    // Резервная копия — переживает git deploy если data/ — persistent volume
    try { fs.writeFileSync(PG_ENV_FILE, JSON.stringify(cfg), 'utf8'); } catch {}
    // Также сохраняем в store.json чтобы пережить git deploy (если data/ — persistent volume)
    try {
      const store = readJSON();
      store[PG_CFG_KEY] = cfg;
      writeJSON(store);
    } catch {}
    // Также сохраняем в globalThis чтобы bootstrap мог его использовать
    g._savedConnStr = cfg.connectionString || null;
    g._savedPgCfg = cfg.host ? { ...cfg } : null;
  } else {
    if (fs.existsSync(PG_CFG_FILE)) fs.unlinkSync(PG_CFG_FILE);
    if (fs.existsSync(PG_ENV_FILE)) try { fs.unlinkSync(PG_ENV_FILE); } catch {}
    // Удаляем из store.json тоже
    try {
      const store = readJSON();
      delete store[PG_CFG_KEY];
      writeJSON(store);
    } catch {}
    g._savedConnStr = null;
    g._savedPgCfg = null;
  }
  // Сбрасываем пул чтобы пересоздать с новым конфигом
  g._pgPool = null; g._pgReady = false; g._pgPoolKey = null; g._pgInitPromise = null;

  // Сохраняем конфиг в саму БД (чтобы пережить git deploy)
  if (cfg) {
    try {
      const pool = await getPool();
      if (pool) {
        await pool.query(
          `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
          [PG_CFG_KEY, JSON.stringify(cfg)]
        );
        console.log('[Store] Конфиг БД сохранён в kv-таблицу (устойчиво к деплоям)');
      }
    } catch (e) {
      console.warn('[Store] Не удалось сохранить конфиг в kv:', e.message);
    }
  }
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { action, key, value, data, config, intentional_delete } = req.body || {};

  // ── Конфиг ──
  if (action === 'pg_save') {
    await persistPgConfig(config || null);
    return res.json({ ok: true });
  }

  if (action === 'pg_get') {
    try {
      const cfg = readPgConfig();
      if (!cfg) return res.json({ ok: true, config: null, source: 'none' });
      const { password, source, ...safe } = cfg;
      safe._passwordSaved = !!password;
      return res.json({ ok: true, config: safe, source: source || 'unknown' });
    } catch (e) { return res.json({ ok: true, config: null, source: 'none', error: e.message }); }
  }

  // ── Тест подключения ──
  if (action === 'pg_test') {
    if (!config) return res.json({ ok: false, error: 'Нет конфига' });
    try {
      const { Pool } = await import('pg');
      const opts = config.connectionString
        ? { connectionString: config.connectionString, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 8000 }
        : { host: config.host, port: parseInt(config.port) || 5432, database: config.database,
            user: config.user, password: config.password,
            ssl: config.ssl ? { rejectUnauthorized: false } : false, max: 1, connectionTimeoutMillis: 8000 };
      const pool = new Pool(opts);
      const r = await pool.query('SELECT version(), current_database() as db, pg_size_pretty(pg_database_size(current_database())) as sz');
      await pool.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      const cnt = await pool.query('SELECT COUNT(*) as c FROM kv');
      await pool.end();
      return res.json({ ok: true, version: r.rows[0].version, database: r.rows[0].db, size: r.rows[0].sz, rows: parseInt(cnt.rows[0].c) });
    } catch (e) { return res.json({ ok: false, error: e.message }); }
  }

  // ── Диагностика ──
  if (action === 'pg_diag') {
    const cfg = readPgConfig();
    let pgTest = null, pgKeys = [], rowCounts = {}, dbSize = '—', pgError = null;
    const pool = await getPool();
    if (pool) {
      try {
        const rows = await pool.query('SELECT key, value FROM kv ORDER BY key');
        const cnt = rows.rows.length;
        pgKeys = rows.rows.map(r => r.key);
        pgTest = { ok: true, rows: cnt };
        for (const row of rows.rows) {
          try {
            const p = JSON.parse(row.value);
            if (Array.isArray(p)) rowCounts[row.key] = p.length;
            else if (p && typeof p === 'object') {
              rowCounts[row.key] = Object.keys(p).length;
              if (row.key === 'cm_users')
                rowCounts['_total_coins'] = Object.values(p).reduce((s, u) => s + (u?.balance || 0), 0);
            } else rowCounts[row.key] = 1;
          } catch { rowCounts[row.key] = 1; }
        }
        rowCounts['_total_keys'] = cnt;
        const szRes = await pool.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size');
        dbSize = szRes.rows[0]?.size || '—';
      } catch (e) { pgTest = { ok: false, error: e.message }; pgError = e.message; }
    }
    const jsonData = readJSON();
    return res.json({
      ok: true, usingPg: !!pool, source: cfg?.source || 'none',
      hasPgCfgFile: fs.existsSync(PG_CFG_FILE),
      hasEnvPg: !!process.env.PG_HOST, hasEnvDbUrl: !!process.env.DATABASE_URL,
      cfgHost: cfg?.host || (cfg?.connectionString ? '(connectionString)' : null),
      pgTest, pgKeys, rowCounts, dbSize, pgError,
      jsonKeys: Object.keys(jsonData).filter(k => k !== PG_CFG_KEY),
      dataVersion: g._dataVersion,
      cwd: process.cwd(),
    });
  }

  // ── Миграция JSON → PG ──
  if (action === 'migrate') {
    const pool = await getPool();
    if (!pool) return res.json({ ok: false, error: 'PostgreSQL не подключён' });
    try {
      const source = data || readJSON();
      await pgKv.setMany(pool, source);
      return res.json({ ok: true, migrated: Object.keys(source).length });
    } catch (e) { return res.json({ ok: false, error: e.message }); }
  }

  // ── Версия данных (для polling без лишних запросов) ──
  if (action === 'version') {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, version: g._dataVersion });
  }

  // ── Ежедневные начисления (трудодни + дни рождения) ──
  // Выполняется на сервере атомарно, чтобы клиент не затирал данные
  if (action === 'daily_grants') {
    try {
      const pool = await getPool();
      const store = pool ? {
        get: (k) => pgKv.get(pool, k),
        set: (k, v) => pgKv.set(pool, k, v),
      } : {
        get: (k) => { const s = readJSON(); return Promise.resolve(s[k] ?? null); },
        set: (k, v) => lock(() => { const s = readJSON(); s[k] = v; writeJSON(s); bumpVersion(); }),
      };

      const todayDate = new Date();
      const todayStr = todayDate.toISOString().slice(0, 10);
      const currentYear = String(todayDate.getFullYear());

      // Читаем актуальные данные с сервера
      const users     = (await store.get('cm_users'))     || {};
      const appearance = (await store.get('cm_appearance')) || {};
      const wdGrant   = (await store.get('cm_workday_grant'))  || '';
      const bdGrant   = (await store.get('cm_birthday_grant')) || '';

      let updatedUsers = { ...users };
      const grants = { workday: 0, birthday: 0 };

      // ── Трудодни ──
      if (wdGrant !== todayStr) {
        const wdCfg = appearance.workdays || {};
        const wdCoins = Number(wdCfg.coinsPerDay || 0);
        if (wdCoins > 0) {
          const overrides = wdCfg.userOverrides || {};
          const globalMode = wdCfg.globalMode || 'employment';
          const globalCustomDate = wdCfg.globalCustomDate || '';
          Object.entries(users).forEach(([uname, ud]) => {
            if (!ud || ud.role === 'admin') return;
            const override = overrides[uname];
            const mode = override?.mode || globalMode;
            let startStr = null;
            if (mode === 'employment') startStr = ud.employmentDate || null;
            else if (mode === 'activation') startStr = ud.activationDate || ud.createdAt || null;
            else if (mode === 'custom') startStr = override?.customDate || globalCustomDate || null;
            if (!startStr) return;
            const start = new Date(startStr);
            if (isNaN(start.getTime()) || start > todayDate) return;
            updatedUsers[uname] = { ...updatedUsers[uname], balance: (updatedUsers[uname].balance || 0) + wdCoins };
            grants.workday++;
          });
          await store.set('cm_workday_grant', todayStr);
        } else {
          // coinsPerDay = 0, просто отмечаем что проверили
          await store.set('cm_workday_grant', todayStr);
        }
      }

      // ── Дни рождения ──
      if (bdGrant !== currentYear) {
        const bonusEnabled = appearance.birthdayEnabled !== false;
        const bonusAmount = parseInt(appearance.birthdayBonus || 100);
        if (bonusEnabled && bonusAmount > 0) {
          Object.entries(users).forEach(([uname, ud]) => {
            if (!ud || !ud.birthdate) return;
            const bd = new Date(ud.birthdate);
            if (isNaN(bd)) return;
            if (bd.getDate() === todayDate.getDate() && bd.getMonth() === todayDate.getMonth()) {
              updatedUsers[uname] = { ...updatedUsers[uname], balance: (updatedUsers[uname].balance || 0) + bonusAmount };
              grants.birthday++;
            }
          });
          if (grants.birthday > 0) await store.set('cm_birthday_grant', currentYear);
        }
      }

      // Сохраняем пользователей только если что-то изменилось
      if (grants.workday > 0 || grants.birthday > 0) {
        await store.set('cm_users', updatedUsers);
      }

      return res.json({ ok: true, grants, users: updatedUsers, version: g._dataVersion });
    } catch (e) {
      console.error('[daily_grants]', e);
      return res.json({ ok: false, error: e.message });
    }
  }

  // ── Основные CRUD ──
  try {
    const pool = await getPool();

    // Защита: никогда не сохранять cm_users как пустой объект/null
    // и никогда не терять пароли пользователей
    if (action === 'set' && key === 'cm_users') {
      if (!value || typeof value !== 'object' || Object.keys(value).length === 0) {
        console.warn('[Store] Попытка сохранить пустой cm_users — отклонено');
        return res.json({ ok: false, error: 'Cannot save empty users' });
      }
      // Мержим с существующими данными на сервере чтобы не терять пользователей
      const existingUsers = pool 
        ? await pgKv.get(pool, 'cm_users') 
        : (readJSON()['cm_users'] || null);
      if (existingUsers && typeof existingUsers === 'object') {
        // Проверяем что ни один пользователь не потерял пароль
        Object.keys(value).forEach(k => {
          if (value[k] && typeof value[k] === 'object') {
            if (!value[k].password && existingUsers[k]?.password) {
              value[k].password = existingUsers[k].password;
            }
            if (value[k].balance === undefined && existingUsers[k]?.balance !== undefined) {
              value[k].balance = existingUsers[k].balance;
            }
          }
        });
        // Добавляем пользователей которые есть на сервере но отсутствуют в запросе
        Object.keys(existingUsers).forEach(k => {
          if (!value[k] && existingUsers[k]) {
            // Если это intentional delete — не восстанавливаем
            if (intentional_delete && intentional_delete === k) return;
            // Пользователь пропал из запроса — сохраняем его
            value[k] = existingUsers[k];
          }
        });
      }
    }

    if (pool) {
      if (action === 'get')     return res.json({ ok: true, value: await pgKv.get(pool, key) });
      if (action === 'set')     { await pgKv.set(pool, key, value); return res.json({ ok: true }); }
      if (action === 'delete')  { await pgKv.delete(pool, key); return res.json({ ok: true }); }
      if (action === 'getAll') {
        const now = Date.now();

        // ETag-проверка: если клиент уже имеет актуальную версию — отвечаем без данных
        const clientVersion = req.body?.clientVersion || null;
        if (clientVersion && String(clientVersion) === String(g._dataVersion) && g._allCache) {
          res.setHeader('Cache-Control', 'no-store');
          // Возвращаем 200 с notModified:true — НЕ 304, у которого нет тела (ломает res.json на клиенте)
          return res.json({ ok: true, notModified: true, version: g._dataVersion });
        }

        // Серверный кэш — не дёргаем БД при каждом запросе
        if (g._allCache && now < g._allCacheExpiry) {
          const payload = { ok: true, data: g._allCache, version: g._dataVersion };
          return sendCompressed(req, res, payload);
        }
        const data = await pgKv.getAll(pool);
        g._allCache = data;
        g._allCacheExpiry = now + ALL_CACHE_TTL;
        const payload = { ok: true, data, version: g._dataVersion };
        return sendCompressed(req, res, payload);
      }
      if (action === 'setMany') { await pgKv.setMany(pool, data); return res.json({ ok: true }); }
    } else {
      // PG настроен но недоступен — сообщаем клиенту чтобы он не перезаписывал состояние
      const pgCfgExists = !!readPgConfig();
      if (pgCfgExists) {
        if (action === 'getAll') return res.json({ ok: false, pg_unavailable: true, error: 'PostgreSQL временно недоступен' });
        if (action === 'version') return res.json({ ok: true, version: g._dataVersion, pg_unavailable: true });
        if (action === 'get')    return res.json({ ok: false, pg_unavailable: true, value: null });
        if (action === 'set' || action === 'setMany' || action === 'delete')
          return res.json({ ok: false, pg_unavailable: true, error: 'PostgreSQL временно недоступен' });
      }
      if (action === 'get')     { const s = readJSON(); return res.json({ ok: true, value: s[key] !== undefined ? s[key] : null }); }
      if (action === 'getAll')  return res.json({ ok: true, data: readJSON(), version: g._dataVersion });
      if (action === 'set')     { await lock(() => { const s = readJSON(); s[key] = value; writeJSON(s); bumpVersion(); }); return res.json({ ok: true }); }
      if (action === 'delete')  { await lock(() => { const s = readJSON(); delete s[key]; writeJSON(s); bumpVersion(); }); return res.json({ ok: true }); }
      if (action === 'setMany') { await lock(() => { const s = readJSON(); Object.assign(s, data || {}); writeJSON(s); bumpVersion(); }); return res.json({ ok: true }); }
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error('[Store] Ошибка:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
