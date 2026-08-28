import pg from 'pg';
import { config } from '../config.js';

// Single shared connection pool. Uses DATABASE_URL if present, else discrete
// PG* settings. SSL is enabled automatically for managed/remote databases.
const useUrl = Boolean(config.databaseUrl);
export const pool = new pg.Pool(
  useUrl
    ? {
        connectionString: config.databaseUrl,
        ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
      }
    : {
        host: config.pg.host,
        port: config.pg.port,
        user: config.pg.user,
        password: config.pg.password,
        database: config.pg.database,
      }
);

export const query = (text, params) => pool.query(text, params);

// Run a set of statements inside a transaction.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
