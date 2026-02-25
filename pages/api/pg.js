// pages/api/pg.js
// Server-side PostgreSQL API handler

let pgPool = null;
let pgConfig = null;

async function getPool(config) {
  // If config changed or no pool, create new one
  const configKey = JSON.stringify(config);
  if (pgPool && pgConfig === configKey) return pgPool;

  // Lazy import pg
  const { Pool } = await import('pg');

  if (pgPool) {
    try { await pgPool.end(); } catch {}
  }

  pgPool = new Pool({
    host: config.host,
    port: parseInt(config.port) || 5432,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10,
  });

  pgConfig = configKey;
  return pgPool;
}

async function ensureKvTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

export default async function handler(req, res) {
  const { action } = req.query;

  if (req.method === 'POST' && action === 'test') {
    const { config } = req.body;
    try {
      const pool = await getPool(config);
      const result = await pool.query('SELECT version(), current_database(), pg_size_pretty(pg_database_size(current_database())) as db_size');
      await ensureKvTable(pool);
      return res.json({
        ok: true,
        version: result.rows[0].version,
        database: result.rows[0].current_database,
        size: result.rows[0].db_size,
      });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'get') {
    const { config, key } = req.body;
    try {
      const pool = await getPool(config);
      await ensureKvTable(pool);
      const result = await pool.query('SELECT value FROM kv WHERE key = $1', [key]);
      if (result.rows.length > 0) {
        return res.json({ ok: true, value: result.rows[0].value });
      }
      return res.json({ ok: true, value: null });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'set') {
    const { config, key, value } = req.body;
    try {
      const pool = await getPool(config);
      await ensureKvTable(pool);
      await pool.query(
        `INSERT INTO kv (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      );
      return res.json({ ok: true });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'delete') {
    const { config, key } = req.body;
    try {
      const pool = await getPool(config);
      await ensureKvTable(pool);
      await pool.query('DELETE FROM kv WHERE key = $1', [key]);
      return res.json({ ok: true });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'all') {
    const { config } = req.body;
    try {
      const pool = await getPool(config);
      await ensureKvTable(pool);
      const result = await pool.query('SELECT key, value FROM kv');
      const out = {};
      result.rows.forEach(({ key, value }) => {
        try { out[key] = JSON.parse(value); } catch {}
      });
      return res.json({ ok: true, data: out });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'stats') {
    const { config } = req.body;
    try {
      const pool = await getPool(config);
      await ensureKvTable(pool);
      const totalRes = await pool.query('SELECT COUNT(*) as total FROM kv');
      const sizeRes = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) as size, pg_database_size(current_database()) as size_bytes`);
      // Count specific keys
      const keysRes = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM kv WHERE key = 'users') as has_users,
          (SELECT value FROM kv WHERE key = 'users') as users_val,
          (SELECT value FROM kv WHERE key = 'products') as products_val,
          (SELECT value FROM kv WHERE key = 'orders') as orders_val,
          (SELECT value FROM kv WHERE key = 'transfers') as transfers_val,
          (SELECT value FROM kv WHERE key = 'categories') as categories_val
      `);
      const row = keysRes.rows[0];
      const countObj = (val) => {
        if (!val) return 0;
        try { const o = JSON.parse(val); return typeof o === 'object' ? Object.keys(o).length : 0; } catch { return 0; }
      };
      return res.json({
        ok: true,
        total: parseInt(totalRes.rows[0].total),
        size: sizeRes.rows[0].size,
        sizeBytes: parseInt(sizeRes.rows[0].size_bytes),
        rowCounts: {
          cm_users: countObj(row.users_val),
          cm_products: countObj(row.products_val),
          cm_orders: countObj(row.orders_val),
          cm_transfers: countObj(row.transfers_val),
          cm_categories: countObj(row.categories_val),
          '_total_keys': parseInt(totalRes.rows[0].total),
        }
      });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'query') {
    const { config, sql } = req.body;
    if (!sql || typeof sql !== 'string') return res.json({ ok: false, error: 'No SQL provided' });
    // Basic safety check - only allow SELECT for non-admin use, but we pass through here
    try {
      const pool = await getPool(config);
      const result = await pool.query(sql);
      return res.json({
        ok: true,
        columns: result.fields ? result.fields.map(f => f.name) : [],
        rows: result.rows || [],
        rowCount: result.rowCount,
      });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'migrate') {
    // Migrate all data from request body to PostgreSQL
    const { config, data } = req.body;
    try {
      const pool = await getPool(config);
      await ensureKvTable(pool);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const [key, value] of Object.entries(data)) {
          await client.query(
            `INSERT INTO kv (key, value, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
            [key, JSON.stringify(value)]
          );
        }
        await client.query('COMMIT');
        return res.json({ ok: true, migrated: Object.keys(data).length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
