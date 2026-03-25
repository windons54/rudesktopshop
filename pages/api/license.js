import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'license-config.json');
const STATUS_FILE = path.join(DATA_DIR, 'license-status.json');
const CHECK_TTL_MS = 15 * 60 * 1000;
const STALE_OK_MS = 24 * 60 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return fallback;
}

function writeJson(file, value) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function deleteFile(file) {
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
}

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function maskKey(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function normalizeServerUrl(url) {
  let value = String(url || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value.replace(/\/+$/, '');
}

function getSiteInfo(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const domain = host.replace(/:\d+$/, '');
  return {
    host,
    domain,
    siteUrl: domain ? `${proto}://${domain}` : '',
  };
}

function isUnexpired(expiresAt) {
  if (!expiresAt) return true;
  const ts = new Date(expiresAt).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

function toClientPayload(config, status) {
  const configured = !!(config?.serverUrl && config?.licenseKey);
  const valid = !!(configured && status?.valid && isUnexpired(status?.expiresAt));
  return {
    ok: true,
    configured,
    valid,
    blocked: !valid,
    config: configured ? {
      serverUrl: config.serverUrl,
      hasKey: !!config.licenseKey,
      licenseKeyMasked: maskKey(config.licenseKey),
      instanceId: config.instanceId || null,
      activatedAt: config.activatedAt || null,
      updatedAt: config.updatedAt || null,
    } : { serverUrl: '', hasKey: false, licenseKeyMasked: '', instanceId: null, activatedAt: null, updatedAt: null },
    status: status ? {
      valid: !!status.valid,
      plan: status.plan || null,
      expiresAt: status.expiresAt || null,
      checkedAt: status.checkedAt || null,
      reason: status.reason || null,
      message: status.message || null,
      boundDomain: status.boundDomain || null,
      stale: !!status.stale,
    } : null,
  };
}

async function validateRemote(config, req) {
  const { domain, siteUrl } = getSiteInfo(req);
  const endpoint = `${normalizeServerUrl(config.serverUrl)}/api.php?action=validate`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      license_key: config.licenseKey,
      domain,
      site_url: siteUrl,
      instance_id: config.instanceId,
      product: 'corp-merch-store',
    }),
  });

  if (!response.ok) {
    throw new Error(`license_server_http_${response.status}`);
  }

  const data = await response.json();
  return {
    valid: !!data.valid,
    reason: data.reason || null,
    message: data.message || null,
    plan: data.plan || data.duration || null,
    expiresAt: data.expires_at || null,
    boundDomain: data.bound_domain || domain || null,
    checkedAt: new Date().toISOString(),
    stale: false,
    serverUrl: normalizeServerUrl(config.serverUrl),
    licenseKeyHash: hashKey(config.licenseKey),
  };
}

async function resolveStatus(req, { force = false, configOverride = null } = {}) {
  let config = configOverride || readJson(CONFIG_FILE, null);
  if (!config?.serverUrl || !config?.licenseKey) return { config, status: null };

  if (!config.instanceId) {
    config = { ...config, instanceId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    writeJson(CONFIG_FILE, config);
  }

  const cached = readJson(STATUS_FILE, null);
  const sameLicense = cached && cached.licenseKeyHash === hashKey(config.licenseKey) && cached.serverUrl === normalizeServerUrl(config.serverUrl);
  const checkedAtTs = cached?.checkedAt ? new Date(cached.checkedAt).getTime() : 0;

  if (!force && sameLicense && cached?.valid && isUnexpired(cached?.expiresAt) && checkedAtTs && (Date.now() - checkedAtTs) < CHECK_TTL_MS) {
    return { config, status: cached };
  }

  try {
    const status = await validateRemote(config, req);
    writeJson(STATUS_FILE, status);
    return { config, status };
  } catch (error) {
    if (sameLicense && cached?.valid && isUnexpired(cached?.expiresAt) && checkedAtTs && (Date.now() - checkedAtTs) < STALE_OK_MS) {
      const staleStatus = {
        ...cached,
        stale: true,
        message: cached.message || 'Используется последний успешный результат проверки',
      };
      writeJson(STATUS_FILE, staleStatus);
      return { config, status: staleStatus };
    }
    const failed = {
      valid: false,
      reason: 'validation_error',
      message: error.message,
      plan: null,
      expiresAt: null,
      boundDomain: null,
      checkedAt: new Date().toISOString(),
      stale: false,
      serverUrl: normalizeServerUrl(config.serverUrl),
      licenseKeyHash: hashKey(config.licenseKey),
    };
    writeJson(STATUS_FILE, failed);
    return { config, status: failed };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const action = req.method === 'GET' ? (req.query.action || 'status') : (req.body?.action || 'status');

  if (action === 'status') {
    const { config, status } = await resolveStatus(req, { force: !!req.body?.force });
    return res.json(toClientPayload(config, status));
  }

  if (action === 'refresh') {
    const { config, status } = await resolveStatus(req, { force: true });
    return res.json(toClientPayload(config, status));
  }

  if (action === 'activate') {
    const saved = readJson(CONFIG_FILE, null);
    const serverUrl = normalizeServerUrl(req.body?.serverUrl || saved?.serverUrl || '');
    const licenseKey = String(req.body?.licenseKey || '').trim() || saved?.licenseKey || '';

    if (!serverUrl || !licenseKey) {
      return res.json({ ok: false, error: 'Укажите адрес сервера лицензий и ключ активации' });
    }

    const config = {
      serverUrl,
      licenseKey,
      instanceId: saved?.instanceId || crypto.randomUUID(),
      activatedAt: saved?.activatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    writeJson(CONFIG_FILE, config);
    const { status } = await resolveStatus(req, { force: true, configOverride: config });
    return res.json(toClientPayload(config, status));
  }

  if (action === 'clear') {
    deleteFile(CONFIG_FILE);
    deleteFile(STATUS_FILE);
    return res.json({ ok: true, configured: false, valid: false, blocked: true, config: null, status: null });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
