import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });
const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'church',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'church',
});
const email = 'test.user.$(get-random)@example.com';
const delUser = await pool.query('DELETE FROM users WHERE email = $1 RETURNING id', [email]);
const delMember = await pool.query('DELETE FROM members WHERE email = $1 RETURNING id', [email]);
console.log('deleted users:', JSON.stringify(delUser.rows), 'members:', JSON.stringify(delMember.rows));
await pool.end();