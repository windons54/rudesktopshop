// lib/pg-store.js — слой доступа к данным поверх pg с кэшем и разбивкой cm_appearance
//
// ПРОБЛЕМА которую решаем:
//   cm_appearance = 715KB (logo, banner, favicon в base64 прямо в JSON)
//   getAll() тянет 1898KB каждый раз — медленно и дорого
//
// РЕШЕНИЕ:
//   1. Кэш с TTL (pg-cache.js) — большинство запросов идут из памяти
//   2. cm_appearance разбит на два ключа:
//      - cm_appearance        — только нон-медиа поля (цвета, тексты, настройки) ~10KB
//      - cm_images            — только base64 изображения ~700KB (загружается редко)
//   3. getAll() исключает cm_images по умолчанию — экономит ~700KB на каждом вызове
//
// СОВМЕСТИМОСТЬ:
//   Все существующие вызовы get('cm_appearance') продолжают работать — возвращают
//   объект с __stored__ вместо base64. Клиентский код должен запрашивать изображения
//   через get('cm_images') отдельно когда они нужны.

import { pgCache } from './pg-cache.js';

/**
 * Получить глобальный пул (инициализируется в pages/api/store.js)
 * @returns {import('pg').Pool | null}
 */
function getPool() {
  return globalThis._pgPool || null;
}

/**
 * Получить значение по ключу (с кэшем)
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function pgGet(key) {
  const cached = pgCache.get(key);
  if (cached !== undefined) return cached;

  const pool = getPool();
  if (!pool) throw new Error('PG pool not initialized');

  const result = await pool.query('SELECT value FROM kv WHERE key = $1', [key]);
  const value = result.rows.length ? tryParse(result.rows[0].value) : null;
  pgCache.set(key, value);
  return value;
}

/**
 * Установить значение по ключу (с инвалидацией кэша)
 * @param {string} key
 * @param {any} value
 */
export async function pgSet(key, value) {
  const pool = getPool();
  if (!pool) throw new Error('PG pool not initialized');

  const serialized = JSON.stringify(value);
  await pool.query(
    `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, serialized]
  );
  pgCache.invalidate(key);
}

/**
 * Удалить ключ
 * @param {string} key
 */
export async function pgDelete(key) {
  const pool = getPool();
  if (!pool) throw new Error('PG pool not initialized');

  await pool.query('DELETE FROM kv WHERE key = $1', [key]);
  pgCache.invalidate(key);
}

/**
 * Получить все ключи КРОМЕ cm_images (они большие, грузятся отдельно)
 * Результат кэшируется на 2 секунды.
 * @returns {Promise<Record<string, any>>}
 */
export async function pgGetAll() {
  const cacheKey = '__all__';
  const cached = pgCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pool = getPool();
  if (!pool) throw new Error('PG pool not initialized');

  // Исключаем cm_images — они ~700KB и нужны только там где явно запрошены
  const result = await pool.query(`SELECT key, value FROM kv WHERE key != 'cm_images'`);
  const out = {};
  for (const row of result.rows) {
    out[row.key] = tryParse(row.value);
  }
  pgCache.set(cacheKey, out);
  return out;
}

/**
 * Получить cm_appearance без изображений (быстро, ~10KB вместо 715KB)
 * Изображения хранятся в cm_images после миграции.
 */
export async function pgGetAppearance() {
  return pgGet('cm_appearance');
}

/**
 * Получить только изображения (cm_images) — грузить только когда нужно
 * Кэшируется на 60 секунд.
 */
export async function pgGetImages() {
  return pgGet('cm_images') || {};
}

/**
 * Сохранить cm_appearance — автоматически вырезает base64 в cm_images
 * чтобы предотвратить повторное «раздутие» ключа.
 * @param {object} appearance
 */
export async function pgSetAppearance(appearance) {
  if (typeof appearance !== 'object' || !appearance) {
    return pgSet('cm_appearance', appearance);
  }

  const images = (await pgGetImages()) || {};
  let ap = { ...appearance };
  let imagesChanged = false;

  // Автоматически выносим base64 в cm_images
  if (ap.logo && typeof ap.logo === 'string' && ap.logo.startsWith('data:')) {
    images.logo = ap.logo; ap.logo = '__stored__'; imagesChanged = true;
  }
  if (ap.banner?.image && typeof ap.banner.image === 'string' && ap.banner.image.startsWith('data:')) {
    images.bannerImage = ap.banner.image;
    ap = { ...ap, banner: { ...ap.banner, image: '__stored__' } };
    imagesChanged = true;
  }
  if (ap.currency?.logo && typeof ap.currency.logo === 'string' && ap.currency.logo.startsWith('data:')) {
    images.currencyLogo = ap.currency.logo;
    ap = { ...ap, currency: { ...ap.currency, logo: '__stored__' } };
    imagesChanged = true;
  }
  if (ap.seo?.favicon && typeof ap.seo.favicon === 'string' && ap.seo.favicon.startsWith('data:')) {
    images.favicon = ap.seo.favicon;
    ap = { ...ap, seo: { ...ap.seo, favicon: '__stored__' } };
    imagesChanged = true;
  }
  if (ap.sectionSettings && typeof ap.sectionSettings === 'object') {
    const newSections = { ...ap.sectionSettings };
    for (const section of Object.keys(newSections)) {
      const s = newSections[section];
      if (s?.banner && typeof s.banner === 'string' && s.banner.startsWith('data:')) {
        images[`section_${section}_banner`] = s.banner;
        newSections[section] = { ...s, banner: '__stored__' };
        imagesChanged = true;
      }
    }
    ap = { ...ap, sectionSettings: newSections };
  }

  await pgSet('cm_appearance', ap);
  if (imagesChanged) await pgSet('cm_images', images);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function tryParse(v) {
  try { return JSON.parse(v); } catch { return v; }
}

export { pgCache };
