import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveChurch, resolveScope } from '../auth.js';
import { wrap } from './util.js';

const router = Router();

// Scoped dashboard metrics, all derived from real records (no fabricated data).
router.get('/summary', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const church = resolveChurch(req);

  // Each metric set is filtered by branch scope and church tenancy. The branch
  // tables carry church_id, but we join branches so the filter reads naturally
  // and stays correct even if a legacy row has a mismatched column value.
  const txClause = buildClause(['t', 'b'], scope, church);
  const attClause = buildClause(['a', 'b'], scope, church);
  const memClause = buildClause(['m', 'b'], scope, church);

  const [tx, att, members] = await Promise.all([
    query(`SELECT t.amount, t.date, t.category, t.member_id FROM transactions t JOIN branches b ON b.id = t.branch_id ${txClause.sql}`, txClause.params),
    query(`SELECT a.service_date, a.present, a.member_id FROM attendance a JOIN branches b ON b.id = a.branch_id ${attClause.sql}`, attClause.params),
    query(`SELECT m.id FROM members m JOIN branches b ON b.id = m.branch_id ${memClause.sql}`, memClause.params),
  ]);

  const now = Date.now();
  const day = 86400000;
  let thisWeek = 0, lastWeek = 0;
  const givers = new Set();
  const funds = {};
  for (const t of tx.rows) {
    const ageDays = (now - new Date(t.date).getTime()) / day;
    const amt = Number(t.amount);
    if (ageDays <= 7) { thisWeek += amt; if (t.member_id) givers.add(t.member_id); funds[t.category] = (funds[t.category] || 0) + amt; }
    else if (ageDays <= 14) { lastWeek += amt; }
  }
  const givingPct = lastWeek > 0 ? (((thisWeek - lastWeek) / lastWeek) * 100).toFixed(1) : null;

  // Attendance per service date
  const byDate = {};
  const byMember = {};
  for (const a of att.rows) {
    const d = a.service_date instanceof Date ? a.service_date.toISOString().split('T')[0] : a.service_date;
    byDate[d] = byDate[d] || 0;
    if (a.present) byDate[d] += 1;
    (byMember[a.member_id] = byMember[a.member_id] || []).push({ d, present: a.present });
  }
  const dates = Object.keys(byDate).sort();
  const latest = dates.length ? byDate[dates[dates.length - 1]] : 0;
  const avg = dates.length ? Math.round(dates.reduce((s, d) => s + byDate[d], 0) / dates.length) : 0;

  // At-risk: last 3 services all absent
  let atRisk = 0;
  for (const mid of Object.keys(byMember)) {
    const recs = byMember[mid].sort((a, b) => a.d.localeCompare(b.d)).slice(-3);
    if (recs.length >= 3 && recs.every((r) => !r.present)) atRisk += 1;
  }

  const topFund = Object.keys(funds).sort((a, b) => funds[b] - funds[a])[0] || null;

  res.json({
    thisWeekGiving: Math.round(thisWeek * 100) / 100,
    givingChangePct: givingPct, // null when no prior-week baseline
    avgAttendance: avg,
    latestAttendance: latest,
    activeMembers: members.rows.length,
    participationPct: members.rows.length ? Math.round((givers.size / members.rows.length) * 100) : 0,
    topFund,
    atRiskCount: atRisk,
  });
}));

// Build a WHERE clause from a branch scope and/or church scope. `aliases` maps
// the table alias and its branch join alias for the query being built.
function buildClause(aliases, scope, church) {
  const [table, branch] = aliases;
  const params = [];
  const where = [];
  if (scope) { params.push(scope); where.push(`${table}.branch_id = $${params.length}`); }
  if (church) { params.push(church); where.push(`${branch}.church_id = $${params.length}`); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export default router;
