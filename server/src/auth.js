import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db/pool.js';
import { config } from './config.js';

import './bcrypt-random.js';

export const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptRounds);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Roles that are always treated as privileged: MFA is mandatory and they can
// never be self-service disabled. The DB CHECK constraint keeps this in sync.
export const PRIVILEGED_ROLES = ['platform_admin', 'hq_admin', 'branch_admin', 'ministry_leader'];
export const isPrivilegedRole = (role) => PRIVILEGED_ROLES.includes(role);

// Every access token carries the server-side session id (`sid`) so sessions can
// be revoked remotely and audited. `typ` distinguishes access tokens from the
// short-lived mfa/reauth tickets.
export function signToken(user, sessionId) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branch_id,
      churchId: user.church_id || 'ch1',
      name: user.name,
      sid: sessionId,
      typ: 'access',
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

// Turn '12h' / '30m' / '15s' / '7d' / '3600' into milliseconds.
export function parseDuration(value) {
  const m = /^(\d+)([smhd])?$/i.exec(String(value || '').trim());
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = parseInt(m[1], 10);
  const mult = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 24 * 3600 * 1000 };
  return n * (mult[(m[2] || 'h').toLowerCase()] || 3600 * 1000);
}

// ---- Password policy -------------------------------------------------------
// A small blacklist of the most-guessed passwords. Combined with a minimum
// length and a letters+numbers requirement this blocks the obvious brute force
// paths without punishing real users with maze-like rules.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'abc12345', '11111111', 'letmein', 'welcome', 'welcome1',
  'monkey', 'dragon', 'iloveyou', 'admin', 'admin123', 'church', 'church123',
  'grace', 'grace123', 'trustno1', 'sunshine', 'princess', 'football', 'superadmin',
]);

// Returns an error message, or null when the password is acceptable.
export function passwordProblem(password, { minLength = config.passwordMinLength } = {}) {
  const pw = String(password || '');
  if (pw.length < minLength) return `Password must be at least ${minLength} characters`;
  if (pw.length > 72) return 'Password must be 72 characters or fewer';
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) return 'That password is too common - choose something unique';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must include both letters and numbers';
  return null;
}

// ---- Authentication middleware ---------------------------------------------
// Verifies the Bearer token, then re-reads the session + user from the
// database on every request. The role is NEVER trusted from the token alone -
// a revoked session, disabled account or role change takes effect immediately,
// which is exactly the "backend enforces identity" boundary from the design.
export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!claims.sid || claims.typ !== 'access') {
    return res.status(401).json({ error: 'Session no longer valid - please sign in again.' });
  }

  try {
    const { rows: s } = await query(
      'SELECT id, created_at, expires_at, ip, user_agent, mfa_verified_at FROM sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()',
      [claims.sid]
    );
    const session = s[0];
    if (!session) return res.status(401).json({ error: 'Session revoked or expired - please sign in again.' });

    const { rows: u } = await query(
      `SELECT id, email, name, role, branch_id, church_id, phone, mfa_enabled, mfa_required,
              active, must_change_password, totp_secret, recovery_codes, password_changed_at
       FROM users WHERE id = $1`,
      [claims.sub]
    );
    const user = u[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Account is disabled - contact the administrator.' });

    req.user = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      branchId: user.branch_id,
      churchId: user.church_id || 'ch1',
      phone: user.phone,
      mfaEnabled: user.mfa_enabled,
      mfaRequired: user.mfa_required || isPrivilegedRole(user.role),
      mustChangePassword: user.must_change_password,
      hasTotp: Boolean(user.totp_secret),
      recoveryCount: Array.isArray(user.recovery_codes) ? user.recovery_codes.length : 0,
    };
    req.session = {
      id: session.id,
      createdAt: session.created_at,
      mfaVerifiedAt: session.mfa_verified_at,
      ip: session.ip,
    };

    // Touch last_seen_at at most once a minute per session (not write-per-request).
    query(
      `UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`,
      [session.id]
    ).catch(() => {});
    next();
  } catch (e) {
    next(e);
  }
}

// Role gate: allow only the listed roles.
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// Privileged-only gate (super admin / HQ / branch admin / ministry leader).
export const requirePrivileged = requireRole(...PRIVILEGED_ROLES);

// Resolve the church scope for a request. Platform admins may target any
// church via ?church=; everyone else is hard-locked to their own church.
// Returns null to mean "all churches" (platform admin global), or a church id.
export function resolveChurch(req) {
  if (req.user.role === 'platform_admin') {
    const target = req.query.church;
    if (!target || target === 'all') return null;
    return target;
  }
  return req.user.churchId || 'ch1';
}

// Build a church-restricting SQL fragment and append its value to `params`.
// `prefix` lets callers target a joined alias (e.g. 'b.'). Returns '' when the
// caller may see every church (platform admin without a target).
export function churchWhere(req, params, prefix = '') {
  const church = resolveChurch(req);
  if (!church) return '';
  params.push(church);
  return `${prefix}church_id = $${params.length}`;
}

// Resolve the branch scope for a request. HQ/platform admins may target any
// campus via ?branch=; everyone else is hard-locked to their own branch
// server-side. Returns null to mean "all branches" (global), or a branch id.
export function resolveScope(req) {
  const role = req.user.role;
  if (role === 'hq_admin' || role === 'platform_admin') {
    const target = req.query.branch;
    if (!target || target === 'global') return null; // all campuses
    return target;
  }
  return req.user.branchId; // locked to own campus
}
