// pages/api/pg.js
// PostgreSQL helpers: test connection, stats, SQL console, migrate

import fs from 'fs';
import path from 'path';

const PG_CFG_FILE = path.join(process.cwd(), 'data', 'pg-config.json');

function readServerPgConfig() {
  if (process.env.PG_HOST) {
    return { host: process.env.PG_HOST, port: process.env.PG_PORT||'5432',
      database: process.env.PG_DATABASE||process.env.PG_DB||'postgres',
      user: process.env.PG_USER, password: process.env.PG_PASSWORD,
      ssl: process.env.PG_SSL === 'true', enabled: true };
  }
  try {
    if (fs.existsSync(PG_CFG_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8'));
      if (c && c.host) return c;
    }
  } catch {}
  return null;
}

let pgPool = null;
let pgPoolKey = null;

async function getPool(config) {
  const key = JSON.stringify(config);
  if (pgPool && pgPoolKey === key) return pgPool;
  const { Pool } = await import('pg');
  if (pgPool) { try { await pgPool.end(); } catch {} }
  pgPool = new Pool({
    host: config.host, port: parseInt(config.port)||5432,
    database: config.database, user: config.user, password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, max: 10,
  });
  pgPoolKey = key;
  return pgPool;
}

async function ensureKvTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { action } = req.query;

  // test uses config from body (called before saving to server)
  if (action === 'test') {
    const { config } = req.body;
    try {
      const pool = await getPool(config);
      const r = await pool.query('SELECT version(), current_database(), pg_size_pretty(pg_database_size(current_database())) as db_size');
      await ensureKvTable(pool);
      return res.json({ ok: true, version: r.rows[0].version, database: r.rows[0].current_database, size: r.rows[0].db_size });
    } catch(err) { return res.json({ ok: false, error: err.message }); }
  }

  // migrate uses config from body (can be called with explicit config)
  if (action === 'migrate') {
    const { config, data } = req.body;
    const cfg = config || readServerPgConfig();
    if (!cfg) return res.json({ ok: false, error: 'PostgreSQL не настроен' });
    try {
      const pool = await getPool(cfg);
      await ensureKvTable(pool);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const [k, v] of Object.entries(data||{})) {
          await client.query(
            `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
             ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,
            [k, JSON.stringify(v)]
          );
        }
        await client.query('COMMIT');
        return res.json({ ok: true, migrated: Object.keys(data||{}).length });
      } catch(e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    } catch(err) { return res.json({ ok: false, error: err.message }); }
  }

  // stats and query use server-side config
  const cfg = readServerPgConfig();
  if (!cfg) return res.json({ ok: false, error: 'PostgreSQL не настроен на сервере' });

  if (action === 'stats') {
    try {
      const pool = await getPool(cfg);
      await ensureKvTable(pool);
      const totalRes = await pool.query('SELECT COUNT(*) as total FROM kv');
      const sizeRes  = await pool.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size');
      return res.json({ ok: true,
        total: parseInt(totalRes.rows[0].total),
        size: sizeRes.rows[0].size,
        rowCounts: { '_total_keys': parseInt(totalRes.rows[0].total) }
      });
    } catch(err) { return res.json({ ok: false, error: err.message }); }
  }

  if (action === 'query') {
    const { sql } = req.body;
    if (!sql) return res.json({ ok: false, error: 'No SQL provided' });
    // В production разрешаем только SELECT для безопасности
    if (process.env.NODE_ENV === 'production') {
      const trimmed = sql.trim().toUpperCase();
      if (!trimmed.startsWith('SELECT')) {
        return res.json({ ok: false, error: 'Only SELECT queries allowed in production' });
      }
    }
    try {
      const pool = await getPool(cfg);
      const r = await pool.query(sql);
      return res.json({ ok: true, columns: r.fields ? r.fields.map(f => f.name) : [], rows: r.rows||[], rowCount: r.rowCount });
    } catch(err) { return res.json({ ok: false, error: err.message }); }
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
