// Build script for Cloudflare Pages.
//
// Produces dist/ - a self-contained static build of the ChurchConnect SPA plus
// the Pages config files and the prebuilt API worker:
//
//   - SPA assets: index.html, app.js, styles.css, js/, vendor/, icons/, ...
//   - _worker.js: the Express API bundled with esbuild (Cloudflare Pages
//     advanced mode). The bundle is produced here, on the build machine, so
//     Wrangler only uploads dist/ and never resolves the server module graph
//     at deploy time (that resolution failed on this repo's OneDrive path,
//     which broke the old functions/api/[[path]].js setup).
//   - _routes.json: only /api/* invokes the Worker.
//   - _headers, _redirects for the SPA.
//
// The backend sources (server/) are intentionally not copied into dist/ - the
// API lives in _worker.js and its secrets live in the Pages project
// environment, never in the bundle.

import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

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
//    _worker.js /api/* routes with no CORS config.
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

// 5. SPA fallback for deep links and refreshes. /api/* is handled by the
//    Worker before this rule and is excluded via _routes.json.
writeFileSync(resolve(dist, '_redirects'), '/* /index.html 200\n');

// 6. Bundle the Express API into a single Worker (_worker.js = Pages advanced
//    mode). node: builtins and cloudflare:node stay external and are provided
//    by the Workers runtime under nodejs_compat_v2 (wrangler.toml), so the
//    output is fully self-contained and deploys with no resolution step.
await esbuild({
  entryPoints: [resolve(root, 'server/src/pages-entry.js')],
  outfile: resolve(dist, '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  // Bundle schema.sql as a plain string so the Worker can run the idempotent
  // schema + core seed on first request (see server/src/db/auto-migrate.js).
  loader: { '.sql': 'text' },
  // Node builtins stay external: the Workers runtime provides them under
  // nodejs_compat_v2 (wrangler.toml). With platform 'neutral' esbuild does not
  // auto-externalize them, so list both the node: prefixed and legacy names to
  // stop resolution from walking out of the project into the host filesystem.
  external: [
    'cloudflare:node',
    ...[
      'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
      'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
      'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
      'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
      'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
      'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
      'worker_threads', 'zlib',
    ].flatMap((name) => [name, 'node:' + name]),
  ],
  banner: {
    js: 'import { createRequire as __workerCreateRequire } from "node:module";\nconst require = __workerCreateRequire("/");\n',
  },
  logLevel: 'info',
});

// 7. Route table: only /api/* invokes the Worker, so static assets never
//    trigger a Worker invocation.
writeFileSync(
  resolve(dist, '_routes.json'),
  JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2) + '\n'
);

console.log('[build-cf] OK - wrote dist/ with ' + COPY_ITEMS.length + ' assets + _worker.js + Pages config');