import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, signToken, authenticate, passwordProblem } from '../auth.js';
import {
  mfaNeeded, mfaTicket, reauthTicket, verifyReauthToken, accountLocked, lockRemainingSeconds,
  recordLoginFailure, recordLoginSuccess, issueAccess, verifyMfaForUser, auditLog, isPrivilegedRole,
} from '../security.js';
import { genId } from './util.js';
import {
  generateCode, hashCode, verifyCodeHash, deliverCode, deliverResetCode, availableMethods,
  generateRecoveryCodes, hashRecoveryCode, generateTotpSecret, totpUri, verifyTotp,
} from '../mfa.js';

import '../bcrypt-random.js';

const router = Router();

// Precomputed dummy hash used when the email is unknown, so a failed login
// burns a bcrypt comparison and response timing doesn't reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 6);

const publicUser = (u, churchName) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, branchId: u.branch_id,
  churchId: u.church_id || 'ch1',
  mfaEnabled: u.mfa_enabled, mfaRequired: u.mfa_required || isPrivilegedRole(u.role),
  hasTotp: Boolean(u.totp_secret), hasRecoveryCodes: (u.recovery_codes || []).length > 0,
  ...(churchName ? { churchName } : {}),
});

async function getChurchName(churchId) {
  const { rows } = await query('SELECT name FROM churches WHERE id = $1', [churchId || 'ch1']);
  return rows[0]?.name || null;
}

// Re-authentication for sensitive operations: accepts the current password, or
// a fresh /auth/reauthenticate token.
async function verifiedSensitive(req, userId) {
  const { password, reauthToken } = req.body || {};
  if (verifyReauthToken(reauthToken, userId)) return true;
  if (!password) return false;
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  return Boolean(rows[0] && (await verifyPassword(password, rows[0].password_hash)));
}

// ---- Step 1: credentials ----------------------------------------------------
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const { rows } = await query(
      `SELECT id, email, name, role, branch_id, church_id, phone, mfa_enabled, mfa_required,
              password_hash, login_attempts, locked_until, active, totp_secret, recovery_codes
       FROM users WHERE email = $1`,
      [String(email).toLowerCase()]
    );
    const user = rows[0];
    const fail = () => res.status(401).json({ error: 'Invalid email or password' });

    if (!user) {
      await verifyPassword(password, DUMMY_HASH); // constant-ish timing
      return fail();
    }
    if (!user.active) return fail();

    if (accountLocked(user)) {
      return res.status(423).json({
        error: 'Too many failed attempts. Please wait before trying again.',
        locked: true, retryAfter: lockRemainingSeconds(user),
      });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const outcome = await recordLoginFailure(user, req);
      await auditLog(user.id, 'login_failed', { attempts: outcome.attempts }, req);
      if (outcome.locked) {
        return res.status(423).json({
          error: 'Too many failed attempts. Account temporarily locked.',
          locked: true, retryAfter: outcome.retryAfter,
        });
      }
      return fail();
    }

    await recordLoginSuccess(user.id, req);
    await auditLog(user.id, 'login_success', { stage: 'credentials', mfaRequired: mfaNeeded(user) }, req);

    if (mfaNeeded(user)) {
      return res.json({ mfaRequired: true, ticket: mfaTicket(user.id), methods: availableMethods(user), user: publicUser(user) });
    }

    const { token, sessionId } = await issueAccess(user, req);
    await auditLog(user.id, 'login_success', { stage: 'complete', sessionId }, req);
    const churchName = await getChurchName(user.church_id);
    return res.json({ token, user: publicUser(user, churchName) });
  } catch (e) {
    next(e);
  }
});

// ---- Step 2a: request an emailed/texted one-time code ------------------------
router.post('/mfa/request', async (req, res, next) => {
  try {
    const { ticket, method = 'email' } = req.body || {};
    if (!ticket) return res.status(400).json({ error: 'Ticket is required' });
    if (!['email', 'sms'].includes(method)) return res.status(400).json({ error: 'Method must be email or sms' });

    let payload;
    try {
      payload = jwt.verify(ticket, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Verification session expired - please sign in again.' });
    }
    if (payload.purpose !== 'mfa') return res.status(400).json({ error: 'Invalid ticket' });

    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Account not found or disabled' });
    if (method === 'sms' && !user.phone) return res.status(400).json({ error: 'No phone number on file - use email' });

    const { rows: last } = await query(
      'SELECT code_hash FROM mfa_codes WHERE user_id = $1 AND method = $2 AND used = false AND expires_at > now() ORDER BY id DESC LIMIT 1',
      [user.id, method]
    );
    const code = generateCode(last[0] && last[0].code_hash);
    await query(
      `INSERT INTO mfa_codes (user_id, method, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')`,
      [user.id, method, hashCode(code)]
    );
    // Keep only the newest pending code for this user+method.
    await query(
      `DELETE FROM mfa_codes WHERE user_id = $1 AND method = $2 AND used = false AND id < (SELECT max(id) FROM mfa_codes WHERE user_id = $1 AND method = $2)`,
      [user.id, method]
    );

    let delivered;
    try {
      delivered = await deliverCode(user, method, code);
    } catch (e) {
      console.error('MFA delivery failed:', e.message);
      const detail = config.env === 'production' ? undefined : e.message;
      return res.status(502).json({ error: 'Could not send the code. Check the email/SMS provider settings or try another method.', ...(detail ? { detail } : {}) });
    }
    await auditLog(user.id, 'mfa_code_sent', { method }, req);
    return res.json({ ok: true, ...(delivered.debugCode !== undefined ? { debugCode: delivered.debugCode } : {}) });
  } catch (e) {
    next(e);
  }
});

// ---- Step 2b: verify MFA and issue the access token --------------------------
// Accepts an emailed/texted code, an authenticator-app (TOTP) code, or a
// single-use recovery code. Wrong codes consume attempts; recovery codes are
// consumed on success only.
router.post('/mfa', async (req, res, next) => {
  try {
    const { ticket, code } = req.body || {};
    if (!ticket || !code) return res.status(400).json({ error: 'Ticket and code are required' });

    let payload;
    try {
      payload = jwt.verify(ticket, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Verification session expired - please sign in again.' });
    }
    if (payload.purpose !== 'mfa') return res.status(400).json({ error: 'Invalid ticket' });

    const { rows } = await query(
      `SELECT id, email, name, role, branch_id, church_id, phone, mfa_enabled, mfa_required,
              totp_secret, recovery_codes, active
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Account not found or disabled' });

    const verified = await verifyMfaForUser(user, String(code).trim());
    if (!verified.ok) {
      await auditLog(user.id, 'mfa_failed', {}, req);
      return res.status(401).json({ error: 'Incorrect code' });
    }

    const { token, sessionId } = await issueAccess(user, req, { mfaVerified: true });
    await auditLog(user.id, 'mfa_success', { method: verified.method, sessionId }, req);
    const churchName = await getChurchName(user.church_id);
    return res.json({ token, user: publicUser(user, churchName) });
  } catch (e) {
    next(e);
  }
});

// ---- Session management -----------------------------------------------------
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [req.session.id]);
    await auditLog(req.user.sub, 'logout', { sessionId: req.session.id }, req);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    const { rowCount } = await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.sub]);
    await auditLog(req.user.sub, 'logout_all', { revoked: rowCount }, req);
    res.json({ ok: true, revoked: rowCount });
  } catch (e) { next(e); }
});

router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, created_at, expires_at, ip, user_agent, last_seen_at, mfa_verified_at
       FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.sub]
    );
    res.json({ sessions: rows.map((s) => ({ ...s, current: s.id === req.session.id })) });
  } catch (e) { next(e); }
});

router.post('/sessions/:id/revoke', authenticate, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [req.params.id, req.user.sub]
    );
    if (!rowCount) return res.status(404).json({ error: 'Session not found' });
    await auditLog(req.user.sub, 'session_revoked', { sessionId: req.params.id, current: req.params.id === req.session.id }, req);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Password ----------------------------------------------------------------
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
    const problem = passwordProblem(newPassword);
    if (problem) return res.status(400).json({ error: problem });

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
    const ok = rows[0] && (await verifyPassword(currentPassword, rows[0].password_hash));
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    if (currentPassword === newPassword) return res.status(400).json({ error: 'New password must be different from the current one' });

    const hash = await hashPassword(newPassword);
    // Revoke every other session so a stolen device can't stay signed in.
    const { rowCount } = await query(
      'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
      [req.user.sub, req.session.id]
    );
    await query(
      'UPDATE users SET password_hash = $1, password_changed_at = now(), must_change_password = false WHERE id = $2',
      [hash, req.user.sub]
    );
    await auditLog(req.user.sub, 'password_changed', { otherSessionsRevoked: rowCount }, req);
    res.json({ ok: true, otherSessionsRevoked: rowCount });
  } catch (e) { next(e); }
});

// Proves the user knows their password; the resulting token unlocks sensitive
// operations (recovery codes, TOTP changes) without re-typing the password.
router.post('/reauthenticate', authenticate, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password is required' });
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
    const ok = rows[0] && (await verifyPassword(password, rows[0].password_hash));
    if (!ok) return res.status(401).json({ error: 'Password is incorrect' });
    await auditLog(req.user.sub, 'reauthenticated', {}, req);
    res.json({ reauthToken: reauthTicket(req.user.sub) });
  } catch (e) { next(e); }
});

// ---- Authenticator app (TOTP) -------------------------------------------------
router.post('/totp/setup', authenticate, async (req, res, next) => {
  try {
    if (req.user.hasTotp) return res.status(400).json({ error: 'Authenticator is already enabled' });
    const secret = generateTotpSecret();
    await query('UPDATE users SET totp_secret_pending = $1 WHERE id = $2', [secret, req.user.sub]);
    const uri = totpUri(secret, req.user.email, config.mfaIssuer);
    await auditLog(req.user.sub, 'totp_setup_started', {}, req);
    res.json({ secret, uri });
  } catch (e) { next(e); }
});

router.post('/totp/verify', authenticate, async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Code is required' });
    const { rows } = await query('SELECT totp_secret_pending, totp_secret FROM users WHERE id = $1', [req.user.sub]);
    const pending = rows[0] && (rows[0].totp_secret_pending || rows[0].totp_secret);
    if (!pending) return res.status(400).json({ error: 'Start authenticator setup first' });
    if (!verifyTotp(pending, String(code).trim())) return res.status(401).json({ error: 'Incorrect code - check the time on your phone' });
    await query('UPDATE users SET totp_secret = $1, totp_secret_pending = NULL, mfa_enabled = true WHERE id = $2', [pending, req.user.sub]);
    await auditLog(req.user.sub, 'totp_enabled', {}, req);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/totp/disable', authenticate, async (req, res, next) => {
  try {
    if (!req.user.hasTotp) return res.status(400).json({ error: 'Authenticator is not enabled' });
    if (req.user.mfaRequired || isPrivilegedRole(req.user.role)) {
      return res.status(403).json({ error: 'MFA is required for this account and cannot be disabled.' });
    }
    if (!(await verifiedSensitive(req, req.user.sub))) return res.status(401).json({ error: 'Re-enter your password to confirm' });
    await query('UPDATE users SET totp_secret = NULL, totp_secret_pending = NULL WHERE id = $1', [req.user.sub]);
    await auditLog(req.user.sub, 'totp_disabled', {}, req);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Recovery codes ------------------------------------------------------------
// Generate 10 fresh single-use codes. Plaintext is returned exactly once and
// stored hashed; generating again invalidates the old set.
router.post('/recovery-codes', authenticate, async (req, res, next) => {
  try {
    if (!(await verifiedSensitive(req, req.user.sub))) return res.status(401).json({ error: 'Re-enter your password to confirm' });
    const codes = generateRecoveryCodes(10);
    await query('UPDATE users SET recovery_codes = $1 WHERE id = $2', [codes.map(hashRecoveryCode), req.user.sub]);
    await auditLog(req.user.sub, 'recovery_codes_generated', { count: codes.length }, req);
    res.json({ codes });
  } catch (e) { next(e); }
});

// ---- Existing MFA settings toggle (members only; privileged MFA is mandatory) --
router.post('/mfa/settings', authenticate, async (req, res, next) => {
  try {
    const { enabled, phone } = req.body || {};
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    if (!enabled && (req.user.mfaRequired || isPrivilegedRole(req.user.role))) {
      return res.status(403).json({ error: 'MFA is required for this account and cannot be turned off.' });
    }

    let sql;
    let params;
    if (typeof phone === 'string') {
      const p = phone.trim();
      if (!p) return res.status(400).json({ error: 'Phone cannot be empty' });
      sql = 'UPDATE users SET phone = $1, mfa_enabled = $2 WHERE id = $3';
      params = [p, enabled, req.user.sub];
    } else {
      sql = 'UPDATE users SET mfa_enabled = $1 WHERE id = $2';
      params = [enabled, req.user.sub];
    }
    await query(sql, params);

    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.sub]);
    const user = rows[0];
    const methods = availableMethods(user);
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, branchId: user.branch_id, churchId: user.church_id || 'ch1', mfaEnabled: user.mfa_enabled, phone: user.phone, methods },
    });
  } catch (e) {
    next(e);
  }
});

// ---- Forgot / reset password (enumeration-safe) --------------------------------
// Always answers ok whether or not the email exists; a real reset code is only
// issued to existing accounts.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const mail = String(email).trim().toLowerCase();

    const { rows } = await query('SELECT id FROM users WHERE email = $1', [mail]);
    const user = rows[0];
    if (user) {
      const code = generateCode();
      await query(
        `INSERT INTO mfa_codes (user_id, method, code_hash, expires_at) VALUES ($1, 'reset', $2, now() + interval '15 minutes')`,
        [user.id, hashCode(code)]
      );
      let delivered;
      try {
        delivered = await deliverResetCode({ email: mail }, code);
      } catch (e) {
        console.error('Reset delivery failed:', e.message);
      }
      await auditLog(user.id, 'password_reset_requested', {}, req);
      if (delivered && delivered.debugCode !== undefined && config.env !== 'production') {
        return res.json({ ok: true, debugCode: delivered.debugCode });
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, code, password } = req.body || {};
    if (!email || !code || !password) return res.status(400).json({ error: 'Email, code and new password are required' });
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });
    const mail = String(email).trim().toLowerCase();

    const { rows: u } = await query('SELECT id FROM users WHERE email = $1', [mail]);
    const user = u[0];
    if (!user) return res.status(401).json({ error: 'Invalid or expired reset code' });

    const { rows: r } = await query(
      `SELECT * FROM mfa_codes WHERE user_id = $1 AND method = 'reset' AND used = false AND expires_at > now() ORDER BY id DESC LIMIT 1`,
      [user.id]
    );
    const reset = r[0];
    if (!reset || !verifyCodeHash(reset.code_hash, String(code).trim())) {
      if (reset) await query('UPDATE mfa_codes SET attempts = attempts + 1 WHERE id = $1', [reset.id]);
      return res.status(401).json({ error: 'Invalid or expired reset code' });
    }

    const hash = await hashPassword(String(password));
    await query('UPDATE mfa_codes SET used = true WHERE id = $1', [reset.id]);
    // A compromised account must re-authenticate on every device.
    const { rowCount } = await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
    await query(
      `UPDATE users SET password_hash = $1, password_changed_at = now(), must_change_password = false,
              login_attempts = 0, locked_until = NULL WHERE id = $2`,
      [hash, user.id]
    );
    await auditLog(user.id, 'password_reset', { sessionsRevoked: rowCount }, req);
    res.json({ ok: true, sessionsRevoked: rowCount });
  } catch (e) {
    next(e);
  }
});

// ---- Current user --------------------------------------------------------------
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const churchName = await getChurchName(req.user.churchId);
    res.json({
      user: {
        id: req.user.sub, email: req.user.email, name: req.user.name, role: req.user.role,
        branchId: req.user.branchId, churchId: req.user.churchId || 'ch1', churchName,
        mfaEnabled: req.user.mfaEnabled, mfaRequired: req.user.mfaRequired,
        hasTotp: req.user.hasTotp, recoveryCount: req.user.recoveryCount,
        mustChangePassword: req.user.mustChangePassword,
        session: { id: req.session.id, mfaVerifiedAt: req.session.mfaVerifiedAt },
      },
    });
  } catch (e) {
    next(e);
  }
});

// Public branch list for the registration form (campus picker).
router.get('/branches', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.id, b.name, b.location, b.code, b.church_id, c.name AS church_name
       FROM branches b JOIN churches c ON c.id = b.church_id ORDER BY c.name, b.name`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Self-service registration. Creates a member account (role 'member', MFA off)
// plus a matching directory record, in one transaction. Privileged roles are
// never assignable here - they are created by administrators only.
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, branchId, phone } = req.body || {};
    const bad = (msg) => res.status(400).json({ error: msg });
    const fullName = String(name || '').trim();
    const mail = String(email || '').trim().toLowerCase();
    if (!fullName) return bad('Full name is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return bad('A valid email is required');
    const problem = passwordProblem(password);
    if (problem) return bad(problem);
    if (!branchId) return bad('A campus (branchId) is required');

    const { rows: b } = await query('SELECT id, church_id FROM branches WHERE id = $1', [branchId]);
    if (!b[0]) return bad('Unknown campus - pick a branch from the list');
    const churchId = b[0].church_id || 'ch1';

    const hash = await hashPassword(String(password));
    const parts = fullName.split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ') || firstName;

    const tokenUser = await withTransaction(async (client) => {
      const { rows: u } = await client.query(
        `INSERT INTO users (email, password_hash, name, role, branch_id, church_id, mfa_enabled)
         VALUES ($1, $2, $3, 'member', $4, $5, false) RETURNING id`,
        [mail, hash, fullName, branchId, churchId]
      );
      await client.query(
        `INSERT INTO members (id, branch_id, church_id, first_name, last_name, email, engagement_score)
         VALUES ($1, $2, $3, $4, $5, $6, 60)`,
        [genId('m'), branchId, churchId, firstName, lastName, mail]
      );
      return { id: u[0].id, email: mail, name: fullName, role: 'member', branch_id: branchId, church_id: churchId, mfa_enabled: false };
    });

    const { token, sessionId } = await issueAccess(tokenUser, req);
    await auditLog(tokenUser.id, 'register', { sessionId }, req);
    const churchName = await getChurchName(churchId);
    return res.status(201).json({ token, user: publicUser(tokenUser, churchName) });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'An account with that email already exists' });
    next(e);
  }
});
export default router;
