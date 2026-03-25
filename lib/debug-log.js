import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DEBUG_DIR = path.join(DATA_DIR, 'debug');
const DEBUG_FILE = path.join(DEBUG_DIR, 'app-debug.log');
const MAX_FILE_BYTES = 512 * 1024;

function ensureDebugDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function trimDebugFile() {
  try {
    const stat = fs.statSync(DEBUG_FILE);
    if (stat.size <= MAX_FILE_BYTES) return;
    const keepBytes = Math.floor(MAX_FILE_BYTES * 0.75);
    const fd = fs.openSync(DEBUG_FILE, 'r');
    const buffer = Buffer.alloc(keepBytes);
    fs.readSync(fd, buffer, 0, keepBytes, stat.size - keepBytes);
    fs.closeSync(fd);
    fs.writeFileSync(DEBUG_FILE, buffer);
  } catch {}
}

export function appendDebugLog(scope, message, extra = null) {
  try {
    ensureDebugDir();
    const entry = {
      ts: new Date().toISOString(),
      scope,
      message,
      ...(extra ? { extra } : {}),
    };
    fs.appendFileSync(DEBUG_FILE, JSON.stringify(entry) + '\n', 'utf8');
    trimDebugFile();
  } catch {}
}

export function readDebugLogTail(limit = 200) {
  try {
    ensureDebugDir();
    if (!fs.existsSync(DEBUG_FILE)) return [];
    const lines = fs.readFileSync(DEBUG_FILE, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(limit, 1000))).map((line) => {
      try { return JSON.parse(line); } catch { return { ts: new Date().toISOString(), scope: 'raw', message: line }; }
    });
  } catch (e) {
    return [{ ts: new Date().toISOString(), scope: 'debug-log', message: 'read_failed', extra: { error: e.message } }];
  }
}

export function clearDebugLog() {
  try {
    ensureDebugDir();
    if (fs.existsSync(DEBUG_FILE)) fs.unlinkSync(DEBUG_FILE);
  } catch {}
}

export function getDebugLogFilePath() {
  return DEBUG_FILE;
}
