/** @type {import('next').NextConfig} */
const fs = require('fs');
const path = require('path');

// Копируем sql-wasm.wasm в public/ при сборке
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
  const wasm =
    files.find(f => f === 'sql-wasm.wasm') ||
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
  // standalone — минимальный Node.js-сервер, запуск через: node .next/standalone/server.js
  output: 'standalone',
  reactStrictMode: false,

  async headers() {
    return [
      {
        source: '/sql-wasm.wasm',
        headers: [
          { key: 'Content-Type', value: 'application/wasm' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        buffer: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
