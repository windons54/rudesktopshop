// pages/api/store.js
// Хранилище на основе JSON-файла (data/store.json).
// Prisma и PostgreSQL полностью удалены — приложение работает только с SQLite (браузер)
// и JSON-файлом (сервер, для Server-Side данных если нужны).

import fs from 'fs';
import path from 'path';

const DATA_DIR   = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

let _lock = Promise.resolve();
const lock = fn => {
  const r = _lock.then(fn);
  _lock = r.catch(() => {});
  return r;
};

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function readJSON() {
  try {
    ensureDir();
    if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {}
  return {};
}

function writeJSON(data) {
  try {
    ensureDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.error('[Store] Write error:', e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, key, value, data } = req.body || {};

  try {
    if (action === 'get') {
      const s = readJSON();
      return res.json({ ok: true, value: s[key] !== undefined ? s[key] : null });
    }

    if (action === 'getAll') {
      return res.json({ ok: true, data: readJSON() });
    }

    if (action === 'set') {
      await lock(() => {
        const s = readJSON();
        s[key] = value;
        writeJSON(s);
      });
      return res.json({ ok: true });
    }

    if (action === 'delete') {
      await lock(() => {
        const s = readJSON();
        delete s[key];
        writeJSON(s);
      });
      return res.json({ ok: true });
    }

    if (action === 'setMany') {
      await lock(() => {
        const s = readJSON();
        Object.assign(s, data || {});
        writeJSON(s);
      });
      return res.json({ ok: true });
    }

    // Заглушки для старых pg_* вызовов — возвращаем ошибку с понятным сообщением
    if (action && action.startsWith('pg_')) {
      return res.json({ ok: false, error: 'PostgreSQL отключён. Используется JSON-хранилище.' });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (e) {
    console.error('[Store] Error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
