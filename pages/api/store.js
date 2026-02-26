// pages/api/store.js
// Слой хранения данных через Prisma (PostgreSQL) с fallback на JSON-файл.
//
// Porядок подключения:
//   1. DATABASE_URL (env) → Prisma автоматически использует его
//   2. Файл data/store.json — только локальная разработка без БД

import fs from 'fs';
import path from 'path';

const DATA_DIR   = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const PG_CFG_KEY = '__pg_config__';

// ── JSON-файл (локальная разработка без БД) ────────────────────────────────
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

// ── Чтение конфига PG из файла или env ────────────────────────────────────
const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');

function readPgConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  if (process.env.PG_HOST) return {
    host: process.env.PG_HOST, port: process.env.PG_PORT || '5432',
    database: process.env.PG_DATABASE || process.env.PG_DB || 'postgres',
    user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    ssl: process.env.PG_SSL === 'true',
  };
  try {
    if (fs.existsSync(PG_CFG_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8'));
      if (c && (c.host || c.connectionString)) return c;
    }
  } catch {}
  return null;
}

// Пул pg — переиспользуется между запросами
let _pgPool = null;
let _pgPoolKey = null;

async function getPgPool() {
  const cfg = readPgConfig();
  if (!cfg) return null;
  const key = JSON.stringify(cfg);
  if (_pgPool && _pgPoolKey === key) return _pgPool;
  try {
    const { Pool } = await import('pg');
    if (_pgPool) { try { await _pgPool.end(); } catch {} }
    const opts = cfg.connectionString
      ? { connectionString: cfg.connectionString, ssl: { rejectUnauthorized: false }, max: 10, connectionTimeoutMillis: 5000 }
      : { host: cfg.host, port: parseInt(cfg.port) || 5432, database: cfg.database, user: cfg.user, password: cfg.password,
          ssl: cfg.ssl ? { rejectUnauthorized: false } : false, max: 10, connectionTimeoutMillis: 5000 };
    _pgPool = new Pool(opts);
    await _pgPool.query('SELECT 1');
    await _pgPool.query(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    _pgPoolKey = key;
    return _pgPool;
  } catch (e) {
    console.error('[PG] Ошибка подключения:', e.message);
    _pgPool = null; _pgPoolKey = null;
    return null;
  }
}

// ── Prisma-клиент (только если DATABASE_URL задан через env) ───────────────
function hasDatabaseUrl() {
  return !!(process.env.DATABASE_URL || process.env.PG_HOST);
}

async function getPrisma() {
  if (!hasDatabaseUrl()) return null;
  try {
    const { default: prisma } = await import('../../lib/prisma.js');
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    return prisma;
  } catch (e) {
    console.error('[Prisma] Ошибка подключения:', e.message);
    return null;
  }
}

// Утилита: сериализовать значение
function serialize(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// Утилита: десериализовать значение
function deserialize(raw) {
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

// ── Prisma: операции с kv ────────────────────────────────────────────────
const prismaKv = {
  async get(prisma, key) {
    const row = await prisma.kv.findUnique({ where: { key } });
    return row ? deserialize(row.value) : null;
  },
  async set(prisma, key, value) {
    const serialized = serialize(value);
    await prisma.kv.upsert({
      where: { key },
      update: { value: serialized, updated_at: new Date() },
      create: { key, value: serialized },
    });
  },
  async delete(prisma, key) {
    await prisma.kv.deleteMany({ where: { key } });
  },
  async getAll(prisma) {
    const rows = await prisma.kv.findMany({
      where: { key: { not: PG_CFG_KEY } },
      orderBy: { key: 'asc' },
    });
    const out = {};
    rows.forEach(({ key, value }) => { out[key] = deserialize(value); });
    return out;
  },
  async setMany(prisma, data) {
    await prisma.$transaction(
      Object.entries(data || {}).map(([key, value]) =>
        prisma.kv.upsert({
          where: { key },
          update: { value: serialize(value), updated_at: new Date() },
          create: { key, value: serialize(value) },
        })
      )
    );
  },
};

// ── pg_config операции ─────────────────────────────────────────────────────
async function getPgConfigForUI() {
  const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
  try {
    if (fs.existsSync(PG_CFG_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8'));
      if (c?.host || c?.connectionString) return { cfg: c, source: 'file' };
    }
  } catch {}
  if (process.env.DATABASE_URL) return { cfg: { connectionString: process.env.DATABASE_URL }, source: 'env_url' };
  if (process.env.PG_HOST) return { cfg: {
    host: process.env.PG_HOST, port: process.env.PG_PORT || '5432',
    database: process.env.PG_DATABASE || process.env.PG_DB || 'postgres',
    user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    ssl: process.env.PG_SSL === 'true',
  }, source: 'env_host' };
  return { cfg: null, source: 'none' };
}

async function persistPgConfig(cfg) {
  const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
  try {
    ensureDir();
    if (cfg) fs.writeFileSync(PG_CFG_FILE, JSON.stringify(cfg), 'utf8');
    else if (fs.existsSync(PG_CFG_FILE)) fs.unlinkSync(PG_CFG_FILE);
  } catch {}
  const prisma = await getPrisma();
  if (prisma) {
    if (cfg) await prismaKv.set(prisma, PG_CFG_KEY, cfg);
    else await prismaKv.delete(prisma, PG_CFG_KEY);
  }
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
      const { cfg, source } = await getPgConfigForUI();
      if (!cfg) return res.json({ ok: true, config: null, source: 'none' });
      const { password, ...safe } = cfg;
      safe._passwordSaved = !!(password);
      return res.json({ ok: true, config: safe, source });
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

  if (action === 'pg_stats') {
    const prisma = await getPrisma();
    const pool = prisma ? null : await getPgPool();
    if (!prisma && !pool) return res.json({ ok: false, error: 'PostgreSQL не подключён' });
    try {
      const statKeys = ['cm_users', 'cm_products', 'cm_orders', 'cm_transfers', 'cm_categories'];
      let totalRows = 0, dbSize = '—', rowCounts = {};

      function countValue(v) {
        try { const p = JSON.parse(v); return Array.isArray(p) ? p.length : (p && typeof p === 'object' ? Object.keys(p).length : 1); }
        catch { return v ? 1 : 0; }
      }

      if (prisma) {
        totalRows = await prisma.kv.count();
        try { const sr = await prisma.$queryRaw`SELECT pg_size_pretty(pg_database_size(current_database())) as size`; dbSize = sr[0]?.size || '—'; } catch {}
        const rows = await prisma.kv.findMany({ where: { key: { in: statKeys } }, select: { key: true, value: true } });
        for (const { key: k, value: v } of rows) rowCounts[k] = countValue(v);
      } else {
        const tr = await pool.query('SELECT COUNT(*) as c FROM kv');
        totalRows = parseInt(tr.rows[0].c);
        try { const sr = await pool.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size'); dbSize = sr.rows[0]?.size || '—'; } catch {}
        const rows = await pool.query('SELECT key, value FROM kv WHERE key = ANY($1)', [statKeys]);
        for (const { key: k, value: v } of rows.rows) rowCounts[k] = countValue(v);
      }

      rowCounts['_total_keys'] = totalRows;
      for (const k of statKeys) { if (!(k in rowCounts)) rowCounts[k] = 0; }
      return res.json({ ok: true, total: totalRows, size: dbSize, rowCounts });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  }

    if (action === 'pg_diag') {
    const prisma = await getPrisma();
    const pool = prisma ? null : await getPgPool();
    const { cfg, source } = await getPgConfigForUI().catch(() => ({ cfg: null, source: 'error' }));
    let pgTest = null, pgKeys = [];
    if (prisma) {
      try {
        const cnt = await prisma.kv.count();
        const keys = await prisma.kv.findMany({ select: { key: true }, orderBy: { key: 'asc' } });
        pgTest = { ok: true, rows: cnt };
        pgKeys = keys.map(r => r.key);
      } catch (e) { pgTest = { ok: false, error: e.message }; }
    } else if (pool) {
      try {
        const cnt = await pool.query('SELECT COUNT(*) as c FROM kv');
        const keys = await pool.query('SELECT key FROM kv ORDER BY key');
        pgTest = { ok: true, rows: parseInt(cnt.rows[0].c) };
        pgKeys = keys.rows.map(r => r.key);
      } catch (e) { pgTest = { ok: false, error: e.message }; }
    }
    return res.json({
      ok: true, usingPg: !!(prisma || pool), usingPrisma: !!prisma, source,
      hasPgCfgFile: fs.existsSync(PG_CFG_FILE),
      hasEnvPg: !!process.env.PG_HOST, hasEnvDbUrl: !!process.env.DATABASE_URL,
      cfgHost: cfg?.host || (cfg?.connectionString ? '(connectionString)' : null),
      pgTest, pgKeys, cwd: process.cwd(),
    });
  }

  // ── Основные data-операции ──
  try {
    // Сначала пробуем Prisma (env), затем pg напрямую (файл конфига), затем JSON
    const prisma = await getPrisma();
    const pool = prisma ? null : await getPgPool();

    if (prisma) {
      // Prisma (DATABASE_URL из env)
      if (action === 'get') return res.json({ ok: true, value: await prismaKv.get(prisma, key) });
      if (action === 'set') { await prismaKv.set(prisma, key, value); return res.json({ ok: true }); }
      if (action === 'delete') { await prismaKv.delete(prisma, key); return res.json({ ok: true }); }
      if (action === 'getAll') return res.json({ ok: true, data: await prismaKv.getAll(prisma) });
      if (action === 'setMany') { await prismaKv.setMany(prisma, data); return res.json({ ok: true }); }
    } else if (pool) {
      // pg напрямую (конфиг из файла pg-config.json)
      if (action === 'get') {
        const r = await pool.query('SELECT value FROM kv WHERE key=$1', [key]);
        return res.json({ ok: true, value: r.rows[0] ? deserialize(r.rows[0].value) : null });
      }
      if (action === 'set') {
        await pool.query(
          `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
           ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,
          [key, serialize(value)]
        );
        return res.json({ ok: true });
      }
      if (action === 'delete') {
        await pool.query('DELETE FROM kv WHERE key=$1', [key]);
        return res.json({ ok: true });
      }
      if (action === 'getAll') {
        const r = await pool.query(`SELECT key,value FROM kv WHERE key!=$1 ORDER BY key`, [PG_CFG_KEY]);
        const out = {};
        r.rows.forEach(({ key: k, value: v }) => { out[k] = deserialize(v); });
        return res.json({ ok: true, data: out });
      }
      if (action === 'setMany') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const [k, v] of Object.entries(data || {})) {
            await client.query(
              `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
               ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,
              [k, serialize(v)]
            );
          }
          await client.query('COMMIT');
        } catch(e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
        return res.json({ ok: true });
      }
    } else {
      // Fallback: JSON-файл
      if (action === 'get') { const s = readJSON(); return res.json({ ok: true, value: s[key] !== undefined ? s[key] : null }); }
      if (action === 'getAll') return res.json({ ok: true, data: readJSON() });
      if (action === 'set') { await lock(() => { const s = readJSON(); s[key] = value; writeJSON(s); }); return res.json({ ok: true }); }
      if (action === 'delete') { await lock(() => { const s = readJSON(); delete s[key]; writeJSON(s); }); return res.json({ ok: true }); }
      if (action === 'setMany') { await lock(() => { const s = readJSON(); Object.assign(s, data || {}); writeJSON(s); }); return res.json({ ok: true }); }
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error('[Store] Ошибка:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
