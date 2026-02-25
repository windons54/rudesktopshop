// pages/api/store.js
// Единое хранилище: PostgreSQL (приоритет) или JSON-файл

import fs from 'fs';
import path from 'path';

const DATA_DIR    = path.join(process.cwd(), 'data');
const STORE_FILE  = path.join(DATA_DIR, 'store.json');
const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');

// ── JSON-file helpers ─────────────────────────────────────────────────────────
let _writeLock = Promise.resolve();

function readStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {}
  return {};
}

function writeStore(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(data), 'utf8');
  } catch (e) { console.error('Store write error:', e); }
}

function withLock(fn) {
  const result = _writeLock.then(fn);
  _writeLock = result.catch(() => {});
  return result;
}

// ── PG config: env > file ─────────────────────────────────────────────────────
function readServerPgConfig() {
  if (process.env.PG_HOST) {
    return { host: process.env.PG_HOST, port: process.env.PG_PORT||'5432',
      database: process.env.PG_DATABASE||process.env.PG_DB||'postgres',
      user: process.env.PG_USER, password: process.env.PG_PASSWORD,
      ssl: process.env.PG_SSL==='true', enabled: true };
  }
  if (process.env.DATABASE_URL) {
    // Support common DATABASE_URL format
    return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, enabled: true };
  }
  try {
    if (fs.existsSync(PG_CFG_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8'));
      if (c && c.host && c.enabled !== false) return c;
    }
  } catch {}
  return null;
}

function savePgConfig(cfg) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (cfg) fs.writeFileSync(PG_CFG_FILE, JSON.stringify(cfg), 'utf8');
    else if (fs.existsSync(PG_CFG_FILE)) fs.unlinkSync(PG_CFG_FILE);
  } catch (e) { console.error('PG config save error:', e); }
}

// ── PostgreSQL pool ───────────────────────────────────────────────────────────
let _pgPool = null;
let _pgConfigKey = null;

async function getPgPool(config) {
  const key = JSON.stringify(config);
  if (_pgPool && _pgConfigKey === key) return _pgPool;
  const { Pool } = await import('pg');
  if (_pgPool) try { await _pgPool.end(); } catch {}
  _pgPool = new Pool(
    config.connectionString
      ? { connectionString: config.connectionString, ssl: config.ssl, connectionTimeoutMillis: 5000, max: 10 }
      : { host: config.host, port: parseInt(config.port)||5432, database: config.database,
          user: config.user, password: config.password,
          ssl: config.ssl ? { rejectUnauthorized: false } : false,
          connectionTimeoutMillis: 5000, max: 10 }
  );
  _pgConfigKey = key;
  await _pgPool.query(`CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  return _pgPool;
}

async function pgGet(pool, key) {
  const r = await pool.query('SELECT value FROM kv WHERE key=$1', [key]);
  if (!r.rows.length) return null;
  try { return JSON.parse(r.rows[0].value); } catch { return r.rows[0].value; }
}

async function pgSet(pool, key, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await pool.query(
    `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
     ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,
    [key, serialized]
  );
}

async function pgGetAll(pool) {
  const r = await pool.query('SELECT key, value FROM kv');
  const out = {};
  r.rows.forEach(({ key, value }) => { try { out[key] = JSON.parse(value); } catch { out[key] = value; } });
  return out;
}

// Resolve which PG config to use: server-side first, client-supplied as fallback
function resolvePgConfig(clientCfg) {
  const server = readServerPgConfig();
  if (server) return server;
  // Fallback: client sent its localStorage config (legacy mode)
  if (clientCfg && clientCfg.enabled && clientCfg.host) return clientCfg;
  return null;
}

// ── main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, key, value, data, pgConfig: clientPgConfig } = req.body || {};

  // ── Admin: save/get/clear server-side pg config ──
  if (action === 'savePgConfig') {
    savePgConfig(req.body.config || null);
    if (_pgPool) { try { await _pgPool.end(); } catch {} _pgPool = null; _pgConfigKey = null; }
    return res.json({ ok: true });
  }
  if (action === 'getPgConfig') {
    const cfg = readServerPgConfig();
    if (cfg) { const { password, ...safe } = cfg; return res.json({ ok: true, config: safe, source: process.env.PG_HOST ? 'env' : 'file' }); }
    return res.json({ ok: true, config: null });
  }
  if (action === 'clearPgConfig') {
    savePgConfig(null);
    if (_pgPool) { try { await _pgPool.end(); } catch {} _pgPool = null; _pgConfigKey = null; }
    return res.json({ ok: true });
  }

  // ── Resolve backend ──
  const pgCfg = resolvePgConfig(clientPgConfig);
  const usePg = !!pgCfg;

  try {
    if (usePg) {
      const pool = await getPgPool(pgCfg);

      if (action === 'get') return res.json({ ok: true, value: await pgGet(pool, key) });
      if (action === 'set') { await pgSet(pool, key, value); return res.json({ ok: true }); }
      if (action === 'delete') { await pool.query('DELETE FROM kv WHERE key=$1', [key]); return res.json({ ok: true }); }
      if (action === 'getAll') return res.json({ ok: true, data: await pgGetAll(pool) });
      if (action === 'setMany') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const [k, v] of Object.entries(data || {})) {
            const s = typeof v === 'string' ? v : JSON.stringify(v);
            await client.query(
              `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
               ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,
              [k, s]
            );
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
        return res.json({ ok: true });
      }
    } else {
      if (action === 'get') return res.json({ ok: true, value: (() => { const s = readStore(); return s[key] !== undefined ? s[key] : null; })() });
      if (action === 'getAll') return res.json({ ok: true, data: readStore() });
      if (action === 'set') { await withLock(() => { const s = readStore(); s[key] = value; writeStore(s); }); return res.json({ ok: true }); }
      if (action === 'delete') { await withLock(() => { const s = readStore(); delete s[key]; writeStore(s); }); return res.json({ ok: true }); }
      if (action === 'setMany') { await withLock(() => { const s = readStore(); Object.assign(s, data || {}); writeStore(s); }); return res.json({ ok: true }); }
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    console.error('Store API error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
