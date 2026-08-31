// Build script for Cloudflare Pages.
//
// Produces dist/ - a self-contained static build of the ChurchConnect SPA plus
// the small Pages config files (headers, redirects, function routes):
//
//   - SPA assets: index.html, app.js, styles.css, js/, vendor/, icons/, ...
//   - <meta name="church-api" content="same-origin"> injected into index.html
//     so js/config.js points API calls at the same origin (/api/* on Pages).
//   - _headers, _redirects, _routes.json for Pages.
//
// The backend (server/) is intentionally not copied: it runs in Pages
// Functions (functions/api/[[path]].js) and its secrets live in the Pages
// project environment, never in dist/.

import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

// Everything the SPA needs, relative to the repo root. Deliberately excludes
// server/, deploy/, vercel-deploy/, docs, workflows and lockfiles.
const COPY_ITEMS = [
  'index.html',
  'app.js',
  'styles.css',
  'ai-engine.js',
  'manifest.json',
  'sw.js',
  'icon.svg',
  'js',
  'vendor',
  'icons',
];

// 1. Clean slate so stale files never leak into the deployment.
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 2. Copy the SPA assets.
for (const item of COPY_ITEMS) {
  const src = resolve(root, item);
  if (!existsSync(src)) {
    console.warn('[build-cf] missing source, skipping: ' + item);
    continue;
  }
  cpSync(src, resolve(dist, item), { recursive: true });
}

// 3. Inject the same-origin marker. js/config.js reads this meta tag and sets
//    apiBase to window.location.origin, so the SPA talks to the Pages
//    Functions /api/* routes with no CORS config.
const indexHtmlPath = resolve(dist, 'index.html');
let indexHtml = readFileSync(indexHtmlPath, 'utf8');
if (!indexHtml.includes('name="church-api"')) {
  indexHtml = indexHtml.replace(
    '<head>',
    '<head>\n    <meta name="church-api" content="same-origin">'
  );
  writeFileSync(indexHtmlPath, indexHtml);
} else {
  console.log('[build-cf] church-api meta already present in index.html');
}

// 4. Never cache the service worker - it must pick up new versions promptly.
writeFileSync(
  resolve(dist, '_headers'),
  ['/sw.js', '  Cache-Control: no-cache, no-store, must-revalidate', ''].join('\n')
);

// 5. SPA fallback for deep links and refreshes. /api/* is handled by Pages
//    Functions before this rule and is excluded via _routes.json.
writeFileSync(resolve(dist, '_redirects'), '/* /index.html 200\n');

// 6. Route table: only /api/* invokes the Functions layer, so static assets
//    never trigger a function invocation.
writeFileSync(
  resolve(dist, '_routes.json'),
  JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2) + '\n'
);

console.log('[build-cf] OK - wrote dist/ with ' + COPY_ITEMS.length + ' assets + Pages config');
