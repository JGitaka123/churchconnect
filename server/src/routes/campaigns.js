import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope, requireRole } from '../auth.js';
import { defaultBranchForChurch, genId, mapCampaign, resolveBranch, wrap } from './util.js';

const router = Router();

// Projects / pledge campaigns, always scoped to the caller's church (and
// branch when a campus is targeted).
router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const params = []; const where = [];
  if (scope) { params.push(scope); where.push(`branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM campaigns ${clause} ORDER BY name`, params);
  res.json(rows.map(mapCampaign));
}));

// Create a project/campaign. Church admins; defaults to their campus when no
// branch is given, and always lands in their own church.
router.post('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const { name, goal, raisedOffset, fundCategory, branchId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Campaign name is required' });
  const goalNum = Number(goal);
  if (!Number.isFinite(goalNum) || goalNum < 0) return res.status(400).json({ error: 'A valid goal is required' });
  const offsetNum = Number(raisedOffset);
  if (!Number.isFinite(offsetNum) || offsetNum < 0) return res.status(400).json({ error: 'A valid raised offset is required' });

  const scope = resolveScope(req);
  const church = resolveChurch(req);
  let target = scope || branchId;
  if (!target) target = await defaultBranchForChurch(church);
  if (!target) return res.status(400).json({ error: 'branchId is required - this church has no branches yet' });
  const resolved = await resolveBranch(target, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  const id = genId('cmp');
  const { rows } = await query(
    `INSERT INTO campaigns (id, name, goal, raised_offset, fund_category, branch_id, church_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, String(name).trim(), goalNum, offsetNum, fundCategory || 'Project Donation', resolved.branchId, resolved.churchId]
  );
  res.status(201).json(mapCampaign(rows[0]));
}));

// Update a project's name, goal, offset, category or campus.
router.patch('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM campaigns WHERE id=$1', [req.params.id]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  const church = resolveChurch(req);
  if (church && c.church_id !== church) return res.status(403).json({ error: 'Out of scope' });

  const body = req.body || {};
  const sets = []; const params = [];
  const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return res.status(400).json({ error: 'Campaign name is required' });
    push('name', String(body.name).trim());
  }
  if (body.goal !== undefined) {
    const n = Number(body.goal);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'A valid goal is required' });
    push('goal', n);
  }
  if (body.raisedOffset !== undefined) {
    const n = Number(body.raisedOffset);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'A valid raised offset is required' });
    push('raised_offset', n);
  }
  if (body.fundCategory !== undefined) push('fund_category', body.fundCategory ? String(body.fundCategory).trim() : null);
  if (body.branchId !== undefined) {
    const resolved = await resolveBranch(body.branchId, church);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    push('branch_id', resolved.branchId);
  }
  if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
  params.push(c.id);
  const { rows: updated } = await query(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  res.json(mapCampaign(updated[0]));
}));

// Delete a project. Money already received stays on the giving ledger.
router.delete('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT id, church_id FROM campaigns WHERE id=$1', [req.params.id]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  const church = resolveChurch(req);
  if (church && c.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  await query('DELETE FROM campaigns WHERE id=$1', [c.id]);
  res.json({ ok: true });
}));

export default router;