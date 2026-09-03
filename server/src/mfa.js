// Church 2.0 - real MFA (email/SMS one-time codes).
//
// Codes are generated server-side, stored hashed (sha-256 + per-code salt) in
// the mfa_codes table, and delivered through REAL providers over HTTPS:
//   - Email: Resend (https://resend.com) - EMAIL_API_KEY=re_xxx, EMAIL_FROM.
//            Override the endpoint with EMAIL_API_URL for other Resend-style
//            JSON APIs (Postmark/SendGrid-shaped gateways).
//   - SMS:   Africa's Talking (https://africastalking.com) - SMS_USERNAME,
//            SMS_API_KEY, optional SMS_FROM. Override with SMS_API_URL for a
//            custom JSON gateway.
// If no provider is configured, non-production environments log the code and
// return it as debugCode so the full flow stays testable locally. In
// production, an unconfigured method fails closed (no code is issued to logs).
import crypto from 'node:crypto';
import { sendEmail } from './email.js';

// CSPRNG that runs on Node AND Cloudflare Workers. node:crypto.randomBytes and
// randomInt are not guaranteed on every Workers runtime, so we draw from Web
// Crypto's getRandomValues instead, which exists in both environments.
const webCrypto = globalThis.crypto;

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  webCrypto.getRandomValues(bytes);
  return bytes;
}

// Uniform random integer in [0, max) using rejection sampling so the result is
// unbiased. Supports ranges up to 2^48.
function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0) throw new RangeError('randomInt max must be a positive integer');
  const byteLength = max <= 0x100000000 ? 4 : 6;
  const span = byteLength === 4 ? 0x100000000 : 0x1000000000000; // 2^32 / 2^48
  const limit = Math.floor(span / max) * max;
  const bytes = new Uint8Array(byteLength);
  let v;
  do {
    webCrypto.getRandomValues(bytes);
    v = 0;
    for (let i = 0; i < byteLength; i++) v = v * 256 + bytes[i];
  } while (v >= limit);
  return v % max;
}

function randomHex(byteLength) {
  return Array.from(randomBytes(byteLength), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const CODE_TTL_MS = 10 * 60 * 1000;   // codes expire after 10 minutes
export const MAX_ATTEMPTS = 5;               // failed entries before invalidation

// 6-digit code (000000-999999). Pass the hash of the user's most recent active
// code to guarantee the new one is different from the last (never re-send the
// same code twice in a row). Falls back to a random code if every draw in the
// attempts window collides (astronomically unlikely).
export function generateCode(excludeHash = null, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const code = String(randomInt(1000000)).padStart(6, '0');
    if (!excludeHash || !verifyCodeHash(excludeHash, code)) return code;
  }
  return String(randomInt(1000000)).padStart(6, '0');
}

export function hashCode(code, salt = randomHex(8)) {
  const digest = crypto.createHash('sha256').update(salt + code).digest('hex');
  return `${salt}:${digest}`;
}

export function verifyCodeHash(stored, code) {
  const [salt, digest] = String(stored).split(':');
  if (!salt || !digest) return false;
  const candidate = crypto.createHash('sha256').update(salt + String(code)).digest('hex');
  const a = Buffer.from(digest, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isProd = () => process.env.NODE_ENV === 'production';

// Whether a real delivery path exists for a method. Dev keeps the debugCode
// fallback, so only production hides unconfigured methods. Set MFA_DEV_DEBUG=1
// (dev only) to force the debugCode path even when a provider is configured -
// this keeps local test suites deterministic and offline.
const debugOverride = () => !isProd() && process.env.MFA_DEV_DEBUG === '1';
export function providerConfigured(method) {
  if (debugOverride()) return false;
  if (method === 'email') return Boolean(process.env.EMAIL_API_KEY || process.env.EMAIL_API_URL);
  if (method === 'sms') {
    return Boolean(process.env.SMS_API_URL) || Boolean(process.env.SMS_USERNAME && process.env.SMS_API_KEY);
  }
  return false;
}


// POST JSON with a timeout and strict status checking so a misconfigured
// provider fails loudly instead of silently dropping codes.
async function httpJson(url, { headers = {}, body, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, signal: controller.signal });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`provider responded ${res.status}: ${text.slice(0, 200) || 'no body'}`);
    return { status: res.status, text };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`provider timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Sender/app name shown on delivered MFA messages. Defaults to the product
// brand so recipients instantly recognize the church (e.g. "Church Connect"
// or "Maximum Miracle Centre"). Override with EMAIL_FROM_NAME.
const appName = () => process.env.EMAIL_FROM_NAME || 'Church Connect';

// Email the verification code. The actual provider (Resend/Brevo/SendGrid) is
// handled by email.js - MFA codes and member announcements share the sender.
async function deliverEmail(user, code) {
  const name = appName();
  const subject = `Your ${name} verification code`;
  const text = `Your ${name} verification code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.`;
  const html = `<p>Your ${name} verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you did not request it, you can ignore this email.</p>`;
  await sendEmail({ to: user.email, subject, text, html });
}

// Africa's Talking SMS (form-encoded, apiKey header). Kenya-first provider.
async function deliverSmsAfricasTalking(user, code) {
  const username = process.env.SMS_USERNAME;
  const key = process.env.SMS_API_KEY;
  if (!username || !key) throw new Error('SMS_USERNAME and SMS_API_KEY are required for Africa\u2019s Talking - add them to .env');
  const url = `https://api.africastalking.com/version1/messaging?username=${encodeURIComponent(username)}`;
  const params = new URLSearchParams({
    to: user.phone,
    message: `Your ${appName()} verification code is ${code}. It expires in 10 minutes.`,
  });
  if (process.env.SMS_FROM) params.set('from', process.env.SMS_FROM);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', apiKey: key, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`Africa's Talking responded ${res.status}: ${text.slice(0, 200) || 'no body'}`);
    return { status: res.status, text };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('SMS provider timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Generic custom SMS gateway (JSON {from,to,message}).
async function deliverSmsGeneric(user, code) {
  await httpJson(process.env.SMS_API_URL, {
    headers: process.env.SMS_API_KEY ? { Authorization: `Bearer ${process.env.SMS_API_KEY}` } : {},
    body: JSON.stringify({
      from: process.env.SMS_FROM || 'Church2',
      to: user.phone,
      message: `Your ${appName()} verification code is ${code}. It expires in 10 minutes.`,
    }),
  });
}

// Deliver a code. Resolves { ok, debugCode? }; debugCode is only present in
// non-production when no provider is configured (local testing).
export async function deliverCode(user, method, code) {
  if (method === 'email' && providerConfigured('email')) {
    await deliverEmail(user, code);
    return { ok: true };
  }

  if (method === 'sms' && providerConfigured('sms')) {
    if (process.env.SMS_API_URL && !(process.env.SMS_USERNAME && process.env.SMS_API_KEY)) {
      await deliverSmsGeneric(user, code);
    } else {
      await deliverSmsAfricasTalking(user, code);
    }
    return { ok: true };
  }

  if (isProd()) {
    throw new Error(`${method === 'email' ? 'Email' : 'SMS'} delivery is not configured (set ${method === 'email' ? 'EMAIL_API_KEY' : 'SMS_USERNAME+SMS_API_KEY'} in server/.env or your host environment, then restart)`);
  }

  console.log(`[mfa-dev] ${method.toUpperCase()} code for ${user.email}: ${code}`);
  return { ok: true, debugCode: code };
}

// ============================================================================
// Authenticator app (TOTP, RFC 6238) + single-use recovery codes.
// Zero-dependency: base32 + HMAC-SHA1 via node:crypto.
// ============================================================================

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Fresh random base32 secret for a user's authenticator app.
export function generateTotpSecret(bytes = 20) {
  return base32Encode(randomBytes(bytes));
}

// otpauth:// URI users scan with Google Authenticator / Authy / 1Password.
export function totpUri(secret, account, issuer = 'ChurchConnect') {
  const label = `${issuer}:${account}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// RFC 6238 counter value for a given time window.
function totpAt(secret, timeStepMs = 30000, when = Date.now()) {
  const counter = BigInt(Math.floor(when / timeStepMs));
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 1000000).padStart(6, '0');
}

// Current 6-digit code for a secret at an optional timestamp (tests use this).
export function totpCode(secret, when = Date.now()) {
  return totpAt(secret, 30000, when);
}

// Verify a 6-digit TOTP code within +/-window time steps (default: +/- 30s).
export function verifyTotp(secret, code, window = 1, when = Date.now()) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean) || !secret) return false;
  for (let i = -window; i <= window; i++) {
    if (timingSafeEqualStr(totpAt(secret, 30000, when + i * 30000), clean)) return true;
  }
  return false;
}

// Generate `count` single-use recovery codes (XXXXXX-XXXXXX-XXXXXX).
export function generateRecoveryCodes(count = 10) {
  const group = () => randomInt(0x100000000).toString(36).padStart(6, '0').toUpperCase();
  return Array.from({ length: count }, () => `${group()}-${group()}-${group()}`);
}

// Recovery codes are stored as salted sha-256 hashes; plaintext is shown once.
export const hashRecoveryCode = (code) =>
  crypto.createHash('sha256').update('ccrc:' + String(code).trim().toUpperCase()).digest('hex');

// Returns the matched index, or -1. Callers splice + persist on success.
export function verifyRecoveryCode(storedHashes, code) {
  const target = hashRecoveryCode(code);
  const list = Array.isArray(storedHashes) ? storedHashes : [];
  for (let i = 0; i < list.length; i++) {
    const a = Buffer.from(String(list[i]), 'hex');
    const b = Buffer.from(target, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return i;
  }
  return -1;
}

// Password-reset code email - same shared provider adapter as MFA codes, so
// Resend/Brevo/SendGrid all work here too.
async function deliverResetEmail(user, code) {
  const name = appName();
  const subject = `Reset your ${name} password`;
  const text = `A password reset was requested for your ${name} account. Use this code to choose a new password: ${code}. It expires in 15 minutes. If you did not request it, you can ignore this email.`;
  const html = `<p>A password reset was requested for your ${name} account.</p><p>Use this code to choose a new password: <strong>${code}</strong>.</p><p>It expires in 15 minutes. If you did not request it, you can ignore this email.</p>`;
  await sendEmail({ to: user.email, subject, text, html });
}

// Deliver a reset code. Mirrors deliverCode(): non-production falls back to a
// debugCode so the flow stays testable; production fails closed if unconfigured.
export async function deliverResetCode(user, code) {
  if (providerConfigured('email')) {
    await deliverResetEmail(user, code);
    return { ok: true };
  }
  if (isProd()) {
    throw new Error('Password reset email is not configured (set EMAIL_API_KEY)');
  }
  console.log(`[mfa-dev] RESET code for ${user.email}: ${code}`);
  return { ok: true, debugCode: code };
}

// Methods the signed-in user can actually use right now (email/SMS/TOTP/recovery).
export function availableMethods(user) {
  const methods = [];
  if (providerConfigured('email') || !isProd()) methods.push('email');
  if (user.phone && (providerConfigured('sms') || !isProd())) methods.push('sms');
  if (user.totp_secret) methods.push('totp');
  if (Array.isArray(user.recovery_codes) && user.recovery_codes.length) methods.push('recovery');
  return methods;
}
