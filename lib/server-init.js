// lib/server-init.js — серверная инициализация при старте Next.js
// Импортируется из instrumentation.js через /* webpackIgnore: true */
// Запускается один раз при старте Node.js процесса.

import { Pool } from 'pg';
import { readPgConfig } from './pg-config-reader.js';
import { runMigration } from './migration.js';

export async function runServerInit() {
  const pgConfig = readPgConfig();

  if (!pgConfig) {
    console.log('[ServerInit] No PG config found (no env vars, no pg-config.json), skipping migration');
    return;
  }

  console.log('[ServerInit] PG config found, connecting...');

  const pool = new Pool({
    ...pgConfig,
    max: 2,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
  });

  try {
    await pool.query('SELECT 1');
    console.log('[ServerInit] Connected. Running migration check...');
    await runMigration(pool);
  } catch (e) {
    console.warn('[ServerInit] Failed:', e.message);
  } finally {
    await pool.end().catch(() => {});
  }
}
