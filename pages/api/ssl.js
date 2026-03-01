// pages/api/ssl.js
// Управление SSL-сертификатами: загрузка, удаление, статус.
// Сертификаты хранятся в /ssl/ в корне проекта (cert.pem, key.pem, ca.pem).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SSL_DIR = path.join(process.cwd(), 'ssl');
const CERT_PATH = path.join(SSL_DIR, 'cert.pem');
const KEY_PATH = path.join(SSL_DIR, 'key.pem');
const CA_PATH = path.join(SSL_DIR, 'ca.pem');

function ensureDir() {
  if (!fs.existsSync(SSL_DIR)) fs.mkdirSync(SSL_DIR, { recursive: true });
}

/** Парсим PEM-сертификат и достаём базовые данные */
function parseCertInfo(pemStr) {
  try {
    const x509 = new crypto.X509Certificate(pemStr);
    return {
      subject: x509.subject,
      issuer: x509.issuer,
      validFrom: x509.validFrom,
      validTo: x509.validTo,
      serialNumber: x509.serialNumber,
      fingerprint256: x509.fingerprint256,
    };
  } catch (e) {
    return { error: 'Не удалось разобрать сертификат: ' + e.message };
  }
}

/** Проверяем что приватный ключ валиден */
function validateKey(pemStr) {
  try {
    crypto.createPrivateKey(pemStr);
    return true;
  } catch {
    return false;
  }
}

/** Проверяем что сертификат и ключ — пара */
function certKeyMatch(certPem, keyPem) {
  try {
    const cert = new crypto.X509Certificate(certPem);
    const pubFromCert = cert.publicKey;
    const privKey = crypto.createPrivateKey(keyPem);
    const pubFromKey = crypto.createPublicKey(privKey);
    return pubFromCert.export({ type: 'spki', format: 'pem' }) === pubFromKey.export({ type: 'spki', format: 'pem' });
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  // ─── STATUS ───
  if (action === 'status') {
    ensureDir();
    const hasCert = fs.existsSync(CERT_PATH);
    const hasKey = fs.existsSync(KEY_PATH);
    const hasCa = fs.existsSync(CA_PATH);
    let certInfo = null;
    let matched = false;
    let expired = false;

    if (hasCert) {
      const certPem = fs.readFileSync(CERT_PATH, 'utf-8');
      certInfo = parseCertInfo(certPem);
      if (certInfo.validTo) {
        expired = new Date(certInfo.validTo) < new Date();
      }
      if (hasKey) {
        const keyPem = fs.readFileSync(KEY_PATH, 'utf-8');
        matched = certKeyMatch(certPem, keyPem);
      }
    }

    return res.json({
      ok: true,
      installed: hasCert && hasKey,
      hasCert, hasKey, hasCa,
      matched, expired,
      certInfo,
      httpsActive: !!process.env.__HTTPS_ACTIVE,
    });
  }

  // ─── UPLOAD ───
  if (action === 'upload') {
    ensureDir();
    const { cert, key, ca } = req.body;
    const errors = [];

    if (!cert || !cert.trim()) errors.push('Сертификат (cert.pem) обязателен');
    if (!key || !key.trim()) errors.push('Приватный ключ (key.pem) обязателен');

    if (cert && !cert.includes('-----BEGIN CERTIFICATE-----')) errors.push('Некорректный формат сертификата (ожидается PEM)');
    if (key && !key.includes('-----BEGIN') ) errors.push('Некорректный формат ключа (ожидается PEM)');

    if (errors.length) return res.json({ ok: false, errors });

    // Валидация ключа
    if (!validateKey(key)) {
      return res.json({ ok: false, errors: ['Приватный ключ невалиден или повреждён'] });
    }

    // Проверка пары cert+key
    if (!certKeyMatch(cert, key)) {
      return res.json({ ok: false, errors: ['Сертификат и ключ не являются парой'] });
    }

    // Парсинг информации
    const certInfo = parseCertInfo(cert);
    if (certInfo.error) {
      return res.json({ ok: false, errors: [certInfo.error] });
    }

    // Проверка срока
    if (certInfo.validTo && new Date(certInfo.validTo) < new Date()) {
      return res.json({ ok: false, errors: ['Сертификат уже истёк (' + certInfo.validTo + ')'] });
    }

    // Записываем файлы
    try {
      fs.writeFileSync(CERT_PATH, cert, 'utf-8');
      fs.writeFileSync(KEY_PATH, key, { mode: 0o600, encoding: 'utf-8' });
      if (ca && ca.trim()) {
        fs.writeFileSync(CA_PATH, ca, 'utf-8');
      } else if (fs.existsSync(CA_PATH)) {
        fs.unlinkSync(CA_PATH);
      }
    } catch (e) {
      return res.json({ ok: false, errors: ['Ошибка записи файлов: ' + e.message] });
    }

    return res.json({
      ok: true,
      certInfo,
      message: 'SSL-сертификат установлен. Перезапустите сервер для активации HTTPS.',
    });
  }

  // ─── DELETE ───
  if (action === 'delete') {
    ensureDir();
    [CERT_PATH, KEY_PATH, CA_PATH].forEach(f => {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    });
    return res.json({ ok: true, message: 'SSL-сертификаты удалены.' });
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });
}
