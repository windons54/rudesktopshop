// pages/api/images.js
// Хранит base64-изображения из cm_appearance отдельно от основных данных.
// Клиент загружает их один раз и кэширует в localStorage — не тянет при каждом getAll.
// GET  /api/images — вернуть cm_images из БД (полные base64)
// POST /api/images { action: 'get' } — то же через POST
// POST /api/images { action: 'set', images: {...} } — сохранить cm_images

import { createRequire } from 'module';

const IMAGES_KEY = 'cm_images';
const g = globalThis;

// Реиспользуем пул из store.js через globalThis
async function getPool() {
  // Если пул уже готов — используем его
  if (g._pgPool && g._pgReady) return g._pgPool;
  // Иначе инициализируем через store
  try {
    const storeModule = await import('./store.js');
    await new Promise(resolve => {
      const mockReq = { method: 'POST', body: { action: 'version' }, query: {} };
      const mockRes = { status: () => mockRes, end: resolve, setHeader: () => {}, json: resolve };
      storeModule.default(mockReq, mockRes).catch(resolve);
    });
  } catch {}
  return (g._pgPool && g._pgReady) ? g._pgPool : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const action = req.method === 'GET' ? 'get' : (req.body?.action || 'get');

  if (action === 'get') {
    try {
      const pool = await getPool();
      if (!pool) return res.json({ ok: false, error: 'pool not ready' });
      const r = await pool.query('SELECT value FROM kv WHERE key=$1', [IMAGES_KEY]);
      if (!r.rows.length) return res.json({ ok: true, images: {} });
      let images = {};
      try { images = JSON.parse(r.rows[0].value); } catch {}
      return res.json({ ok: true, images });
    } catch(e) {
      return res.json({ ok: false, error: e.message });
    }
  }

  if (action === 'set') {
    const { images } = req.body || {};
    if (!images || typeof images !== 'object') return res.json({ ok: false, error: 'no images' });
    try {
      const pool = await getPool();
      if (!pool) return res.json({ ok: false, error: 'pool not ready' });
      await pool.query(
        `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [IMAGES_KEY, JSON.stringify(images)]
      );
      // Сбрасываем кэш getAll чтобы при следующем poll пересчитал версию
      if (g._allCache) { g._allCache = null; g._allCacheExpiry = 0; }
      return res.json({ ok: true });
    } catch(e) {
      return res.json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'unknown action' });
}
