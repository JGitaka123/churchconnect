import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope, requireRole } from '../auth.js';
import { wrap } from './util.js';

const router = Router();

// All attendance records in scope (the client computes per-service views).
router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const params = [];
  const where = [];
  if (scope) { params.push(scope); where.push(`branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM attendance ${clause}`, params);
  res.json(rows.map((r) => ({
    id: r.id, memberId: r.member_id, branchId: r.branch_id,
    date: r.service_date instanceof Date ? r.service_date.toISOString().split('T')[0] : r.service_date,
    present: r.present,
  })));
}));

// Toggle/record a member's attendance for a service date (upsert).
router.put('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { memberId, date, present } = req.body || {};
  if (!memberId || !date) return res.status(400).json({ error: 'memberId and date are required' });
  const { rows: m } = await query('SELECT branch_id, church_id FROM members WHERE id=$1', [memberId]);
  if (!m[0]) return res.status(404).json({ error: 'Member not found' });
  if (scope && m[0].branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  if (church && m[0].church_id !== church) return res.status(403).json({ error: 'Out of scope' });

  const id = `att_${memberId}_${date}`;
  const { rows } = await query(
    `INSERT INTO attendance (id,member_id,branch_id,church_id,service_date,present) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (member_id, service_date) DO UPDATE SET present = EXCLUDED.present RETURNING *`,
    [id, memberId, m[0].branch_id, m[0].church_id, date, Boolean(present)]
  );
  const r = rows[0];
  res.json({ id: r.id, memberId: r.member_id, branchId: r.branch_id, date, present: r.present });
}));

export default router;
