import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope, requireRole } from '../auth.js';
import { genId, mapPrayer, wrap } from './util.js';

const router = Router();

// Prayer requests are scoped by campus (sensitive pastoral content).
router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const params = []; const where = [];
  if (scope) {
    const { rows: b } = await query('SELECT name FROM branches WHERE id=$1', [scope]);
    params.push(b[0]?.name || '');
    where.push(`branch_name = $${params.length}`);
  }
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM prayer_requests ${clause} ORDER BY created_at DESC`, params);
  res.json(rows.map(mapPrayer));
}));

// Members submit prayer requests from the mobile app.
router.post('/', wrap(async (req, res) => {
  const { memberId, memberName, branchName, text, category, route } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Prayer text is required' });

  // Attribute the request to the member's church when known, else the caller's.
  let churchId = resolveChurch(req) || 'ch1';
  let fallbackBranch = branchName || '';
  if (memberId) {
    const { rows: m } = await query('SELECT church_id, branch_id FROM members WHERE id=$1', [memberId]);
    if (m[0]) {
      churchId = m[0].church_id || churchId;
      if (!fallbackBranch) {
        const { rows: b } = await query('SELECT name FROM branches WHERE id=$1', [m[0].branch_id]);
        fallbackBranch = b[0]?.name || '';
      }
    }
  }
  const { rows } = await query(
    `INSERT INTO prayer_requests (id,member_id,member_name,branch_name,text,category,route,status,church_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Assigned',$8) RETURNING *`,
    [genId('pr'), memberId || null, memberName || 'Member', fallbackBranch || 'Nairobi CBD', text, category || 'General', route || 'Pastoral Care Team', churchId]
  );
  res.status(201).json(mapPrayer(rows[0]));
}));

// Approve/dismiss removes it from the active inbox.
router.delete('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const church = resolveChurch(req);
  const params = [req.params.id];
  let where = 'id = $1';
  if (church) { params.push(church); where += ` AND church_id = $${params.length}`; }
  await query(`DELETE FROM prayer_requests WHERE ${where}`, params);
  res.json({ ok: true });
}));

export default router;
