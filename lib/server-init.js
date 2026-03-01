// lib/server-init.js — серверная инициализация: миграция cm_appearance → cm_images
// Импортируется ТОЛЬКО через динамический import() из instrumentation.js (/* webpackIgnore: true */)
//
// КЛЮЧЕВОЕ ОТЛИЧИЕ от предыдущей версии:
// Не ждём g._pgPool (он может не существовать на момент старта).
// Создаём собственный временный Pool через DATABASE_URL или PG_* env-переменные,
// либо читаем конфиг из /app/data/pg-config.json (fallback для docker-деплоев без env).

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { runMigration } from './migration.js';

function buildPgConfig() {
  // 1. DATABASE_URL (heroku-style)
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  // 2. Отдельные PG_* переменные
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
  // 3. Файловый конфиг (docker volume /app/data/pg-config.json)
  try {
    const raw = readFileSync('/app/data/pg-config.json', 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg && cfg.host) return cfg;
  } catch {}
  return null;
}

export async function runServerInit() {
  const pgConfig = buildPgConfig();
  if (!pgConfig) {
    console.log('[ServerInit] No PG config found, skipping migration');
    return;
  }

  const pool = new Pool({ ...pgConfig, max: 2, connectionTimeoutMillis: 8000 });

  try {
    // Проверяем соединение
    await pool.query('SELECT 1');
    console.log('[ServerInit] DB connected, checking migration...');

    await runMigration(pool);
  } catch (e) {
    console.warn('[ServerInit] Error:', e.message);
  } finally {
    await pool.end().catch(() => {});
  }
}
