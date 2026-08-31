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
import app from "./app.js";

// Bind the Express app to the same logical port the handler serves.
app.listen(4000);

export default httpServerHandler({ port: 4000 });