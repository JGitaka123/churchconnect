import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope, requireRole } from '../auth.js';
import { defaultBranchForChurch, findMemberIdForUser, genId, mapEvent, resolveBranch, wrap } from './util.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const params = []; const where = [];
  if (scope) { params.push(scope); where.push(`branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM events ${clause} ORDER BY date`, params);
  res.json(rows.map(mapEvent));
}));

// Post a new upcoming event from the admin dashboard. It starts with an empty
// going-list; members RSVP "Going" to it from the app Home tab.
router.post('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { title, date, time, branchId, description } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Event title is required' });
  if (!date) return res.status(400).json({ error: 'Event date is required' });
  let target = scope || branchId;
  if (!target) target = await defaultBranchForChurch(church);
  if (!target) return res.status(400).json({ error: 'branchId is required - this church has no branches yet' });
  const resolved = await resolveBranch(target, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const id = genId('e');
  const { rows } = await query(
    'INSERT INTO events (id,branch_id,church_id,title,description,date,time,roles_required,volunteers_signed_up,rsvp_member_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
    [id, resolved.branchId, resolved.churchId, String(title).trim(), description || null, date, time || null, [], [], []]
  );
  const { rows: b } = await query('SELECT name FROM branches WHERE id=$1', [resolved.branchId]);
  res.status(201).json(mapEvent({ ...rows[0], branch_name: b[0]?.name }));
}));

// RSVP from the member app: a member says they are "Going" (or withdraws).
// Only the member themself is added to the event's going list.
router.post('/:id/rsvp', wrap(async (req, res) => {
  const { memberId, going } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'memberId is required' });
  const { rows } = await query('SELECT * FROM events WHERE id=$1', [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  if (scope && event.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  if (church && event.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  const { rows: valid } = await query('SELECT id FROM members WHERE id = $1 AND branch_id = $2', [memberId, event.branch_id]);
  if (!valid[0]) return res.status(400).json({ error: 'Member not found on this campus' });
  const rsvps = event.rsvp_member_ids || [];
  const next = going === true
    ? (rsvps.includes(memberId) ? rsvps : [...rsvps, memberId])
    : rsvps.filter((id) => id !== memberId);
  const { rows: updated } = await query('UPDATE events SET rsvp_member_ids=$1 WHERE id=$2 RETURNING *', [next, event.id]);
  res.json(mapEvent(updated[0]));
}));

router.put('/:id/volunteers', wrap(async (req, res) => {
  const { volunteerIds } = req.body || {};
  if (!Array.isArray(volunteerIds)) return res.status(400).json({ error: 'volunteerIds must be an array' });
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { rows } = await query('SELECT * FROM events WHERE id=$1', [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (scope && event.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  if (church && event.church_id !== church) return res.status(403).json({ error: 'Out of scope' });

  const requested = [...new Set(volunteerIds.filter((id) => id && typeof id === 'string'))];
  const { rows: valid } = requested.length
    ? await query('SELECT id FROM members WHERE id = ANY($1) AND branch_id = $2', [requested, event.branch_id])
    : { rows: [] };
  const next = valid.map((r) => r.id);

  // A member-role user may only add/remove themselves on the roster. Admins and
  // ministry leaders can replace the full roster for their campus.
  if (req.user.role === 'member') {
    const selfId = await findMemberIdForUser(req.user);
    if (!selfId) return res.status(403).json({ error: 'Member profile not found' });
    const oldOutsideSelf = (event.volunteers_signed_up || []).filter((id) => id !== selfId);
    const nextOutsideSelf = next.filter((id) => id !== selfId);
    const outsideChanged =
      oldOutsideSelf.length !== nextOutsideSelf.length ||
      oldOutsideSelf.some((id) => !nextOutsideSelf.includes(id)) ||
      nextOutsideSelf.some((id) => !oldOutsideSelf.includes(id));
    if (outsideChanged) return res.status(403).json({ error: 'Members may only update their own roster assignment' });
  }

  const { rows: updated } = await query(
    'UPDATE events SET volunteers_signed_up = $1 WHERE id = $2 RETURNING *',
    [next, event.id]
  );
  res.json(mapEvent(updated[0]));
}));

// Replace the event's full rota: the task/role list plus who is assigned.
// Roles and volunteers are stored together so multi-person roles survive a
// page refresh (the roster is rebuilt from these two arrays).
router.put('/:id/rota', wrap(async (req, res) => {
  const { rolesRequired, volunteersSignedUp } = req.body || {};
  if (!Array.isArray(rolesRequired)) return res.status(400).json({ error: 'rolesRequired must be an array' });
  if (!Array.isArray(volunteersSignedUp)) return res.status(400).json({ error: 'volunteersSignedUp must be an array' });
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { rows } = await query('SELECT * FROM events WHERE id=$1', [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (scope && event.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  if (church && event.church_id !== church) return res.status(403).json({ error: 'Out of scope' });

  const roles = [...new Set(rolesRequired.filter((r) => r && typeof r === 'string').map((r) => String(r).trim()).filter(Boolean))];
  const ids = [...new Set(volunteersSignedUp.filter((id) => id && typeof id === 'string'))];
  const { rows: valid } = ids.length
    ? await query('SELECT id FROM members WHERE id = ANY($1) AND branch_id = $2', [ids, event.branch_id])
    : { rows: [] };
  const nextVolunteers = valid.map((r) => r.id);

  const { rows: updated } = await query(
    'UPDATE events SET roles_required = $1, volunteers_signed_up = $2 WHERE id = $3 RETURNING *',
    [roles, nextVolunteers, event.id]
  );
  res.json(mapEvent(updated[0]));
}));

export default router;
