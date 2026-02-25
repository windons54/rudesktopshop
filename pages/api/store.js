// pages/api/store.js
// На Vercel файловая система read-only между запросами — файлы не персистентны.
// Поэтому pg-конфиг хранится:
//   1. В env-переменных Vercel (DATABASE_URL / PG_HOST и др.) — приоритет
//   2. В самой БД PostgreSQL в таблице kv под ключом __pg_config__ — если БД уже есть
//   3. В JSON-файле — только для локальной разработки

import fs from 'fs';
import path from 'path';

const DATA_DIR   = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
const PG_CFG_KV_KEY = '__pg_config__';

// ── JSON helpers (локальная разработка) ───────────────────────────────────────
let _lock = Promise.resolve();
const lock = fn => { const r = _lock.then(fn); _lock = r.catch(()=>{}); return r; };
const ensureDir = () => { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive:true }); } catch {} };

function readJSON() {
  try { ensureDir(); if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE,'utf8')); } catch {}
  return {};
}
function writeJSON(data) {
  try { ensureDir(); fs.writeFileSync(STORE_FILE, JSON.stringify(data), 'utf8'); } catch(e) { console.error(e); }
}
function readPgCfgFile() {
  try { if (fs.existsSync(PG_CFG_FILE)) { const c = JSON.parse(fs.readFileSync(PG_CFG_FILE,'utf8')); if (c?.host || c?.connectionString) return c; } } catch {}
  return null;
}
function writePgCfgFile(cfg) {
  try { ensureDir(); if (cfg) fs.writeFileSync(PG_CFG_FILE, JSON.stringify(cfg), 'utf8'); else if (fs.existsSync(PG_CFG_FILE)) fs.unlinkSync(PG_CFG_FILE); } catch {}
}

// ── PG pool ───────────────────────────────────────────────────────────────────
let _pool = null, _poolCfgKey = null;

function buildPoolOptions(cfg) {
  if (cfg.connectionString) {
    return { connectionString: cfg.connectionString, ssl: cfg.ssl ?? { rejectUnauthorized: false }, max: 10, connectionTimeoutMillis: 8000 };
  }
  return { host: cfg.host, port: parseInt(cfg.port)||5432, database: cfg.database, user: cfg.user, password: cfg.password, ssl: cfg.ssl ? { rejectUnauthorized: false } : false, max: 10, connectionTimeoutMillis: 8000 };
}

// Получить конфиг из env (без обращения к БД)
function getCfgFromEnv() {
  if (process.env.PG_HOST) {
    return { host: process.env.PG_HOST, port: process.env.PG_PORT||'5432', database: process.env.PG_DATABASE||process.env.PG_DB||'postgres', user: process.env.PG_USER, password: process.env.PG_PASSWORD, ssl: process.env.PG_SSL==='true' };
  }
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  return null;
}

// Получить пул — сначала env, потом попробовать прочитать конфиг из самой БД
async function getPool() {
  // Если уже есть рабочий пул — используем его
  if (_pool && _poolCfgKey) {
    try { await _pool.query('SELECT 1'); return _pool; } catch { _pool = null; _poolCfgKey = null; }
  }

  // 1. Попробовать env
  const envCfg = getCfgFromEnv();
  if (envCfg) {
    const key = JSON.stringify(envCfg);
    if (_pool && _poolCfgKey === key) return _pool;
    const { Pool } = await import('pg');
    if (_pool) try { await _pool.end(); } catch {}
    _pool = new Pool(buildPoolOptions(envCfg));
    await _pool.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    _poolCfgKey = key;
    return _pool;
  }

  // 2. Попробовать конфиг из файла (локальная разработка)
  const fileCfg = readPgCfgFile();
  if (fileCfg) {
    const key = JSON.stringify(fileCfg);
    if (_pool && _poolCfgKey === key) return _pool;
    const { Pool } = await import('pg');
    if (_pool) try { await _pool.end(); } catch {}
    _pool = new Pool(buildPoolOptions(fileCfg));
    await _pool.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    _poolCfgKey = key;
    return _pool;
  }

  return null;
}

// Создать временный пул по произвольному конфигу (для test/save)
async function makePool(cfg) {
  const { Pool } = await import('pg');
  const p = new Pool({ ...buildPoolOptions(cfg), max: 1 });
  return p;
}

// ── Сохранить pg-конфиг персистентно ─────────────────────────────────────────
// Стратегия: сохраняем в файл (локально) И в саму БД (для Vercel)
async function savePgConfig(cfg) {
  // Всегда пишем в файл (работает локально, на Vercel — эфемерно, но не вредит)
  writePgCfgFile(cfg);

  if (!cfg) {
    // Удаляем конфиг из БД (если БД доступна через env)
    try {
      const pool = await getPool();
      if (pool) await pool.query('DELETE FROM kv WHERE key=$1', [PG_CFG_KV_KEY]);
    } catch {}
    return;
  }

  // Сохраняем конфиг в саму БД — используем переданный конфиг для подключения
  try {
    const p = await makePool(cfg);
    await p.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await p.query(
      `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,
      [PG_CFG_KV_KEY, JSON.stringify(cfg)]
    );
    await p.end();
  } catch(e) {
    console.error('savePgConfig to DB failed:', e.message);
  }
}

// Прочитать сохранённый pg-конфиг (env → файл → из самой БД)
async function loadPgConfig() {
  // env — высший приоритет
  const envCfg = getCfgFromEnv();
  if (envCfg) return { cfg: envCfg, source: process.env.PG_HOST ? 'env_host' : 'env_url' };

  // файл (локально)
  const fileCfg = readPgCfgFile();
  if (fileCfg) return { cfg: fileCfg, source: 'file' };

  // БД — только если есть DATABASE_URL (bootstrapping через env)
  // Этот путь используется если конфиг был сохранён ранее в kv
  // но env уже не нужен — конфиг лежит в БД
  // (На практике на Vercel всегда будет DATABASE_URL в env)
  return { cfg: null, source: 'none' };
}

// ── main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { action, key, value, data, config } = req.body || {};

  // --- pg config management ---
  if (action === 'pg_save') {
    let cfgToSave = config || null;

    if (cfgToSave) {
      // Если пароль пустой — попробовать сохранить существующий
      if (!cfgToSave.password) {
        try {
          const pool = await getPool();
          if (pool) {
            const r = await pool.query('SELECT value FROM kv WHERE key=$1', [PG_CFG_KV_KEY]);
            if (r.rows[0]) {
              const existing = JSON.parse(r.rows[0].value);
              if (existing.password) cfgToSave = { ...cfgToSave, password: existing.password };
            }
          } else {
            const fileCfg = readPgCfgFile();
            if (fileCfg?.password) cfgToSave = { ...cfgToSave, password: fileCfg.password };
          }
        } catch {}
      }
    }

    await savePgConfig(cfgToSave);
    // Сбросить пул чтобы переподключился с новым конфигом
    if (_pool) { try { await _pool.end(); } catch {} _pool = null; _poolCfgKey = null; }
    return res.json({ ok: true });
  }

  if (action === 'pg_get') {
    const { cfg, source } = await loadPgConfig();
    if (!cfg) return res.json({ ok: true, config: null, source: 'none' });
    const { password, ...safe } = cfg;
    safe._passwordSaved = !!(password);
    return res.json({ ok: true, config: safe, source });
  }

  if (action === 'pg_test') {
    const cfg = config;
    if (!cfg) return res.json({ ok: false, error: 'Нет конфига' });
    try {
      const p = await makePool(cfg);
      const r = await p.query('SELECT version(), current_database() as db, pg_size_pretty(pg_database_size(current_database())) as sz');
      await p.query(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      const cnt = await p.query('SELECT COUNT(*) as c FROM kv');
      await p.end();
      return res.json({ ok: true, version: r.rows[0].version, database: r.rows[0].db, size: r.rows[0].sz, rows: parseInt(cnt.rows[0].c) });
    } catch(e) { return res.json({ ok: false, error: e.message }); }
  }

  if (action === 'pg_diag') {
    const pool = await getPool();
    const { cfg, source } = await loadPgConfig();
    let pgTest = null, pgKeys = [];
    if (pool) {
      try {
        const cnt = await pool.query('SELECT COUNT(*) as c FROM kv');
        const keys = await pool.query('SELECT key FROM kv ORDER BY key');
        pgTest = { ok: true, rows: parseInt(cnt.rows[0].c) };
        pgKeys = keys.rows.map(r => r.key);
      } catch(e) { pgTest = { ok: false, error: e.message }; }
    }
    const jsonKeys = Object.keys(readJSON());
    return res.json({ ok: true,
      usingPg: !!pool, source,
      hasPgCfgFile: fs.existsSync(PG_CFG_FILE),
      hasEnvPg: !!process.env.PG_HOST,
      hasEnvDbUrl: !!process.env.DATABASE_URL,
      cfgHost: cfg?.host || (cfg?.connectionString ? '(connectionString)' : null),
      pgTest, pgKeys, jsonKeys, cwd: process.cwd()
    });
  }

  // --- data operations ---
  try {
    const pool = await getPool();
    if (pool) {
      if (action==='get') {
        const r = await pool.query('SELECT value FROM kv WHERE key=$1', [key]);
        const v = r.rows[0]?.value;
        return res.json({ ok: true, value: v != null ? (() => { try { return JSON.parse(v); } catch { return v; } })() : null });
      }
      if (action==='set') {
        const s = typeof value==='string' ? value : JSON.stringify(value);
        await pool.query(`INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`, [key, s]);
        return res.json({ ok: true });
      }
      if (action==='delete') {
        await pool.query('DELETE FROM kv WHERE key=$1', [key]);
        return res.json({ ok: true });
      }
      if (action==='getAll') {
        const r = await pool.query('SELECT key,value FROM kv');
        const out = {};
        r.rows.forEach(({key:k,value:v}) => { try { out[k]=JSON.parse(v); } catch { out[k]=v; } });
        return res.json({ ok: true, data: out });
      }
      if (action==='setMany') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const [k,v] of Object.entries(data||{})) {
            const s = typeof v==='string' ? v : JSON.stringify(v);
            await client.query(`INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`, [k, s]);
          }
          await client.query('COMMIT');
        } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
        return res.json({ ok: true });
      }
    } else {
      // JSON-файл (локально без БД)
      if (action==='get') { const s=readJSON(); return res.json({ ok:true, value: s[key]!==undefined ? s[key] : null }); }
      if (action==='getAll') { return res.json({ ok:true, data: readJSON() }); }
      if (action==='set') { await lock(()=>{ const s=readJSON(); s[key]=value; writeJSON(s); }); return res.json({ ok:true }); }
      if (action==='delete') { await lock(()=>{ const s=readJSON(); delete s[key]; writeJSON(s); }); return res.json({ ok:true }); }
      if (action==='setMany') { await lock(()=>{ const s=readJSON(); Object.assign(s, data||{}); writeJSON(s); }); return res.json({ ok:true }); }
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch(e) {
    console.error('Store error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
