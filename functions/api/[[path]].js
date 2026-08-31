// Cloudflare Pages Functions entry for the ChurchConnect API.
//
// Pages mounts this file under /api/* and forwards every matching request to
// the Express app in server/src/app.js. The Node.js compatibility layer
// (cloudflare:node) hosts the Express HTTP server inside the Worker. The port
// passed to httpServerHandler is only a routing key that ties the handler to
// app.listen(4000) - it is not a real network port.
//
// Static SPA assets are served by Pages' asset pipeline (dist/), never by
// Express, so this function only ever sees /api/* requests.

import { httpServerHandler } from "cloudflare:node";
import app from "../../server/src/app.js";

// Bind the Express app to the same logical port the handler serves.
app.listen(4000);

export default httpServerHandler({ port: 4000 });
