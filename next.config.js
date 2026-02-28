/** @type {import('next').NextConfig} */
const fs = require('fs');
const path = require('path');

// Copy sql-wasm.wasm from node_modules to public/ at build time
function copySqlWasm() {
  const dest = path.join(__dirname, 'public', 'sql-wasm.wasm');
  if (!fs.existsSync(path.join(__dirname, 'public'))) {
    fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
  }
  if (fs.existsSync(dest)) {
    console.log('✅ sql-wasm.wasm already in public/');
    return;
  }
  const distDir = path.join(__dirname, 'node_modules', 'sql.js', 'dist');
  if (!fs.existsSync(distDir)) {
    console.warn('⚠️  sql.js/dist not found');
    return;
  }
  const files = fs.readdirSync(distDir);
  console.log('sql.js/dist:', files.join(', '));
  // Prefer browser version, then any wasm
  const wasm = files.find(f => f === 'sql-wasm.wasm') ||
               files.find(f => f.includes('browser') && f.endsWith('.wasm')) ||
               files.find(f => f.endsWith('.wasm'));
  if (wasm) {
    fs.copyFileSync(path.join(distDir, wasm), dest);
    console.log('✅ Copied', wasm, '→ public/sql-wasm.wasm');
  } else {
    console.warn('⚠️  No .wasm found in sql.js/dist');
  }
}

copySqlWasm();

const nextConfig = {
  reactStrictMode: false,

  compress: true,
  poweredByHeader: false,

  // Оптимизация для продакшена
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },

  async headers() {
    return [
      {
        source: '/sql-wasm.wasm',
        headers: [
          { key: 'Content-Type', value: 'application/wasm' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Кэширование статических ресурсов
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // API — без кэша
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Серверные Node.js модули не доступны в браузере.
      // pg (и instrumentation.js) используют net/tls/dns — помечаем их как false
      // чтобы webpack не пытался их збандлить для клиентской сборки.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        buffer: false,
        net: false,
        tls: false,
        dns: false,
        stream: false,
        os: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
