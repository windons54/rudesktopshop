// pages/api/store.js
// Слой хранения данных: PostgreSQL (через pg Pool + pg-config.json) с fallback на JSON-файл.
//
// Порядок подключения к PostgreSQL:
//   1. DATABASE_URL (env)
//   2. PG_HOST (env)
//   3. data/pg-config.json (сохранённый через UI)
// Если ни один не настроен — fallback на data/store.json

import fs from 'fs';
import path from 'path';

const DATA_DIR    = path.join(process.cwd(), 'data');
const STORE_FILE  = path.join(DATA_DIR, 'store.json');
const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
const PG_CFG_KEY  = '__pg_config__';

// ── JSON-файл fallback ─────────────────────────────────────────────────────
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

// ── Читаем конфиг PG (env или файл) ───────────────────────────────────────
function readPgConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, source: 'env_url' };
  }
  if (process.env.PG_HOST) {
    return {
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT) || 5432,
      database: process.env.PG_DATABASE || process.env.PG_DB || 'postgres',
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      ssl: process.env.PG_SSL === 'true',
      source: 'env_host',
    };
  }
  try {
    if (fs.existsSync(PG_CFG_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8'));
      if (c && (c.host || c.connectionString)) {
        return { ...c, source: 'file' };
      }
    }
  } catch {}
  return null;
}

// ── pg Pool singleton ──────────────────────────────────────────────────────
let _pool = null;
let _poolCfgKey = null;

async function getPool() {
  const cfg = readPgConfig();
  if (!cfg) return null;

  const { source, ...poolCfg } = cfg;
  const cfgKey = JSON.stringify(poolCfg);

  if (_pool && _poolCfgKey === cfgKey) return _pool;

  try {
    const { Pool } = await import('pg');
    if (_pool) { try { await _pool.end(); } catch {} }

    const opts = poolCfg.connectionString
      ? {
          connectionString: poolCfg.connectionString,
          ssl: { rejectUnauthorized: false },
          max: 10,
          connectionTimeoutMillis: 8000,
          idleTimeoutMillis: 30000,
        }
      : {
          host: poolCfg.host,
          port: poolCfg.port || 5432,
          database: poolCfg.database,
          user: poolCfg.user,
          password: poolCfg.password,
          ssl: poolCfg.ssl ? { rejectUnauthorized: false } : false,
          max: 10,
          connectionTimeoutMillis: 8000,
          idleTimeoutMillis: 30000,
        };

    _pool = new Pool(opts);
    _poolCfgKey = cfgKey;

    await _pool.query('SELECT 1');
    await _pool.query(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    return _pool;
  } catch (e) {
    console.error('[PG Pool] Ошибка подключения:', e.message);
    _pool = null;
    _poolCfgKey = null;
    return null;
  }
}

// ── Утилиты сериализации ───────────────────────────────────────────────────
function serialize(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
function deserialize(raw) {
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

// ── CRUD через pg Pool ─────────────────────────────────────────────────────
const pgKv = {
  async get(pool, key) {
    const r = await pool.query('SELECT value FROM kv WHERE key=$1', [key]);
    return r.rows.length ? deserialize(r.rows[0].value) : null;
  },
  async set(pool, key, value) {
    const v = serialize(value);
    await pool.query(
      `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [key, v]
    );
  },
  async delete(pool, key) {
    await pool.query('DELETE FROM kv WHERE key=$1', [key]);
  },
  async getAll(pool) {
    const r = await pool.query(`SELECT key,value FROM kv WHERE key!=$1 ORDER BY key`, [PG_CFG_KEY]);
    const out = {};
    r.rows.forEach(({ key, value }) => { out[key] = deserialize(value); });
    return out;
  },
  async setMany(pool, data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(data || {})) {
        const v = serialize(value);
        await client.query(
          `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
          [key, v]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
};

// ── Сохранение конфига PG ──────────────────────────────────────────────────
async function persistPgConfig(cfg) {
  ensureDir();
  if (cfg) {
    fs.writeFileSync(PG_CFG_FILE, JSON.stringify(cfg), 'utf8');
  } else {
    if (fs.existsSync(PG_CFG_FILE)) fs.unlinkSync(PG_CFG_FILE);
  }
  _pool = null;
  _poolCfgKey = null;
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { action, key, value, data, config } = req.body || {};

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
    } catch (e) {
      return res.json({ ok: true, config: null, source: 'none', error: e.message });
    }
  }

  if (action === 'pg_test') {
    if (!config) return res.json({ ok: false, error: 'Нет конфига' });
    try {
      const { Pool } = await import('pg');
      const opts = config.connectionString
        ? { connectionString: config.connectionString, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 8000 }
        : { host: config.host, port: parseInt(config.port) || 5432, database: config.database, user: config.user, password: config.password, ssl: config.ssl ? { rejectUnauthorized: false } : false, max: 1, connectionTimeoutMillis: 8000 };
      const pool = new Pool(opts);
      const r = await pool.query('SELECT version(), current_database() as db, pg_size_pretty(pg_database_size(current_database())) as sz');
      await pool.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      const cnt = await pool.query('SELECT COUNT(*) as c FROM kv');
      await pool.end();
      return res.json({ ok: true, version: r.rows[0].version, database: r.rows[0].db, size: r.rows[0].sz, rows: parseInt(cnt.rows[0].c) });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  }

  if (action === 'pg_diag') {
    const cfg = readPgConfig();
    let pgTest = null, pgKeys = [], rowCounts = {}, dbSize = '—', pgError = null;
    const pool = await getPool();
    if (pool) {
      try {
        const cntRes = await pool.query('SELECT COUNT(*) as c FROM kv');
        const cnt = parseInt(cntRes.rows[0].c);
        const rows = await pool.query('SELECT key, value FROM kv ORDER BY key');
        pgKeys = rows.rows.map(r => r.key);
        pgTest = { ok: true, rows: cnt };

        for (const row of rows.rows) {
          try {
            const parsed = JSON.parse(row.value);
            if (Array.isArray(parsed)) {
              rowCounts[row.key] = parsed.length;
            } else if (parsed && typeof parsed === 'object') {
              rowCounts[row.key] = Object.keys(parsed).length;
              if (row.key === 'cm_users') {
                rowCounts['_total_coins'] = Object.values(parsed).reduce((s, u) => s + (u?.balance || 0), 0);
              }
            } else {
              rowCounts[row.key] = 1;
            }
          } catch { rowCounts[row.key] = 1; }
        }
        rowCounts['_total_keys'] = cnt;

        const szRes = await pool.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size');
        dbSize = szRes.rows[0]?.size || '—';
      } catch (e) {
        pgTest = { ok: false, error: e.message };
        pgError = e.message;
      }
    }

    const jsonData = readJSON();
    const jsonKeys = Object.keys(jsonData).filter(k => k !== PG_CFG_KEY);

    return res.json({
      ok: true,
      usingPg: !!pool,
      source: cfg?.source || 'none',
      hasPgCfgFile: fs.existsSync(PG_CFG_FILE),
      hasEnvPg: !!process.env.PG_HOST,
      hasEnvDbUrl: !!process.env.DATABASE_URL,
      cfgHost: cfg?.host || (cfg?.connectionString ? '(connectionString)' : null),
      pgTest, pgKeys, rowCounts, dbSize,
      pgError,
      jsonKeys,
      cwd: process.cwd(),
    });
  }

  if (action === 'migrate') {
    const pool = await getPool();
    if (!pool) return res.json({ ok: false, error: 'PostgreSQL не подключён' });
    try {
      const source = data || readJSON();
      await pgKv.setMany(pool, source);
      return res.json({ ok: true, migrated: Object.keys(source).length });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  }

  // ── Основные CRUD операции ──
  try {
    const pool = await getPool();

    if (pool) {
      if (action === 'get')     return res.json({ ok: true, value: await pgKv.get(pool, key) });
      if (action === 'set')     { await pgKv.set(pool, key, value); return res.json({ ok: true }); }
      if (action === 'delete')  { await pgKv.delete(pool, key); return res.json({ ok: true }); }
      if (action === 'getAll')  return res.json({ ok: true, data: await pgKv.getAll(pool) });
      if (action === 'setMany') { await pgKv.setMany(pool, data); return res.json({ ok: true }); }
    } else {
      if (action === 'get')     { const s = readJSON(); return res.json({ ok: true, value: s[key] !== undefined ? s[key] : null }); }
      if (action === 'getAll')  return res.json({ ok: true, data: readJSON() });
      if (action === 'set')     { await lock(() => { const s = readJSON(); s[key] = value; writeJSON(s); }); return res.json({ ok: true }); }
      if (action === 'delete')  { await lock(() => { const s = readJSON(); delete s[key]; writeJSON(s); }); return res.json({ ok: true }); }
      if (action === 'setMany') { await lock(() => { const s = readJSON(); Object.assign(s, data || {}); writeJSON(s); }); return res.json({ ok: true }); }
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error('[Store] Ошибка:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
