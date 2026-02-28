// lib/server-init.js — серверная инициализация PostgreSQL + миграция данных
// Импортируется ТОЛЬКО через динамический import() из instrumentation.js
// Поэтому webpack не включает pg в клиентский бандл.

export async function runServerInit() {
  const g = globalThis;

  // ── 1. Прогрев пула ──────────────────────────────────────────────────────
  try {
    await import('../pages/api/store.js');
    console.log('[ServerInit] PG pool warmup started');
  } catch (e) {
    console.warn('[ServerInit] Warmup import error:', e.message);
    return;
  }

  // Ждём готовности пула (макс 10 секунд)
  for (let i = 0; i < 50; i++) {
    if (g._pgPool && g._pgReady) break;
    await new Promise(r => setTimeout(r, 200));
  }

  if (!g._pgPool || !g._pgReady) {
    console.warn('[ServerInit] Pool not ready after 10s, skipping migration');
    return;
  }

  // ── 2. Миграция cm_appearance → cm_images ────────────────────────────────
  try {
    const existing = await g._pgPool.query(
      'SELECT value FROM kv WHERE key = $1',
      ['cm_images']
    );
    if (existing.rows.length > 0) {
      console.log('[ServerInit] cm_images already exists, skipping migration');
      return;
    }

    const apRow = await g._pgPool.query(
      'SELECT value FROM kv WHERE key = $1',
      ['cm_appearance']
    );
    if (!apRow.rows.length) {
      console.log('[ServerInit] No cm_appearance found, nothing to migrate');
      // Создаём пустую запись чтобы не запускать миграцию снова
      await g._pgPool.query(
        `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO NOTHING`,
        ['cm_images', '{}']
      );
      return;
    }

    let ap;
    try { ap = JSON.parse(apRow.rows[0].value); } catch { return; }

    const images = {};
    let changed = false;

    if (ap.logo && typeof ap.logo === 'string' && ap.logo.startsWith('data:')) {
      images.logo = ap.logo;
      ap.logo = '__stored__';
      changed = true;
      console.log('[ServerInit] Migrating logo:', Math.round(images.logo.length / 1024) + 'KB');
    }
    if (ap.banner?.image && typeof ap.banner.image === 'string' && ap.banner.image.startsWith('data:')) {
      images.bannerImage = ap.banner.image;
      ap.banner = { ...ap.banner, image: '__stored__' };
      changed = true;
      console.log('[ServerInit] Migrating bannerImage:', Math.round(images.bannerImage.length / 1024) + 'KB');
    }
    if (ap.sectionSettings && typeof ap.sectionSettings === 'object') {
      for (const section of Object.keys(ap.sectionSettings)) {
        const s = ap.sectionSettings[section];
        if (s?.banner && typeof s.banner === 'string' && s.banner.startsWith('data:')) {
          images['section_' + section + '_banner'] = s.banner;
          ap.sectionSettings[section] = { ...s, banner: '__stored__' };
          changed = true;
          console.log('[ServerInit] Migrating section', section, 'banner');
        }
      }
    }
    if (ap.currency?.logo && typeof ap.currency.logo === 'string' && ap.currency.logo.startsWith('data:')) {
      images.currencyLogo = ap.currency.logo;
      ap.currency = { ...ap.currency, logo: '__stored__' };
      changed = true;
      console.log('[ServerInit] Migrating currencyLogo');
    }
    if (ap.seo?.favicon && typeof ap.seo.favicon === 'string' && ap.seo.favicon.startsWith('data:')) {
      images.favicon = ap.seo.favicon;
      ap.seo = { ...ap.seo, favicon: '__stored__' };
      changed = true;
      console.log('[ServerInit] Migrating favicon');
    }

    // Сохраняем в транзакции
    const client = await g._pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
        ['cm_images', JSON.stringify(images)]
      );
      if (changed) {
        await client.query(
          `UPDATE kv SET value=$1, updated_at=NOW() WHERE key=$2`,
          [JSON.stringify(ap), 'cm_appearance']
        );
      }
      await client.query('COMMIT');

      const savedKB = Math.round(Object.values(images).reduce((s, v) => s + (typeof v === 'string' ? v.length : 0), 0) / 1024);
      console.log('[ServerInit] Migration complete! Moved', Object.keys(images).length, 'images (' + savedKB + 'KB) to cm_images');

      g._allCache = null;
      g._allCacheExpiry = 0;
      if (g._dataVersion) g._dataVersion = Date.now();
    } catch(e) {
      await client.query('ROLLBACK');
      console.error('[ServerInit] Migration failed:', e.message);
    } finally {
      client.release();
    }
  } catch(e) {
    console.warn('[ServerInit] Migration error:', e.message);
  }
}
