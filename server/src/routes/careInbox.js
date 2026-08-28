import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope, requireRole } from '../auth.js';
import { defaultBranchForChurch, genId, mapCareMessage, resolveBranch, wrap } from './util.js';

const router = Router();

// Care messages posted by church staff for the member AI Care inbox. Scoped to
// the caller's campus so members only ever see their own campus's posts.
router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const params = []; const where = [];
  if (scope) { params.push(scope); where.push(`branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM care_inbox ${clause} ORDER BY created_at DESC`, params);
  res.json(rows.map(mapCareMessage));
}));

// Staff post a care message that is inboxed to members of the target campus.
router.post('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { title, body, branchId } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Care message body is required' });
  let target = scope || branchId;
  if (!target) target = await defaultBranchForChurch(church);
  if (!target) return res.status(400).json({ error: 'branchId is required - this church has no branches yet' });
  const resolved = await resolveBranch(target, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const { rows } = await query(
    'INSERT INTO care_inbox (id,branch_id,church_id,title,body,author) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [genId('ci'), resolved.branchId, resolved.churchId, title ? String(title).trim() : null, String(body).trim(), req.user.name || 'Church Care Team']
  );
  res.status(201).json(mapCareMessage(rows[0]));
}));

// Edit a previously posted care message.
router.patch('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM care_inbox WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Care message not found' });
  const church = resolveChurch(req);
  if (church && rows[0].church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  const { title, body } = req.body || {};
  const nextTitle = title !== undefined ? String(title).trim() : rows[0].title;
  const nextBody = body !== undefined ? String(body).trim() : rows[0].body;
  if (!nextBody) return res.status(400).json({ error: 'Care message body is required' });
  const { rows: updated } = await query(
    'UPDATE care_inbox SET title=$1, body=$2, updated_at=now() WHERE id=$3 RETURNING *',
    [nextTitle, nextBody, req.params.id]
  );
  res.json(mapCareMessage(updated[0]));
}));

// Remove a care message from the member inbox.
router.delete('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { rows } = await query('SELECT id, church_id FROM care_inbox WHERE id=$1', [req.params.id]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'Care message not found' });
  const church = resolveChurch(req);
  if (church && c.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  await query('DELETE FROM care_inbox WHERE id=$1', [c.id]);
  res.json({ ok: true });
}));

export default router;
