import bcrypt from 'bcryptjs';

// Cloudflare Workers exposes WebCrypto (globalThis.crypto.getRandomValues) but
// bcryptjs's own auto-detection can miss it and then refuses to generate salts.
// Register an explicit cryptographically secure random source up front. It works
// on Workers and on Node 19+ (globalThis.crypto exists in both).
if (typeof bcrypt.setRandomFallback === 'function' && globalThis.crypto?.getRandomValues) {
  bcrypt.setRandomFallback((len) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(len))));
}
