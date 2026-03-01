// lib/pg-config-reader.js — единая логика чтения PG-конфига
//
// Порядок приоритетов:
//  1. pg.env       — файл в корне репозитория, коммитится в git, не сбрасывается при деплоях ✅
//  2. DATABASE_URL — env-переменная (heroku-style)
//  3. PG_HOST      — отдельные PG_* env-переменные
//  4. data/pg-config.json — сохраняется через UI (сбрасывается если volume не примонтирован)
//  5. data/pg-env.json    — резервная копия

import fs from 'fs';
import path from 'path';

const ROOT_DIR    = process.cwd();
const DATA_DIR    = path.join(ROOT_DIR, 'data');
const PG_ENV_FILE = path.join(ROOT_DIR, 'pg.env');          // ← главный файл, в git
const PG_CFG_FILE = path.join(DATA_DIR, 'pg-config.json'); // ← через UI
const PG_BAK_FILE = path.join(DATA_DIR, 'pg-env.json');    // ← резервная копия

/**
 * Парсит содержимое .env файла в объект { KEY: value }
 */
function parseEnvFile(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    result[key] = val;
  }
  return result;
}

/**
 * Читает конфиг PG в порядке приоритетов.
 * @returns {object|null} конфиг для new Pool(...) или null
 */
export function readPgConfig() {
  // ── 1. pg.env в корне репозитория ──────────────────────────────────────
  try {
    if (fs.existsSync(PG_ENV_FILE)) {
      const vars = parseEnvFile(fs.readFileSync(PG_ENV_FILE, 'utf8'));
      if (vars.PG_HOST || vars.DATABASE_URL) {
        if (vars.DATABASE_URL) {
          return { connectionString: vars.DATABASE_URL, ssl: { rejectUnauthorized: false } };
        }
        return _buildHostConfig(vars);
      }
    }
  } catch {}

  // ── 2. DATABASE_URL env ─────────────────────────────────────────────────
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }

  // ── 3. PG_HOST env ──────────────────────────────────────────────────────
  if (process.env.PG_HOST) {
    return _buildHostConfig(process.env);
  }

  // ── 4. data/pg-config.json (сохраняется через UI) ───────────────────────
  try {
    if (fs.existsSync(PG_CFG_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_CFG_FILE, 'utf8'));
      if (c && (c.host || c.connectionString)) return _normalize(c);
    }
  } catch {}

  // ── 5. data/pg-env.json (резервная копия) ───────────────────────────────
  try {
    if (fs.existsSync(PG_BAK_FILE)) {
      const c = JSON.parse(fs.readFileSync(PG_BAK_FILE, 'utf8'));
      if (c && (c.host || c.connectionString)) return _normalize(c);
    }
  } catch {}

  return null;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function _buildHostConfig(vars) {
  const ssl = vars.PG_SSL === 'true' || vars.PG_SSL === true;
  return {
    host:     vars.PG_HOST,
    port:     parseInt(vars.PG_PORT || '5432', 10),
    database: vars.PG_DATABASE || vars.PG_DB || 'postgres',
    user:     vars.PG_USER,
    password: vars.PG_PASSWORD,
    ssl:      ssl ? { rejectUnauthorized: false } : false,
  };
}

function _normalize(c) {
  const cfg = { ...c };
  delete cfg.source;
  delete cfg.enabled;
  if (cfg.connectionString) {
    cfg.ssl = { rejectUnauthorized: false };
  } else {
    if (cfg.ssl === true || cfg.ssl === 'true') {
      cfg.ssl = { rejectUnauthorized: false };
    } else if (!cfg.ssl || cfg.ssl === 'false') {
      cfg.ssl = false;
    }
  }
  return cfg;
}
