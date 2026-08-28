// Auth-security test suite for the hardened sign-in layer:
//   - account lockout (brute force protection)
//   - revocable sessions + logout / logout-all / session listing
//   - password change with cross-session revocation
//   - re-authentication for sensitive operations
//   - single-use recovery codes
//   - authenticator-app (TOTP) MFA
//   - mandatory MFA for privileged roles
//   - forgot / reset password
//   - legacy (sid-less) tokens rejected
// Run with:  MFA_DEV_DEBUG=1 node .auth-security-test.mjs
import express from 'express';
import jwt from 'jsonwebtoken';
import authRoutes from './src/routes/auth.js';
import { config } from './src/config.js';
import { pool } from './src/db/pool.js';
import { totpCode } from './src/mfa.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('HANDLER ERROR:', err.stack || err.message);
  res.status(err.status || 500).json({ error: err.publicMessage || err.message });
});

function run(req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, body: undefined,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve({ status: this.statusCode, body: b }); return this; },
      set() { return this; }, setHeader() { return this; }, getHeader() { return undefined; },
      removeHeader() { return this; }, end() { return this; }, type() { return this; },
    };
    const reqObj = {
      method: req.method, url: req.url, headers: req.headers || {}, body: req.body || {}, query: req.query || {},
      protocol: 'http', get: (h) => (h === 'host' ? 'localhost:4000' : undefined),
      connection: { encrypted: false }, socket: { encrypted: false },
    };
    app.handle(reqObj, res, () => resolve({ status: res.statusCode, body: res.body }));
  });
}

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS | ' + name + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL | ' + name + (extra ? ' | ' + extra : '')); }
};
const auth = (token) => ({ authorization: 'Bearer ' + token });
const uniq = 'sec' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const emailA = uniq + '-a@test.org';
const emailB = uniq + '-b@test.org';
const pwA = 'SecurePass!123';
const pwB = 'SecurePass!456';

// ---- create two fresh member accounts (MFA off) -----------------------------
let r = await run({ method: 'POST', url: '/api/auth/register', body: { name: 'Sec Tester A', email: emailA, password: pwA, branchId: 'b1' } });
check('register A -> 201 + member token', r.status === 201 && r.body.token && r.body.user.role === 'member');
let tokA = r.body.token;

r = await run({ method: 'POST', url: '/api/auth/register', body: { name: 'Sec Tester B', email: emailB, password: pwB, branchId: 'b1' } });
check('register B -> 201', r.status === 201 && r.body.token);
const tokB = r.body.token;

// ---- brute force lockout ------------------------------------------------------
let locked = false;
for (let i = 1; i <= 5; i++) {
  r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: 'wrong-pass' } });
  if (i < 5) check(`wrong password attempt ${i} -> 401`, r.status === 401);
  else locked = r.status === 423 && r.body.locked === true;
}
check('5th wrong password locks the account (423 + locked)', locked);

r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: pwA } });
check('correct password while locked -> still 423', r.status === 423 && r.body.retryAfter > 0);

// Unlock directly so the rest of the suite doesn't wait 15 minutes.
await pool.query('UPDATE users SET locked_until = NULL, login_attempts = 0 WHERE email = $1', [emailA]);

r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: 'wrong-pass' } });
check('after unlock, one more failure -> 401 (counter reset)', r.status === 401);

// ---- sessions: login, list, logout, revoke ------------------------------------
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: pwA } });
check('correct login after unlock -> token', r.status === 200 && r.body.token);
tokA = r.body.token;

r = await run({ method: 'GET', url: '/api/auth/sessions', headers: auth(tokA) });
const s1 = r.body && r.body.sessions;
check('GET /auth/sessions -> current session listed', r.status === 200 && Array.isArray(s1) && s1.length >= 1 && s1.some((s) => s.current));

r = await run({ method: 'POST', url: '/api/auth/logout', headers: auth(tokA) });
check('logout revokes session', r.status === 200 && r.body.ok === true);
r = await run({ method: 'GET', url: '/api/auth/me', headers: auth(tokA) });
check('token after logout -> 401', r.status === 401);

// Second session for cross-device tests.
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: pwA } });
const tokA2 = r.body.token;
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: pwA } });
const tokA3 = r.body.token;

r = await run({ method: 'GET', url: '/api/auth/sessions', headers: auth(tokA2) });
const s2 = r.body && r.body.sessions;
check('two active sessions listed', r.status === 200 && Array.isArray(s2) && s2.length >= 2);
const other = s2.find((s) => !s.current);
check('non-current session can be found', Boolean(other));
if (other) {
  r = await run({ method: 'POST', url: '/api/auth/sessions/' + encodeURIComponent(other.id) + '/revoke', headers: auth(tokA2) });
  check('revoke other session -> ok', r.status === 200 && r.body.ok === true);
  r = await run({ method: 'GET', url: '/api/auth/me', headers: auth(tokA3) });
  check('revoked session token -> 401', r.status === 401);
}

// ---- password change with cross-session revocation -----------------------------
r = await run({ method: 'POST', url: '/api/auth/change-password', headers: auth(tokA2), body: { currentPassword: 'nope', newPassword: 'NewSecure!456' } });
check('change-password rejects wrong current', r.status === 401);
r = await run({ method: 'POST', url: '/api/auth/change-password', headers: auth(tokA2), body: { currentPassword: pwA, newPassword: 'short1' } });
check('change-password rejects weak new password', r.status === 400);

// Create a 3rd live session, then change the password from tokA2.
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: pwA } });
const tokA4 = r.body.token;
r = await run({ method: 'POST', url: '/api/auth/change-password', headers: auth(tokA2), body: { currentPassword: pwA, newPassword: 'NewSecure!456' } });
check('change-password ok + revokes other sessions', r.status === 200 && r.body.ok === true && r.body.otherSessionsRevoked >= 1);
r = await run({ method: 'GET', url: '/api/auth/me', headers: auth(tokA4) });
check('other session token invalid after password change', r.status === 401);
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: pwA } });
check('old password no longer works', r.status === 401);
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: 'NewSecure!456' } });
check('new password works', r.status === 200 && r.body.token);
tokA = r.body.token;

// ---- re-authentication + recovery codes + TOTP --------------------------------
r = await run({ method: 'POST', url: '/api/auth/reauthenticate', headers: auth(tokA), body: { password: 'NewSecure!456' } });
check('reauthenticate -> reauthToken', r.status === 200 && typeof r.body.reauthToken === 'string');
const reauth = r.body.reauthToken;

r = await run({ method: 'POST', url: '/api/auth/recovery-codes', headers: auth(tokA), body: {} });
check('recovery-codes requires password/reauth', r.status === 401);
r = await run({ method: 'POST', url: '/api/auth/recovery-codes', headers: auth(tokA), body: { reauthToken: reauth } });
check('recovery-codes via reauthToken -> 10 codes', r.status === 200 && Array.isArray(r.body.codes) && r.body.codes.length === 10);
const recoveryCode = r.body.codes[0];

r = await run({ method: 'POST', url: '/api/auth/totp/setup', headers: auth(tokA) });
check('totp/setup -> secret + uri', r.status === 200 && r.body.secret && r.body.uri.startsWith('otpauth://'));
const secret = r.body.secret;
const totp = totpCode(secret);
r = await run({ method: 'POST', url: '/api/auth/totp/verify', headers: auth(tokA), body: { code: totp } });
check('totp/verify enables authenticator', r.status === 200 && r.body.ok === true);

// Enable email-code MFA too, then sign out everything and test MFA sign-in.
r = await run({ method: 'POST', url: '/api/auth/mfa/settings', headers: auth(tokA), body: { enabled: true } });
check('mfa/settings enables MFA', r.status === 200 && r.body.user.mfaEnabled === true);
r = await run({ method: 'POST', url: '/api/auth/logout-all', headers: auth(tokA) });
check('logout-all revokes all sessions', r.status === 200 && r.body.ok === true);

r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: 'NewSecure!456' } });
check('MFA now required at login', r.status === 200 && r.body.mfaRequired === true && r.body.methods.includes('totp') && r.body.methods.includes('recovery'), 'methods=' + JSON.stringify(r.body.methods));
const ticket = r.body.ticket;

r = await run({ method: 'POST', url: '/api/auth/mfa', body: { ticket, code: totp } });
check('login via TOTP -> token', r.status === 200 && r.body.token);
tokA = r.body.token;

// Single-use recovery code: first use works, second use is rejected.
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: 'NewSecure!456' } });
const ticket2 = r.body.ticket;
r = await run({ method: 'POST', url: '/api/auth/mfa', body: { ticket: ticket2, code: recoveryCode } });
check('login via recovery code -> token', r.status === 200 && r.body.token);
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: 'NewSecure!456' } });
const ticket3 = r.body.ticket;
r = await run({ method: 'POST', url: '/api/auth/mfa', body: { ticket: ticket3, code: recoveryCode } });
check('used recovery code rejected (single-use)', r.status === 401);

// Wrong MFA code still fails cleanly.
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailA, password: 'NewSecure!456' } });
r = await run({ method: 'POST', url: '/api/auth/mfa', body: { ticket: r.body.ticket, code: '000000' } });
check('wrong MFA code -> 401', r.status === 401);

// ---- privileged accounts cannot disable MFA -----------------------------------
r = await run({ method: 'POST', url: '/api/auth/totp/disable', headers: auth(tokA), body: { password: 'NewSecure!456' } });
check('member can keep TOTP; disable requires privileged check (member disallowed only if mfaRequired)', r.status === 200 && r.body.ok === true);

r = await run({ method: 'POST', url: '/api/auth/login', body: { email: 'admin@livingwaters.test', password: 'grace' } });
check('privileged account with MFA off still requires MFA (role-enforced)', r.status === 200 && r.body.mfaRequired === true);

// ---- forgot / reset password ----------------------------------------------------
r = await run({ method: 'POST', url: '/api/auth/forgot-password', body: { email: emailB } });
check('forgot-password -> ok (debug code in dev)', r.status === 200 && r.body.ok === true && typeof r.body.debugCode === 'string');
const resetCode = r.body.debugCode;
r = await run({ method: 'POST', url: '/api/auth/reset-password', body: { email: emailB, code: resetCode, password: 'ResetPass!789' } });
check('reset-password -> ok + sessions revoked', r.status === 200 && r.body.ok === true);
r = await run({ method: 'GET', url: '/api/auth/me', headers: auth(tokB) });
check('token invalid after password reset', r.status === 401);
r = await run({ method: 'POST', url: '/api/auth/login', body: { email: emailB, password: 'ResetPass!789' } });
check('login with new password after reset', r.status === 200 && r.body.token);

// ---- legacy sid-less tokens are rejected ---------------------------------------
const legacy = jwt.sign({ sub: 1, email: emailB, role: 'member', branchId: 'b1', churchId: 'ch1' }, config.jwtSecret, { expiresIn: '5m' });
r = await run({ method: 'GET', url: '/api/auth/me', headers: auth(legacy) });
check('sid-less legacy token -> 401', r.status === 401);

// ---- audit trail exists ---------------------------------------------------------
const { rows: auditRows } = await pool.query(
  'SELECT count(*)::int AS n FROM audit_logs al JOIN users u ON u.id = al.user_id WHERE u.email = $1',
  [emailA]
);
check('audit log entries recorded for account', (auditRows[0] && auditRows[0].n) > 0, 'n=' + (auditRows[0] && auditRows[0].n));

// ---- cleanup ---------------------------------------------------------------------
const cleanup = [
  ['DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email IN ($1,$2))', [emailA, emailB]],
  ['DELETE FROM members WHERE email IN ($1,$2)', [emailA, emailB]],
  ['DELETE FROM users WHERE email IN ($1,$2)', [emailA, emailB]],
];
for (const [sql, params] of cleanup) { try { await pool.query(sql, params); } catch (e) { console.log('cleanup skip:', e.message); } }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await pool.end();
process.exitCode = fail ? 1 : 0;
