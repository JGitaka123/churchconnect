// Church 2.0 - runtime configuration.
//
// apiBase: base URL of the backend API.
//   - Local dev: defaults to the local backend (http://localhost:4000).
//   - Deployed (Cloudflare Pages or any https site): defaults to THIS page's
//     own origin, because the API runs on the same domain
//     (https://your-site.pages.dev/api/...). There is no hardcoded live URL.
//   - Optional runtime override via localStorage 'church2_api_base' in the
//     browser console; a localhost override is ignored unless the page is
//     actually open on localhost.
// The backend serves BOTH the app and the API. If someone opens the old
// http-server port (8080), cross-origin fetch can be blocked by the browser,
// so bounce them to the real app URL (port 4000) automatically.
(function () {
  if (typeof window === 'undefined') return;
  const loc = window.location;
  const isLocalHost = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
  // The backend serves BOTH the app and the API on port 4000. Opening the
  // static file directly (file://), the old http-server port (8080), or any
  // other local port would either run in demo mode or hit cross-origin CORS,
  // so bounce every local access path to the real app URL (port 4000), where
  // the DB-connected API is same-origin.
  if (loc.protocol === 'file:') {
    window.location.replace('http://localhost:4000');
  } else if (loc.protocol === 'http:' && isLocalHost && loc.port !== '4000') {
    window.location.replace(loc.protocol + '//' + loc.hostname + ':4000');
  } else if (
    loc.protocol === 'http:' &&
    loc.port !== '4000' &&
    typeof document !== 'undefined' &&
    document.querySelector &&
    !document.querySelector('meta[name="church-api"][content="same-origin"]')
  ) {
    // LAN IP / phone access on the static server (e.g. 192.168.x.x:8080):
    // bounce to the backend on port 4000, which serves the app and the API
    // same-origin. Deployed pages carry the church-api marker and are skipped.
    window.location.replace(loc.protocol + '//' + loc.hostname + ':4000');
  }
})();

// Same-origin when served by the backend (port 4000); cross-origin fallback
// when the frontend runs standalone on http-server (port 8080).
const API_BASE_DEFAULT = (function () {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  // Opened straight from disk -> point at the local backend so the app never
  // silently falls back to the offline demo data.
  if (window.location.protocol === 'file:') return 'http://localhost:4000';
  // Served by the backend itself -> same-origin (relative) API calls.
  if (window.location.port === '4000') return window.location.origin; // same-origin (truthy)
  // The backend injects a marker into index.html, so same-origin API calls
  // also work when the app is reached on any other host it serves: a LAN IP
  // or an https tunnel (cloudflared/ngrok) on a phone.
  if (typeof document !== 'undefined' && document.querySelector && document.querySelector('meta[name="church-api"][content="same-origin"]')) {
    return window.location.origin;
  }
  // Local http-server on 8080 -> explicit cross-origin base.
  if (window.location.protocol === 'http:' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) return 'http://localhost:4000';
  // Deployed (https) or LAN access -> the API is served on the same origin
  // as this page (Cloudflare Pages worker or the backend). Never point at a
  // visitor's localhost.
  return window.location.origin;
})();

// A saved override that points at localhost must only apply while the page is
// actually open on localhost. On the live site it would send every API call
// to a visitor's own computer, so it is ignored there.
let apiOverride = (typeof localStorage !== 'undefined' && localStorage.getItem('church2_api_base')) || '';
if (apiOverride && typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(apiOverride)) apiOverride = '';
}

window.CHURCH2_CONFIG = {
  apiBase: apiOverride || API_BASE_DEFAULT,
};
