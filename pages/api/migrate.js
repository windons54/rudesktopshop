// pages/api/migrate.js — миграция изображений из entity-ключей в отдельные *_images ключи
//
// GET  /api/migrate                              — статус всех миграций
// POST /api/migrate  { target?, force? }         — запустить миграцию
//   target: 'appearance' | 'entities' | 'all'   (по умолчанию 'all')
//   force:  true — перезапустить даже если уже выполнено

import { Pool } from 'pg';
import { readPgConfig } from '../../lib/pg-config-reader.js';
import { runMigration } from '../../lib/migration.js';
import { runEntityMigration } from '../../lib/migration.js';

export default async function handler(req, res) {
  const pgConfig = readPgConfig();
  if (!pgConfig) {
    return res.status(500).json({ ok: false, error: 'No PG config found.' });
  }

  // GET — статус всех миграций
  if (req.method === 'GET') {
    const pool = new Pool({ ...pgConfig, max: 1, connectionTimeoutMillis: 5000 });
    try {
      const keys = ['cm_images', 'cm_tasks_images', 'cm_products_images', 'cm_auctions_images', 'cm_lotteries_images'];
      const r = await pool.query(`SELECT key, length(value) as len, value FROM kv WHERE key = ANY($1)`, [keys]);

      const status = {};
      for (const key of keys) {
        const row = r.rows.find(r => r.key === key);
        if (!row) { status[key] = { exists: false, kb: 0, count: 0 }; continue; }
        let obj = {};
        try { obj = JSON.parse(row.value); } catch {}
        status[key] = { exists: true, kb: Math.round(row.len / 1024), count: Object.keys(obj).length };
      }

      // Размеры основных ключей (до и после)
      const mainKeys = ['cm_appearance', 'cm_tasks', 'cm_products', 'cm_auctions', 'cm_lotteries'];
      const mainR = await pool.query(`SELECT key, length(value) as len FROM kv WHERE key = ANY($1)`, [mainKeys]);
      const mainSizes = {};
      for (const row of mainR.rows) mainSizes[row.key] = Math.round(row.len / 1024);

      return res.json({ ok: true, imageKeys: status, mainKeySizes: mainSizes });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    } finally {
      await pool.end().catch(() => {});
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const target = req.body?.target || 'all';
  const force  = req.body?.force === true;

  const pool = new Pool({ ...pgConfig, max: 2, connectionTimeoutMillis: 8000 });
  try {
    const response = { ok: true };

    if (target === 'appearance' || target === 'all') {
      response.appearance = await runMigration(pool, { force });
    }
    if (target === 'entities' || target === 'all') {
      response.entities = await runEntityMigration(pool, { force });
    }

    // Инвалидируем все кэши
    if (globalThis._pgCache)     globalThis._pgCache.flush();
    if (globalThis._allCache)    { globalThis._allCache = null; globalThis._allCacheExpiry = 0; }
    if (globalThis._dataVersion) globalThis._dataVersion = Date.now();

    return res.json(response);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    await pool.end().catch(() => {});
  }
}
