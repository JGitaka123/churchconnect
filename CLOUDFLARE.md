# Deploying ChurchConnect to Cloudflare Pages

> **Fastest path: double-click `DEPLOY-CF.bat`** at the repo root. It installs
> dependencies, builds `dist/`, logs you into Cloudflare, creates the Pages
> project, sets the required secrets, and deploys - no GitHub Actions needed.


ChurchConnect deploys as a single Cloudflare Pages project:

- **Static SPA** - `index.html`, `app.js`, `styles.css`, `js/`, `vendor/` and
  `icons/` are assembled into `dist/` by `scripts/build-cf.mjs` and served by
  Pages' global CDN.
- **API** - the Express backend (`server/src/app.js`) is bundled into
  `dist/_worker.js` by `scripts/build-cf.mjs` (Pages advanced mode) and
  mounted under `/api/*`. It talks to a Neon Postgres database using
  `@neondatabase/serverless`, a drop-in `pg` replacement that connects over
  WebSockets (Workers cannot open raw TCP sockets).

SPA and API share one origin (`https://churchconnect.pages.dev`), so there is
no CORS setup: the build script injects
`<meta name="church-api" content="same-origin">` into `dist/index.html`, and
`js/config.js` uses that marker to point API calls at `window.location.origin`.


> **Fresh/stale database self-heals:** the deployed Worker runs the schema + a
> small core dataset (church, campuses, admin accounts, members) once on the first
> request. It is idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`), so you do
> not need to migrate the Neon database manually before the first deploy - just set
> `DATABASE_URL` as a secret below.

## What you need

- The GitHub repository with this code (push to `main` to deploy).
- A Cloudflare account (free tier is fine).
- A Neon Postgres database (free tier: https://neon.tech).

## 1. Create the Neon database and load the schema

1. Sign up at https://neon.tech and create a project in a region close to your
   users (e.g. `US East` or `EU West`).
2. Copy the pooled connection string from the dashboard (Project Settings ->
   Connection Details). It looks like:
   `postgresql://user:password@ep-xxxx.region.aws.neon.tech/churchconnect?sslmode=require`
3. Create the schema and seed demo data **from your machine** (node-postgres
   needs a normal TCP connection, so this runs locally, not on Workers):

   ```powershell
   cd server
   $env:DATABASE_URL = "postgresql://user:password@ep-xxxx.region.aws.neon.tech/churchconnect?sslmode=require"
   $env:PGSSL = "require"
   node src/db/migrate.js
   node src/db/seed.js
   ```

   `migrate.js` is idempotent (`IF NOT EXISTS`), so it is safe to re-run.
   `seed.js` creates the demo accounts (password from `SEED_PASSWORD`, default
   `grace`).


> **Stuck at login?** Run the one-command admin reset from the `server`
> folder (uses the schema + core seed first, then turns MFA off for the
> admin so you can get in even before email/SMS delivery is configured):

> ```powershell
> cd server
> $env:DATABASE_URL = "postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require"
> $env:DB_DRIVER = "neon"
> npm run reset-admin
> ```

> It prints the email and password to use (default `admin@maximummiracle.org` / `grace`).

## 2. Create the Pages project (one time)

The repo ships `wrangler.toml` with:

```toml
name = "churchconnect"
pages_build_output_dir = "./dist"
compatibility_date = "2026-08-19"
compatibility_flags = ["nodejs_compat_v2"]
```

Create the project (or let the GitHub Action create it on the first deploy):

```powershell
npx wrangler@4 pages project create churchconnect --production-branch main
```

Requires wrangler >= 3.45.0 (the V2 build system that reads
`pages_build_output_dir`). The compatibility settings enable the Node.js HTTP
server modules used by the prebuilt `_worker.js` entry.

## 3. Set the Pages environment variables

In the Cloudflare dashboard (Workers & Pages -> churchconnect -> Settings ->
Environment variables), add these production values. The API reads them from
`process.env` (populated automatically on recent compatibility dates), so no
code changes are needed:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Your Neon connection string (`postgresql://...?sslmode=require`) |
| `DB_DRIVER` | `neon` - switches the API to the WebSocket Neon driver |
| `JWT_SECRET` | Long random string (`openssl rand -hex 48`) |
| `CORS_ORIGINS` | `https://churchconnect.pages.dev` (comma-separated list allowed) |
| `NODE_ENV` | `production` |
| `BCRYPT_ROUNDS` | `4` - free-tier Workers CPU budget; 12 can exceed the 10 ms limit |
| `EMAIL_API_KEY` | Optional - Resend key so MFA codes can actually be emailed |
| `EMAIL_FROM` | Optional - verified sender for code emails |
| `SMS_USERNAME`, `SMS_API_KEY` | Optional - Africa's Talking for SMS MFA |
| `DEEPSEEK_API_KEY` | Optional - AI assistant |

The dashboard exposes **secrets** (encrypted) and **plain-text variables**;
use the secret type for anything sensitive (`DATABASE_URL`, `JWT_SECRET`,
`EMAIL_API_KEY`, `SMS_API_KEY`, `DEEPSEEK_API_KEY`).

CLI alternative (production environment):

```powershell
echo "postgresql://..." | npx wrangler@4 pages secret put DATABASE_URL --project-name churchconnect
```

> Delivery + AI secrets: `DEPLOY-CF.ps1` reads `server/.env` and uploads
> `EMAIL_API_KEY`, `EMAIL_FROM`, `SMS_*` and `DEEPSEEK_API_KEY` automatically on
> every deploy. In production the app fails closed when no email/SMS provider is
> configured, so set `EMAIL_API_KEY` (or SMS) before relying on login; the AI
> assistant needs `DEEPSEEK_API_KEY`.
1. Push this repo to GitHub.
2. Add repository secrets (Settings -> Secrets and variables -> Actions):
   - `CLOUDFLARE_API_TOKEN` - My Profile -> API Tokens -> Create Token ->
     "Edit Cloudflare Workers" template, then add the `Pages:Edit` permission.
   - `CLOUDFLARE_ACCOUNT_ID` - your account ID (dashboard right rail, or
     `npx wrangler whoami`).
3. Push to `main`. `.github/workflows/cloudflare.yml` runs
   `npm ci` (root + server), `npm test`, `npm run build`, then
   `wrangler pages deploy`. If the secrets are missing the job skips cleanly.

## 5. Verify

- API health: https://churchconnect.pages.dev/api/health should return
  `{"status":"ok","db":"up"}`.
- Open the app: https://churchconnect.pages.dev
- Sign in with the seeded admin: `admin@maximummiracle.org` / `grace`.

## 6. Custom domain

Workers & Pages -> churchconnect -> Custom domains -> Add custom domain, then
point DNS at Cloudflare. Update `CORS_ORIGINS` to the custom domain afterwards.

## Local build and preview

```powershell
npm run build                     # writes dist/ (SPA + Pages config)
npx wrangler@4 pages dev dist     # local preview including Functions
```

## Notes and limits

- **Neon driver** - `@neondatabase/serverless` is a drop-in `pg` replacement
  over WebSockets. Neon recommends creating a Pool/Client per request in
  serverless environments; this app uses a shared module-level pool, which is
  fine at demo scale (Workers isolates keep the WebSocket alive between
  requests).
- **Hyperdrive** - for production scale, wrap the Neon connection in a
  Hyperdrive binding in `wrangler.toml` and point `DATABASE_URL` at the
  Hyperdrive connection string to cache connections and avoid cold starts.
- **Rate limiting** - `app.set('trust proxy', 1)` keeps the in-app limiters
  working behind Cloudflare's forwarded IP headers.
- **bcrypt** - keep `BCRYPT_ROUNDS` low (4) on the free tier.
- The existing Vercel/`deploy/` paths are untouched; the Cloudflare deploy runs
  alongside them.

## Troubleshooting

- `/api/health` returns `503` -> `DATABASE_URL` or `DB_DRIVER` is wrong/missing;
  check the Pages environment variables and the Neon connection string.
- Function returns 500 -> open the deployment in the dashboard and read the
  invocation logs (Workers & Pages -> churchconnect -> Logs).
- Deep links 404 -> `dist/_redirects` (`/* /index.html 200`) is written by the
  build script; re-run `npm run build` if it is missing from the deployment.
- `import.meta.url` crash on Workers - `server/src/config.js` guards the
  conversion (see the try/catch there); `.env` loading is skipped on Workers.
