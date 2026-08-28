import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, requireRole } from '../auth.js';
import { genId, mapAnnouncement, wrap } from './util.js';

const router = Router();

const ADMIN_ROLES = ['hq_admin', 'branch_admin', 'platform_admin'];

// List announcements. Admins see every status; everyone else sees only the
// published feed (approved by an admin, or broadcast directly).
router.get('/', wrap(async (req, res) => {
  const church = resolveChurch(req);
  const params = [];
  const where = [];
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
    params.push('approved', 'published');
    where.push(`status IN ($${params.length - 1}, $${params.length})`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM announcements ${clause} ORDER BY created_at DESC, sent_at DESC`, params);
  res.json(rows.map(mapAnnouncement));
}));

// Send a broadcast directly (admin). Published immediately - no moderation.
router.post('/', requireRole(...ADMIN_ROLES), wrap(async (req, res) => {
  const { title, body, audience = 'all', channels = [] } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required' });
  if (!Array.isArray(channels) || channels.length === 0) return res.status(400).json({ error: 'Pick at least one channel' });

  const church = resolveChurch(req);
  const scope = audience === 'all' ? null : audience;
  const params = [];
  const where = [];
  if (scope) { params.push(scope); where.push(`branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countSql = await query(`SELECT count(*)::int AS n FROM members ${clause}`, params);
  const recipients = countSql.rows[0].n;

  const { rows } = await query(
    `INSERT INTO announcements (id,title,body,audience,channels,recipients,church_id,status,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'published',now()) RETURNING *`,
    [genId('an'), title, body, audience, channels, recipients, church || 'ch1']
  );
  res.status(201).json(mapAnnouncement(rows[0]));
}));

// Member suggestion -> routed to the admin dashboard as "pending".
router.post('/suggest', wrap(async (req, res) => {
  const { title, body, audience = 'all', channels = ['push'] } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required' });
  if (typeof body !== 'string' || body.length > 2000) return res.status(400).json({ error: 'Message is too long (max 2000 characters)' });

  const church = resolveChurch(req);
  const { rows } = await query(
    `INSERT INTO announcements (id,title,body,audience,channels,recipients,church_id,status,suggested_by,suggested_name,created_at)
     VALUES ($1,$2,$3,$4,$5,0,$6,'pending',$7,$8,now()) RETURNING *`,
    [genId('an'), String(title).slice(0, 200), body, audience, channels, church || 'ch1', String(req.user.sub), req.user.name || req.user.email]
  );
  res.status(201).json(mapAnnouncement(rows[0]));
}));

// Admin: approve a pending suggestion -> published to the congregation.
router.post('/:id/approve', requireRole(...ADMIN_ROLES), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM announcements WHERE id = $1', [req.params.id]);
  const ann = rows[0];
  if (!ann) return res.status(404).json({ error: 'Announcement not found' });
  if (ann.status !== 'pending') return res.status(400).json({ error: 'Only pending suggestions can be approved' });

  const church = resolveChurch(req);
  const scope = ann.audience === 'all' ? null : ann.audience;
  const params = [];
  const where = [];
  if (scope) { params.push(scope); where.push(`branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`church_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countSql = await query(`SELECT count(*)::int AS n FROM members ${clause}`, params);
  const recipients = countSql.rows[0].n;

  const upd = await query(
    `UPDATE announcements SET status='approved', recipients=$2, approved_by=$3, approved_at=now(), rejected_reason=NULL
     WHERE id=$1 RETURNING *`,
    [ann.id, recipients, req.user.name || req.user.email]
  );
  res.json(mapAnnouncement(upd.rows[0]));
}));

// Admin: reject a pending suggestion (optional public reason).
router.post('/:id/reject', requireRole(...ADMIN_ROLES), wrap(async (req, res) => {
  const reason = String((req.body || {}).reason || '').slice(0, 500);
  const upd = await query(
    `UPDATE announcements SET status='rejected', rejected_reason=$2, approved_by=$3, approved_at=now()
     WHERE id=$1 AND status='pending' RETURNING *`,
    [req.params.id, reason, req.user.name || req.user.email]
  );
  if (!upd.rows[0]) return res.status(404).json({ error: 'Pending announcement not found' });
  res.json(mapAnnouncement(upd.rows[0]));
}));

export default router;
