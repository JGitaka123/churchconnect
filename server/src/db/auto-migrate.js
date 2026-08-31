// One-time, idempotent schema + core-seed runner used by the Cloudflare
// Worker (pages-entry.js) so a fresh or stale Neon database self-heals on
// the first request. It mirrors db/migrate.js, which is proven to work
// against Neon: the whole schema runs as one simple multi-statement query.
//
// schema.sql and CORE_SEED_SQL are both safe to re-run (IF NOT EXISTS /
// ON CONFLICT DO NOTHING), so a partial failure just gets re-run on the next
// request. The schema_meta marker row is written only AFTER everything
// succeeded, so a failed run is never treated as "done".
//
// This module is only imported from pages-entry.js (the Worker build), never
// by the local dev server, and schema.sql is bundled as plain text by esbuild
// via the '.sql' text loader in scripts/build-cf.mjs.
import schemaSql from './schema.sql';
import { pool } from './pool.js';
import { CORE_SEED_SQL } from './coreSeed.js';

const META_KEY = 'schema.v1';
let done = false;
let running = null;

export function ensureMigrated() {
  if (done) return Promise.resolve();
  if (!running) {
    running = (async () => {
      // Cheap check first: has this database been migrated already?
      const found = await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'schema_meta'`
      );
      if (found.rows.length) {
        const marker = await pool.query(`SELECT 1 FROM schema_meta WHERE key = '${META_KEY}'`);
        if (marker.rows.length) { done = true; return; }
      }

      // Apply the schema + core seed (idempotent, no transaction needed).
      await pool.query(schemaSql);
      await pool.query(CORE_SEED_SQL);

      // Only now record success so a failure retries on the next request.
      await pool.query(
        `CREATE TABLE IF NOT EXISTS schema_meta (
           key        TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         );
         INSERT INTO schema_meta (key) VALUES ('${META_KEY}')
         ON CONFLICT (key) DO NOTHING`
      );
      done = true;
    })().catch((err) => {
      running = null; // let the next request retry
      throw err;
    });
  }
  return running;
}