import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope } from '../auth.js';
import { defaultBranchForChurch, genId, mapRecurringGift, resolveBranch, wrap } from './util.js';

const router = Router();
const FREQUENCIES = new Set(['weekly', 'monthly']);

router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const params = [];
  const where = [];
  if (scope) { params.push(scope); where.push(`rg.branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`rg.church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT rg.*, b.name AS branch_name FROM recurring_gifts rg JOIN branches b ON b.id = rg.branch_id ${clause} ORDER BY rg.next_date`,
    params
  );
  res.json(rows.map(mapRecurringGift));
}));

router.post('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { memberId, memberName, branchId, amount, category, frequency, method, nextDate } = req.body || {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'A valid amount greater than 0 is required' });
  if (!FREQUENCIES.has(frequency)) return res.status(400).json({ error: 'frequency must be weekly or monthly' });

  let targetBranch = scope || branchId;
  let name = memberName || 'Anonymous';
  if (memberId && memberId !== 'anonymous') {
    const { rows } = await query('SELECT branch_id, church_id, first_name, last_name FROM members WHERE id=$1', [memberId]);
    if (rows[0]) {
      if (scope && rows[0].branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
      if (church && rows[0].church_id !== church) return res.status(403).json({ error: 'Out of scope' });
      targetBranch = scope || rows[0].branch_id;
      name = `${rows[0].first_name} ${rows[0].last_name}`;
    }
  }
  if (!targetBranch) targetBranch = await defaultBranchForChurch(church);
  if (!targetBranch) return res.status(400).json({ error: 'branchId is required - this church has no branches yet' });
  const resolved = await resolveBranch(targetBranch, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  const parsedNext = nextDate ? new Date(nextDate) : null;
  const next = parsedNext && !Number.isNaN(parsedNext.getTime())
    ? parsedNext.toISOString().split('T')[0]
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() + (frequency === 'weekly' ? 7 : 30));
        return d.toISOString().split('T')[0];
      })();

  const { rows } = await query(
    `INSERT INTO recurring_gifts (id,member_id,member_name,branch_id,church_id,amount,category,frequency,method,next_date,active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING *`,
    [genId('rec'), memberId && memberId !== 'anonymous' ? memberId : null, name, resolved.branchId, resolved.churchId, amt, category || 'Offering', frequency, method || 'M-Pesa', next]
  );
  const { rows: b } = await query('SELECT name FROM branches WHERE id=$1', [resolved.branchId]);
  res.status(201).json(mapRecurringGift({ ...rows[0], branch_name: b[0]?.name }));
}));

export default router;
