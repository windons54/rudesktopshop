// pages/api/store.js
// Серверное хранилище — JSON-файл на диске (общий для всех браузеров)
// Если настроен PostgreSQL — использует его

import fs from 'fs';
import path from 'path';

const DATA_DIR  = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

// ── helpers ──────────────────────────────────────────────────────────────────
let _memCache = null;

function readStore() {
  if (_memCache) return _memCache;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STORE_FILE)) {
      _memCache = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    } else {
      _memCache = {};
    }
  } catch { _memCache = {}; }
  return _memCache;
}

function writeStore(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(data), 'utf8');
    _memCache = data;
  } catch (e) { console.error('Store write error:', e); }
}

// ── PostgreSQL helpers ────────────────────────────────────────────────────────
let _pgPool = null;
let _pgConfigKey = null;

async function getPgPool(config) {
  const key = JSON.stringify(config);
  if (_pgPool && _pgConfigKey === key) return _pgPool;
  const { Pool } = await import('pg');
  if (_pgPool) try { await _pgPool.end(); } catch {}
  _pgPool = new Pool({
    host: config.host, port: parseInt(config.port) || 5432,
    database: config.database, user: config.user, password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000, max: 10,
  });
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
  await pool.query(
    `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
     ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,
    [key, JSON.stringify(value)]
  );
}

async function pgGetAll(pool) {
  const r = await pool.query('SELECT key, value FROM kv');
  const out = {};
  r.rows.forEach(({ key, value }) => { try { out[key] = JSON.parse(value); } catch {} });
  return out;
}

// ── main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, key, value, data, pgConfig } = req.body || {};

  // Определяем бэкенд
  const usePg = pgConfig && pgConfig.enabled && pgConfig.host;

  try {
    if (usePg) {
      // ── PostgreSQL backend ──
      const pool = await getPgPool(pgConfig);

      if (action === 'get') {
        const v = await pgGet(pool, key);
        return res.json({ ok: true, value: v });
      }
      if (action === 'set') {
        await pgSet(pool, key, value);
        return res.json({ ok: true });
      }
      if (action === 'delete') {
        await pool.query('DELETE FROM kv WHERE key=$1', [key]);
        return res.json({ ok: true });
      }
      if (action === 'getAll') {
        return res.json({ ok: true, data: await pgGetAll(pool) });
      }
      if (action === 'setMany') {
        // Batch write
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const [k, v] of Object.entries(data || {})) {
            await client.query(
              `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
               ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,
              [k, JSON.stringify(v)]
            );
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
        return res.json({ ok: true });
      }

    } else {
      // ── JSON-file backend ──
      const store = readStore();

      if (action === 'get') {
        return res.json({ ok: true, value: store[key] !== undefined ? store[key] : null });
      }
      if (action === 'set') {
        store[key] = value;
        writeStore(store);
        return res.json({ ok: true });
      }
      if (action === 'delete') {
        delete store[key];
        writeStore(store);
        return res.json({ ok: true });
      }
      if (action === 'getAll') {
        return res.json({ ok: true, data: store });
      }
      if (action === 'setMany') {
        Object.assign(store, data || {});
        writeStore(store);
        return res.json({ ok: true });
      }
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    console.error('Store API error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
