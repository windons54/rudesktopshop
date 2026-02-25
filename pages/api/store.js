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

// ── Prisma-клиент (только если DATABASE_URL задан) ─────────────────────────
function hasDatabaseUrl() {
  return !!(process.env.DATABASE_URL || process.env.PG_HOST);
}

async function getPrisma() {
  if (!hasDatabaseUrl()) return null;
  try {
    const { default: prisma } = await import('../../lib/prisma.js');
    await prisma.$queryRaw`SELECT 1`;
    // Убеждаемся что таблица существует (на случай первого запуска без миграции)
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

  if (action === 'pg_diag') {
    const prisma = await getPrisma();
    const { cfg, source } = await getPgConfigForUI().catch(() => ({ cfg: null, source: 'error' }));
    let pgTest = null, pgKeys = [];
    if (prisma) {
      try {
        const cnt = await prisma.kv.count();
        const keys = await prisma.kv.findMany({ select: { key: true }, orderBy: { key: 'asc' } });
        pgTest = { ok: true, rows: cnt };
        pgKeys = keys.map(r => r.key);
      } catch (e) { pgTest = { ok: false, error: e.message }; }
    }
    const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
    return res.json({
      ok: true, usingPg: !!prisma, usingPrisma: true, source,
      hasPgCfgFile: fs.existsSync(PG_CFG_FILE),
      hasEnvPg: !!process.env.PG_HOST, hasEnvDbUrl: !!process.env.DATABASE_URL,
      cfgHost: cfg?.host || (cfg?.connectionString ? '(connectionString)' : null),
      pgTest, pgKeys, cwd: process.cwd(),
    });
  }

  // ── Основные data-операции ──
  try {
    const prisma = await getPrisma();

    if (prisma) {
      if (action === 'get') return res.json({ ok: true, value: await prismaKv.get(prisma, key) });
      if (action === 'set') { await prismaKv.set(prisma, key, value); return res.json({ ok: true }); }
      if (action === 'delete') { await prismaKv.delete(prisma, key); return res.json({ ok: true }); }
      if (action === 'getAll') return res.json({ ok: true, data: await prismaKv.getAll(prisma) });
      if (action === 'setMany') { await prismaKv.setMany(prisma, data); return res.json({ ok: true }); }
    } else {
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
