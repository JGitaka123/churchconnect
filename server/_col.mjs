import { pool } from './src/db/pool.js';
const q = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'announcements' ORDER BY ordinal_position`);
console.log('COLUMNS: ' + q.rows.map(r => r.column_name).join(', '));
const s = await pool.query(`SELECT status, count(*)::int AS n FROM announcements GROUP BY status`);
console.log('STATUS: ' + JSON.stringify(s.rows));
process.exit(0);
