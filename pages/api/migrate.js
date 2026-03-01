// pages/api/migrate.js — ручной запуск миграции cm_appearance → cm_images
//
// GET  /api/migrate          — проверить статус (без изменений в БД)
// POST /api/migrate          — запустить миграцию
//
// Защита:
//   - Если задан env MIGRATE_SECRET — требует { secret: "..." } в теле POST
//   - Иначе доступен только с localhost (127.0.0.1 / ::1)

import { Pool } from 'pg';
import { readPgConfig } from '../../lib/pg-config-reader.js';
import { runMigration } from '../../lib/migration.js';

function isAuthorized(req, body) {
  const secret = process.env.MIGRATE_SECRET;
  if (secret) return body?.secret === secret;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export default async function handler(req, res) {
  const pgConfig = readPgConfig();

  if (!pgConfig) {
    return res.status(500).json({
      ok: false,
      error: 'No PG config found. Настройте подключение в UI или передайте DATABASE_URL / PG_HOST env.',
    });
  }

  // GET — только статус
  if (req.method === 'GET') {
    const pool = new Pool({ ...pgConfig, max: 1, connectionTimeoutMillis: 5000 });
    try {
      const images  = await pool.query(`SELECT 1 FROM kv WHERE key = 'cm_images' LIMIT 1`);
      const apSize  = await pool.query(`SELECT length(value) as len FROM kv WHERE key = 'cm_appearance'`);
      const imgSize = await pool.query(`SELECT length(value) as len FROM kv WHERE key = 'cm_images'`);
      return res.json({
        ok: true,
        status: images.rows.length > 0 ? 'already_migrated' : 'pending',
        cm_images_exists: images.rows.length > 0,
        cm_appearance_kb: apSize.rows.length  ? Math.round(apSize.rows[0].len  / 1024) : null,
        cm_images_kb:     imgSize.rows.length ? Math.round(imgSize.rows[0].len / 1024) : null,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    } finally {
      await pool.end().catch(() => {});
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!isAuthorized(req, req.body)) {
    return res.status(403).json({
      ok: false,
      error: 'Forbidden. Задайте MIGRATE_SECRET env или запустите с localhost.',
    });
  }

  const pool = new Pool({ ...pgConfig, max: 2, connectionTimeoutMillis: 8000 });
  try {
    const result = await runMigration(pool);

    // Инвалидируем глобальный кэш
    if (globalThis._pgCache) globalThis._pgCache.flush();
    // Инвалидируем кэш store.js
    if (globalThis._allCache) { globalThis._allCache = null; globalThis._allCacheExpiry = 0; }
    if (globalThis._dataVersion) globalThis._dataVersion = Date.now();

    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    await pool.end().catch(() => {});
  }
}
