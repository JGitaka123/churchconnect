import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope, requireRole } from '../auth.js';
import { defaultBranchForChurch, genId, mapAnnouncement, mapGroup, resolveBranch, wrap } from './util.js';
import { assertDeliveryReady, sendGroupAnnouncement } from '../notify.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const params = []; const where = [];
  if (scope) { params.push(scope); where.push(`branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM groups ${clause} ORDER BY name`, params);
  res.json(rows.map(mapGroup));
}));

router.post('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { name, schedule, description, branchId, memberIds } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  let target = scope || branchId;
  if (!target) target = await defaultBranchForChurch(church);
  if (!target) return res.status(400).json({ error: 'branchId is required - this church has no branches yet' });
  const resolved = await resolveBranch(target, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const id = genId('g');
  // Keep only real members who belong to the group's campus (server-side check;
  // a branch admin can't pull people in from another campus).
  let members = Array.isArray(memberIds) ? memberIds.filter((x) => x && typeof x === 'string') : [];
  if (members.length) {
    const { rows } = await query('SELECT id FROM members WHERE id = ANY($1) AND branch_id = $2', [members, resolved.branchId]);
    members = rows.map((r) => r.id);
  }
  const { rows } = await query(
    'INSERT INTO groups (id,branch_id,church_id,name,schedule,description,member_ids) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [id, resolved.branchId, resolved.churchId, name, schedule || null, description || null, members]
  );
  res.status(201).json(mapGroup(rows[0]));
}));

// Join/leave: toggles the member in the group's roster.
router.post('/:id/toggle-member', wrap(async (req, res) => {
  const { memberId } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'memberId is required' });
  const { rows } = await query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
  const g = rows[0];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  const church = resolveChurch(req);
  if (church && g.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  const ids = g.member_ids || [];
  const next = ids.includes(memberId) ? ids.filter((x) => x !== memberId) : [...ids, memberId];
  const { rows: upd } = await query('UPDATE groups SET member_ids=$1 WHERE id=$2 RETURNING *', [next, g.id]);
  res.json(mapGroup(upd[0]));
}));

// A member asks to join a group from the app: they land on the pending list
// until an admin approves. Posting cancel=true withdraws the request.
router.post('/:id/join-request', wrap(async (req, res) => {
  const { memberId, cancel } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'memberId is required' });
  const { rows } = await query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
  const g = rows[0];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  const church = resolveChurch(req);
  if (church && g.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  const ids = g.member_ids || [];
  const pending = g.pending_member_ids || [];
  let nextPending = pending;
  if (cancel === true) {
    nextPending = pending.filter((x) => x !== memberId);
  } else {
    if (ids.includes(memberId)) return res.status(400).json({ error: 'Already a member of this group' });
    if (!pending.includes(memberId)) nextPending = [...pending, memberId];
  }
  const { rows: upd } = await query('UPDATE groups SET pending_member_ids=$1 WHERE id=$2 RETURNING *', [nextPending, g.id]);
  res.json(mapGroup(upd[0]));
}));

// Admin approves a join request: the member moves from pending to the roster.
router.post('/:id/approve-request', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { memberId } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'memberId is required' });
  const { rows } = await query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
  const g = rows[0];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  const scope = resolveScope(req);
  if (scope && g.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  const church = resolveChurch(req);
  if (church && g.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  const pending = g.pending_member_ids || [];
  if (!pending.includes(memberId)) return res.status(400).json({ error: 'No pending request for this member' });
  const ids = g.member_ids || [];
  const nextIds = ids.includes(memberId) ? ids : [...ids, memberId];
  const nextPending = pending.filter((x) => x !== memberId);
  const { rows: upd } = await query('UPDATE groups SET member_ids=$1, pending_member_ids=$2 WHERE id=$3 RETURNING *', [nextIds, nextPending, g.id]);
  res.json(mapGroup(upd[0]));
}));

// Admin declines a join request: the request is dropped from the pending list.
router.post('/:id/decline-request', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { memberId } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'memberId is required' });
  const { rows } = await query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
  const g = rows[0];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  const scope = resolveScope(req);
  if (scope && g.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  const church = resolveChurch(req);
  if (church && g.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  const nextPending = (g.pending_member_ids || []).filter((x) => x !== memberId);
  const { rows: upd } = await query('UPDATE groups SET pending_member_ids=$1 WHERE id=$2 RETURNING *', [nextPending, g.id]);
  res.json(mapGroup(upd[0]));
}));


// Update a group's details and/or membership. The roster is replaced wholesale
// by memberIds; only real members of the group's campus are kept.
router.put('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { name, schedule, description, memberIds } = req.body || {};
  const { rows } = await query('SELECT * FROM groups WHERE id = $1', [req.params.id]);
  const g = rows[0];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  const scope = resolveScope(req);
  if (scope && g.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  const church = resolveChurch(req);
  if (church && g.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Group name is required' });

  let members = Array.isArray(memberIds) ? memberIds.filter((x) => x && typeof x === 'string') : g.member_ids || [];
  if (members.length) {
    const { rows: valid } = await query('SELECT id FROM members WHERE id = ANY($1) AND branch_id = $2', [members, g.branch_id]);
    members = valid.map((r) => r.id);
  }

  const next = {
    name: name !== undefined ? String(name).trim() : g.name,
    schedule: schedule !== undefined ? schedule : g.schedule,
    description: description !== undefined ? description : g.description,
  };
  const { rows: updated } = await query(
    'UPDATE groups SET name = $1, schedule = $2, description = $3, member_ids = $4 WHERE id = $5 RETURNING *',
    [next.name, next.schedule, next.description, members, g.id]
  );
  res.json(mapGroup(updated[0]));
}));

// Delete a group (admins only, scoped to the caller's campus).
router.delete('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT branch_id, church_id FROM groups WHERE id = $1', [req.params.id]);
  const g = rows[0];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  const scope = resolveScope(req);
  if (scope && g.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  const church = resolveChurch(req);
  if (church && g.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  await query('DELETE FROM groups WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Group announcement: an admin posts to a group and every current member is
// notified over the chosen channels (email / WhatsApp, SMS fallback). The
// announcement also shows in the member app's Groups tab for members of the
// group.
router.post('/:id/announce', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { title, body, channels = [] } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Announcement title is required' });
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Announcement message is required' });
  const picked = (Array.isArray(channels) ? channels : []).filter((ch) => ch === 'email' || ch === 'sms' || ch === 'whatsapp');
  if (picked.length === 0) return res.status(400).json({ error: 'Pick at least one channel (email, SMS or WhatsApp)' });
  try {
    assertDeliveryReady(picked);
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }

  const { rows } = await query('SELECT * FROM groups WHERE id = $1', [req.params.id]);
  const g = rows[0];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  const scope = resolveScope(req);
  if (scope && g.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  const church = resolveChurch(req);
  if (church && g.church_id !== church) return res.status(403).json({ error: 'Out of scope' });

  const memberIds = g.member_ids || [];
  const members = memberIds.length
    ? (await query('SELECT id, first_name, last_name, email, phone FROM members WHERE id = ANY($1)', [memberIds])).rows
    : [];

  const id = genId('an');
  const { rows: inserted } = await query(
    `INSERT INTO announcements (id,title,body,audience,channels,recipients,church_id,group_id,status,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published',now()) RETURNING *`,
    [id, String(title).trim(), String(body).trim(), g.id, picked, members.length, g.church_id || church || 'ch1', g.id]
  );

  const delivered = await sendGroupAnnouncement({
    group: { name: g.name },
    members,
    announcement: { title: String(title).trim(), body: String(body).trim(), channels: picked },
  });

  // Reach summary so the admin sees how many group members can actually be
  // contacted over the chosen channels and how many have no contact on file.
  const reach = {
    members: members.length,
    withEmail: members.filter((x) => x.email && String(x.email).trim()).length,
    withPhone: members.filter((x) => x.phone && String(x.phone).trim()).length,
    withoutContact: members.filter((x) => !x.email && !x.phone).length,
  };

  res.status(201).json({ announcement: mapAnnouncement(inserted[0]), delivered, reach });
}));

export default router;
