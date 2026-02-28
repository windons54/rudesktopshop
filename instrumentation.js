// instrumentation.js — Next.js server lifecycle hook
// Запускается ОДИН РАЗ при старте сервера, до первого HTTP-запроса.
// 1. Прогревает пул PostgreSQL заранее
// 2. Мигрирует base64 из cm_appearance → cm_images (автоматически)

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    // Импорт инициализирует модуль и запускает _pgWarmupStarted
    await import('./pages/api/store.js');
    console.log('[Instrumentation] PG pool warmup started');

    // Ждём готовности пула (макс 10 секунд)
    const g = globalThis;
    for (let i = 0; i < 50; i++) {
      if (g._pgPool && g._pgReady) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!g._pgPool || !g._pgReady) {
      console.warn('[Instrumentation] Pool not ready after 10s, skipping migration');
      return;
    }

    // ── Миграция cm_appearance: вырезаем base64 → cm_images ──────────────
    // Запускаем один раз — если cm_images уже есть, пропускаем
    try {
      const existing = await g._pgPool.query(
        'SELECT value FROM kv WHERE key = $1',
        ['cm_images']
      );
      if (existing.rows.length > 0) {
        console.log('[Instrumentation] cm_images already exists, skipping migration');
        return;
      }

      const apRow = await g._pgPool.query(
        'SELECT value FROM kv WHERE key = $1',
        ['cm_appearance']
      );
      if (!apRow.rows.length) {
        console.log('[Instrumentation] No cm_appearance found, nothing to migrate');
        return;
      }

      let ap;
      try { ap = JSON.parse(apRow.rows[0].value); } catch { return; }

      const images = {};
      let changed = false;

      // Вырезаем logo
      if (ap.logo && typeof ap.logo === 'string' && ap.logo.startsWith('data:')) {
        images.logo = ap.logo;
        ap.logo = '__stored__';
        changed = true;
        console.log('[Instrumentation] Migrating logo:', Math.round(images.logo.length / 1024) + 'KB');
      }
      // Вырезаем banner.image
      if (ap.banner?.image && typeof ap.banner.image === 'string' && ap.banner.image.startsWith('data:')) {
        images.bannerImage = ap.banner.image;
        ap.banner = { ...ap.banner, image: '__stored__' };
        changed = true;
        console.log('[Instrumentation] Migrating bannerImage:', Math.round(images.bannerImage.length / 1024) + 'KB');
      }
      // Вырезаем sectionSettings banner images
      if (ap.sectionSettings && typeof ap.sectionSettings === 'object') {
        for (const section of Object.keys(ap.sectionSettings)) {
          const s = ap.sectionSettings[section];
          if (s?.banner && typeof s.banner === 'string' && s.banner.startsWith('data:')) {
            images['section_' + section + '_banner'] = s.banner;
            ap.sectionSettings[section] = { ...s, banner: '__stored__' };
            changed = true;
            console.log('[Instrumentation] Migrating section', section, 'banner:', Math.round(s.banner.length / 1024) + 'KB');
          }
        }
      }
      // Вырезаем currency.logo
      if (ap.currency?.logo && typeof ap.currency.logo === 'string' && ap.currency.logo.startsWith('data:')) {
        images.currencyLogo = ap.currency.logo;
        ap.currency = { ...ap.currency, logo: '__stored__' };
        changed = true;
        console.log('[Instrumentation] Migrating currencyLogo:', Math.round(images.currencyLogo.length / 1024) + 'KB');
      }
      // Вырезаем seo.favicon
      if (ap.seo?.favicon && typeof ap.seo.favicon === 'string' && ap.seo.favicon.startsWith('data:')) {
        images.favicon = ap.seo.favicon;
        ap.seo = { ...ap.seo, favicon: '__stored__' };
        changed = true;
        console.log('[Instrumentation] Migrating favicon:', Math.round(images.favicon.length / 1024) + 'KB');
      }

      if (!changed && Object.keys(images).length === 0) {
        // Нет картинок — всё равно создаём пустую запись cm_images чтобы не запускать миграцию снова
        await g._pgPool.query(
          `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO NOTHING`,
          ['cm_images', '{}']
        );
        console.log('[Instrumentation] No base64 images found in cm_appearance');
        return;
      }

      // Сохраняем оба ключа в одной транзакции
      const client = await g._pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
          ['cm_images', JSON.stringify(images)]
        );
        await client.query(
          `UPDATE kv SET value=$1, updated_at=NOW() WHERE key=$2`,
          [JSON.stringify(ap), 'cm_appearance']
        );
        await client.query('COMMIT');

        const savedBytes = Object.values(images).reduce((s, v) => s + (typeof v === 'string' ? v.length : 0), 0);
        console.log('[Instrumentation] Migration complete! Moved', Object.keys(images).length, 'images (', Math.round(savedBytes / 1024) + 'KB) to cm_images');

        // Сбрасываем серверный кэш getAll
        g._allCache = null;
        g._allCacheExpiry = 0;
        if (g._dataVersion) g._dataVersion = Date.now();
      } catch(e) {
        await client.query('ROLLBACK');
        console.error('[Instrumentation] Migration failed:', e.message);
      } finally {
        client.release();
      }
    } catch(e) {
      console.warn('[Instrumentation] Migration error:', e.message);
    }
  } catch (e) {
    console.warn('[Instrumentation] Error:', e.message);
  }
}
