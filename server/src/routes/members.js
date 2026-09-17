import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope, requireRole } from '../auth.js';
import { defaultBranchForChurch, findMemberIdForUser, genId, mapMember, resolveBranch, wrap } from './util.js';

const router = Router();

// List members, always scoped to the caller's permitted campus.
router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req); // null = all (HQ global) else branch id
  const church = resolveChurch(req); // null = all churches (platform global)
  const search = (req.query.search || '').toString().trim().toLowerCase();
  const params = [];
  const where = [];
  if (scope) { params.push(scope); where.push(`m.branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`m.church_id = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(lower(m.first_name || ' ' || m.last_name) LIKE ${p} OR lower(coalesce(m.email,'')) LIKE ${p} OR coalesce(m.phone,'') LIKE ${p})`);
  }
  // A member-role account is not the church directory. It may only read its own
  // record (plus anyone linked to the same family), so John's phone never holds
  // another member's email address, phone number or profile.
  if (req.user.role === 'member') {
    const selfId = await findMemberIdForUser(req.user);
    if (!selfId) return res.json([]);
    params.push(selfId);
    const self = `$${params.length}`;
    where.push(`(m.id = ${self} OR (m.family_id IS NOT NULL AND m.family_id = (SELECT family_id FROM members WHERE id = ${self})))`);
  }
  const sql = `SELECT m.*, b.name AS branch_name FROM members m JOIN branches b ON b.id = m.branch_id
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.last_name, m.first_name`;
  const { rows } = await query(sql, params);
  res.json(rows.map(mapMember));
}));

router.get('/:id', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { rows } = await query('SELECT m.*, b.name AS branch_name FROM members m JOIN branches b ON b.id=m.branch_id WHERE m.id=$1', [req.params.id]);
  const m = rows[0];
  if (!m) return res.status(404).json({ error: 'Member not found' });
  if (scope && m.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  if (church && m.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  // Same isolation rule as the list: a member may open their own profile (or a
  // family member's), never another person's record.
  if (req.user.role === 'member') {
    const selfId = await findMemberIdForUser(req.user);
    const { rows: own } = selfId
      ? await query('SELECT family_id FROM members WHERE id=$1', [selfId])
      : { rows: [] };
    const sameFamily = Boolean(m.family_id) && Boolean(own[0]) && m.family_id === own[0].family_id;
    if (m.id !== selfId && !sameFamily) return res.status(403).json({ error: 'Out of scope' });
  }
  res.json(mapMember(m));
}));

// Create a member (admins only). Branch is forced to the caller's scope unless HQ.
router.post('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { firstName, lastName, email, phone, volunteer_skills = [], branchId, familyId, familyRole, familyName, familyContactName, familyContactPhone, familyContactEmail, rolePosition, maritalStatus, age, expectations, previousExperience, familyMembers = [], pledgeAmount, pledgePaid, pledgeCampaignId, pledges } = req.body || {};
  if (!firstName || !lastName) return res.status(400).json({ error: 'First and last name are required' });
  const mail = email ? String(email).trim() : null;
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) {
    return res.status(400).json({ error: 'Enter a valid email address so the member can receive messages and log in.' });
  }
  const pledgeAmt = (pledgeAmount === undefined || pledgeAmount === null || pledgeAmount === '') ? null : Number(pledgeAmount);
  if (pledgeAmt !== null && (!Number.isFinite(pledgeAmt) || pledgeAmt < 0)) {
    return res.status(400).json({ error: 'pledgeAmount must be a non-negative number' });
  }
  const pledgePaidAmt = (pledgePaid === undefined || pledgePaid === null || pledgePaid === '') ? 0 : Number(pledgePaid);
  if (!Number.isFinite(pledgePaidAmt) || pledgePaidAmt < 0) {
    return res.status(400).json({ error: 'pledgePaid must be a non-negative number' });
  }
  let targetBranch = scope || branchId;
  if (!targetBranch) targetBranch = await defaultBranchForChurch(church);
  if (!targetBranch) return res.status(400).json({ error: 'branchId is required - this church has no branches yet' });
  const resolved = await resolveBranch(targetBranch, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const pledgeCamp = await pledgeCampaignFor(pledgeCampaignId, resolved.churchId);
  if (pledgeCamp.error) return res.status(400).json({ error: pledgeCamp.error });
  const pledgeList = await normalisePledges(pledges, resolved.churchId);
  if (pledgeList.error) return res.status(400).json({ error: pledgeList.error });
  const id = genId('m');
  const { rows } = await query(
    `INSERT INTO members (id,branch_id,church_id,first_name,last_name,email,phone,volunteer_skills,engagement_score,family_id,family_role,family_name,family_contact_name,family_contact_phone,family_contact_email,role_position,marital_status,age,expectations,previous_experience,family_members,pledge_amount,pledge_paid,pledge_campaign_id,pledges)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,60,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24::jsonb) RETURNING *`,
    [id, resolved.branchId, resolved.churchId, firstName, lastName, mail, phone || null, Array.isArray(volunteer_skills) ? volunteer_skills : [], familyId || null, familyRole || null, familyName || null, familyContactName || null, familyContactPhone || null, familyContactEmail || null, rolePosition || null, maritalStatus || null, age != null ? Number(age) : null, expectations || null, previousExperience || null, JSON.stringify(Array.isArray(familyMembers) ? familyMembers : []), pledgeAmt, pledgePaidAmt, pledgeCamp.value, JSON.stringify(pledgeList.value)]
  );
  const { rows: b } = await query('SELECT name FROM branches WHERE id=$1', [resolved.branchId]);
  res.status(201).json(mapMember({ ...rows[0], branch_name: b[0]?.name }));
}));

// Update profile data such as volunteer skills and engagement score. Admins and
// ministry leaders can update members in their campus; a member can update only
// the directory record that belongs to their signed-in account.
router.patch('/:id', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { rows } = await query('SELECT * FROM members WHERE id=$1', [req.params.id]);
  const member = rows[0];
  if (!member) return res.status(404).json({ error: 'Member not found' });
  if (scope && member.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  if (church && member.church_id !== church) return res.status(403).json({ error: 'Out of scope' });

  if (req.user.role === 'member') {
    const selfId = await findMemberIdForUser(req.user);
    if (!selfId || selfId !== member.id) return res.status(403).json({ error: 'Members may only update their own profile' });
  }

  const body = req.body || {};
  const sets = [];
  const params = [];
  const push = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (body.firstName !== undefined) push('first_name', String(body.firstName).trim());
  if (body.lastName !== undefined) push('last_name', String(body.lastName).trim());
  if (body.email !== undefined) {
    const newMail = body.email ? String(body.email).trim() : '';
    if (newMail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newMail)) {
      return res.status(400).json({ error: 'Enter a valid email address so the member can receive messages and log in.' });
    }
    push('email', newMail || null);
  }
  if (body.phone !== undefined) push('phone', body.phone ? String(body.phone).trim() : null);
  if (body.volunteer_skills !== undefined) {
    if (!Array.isArray(body.volunteer_skills) || body.volunteer_skills.some((s) => typeof s !== 'string')) {
      return res.status(400).json({ error: 'volunteer_skills must be an array of strings' });
    }
    push('volunteer_skills', [...new Set(body.volunteer_skills.map((s) => s.trim()).filter(Boolean))]);
  }
  if (body.engagement_score !== undefined) {
    const score = Number(body.engagement_score);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: 'engagement_score must be an integer from 0 to 100' });
    }
    push('engagement_score', score);
  }
  if (body.spiritual_milestones !== undefined) {
    if (!Array.isArray(body.spiritual_milestones) || body.spiritual_milestones.some((s) => typeof s !== 'string')) {
      return res.status(400).json({ error: 'spiritual_milestones must be an array of strings' });
    }
    push('spiritual_milestones', [...new Set(body.spiritual_milestones.map((s) => s.trim()).filter(Boolean))]);
  }
  if (body.familyId !== undefined) push('family_id', body.familyId ? String(body.familyId).trim() : null);
  if (body.familyRole !== undefined) push('family_role', body.familyRole ? String(body.familyRole).trim() : null);
  if (body.familyName !== undefined) push('family_name', body.familyName ? String(body.familyName).trim() : null);
  if (body.familyContactName !== undefined) push('family_contact_name', body.familyContactName ? String(body.familyContactName).trim() : null);
  if (body.familyContactPhone !== undefined) push('family_contact_phone', body.familyContactPhone ? String(body.familyContactPhone).trim() : null);
  if (body.familyContactEmail !== undefined) push('family_contact_email', body.familyContactEmail ? String(body.familyContactEmail).trim() : null);
  if (body.familyMembers !== undefined) {
    const fm = Array.isArray(body.familyMembers) ? body.familyMembers : [];
    const clean = fm
      .filter((x) => x && typeof x === 'object' && typeof x.name === 'string' && String(x.name).trim())
      .map((x) => ({ name: String(x.name).trim(), role: x.role ? String(x.role).trim() : '' }));
    params.push(JSON.stringify(clean));
    sets.push(`family_members = $${params.length}::jsonb`);
  }
  if (body.rolePosition !== undefined) push('role_position', body.rolePosition ? String(body.rolePosition).trim() : null);
  if (body.maritalStatus !== undefined) push('marital_status', body.maritalStatus ? String(body.maritalStatus).trim() : null);
  if (body.age !== undefined) {
    const ageNum = Number(body.age);
    if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 130) {
      return res.status(400).json({ error: 'age must be an integer from 0 to 130' });
    }
    push('age', ageNum);
  }
  if (body.expectations !== undefined) push('expectations', body.expectations ? String(body.expectations).trim() : null);
  if (body.previousExperience !== undefined) push('previous_experience', body.previousExperience ? String(body.previousExperience).trim() : null);
  if (body.pledgeAmount !== undefined) {
    const pledgeAmt = (body.pledgeAmount === null || body.pledgeAmount === '') ? null : Number(body.pledgeAmount);
    if (pledgeAmt !== null && (!Number.isFinite(pledgeAmt) || pledgeAmt < 0)) {
      return res.status(400).json({ error: 'pledgeAmount must be a non-negative number' });
    }
    push('pledge_amount', pledgeAmt);
  }
  if (body.pledgePaid !== undefined) {
    const pledgePaidAmt = Number(body.pledgePaid);
    if (!Number.isFinite(pledgePaidAmt) || pledgePaidAmt < 0) {
      return res.status(400).json({ error: 'pledgePaid must be a non-negative number' });
    }
    push('pledge_paid', pledgePaidAmt);
  }
  // The project this pledge is for, chosen by the member in the app (or cleared
  // back to a general pledge with null/empty).
  if (body.pledgeCampaignId !== undefined) {
    const camp = await pledgeCampaignFor(body.pledgeCampaignId, member.church_id);
    if (camp.error) return res.status(400).json({ error: camp.error });
    push('pledge_campaign_id', camp.value);
  }
  // The per-project breakdown of the member's promise(s). A member pledges to
  // as many projects as they like, one entry each.
  if (body.pledges !== undefined) {
    const list = await normalisePledges(body.pledges, member.church_id);
    if (list.error) return res.status(400).json({ error: list.error });
    params.push(JSON.stringify(list.value));
    sets.push(`pledges = $${params.length}::jsonb`);
  }

  if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
  params.push(member.id);
  const { rows: updated } = await query(
    `UPDATE members SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  const { rows: b } = await query('SELECT name FROM branches WHERE id=$1', [member.branch_id]);
  res.json(mapMember({ ...updated[0], branch_name: b[0]?.name }));
}));

// Remove a member: attendance rows cascade, transactions keep history with
// member_id set to NULL, and group rosters drop the removed id.
router.delete('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);
  const { rows } = await query('SELECT * FROM members WHERE id=$1', [req.params.id]);
  const member = rows[0];
  if (!member) return res.status(404).json({ error: 'Member not found' });
  if (scope && member.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  if (church && member.church_id !== church) return res.status(403).json({ error: 'Out of scope' });
  await query('UPDATE groups SET member_ids = array_remove(member_ids, $1) WHERE $1 = ANY(member_ids)', [req.params.id]);
  await query('DELETE FROM members WHERE id=$1', [req.params.id]);
  res.json({ ok: true, id: req.params.id });
}));

// A pledge can be tied to one project. The project must exist and belong to the
// same church as the member, so a pledge can never point at another church's
// campaign, and a stale project id is refused instead of stored.
async function pledgeCampaignFor(campaignId, churchId) {
  const id = campaignId ? String(campaignId).trim() : '';
  if (!id) return { value: null };
  const { rows } = await query('SELECT id, church_id FROM campaigns WHERE id=$1', [id]);
  const camp = rows[0];
  if (!camp) return { error: 'That project no longer exists - pick another one.' };
  if (churchId && camp.church_id !== churchId) return { error: 'That project belongs to another church.' };
  return { value: camp.id };
}

// A member may pledge to several projects at once, so the promise is stored as
// a list of {campaignId, amount}. Every project must belong to the same church
// as the member, no project may appear twice, and at most one entry may be the
// "general" promise that is not tied to any project.
async function normalisePledges(list, churchId) {
  if (!Array.isArray(list)) return { error: 'pledges must be a list of project pledges' };
  const out = [];
  const seen = new Set();
  let general = 0;
  for (const raw of list) {
    const amount = Number(raw && raw.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Each pledge needs an amount greater than 0' };
    const camp = await pledgeCampaignFor(raw && raw.campaignId, churchId);
    if (camp.error) return { error: camp.error };
    if (!camp.value) {
      general = Math.max(general, amount);
      continue;
    }
    if (seen.has(camp.value)) return { error: 'The same project appears twice in the pledge list' };
    seen.add(camp.value);
    out.push({ campaignId: camp.value, amount });
  }
  if (general > 0) out.push({ campaignId: null, amount: general });
  return { value: out };
}

export default router;
