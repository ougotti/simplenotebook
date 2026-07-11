// next.config.js sets a basePath, but the static export under `out/` has no
// such subdirectory on disk -- basePath only affects how the app requests
// its own assets, not the export's file layout. `serve out` therefore
// serves the app at the origin root, so every basePath-prefixed request
// 404s. This script copies `out/` into a `.serve-root/<basePath>/` folder so
// a static file server can host it at the same path the app expects in
// production. basePath is read from next.config.js rather than duplicated
// here so the two can't drift apart.
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const nextConfig = require(path.join(rootDir, 'next.config.js'));
const BASE_PATH_SEGMENT = (nextConfig.basePath || '').replace(/^\/+/, '');
const outDir = path.join(rootDir, 'out');
const serveDir = path.join(rootDir, '.serve-root');
const targetDir = path.join(serveDir, BASE_PATH_SEGMENT);

if (!BASE_PATH_SEGMENT) {
  console.error('Error: next.config.js has no basePath set.');
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  console.error('Error: out/ directory not found. Run "npm run build" first.');
  process.exit(1);
}

fs.rmSync(serveDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(outDir, targetDir, { recursive: true });

console.log(`Prepared static export for serving under /${BASE_PATH_SEGMENT}`);
