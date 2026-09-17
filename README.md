# Church Connect (Maximum Miracle Centre)

One platform, two experiences - one shared backend and database, so everything a
member does in the app is instantly visible to staff in the console.

| Audience | Product | Entry point |
| :--- | :--- | :--- |
| Members | **Church Connect** - installable mobile app (PWA). Home, sermons, scripture, giving, groups, serve, prayer and their giving history. | `member.html` |
| Staff / admins | **Ministry Console** - web app for HQ, campus and ministry leaders. Dashboard, member database, giving, attendance, groups, rotas, follow-ups and communications. | `index.html` |

## Member app vs console

- `member.html` is the member entry. It is an installable PWA named **Church
  Connect** (see `member-manifest.json`). Only `member` accounts can sign in
  there - staff are shown a notice and pointed to the console.
- `index.html` is the staff web console. Members who open it still only ever see
  the Church Connect mobile experience, never admin panels (role-based).
- `member.html` is generated from `index.html` by `scripts/build-cf.mjs` on
  deploy so the two never drift. Do not hand-edit `member.html`.
- Data syncs automatically: RSVPs, group join/leave, giving, pledges, prayer
  requests, serve sign-ups and announcement suggestions all go through the same
  API into Postgres, and appear in the console for staff.

## Members: install the app

1. Open the member link on a phone (`/member.html`).
2. Sign in (or create an account - new accounts are members).
3. Tap **Install Church Connect** on the Home tab (Android), or on iPhone/iPad
   use Share -> Add to Home Screen.

## Demo accounts (password is `grace` for all)

| Role | Email |
| :--- | :--- |
| HQ admin | `admin@maximummiracle.org` |
| Campus admin | `kawangware@maximummiracle.org` |
| Ministry leader | `worship@maximummiracle.org` |
| Member | `john@maximummiracle.org` |

## Local run

Everything runs from this `Church/` folder, and there is only **one** server:
it serves the app **and** the API on port 4000.

| Command | What it does |
| :--- | :--- |
| `npm start` | Starts the server - frontend and backend together - on `http://localhost:4000`. Frees port 4000 first if an older copy is still running. |
| `npm run backend` | Same as `npm start`. |
| `npm run dev` | Server in watch mode, for editing server code. |
| `START-CLEAN.bat` | Double-click: stops anything on port 4000, then starts the server. |
| `START-APP.bat` | Double-click: starts the server and opens the app in the browser. |

There is no separate frontend process to start. The frontend is static files
(`index.html`, `app.js`, `styles.css`, `js/`) served by that same server, and
`js/config.js` redirects any other local port to 4000 so API calls stay
same-origin. The staff console is `/`, the member app is `/member.html`.

- Requires the Postgres/Neon database configured under `server/.env`
  (see `server/.env.example`).

## Deploy

- Cloudflare Pages: `npm run build` then deploy `dist/` (GitHub Actions does
  this automatically from `main`). The build regenerates `member.html` from
  `index.html`.
