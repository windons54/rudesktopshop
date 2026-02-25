// pages/api/debug.js
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // Защита: доступ только с секретным токеном или в development
  const secret = process.env.DEBUG_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!secret) return res.status(403).json({ error: 'Debug endpoint disabled in production (set DEBUG_SECRET env to enable)' });
    const token = req.query.secret || req.headers['x-debug-secret'];
    if (token !== secret) return res.status(403).json({ error: 'Invalid debug secret' });
  }

  const DATA_DIR    = path.join(process.cwd(), 'data');
  const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
  const STORE_FILE  = path.join(DATA_DIR, 'store.json');

  const hasEnvUrl = !!process.env.DATABASE_URL;
  const hasEnvHost = !!process.env.PG_HOST;

  let pgKeys = [];
  let pgError = null;

  // Connect using DATABASE_URL (priority) or file config
  try {
    const { Pool } = await import('pg');
    let pool;
    if (process.env.DATABASE_URL) {
      pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 5000 });
    } else if (process.env.PG_HOST) {
      pool = new Pool({ host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT)||5432, database: process.env.PG_DATABASE||'postgres', user: process.env.PG_USER, password: process.env.PG_PASSWORD, ssl: process.env.PG_SSL==='true'?{rejectUnauthorized:false}:false, max: 1, connectionTimeoutMillis: 5000 });
    } else if (fs.existsSync(PG_CFG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8'));
      pool = new Pool({ host: cfg.host, port: parseInt(cfg.port)||5432, database: cfg.database, user: cfg.user, password: cfg.password, ssl: cfg.ssl?{rejectUnauthorized:false}:false, max: 1, connectionTimeoutMillis: 5000 });
    }
    if (pool) {
      const r = await pool.query('SELECT key, LEFT(value::text, 80) as val_preview FROM kv ORDER BY key');
      pgKeys = r.rows.map(row => ({ key: row.key, preview: row.val_preview }));
      await pool.end();
    }
  } catch(e) { pgError = e.message; }

  let jsonKeys = [];
  try { if (fs.existsSync(STORE_FILE)) jsonKeys = Object.keys(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))); } catch {}

  return res.json({
    hasEnvUrl, hasEnvHost, hasCfgFile: fs.existsSync(PG_CFG_FILE),
    pgKeys, pgError,
    jsonKeys,
    cwd: process.cwd(),
  });
}
