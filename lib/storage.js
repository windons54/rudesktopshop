// lib/storage.js
// Unified storage layer: SQLite (browser, sql.js + IndexedDB) OR PostgreSQL (server-side via API)

// ─── PostgreSQL config helpers ────────────────────────────────────────────────
const PG_CONFIG_KEY = '__pg_config__';

export function getPgConfig() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PG_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function savePgConfig(cfg) {
  if (typeof window === 'undefined') return;
  if (cfg) {
    localStorage.setItem(PG_CONFIG_KEY, JSON.stringify(cfg));
  } else {
    localStorage.removeItem(PG_CONFIG_KEY);
  }
}

export function isPgEnabled() {
  const cfg = getPgConfig();
  return !!(cfg && cfg.enabled && cfg.host);
}

// ─── PostgreSQL API client ────────────────────────────────────────────────────
async function pgApi(action, body) {
  const cfg = getPgConfig();
  if (!cfg || !cfg.enabled) throw new Error('PostgreSQL не настроен');
  const res = await fetch(`/api/pg?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: cfg, ...body }),
  });
  return res.json();
}

export const pgStorage = {
  test: async (config) => {
    const res = await fetch('/api/pg?action=test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    return res.json();
  },
  get: async (key) => {
    const r = await pgApi('get', { key });
    if (!r.ok) throw new Error(r.error);
    if (r.value === null) return null;
    try { return JSON.parse(r.value); } catch { return r.value; }
  },
  set: async (key, value) => {
    const r = await pgApi('set', { key, value: JSON.stringify(value) });
    if (!r.ok) throw new Error(r.error);
  },
  delete: async (key) => {
    const r = await pgApi('delete', { key });
    if (!r.ok) throw new Error(r.error);
  },
  all: async () => {
    const r = await pgApi('all', {});
    if (!r.ok) throw new Error(r.error);
    return r.data || {};
  },
  stats: async () => {
    const r = await pgApi('stats', {});
    if (!r.ok) throw new Error(r.error);
    return r;
  },
  query: async (sql) => {
    const r = await pgApi('query', { sql });
    if (!r.ok) throw new Error(r.error);
    return r;
  },
  migrate: async (data) => {
    const cfg = getPgConfig();
    const res = await fetch('/api/pg?action=migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg, data }),
    });
    return res.json();
  },
};

// ─── SQLite storage layer (sql.js + IndexedDB) ───────────────────────────────
const DB_NAME = 'merch_store_sqlite';
const DB_STORE = 'sqlitedb';
const DB_KEY = 'main';

let _sqliteDB = null;
let _sqlReady = false;
let _sqlReadyCallbacks = [];
let _saveTimer = null;
const _cache = {};

function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}

async function loadDbFromIDB() {
  try {
    const idb = await openIDB();
    return await new Promise((res) => {
      const tx = idb.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}

async function saveDbToIDB() {
  if (!_sqliteDB) return;
  try {
    const data = _sqliteDB.export();
    const idb = await openIDB();
    await new Promise((res, rej) => {
      const tx = idb.transaction(DB_STORE, 'readwrite');
      const req = tx.objectStore(DB_STORE).put(data, DB_KEY);
      req.onsuccess = res;
      req.onerror = () => rej(req.error);
    });
  } catch (e) { console.error('SQLite save error', e); }
}

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveDbToIDB, 400);
}

export async function initSQLite() {
  if (_sqlReady) return _sqliteDB;

  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs({
    locateFile: () => '/sql-wasm.wasm',
  });

  const existing = await loadDbFromIDB();
  if (existing) {
    _sqliteDB = new SQL.Database(existing);
  } else {
    _sqliteDB = new SQL.Database();
  }

  _sqliteDB.run(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  _sqlReady = true;
  _sqlReadyCallbacks.forEach(cb => cb());
  _sqlReadyCallbacks = [];
  return _sqliteDB;
}

export function whenSQLReady() {
  if (_sqlReady) return Promise.resolve();
  return new Promise(res => _sqlReadyCallbacks.push(res));
}

export const storage = {
  get: (k) => {
    if (_cache.hasOwnProperty(k)) return _cache[k];
    if (!_sqliteDB) return null;
    try {
      const res = _sqliteDB.exec(`SELECT value FROM kv WHERE key=?`, [k]);
      if (res.length && res[0].values.length) {
        const v = JSON.parse(res[0].values[0][0]);
        _cache[k] = v;
        return v;
      }
    } catch (e) { console.warn('SQLite get error', k, e); }
    return null;
  },
  set: (k, v) => {
    _cache[k] = v;
    if (!_sqliteDB) return;
    try {
      _sqliteDB.run(`INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`, [k, JSON.stringify(v)]);
      scheduleSave();
    } catch (e) { console.warn('SQLite set error', k, e); }
  },
  delete: (k) => {
    delete _cache[k];
    if (!_sqliteDB) return;
    try {
      _sqliteDB.run(`DELETE FROM kv WHERE key=?`, [k]);
      scheduleSave();
    } catch (e) {}
  },
  all: () => {
    if (!_sqliteDB) return {};
    try {
      const res = _sqliteDB.exec(`SELECT key, value FROM kv`);
      const out = {};
      if (res.length) res[0].values.forEach(([k, v]) => { try { out[k] = JSON.parse(v); } catch {} });
      return out;
    } catch { return {}; }
  },
  exportDB: () => _sqliteDB ? _sqliteDB.export() : null,
  importDB: async (data) => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
    _sqliteDB = new SQL.Database(data);
    Object.keys(_cache).forEach(k => delete _cache[k]);
    await saveDbToIDB();
  },
  exec: (sql) => {
    if (!_sqliteDB) throw new Error('SQLite не инициализирован');
    return _sqliteDB.exec(sql);
  },
  run: (sql, params) => {
    if (!_sqliteDB) throw new Error('SQLite не инициализирован');
    _sqliteDB.run(sql, params);
    scheduleSave();
  },
  isReady: () => _sqlReady,
};
