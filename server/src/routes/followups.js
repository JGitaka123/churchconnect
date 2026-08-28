import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope, requireRole } from '../auth.js';
import { defaultBranchForChurch, genId, mapFollowup, resolveBranch, wrap } from './util.js';

const router = Router();
const STAGES = ['New Guest', 'Contacted', 'Connected', 'Member'];

router.get('/', wrap(async (req, res) => {
  // Assimilated guests auto-convert to permanent members after 1 month and
  // leave the pipeline, so the board never shows stale "Member" cards.
  await pruneExpiredAssimilated();
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const params = []; const where = [];
  if (scope) { params.push(scope); where.push(`branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM followups ${clause} ORDER BY created_at DESC`, params);
  res.json(rows.map(mapFollowup));
}));

router.post('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { name, owner, branchId, maritalStatus, age, expectations, previousActivity, contributed, contact } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Guest name is required' });
  let target = scope || branchId;
  if (!target) target = await defaultBranchForChurch(church);
  if (!target) return res.status(400).json({ error: 'branchId is required - this church has no branches yet' });
  const resolved = await resolveBranch(target, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const cleanAge = (age === undefined || age === null || age === '' || isNaN(Number(age))) ? null : Math.max(1, Math.min(130, Math.round(Number(age))));
  const cleanContributed = (contributed === undefined || contributed === null || contributed === '' || isNaN(Number(contributed))) ? null : Math.max(0, Number(contributed));
  const { rows } = await query(
    'INSERT INTO followups (id,branch_id,church_id,name,stage,owner,note,marital_status,age,expectations,previous_activity,contributed,contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
    [genId('fu'), resolved.branchId, resolved.churchId, name, 'New Guest', owner || 'Unassigned', '', maritalStatus || null, cleanAge, expectations || null, previousActivity || null, cleanContributed, contact ? String(contact).trim() : null]
  );
  res.status(201).json(mapFollowup(rows[0]));
}));

// Advance/regress a guest through the pipeline. Reaching the final Member
// stage also enrolls the guest in the member directory (once).
router.patch('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { stage } = req.body || {};
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const { rows } = await query('SELECT * FROM followups WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Follow-up not found' });
  const fu = rows[0];
  const church = resolveChurch(req);
  if (church && fu.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  // Reaching "Member" stamps the assimilation date so the card can be
  // auto-removed once the guest is a permanent member (after 1 month).
  const { rows: updated } = stage === 'Member'
    ? await query('UPDATE followups SET stage=$1, assimilated_at=COALESCE(assimilated_at, now()) WHERE id=$2 RETURNING *', [stage, fu.id])
    : await query('UPDATE followups SET stage=$1 WHERE id=$2 RETURNING *', [stage, fu.id]);
  let memberId = null;
  if (stage === 'Member') {
    const m = await assimilateGuest(fu);
    if (m) memberId = m.id;
  }
  res.json({ ...mapFollowup(updated[0]), memberId });
}));

// Remove a one-time visitor from the pipeline entirely.
router.delete('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { rows } = await query('SELECT * FROM followups WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Follow-up not found' });
  const fu = rows[0];
  if (scope && fu.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  if (church && fu.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  await query('DELETE FROM followups WHERE id=$1', [req.params.id]);
  res.json({ ok: true, id: req.params.id });
}));

// Enroll an assimilated guest in the members directory. Reuses an existing
// record with the same name + campus so re-advancing the card never duplicates.
async function assimilateGuest(fu) {
  const name = String(fu.name || '').trim();
  if (!name) return null;
  const parts = name.split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  const { rows: existing } = await query(
    'SELECT m.*, b.name AS branch_name FROM members m JOIN branches b ON b.id=m.branch_id WHERE m.branch_id=$1 AND lower(m.first_name)=lower($2) AND lower(m.last_name)=lower($3) LIMIT 1',
    [fu.branch_id, firstName, lastName]
  );
  if (existing[0]) return existing[0];
  const id = genId('m');
  const { rows: created } = await query(
    `INSERT INTO members (id,branch_id,church_id,first_name,last_name,engagement_score,spiritual_milestones,marital_status,age,expectations,previous_experience)
     VALUES ($1,$2,$3,$4,$5,60,$6,$7,$8,$9,$10) RETURNING *`,
    [id, fu.branch_id, fu.church_id || 'ch1', firstName, lastName, [`Member: ${new Date().toISOString().split('T')[0]}`], fu.marital_status || null, fu.age == null ? null : fu.age, fu.expectations || null, fu.previous_activity || null]
  );
  const { rows: b } = await query('SELECT name FROM branches WHERE id=$1', [fu.branch_id]);
  return { ...created[0], branch_name: b[0]?.name };
}


// Assimilated guests become permanent members after 1 month: their follow-up
// card is removed automatically and they stay in the members directory for
// good. Safe to run on every read and on a timer.
export async function pruneExpiredAssimilated() {
  // Backfill the 1-month clock for cards already at "Member" before this
  // column existed - they count from when they entered the pipeline.
  await query(`UPDATE followups SET assimilated_at = created_at WHERE stage = 'Member' AND assimilated_at IS NULL`);
  const { rows } = await query(
    `SELECT id, branch_id, name FROM followups
     WHERE stage = 'Member' AND assimilated_at IS NOT NULL AND assimilated_at <= now() - interval '1 month'`
  );
  if (!rows.length) return 0;
  const when = new Date().toISOString().split('T')[0];
  for (const fu of rows) {
    const parts = String(fu.name || '').trim().split(/\s+/);
    if (parts.length) {
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');
      await query(
        'UPDATE members SET spiritual_milestones = array_append(spiritual_milestones, $1) WHERE branch_id = $2 AND lower(first_name) = lower($3) AND lower(last_name) = lower($4)',
        [`Permanent member: ${when}`, fu.branch_id, firstName, lastName]
      );
    }
    await query('DELETE FROM followups WHERE id = $1', [fu.id]);
  }
  console.log(`[assimilation] ${rows.length} assimilated guest(s) became permanent members and left the follow-up pipeline`);
  return rows.length;
}

export default router;
