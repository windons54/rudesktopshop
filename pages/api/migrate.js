// pages/api/migrate.js — ручной запуск миграции cm_appearance → cm_images
// POST /api/migrate  { secret: "..." }
// GET  /api/migrate  — статус (без изменений)
//
// Защищён секретом MIGRATE_SECRET (env) или admin-паролем из cm_config.
// Если ни то ни другое не задано — доступен только локально (127.0.0.1).

import { Pool } from 'pg';
import { runMigration } from '../../lib/migration.js';

function getPgConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  if (process.env.PG_HOST) {
    return {
      host:     process.env.PG_HOST,
      port:     parseInt(process.env.PG_PORT || '5432', 10),
      database: process.env.PG_DATABASE || process.env.PG_DB || 'postgres',
      user:     process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      ssl:      process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };
  }
  return null;
}

function isAuthorized(req, body) {
  const secret = process.env.MIGRATE_SECRET;
  if (secret) return body?.secret === secret;

  // Fallback: только localhost
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export default async function handler(req, res) {
  // GET — статус без изменений
  if (req.method === 'GET') {
    const pgConfig = getPgConfig();
    if (!pgConfig) return res.json({ ok: false, error: 'No PG config' });
    const pool = new Pool({ ...pgConfig, max: 1, connectionTimeoutMillis: 5000 });
    try {
      const r = await pool.query('SELECT value FROM kv WHERE key = $1', ['cm_images']);
      const ap = await pool.query('SELECT length(value) as len FROM kv WHERE key = $1', ['cm_appearance']);
      return res.json({
        ok: true,
        cm_images_exists: r.rows.length > 0,
        cm_appearance_kb: ap.rows.length ? Math.round(ap.rows[0].len / 1024) : null,
        status: r.rows.length > 0 ? 'already_migrated' : 'pending',
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    } finally {
      await pool.end().catch(() => {});
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!isAuthorized(req, req.body)) {
    return res.status(403).json({ ok: false, error: 'Forbidden. Set MIGRATE_SECRET env or run from localhost.' });
  }

  const pgConfig = getPgConfig();
  if (!pgConfig) return res.status(500).json({ ok: false, error: 'No PG config found' });

  const pool = new Pool({ ...pgConfig, max: 2, connectionTimeoutMillis: 8000 });
  try {
    const result = await runMigration(pool);
    // Инвалидируем глобальный кэш если он есть
    const g = globalThis;
    if (g._pgCache) g._pgCache.flush();
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    await pool.end().catch(() => {});
  }
}
