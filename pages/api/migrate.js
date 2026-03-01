// pages/api/migrate.js — запуск миграции cm_appearance → cm_images
//
// GET  /api/migrate                 — проверить статус (без изменений в БД)
// POST /api/migrate  { force? }     — запустить миграцию
//                    force=true     — перезапустить даже если cm_images уже есть
//
// Авторизация: не требуется (как и в остальных API роутах проекта).
// Миграция идемпотентна — повторный запуск без force ничего не меняет.

import { Pool } from 'pg';
import { readPgConfig } from '../../lib/pg-config-reader.js';
import { runMigration } from '../../lib/migration.js';

export default async function handler(req, res) {
  const pgConfig = readPgConfig();
  if (!pgConfig) {
    return res.status(500).json({
      ok: false,
      error: 'No PG config found. Настройте подключение в UI или передайте DATABASE_URL / PG_HOST env.',
    });
  }

  // GET — только статус, без изменений
  if (req.method === 'GET') {
    const pool = new Pool({ ...pgConfig, max: 1, connectionTimeoutMillis: 5000 });
    try {
      const apRow  = await pool.query(`SELECT value, length(value) as len FROM kv WHERE key = 'cm_appearance'`);
      const imgRow = await pool.query(`SELECT value, length(value) as len FROM kv WHERE key = 'cm_images'`);

      let imagesObj = {};
      if (imgRow.rows.length) {
        try { imagesObj = JSON.parse(imgRow.rows[0].value); } catch {}
      }
      const imageKeys = Object.keys(imagesObj);

      let apObj = {};
      let base64InAppearance = [];
      if (apRow.rows.length) {
        try { apObj = JSON.parse(apRow.rows[0].value); } catch {}
        if (apObj.logo?.startsWith?.('data:'))           base64InAppearance.push('logo');
        if (apObj.banner?.image?.startsWith?.('data:'))  base64InAppearance.push('banner.image');
        if (apObj.currency?.logo?.startsWith?.('data:')) base64InAppearance.push('currency.logo');
        if (apObj.seo?.favicon?.startsWith?.('data:'))   base64InAppearance.push('seo.favicon');
        if (apObj.sectionSettings) {
          for (const s of Object.keys(apObj.sectionSettings)) {
            if (apObj.sectionSettings[s]?.banner?.startsWith?.('data:'))
              base64InAppearance.push(`sectionSettings.${s}.banner`);
          }
        }
      }

      const status = imgRow.rows.length === 0         ? 'not_started'
                   : imageKeys.length === 0            ? 'empty_stub'
                   : base64InAppearance.length > 0     ? 'partial'
                                                       : 'done';

      return res.json({
        ok: true,
        status,
        cm_appearance_kb:             apRow.rows.length  ? Math.round(apRow.rows[0].len  / 1024) : null,
        cm_images_kb:                 imgRow.rows.length ? Math.round(imgRow.rows[0].len / 1024) : null,
        cm_images_keys:               imageKeys,
        base64_still_in_appearance:   base64InAppearance,
        needs_migration:              status !== 'done',
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

  const force = req.body?.force === true;
  const pool = new Pool({ ...pgConfig, max: 2, connectionTimeoutMillis: 8000 });
  try {
    const result = await runMigration(pool, { force });

    // Инвалидируем все кэши
    if (globalThis._pgCache)     globalThis._pgCache.flush();
    if (globalThis._allCache)    { globalThis._allCache = null; globalThis._allCacheExpiry = 0; }
    if (globalThis._dataVersion) globalThis._dataVersion = Date.now();

    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    await pool.end().catch(() => {});
  }
}
