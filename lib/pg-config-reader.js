// lib/pg-config-reader.js — единая логика чтения PG-конфига для серверных модулей
// Повторяет readPgConfig() из pages/api/store.js: DATABASE_URL → PG_HOST → pg-config.json → pg-env.json
// Используется в server-init.js и pages/api/migrate.js

import fs from 'fs';
import path from 'path';

const DATA_DIR    = path.join(process.cwd(), 'data');
const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json');
const PG_ENV_FILE = path.join(DATA_DIR, 'pg-env.json');

/**
 * Читает конфиг PG в том же порядке что store.js.
 * @returns {object|null} конфиг для new Pool(...) или null
 */
export function readPgConfig() {
  // 1. DATABASE_URL
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  // 2. PG_HOST env
  if (process.env.PG_HOST) {
    return {
      host:     process.env.PG_HOST,
      port:     parseInt(process.env.PG_PORT || '5432', 10),
      database: process.env.PG_DATABASE || process.env.PG_DB || 'postgres',
      user:     process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      ssl:      process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };
  }
  // 3. pg-config.json (создаётся через UI, лежит в docker volume /app/data)
  try {
    if (fs.existsSync(PG_CFG_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8'));
      if (c && (c.host || c.connectionString)) {
        return _normalize(c);
      }
    }
  } catch {}
  // 4. pg-env.json (резервная копия, переживает деплой)
  try {
    if (fs.existsSync(PG_ENV_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_ENV_FILE, 'utf8'));
      if (c && (c.host || c.connectionString)) {
        return _normalize(c);
      }
    }
  } catch {}
  return null;
}

// Нормализуем ssl: boolean → объект, как это делает store.js
function _normalize(c) {
  const cfg = { ...c };
  if (cfg.connectionString) {
    cfg.ssl = { rejectUnauthorized: false };
  } else {
    // ssl может быть true/false/boolean/"true"/"false"/object
    if (cfg.ssl === true || cfg.ssl === 'true') {
      cfg.ssl = { rejectUnauthorized: false };
    } else if (!cfg.ssl || cfg.ssl === 'false') {
      cfg.ssl = false;
    }
    // если уже объект — оставляем как есть
  }
  // убираем служебные поля store.js
  delete cfg.source;
  delete cfg.enabled;
  return cfg;
}
