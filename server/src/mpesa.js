// Safaricom Daraja - M-Pesa STK Push (Lipa Na M-Pesa Online) client.
//
// Every credential is read from the environment (server/.env, which is
// gitignored - never commit real keys). The browser NEVER sees these values:
// it only asks this server to push an STK prompt to a phone.
//
// Env vars (see server/.env.example):
//   MPESA_ENV             sandbox | production        (default: sandbox)
//   MPESA_CONSUMER_KEY    Daraja app consumer key
//   MPESA_CONSUMER_SECRET Daraja app consumer secret
//   MPESA_SHORTCODE       PayBill/Till number        (sandbox demo: 174379)
//   MPESA_PASSKEY         Lipa Na M-Pesa passkey for the shortcode
//   MPESA_CALLBACK_URL    Public HTTPS URL that receives the payment result
//   MPESA_ACCOUNT_REF     Default PayBill account name shown on the prompt
//
// Plain ESM + fetch only, so it runs in the local Express server and on
// Cloudflare Workers (both provide a global fetch).

const ENV = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
const API_BASE = ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

const consumerKey = process.env.MPESA_CONSUMER_KEY || '';
const consumerSecret = process.env.MPESA_CONSUMER_SECRET || '';
const shortCode = process.env.MPESA_SHORTCODE || '';
const passKey = process.env.MPESA_PASSKEY || '';

export function mpesaEnv() { return ENV; }

// True only when every credential needed to call Daraja is present.
export function mpesaConfigured() {
  return Boolean(
    consumerKey && consumerSecret && shortCode && passKey &&
    String(process.env.MPESA_CALLBACK_URL || '').trim()
  );
}

const base64 = (value) =>
  typeof Buffer !== 'undefined'
    ? Buffer.from(String(value), 'utf8').toString('base64')
    : btoa(unescape(encodeURIComponent(String(value))));

function pad2(n) { return String(n).padStart(2, '0'); }

// YYYYMMDDHHmmss - Daraja's timestamp format.
export function mpesaTimestamp(date = new Date()) {
  return '' + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) +
    pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds());
}

// STK password = base64(Shortcode + Passkey + Timestamp).
export function mpesaPassword(timestamp) {
  return base64(`${shortCode}${passKey}${timestamp}`);
}

// Accepts 0712 345 678, +254712345678, 254712345678 and returns 2547XXXXXXXX
// (12 digits). Returns null when the number cannot be a Kenyan mobile number.
export function normalizePhone(input) {
  let p = String(input || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  else if (/^[17]\d{8}$/.test(p)) p = '254' + p;
  return /^254[17]\d{8}$/.test(p) ? p : null;
}

// Short-lived OAuth bearer token for Daraja (cached until near expiry).
let tokenCache = null;
async function oauthToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const auth = 'Basic ' + base64(`${consumerKey}:${consumerSecret}`);
  const res = await fetch(`${API_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: auth },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(
      data.errorDescription || data.errorMessage || `M-Pesa OAuth failed (${res.status})`
    );
    err.code = 'MPESA_OAUTH_FAILED';
    err.detail = data;
    throw err;
  }
  const expiresInSec = Math.max(60, Number(data.expires_in) || 3599);
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (expiresInSec - 60) * 1000,
  };
  return tokenCache.token;
}

// Send an STK push to `phone`. Resolves with Daraja's response
// ({ MerchantRequestID, CheckoutRequestID, ResponseDescription }).
export async function stkPush({ phone, amount, accountRef, description = 'Church giving' }) {
  if (!mpesaConfigured()) {
    const err = new Error(
      'M-Pesa is not configured yet - add the MPESA_* variables to server/.env (see server/.env.example).'
    );
    err.code = 'MPESA_NOT_CONFIGURED';
    throw err;
  }
  const token = await oauthToken();
  const timestamp = mpesaTimestamp();
  const amountInt = Math.round(Number(amount));
  const payload = {
    BusinessShortCode: shortCode,
    Password: mpesaPassword(timestamp),
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: String(amountInt),
    PartyA: phone,
    PartyB: shortCode,
    PhoneNumber: phone,
    CallBackURL: String(process.env.MPESA_CALLBACK_URL || '').trim(),
    AccountReference: String(accountRef || process.env.MPESA_ACCOUNT_REF || 'CHURCH').slice(0, 12),
    TransactionDesc: String(description).slice(0, 13),
  };
  const res = await fetch(`${API_BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || String(data.ResponseCode) !== '0') {
    const err = new Error(
      data.errorMessage || data.ResponseDescription || `STK push failed (${res.status})`
    );
    err.code = data.errorCode || 'MPESA_STK_FAILED';
    err.detail = data;
    throw err;
  }
  return data;
}