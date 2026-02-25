#!/usr/bin/env node
// scripts/copy-wasm.js
// Tries to copy sql-wasm.wasm from node_modules to public/
// Non-fatal: wasm is now loaded from CDN at runtime

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Ensure public/ exists
const publicDir = path.join(root, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log('✅ Created public/ directory');
}

// Try to copy wasm as local fallback (not required — CDN is used at runtime)
const candidates = [
  path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  path.join(root, 'node_modules', 'sql.js', 'sql-wasm.wasm'),
];

const dest = path.join(publicDir, 'sql-wasm.wasm');
const src = candidates.find(p => fs.existsSync(p));

if (src && !fs.existsSync(dest)) {
  try {
    fs.copyFileSync(src, dest);
    console.log('✅ sql-wasm.wasm copied to public/ (local fallback)');
  } catch (e) {
    console.log('ℹ️  Could not copy wasm locally — CDN will be used at runtime');
  }
} else {
  console.log('ℹ️  sql-wasm.wasm will be loaded from CDN at runtime');
}
// Always exit 0
process.exit(0);
