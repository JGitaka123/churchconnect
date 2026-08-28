import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load server/.env relative to this file, not the process CWD, so the server
// uses the right DB credentials no matter which directory it is started from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Centralized, validated configuration. All secrets come from the environment;
// nothing sensitive is ever committed. See server/.env.example.
const required = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),

  // Postgres - either a single DATABASE_URL or discrete PG* vars.
  databaseUrl: process.env.DATABASE_URL || null,
  pg: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'church2',
    password: process.env.PGPASSWORD || 'church2',
    database: process.env.PGDATABASE || 'church2',
  },

  // Auth
  jwtSecret: required('JWT_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'dev-insecure-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  // Server-side session lifetime (revocable sessions tracked in Postgres).
  sessionTtl: process.env.SESSION_TTL || '30d',
  // Short-lived verification tickets issued after the password step.
  mfaTicketTtl: process.env.MFA_TICKET_TTL || '5m',
  reauthTtl: process.env.REAUTH_TTL || '5m',
  // Brute-force protection: N failed logins locks the account for lockoutMs.
  maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
  lockoutMs: parseInt(process.env.LOCKOUT_MS || String(15 * 60 * 1000), 10),
  // Password policy for registration / password changes.
  passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10),
  // Issuer name shown in authenticator apps (otpauth URI).
  mfaIssuer: process.env.MFA_ISSUER || 'ChurchConnect',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  // CORS - comma-separated allowed origins (the Vercel frontend URL in prod).
  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

