import express from 'express';
import authRoutes from './src/routes/auth.js';
import v1Routes, { v1AuthRouter } from './src/routes/v1.js';
import memberRoutes from './src/routes/members.js';
import transactionRoutes from './src/routes/transactions.js';
import attendanceRoutes from './src/routes/attendance.js';
import dashboardRoutes from './src/routes/dashboard.js';
import groupRoutes from './src/routes/groups.js';
import followupRoutes from './src/routes/followups.js';
import announcementRoutes from './src/routes/announcements.js';
import prayerRoutes from './src/routes/prayer.js';
import eventRoutes from './src/routes/events.js';
import campaignRoutes from './src/routes/campaigns.js';
import recurringGiftRoutes from './src/routes/recurringGifts.js';
import careInboxRoutes from './src/routes/careInbox.js';
import { authenticate } from './src/auth.js';
import { pool } from './src/db/pool.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', v1AuthRouter);
app.use('/api', authenticate);
app.use('/api/v1', authenticate, v1Routes);
app.use('/api/members', memberRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/prayer-requests', prayerRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/recurring-gifts', recurringGiftRoutes);
app.use('/api/care-inbox', careInboxRoutes);
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
const uniq = 'smoke' + Date.now().toString(36);
const email = uniq + '@test.org';

let r = await run({ method: 'POST', url: '/api/auth/register', body: { name: 'Smoke Tester', email, password: 'TestPass123!', branchId: 'b1', phone: '+254700000001' } });
check('register new member -> 201 + token', r.status === 201 && r.body.token && r.body.user.role === 'member');
const memberToken = r.body.token;

r = await run({ method: 'POST', url: '/api/auth/login', body: { email, password: 'TestPass123!' } });
check('login registered member (mfa off)', r.status === 200 && r.body.token);

r = await run({ method: 'POST', url: '/api/auth/login', body: { email: 'admin@maximummiracle.org', password: 'grace' } });
let adminToken = r.body.token;
if (adminToken) {
  check('admin login -> direct token (hq_admin)', r.status === 200 && adminToken && r.body.user.role === 'hq_admin');
} else {
  check('admin login -> mfaRequired + methods', r.status === 200 && r.body.mfaRequired === true && r.body.methods.includes('email') && r.body.methods.includes('sms'), 'methods=' + JSON.stringify(r.body.methods));
  const ticket = r.body.ticket;
  r = await run({ method: 'POST', url: '/api/auth/mfa/request', body: { ticket, method: 'email' } });
  check('mfa/request -> debugCode issued', r.status === 200 && r.body.ok === true && typeof r.body.debugCode === 'string');
  const code = r.body.debugCode;
  r = await run({ method: 'POST', url: '/api/auth/mfa', body: { ticket, code } });
  check('mfa verify -> access token (hq_admin)', r.status === 200 && r.body.token && r.body.user.role === 'hq_admin');
  adminToken = r.body.token;
}

r = await run({ method: 'GET', url: '/api/auth/me', headers: auth(adminToken) });
check('GET /auth/me', r.status === 200 && r.body.user.email === 'admin@maximummiracle.org');

r = await run({ method: 'GET', url: '/api/members', headers: auth(adminToken) });
check('GET /members (seeded)', r.status === 200 && Array.isArray(r.body) && r.body.length >= 10, 'count=' + (r.body || []).length);

r = await run({ method: 'POST', url: '/api/members', headers: auth(adminToken), body: { firstName: 'Smoke', lastName: 'Member', branchId: 'b1', email: uniq + '@member.org', phone: '+254700000002', volunteer_skills: ['Greeting'], familyId: 'fam_smoke', familyRole: 'Husband', familyName: 'Smoke Family', familyContactName: 'Smoke Contact', familyContactPhone: '+254700000099', familyContactEmail: uniq + '@family.org' } });
check('POST /members -> 201 with family link', r.status === 201 && r.body.id && r.body.familyId === 'fam_smoke' && r.body.familyRole === 'Husband' && r.body.familyName === 'Smoke Family', 'family=' + (r.body && r.body.familyId));
const createdMemberId = r.body && r.body.id;

r = await run({ method: 'GET', url: '/api/groups', headers: auth(adminToken) });
check('GET /groups (seeded)', r.status === 200 && Array.isArray(r.body) && r.body.length >= 7, 'count=' + (r.body || []).length);

r = await run({ method: 'POST', url: '/api/groups', headers: auth(adminToken), body: { name: 'Smoke Group', branchId: 'b1', schedule: 'Mon 7 PM', description: 'smoke', memberIds: ['m1', 'm99'] } });
check('POST /groups with members -> roster filtered to campus', r.status === 201 && r.body.memberIds.length === 1 && r.body.memberIds[0] === 'm1', 'memberIds=' + JSON.stringify(r.body && r.body.memberIds));
const groupId = r.body && r.body.id;

r = await run({ method: 'PUT', url: '/api/groups/' + groupId, headers: auth(adminToken), body: { name: 'Smoke Group Renamed', memberIds: ['m1', 'm3'] } });
check('PUT /groups/:id -> roster replaced', r.status === 200 && r.body.name === 'Smoke Group Renamed' && r.body.memberIds.length === 2);

r = await run({ method: 'DELETE', url: '/api/groups/' + groupId, headers: auth(adminToken) });
check('DELETE /groups/:id -> ok', r.status === 200 && r.body.ok === true);

r = await run({ method: 'GET', url: '/api/transactions', headers: auth(adminToken) });
check('GET /transactions (seeded)', r.status === 200 && Array.isArray(r.body) && r.body.length > 0, 'count=' + (r.body || []).length);

r = await run({ method: 'POST', url: '/api/transactions', headers: auth(adminToken), body: { memberId: 'm1', amount: 500, category: 'Tithe', paymentMethod: 'Cash', date: '2026-08-02' } });
check('POST /transactions -> 201', r.status === 201 && r.body.receiptNumber, 'receipt=' + (r.body && r.body.receiptNumber));
const txId = r.body && r.body.id;

r = await run({ method: 'GET', url: '/api/attendance', headers: auth(adminToken) });
check('GET /attendance (seeded)', r.status === 200 && Array.isArray(r.body) && r.body.length > 0, 'count=' + (r.body || []).length);

r = await run({ method: 'PUT', url: '/api/attendance', headers: auth(adminToken), body: { memberId: 'm1', date: '2026-08-02', present: true } });
check('PUT /attendance upsert', r.status === 200 && r.body.memberId === 'm1' && r.body.present === true);

r = await run({ method: 'GET', url: '/api/dashboard/summary', headers: auth(adminToken) });
check('GET /dashboard/summary', r.status === 200 && r.body && typeof r.body === 'object', 'keys=' + Object.keys(r.body || {}).join(','));

r = await run({ method: 'GET', url: '/api/followups', headers: auth(adminToken) });
check('GET /followups (seeded)', r.status === 200 && Array.isArray(r.body), 'count=' + (r.body || []).length);

r = await run({ method: 'POST', url: '/api/followups', headers: auth(adminToken), body: { name: 'Smoke Guest', owner: 'Test', branchId: 'b1' } });
check('POST /followups -> 201', r.status === 201 && r.body.id);
const fuId = r.body && r.body.id;

r = await run({ method: 'PATCH', url: '/api/followups/' + fuId, headers: auth(adminToken), body: { stage: 'Contacted' } });
check('PATCH /followups/:id', r.status === 200 && r.body.stage === 'Contacted');

// Reaching the final Member stage enrolls the guest in the member directory.
r = await run({ method: 'PATCH', url: '/api/followups/' + fuId, headers: auth(adminToken), body: { stage: 'Member' } });
check('PATCH /followups/:id -> Member enrolls guest as member', r.status === 200 && r.body.stage === 'Member' && typeof r.body.memberId === 'string', 'memberId=' + (r.body && r.body.memberId));
const assimilatedId = r.body && r.body.memberId;

r = await run({ method: 'GET', url: '/api/members/' + assimilatedId, headers: auth(adminToken) });
check('assimilated guest appears in members directory', r.status === 200 && r.body.firstName === 'Smoke' && r.body.lastName === 'Guest', (r.body && r.body.firstName) + ' ' + (r.body && r.body.lastName));

// Re-advancing the card to Member reuses the same member (no duplicates).
r = await run({ method: 'PATCH', url: '/api/followups/' + fuId, headers: auth(adminToken), body: { stage: 'Connected' } });
r = await run({ method: 'PATCH', url: '/api/followups/' + fuId, headers: auth(adminToken), body: { stage: 'Member' } });
check('re-assimilation reuses existing member', r.status === 200 && r.body.memberId === assimilatedId);

r = await run({ method: 'GET', url: '/api/care-inbox', headers: auth(adminToken) });
check('GET /care-inbox (seeded)', r.status === 200 && Array.isArray(r.body), 'count=' + (r.body || []).length);

r = await run({ method: 'POST', url: '/api/care-inbox', headers: auth(adminToken), body: { title: 'Smoke Care', body: 'We are praying for you.', branchId: 'b1' } });
check('POST /care-inbox -> 201', r.status === 201 && r.body.id && r.body.body === 'We are praying for you.', 'id=' + (r.body && r.body.id));
const careId = r.body && r.body.id;

r = await run({ method: 'PATCH', url: '/api/care-inbox/' + careId, headers: auth(adminToken), body: { body: 'Updated care note.' } });
check('PATCH /care-inbox/:id', r.status === 200 && r.body.body === 'Updated care note.');

r = await run({ method: 'DELETE', url: '/api/care-inbox/' + careId, headers: auth(adminToken) });
check('DELETE /care-inbox/:id', r.status === 200 && r.body.ok === true);

r = await run({ method: 'GET', url: '/api/announcements', headers: auth(adminToken) });
check('GET /announcements (seeded)', r.status === 200 && Array.isArray(r.body), 'count=' + (r.body || []).length);

r = await run({ method: 'POST', url: '/api/announcements', headers: auth(adminToken), body: { title: 'Smoke Announcement', body: 'test', audience: 'all', channels: ['push'] } });
check('POST /announcements -> 201', r.status === 201 && r.body.id);

r = await run({ method: 'GET', url: '/api/prayer-requests', headers: auth(adminToken) });
check('GET /prayer-requests (seeded)', r.status === 200 && Array.isArray(r.body), 'count=' + (r.body || []).length);

r = await run({ method: 'POST', url: '/api/prayer-requests', headers: auth(memberToken), body: { memberId: 'm1', memberName: 'John Kamau', branchName: 'Nairobi CBD', text: 'Smoke prayer', category: 'General' } });
check('POST /prayer-requests (member) -> 201', r.status === 201 && r.body.id);
const prId = r.body && r.body.id;

r = await run({ method: 'DELETE', url: '/api/prayer-requests/' + prId, headers: auth(adminToken) });
check('DELETE /prayer-requests/:id', r.status === 200 && r.body.ok === true);

r = await run({ method: 'GET', url: '/api/events', headers: auth(adminToken) });
check('GET /events (seeded)', r.status === 200 && Array.isArray(r.body) && r.body.length >= 3, 'count=' + (r.body || []).length);

const seedEvent = r.body && r.body.find((e) => e.id === 'e1');
const originalVolunteers = seedEvent ? seedEvent.volunteersSignedUp : [];
const nextVolunteers = originalVolunteers.includes('m2') ? originalVolunteers : [...originalVolunteers, 'm2'];
r = await run({ method: 'PUT', url: '/api/events/e1/volunteers', headers: auth(adminToken), body: { volunteerIds: nextVolunteers } });
check('PUT /api/events/:id/volunteers', r.status === 200 && Array.isArray(r.body.volunteersSignedUp) && r.body.volunteersSignedUp.includes('m2'), 'next=' + JSON.stringify(r.body && r.body.volunteersSignedUp));
r = await run({ method: 'PUT', url: '/api/events/e1/volunteers', headers: auth(adminToken), body: { volunteerIds: originalVolunteers } });
check('PUT /api/events/:id/volunteers restores roster', r.status === 200 && JSON.stringify(r.body.volunteersSignedUp) === JSON.stringify(originalVolunteers));

r = await run({ method: 'GET', url: '/api/campaigns', headers: auth(adminToken) });
check('GET /api/campaigns', r.status === 200 && Array.isArray(r.body), 'count=' + (r.body || []).length);

r = await run({ method: 'GET', url: '/api/recurring-gifts', headers: auth(adminToken) });
check('GET /api/recurring-gifts', r.status === 200 && Array.isArray(r.body), 'count=' + (r.body || []).length);

r = await run({ method: 'POST', url: '/api/recurring-gifts', headers: auth(adminToken), body: { memberId: 'm1', amount: 321, category: 'Offering', frequency: 'monthly', method: 'M-Pesa' } });
check('POST /api/recurring-gifts -> 201', r.status === 201 && r.body.id && Number(r.body.amount) === 321, 'id=' + (r.body && r.body.id));
const recurringGiftId = r.body && r.body.id;

r = await run({ method: 'GET', url: '/api/members/m1', headers: auth(adminToken) });
const memberBefore = r.body || {};
const originalSkills = memberBefore.volunteer_skills || [];
const originalScore = memberBefore.engagement_score;
const testScore = Math.min(originalScore + 1, 100);
r = await run({ method: 'PATCH', url: '/api/members/m1', headers: auth(adminToken), body: { engagement_score: testScore, volunteer_skills: originalSkills } });
check('PATCH /api/members/:id', r.status === 200 && r.body.engagement_score === testScore, 'score=' + (r.body && r.body.engagement_score));
r = await run({ method: 'PATCH', url: '/api/members/m1', headers: auth(adminToken), body: { engagement_score: originalScore, volunteer_skills: originalSkills } });
check('PATCH /api/members/:id restores profile', r.status === 200 && r.body.engagement_score === originalScore);

r = await run({ method: 'PATCH', url: '/api/members/' + createdMemberId, headers: auth(adminToken), body: { familyContactPhone: '+254711222333', familyContactEmail: uniq + '@family2.org' } });
check('PATCH /api/members/:id family contacts persist', r.status === 200 && r.body.familyContactPhone === '+254711222333' && r.body.familyContactEmail === uniq + '@family2.org');

r = await run({ method: 'GET', url: '/api/v1/branches', headers: auth(adminToken) });
check('v1 GET /branches', r.status === 200 && Array.isArray(r.body) && r.body.length >= 3);

r = await run({ method: 'GET', url: '/api/v1/members', headers: auth(adminToken) });
check('v1 GET /members -> {data,pagination}', r.status === 200 && Array.isArray(r.body.data) && r.body.pagination && r.body.pagination.total > 0, 'total=' + (r.body && r.body.pagination && r.body.pagination.total));

r = await run({ method: 'POST', url: '/api/v1/members', headers: auth(adminToken), body: { first_name: 'Smoke', last_name: 'V1', branch_id: 'b1' } });
check('v1 POST /members -> 201', r.status === 201 && r.body.id);
const v1MemberId = r.body && r.body.id;

r = await run({ method: 'POST', url: '/api/v1/financials/transactions', headers: auth(memberToken), body: { member_id: 'm2', amount: 100, category: 'Offering' } });
check('v1 POST /financials/transactions -> 201', r.status === 201 && r.body.receipt_number && r.body.receipt_url.includes('localhost:4000'), 'receipt=' + (r.body && r.body.receipt_number));
const v1TxId = r.body && r.body.transaction_id;

r = await run({ method: 'GET', url: '/api/v1/financials/receipts/' + encodeURIComponent(r.body.receipt_number), headers: auth(adminToken) });
check('v1 GET /financials/receipts/:num', r.status === 200 && r.body.status === 'Success');

r = await run({ method: 'POST', url: '/api/v1/ai/prayer/categorize', headers: auth(adminToken), body: { text: 'Please pray for my sick mother' } });
check('v1 POST /ai/prayer/categorize', r.status === 200 && r.body.category, 'category=' + (r.body && r.body.category));

r = await run({ method: 'GET', url: '/api/members', headers: {} });
check('no token -> 401', r.status === 401);
r = await run({ method: 'GET', url: '/api/members', headers: auth('garbage.token.here') });
check('bad token -> 401', r.status === 401);
r = await run({ method: 'GET', url: '/api/nope', headers: auth(adminToken) });
check('unknown route -> 404', r.status === 404);
r = await run({ method: 'POST', url: '/api/auth/register', body: { name: 'Dup', email: 'admin@maximummiracle.org', password: 'TestPass123!', branchId: 'b1' } });
check('duplicate register -> 409', r.status === 409);

const cleanup = [
  ['DELETE FROM members WHERE id=$1', [createdMemberId]],
  ['DELETE FROM members WHERE email=$1', [email]],
  ['DELETE FROM users WHERE email=$1', [email]],
  ['DELETE FROM transactions WHERE id=$1', [txId]],
  ['DELETE FROM transactions WHERE id=$1', [v1TxId]],
  ['DELETE FROM followups WHERE id=$1', [fuId]],
  ['DELETE FROM announcements WHERE title=$1', ['Smoke Announcement']],
  ['DELETE FROM prayer_requests WHERE id=$1', [prId]],
  ['DELETE FROM members WHERE id=$1', [v1MemberId]],
  ['DELETE FROM recurring_gifts WHERE id=$1', [recurringGiftId]],
  ["DELETE FROM attendance WHERE id='att_m1_2026-08-02'", []],
];
for (const [sql, params] of cleanup) { try { await pool.query(sql, params); } catch (e) { console.log('cleanup skip:', e.message); } }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await pool.end();
process.exitCode = fail ? 1 : 0;
