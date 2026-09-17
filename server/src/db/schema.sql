-- Church 2.0 - production schema (PostgreSQL 14+)
-- Idempotent: safe to run repeatedly (used as the migration).

CREATE TABLE IF NOT EXISTS branches (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  location    TEXT,
  code        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auth accounts. Roles gate access; branch_id scopes non-HQ users to a campus.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('hq_admin','branch_admin','ministry_leader','member')),
  branch_id     TEXT REFERENCES branches(id) ON DELETE SET NULL,
  mfa_enabled   BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id                  TEXT PRIMARY KEY,
  branch_id           TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  family_id           TEXT,
  family_role         TEXT,
  engagement_score    INTEGER NOT NULL DEFAULT 60,
  volunteer_skills    TEXT[] NOT NULL DEFAULT '{}',
  spiritual_milestones TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_members_branch ON members(branch_id);
-- Family contact details captured when a member is linked to a family.
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_name TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_contact_name TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_contact_phone TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_contact_email TEXT;
-- Profile fields captured when a member is enlisted (Aug 2026 feedback).
ALTER TABLE members ADD COLUMN IF NOT EXISTS role_position TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE members ADD COLUMN IF NOT EXISTS expectations TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS previous_experience TEXT;
-- Family members added by name (simpler than linking member records). Stored as
-- [{name, role}] so giving can be credited to the registered member.
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_members JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Per-individual pledge: pledge_amount is the money the member promised to
-- contribute and pledge_paid is what they have contributed so far. The means
-- used to pay (M-Pesa, Bank Transfer, Cash, ...) is recorded on each Pledge
-- transaction linked to the member.
ALTER TABLE members ADD COLUMN IF NOT EXISTS pledge_amount NUMERIC(12,2);
ALTER TABLE members ADD COLUMN IF NOT EXISTS pledge_paid  NUMERIC(12,2) NOT NULL DEFAULT 0;
-- The project a member's pledge is for, chosen by the member in the app.
-- NULL means a general pledge that is not tied to any single project.
ALTER TABLE members ADD COLUMN IF NOT EXISTS pledge_campaign_id TEXT;
-- One member may pledge to several projects at once, so the per-project part of
-- their promise lives here as [{campaignId, amount}]. pledge_amount stays the
-- member's total promise so every existing total still adds up.
ALTER TABLE members ADD COLUMN IF NOT EXISTS pledges JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Pledges recorded before that list existed live in pledge_amount (and, once the
-- app was used, the project they were for). Move them across once so the member
-- app and the console report the same promise. No-op after the first run.
UPDATE members
   SET pledges = jsonb_build_array(jsonb_build_object('campaignId', pledge_campaign_id, 'amount', pledge_amount))
 WHERE pledge_amount IS NOT NULL AND pledge_amount > 0 AND pledges = '[]'::jsonb;

CREATE TABLE IF NOT EXISTS transactions (
  id             TEXT PRIMARY KEY,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  member_id      TEXT REFERENCES members(id) ON DELETE SET NULL,
  member_name    TEXT,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category       TEXT NOT NULL,
  date           DATE NOT NULL,
  payment_method TEXT,
  receipt_number TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_branch ON transactions(branch_id);
CREATE INDEX IF NOT EXISTS idx_tx_member ON transactions(member_id);
-- The project a gift was given to. Tithes and offerings leave this NULL; a gift
-- to a project carries it so the project's progress is exact instead of being
-- guessed from the fund category.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS campaign_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tx_campaign ON transactions(campaign_id);

CREATE TABLE IF NOT EXISTS attendance (
  id           TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  branch_id    TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  present      BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (member_id, service_date)
);
CREATE INDEX IF NOT EXISTS idx_att_branch ON attendance(branch_id);

CREATE TABLE IF NOT EXISTS events (
  id                  TEXT PRIMARY KEY,
  branch_id           TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  date                DATE,
  time                TEXT,
  roles_required      TEXT[] NOT NULL DEFAULT '{}',
  volunteers_signed_up TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  schedule    TEXT,
  description TEXT,
  member_ids  TEXT[] NOT NULL DEFAULT '{}'
);

-- Upgrade older databases that predate group membership.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS member_ids TEXT[] NOT NULL DEFAULT '{}';

-- Upgrade older databases that predate event RSVPs from the member app ("Going").
ALTER TABLE events ADD COLUMN IF NOT EXISTS rsvp_member_ids TEXT[] NOT NULL DEFAULT '{}';

-- Upgrade older databases that predate small-group join requests (admin approval).
ALTER TABLE groups ADD COLUMN IF NOT EXISTS pending_member_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS followups (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  stage      TEXT NOT NULL DEFAULT 'New Guest',
  owner      TEXT,
  note       TEXT,
  marital_status    TEXT,
  age               INTEGER,
  expectations      TEXT,
  previous_activity TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE followups ADD COLUMN IF NOT EXISTS assimilated_at TIMESTAMPTZ;
ALTER TABLE followups ADD COLUMN IF NOT EXISTS contributed NUMERIC(12,2);
ALTER TABLE followups ADD COLUMN IF NOT EXISTS contact TEXT;

CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  audience   TEXT NOT NULL DEFAULT 'all',
  channels   TEXT[] NOT NULL DEFAULT '{}',
  recipients INTEGER NOT NULL DEFAULT 0,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prayer_requests (
  id          TEXT PRIMARY KEY,
  member_id   TEXT,
  member_name TEXT,
  branch_name TEXT,
  text        TEXT NOT NULL,
  category    TEXT,
  route       TEXT,
  status      TEXT NOT NULL DEFAULT 'Assigned',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  goal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Funds banked before this system's transaction history begins. Added to the
  -- summed transactions so a months-long appeal shows its true progress.
  raised_offset NUMERIC(12,2) NOT NULL DEFAULT 0,
  fund_category TEXT,
  branch_id     TEXT REFERENCES branches(id) ON DELETE CASCADE
);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS raised_offset NUMERIC(12,2) NOT NULL DEFAULT 0;

-- MFA delivery. Codes are stored hashed with a per-code salt and short-lived;
-- the delivery channel (email/SMS) is chosen at request time from the user's
-- profile. See server/src/mfa.js.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE TABLE IF NOT EXISTS mfa_codes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method     TEXT NOT NULL CHECK (method IN ('email','sms')),
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfa_codes_user ON mfa_codes(user_id);

CREATE TABLE IF NOT EXISTS recurring_gifts (
  id          TEXT PRIMARY KEY,
  member_id   TEXT,
  member_name TEXT,
  branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL,
  category    TEXT,
  frequency   TEXT NOT NULL,
  method      TEXT,
  next_date   DATE,
  active      BOOLEAN NOT NULL DEFAULT true
);

-- Admin-to-member care messages: posted from the Communications AI Care Inbox
-- and delivered to members' AI Care view in the mobile app.
CREATE TABLE IF NOT EXISTS care_inbox (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  title      TEXT,
  body       TEXT NOT NULL,
  author     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_care_inbox_branch ON care_inbox(branch_id);



-- ============================================================================
-- Multi-church (multi-tenant) support.
-- Every church owns its branches, members, giving, campaigns, groups, etc.
-- Existing Maximum Miracle Centre data is preserved under the default church
-- 'ch1'. New churches are registered as separate tenants with their own admin
-- accounts, branches and projects. All statements are idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS churches (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  short_name  TEXT,
  tagline     TEXT,
  website     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO churches (id, name, short_name, tagline, website)
VALUES ('ch1', 'Maximum Miracle Centre', 'MMC', 'Reaching the lost, restoring the broken', 'https://maximummiracle.org')
ON CONFLICT (id) DO NOTHING;

-- Contact + news fields for the church: surfaced in the member app as the
-- news bullet ticker and the Talk-to-an-Elder call/email links.
ALTER TABLE churches ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS news_bullet TEXT;

-- Sermon + social channels the church publishes on. The admin links these in
-- Settings > Church Profile and the member app's Sermons tab surfaces them for
-- every member (a YouTube channel drives the in-app feed; Facebook and TikTok
-- open the church's page).
ALTER TABLE churches ADD COLUMN IF NOT EXISTS youtube_channel TEXT;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS facebook_url    TEXT;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS tiktok_url      TEXT;

-- Tenancy columns. DEFAULT 'ch1' backfills pre-multi-tenant rows and keeps any
-- legacy write path working; the API always sets church_id explicitly.
ALTER TABLE branches        ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE users           ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE members         ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE transactions    ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE attendance      ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE events          ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE groups          ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE followups       ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE followups       ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE followups       ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE followups       ADD COLUMN IF NOT EXISTS expectations TEXT;
ALTER TABLE followups       ADD COLUMN IF NOT EXISTS previous_activity TEXT;
ALTER TABLE announcements   ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE prayer_requests ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE campaigns       ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE recurring_gifts ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);
ALTER TABLE care_inbox      ADD COLUMN IF NOT EXISTS church_id TEXT NOT NULL DEFAULT 'ch1' REFERENCES churches(id);

CREATE INDEX IF NOT EXISTS idx_branches_church   ON branches(church_id);
CREATE INDEX IF NOT EXISTS idx_users_church      ON users(church_id);
CREATE INDEX IF NOT EXISTS idx_members_church    ON members(church_id);
CREATE INDEX IF NOT EXISTS idx_tx_church         ON transactions(church_id);
CREATE INDEX IF NOT EXISTS idx_att_church        ON attendance(church_id);
CREATE INDEX IF NOT EXISTS idx_events_church     ON events(church_id);
CREATE INDEX IF NOT EXISTS idx_groups_church     ON groups(church_id);
CREATE INDEX IF NOT EXISTS idx_followups_church  ON followups(church_id);
CREATE INDEX IF NOT EXISTS idx_announce_church   ON announcements(church_id);
CREATE INDEX IF NOT EXISTS idx_prayer_church     ON prayer_requests(church_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_church  ON campaigns(church_id);
CREATE INDEX IF NOT EXISTS idx_recurring_church  ON recurring_gifts(church_id);
CREATE INDEX IF NOT EXISTS idx_care_church       ON care_inbox(church_id);

-- Cross-church platform administrators can manage every tenant.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('platform_admin','hq_admin','branch_admin','ministry_leader','member'));

-- ============================================================================
-- Account security hardening (sign-in & login security).
-- Idempotent: safe to run on every deploy (used as the migration).
-- ============================================================================

-- Password-reset one-time codes reuse mfa_codes; widen the method check.
ALTER TABLE mfa_codes DROP CONSTRAINT IF EXISTS mfa_codes_method_check;
ALTER TABLE mfa_codes ADD CONSTRAINT mfa_codes_method_check CHECK (method IN ('email','sms','reset'));

-- Brute-force protection + account lifecycle.
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_attempts  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active          BOOLEAN NOT NULL DEFAULT true;

-- Authenticator-app (TOTP) MFA. totp_secret_pending holds a freshly generated
-- secret until the user proves they can generate codes; only then is it
-- promoted to totp_secret.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_pending TEXT;

-- Single-use recovery codes (sha-256 hashed - plaintext is shown once).
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes TEXT[] NOT NULL DEFAULT '{}';

-- System-enforced MFA for privileged accounts regardless of user preference.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT false;

-- Rescue flag: allows an account to sign in without MFA. Only set by the
-- reset-admin script so a misconfigured email/SMS provider can never lock
-- the admin out permanently; re-enabling MFA in Settings clears it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_exempt BOOLEAN NOT NULL DEFAULT false;

-- Revocable server-side sessions. Every access token carries a session id so
-- the backend can kill a device remotely and keep a last-seen trail per login.
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  ip              TEXT,
  user_agent      TEXT,
  last_seen_at    TIMESTAMPTZ,
  mfa_verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- Immutable audit trail: login success/failure, MFA, lockouts, password
-- changes, session revocation, TOTP changes, recovery-code generation.
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ============================================================================
-- Announcement suggestion & approval workflow (member -> admin moderation).
-- Idempotent: safe to run on every deploy (used as the migration).
--   status        pending | approved | rejected | published (admin direct)
--   suggested_by  user id of the member who suggested it
--   suggested_name display name for the suggestion card
--   approved_by   admin who approved/rejected
--   approved_at   when the decision was made
--   rejected_reason optional note shown to the suggester
-- ============================================================================
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS suggested_by TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS suggested_name TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS rejected_reason TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_announce_group ON announcements(group_id);
