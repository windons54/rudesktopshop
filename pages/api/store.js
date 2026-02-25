// pages/api/store.js
// На Vercel файловая система эфемерна между запросами.
// pg-конфиг хранится в порядке приоритетов:
//   1. Env-переменные (DATABASE_URL / PG_HOST) — только для первичного подключения
//   2. Таблица kv, ключ __pg_config__ — основное хранилище (персистентно в БД)
//   3. Файл pg-config.json — только локальная разработка

import fs from 'fs';
import path from 'path';

const DATA_DIR    = path.join(process.cwd(), 'data');
const STORE_FILE  = path.join(DATA_DIR, 'store.json');
const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
const PG_CFG_KEY  = '__pg_config__';

// ── JSON-файл (локальная разработка без БД) ───────────────────────────────────
let _lock = Promise.resolve();
const lock = fn => { const r = _lock.then(fn); _lock = r.catch(() => {}); return r; };
const ensureDir = () => { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {} };
function readJSON() {
  try { ensureDir(); if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch {}
  return {};
}
function writeJSON(data) {
  try { ensureDir(); fs.writeFileSync(STORE_FILE, JSON.stringify(data), 'utf8'); } catch(e) { console.error(e); }
}

// ── PG pool ───────────────────────────────────────────────────────────────────
let _pool = null, _poolKey = null;

function buildOpts(cfg) {
  if (cfg.connectionString) {
    return { connectionString: cfg.connectionString, ssl: cfg.ssl ?? { rejectUnauthorized: false }, max: 10, connectionTimeoutMillis: 8000 };
  }
  return { host: cfg.host, port: parseInt(cfg.port) || 5432, database: cfg.database, user: cfg.user, password: cfg.password, ssl: cfg.ssl ? { rejectUnauthorized: false } : false, max: 10, connectionTimeoutMillis: 8000 };
}

// Конфиг только из env (без обращения к БД)
function envCfg() {
  if (process.env.PG_HOST) return { host: process.env.PG_HOST, port: process.env.PG_PORT||'5432', database: process.env.PG_DATABASE||process.env.PG_DB||'postgres', user: process.env.PG_USER, password: process.env.PG_PASSWORD, ssl: process.env.PG_SSL === 'true' };
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  return null;
}

// Конфиг из файла (локально)
function fileCfg() {
  try { if (fs.existsSync(PG_CFG_FILE)) { const c = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8')); if (c?.host || c?.connectionString) return c; } } catch {}
  return null;
}

// Получить пул для работы с данными.
// Порядок: env → kv-таблица (если env даёт подключение) → файл
async function getPool() {
  // Проверить живой пул
  if (_pool && _poolKey) {
    try { await _pool.query('SELECT 1'); return _pool; } catch { _pool = null; _poolKey = null; }
  }

  const { Pool } = await import('pg');

  // Попробовать подключиться через env или файл
  const bootstrapCfg = envCfg() || fileCfg();
  if (!bootstrapCfg) return null;

  const bKey = JSON.stringify(bootstrapCfg);
  if (_pool && _poolKey === bKey) return _pool;

  if (_pool) try { await _pool.end(); } catch {}
  const p = new Pool(buildOpts(bootstrapCfg));
  await p.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Проверить: есть ли в kv сохранённый конфиг отличный от bootstrap?
  // (это нужно когда admin сохранил другое подключение)
  try {
    const r = await p.query('SELECT value FROM kv WHERE key=$1', [PG_CFG_KEY]);
    if (r.rows[0]) {
      const savedCfg = JSON.parse(r.rows[0].value);
      const sKey = JSON.stringify(savedCfg);
      if (sKey !== bKey) {
        // Переподключиться к сохранённому конфигу
        const p2 = new Pool(buildOpts(savedCfg));
        await p2.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await p.end();
        _pool = p2;
        _poolKey = sKey;
        return _pool;
      }
    }
  } catch {}

  _pool = p;
  _poolKey = bKey;
  return _pool;
}

// Временный пул для тестирования произвольного конфига
async function tempPool(cfg) {
  const { Pool } = await import('pg');
  return new Pool({ ...buildOpts(cfg), max: 1, connectionTimeoutMillis: 8000 });
}

// ── Получить сохранённый pg-конфиг (для отображения в UI) ────────────────────
async function getPgConfigForUI() {
  // 1. Файл (локально)
  const fc = fileCfg();
  if (fc) return { cfg: fc, source: 'file' };

  // 2. env
  const ec = envCfg();
  if (!ec) return { cfg: null, source: 'none' };

  // 3. Читаем из kv — там может лежать конфиг сохранённый через UI
  try {
    const p = new (await import('pg')).Pool({ ...buildOpts(ec), max: 1, connectionTimeoutMillis: 5000 });
    await p.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    const r = await p.query('SELECT value FROM kv WHERE key=$1', [PG_CFG_KEY]);
    await p.end();
    if (r.rows[0]) {
      const saved = JSON.parse(r.rows[0].value);
      return { cfg: saved, source: 'db' };
    }
  } catch {}

  return { cfg: ec, source: envCfg() ? (process.env.PG_HOST ? 'env_host' : 'env_url') : 'none' };
}

// ── Сохранить pg-конфиг (в файл + в саму БД) ─────────────────────────────────
async function persistPgConfig(cfg, existingPassword) {
  // Восстановить пароль если не передан
  if (cfg && !cfg.password && existingPassword) {
    cfg = { ...cfg, password: existingPassword };
  }

  // Сохранить в файл (работает локально)
  try {
    ensureDir();
    if (cfg) fs.writeFileSync(PG_CFG_FILE, JSON.stringify(cfg), 'utf8');
    else if (fs.existsSync(PG_CFG_FILE)) fs.unlinkSync(PG_CFG_FILE);
  } catch {}

  if (!cfg) {
    // Удалить из БД
    try {
      const pool = await getPool();
      if (pool) await pool.query('DELETE FROM kv WHERE key=$1', [PG_CFG_KEY]);
    } catch {}
    return;
  }

  // Сохранить в саму БД (персистентно на Vercel)
  // Используем НОВЫЙ конфиг для подключения (сохраняем туда куда указывают настройки)
  try {
    const p = await tempPool(cfg);
    await p.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await p.query(
      `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,
      [PG_CFG_KEY, JSON.stringify(cfg)]
    );
    await p.end();
  } catch(e) {
    console.error('persistPgConfig to DB failed:', e.message);
    // Не фатально — хотя бы в файле сохранено
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { action, key, value, data, config } = req.body || {};

  // --- pg config ---
  if (action === 'pg_save') {
    // Получить существующий пароль чтобы не затереть
    let existingPassword = null;
    try {
      const { cfg } = await getPgConfigForUI();
      existingPassword = cfg?.password || null;
    } catch {}

    await persistPgConfig(config || null, existingPassword);

    // Сбросить пул
    if (_pool) { try { await _pool.end(); } catch {} _pool = null; _poolKey = null; }
    return res.json({ ok: true });
  }

  if (action === 'pg_get') {
    try {
      const { cfg, source } = await getPgConfigForUI();
      if (!cfg) return res.json({ ok: true, config: null, source: 'none' });
      const { password, ...safe } = cfg;
      safe._passwordSaved = !!(password);
      return res.json({ ok: true, config: safe, source });
    } catch(e) {
      return res.json({ ok: true, config: null, source: 'none', error: e.message });
    }
  }

  if (action === 'pg_test') {
    if (!config) return res.json({ ok: false, error: 'Нет конфига' });
    let p;
    try {
      p = await tempPool(config);
      const r = await p.query('SELECT version(), current_database() as db, pg_size_pretty(pg_database_size(current_database())) as sz');
      await p.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      const cnt = await p.query('SELECT COUNT(*) as c FROM kv');
      await p.end();
      return res.json({ ok: true, version: r.rows[0].version, database: r.rows[0].db, size: r.rows[0].sz, rows: parseInt(cnt.rows[0].c) });
    } catch(e) {
      try { if (p) await p.end(); } catch {}
      return res.json({ ok: false, error: e.message });
    }
  }

  if (action === 'pg_diag') {
    const pool = await getPool();
    const { cfg, source } = await getPgConfigForUI().catch(() => ({ cfg: null, source: 'error' }));
    let pgTest = null, pgKeys = [];
    if (pool) {
      try {
        const cnt = await pool.query('SELECT COUNT(*) as c FROM kv');
        const keys = await pool.query('SELECT key FROM kv ORDER BY key');
        pgTest = { ok: true, rows: parseInt(cnt.rows[0].c) };
        pgKeys = keys.rows.map(r => r.key);
      } catch(e) { pgTest = { ok: false, error: e.message }; }
    }
    return res.json({ ok: true,
      usingPg: !!pool, source,
      hasPgCfgFile: fs.existsSync(PG_CFG_FILE),
      hasEnvPg: !!process.env.PG_HOST,
      hasEnvDbUrl: !!process.env.DATABASE_URL,
      cfgHost: cfg?.host || (cfg?.connectionString ? '(connectionString)' : null),
      pgTest, pgKeys, cwd: process.cwd()
    });
  }

  // --- data operations ---
  try {
    const pool = await getPool();
    if (pool) {
      if (action === 'get') {
        const r = await pool.query('SELECT value FROM kv WHERE key=$1', [key]);
        const v = r.rows[0]?.value;
        return res.json({ ok: true, value: v != null ? (() => { try { return JSON.parse(v); } catch { return v; } })() : null });
      }
      if (action === 'set') {
        const s = typeof value === 'string' ? value : JSON.stringify(value);
        await pool.query(`INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`, [key, s]);
        return res.json({ ok: true });
      }
      if (action === 'delete') {
        await pool.query('DELETE FROM kv WHERE key=$1', [key]);
        return res.json({ ok: true });
      }
      if (action === 'getAll') {
        const r = await pool.query('SELECT key,value FROM kv WHERE key != $1', [PG_CFG_KEY]);
        const out = {};
        r.rows.forEach(({ key: k, value: v }) => { try { out[k] = JSON.parse(v); } catch { out[k] = v; } });
        return res.json({ ok: true, data: out });
      }
      if (action === 'setMany') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const [k, v] of Object.entries(data || {})) {
            const s = typeof v === 'string' ? v : JSON.stringify(v);
            await client.query(`INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`, [k, s]);
          }
          await client.query('COMMIT');
        } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
        return res.json({ ok: true });
      }
    } else {
      // JSON-файл (локально без БД)
      if (action === 'get') { const s = readJSON(); return res.json({ ok: true, value: s[key] !== undefined ? s[key] : null }); }
      if (action === 'getAll') { return res.json({ ok: true, data: readJSON() }); }
      if (action === 'set') { await lock(() => { const s = readJSON(); s[key] = value; writeJSON(s); }); return res.json({ ok: true }); }
      if (action === 'delete') { await lock(() => { const s = readJSON(); delete s[key]; writeJSON(s); }); return res.json({ ok: true }); }
      if (action === 'setMany') { await lock(() => { const s = readJSON(); Object.assign(s, data || {}); writeJSON(s); }); return res.json({ ok: true }); }
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch(e) {
    console.error('Store error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
