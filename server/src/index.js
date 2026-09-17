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
const FRONTEND_FILES = ['index.html', 'styles.css', 'app.js', 'ai-engine.js', 'manifest.json', 'icon.svg', 'sw.js', 'member-manifest.json'];
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
// The member app is generated from index.html (same as scripts/build-cf.mjs)
// so the installable member entry stays current and always carries the
// same-origin API marker in local dev too.
app.get('/member.html', (_req, res) => res.type('html').send(
  loadIndexHtml()
    .replace('<body>', '<body data-app="member">')
    .replace(/href="manifest\.json\?v=\d+"/, 'href="member-manifest.json?v=1"')
));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.type('html').send(loadIndexHtml());
});

app.use(errorHandler);

// ---- Start: never crash on a busy port -------------------------------------
// If the configured port (4000 by default) is already taken by another server,
// roll up to the next free port and print the real URL to open.
const MAX_PORT_JUMPS = 20;
const tryListen = (port) =>
  new Promise((resolve, reject) => {
    const srv = app.listen(port);
    srv.once('listening', () => resolve(srv));
    srv.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') return reject(new Error('EADDRINUSE'));
      reject(err);
    });
  });

async function startServer() {
  let server = null;
  for (let port = config.port; port < config.port + MAX_PORT_JUMPS; port++) {
    try {
      server = await tryListen(port);
      console.log(`\nChurch 2.0 is running at  http://localhost:${port}  (${config.env})`);
      console.log(`Open this address in your browser - it serves the app AND the API.\n`);
      console.log(`Sign-ins and any refusal reasons are printed live below.`);
      console.log(`Staff sign-ins are tagged [STAFF] so an admin login stands out.\n`);
      break;
    } catch (err) {
      if (err && err.message === 'EADDRINUSE') {
        console.log(`Port ${port} is already in use - trying port ${port + 1}...`);
        continue;
      }
      throw err;
    }
  }
  if (!server) {
    console.error(`Ports ${config.port} to ${config.port + MAX_PORT_JUMPS - 1} are all busy. Close other node/npm windows and try again.`);
    process.exit(1);
  }

  // Assimilated guests become permanent members after 1 month. Sweep on boot
  // and hourly so the follow-up pipeline auto-clears without a page refresh.
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
}

startServer().catch((e) => {
  console.error(e);
  process.exit(1);
});
