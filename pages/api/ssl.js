// pages/api/ssl.js
// Управление SSL-сертификатами: загрузка, удаление, статус, Let's Encrypt.
// Сертификаты хранятся в /ssl/ в корне проекта (cert.pem, key.pem, ca.pem).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const SSL_DIR = path.join(process.cwd(), 'ssl');
const CERT_PATH = path.join(SSL_DIR, 'cert.pem');
const KEY_PATH = path.join(SSL_DIR, 'key.pem');
const CA_PATH = path.join(SSL_DIR, 'ca.pem');
const LE_LOG_PATH = path.join(SSL_DIR, 'letsencrypt.log');

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
  } catch (_e) {
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
  } catch (_e) {
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
    if (key && !key.includes('-----BEGIN')) errors.push('Некорректный формат ключа (ожидается PEM)');

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
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_e) { /* ignore */ }
    });
    return res.json({ ok: true, message: 'SSL-сертификаты удалены.' });
  }

  // ─── LETSENCRYPT CHECK ───
  if (action === 'le_check') {
    let certbotInstalled = false;
    let certbotVersion = '';
    try {
      certbotVersion = execSync('certbot --version 2>&1', { encoding: 'utf-8', timeout: 5000 }).trim();
      certbotInstalled = true;
    } catch (_e) { /* certbot not found */ }

    return res.json({
      ok: true,
      certbotInstalled,
      certbotVersion,
    });
  }

  // ─── LETSENCRYPT ISSUE ───
  if (action === 'le_issue') {
    ensureDir();
    const { domain, email, method } = req.body;
    const errors = [];

    if (!domain || !domain.trim()) errors.push('Укажите домен');
    if (!email || !email.trim()) errors.push('Укажите email для Let\'s Encrypt');
    if (domain && !/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/.test(domain.trim())) {
      errors.push('Некорректный формат домена');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.push('Некорректный email');
    }
    if (errors.length) return res.json({ ok: false, errors });

    const d = domain.trim();
    const em = email.trim();
    const useStandalone = method !== 'webroot';

    // Формируем команду certbot
    let cmd;
    if (useStandalone) {
      cmd = [
        'certbot', 'certonly', '--standalone',
        '--non-interactive', '--agree-tos',
        '--email', em,
        '-d', d,
        '--cert-path', CERT_PATH,
        '--key-path', KEY_PATH,
        '--fullchain-path', CERT_PATH,
        '--http-01-port', '80',
      ];
    } else {
      const webrootPath = path.join(process.cwd(), 'public');
      cmd = [
        'certbot', 'certonly', '--webroot',
        '--non-interactive', '--agree-tos',
        '--email', em,
        '-d', d,
        '--webroot-path', webrootPath,
      ];
    }

    // Запускаем certbot
    try {
      const result = execSync(cmd.join(' ') + ' 2>&1', {
        encoding: 'utf-8',
        timeout: 120000,
        env: { ...process.env, PATH: process.env.PATH + ':/usr/bin:/usr/local/bin:/snap/bin' },
      });

      fs.writeFileSync(LE_LOG_PATH, result, 'utf-8');

      // Certbot по умолчанию кладёт сертификаты в /etc/letsencrypt/live/<domain>/
      const liveDir = '/etc/letsencrypt/live/' + d;
      const liveCert = path.join(liveDir, 'fullchain.pem');
      const liveKey = path.join(liveDir, 'privkey.pem');

      if (fs.existsSync(liveCert) && fs.existsSync(liveKey)) {
        fs.copyFileSync(liveCert, CERT_PATH);
        fs.copyFileSync(liveKey, KEY_PATH);
        if (fs.existsSync(CA_PATH)) try { fs.unlinkSync(CA_PATH); } catch (_e) { /* ok */ }

        const certPem = fs.readFileSync(CERT_PATH, 'utf-8');
        const certInfo = parseCertInfo(certPem);

        return res.json({
          ok: true,
          certInfo,
          log: result.slice(-500),
          message: 'Let\'s Encrypt сертификат успешно получен для ' + d + '. Перезапустите сервер.',
        });
      }

      // Если certbot использовал --cert-path напрямую
      if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
        const certPem = fs.readFileSync(CERT_PATH, 'utf-8');
        const certInfo = parseCertInfo(certPem);
        return res.json({
          ok: true,
          certInfo,
          log: result.slice(-500),
          message: 'Let\'s Encrypt сертификат получен для ' + d + '. Перезапустите сервер.',
        });
      }

      return res.json({
        ok: false,
        errors: ['Certbot завершился, но сертификаты не найдены. Проверьте логи.'],
        log: result.slice(-1000),
      });

    } catch (err) {
      const output = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + err.message;
      fs.writeFileSync(LE_LOG_PATH, output, 'utf-8');
      return res.json({
        ok: false,
        errors: ['Ошибка certbot: ' + (err.stderr || err.message || 'неизвестная ошибка').slice(0, 300)],
        log: output.slice(-1000),
      });
    }
  }

  // ─── LETSENCRYPT RENEW ───
  if (action === 'le_renew') {
    ensureDir();
    const { domain } = req.body;
    try {
      const result = execSync('certbot renew --non-interactive 2>&1', {
        encoding: 'utf-8',
        timeout: 120000,
        env: { ...process.env, PATH: process.env.PATH + ':/usr/bin:/usr/local/bin:/snap/bin' },
      });
      fs.writeFileSync(LE_LOG_PATH, result, 'utf-8');

      // Перекопируем обновлённые файлы
      if (domain) {
        const liveDir = '/etc/letsencrypt/live/' + domain.trim();
        const liveCert = path.join(liveDir, 'fullchain.pem');
        const liveKey = path.join(liveDir, 'privkey.pem');
        if (fs.existsSync(liveCert) && fs.existsSync(liveKey)) {
          fs.copyFileSync(liveCert, CERT_PATH);
          fs.copyFileSync(liveKey, KEY_PATH);
        }
      }

      return res.json({
        ok: true,
        log: result.slice(-500),
        message: 'Продление сертификата завершено. Перезапустите сервер при необходимости.',
      });
    } catch (err) {
      const output = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + err.message;
      return res.json({
        ok: false,
        errors: ['Ошибка при продлении: ' + (err.stderr || err.message || '').slice(0, 300)],
        log: output.slice(-1000),
      });
    }
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });
}
