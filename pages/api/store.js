// pages/api/store.js — единое хранилище. pgConfig ТОЛЬКО на сервере, клиент его не передаёт.
import fs from 'fs';
import path from 'path';

const DATA_DIR   = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');

// ── JSON helpers ──────────────────────────────────────────────────────────────
let _lock = Promise.resolve();
const lock = fn => { const r = _lock.then(fn); _lock = r.catch(()=>{}); return r; };

const ensureDir = () => { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive:true }); };

function readJSON() {
  try { ensureDir(); if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE,'utf8')); } catch {}
  return {};
}
function writeJSON(data) {
  try { ensureDir(); fs.writeFileSync(STORE_FILE, JSON.stringify(data), 'utf8'); } catch(e) { console.error(e); }
}

// ── PG config ─────────────────────────────────────────────────────────────────
function readPgCfg() {
  // 1. env vars
  if (process.env.PG_HOST) return { host:process.env.PG_HOST, port:process.env.PG_PORT||'5432', database:process.env.PG_DATABASE||process.env.PG_DB||'postgres', user:process.env.PG_USER, password:process.env.PG_PASSWORD, ssl:process.env.PG_SSL==='true' };
  if (process.env.DATABASE_URL) return { connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} };
  // 2. file saved by admin
  try { if (fs.existsSync(PG_CFG_FILE)) { const c = JSON.parse(fs.readFileSync(PG_CFG_FILE,'utf8')); if (c?.host) return c; } } catch {}
  return null;
}
function writePgCfg(cfg) {
  try { ensureDir(); if (cfg) fs.writeFileSync(PG_CFG_FILE, JSON.stringify(cfg), 'utf8'); else if (fs.existsSync(PG_CFG_FILE)) fs.unlinkSync(PG_CFG_FILE); } catch(e) { console.error(e); }
}

// ── PG pool ───────────────────────────────────────────────────────────────────
let _pool = null, _poolKey = null;
async function getPool() {
  const cfg = readPgCfg();
  if (!cfg) return null;
  const key = JSON.stringify(cfg);
  if (_pool && _poolKey===key) return _pool;
  const { Pool } = await import('pg');
  if (_pool) try { await _pool.end(); } catch {}
  _pool = new Pool(cfg.connectionString ? { connectionString:cfg.connectionString, ssl:cfg.ssl, max:10, connectionTimeoutMillis:5000 } : { host:cfg.host, port:parseInt(cfg.port)||5432, database:cfg.database, user:cfg.user, password:cfg.password, ssl:cfg.ssl?{rejectUnauthorized:false}:false, max:10, connectionTimeoutMillis:5000 });
  _poolKey = key;
  await _pool.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  return _pool;
}

// ── main ──────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { action, key, value, data, config } = req.body || {};

  // --- pg config management ---
  if (action === 'pg_save') {
    let cfgToSave = config || null;
    // If saving but password is empty, preserve existing password from file
    if (cfgToSave && !cfgToSave.password) {
      try {
        const existing = readPgCfg();
        if (existing && existing.password) {
          cfgToSave = { ...cfgToSave, password: existing.password };
        }
      } catch {}
    }
    writePgCfg(cfgToSave);
    if (_pool) { try { await _pool.end(); } catch {} _pool = null; _poolKey = null; }
    return res.json({ ok:true });
  }
  if (action === 'pg_get') {
    const cfg = readPgCfg();
    if (!cfg) return res.json({ ok:true, config:null, source:'none' });
    const { password, ...safe } = cfg;
    safe._passwordSaved = !!(password);
    return res.json({ ok:true, config:safe, source: process.env.PG_HOST?'env':'file' });
  }
  if (action === 'pg_test') {
    const cfg = config || readPgCfg();
    if (!cfg) return res.json({ ok:false, error:'Нет конфига' });
    try {
      const { Pool } = await import('pg');
      const p = new Pool(cfg.connectionString ? { connectionString:cfg.connectionString, ssl:cfg.ssl, max:1, connectionTimeoutMillis:5000 } : { host:cfg.host, port:parseInt(cfg.port)||5432, database:cfg.database, user:cfg.user, password:cfg.password, ssl:cfg.ssl?{rejectUnauthorized:false}:false, max:1, connectionTimeoutMillis:5000 });
      const r = await p.query('SELECT version(), current_database() as db, pg_size_pretty(pg_database_size(current_database())) as sz');
      await p.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      const cnt = await p.query('SELECT COUNT(*) as c FROM kv');
      await p.end();
      return res.json({ ok:true, version:r.rows[0].version, database:r.rows[0].db, size:r.rows[0].sz, rows:parseInt(cnt.rows[0].c) });
    } catch(e) { return res.json({ ok:false, error:e.message }); }
  }
  if (action === 'pg_diag') {
    const pool = await getPool();
    const cfg = readPgCfg();
    const source = process.env.PG_HOST ? 'env_host' : process.env.DATABASE_URL ? 'env_url' : fs.existsSync(PG_CFG_FILE) ? 'file' : 'none';
    let pgTest = null;
    let pgKeys = [];
    if (pool) {
      try {
        const cnt = await pool.query('SELECT COUNT(*) as c FROM kv');
        const keys = await pool.query('SELECT key FROM kv ORDER BY key');
        pgTest = { ok:true, rows:parseInt(cnt.rows[0].c) };
        pgKeys = keys.rows.map(r => r.key);
      } catch(e) { pgTest={ok:false,error:e.message}; }
    }
    const jsonKeys = Object.keys(readJSON());
    return res.json({ ok:true,
      usingPg: !!pool, source, hasPgCfgFile: fs.existsSync(PG_CFG_FILE),
      hasEnvPg: !!process.env.PG_HOST, hasEnvDbUrl: !!process.env.DATABASE_URL,
      cfgHost: cfg?.host || (cfg?.connectionString ? '(connectionString)' : null),
      pgTest, pgKeys, jsonKeys, cwd:process.cwd()
    });
  }

  // --- data operations ---
  try {
    const pool = await getPool();
    if (pool) {
      // PostgreSQL backend
      if (action==='get') {
        const r = await pool.query('SELECT value FROM kv WHERE key=$1',[key]);
        const v = r.rows[0]?.value;
        return res.json({ ok:true, value: v!=null ? (() => { try{return JSON.parse(v);}catch{return v;} })() : null });
      }
      if (action==='set') {
        const s = typeof value==='string' ? value : JSON.stringify(value);
        await pool.query(`INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,[key,s]);
        return res.json({ ok:true });
      }
      if (action==='delete') {
        await pool.query('DELETE FROM kv WHERE key=$1',[key]);
        return res.json({ ok:true });
      }
      if (action==='getAll') {
        const r = await pool.query('SELECT key,value FROM kv');
        const out = {};
        r.rows.forEach(({key:k,value:v}) => { try{out[k]=JSON.parse(v);}catch{out[k]=v;} });
        return res.json({ ok:true, data:out });
      }
      if (action==='setMany') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const [k,v] of Object.entries(data||{})) {
            const s = typeof v==='string'?v:JSON.stringify(v);
            await client.query(`INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,[k,s]);
          }
          await client.query('COMMIT');
        } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
        return res.json({ ok:true });
      }
    } else {
      // JSON file backend
      if (action==='get') { const s=readJSON(); return res.json({ok:true,value:s[key]!==undefined?s[key]:null}); }
      if (action==='getAll') { return res.json({ok:true,data:readJSON()}); }
      if (action==='set') { await lock(()=>{const s=readJSON();s[key]=value;writeJSON(s);}); return res.json({ok:true}); }
      if (action==='delete') { await lock(()=>{const s=readJSON();delete s[key];writeJSON(s);}); return res.json({ok:true}); }
      if (action==='setMany') { await lock(()=>{const s=readJSON();Object.assign(s,data||{});writeJSON(s);}); return res.json({ok:true}); }
    }
    return res.status(400).json({ ok:false, error:'Unknown action' });
  } catch(e) {
    console.error('Store error:', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
}
