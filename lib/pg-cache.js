// lib/pg-cache.js — серверный in-memory кэш для PostgreSQL kv-store
//
// Архитектура:
//  - Каждый ключ кэшируется отдельно с TTL (по умолчанию 10с)
//  - getAll() кэшируется отдельно с коротким TTL (2с) — он самый дорогой
//  - При set/delete соответствующие ключи инвалидируются немедленно
//  - _pgCache — глобальный синглтон (переживает hot reload в dev)

const DEFAULT_TTL_MS = 10_000;   // 10 сек для отдельных ключей
const ALL_TTL_MS     = 2_000;    // 2 сек для getAll (1898KB!)
const IMAGES_TTL_MS  = 60_000;   // 60 сек для cm_images (редко меняются)

class PgCache {
  constructor() {
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this._store = new Map();
    this._hits = 0;
    this._misses = 0;
  }

  _ttlFor(key) {
    if (key === '__all__')   return ALL_TTL_MS;
    if (key === 'cm_images') return IMAGES_TTL_MS;
    return DEFAULT_TTL_MS;
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) { this._misses++; return undefined; }
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      this._misses++;
      return undefined;
    }
    this._hits++;
    return entry.value;
  }

  set(key, value) {
    this._store.set(key, {
      value,
      expiresAt: Date.now() + this._ttlFor(key),
    });
  }

  invalidate(key) {
    this._store.delete(key);
    this._store.delete('__all__'); // getAll всегда инвалидируем при изменении
  }

  flush() {
    this._store.clear();
  }

  stats() {
    const now = Date.now();
    let alive = 0, expired = 0;
    for (const [, v] of this._store) {
      if (now <= v.expiresAt) alive++; else expired++;
    }
    return { hits: this._hits, misses: this._misses, alive, expired };
  }
}

// Глобальный синглтон — переживает hot reload Next.js
const g = globalThis;
if (!g._pgCache) g._pgCache = new PgCache();

export const pgCache = g._pgCache;
