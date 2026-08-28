// Shared sign-in security helpers used by both the SPA auth routes (/api/auth)
// and the documented external API (/api/v1/auth). Keeping the logic in one
// place means lockout, sessions, MFA and audit behavior can never drift
// between the two front doors.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from './db/pool.js';
import { config } from './config.js';
import { signToken, isPrivilegedRole, parseDuration } from './auth.js';
import { verifyCodeHash, verifyTotp, verifyRecoveryCode, MAX_ATTEMPTS } from './mfa.js';

export { isPrivilegedRole };

// Whether the account must complete an MFA step before a token is issued.
export const mfaNeeded = (user) =>
  Boolean(
    user.mfa_enabled ||
    user.mfa_required ||
    isPrivilegedRole(user.role) ||
    user.totp_secret ||
    (Array.isArray(user.recovery_codes) && user.recovery_codes.length)
  );

// Short-lived ticket issued after the password step; exchanged for an access
// token after MFA succeeds. jti lets callers throttle brute-force attempts.
export const mfaTicket = (userId) =>
  jwt.sign({ sub: userId, purpose: 'mfa', jti: crypto.randomBytes(8).toString('hex') }, config.jwtSecret, {
    expiresIn: config.mfaTicketTtl,
  });

// Short-lived token proving the user re-entered their password (sensitive ops).
export const reauthTicket = (userId) =>
  jwt.sign({ sub: userId, purpose: 'reauth' }, config.jwtSecret, { expiresIn: config.reauthTtl });

export const verifyReauthToken = (token, userId) => {
  if (!token) return false;
  try {
    const p = jwt.verify(token, config.jwtSecret);
    return p.purpose === 'reauth' && p.sub === userId;
  } catch {
    return false;
  }
};

export const accountLocked = (user) => Boolean(user.locked_until && new Date(user.locked_until) > new Date());

export const lockRemainingSeconds = (user) =>
  accountLocked(user) ? Math.max(1, Math.ceil((new Date(user.locked_until) - new Date()) / 1000)) : 0;

// On a failed password: increment the counter, and after maxLoginAttempts lock
// the account for lockoutMs. Returns the new state.
export async function recordLoginFailure(user, req) {
  const attempts = (user.login_attempts || 0) + 1;
  if (attempts >= config.maxLoginAttempts) {
    await query(
      `UPDATE users SET login_attempts = 0, locked_until = now() + ($2 || ' seconds')::interval WHERE id = $1`,
      [user.id, Math.floor(config.lockoutMs / 1000)]
    );
    return { locked: true, attempts, retryAfter: Math.floor(config.lockoutMs / 1000) };
  }
  await query('UPDATE users SET login_attempts = $2 WHERE id = $1', [user.id, attempts]);
  return { locked: false, attempts };
}

// On a successful password: reset the counter and record the login.
export async function recordLoginSuccess(userId, req) {
  await query(
    'UPDATE users SET login_attempts = 0, locked_until = NULL, last_login_at = now(), last_login_ip = $2 WHERE id = $1',
    [userId, (req && req.ip) || null]
  );
}

// Create a revocable server-side session for the user. Returns the session id.
export async function createSession(userId, req, { mfaVerified = false } = {}) {
  const id = crypto.randomBytes(24).toString('hex');
  const ttlMs = parseDuration(config.sessionTtl);
  const expiresAt = new Date(Date.now() + ttlMs);
  await query(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent, mfa_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      userId,
      expiresAt,
      (req && req.ip) || null,
      req ? String(req.headers['user-agent'] || '').slice(0, 300) : null,
      mfaVerified ? new Date() : null,
    ]
  );
  return id;
}

// Issue an access token bound to a new session. Returns { token, sessionId }.
export async function issueAccess(user, req, { mfaVerified = false } = {}) {
  const sessionId = await createSession(user.id, req, { mfaVerified });
  return { token: signToken(user, sessionId), sessionId };
}

// Verify an MFA submission (email/SMS code, authenticator app, or a single-use
// recovery code). Returns { ok, method } and consumes one-time credentials.
export async function verifyMfaForUser(user, codeStr) {
  const { rows } = await query(
    'SELECT * FROM mfa_codes WHERE user_id = $1 AND used = false AND expires_at > now() ORDER BY id DESC LIMIT 1',
    [user.id]
  );
  const pending = rows[0];
  if (pending) {
    if (pending.attempts >= MAX_ATTEMPTS) {
      await query('UPDATE mfa_codes SET attempts = attempts + 1 WHERE id = $1', [pending.id]);
    } else if (verifyCodeHash(pending.code_hash, codeStr)) {
      await query('UPDATE mfa_codes SET used = true WHERE id = $1', [pending.id]);
      return { ok: true, method: pending.method };
    } else {
      await query('UPDATE mfa_codes SET attempts = attempts + 1 WHERE id = $1', [pending.id]);
    }
  }

  if (user.totp_secret && verifyTotp(user.totp_secret, codeStr)) {
    return { ok: true, method: 'totp' };
  }

  const idx = verifyRecoveryCode(user.recovery_codes, codeStr);
  if (idx >= 0) {
    const list = Array.isArray(user.recovery_codes) ? [...user.recovery_codes] : [];
    list.splice(idx, 1);
    await query('UPDATE users SET recovery_codes = $1 WHERE id = $2', [list, user.id]);
    return { ok: true, method: 'recovery' };
  }

  return { ok: false };
}

// Append to the immutable audit trail. Never throws (audit failures must not
// break the request that triggered them).
export async function auditLog(userId, action, detail = {}, req = null) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, detail, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        action,
        JSON.stringify(detail),
        (req && req.ip) || null,
        req ? String(req.headers['user-agent'] || '').slice(0, 300) : null,
      ]
    );
  } catch (e) {
    console.error('audit write failed:', e.message);
  }
}
