import express from 'express';
import { app, errorHandler } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { pruneExpiredAssimilated } from './routes/followups.js';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Local dev / Docker entry point. Serves the SPA and the /api routes from the
// same Express process. Deployed to Cloudflare, only app.js runs - Pages
// serves the static assets (built by scripts/build-cf.mjs) and the Functions
// layer mounts the API under /api/*.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '../../'); // Church/ SPA root
const FRONTEND_FILES = ['index.html', 'styles.css', 'app.js', 'ai-engine.js', 'manifest.json', 'icon.svg', 'sw.js'];
// index.html is read per-request so HTML edits (labels, layout) show up on a
// plain refresh without a server restart. The shell is tiny and this app is
// demo-scale, so the synchronous read is a non-issue.
const loadIndexHtml = () => readFileSync(path.join(frontendDir, 'index.html'), 'utf8')
  .replace('<head>', '<head><meta name="church-api" content="same-origin">');

// Never let the browser cache frontend files (dev); versioned URLs keep them fresh.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
});

// Serve the SPA from the same origin (no CORS / cross-origin fetch issues).
// Only whitelisted assets are exposed - never server/ or .env.
app.use('/js', express.static(path.join(frontendDir, 'js'), { maxAge: 0 }));
app.use('/vendor', express.static(path.join(frontendDir, 'vendor'), { maxAge: 0 }));
app.use('/icons', express.static(path.join(frontendDir, 'icons'), { maxAge: 0 }));
for (const file of FRONTEND_FILES) {
  app.get('/' + file, (_req, res) => res.sendFile(path.join(frontendDir, file)));
}
app.get('/', (_req, res) => res.type('html').send(loadIndexHtml()));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.type('html').send(loadIndexHtml());
});

app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`Church 2.0 API listening on :${config.port} (${config.env})`);
});

// Assimilated guests become permanent members after 1 month. Sweep on boot and
// hourly so the follow-up pipeline auto-clears even without a page refresh.
pruneExpiredAssimilated().catch((e) => console.error('[assimilation] initial sweep failed', e));
setInterval(() => {
  pruneExpiredAssimilated().catch((e) => console.error('[assimilation] hourly sweep failed', e));
}, 60 * 60 * 1000);

// Graceful shutdown
const shutdown = () => {
  server.close(() => pool.end().then(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
