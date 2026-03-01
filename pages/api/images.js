// pages/api/images.js
// Хранит base64-изображения отдельно от основных данных.
// Клиент загружает их один раз и кэширует в localStorage.
//
// GET  /api/images?type=appearance            — cm_images (логотипы, баннеры)
// GET  /api/images?type=tasks                 — cm_tasks_images { [id]: base64 }
// GET  /api/images?type=products              — cm_products_images { [id_idx]: base64 }
// GET  /api/images?type=auctions              — cm_auctions_images
// GET  /api/images?type=lotteries             — cm_lotteries_images
// GET  /api/images?type=all                   — все сразу { appearance, tasks, products, auctions, lotteries }
// POST /api/images { action:'get', type }     — то же через POST
// POST /api/images { action:'set', type, images } — сохранить

const TYPE_TO_KEY = {
  appearance: 'cm_images',
  tasks:      'cm_tasks_images',
  products:   'cm_products_images',
  auctions:   'cm_auctions_images',
  lotteries:  'cm_lotteries_images',
};

const g = globalThis;

async function getPool() {
  if (g._pgPool && g._pgReady) return g._pgPool;
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

async function fetchKey(pool, key) {
  const r = await pool.query('SELECT value FROM kv WHERE key=$1', [key]);
  if (!r.rows.length) return {};
  try { return JSON.parse(r.rows[0].value) || {}; } catch { return {}; }
}

async function saveKey(pool, key, images) {
  await pool.query(
    `INSERT INTO kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, JSON.stringify(images)]
  );
  if (g._allCache) { g._allCache = null; g._allCacheExpiry = 0; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Accept-Encoding');

  const type   = (req.method === 'GET' ? req.query?.type : req.body?.type) || 'appearance';
  const action = req.method === 'GET' ? 'get' : (req.body?.action || 'get');

  try {
    const pool = await getPool();
    if (!pool) return res.json({ ok: false, error: 'pool not ready' });

    if (action === 'get') {
      if (type === 'all') {
        // Грузим все типы одним запросом
        const keys = Object.values(TYPE_TO_KEY);
        const r = await pool.query(`SELECT key, value FROM kv WHERE key = ANY($1)`, [keys]);
        const result = {};
        for (const [typeName, dbKey] of Object.entries(TYPE_TO_KEY)) {
          const row = r.rows.find(row => row.key === dbKey);
          result[typeName] = row ? (JSON.parse(row.value || '{}') || {}) : {};
        }
        return res.json({ ok: true, ...result });
      }

      const dbKey = TYPE_TO_KEY[type];
      if (!dbKey) return res.status(400).json({ ok: false, error: 'unknown type' });
      const images = await fetchKey(pool, dbKey);
      return res.json({ ok: true, images });
    }

    if (action === 'set') {
      const { images } = req.body || {};
      if (!images || typeof images !== 'object') return res.json({ ok: false, error: 'no images' });
      const dbKey = TYPE_TO_KEY[type];
      if (!dbKey) return res.status(400).json({ ok: false, error: 'unknown type' });
      await saveKey(pool, dbKey, images);
      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'unknown action' });
  } catch(e) {
    return res.json({ ok: false, error: e.message });
  }
}
