// lib/migration.js — логика миграции cm_appearance → cm_images
// Используется и из server-init.js (при старте) и из pages/api/migrate.js (вручную).
// Принимает готовый pool — не создаёт соединения сам.

const IMAGE_FIELDS = [
  {
    extract: (ap) => ap.logo && typeof ap.logo === 'string' && ap.logo.startsWith('data:') ? ap.logo : null,
    key: 'logo',
    clear: (ap) => ({ ...ap, logo: '__stored__' }),
    label: 'logo',
  },
  {
    extract: (ap) => ap.banner?.image && typeof ap.banner.image === 'string' && ap.banner.image.startsWith('data:') ? ap.banner.image : null,
    key: 'bannerImage',
    clear: (ap) => ({ ...ap, banner: { ...ap.banner, image: '__stored__' } }),
    label: 'banner.image',
  },
  {
    extract: (ap) => ap.currency?.logo && typeof ap.currency.logo === 'string' && ap.currency.logo.startsWith('data:') ? ap.currency.logo : null,
    key: 'currencyLogo',
    clear: (ap) => ({ ...ap, currency: { ...ap.currency, logo: '__stored__' } }),
    label: 'currency.logo',
  },
  {
    extract: (ap) => ap.seo?.favicon && typeof ap.seo.favicon === 'string' && ap.seo.favicon.startsWith('data:') ? ap.seo.favicon : null,
    key: 'favicon',
    clear: (ap) => ({ ...ap, seo: { ...ap.seo, favicon: '__stored__' } }),
    label: 'seo.favicon',
  },
];

/**
 * Выполняет миграцию cm_appearance → cm_images.
 * @param {import('pg').Pool} pool
 * @param {{ force?: boolean }} opts  force=true — перезапустить даже если cm_images уже есть
 * @returns {{ skipped: boolean, reason?: string, moved: string[], savedKB: number }}
 */
export async function runMigration(pool, { force = false } = {}) {
  // Уже мигрировали? Пропускаем только если cm_images непустой И не force
  const existing = await pool.query('SELECT value FROM kv WHERE key = $1', ['cm_images']);
  if (existing.rows.length > 0 && !force) {
    let imagesObj = {};
    try { imagesObj = JSON.parse(existing.rows[0].value); } catch {}
    if (Object.keys(imagesObj).length > 0) {
      console.log('[Migration] cm_images already exists and is non-empty, skipping');
      return { skipped: true, reason: 'already_done' };
    }
    console.log('[Migration] cm_images exists but is empty — re-running migration');
  }

  // Читаем cm_appearance
  const apRow = await pool.query('SELECT value FROM kv WHERE key = $1', ['cm_appearance']);
  if (!apRow.rows.length) {
    console.log('[Migration] No cm_appearance found, creating empty cm_images stub');
    await pool.query(
      `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO NOTHING`,
      ['cm_images', '{}']
    );
    return { skipped: true, reason: 'no_source' };
  }

  let ap;
  try { ap = JSON.parse(apRow.rows[0].value); }
  catch { return { skipped: true, reason: 'parse_error' }; }

  const images = {};
  const moved = [];

  // Основные поля
  for (const field of IMAGE_FIELDS) {
    const val = field.extract(ap);
    if (val) {
      images[field.key] = val;
      ap = field.clear(ap);
      moved.push(field.label);
      console.log(`[Migration] Extracting ${field.label}: ${Math.round(val.length / 1024)}KB`);
    }
  }

  // sectionSettings[*].banner
  if (ap.sectionSettings && typeof ap.sectionSettings === 'object') {
    for (const section of Object.keys(ap.sectionSettings)) {
      const s = ap.sectionSettings[section];
      if (s?.banner && typeof s.banner === 'string' && s.banner.startsWith('data:')) {
        const imgKey = `section_${section}_banner`;
        images[imgKey] = s.banner;
        ap = {
          ...ap,
          sectionSettings: {
            ...ap.sectionSettings,
            [section]: { ...s, banner: '__stored__' },
          },
        };
        moved.push(`sectionSettings.${section}.banner`);
        console.log(`[Migration] Extracting section ${section} banner: ${Math.round(s.banner.length / 1024)}KB`);
      }
    }
  }

  if (moved.length === 0) {
    console.log('[Migration] No base64 images found in cm_appearance (already clean or no images set)');
    // Обновляем cm_images чтобы зафиксировать что миграция прошла
    await pool.query(
      `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
      ['cm_images', '{}']
    );
    return { skipped: false, moved: [], savedKB: 0, reason: 'no_images_found' };
  }

  const savedKB = Math.round(
    Object.values(images).reduce((sum, v) => sum + (typeof v === 'string' ? v.length : 0), 0) / 1024
  );

  // Сохраняем в транзакции
  const client = await pool.connect();
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
    console.log(`[Migration] Done! Moved ${moved.length} images (${savedKB}KB) to cm_images`);
    return { skipped: false, moved, savedKB };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[Migration] Transaction failed:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

// ─── Миграция изображений из entity-ключей ────────────────────────────────

const ENTITY_CONFIGS = [
  { key: 'cm_tasks',     imagesKey: 'cm_tasks_images',     field: 'image',  isArray: false },
  { key: 'cm_auctions',  imagesKey: 'cm_auctions_images',  field: 'image',  isArray: false },
  { key: 'cm_lotteries', imagesKey: 'cm_lotteries_images', field: 'image',  isArray: false },
  { key: 'cm_products',  imagesKey: 'cm_products_images',  field: 'images', isArray: true  },
];

/**
 * Мигрирует base64-изображения из cm_tasks/products/auctions/lotteries
 * в отдельные *_images ключи.
 */
export async function runEntityMigration(pool, { force = false } = {}) {
  const results = [];

  for (const cfg of ENTITY_CONFIGS) {
    // Проверяем что ещё не мигрировали (или force)
    if (!force) {
      const existing = await pool.query('SELECT value FROM kv WHERE key=$1', [cfg.imagesKey]);
      if (existing.rows.length > 0) {
        let obj = {};
        try { obj = JSON.parse(existing.rows[0].value); } catch {}
        if (Object.keys(obj).length > 0) {
          results.push({ key: cfg.key, skipped: true, reason: 'already_done' });
          continue;
        }
      }
    }

    // Читаем данные
    const dataRow = await pool.query('SELECT value FROM kv WHERE key=$1', [cfg.key]);
    if (!dataRow.rows.length) {
      results.push({ key: cfg.key, skipped: true, reason: 'no_data' });
      continue;
    }

    let items;
    try { items = JSON.parse(dataRow.rows[0].value); } catch {
      results.push({ key: cfg.key, skipped: true, reason: 'parse_error' });
      continue;
    }
    if (!Array.isArray(items)) {
      results.push({ key: cfg.key, skipped: true, reason: 'not_array' });
      continue;
    }

    const imagesMap = {};
    let moved = 0;
    let savedBytes = 0;

    const slim = items.map(item => {
      if (!item || !item.id) return item;

      if (cfg.isArray) {
        // cm_products: product.images[] — массив base64
        const imgArr = item.images && item.images.length > 0 ? item.images : (item.image ? [item.image] : []);
        const newImgs = [];
        let changed = false;
        imgArr.forEach((img, idx) => {
          if (typeof img === 'string' && img.startsWith('data:')) {
            const imgKey = item.id + '_' + idx;
            imagesMap[imgKey] = img;
            newImgs.push('__stored__:' + imgKey);
            savedBytes += img.length;
            moved++;
            changed = true;
          } else {
            newImgs.push(img);
          }
        });
        return changed ? { ...item, images: newImgs } : item;
      } else {
        // cm_tasks / cm_auctions / cm_lotteries: одно поле image
        if (typeof item[cfg.field] === 'string' && item[cfg.field].startsWith('data:')) {
          imagesMap[item.id] = item[cfg.field];
          savedBytes += item[cfg.field].length;
          moved++;
          return { ...item, [cfg.field]: '__stored__' };
        }
        return item;
      }
    });

    if (moved === 0) {
      // Нет base64 — создаём пустой маркер чтобы не перезапускать
      await pool.query(
        `INSERT INTO kv(key,value,updated_at) VALUES($1,'{}',NOW()) ON CONFLICT(key) DO UPDATE SET value='{}', updated_at=NOW()`,
        [cfg.imagesKey]
      );
      results.push({ key: cfg.key, skipped: false, moved: 0, savedKB: 0, reason: 'no_images' });
      continue;
    }

    // Сохраняем в транзакции
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [cfg.imagesKey, JSON.stringify(imagesMap)]
      );
      await client.query(
        `UPDATE kv SET value=$1, updated_at=NOW() WHERE key=$2`,
        [JSON.stringify(slim), cfg.key]
      );
      await client.query('COMMIT');
      const savedKB = Math.round(savedBytes / 1024);
      console.log(`[Migration] ${cfg.key}: moved ${moved} images (${savedKB}KB) → ${cfg.imagesKey}`);
      results.push({ key: cfg.key, skipped: false, moved, savedKB });
    } catch(e) {
      await client.query('ROLLBACK');
      console.error(`[Migration] ${cfg.key} failed:`, e.message);
      results.push({ key: cfg.key, skipped: false, error: e.message });
    } finally {
      client.release();
    }
  }

  return results;
}
