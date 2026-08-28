# Maximum Miracle Centre - Production Deployment Runbook

This deploys the platform across your two resources:

- **Vercel** -> the static frontend (repo root: `index.html`, `app.js`, `styles.css`, `js/`, `vendor/`, `icons/`, `icon.svg`, `manifest.json`, `sw.js`).
- **Contabo VPS** -> the API (`server/`) + PostgreSQL + nginx (TLS), via Docker Compose in `deploy/`.

```
Browser --> Vercel (static SPA) --HTTPS--> Contabo nginx --> API container --> Postgres
```

The frontend also runs **standalone** (localStorage demo) when no API is configured - so a Vercel deploy works immediately, and you "light up" the backend by pointing it at your API URL.

> Architecture note: the API enforces auth + RBAC + campus scoping **server-side** (a branch admin cannot read another campus even by tampering with requests). Secrets come only from environment variables; nothing sensitive is committed.

---

## Prerequisites

- A domain you control, with two DNS records:
  - `app.yourchurch.org` (or an apex) -> managed by Vercel (frontend)
  - `api.yourchurch.org` -> **A record -> your Contabo VPS IP** (backend)
- Contabo VPS (Ubuntu 22.04/24.04) with Docker + Docker Compose installed:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- The Vercel CLI locally (`npm i -g vercel`) or the Vercel dashboard.

---

## Part A - Backend on Contabo

1. **Copy the repo to the VPS** (git clone, or scp the `server/` and `deploy/` folders).

2. **Configure secrets**:
   ```bash
   cd deploy
   cp .env.example .env
   # Edit .env:
   #   PGPASSWORD   - a strong DB password
   #   JWT_SECRET   - openssl rand -hex 48
   #   CORS_ORIGINS - your Vercel URL, e.g. https://app.yourchurch.org
   ```

3. **Point nginx at your API domain**: edit `deploy/nginx/conf.d/church2-api.conf` and replace every `api.yourchurch.org` with your real API subdomain.

4. **Obtain the TLS certificate** (one-time). First bring up nginx on port 80 so certbot can answer the ACME challenge:
   ```bash
   mkdir -p certbot/www certbot/conf
   docker compose up -d nginx
   docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
     -d api.yourchurch.org --email you@yourchurch.org --agree-tos --no-eff-email
   docker compose restart nginx
   ```

5. **Start the stack**:
   ```bash
   docker compose up -d --build
   ```
   The API container runs migrations automatically on start.

6. **Seed the initial data** (first time only - creates the demo login accounts and sample data):
   ```bash
   docker compose exec api node src/db/seed.js
   ```
   > For a real launch, create your own admin instead of seeding demo data, and set a strong `SEED_PASSWORD` or change passwords immediately after.

7. **Verify**:
   ```bash
   curl https://api.yourchurch.org/api/health          # {"status":"ok","db":"up"}
   ```

Certbot auto-renews certificates every 12h; nginx picks up renewed certs on reload.

---

## Part B - Frontend on Vercel

1. From the repo root:
   ```bash
   vercel            # first run: link the project
   vercel --prod     # deploy to production
   ```
   (Or import the GitHub repo in the Vercel dashboard - `vercel.json` and `.vercelignore` are already configured to publish the root as a static site and exclude `server/`/`deploy/`.)

2. **Connect the frontend to the API.** Set the API base URL in `js/config.js`:
   ```js
   window.CHURCH2_CONFIG = { apiBase: "https://api.yourchurch.org" };
   ```
   Commit + redeploy. (For a quick test without editing the file, open the app and run
   `localStorage.setItem('church2_api_base','https://api.yourchurch.org')` in the console, then reload.)

3. **Lock CORS down**: ensure `CORS_ORIGINS` in the Contabo `.env` is exactly your Vercel production URL, then `docker compose up -d` to apply.

---

## Verify the whole path

Open the Vercel URL and sign in (`admin@maximummiracle.org` / seeded password, MFA code `123456`).
You should see real data served from Postgres on Contabo. A wrong password is rejected by the server; a branch admin only ever sees their own campus.

---

## Security checklist before real launch

- [ ] Replace the seeded demo accounts with real staff accounts; rotate all passwords.
- [ ] Swap the mock MFA (`MFA_DEMO_CODE`) for real TOTP (the `/auth/mfa` step is structured for this).
- [ ] Strong, unique `JWT_SECRET` and `PGPASSWORD` (never commit `.env`).
- [ ] `CORS_ORIGINS` restricted to your exact frontend origin (no `*`).
- [ ] Enable automated Postgres backups (e.g. `pg_dump` cron to Contabo object storage).
- [ ] Add real payment processing (Stripe/Tithe.ly) for live giving - currently receipts are recorded, not charged.

---

## What's wired vs. remaining

**Done & verified:** real auth (bcrypt + JWT + MFA step), RBAC + server-side campus scoping, and REST endpoints for members, transactions/giving, attendance, dashboard summary, groups, follow-ups, announcements, prayer requests, events, campaigns, recurring-gift schedules, and volunteer rosters. When an `apiBase` is configured the whole UI is **backend-backed**: on login the app hydrates `this.db` from Postgres (so every view renders shared, real data), and every mutation - recording a gift, marking attendance, enrolling a member, moving a follow-up, creating/joining a group, sending a broadcast, submitting/dismissing a prayer request, creating a recurring gift, updating a volunteer roster, and syncing member skills/engagement - is mirrored to the API and persisted. Writes are optimistic (the UI updates instantly) and reconcile the server-assigned id; a failed sync surfaces a toast rather than silently dropping. With no `apiBase` set the same code runs standalone against localStorage (demo mode). All paths were verified end-to-end against a live Postgres, including that a branch admin cannot read or write outside their own campus even by tampering with `?branch=`.

**Remaining increment:** add live payment processing so giving is charged, not just recorded. For this client that means an **M-Pesa Daraja** integration (STK push + C2B confirmation callback) against the church's own paybill, with a card fallback. A few client-only conveniences without server endpoints yet - scripture reading streaks - remain local until matching endpoints are added; everything else is backend-backed.

---

## Client configuration (Maximum Miracle Centre)

Everything client-specific lives in **two places**, by design:

| What | Where |
|---|---|
| Church name, tagline, website, currency, campuses, ministries, service times, M-Pesa paybill, card fee rates | `js/brand.js` |
| Brand palette (`--mmc-royal`, `--mmc-royal-light`, `--mmc-gold`, `--mmc-gold-deep`) | top of `styles.css` `:root` |

To rebrand for another church, change those two files - no other file hardcodes the client's identity, colours or currency. The palette hex values are mirrored in `js/brand.js` under `palette` so charts (canvas-drawn, can't read CSS) stay in sync.

### Before go-live, confirm with the church

- [ ] **M-Pesa paybill / account number.** `js/brand.js` ships `paybill: '891300'` with `shortCodeConfirmed: false` - a placeholder. Replace it with the church's real short code and flip the flag.
- [ ] **Exact brand hex codes** and a vector logo, if the church's designer has them. The current royal-and-gold palette was set from public brand material.
- [ ] **Campus addresses and service times** in `js/brand.js` (`campuses`, `services`).
- [ ] **Real staff accounts** - the seeded `@maximummiracle.org` demo logins are for the demo only.
