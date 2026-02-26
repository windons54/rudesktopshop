// scripts/copy-wasm.js
// Копирует sql-wasm.wasm из node_modules/sql.js/dist в public/
// Запускается после `npm run build` и при `postinstall`

const fs   = require('fs');
const path = require('path');

const root    = path.join(__dirname, '..');
const dest    = path.join(root, 'public', 'sql-wasm.wasm');
const distDir = path.join(root, 'node_modules', 'sql.js', 'dist');

if (!fs.existsSync(path.join(root, 'public'))) {
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
}

if (fs.existsSync(dest)) {
  console.log('✅ sql-wasm.wasm already in public/');
  process.exit(0);
}

if (!fs.existsSync(distDir)) {
  console.warn('⚠️  sql.js/dist not found — skipping wasm copy');
  process.exit(0);
}

const files = fs.readdirSync(distDir);
const wasm  =
  files.find(f => f === 'sql-wasm.wasm') ||
  files.find(f => f.includes('browser') && f.endsWith('.wasm')) ||
  files.find(f => f.endsWith('.wasm'));

if (wasm) {
  fs.copyFileSync(path.join(distDir, wasm), dest);
  console.log(`✅ Copied ${wasm} → public/sql-wasm.wasm`);
} else {
  console.warn('⚠️  No .wasm file found in sql.js/dist');
}
