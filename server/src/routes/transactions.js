import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope, requireRole } from '../auth.js';
import { defaultBranchForChurch, findMemberIdForUser, genId, mapTx, resolveBranch, wrap } from './util.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const params = [];
  const where = [];
  if (scope) { params.push(scope); where.push(`t.branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`t.church_id = $${params.length}`); }
  // A member-role account only ever receives its own gifts. The campus's other
  // contributions carry the giver's name, amount and receipt, which is not
  // John's data - and no client-side filter can un-send it.
  if (req.user.role === 'member') {
    const selfId = await findMemberIdForUser(req.user);
    if (!selfId) return res.json([]);
    params.push(selfId);
    where.push(`t.member_id = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT t.*, b.name AS branch_name FROM transactions t JOIN branches b ON b.id=t.branch_id ${clause} ORDER BY t.date DESC, t.created_at DESC`,
    params
  );
  res.json(rows.map(mapTx));
}));

// Record a contribution. Admins/ministry leaders; branch forced to scope.
router.post('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader', 'member'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { memberId: requestedMemberId, amount, category, paymentMethod, date, memberName, branchId, campaignId: requestedCampaignId } = req.body || {};
  // A member may only record giving under their own name. Trusting a client
  // supplied memberId would let one account file a gift as somebody else.
  let memberId = requestedMemberId;
  if (req.user.role === 'member') {
    const selfId = await findMemberIdForUser(req.user);
    if (!selfId) return res.status(403).json({ error: 'No member record is linked to this account' });
    memberId = selfId;
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'A valid amount greater than 0 is required' });

  let targetBranch = scope || branchId;
  let name = memberName || 'Anonymous';
  if (memberId && memberId !== 'anonymous') {
    const { rows } = await query('SELECT branch_id, church_id, first_name, last_name FROM members WHERE id=$1', [memberId]);
    if (rows[0]) {
      if (church && rows[0].church_id !== church) return res.status(403).json({ error: 'Out of scope' });
      targetBranch = scope || rows[0].branch_id;
      name = `${rows[0].first_name} ${rows[0].last_name}`;
    }
  }
  if (!targetBranch) targetBranch = await defaultBranchForChurch(church);
  if (!targetBranch) return res.status(400).json({ error: 'branchId is required - this church has no branches yet' });
  const resolved = await resolveBranch(targetBranch, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  // A gift may be earmarked to a project. The project must live in the same
  // church and campus as the gift, otherwise project progress would be wrong.
  let campaignId = null;
  if (requestedCampaignId) {
    const { rows: camp } = await query('SELECT id, church_id, branch_id FROM campaigns WHERE id=$1', [requestedCampaignId]);
    const c = camp[0];
    if (!c) return res.status(400).json({ error: 'That project no longer exists - pick another one.' });
    if (resolved.churchId && c.church_id !== resolved.churchId) return res.status(400).json({ error: 'That project belongs to another church.' });
    if (c.branch_id !== resolved.branchId) return res.status(400).json({ error: 'That project belongs to another campus.' });
    campaignId = c.id;
  }
  const id = genId('t');
  const receipt = `REC-2026-${Math.floor(Math.random() * 90000) + 10000}`;
  const { rows } = await query(
    `INSERT INTO transactions (id,branch_id,church_id,member_id,member_name,amount,category,date,payment_method,receipt_number,campaign_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [id, resolved.branchId, resolved.churchId, memberId && memberId !== 'anonymous' ? memberId : null, name, amt, category || 'Offering', date || new Date().toISOString().split('T')[0], paymentMethod || 'Cash', receipt, campaignId]
  );
  const { rows: b } = await query('SELECT name FROM branches WHERE id=$1', [resolved.branchId]);
  res.status(201).json(mapTx({ ...rows[0], branch_name: b[0]?.name }));
}));

export default router;
