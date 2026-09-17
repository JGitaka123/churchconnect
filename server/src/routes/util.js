import crypto from 'node:crypto';
import { query } from '../db/pool.js';

// Prefix + short random id, stable and URL-safe.
export const genId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

// Row mappers: DB snake_case -> API camelCase (matches the frontend's shapes).
export const mapMember = (r) => ({
  id: r.id, branchId: r.branch_id, firstName: r.first_name, lastName: r.last_name,
  email: r.email || '', phone: r.phone || '', familyId: r.family_id, familyRole: r.family_role,
  familyName: r.family_name || '', familyContactName: r.family_contact_name || '',
  familyContactPhone: r.family_contact_phone || '', familyContactEmail: r.family_contact_email || '',
  engagement_score: r.engagement_score, volunteer_skills: r.volunteer_skills || [],
  spiritualMilestones: r.spiritual_milestones || [],
  rolePosition: r.role_position || null, maritalStatus: r.marital_status || null, age: r.age == null ? null : r.age,
  expectations: r.expectations || null, previousExperience: r.previous_experience || null,
  familyMembers: Array.isArray(r.family_members) ? r.family_members : [],
  pledgeAmount: r.pledge_amount == null ? null : Number(r.pledge_amount),
  pledgePaid: Number(r.pledge_paid || 0),
  pledgeCampaignId: r.pledge_campaign_id || null,
  pledges: Array.isArray(r.pledges) ? r.pledges : [],
  branchName: r.branch_name || undefined,
});

export const mapTx = (r) => ({
  id: r.id, branchId: r.branch_id, branchName: r.branch_name || undefined, memberId: r.member_id,
  memberName: r.member_name, amount: Number(r.amount), category: r.category,
  date: r.date instanceof Date ? `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}-${String(r.date.getDate()).padStart(2, '0')}` : r.date,
  paymentMethod: r.payment_method, receiptNumber: r.receipt_number,
  campaignId: r.campaign_id || null,
});

export const mapGroup = (r) => ({
  id: r.id, branchId: r.branch_id, name: r.name, schedule: r.schedule,
  description: r.description, memberIds: r.member_ids || [],
  pendingMemberIds: r.pending_member_ids || [],
});

export const mapFollowup = (r) => ({
  id: r.id, branchId: r.branch_id, name: r.name, stage: r.stage, owner: r.owner, note: r.note,
  maritalStatus: r.marital_status || null, age: r.age == null ? null : r.age,
  expectations: r.expectations || null, previousActivity: r.previous_activity || null,
  contributed: r.contributed == null ? null : Number(r.contributed),
  contact: r.contact || null,
  assimilatedAt: r.assimilated_at || null,
  visitedDate: r.created_at instanceof Date ? r.created_at.toISOString().split('T')[0] : (r.created_at ? String(r.created_at).slice(0, 10) : null),
});

export const mapCareMessage = (r) => ({
  id: r.id, branchId: r.branch_id, title: r.title, body: r.body, author: r.author,
  sentAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
});

export const mapAnnouncement = (r) => ({
  id: r.id, title: r.title, body: r.body, audience: r.audience, groupId: r.group_id || null, channels: r.channels || [],
  recipients: r.recipients, sentAt: r.sent_at,
  status: r.status || 'published',
  suggestedBy: r.suggested_by, suggestedName: r.suggested_name,
  approvedBy: r.approved_by, approvedAt: r.approved_at,
  rejectedReason: r.rejected_reason, createdAt: r.created_at,
});

export const mapPrayer = (r) => ({
  id: r.id, memberId: r.member_id, memberName: r.member_name, branchName: r.branch_name,
  text: r.text, category: r.category, route: r.route, status: r.status,
});

export const mapEvent = (r) => ({
  id: r.id, branchId: r.branch_id, title: r.title, description: r.description,
  date: r.date instanceof Date ? `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}-${String(r.date.getDate()).padStart(2, '0')}` : r.date,
  time: r.time, rolesRequired: r.roles_required || [], volunteersSignedUp: r.volunteers_signed_up || [],
  rsvpMemberIds: r.rsvp_member_ids || [],
});

export const mapCampaign = (r) => ({
  id: r.id, name: r.name, goal: Number(r.goal), raisedOffset: Number(r.raised_offset),
  fundCategory: r.fund_category, branchId: r.branch_id,
});

export const mapRecurringGift = (r) => ({
  id: r.id, memberId: r.member_id, memberName: r.member_name, branchId: r.branch_id,
  branchName: r.branch_name || undefined, amount: Number(r.amount), category: r.category,
  frequency: r.frequency, method: r.method,
  nextDate: r.next_date instanceof Date ? r.next_date.toISOString().split('T')[0] : r.next_date,
  active: r.active,
});

// Resolve the signed-in user's directory member id. Registration stores the
// same email, while the seeded John Kamau account uses a different email, so
// fall back to name+branch to keep self-service member writes working.
export async function findMemberIdForUser(user) {
  if (!user) return null;
  if (user.email) {
    // Prefer the member record on the SAME campus as the account. The same
    // email can legitimately exist on two branches (e.g. a transferred member),
    // and matching without a branch could point a user at another campus's
    // profile, giving history and group announcements.
    const { rows } = user.branchId
      ? await query(
          'SELECT id FROM members WHERE lower(email) = lower($1) AND branch_id = $2 ORDER BY created_at LIMIT 1',
          [user.email, user.branchId]
        )
      : await query('SELECT id FROM members WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1', [user.email]);
    if (rows[0]) return rows[0].id;
  }
  const parts = String(user.name || '').trim().split(/\s+/);
  if (parts.length >= 2 && user.branchId) {
    const { rows } = await query(
      'SELECT id FROM members WHERE branch_id=$1 AND lower(first_name)=lower($2) AND lower(last_name)=lower($3) ORDER BY created_at LIMIT 1',
      [user.branchId, parts[0], parts.slice(1).join(' ')]
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

// Wrap an async route so thrown errors reach the error middleware.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// First branch of a church (used when a write omits branch_id). Falls back to
// the default church when none is given.
export async function defaultBranchForChurch(churchId) {
  const { rows } = await query(
    'SELECT id FROM branches WHERE church_id = $1 ORDER BY id LIMIT 1',
    [churchId || 'ch1']
  );
  return rows[0]?.id || null;
}

// Validate a branch exists and (when a church is enforced) belongs to it.
// Returns { branchId, churchId } on success or { error } on failure.
export async function resolveBranch(branchId, churchId) {
  const { rows } = await query('SELECT id, church_id FROM branches WHERE id = $1', [branchId]);
  const b = rows[0];
  if (!b) return { error: 'Unknown branch' };
  if (churchId && b.church_id !== churchId) return { error: 'Out of scope' };
  return { branchId: b.id, churchId: b.church_id };
}
