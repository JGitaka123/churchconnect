// Idempotent core dataset for the Maximum Miracle Centre tenant (ch1).
// Safe to run on every deploy: each INSERT is guarded with ON CONFLICT DO
// NOTHING, so existing rows (including any real data) are never touched.
// The destructive full demo seed (db/seed.js) is still the source of the
// bigger dataset; this only guarantees a fresh database is immediately usable
// (church, campuses, admin accounts and members).
export const CORE_SEED_SQL = `
INSERT INTO branches (id, name, location, code, church_id) VALUES
('b1', 'Nairobi CBD', 'Embassy Cinema, Latema Road, off Tom Mboya Street, Nairobi', 'NRB', 'ch1'),
('b2', 'Kawangware', 'Kawangware, Nairobi', 'KWG', 'ch1'),
('b3', 'Nakuru', 'Langa Langa, Kanu Street, Nakuru', 'NKR', 'ch1')
ON CONFLICT (id) DO NOTHING;

-- Demo login accounts. Password for all four is "grace" (bcrypt precomputed).
INSERT INTO users (email, password_hash, name, role, branch_id, church_id, phone, mfa_enabled) VALUES
('admin@maximummiracle.org', '$2a$12$KSGzZSsgVowMq06f8cdiCuGcqSxKqQWo/dd10QgbL70sSxf/mQCg2', 'HQ Administrator', 'hq_admin', 'b1', 'ch1', '+254711111111', true),
('kawangware@maximummiracle.org', '$2a$12$KSGzZSsgVowMq06f8cdiCuGcqSxKqQWo/dd10QgbL70sSxf/mQCg2', 'Kawangware Campus Admin', 'branch_admin', 'b2', 'ch1', '+254722222222', true),
('worship@maximummiracle.org', '$2a$12$KSGzZSsgVowMq06f8cdiCuGcqSxKqQWo/dd10QgbL70sSxf/mQCg2', 'Worship Leader', 'ministry_leader', 'b1', 'ch1', '+254733333333', true),
('john@maximummiracle.org', '$2a$12$KSGzZSsgVowMq06f8cdiCuGcqSxKqQWo/dd10QgbL70sSxf/mQCg2', 'John Kamau', 'member', 'b1', 'ch1', '+254744444444', false)
ON CONFLICT (email) DO NOTHING;

INSERT INTO members (id, branch_id, church_id, first_name, last_name, email, phone, engagement_score) VALUES
('m1', 'b1', 'ch1', 'John', 'Kamau', 'john.kamau@maximummiracle.org', '+254712345678', 95),
('m2', 'b1', 'ch1', 'Mary', 'Kamau', 'mary.kamau@maximummiracle.org', '+254722345678', 88),
('m3', 'b1', 'ch1', 'David', 'Onyango', 'david.onyango@email.com', '+254733333333', 75),
('m4', 'b1', 'ch1', 'Grace', 'Mwangi', 'grace.m@email.com', '+254744444444', 62),
('m5', 'b2', 'ch1', 'Samuel', 'Kariuki', 'samuel.kariuki@email.com', '+254701223344', 92),
('m6', 'b2', 'ch1', 'Esther', 'Kariuki', 'esther.kariuki@email.com', '+254701223355', 78),
('m7', 'b2', 'ch1', 'Faith', 'Wanjiku', 'faith.wanjiku@email.com', '+254702334455', 41),
('m8', 'b3', 'ch1', 'Peter', 'Kiprono', 'peter.kiprono@email.com', '+254703445566', 84),
('m9', 'b3', 'ch1', 'Alice', 'Chebet', 'alice.chebet@email.com', '+254704556677', 35),
('m10', 'b1', 'ch1', 'Kennedy', 'Otieno', 'kennedy.o@email.com', '+254755555555', 30)
ON CONFLICT (id) DO NOTHING;
`;