import { config } from '../config.js';

// Single shared connection pool. Uses DATABASE_URL if present, else discrete
// PG* settings. SSL is enabled automatically for managed/remote databases.
//
// Cloudflare Workers cannot open raw TCP sockets, so when the API runs on
// Pages Functions the driver is switched to @neondatabase/serverless (a
// node-postgres-compatible Pool/Client that talks to Neon over WebSocket).
// Set DB_DRIVER=neon in the Pages environment for that. The import specifiers
// are kept in variables so bundlers don't try to statically resolve either
// driver into the Workers bundle.
const pgSpecifier = 'pg';
// The Neon specifier stays a literal so Workers bundlers include it; pg keeps
// a variable specifier so it is left as a runtime import (never executed on
// Workers, where raw TCP sockets are unavailable).
const Driver = config.dbDriver === 'neon'
  ? await import('@neondatabase/serverless')
  : await import(pgSpecifier);

const useUrl = Boolean(config.databaseUrl);
export const pool = new Driver.Pool(
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
