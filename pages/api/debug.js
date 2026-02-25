// pages/api/debug.js — временная диагностика
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  const DATA_DIR    = path.join(process.cwd(), 'data');
  const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
  const STORE_FILE  = path.join(DATA_DIR, 'store.json');

  // Серверный pg-config
  let pgCfgFile = null;
  try { if (fs.existsSync(PG_CFG_FILE)) pgCfgFile = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8')); } catch(e) { pgCfgFile = { error: e.message }; }

  // ENV
  const envPg = {
    PG_HOST: process.env.PG_HOST || null,
    PG_USER: process.env.PG_USER || null,
    PG_DATABASE: process.env.PG_DATABASE || null,
    DATABASE_URL: process.env.DATABASE_URL ? '[SET]' : null,
  };

  // JSON store keys
  let storeKeys = [];
  try { if (fs.existsSync(STORE_FILE)) storeKeys = Object.keys(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))); } catch {}

  // Client pgConfig from request body
  const clientCfg = req.method === 'POST' ? (req.body?.pgConfig || null) : null;

  // Try PG connection if config available
  let pgTest = null;
  const cfg = pgCfgFile && pgCfgFile.host ? pgCfgFile : (envPg.PG_HOST ? { host: envPg.PG_HOST } : null);
  if (cfg || clientCfg) {
    try {
      const activeCfg = cfg || clientCfg;
      const { Pool } = await import('pg');
      const pool = new Pool({
        host: activeCfg.host, port: parseInt(activeCfg.port)||5432,
        database: activeCfg.database, user: activeCfg.user, password: activeCfg.password,
        ssl: activeCfg.ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 3000, max: 1,
      });
      const r = await pool.query('SELECT COUNT(*) as cnt FROM kv');
      pgTest = { ok: true, rows: parseInt(r.rows[0].cnt) };
      await pool.end();
    } catch(e) { pgTest = { ok: false, error: e.message }; }
  }

  return res.json({
    serverPgCfgFile: pgCfgFile ? { host: pgCfgFile.host, database: pgCfgFile.database, user: pgCfgFile.user, enabled: pgCfgFile.enabled, hasPassword: !!pgCfgFile.password } : null,
    envPg,
    clientCfgReceived: clientCfg ? { host: clientCfg.host, enabled: clientCfg.enabled } : null,
    jsonStoreKeys: storeKeys,
    pgConnectionTest: pgTest,
    cwd: process.cwd(),
    dataDir: DATA_DIR,
    pgCfgFileExists: fs.existsSync(PG_CFG_FILE),
    storeFileExists: fs.existsSync(STORE_FILE),
  });
}
