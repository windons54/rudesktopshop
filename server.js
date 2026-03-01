// server.js — Кастомный сервер Next.js с поддержкой HTTPS (SSL).
// Если в папке ./ssl есть cert.pem и key.pem — запускается HTTPS на PORT_HTTPS (443).
// HTTP всегда работает на PORT (3000) и может редиректить на HTTPS.

const { createServer: createHttpServer } = require('http');
const { createServer: createHttpsServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const httpPort = parseInt(process.env.PORT, 10) || 3000;
const httpsPort = parseInt(process.env.PORT_HTTPS, 10) || 443;
const sslDir = path.join(__dirname, 'ssl');
const SSL_REDIRECT = process.env.SSL_REDIRECT !== 'false'; // редирект HTTP→HTTPS по умолчанию

function loadSslOpts() {
  const certPath = path.join(sslDir, 'cert.pem');
  const keyPath = path.join(sslDir, 'key.pem');
  const caPath = path.join(sslDir, 'ca.pem');

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null;

  try {
    const opts = {
      cert: fs.readFileSync(certPath, 'utf-8'),
      key: fs.readFileSync(keyPath, 'utf-8'),
    };
    if (fs.existsSync(caPath)) {
      opts.ca = fs.readFileSync(caPath, 'utf-8');
    }
    return opts;
  } catch (e) {
    console.error('[SSL] Ошибка чтения сертификатов:', e.message);
    return null;
  }
}

async function main() {
  const app = next({ dev, hostname, port: httpPort });
  const handle = app.getRequestHandler();
  await app.prepare();

  const sslOpts = loadSslOpts();

  // ── HTTP сервер ──
  const httpServer = createHttpServer((req, res) => {
    // Если HTTPS активен и включён редирект — перенаправляем
    if (sslOpts && SSL_REDIRECT && req.headers.host) {
      const host = req.headers.host.split(':')[0];
      const target = `https://${host}${httpsPort !== 443 ? ':' + httpsPort : ''}${req.url}`;
      res.writeHead(301, { Location: target });
      res.end();
      return;
    }
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  httpServer.listen(httpPort, hostname, () => {
    console.log(`[HTTP]  Сервер запущен → http://${hostname}:${httpPort}`);
  });

  // ── HTTPS сервер (если есть сертификаты) ──
  if (sslOpts) {
    try {
      const httpsServer = createHttpsServer(sslOpts, (req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
      });

      httpsServer.listen(httpsPort, hostname, () => {
        process.env.__HTTPS_ACTIVE = 'true';
        console.log(`[HTTPS] Сервер запущен → https://${hostname}:${httpsPort}`);
        console.log(`[HTTPS] SSL-сертификаты загружены из ${sslDir}`);
      });

      httpsServer.on('error', (e) => {
        if (e.code === 'EACCES') {
          console.error(`[HTTPS] Нет прав для порта ${httpsPort}. Попробуйте PORT_HTTPS=8443 или запустите от root.`);
        } else {
          console.error('[HTTPS] Ошибка запуска:', e.message);
        }
        console.log('[HTTPS] Продолжаем работу только по HTTP.');
      });
    } catch (e) {
      console.error('[HTTPS] Не удалось создать HTTPS-сервер:', e.message);
      console.log('[HTTPS] Продолжаем работу только по HTTP.');
    }
  } else {
    console.log('[SSL]   Сертификаты не найдены (./ssl/cert.pem, ./ssl/key.pem). Работаем только по HTTP.');
  }
}

main().catch((e) => {
  console.error('Ошибка запуска сервера:', e);
  process.exit(1);
});
