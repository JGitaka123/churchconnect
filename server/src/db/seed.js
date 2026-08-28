import bcrypt from 'bcryptjs';
import { pool, withTransaction } from './pool.js';
import { migrate } from './migrate.js';
import { config } from '../config.js';

// Seeds the Maximum Miracle Centre dataset used by the app (3 campuses, 10
// members, 4 login
// accounts, giving, attendance, events, groups, etc). Destructive: it wipes and
// repopulates the data tables. Run once after migrate on a fresh database.

const BRANCHES = [
  { id: 'b1', name: 'Nairobi CBD', location: 'Embassy Cinema, Latema Road, off Tom Mboya Street, Nairobi', code: 'NRB' },
  { id: 'b2', name: 'Kawangware', location: 'Kawangware, Nairobi', code: 'KWG' },
  { id: 'b3', name: 'Nakuru', location: 'Langa Langa, Kanu Street, Nakuru', code: 'NKR' },
];

const MEMBERS = [
  { id: 'm1', branch_id: 'b1', first_name: 'John', last_name: 'Kamau', email: 'john.kamau@maximummiracle.org', phone: '+254712345678', family_id: 'fam_kamau', family_role: 'Husband', spiritual_milestones: ['Baptized: 2018-04-12', 'Member: 2019-01-01'], volunteer_skills: ['Worship Vocals', 'Keyboard', 'Guitar'], engagement_score: 95 },
  { id: 'm2', branch_id: 'b1', first_name: 'Mary', last_name: 'Kamau', email: 'mary.kamau@maximummiracle.org', phone: '+254722345678', family_id: 'fam_kamau', family_role: 'Wife', spiritual_milestones: ['Baptized: 2019-06-20'], volunteer_skills: ['Childcare', 'Greeting'], engagement_score: 88 },
  { id: 'm3', branch_id: 'b1', first_name: 'David', last_name: 'Onyango', email: 'david.onyango@email.com', phone: '+254733333333', family_id: 'fam_onyango', family_role: 'Single', spiritual_milestones: ['Member: 2021-03-10'], volunteer_skills: ['Ushering', 'Security', 'First Aid'], engagement_score: 75 },
  { id: 'm4', branch_id: 'b1', first_name: 'Grace', last_name: 'Mwangi', email: 'grace.m@email.com', phone: '+254744444444', family_id: 'fam_mwangi', family_role: 'Single', spiritual_milestones: ['Baptized: 2022-11-05'], volunteer_skills: ['Ushering', 'Greeting'], engagement_score: 62 },
  { id: 'm5', branch_id: 'b2', first_name: 'Samuel', last_name: 'Kariuki', email: 'samuel.kariuki@email.com', phone: '+254701223344', family_id: 'fam_kariuki', family_role: 'Husband', spiritual_milestones: ['Member: 2015-05-24'], volunteer_skills: ['Sound Engineering', 'Video Editing'], engagement_score: 92 },
  { id: 'm6', branch_id: 'b2', first_name: 'Esther', last_name: 'Kariuki', email: 'esther.kariuki@email.com', phone: '+254701223355', family_id: 'fam_kariuki', family_role: 'Wife', spiritual_milestones: ['Member: 2015-05-24'], volunteer_skills: ['Worship Vocals', 'Public Speaking'], engagement_score: 78 },
  { id: 'm7', branch_id: 'b2', first_name: 'Faith', last_name: 'Wanjiku', email: 'faith.wanjiku@email.com', phone: '+254702334455', family_id: 'fam_wanjiku', family_role: 'Single', spiritual_milestones: ['Baptized: 2024-02-14'], volunteer_skills: ['Greeting', 'Social Media'], engagement_score: 41 },
  { id: 'm8', branch_id: 'b3', first_name: 'Peter', last_name: 'Kiprono', email: 'peter.kiprono@email.com', phone: '+254703445566', family_id: 'fam_kiprono', family_role: 'Single', spiritual_milestones: ['Member: 2023-09-12'], volunteer_skills: ['Graphics', 'Video Editing', 'Website Support'], engagement_score: 84 },
  { id: 'm9', branch_id: 'b3', first_name: 'Alice', last_name: 'Chebet', email: 'alice.chebet@email.com', phone: '+254704556677', family_id: 'fam_chebet', family_role: 'Single', spiritual_milestones: [], volunteer_skills: ['Greeting', 'First Aid'], engagement_score: 35 },
  { id: 'm10', branch_id: 'b1', first_name: 'Kennedy', last_name: 'Otieno', email: 'kennedy.o@email.com', phone: '+254755555555', family_id: 'fam_otieno', family_role: 'Husband', spiritual_milestones: ['Baptized: 2010-08-15'], volunteer_skills: ['Youth Mentorship', 'Security'], engagement_score: 30 },
];

// Demo login accounts. Passwords come from SEED_PASSWORD (default "grace" for
// local dev) and are bcrypt-hashed before storage.
const USERS = [
  { email: 'admin@maximummiracle.org', name: 'HQ Administrator', role: 'hq_admin', branch_id: 'b1', phone: '+254711111111' },
  { email: 'kawangware@maximummiracle.org', name: 'Kawangware Campus Admin', role: 'branch_admin', branch_id: 'b2', phone: '+254722222222' },
  { email: 'worship@maximummiracle.org', name: 'Worship Leader', role: 'ministry_leader', branch_id: 'b1', phone: '+254733333333' },
  { email: 'john@maximummiracle.org', name: 'John Kamau', role: 'member', branch_id: 'b1', phone: '+254744444444' },
];

const EVENTS = [
  { id: 'e1', branch_id: 'b1', title: 'Youth Praise Night', description: 'An evening of worship, drama, and networking for young adults.', date: '2026-07-19', time: '18:00', roles_required: ['Worship Vocals', 'Keyboard', 'Guitar', 'Sound Engineering', 'Greeting'], volunteers_signed_up: ['m1'], rsvp_member_ids: ['m2', 'm3', 'm10'] },
  { id: 'e2', branch_id: 'b2', title: 'Kawangware Community Outreach', description: 'Food, clothing and medical support for families around the Kawangware campus.', date: '2026-07-25', time: '09:00', roles_required: ['Greeting', 'First Aid', 'Security'], volunteers_signed_up: ['m6'], rsvp_member_ids: ['m6', 'm7'] },
  { id: 'e3', branch_id: 'b1', title: 'Sunday 2nd Service - Nairobi CBD', description: 'Main Sunday gathering at Embassy Cinema, Latema Road.', date: '2026-07-12', time: '10:00', roles_required: ['Ushering', 'Greeting', 'Sound Engineering', 'Worship Vocals', 'Security'], volunteers_signed_up: ['m3', 'm4'], rsvp_member_ids: ['m1', 'm4'] },
];

const GROUPS = [
  { id: 'g1', branch_id: 'b1', name: 'Young Adults Fellowship', schedule: 'Tue 6:30 PM', description: '20s-30s community - Bible study, mentorship and fellowship.', member_ids: ['m1', 'm3'], pending_member_ids: [] },
  { id: 'g2', branch_id: 'b1', name: 'Family Life & Marriage', schedule: 'Wed 5:30 PM', description: 'For couples growing together in faith.', member_ids: ['m2'], pending_member_ids: [] },
  { id: 'g3', branch_id: 'b1', name: 'Intercessors Fellowship', schedule: 'Fri 6:00 AM', description: 'Corporate prayer for the church, the city and the nation.', member_ids: [], pending_member_ids: ['m10'] },
  { id: 'g4', branch_id: 'b2', name: "Men's Morning Prayer", schedule: 'Sat 6:00 AM', description: 'Prayer, accountability and breakfast.', member_ids: ['m5'], pending_member_ids: [] },
  { id: 'g5', branch_id: 'b2', name: 'Kawangware Home Fellowship', schedule: 'Tue 6:00 PM', description: 'Midweek fellowship in homes around the campus.', member_ids: [], pending_member_ids: [] },
  { id: 'g6', branch_id: 'b3', name: 'Women of Grace', schedule: 'Thu 10:00 AM', description: 'Bible study and fellowship.', member_ids: ['m8'], pending_member_ids: [] },
  { id: 'g7', branch_id: 'b3', name: 'Nakuru Youth Fellowship', schedule: 'Sat 4:00 PM', description: 'Teens and young adults - worship, mentorship and sport.', member_ids: [], pending_member_ids: [] },
];

// Enrol roughly half of each campus into that campus's groups - groups holding
// two or three named members read as unused next to an 83-person campus roll.
function enrolGroups(groups, roster) {
  for (const g of groups) {
    const pool = roster.filter((m) => m.branch_id === g.branch_id);
    const peers = groups.filter((x) => x.branch_id === g.branch_id);
    const slot = peers.indexOf(g);
    pool.forEach((m, i) => {
      if (Math.random() > 0.5) return;
      if (i % peers.length !== slot) return;
      if (!g.member_ids.includes(m.id)) g.member_ids.push(m.id);
    });
  }
  return groups;
}

const FOLLOWUPS = [
  { id: 'fu1', branch_id: 'b1', name: 'Peter Njoroge', stage: 'New Guest', owner: 'Pastor Joseph', note: 'First-time guest at 2nd Service, filled a connect card.', contributed: 2000, contact: '+254711223344' },
  { id: 'fu2', branch_id: 'b1', name: 'Linda Achieng', stage: 'Contacted', owner: 'Grace Mwangi', note: 'Called; interested in joining a home fellowship.', contributed: 500, contact: '+254722334455' },
  { id: 'fu3', branch_id: 'b2', name: 'Brian Mutua', stage: 'Connected', owner: 'Samuel Kariuki', note: 'Joined the Tuesday Kawangware home fellowship.', contributed: 1500, contact: '+254733445566' },
  { id: 'fu4', branch_id: 'b3', name: 'Janet Cherono', stage: 'New Guest', owner: 'Peter Kiprono', note: 'Walked in at the Nakuru campus after watching NURU TV.', contributed: 1000, contact: '+254744556677' },
];

const PRAYERS = [
  { id: 'pr1', member_id: 'm1', member_name: 'John Kamau', branch_name: 'Nairobi CBD', text: 'Praying for my family as we plan to travel upcountry this week.', category: 'Family', route: 'Family Life & Marriage Ministry', status: 'Approved' },
  { id: 'pr2', member_id: 'm7', member_name: 'Faith Wanjiku', branch_name: 'Kawangware', text: 'I am recovering from knee surgery and still in moderate pain.', category: 'Healing', route: 'Hospital & Home Care Ministry', status: 'Assigned' },
];

const CAMPAIGNS = [
  { id: 'camp1', name: "Children's Home Support Fund", goal: 1500000, raised_offset: 940000, fund_category: 'Project Donation', branch_id: 'b1' },
  { id: 'camp2', name: 'NURU TV Broadcast Equipment', goal: 850000, raised_offset: 410000, fund_category: 'Pledge', branch_id: 'b1' },
];

// Ten members makes every average look like a toy. Grow the handcrafted core
// (m1-m10, referenced by groups, events and prayer requests) into a congregation
// of a believable size, using common Kenyan given/family names.
function generateCongregation(core) {
  const FIRST = ['Alice', 'Benard', 'Brenda', 'Caleb', 'Carolyne', 'Collins', 'Cynthia', 'Daniel',
    'Dennis', 'Dorcas', 'Edwin', 'Elizabeth', 'Emmanuel', 'Eunice', 'Evans', 'Gladys', 'Griffin',
    'Hellen', 'Ian', 'Irene', 'Isaac', 'Jackline', 'James', 'Joan', 'Joseph', 'Josphat', 'Judy',
    'Kevin', 'Lilian', 'Lucy', 'Martin', 'Mercy', 'Moses', 'Naomi', 'Nelson', 'Nancy', 'Patrick',
    'Pauline', 'Purity', 'Rose', 'Ruth', 'Silas', 'Sharon', 'Stephen', 'Susan', 'Timothy',
    'Valentine', 'Victor', 'Winnie', 'Zachary'];
  const LAST = ['Achieng', 'Barasa', 'Cheruiyot', 'Chepkoech', 'Gitonga', 'Kimani', 'Kiplagat',
    'Kirui', 'Koech', 'Langat', 'Maina', 'Makau', 'Mbugua', 'Mburu', 'Mutiso', 'Muthoni',
    'Mwende', 'Nyakundi', 'Njuguna', 'Nyambura', 'Obara', 'Ochieng', 'Odhiambo', 'Okoth',
    'Omondi', 'Ondiek', 'Owuor', 'Rotich', 'Sang', 'Wafula', 'Waweru', 'Wekesa'];
  const SKILLS = ['Ushering', 'Greeting', 'Worship Vocals', 'Keyboard', 'Guitar', 'Drums',
    'Sound Engineering', 'Video Editing', 'Graphics', 'Childcare', 'Youth Mentorship',
    'Intercession', 'First Aid', 'Security', 'Social Media', 'Hospitality', 'Public Speaking'];
  const ROLES = ['Single', 'Husband', 'Wife'];
  // Weighted so the CBD mother church carries most of the roll.
  const spread = [
    { branch_id: 'b1', count: 78 },
    { branch_id: 'b2', count: 41 },
    { branch_id: 'b3', count: 27 },
  ];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const out = [...core];
  let n = core.length;

  for (const { branch_id, count } of spread) {
    for (let i = 0; i < count; i++) {
      n += 1;
      const first_name = pick(FIRST);
      const last_name = pick(LAST);
      const roll = Math.random();
      const engagement_score = roll < 0.12 ? 20 + Math.floor(Math.random() * 25)
        : roll < 0.35 ? 45 + Math.floor(Math.random() * 25)
        : 70 + Math.floor(Math.random() * 30);
      out.push({
        id: `m${n}`,
        branch_id,
        first_name,
        last_name,
        email: `${first_name.toLowerCase()}.${last_name.toLowerCase()}${n}@email.com`,
        phone: `+2547${String(10000000 + Math.floor(Math.random() * 89999999))}`,
        family_id: `fam_${last_name.toLowerCase()}_${n}`,
        family_role: pick(ROLES),
        spiritual_milestones: Math.random() < 0.6
          ? [`Member: ${2012 + Math.floor(Math.random() * 13)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`]
          : [],
        volunteer_skills: [...new Set([pick(SKILLS), pick(SKILLS)])],
        engagement_score,
      });
    }
  }
  return out;
}

function recentSundays(count) {
  const dates = [];
  const anchor = new Date();
  anchor.setUTCHours(0, 0, 0, 0);
  anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());
  for (let i = 0; i < count; i++) {
    const d = new Date(anchor.getTime() - i * 7 * 86400000);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates.reverse();
}

async function seed() {
  await migrate();
  const password = process.env.SEED_PASSWORD || 'grace';
  const hash = await bcrypt.hash(password, config.bcryptRounds);

  const roster = generateCongregation(MEMBERS);
  // Per-individual pledges for the demo roster: pledge_amount is the money the
  // member promised to contribute and pledge_paid is what they have paid so
  // far. The means each member used is recorded per pledge payment below.
  const PLEDGE_SEED = {
    m1: [50000, 15000],
    m2: [25000, 5000],
    m4: [30000, 0],
    m5: [80000, 30000],
    m8: [45000, 10000],
    m10: [20000, 0],
  };
  roster.forEach((m) => {
    const seed = PLEDGE_SEED[m.id];
    if (seed) { m.pledge_amount = seed[0]; m.pledge_paid = seed[1]; }
  });
  const groups = enrolGroups(GROUPS, roster);

  await withTransaction(async (c) => {
    await c.query(`TRUNCATE branches, users, members, transactions, attendance, events, groups, followups, announcements, prayer_requests, campaigns, recurring_gifts RESTART IDENTITY CASCADE`);

    for (const b of BRANCHES) {
      await c.query('INSERT INTO branches (id,name,location,code) VALUES ($1,$2,$3,$4)', [b.id, b.name, b.location, b.code]);
    }
    for (const u of USERS) {
      await c.query('INSERT INTO users (email,password_hash,name,role,branch_id,phone) VALUES ($1,$2,$3,$4,$5,$6)', [u.email, hash, u.name, u.role, u.branch_id, u.phone || null]);
    }
    // Privileged accounts always require MFA - enforced server-side at login too.
    await c.query(`UPDATE users SET mfa_required = true WHERE role IN ('platform_admin','hq_admin','branch_admin','ministry_leader')`);
    for (const m of roster) {
      await c.query(
        `INSERT INTO members (id,branch_id,first_name,last_name,email,phone,family_id,family_role,engagement_score,volunteer_skills,spiritual_milestones,pledge_amount,pledge_paid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [m.id, m.branch_id, m.first_name, m.last_name, m.email, m.phone, m.family_id, m.family_role, m.engagement_score, m.volunteer_skills, m.spiritual_milestones, m.pledge_amount ?? null, m.pledge_paid ?? 0]
      );
    }

    // Transactions - roughly one gift per member over the last 14 days
    const cats = ['Tithe', 'Offering', 'Pledge', 'Project Donation'];
    // Weighted so M-Pesa dominates, which is how giving actually arrives in Kenya.
    const methods = ['M-Pesa', 'M-Pesa', 'M-Pesa', 'M-Pesa', 'Bank Transfer', 'Cash', 'Card'];
    const now = Date.now();
    const txCount = Math.max(40, Math.round(roster.length * 1.4));
    for (let i = 0; i < txCount; i++) {
      const m = roster[Math.floor(Math.random() * roster.length)];
      // KES bands per fund, rounded to the nearest 50 shillings.
      const band = { Tithe: [2000, 25000], Offering: [100, 2000], Pledge: [1000, 15000], 'Project Donation': [500, 10000] }[cats[i % cats.length]];
      const amount = Math.round((Math.random() * (band[1] - band[0]) + band[0]) / 50) * 50;
      const daysAgo = Math.floor(Math.random() * 14);
      const date = new Date(now - daysAgo * 86400000).toISOString().split('T')[0];
      await c.query(
        `INSERT INTO transactions (id,branch_id,member_id,member_name,amount,category,date,payment_method,receipt_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [`t_${i}`, m.branch_id, m.id, `${m.first_name} ${m.last_name}`, amount, cats[i % cats.length], date, methods[i % methods.length], `REC-2026-${10000 + i}`]
      );
    }

    // Explicit pledge payments for the seeded pledges - the payment method is
    // the means each member used to pay their pledge (M-Pesa, Bank Transfer,
    // Cash...), so the member app can show how each pledge has been paid.
    const pledgePayments = [
      { id: 'tp1', member_id: 'm1', amount: 10000, method: 'M-Pesa', daysAgo: 20 },
      { id: 'tp2', member_id: 'm1', amount: 5000, method: 'Bank Transfer', daysAgo: 6 },
      { id: 'tp3', member_id: 'm2', amount: 5000, method: 'M-Pesa', daysAgo: 12 },
      { id: 'tp4', member_id: 'm5', amount: 30000, method: 'Cash', daysAgo: 10 },
    ];
    for (const pp of pledgePayments) {
      const pm = roster.find((x) => x.id === pp.member_id);
      if (!pm) continue;
      const date = new Date(now - pp.daysAgo * 86400000).toISOString().split('T')[0];
      await c.query(
        `INSERT INTO transactions (id,branch_id,member_id,member_name,amount,category,date,payment_method,receipt_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [pp.id, pm.branch_id, pm.id, `${pm.first_name} ${pm.last_name}`, pp.amount, 'Pledge', date, pp.method, `REC-2026-${90000 + pledgePayments.indexOf(pp)}`]
      );
    }

    // Attendance - 8 Sundays, with a recent absence streak for m7/m9/m10.
    // Insert sequentially: the transaction shares one client, so queries must
    // not overlap.
    const services = recentSundays(8);
    const streak = ['m7', 'm9', 'm10'];
    for (const m of roster) {
      const base = Math.min(0.95, Math.max(0.35, m.engagement_score / 100));
      for (let idx = 0; idx < services.length; idx++) {
        const date = services[idx];
        const recent = idx >= services.length - 3;
        const present = streak.includes(m.id) && recent ? false : Math.random() < base;
        await c.query('INSERT INTO attendance (id,member_id,branch_id,service_date,present) VALUES ($1,$2,$3,$4,$5)', [`att_${m.id}_${date}`, m.id, m.branch_id, date, present]);
      }
    }

    for (const e of EVENTS) {
      await c.query('INSERT INTO events (id,branch_id,title,description,date,time,roles_required,volunteers_signed_up,rsvp_member_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [e.id, e.branch_id, e.title, e.description, e.date, e.time, e.roles_required, e.volunteers_signed_up, e.rsvp_member_ids || []]);
    }
    for (const g of groups) {
      await c.query('INSERT INTO groups (id,branch_id,name,schedule,description,member_ids,pending_member_ids) VALUES ($1,$2,$3,$4,$5,$6,$7)', [g.id, g.branch_id, g.name, g.schedule, g.description, g.member_ids, g.pending_member_ids || []]);
    }
    for (const f of FOLLOWUPS) {
      await c.query('INSERT INTO followups (id,branch_id,name,stage,owner,note,contributed,contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [f.id, f.branch_id, f.name, f.stage, f.owner, f.note, f.contributed ?? null, f.contact ?? null]);
    }
    for (const p of PRAYERS) {
      await c.query('INSERT INTO prayer_requests (id,member_id,member_name,branch_name,text,category,route,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [p.id, p.member_id, p.member_name, p.branch_name, p.text, p.category, p.route, p.status]);
    }
    for (const cp of CAMPAIGNS) {
      await c.query('INSERT INTO campaigns (id,name,goal,raised_offset,fund_category,branch_id) VALUES ($1,$2,$3,$4,$5,$6)', [cp.id, cp.name, cp.goal, cp.raised_offset, cp.fund_category, cp.branch_id]);
    }
    await c.query(
      `INSERT INTO announcements (id,title,body,audience,channels,recipients) VALUES ($1,$2,$3,$4,$5,$6)`,
      ['an1', 'Baptism Sunday - register now', 'Maximum Miracle Centre is holding a baptism service on the last Sunday of the month at the Nairobi CBD campus. Speak to a pastor or reply to register.', 'all', ['sms', 'push'], 10]
    );
  });

  console.log(`Seeded. Demo login password: "${password}" (set SEED_PASSWORD to override).`);
}

seed()
  .then(() => pool.end())
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  });


