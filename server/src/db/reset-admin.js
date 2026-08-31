// Reset the admin account so you can always sign in, even if email/SMS
// delivery is not configured yet.
//
//   cd server
//   $env:DATABASE_URL = "postgresql://..."   (Neon connection string)
//   $env:DB_DRIVER     = "neon"              (use the WebSocket driver)
//   node src/db/reset-admin.js
//
// It runs the (idempotent) schema first if needed, then sets the admin's
// password and turns MFA off for that account so the next login works
// immediately. Re-enable MFA from Settings after you're in.
// Override the account/password with ADMIN_EMAIL / ADMIN_PASSWORD.
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { config } from '../config.js';
import { migrate } from './migrate.js';

const email = String(process.env.ADMIN_EMAIL || 'admin@maximummiracle.org').toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD || process.env.SEED_PASSWORD || 'grace';

async function main() {
  await migrate(); // idempotent - safe on an already-set-up database

  const hash = await bcrypt.hash(password, config.bcryptRounds);
  const { rows } = await pool.query(
    `UPDATE users SET
       password_hash    = $2,
       mfa_enabled      = false,
       mfa_exempt       = true,
       mfa_required     = false,
       totp_secret      = NULL,
       totp_secret_pending = NULL,
       recovery_codes   = '{}',
       login_attempts   = 0,
       locked_until     = NULL,
       active           = true
     WHERE email = $1
     RETURNING id, email, name, role`,
    [email, hash]
  );

  if (!rows[0]) {
    const ins = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, branch_id, church_id, mfa_enabled, mfa_exempt)
       VALUES ($1, $2, 'HQ Administrator', 'hq_admin', 'b1', 'ch1', false, true)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, name, role`,
      [email, hash]
    );
    if (!ins.rows[0]) throw new Error('Could not create the admin account.');
    rows.push(ins.rows[0]);
  }

  console.log('========================================================');
  console.log('  Admin login reset complete');
  console.log('  Email:    ' + email);
  console.log('  Password: ' + password);
  console.log('  MFA:      off (re-enable it in Settings after signing in)');
  console.log('========================================================');
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error('Reset failed:', e.message || e);
    process.exit(1);
  });
