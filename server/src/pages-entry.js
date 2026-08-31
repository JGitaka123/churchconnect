// Cloudflare Pages entry for the ChurchConnect API (advanced mode).
//
// scripts/build-cf.mjs bundles this file with esbuild into dist/_worker.js, so
// Cloudflare Pages deploys a single prebuilt Worker. Bundling runs on the
// build machine (or GitHub Actions), never at deploy time, so Wrangler never
// has to resolve files outside the repo.
//
// The Node.js compatibility layer (cloudflare:node, enabled via
// nodejs_compat_v2 in wrangler.toml) hosts the Express HTTP server inside the
// Worker. The port passed to httpServerHandler is only a routing key that ties
// the handler to app.listen(4000) - it is not a real network port.

import { httpServerHandler } from "cloudflare:node";
import app, { setSchemaGuard } from "./app.js";
import { ensureMigrated } from "./db/auto-migrate.js";

// Apply the schema + core seed once on the first request so a fresh or stale
// Neon database self-heals (idempotent; see server/src/db/schema.sql).
setSchemaGuard(ensureMigrated);

// Bind the Express app to the same logical port the handler serves.
app.listen(4000);

export default httpServerHandler({ port: 4000 });