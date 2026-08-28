import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './pool.js';

// Applies schema.sql. The schema is idempotent (IF NOT EXISTS), so this doubles
// as a simple migration runner - safe to run on every deploy.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Second tenant used to prove multi-church isolation with real data. The
// Maximum Miracle Centre rows stay untouched under ch1; this adds a distinct
// church with its own branches, admin account, members, project and giving.
// Idempotent: each INSERT is guarded with ON CONFLICT DO NOTHING.
const LWC_ADMIN_HASH = '$2a$12$QwLDQTlYZtJv.7RFEVy35O.MgdMjsHvFOS0orwfWLjQlzYTpw0O4e'; // 'grace'

async function seedMultiTenantDemo() {
  await pool.query(`INSERT INTO churches (id, name, short_name, tagline, website)
    VALUES ('ch2', 'Living Waters Church', 'LWC', 'Deep roots, living faith', 'https://livingwaters.church')
    ON CONFLICT (id) DO NOTHING`);

  await pool.query(`INSERT INTO branches (id, name, location, code, church_id) VALUES
    ('b10', 'Nairobi West', 'Nairobi West, Nairobi', 'NWE', 'ch2'),
    ('b11', 'Kisumu', 'Milimani, Kisumu', 'KSM', 'ch2')
    ON CONFLICT (id) DO NOTHING`);

  await pool.query(`INSERT INTO users (email, password_hash, name, role, branch_id, church_id, mfa_enabled) VALUES
    ('admin@livingwaters.test', $1, 'LWC Headquarters Admin', 'hq_admin', 'b10', 'ch2', false),
    ('faith@livingwaters.test', $1, 'Faith Achieng', 'member', 'b10', 'ch2', false)
    ON CONFLICT (email) DO NOTHING`, [LWC_ADMIN_HASH]);

  await pool.query(`INSERT INTO members (id, branch_id, church_id, first_name, last_name, email, engagement_score) VALUES
    ('mlwc1', 'b10', 'ch2', 'Faith', 'Achieng', 'faith@livingwaters.test', 82),
    ('mlwc2', 'b10', 'ch2', 'Stephen', 'Otieno', 'stephen.otieno@livingwaters.test', 74),
    ('mlwc3', 'b11', 'ch2', 'Mercy', 'Atieno', 'mercy.atieno@livingwaters.test', 68),
    ('mlwc4', 'b11', 'ch2', 'David', 'Omondi', 'david.omondi@livingwaters.test', 71)
    ON CONFLICT (id) DO NOTHING`);

  await pool.query(`INSERT INTO campaigns (id, name, goal, raised_offset, fund_category, branch_id, church_id) VALUES
    ('camp3', 'Church Building Fund', 2500000, 800000, 'Project Donation', 'b10', 'ch2'),
    ('camp4', 'Children''s Ministry Hall', 1200000, 250000, 'Pledge', 'b10', 'ch2')
    ON CONFLICT (id) DO NOTHING`);

  await pool.query(`INSERT INTO transactions (id, branch_id, church_id, member_id, member_name, amount, category, date, payment_method) VALUES
    ('txlwc1', 'b10', 'ch2', 'mlwc1', 'Faith Achieng', 12500, 'Tithe', '2026-08-10', 'M-Pesa'),
    ('txlwc2', 'b10', 'ch2', 'mlwc2', 'Stephen Otieno', 8000, 'Offering', '2026-08-10', 'M-Pesa'),
    ('txlwc3', 'b10', 'ch2', 'mlwc3', 'Mercy Atieno', 50000, 'Pledge', '2026-08-11', 'Bank Transfer'),
    ('txlwc4', 'b11', 'ch2', 'mlwc4', 'David Omondi', 15000, 'Project Donation', '2026-08-12', 'Cash'),
    ('txlwc5', 'b10', 'ch2', 'mlwc1', 'Faith Achieng', 30000, 'Project Donation', '2026-08-14', 'M-Pesa')
    ON CONFLICT (id) DO NOTHING`);

  console.log('Multi-church demo data seeded (Living Waters Church)');
}

export async function migrate() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Schema applied');
  await seedMultiTenantDemo();
}

// Allow `npm run migrate`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error('Migration failed:', e);
      process.exit(1);
    });
}