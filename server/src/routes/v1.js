// Church 2.0 - documented external API contract (/api/v1).
//
// Implements the shapes defined in api-documentation.md for external
// integrations (accounting, payment gateways, mobile apps). The SPA continues
// to use the legacy unversioned /api/* endpoints, which are untouched.
//
// Note on the AI endpoints: the categorization/repurposing logic lives in
// ai-engine.js (repo root). Imported statically so it resolves in local dev,
// the Docker image, and the Cloudflare Workers bundle alike.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, requireRole, resolveChurch, passwordProblem } from '../auth.js';
import { defaultBranchForChurch, genId, resolveBranch, wrap } from './util.js';
import { generateCode, hashCode, deliverCode, availableMethods } from '../mfa.js';
import {
  mfaNeeded, mfaTicket, accountLocked, lockRemainingSeconds, recordLoginFailure, recordLoginSuccess,
  issueAccess, verifyMfaForUser, auditLog,
} from '../security.js';

import AIEngine from '../../../ai-engine.js';

// ---------------------------------------------------------------- auth
// "12h" / "30m" / "3600" -> seconds, matching the docs' expires_in field.
function expiresInSeconds(value) {
  const m = /^(\d+)([smhd])?$/i.exec(String(value || '').trim());
  if (!m) return 3600;
  const n = parseInt(m[1], 10);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (mult[(m[2] || '').toLowerCase()] || 1);
}

export const v1AuthRouter = Router();

// Step 1 - validate credentials. Documented response: mfa_required + mfa_token,
// or access_token + expires_in when MFA is off.
v1AuthRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const { rows } = await query(
      'SELECT id, email, name, role, branch_id, church_id, phone, mfa_enabled, mfa_required, password_hash, login_attempts, locked_until, active, totp_secret, recovery_codes FROM users WHERE email = $1',
      [String(email).toLowerCase()]
    );
    const user = rows[0];
    const fail = () => res.status(401).json({ error: 'Invalid email or password' });
    if (!user || !user.active) return fail();

    if (accountLocked(user)) {
      return res.status(423).json({ error: 'Too many failed attempts. Please wait before trying again.', locked: true, retryAfter: lockRemainingSeconds(user) });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const outcome = await recordLoginFailure(user, req);
      await auditLog(user.id, 'login_failed', { attempts: outcome.attempts, api: 'v1' }, req);
      if (outcome.locked) {
        return res.status(423).json({ error: 'Too many failed attempts. Account temporarily locked.', locked: true, retryAfter: outcome.retryAfter });
      }
      return fail();
    }

    await recordLoginSuccess(user.id, req);
    await auditLog(user.id, 'login_success', { api: 'v1', mfaRequired: mfaNeeded(user) }, req);

    if (mfaNeeded(user)) {
      return res.json({ status: 'mfa_required', mfa_token: mfaTicket(user.id), method: 'authenticator_app', methods: availableMethods(user) });
    }

    const { token } = await issueAccess(user, req);
    return res.json({ access_token: token, expires_in: expiresInSeconds(config.jwtExpiresIn) });
  } catch (e) {
    next(e);
  }
});

// Step 2 - verify the MFA code. NOTE: mock TOTP (demo code) until real TOTP lands.
v1AuthRouter.post('/mfa/request', async (req, res, next) => {
  try {
    const { mfa_token, method = 'email' } = req.body || {};
    if (!mfa_token) return res.status(400).json({ error: 'mfa_token is required' });
    if (!['email', 'sms'].includes(method)) return res.status(400).json({ error: 'Method must be email or sms' });

    let payload;
    try {
      payload = jwt.verify(mfa_token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Verification session expired - please sign in again.' });
    }
    if (payload.purpose !== 'mfa') return res.status(400).json({ error: 'Invalid token' });

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
    await query(
      `DELETE FROM mfa_codes WHERE user_id = $1 AND method = $2 AND used = false AND id < (SELECT max(id) FROM mfa_codes WHERE user_id = $1 AND method = $2)`,
      [user.id, method]
    );

    let delivered;
    try {
      delivered = await deliverCode(user, method, code);
    } catch (e) {
      console.error('MFA delivery failed:', e.message);
      return res.status(502).json({ error: 'Could not send the code. Check the email/SMS provider settings or try another method.' });
    }
    await auditLog(user.id, 'mfa_code_sent', { method, api: 'v1' }, req);
    return res.json({ status: 'ok', ...(delivered.debugCode !== undefined ? { debug_code: delivered.debugCode } : {}) });
  } catch (e) {
    next(e);
  }
});

v1AuthRouter.post('/mfa/verify', async (req, res, next) => {
  try {
    const { mfa_token, code } = req.body || {};
    if (!mfa_token || !code) return res.status(400).json({ error: 'mfa_token and code are required' });

    let payload;
    try {
      payload = jwt.verify(mfa_token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Verification session expired - please sign in again.' });
    }
    if (payload.purpose !== 'mfa') return res.status(400).json({ error: 'Invalid token' });

    const { rows } = await query(
      'SELECT id, email, name, role, branch_id, church_id, phone, mfa_enabled, mfa_required, totp_secret, recovery_codes, active FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Account not found or disabled' });

    const verified = await verifyMfaForUser(user, String(code).trim());
    if (!verified.ok) {
      await auditLog(user.id, 'mfa_failed', { api: 'v1' }, req);
      return res.status(401).json({ error: 'Incorrect code' });
    }

    const { token } = await issueAccess(user, req, { mfaVerified: true });
    await auditLog(user.id, 'mfa_success', { method: verified.method, api: 'v1' }, req);
    return res.json({ access_token: token, expires_in: expiresInSeconds(config.jwtExpiresIn) });
  } catch (e) {
    next(e);
  }
});


// Public branch list for the registration campus picker.
v1AuthRouter.get('/branches', async (_req, res, next) => {
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

// Self-service registration (documented contract, snake_case). Creates a member
// account (role 'member', MFA off until real TOTP lands) plus a directory record.
v1AuthRouter.post('/register', async (req, res, next) => {
  try {
    const { full_name, email, password, branch_id, phone } = req.body || {};
    const bad = (msg) => res.status(400).json({ error: msg });
    const fullName = String(full_name || '').trim();
    const mail = String(email || '').trim().toLowerCase();
    if (!fullName) return bad('full_name is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return bad('A valid email is required');
    const problem = passwordProblem(password);
    if (problem) return bad(problem);
    if (!branch_id) return bad('branch_id is required');

    const { rows: b } = await query('SELECT id, church_id FROM branches WHERE id = $1', [branch_id]);
    if (!b[0]) return bad('Unknown branch - pick one from the list');
    const churchId = b[0].church_id || 'ch1';

    const hash = await hashPassword(String(password));
    const parts = fullName.split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ') || firstName;

    const tokenUser = await withTransaction(async (client) => {
      const { rows: u } = await client.query(
        `INSERT INTO users (email, password_hash, name, role, branch_id, church_id, mfa_enabled)
         VALUES ($1, $2, $3, 'member', $4, $5, false) RETURNING id`,
        [mail, hash, fullName, branch_id, churchId]
      );
      await client.query(
        `INSERT INTO members (id, branch_id, church_id, first_name, last_name, email, engagement_score)
         VALUES ($1, $2, $3, $4, $5, $6, 60)`,
        [genId('m'), branch_id, churchId, firstName, lastName, mail]
      );
      return { id: u[0].id, email: mail, name: fullName, role: 'member', branch_id, church_id: churchId };
    });

    const { token } = await issueAccess(tokenUser, req);
    await auditLog(tokenUser.id, 'register', { api: 'v1' }, req);
    return res.status(201).json({
      access_token: token,
      expires_in: expiresInSeconds(config.jwtExpiresIn),
      user: {
        id: tokenUser.id,
        email: tokenUser.email,
        name: tokenUser.name,
        role: tokenUser.role,
        branch_id: tokenUser.branch_id,
        church_id: tokenUser.church_id,
      },
    });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'An account with that email already exists' });
    next(e);
  }
});
// ---------------------------------------------------------------- v1 resources
const v1 = Router();

// ---- Branches ----
const mapBranch = (r) => ({
  id: r.id,
  name: r.name,
  location: r.location,
  code: r.code || null,
  churchId: r.church_id || 'ch1',
  member_count: r.member_count != null ? r.member_count : 0,
  created_at: r.created_at,
});

v1.get('/branches', wrap(async (req, res) => {
  const church = resolveChurch(req);
  const params = [];
  let where = '';
  if (church) { params.push(church); where = `WHERE b.church_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT b.id, b.name, b.location, b.code, b.church_id, b.created_at, count(m.id)::int AS member_count
     FROM branches b LEFT JOIN members m ON m.branch_id = b.id ${where}
     GROUP BY b.id, b.name, b.location, b.code, b.church_id, b.created_at ORDER BY b.name`,
    params
  );
  res.json(rows.map(mapBranch));
}));

v1.post('/branches', requireRole('hq_admin', 'platform_admin'), wrap(async (req, res) => {
  const { name, location, code } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Branch name is required' });
  const church = resolveChurch(req);
  if (!church) return res.status(400).json({ error: 'A church target is required (?church=ch1)' });
  const id = genId('b');
  const { rows } = await query(
    'INSERT INTO branches (id, name, location, code, church_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, String(name).trim(), location || null, code || null, church]
  );
  res.status(201).json(mapBranch({ ...rows[0], member_count: 0 }));
}));

// Update a branch (name, location, code). Admins may only touch their own church.
v1.patch('/branches/:id', requireRole('hq_admin', 'platform_admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM branches WHERE id=$1', [req.params.id]);
  const b = rows[0];
  if (!b) return res.status(404).json({ error: 'Branch not found' });
  const church = resolveChurch(req);
  if (church && b.church_id !== church) return res.status(403).json({ error: 'Out of scope' });

  const body = req.body || {};
  const sets = []; const params = [];
  const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return res.status(400).json({ error: 'Branch name is required' });
    push('name', String(body.name).trim());
  }
  if (body.location !== undefined) push('location', body.location ? String(body.location).trim() : null);
  if (body.code !== undefined) push('code', body.code ? String(body.code).trim() : null);
  if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
  params.push(b.id);
  const { rows: updated } = await query(`UPDATE branches SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  const { rows: mc } = await query('SELECT count(*)::int AS member_count FROM members WHERE branch_id=$1', [b.id]);
  res.json(mapBranch({ ...updated[0], member_count: mc[0].member_count }));
}));

// Delete a branch (cascades its members, giving, attendance and groups).
v1.delete('/branches/:id', requireRole('hq_admin', 'platform_admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT id, church_id FROM branches WHERE id=$1', [req.params.id]);
  const b = rows[0];
  if (!b) return res.status(404).json({ error: 'Branch not found' });
  const church = resolveChurch(req);
  if (church && b.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  await query('DELETE FROM branches WHERE id=$1', [b.id]);
  res.json({ ok: true });
}));

// ---- Churches ----
const mapChurch = (r) => ({
  id: r.id, name: r.name, shortName: r.short_name || null,
  tagline: r.tagline || null, website: r.website || null,
  contactEmail: r.contact_email || null, contactPhone: r.contact_phone || null,
  newsBullet: r.news_bullet || null,
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
});

// A normal user sees their own church; a platform admin may list all tenants.
v1.get('/churches', wrap(async (req, res) => {
  const church = resolveChurch(req);
  const params = [];
  let where = '';
  if (church) { params.push(church); where = 'WHERE id = $1'; }
  const { rows } = await query(`SELECT * FROM churches ${where} ORDER BY name`, params);
  res.json(rows.map(mapChurch));
}));

// Provision a brand-new church tenant (platform admins only).
v1.post('/churches', requireRole('platform_admin'), wrap(async (req, res) => {
  const { name, shortName, tagline, website, contactEmail, contactPhone, newsBullet } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Church name is required' });
  const id = genId('ch');
  const { rows } = await query(
    'INSERT INTO churches (id, name, short_name, tagline, website, contact_email, contact_phone, news_bullet) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
    [id, String(name).trim(), shortName ? String(shortName).trim() : null, tagline ? String(tagline).trim() : null, website ? String(website).trim() : null, contactEmail ? String(contactEmail).trim() : null, contactPhone ? String(contactPhone).trim() : null, newsBullet ? String(newsBullet).trim() : null]
  );
  res.status(201).json(mapChurch(rows[0]));
}));

// Edit a church's identity. HQ admins may update their own church; platform
// admins may update any tenant.
v1.patch('/churches/:id', requireRole('hq_admin', 'platform_admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM churches WHERE id=$1', [req.params.id]);
  const ch = rows[0];
  if (!ch) return res.status(404).json({ error: 'Church not found' });
  if (req.user.role !== 'platform_admin' && req.user.churchId !== ch.id) {
    return res.status(403).json({ error: 'Admins may only update their own church' });
  }

  const body = req.body || {};
  const sets = []; const params = [];
  const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return res.status(400).json({ error: 'Church name is required' });
    push('name', String(body.name).trim());
  }
  if (body.shortName !== undefined) push('short_name', body.shortName ? String(body.shortName).trim() : null);
  if (body.tagline !== undefined) push('tagline', body.tagline ? String(body.tagline).trim() : null);
  if (body.website !== undefined) push('website', body.website ? String(body.website).trim() : null);
  if (body.contactEmail !== undefined) push('contact_email', body.contactEmail ? String(body.contactEmail).trim() : null);
  if (body.contactPhone !== undefined) push('contact_phone', body.contactPhone ? String(body.contactPhone).trim() : null);
  if (body.newsBullet !== undefined) push('news_bullet', body.newsBullet ? String(body.newsBullet).trim() : null);
  if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
  params.push(ch.id);
  const { rows: updated } = await query(`UPDATE churches SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  res.json(mapChurch(updated[0]));
}));

// ---- Members (paginated, snake_case, per docs) ----
const mapMember = (r) => ({
  id: r.id,
  branch_id: r.branch_id,
  first_name: r.first_name,
  last_name: r.last_name,
  email: r.email,
  phone: r.phone,
  family_id: r.family_id,
  family_role: r.family_role,
  engagement_score: r.engagement_score,
  volunteer_skills: r.volunteer_skills || [],
  spiritual_milestones: r.spiritual_milestones || [],
  created_at: r.created_at,
});

// Effective branch scope: HQ may target any campus via branch_id; everyone else
// is hard-locked to their own campus (same rule as the legacy /api).
function scopeFor(req) {
  if (req.user.role === 'hq_admin' || req.user.role === 'platform_admin') return req.query.branch_id || null;
  return req.user.branchId || null;
}

v1.get('/members', wrap(async (req, res) => {
  const branchId = scopeFor(req);
  const queryText = (req.query.query || '').toString().trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  const params = [];
  const where = [];
  if (branchId) { params.push(branchId); where.push(`branch_id = $${params.length}`); }
  const church = resolveChurch(req);
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  if (queryText) {
    params.push(`%${queryText}%`);
    const p = `$${params.length}`;
    where.push(`(lower(first_name || ' ' || last_name) LIKE ${p} OR lower(coalesce(email,'')) LIKE ${p} OR coalesce(phone,'') LIKE ${p})`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [{ rows: totalRows }, { rows }] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM members ${clause}`, params),
    query(`SELECT * FROM members ${clause} ORDER BY last_name, first_name LIMIT ${limit} OFFSET ${offset}`, params),
  ]);

  res.json({ data: rows.map(mapMember), pagination: { total: totalRows[0].n, limit, page } });
}));

v1.post('/members', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const { branch_id, first_name, last_name, email, phone, family_id } = req.body || {};
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name are required' });
  let targetBranch = branch_id;
  if (req.user.role !== 'hq_admin' && req.user.role !== 'platform_admin') targetBranch = req.user.branchId; // locked to own campus
  if (!targetBranch) return res.status(400).json({ error: 'branch_id is required' });
  const church = resolveChurch(req);
  const resolved = await resolveBranch(targetBranch, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const id = genId('m');
  const { rows } = await query(
    `INSERT INTO members (id, branch_id, church_id, first_name, last_name, email, phone, family_id, engagement_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 60) RETURNING *`,
    [id, resolved.branchId, resolved.churchId, first_name, last_name, email || null, phone || null, family_id || null]
  );
  res.status(201).json(mapMember(rows[0]));
}));

// ---- Financials ----
async function sendReceipt(receiptNumber, res, req) {
  const church = resolveChurch(req);
  const params = [receiptNumber];
  let where = 'receipt_number = $1';
  if (church) { params.push(church); where += ` AND church_id = $${params.length}`; }
  const { rows } = await query(`SELECT * FROM transactions WHERE ${where}`, params);
  if (!rows[0]) return res.status(404).json({ error: 'Receipt not found' });
  const r = rows[0];
  return res.json({
    transaction_id: r.id,
    member_id: r.member_id,
    member_name: r.member_name,
    amount: Number(r.amount),
    category: r.category,
    payment_method: r.payment_method,
    date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : r.date,
    receipt_number: r.receipt_number,
    status: 'Success',
  });
}

v1.get('/financials/receipts/:receiptNumber', wrap(async (req, res) => {
  await sendReceipt(req.params.receiptNumber, res, req);
}));

v1.post('/financials/transactions', requireRole('hq_admin', 'branch_admin', 'ministry_leader', 'member'), wrap(async (req, res) => {
  const { branch_id, member_id, amount, category, payment_method } = req.body || {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'A valid amount greater than 0 is required' });

  const church = resolveChurch(req);
  let targetBranch = branch_id;
  let name = 'Anonymous';
  if (member_id) {
    const { rows } = await query('SELECT branch_id, church_id, first_name, last_name FROM members WHERE id=$1', [member_id]);
    if (rows[0]) {
      if (church && rows[0].church_id !== church) return res.status(403).json({ error: 'Out of scope' });
      targetBranch = rows[0].branch_id;
      name = `${rows[0].first_name} ${rows[0].last_name}`;
    }
  }
  // Non-HQ callers are locked to their own campus.
  if (req.user.role !== 'hq_admin' && req.user.role !== 'platform_admin') targetBranch = req.user.branchId;
  if (!targetBranch) targetBranch = await defaultBranchForChurch(church);
  if (!targetBranch) return res.status(400).json({ error: 'branch_id is required' });
  const resolved = await resolveBranch(targetBranch, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  const id = genId('t');
  const receipt_number = `REC-2026-${Math.floor(Math.random() * 90000) + 10000}`;
  const { rows } = await query(
    `INSERT INTO transactions (id, branch_id, church_id, member_id, member_name, amount, category, date, payment_method, receipt_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, receipt_number`,
    [id, resolved.branchId, resolved.churchId, member_id || null, name, amt, category || 'Offering',
     new Date().toISOString().split('T')[0], payment_method || 'Cash', receipt_number]
  );
  const t = rows[0];
  const receipt_url = `${req.protocol}://${req.get('host')}/api/v1/financials/receipts/${encodeURIComponent(t.receipt_number)}`;
  res.status(201).json({ transaction_id: t.id, receipt_number: t.receipt_number, receipt_url, status: 'Success' });
}));

// ---- AI services ----
v1.post('/ai/prayer/categorize', wrap(async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Prayer text is required' });
  const result = AIEngine.categorizePrayerRequest(text);
  res.json({
    category: result.category,
    confidence: Number(result.confidence),
    action_route: result.route,
    tags: result.tags || [],
  });
}));

v1.post('/ai/sermon/repurpose', wrap(async (req, res) => {
  const { title, transcript } = req.body || {};
  if (!title && !transcript) return res.status(400).json({ error: 'title and transcript are required' });
  const result = AIEngine.repurposeSermon(title || '', transcript || '');
  res.json({
    devotional: result.devotional,
    social_media_quotes: result.socialQuotes || [],
    discussion_questions: result.discussionQuestions || [],
  });
}));

// ---- AI chat (DeepSeek) -----------------------------------------------------
// The frontend assistant calls this when DEEPSEEK_API_KEY is configured. It
// returns { reply } on success and { fallback: true } so clients degrade to
// the built-in engine when the key is missing or the provider errors out.
v1.post('/ai/chat', wrap(async (req, res) => {
  const { messages, system } = req.body || {};
  const list = Array.isArray(messages) ? messages : [];
  const last = list.filter((m) => m && typeof m.content === 'string' && String(m.content).trim()).pop();
  if (!last) return res.status(400).json({ error: 'A message is required' });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'DEEPSEEK_API_KEY is not configured', fallback: true });

  const body = {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: String(system || 'You are the ChurchConnect assistant. Answer helpfully and concisely.').slice(0, 1500) },
      ...list.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) })),
    ],
    temperature: 0.7,
    max_tokens: 900,
    stream: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('DeepSeek responded', r.status, detail.slice(0, 200));
      return res.status(502).json({ error: 'DeepSeek responded ' + r.status, fallback: true });
    }
    const data = await r.json();
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (!String(reply).trim()) return res.status(502).json({ error: 'Empty reply from DeepSeek', fallback: true });
    return res.json({ reply: String(reply).trim(), fallback: false });
  } catch (e) {
    console.error('DeepSeek call failed:', e.message);
    return res.status(502).json({ error: 'DeepSeek call failed', fallback: true });
  } finally {
    clearTimeout(timer);
  }
}));

export default v1;



