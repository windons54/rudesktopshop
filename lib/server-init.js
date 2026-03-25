// lib/server-init.js — серверная инициализация при старте Next.js
// Импортируется из instrumentation.js через /* webpackIgnore: true */
// Запускается один раз при старте Node.js процесса.

import { Pool } from 'pg';
import { readPgConfig } from './pg-config-reader.js';
import { runMigration } from './migration.js';
import { appendDebugLog } from './debug-log.js';

export async function runServerInit() {
  const pgConfig = readPgConfig();

  if (!pgConfig) {
    console.log('[ServerInit] No PG config found (no env vars, no pg-config.json), skipping migration');
    appendDebugLog('server-init', 'no_pg_config');
    return;
  }

  console.log('[ServerInit] PG config found, connecting...');
  appendDebugLog('server-init', 'pg_config_found', { source: pgConfig.source || 'unknown', host: pgConfig.host || null });

  const pool = new Pool({
    ...pgConfig,
    max: 2,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
  });

  try {
    await pool.query('SELECT 1');
    console.log('[ServerInit] Connected. Running migration check...');
    appendDebugLog('server-init', 'connected');
    await runMigration(pool);
    appendDebugLog('server-init', 'migration_check_completed');
  } catch (e) {
    console.warn('[ServerInit] Failed:', e.message);
    appendDebugLog('server-init', 'failed', { error: e.message, code: e.code || null, host: pgConfig.host || null });
  } finally {
    await pool.end().catch(() => {});
  }
}
