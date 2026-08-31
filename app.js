// Maximum Miracle Centre - main application controller
// Handles global state, CRUD operations, rendering, and Chart.js visualization

// ---- Rendering helpers -------------------------------------------------------
// esc(): escape untrusted text before it is interpolated into innerHTML. Every
// member name, email, phone, prayer request, chat message, and sermon note is
// user-controlled, so it MUST pass through esc() to prevent stored XSS.
function esc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


// PDF byte helpers - the generated PDFs are pure ASCII (non-ASCII text is
// replaced with '?' before it enters a content stream), so every char is
// exactly one byte in the latin1 encoding the PDF spec expects. These avoid
// Node-only Buffer APIs so the same code runs in the browser.
function latin1ByteLength(value) {
    return String(value).length;
}
function latin1ToBytes(value) {
    const s = String(value);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    return bytes;
}
// Helvetica glyph widths (per 1000 units of em) for ASCII 32-126. The PDF
// layer uses these so right-aligned text lands where it visually belongs.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
function helveticaWidth(text, size, bold) {
    const table = bold ? HELV_BOLD : HELV;
    let units = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i) - 32;
        units += (code >= 0 && code < table.length) ? table[code] : 556;
    }
    return (units * size) / 1000;
}
// mdInline(): fully escape first, then apply a tiny, safe Markdown subset so the
// AI engine's **bold**/*italic*/`code` render as HTML instead of literal asterisks.
function mdInline(text) {
    return esc(text)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// renderMarkdown(): block-level rendering for multi-line AI output - paragraphs,
// bullet lists ("- " or "- "), and line breaks. Safe: all text is escaped.
function renderMarkdown(text) {
    const lines = String(text == null ? '' : text).split('\n');
    let html = '';
    let inList = false;
    lines.forEach((line) => {
        const trimmed = line.trim();
        const bullet = trimmed.match(/^[--]\s+(.*)$/);
        if (bullet) {
            if (!inList) { html += '<ul class="md-list">'; inList = true; }
            html += `<li>${mdInline(bullet[1])}</li>`;
        } else {
            if (inList) { html += '</ul>'; inList = false; }
            if (trimmed.length) html += `<p class="md-p">${mdInline(trimmed)}</p>`;
        }
    });
    if (inList) html += '</ul>';
    return html;
}

// Roles a member can hold within their linked family unit.
const FAMILY_ROLES = ['Husband', 'Wife', 'Child', 'Parent', 'Guardian', 'Sibling', 'Grandparent', 'Other'];

// Payment means (methods) a member can use to pay their pledge.
const PLEDGE_METHODS = ['M-Pesa', 'Bank Transfer', 'Cash', 'Card', 'Cheque', 'PayPal', 'Other'];

// Initialize Global State
const ChurchApp = {
    // 1. Centralized Mock Database
    db: {
        branches: [
            { id: 'b1', name: 'Nairobi CBD', location: 'Embassy Cinema, Latema Road, off Tom Mboya Street, Nairobi', code: 'NRB' },
            { id: 'b2', name: 'Kawangware', location: 'Kawangware, Nairobi', code: 'KWG' },
            { id: 'b3', name: 'Nakuru', location: 'Langa Langa, Kanu Street, Nakuru', code: 'NKR' }
        ],
        members: [
            { id: 'm1', branchId: 'b1', branchName: 'Nairobi CBD', firstName: 'John', lastName: 'Kamau', email: 'john.kamau@maximummiracle.org', phone: '+254712345678', familyId: 'fam_kamau', familyRole: 'Husband', spiritualMilestones: ['Baptized: 2018-04-12', 'Member: 2019-01-01'], volunteer_skills: ['Worship Vocals', 'Keyboard', 'Guitar'], engagement_score: 95, rolePosition: 'Worship Leader', maritalStatus: 'Married', age: 38, expectations: 'Lead worship and mentor the youth music team.', previousExperience: 'Choir director at PCEA Langata', pledgeAmount: 50000, pledgePaid: 15000 },
            { id: 'm2', branchId: 'b1', branchName: 'Nairobi CBD', firstName: 'Mary', lastName: 'Kamau', email: 'mary.kamau@maximummiracle.org', phone: '+254722345678', familyId: 'fam_kamau', familyRole: 'Wife', spiritualMilestones: ['Baptized: 2019-06-20'], volunteer_skills: ['Childcare', 'Greeting'], engagement_score: 88, rolePosition: 'Hospitality Lead', maritalStatus: 'Married', age: 35, expectations: 'Support children ministry and family discipleship.', previousExperience: 'Sunday school teacher at CITAM Valley Road', pledgeAmount: 25000, pledgePaid: 5000 },
            { id: 'm3', branchId: 'b1', branchName: 'Nairobi CBD', firstName: 'David', lastName: 'Onyango', email: 'david.onyango@email.com', phone: '+254733333333', familyId: 'fam_onyango', familyRole: 'Single', spiritualMilestones: ['Member: 2021-03-10'], volunteer_skills: ['Ushering', 'Security', 'First Aid'], engagement_score: 75 },
            { id: 'm4', branchId: 'b1', branchName: 'Nairobi CBD', firstName: 'Grace', lastName: 'Mwangi', email: 'grace.m@email.com', phone: '+254744444444', familyId: 'fam_mwangi', familyRole: 'Single', spiritualMilestones: ['Baptized: 2022-11-05'], volunteer_skills: ['Ushering', 'Greeting'], engagement_score: 62 },
            { id: 'm5', branchId: 'b2', branchName: 'Kawangware', firstName: 'Samuel', lastName: 'Kariuki', email: 'samuel.kariuki@email.com', phone: '+254701223344', familyId: 'fam_kariuki', familyRole: 'Husband', spiritualMilestones: ['Member: 2015-05-24'], volunteer_skills: ['Sound Engineering', 'Video Editing'], engagement_score: 92, pledgeAmount: 80000, pledgePaid: 30000 },
            { id: 'm6', branchId: 'b2', branchName: 'Kawangware', firstName: 'Esther', lastName: 'Kariuki', email: 'esther.kariuki@email.com', phone: '+254701223355', familyId: 'fam_kariuki', familyRole: 'Wife', spiritualMilestones: ['Member: 2015-05-24'], volunteer_skills: ['Worship Vocals', 'Public Speaking'], engagement_score: 78 },
            { id: 'm7', branchId: 'b2', branchName: 'Kawangware', firstName: 'Faith', lastName: 'Wanjiku', email: 'faith.wanjiku@email.com', phone: '+254702334455', familyId: 'fam_wanjiku', familyRole: 'Single', spiritualMilestones: ['Baptized: 2024-02-14'], volunteer_skills: ['Greeting', 'Social Media'], engagement_score: 41 }, // Flagged at risk
            { id: 'm8', branchId: 'b3', branchName: 'Nakuru', firstName: 'Peter', lastName: 'Kiprono', email: 'peter.kiprono@email.com', phone: '+254703445566', familyId: 'fam_kiprono', familyRole: 'Single', spiritualMilestones: ['Member: 2023-09-12'], volunteer_skills: ['Graphics', 'Video Editing', 'Website Support'], engagement_score: 84 },
            { id: 'm9', branchId: 'b3', branchName: 'Nakuru', firstName: 'Alice', lastName: 'Chebet', email: 'alice.chebet@email.com', phone: '+254704556677', familyId: 'fam_chebet', familyRole: 'Single', spiritualMilestones: [], volunteer_skills: ['Greeting', 'First Aid'], engagement_score: 35 }, // Flagged at risk
            { id: 'm10', branchId: 'b1', branchName: 'Nairobi CBD', firstName: 'Kennedy', lastName: 'Otieno', email: 'kennedy.o@email.com', phone: '+254755555555', familyId: 'fam_otieno', familyRole: 'Husband', spiritualMilestones: ['Baptized: 2010-08-15'], volunteer_skills: ['Youth Mentorship', 'Security'], engagement_score: 30 } // Flagged at risk
        ],
        transactions: [],
        attendance: [],
        // A few standing orders so the recurring-giving panel demonstrates the
        // feature out of the box. Members here are from the handcrafted core.
        recurringGifts: [
            { id: 'rec_seed_1', memberId: 'm1', memberName: 'John Kamau', branchId: 'b1', branchName: 'Nairobi CBD', amount: 5000, category: 'Tithe', frequency: 'monthly', method: 'M-Pesa', nextDate: '2026-08-01', active: true },
            { id: 'rec_seed_2', memberId: 'm2', memberName: 'Mary Kamau', branchId: 'b1', branchName: 'Nairobi CBD', amount: 1500, category: 'Offering', frequency: 'weekly', method: 'M-Pesa', nextDate: '2026-07-20', active: true },
            { id: 'rec_seed_3', memberId: 'm5', memberName: 'Samuel Kariuki', branchId: 'b2', branchName: 'Kawangware', amount: 3000, category: 'Tithe', frequency: 'monthly', method: 'Bank Transfer', nextDate: '2026-08-05', active: true },
            { id: 'rec_seed_4', memberId: 'm8', memberName: 'Peter Kiprono', branchId: 'b3', branchName: 'Nakuru', amount: 2000, category: 'Project Donation', frequency: 'monthly', method: 'M-Pesa', nextDate: '2026-08-03', active: true }
        ],
        // One campaign per fund category - `raised` is summed from matching
        // transactions, so two campaigns sharing a category would double-count.
        // `raisedOffset` carries the funds banked before this app's transaction
        // window; without it a months-long capital appeal reads as ~0%.
        campaigns: [
            { id: 'camp1', name: "Children's Home Support Fund", goal: 1500000, raisedOffset: 940000, fundCategory: 'Project Donation', branchId: 'b1' },
            { id: 'camp2', name: 'NURU TV Broadcast Equipment', goal: 850000, raisedOffset: 410000, fundCategory: 'Pledge', branchId: 'b1' }
        ],
        followUps: [
            { id: 'fu1', name: 'Peter Njoroge', branchId: 'b1', stage: 'New Guest', owner: 'Pastor Joseph', note: 'First-time guest at 2nd Service, filled a connect card.', maritalStatus: 'Married', age: 34, expectations: 'Interested in the men\'s ministry', previousActivity: 'Served as a worship drummer at a previous church', visitedDate: '2026-07-12', contributed: 2000, contact: '+254711223344' },
            { id: 'fu2', name: 'Linda Achieng', branchId: 'b1', stage: 'Contacted', owner: 'Grace Mwangi', note: 'Called; interested in joining a home fellowship.', visitedDate: '2026-07-12', contributed: 500, contact: '+254722334455' },
            { id: 'fu3', name: 'Brian Mutua', branchId: 'b2', stage: 'Connected', owner: 'Samuel Kariuki', note: 'Joined the Tuesday Kawangware home fellowship.', visitedDate: '2026-07-19', contributed: 1500, contact: '+254733445566' },
            { id: 'fu4', name: 'Janet Cherono', branchId: 'b3', stage: 'New Guest', owner: 'Peter Kiprono', note: 'Walked in at the Nakuru campus after watching NURU TV.', visitedDate: '2026-08-02', contributed: 1000, contact: '+254744556677' }
        ],
        groups: [
            { id: 'g1', name: 'Young Adults Fellowship', branchId: 'b1', schedule: 'Tue 6:30 PM', description: '20s-30s community - Bible study, mentorship and fellowship.', memberIds: ['m1', 'm3'], pendingMemberIds: [] },
            { id: 'g2', name: 'Family Life & Marriage', branchId: 'b1', schedule: 'Wed 5:30 PM', description: 'For couples growing together in faith.', memberIds: ['m2'], pendingMemberIds: [] },
            { id: 'g3', name: 'Intercessors Fellowship', branchId: 'b1', schedule: 'Fri 6:00 AM', description: 'Corporate prayer for the church, the city and the nation.', memberIds: [], pendingMemberIds: ['m10'] },
            { id: 'g4', name: "Men's Morning Prayer", branchId: 'b2', schedule: 'Sat 6:00 AM', description: 'Prayer, accountability and breakfast.', memberIds: ['m5'], pendingMemberIds: [] },
            { id: 'g5', name: 'Kawangware Home Fellowship', branchId: 'b2', schedule: 'Tue 6:00 PM', description: 'Midweek fellowship in homes around the campus.', memberIds: [], pendingMemberIds: [] },
            { id: 'g6', name: 'Women of Grace', branchId: 'b3', schedule: 'Thu 10:00 AM', description: 'Bible study and fellowship.', memberIds: ['m8'], pendingMemberIds: [] },
            { id: 'g7', name: 'Nakuru Youth Fellowship', branchId: 'b3', schedule: 'Sat 4:00 PM', description: 'Teens and young adults - worship, mentorship and sport.', memberIds: [], pendingMemberIds: [] }
        ],
        announcements: [
            { id: 'an1', title: 'Baptism Sunday - register now', body: 'Maximum Miracle Centre is holding a baptism service on the last Sunday of the month at the Nairobi CBD branch. Speak to a pastor or reply to register.', audience: 'all', channels: ['sms', 'push'], recipients: 10, sentAt: '2026-07-06T09:00:00Z' }
        ],
        readingPlans: [
            { id: 'rp1', title: '7 Days of Peace', emoji: '', days: [
                { ref: 'John 14:27', text: 'Peace I leave with you; my peace I give to you.' },
                { ref: 'Philippians 4:6-7', text: 'Do not be anxious about anything, but in everything by prayer... present your requests to God.' },
                { ref: 'Isaiah 26:3', text: 'You keep him in perfect peace whose mind is stayed on you.' },
                { ref: 'Psalm 4:8', text: 'In peace I will both lie down and sleep; for you alone, O Lord, make me dwell in safety.' },
                { ref: 'Matthew 11:28', text: 'Come to me, all who labor and are heavy laden, and I will give you rest.' },
                { ref: 'Colossians 3:15', text: 'Let the peace of Christ rule in your hearts.' },
                { ref: 'Romans 15:13', text: 'May the God of hope fill you with all joy and peace in believing.' }
            ]},
            { id: 'rp2', title: 'Foundations of Faith', emoji: '', days: [
                { ref: 'Hebrews 11:1', text: 'Now faith is the assurance of things hoped for, the conviction of things not seen.' },
                { ref: 'Ephesians 2:8', text: 'For by grace you have been saved through faith.' },
                { ref: 'Romans 10:17', text: 'So faith comes from hearing, and hearing through the word of Christ.' },
                { ref: 'James 2:17', text: 'So also faith by itself, if it does not have works, is dead.' },
                { ref: 'Mark 11:24', text: 'Whatever you ask in prayer, believe that you have received it, and it will be yours.' }
            ]}
        ],
        readingState: {},
        events: [
            { id: 'e1', branchId: 'b1', title: 'Youth Praise Night', description: 'An evening of worship, drama, and networking for young adults.', date: '2026-07-19', time: '18:00', rolesRequired: ['Worship Vocals', 'Keyboard', 'Guitar', 'Sound Engineering', 'Greeting'], volunteersSignedUp: ['m1'], rsvpMemberIds: ['m2', 'm3', 'm10'] },
            { id: 'e2', branchId: 'b2', title: 'Kawangware Community Outreach', description: 'Food, clothing and medical support for families around the Kawangware branch.', date: '2026-07-25', time: '09:00', rolesRequired: ['Greeting', 'First Aid', 'Security'], volunteersSignedUp: ['m6'], rsvpMemberIds: ['m6', 'm7'] },
            { id: 'e3', branchId: 'b1', title: 'Sunday 2nd Service - Nairobi CBD', description: 'Main Sunday gathering at Embassy Cinema, Latema Road.', date: '2026-07-12', time: '10:00', rolesRequired: ['Ushering', 'Greeting', 'Sound Engineering', 'Worship Vocals', 'Security'], volunteersSignedUp: ['m3', 'm4'], rsvpMemberIds: ['m1', 'm4'] }
        ],
        sermons: [
            { id: 's1', title: 'Walking by Faith, Not by Sight', preacher: 'Bishop Joseph Mwangi', date: '2026-07-05', branchName: 'Nairobi CBD', thumbnail: 'sermon_faith', duration: '42:15', mediaUrl: 'https://www.w3schools.com/html/mov_bbb.mp4' },
            { id: 's2', title: 'The Heart of a Faithful Steward', preacher: 'Pastor Samuel Kariuki', date: '2026-06-28', branchName: 'Kawangware', thumbnail: 'sermon_steward', duration: '38:40', mediaUrl: 'https://www.w3schools.com/html/movie.mp4' }
        ],
        prayerRequests: [
            { id: 'pr1', memberId: 'm1', memberName: 'John Kamau', branchName: 'Nairobi CBD', text: 'Praying for my family as we plan to travel upcountry this week.', category: 'Family', route: 'Family Life & Marriage Ministry', status: 'Approved', timestamp: '2026-07-10T14:30:00Z' },
            { id: 'pr2', memberId: 'm7', memberName: 'Faith Wanjiku', branchName: 'Kawangware', text: 'I am recovering from knee surgery and still in moderate pain.', category: 'Healing', route: 'Hospital & Home Care Ministry', status: 'Assigned', timestamp: '2026-07-11T09:15:00Z' }
        ],
        careInbox: []
    },

    // 2. Active Session Configuration
    session: {
        currentRole: 'hq_admin', // hq_admin, branch_admin, ministry_leader, member
        currentBranch: 'b1',
        activeTab: 'admin_dashboard', // dashboard, directory, financials, ministry, communications, settings, mobile_preview
        mfaVerified: true,
        selectedMemberId: null,
        selectedEventId: 'e3',
        simulatedMobileView: 'home', // home, sermons, bible, give, projects, serve, chat
        bibleVersion: 'KJV',
        bibleBook: 'John',
        bibleChapter: '1'
    },

    // 3. Application Charts (Chart.js references)
    charts: {},

    // RBAC: which tabs each role may access. Enforced in renderAll - not just
    // hidden in the nav, so a member cannot reach an admin panel by any route.
    ROLE_TABS: {
        hq_admin: ['admin_dashboard', 'admin_directory', 'admin_financials', 'admin_staff', 'admin_ministry', 'admin_followups', 'admin_groups', 'admin_communications', 'admin_settings', 'mobile_preview'],
        branch_admin: ['admin_dashboard', 'admin_directory', 'admin_financials', 'admin_staff', 'admin_ministry', 'admin_followups', 'admin_groups', 'admin_communications', 'admin_settings', 'mobile_preview'],
        ministry_leader: ['admin_dashboard', 'admin_staff', 'admin_ministry', 'admin_followups', 'admin_groups', 'admin_communications', 'mobile_preview'],
        member: ['mobile_preview']
    },

    // 4. Initialize Data & Render
    init() {
        this.loadDB();
        this.ensureTransportMeta();
        this.loadAttendanceMeta();
        this.loadTheme();
        this.setupEventHandlers();

        // Auth gate. When the production API is configured, restore the session
        // from the stored token (validated against the server); otherwise use
        // the standalone localStorage demo session.
        if (window.Church2API && Church2API.isEnabled()) {
            this.initApiAuth();
        } else {
            this.showAuthScreen('credentials');
        }

    },

    // Persistence: Save state
    saveDB() {
        // Production is backend-only: church data lives in Postgres and is never
        // mirrored into the browser. Only the standalone demo mode (no API
        // configured) persists to localStorage.
        if (this.apiEnabled()) return;
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem('church2_db', JSON.stringify(this.db));
        } catch (e) {
            // Most likely QuotaExceededError - surface it instead of throwing
            // uncaught mid-action (which would abort the surrounding handler).
            console.error('Could not persist data:', e);
            if (this.toast) this.toast('Local storage is full - recent changes may not be saved.', 'error');
        }
    },

    // Bump whenever the seeded demo dataset itself changes shape or content
    // (campuses, people, currency). A saved DB stamped with an older version is
    // discarded and re-seeded so returning demo visitors don't keep stale data.
    // In API mode this is moot - the server's data replaces it on hydrate.
    SEED_VERSION: 5,

    // Persistence: Load state
    loadDB() {
        // Production is backend-only: the server hydrates this.db after login.
        // Do not read or seed a local demo database.
        if (this.apiEnabled()) {
            this.db.__seedVersion = this.SEED_VERSION;
            this.ensureSchema(this.db, false);
            return;
        }
        // Snapshot the pristine seed before a saved DB overwrites it, so
        // ensureSchema can backfill from one source of truth.
        const seed = this.db;
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('church2_db');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // Guard against valid-but-wrong JSON (e.g. "null", an array,
                    // a string) that would break ensureSchema/renderers.
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.members)) {
                        throw new Error('Saved DB is not a valid database object');
                    }
                    if (parsed.__seedVersion !== this.SEED_VERSION) {
                        throw new Error('Saved DB predates the current seed');
                    }
                    this.db = parsed;
                    this.ensureSchema(seed);
                    return;
                } catch (e) {
                    console.error("Error parsing saved DB, regenerating:", e);
                    this.db = seed;
                }
            }
        }
        // Fallback: generate and save
        this.db.__seedVersion = this.SEED_VERSION;
        this.generateCongregation();
        this.generateInitialTransactions();
        this.generateInitialAttendance();
        this.saveDB();
    },

    // Backfill collections added in later versions onto an older saved DB so
    // renderers never hit undefined. Attendance was added in v2. `seed` is the
    // pristine dataset from the class literal.
    ensureSchema(seed, persist = true) {
        seed = seed || {};
        let changed = false;
        if (this.db.__seedVersion !== this.SEED_VERSION) { this.db.__seedVersion = this.SEED_VERSION; changed = true; }
        if (!Array.isArray(this.db.transactions)) { this.db.transactions = []; changed = true; }
        if (!Array.isArray(this.db.events)) { this.db.events = []; changed = true; }
        if (!Array.isArray(this.db.sermons)) { this.db.sermons = []; changed = true; }
        if (!Array.isArray(this.db.prayerRequests)) { this.db.prayerRequests = []; changed = true; }
        if (!Array.isArray(this.db.recurringGifts)) { this.db.recurringGifts = []; changed = true; }
        if (!Array.isArray(this.db.careInbox)) { this.db.careInbox = []; changed = true; }
        // Backfill the rest straight from the pristine seed - one source of
        // truth, so rebranding the dataset never has to be done twice.
        ['branches', 'campaigns', 'followUps', 'groups', 'announcements', 'readingPlans'].forEach((key) => {
            if (!Array.isArray(this.db[key])) {
                this.db[key] = JSON.parse(JSON.stringify(seed[key] || []));
                changed = true;
            }
        });
        // Backfill the member-app RSVP and small-group join-request lists.
        (this.db.events || []).forEach((e) => { if (!Array.isArray(e.rsvpMemberIds)) { e.rsvpMemberIds = []; changed = true; } });
        (this.db.groups || []).forEach((g) => { if (!Array.isArray(g.pendingMemberIds)) { g.pendingMemberIds = []; changed = true; } });
        if (!this.db.readingState || typeof this.db.readingState !== 'object' || Array.isArray(this.db.readingState)) {
            this.db.readingState = {};
            changed = true;
        }
        if (!Array.isArray(this.db.attendance) || this.db.attendance.length === 0) {
            this.generateInitialAttendance();
            changed = true;
        }
        // Older seeds only recorded 8 services; extend to a full year so the
        // dashboard's yearly attendance trend has complete coverage.
        if (this.ensureYearlyAttendance()) changed = true;
        if (!this.db.attendanceMeta || typeof this.db.attendanceMeta !== 'object' || Array.isArray(this.db.attendanceMeta)) {
            this.db.attendanceMeta = {};
            changed = true;
        }
        // Family members added by name (v3). Backfill from legacy family links
        // so existing families keep showing until the member edits their list.
        if (Array.isArray(this.db.members)) {
            const all = this.db.members;
            all.forEach((m) => {
                if (Array.isArray(m.familyMembers)) return;
                const linked = all.filter((x) => m.familyId && x.familyId === m.familyId && x.id !== m.id);
                m.familyMembers = linked.map((x) => ({ name: `${x.firstName} ${x.lastName}`, role: x.familyRole || '' }));
                changed = true;
            });
        }
        if (changed && persist) this.saveDB();
    },

    // The Sundays we hold services on - most recent `count`, oldest first.
    getRecentServiceDates(count) {
        const dates = [];
        const anchor = new Date();
        anchor.setHours(0, 0, 0, 0);
        anchor.setDate(anchor.getDate() - anchor.getDay()); // back to most recent Sunday
        for (let i = 0; i < count; i++) {
            const d = new Date(anchor.getTime() - i * 7 * 24 * 60 * 60 * 1000);
            dates.push(d.toISOString().split('T')[0]);
        }
        return dates.reverse();
    },

    // Theme: Load state
    loadTheme() {
        if (typeof localStorage !== 'undefined') {
            let savedTheme = localStorage.getItem('church2_theme') || 'dark';
            // The old neon theme was retired in favour of the on-brand
            // Midnight theme; migrate anyone still holding the old value so
            // they don't land on a class that no longer has styles.
            if (savedTheme === 'cyber') {
                savedTheme = 'midnight';
                localStorage.setItem('church2_theme', savedTheme);
            }
            document.body.className = savedTheme === 'dark' ? '' : 'theme-' + savedTheme;
            const themeSelect = document.getElementById('interface-theme-select');
            if (themeSelect) themeSelect.value = savedTheme;
        }
    },

    // ---- Auth gate (mock login + MFA + RBAC) --------------------------------
    applyUser(user) {
        this.session.currentUser = user;
        this.session.currentRole = user.role;
        this.session.churchId = user.churchId || 'ch1';
        this.session.churchName = user.churchName || null;
        // HQ/platform admins start on the church-wide view; everyone else is
        // locked to the campus they administer.
        this.session.currentBranch = (user.role === 'hq_admin' || user.role === 'platform_admin') ? 'global' : (user.branchId || 'global');
        this.session.mfaVerified = true;
        this.session.activeTab = user.role === 'member' ? 'mobile_preview' : 'admin_dashboard';
        // Reflect the signed-in role in the simulator dropdown.
        const roleSel = document.getElementById('role-simulator-select');
        if (roleSel) roleSel.value = user.role;
        this.applyChurchBranding();
    },

    // Rebrand the chrome (document title, sidebar identity, footer and any
    // per-church palette) to the signed-in church. Falls back to MMC_BRAND
    // when no church record has loaded yet (demo mode / pre-login).
    applyChurchBranding() {
        const brand = window.MMC_BRAND || {};
        const church = this.church || (Array.isArray(this.db.churches) && this.db.churches[0]) || null;
        const name = church && church.name ? String(church.name).trim() : (brand.name || '');
        const palette = (church && church.palette) || brand.palette || null;

        // Guard for DOM-less test harnesses and pre-DOM init calls.
        if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;

        // "Maximum Miracle Centre" -> brand-name "Maximum Miracle" / sub "Centre".
        let nameLine = name || 'Church';
        let subLine = 'Ministry Console';
        const words = name.split(/\s+/).filter(Boolean);
        if (words.length > 1) {
            nameLine = words.slice(0, -1).join(' ');
            subLine = words[words.length - 1] + ' - Ministry Console';
        }

        document.title = name ? name + ' - Ministry Console' : 'Church Connect - Ministry Console';
        const brandName = document.querySelector('.brand-name');
        if (brandName) brandName.textContent = nameLine;
        const brandSub = document.querySelector('.brand-sub');
        if (brandSub) brandSub.textContent = subLine;

        // Sidebar footer identity line (the "Church 2.0 OS" credit).
        const footer = Array.prototype.find.call(document.querySelectorAll('.sidebar > div'), (el) => el.textContent.indexOf('Church 2.0 OS') !== -1);
        if (footer) footer.textContent = (name || 'Church') + ' - Church 2.0 OS v1.1';

        // Per-church palette tokens; dynamic church records may ship one later,
        // otherwise this re-applies the MMC defaults (a no-op).
        if (palette) {
            const map = { royal: '--mmc-royal', royalLight: '--mmc-royal-light', gold: '--mmc-gold', goldDeep: '--mmc-gold-deep' };
            for (const key of Object.keys(map)) {
                if (palette[key]) document.documentElement.style.setProperty(map[key], palette[key]);
            }
        }
    },

    showApp() {
        const auth = document.getElementById('auth-screen');
        const app = document.getElementById('app-container');
        if (auth) auth.style.display = 'none';
        if (app) app.style.display = 'flex';
    },

    // ChurchConnect split-shell brand rail (v3 auth design). Matches the
    // reference layout: dark indigo brand panel + white form surface + the
    // signature purple->blue->teal gradient band.
    authBrandRail(step) {
        const isRegister = step === 'register';
        const isMfa = step === 'mfa';
        const heading = isRegister ? 'Create your account' : (isMfa ? 'Secure your account' : 'Welcome back');
        const copy = isRegister
            ? 'One account for everything ministry - membership, giving, groups and volunteer rotas across every campus.'
            : 'Manage membership, giving, groups and AI ministry insights from one console, across every campus.';
        const ctaLabel = isRegister ? 'Already have an account? Sign in' : 'Create account';
        return `
            <aside class="auth-brand-panel">
                <div>
                    <div class="auth-brand-mark"><img class="auth-brand-logo" src="icons/logo-emblem-128.png?v=6" alt="Maximum Miracle Centre logo"><span>ChurchConnect</span></div>
                    <p class="auth-brand-tag">Church management platform</p>
                </div>
                <div>
                    <h2 class="auth-brand-heading">${heading}</h2>
                    <p class="auth-brand-copy">${copy}</p>
                    <ul class="auth-brand-features">
                        <li><span class="auth-check">&#10003;</span>Members, families &amp; spiritual milestones</li>
                        <li><span class="auth-check">&#10003;</span>Staff rosters &amp; volunteer rotas</li>
                        <li><span class="auth-check">&#10003;</span>Giving, pledges &amp; tax statements</li>
                    </ul>
                </div>
                <button type="button" class="auth-cta" id="auth-brand-cta">${ctaLabel} &rarr;</button>
            </aside>`;
    },

    showAuthScreen(step, ctx) {
        const auth = document.getElementById('auth-screen');
        const app = document.getElementById('app-container');
        if (app) app.style.display = 'none';
        if (!auth) return;
        auth.style.display = 'flex';

                if (step === 'mfa') {
            // An explicit empty list (production, no provider configured) means no
            // method can actually deliver a code; an undefined list is the demo
            // fallback (accepts the demo code).
            const hasMethods = Array.isArray(ctx && ctx.methods);
            const methods = hasMethods ? ctx.methods : ['email'];
            ctx = ctx || {};
            ctx.method = methods.length ? (methods.includes(ctx.method) ? ctx.method : methods[0]) : null;
            const noMethod = methods.length === 0;
            const methodLabelMap = { email: 'Email me', sms: 'Text me', totp: 'Authenticator app', recovery: 'Recovery code' };
            const methodCopy = ctx.method === 'totp'
                ? 'Enter the 6-digit code from your authenticator app for <strong>' + esc(ctx.email || '') + '</strong>.'
                : (ctx.method === 'recovery'
                    ? 'Enter one of your single-use recovery codes for <strong>' + esc(ctx.email || '') + '</strong>.'
                    : 'Enter the 6-digit code we sent to your ' + (ctx.method === 'sms' ? 'phone' : 'email') + ' for <strong>' + esc(ctx.email || '') + '</strong>.');
            const canSend = ctx.method === 'email' || ctx.method === 'sms';
            const chips = methods.map((m) => `<button type="button" class="auth-demo-chip${m === ctx.method ? ' active' : ''}" data-method="${m}">${methodLabelMap[m] || 'Email me'}</button>`).join('');
            auth.innerHTML = `
                <div class="auth-shell">
                    ${this.authBrandRail('mfa')}
                    <section class="auth-form-panel">
                        <div class="auth-org">
                            <span class="auth-logo"><img src="icons/logo-emblem-128.png?v=4" alt="Maximum Miracle Centre logo"></span>
                            <div>
                                <div class="auth-org-name">Church Connect</div>
                                <div class="auth-org-sub">Ministry Console</div>
                            </div>
                        </div>
                        <h2 class="auth-title">Two-factor <span class="grad">verification</span></h2>
                        <p class="auth-sub">${methodCopy}</p>
                        <form id="mfa-form" class="auth-form">
                            <input type="text" id="mfa-code" class="auth-input" inputmode="${ctx.method === 'recovery' ? 'text' : 'numeric'}" maxlength="${ctx.method === 'recovery' ? 20 : 6}" placeholder="${ctx.method === 'recovery' ? 'XXXXXX-XXXXXX-XXXXXX' : '000000'}" autocomplete="one-time-code" aria-label="verification code" required>
                            ${chips ? `<div class="auth-demo">${chips}</div>` : ''}
                            <p id="mfa-status" class="auth-sub" style="font-size:0.75rem;"></p>
                            <p id="auth-error" class="auth-error" role="alert"></p>
                            <button type="submit" class="auth-btn" ${noMethod ? 'disabled' : ''}>Verify &amp; sign in</button>
                            <button type="button" class="auth-link" id="mfa-resend">Resend code</button>
                            <button type="button" class="auth-link" id="mfa-back">&larr; Back to login</button>
                        </form>
                    </section>
                    <div class="auth-band" aria-hidden="true"></div>
                </div>`;
            document.getElementById('auth-brand-cta').onclick = () => this.showAuthScreen('credentials');
            document.getElementById('mfa-form').onsubmit = (e) => { e.preventDefault(); if (!noMethod) this.handleMfa(ctx); };
            document.getElementById('mfa-back').onclick = () => this.showAuthScreen('credentials');
            document.getElementById('mfa-resend').onclick = () => this.handleMfaRequest(ctx, ctx.method, true);
            auth.querySelectorAll('[data-method]').forEach((chip) => {
                chip.onclick = () => { ctx.method = chip.dataset.method; this.showAuthScreen('mfa', ctx); };
            });
            document.getElementById('mfa-code').focus();
            if (noMethod) {
                const st = document.getElementById('mfa-status');
                if (st) st.textContent = 'No verification method is configured yet. Contact the administrator.';
                document.getElementById('mfa-code').disabled = true;
                document.getElementById('mfa-resend').style.display = 'none';
            } else if (canSend) {
                this.handleMfaRequest(ctx, ctx.method, false);
            } else {
                const st = document.getElementById('mfa-status');
                if (st) st.textContent = ctx.method === 'recovery'
                    ? 'Use one of the codes you saved when you set up MFA.'
                    : 'Open your authenticator app and enter the current 6-digit code.';
                document.getElementById('mfa-resend').style.display = 'none';
            }
            return;
        }

        if (step === 'forgot') {
            const stage = (ctx && ctx.stage) || 'email';
            const email = (ctx && ctx.email) || '';
            auth.innerHTML = `
                <div class="auth-shell">
                    ${this.authBrandRail('register')}
                    <section class="auth-form-panel">
                        <div class="auth-org">
                            <span class="auth-logo"><img src="icons/logo-emblem-128.png?v=4" alt="Maximum Miracle Centre logo"></span>
                            <div>
                                <div class="auth-org-name">Church Connect</div>
                                <div class="auth-org-sub">Ministry Console</div>
                            </div>
                        </div>
                        <h2 class="auth-title">Reset your <span class="grad">password</span></h2>
                        <p class="auth-sub">${stage === 'email' ? 'Enter your account email and we will send you a reset code.' : 'Enter the reset code and your new password.'}</p>
                        <form id="forgot-form" class="auth-form">
                            <label class="auth-label" for="forgot-email">Email</label>
                            <input type="email" id="forgot-email" class="auth-input" placeholder="you@example.com" autocomplete="email" value="${esc(email)}" required ${stage === 'code' ? 'readonly' : ''}>
                            ${stage === 'code' ? `
                            <label class="auth-label" for="forgot-code">Reset code</label>
                            <input type="text" id="forgot-code" class="auth-input" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" required>
                            <label class="auth-label" for="forgot-password">New password</label>
                            <input type="password" id="forgot-password" class="auth-input" placeholder="At least 8 characters" minlength="8" autocomplete="new-password" required>` : ''}
                            <p id="auth-error" class="auth-error" role="alert"></p>
                            <button type="submit" class="auth-btn">${stage === 'email' ? 'Send reset code' : 'Set new password'}</button>
                            <button type="button" class="auth-link" id="forgot-back">&larr; Back to sign in</button>
                        </form>
                    </section>
                    <div class="auth-band" aria-hidden="true"></div>
                </div>`;
            document.getElementById('auth-brand-cta').onclick = () => this.showAuthScreen('credentials');
            document.getElementById('forgot-back').onclick = () => this.showAuthScreen('credentials');
            document.getElementById('forgot-form').onsubmit = (e) => {
                e.preventDefault();
                if (stage === 'email') this.handleForgotRequest(ctx);
                else this.handleForgotReset(ctx);
            };
            const fe = document.getElementById('forgot-email');
            if (fe && stage === 'email') fe.focus();
            return;
        }

        if (step === 'register') {
            auth.innerHTML = `
                <div class="auth-shell">
                    ${this.authBrandRail('register')}
                    <section class="auth-form-panel">
                        <div class="auth-org">
                            <span class="auth-logo"><img src="icons/logo-emblem-128.png?v=4" alt="Maximum Miracle Centre logo"></span>
                            <div>
                                <div class="auth-org-name">Church Connect</div>
                                <div class="auth-org-sub">Ministry Console</div>
                            </div>
                        </div>
                        <h2 class="auth-title">Create your <span class="grad">account</span></h2>
                        <p class="auth-sub">Register for the ministry portal. You will be signed in right away.</p>
                        <form id="register-form" class="auth-form">
                            <label class="auth-label" for="reg-name">Full name</label>
                            <input type="text" id="reg-name" class="auth-input" placeholder="Jane Wanjiku" autocomplete="name" required>
                            <label class="auth-label" for="reg-email">Email</label>
                            <input type="email" id="reg-email" class="auth-input" placeholder="you@example.com" autocomplete="email" required>
                            <label class="auth-label" for="reg-phone">Phone (optional - for SMS codes)</label>
                            <input type="tel" id="reg-phone" class="auth-input" placeholder="+254712345678" autocomplete="tel">
                            <label class="auth-label" for="reg-password">Password</label>
                            <input type="password" id="reg-password" class="auth-input" placeholder="At least 8 characters" minlength="8" autocomplete="new-password" required>
                            <label class="auth-label" for="reg-branch">Branch</label>
                            <select id="reg-branch" class="auth-input" required></select>
                            <p id="auth-error" class="auth-error" role="alert"></p>
                            <button type="submit" class="auth-btn">Create account</button>
                            <button type="button" class="auth-link" id="register-back">&larr; Back to sign in</button>
                        </form>
                    </section>
                    <div class="auth-band" aria-hidden="true"></div>
                </div>`;
            document.getElementById('auth-brand-cta').onclick = () => this.showAuthScreen('credentials');
            const regBranch = document.getElementById('reg-branch');
            const localBranches = (this.db && this.db.branches) || [];
            const fillBranches = (list) => {
                const options = (list && list.length ? list : localBranches)
                    .map((b) => {
                        const churchLabel = b.churchName || b.church_name || '';
                        const label = churchLabel ? `${churchLabel} - ${b.name || b.id}` : (b.name || b.id);
                        return `<option value="${esc(b.id)}">${esc(label)}</option>`;
                    })
                    .join('');
                regBranch.innerHTML = options || '<option value="">No branches available</option>';
            };
            fillBranches(localBranches);
            if (this.apiEnabled() && window.Church2API && Church2API.branchesPublic) {
                Church2API.branchesPublic().then(fillBranches).catch(() => {});
            }
            document.getElementById('register-form').onsubmit = (e) => { e.preventDefault(); this.handleRegister(); };
            document.getElementById('register-back').onclick = () => this.showAuthScreen('credentials');
            document.getElementById('reg-name').focus();
            return;
        }

        // credentials step
        const apiMode = this.apiEnabled();
        auth.innerHTML = `
            <div class="auth-shell">
                ${this.authBrandRail('credentials')}
                <section class="auth-form-panel">
                    <div class="auth-org">
                        <span class="auth-logo"><img src="icons/logo-emblem-128.png?v=4" alt="Maximum Miracle Centre logo"></span>
                        <div>
                            <div class="auth-org-name">Church Connect</div>
                            <div class="auth-org-sub">Ministry Console</div>
                        </div>
                    </div>
                    <h2 class="auth-title">Sign in to your <span class="grad">ministry console</span></h2>
                    <p class="auth-sub">Secure access to your church's data.</p>
                    <form id="login-form" class="auth-form">
                        <label class="auth-label" for="login-email">Email</label>
                        <input type="email" id="login-email" class="auth-input" placeholder="you@maximummiracle.org" autocomplete="username" required>
                        <label class="auth-label" for="login-password">Password</label>
                        <input type="password" id="login-password" class="auth-input" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="current-password" required>
                        <p id="auth-error" class="auth-error" role="alert"></p>
                        <p id="auth-mode" class="auth-sub" style="font-size:0.7rem; margin-top:6px;"></p>
                        <button type="submit" class="auth-btn">Continue</button>
                        <button type="button" class="auth-link" id="login-register">New here? Create an account</button>
                        <button type="button" class="auth-link" id="login-forgot" style="font-size:0.8rem;">Forgot password?</button>
                    </form>
                    ${apiMode ? '' : `
                    <div class="auth-demo" role="status">
                        <span>Backend not connected yet. On your computer run npm run dev (or START-APP.bat). On the live site, wait a minute and reload.</span>
                    </div>
                    `}
                </section>
                <div class="auth-band" aria-hidden="true"></div>
            </div>`;
        document.getElementById('auth-brand-cta').onclick = () => this.showAuthScreen('register');
        document.getElementById('login-form').onsubmit = (e) => { e.preventDefault(); this.handleLogin(); };
        document.getElementById('login-register').onclick = () => this.showAuthScreen('register');
        const forgotBtn = document.getElementById('login-forgot');
        if (forgotBtn) forgotBtn.onclick = () => this.showAuthScreen('forgot');
    },

    // Restore an API-backed session from the stored token (production mode).
    initApiAuth() {
        if (Church2API.getToken()) {
            Church2API.me()
                .then(({ user }) => { this.applyUser(user); this.showApp(); this.hydrateThenRender(); })
                .catch(() => { Church2API.logout(); this.showAuthScreen('credentials'); });
        } else {
            this.showAuthScreen('credentials');
        }
    },

    _finishApiLogin(user) {
        // The JWT is already stored by the API client; never persist the password.
        this.applyUser(user);
        this.showApp();
        this.hydrateThenRender();
        this.toast(`Welcome, ${user.name}.`);
    },

    // ----- Backend data layer -------------------------------------------------
    // In production the app is backend-backed: this.db is hydrated from Postgres
    // on login and every mutation is mirrored to the API. In standalone demo mode
    // (no apiBase configured) all of this is a no-op and the localStorage flow
    // below is used unchanged.
    apiEnabled() { return Boolean(window.Church2API && Church2API.isEnabled()); },
    // Paint immediately with whatever we have, then refresh from the server.
    // First paint is never blocked on the network; a slow/failed fetch just
    // leaves the current data in place.
    hydrateThenRender() {
        this.renderAll();
        if (!this.apiEnabled()) return;
        this.hydrateFromApi().then(() => this.renderAll()).catch(() => {});
    },

    // Pull the shared dataset into this.db so every existing (synchronous) view
    // reflects Postgres. Scope is enforced server-side; we request the full
    // permitted set with 'global' and let the client's campus filter narrow it,
    // exactly as in standalone mode. A slice is only replaced when its fetch
    // succeeded, so a partial outage degrades gracefully. Never throws.
    async hydrateFromApi() {
        if (!this.apiEnabled()) return;
        const g = 'global';
        const failed = new Set();
        // Each slice is a named request so a partial outage retries only the
        // slices that failed, and the warning names them when one really breaks.
        const slices = {
            branches: () => Church2API.branches(),
            churches: () => Church2API.churches(),
            members: () => Church2API.members(g),
            transactions: () => Church2API.transactions(g),
            attendance: () => Church2API.attendance(g),
            groups: () => Church2API.groups(g),
            followUps: () => Church2API.followups(g),
            announcements: () => Church2API.announcements(),
            prayers: () => Church2API.prayerRequests(g),
            events: () => Church2API.events(g),
            campaigns: () => Church2API.campaigns(g),
            recurringGifts: () => Church2API.recurringGifts(g),
            careInbox: () => Church2API.careInbox(g),
            summary: () => Church2API.dashboardSummary(this.session.currentBranch || 'global'),
        };
        const runOne = async (name, factory) => {
            try {
                this.applyHydrateSlice(name, await factory());
            } catch (e) {
                console.error('Hydrate failed (' + name + '):', e);
                failed.add(name);
            }
        };
        const runAll = () => Promise.all(Object.keys(slices).map((n) => runOne(n, slices[n])));
        await runAll();
        if (failed.size) {
            // A fresh deploy can take a few seconds to warm up (Worker compile +
            // Neon connection pool). Retry only the failed slices, twice, with a
            // short backoff, before showing any warning.
            for (const delay of [3000, 6000]) {
                await new Promise((r) => setTimeout(r, delay));
                const retry = [...failed];
                failed.clear();
                await Promise.all(retry.map((n) => runOne(n, slices[n])));
                if (!failed.size) break;
            }
        }
        this.applyChurchBranding();
        this.ensureTransportMeta();
        this.loadAttendanceMeta();
        if (failed.size) this.showDataWarning([...failed]);
    },

    // Merge one fetched slice into this.db using the same rules as before:
    // members/branches/churches/events only replace when non-empty so an
    // unseeded backend can't blank the UI, everything else replaces freely.
    applyHydrateSlice(name, data) {
        if (data === undefined) return;
        if (name === 'branches') { if (Array.isArray(data) && data.length) this.db.branches = data; return; }
        if (name === 'churches') {
            if (Array.isArray(data) && data.length) {
                this.db.churches = data;
                this.church = data[0];
                if (this.session.churchId === (data[0] || {}).id) this.session.churchName = data[0].name;
            }
            return;
        }
        if (name === 'members') { if (Array.isArray(data) && data.length) this.db.members = data; return; }
        if (name === 'transactions') { if (Array.isArray(data)) this.db.transactions = data; return; }
        if (name === 'attendance') { if (Array.isArray(data)) this.db.attendance = data; return; }
        if (name === 'groups') { if (Array.isArray(data)) this.db.groups = data; return; }
        if (name === 'followUps') { if (Array.isArray(data)) this.db.followUps = data; return; }
        if (name === 'announcements') { if (Array.isArray(data)) this.db.announcements = data; return; }
        if (name === 'prayers') { if (Array.isArray(data)) this.db.prayerRequests = data; return; }
        if (name === 'events') { if (Array.isArray(data) && data.length) this.db.events = data; return; }
        if (name === 'campaigns') { if (Array.isArray(data)) this.db.campaigns = data; return; }
        if (name === 'recurringGifts') { if (Array.isArray(data)) this.db.recurringGifts = data; return; }
        if (name === 'careInbox') { if (Array.isArray(data)) this.db.careInbox = data; return; }
        if (name === 'summary') { if (data && typeof data === 'object') this.dashboardSummary = data; return; }
    },

    // If any API slice still failed after retries, surface a visible,
    // dismissible banner naming the slices instead of letting the app silently
    // look like empty tabs.
    showDataWarning(slices) {
        if (typeof document === 'undefined') return;
        if (document.getElementById('data-warning-banner')) return;
        const names = Array.isArray(slices) && slices.length ? ' (' + slices.join(', ') + ')' : '';
        const banner = document.createElement('div');
        banner.id = 'data-warning-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b91c1c;color:#fff;padding:10px 14px;font-size:13px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.45);cursor:pointer;';
        banner.title = 'Click to dismiss';
        banner.innerHTML = 'Warning: some data could not be loaded from the server' + names + '. If tabs look empty, make sure the backend is running, then press Ctrl+F5 to refresh.';
        banner.addEventListener('click', () => banner.remove());
        document.body.appendChild(banner);
    },

    refreshDashboardSummary() {
        if (!this.apiEnabled()) return;
        Church2API.dashboardSummary(this.session.currentBranch || 'global')
            .then((s) => {
                this.dashboardSummary = s;
                this.renderAll();
            })
            .catch(() => {});
    },

    // Fire an API write in the background. The local optimistic update has
    // already rendered, so we only surface failures. `onOk` reconciles any
    // server-assigned id back onto the optimistic record. Never throws.
    apiWrite(promiseFactory, onOk) {
        if (!this.apiEnabled()) return;
        Promise.resolve().then(promiseFactory)
            .then((r) => { if (onOk) try { onOk(r); } catch (e) { console.error(e); } })
            .catch((e) => {
                console.error('Sync failed:', e);
                if (this.toast) this.toast('Saved locally, but not synced to the server.', 'error');
            });
    },

    syncMemberProfile(member) {
        if (!member) return;
        this.apiWrite(
            () => Church2API.updateMember(member.id, {
                engagement_score: member.engagement_score,
                volunteer_skills: Array.isArray(member.volunteer_skills) ? member.volunteer_skills : [],
                spiritual_milestones: Array.isArray(member.spiritualMilestones) ? member.spiritualMilestones : [],
                familyId: member.familyId || null,
                familyRole: member.familyRole || null,
                familyName: member.familyName || null,
                familyContactName: member.familyContactName || null,
                familyContactPhone: member.familyContactPhone || null,
                familyContactEmail: member.familyContactEmail || null,
                familyMembers: Array.isArray(member.familyMembers) ? member.familyMembers : [],
                pledgeAmount: member.pledgeAmount == null ? null : (parseFloat(member.pledgeAmount) || 0),
                pledgePaid: parseFloat(member.pledgePaid) || 0,
            }),
            (srv) => {
                if (!srv) return;
                if (srv.engagement_score !== undefined) member.engagement_score = srv.engagement_score;
                if (Array.isArray(srv.volunteer_skills)) member.volunteer_skills = srv.volunteer_skills;
                if (Array.isArray(srv.spiritualMilestones)) member.spiritualMilestones = srv.spiritualMilestones;
                if (srv.familyId !== undefined) member.familyId = srv.familyId;
                if (srv.familyRole !== undefined) member.familyRole = srv.familyRole;
                if (srv.familyName !== undefined) member.familyName = srv.familyName;
                if (srv.familyContactName !== undefined) member.familyContactName = srv.familyContactName;
                if (srv.familyContactPhone !== undefined) member.familyContactPhone = srv.familyContactPhone;
                if (srv.familyContactEmail !== undefined) member.familyContactEmail = srv.familyContactEmail;
                if (Array.isArray(srv.familyMembers)) member.familyMembers = srv.familyMembers;
                if (srv.pledgeAmount !== undefined) member.pledgeAmount = srv.pledgeAmount;
                if (srv.pledgePaid !== undefined) member.pledgePaid = srv.pledgePaid;
            }
        );
    },

    handleLogin() {
        const email = document.getElementById('login-email').value.trim().toLowerCase();
        const password = document.getElementById('login-password').value;
        const err = document.getElementById('auth-error');

        // Production: authenticate against the real API.
        if (window.Church2API && Church2API.isEnabled()) {
            Church2API.login(email, password)
                .then((r) => {
                    if (r.mfaRequired) this.showAuthScreen('mfa', { email, ticket: r.ticket, methods: r.methods || ['email'] });
                    else if (r.token) { Church2API.completePasswordLogin(r); this._finishApiLogin(r.user); }
                })
                .catch((e) => { if (err) err.textContent = e.message || 'Sign in failed.'; });
            return;
        }

        // Production is backend-only - there are no local accounts.
        if (err) err.textContent = 'Backend not connected. On your computer run npm run dev (or START-APP.bat); on the live site wait a minute and reload.';
    },

    handleRegister() {
        const err = document.getElementById('auth-error');
        if (!this.apiEnabled()) {
            if (err) err.textContent = 'Backend not connected. On your computer run npm run dev (or START-APP.bat); on the live site wait a minute and reload.';
            return;
        }
        const name = (document.getElementById('reg-name').value || '').trim();
        const email = (document.getElementById('reg-email').value || '').trim().toLowerCase();
        const password = document.getElementById('reg-password').value || '';
        const branchId = document.getElementById('reg-branch').value;
        const phone = (document.getElementById('reg-phone').value || '').trim();
        if (!name || !email || !password || !branchId) {
            if (err) err.textContent = 'Please fill in all fields.';
            return;
        }
        if (password.length < 8) {
            if (err) err.textContent = 'Password must be at least 8 characters.';
            return;
        }
        Church2API.register({ name, email, password, branchId, phone: phone || undefined })
            .then((r) => {
                if (r && r.token) { Church2API.completePasswordLogin(r); this._finishApiLogin(r.user); }
            })
            .catch((e) => { if (err) err.textContent = e.message || 'Registration failed.'; });
    },

    handleMfaRequest(ctx, method, resend) {
        const status = document.getElementById('mfa-status');
        const err = document.getElementById('auth-error');
        if (!this.apiEnabled()) {
            if (status) status.textContent = 'Backend not connected yet - on your computer run npm run dev, or wait a minute on the live site and reload.';
            return;
        }
        const m = method || (ctx && ctx.method) || 'email';
        const label = m === 'sms' ? 'phone' : 'email';
        if (status) status.textContent = resend ? 'Sending a new code...' : 'Sending code...';
        Church2API.requestMfaCode(ctx.ticket, m)
            .then((r) => {
                if (status) status.textContent = `Code sent to your ${label}.${r && r.debugCode ? ` (dev code: ${r.debugCode})` : ''}`;
            })
            .catch((e) => { if (err) err.textContent = e.message || 'Could not send the code.'; });
    },

    handleMfa(ctx) {
        const code = (document.getElementById('mfa-code').value || '').trim();
        const err = document.getElementById('auth-error');
        const isRecovery = ctx && ctx.method === 'recovery';
        if (isRecovery ? code.length < 8 : !/^\d{6}$/.test(code)) {
            if (err) err.textContent = isRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code.';
            return;
        }

        // Production: verify the code with the API and receive the access token.
        if (window.Church2API && Church2API.isEnabled()) {
            Church2API.verifyMfa(ctx.ticket, code)
                .then((r) => this._finishApiLogin(r.user))
                .catch((e) => { if (err) err.textContent = e.message || 'Incorrect code.'; });
            return;
        }

        // Production is backend-only - there is no demo code path.
        if (err) err.textContent = 'Backend not connected yet - on your computer run npm run dev, or wait a minute on the live site and reload.';
    },

    handleForgotRequest(ctx) {
        const err = document.getElementById('auth-error');
        const email = (document.getElementById('forgot-email').value || '').trim().toLowerCase();
        if (!this.apiEnabled()) {
            if (err) err.textContent = 'Backend not connected yet - on your computer run npm run dev, or wait a minute on the live site and reload.';
            return;
        }
        if (!email) { if (err) err.textContent = 'Enter your email address.'; return; }
        Church2API.forgotPassword(email)
            .then(() => this.showAuthScreen('forgot', { stage: 'code', email }))
            .catch((e) => { if (err) err.textContent = e.message || 'Could not send the reset code.'; });
    },

    handleForgotReset(ctx) {
        const err = document.getElementById('auth-error');
        const email = (ctx && ctx.email) || (document.getElementById('forgot-email').value || '').trim().toLowerCase();
        const code = (document.getElementById('forgot-code').value || '').trim();
        const password = document.getElementById('forgot-password').value || '';
        if (!code || password.length < 8) {
            if (err) err.textContent = 'Enter the reset code and a password of at least 8 characters.';
            return;
        }
        Church2API.resetPassword(email, code, password)
            .then(() => {
                this.toast('Password reset. Sign in with your new password.');
                this.showAuthScreen('credentials');
            })
            .catch((e) => { if (err) err.textContent = e.message || 'Could not reset the password.'; });
    },

    // ---- Account security (Settings > Security & Sign-in) ---------------------
    renderSecuritySettings() {
        const root = document.getElementById('security-settings-root');
        if (!root) return;
        if (!this.apiEnabled()) {
            root.innerHTML = '<div style="color:var(--text-secondary); font-size:0.85rem;">Connect to the live database to manage your account security.</div>';
            return;
        }
        const me = this.session.currentUser || {};
        const status = [
            ['MFA required (account policy)', me.mfaRequired ? 'Yes' : 'No'],
            ['MFA enabled', me.mfaEnabled ? 'Yes' : 'No'],
            ['Authenticator app (TOTP)', me.hasTotp ? 'On' : 'Off'],
            ['Recovery codes saved', me.recoveryCount ? String(me.recoveryCount) : 'None'],
        ];
        root.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-bottom:14px;">
                ${status.map(([k, v]) => `<div style="padding:10px 12px; border:1px solid var(--border-light); border-radius:10px;">
                    <div style="font-size:0.7rem; color:var(--text-secondary);">${esc(k)}</div>
                    <div style="font-size:0.95rem; font-weight:600;">${esc(v)}</div>
                </div>`).join('')}
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px;">
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <h4 style="font-size:0.9rem; margin:0;">Change password</h4>
                    <input type="password" id="sec-current-password" class="form-control" placeholder="Current password" autocomplete="current-password">
                    <input type="password" id="sec-new-password" class="form-control" placeholder="New password (8+ chars, letters &amp; numbers)" autocomplete="new-password">
                    <button type="button" class="btn btn-primary-gradient btn-sm" onclick="ChurchApp.changePassword()">Change password</button>
                    <p id="sec-password-status" class="auth-sub" style="font-size:0.7rem; margin:0;"></p>
                </div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <h4 style="font-size:0.9rem; margin:0;">Authenticator app (TOTP)</h4>
                    ${me.hasTotp
                        ? `<div style="font-size:0.8rem;">Authenticator app is enabled.</div>
                           ${me.mfaRequired ? '<div style="font-size:0.7rem; color:var(--text-secondary);">MFA is required for this account and cannot be disabled.</div>' : '<button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.disableTotp()">Disable authenticator</button>'}`
                        : '<button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.setupTotp()">Set up authenticator app</button>'}
                    <div id="sec-totp-setup" style="font-size:0.75rem;"></div>
                </div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <h4 style="font-size:0.9rem; margin:0;">Recovery codes</h4>
                    <p style="font-size:0.72rem; color:var(--text-secondary); margin:0;">10 single-use codes to sign in if you lose your phone. Shown only once - store them safely.</p>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.generateRecoveryCodes()">Generate new codes</button>
                    <div id="sec-recovery-codes" style="font-size:0.72rem;"></div>
                </div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <h4 style="font-size:0.9rem; margin:0;">Active sessions</h4>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.renderActiveSessions()">Refresh</button>
                        <button type="button" class="btn btn-danger btn-sm" onclick="ChurchApp.signOutAllDevices()">Sign out all devices</button>
                    </div>
                    <div id="sec-sessions" style="font-size:0.72rem;"></div>
                </div>
            </div>`;
        this.renderActiveSessions();
    },

    async refreshSecurity() {
        try {
            const { user } = await Church2API.me();
            if (user) this.session.currentUser = Object.assign({}, this.session.currentUser, user);
        } catch (e) { /* token may be dead */ }
        this.renderSecuritySettings();
    },

    async changePassword() {
        const current = (document.getElementById('sec-current-password').value || '');
        const next = (document.getElementById('sec-new-password').value || '');
        const st = document.getElementById('sec-password-status');
        if (!current || next.length < 8) {
            if (st) st.textContent = 'Enter your current and a new password (8+ characters).';
            return;
        }
        try {
            const r = await Church2API.changePassword(current, next);
            if (st) st.textContent = r.otherSessionsRevoked ? 'Password changed - other devices were signed out.' : 'Password changed.';
            document.getElementById('sec-current-password').value = '';
            document.getElementById('sec-new-password').value = '';
        } catch (e) {
            if (st) st.textContent = e.message || 'Could not change password.';
        }
    },

    async setupTotp() {
        const area = document.getElementById('sec-totp-setup');
        try {
            const r = await Church2API.setupTotp();
            if (area) area.innerHTML = `
                <div style="margin-top:8px; padding:10px; border:1px solid var(--border-light); border-radius:10px;">
                    <div style="font-weight:600; margin-bottom:4px;">1. Add to your authenticator app</div>
                    <textarea readonly rows="2" class="form-control" style="font-family:monospace; font-size:0.7rem; resize:none;">${esc(r.uri)}</textarea>
                    <div style="font-size:0.7rem; color:var(--text-secondary); margin:6px 0;">Or enter this secret manually: <code>${esc(r.secret)}</code></div>
                    <div style="font-weight:600; margin:8px 0 4px;">2. Confirm the 6-digit code</div>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="sec-totp-code" class="form-control" inputmode="numeric" maxlength="6" placeholder="000000" style="flex:1;">
                        <button type="button" class="btn btn-primary-gradient btn-sm" onclick="ChurchApp.verifyTotpSetup()">Enable</button>
                    </div>
                </div>`;
        } catch (e) {
            if (area) area.textContent = e.message || 'Could not start authenticator setup.';
        }
    },

    async verifyTotpSetup() {
        const code = (document.getElementById('sec-totp-code').value || '').trim();
        const area = document.getElementById('sec-totp-setup');
        if (!/^\d{6}$/.test(code)) { if (area) area.textContent = 'Enter the 6-digit code from your authenticator app.'; return; }
        try {
            await Church2API.verifyTotp(code);
            this.toast('Authenticator app enabled.');
            await this.refreshSecurity();
        } catch (e) {
            if (area) area.textContent = e.message || 'Could not enable authenticator.';
        }
    },

    async disableTotp() {
        const pw = window.prompt('Re-enter your password to disable the authenticator app:');
        if (pw === null) return;
        try {
            await Church2API.disableTotp(pw);
            this.toast('Authenticator app disabled.');
            await this.refreshSecurity();
        } catch (e) {
            this.toast(e.message || 'Could not disable authenticator.');
        }
    },

    async generateRecoveryCodes() {
        const pw = window.prompt('Re-enter your password to generate new recovery codes:');
        if (pw === null) return;
        const el = document.getElementById('sec-recovery-codes');
        try {
            const r = await Church2API.recoveryCodes(pw);
            if (el) el.innerHTML = `<div style="margin-top:8px; padding:10px; border:1px solid var(--border-light); border-radius:10px;">
                <div style="font-weight:600; margin-bottom:4px;">Save these codes - they are shown only once.</div>
                <div style="font-family:monospace; font-size:0.7rem; line-height:1.6;">${r.codes.map((c) => esc(c)).join('<br>')}</div>
            </div>`;
            this.toast('New recovery codes generated.');
            await this.refreshSecurity();
        } catch (e) {
            if (el) el.textContent = e.message || 'Could not generate recovery codes.';
        }
    },

    async renderActiveSessions() {
        const el = document.getElementById('sec-sessions');
        if (!el) return;
        try {
            const r = await Church2API.sessions();
            const list = r.sessions || [];
            el.innerHTML = list.length
                ? list.map((x) => {
                    const when = new Date(x.created_at).toLocaleString();
                    const label = x.current ? ' (this device)' : '';
                    return `<div style="display:flex; justify-content:space-between; gap:8px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border-light);">
                        <div style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(x.user_agent || 'Unknown device')}
                            <div style="font-size:0.65rem; color:var(--text-secondary);">Signed in ${esc(when)}${esc(label)}</div>
                        </div>
                        ${x.current ? '' : `<button type="button" class="btn btn-danger btn-sm" onclick="ChurchApp.revokeSession('${x.id}')">Revoke</button>`}
                    </div>`;
                }).join('')
                : '<div style="color:var(--text-secondary);">No active sessions.</div>';
        } catch (e) {
            el.textContent = 'Could not load sessions.';
        }
    },

    async revokeSession(id) {
        try {
            await Church2API.revokeSession(id);
            this.toast('Session revoked.');
            this.renderActiveSessions();
        } catch (e) {
            this.toast(e.message || 'Could not revoke session.');
        }
    },

    async signOutAllDevices() {
        if (!window.confirm('Sign out every device, including this one?')) return;
        try {
            await Church2API.logoutAll();
            this.toast('Signed out everywhere.');
            await this.refreshSecurity();
        } catch (e) {
            this.toast(e.message || 'Could not sign out all devices.');
        }
    },

    logout() {
        if (typeof localStorage !== 'undefined') localStorage.removeItem('church2_session');
        if (window.Church2API && Church2API.isEnabled()) Church2API.logout();
        this.session.currentUser = null;
        this.showAuthScreen('credentials');
    },

    // Helper: Generate historical transactions over the last 14 days
    // Ten members makes every chart and average look like a toy. A real MMC
    // campus roll runs into the hundreds, so we grow the handcrafted core (m1-m10,
    // referenced by groups, events and prayer requests) into a congregation of a
    // believable size. Names are drawn from common Kenyan given/family names.
    generateCongregation() {
        const FIRST = ['Alice', 'Benard', 'Brenda', 'Caleb', 'Carolyne', 'Collins', 'Cynthia', 'Daniel',
            'Dennis', 'Dorcas', 'Edwin', 'Elizabeth', 'Emmanuel', 'Eunice', 'Evans', 'Gladys', 'Griffin',
            'Hellen', 'Ian', 'Irene', 'Isaac', 'Jackline', 'James', 'Joan', 'Joseph', 'Josphat', 'Judy',
            'Kevin', 'Lilian', 'Lucy', 'Martin', 'Mercy', 'Moses', 'Naomi', 'Nelson', 'Nancy', 'Patrick',
            'Pauline', 'Purity', 'Rose', 'Ruth', 'Silas', 'Sharon', 'Stephen', 'Susan', 'Timothy',
            'Valentine', 'Victor', 'Winnie', 'Zachary'];
        const LAST = ['Achieng', 'Barasa', 'Cheruiyot', 'Chepkoech', 'Gitonga', 'Kimani', 'Kiplagat',
            'Kirui', 'Koech', 'Langat', 'Maina', 'Makau', 'Mbugua', 'Mburu', 'Mutiso', 'Muthoni',
            'Mwende', 'Nyakundi', 'Njuguna', 'Nyambura', 'Obara', 'Ochieng', 'Odhiambo', 'Okoth',
            'Omondi', 'Ondiek', 'Owuor', 'Rotich', 'Sang', 'Wafula', 'Waweru', 'Wekesa'];
        const SKILLS = ['Ushering', 'Greeting', 'Worship Vocals', 'Keyboard', 'Guitar', 'Drums',
            'Sound Engineering', 'Video Editing', 'Graphics', 'Childcare', 'Youth Mentorship',
            'Intercession', 'First Aid', 'Security', 'Social Media', 'Hospitality', 'Public Speaking'];
        const ROLES = ['Single', 'Husband', 'Wife'];

        // Weighted so the CBD mother church carries most of the roll.
        const spread = [
            { branchId: 'b1', count: 78 },
            { branchId: 'b2', count: 41 },
            { branchId: 'b3', count: 27 }
        ];
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
        let n = this.db.members.length;

        spread.forEach(({ branchId, count }) => {
            const branch = this.db.branches.find(b => b.id === branchId);
            for (let i = 0; i < count; i++) {
                n += 1;
                const firstName = pick(FIRST);
                const lastName = pick(LAST);
                const skills = [...new Set([pick(SKILLS), pick(SKILLS)])];
                // Engagement clusters high - most of a congregation is engaged -
                // with a genuine tail so the at-risk analytics have real subjects.
                const roll = Math.random();
                const engagement = roll < 0.12 ? 20 + Math.floor(Math.random() * 25)
                    : roll < 0.35 ? 45 + Math.floor(Math.random() * 25)
                    : 70 + Math.floor(Math.random() * 30);
                this.db.members.push({
                    id: `m${n}`,
                    branchId,
                    branchName: branch ? branch.name : '',
                    firstName,
                    lastName,
                    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${n}@email.com`,
                    phone: `+2547${String(10000000 + Math.floor(Math.random() * 89999999))}`,
                    familyId: `fam_${lastName.toLowerCase()}_${n}`,
                    familyRole: pick(ROLES),
                    spiritualMilestones: Math.random() < 0.6
                        ? [`Member: ${2012 + Math.floor(Math.random() * 13)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`]
                        : [],
                    volunteer_skills: skills,
                    engagement_score: engagement
                });
            }
        });

        // Enrol roughly half of each campus into that campus's groups. Groups
        // seeded with two or three named members look empty next to an 83-person
        // campus roll, which misreads as "nobody uses this feature".
        this.db.branches.forEach((branch) => {
            const groups = this.db.groups.filter(g => g.branchId === branch.id);
            if (!groups.length) return;
            const pool = this.db.members.filter(m => m.branchId === branch.id);
            pool.forEach((m, i) => {
                if (Math.random() > 0.5) return;
                const g = groups[i % groups.length];
                if (!g.memberIds.includes(m.id)) g.memberIds.push(m.id);
            });
        });
    },

    generateInitialTransactions() {
        // Amount bands are in Kenyan Shillings and differ by category - a tithe
        // is a far larger cheque than a Sunday offering, and flattening them
        // would make the giving analytics meaningless.
        const bands = {
            'Tithe': [2000, 25000],
            'Offering': [100, 2000],
            'Pledge': [1000, 15000],
            'Project Donation': [500, 10000]
        };
        const categories = Object.keys(bands);
        // Weighted to reflect Kenyan giving: M-Pesa carries the clear majority.
        const methods = ['M-Pesa', 'M-Pesa', 'M-Pesa', 'M-Pesa', 'Bank Transfer', 'Cash', 'Card'];
        const now = new Date();

        // Roughly one gift per member over the fortnight, so the giving totals
        // stay proportional to the size of the congregation.
        const txCount = Math.max(40, Math.round(this.db.members.length * 1.4));
        for (let i = 0; i < txCount; i++) {
            const memberIndex = Math.floor(Math.random() * this.db.members.length);
            const member = this.db.members[memberIndex];
            const category = categories[Math.floor(Math.random() * categories.length)];
            const [lo, hi] = bands[category];
            // Round to the nearest 50 shillings - real giving lands on round numbers.
            const amount = Math.round((Math.random() * (hi - lo) + lo) / 50) * 50;
            const method = methods[Math.floor(Math.random() * methods.length)];
            
            // Random date in the last 14 days
            const daysAgo = Math.floor(Math.random() * 14);
            const txDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
            
            this.db.transactions.push({
                id: `t_${i}`,
                branchId: member.branchId,
                branchName: member.branchName,
                memberId: member.id,
                memberName: `${member.firstName} ${member.lastName}`,
                amount: amount,
                category: category,
                date: txDate.toISOString().split('T')[0],
                paymentMethod: method,
                receiptNumber: `REC-2026-${10000 + i}`
            });
        }

        // A few walk-in guests give during services - they have no member
        // record, so the guest contributions ledger has something to show.
        const guestCount = Math.max(4, Math.round(this.db.members.length * 0.08));
        const guestMethods = ['Cash', 'M-Pesa', 'M-Pesa'];
        for (let i = 0; i < guestCount; i++) {
            const branch = this.db.branches[Math.floor(Math.random() * this.db.branches.length)];
            const amount = Math.round((Math.random() * 3500 + 200) / 50) * 50;
            const daysAgo = Math.floor(Math.random() * 14);
            const txDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
            this.db.transactions.push({
                id: `tg_${i}`,
                branchId: branch.id,
                branchName: branch.name,
                memberId: null,
                memberName: 'Guest Visitor',
                amount,
                category: 'General Contribution - Guest',
                date: txDate.toISOString().split('T')[0],
                paymentMethod: guestMethods[Math.floor(Math.random() * guestMethods.length)],
                receiptNumber: `REC-2026-${90000 + i}`
            });
        }
        
        // Sort transactions by date descending
        this.db.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    // Helper: Seed real attendance records over the last year of Sundays. These
    // records are the single source of truth for all attendance analytics - the
    // dashboard and AI briefing read them, never a random number.
    generateInitialAttendance() {
        this.db.attendance = [];
        const services = this.getRecentServiceDates(52); // oldest -> newest
        // Members deliberately given a recent absence streak so at-risk detection
        // has something real to surface.
        const streakIds = ['m7', 'm9', 'm10'];

        this.db.members.forEach(member => {
            const base = Math.min(0.95, Math.max(0.35, (member.engagement_score || 60) / 100));
            services.forEach((date, idx) => {
                const isRecent = idx >= services.length - 3; // last 3 services
                let present;
                if (streakIds.includes(member.id) && isRecent) {
                    present = false; // guaranteed 3-service absence streak
                } else {
                    present = Math.random() < base;
                }
                this.db.attendance.push({
                    id: `att_${member.id}_${date}`,
                    memberId: member.id,
                    branchId: member.branchId,
                    date,
                    present
                });
            });
        });
    },

    // Backfill a full year of Sunday service dates onto an existing database.
    // Older seeds only recorded 8 services, which left the dashboard's yearly
    // attendance trend mostly empty - fill in the missing Sundays while
    // preserving any attendance the user has already recorded.
    ensureYearlyAttendance() {
        if (!Array.isArray(this.db.attendance) || !Array.isArray(this.db.members)) return false;
        const haveDates = new Set(this.db.attendance.map(a => a.date));
        const missing = this.getRecentServiceDates(52).filter(d => !haveDates.has(d));
        if (!missing.length) return false;
        this.db.members.forEach(member => {
            const base = Math.min(0.95, Math.max(0.35, (member.engagement_score || 60) / 100));
            missing.forEach(date => {
                this.db.attendance.push({
                    id: `att_${member.id}_${date}`,
                    memberId: member.id,
                    branchId: member.branchId,
                    date,
                    present: Math.random() < base
                });
            });
        });
        return true;
    },

    // 5. Setup Action Listeners
    setupEventHandlers() {
        // Interface Theme Switcher
        const themeSelectEl = document.getElementById('interface-theme-select');
        if (themeSelectEl) {
            themeSelectEl.addEventListener('change', (e) => {
                const theme = e.target.value;
                document.body.className = theme === 'dark' ? '' : 'theme-' + theme;
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('church2_theme', theme);
                }
                // Chart.js paints to a canvas, so it can't inherit the new CSS
                // tokens - repaint or the axis labels keep the old theme's
                // contrast (grey-on-white in Daylight).
                this.renderAll();
            });
        }

        // Role Selector Change
        document.getElementById('role-simulator-select').addEventListener('change', (e) => {
            this.session.currentRole = e.target.value;
            
            // Auto update active tab depending on role
            if (this.session.currentRole === 'member') {
                this.session.activeTab = 'mobile_preview';
            } else if (this.session.activeTab === 'mobile_preview') {
                this.session.activeTab = 'admin_dashboard';
            }
            
            this.renderAll();
        });

        // Branch Switcher Change
        document.getElementById('global-branch-select').addEventListener('change', (e) => {
            this.session.currentBranch = e.target.value;
            this.dashboardSummary = null;
            this.renderAll();
            this.refreshDashboardSummary();
        });

        // Sidebar Navigation links
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navLinks.forEach(n => n.classList.remove('active'));
                link.classList.add('active');
                this.session.activeTab = link.dataset.tab;
                this.renderAll();
            });
        });

        // Quick actions and any [data-goto] button: jump straight to a tab.
        document.querySelectorAll('[data-goto]').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.goto;
                if (!target) return;
                const link = document.querySelector('.nav-link[data-tab="' + target + '"]');
                if (link) link.classList.add('active');
                this.session.activeTab = target;
                this.renderAll();
            });
        });

        // Sidebar search: filter nav links by name (respects role visibility).
        const navSearch = document.getElementById('nav-search-input');
        if (navSearch) {
            navSearch.addEventListener('input', () => {
                const q = navSearch.value.trim().toLowerCase();
                const allowed = this.ROLE_TABS[this.session.currentRole] || this.ROLE_TABS.member;
                document.querySelectorAll('.nav-link').forEach(link => {
                    const tab = link.dataset.tab;
                    const match = !q || link.textContent.toLowerCase().includes(q);
                    link.style.display = (allowed.includes(tab) && match) ? 'flex' : 'none';
                });
                document.querySelectorAll('.nav-group').forEach(group => {
                    const links = group.querySelectorAll('.nav-link');
                    group.style.display = Array.from(links).some(l => l.style.display !== 'none') ? '' : 'none';
                });
            });
        }

        // Mobile: off-canvas sidebar drawer (hamburger in the global header).
        const sidebarToggle = document.getElementById('sidebar-toggle');
        const closeSidebar = () => {
            document.body.classList.remove('sidebar-open');
            const t = document.getElementById('sidebar-toggle');
            if (t) t.setAttribute('aria-expanded', 'false');
        };
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = document.body.classList.toggle('sidebar-open');
                sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        }
        document.addEventListener('click', (e) => {
            if (!document.body.classList.contains('sidebar-open')) return;
            const t = e.target;
            const inSidebar = t && t.closest && (t.closest('.sidebar') || t.closest('#sidebar-toggle'));
            if (!inSidebar) closeSidebar();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeSidebar();
        });
        navLinks.forEach((link) => link.addEventListener('click', closeSidebar));

        // Search Bar Event
        document.getElementById('member-search-input').addEventListener('input', () => {
            this.renderMemberDirectory();
        });
        document.getElementById('member-branch-filter').addEventListener('change', () => {
            this.renderMemberDirectory();
        });

        // Add Member Form Submit
        document.getElementById('add-member-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleCreateMember();
        });
        document.getElementById('member-giving-type')?.addEventListener('change', () => this.toggleMemberGivingType());

        // Record Transaction Form Submit
        document.getElementById('record-tx-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRecordTransaction();
        });

        // Guest Contribution Form Submit (add new, or save an edit from the
        // Guest Contributions tab).
        document.getElementById('guest-tx-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleGuestTxForm();
        });

        // Pledge Payment preview: show the member's pledged amount, contributed
        // money and remaining balance whenever the category or member changes.
        document.getElementById('tx-category-select')?.addEventListener('change', () => this.refreshTxPledgePanel());
        document.getElementById('tx-member-select')?.addEventListener('change', () => this.refreshTxPledgePanel());
        document.getElementById('tx-amount-input')?.addEventListener('input', () => this.refreshTxPledgePanel());

        // Web "Log Contribution Offline" mirrors the member app Give tab.
        document.querySelectorAll('#tx-quick-chips .give-chip').forEach((chip) => {
            chip.addEventListener('click', () => this.pickTxQuickAmount(chip));
        });
        document.getElementById('tx-method-select')?.addEventListener('change', () => this.refreshTxMpesaHint());

        // AI Sermon Repurpose Submit
        document.getElementById('ai-repurpose-btn').addEventListener('click', () => {
            this.handleSermonRepurpose();
        });

        // Mobile Chatbot Handler
        document.getElementById('mobile-chat-send-btn').addEventListener('click', () => {
            this.handleMobileChatSend();
        });
        document.getElementById('mobile-chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleMobileChatSend();
        });

        // Mobile Giving Form Submit
        document.getElementById('mobile-giving-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleMobileGiving();
        });

        // Mobile Serve Sign up button trigger
        document.getElementById('volunteer-skills-signup-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleMobileVolunteerSignup();
        });

        // Settings: church profile, branches and projects (multi-church).
        document.getElementById('church-profile-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const church = this.church || (Array.isArray(this.db.churches) && this.db.churches[0]);
            if (!church) { this.toast('Church profile not loaded yet.', 'error'); return; }
            const payload = {
                name: document.getElementById('church-name-input').value.trim(),
                shortName: document.getElementById('church-short-name-input').value.trim(),
                tagline: document.getElementById('church-tagline-input').value.trim(),
                website: document.getElementById('church-website-input').value.trim(),
                youtubeChannel: document.getElementById('church-youtube-input').value.trim(),
                contactEmail: document.getElementById('church-contact-email-input').value.trim(),
                contactPhone: document.getElementById('church-contact-phone-input').value.trim(),
                newsBullet: document.getElementById('church-news-bullet-input').value.trim(),
            };
            if (!payload.name) { this.toast('Church name is required.', 'error'); return; }
            this.apiWrite(() => Church2API.updateChurch(church.id, payload), () => {
                this.hydrateFromApi().then(() => this.renderAll());
                this.toast('Church profile saved.');
            });
        });

        document.getElementById('add-branch-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('branch-name-input').value.trim();
            const location = document.getElementById('branch-location-input').value.trim();
            const code = document.getElementById('branch-code-input').value.trim();
            if (!name) { this.toast('Branch name is required.', 'error'); return; }
            const payload = { name, location, code };
            const done = () => { this.resetBranchForm(); this.hydrateFromApi().then(() => this.renderAll()); };
            if (this.editingBranchId) {
                this.apiWrite(() => Church2API.updateBranch(this.editingBranchId, payload), () => { this.toast('Branch updated.'); done(); });
            } else {
                this.apiWrite(() => Church2API.createBranch(payload), () => { this.toast('Branch added.'); done(); });
            }
        });

        document.getElementById('branch-form-cancel')?.addEventListener('click', () => this.resetBranchForm());

        document.getElementById('add-campaign-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitCampaignForm('');
        });
        document.getElementById('dash-add-campaign-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitCampaignForm('dash-');
        });
        document.getElementById('dash-new-project-btn')?.addEventListener('click', () => this.openDashboardProjectForm());
        document.getElementById('dash-cancel-campaign-btn')?.addEventListener('click', () => this.resetCampaignForm('dash-'));

        document.getElementById('cancel-campaign-btn')?.addEventListener('click', () => this.resetCampaignForm());
        document.getElementById('new-project-btn')?.addEventListener('click', () => this.openNewProject());

        // Sign out
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
    },

    // 6. Master Render Coordinator
    // Live theme tokens for canvas-drawn charts, which can't inherit CSS.
    chartTheme() {
        const css = getComputedStyle(document.body);
        const read = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
        const light = document.body.classList.contains('theme-light');
        return {
            tick: read('--text-secondary', '#9ca3af'),
            grid: light ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255,255,255,0.05)',
            surface: light ? '#ffffff' : '#0b1220',
            legend: read('--text-primary', '#f3f4f6')
        };
    },

    // Fill every campus <select> from db.branches so the campus list lives in
    // exactly one place. Selects keep any leading "all"/"global" option and
    // their current value where it is still valid.
    populateCampusSelects() {
        document.querySelectorAll('select[data-campus-select]').forEach((sel) => {
            const previous = sel.value;
            const keep = [...sel.options].filter(o => o.value === 'all' || o.value === 'global');
            sel.innerHTML = '';
            keep.forEach(o => sel.appendChild(o));
            this.db.branches.forEach((b) => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name;
                sel.appendChild(opt);
            });
            if (previous && [...sel.options].some(o => o.value === previous)) sel.value = previous;
            else if (this.session.currentBranch && [...sel.options].some(o => o.value === this.session.currentBranch)) sel.value = this.session.currentBranch;
        });

        // Member pickers list the people actually on the books, scoped to the
        // campus in view so a branch admin can't record giving for another campus.
        const scope = this.session.currentBranch;
        const inScope = this.db.members.filter(m => scope === 'global' || m.branchId === scope);
        document.querySelectorAll('select[data-member-select]').forEach((sel) => {
            const previous = sel.value;
            const keep = [...sel.options].filter(o => o.value === 'anonymous');
            sel.innerHTML = '';
            keep.forEach(o => sel.appendChild(o));
            inScope.forEach((m) => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = `${m.firstName} ${m.lastName}`;
                sel.appendChild(opt);
            });
            if (previous && [...sel.options].some(o => o.value === previous)) sel.value = previous;
            else if (this.session.currentBranch && [...sel.options].some(o => o.value === this.session.currentBranch)) sel.value = this.session.currentBranch;
        });
    },

    renderAll() {
        this.populateCampusSelects();
        this.populateMemberGiveProjects();
        const role = this.session.currentRole;
        const branchId = this.session.currentBranch;

        // RBAC enforcement: if the current role isn't permitted the active tab,
        // redirect to that role's default landing tab. This is real access
        // control - not merely hiding nav links - so no route reaches a panel
        // the role can't see.
        const allowed = this.ROLE_TABS[role] || this.ROLE_TABS.member;
        if (!allowed.includes(this.session.activeTab)) {
            this.session.activeTab = (role === 'member') ? 'mobile_preview' : 'admin_dashboard';
        }
        const activeTab = this.session.activeTab;

        // Real-phone hooks: flag when the member app is on screen and when the
        // signed-in account is a real member, so CSS can go full-screen and
        // immersive on phones. The real role (not a simulated preview role) is
        // used so an admin previewing the member app keeps the console chrome.
        const appRoot = document.getElementById('app-container');
        if (appRoot) {
            appRoot.classList.toggle('mode-mobile', activeTab === 'mobile_preview');
            const realRole = (this.session.currentUser && this.session.currentUser.role) || role;
            appRoot.classList.toggle('mode-member', realRole === 'member');
        }

        // Sync header displays. "global" is a valid selection (All Branches) that
        // has no matching branch record, so fall back to a friendly label instead
        // of dereferencing undefined and aborting the entire render.
        const branchObj = this.db.branches.find(b => b.id === branchId);
        const branchLabel = branchObj ? branchObj.name : (branchId === 'global' ? 'All Branches' : 'Unknown Campus');
        document.getElementById('active-branch-indicator').innerText = branchLabel;
        document.getElementById('active-role-indicator').innerText = role.toUpperCase().replace('_', ' ');

        // The "Simulated Role" preview control is a super-admin-only affordance.
        // Hiding it for other signed-in users closes an escalation path: a member
        // must not be able to switch themselves into an admin role.
        const roleSimWrap = document.getElementById('role-simulator-select')?.closest('div');
        if (roleSimWrap) {
            const isSuperAdmin = !this.session.currentUser || this.session.currentUser.role === 'hq_admin';
            roleSimWrap.style.display = isSuperAdmin ? '' : 'none';
        }

        // Branch scope: HQ admin roams all campuses; every other role is locked
        // to the campus they actually administer (from their signed-in account),
        // not a hardcoded default.
        const branchSelect = document.getElementById('global-branch-select');
        if (role === 'hq_admin') {
            branchSelect.removeAttribute('disabled');
        } else {
            const homeBranch = (this.session.currentUser && this.session.currentUser.branchId) || this.firstBranchId();
            this.session.currentBranch = homeBranch;
            branchSelect.value = homeBranch;
            branchSelect.setAttribute('disabled', 'true');
        }

        // Sidebar link visibility is driven entirely by ROLE_TABS - the single
        // source of truth - so the nav can never show a link the RBAC check at
        // the top of renderAll would immediately bounce.
        const allowedTabs = this.ROLE_TABS[role] || this.ROLE_TABS.member;
        document.querySelectorAll('.nav-link').forEach(link => {
            const tab = link.dataset.tab;
            link.style.display = allowedTabs.includes(tab) ? 'flex' : 'none';
            link.classList.toggle('active', tab === activeTab);
        });
        // Hide nav groups whose links are all hidden for this role.
        document.querySelectorAll('.nav-group').forEach(group => {
            const links = group.querySelectorAll('.nav-link');
            const anyVisible = Array.from(links).some(l => l.style.display !== 'none');
            group.style.display = anyVisible ? '' : 'none';
        });

        // Sidebar profile chip (signed-in user).
        const profileName = document.getElementById('sidebar-profile-name');
        const profileAvatar = document.getElementById('sidebar-profile-avatar');
        const signedIn = this.session.currentUser;
        const roleLabel = String(role || 'admin').toUpperCase().replace('_', ' ');
        if (profileName) profileName.innerText = (signedIn && signedIn.name) || roleLabel.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        if (profileAvatar) {
            const src = (signedIn && signedIn.name) || roleLabel;
            profileAvatar.innerText = src.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'SA';
        }

        // Render main view panels
        const panels = ['admin_dashboard', 'admin_directory', 'admin_financials', 'admin_staff', 'admin_ministry', 'admin_followups', 'admin_groups', 'admin_communications', 'admin_settings', 'mobile_preview'];
        panels.forEach(p => {
            const panelEl = document.getElementById(p);
            if (panelEl) {
                panelEl.style.display = (p === activeTab) ? 'block' : 'none';
            }
        });

        // Trigger individual panel renders
        if (activeTab === 'admin_dashboard') {
            this.renderDashboard();
        } else if (activeTab === 'admin_directory') {
            this.renderMemberDirectory();
        } else if (activeTab === 'admin_financials') {
            this.renderFinancials();
        } else if (activeTab === 'admin_staff') {
            this.renderStaffPanel();
        } else if (activeTab === 'admin_ministry') {
            this.renderMinistry();
        } else if (activeTab === 'admin_followups') {
            this.renderFollowUps();
        } else if (activeTab === 'admin_groups') {
            this.renderGroups();
        } else if (activeTab === 'admin_communications') {
            this.renderCommunications();
        } else if (activeTab === 'admin_settings') {
            this.renderSettings();
        } else if (activeTab === 'mobile_preview') {
            this.renderMobilePreview();
        }
    },

    // 7. Panel: Dashboard View Rendering
    renderDashboard() {
        const branchId = this.session.currentBranch;
        const role = this.session.currentRole;

        // Filter transactions/attendance for calculations. Scope to a single campus
        // unless "All Branches (Global)" is selected, in which case aggregate everything.
        let branchTx = this.db.transactions;
        let branchMembers = this.db.members;
        let branchAttendance = this.db.attendance || [];

        if (branchId && branchId !== 'global') {
            branchTx = this.db.transactions.filter(t => t.branchId === branchId);
            branchMembers = this.db.members.filter(m => m.branchId === branchId);
            branchAttendance = branchAttendance.filter(a => a.branchId === branchId);
        }

        // Compute AI Snapshot Metrics - all derived from real records, no randomness
        const snapshot = window.AIEngine.generateWeeklySnapshot(
            this.db.branches,
            branchMembers,
            branchTx,
            this.db.events,
            branchAttendance
        );

        // Update dashboard counters
        document.getElementById('dash-giving-total').innerText = money(snapshot.thisWeekGiving);
        document.getElementById('dash-giving-change').innerText = snapshot.givingDiffPercent;
        document.getElementById('dash-giving-change').className = snapshot.givingDiffPercent.startsWith('-') ? 'changedown' : 'changeup';

        document.getElementById('dash-members-total').innerText = branchMembers.length;
        if (this.dashboardSummary) {
            const summary = this.dashboardSummary;
            document.getElementById('dash-giving-total').innerText = money(summary.thisWeekGiving);
            if (summary.givingChangePct != null) {
                document.getElementById('dash-giving-change').innerText = summary.givingChangePct + '%';
                document.getElementById('dash-giving-change').className = summary.givingChangePct >= 0 ? 'changeup' : 'changedown';
            }
            document.getElementById('dash-members-total').innerText = summary.activeMembers;
        }
        // Label the scope honestly - "Across campuses" is wrong when a single
        // campus is selected, and the count would look like a church-wide total.
        const scopeLabel = document.getElementById('dash-members-scope');
        if (scopeLabel) {
            const b = this.db.branches.find(x => x.id === this.session.currentBranch);
            scopeLabel.innerText = b ? `At ${b.name}` : 'Across all branches';
        }

        // Render AI Ministry Health Executive Briefing card
        const aiSnapshotCard = document.getElementById('ai-snapshot-content');
        if (aiSnapshotCard) {
            aiSnapshotCard.innerHTML = `
                <div class="ai-header-badge">
                    <svg class="badge-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/></svg> AI-GENERATED ${new Date().toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()} BRIEFING
                </div>
                <p class="ai-report-title">Weekly Ministry Health Report</p>
                <div class="weekly-bulletin-ai md-body">${renderMarkdown(snapshot.bulletSummary)}</div>
                <div class="ai-exec-context md-body">
                    <strong>Executive Context:</strong> ${renderMarkdown(snapshot.executiveSnapshot)}
                </div>
                <div class="at-risk-container">
                    <span class="at-risk-heading"><svg class="inline-ico warn-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17.2v.1"/></svg> CRITICAL CARE ALERTS (At-Risk Members)</span>
                    <ul class="at-risk-list">
                        ${snapshot.atRisk.length ? snapshot.atRisk.map(m => `<li>${esc(m)}</li>`).join('') : '<li class="muted-italic">No at-risk members this week - great job!</li>'}
                    </ul>
                </div>
            `;
        }

       // Render charts inside dashboard
       this.renderDashboardCharts(branchTx, branchAttendance);

       // Projects & Fundraising section - admin posts, members see live progress.
       this.renderDashboardProjects();

       // Reference-dashboard panels: greeting, health, breakdowns, events, care.
       this.renderDashboardInsights(branchTx, branchMembers, snapshot);
       this.renderSuggestedAnnouncements();
   },

    // Reference-mockup dashboard panels. Every figure is derived from the same
    // real records the rest of the app uses - no hardcoded numbers.
    renderDashboardInsights(branchTx, branchMembers, snapshot) {
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const money = (n) => (typeof window !== 'undefined' && window.money) ? window.money(n) : `Ksh ${(Number(n) || 0).toLocaleString('en-KE')}`;
        const role = this.session.currentRole;
        const user = this.session.currentUser;

        // Greeting - time-aware, uses the signed-in user's first name.
        const greeting = document.getElementById('dash-greeting');
        if (greeting) {
            const hour = new Date().getHours();
            const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
            const who = user && user.name ? String(user.name).split(' ')[0] : (role === 'member' ? 'there' : 'Super Admin');
            greeting.innerText = `${part}, ${who}!`;
        }

        // New members joined in the last 30 days (from real milestone dates).
        const nmTotal = document.getElementById('dash-newmembers-total');
        const nmChange = document.getElementById('dash-newmembers-change');
        if (nmTotal) {
            const memberDate = (m) => {
                if (m.addedAt || m.joinedAt || m.createdAt) return new Date(m.addedAt || m.joinedAt || m.createdAt);
                const milestone = (m.spiritualMilestones || []).find((s) => /^member:/i.test(String(s)));
                if (milestone) {
                    const match = /(\d{4}-\d{2}-\d{2})/.exec(milestone);
                    if (match) return new Date(match[1] + 'T00:00:00');
                }
                return null;
            };
            const now = Date.now();
            const dayMs = 86400000;
            const newCount = (branchMembers || []).filter((m) => {
                const d = memberDate(m);
                return d && (now - d.getTime()) <= 30 * dayMs;
            }).length;
            nmTotal.innerText = String(newCount);
            if (nmChange) nmChange.innerText = newCount > 0 ? 'new' : '-';
        }

        // Overall health - starts from real engagement and penalises real gaps.
        const ring = document.getElementById('dash-health-ring');
        const pctEl = document.getElementById('dash-health-pct');
        const labelEl = document.getElementById('dash-health-label');
        if (ring && pctEl) {
            let score = 82;
            score -= (snapshot.atRisk && snapshot.atRisk.length || 0) * 6;
            if ((snapshot.participationPct ?? 0) < 25) score -= 8;
            if ((snapshot.avgAttendance ?? 0) <= 0) score -= 10;
            score = Math.max(10, Math.min(100, Math.round(score)));
            ring.style.setProperty('--health-pct', score);
            pctEl.innerText = score + '%';
            if (labelEl) labelEl.innerText = score >= 70 ? 'Great, keep it up!' : score >= 45 ? 'Needs attention' : 'Prayer needed';
        }

        // Giving breakdown by fund category (all-time in current scope).
        const breakdown = document.getElementById('dash-giving-breakdown');
        if (breakdown) {
            const totals = {};
            let grand = 0;
            (branchTx || []).forEach((t) => {
                const amt = parseFloat(t.amount) || 0;
                const cat = t.category || 'Other';
                totals[cat] = (totals[cat] || 0) + amt;
                grand += amt;
            });
            const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
            breakdown.innerHTML = rows.length
                ? rows.map(([cat, amt]) => `
                    <div class="breakdown-item">
                        <div class="breakdown-head"><span class="breakdown-name">${esc(cat)}</span><span class="breakdown-amt">${money(amt)}</span></div>
                        <div class="breakdown-track"><div class="breakdown-fill" style="width:${grand ? Math.round((amt / grand) * 100) : 0}%"></div></div>
                    </div>`).join('')
                : '<p class="muted-italic" style="font-size:0.82rem;">No giving recorded in this scope yet.</p>';
        }

        // Branch overview - members per campus, scaled to the largest campus.
        const overview = document.getElementById('dash-branch-overview');
        if (overview) {
            const allMembers = this.db.members || [];
            const branches = (this.db.branches || []).slice().sort((a, b) => a.name.localeCompare(b.name));
            const maxCount = Math.max(1, ...branches.map((b) => allMembers.filter((m) => m.branchId === b.id).length));
            const html = branches.map((b) => {
                const count = allMembers.filter((m) => m.branchId === b.id).length;
                return `<div class="branch-row">
                    <div class="branch-head"><span class="branch-name">${esc(b.name)}</span><span class="branch-count">${count} members</span></div>
                    <div class="branch-track"><div class="branch-fill" style="width:${Math.round((count / maxCount) * 100)}%"></div></div>
                </div>`;
            }).join('');
            overview.innerHTML = `
                <div class="branch-row" style="margin-bottom:14px;">
                    <div class="branch-head"><span class="branch-name">All (Global)</span><span class="branch-count">${allMembers.length} members</span></div>
                    <div class="branch-track"><div class="branch-fill" style="width:100%"></div></div>
                </div>
                ${html}`;
        }

        // Upcoming events - next 4 from the real event calendar.
        const events = document.getElementById('dash-upcoming-events');
        if (events) {
            const branchId = this.session.currentBranch;
            let list = (this.db.events || []).slice();
            if (branchId && branchId !== 'global') list = list.filter((e) => e.branchId === branchId);
            const today = new Date().toISOString().slice(0, 10);
            const upcoming = list
                .filter((e) => String(e.date) >= today)
                .sort((a, b) => String(a.date).localeCompare(String(b.date)))
                .slice(0, 4);
            events.innerHTML = upcoming.length
                ? upcoming.map((e) => {
                    const d = new Date(e.date + 'T00:00:00');
                    const day = d.toLocaleDateString(undefined, { day: 'numeric' });
                    const mon = d.toLocaleDateString(undefined, { month: 'short' });
                    const time = e.time ? new Date('2000-01-01T' + e.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
                    const branch = this.db.branches.find((b) => b.id === e.branchId);
                    const goers = (e.rsvpMemberIds || []).map(id => this.db.members.find(mm => mm.id === id)).filter(Boolean);
                    const roles = (e.rolesRequired && e.rolesRequired.length) ? e.rolesRequired.length + ' roles needed' : 'Open event';
                    return `<li class="upcoming-event">
                        <div class="event-date-badge"><span class="day">${day}</span><span class="mon">${mon}</span></div>
                        <div class="event-info">
                            <div class="event-title">${esc(e.title)}</div>
                            <div class="event-time">${time ? time + ' · ' : ''}${esc(branch ? branch.name : '')}</div>
                            <div class="event-branch">${esc(roles)} &middot; ${goers.length} going</div>
                            ${goers.length ? `<div class="event-roster">${goers.map(m => `<span class="group-member-pill">${esc(m.firstName)} ${esc(m.lastName)}</span>`).join('')}</div>` : ''}
                        </div>
                    </li>`;
                }).join('')
                : '<li class="muted-italic" style="font-size:0.82rem;">No upcoming events.</li>';
        }

        // Care alert + prayer requests.
        const careAlert = document.getElementById('dash-care-alert');
        if (careAlert) {
            const count = snapshot.atRisk && snapshot.atRisk.length || 0;
            careAlert.innerHTML = count
                ? `<strong>${count} member(s)</strong> flagged for a 3+ service absence streak. Pastoral care outreach is recommended.`
                : '<strong>All clear.</strong> No at-risk members in this scope this week.';
        }
        const prayers = document.getElementById('dash-prayer-requests');
        if (prayers) {
            const branchId = this.session.currentBranch;
            let list = (this.db.prayerRequests || []).slice();
            if (branchId && branchId !== 'global') {
                const branchName = this.db.branches.find((b) => b.id === branchId)?.name;
                list = list.filter((p) => p.branchId === branchId || p.branchName === branchName);
            }
            const shown = list.slice(-3).reverse();
            prayers.innerHTML = shown.length
                ? shown.map((p) => `<li class="prayer-item"><div class="prayer-name">${esc(p.memberName || 'Prayer request')}</div><div class="prayer-text">${esc(p.text || '')}</div></li>`).join('')
                : '<li class="muted-italic" style="font-size:0.82rem;">No prayer requests yet.</li>';
        }
    },
    renderDashboardCharts(transactions, attendance) {
        // Chart.js is loaded from a CDN and may be unavailable (offline, blocked,
        // or the PWA running without a network). Degrade gracefully instead of
        // throwing "Chart is not defined" and aborting the rest of init().
        if (typeof Chart === 'undefined') {
            document.querySelectorAll('.chart-container-wrapper').forEach((wrap) => {
                if (!wrap.querySelector('.chart-fallback')) {
                    const note = document.createElement('div');
                    note.className = 'chart-fallback';
                    note.textContent = 'Charts are unavailable offline. Reconnect to view visual analytics.';
                    wrap.appendChild(note);
                }
            });
            return;
        }

        // Destroy existing charts to avoid redraw issues
        if (this.charts.giving) this.charts.giving.destroy();
        if (this.charts.categories) this.charts.categories.destroy();

        // 1. Yearly contribution trend: weekly giving summed from real
        // transactions over the past year (per service date).
        const ctxGiving = document.getElementById('giving-trend-chart')?.getContext('2d');
        if (ctxGiving) {
            const serviceDates = this.getRecentServiceDates(52); // oldest -> newest
            const dateLabels = serviceDates.map(d =>
                new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
            const weeklyGiving = serviceDates.map(d =>
                (transactions || []).filter(t => t.date === d)
                    .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0));

            const ct = this.chartTheme();
            this.charts.giving = new Chart(ctxGiving, {
                type: 'line',
                data: {
                    labels: dateLabels,
                    datasets: [{
                        label: 'Contribution',
                        data: weeklyGiving,
                        borderColor: MMC_BRAND.palette.royalLight,
                        backgroundColor: 'rgba(59, 130, 246, 0.14)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 3,
                        pointBackgroundColor: MMC_BRAND.palette.gold,
                        pointBorderColor: '#fff',
                        pointRadius: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            // Anchor at zero: a floating baseline visually
                            // exaggerates ordinary week-to-week variation.
                            beginAtZero: true,
                            grid: { color: ct.grid },
                            ticks: { color: ct.tick, precision: 0 }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: ct.tick }
                        }
                    }
                }
            });
        }

        // 2. Fund allocation breakdown chart (Doughnut)
        const ctxCategories = document.getElementById('category-pie-chart')?.getContext('2d');
        if (ctxCategories) {
            const categories = ['Tithe', 'Offering', 'Pledge', 'Project Donation'];
            const categorySums = categories.map(cat => 
                transactions
                    .filter(t => t.category === cat)
                    .reduce((sum, t) => sum + parseFloat(t.amount), 0)
            );

            const ctc = this.chartTheme();
            this.charts.categories = new Chart(ctxCategories, {
                type: 'doughnut',
                data: {
                    labels: categories,
                    datasets: [{
                        data: categorySums,
                        // Royal-and-gold brand ramp rather than a generic
                        // rainbow, so the chart reads as MMC at a glance.
                        backgroundColor: [
                            'rgba(29, 78, 216, 0.90)',   // Tithe - royal
                            'rgba(240, 180, 41, 0.90)',  // Offering - gold
                            'rgba(96, 165, 250, 0.90)',  // Pledge - light royal
                            'rgba(200, 137, 15, 0.90)'   // Project - deep gold
                        ],
                        borderColor: ctc.surface,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: { color: ctc.legend, font: { size: 11 } }
                        }
                    }
                }
            });
        }
    },

    // Panel: Staff (roster)
    attendanceScopeMembers() {
        const branchId = this.session.currentBranch;
        return this.db.members.filter((m) => (!branchId || branchId === 'global') ? true : m.branchId === branchId);
    },

    // Per-service meta (starting member + transport counts) persisted with the
    // roster so present/absent can be derived quickly.
    getAttendanceMeta(date) {
        this.db.attendanceMeta = this.db.attendanceMeta || {};
        if (!date) return { startingMemberId: null, startingMemberName: '', transport: { vehicles: 0, bicycles: 0, motorcycles: 0 } };
        if (!this.db.attendanceMeta[date]) this.db.attendanceMeta[date] = { startingMemberId: null, startingMemberName: '', transport: { vehicles: 0, bicycles: 0, motorcycles: 0 } };
        const meta = this.db.attendanceMeta[date];
        if (!meta.transport) meta.transport = { vehicles: 0, bicycles: 0, motorcycles: 0 };
        if (!meta.startingMemberId) meta.startingMemberId = null;
        return meta;
    },

    populateAttendanceControls(members, meta) {
        const startSelect = document.getElementById('attendance-start-member');
        if (startSelect) {
            startSelect.innerHTML = '<option value="">None - manual check-in</option>' + members.map(m =>
                `<option value="${esc(m.id)}"${m.id === meta.startingMemberId ? ' selected' : ''}>${esc(m.firstName)} ${esc(m.lastName)}</option>`
            ).join('');
        }
        const t = meta.transport || {};
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || 0; };
        set('att-transport-vehicles', t.vehicles);
        set('att-transport-bicycles', t.bicycles);
        set('att-transport-motorcycles', t.motorcycles);
    },

    // Mark every member from the top of the roster through the chosen starting
    // member as present (and everyone after as absent). Admins can still toggle
    // individual members afterwards.
    applyStartingMember() {
        const serviceDate = this.session.selectedServiceDate;
        if (!serviceDate) return;
        const memberId = document.getElementById('attendance-start-member') ? document.getElementById('attendance-start-member').value : '';
        const meta = this.getAttendanceMeta(serviceDate);
        const members = this.attendanceScopeMembers();
        if (!memberId) {
            meta.startingMemberId = null;
            meta.startingMemberName = '';
        } else {
            const startIdx = members.findIndex(m => m.id === memberId);
            if (startIdx < 0) return;
            members.forEach((m, i) => {
                const rec = this.db.attendance.find(a => a.memberId === m.id && a.date === serviceDate);
                if (rec) rec.present = i <= startIdx;
                else this.db.attendance.push({ id: `att_${m.id}_${serviceDate}`, memberId: m.id, branchId: m.branchId, date: serviceDate, present: i <= startIdx });
            });
            meta.startingMemberId = memberId;
            const mem = this.db.members.find(m => m.id === memberId);
            meta.startingMemberName = mem ? `${mem.firstName} ${mem.lastName}` : '';
        }
        this.saveDB();
        this.renderStaffPanel();
    },

    clearStartingMember() {
        const serviceDate = this.session.selectedServiceDate;
        if (!serviceDate) return;
        const meta = this.getAttendanceMeta(serviceDate);
        meta.startingMemberId = null;
        meta.startingMemberName = '';
        this.saveDB();
        this.renderStaffPanel();
    },

    saveTransportCounts() {
        const serviceDate = this.session.selectedServiceDate;
        if (!serviceDate) return;
        const meta = this.getAttendanceMeta(serviceDate);
        const read = (id) => Math.max(0, parseInt(document.getElementById(id) ? document.getElementById(id).value : '0', 10) || 0);
        meta.transport = {
            vehicles: read('att-transport-vehicles'),
            bicycles: read('att-transport-bicycles'),
            motorcycles: read('att-transport-motorcycles')
        };
       this.saveDB();
       this.saveTransportMeta();
       this.toast('Transport counts saved for ' + this.formatServiceLabel(serviceDate) + '.');
       this.renderStaffPanel();
   },

    // Dashboard-side transport recording: writes to the same attendanceMeta
    // store, so the dashboard chart updates instantly from here or Attendance.
    renderDashboardTransportControls() {
        const select = document.getElementById('dash-transport-service-select');
        if (!select) return;
        const serviceDates = [...new Set((this.db.attendance || []).map(a => a.date))].sort().reverse();
        if (!this.session.selectedServiceDate || !serviceDates.includes(this.session.selectedServiceDate)) {
            this.session.selectedServiceDate = serviceDates[0] || null;
        }
        select.innerHTML = serviceDates.map((d, i) =>
            `<option value="${esc(d)}"${d === this.session.selectedServiceDate ? ' selected' : ''}>${esc(this.formatServiceLabel(d))}${i === 0 ? ' (latest)' : ''}</option>`
        ).join('');
        select.onchange = (e) => { this.session.selectedServiceDate = e.target.value; this.renderDashboardTransportControls(); };

        const meta = this.getAttendanceMeta(this.session.selectedServiceDate);
        const t = meta.transport || {};
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || 0; };
        set('dash-transport-vehicles', t.vehicles);
        set('dash-transport-motorcycles', t.motorcycles);
        set('dash-transport-bicycles', t.bicycles);
    },

    saveDashboardTransportCounts() {
        const serviceDate = this.session.selectedServiceDate;
        if (!serviceDate) return;
        const meta = this.getAttendanceMeta(serviceDate);
        const read = (id) => Math.max(0, parseInt(document.getElementById(id) ? document.getElementById(id).value : '0', 10) || 0);
        meta.transport = {
            vehicles: read('dash-transport-vehicles'),
            bicycles: read('dash-transport-bicycles'),
            motorcycles: read('dash-transport-motorcycles')
        };
        this.saveDB();
        this.saveTransportMeta();
        this.toast('Transport counts saved for ' + this.formatServiceLabel(serviceDate) + '.');
        this.renderDashboardTransportControls();
        this.renderTransportChart('dash-transport-chart');
    },

   // Transport counts persist per browser (the server stores attendance only),
   // so the trend graphs keep data across reloads.
    saveTransportMeta() {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem('church2_attendance_meta', JSON.stringify(this.db.attendanceMeta || {}));
        } catch (e) {
            console.error('Could not persist transport meta:', e);
        }
    },

    loadAttendanceMeta() {
        if (typeof localStorage === 'undefined') return;
        try {
            const saved = localStorage.getItem('church2_attendance_meta');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    this.db.attendanceMeta = Object.assign({}, this.db.attendanceMeta || {}, parsed);
                }
            }
        } catch (e) {
            console.error('Could not load transport meta:', e);
        }
    },

    // Seed realistic transport counts for every service date when nothing has
    // been recorded yet, so the transport graphs are never blank.
    ensureTransportMeta() {
        if (!this.db.attendanceMeta) this.db.attendanceMeta = {};
        if (Object.keys(this.db.attendanceMeta).length > 0) return;
        const dates = [...new Set((this.db.attendance || []).map(a => a.date))].sort();
        dates.forEach((d, i) => {
            const wave = dates.length > 1 ? Math.sin((i / (dates.length - 1)) * Math.PI) : 0.5;
            this.db.attendanceMeta[d] = {
                startingMemberId: null,
                startingMemberName: '',
                transport: {
                    vehicles: Math.max(2, Math.round(9 + wave * 13)),
                    motorcycles: Math.max(1, Math.round(3 + wave * 8)),
                    bicycles: Math.max(0, Math.round(1 + wave * 5))
                }
            };
        });
    },

    renderTransportChart(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const wrap = canvas.parentElement;
        if (typeof Chart === 'undefined') {
            if (wrap && !wrap.querySelector('.chart-fallback')) {
                const n = document.createElement('div');
                n.className = 'chart-fallback';
                n.textContent = 'Transport chart is unavailable offline.';
                wrap.appendChild(n);
            }
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const key = canvasId === 'dash-transport-chart' ? 'dashTransport' : 'transport';
        if (this.charts[key]) this.charts[key].destroy();

        this.ensureTransportMeta();
        const meta = this.db.attendanceMeta || {};
        const dates = Object.keys(meta).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
        const labels = dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        const get = (d, k) => (meta[d].transport || {})[k] || 0;
        const cta = this.chartTheme();
        this.charts[key] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Cars', data: dates.map(d => get(d, 'vehicles')), backgroundColor: 'rgba(59, 130, 246, 0.6)', borderColor: '#3b82f6', borderWidth: 1.5, borderRadius: 5 },
                    { label: 'Motorbikes', data: dates.map(d => get(d, 'motorcycles')), backgroundColor: 'rgba(240, 180, 41, 0.6)', borderColor: '#f0b429', borderWidth: 1.5, borderRadius: 5 },
                    { label: 'Bicycles', data: dates.map(d => get(d, 'bicycles')), backgroundColor: 'rgba(16, 185, 129, 0.6)', borderColor: '#10b981', borderWidth: 1.5, borderRadius: 5 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { color: cta.legend, font: { size: 11 } } } },
                scales: {
                    y: { beginAtZero: true, ticks: { color: cta.tick, precision: 0 }, grid: { color: cta.grid } },
                    x: { ticks: { color: cta.tick }, grid: { display: false } }
                }
            }
        });
    },

    renderStaffMembers() {
        const tbody = document.getElementById('staff-tbody');
        if (!tbody) return;
        let members = this.attendanceScopeMembers();
        const searchInput = document.getElementById('staff-search');
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
        if (query) {
            members = members.filter((m) => `${m.firstName} ${m.lastName}`.toLowerCase().includes(query));
        }
        const rows = members.map(m => {
            const role = (m.rolePosition && String(m.rolePosition).trim()) ? String(m.rolePosition).trim() : 'Member';
            const skills = (Array.isArray(m.volunteer_skills) && m.volunteer_skills.length)
                ? m.volunteer_skills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join(' ')
                : '<span class="muted-italic" style="font-size:0.75rem;">&mdash;</span>';
            return `<tr>
                <td>
                    <div class="member-profile-cell">
                        <div class="member-avatar">${esc((m.firstName[0] || '') + (m.lastName[0] || ''))}</div>
                        <span class="member-name">${esc(m.firstName)} ${esc(m.lastName)}</span>
                    </div>
                </td>
                <td><span class="branch-pill badge-${esc(m.branchId)}">${esc(m.branchName)}</span></td>
                <td>${esc(role)}</td>
                <td>${m.phone ? `<a href="tel:${esc(m.phone)}" style="text-decoration:none;">${esc(m.phone)}</a>` : '<span class="muted-italic" style="font-size:0.75rem;">&mdash;</span>'}</td>
                <td><div style="display:flex; gap:4px; flex-wrap:wrap;">${skills}</div></td>
                <td>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.openStaffEditor('${esc(m.id)}')">Edit</button>
                        <button type="button" class="btn btn-danger btn-sm" onclick="ChurchApp.deleteStaffMember('${esc(m.id)}')">Delete</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
        tbody.innerHTML = rows || `<tr><td colspan="6" class="muted-italic" style="text-align:center; padding:24px;">${query ? 'No staff match that name.' : 'No members in this scope.'}</td></tr>`;
        if (searchInput) searchInput.oninput = () => this.renderStaffMembers();
    },

    // Staff tab: edit / replace a staff member's details from the Staffs roster.
    openStaffEditor(memberId) {
        // Called with no memberId it opens the "Add New Staff" form instead.
        const isNew = !memberId;
        const member = isNew ? null : this.db.members.find((m) => m.id === memberId);
        const modal = document.getElementById('staff-edit-modal');
        if (!modal) return;
        if (!isNew && !member) return;
        const skills = member ? (Array.isArray(member.volunteer_skills) ? member.volunteer_skills.join(', ') : '') : '';
        const selectedBranch = member ? member.branchId : (this.session.currentBranch || this.firstBranchId());
        const branchOptions = (this.db.branches || []).map((b) =>
            `<option value="${esc(b.id)}"${b.id === selectedBranch ? ' selected' : ''}>${esc(b.name)}</option>`
        ).join('');
        const title = isNew ? 'Add New Staff' : `Edit Staff: ${esc(member.firstName)} ${esc(member.lastName)}`;
        const val = (v) => (v ? esc(v) : '');
        modal.innerHTML = `
            <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="staff-modal-title">
                <div class="modal-header">
                    <h3 id="staff-modal-title">${title}</h3>
                    <button class="modal-close" aria-label="Close" onclick="ChurchApp.closeModal('staff-edit-modal')">&times;</button>
                </div>
                <div class="modal-body scroll-y">
                    <label class="form-label-sm" for="se-first">First Name</label>
                    <input type="text" id="se-first" class="form-control" value="${member ? val(member.firstName) : ''}">
                    <label class="form-label-sm" for="se-last">Last Name</label>
                    <input type="text" id="se-last" class="form-control" value="${member ? val(member.lastName) : ''}">
                    <label class="form-label-sm" for="se-email">Email</label>
                    <input type="email" id="se-email" class="form-control" value="${member ? val(member.email) : ''}">
                    <label class="form-label-sm" for="se-phone">Contact Number</label>
                    <input type="tel" id="se-phone" class="form-control" value="${member ? val(member.phone) : ''}">
                    <label class="form-label-sm" for="se-role">Role / Position</label>
                    <input type="text" id="se-role" class="form-control" value="${member ? val(member.rolePosition) : ''}" placeholder="e.g. Worship Leader">
                    <label class="form-label-sm" for="se-campus">Branch</label>
                    <select id="se-campus" class="form-control">${branchOptions}</select>
                    <label class="form-label-sm" for="se-skills">Volunteer Skills <span style="opacity:.6;">(comma separated)</span></label>
                    <input type="text" id="se-skills" class="form-control" value="${member ? val(skills) : ''}" placeholder="e.g. Ushering, First Aid">
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="ChurchApp.closeModal('staff-edit-modal')">Cancel</button>
                    <button type="button" class="btn btn-primary-gradient" id="se-save">${isNew ? 'Add Staff' : 'Save changes'}</button>
                </div>
            </div>`;
        this.openModal('staff-edit-modal');
        document.getElementById('se-save').onclick = () => this.saveStaffMember(memberId);
        const firstInput = document.getElementById('se-first');
        if (firstInput) firstInput.focus();
    },

    saveStaffMember(memberId) {
        const isNew = !memberId;
        const existing = isNew ? null : this.db.members.find((m) => m.id === memberId);
        if (!isNew && !existing) return;
        const read = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');
        const firstName = read('se-first');
        const lastName = read('se-last');
        if (!firstName || !lastName) { this.toast('First and last name are required.', 'error'); return; }
        const branchId = document.getElementById('se-campus') ? document.getElementById('se-campus').value : (existing ? existing.branchId : this.firstBranchId());
        const branch = (this.db.branches || []).find((b) => b.id === branchId);
        const skills = [...new Set(read('se-skills').split(',').map((s) => s.trim()).filter(Boolean))];
        const patch = {
            firstName,
            lastName,
            email: read('se-email'),
            phone: read('se-phone'),
            rolePosition: read('se-role') || null,
            volunteer_skills: skills,
        };

        if (isNew) {
            const branchLabel = branch ? branch.name : (branchId || 'Selected Branch');
            const newMember = {
                id: `m_${Date.now()}`,
                branchId: branchId,
                branchName: branchLabel,
                firstName,
                lastName,
                email: patch.email,
                phone: patch.phone,
                familyId: null,
                familyRole: null,
                familyMembers: [],
                spiritualMilestones: ['Registered: ' + new Date().toISOString().split('T')[0]],
                volunteer_skills: skills,
                engagement_score: 50,
                rolePosition: patch.rolePosition,
                maritalStatus: null,
                age: null,
                expectations: null,
                previousExperience: null
            };
            this.db.members.push(newMember);
            this.saveDB();
            this.apiWrite(
                () => Church2API.createMember({ ...patch, branchId }),
                (srv) => { if (srv && srv.id) { newMember.id = srv.id; this.saveDB(); } }
            );
            this.closeModal('staff-edit-modal');
            this.renderStaffMembers();
            this.renderAll();
            this.toast(`Staff member "${firstName} ${lastName}" added to ${branchLabel}.`);
            return;
        }

        const campusChanged = branch && branch.id !== existing.branchId;
        Object.assign(existing, patch);
        if (branch) { existing.branchId = branch.id; existing.branchName = branch.name; }
        this.saveDB();
        this.apiWrite(
            () => Church2API.updateMember(existing.id, patch),
            (srv) => { if (srv && srv.branchName) existing.branchName = srv.branchName; }
        );
        this.closeModal('staff-edit-modal');
        this.renderStaffMembers();
        this.renderAll();
        this.toast(campusChanged
            ? `Staff member "${existing.firstName} ${existing.lastName}" updated (branch change saved locally).`
            : `Staff member "${existing.firstName} ${existing.lastName}" updated.`);
    },

    // Staff tab: delete a staff member from the roster, their attendance
    // records and group memberships. Optimistic locally, mirrored to the API.
    deleteStaffMember(memberId) {
        const member = this.db.members.find((m) => m.id === memberId);
        if (!member) return;
        const name = `${member.firstName} ${member.lastName}`;
        if (!confirm(`Remove ${name} from Staffs? This also removes them from the member database and groups. This cannot be undone.`)) return;
        this.db.members = this.db.members.filter((m) => m.id !== memberId);
        this.db.attendance = (this.db.attendance || []).filter((a) => a.memberId !== memberId);
        (this.db.groups || []).forEach((g) => {
            if (Array.isArray(g.memberIds)) g.memberIds = g.memberIds.filter((id) => id !== memberId);
        });
        if (this.session.selectedMemberId === memberId) this.session.selectedMemberId = null;
        this.saveDB();
        this.apiWrite(() => Church2API.deleteMember(memberId));
        this.closeModal('staff-edit-modal');
        this.renderStaffMembers();
        this.renderAll();
        this.toast(`Staff member ${name} removed.`, 'info');
    },

    renderStaffPanel() {
        this.renderStaffMembers();
    },

    formatServiceLabel(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    },

    toggleAttendance(memberId) {
        const serviceDate = this.session.selectedServiceDate;
        if (!serviceDate) return;
        this.db.attendance = this.db.attendance || [];
        let rec = this.db.attendance.find(a => a.memberId === memberId && a.date === serviceDate);
        const member = this.db.members.find(m => m.id === memberId);
        if (rec) {
            rec.present = !rec.present;
        } else if (member) {
            this.db.attendance.push({ id: `att_${memberId}_${serviceDate}`, memberId, branchId: member.branchId, date: serviceDate, present: true });
        }
        this.saveDB();
        this.apiWrite(() => Church2API.setAttendance({ memberId, date: serviceDate, present: rec ? rec.present : true }));
        this.renderStaffPanel();
    },

    renderAttendanceChart(attendance, serviceDatesDesc) {
        const wrap = document.getElementById('attendance-trend-chart')?.parentElement;
        if (typeof Chart === 'undefined') {
            if (wrap && !wrap.querySelector('.chart-fallback')) {
                const n = document.createElement('div');
                n.className = 'chart-fallback';
                n.textContent = 'Attendance chart is unavailable offline.';
                wrap.appendChild(n);
            }
            return;
        }
        const ctx = document.getElementById('attendance-trend-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.attendance) this.charts.attendance.destroy();

        const dates = [...serviceDatesDesc].sort(); // ascending
        const counts = dates.map(d => attendance.filter(a => a.date === d && a.present).length);
        const labels = dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

        const cta = this.chartTheme();
        this.charts.attendance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Present',
                    data: counts,
                    backgroundColor: 'rgba(16, 185, 129, 0.55)',
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { color: cta.tick, precision: 0 }, grid: { color: cta.grid } },
                    x: { ticks: { color: cta.tick }, grid: { display: false } }
                }
            }
        });
    },

    renderAttendanceSummary(members, attendance) {
        const el = document.getElementById('attendance-summary');
        if (!el) return;
        // At-risk = 3+ consecutive most-recent absences
        const byMember = {};
        attendance.forEach(a => (byMember[a.memberId] = byMember[a.memberId] || []).push(a));
        const atRisk = members.filter(m => {
            const recs = (byMember[m.id] || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
            let streak = 0;
            for (const r of recs) { if (!r.present) streak++; else break; }
            return streak >= 3;
        });
        el.innerHTML = `
            <div class="attendance-summary-row">
                <span><svg class="inline-ico warn-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17.2v.1"/></svg> At-risk (3+ absences)</span>
                <strong>${atRisk.length}</strong>
            </div>
            ${atRisk.length ? `<ul class="at-risk-list" style="margin-top:8px;">
                ${atRisk.slice(0, 5).map(m => `<li>${esc(m.firstName)} ${esc(m.lastName)}</li>`).join('')}
            </ul>` : '<p class="muted-italic" style="margin-top:8px;">No members in an absence streak - healthy engagement.</p>'}`;
    },

    // Assimilated guests become permanent members after 1 month: the follow-up
    // card is removed automatically and the member stays in the directory.
    pruneAssimilatedFollowups() {
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const list = this.db.followUps || [];
        let changed = false;
        list.forEach((i) => {
            if (i.stage !== 'Member') return;
            if (!i.assimilatedAt) {
                // Backfill the clock from when they entered the pipeline.
                i.assimilatedAt = i.visitedDate
                    ? new Date(String(i.visitedDate).slice(0, 10) + 'T00:00:00').toISOString()
                    : new Date().toISOString();
                changed = true;
            }
        });
        const expired = list.filter((i) => i.stage === 'Member' && i.assimilatedAt && (now - new Date(i.assimilatedAt).getTime()) >= THIRTY_DAYS);
        if (!expired.length) {
            if (changed) this.saveDB();
            return;
        }
        const when = new Date().toISOString().split('T')[0];
        expired.forEach((i) => {
            const name = String(i.name || '').trim();
            const firstName = name.split(/s+/)[0] || '';
            const lastName = name.split(/s+/).slice(1).join(' ');
            const member = this.db.members.find(m =>
                m.branchId === i.branchId &&
                String(m.firstName || '').toLowerCase() === firstName.toLowerCase() &&
                String(m.lastName || '').toLowerCase() === lastName.toLowerCase()
            );
            if (member) {
                member.spiritualMilestones = member.spiritualMilestones || [];
                if (!member.spiritualMilestones.includes('Permanent member: ' + when)) {
                    member.spiritualMilestones.push('Permanent member: ' + when);
                }
            }
            this.apiWrite(() => Church2API.deleteFollowup(i.id));
        });
        this.db.followUps = list.filter((i) => !expired.includes(i));
        this.saveDB();
        this.renderMemberDirectory();
        this.toast(expired.length + ' assimilated guest' + (expired.length === 1 ? '' : 's') + ' became permanent member' + (expired.length === 1 ? '' : 's') + ' and left the follow-up pipeline.', 'info');
    },

    // Panel: Follow-Ups / Assimilation Pipeline (kanban)
    FOLLOWUP_STAGES: ['New Guest', 'Contacted', 'Connected', 'Member'],

    renderFollowUps() {
        this.pruneAssimilatedFollowups();
        const branchId = this.session.currentBranch;
        const inScope = (m) => (!branchId || branchId === 'global') ? true : m.branchId === branchId;
        const items = (this.db.followUps || []).filter(inScope);
        const board = document.getElementById('followup-board');
        if (!board) return;

        const stageMeta = {
            'New Guest': { icon: '', tone: 'guest' },
            'Contacted': { icon: '', tone: 'contacted' },
            'Connected': { icon: '', tone: 'connected' },
            'Member': { icon: '', tone: 'member' }
        };

        board.innerHTML = this.FOLLOWUP_STAGES.map((stage, sIdx) => {
            const inStage = items.filter(i => i.stage === stage);
            const cards = inStage.map(i => {
                const canBack = sIdx > 0;
                const canFwd = sIdx < this.FOLLOWUP_STAGES.length - 1;
                const permanentLabel = i.assimilatedAt ? new Date(new Date(i.assimilatedAt).getTime() + 30 * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                return `<div class="followup-card">
                    <div class="followup-card-top">
                        <strong>${esc(i.name)}</strong>
                        <span class="branch-pill badge-${esc(i.branchId)}">${esc((this.db.branches.find(b => b.id === i.branchId) || {}).name || '')}</span>
                    </div>
                    ${i.owner ? `<div class="followup-owner"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.4 2.9-5.4 6.5-5.4s6.5 2 6.5 5.4"/></svg> ${esc(i.owner)}</div>` : ''}
                    ${(i.maritalStatus || i.age) ? `<p class="followup-note">${i.maritalStatus ? esc(i.maritalStatus) : ''}${i.maritalStatus && i.age ? ' &middot; ' : ''}${i.age ? `Age ${esc(i.age)}` : ''}</p>` : ''}
                    ${i.expectations ? `<p class="followup-note"><strong style="color:var(--text-secondary);">Expectations:</strong> ${esc(i.expectations)}</p>` : ''}
                    ${i.previousActivity ? `<p class="followup-note"><strong style="color:var(--text-secondary);">Previous activity:</strong> ${esc(i.previousActivity)}</p>` : ''}
                    ${i.note ? `<p class="followup-note">${esc(i.note)}</p>` : ''}
                    ${i.contributed ? `<p class="followup-note"><strong style="color:var(--accent-gold);">Contributed:</strong> ${window.money(Number(i.contributed))}</p>` : ''}
                    ${i.contact ? `<p class="followup-note"><strong style="color:var(--text-secondary);">Contact:</strong> ${esc(i.contact)}</p>` : ''}
                    ${i.assimilatedAt ? `<p class="followup-note"><strong style="color:var(--text-secondary);">Permanent member:</strong> ${esc(permanentLabel)} <span class="muted-italic" style="opacity:.7;">(card leaves automatically)</span></p>` : ''}
                    <div class="followup-actions">
                        ${stage === 'New Guest' ? `
                            <button class="followup-move del" aria-label="Delete ${esc(i.name)}" title="Delete this one-time guest" onclick="ChurchApp.deleteFollowUp('${esc(i.id)}')">Delete</button>
                        ` : `
                            <button class="followup-move" ${canBack ? '' : 'disabled'} aria-label="Move ${esc(i.name)} back" onclick="ChurchApp.moveFollowUp('${esc(i.id)}', -1)"><-</button>
                        `}
                        <button class="followup-move fwd" ${canFwd ? '' : 'disabled'} aria-label="Advance ${esc(i.name)}" onclick="ChurchApp.moveFollowUp('${esc(i.id)}', 1)">${canFwd ? 'Advance ->' : 'Assimilated'}</button>
                    </div>
                </div>`;
            }).join('') || '<p class="followup-empty muted-italic">Empty</p>';

            return `<div class="followup-col tone-${stageMeta[stage].tone}">
                <div class="followup-col-head">
                    <span>${stageMeta[stage].icon} ${esc(stage)}</span>
                    <span class="followup-count">${inStage.length}</span>
                </div>
                <div class="followup-col-body">${cards}</div>
            </div>`;
        }).join('');

        const form = document.getElementById('add-followup-form');
        if (form) {
            form.onsubmit = (e) => {
                e.preventDefault();
                const name = document.getElementById('followup-name').value.trim();
                const owner = document.getElementById('followup-owner').value.trim();
                const maritalStatus = document.getElementById('followup-marital') ? document.getElementById('followup-marital').value.trim() : '';
                const ageRaw = document.getElementById('followup-age') ? document.getElementById('followup-age').value : '';
                const age = (ageRaw === '' || isNaN(parseInt(ageRaw, 10))) ? null : Math.min(130, Math.max(1, parseInt(ageRaw, 10)));
                const expectations = document.getElementById('followup-expectations') ? document.getElementById('followup-expectations').value.trim() : '';
                const previousActivity = document.getElementById('followup-previous') ? document.getElementById('followup-previous').value.trim() : '';
                const contributedRaw = document.getElementById('followup-contributed') ? document.getElementById('followup-contributed').value : '';
                const contributed = (contributedRaw === '' || isNaN(Number(contributedRaw))) ? null : Math.max(0, Number(contributedRaw));
                const contact = document.getElementById('followup-contact') ? document.getElementById('followup-contact').value.trim() : '';
                if (!name) return;
                const targetBranch = (branchId && branchId !== 'global') ? branchId : this.firstBranchId();
                const item = {
                    id: `fu_${Date.now()}`,
                    name, owner: owner || 'Unassigned',
                    branchId: targetBranch,
                    stage: 'New Guest',
                    note: '',
                    visitedDate: new Date().toISOString().split('T')[0],
                    maritalStatus: maritalStatus || null,
                    age,
                    expectations: expectations || null,
                    previousActivity: previousActivity || null,
                    contributed,
                    contact: contact || null
                };
                this.db.followUps.unshift(item);
                this.saveDB();
                this.apiWrite(
                    () => Church2API.createFollowup({
                        name,
                        owner: item.owner,
                        branchId: targetBranch,
                        maritalStatus: item.maritalStatus,
                        age: item.age,
                        expectations: item.expectations,
                        previousActivity: item.previousActivity,
                        contributed: item.contributed,
                        contact: item.contact
                    }),
                    (srv) => { if (srv && srv.id) item.id = srv.id; }
                );
                form.reset();
                this.renderFollowUps();
                this.toast(`${name} added to the assimilation pipeline${item.contributed ? ` with a contribution of ${window.money(item.contributed)}` : ''}${item.contact ? ` - contact ${esc(item.contact)}` : ''}.`);
            };
        }
        this.renderVisitorsLog();
    },

    moveFollowUp(id, dir) {
        const item = (this.db.followUps || []).find(i => i.id === id);
        if (!item) return;
        const idx = this.FOLLOWUP_STAGES.indexOf(item.stage);
        const next = idx + dir;
        if (next < 0 || next >= this.FOLLOWUP_STAGES.length) return;
        item.stage = this.FOLLOWUP_STAGES[next];
        // Stamped the day the guest is assimilated - the card auto-leaves the
        // pipeline once the member becomes permanent (after 1 month).
        if (item.stage === 'Member') {
            item.assimilatedAt = item.assimilatedAt || new Date().toISOString();
        }
        this.saveDB();
        let assimilatedMember = null;
        if (item.stage === 'Member') {
            assimilatedMember = this.assimilateFollowupMember(item);
        }
        this.apiWrite(
            () => Church2API.moveFollowup(item.id, item.stage),
            (srv) => {
                if (!srv || !srv.memberId || !assimilatedMember) return;
                if (assimilatedMember.id !== srv.memberId) {
                    assimilatedMember.id = srv.memberId;
                    this.saveDB();
                }
            }
        );
        this.renderFollowUps();
        if (item.stage === 'Member') {
            this.toast(`${item.name} is now a committed member and appears in the member directory.`);
        }
    },

    // A one-time visitor is removed from the pipeline entirely (the "<-" slot
    // in the New Guest column). Also used by the Visitors Log.
    deleteFollowUp(id) {
        const item = (this.db.followUps || []).find(i => i.id === id);
        const name = item ? item.name : id;
        if (!confirm(`Remove ${name} from the follow-up pipeline? Their visitor record will be deleted too.`)) return;
        this.db.followUps = (this.db.followUps || []).filter(i => i.id !== id);
        this.saveDB();
        this.apiWrite(() => Church2API.deleteFollowup(id));
        this.renderFollowUps();
        this.toast(`${name} removed from the pipeline.`, 'info');
    },

    // Visitors Log: every visitor with their details and the date they visited.
    renderVisitorsLog() {
        const tbody = document.getElementById('visitors-log-tbody');
        if (!tbody) return;
        const branchId = this.session.currentBranch;
        const inScope = (i) => (!branchId || branchId === 'global') ? true : i.branchId === branchId;
        const items = (this.db.followUps || []).filter(inScope);
        const rows = items.map(i => `
            <tr>
                <td><strong>${esc(i.name)}</strong></td>
                <td>${i.contact ? esc(i.contact) : '<span class="muted-italic">&mdash;</span>'}</td>
                <td>${i.visitedDate ? esc(i.visitedDate) : '<span class="muted-italic">&mdash;</span>'}</td>
                <td>${i.maritalStatus ? esc(i.maritalStatus) : '<span class="muted-italic">&mdash;</span>'}</td>
                <td>${i.age != null ? esc(i.age) : '<span class="muted-italic">&mdash;</span>'}</td>
                <td>${i.expectations ? esc(i.expectations) : '<span class="muted-italic">&mdash;</span>'}</td>
                <td>${i.previousActivity ? esc(i.previousActivity) : '<span class="muted-italic">&mdash;</span>'}</td>
                <td>${i.contributed ? window.money(Number(i.contributed)) : '<span class="muted-italic">&mdash;</span>'}</td>
                <td>${i.owner ? esc(i.owner) : '<span class="muted-italic">&mdash;</span>'}</td>
                <td><span class="branch-pill">${esc(i.stage)}</span></td>
                <td><button type="button" class="btn btn-danger btn-sm" onclick="ChurchApp.deleteFollowUp('${esc(i.id)}')">Delete</button></td>
            </tr>`).join('');
        tbody.innerHTML = rows || '<tr><td colspan="11" class="muted-italic" style="text-align:center; padding:20px;">No visitors recorded yet.</td></tr>';
    },

    // When a follow-up reaches the final Member stage, enroll the guest in the
    // member directory (once). Reuses an existing record with the same name and
    // campus so moving the card back and forward never creates a duplicate.
    assimilateFollowupMember(fu) {
        const name = String(fu.name || '').trim();
        if (!name) return null;
        const parts = name.split(/\s+/);
        const firstName = parts[0];
        const lastName = parts.slice(1).join(' ');
        const branchId = fu.branchId || ((this.session.currentBranch && this.session.currentBranch !== 'global') ? this.session.currentBranch : this.firstBranchId());
        const existing = (this.db.members || []).find(m =>
            m.branchId === branchId &&
            String(m.firstName || '').toLowerCase() === firstName.toLowerCase() &&
            String(m.lastName || '').toLowerCase() === lastName.toLowerCase()
        );
        if (existing) return existing;
        const branchObj = (this.db.branches || []).find(b => b.id === branchId);
        const member = {
            id: `m_${Date.now()}`,
            branchId,
            branchName: branchObj ? branchObj.name : (branchId || 'Selected Branch'),
            firstName,
            lastName,
            email: '',
            phone: '',
            familyId: null,
            familyRole: null,
            maritalStatus: fu.maritalStatus || null,
            age: (fu.age != null && !isNaN(Number(fu.age))) ? Math.min(130, Math.max(1, Math.round(Number(fu.age)))) : null,
            expectations: fu.expectations || null,
            previousExperience: fu.previousActivity || null,
            spiritualMilestones: [`Member: ${new Date().toISOString().split('T')[0]}`],
            volunteer_skills: [],
            engagement_score: 60
        };
        this.db.members.push(member);
        this.saveDB();
        this.renderMemberDirectory();
        return member;
    },

    // Panel: Small Groups (admin)
    renderGroups() {
        const branchId = this.session.currentBranch;
        const inScope = (g) => (!branchId || branchId === 'global') ? true : g.branchId === branchId;
        const groups = (this.db.groups || []).filter(inScope);
        const grid = document.getElementById('groups-grid');
        if (grid) {
            grid.innerHTML = groups.map(g => {
                const campus = (this.db.branches.find(b => b.id === g.branchId) || {}).name || '';
                const count = (g.memberIds || []).length;
                const rosterMembers = (g.memberIds || []).map(id => this.db.members.find(mm => mm.id === id)).filter(Boolean);
                const rosterPills = rosterMembers.length
                    ? rosterMembers.map(m => `<span class="group-member-pill">${esc(m.firstName)} ${esc(m.lastName)}<button type="button" class="pill-remove" title="Remove ${esc(m.firstName)} ${esc(m.lastName)}" onclick="ChurchApp.removeGroupMember('${esc(g.id)}','${esc(m.id)}')">&times;</button></span>`).join('')
                    : '<span class="muted-italic">No members yet</span>';
                return `<div class="group-card">
                    <div class="group-card-head">
                        <h4>${esc(g.name)}</h4>
                        <div class="group-card-tools">
                            <span class="group-count"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.2" cy="9" r="3"/><circle cx="16.6" cy="10" r="2.3"/><path d="M2.6 19c0-3 2.4-4.9 5.6-4.9 1.6 0 3 .5 4 1.3"/><path d="M14.6 14.7c2.6.2 4.8 1.9 4.8 4.6"/></svg> ${count}</span>
                            ${(g.pendingMemberIds || []).length ? `<span class="status-pill status-pending" title="Join requests awaiting your approval">${(g.pendingMemberIds || []).length} request${(g.pendingMemberIds || []).length === 1 ? '' : 's'}</span>` : ''}
                            <button type="button" class="group-icon-btn" title="Edit group" onclick="ChurchApp.openGroupEditor('${esc(g.id)}')">&#9998;</button>
                            <button type="button" class="group-icon-btn group-icon-danger" title="Delete group" onclick="ChurchApp.deleteGroupById('${esc(g.id)}')">&#128465;</button>
                        </div>
                    </div>
                    <div class="group-meta">
                        <span class="branch-pill badge-${esc(g.branchId)}">${esc(campus)}</span>
                        <span class="group-schedule"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.4"/><path d="M3.5 9.5h17M8 3.4v3.2M16 3.4v3.2"/></svg> ${esc(g.schedule || 'TBD')}</span>
                    </div>
                    ${g.description ? `<p class="group-desc">${esc(g.description)}</p>` : ''}
                    <div class="group-roster">${rosterPills}<button type="button" class="group-add-btn" onclick="ChurchApp.openGroupEditor('${esc(g.id)}')">+ Add member</button></div>
                    <div class="group-actions">
                        <button type="button" class="group-edit-btn" onclick="ChurchApp.openGroupEditor('${esc(g.id)}')">&#9998; Edit group</button>
                        <button type="button" class="group-edit-btn" onclick="ChurchApp.toggleGroupAnnounceForm('${esc(g.id)}')">&#128227; Announce</button>
                        <button type="button" class="group-delete-btn" onclick="ChurchApp.deleteGroupById('${esc(g.id)}')">Delete</button>
                    </div>
                    <div id="group-announce-form-${esc(g.id)}" class="group-announce-wrap"></div>
                </div>`;
            }).join('') || '<p class="muted-italic" style="margin-top:12px;">No groups at this branch yet.</p>';
        }

        // "From the App" - the member app's Home tab feeds these in: members who
        // RSVP'd "Going" to an event, and small-group join requests awaiting the
        // admin's approval (the app no longer self-joins instantly).
        const rsvpBox = document.getElementById('groups-event-rsvps');
        if (rsvpBox) {
            const scopedEvents = (this.db.events || []).filter(inScope);
            rsvpBox.innerHTML = scopedEvents.length
                ? scopedEvents.map(e => {
                    const goers = (e.rsvpMemberIds || []).map(id => this.db.members.find(mm => mm.id === id)).filter(Boolean);
                    return `<div class="group-app-item">
                        <div>
                            <strong>${esc(e.title)}</strong>
                            <span style="font-size:0.72rem; color:var(--text-secondary); display:block;">${esc(e.date || '')}${e.time ? ` at ${esc(e.time)}` : ''} - ${goers.length} going</span>
                        </div>
                        <div class="group-roster" style="flex-wrap:wrap;">${goers.length
                            ? goers.map(m => `<span class="group-member-pill">${esc(m.firstName)} ${esc(m.lastName)}</span>`).join('')
                            : '<span class="muted-italic" style="font-size:0.75rem;">No RSVPs yet - members tap "Going" in the app Home tab.</span>'}</div>
                    </div>`;
                }).join('')
                : '<p class="muted-italic" style="font-size:0.8rem;">No events at this branch yet.</p>';
        }
        const requestBox = document.getElementById('groups-join-requests');
        if (requestBox) {
            const scopedGroups = (this.db.groups || []).filter(inScope);
            const requests = scopedGroups.flatMap(g => (g.pendingMemberIds || []).map(memberId => {
                const m = this.db.members.find(mm => mm.id === memberId);
                return m ? { group: g, member: m } : null;
            }).filter(Boolean));
            requestBox.innerHTML = requests.length
                ? requests.map(({ group, member }) => `<div class="group-app-item">
                        <div>
                            <strong>${esc(member.firstName)} ${esc(member.lastName)}</strong>
                            <span style="font-size:0.72rem; color:var(--text-secondary); display:block;">wants to join <strong>${esc(group.name)}</strong></span>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button type="button" class="btn btn-primary-gradient btn-sm" onclick="ChurchApp.approveGroupJoinRequest('${esc(group.id)}','${esc(member.id)}')">Approve</button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.declineGroupJoinRequest('${esc(group.id)}','${esc(member.id)}')">Decline</button>
                        </div>
                    </div>`).join('')
                : '<p class="muted-italic" style="font-size:0.8rem;">No pending join requests - members request to join from the app Groups tab.</p>';
        }

        const form = document.getElementById('add-group-form');
        if (form) {
            // Member picker - add as many members as you want. Candidates are
            // scoped to the campus selected in the form.
            const selected = new Set();
            const search = document.getElementById('group-member-search');
            const optionsBox = document.getElementById('group-member-options');
            const pillsBox = document.getElementById('group-member-pills');
            const branchSel = document.getElementById('group-branch');

            const candidateMembers = () => {
                const scope = branchSel ? branchSel.value : this.session.currentBranch;
                const scoped = (this.db.members || []).filter(m => m.branchId === scope);
                // If the selected campus has no members yet, fall back to the full
                // roll so the picker is never empty. The server keeps only members
                // who belong to the group's campus, so cross-campus picks are dropped.
                return scoped.length ? scoped : (this.db.members || []);
            };
            const renderOptions = (filter) => {
                if (!optionsBox) return;
                const q = (filter || '').toLowerCase();
                const avail = candidateMembers().filter(m =>
                    !selected.has(m.id) &&
                    (!q || `${m.firstName} ${m.lastName} ${m.email || ''}`.toLowerCase().includes(q))
                ).slice(0, 60);
                optionsBox.innerHTML = avail.length
                    ? avail.map(m => `<button type="button" class="member-option" data-id="${esc(m.id)}">${esc(m.firstName)} ${esc(m.lastName)} <span style="opacity:.55;">- ${esc(m.branchName || '')}</span></button>`).join('')
                    : '<span class="muted-italic" style="padding:6px; display:block;">No members to add.</span>';
                optionsBox.querySelectorAll('.member-option').forEach(btn => {
                    btn.onclick = () => {
                        const m = this.db.members.find(x => x.id === btn.dataset.id);
                        if (!m || selected.has(m.id)) return;
                        selected.add(m.id);
                        renderPills();
                        renderOptions(search ? search.value : '');
                    };
                });
            };
            const renderPills = () => {
                if (!pillsBox) return;
                const members = (this.db.members || []).filter(m => selected.has(m.id));
                pillsBox.innerHTML = members.map(m =>
                    `<span class="group-member-pill">${esc(m.firstName)} ${esc(m.lastName)} <button type="button" class="pill-remove" data-id="${esc(m.id)}" aria-label="Remove">&times;</button></span>`
                ).join('');
                pillsBox.querySelectorAll('.pill-remove').forEach(btn => {
                    btn.onclick = () => {
                        selected.delete(btn.dataset.id);
                        renderPills();
                        renderOptions(search ? search.value : '');
                    };
                });
            };
            if (search) {
                search.addEventListener('input', () => renderOptions(search.value));
                search.addEventListener('focus', () => renderOptions(search.value));
            }
            if (branchSel) {
                branchSel.addEventListener('change', () => {
                    const scope = branchSel.value;
                    [...selected].forEach(id => {
                        const m = this.db.members.find(x => x.id === id);
                        if (m && m.branchId !== scope) selected.delete(id);
                    });
                    renderPills();
                    renderOptions(search ? search.value : '');
                });
            }
            renderPills();
            renderOptions('');

            form.onsubmit = (e) => {
                e.preventDefault();
                const name = document.getElementById('group-name').value.trim();
                if (!name) return;
                const isHq = this.session.currentUser && this.session.currentUser.role === 'hq_admin';
                const group = {
                    id: `g_${Date.now()}`,
                    name,
                    // The server hard-locks non-HQ users to their own campus.
                    branchId: isHq ? document.getElementById('group-branch').value : this.session.currentBranch,
                    schedule: document.getElementById('group-schedule').value.trim(),
                    description: document.getElementById('group-desc').value.trim(),
                    memberIds: [...selected]
                };
                this.db.groups.unshift(group);
                this.saveDB();
                this.apiWrite(
                    () => Church2API.createGroup({ name, branchId: group.branchId, schedule: group.schedule, description: group.description, memberIds: [...selected] }),
                    (srv) => { if (srv && srv.id) { group.id = srv.id; group.branchId = srv.branchId || group.branchId; group.memberIds = srv.memberIds || group.memberIds; } }
                );
                form.reset();
                selected.clear();
                renderPills();
                renderOptions('');
                this.renderGroups();
                this.toast(`Group "${name}" created with ${group.memberIds.length} member${group.memberIds.length === 1 ? '' : 's'}.`);
            };
        }
        this.renderGroupAnnouncements();
    },

    // Edit a group: rename, reschedule, and add/remove members (as many as you
    // want). Changes are optimistic and mirrored to the API.
    openGroupEditor(groupId) {
        const group = (this.db.groups || []).find(g => g.id === groupId);
        const modal = document.getElementById('group-edit-modal');
        if (!group || !modal) return;
        const campus = (this.db.branches.find(b => b.id === group.branchId) || {}).name || group.branchId || '';

        modal.innerHTML = `
            <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="group-modal-title">
                <div class="modal-header">
                    <h3 id="group-modal-title">Edit Group: ${esc(group.name)}</h3>
                    <button class="modal-close" aria-label="Close" onclick="ChurchApp.closeModal('group-edit-modal')">&times;</button>
                </div>
                <div class="modal-body scroll-y">
                    <label class="auth-label" for="ge-name">Group Name</label>
                    <input type="text" id="ge-name" class="form-control" value="${esc(group.name)}">
                    <label class="auth-label" for="ge-schedule">Meeting Schedule</label>
                    <input type="text" id="ge-schedule" class="form-control" value="${esc(group.schedule || '')}" placeholder="e.g. Tue 7:00 PM">
                    <label class="auth-label" for="ge-desc">Description</label>
                    <input type="text" id="ge-desc" class="form-control" value="${esc(group.description || '')}" placeholder="Short description">
                    <label class="auth-label">Members <span style="opacity:.6;">(add / remove)</span> <span class="muted-italic">- ${esc(campus)}</span></label>
                    <input type="text" id="ge-member-search" class="form-control" placeholder="Search members to add..." autocomplete="off">
                    <div id="ge-member-options" class="member-options"></div>
                    <div id="ge-member-pills" class="group-member-pills"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="group-delete-btn" id="ge-delete">Delete group</button>
                    <span style="flex:1;"></span>
                    <button type="button" class="btn btn-secondary" onclick="ChurchApp.closeModal('group-edit-modal')">Cancel</button>
                    <button type="button" class="btn btn-primary-gradient" id="ge-save">Save changes</button>
                </div>
            </div>`;
        this.openModal('group-edit-modal');

        const selected = new Set(group.memberIds || []);
        const search = document.getElementById('ge-member-search');
        const optionsBox = document.getElementById('ge-member-options');
        const pillsBox = document.getElementById('ge-member-pills');

        const renderOptions = (filter) => {
            if (!optionsBox) return;
            const q = (filter || '').toLowerCase();
            const scoped = (this.db.members || []).filter(m => m.branchId === group.branchId);
            const pool = scoped.length ? scoped : (this.db.members || []);
            const avail = pool.filter(m =>
                !selected.has(m.id) &&
                (!q || `${m.firstName} ${m.lastName} ${m.email || ''}`.toLowerCase().includes(q))
            ).slice(0, 60);
            optionsBox.innerHTML = avail.length
                ? avail.map(m => `<button type="button" class="member-option" data-id="${esc(m.id)}">${esc(m.firstName)} ${esc(m.lastName)} <span style="opacity:.55;">- ${esc(m.branchName || '')}</span></button>`).join('')
                : '<span class="muted-italic" style="padding:6px; display:block;">No members to add.</span>';
            optionsBox.querySelectorAll('.member-option').forEach(btn => {
                btn.onclick = () => {
                    const m = this.db.members.find(x => x.id === btn.dataset.id);
                    if (!m || selected.has(m.id)) return;
                    selected.add(m.id);
                    renderPills();
                    renderOptions(search ? search.value : '');
                };
            });
        };
        const renderPills = () => {
            if (!pillsBox) return;
            const members = (this.db.members || []).filter(m => selected.has(m.id));
            pillsBox.innerHTML = members.map(m =>
                `<span class="group-member-pill">${esc(m.firstName)} ${esc(m.lastName)} <button type="button" class="pill-remove" data-id="${esc(m.id)}" aria-label="Remove">&times;</button></span>`
            ).join('') || '<span class="muted-italic">No members yet.</span>';
            pillsBox.querySelectorAll('.pill-remove').forEach(btn => {
                btn.onclick = () => {
                    selected.delete(btn.dataset.id);
                    renderPills();
                    renderOptions(search ? search.value : '');
                };
            });
        };
        if (search) {
            search.addEventListener('input', () => renderOptions(search.value));
            search.addEventListener('focus', () => renderOptions(search.value));
        }
        renderPills();
        renderOptions('');
        if (document.getElementById('ge-name')) document.getElementById('ge-name').focus();

        document.getElementById('ge-save').onclick = () => {
            const name = document.getElementById('ge-name').value.trim();
            if (!name) { this.toast('Group name is required.', 'error'); return; }
            group.name = name;
            group.schedule = document.getElementById('ge-schedule').value.trim();
            group.description = document.getElementById('ge-desc').value.trim();
            group.memberIds = [...selected];
            this.saveDB();
            this.apiWrite(
                () => Church2API.updateGroup(group.id, { name: group.name, schedule: group.schedule, description: group.description, memberIds: group.memberIds }),
                (srv) => { if (srv && srv.id) { group.id = srv.id; group.branchId = srv.branchId || group.branchId; group.memberIds = srv.memberIds || group.memberIds; } }
            );
            this.closeModal('group-edit-modal');
            this.renderGroups();
            this.toast(`Group "${group.name}" updated (${group.memberIds.length} members).`);
        };

        document.getElementById('ge-delete').onclick = () => this.deleteGroupById(group.id);
    },

    // Remove a single member straight from the directory card. Optimistic and
    // mirrored to the API (PUT replaces the roster with the remaining ids).
    removeGroupMember(groupId, memberId) {
        const group = (this.db.groups || []).find(g => g.id === groupId);
        if (!group) return;
        const member = this.db.members.find(x => x.id === memberId);
        group.memberIds = (group.memberIds || []).filter(id => id !== memberId);
        this.saveDB();
        this.apiWrite(() => Church2API.updateGroup(group.id, { name: group.name, schedule: group.schedule, description: group.description, memberIds: group.memberIds }));
        this.renderGroups();
        this.toast(`Removed ${member ? `${member.firstName} ${member.lastName}` : 'member'} from "${group.name}".`, 'info');
    },

    // Confirm + delete a group. Shared by the directory card and the editor
    // modal (closeModal is a no-op when no modal is open).
    deleteGroupById(id) {
        const group = (this.db.groups || []).find(g => g.id === id);
        const name = group ? group.name : id;
        if (!confirm(`Delete the group "${name}"? This cannot be undone.`)) return;
        this.db.groups = (this.db.groups || []).filter(g => g.id !== id);
        this.saveDB();
        this.apiWrite(() => Church2API.deleteGroup(id));
        this.closeModal('group-edit-modal');
        this.renderGroups();
        this.toast(`Group "${name}" deleted.`, 'info');
    },

    // Mobile: browse small groups and request to join. Joining is no longer
    // instant - the request lands in the web Groups tab for the admin to approve.
    // ---- Group announcements -------------------------------------------------
    // Admin: open/close the inline "Post an announcement" form on a group card.
    toggleGroupAnnounceForm(groupId) {
        const form = document.getElementById('group-announce-form-' + groupId);
        if (!form) return;
        if (form.style.display !== 'none' && form.innerHTML) { form.style.display = 'none'; return; }
        form.innerHTML = `
            <div class="group-announce-card">
                <div class="group-announce-head">
                    <strong>Post an announcement</strong>
                    <button type="button" class="modal-close" aria-label="Close form" onclick="ChurchApp.toggleGroupAnnounceForm('${esc(groupId)}')">x</button>
                </div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <input type="text" id="group-ann-title-${esc(groupId)}" class="form-control" placeholder="Title - e.g. Prayer meeting tonight" style="font-size:0.8rem;">
                    <textarea id="group-ann-body-${esc(groupId)}" class="form-control" rows="3" placeholder="Message for the group..." style="font-size:0.8rem; resize:vertical;"></textarea>
                    <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap; font-size:0.75rem; color:var(--text-secondary);">
                        <label style="display:flex; gap:5px; align-items:center;"><input type="checkbox" class="group-ann-channel" data-group="${esc(groupId)}" value="email" checked> Email</label>
                        <label style="display:flex; gap:5px; align-items:center;"><input type="checkbox" class="group-ann-channel" data-group="${esc(groupId)}" value="whatsapp" checked> WhatsApp</label>
                    </div>
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.toggleGroupAnnounceForm('${esc(groupId)}')">Cancel</button>
                        <button type="button" class="btn btn-primary-gradient btn-sm" onclick="ChurchApp.submitGroupAnnounce('${esc(groupId)}')">Send to group</button>
                    </div>
                </div>
            </div>`;
        form.style.display = 'block';
    },

    // Admin: post the announcement. It is saved locally, pushed to the server
    // (which emails/WhatsApps every member), and shows in the member app.
    submitGroupAnnounce(groupId) {
        const group = (this.db.groups || []).find(g => g.id === groupId);
        if (!group) return;
        const titleEl = document.getElementById('group-ann-title-' + groupId);
        const bodyEl = document.getElementById('group-ann-body-' + groupId);
        if (!titleEl || !bodyEl) return;
        const title = titleEl.value.trim();
        const body = bodyEl.value.trim();
        const channels = [...document.querySelectorAll('.group-ann-channel[data-group="' + groupId + '"]:checked')].map(c => c.value);
        if (!title) { this.toast('Enter an announcement title.', 'error'); return; }
        if (!body) { this.toast('Enter the announcement message.', 'error'); return; }
        if (channels.length === 0) { this.toast('Pick at least one channel - email or WhatsApp.', 'error'); return; }

        const members = (group.memberIds || []).map(id => this.db.members.find(m => m.id === id)).filter(Boolean);
        this.db.announcements = this.db.announcements || [];
        const announcement = {
            id: 'an_' + Date.now(),
            title, body,
            groupId,
            audience: groupId,
            channels,
            recipients: members.length,
            sentAt: new Date().toISOString(),
            status: 'published'
        };
        this.db.announcements.unshift(announcement);
        this.saveDB();
        this.apiWrite(
            () => Church2API.announceToGroup(groupId, { title, body, channels }),
            (srv) => {
                if (srv && srv.announcement) {
                    announcement.id = srv.announcement.id;
                    announcement.recipients = srv.announcement.recipients;
                    if (srv.delivered) announcement.delivered = srv.delivered;
                }
            }
        );
        this.toggleGroupAnnounceForm(groupId);
        this.renderGroups();
        this.renderMobileGroups();
        this.toast(`Announcement sent to ${members.length} member${members.length === 1 ? '' : 's'} via ${channels.join(' & ')}.`);
    },

    // Web Groups tab: history of announcements posted to small groups.
    renderGroupAnnouncements() {
        const log = document.getElementById('groups-announcements-log');
        if (!log) return;
        const branchId = this.session.currentBranch;
        const items = (this.db.announcements || []).filter(a => a.groupId && (a.status || 'published') !== 'pending');
        const inScope = (a) => {
            const g = (this.db.groups || []).find(x => x.id === a.groupId);
            if (!g) return false;
            return (!branchId || branchId === 'global') ? true : g.branchId === branchId;
        };
        log.innerHTML = items.filter(inScope).length
            ? items.filter(inScope).map(a => {
                const g = (this.db.groups || []).find(x => x.id === a.groupId);
                const when = (a.sentAt || a.createdAt) ? new Date(a.sentAt || a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                return `<div class="broadcast-item">
                    <div class="broadcast-item-head">
                        <strong>${esc(a.title)}</strong>
                        <span class="broadcast-when">${esc(when)}</span>
                    </div>
                    <p class="broadcast-body">${esc(a.body)}</p>
                    <div class="broadcast-tags">
                        <span class="broadcast-audience-pill">${esc(g ? g.name : a.groupId)}</span>
                        <span class="broadcast-channel-pill">${esc((a.channels || []).join(', '))}</span>
                        <span class="broadcast-reach">Reached ${esc(a.recipients || 0)} members</span>
                    </div>
                </div>`;
            }).join('')
            : '<p class="muted-italic" style="font-size:0.8rem;">No group announcements yet - use "Announce" on a group card to notify its members.</p>';
    },
    renderMobileGroups() {
        const container = document.getElementById('mobile-groups-list');
        if (!container) return;
        const me = this.db.members.find(m => m.id === this.simulatedMemberId());
        const myBranch = me ? me.branchId : this.firstBranchId();
        const groups = (this.db.groups || []).filter(g => g.branchId === myBranch);
        const memberId = this.simulatedMemberId();

        container.innerHTML = groups.map(g => {
            const joined = (g.memberIds || []).includes(memberId);
            const requested = (g.pendingMemberIds || []).includes(memberId);
            const label = joined ? 'Joined' : (requested ? 'Requested' : 'Join');
            const action = joined
                ? `ChurchApp.leaveGroup('${esc(g.id)}')`
                : (requested ? `ChurchApp.cancelGroupJoin('${esc(g.id)}')` : `ChurchApp.requestGroupJoin('${esc(g.id)}')`);
            return `<div class="mobile-group-card">
                <div class="mobile-group-info">
                    <strong>${esc(g.name)}</strong>
                    <span>${esc(g.schedule || 'TBD')} - ${(g.memberIds || []).length} members${requested ? ' - request pending admin approval' : ''}</span>
                </div>
                <button class="mobile-group-btn${joined ? ' joined' : (requested ? ' pending' : '')}" onclick="${action}">${label}</button>
            </div>`;
        }).join('') || '<p class="muted-italic" style="font-size:0.72rem;">No groups at your branch yet.</p>';

        // Group announcements: only for groups this member has joined.
        const annBox = document.getElementById('mobile-group-announcements');
        if (annBox) {
            const joinedIds = groups.filter(g => (g.memberIds || []).includes(memberId)).map(g => g.id);
            const anns = (this.db.announcements || []).filter(a => a.groupId && joinedIds.includes(a.groupId));
            annBox.innerHTML = `
                <div class="mobile-section-head" style="margin-top:8px;">
                    <h4>Group Announcements</h4>
                </div>
                ${anns.length
                    ? `<div class="mobile-ann-list">${anns.map(a => {
                        const g = (this.db.groups || []).find(x => x.id === a.groupId);
                        const when = (a.sentAt || a.createdAt) ? new Date(a.sentAt || a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                        return `<div class="mobile-ann-item">
                            <div class="mobile-ann-head"><strong>${esc(a.title)}</strong><span class="mobile-ann-when">${esc(when)}</span></div>
                            <span class="mobile-ann-group">${esc(g ? g.name : '')}</span>
                            <p class="mobile-ann-body">${esc(a.body)}</p>
                            <div class="mobile-ann-tags">${(a.channels || []).map(ch => `<span class="broadcast-channel-pill">${esc(ch)}</span>`).join('')}</div>
                        </div>`;
                    }).join('')}</div>`
                    : '<p class="muted-italic" style="font-size:0.72rem; margin:4px 0;">Announcements posted to your groups will appear here.</p>'}
            `;
        }
    },

    // Send a join request - the admin approves it in the web Groups tab.
    requestGroupJoin(groupId) {
        const group = (this.db.groups || []).find(g => g.id === groupId);
        if (!group) return;
        const memberId = this.simulatedMemberId();
        group.pendingMemberIds = group.pendingMemberIds || [];
        if ((group.memberIds || []).includes(memberId) || group.pendingMemberIds.includes(memberId)) return;
        group.pendingMemberIds.push(memberId);
        this.saveDB();
        this.apiWrite(() => Church2API.requestGroupJoin(group.id, memberId));
        this.toast(`Join request sent for ${group.name} - the admin will approve it.`);
        this.renderMobileGroups();
    },

    // Withdraw a join request that has not been approved yet.
    cancelGroupJoin(groupId) {
        const group = (this.db.groups || []).find(g => g.id === groupId);
        if (!group) return;
        const memberId = this.simulatedMemberId();
        group.pendingMemberIds = (group.pendingMemberIds || []).filter(x => x !== memberId);
        this.saveDB();
        this.apiWrite(() => Church2API.requestGroupJoin(group.id, memberId, true));
        this.toast(`Join request for ${group.name} withdrawn.`, 'info');
        this.renderMobileGroups();
    },

    // Leave a group the member already belongs to (instant, no approval needed).
    leaveGroup(groupId) {
        const group = (this.db.groups || []).find(g => g.id === groupId);
        if (!group) return;
        const memberId = this.simulatedMemberId();
        group.memberIds = (group.memberIds || []).filter(x => x !== memberId);
        this.saveDB();
        this.apiWrite(() => Church2API.toggleGroupMember(group.id, memberId));
        this.toast(`Left ${group.name}.`, 'info');
        this.renderMobileGroups();
    },

    // Web Groups tab (admin): approve a pending join request from the app.
    approveGroupJoinRequest(groupId, memberId) {
        const group = (this.db.groups || []).find(g => g.id === groupId);
        const member = this.db.members.find(m => m.id === memberId);
        if (!group) return;
        group.pendingMemberIds = (group.pendingMemberIds || []).filter(x => x !== memberId);
        group.memberIds = group.memberIds || [];
        if (!group.memberIds.includes(memberId)) group.memberIds.push(memberId);
        this.saveDB();
        this.apiWrite(() => Church2API.approveGroupRequest(groupId, memberId));
        this.toast(`${member ? `${member.firstName} ${member.lastName}` : 'Member'} added to ${group.name}.`);
        this.renderGroups();
        this.renderMobileGroups();
    },

    // Web Groups tab (admin): decline a pending join request from the app.
    declineGroupJoinRequest(groupId, memberId) {
        const group = (this.db.groups || []).find(g => g.id === groupId);
        const member = this.db.members.find(m => m.id === memberId);
        if (!group) return;
        group.pendingMemberIds = (group.pendingMemberIds || []).filter(x => x !== memberId);
        this.saveDB();
        this.apiWrite(() => Church2API.declineGroupRequest(groupId, memberId));
        this.toast(`${member ? `${member.firstName} ${member.lastName}` : 'Request'} declined.`, 'info');
        this.renderGroups();
        this.renderMobileGroups();
    },

    // 8. Panel: Member Directory View Rendering
    renderMemberDirectory() {
        const query = document.getElementById('member-search-input').value.toLowerCase();
        const branchFilter = document.getElementById('member-branch-filter').value;
        const tbody = document.getElementById('member-directory-tbody');
        tbody.innerHTML = '';

        // Respect the active campus scope: a campus-locked admin can only ever see
        // their own members, regardless of the in-panel filter.
        const scope = this.session.currentBranch;
        const scoped = (scope && scope !== 'global') ? scope : null;

        const filteredMembers = this.db.members.filter(member => {
            if (scoped && member.branchId !== scoped) return false;
            const fullName = `${member.firstName} ${member.lastName}`.toLowerCase();
            const matchesQuery = fullName.includes(query) || (member.email || '').toLowerCase().includes(query) || (member.phone || '').includes(query);
            const matchesBranch = (branchFilter === 'all') || (member.branchId === branchFilter);
            return matchesQuery && matchesBranch;
        });

        filteredMembers.forEach(m => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="member-profile-cell">
                        <div class="member-avatar">${esc((m.firstName[0] || '') + (m.lastName[0] || ''))}</div>
                        <div>
                            <span class="member-name">${esc(m.firstName)} ${esc(m.lastName)}</span>
                            <span class="member-id">ID: ${esc(m.id)}</span>
                            ${m.rolePosition || m.maritalStatus || m.age != null ? `<span class="member-phone">${esc([m.rolePosition ? `Role: ${m.rolePosition}` : null, m.maritalStatus, m.age != null ? `${m.age} yrs` : null].filter(Boolean).join(' · '))}</span>` : ''}
                        </div>
                    </div>
                </td>
                <td><span class="branch-pill badge-${esc(m.branchId)}">${esc(m.branchName)}</span></td>
                <td>
                    <div class="member-email">${esc(m.email)}</div>
                    <div class="member-phone">${esc(m.phone)}</div>
                </td>
                <td>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(m.volunteer_skills || []).map(s => `<span class="skill-tag">${esc(s)}</span>`).join('') || '<span class="muted-italic">-</span>'}
                    </div>
                </td>
                <td>
                    <div class="score-indicator-bar">
                        <div class="score-progress" style="width: ${m.engagement_score}%; background: ${m.engagement_score > 75 ? '#10b981' : (m.engagement_score > 50 ? '#f59e0b' : '#ef4444')};"></div>
                        <span class="score-text">${m.engagement_score}%</span>
                    </div>
                </td>
                <td>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                        ${(parseFloat(m.pledgeAmount) || 0) > 0 ? this.pledgeStatusButtonForMember(m.id) : ''}
                        <button class="action-btn-sm" onclick="ChurchApp.viewMemberDetails('${m.id}')">View Profile</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (filteredMembers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 30px;">No members found matching the criteria.</td></tr>`;
        }
        this.populateMemberFamilyOptions();
    },

    // 9. Panel: Member Details Modal Manager
    viewMemberDetails(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;

        this.session.selectedMemberId = memberId;
        const modal = document.getElementById('member-detail-modal');
        
        // Family members are added by name - no separate member records needed.
        const familyMembers = this.effectiveFamilyMembers(member);

        // Fetch giving transactions for member
        const donations = this.db.transactions.filter(t => t.memberId === memberId);

        // Per-individual pledge: promised amount, paid so far, balance left and
        // the payments (with the means used) that make up the pledge.
        const pledge = this.memberPledge(member);
        const pledgePayments = (this.db.transactions || []).filter(t => t.memberId === memberId && String(t.category || '').toLowerCase() === 'pledge').sort((a, b) => new Date(a.date) - new Date(b.date));

        modal.innerHTML = `
            <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="member-modal-title">
                <div class="modal-header">
                    <h3 id="member-modal-title">Member Profile: ${esc(member.firstName)} ${esc(member.lastName)}</h3>
                    <button class="modal-close" aria-label="Close member profile" onclick="ChurchApp.closeModal('member-detail-modal')">x</button>
                </div>
                <div class="modal-body scroll-y">
                    <div style="display:flex; gap:8px; justify-content:flex-end; margin-bottom:12px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.downloadMemberProfile('${esc(member.id)}')">Download Profile PDF</button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.printMemberProfile('${esc(member.id)}')">Print / Save</button>
                    </div>
                    <div class="member-detail-grid">
                        <div>
                            <h4>Contact Information</h4>
                            <p><strong>Email:</strong> ${esc(member.email)}</p>
                            <p><strong>Phone:</strong> ${esc(member.phone)}</p>
                            <p><strong>Primary Branch:</strong> ${esc(member.branchName)}</p>
                            <p><strong>Engagement Rating:</strong> ${esc(member.engagement_score)}%</p>
                        </div>
                        <div>
                            <h4>Family Connections</h4>
                            <p><strong>Family Unit ID:</strong> ${esc(member.familyId || 'Not set')}</p>
                            ${member.familyName ? `<p><strong>Family:</strong> ${esc(member.familyName)}</p>` : ''}
                            <p style="font-size:0.75rem; color:var(--text-secondary); margin: 8px 0 10px;">Add or edit family members by name. When a family member gives, the gift is credited to <strong>${esc(member.firstName)} ${esc(member.lastName)}</strong>.</p>
                            <div id="family-members-editor" style="display:flex; flex-direction:column; gap:8px;">
                                ${familyMembers.length ? familyMembers.map((fm, idx) => `
                                    <div class="family-member-row">
                                        <input type="text" class="form-control family-member-name" data-idx="${idx}" value="${esc(fm.name)}" placeholder="Family member name" aria-label="Family member name">
                                        <select class="select-custom family-member-role" data-idx="${idx}" aria-label="Family member role">
                                            <option value="">Role</option>
                                            ${FAMILY_ROLES.map(r => `<option value="${esc(r)}" ${fm.role === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
                                        </select>
                                        <button type="button" class="btn btn-danger btn-sm" onclick="ChurchApp.removeFamilyMemberRow(${idx})">Remove</button>
                                    </div>`).join('') : '<p class="muted-italic" id="family-members-empty" style="font-size:0.8rem;">No family members added yet.</p>'}
                            </div>
                            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                                <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.addFamilyMemberRow()">+ Add Family Member</button>
                                <button type="button" class="btn btn-primary-gradient btn-sm" onclick="ChurchApp.saveFamilyMembers()">Save Family Members</button>
                            </div>
                        </div>
                    </div>

                    <div class="milestones-section">
                        <h4>Member Details</h4>
                        <div class="member-detail-grid" style="margin-top:8px;">
                            <div>
                                <p><strong>Role / Position:</strong> ${esc(member.rolePosition || 'Not provided')}</p>
                                <p><strong>Marital Status:</strong> ${esc(member.maritalStatus || 'Not provided')}</p>
                                <p><strong>Age:</strong> ${member.age != null ? esc(String(member.age)) : 'Not provided'}</p>
                            </div>
                            <div>
                                <p><strong>Expectations from the group:</strong> ${esc(member.expectations || 'Not provided')}</p>
                                <p><strong>Previous experience / organization:</strong> ${esc(member.previousExperience || 'Not provided')}</p>
                            </div>
                        </div>
                    </div>
                    <div class="milestones-section">
                        <h4>Spiritual Milestones</h4>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                            ${member.spiritualMilestones.length > 0 ? member.spiritualMilestones.map((m, idx) => `<span class="milestone-pill">${esc(m)} <button class="milestone-remove" onclick="ChurchApp.removeSpiritualMilestone(${idx})" aria-label="Remove milestone">x</button></span>`).join('') : '<span class="muted-italic">No spiritual milestones logged.</span>'}
                        </div>
                        <div style="margin-top: 12px;">
                            <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:6px;">Record a milestone - enter the date it happened and what happened (e.g. Baptized, Confirmed, Joined membership).</div>
                            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                <input type="date" id="new-milestone-date" class="form-control" style="width: 160px;" aria-label="Milestone date">
                                <input type="text" id="new-milestone-input" placeholder="What happened?" class="form-control" style="flex-grow: 1; min-width: 180px;" aria-label="Milestone description">
                                <button class="btn btn-primary-gradient" onclick="ChurchApp.addSpiritualMilestone()">Add Milestone</button>
                            </div>
                        </div>
                    </div>

                    <div class="milestones-section">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                            <h4>Pledge (Money Promised)</h4>
                            ${pledge.amount > 0 ? this.pledgeStatusButton(pledge.amount, pledge.paid, pledge.balance, member.id) : '<span class="muted-italic" style="font-size:0.8rem;">No pledge recorded for this member.</span>'}
                        </div>
                        <div class="tx-pledge-grid" style="margin-top:10px;">
                            <div class="tx-pledge-stat"><span>Pledged</span><strong>${window.money(pledge.amount, { decimals: 0 })}</strong></div>
                            <div class="tx-pledge-stat"><span>Contributed</span><strong>${window.money(pledge.paid, { decimals: 0 })}</strong></div>
                            <div class="tx-pledge-stat tx-pledge-balance-stat"><span>Balance</span><strong>${window.money(pledge.balance, { decimals: 0 })}</strong></div>
                        </div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; align-items:center;">
                            <input type="number" id="member-pledge-edit-amount" class="form-control" style="width:170px;" min="0" step="1" placeholder="Pledge amount (Ksh)" value="${pledge.amount > 0 ? pledge.amount : ''}" aria-label="Pledge amount">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.setMemberPledge('${esc(member.id)}')">Save Pledge</button>
                        </div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center;">
                            <input type="number" id="member-pledge-pay-amount" class="form-control" style="width:150px;" min="1" step="1" placeholder="Payment (Ksh)" aria-label="Pledge payment amount">
                            <select id="member-pledge-pay-method" class="select-custom" style="width:170px;" aria-label="Pledge payment method">
                                ${PLEDGE_METHODS.map(m => `<option>${esc(m)}</option>`).join('')}
                            </select>
                            <button type="button" class="btn btn-primary-gradient btn-sm" onclick="ChurchApp.recordMemberPledgePayment('${esc(member.id)}')">Pay Pledge</button>
                        </div>
                        <div style="margin-top:12px;">
                            <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:6px;">Pledge payments &amp; the means used:</div>
                            ${pledgePayments.length ? `
                            <table class="financial-table">
                                <thead><tr><th>Date</th><th style="text-align:right;">Amount</th><th>Means Used</th></tr></thead>
                                <tbody>${pledgePayments.map(p => `
                                    <tr>
                                        <td>${esc(p.date)}</td>
                                        <td class="amount-cell" style="color:#10b981; font-weight:bold; text-align:right;">${window.money(parseFloat(p.amount), { decimals: 0 })}</td>
                                        <td><span class="category-pill category-pledge">${esc(p.paymentMethod || 'Cash')}</span></td>
                                    </tr>`).join('')}
                                </tbody>
                            </table>` : '<p class="muted-italic" style="font-size:0.8rem;">No pledge payments recorded yet - log one above or in the Financials ledger.</p>'}
                        </div>
                    </div>

                    <div style="margin-top:12px; padding:12px; border:1px solid rgba(16,185,129,0.3); border-radius:10px; background:rgba(16,185,129,0.06);">
                        <div style="font-size:0.78rem; font-weight:600; color:#34d399; margin-bottom:6px;">Give the Whole Amount (One-time Gift)</div>
                        <div style="font-size:0.7rem; color:var(--text-secondary); margin-bottom:8px;">For members who prefer not to pledge - record their full gift to any project/fund of their choice.</div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                            <select id="member-oneoff-project" class="select-custom" style="flex:1; min-width:170px;" aria-label="One-time gift project">${this.memberGiveProjectOptions()}</select>
                            <select id="member-oneoff-method" class="select-custom" style="width:150px;" aria-label="One-time gift method">
                                ${PLEDGE_METHODS.map(m => `<option>${esc(m)}</option>`).join('')}
                            </select>
                            <input type="number" id="member-oneoff-amount" class="form-control" style="width:140px;" min="1" step="1" placeholder="Amount (Ksh)" aria-label="One-time gift amount">
                            <button type="button" class="btn btn-primary-gradient btn-sm" onclick="ChurchApp.recordOneTimeGiftForMember('${esc(member.id)}')">Log Gift</button>
                        </div>
                    </div>

                    <div style="margin-top: 20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <h4>Recent Giving Ledger</h4>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                ${this.memberPledge(member).amount > 0 ? this.pledgeStatusButtonForMember(member.id) : ''}
                                <button class="btn btn-secondary btn-sm" onclick="ChurchApp.viewGivingStatement('${esc(member.id)}')">Giving Statement</button>
                            </div>
                        </div>
                        <table class="financial-table" style="margin-top: 8px;">
                            <thead>
                                <tr>
                                    <th>Receipt</th>
                                    <th>Date</th>
                                    <th>Category</th>
                                    <th style="text-align:right;">Amount</th>
                                    <th>Method</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${donations.map(d => `
                                    <tr>
                                        <td><a href="#" onclick="ChurchApp.viewReceipt('${esc(d.id)}'); return false;">${esc(d.receiptNumber)}</a></td>
                                        <td>${esc(d.date)}${d.onBehalfOf ? `<div style="font-size:0.68rem; color:var(--text-secondary);">by ${esc(d.onBehalfOf)}</div>` : ''}</td>
                                        <td>${this.txCategoryCell(d)}</td>
                                        <td class="amount-cell" style="color: #10b981; font-weight: bold;">${money(parseFloat(d.amount))}</td>
                                        <td>${esc(d.paymentMethod)}</td>
                                    </tr>
                                `).join('')}
                                ${donations.length === 0 ? '<tr><td colspan="5" style="text-align:center;" class="muted-italic">No transaction history found.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        this.openModal('member-detail-modal');
    },

    addSpiritualMilestone() {
        const input = document.getElementById('new-milestone-input');
        const dateInput = document.getElementById('new-milestone-date');
        const detail = input ? input.value.trim() : '';
        const date = dateInput ? dateInput.value : '';
        if (!detail && !date) return;
        if (!date) { this.toast('Pick the date the milestone happened.', 'error'); return; }
        if (!detail) { this.toast('Describe what happened for this milestone.', 'error'); return; }

        const milestone = detail + ': ' + date;
        const member = this.db.members.find(m => m.id === this.session.selectedMemberId);
        if (member) {
            member.spiritualMilestones.push(milestone);
            // Boost engagement score slightly for milestone achievement
            member.engagement_score = Math.min(member.engagement_score + 5, 100);
            this.saveDB();
            this.syncMemberProfile(member);
            if (input) input.value = '';
            if (dateInput) dateInput.value = '';
            // Re-render
            this.viewMemberDetails(member.id);
            this.renderMemberDirectory();
            this.toast('Milestone added for ' + member.firstName + '.');
        }
    },

    removeSpiritualMilestone(index) {
        const member = this.db.members.find(m => m.id === this.session.selectedMemberId);
        if (!member || !Array.isArray(member.spiritualMilestones)) return;
        member.spiritualMilestones.splice(index, 1);
        this.saveDB();
        this.syncMemberProfile(member);
        this.viewMemberDetails(member.id);
        this.renderMemberDirectory();
    },

    // Family members are simple names (plus an optional role) on the registered
    // member - no separate member records or link/unlink machinery.
    effectiveFamilyMembers(member) {
        const stored = Array.isArray(member.familyMembers) ? member.familyMembers : [];
        const linked = this.db.members.filter((x) => member.familyId && x.familyId === member.familyId && x.id !== member.id);
        const seen = new Set();
        const out = [];
        const push = (name, role) => {
            const trimmed = String(name || '').trim();
            if (!trimmed || seen.has(trimmed.toLowerCase())) return;
            seen.add(trimmed.toLowerCase());
            out.push({ name: trimmed, role: String(role || '').trim() });
        };
        stored.forEach((fm) => { if (fm && fm.name) push(fm.name, fm.role); });
        linked.forEach((lm) => push(`${lm.firstName} ${lm.lastName}`, lm.familyRole));
        return out;
    },

    collectFamilyMemberRows() {
        return Array.from(document.querySelectorAll('#family-members-editor .family-member-row')).map((rowEl) => {
            const nameInput = rowEl.querySelector('.family-member-name');
            const roleSelect = rowEl.querySelector('.family-member-role');
            return {
                name: nameInput ? nameInput.value.trim() : '',
                role: roleSelect ? roleSelect.value : ''
            };
        }).filter((fm) => fm.name);
    },

    addFamilyMemberRow() {
        const member = this.db.members.find(m => m.id === this.session.selectedMemberId);
        if (!member) return;
        const rows = this.collectFamilyMemberRows();
        rows.push({ name: '', role: '' });
        member.familyMembers = rows;
        this.viewMemberDetails(member.id);
    },

    removeFamilyMemberRow(index) {
        const member = this.db.members.find(m => m.id === this.session.selectedMemberId);
        if (!member) return;
        const rows = this.collectFamilyMemberRows();
        rows.splice(index, 1);
        member.familyMembers = rows;
        this.viewMemberDetails(member.id);
    },

    saveFamilyMembers() {
        const member = this.db.members.find(m => m.id === this.session.selectedMemberId);
        if (!member) return;
        const rows = this.collectFamilyMemberRows();
        member.familyMembers = rows;

        // Keep legacy member-record links in sync with the saved list so a
        // removed name does not reappear from an old family link.
        if (member.familyId) {
            const savedNames = rows.map((r) => r.name.toLowerCase());
            this.db.members.forEach((x) => {
                if (x.id === member.id || x.familyId !== member.familyId) return;
                const full = `${x.firstName} ${x.lastName}`.toLowerCase();
                if (!savedNames.includes(full)) {
                    x.familyId = null;
                    x.familyRole = null;
                }
            });
        }
        if (!rows.length && member.familyId) member.familyId = null;

        this.saveDB();
        this.syncMemberProfile(member);
        this.viewMemberDetails(member.id);
        this.renderMemberDirectory();
        this.toast(rows.length ? `Family members saved (${rows.length}).` : 'Family members cleared.');
    },
    handleCreateMember() {
        const firstName = document.getElementById('member-first-name').value.trim();
        const lastName = document.getElementById('member-last-name').value.trim();
        const email = document.getElementById('member-email').value.trim();
        const phone = document.getElementById('member-phone').value.trim();
        const branchId = document.getElementById('member-branch-select').value;
        const skillsText = document.getElementById('member-skills').value.trim();
        const familyMembersText = document.getElementById('member-family-members') ? document.getElementById('member-family-members').value : '';
        const familyMembers = familyMembersText.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, role: '' }));
        const contribution = parseFloat(document.getElementById('member-family-contribution') ? document.getElementById('member-family-contribution').value : '') || 0;
        const rolePosition = document.getElementById('member-role-position') ? document.getElementById('member-role-position').value.trim() : '';
        const maritalStatus = document.getElementById('member-marital-status') ? document.getElementById('member-marital-status').value : '';
        const ageRaw = document.getElementById('member-age') ? document.getElementById('member-age').value : '';
        const age = (ageRaw === '' || isNaN(parseInt(ageRaw, 10))) ? null : Math.min(130, Math.max(0, parseInt(ageRaw, 10)));
        const expectations = document.getElementById('member-expectations') ? document.getElementById('member-expectations').value.trim() : '';
        const previousExperience = document.getElementById('member-previous-experience') ? document.getElementById('member-previous-experience').value.trim() : '';
        const pledgeAmount = parseFloat(document.getElementById('member-pledge-amount') ? document.getElementById('member-pledge-amount').value : '') || 0;
        const pledgeMethod = document.getElementById('member-pledge-method') ? document.getElementById('member-pledge-method').value : '';
        const givingType = document.getElementById('member-giving-type') ? document.getElementById('member-giving-type').value : 'pledge';
        const giveProject = document.getElementById('member-give-project') ? document.getElementById('member-give-project').value : 'Offering';
        
        const branchObj = this.db.branches.find(b => b.id === branchId);
        const branchLabel = branchObj ? branchObj.name : (branchId || 'Selected Branch');
        const skillsArray = skillsText ? skillsText.split(',').map(s => s.trim()) : [];

        // Families are tracked as names on the registered member record.
        const familyId = null;
        const newMember = {
            id: `m_${Date.now()}`,
            branchId: branchId,
            branchName: branchLabel,
            firstName,
            lastName,
            email,
            phone,
            familyId: null,
            familyRole: null,
            familyMembers,
            familyName: undefined,
            familyContactName: undefined,
            familyContactPhone: undefined,
            familyContactEmail: undefined,
            spiritualMilestones: ['Registered: ' + new Date().toISOString().split('T')[0]],
            volunteer_skills: skillsArray,
            engagement_score: 50,
            rolePosition: rolePosition || null,
            maritalStatus: maritalStatus || null,
            age,
            expectations: expectations || null,
            previousExperience: previousExperience || null,
            pledgeAmount: givingType === 'full' ? null : (pledgeAmount > 0 ? pledgeAmount : null),
            pledgePaid: 0
        };

        this.db.members.push(newMember);
        this.saveDB();
        this.apiWrite(
            () => Church2API.createMember({
                firstName, lastName, email, phone,
                volunteer_skills: skillsArray, branchId,
                rolePosition, maritalStatus, age, expectations, previousExperience,
                familyId: newMember.familyId || null,
                familyRole: newMember.familyRole || null,
                familyName: newMember.familyName || null,
                familyContactName: newMember.familyContactName || null,
                familyContactPhone: newMember.familyContactPhone || null,
                familyContactEmail: newMember.familyContactEmail || null,
                familyMembers: newMember.familyMembers || [],
                pledgeAmount: givingType === 'full' ? null : (pledgeAmount > 0 ? pledgeAmount : null),
            }),
            (srv) => {
                if (srv && srv.id) {
                    newMember.id = srv.id;
                    this.saveDB();
                }
                if (contribution > 0) {
                    if (givingType === 'full') {
                        // One-time gift: the individual chose which project/fund
                        // the whole amount goes to - no pledge is recorded.
                        const target = giveProject || 'Offering';
                        const campaign = target.indexOf('campaign:') === 0
                            ? (this.db.campaigns || []).find(c => c.id === target.slice('campaign:'.length)) || null
                            : null;
                        const fullCategory = campaign ? campaign.fundCategory : target;
                        this.recordContributionForMember(newMember, contribution, fullCategory, pledgeMethod || 'Cash', {
                            campaignId: campaign ? campaign.id : null,
                            campaignName: campaign ? campaign.name : null
                        });
                    } else if (pledgeAmount > 0) {
                        // The initial gift pays toward the member's pledge using
                        // the means (method) they chose.
                        this.recordContributionForMember(newMember, contribution, 'Pledge', pledgeMethod || 'Cash');
                    } else {
                        this.recordContributionForMember(newMember, contribution, 'Offering', 'Cash');
                    }
                }
            }
        );
        document.getElementById('add-member-form').reset();

        // Notification simulation
        this.toast(`${firstName} ${lastName} enrolled in ${branchLabel}.`);
        this.renderMemberDirectory();
    },

    recordContributionForMember(member, amount, category = 'Offering', method = 'Cash', extra = {}) {
        if (!member || !(amount > 0)) return;
        const date = new Date().toISOString().split('T')[0];
        const branchObj = this.db.branches.find(b => b.id === member.branchId);
        const newTx = {
            id: `t_${Date.now()}`,
            branchId: member.branchId,
            branchName: branchObj ? branchObj.name : 'Selected Branch',
            memberId: member.id,
            memberName: `${member.firstName} ${member.lastName}`,
            amount,
            category,
            campaignId: extra.campaignId || null,
            campaignName: extra.campaignName || null,
            date,
            paymentMethod: method,
            receiptNumber: `REC-2026-${Math.floor(Math.random() * 90000) + 10000}`
        };
        this.db.transactions = this.db.transactions || [];
        this.db.transactions.unshift(newTx);
        this.saveDB();
        this.apiWrite(
            () => Church2API.recordTransaction({ memberId: member.id, amount, category, paymentMethod: method, date, memberName: newTx.memberName, branchId: member.branchId }),
            (srv) => { if (srv && srv.id) { newTx.id = srv.id; if (srv.receiptNumber) newTx.receiptNumber = srv.receiptNumber; } }
        );
        // A pledge payment reduces what the individual still owes on the pledge.
        if (category === 'Pledge' && !extra.campaignId) {
            member.pledgePaid = Math.min(parseFloat(member.pledgeAmount) || 0, (parseFloat(member.pledgePaid) || 0) + amount);
            this.syncMemberProfile(member);
        }
    },

    // Record (or update) the amount this individual promises as a pledge.
    setMemberPledge(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;
        const input = document.getElementById('member-pledge-edit-amount');
        const amount = parseFloat(input ? input.value : '') || 0;
        if (amount < 0) { this.toast('Pledge amount cannot be negative.', 'error'); return; }
        member.pledgeAmount = amount > 0 ? amount : null;
        member.pledgePaid = Math.min(parseFloat(member.pledgePaid) || 0, amount > 0 ? amount : 0);
        this.saveDB();
        this.syncMemberProfile(member);
        this.viewMemberDetails(memberId);
        this.renderMemberDirectory();
        this.toast(amount > 0 ? `Pledge of ${window.money(amount)} recorded for ${member.firstName} ${member.lastName}.` : `Pledge cleared for ${member.firstName} ${member.lastName}.`);
    },

    // Log a pledge payment for this individual with the means they used to pay.
    recordMemberPledgePayment(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;
        const amount = parseFloat(document.getElementById('member-pledge-pay-amount') ? document.getElementById('member-pledge-pay-amount').value : '');
        const method = document.getElementById('member-pledge-pay-method') ? document.getElementById('member-pledge-pay-method').value : 'Cash';
        if (isNaN(amount) || amount <= 0) { this.toast('Enter a valid pledge payment amount.', 'error'); return; }
        const pledge = this.memberPledge(member);
        if (pledge.amount <= 0) { this.toast('Set a pledge amount for this member first.', 'error'); return; }
        if (amount > pledge.balance) { this.toast(`Payment exceeds the remaining balance of ${window.money(pledge.balance)}.`, 'error'); return; }
        const result = this.logPledgePayment(member, amount, method);
        this.viewMemberDetails(memberId);
        this.renderAll();
        this.toast(`Logged pledge payment of ${window.money(amount)} via ${esc(method)}. Received: ${window.money(result.received)}, Remaining: ${window.money(result.remaining)}.`);
    },

    // Shared pledge payment recorder: creates the Pledge transaction, reduces
    // what the individual still owes on the pledge, and syncs the means used.
    logPledgePayment(member, amount, method, extra = {}) {
        const date = new Date().toISOString().split('T')[0];
        const branchObj = this.db.branches.find(b => b.id === member.branchId);
        const newTx = {
            id: `t_${Date.now()}`,
            branchId: member.branchId,
            branchName: branchObj ? branchObj.name : member.branchName,
            memberId: member.id,
            memberName: `${member.firstName} ${member.lastName}`,
            amount,
            category: 'Pledge',
            campaignId: extra.campaignId || null,
            campaignName: extra.campaignName || null,
            date,
            paymentMethod: method,
            receiptNumber: `REC-2026-${Math.floor(Math.random() * 90000) + 10000}`,
            onBehalfOf: null
        };
        this.db.transactions = this.db.transactions || [];
        this.db.transactions.unshift(newTx);
        const paidBefore = parseFloat(member.pledgePaid) || 0;
        member.pledgePaid = Math.min(parseFloat(member.pledgeAmount) || 0, paidBefore + amount);
        member.engagement_score = Math.min((member.engagement_score || 0) + 2, 100);
        this.saveDB();
        this.syncMemberProfile(member);
        this.apiWrite(
            () => Church2API.recordTransaction({ memberId: member.id, amount, category: 'Pledge', paymentMethod: method, date, memberName: newTx.memberName, branchId: member.branchId }),
            (srv) => { if (srv && srv.id) { newTx.id = srv.id; if (srv.receiptNumber) newTx.receiptNumber = srv.receiptNumber; } }
        );
        return { received: paidBefore + amount, remaining: Math.max(0, (parseFloat(member.pledgeAmount) || 0) - (paidBefore + amount)) };
    },

    // The pledge button doubles as a payment form: for an individual's pledge
    // it opens the modal where the member enters the amount and the means used
    // to pay, then records it against their pledge.
    recordPledgeFromButton(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;
        const amount = parseFloat(document.getElementById('pledge-modal-pay-amount') ? document.getElementById('pledge-modal-pay-amount').value : '');
        const method = document.getElementById('pledge-modal-pay-method') ? document.getElementById('pledge-modal-pay-method').value : 'Cash';
        if (isNaN(amount) || amount <= 0) { this.toast('Enter a valid pledge payment amount.', 'error'); return; }
        const pledge = this.memberPledge(member);
        if (pledge.amount <= 0) { this.toast('Set a pledge amount for this member first.', 'error'); return; }
        if (amount > pledge.balance) { this.toast(`Payment exceeds the remaining balance of ${window.money(pledge.balance)}.`, 'error'); return; }
        const result = this.logPledgePayment(member, amount, method);
        this.closeModal('receipt-modal');
        this.renderAll();
        this.toast(`Logged pledge payment of ${window.money(amount)} via ${esc(method)}. Received: ${window.money(result.received)}, Remaining: ${window.money(result.remaining)}.`);
    },

    toggleMemberFamilySection() {
        const toggle = document.getElementById('member-link-family');
        const section = document.getElementById('member-family-section');
        if (section) section.style.display = toggle && toggle.checked ? 'flex' : 'none';
    },

    toggleMemberFamilyNewFields() {
        const select = document.getElementById('member-family-select');
        const newFields = document.getElementById('member-family-new-fields');
        if (newFields) newFields.style.display = select && select.value ? 'none' : 'flex';
    },

    populateMemberFamilyOptions() {
        const select = document.getElementById('member-family-select');
        if (!select) return;
        const families = new Map();
        (this.db.members || []).forEach(m => {
            if (!m.familyId || families.has(m.familyId)) return;
            const label = m.familyName || `${m.firstName} ${m.lastName}'s Family`;
            families.set(m.familyId, label);
        });
        select.innerHTML = '<option value="">Create a new family</option>' +
            [...families.entries()].map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
        const newFields = document.getElementById('member-family-new-fields');
        if (newFields) newFields.style.display = select.value ? 'none' : 'flex';
    },

    // 10. Panel: Financials Ledger Rendering
    renderFinancials() {
        const branchId = this.session.currentBranch;
        const tbody = document.getElementById('financials-tbody');
        tbody.innerHTML = '';
        this.populateTxCategoryOptions();
        // Guest tab: same allocation funds + projects, plus a default date.
        const guestCat = document.getElementById('guest-tx-category');
        if (guestCat) guestCat.innerHTML = this.memberGiveProjectOptions();
        const guestDate = document.getElementById('guest-tx-date');
        if (guestDate && !guestDate.value) guestDate.value = new Date().toISOString().split('T')[0];

        let filteredTx = this.db.transactions;
        if (branchId !== 'all' && branchId !== 'global') {
            filteredTx = this.db.transactions.filter(t => t.branchId === branchId);
        }

        // Render rows
        filteredTx.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="receipt-no" style="font-family: monospace; font-weight: bold;">${esc(t.receiptNumber)}</span></td>
                <td><span class="branch-pill badge-${esc(t.branchId)}">${esc(t.branchName)}</span></td>
                <td>${esc(t.memberName || 'Anonymous')}</td>
                <td>${this.txCategoryCell(t)}</td>
                <td class="amount-cell" style="color: #10b981; font-weight: bold; text-align: right;">${money(parseFloat(t.amount))}</td>
                <td>${esc(t.date)}</td>
                <td>${esc(t.paymentMethod)}</td>
                <td>
                    <button class="action-btn-sm" onclick="ChurchApp.viewReceipt('${esc(t.id)}')">Receipt</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (filteredTx.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 30px;">No transactions logged.</td></tr>`;
        }

        // Bind quick export buttons
        document.getElementById('export-csv-btn').onclick = () => this.exportFinancialCSV(filteredTx);

        // Campaign progress + recurring-gift insights strip
        this.renderGivingInsights(branchId);
        this.renderFinancialSummary(branchId, filteredTx);
        this.renderGuestContributions(branchId, filteredTx);
        this.refreshTxMpesaHint();
    },

    // "Guest Contributions" tab: every gift filed without a member record
    // (walk-in visitors / anonymous givers), with its own total and ledger.
    renderGuestContributions(branchId, filteredTx) {
        const tbody = document.getElementById('guest-contrib-tbody');
        if (!tbody) return;
        const guestTx = (filteredTx || this.db.transactions).filter(t => !t.memberId);
        tbody.innerHTML = '';
        guestTx.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="receipt-no" style="font-family: monospace; font-weight: bold;">${esc(t.receiptNumber)}</span></td>
                <td><span class="branch-pill badge-${esc(t.branchId)}">${esc(t.branchName)}</span></td>
                <td>${esc(t.memberName || 'Guest')}</td>
                <td>${this.txCategoryCell(t)}</td>
                <td class="amount-cell" style="color: #10b981; font-weight: bold; text-align: right;">${money(parseFloat(t.amount))}</td>
                <td>${esc(t.date)}</td>
                <td>${esc(t.paymentMethod)}</td>
                <td>
                    <button class="action-btn-sm" onclick="ChurchApp.viewReceipt('${esc(t.id)}')">Receipt</button>
                    <button class="action-btn-sm" onclick="ChurchApp.editGuestContribution('${esc(t.id)}')">Edit</button>
                    <button class="action-btn-sm btn-dismiss" onclick="ChurchApp.deleteGuestContribution('${esc(t.id)}')">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        if (!guestTx.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 30px;">No guest contributions logged yet.</td></tr>`;
        }

        const summary = document.getElementById('guest-contrib-summary');
        if (summary) {
            const total = guestTx.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
            const moneyFmt = (n) => window.money(n, { decimals: 0 });
            summary.innerHTML = '<div class="giving-insights-head"><span style="font-family: var(--font-header); font-weight:700; color:var(--text-primary);">Guest Contributions Summary</span></div>' +
                `<div class="card-glass campaign-card summary-stat-card">
                    <span class="campaign-eyebrow">Guest Contributions</span>
                    <div class="stat-value">${moneyFmt(total)}</div>
                </div>
                <div class="card-glass campaign-card summary-stat-card">
                    <span class="campaign-eyebrow">Guest Gifts Filed</span>
                    <div class="stat-value">${guestTx.length}</div>
                </div>`;
        }

        const exportBtn = document.getElementById('export-guest-csv-btn');
        if (exportBtn) exportBtn.onclick = () => this.exportFinancialCSV(guestTx);
    },

    // Guest Contributions tab: add a new walk-in gift, or load an existing
    // ledger entry into the form to edit it. Entries without a member record
    // are guests (anonymous gifts go here too).
    handleGuestTxForm() {
        const editId = document.getElementById('guest-tx-edit-id').value;
        const name = document.getElementById('guest-tx-name').value.trim();
        const categoryValue = document.getElementById('guest-tx-category').value;
        const amount = parseFloat(document.getElementById('guest-tx-amount').value);
        const method = document.getElementById('guest-tx-method').value;
        const date = document.getElementById('guest-tx-date').value || new Date().toISOString().split('T')[0];

        if (!name) { this.toast('Enter the guest contributor name.', 'error'); return; }
        if (isNaN(amount) || amount <= 0) { this.toast('Enter a valid contribution amount greater than Ksh 0.', 'error'); return; }

        // Allocation Target of campaign:<id> maps to the dashboard project
        // fund, exactly like the offline member form.
        const campaign = categoryValue.indexOf('campaign:') === 0
            ? (this.db.campaigns || []).find(c => c.id === categoryValue.slice('campaign:'.length)) || null
            : null;
        const category = campaign ? campaign.fundCategory : categoryValue;

        let branchId = (this.session.currentBranch === 'all' || this.session.currentBranch === 'global')
            ? this.firstBranchId() : this.session.currentBranch;
        if (campaign && (this.session.currentBranch === 'all' || this.session.currentBranch === 'global')) {
            branchId = campaign.branchId;
        }
        const branchObj = this.db.branches.find(b => b.id === branchId);

        if (editId) {
            const tx = this.db.transactions.find(t => t.id === editId);
            if (!tx) return;
            tx.memberName = name;
            tx.amount = amount;
            tx.category = category;
            tx.campaignId = campaign ? campaign.id : null;
            tx.campaignName = campaign ? campaign.name : null;
            tx.date = date;
            tx.paymentMethod = method;
            if (branchObj) { tx.branchId = branchObj.id; tx.branchName = branchObj.name; }
            this.saveDB();
            this.resetGuestTxForm();
            this.renderAll();
            this.toast(`Guest contribution for ${esc(name)} updated.`);
            return;
        }

        const newTx = {
            id: `t_${Date.now()}`,
            branchId,
            branchName: branchObj ? branchObj.name : 'Church',
            memberId: null,
            memberName: name,
            amount,
            category,
            campaignId: campaign ? campaign.id : null,
            campaignName: campaign ? campaign.name : null,
            date,
            paymentMethod: method,
            receiptNumber: `REC-2026-${Math.floor(Math.random() * 90000) + 10000}`,
            onBehalfOf: null
        };
        this.db.transactions.unshift(newTx);
        this.saveDB();
        this.apiWrite(
            () => Church2API.recordTransaction({ memberId: 'anonymous', amount, category, paymentMethod: method, date, memberName: name, branchId }),
            (srv) => { if (srv && srv.id) { newTx.id = srv.id; if (srv.receiptNumber) newTx.receiptNumber = srv.receiptNumber; } }
        );
        this.resetGuestTxForm();
        this.renderAll();
        this.toast(`Logged ${money(amount)} from ${esc(name)}. Receipt ${newTx.receiptNumber}.`);
    },

    editGuestContribution(txId) {
        const tx = this.db.transactions.find(t => t.id === txId);
        if (!tx) return;
        const catSelect = document.getElementById('guest-tx-category');
        const campaignValue = tx.campaignId ? 'campaign:' + tx.campaignId : null;
        const catValue = (campaignValue && catSelect.querySelector('option[value="' + campaignValue + '"]'))
            ? campaignValue : tx.category;
        catSelect.value = catValue;
        if (!catSelect.value) catSelect.value = 'Offering';
        document.getElementById('guest-tx-edit-id').value = tx.id;
        document.getElementById('guest-tx-name').value = tx.memberName || '';
        document.getElementById('guest-tx-amount').value = tx.amount;
        document.getElementById('guest-tx-method').value = tx.paymentMethod || 'Cash';
        document.getElementById('guest-tx-date').value = tx.date || '';
        document.getElementById('guest-tx-submit-btn').textContent = 'Save Changes';
        const cancelBtn = document.getElementById('guest-tx-cancel-btn');
        if (cancelBtn) cancelBtn.style.display = '';
        const form = document.getElementById('guest-tx-form');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this.toast(`Editing guest contribution for ${esc(tx.memberName)}.`);
    },

    cancelGuestTxEdit() {
        this.resetGuestTxForm();
    },

    resetGuestTxForm() {
        const form = document.getElementById('guest-tx-form');
        if (form) form.reset();
        const editId = document.getElementById('guest-tx-edit-id');
        if (editId) editId.value = '';
        const submitBtn = document.getElementById('guest-tx-submit-btn');
        if (submitBtn) submitBtn.textContent = 'Add Guest Contribution';
        const cancelBtn = document.getElementById('guest-tx-cancel-btn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        const dateInput = document.getElementById('guest-tx-date');
        if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
    },

    deleteGuestContribution(txId) {
        const tx = this.db.transactions.find(t => t.id === txId);
        if (!tx) return;
        if (!confirm(`Delete the guest contribution from ${tx.memberName || 'Guest'} for ${money(parseFloat(tx.amount))}? This cannot be undone.`)) return;
        this.db.transactions = this.db.transactions.filter(t => t.id !== txId);
        this.saveDB();
        this.renderAll();
        this.toast('Guest contribution deleted.', 'info');
    },

    // Switch between the Contribution Ledger and Guest Contributions tabs.
    switchFinancialTab(tab) {
        document.querySelectorAll('.fin-tab').forEach((btn) => {
            const on = btn.dataset.finTab === tab;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const all = document.getElementById('fin-panel-all');
        const guest = document.getElementById('fin-panel-guest');
        if (all) all.style.display = tab === 'all' ? '' : 'none';
        if (guest) guest.style.display = tab === 'guest' ? '' : 'none';
    },

    // Rebuild the "Allocation Target" dropdown in Log Contribution Offline so
    // every project posted from the dashboard can be selected directly.

    // Populate the "Give to Project / Fund" picker (member registration) with
    // the general funds plus every project, so the individual chooses where
    // their one-time gift goes.
    populateMemberGiveProjects() {
        const select = document.getElementById('member-give-project');
        if (select) select.innerHTML = this.memberGiveProjectOptions();
    },

    memberGiveProjectOptions() {
        const branchId = this.session.currentBranch;
        const inScope = (bId) => (!branchId || branchId === 'global' || branchId === 'all') ? true : bId === branchId;
        const campaigns = (this.db.campaigns || []).filter(c => inScope(c.branchId));
        const base = [
            { value: 'Offering', label: 'General Offering' },
            { value: 'Tithe', label: 'Tithe' },
            { value: 'General Contribution - Guest', label: 'General Contribution' }
        ];
        const baseOptions = base.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
        const projectGroup = campaigns.length
            ? `<optgroup label="Projects">${campaigns.map(c => `<option value="campaign:${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>`
            : '';
        return baseOptions + projectGroup;
    },

    // Toggle between "Pledge (installments)" and "Give the whole amount now"
    // on the member registration form.
    toggleMemberGivingType() {
        const typeEl = document.getElementById('member-giving-type');
        const type = typeEl ? typeEl.value : 'pledge';
        const pledgeFields = document.getElementById('member-pledge-fields');
        const projectField = document.getElementById('member-give-project-field');
        const hint = document.getElementById('member-giving-hint');
        if (pledgeFields) pledgeFields.style.display = type === 'pledge' ? 'grid' : 'none';
        if (projectField) projectField.style.display = type === 'full' ? 'block' : 'none';
        if (hint) {
            hint.textContent = type === 'full'
                ? 'The initial contribution below is recorded as a one-time gift to the selected project/fund.'
                : 'If an initial payment is entered below, it counts toward this pledge using the method chosen above.';
        }
    },

    // Log a full one-time gift for an existing member from their profile - the
    // individual picked which project/fund the whole amount goes to.
    recordOneTimeGiftForMember(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;
        const target = document.getElementById('member-oneoff-project') ? document.getElementById('member-oneoff-project').value : 'Offering';
        const amount = parseFloat(document.getElementById('member-oneoff-amount') ? document.getElementById('member-oneoff-amount').value : '');
        const method = document.getElementById('member-oneoff-method') ? document.getElementById('member-oneoff-method').value : 'Cash';
        if (isNaN(amount) || amount <= 0) { this.toast('Enter a valid one-time gift amount.', 'error'); return; }
        const campaign = target.indexOf('campaign:') === 0
            ? (this.db.campaigns || []).find(c => c.id === target.slice('campaign:'.length)) || null
            : null;
        const category = campaign ? campaign.fundCategory : target;
        this.recordContributionForMember(member, amount, category, method, {
            campaignId: campaign ? campaign.id : null,
            campaignName: campaign ? campaign.name : null
        });
        this.viewMemberDetails(memberId);
        this.renderMemberDirectory();
        this.toast(`Logged one-time gift of ${window.money(amount)} for ${member.firstName} ${member.lastName}.`);
    },

    // Populate the member app's giving dropdown with the general funds and
    // every church project, so the giver chooses whichever they want.
    populateMobileGivingFunds() {
        const select = document.getElementById('mobile-giving-category');
        if (!select) return;
        const branchId = this.session.currentBranch;
        const inScope = (bId) => (!branchId || branchId === 'global' || branchId === 'all') ? true : bId === branchId;
        const campaigns = (this.db.campaigns || []).filter(c => inScope(c.branchId));
        const prev = select.value;
        const bases = [
            { value: 'Tithe', label: 'Tithe Contribution' },
            { value: 'Offering', label: 'General Offering' },
            { value: 'Pledge', label: 'Pledge Target' }
        ];
        const baseOptions = bases.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
        const projectGroup = campaigns.length
            ? `<optgroup label="Church Projects">${campaigns.map(c => `<option value="campaign:${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>`
            : '';
        select.innerHTML = baseOptions + projectGroup;
        if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
    },

    populateTxCategoryOptions() {
        const select = document.getElementById('tx-category-select');
        if (!select) return;
        const branchId = this.session.currentBranch;
        const inScope = (bId) => (!branchId || branchId === 'global' || branchId === 'all') ? true : bId === branchId;
        const campaigns = (this.db.campaigns || []).filter(c => inScope(c.branchId));
        const prev = select.value;
        const bases = [
            { value: 'Tithe', label: 'Tithe' },
            { value: 'Offering', label: 'Offering' },
            { value: 'Pledge', label: 'Pledge Payment' },
            { value: 'Project Donation', label: 'Project/Building Fund' },
            { value: 'General Contribution - Guest', label: 'General Contribution - Guest' }
        ];
        const baseOptions = bases.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
        const projectGroup = campaigns.length
            ? `<optgroup label="Projects">${campaigns.map(c => `<option value="campaign:${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>`
            : '';
        select.innerHTML = baseOptions + projectGroup;
        if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;
        this.refreshTxPledgePanel();
    },

    // A member's pledge promise: what they pledged, what they have paid so far,
    // and the balance still owed. Members without a pledge simply read 0s.
    memberPledge(member) {
        const amount = parseFloat(member && member.pledgeAmount) || 0;
        const paid = parseFloat(member && member.pledgePaid) || 0;
        return { amount, paid, balance: Math.max(0, amount - paid) };
    },

    // Resolve the pledge behind a transaction: campaign-backed pledge payments
    // report the campaign's promised/removed/remaining; otherwise the member's
    // pledged amount, what they have contributed and the balance still owed.
    transactionPledge(tx) {
        if (tx && tx.campaignId) {
            const camp = (this.db.campaigns || []).find(c => c.id === tx.campaignId);
            if (camp && String(camp.fundCategory || '').toLowerCase() === 'pledge') {
                const m = this.campaignMetrics(camp, () => true);
                return { pledged: m.goal, removed: m.raised, remaining: m.remaining };
            }
        }
        if (tx && tx.memberId) {
            const member = (this.db.members || []).find(m => m.id === tx.memberId);
            if (member) {
                const p = this.memberPledge(member);
                if (p.amount > 0) return { pledged: p.amount, removed: p.paid, remaining: p.balance };
            }
        }
        return { pledged: 0, removed: 0, remaining: 0 };
    },

    // Pledge button for a member record: surfaces their promised amount, what
    // they have contributed so far and the balance still left on the pledge.
    pledgeStatusButtonForMember(memberId) {
        const p = this.memberPledge((this.db.members || []).find(m => m.id === memberId));
        return this.pledgeStatusButton(p.amount, p.paid, p.balance, memberId);
    },

    // Category cell for a ledger row. A pledge is a promise, so any pledge
    // mention renders as a button showing the balance left (clicking it opens
    // the full pledged / contributed / balance breakdown).
    txCategoryCell(tx) {
        if (String(tx.category || '').toLowerCase() !== 'pledge') {
            return `<span class="category-pill category-${esc((tx.category || '').toLowerCase().replace(' ', ''))}">${esc(tx.campaignName || tx.category)}</span>`;
        }
        const p = this.transactionPledge(tx);
        const campaignTag = tx.campaignName && tx.campaignName.toLowerCase() !== 'pledge'
            ? `<span class="category-pill category-pledge">${esc(tx.campaignName)}</span>`
            : '';
        return `<div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">${campaignTag}${this.pledgeStatusButton(p.pledged, p.removed, p.remaining, tx.memberId && !tx.campaignId ? tx.memberId : undefined)}</div>`;
    },

    // Quick-amount chips on the web offline giving form - mirrors the member
    // app Give tab chips (tap a preset or Custom).
    pickTxQuickAmount(chip) {
        const input = document.getElementById('tx-amount-input');
        if (!input) return;
        if (chip.dataset.amount === 'custom') {
            input.value = '';
            input.focus();
        } else {
            input.value = chip.dataset.amount;
        }
        document.querySelectorAll('#tx-quick-chips .give-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
        this.refreshTxPledgePanel();
    },

    // M-Pesa paybill hint on the web offline form, exactly like the member
    // app Give tab: visible only while M-Pesa is the payment gateway.
    refreshTxMpesaHint() {
        const hint = document.getElementById('tx-mpesa-hint');
        if (!hint) return;
        const method = document.getElementById('tx-method-select') ? document.getElementById('tx-method-select').value : 'M-Pesa';
        hint.style.display = method === 'M-Pesa' ? '' : 'none';
        const brand = window.MMC_BRAND;
        if (brand) {
            const pb = document.getElementById('tx-mpesa-paybill');
            const acc = document.getElementById('tx-mpesa-account');
            if (pb) pb.textContent = brand.giving.mpesa.paybill;
            if (acc) acc.textContent = brand.giving.mpesa.accountName;
        }
    },

    // "Log Contribution Offline" > Allocation Target = Pledge Payment: surface
    // the selected member's pledge - pledged amount, contributed so far and the
    // remaining balance - and warn when the entered amount would overpay.
    refreshTxPledgePanel() {
        const panel = document.getElementById('tx-pledge-panel');
        if (!panel) return;
        const category = document.getElementById('tx-category-select')?.value;
        const memberId = document.getElementById('tx-member-select')?.value;
        if (category !== 'Pledge' || !memberId || memberId === 'anonymous') {
            panel.style.display = 'none';
            return;
        }

        const member = this.db.members.find(m => m.id === memberId);
        const name = member ? `${member.firstName} ${member.lastName}` : 'this member';
        const pledge = this.memberPledge(member);
        const money = (n) => window.money(n, { decimals: 0 });
        const set = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        set('tx-pledge-member', name);
        set('tx-pledge-amount', money(pledge.amount));
        set('tx-pledge-paid', money(pledge.paid));
        set('tx-pledge-balance', money(pledge.balance));

        // "Paid via" pills, same as the member app My Pledge card.
        const methodsEl = document.getElementById('tx-pledge-methods');
        if (methodsEl) {
            const payments = (this.db.transactions || []).filter((t) => member && t.memberId === member.id && String(t.category || '').toLowerCase() === 'pledge');
            const payMethods = [...new Set(payments.map((t) => t.paymentMethod || 'Cash'))];
            methodsEl.innerHTML = payments.length
                ? 'Paid via: ' + payMethods.map((mth) => '<span class="category-pill category-pledge">' + esc(mth) + '</span>').join(' ')
                : 'No pledge payments yet.';
        }

        const amountInput = document.getElementById('tx-amount-input');
        const entered = parseFloat(amountInput ? amountInput.value : '') || 0;
        const hint = document.getElementById('tx-pledge-hint');
        if (hint) {
            if (pledge.amount <= 0) {
                hint.textContent = `No active pledge recorded for ${name}.`;
                hint.className = 'tx-pledge-hint is-warn';
            } else if (entered > pledge.balance) {
                hint.textContent = `Amount exceeds the remaining balance of ${money(pledge.balance)}.`;
                hint.className = 'tx-pledge-hint is-warn';
            } else if (pledge.balance <= 0) {
                hint.textContent = 'This pledge is fully paid.';
                hint.className = 'tx-pledge-hint is-ok';
            } else {
                hint.textContent = `Logging this contribution leaves a balance of ${money(Math.max(0, pledge.balance - entered))}.`;
                hint.className = 'tx-pledge-hint is-ok';
            }
        }
        panel.style.display = 'block';
    },

    // ---- Projects & fundraising campaigns --------------------------------
    // Shared metrics for a campaign: funded progress plus movement over the
    // last 14 days, so every project card can honestly show increase/decrease.
    campaignMetrics(c, inScope) {
        const goal = parseFloat(c.goal) || 0;
        const tx = (this.db.transactions || []).filter(t =>
            (t.campaignId ? t.campaignId === c.id : t.category === c.fundCategory) && inScope(t.branchId));
        const raised = (parseFloat(c.raisedOffset) || 0) + tx.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        const remaining = Math.max(0, goal - raised);
        const pct = goal ? Math.min(100, Math.round((raised / goal) * 100)) : 0;
        const now = Date.now();
        const day = 86400000;
        const sumSince = (cutoff) => tx
            .filter(t => t.date && !isNaN(new Date(t.date).getTime()) && new Date(t.date).getTime() >= cutoff)
            .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        const recent = sumSince(now - 7 * day);
        const prior = sumSince(now - 14 * day) - recent;
        let trend = { dir: 'flat', label: 'No recent activity', pct: 0, delta: 0 };
        if (recent > 0 || prior > 0) {
            const delta = recent - prior;
            if (delta > 0) {
                const pctChg = prior > 0 ? Math.round((delta / prior) * 100) : null;
                trend = { dir: 'up', label: pctChg != null ? `Up ${pctChg}% this week` : 'New funds this week', pct: pctChg, delta };
            } else if (delta < 0) {
                if (recent === 0) {
                    trend = { dir: 'down', label: 'No new funds this week', pct: 0, delta };
                } else {
                    const pctChg = Math.round((Math.abs(delta) / prior) * 100);
                    trend = { dir: 'down', label: `Down ${pctChg}% this week`, pct: pctChg, delta };
                }
            } else {
                trend = { dir: 'flat', label: 'Steady this week', pct: 0, delta: 0 };
            }
        }
        return { goal, raised, remaining, pct, trend };
    },

    fundCategoryBadge(category, pledge) {
        const labels = { Tithe: 'Tithes', Offering: 'Offering', Pledge: 'Pledge', 'Project Donation': 'Project Donation' };
        const key = labels[category] ? category : 'Project Donation';
        const cls = String(key).toLowerCase().replace(/\s+/g, '-');
        if (String(key).toLowerCase() === 'pledge') {
            // A pledge is the money promised: the mention is a button that
            // shows the balance left and opens the paid/remaining breakdown.
            const pledged = (pledge && pledge.pledged != null) ? pledge.pledged : 0;
            const removed = (pledge && pledge.removed != null) ? pledge.removed : 0;
            const remaining = (pledge && pledge.remaining != null) ? pledge.remaining : 0;
            return this.pledgeStatusButton(pledged, removed, remaining);
        }
        return `<span class="campaign-category-badge cat-${cls}">${esc(labels[key])}</span>`;
    },

    // Every pledge mention is a button-form: its face shows the amount received
    // and the money remaining, and clicking opens the full breakdown plus - for
    // an individual's pledge - a form to record a payment and the means used.
    pledgeStatusButton(pledged, removed, remaining, memberId) {
        const money = (n) => window.money(n, { decimals: 0 });
        const left = Math.max(0, remaining);
        const paid = Math.max(0, removed);
        const label = (paid > 0 || left > 0)
            ? `Pledge \u00b7 ${money(paid)} received \u00b7 ${left > 0 ? `${money(left)} left` : 'Fully paid'}`
            : 'Pledge';
        const args = [esc(String(pledged)), esc(String(paid)), esc(String(left))];
        if (memberId) args.push(`'${esc(memberId)}'`);
        return `<button type="button" class="btn btn-secondary btn-sm pledge-view-btn" title="Pledged ${money(pledged)} \u00b7 Received ${money(paid)} \u00b7 Remaining ${money(left)}" onclick="ChurchApp.viewPledgeDetails(${args.join(', ')})">${label}</button>`;
    },

    // "Pledge" = the money promised. The pledge button opens a breakdown of how
    // much was promised, the amount received so far and the money remaining -
    // and for an individual member it doubles as a payment form (amount + the
    // means used to pay).
    viewPledgeDetails(pledged, removed, remaining, memberId) {
        const modal = document.getElementById('receipt-modal');
        if (!modal) return;
        const money = (n) => window.money(n, { decimals: 0 });
        const member = memberId ? (this.db.members || []).find(m => m.id === memberId) : null;
        const pledge = member ? this.memberPledge(member) : null;
        const payForm = member && pledge && pledge.amount > 0 ? (pledge.balance > 0 ? `
                <div class="pledge-pay-form" style="margin-top:14px; border-top:1px dashed rgba(150,150,150,0.35); padding-top:12px;">
                    <div style="font-weight:700; margin-bottom:8px;">Pay your pledge</div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <input type="number" id="pledge-modal-pay-amount" class="form-control" min="1" step="1" placeholder="Payment amount (Ksh)" aria-label="Pledge payment amount">
                        <select id="pledge-modal-pay-method" class="select-custom" aria-label="Pledge payment method">
                            ${PLEDGE_METHODS.map(m => `<option>${esc(m)}</option>`).join('')}
                        </select>
                        <button type="button" class="btn btn-primary-gradient btn-sm" onclick="ChurchApp.recordPledgeFromButton('${esc(member.id)}')">Record Pledge Payment</button>
                    </div>
                </div>` : '<div style="margin-top:12px; font-size:0.8rem; color:var(--accent-gold);">This pledge is fully paid.</div>') : '';
        modal.innerHTML = `
            <div class="modal-card statement-card" role="dialog" aria-modal="true" aria-labelledby="pledge-modal-title">
                <div class="modal-header">
                    <h3 id="pledge-modal-title">Pledge Details</h3>
                    <button class="modal-close" aria-label="Close pledge details" onclick="ChurchApp.closeModal('receipt-modal')">x</button>
                </div>
                <div class="modal-body">
                    <div class="pledge-detail-row">
                        <span>Pledged (Money Promised)</span>
                        <strong>${money(pledged)}</strong>
                    </div>
                    <div class="pledge-detail-row">
                        <span>Amount Received</span>
                        <strong>${money(removed)}</strong>
                    </div>
                    <div class="pledge-detail-row pledge-detail-balance">
                        <span>Money Remaining</span>
                        <strong>${money(remaining)}</strong>
                    </div>
                    ${payForm}
                </div>
            </div>`;
        this.openModal('receipt-modal');
    },

    // Figures line for a project card. A pledge is a promise, not money out of
    // the door, so pledge campaigns explicitly show the pledged amount, what
    // has been paid so far, and the remaining balance. Other categories keep
    // the raised-of-goal wording.
    campaignFiguresHtml(c, m, containerClass = 'campaign-figures') {
        const money = (n) => window.money(n, { decimals: 0 });
        const isPledge = String(c.fundCategory || '').toLowerCase() === 'pledge';
        const figures = isPledge
            ? this.pledgeStatusButton(m.goal, m.raised, m.remaining)
            : `<strong>${money(m.raised)}</strong> raised of ${money(m.goal)} goal &middot; <strong>${money(m.remaining)}</strong> remaining`;
        return `<div class="${containerClass}">${figures}</div>`;
    },

    // Subtitle for a settings row: pledge campaigns show pledged/paid/remaining,
    // everything else shows the goal and its fund category.
    campaignRowSubtitle(c) {
        const m = this.campaignMetrics(c, () => true);
        const money = (n) => window.money(n, { decimals: 0 });
        const isPledge = String(c.fundCategory || '').toLowerCase() === 'pledge';
        if (isPledge) {
            return this.pledgeStatusButton(m.goal, m.raised, m.remaining);
        }
        return `${money(m.goal)} goal &middot; ${esc(c.fundCategory || 'Project')}`;
    },

    campaignCardHtml(c, inScope, canManage, supportForm) {
        const m = this.campaignMetrics(c, inScope);
        const money = (n) => window.money(n, { decimals: 0 });
        const arrow = m.trend.dir === 'up' ? '&#9650;' : m.trend.dir === 'down' ? '&#9660;' : '&#8226;';
        const trendCls = m.trend.dir === 'up' ? 'trend-up' : m.trend.dir === 'down' ? 'trend-down' : 'trend-flat';
        const funded = m.pct >= 100 ? '<span class="campaign-funded">Fully Funded</span>' : '';
        const actions = canManage ? `<div class="campaign-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.editCampaign('${esc(c.id)}')">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="ChurchApp.deleteCampaign('${esc(c.id)}')">Delete</button>
        </div>` : '';
        return `<div class="card-glass campaign-card">
            <div class="campaign-head">
                <div>
                    <div class="campaign-badges">${this.fundCategoryBadge(c.fundCategory, { pledged: m.goal, removed: m.raised, remaining: m.remaining })}${funded}</div>
                    <h4>${esc(c.name)}</h4>
                </div>
                <span class="campaign-pct">${m.pct}%</span>
            </div>
            <div class="campaign-bar"><div class="campaign-bar-fill" style="width:${m.pct}%;"></div></div>
            ${this.campaignFiguresHtml(c, m)}
            <div class="campaign-foot">
                <span class="campaign-trend ${trendCls}">${arrow} ${esc(m.trend.label)}</span>
            </div>
            ${supportForm ? `<div class="mobile-project-support">
                <input type="number" id="proj-amount-${esc(c.id)}" class="form-control" min="1" step="1" placeholder="Amount (Ksh)" aria-label="Support amount">
                <select id="proj-method-${esc(c.id)}" class="select-custom" aria-label="Payment method">
                    <option>M-Pesa</option>
                    <option>Card</option>
                    <option>Bank Transfer</option>
                    <option>Cash</option>
                </select>
                <button type="button" class="mobile-rsvp-btn" onclick="ChurchApp.supportProject('${esc(c.id)}')">Support this project</button>
            </div>` : ''}
            ${actions}
        </div>`;
    },

    // Dashboard "Projects & Fundraising" section - post + track live progress.
    renderDashboardProjects() {
        const el = document.getElementById('dashboard-projects-list');
        if (!el) return;
        const branchId = this.session.currentBranch;
        const canManage = this.apiEnabled() && (this.session.currentRole === 'hq_admin' || this.session.currentRole === 'branch_admin');
        const inScope = (bId) => (!branchId || branchId === 'global') ? true : bId === branchId;
        const campaigns = (this.db.campaigns || []).filter(c => inScope(c.branchId) || (branchId === 'global'));

        const branchSel = document.getElementById('dash-campaign-branch-input');
        if (branchSel) {
            const previous = branchSel.value;
            branchSel.innerHTML = (this.db.branches || []).map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
            if (previous && [...branchSel.options].some((o) => o.value === previous)) branchSel.value = previous;
            else if (this.session.currentBranch && this.session.currentBranch !== 'global' && [...branchSel.options].some((o) => o.value === this.session.currentBranch)) branchSel.value = this.session.currentBranch;
        }

        el.innerHTML = campaigns.length
            ? campaigns.map((c) => this.campaignCardHtml(c, inScope, canManage)).join('')
            : '<div class="campaign-empty">No projects yet - click "+ New Project" to post your first project with its required amount.</div>';
    },

    openDashboardProjectForm() {
        this.editingCampaignId = null;
        const form = document.getElementById('dash-add-campaign-form');
        if (form) {
            form.style.display = 'flex';
            form.reset();
        }
        const nameInput = document.getElementById('dash-campaign-name-input');
        if (nameInput) nameInput.focus();
    },

    // Shared save path for the settings + dashboard project forms.
    submitCampaignForm(prefix) {
        const name = document.getElementById(prefix + 'campaign-name-input').value.trim();
        const goal = Number(document.getElementById(prefix + 'campaign-goal-input').value);
        const fundCategory = document.getElementById(prefix + 'campaign-category-input').value;
        const branchId = document.getElementById(prefix + 'campaign-branch-input').value;
        const raisedOffset = Number(document.getElementById(prefix + 'campaign-offset-input').value) || 0;
        if (!name) { this.toast('Project name is required.', 'error'); return; }
        if (!Number.isFinite(goal) || goal <= 0) { this.toast('Enter a valid goal.', 'error'); return; }
        const payload = { name, goal, fundCategory, raisedOffset, branchId };
        const done = () => { this.resetCampaignForm(prefix); this.hydrateFromApi().then(() => this.renderAll()); };
        if (this.editingCampaignId) {
            this.apiWrite(() => Church2API.updateCampaign(this.editingCampaignId, payload), () => { this.toast('Project updated.'); done(); });
        } else {
            this.apiWrite(() => Church2API.createCampaign(payload), () => { this.toast('Project created.'); done(); });
        }
    },

    renderGivingInsights(branchId, targetEl, mobileMode) {
        const el = targetEl || document.getElementById('giving-insights');
        if (!el) return;
        // In the member app (mobileMode) every admin-posted project is shown
        // with no management buttons, and each card gets a support form.
        const inScope = mobileMode ? () => true : (bId) => (!branchId || branchId === 'global') ? true : bId === branchId;
        const canManage = !mobileMode && this.apiEnabled() && (this.session.currentRole === 'hq_admin' || this.session.currentRole === 'branch_admin');

        // Projects/pledge campaigns: raised = sum of matching-fund transactions
        // in scope, remaining = goal minus raised (never below zero).
        const campaigns = (this.db.campaigns || []).filter(c => inScope(c.branchId) || (branchId === 'global'));
        const campaignCards = campaigns.map((c) => this.campaignCardHtml(c, inScope, canManage, mobileMode)).join('');

        // Active recurring gifts in scope
        const recurring = (this.db.recurringGifts || []).filter(r => r.active && inScope(r.branchId));
        const recurringTotal = recurring.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
        const recurringCard = `<div class="card-glass campaign-card">
            <span class="campaign-eyebrow"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 0 1 13.5-3.5L20 8"/><path d="M20 4v4h-4"/><path d="M20 15a8 8 0 0 1-13.5 3.5L4 16"/><path d="M4 20v-4h4"/></svg> Recurring Giving</span>
            <h4>${recurring.length} active schedule${recurring.length === 1 ? '' : 's'}</h4>
            <div class="campaign-figures"><strong>${window.money(recurringTotal)}</strong> committed per cycle</div>
            ${recurring.length ? `<ul class="recurring-list">${recurring.slice(0, 3).map(r =>
                `<li>${esc(r.memberName)} - ${window.money(parseFloat(r.amount))} ${esc(r.frequency)} (${r.category === 'Pledge' ? this.pledgeStatusButtonForMember(r.memberId) : esc(r.category)})</li>`).join('')}</ul>` : ''}
        </div>`;

        const insightsHeader = `<div class="giving-insights-head">
            <span style="font-family: var(--font-header); font-weight:700; color:var(--text-primary);">Projects &amp; Pledge Campaigns</span>
            ${canManage ? `<button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.openNewProject()">+ New Project</button>` : ''}
        </div>`;

        el.innerHTML = insightsHeader + campaignCards + recurringCard;
    },

    // 10b. Panel: Settings (church profile, branches, projects).
    renderSettings() {
        if (!this.apiEnabled()) {
            const list = document.getElementById('branches-manager-list');
            if (list) list.innerHTML = '<div style="color:var(--text-secondary); font-size:0.85rem;">Connect to the live database to manage churches, branches and projects.</div>';
            const proj = document.getElementById('projects-manager-list');
            if (proj) proj.innerHTML = '';
            return;
        }
        this.renderChurchProfileForm();
        this.renderBranchesManager();
        this.renderProjectsManager();
        this.renderSecuritySettings();
    },

    // Contact details + news bullet surfaced in the member app. The super admin
    // edits these in Settings > Church Profile; demo mode falls back to brand.
    churchContactInfo() {
        const church = this.church || (Array.isArray(this.db.churches) && this.db.churches[0]) || null;
        const brand = window.MMC_BRAND || {};
        let savedYt = '';
        try { savedYt = (typeof localStorage !== 'undefined' && localStorage.getItem('church2_youtube_channel')) || ''; } catch (e) { /* private mode */ }
        return {
            contactEmail: (church && church.contactEmail) || brand.contactEmail || '',
            contactPhone: (church && church.contactPhone) || brand.contactPhone || '',
            newsBullet: (church && church.newsBullet) || brand.newsBullet || '',
            youtubeChannel: (church && church.youtubeChannel) || savedYt || brand.youtubeChannel || ''
        };
    },

    renderChurchProfileForm() {
        const church = this.church || (Array.isArray(this.db.churches) && this.db.churches[0]);
        if (!church) return;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        set('church-name-input', church.name);
        set('church-short-name-input', church.shortName);
        set('church-tagline-input', church.tagline);
        set('church-website-input', church.website);
        set('church-youtube-input', church.youtubeChannel);
        set('church-contact-email-input', church.contactEmail);
        set('church-contact-phone-input', church.contactPhone);
        set('church-news-bullet-input', church.newsBullet);
        this.church = church;
        if (this.session.churchId === church.id) this.session.churchName = church.name;
        this.applyChurchBranding();
    },

    renderBranchesManager() {
        const el = document.getElementById('branches-manager-list');
        if (!el) return;
        const branches = this.db.branches || [];
        const isHq = this.session.currentRole === 'hq_admin' || this.session.currentRole === 'platform_admin';
        const church = this.church || (Array.isArray(this.db.churches) && this.db.churches[0]) || null;
        const churchName = church && church.name ? church.name : 'this church';
        const titleEl = document.getElementById('branches-manager-title');
        if (titleEl) titleEl.textContent = 'Branches - ' + churchName;
        el.innerHTML = branches.length ? branches.map((b) => `
            <div class="branch-manager-row">
                <div style="flex:1; min-width:0;">
                    <strong>${esc(b.name)}</strong>
                    <div style="font-size:0.75rem; color:var(--text-secondary);">${esc(b.location || 'No location')}${(b.memberCount ?? b.member_count) != null ? ` &middot; ${b.memberCount ?? b.member_count} member${(b.memberCount ?? b.member_count) === 1 ? '' : 's'}` : ''}${b.code ? ` &middot; ${esc(b.code)}` : ''}</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    ${isHq ? `<button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.editBranch('${esc(b.id)}')">Edit</button>
                    <button type="button" class="btn btn-danger btn-sm" onclick="ChurchApp.deleteBranch('${esc(b.id)}')">Delete</button>` : ''}
                </div>
            </div>`).join('') : '<div style="color:var(--text-secondary); font-size:0.85rem;">No branches yet - add the first campus above.</div>';
        const formWrap = document.getElementById('add-branch-form');
        const hint = document.getElementById('branches-manager-hint');
        if (formWrap) formWrap.style.display = isHq ? 'flex' : 'none';
        if (hint) hint.textContent = isHq
            ? 'New branches are added under ' + churchName + ' - they appear across the console and in the member app.'
            : 'Branches for ' + churchName + ' are managed by the headquarters admin.';
    },

    resetBranchForm() {
        this.editingBranchId = null;
        const form = document.getElementById('add-branch-form');
        if (form) form.reset();
        const submit = document.getElementById('branch-form-submit');
        const cancel = document.getElementById('branch-form-cancel');
        if (submit) submit.textContent = 'Add Branch';
        if (cancel) cancel.style.display = 'none';
    },

    editBranch(id) {
        if (this.session.currentRole !== 'hq_admin' && this.session.currentRole !== 'platform_admin') return;
        const b = (this.db.branches || []).find((x) => x.id === id);
        if (!b) return;
        this.editingBranchId = id;
        const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v || ''; };
        set('branch-name-input', b.name);
        set('branch-location-input', b.location);
        set('branch-code-input', b.code);
        const submit = document.getElementById('branch-form-submit');
        const cancel = document.getElementById('branch-form-cancel');
        if (submit) submit.textContent = 'Save Branch Changes';
        if (cancel) cancel.style.display = 'inline-block';
    },

    deleteBranch(id) {
        if (this.session.currentRole !== 'hq_admin' && this.session.currentRole !== 'platform_admin') return;
        const b = (this.db.branches || []).find((x) => x.id === id);
        if (!b) return;
        if (!window.confirm(`Delete branch "${b.name}" and all its members, giving, attendance and groups? This cannot be undone.`)) return;
        this.apiWrite(() => Church2API.deleteBranch(id), () => {
            this.hydrateFromApi().then(() => this.renderAll());
            this.toast('Branch deleted.');
        });
    },

    renderProjectsManager() {
        const el = document.getElementById('projects-manager-list');
        if (!el) return;
        const campaigns = this.db.campaigns || [];

        // Keep the project form's campus picker in sync with the church's branches.
        const branchSel = document.getElementById('campaign-branch-input');
        if (branchSel) {
            const previous = branchSel.value;
            branchSel.innerHTML = (this.db.branches || []).map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
            if (previous && [...branchSel.options].some((o) => o.value === previous)) branchSel.value = previous;
            else if (this.session.currentBranch && this.session.currentBranch !== 'global' && [...branchSel.options].some((o) => o.value === this.session.currentBranch)) branchSel.value = this.session.currentBranch;
        }

        el.innerHTML = campaigns.length ? campaigns.map((c) => `
            <div class="branch-manager-row">
                <div style="flex:1; min-width:0;">
                    <strong>${esc(c.name)}</strong>
                    <div style="font-size:0.75rem; color:var(--text-secondary);">${this.campaignRowSubtitle(c)}</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.editCampaign('${esc(c.id)}')">Edit</button>
                    <button type="button" class="btn btn-danger btn-sm" onclick="ChurchApp.deleteCampaign('${esc(c.id)}')">Delete</button>
                </div>
            </div>`).join('') : '<div style="color:var(--text-secondary); font-size:0.85rem;">No projects yet - click "+ New Project" to start one.</div>';
    },

    openNewProject() {
        this.editingCampaignId = null;
        const form = document.getElementById('add-campaign-form');
        const nameInput = document.getElementById('campaign-name-input');
        if (form) {
            form.style.display = 'flex';
            form.reset();
        }
        this.session.activeTab = 'admin_settings';
        this.renderAll();
        if (nameInput) nameInput.focus();
    },

    resetCampaignForm(prefix = '') {
        this.editingCampaignId = null;
        const form = document.getElementById(prefix + 'add-campaign-form');
        if (form) form.style.display = 'none';
    },

    editCampaign(id) {
        const c = (this.db.campaigns || []).find((x) => x.id === id);
        if (!c) return;
        this.editingCampaignId = id;
        const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v || ''; };
        set('campaign-name-input', c.name);
        set('campaign-goal-input', c.goal);
        set('campaign-category-input', c.fundCategory || 'Project Donation');
        set('campaign-offset-input', c.raisedOffset || 0);
        const branchSel = document.getElementById('campaign-branch-input');
        if (branchSel && c.branchId && [...branchSel.options].some((o) => o.value === c.branchId)) branchSel.value = c.branchId;
        const form = document.getElementById('add-campaign-form');
        if (form) form.style.display = 'flex';
        this.session.activeTab = 'admin_settings';
        this.renderAll();
    },

    deleteCampaign(id) {
        const c = (this.db.campaigns || []).find((x) => x.id === id);
        if (!c) return;
        if (!window.confirm(`Delete project "${c.name}"? Money already received stays on the giving ledger.`)) return;
        this.apiWrite(() => Church2API.deleteCampaign(id), () => {
            this.hydrateFromApi().then(() => this.renderAll());
            this.toast('Project deleted.');
        });
    },

    // Conclusive financial summary: totals + per-fund breakdown + outstanding
    // pledge balances, so the ledger can be reconciled at a glance.
    renderFinancialSummary(branchId, filteredTx, targetEl, mobileMode) {
        const el = targetEl || document.getElementById('financial-summary');
        if (!el) return;
        const isMobile = mobileMode === true || (targetEl && targetEl.id === 'mobile-financial-summary');
        const tx = filteredTx || this.db.transactions;
        const inScope = (bId) => (!branchId || branchId === 'global') ? true : bId === branchId;
        const total = tx.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        const funds = ['Tithe', 'Offering', 'Pledge', 'Project Donation', 'General Contribution - Guest'];
        const byFund = funds.map(f => ({
            fund: f,
            amount: tx.filter(t => t.category === f).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
        }));
        // Pledge campaigns: the goal is a promise, so surface pledged, paid so
        // far and the remaining balance rather than just an outstanding figure.
        const pledgeCampaigns = (this.db.campaigns || []).filter(c => inScope(c.branchId) && String(c.fundCategory || '').toLowerCase() === 'pledge');
        const pledgePledged = pledgeCampaigns.reduce((s, c) => s + (parseFloat(c.goal) || 0), 0);
        const pledgePaid = pledgeCampaigns.reduce((s, c) => {
            const raised = (parseFloat(c.raisedOffset) || 0) + this.db.transactions
                .filter(t => (t.campaignId ? t.campaignId === c.id : t.category === c.fundCategory) && inScope(t.branchId))
                .reduce((s2, t) => s2 + (parseFloat(t.amount) || 0), 0);
            return s + raised;
        }, 0);
        const pledgeRemaining = Math.max(0, pledgePledged - pledgePaid);
        const money = (n) => window.money(n, { decimals: 0 });
        const mobileCardCls = isMobile ? ' mobile-summary-card' : '';
        const card = (label, value) => `<div class="card-glass campaign-card summary-stat-card${mobileCardCls}">
            <span class="campaign-eyebrow">${esc(label)}</span>
            <div class="stat-value">${value}</div>
        </div>`;
        // The Pledge card carries the full pledge picture: the promised total,
        // what has been paid/removed so far, and the remaining balance.
        const pledgeCard = `<div class="card-glass campaign-card summary-stat-card${mobileCardCls}">
            ${this.pledgeStatusButton(pledgePledged, pledgePaid, pledgeRemaining)}
            <div class="stat-value">${money(pledgeRemaining)}</div>
            <div class="stat-sub">Balance remaining &middot; Pledged ${money(pledgePledged)} &middot; Removed ${money(pledgePaid)}</div>
        </div>`;
        const finHead = `<div class="giving-insights-head${isMobile ? ' mobile-fin-summary-head' : ''}"><span style="font-family: var(--font-header); font-weight:700; color:var(--text-primary);">Financial Summary</span></div>`;
        const finCards = [
            card('Total Contributions', money(total)),
            card('Contributions Filed', String(tx.length)),
            ...byFund.map(f => f.fund === 'Pledge' ? pledgeCard : card(f.fund, money(f.amount)))
        ];
        el.innerHTML = finHead + (isMobile ? `<div class="mobile-fin-summary-grid">${finCards.join('')}</div>` : finCards.join(''));
    },
    // Printable, tax-ready annual giving statement for one member.
    viewGivingStatement(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;
        const year = new Date().getFullYear();
        const gifts = this.db.transactions
            .filter(t => t.memberId === memberId && new Date(t.date).getFullYear() === year)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        const total = gifts.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        const money = (n) => window.money(n);

        const byFund = {};
        gifts.forEach(t => { byFund[t.category] = (byFund[t.category] || 0) + (parseFloat(t.amount) || 0); });

        const modal = document.getElementById('receipt-modal');
        modal.innerHTML = `
            <div class="modal-card statement-card" role="dialog" aria-modal="true" aria-labelledby="statement-title">
                <div class="modal-header">
                    <h3 id="statement-title">${year} Annual Giving Statement</h3>
                    <button class="modal-close" aria-label="Close statement" onclick="ChurchApp.closeModal('receipt-modal')">x</button>
                </div>
                <div class="modal-body receipt-print-area scroll-y">
                    <div class="receipt-header">
                        <h2>${esc('Church Connect'.toUpperCase())}</h2>
                        <p>${esc(member.branchName)}</p>
                    </div>
                    <p style="margin-top:10px;"><strong>${esc(member.firstName)} ${esc(member.lastName)}</strong><br>
                    <span style="color:var(--text-secondary); font-size:0.8rem;">${esc(member.email)}</span></p>
                    <p style="font-size:0.75rem; color:var(--text-secondary); margin-top:8px;">
                        Tax-deductible contributions for the ${year} calendar year. No goods or services were provided in exchange for these gifts.
                    </p>
                    <hr style="border:0; border-top:1px dashed rgba(150,150,150,0.4); margin:14px 0;">
                    <table class="financial-table">
                        <thead><tr><th>Date</th><th>Fund</th><th>Method</th><th style="text-align:right;">Amount</th></tr></thead>
                        <tbody>
                            ${gifts.map(t => `<tr>
                                <td>${esc(t.date)}</td>
                                <td>${esc(t.campaignName || t.category)}</td>
                                <td>${esc(t.paymentMethod)}</td>
                                <td style="text-align:right;">${money(parseFloat(t.amount))}</td>
                            </tr>`).join('') || `<tr><td colspan="4" class="muted-italic" style="text-align:center;">No ${year} contributions on record.</td></tr>`}
                        </tbody>
                    </table>
                    <div class="statement-by-fund">
                        ${Object.keys(byFund).map(f => `<span class="statement-fund-pill">${esc(f)}: ${money(byFund[f])}</span>`).join('')}
                    </div>
                    <div class="receipt-row total-row" style="margin-top:14px;">
                        <span style="font-size:1.05rem;">TOTAL ${year} CONTRIBUTIONS</span>
                        <strong style="color:#10b981; font-size:1.35rem;">${money(total)}</strong>
                    </div>
                    <p style="font-size:0.7rem; color:var(--text-secondary); margin-top:14px;">${esc('Church Connect')} is a registered place of worship. Retain this statement for your records.</p>
                </div>
                <div style="display:flex; gap:8px; margin-top:15px; justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="ChurchApp.downloadStatementPdf('${esc(member.id)}')">Download PDF</button>
                    <button class="btn btn-secondary" onclick="window.print()">Print / Save PDF</button>
                    <button class="btn btn-primary-gradient" onclick="ChurchApp.closeModal('receipt-modal')">Close</button>
                </div>
            </div>
        `;
        this.openModal('receipt-modal');
    },

    // Download a real PDF file of the giving statement (dependency-free,
    // generated entirely in the browser so it works offline too).
    downloadStatementPdf(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;
        const year = new Date().getFullYear();
        const gifts = this.db.transactions
            .filter(t => t.memberId === memberId && new Date(t.date).getFullYear() === year)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        const total = gifts.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
        const byFund = {};
        gifts.forEach(t => { byFund[t.category] = (byFund[t.category] || 0) + (parseFloat(t.amount) || 0); });

        const bytes = this.buildStatementPdf({ member, year, gifts, total, byFund });
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : '';
        if (!url) { window.print(); return; }
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Giving-Statement-' + (member.lastName || member.id) + '-' + year + '.pdf';
        document.body.appendChild(link);
        if (link.click) link.click();
        if (document.body.removeChild) document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    // Build a standalone A4 PDF for the giving statement. Pure ASCII output,
    // Helvetica base-14 fonts - no external libraries or network needed.
    buildStatementPdf({ member, year, gifts, total, byFund }) {
        const PAGE_W = 595.28;
        const PAGE_H = 841.89;
        const MARGIN = 50;
        const BOTTOM = 60;
        let y = 800;

        const escPdf = (value) => String(value)
            .replace(/[^\x20-\x7E]/g, '?')      // ASCII only, like the rest of the app
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');

        const fmtKsh = (n) => {
            const amount = Number(n) || 0;
            const negative = amount < 0;
            const abs = Math.abs(amount);
            const decimals = Number.isInteger(abs) ? 0 : 2;
            const digits = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
            return 'Ksh ' + (negative ? '-' : '') + digits;
        };

        const pages = [[]];
        const lineHeight = 15;
        const emit = (text, x, font, size, align) => {
            if (y < BOTTOM) { pages.push([]); y = 800; }
            pages[pages.length - 1].push({ text: escPdf(text), x, y, font, size, align: align || 'left' });
        };
        const row = (cells) => {
            if (y < BOTTOM) { pages.push([]); y = 800; }
            const page = pages[pages.length - 1];
            cells.forEach((c) => page.push({
                text: escPdf(c.text), x: c.x, y,
                font: c.font || '/F2', size: c.size || 10, align: c.align || 'left'
            }));
            y -= lineHeight;
        };
        const rule = () => {
            if (y < BOTTOM) { pages.push([]); y = 800; }
            pages[pages.length - 1].push({ rule: [MARGIN, y + 4, PAGE_W - MARGIN] });
        };

        const col = { date: MARGIN, fund: 125, method: 280, amount: PAGE_W - MARGIN };
        const brand = 'Church Connect';

        // Header block
        emit(String(brand).toUpperCase(), MARGIN, '/F1', 16);
        y -= 20;
        emit(member.branchName || '', MARGIN, '/F2', 10);
        emit('ANNUAL GIVING STATEMENT - ' + year, col.amount, '/F1', 12, 'right');
        y -= 15;
        emit('Prepared on ' + new Date().toISOString().split('T')[0], MARGIN, '/F2', 9);
        y -= 14;
        emit(member.firstName + ' ' + member.lastName, MARGIN, '/F1', 11);
        y -= 15;
        emit(member.email || '', MARGIN, '/F2', 9);
        y -= 13;
        emit('Tax-deductible contributions for the ' + year + ' calendar year. No goods or services were provided in exchange for these gifts.', MARGIN, '/F2', 8);
        y -= 12;
        rule();
        y -= 12;

        // Column headings
        row([{ text: 'Date', x: col.date, font: '/F1' },
             { text: 'Fund', x: col.fund, font: '/F1' },
             { text: 'Method', x: col.method, font: '/F1' },
             { text: 'Amount', x: col.amount, font: '/F1', align: 'right' }]);

        if (!gifts.length) {
            row([{ text: 'No ' + year + ' contributions on record.', x: col.date, font: '/F2' }]);
        } else {
            gifts.forEach((g) => row([
                { text: g.date, x: col.date },
                { text: g.category || '-', x: col.fund },
                { text: g.paymentMethod || '-', x: col.method },
                { text: fmtKsh(g.amount), x: col.amount, align: 'right' }
            ]));
        }
        y -= 4;
        rule();
        y -= 8;

        // Breakdown by fund
        Object.keys(byFund).forEach((f) => {
            row([{ text: f + ': ' + fmtKsh(byFund[f]), x: col.fund, font: '/F2' }]);
        });

        // Total row
        y -= 2;
        row([{ text: 'TOTAL ' + year + ' CONTRIBUTIONS', x: col.date, font: '/F1' },
             { text: fmtKsh(total), x: col.amount, font: '/F1', align: 'right' }]);

        y -= 8;
        emit(brand + ' is a registered place of worship. Retain this statement for your records.', MARGIN, '/F2', 8);

        // Serialize the PDF objects and cross-reference table.
        const parts = [null];
        parts[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        const pageRefs = pages.map((_, i) => (3 + i) + ' 0 R').join(' ');
        parts[2] = '<< /Type /Pages /Kids [' + pageRefs + '] /Count ' + pages.length + ' >>';

        let next = 3;
        const pageNums = pages.map(() => next++);
        const fontBoldNum = next++;
        const fontRegNum = next++;
        const streamNums = pages.map(() => next++);

        pages.forEach((ops, i) => {
            parts[pageNums[i]] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] '
                + '/Resources << /Font << /F1 ' + fontBoldNum + ' 0 R /F2 ' + fontRegNum + ' 0 R >> >> '
                + '/Contents ' + streamNums[i] + ' 0 R >>';
        });
        parts[fontBoldNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
        parts[fontRegNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

        pages.forEach((ops, i) => {
            const stream = ops.map((op) => {
                if (op.rule) {
                    return op.rule[0] + ' ' + op.rule[1] + ' m ' + op.rule[2] + ' ' + op.rule[1] + ' l S';
                }
                const width = helveticaWidth(op.text, op.size, op.font === '/F1');
                const x = op.align === 'right' ? op.x - width
                    : op.align === 'center' ? op.x - width / 2
                    : op.x;
                return 'BT ' + op.font + ' ' + op.size + ' Tf 1 0 0 1 ' + x.toFixed(2) + ' ' + op.y.toFixed(2) + ' Tm (' + op.text + ') Tj ET';
            }).join('\n');
            parts[streamNums[i]] = '<< /Length ' + latin1ByteLength(stream) + ' >>\nstream\n' + stream + '\nendstream';
        });

        let pdf = '%PDF-1.4\n';
        const offsets = [];
        for (let i = 1; i < parts.length; i++) {
            offsets[i] = latin1ByteLength(pdf);
            pdf += i + ' 0 obj\n' + parts[i] + '\nendobj\n';
        }
        const xrefStart = latin1ByteLength(pdf);
        pdf += 'xref\n0 ' + parts.length + '\n';
        pdf += '0000000000 65535 f \n';
        for (let i = 1; i < parts.length; i++) {
            pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
        }
        pdf += 'trailer\n<< /Size ' + parts.length + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n';
        return latin1ToBytes(pdf);
    },

    // Download the member profile as a real PDF (dependency-free, browser-side).
    downloadMemberProfile(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;
        const donations = this.db.transactions.filter(t => t.memberId === memberId);
        const total = donations.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        const bytes = this.buildProfilePdf({ member, familyMembers: this.effectiveFamilyMembers(member), donations, total });
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : '';
        if (!url) { window.print(); return; }
       const link = document.createElement('a');
       link.href = url;
       link.download = 'Member-Profile-' + (member.lastName || member.id) + '-' + new Date().toISOString().split('T')[0] + '.pdf';
       document.body.appendChild(link);
        link.click();
        // Defer cleanup: removing the link or revoking the blob URL
        // synchronously can silently cancel the download in some browsers.
        setTimeout(() => {
            if (document.body.contains(link)) document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 1500);
   },

   printMemberProfile(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;
        // Ensure the freshest profile is on screen before the browser prints.
        this.viewMemberDetails(member.id);
        setTimeout(() => window.print(), 150);
    },

    // Standalone A4 PDF for a member profile. Pure ASCII, base-14 fonts.
    buildProfilePdf({ member, familyMembers, donations, total }) {
        const PAGE_W = 595.28;
        const PAGE_H = 841.89;
        const MARGIN = 50;
        const BOTTOM = 60;
        let y = 800;

        const escPdf = (value) => String(value == null ? '' : value)
            .replace(/[^\x20-\x7E]/g, '?')
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
        const fmtKsh = (n) => {
            const amount = Number(n) || 0;
            const digits = (Math.abs(amount)).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Math.abs(amount)) ? 0 : 2, maximumFractionDigits: 2 });
            return 'Ksh ' + (amount < 0 ? '-' : '') + digits;
        };

        const pages = [[]];
        const lineHeight = 15;
        const emit = (text, x, font, size, align) => {
            if (y < BOTTOM) { pages.push([]); y = 800; }
            pages[pages.length - 1].push({ text: escPdf(text), x, y, font, size, align: align || 'left' });
        };
        const row = (cells) => {
            if (y < BOTTOM) { pages.push([]); y = 800; }
            const page = pages[pages.length - 1];
            cells.forEach((c) => page.push({
                text: escPdf(c.text), x: c.x, y,
                font: c.font || '/F2', size: c.size || 10, align: c.align || 'left'
            }));
            y -= lineHeight;
        };
        const rule = () => {
            if (y < BOTTOM) { pages.push([]); y = 800; }
            pages[pages.length - 1].push({ rule: [MARGIN, y + 4, PAGE_W - MARGIN] });
        };

        const col = { left: MARGIN, mid: 300, right: PAGE_W - MARGIN };
        const brand = 'Church Connect';
        const fullName = `${member.firstName || ''} ${member.lastName || ''}`.trim();
        const orDash = (value) => (value == null || value === '') ? '-' : String(value);

        emit(String(brand).toUpperCase(), col.left, '/F1', 16);
        emit('MEMBER PROFILE', col.right, '/F1', 12, 'right');
        y -= 20;
        emit((member.branchName || '') + '  |  Prepared on ' + new Date().toISOString().split('T')[0], col.left, '/F2', 9);
        y -= 14;
        rule();
        y -= 16;

        emit(fullName || '-', col.left, '/F1', 14);
        y -= 20;
        emit('Member ID: ' + (member.id || '-'), col.left, '/F2', 9);
        y -= 14;
        rule();
        y -= 16;

        const L1 = col.left, V1 = 150, L2 = 310, V2 = 410;
        const detailRow = (leftLabel, leftValue, rightLabel, rightValue) => row([
            { text: leftLabel, x: L1, font: '/F1', size: 9 },
            { text: leftValue, x: V1, font: '/F2', size: 9 },
            { text: rightLabel, x: L2, font: '/F1', size: 9 },
            { text: rightValue, x: V2, font: '/F2', size: 9 }
        ]);
        detailRow('Email', orDash(member.email), 'Phone', orDash(member.phone));
        detailRow('Branch', orDash(member.branchName || member.branchId), 'Engagement', member.engagement_score != null ? member.engagement_score + '%' : '-');
        detailRow('Role / Position', orDash(member.rolePosition), 'Marital Status', orDash(member.maritalStatus));
        detailRow('Age', member.age != null ? String(member.age) : '-', 'Family Unit', orDash(member.familyId));
        y -= 8;

        emit('Family Members', col.left, '/F1', 11);
        y -= 15;
        if (familyMembers && familyMembers.length) {
            familyMembers.forEach((fm) => row([
                { text: '- ' + fm.name + (fm.role ? ' (' + fm.role + ')' : ''), x: 60, font: '/F2' }
            ]));
        } else {
            row([{ text: '- None added yet.', x: 60, font: '/F2' }]);
        }
        y -= 4;

        emit('Spiritual Milestones', col.left, '/F1', 11);
        y -= 15;
        if (Array.isArray(member.spiritualMilestones) && member.spiritualMilestones.length) {
            member.spiritualMilestones.forEach((ms) => row([{ text: '- ' + ms, x: 60, font: '/F2' }]));
        } else {
            row([{ text: '- None logged.', x: 60, font: '/F2' }]);
        }
        y -= 4;

        emit('Giving Summary', col.left, '/F1', 11);
        y -= 15;
        row([{ text: 'Total contributions: ' + fmtKsh(total), x: col.left, font: '/F1' }]);
        y -= 4;
        if (donations && donations.length) {
            row([
                { text: 'Date', x: col.left, font: '/F1', size: 9 },
                { text: 'Fund', x: col.mid, font: '/F1', size: 9 },
                { text: 'Amount', x: col.right, font: '/F1', size: 9, align: 'right' }
            ]);
            donations.slice(0, 25).forEach((t) => row([
                { text: t.date || '-', x: col.left, size: 9 },
                { text: t.category || '-', x: col.mid, size: 9 },
                { text: fmtKsh(t.amount), x: col.right, size: 9, align: 'right' }
            ]));
            if (donations.length > 25) row([{ text: '... and ' + (donations.length - 25) + ' more contributions.', x: col.left, font: '/F2' }]);
        } else {
            row([{ text: 'No contributions on record.', x: col.left, font: '/F2' }]);
        }

        y -= 8;
        emit(brand + ' - member directory record. Retain for your records.', MARGIN, '/F2', 8);

        const parts = [null];
        parts[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        const pageRefs = pages.map((_, i) => (3 + i) + ' 0 R').join(' ');
        parts[2] = '<< /Type /Pages /Kids [' + pageRefs + '] /Count ' + pages.length + ' >>';
        let next = 3;
        const pageNums = pages.map(() => next++);
        const fontBoldNum = next++;
        const fontRegNum = next++;
        const streamNums = pages.map(() => next++);
        pages.forEach((ops, i) => {
            parts[pageNums[i]] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] '
                + '/Resources << /Font << /F1 ' + fontBoldNum + ' 0 R /F2 ' + fontRegNum + ' 0 R >> >> '
                + '/Contents ' + streamNums[i] + ' 0 R >>';
        });
        parts[fontBoldNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
        parts[fontRegNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
        pages.forEach((ops, i) => {
            const stream = ops.map((op) => {
                if (op.rule) {
                    return op.rule[0] + ' ' + op.rule[1] + ' m ' + op.rule[2] + ' ' + op.rule[1] + ' l S';
                }
                const width = helveticaWidth(op.text, op.size, op.font === '/F1');
                const x = op.align === 'right' ? op.x - width
                    : op.align === 'center' ? op.x - width / 2
                    : op.x;
                return 'BT ' + op.font + ' ' + op.size + ' Tf 1 0 0 1 ' + x.toFixed(2) + ' ' + op.y.toFixed(2) + ' Tm (' + op.text + ') Tj ET';
            }).join('\n');
            parts[streamNums[i]] = '<< /Length ' + latin1ByteLength(stream) + ' >>\nstream\n' + stream + '\nendstream';
        });
        let pdf = '%PDF-1.4\n';
        const offsets = [];
        for (let i = 1; i < parts.length; i++) {
            offsets[i] = latin1ByteLength(pdf);
            pdf += i + ' 0 obj\n' + parts[i] + '\nendobj\n';
        }
        const xrefStart = latin1ByteLength(pdf);
        pdf += 'xref\n0 ' + parts.length + '\n';
        pdf += '0000000000 65535 f \n';
        for (let i = 1; i < parts.length; i++) {
            pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
        }
        pdf += 'trailer\n<< /Size ' + parts.length + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n';
        return latin1ToBytes(pdf);
    },

    firstBranchId() {
        return (Array.isArray(this.db.branches) && this.db.branches.length) ? this.db.branches[0].id : 'b1';
    },

    handleRecordTransaction() {
        const memberSelect = document.getElementById('tx-member-select');
        const memberId = memberSelect.value;
        const categoryValue = document.getElementById('tx-category-select').value;
        const amount = parseFloat(document.getElementById('tx-amount-input').value);
        const method = document.getElementById('tx-method-select').value;
        const frequency = document.getElementById('tx-frequency-select') ? document.getElementById('tx-frequency-select').value : 'once';
        const date = document.getElementById('tx-date-input').value || new Date().toISOString().split('T')[0];

        if (isNaN(amount) || amount <= 0) { this.toast('Enter a valid contribution amount greater than Ksh 0.', 'error'); return; }

        // An "Allocation Target" of campaign:<id> means the gift is for a
        // specific dashboard project - carry its fund category and tag.
        const campaign = categoryValue.indexOf('campaign:') === 0
            ? (this.db.campaigns || []).find(c => c.id === categoryValue.slice('campaign:'.length)) || null
            : null;
        const category = campaign ? campaign.fundCategory : categoryValue;

        let memberName = 'Anonymous';
        // When "All Branches (Global)" is active there is no single campus to file
        // an anonymous gift under, so default to the HQ campus (b1).
        let branchId = (this.session.currentBranch === 'all' || this.session.currentBranch === 'global')
            ? this.firstBranchId() : this.session.currentBranch;
        if (campaign && memberId === 'anonymous' && (this.session.currentBranch === 'all' || this.session.currentBranch === 'global')) {
            branchId = campaign.branchId;
        }

        if (memberId !== 'anonymous') {
            const memberObj = this.db.members.find(m => m.id === memberId);
            if (memberObj) {
                memberName = `${memberObj.firstName} ${memberObj.lastName}`;
                branchId = memberObj.branchId;
                
                // A pledge payment reduces what the member still owes on the
                // pledge. Mirror the member app: a pledge can only be paid
                // down to its remaining balance, never beyond it.
                if (category === 'Pledge') {
                    const pledge = this.memberPledge(memberObj);
                    if (pledge.amount <= 0) {
                        this.toast('No pledge recorded for this member - set one up first.', 'error');
                        return;
                    }
                    if (amount > pledge.balance) {
                        this.toast('Amount exceeds the remaining pledge balance of ' + window.money(pledge.balance) + '.', 'error');
                        return;
                    }
                    memberObj.pledgePaid = (parseFloat(memberObj.pledgePaid) || 0) + amount;
                }

                // Boost engagement score for giving
                memberObj.engagement_score = Math.min(memberObj.engagement_score + 4, 100);
                this.syncMemberProfile(memberObj);
            }
        }

        const branchObj = this.db.branches.find(b => b.id === branchId);

        const newTx = {
            id: `t_${Date.now()}`,
            branchId,
            branchName: branchObj.name,
            memberId: memberId === 'anonymous' ? null : memberId,
            memberName,
            amount,
            category,
            campaignId: campaign ? campaign.id : null,
            campaignName: campaign ? campaign.name : null,
            date,
            paymentMethod: method,
            receiptNumber: `REC-2026-${Math.floor(Math.random() * 90000) + 10000}`,
            onBehalfOf: null
        };

        this.db.transactions.unshift(newTx);

        // Repeat weekly/monthly gifts schedule a recurring gift, exactly like
        // the member app Give tab.
        let recurringNote = '';
        if (frequency !== 'once') {
            this.db.recurringGifts = this.db.recurringGifts || [];
            const next = new Date();
            next.setDate(next.getDate() + (frequency === 'weekly' ? 7 : 30));
            this.db.recurringGifts.unshift({
                'id': 'rec_' + Date.now(),
                memberId: memberId === 'anonymous' ? null : memberId,
                memberName: memberName === 'Anonymous' ? 'Guest' : memberName,
                branchId,
                branchName: branchObj.name,
                amount,
                category,
                frequency,
                method,
                nextDate: next.toISOString().split('T')[0],
                active: true
            });
            recurringNote = ' Recurring ' + esc(frequency) + ' gift scheduled - next on ' + next.toISOString().split('T')[0] + '.';
        }
        this.saveDB();
        this.apiWrite(
            () => Church2API.recordTransaction({ memberId, amount, category, paymentMethod: method, date, memberName, branchId }),
            (srv) => { if (srv && srv.id) { newTx.id = srv.id; if (srv.receiptNumber) newTx.receiptNumber = srv.receiptNumber; } }
        );
        document.getElementById('record-tx-form').reset();
        
        // Reset defaults
        document.getElementById('tx-date-input').value = new Date().toISOString().split('T')[0];
        document.querySelectorAll('#tx-quick-chips .give-chip').forEach((c) => c.classList.remove('is-active'));
        this.refreshTxMpesaHint();

        this.toast(`Logged ${money(amount)} from ${memberName}. Receipt ${newTx.receiptNumber}.` + recurringNote);
        
        this.renderAll();
        this.refreshTxPledgePanel();
        // The button says "File Record and Generate Receipt" - actually show the
        // generated receipt so the admin can verify or print it immediately.
        this.viewReceipt(newTx.id);
    },

    viewReceipt(txId) {
        const tx = this.db.transactions.find(t => t.id === txId);
        if (!tx) return;

        const modal = document.getElementById('receipt-modal');
        modal.innerHTML = `
            <div class="modal-card receipt-card" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title">
                <div class="receipt-seal">
                    <span>Approved<br>HQ System</span>
                </div>
                <div class="modal-header">
                    <h3 id="receipt-modal-title">STEWARDSHIP RECEIPT</h3>
                    <button class="modal-close" aria-label="Close receipt" onclick="ChurchApp.closeModal('receipt-modal')">x</button>
                </div>
                <div class="modal-body receipt-print-area">
                    <div class="receipt-header">
                        <h2>${esc('Church Connect'.toUpperCase())}</h2>
                        <p>${esc(tx.branchName)}</p>
                        <p style="font-size: 0.75rem; color:var(--text-secondary);">Branch Code: ${esc((tx.branchId || '').toUpperCase())}</p>
                    </div>
                    <hr style="border: 0; border-top: 1px dashed var(--border-light); margin: 15px 0;">
                    <div class="receipt-row">
                        <span>Receipt Number:</span>
                        <strong>${esc(tx.receiptNumber)}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Date Filed:</span>
                        <strong>${esc(tx.date)}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Donation Contributor:</span>
                        <strong>${esc(tx.memberName || 'Anonymous Partner')}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Giving Allocation:</span>
                        <strong class="category-pill">${esc(tx.campaignName || tx.category)}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Payment Channel:</span>
                        <strong>${esc(tx.paymentMethod)}</strong>
                    </div>
                    <hr style="border: 0; border-top: 1px dashed var(--border-light); margin: 15px 0;">
                    <div class="receipt-row total-row">
                        <span style="font-size: 1.1rem;">TOTAL AMOUNT RECEIVED:</span>
                        <strong style="color: #10b981; font-size: 1.4rem;">${money(parseFloat(tx.amount))}</strong>
                    </div>
                    
                    <div class="simulated-barcode">
                        <div class="thick"></div>
                        <div class="thin"></div>
                        <div class="space"></div>
                        <div class="thick"></div>
                        <div class="thick"></div>
                        <div class="thin"></div>
                        <div class="space"></div>
                        <div class="thin"></div>
                        <div class="thick"></div>
                        <div class="thin"></div>
                        <div class="space"></div>
                        <div class="thick"></div>
                        <div class="thin"></div>
                    </div>

                    <div class="receipt-footer">
                        <p>Thank you for your generous stewardship.</p>
                        <p style="font-size:0.7rem; color:var(--text-secondary); margin-top:8px;">Signed electronically by the ${esc('Church Connect')} HQ admin system</p>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; margin-top: 15px; justify-content: flex-end;">
                    <button class="btn btn-secondary" onclick="window.print()">Print Receipt</button>
                    <button class="btn btn-primary-gradient" onclick="ChurchApp.closeModal('receipt-modal')">Close</button>
                </div>
            </div>
        `;
        this.openModal('receipt-modal');
    },

    exportFinancialCSV(transactions) {
        // Escape a CSV cell: double embedded quotes, and neutralize leading
        // =/+/-/@ so spreadsheet apps can't execute a value as a formula.
        const csvCell = (value) => {
            let s = String(value == null ? '' : value);
            if (/^[=+\-@]/.test(s)) s = "'" + s;
            return `"${s.replace(/"/g, '""')}"`;
        };

        const rows = [
            ['Receipt Number', 'Branch', 'Member Name', 'Category', 'Amount', 'Date', 'Payment Method'],
            ...transactions.map(t => [
                t.receiptNumber,
                t.branchName,
                t.memberName || 'Anonymous',
                t.category,
                parseFloat(t.amount).toFixed(2),
                t.date,
                t.paymentMethod
            ])
        ];

        const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');

        // Use a Blob URL so commas/quotes survive without URI-encoding quirks.
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `church2_financial_export_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    // 10. Panel: Ministry & Rota Rendering
    // Build (or return) the per-event roster. The roster holds the role name,
    // how many people the role needs, and the assigned member ids - so roles
    // that need more than one person are fully supported. Legacy events without
    // a roster are backfilled from rolesRequired + volunteersSignedUp.
    ensureEventRoster(event) {
        if (!event) return [];
        if (Array.isArray(event.roster) && event.roster.length) {
            event.roster.forEach((r) => {
                if (typeof r.slots !== 'number' || r.slots < 1) r.slots = 1;
                if (!Array.isArray(r.volunteers)) r.volunteers = [];
            });
            return event.roster;
        }
        const roles = Array.isArray(event.rolesRequired) ? event.rolesRequired : [];
        const signed = Array.isArray(event.volunteersSignedUp) ? event.volunteersSignedUp : [];
        const roster = roles.map((role) => ({ role, slots: 1, volunteers: [] }));
        // Place each signed-up volunteer into a role their stored skills match.
        // Multiple people can share the same role.
        signed.forEach((id) => {
            const member = this.db.members.find((m) => m.id === id);
            if (!member) return;
            const target = roster.find((r) =>
                !r.volunteers.includes(id) &&
                window.AIEngine && AIEngine.findMatchingStoredSkill(r.role, member.volunteer_skills)
            ) || roster.find((r) => !r.volunteers.includes(id));
            if (target) target.volunteers.push(id);
        });
        event.roster = roster;
        return roster;
    },

    // Persist the roster's flat parts (roles + assigned ids) locally and to the
    // backend so multi-person assignments survive a refresh.
    syncEventRota(event) {
        this.saveDB();
        this.apiWrite(() => Church2API.updateEventRota(event.id, {
            rolesRequired: Array.isArray(event.rolesRequired) ? event.rolesRequired : [],
            volunteersSignedUp: Array.isArray(event.volunteersSignedUp) ? event.volunteersSignedUp : [],
        }));
    },

    renderMinistry() {
        const selectEvent = document.getElementById('rota-event-select');

        // Scope events to the active campus so a campus admin only rosters their
        // own events (and can't assign another campus's members).
        const scope = this.session.currentBranch;
        const events = this.db.events.filter(e => !scope || scope === 'global' || e.branchId === scope);

        // Keep the selected event valid within the current scope.
        let activeEventId = this.session.selectedEventId;
        if (!events.some(e => e.id === activeEventId)) {
            activeEventId = events.length ? events[0].id : null;
            this.session.selectedEventId = activeEventId;
        }

        // Sync dropdown list
        selectEvent.innerHTML = '';
        events.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.text = `${e.title} (${e.date})`;
            selectEvent.appendChild(opt);
        });
        selectEvent.value = activeEventId;
        selectEvent.onchange = (e) => {
            this.session.selectedEventId = e.target.value;
            this.renderMinistry();
        };

        const rosterContainer = document.getElementById('rota-required-roles');
        const statsContainer = document.getElementById('rota-stats');
        const taskForm = document.getElementById('add-rota-task-form');
        if (taskForm) taskForm.onsubmit = (ev) => { ev.preventDefault(); this.addRotaTask(); };

        if (!activeEventId) {
            if (rosterContainer) rosterContainer.innerHTML = '<p class="muted-italic">No events scheduled for this campus yet.</p>';
            if (statsContainer) statsContainer.innerHTML = '';
            return;
        }

        // Render Rota details
        const event = this.db.events.find(e => e.id === activeEventId);
        if (!event) return;
        const roster = this.ensureEventRoster(event);

        // Volunteer-task dashboard: open slots, filled count, tasks still open.
        const totalSlots = roster.reduce((n, r) => n + r.slots, 0);
        const filled = roster.reduce((n, r) => n + (r.volunteers || []).length, 0);
        const openTasks = roster.filter(r => (r.volunteers || []).length < r.slots).length;
        if (statsContainer) {
            statsContainer.innerHTML = [
                { value: totalSlots, label: 'Volunteer slots needed' },
                { value: `${filled}/${totalSlots}`, label: 'Slots filled' },
                { value: openTasks, label: 'Tasks still needing people' }
            ].map(s => `
                <div class="card-glass summary-stat-card" style="padding:14px;">
                    <div class="stat-value" style="font-size:1.3rem;">${esc(s.value)}</div>
                    <div class="stat-sub">${esc(s.label)}</div>
                </div>`).join('');
        }

        rosterContainer.innerHTML = '';
        if (!roster.length) {
            rosterContainer.innerHTML = '<p class="muted-italic">No volunteer tasks yet. Add one above with the "+ Add Task" form.</p>';
            return;
        }

        roster.forEach(entry => {
            const assigned = (entry.volunteers || [])
                .map(id => this.db.members.find(m => m.id === id))
                .filter(Boolean);
            const remaining = Math.max(0, entry.slots - assigned.length);
            const status = remaining === 0 ? 'is-assigned' : 'is-unassigned';
            const statusLabel = remaining === 0 ? 'Fully staffed' : `${assigned.length} of ${entry.slots} assigned`;
            const safeRole = esc(entry.role).replace(/'/g, "\\'");

            // Count members in this campus database who volunteered for the role
            // (the exact pool the AI matcher draws from).
            const dbVolunteers = this.db.members.filter(m =>
                m.branchId === event.branchId &&
                window.AIEngine && AIEngine.findMatchingStoredSkill(entry.role, m.volunteer_skills)
            ).length;

            const div = document.createElement('div');
            div.className = 'rota-role-card';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:220px;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <strong class="rota-role-name" style="font-size: 0.95rem;">${esc(entry.role)}</strong>
                            <button class="remove-vol-btn" title="Delete this volunteer task" aria-label="Delete task ${esc(entry.role)}" onclick="ChurchApp.removeRotaRole('${esc(event.id)}', '${safeRole}')">&times;</button>
                        </div>
                        <p class="rota-status ${status}">Status: ${statusLabel}</p>
                        <p style="font-size:0.72rem; color:var(--text-secondary); margin-top:2px;">${dbVolunteers} member${dbVolunteers === 1 ? '' : 's'} in the database are skilled for this task</p>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-end;">
                        <label style="font-size:0.72rem; color:var(--text-secondary); display:flex; align-items:center; gap:6px;">
                            People needed:
                            <input type="number" min="1" max="50" value="${esc(entry.slots)}" style="width:64px; padding:4px 6px;" class="form-control" onchange="ChurchApp.updateRotaSlots('${esc(event.id)}', '${safeRole}', this.value)">
                        </label>
                        ${remaining > 0 ? `<button class="action-btn-sm" onclick="ChurchApp.showMatchAI('${esc(event.id)}', '${safeRole}')"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke:none;"><path d="M12 4l1.4 4 4 1.4-4 1.4L12 15l-1.4-4.2L6.6 9.4l4-1.4z"/></svg> AI Match (${remaining} more)</button>` : ''}
                    </div>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:10px;">
                    ${assigned.length ? assigned.map(v => `
                        <span class="volunteer-pill">
                            <span>&#10003; ${esc(v.firstName)} ${esc(v.lastName)}</span>
                            <button aria-label="Remove ${esc(v.firstName)} ${esc(v.lastName)} from ${esc(entry.role)}" onclick="ChurchApp.removeVolunteerFromRole('${esc(event.id)}', '${safeRole}', '${esc(v.id)}')" class="remove-vol-btn">x</button>
                        </span>`).join('') : '<span class="muted-italic" style="font-size:0.75rem;">No one assigned yet.</span>'}
                </div>`;
            rosterContainer.appendChild(div);
        });
    },

    addRotaTask() {
        const event = this.db.events.find(e => e.id === this.session.selectedEventId);
        if (!event) return;
        const nameInput = document.getElementById('rota-task-name');
        const slotsInput = document.getElementById('rota-task-slots');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) { this.toast('Enter a task / role name.', 'error'); return; }
        let slots = parseInt(slotsInput ? slotsInput.value : '1', 10);
        if (isNaN(slots) || slots < 1) slots = 1;
        const roster = this.ensureEventRoster(event);
        if (roster.some(r => r.role.toLowerCase() === name.toLowerCase())) {
            this.toast(`"${name}" already exists on this event's roster.`, 'error');
            return;
        }
        roster.push({ role: name, slots, volunteers: [] });
        event.rolesRequired = event.rolesRequired || [];
        if (!event.rolesRequired.includes(name)) event.rolesRequired.push(name);
        this.syncEventRota(event);
        if (nameInput) nameInput.value = '';
        if (slotsInput) slotsInput.value = '1';
        this.renderMinistry();
        this.toast(`Volunteer task "${name}" added (${slots} slot${slots === 1 ? '' : 's'}).`);
    },

    updateRotaSlots(eventId, role, value) {
        const event = this.db.events.find(e => e.id === eventId);
        if (!event) return;
        const entry = this.ensureEventRoster(event).find(r => r.role === role);
        if (!entry) return;
        let slots = parseInt(value, 10);
        if (isNaN(slots) || slots < 1) slots = 1;
        entry.slots = slots;
        this.syncEventRota(event);
        this.renderMinistry();
        this.toast(`"${role}" now needs ${slots} people.`);
    },

    removeRotaRole(eventId, role) {
        const event = this.db.events.find(e => e.id === eventId);
        if (!event) return;
        if (!confirm(`Delete the volunteer task "${role}"? Assigned people will be released from it.`)) return;
        const roster = this.ensureEventRoster(event);
        const entry = roster.find(r => r.role === role);
        const released = entry ? (entry.volunteers || []) : [];
        event.roster = roster.filter(r => r.role !== role);
        event.rolesRequired = (event.rolesRequired || []).filter(r => r !== role);
        event.volunteersSignedUp = (event.volunteersSignedUp || []).filter(id => !released.includes(id));
        this.syncEventRota(event);
        this.renderMinistry();
        this.toast(`Volunteer task "${role}" deleted.`, 'info');
    },

    removeVolunteerFromRole(eventId, role, volunteerId) {
        const event = this.db.events.find(e => e.id === eventId);
        if (!event) return;
        const roster = this.ensureEventRoster(event);
        const entry = roster.find(r => r.role === role);
        if (entry) entry.volunteers = (entry.volunteers || []).filter(id => id !== volunteerId);
        event.volunteersSignedUp = (event.volunteersSignedUp || []).filter(id => id !== volunteerId);
        this.syncEventRota(event);
        this.renderMinistry();
    },

    showMatchAI(eventId, role) {
        const event = this.db.events.find(e => e.id === eventId);
        // Only suggest volunteers from the event's own campus, and only members
        // whose own database record lists this skill as a volunteer skill.
        const pool = event ? this.db.members.filter(m => m.branchId === event.branchId) : this.db.members;
        const matches = window.AIEngine.matchVolunteersForEvent([role], pool);

        // Don't re-suggest people already assigned to this role.
        const roster = event ? this.ensureEventRoster(event) : [];
        const entry = roster.find(r => r.role === role);
        const already = entry ? (entry.volunteers || []) : [];
        const available = matches.filter(m => !already.includes(m.member.id));

        const modal = document.getElementById('ai-matcher-modal');
        modal.innerHTML = `
            <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="matcher-modal-title">
                <div class="modal-header">
                    <h3 id="matcher-modal-title">AI Volunteer Matching System</h3>
                    <button class="modal-close" aria-label="Close volunteer matcher" onclick="ChurchApp.closeModal('ai-matcher-modal')">x</button>
                </div>
                <div class="modal-body">
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">
                        Searching the <strong style="color:#60a5fa;">member database</strong> for people skilled for:
                        <strong style="color:#60a5fa;">${esc(role)}</strong>
                        &mdash; ${available.length} member${available.length === 1 ? '' : 's'} found in the ${esc(event.branchName || 'campus')} database.
                        Tick more than one if the task needs more than one person.
                    </p>
                    <div class="matches-list" id="matcher-matches">
                        ${available.map(m => `
                            <div class="match-item" style="padding:10px 12px;">
                                <label style="display:flex; gap:10px; align-items:flex-start; cursor:pointer; width:100%;">
                                    <input type="checkbox" class="matcher-check" value="${esc(m.member.id)}" style="margin-top:4px;">
                                    <div style="flex:1;">
                                        <strong>${esc(m.member.firstName)} ${esc(m.member.lastName)}</strong>
                                        <p style="font-size:0.75rem; color:var(--text-secondary);">Branch: ${esc(m.member.branchName)} | Engagement: ${esc(m.member.engagement_score)}%</p>
                                        <p style="font-size:0.75rem; color:#6ee7b7; margin-top:4px;">&#10003; Skilled for this role: ${(m.storedSkills || []).map(s => `<span class="skill-tag" style="color:#6ee7b7;">${esc(s)}</span>`).join(' ')}</p>
                                    </div>
                                    <span class="match-percentage">${esc(m.score)}% Match</span>
                                </label>
                            </div>
                        `).join('')}
                        ${available.length === 0 ? '<p class="muted-italic" style="text-align:center;">No unassigned members in the database have this skill. Add the skill to a member\'s profile in the Members tab, then try again.</p>' : ''}
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="ChurchApp.closeModal('ai-matcher-modal')">Cancel</button>
                    <button type="button" class="btn btn-primary-gradient" id="matcher-assign"${available.length ? '' : ' disabled'}>Assign Selected</button>
                </div>
            </div>
        `;
        document.getElementById('matcher-assign').onclick = () => {
            const checked = [...document.querySelectorAll('.matcher-check:checked')].map(cb => cb.value);
            if (!checked.length) { this.toast('Select at least one person to assign.', 'error'); return; }
            this.assignVolunteerRole(eventId, role, checked);
        };
        this.openModal('ai-matcher-modal');
    },

    assignVolunteerRole(eventId, role, volunteerIds) {
        const ids = Array.isArray(volunteerIds) ? volunteerIds : [volunteerIds].filter(Boolean);
        const event = this.db.events.find(e => e.id === eventId);
        if (!event || !ids.length) return;
        const roster = this.ensureEventRoster(event);
        let entry = roster.find(r => r.role === role);
        if (!entry) {
            entry = { role, slots: 1, volunteers: [] };
            roster.push(entry);
            event.rolesRequired = event.rolesRequired || [];
            if (!event.rolesRequired.includes(role)) event.rolesRequired.push(role);
        }
        ids.forEach(id => {
            if (!entry.volunteers.includes(id)) entry.volunteers.push(id);
            if (!event.volunteersSignedUp.includes(id)) event.volunteersSignedUp.push(id);
        });
        this.syncEventRota(event);
        this.closeModal('ai-matcher-modal');
        this.renderMinistry();
        this.toast(`${ids.length} person${ids.length === 1 ? '' : 's'} assigned to "${role}".`);
    },

    // 11. Panel: Communications Dashboard Rendering
    renderCommunications() {
        const listContainer = document.getElementById('prayer-requests-list');
        listContainer.innerHTML = '';

        // Prayer requests are sensitive pastoral content - scope them to the
        // active campus so a campus admin never sees another campus's requests.
        const scope = this.session.currentBranch;
        const scopeName = (scope && scope !== 'global')
            ? (this.db.branches.find(b => b.id === scope) || {}).name : null;
        const prayers = this.db.prayerRequests.filter(pr => !scopeName || pr.branchName === scopeName);

        prayers.forEach(pr => {
            const branchId = (this.db.branches.find(b => b.name === pr.branchName) || {}).id || this.firstBranchId();
            const card = document.createElement('div');
            card.className = 'prayer-request-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                    <div>
                        <strong class="prayer-member">${esc(pr.memberName)}</strong>
                        <span class="branch-pill badge-${esc(branchId)}" style="font-size: 0.7rem; margin-left: 8px;">${esc(pr.branchName)}</span>
                    </div>
                    <span class="category-pill prayer-category"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13.5l-7 7a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1-.5-1.9l1.4-5.6a2 2 0 0 1 1.5-1.5l5.6-1.4a2 2 0 0 1 1.9.5l6.2 6.2a2 2 0 0 1-.1 2.9z"/><circle cx="9" cy="9" r="1.3"/></svg> ${esc(pr.category)}</span>
                </div>
                <p class="prayer-text">"${esc(pr.text)}"</p>
                <div class="prayer-actions">
                    <span>Routed to: <strong>${esc(pr.route)}</strong></span>
                    <div>
                        <button class="action-btn-sm btn-approve" onclick="ChurchApp.approvePrayer('${esc(pr.id)}')">Approve</button>
                        <button class="action-btn-sm btn-dismiss" onclick="ChurchApp.deletePrayer('${esc(pr.id)}')">Dismiss</button>
                    </div>
                </div>
            `;
            listContainer.appendChild(card);
        });

        if (prayers.length === 0) {
            listContainer.innerHTML = `<div class="empty-state"><span>Inbox zero - no pending prayer requests.</span></div>`;
        }

        this.renderCareInbox();
        this.renderBroadcasts();
        this.renderSuggestedAnnouncements();
    },

    renderCareInbox() {
        const posts = document.getElementById('care-inbox-posts');
        if (!posts) return;
        const scope = this.session.currentBranch;
        const items = (this.db.careInbox || []).filter(m => !scope || scope === 'global' || m.branchId === scope);
        posts.innerHTML = items.map(m => `
            <div class="care-inbox-post">
                <div class="care-inbox-post-head">
                    <strong>${esc(m.title || 'Care Message')}</strong>
                    <span class="care-inbox-author">${esc(m.author || 'Church Care Team')}</span>
                </div>
                <p class="care-inbox-body">${esc(m.body)}</p>
                <div class="care-inbox-actions">
                    <span class="care-inbox-time">${m.sentAt ? new Date(m.sentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    <div>
                        <button class="action-btn-sm" onclick="ChurchApp.editCareMessage('${esc(m.id)}')">Edit</button>
                        <button class="action-btn-sm btn-dismiss" onclick="ChurchApp.deleteCareMessage('${esc(m.id)}')">Delete</button>
                    </div>
                </div>
            </div>
        `).join('') || '<p class="muted-italic" style="font-size:0.78rem;">No care messages posted yet. Write one above and post it to the member AI Care inbox.</p>';
    },

    postCareMessage() {
        const titleInput = document.getElementById('care-message-title');
        const bodyInput = document.getElementById('care-message-body');
        if (!bodyInput) return;
        const title = (titleInput ? titleInput.value : '').trim();
        const body = bodyInput.value.trim();
        if (!body) { this.toast('Write a care message first.', 'error'); return; }

        const editingId = this._editingCareMessageId;
        if (editingId) {
            const existing = (this.db.careInbox || []).find(m => m.id === editingId);
            if (existing) {
                existing.title = title;
                existing.body = body;
                this.saveDB();
                this.apiWrite(() => Church2API.updateCareMessage(existing.id, { title, body }));
            }
            this._editingCareMessageId = null;
        } else {
            const branchId = (this.session.currentBranch && this.session.currentBranch !== 'global') ? this.session.currentBranch : this.firstBranchId();
            const message = {
                id: `ci_${Date.now()}`,
                branchId,
                title,
                body,
                author: (this.session.currentUser && this.session.currentUser.name) || 'Church Care Team',
                sentAt: new Date().toISOString()
            };
            this.db.careInbox = this.db.careInbox || [];
            this.db.careInbox.unshift(message);
            this.saveDB();
            this.apiWrite(() => Church2API.postCareMessage({ title, body, branchId }), (srv) => { if (srv && srv.id) message.id = srv.id; });
        }

        if (titleInput) titleInput.value = '';
        bodyInput.value = '';
        const btn = document.getElementById('care-post-btn');
        if (btn) btn.textContent = 'Post to Members';
        const cancel = document.getElementById('care-cancel-btn');
        if (cancel) cancel.style.display = 'none';
        this.renderCareInbox();
        this.renderMobileChat();
        this.toast(editingId ? 'Care message updated.' : 'Care message posted to the member AI Care inbox.');
    },

    editCareMessage(id) {
        const message = (this.db.careInbox || []).find(m => m.id === id);
        if (!message) return;
        this._editingCareMessageId = id;
        const titleInput = document.getElementById('care-message-title');
        const bodyInput = document.getElementById('care-message-body');
        if (titleInput) titleInput.value = message.title || '';
        if (bodyInput) bodyInput.value = message.body || '';
        const btn = document.getElementById('care-post-btn');
        if (btn) btn.textContent = 'Save Changes';
        const cancel = document.getElementById('care-cancel-btn');
        if (cancel) cancel.style.display = '';
        if (bodyInput) bodyInput.focus();
    },

    cancelEditCareMessage() {
        this._editingCareMessageId = null;
        const titleInput = document.getElementById('care-message-title');
        const bodyInput = document.getElementById('care-message-body');
        if (titleInput) titleInput.value = '';
        if (bodyInput) bodyInput.value = '';
        const btn = document.getElementById('care-post-btn');
        if (btn) btn.textContent = 'Post to Members';
        const cancel = document.getElementById('care-cancel-btn');
        if (cancel) cancel.style.display = 'none';
    },

    deleteCareMessage(id) {
        if (!confirm('Delete this care message from the member inbox?')) return;
        this.db.careInbox = (this.db.careInbox || []).filter(m => m.id !== id);
        this.saveDB();
        this.apiWrite(() => Church2API.deleteCareMessage(id));
        if (this._editingCareMessageId === id) this.cancelEditCareMessage();
        this.renderCareInbox();
        this.renderMobileChat();
        this.toast('Care message deleted.', 'info');
    },

    renderBroadcasts() {
        const log = document.getElementById('broadcast-log');
        if (log) {
            const items = (this.db.announcements || []).filter(a => (a.status || 'published') !== 'pending');
            log.innerHTML = items.map(a => {
                const audience = a.audience === 'all' ? 'All Branches' : ((this.db.branches.find(b => b.id === a.audience) || {}).name || a.audience);
                const when = (a.sentAt || a.approvedAt || a.createdAt || a.suggestedAt) ? new Date(a.sentAt || a.approvedAt || a.createdAt || a.suggestedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                const status = a.status || 'published';
                const statusLabel = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Published';
                return `<div class="broadcast-item">
                    <div class="broadcast-item-head">
                        <strong>${esc(a.title)}</strong>
                        <span class="broadcast-when">${esc(when)}</span>
                        <span class="status-pill status-${status}">${esc(statusLabel)}</span>
                    </div>
                    <p class="broadcast-body">${esc(a.body)}</p>
                    <div class="broadcast-tags">
                        <span class="broadcast-audience-pill">${esc(audience)}</span>
                        ${(a.channels || []).map(c => `<span class="broadcast-channel-pill">${c === 'email' ? '' : c === 'sms' ? '' : ''} ${esc(c)}</span>`).join('')}
                        <span class="broadcast-reach">${status === 'rejected' ? `Rejected${a.rejectedReason ? ' - ' + esc(a.rejectedReason) : ''}${a.approvedBy ? ' by ' + esc(a.approvedBy) : ''}` : `Delivered to ${esc(a.recipients)} members`}</span>
                    </div>
                </div>`;
            }).join('') || '<p class="muted-italic" style="font-size:0.8rem;">No broadcasts sent yet.</p>';
        }

        const form = document.getElementById('broadcast-form');
        if (form) {
            form.onsubmit = (e) => {
                e.preventDefault();
                const title = document.getElementById('broadcast-title').value.trim();
                const body = document.getElementById('broadcast-body').value.trim();
                const audience = document.getElementById('broadcast-audience').value;
                const channels = [...document.querySelectorAll('.broadcast-channel:checked')].map(c => c.value);
                if (!title || !body) return;
                if (channels.length === 0) { this.toast('Pick at least one channel.', 'error'); return; }

                const recipients = audience === 'all'
                    ? this.db.members.length
                    : this.db.members.filter(m => m.branchId === audience).length;

                this.db.announcements = this.db.announcements || [];
                const announcement = {
                    id: `an_${Date.now()}`,
                    title, body, audience, channels, recipients,
                    sentAt: new Date().toISOString()
                };
                this.db.announcements.unshift(announcement);
                this.saveDB();
                this.apiWrite(() => Church2API.sendAnnouncement({ title, body, audience, channels }), (srv) => { if (srv && srv.id) announcement.id = srv.id; });
                form.reset();
                document.querySelectorAll('.broadcast-channel').forEach(c => { c.checked = (c.value !== 'push'); });
                this.renderBroadcasts();
                this.toast(`Broadcast sent to ${recipients} members via ${channels.join(', ')}.`);
            };
        }
    },

    renderSuggestedAnnouncements() {
        const pending = (this.db.announcements || []).filter(a => (a.status || 'published') === 'pending');
        const count = pending.length;
        const isAdmin = !!this.session.currentUser && ['hq_admin', 'branch_admin', 'platform_admin'].includes(this.session.currentUser.role);

        const countEl = document.getElementById('suggested-ann-count');
        if (countEl) countEl.textContent = count;
        const dashCount = document.getElementById('dash-suggested-count');
        if (dashCount) dashCount.textContent = count;

        const dashCard = document.getElementById('dash-suggested-card');
        if (dashCard) dashCard.style.display = count ? '' : 'none';

        const dashList = document.getElementById('dash-suggested-list');
        if (dashList) {
            dashList.innerHTML = pending.slice(0, 3).map(a => `
                <div class="suggestion-item suggestion-compact">
                    <div class="suggestion-head">
                        <strong class="suggestion-title">${esc(a.title)}</strong>
                        <span class="suggestion-meta">by ${esc(a.suggestedName || 'a member')}</span>
                    </div>
                    <p class="suggestion-body">${esc((a.body || '').slice(0, 90))}${(a.body || '').length > 90 ? '…' : ''}</p>
                </div>
            `).join('') || '<p class="muted-italic" style="font-size:0.75rem;">No suggestions waiting.</p>';
        }

        const log = document.getElementById('suggested-ann-log');
        if (log) {
            if (!isAdmin) { log.innerHTML = ''; return; }
            log.innerHTML = pending.length ? pending.map(a => {
                const stamp = a.suggestedAt || a.createdAt;
                const when = stamp ? new Date(stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                return `
                <div class="suggestion-item">
                    <div class="suggestion-head">
                        <strong class="suggestion-title">${esc(a.title)}</strong>
                        <span class="suggestion-meta">Suggested by ${esc(a.suggestedName || 'a member')}${when ? ' · ' + esc(when) : ''}</span>
                    </div>
                    <p class="suggestion-body">${esc(a.body)}</p>
                    <div class="suggestion-actions">
                        <button type="button" class="action-btn-sm btn-approve" onclick="ChurchApp.approveSuggestion('${esc(a.id)}')">Approve &amp; Announce</button>
                        <button type="button" class="action-btn-sm btn-dismiss" onclick="ChurchApp.rejectSuggestion('${esc(a.id)}')">Reject</button>
                    </div>
                </div>`;
            }).join('') : '<div class="empty-state"><span>All caught up - no announcements awaiting approval.</span></div>';
        }
    },

    approveSuggestion(id) {
        const ann = (this.db.announcements || []).find(a => a.id === id);
        if (!ann || (ann.status || 'published') !== 'pending') return;
        ann.status = 'approved';
        ann.approvedBy = (this.session.currentUser && this.session.currentUser.name) || 'Admin';
        ann.approvedAt = new Date().toISOString();
        const audience = ann.audience || 'all';
        ann.recipients = audience === 'all'
            ? (this.db.members || []).length
            : (this.db.members || []).filter(m => m.branchId === audience).length;
        this.saveDB();
        this.apiWrite(() => Church2API.approveAnnouncement(id), (srv) => { if (srv && srv.recipients != null) ann.recipients = srv.recipients; });
        this.renderCommunications();
        this.renderMobileAnnouncements();
        this.toast('Announcement approved and published to the congregation.');
    },

    rejectSuggestion(id) {
        const ann = (this.db.announcements || []).find(a => a.id === id);
        if (!ann || (ann.status || 'published') !== 'pending') return;
        const reason = (window.prompt('Reason for rejection (optional):', '') || '').trim();
        ann.status = 'rejected';
        ann.rejectedReason = reason;
        ann.approvedBy = (this.session.currentUser && this.session.currentUser.name) || 'Admin';
        ann.approvedAt = new Date().toISOString();
        this.saveDB();
        this.apiWrite(() => Church2API.rejectAnnouncement(id, reason));
        this.renderCommunications();
        this.renderMobileAnnouncements();
        this.toast('Announcement suggestion rejected.', 'info');
    },

    renderMobileAnnouncements() {
        const list = document.getElementById('mobile-announcements-list');
        if (!list) return;
        const items = (this.db.announcements || []).filter(a => ['approved', 'published'].includes(a.status || 'published')).slice(0, 5);
        list.innerHTML = items.length ? items.map(a => {
            const stamp = a.sentAt || a.approvedAt || a.createdAt || a.suggestedAt;
            const when = stamp ? new Date(stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
            return `
                <div class="mobile-announcement-item">
                    <strong>${esc(a.title)}</strong>
                    <span>${esc(a.body)}</span>
                    <span class="mobile-announcement-meta">${esc(when)}${a.approvedBy ? ' · Posted by ' + esc(a.approvedBy) : ''}</span>
                </div>`;
        }).join('') : '<p class="muted-italic" style="font-size:0.72rem;">No announcements yet.</p>';
    },

    submitAnnouncementSuggestion() {
        const titleInput = document.getElementById('suggest-ann-title');
        const bodyInput = document.getElementById('suggest-ann-body');
        if (!titleInput || !bodyInput) return;
        const title = titleInput.value.trim();
        const body = bodyInput.value.trim();
        if (!title || !body) { this.toast('Please enter both a title and the announcement text.', 'error'); return; }
        const user = this.session.currentUser || {};
        const announcement = {
            id: 'an_' + Date.now(),
            title,
            body,
            audience: 'all',
            channels: ['push'],
            recipients: 0,
            status: 'pending',
            suggestedBy: user.id || user.sub || '',
            suggestedName: user.name || 'Church Member',
            suggestedAt: new Date().toISOString()
        };
        this.db.announcements = this.db.announcements || [];
        this.db.announcements.unshift(announcement);
        this.saveDB();
        this.apiWrite(() => Church2API.suggestAnnouncement({ title, body }), (srv) => { if (srv && srv.id) announcement.id = srv.id; });
        titleInput.value = '';
        bodyInput.value = '';
        this.renderMobileAnnouncements();
        this.renderSuggestedAnnouncements();
        this.toast('Suggestion submitted - it will appear on the admin dashboard for approval.');
    },

    approvePrayer(prId) {
        this.db.prayerRequests = this.db.prayerRequests.filter(p => p.id !== prId);
        this.saveDB();
        this.apiWrite(() => Church2API.dismissPrayer(prId));
        this.toast('Prayer request approved and routed to the prayer team.');
        this.renderCommunications();
    },

    deletePrayer(prId) {
        this.db.prayerRequests = this.db.prayerRequests.filter(p => p.id !== prId);
        this.saveDB();
        this.apiWrite(() => Church2API.dismissPrayer(prId));
        this.renderCommunications();
    },

    handleSermonRepurpose() {
        const title = document.getElementById('sermon-title-input').value.trim();
        const text = document.getElementById('sermon-notes-input').value.trim();

        if (!text) {
            this.toast('Please paste some sermon notes or transcript text first.', 'error');
            return;
        }

        const result = window.AIEngine.repurposeSermon(title, text);
        const resultsContainer = document.getElementById('ai-repurpose-results');
        
        resultsContainer.innerHTML = `
            <div class="repurposed-card animate-fade-in">
                <div class="ai-header-badge"><svg class="badge-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/></svg> AI REPURPOSED SERMON KIT</div>
                <h4 class="kit-title">${esc(result.title)}</h4>
                <hr class="kit-divider">

                <h5 class="kit-subhead">3-Day Devotional Study Guide</h5>
                <div class="kit-devotional md-body">
                    ${renderMarkdown(result.devotional.day1)}
                    ${renderMarkdown(result.devotional.day2)}
                    ${renderMarkdown(result.devotional.day3)}
                </div>

                <h5 class="kit-subhead">Social Media Highlights</h5>
                <ul class="kit-list">
                    ${result.socialQuotes.map(q => `<li>${mdInline(q)}</li>`).join('')}
                </ul>

                <h5 class="kit-subhead">Small Group Study Questions</h5>
                <ol class="kit-list">
                    ${result.discussionQuestions.map(q => `<li>${mdInline(q)}</li>`).join('')}
                </ol>
            </div>
        `;
    },

    // 12. Panel: Member Mobile App Preview Simulation
    renderMobilePreview() {
        const view = this.session.simulatedMobileView;
        
        // Setup Active Subview View
        const subviews = ['mobile-home', 'mobile-sermons', 'mobile-bible', 'mobile-give', 'mobile-projects', 'mobile-serve', 'mobile-chat', 'mobile-profile', 'mobile-history'];
        subviews.forEach(sv => {
            const el = document.getElementById(sv);
            if (el) {
                // 'flex', not 'block': .mobile-app-body is a flex column and a
                // block override collapses children that rely on flex sizing
                // (the chat transcript would shrink to its content).
                el.style.display = (sv === `mobile-${view}`) ? 'flex' : 'none';
            }
        });

        // Sync Mobile Navigation Active State
        const buttons = document.querySelectorAll('.mobile-tab-btn');
        buttons.forEach(btn => {
            if (btn.dataset.view === view) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Dynamic rendering based on views
        if (view === 'home') {
            this.renderMobileHome();
        } else if (view === 'sermons') {
            this.renderMobileSermons();
        } else if (view === 'bible') {
            this.renderMobileBible();
        } else if (view === 'give') {
            this.renderMobileGive();
        } else if (view === 'projects') {
            this.renderMobileProjects();
        } else if (view === 'serve') {
            this.renderMobileServe();
        } else if (view === 'chat') {
            this.renderMobileChat();
        } else if (view === 'profile') {
            this.renderMobileProfile();
        } else if (view === 'history') {
            this.renderMobileHistory();
        }
    },

    switchMobileView(viewName) {
        this.session.simulatedMobileView = viewName;
        this.renderMobilePreview();
    },

    // Church projects shown in the member app - category, progress + trend.
    renderMobileProjects() {
        const list = document.getElementById('mobile-projects-list');
        if (!list) return;
        const branchId = this.session.currentBranch;
        const inScope = (bId) => (!branchId || branchId === 'global') ? true : bId === branchId;
        const campaigns = (this.db.campaigns || []).filter(c => inScope(c.branchId) || (branchId === 'global'));
        const money = (n) => window.money(n, { decimals: 0 });
        list.innerHTML = campaigns.length ? campaigns.map((c) => {
            const m = this.campaignMetrics(c, inScope);
            const arrow = m.trend.dir === 'up' ? '&#9650;' : m.trend.dir === 'down' ? '&#9660;' : '&#8226;';
            const trendCls = m.trend.dir === 'up' ? 'trend-up' : m.trend.dir === 'down' ? 'trend-down' : 'trend-flat';
            const funded = m.pct >= 100 ? '<span class="campaign-funded">Fully Funded</span>' : '';
            return `<div class="mobile-project-card">
                <div class="mobile-project-top">
                    <strong>${esc(c.name)}</strong>
                    <span class="mobile-project-pct">${m.pct}%</span>
                </div>
                <div class="mobile-project-badges">${this.fundCategoryBadge(c.fundCategory, { pledged: m.goal, removed: m.raised, remaining: m.remaining })}${funded}</div>
                <div class="campaign-bar mobile-project-bar"><div class="campaign-bar-fill" style="width:${m.pct}%;"></div></div>
                ${this.campaignFiguresHtml(c, m, 'mobile-project-figures')}
                <div class="mobile-project-foot">
                    <span class="campaign-trend ${trendCls}">${arrow} ${esc(m.trend.label)}</span>
                </div>
            ${supportForm ? `<div class="mobile-project-support">
                <input type="number" id="proj-amount-${esc(c.id)}" class="form-control" min="1" step="1" placeholder="Amount (Ksh)" aria-label="Support amount">
                <select id="proj-method-${esc(c.id)}" class="select-custom" aria-label="Payment method">
                    <option>M-Pesa</option>
                    <option>Card</option>
                    <option>Bank Transfer</option>
                    <option>Cash</option>
                </select>
                <button type="button" class="mobile-rsvp-btn" onclick="ChurchApp.supportProject('${esc(c.id)}')">Support this project</button>
            </div>` : ''}
            </div>`;
        }).join('') : '<div class="mobile-project-empty">No church projects posted yet - check back soon.</div>';
    },

    // First name of the signed-in user, used for mobile simulator greetings.
    mobileGreetingName() {
        const u = this.session.currentUser;
        const full = (u && (u.name || u.fullName || '')) || '';
        return full.trim().split(/\s+/)[0] || '';
    },

    renderMobileHome() {
        // Time-aware greeting for the simulated phone header.
        const greetingEl = document.getElementById('mobile-greeting');
        if (greetingEl) {
            const hour = new Date().getHours();
            const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
            const name = this.mobileGreetingName();
            greetingEl.textContent = name ? `${part}, ${name}!` : `${part}!`;
        }

        // News bullet ticker - the super admin edits this in Settings.
        const tickerEl = document.getElementById('mobile-news-bullet');
        if (tickerEl) {
            const textEl = tickerEl.querySelector('.mobile-news-text');
            if (textEl) textEl.textContent = this.churchContactInfo().newsBullet || 'Welcome to our church family!';
        }

        const welcomeEl = document.getElementById('mobile-welcome');
        if (welcomeEl) {
            welcomeEl.textContent = 'Welcome to Church Connect';
        }

        const eventsContainer = document.getElementById('mobile-upcoming-events');
        eventsContainer.innerHTML = '';

        const branchName = (branchId) => {
            const b = (this.db.branches || []).find(x => x.id === branchId);
            return b ? b.name : '';
        };
        const fmtTime = (t) => {
            if (!t) return '';
            const parts = String(t).split(':').map(Number);
            const hh = parts[0] || 0;
            const mm = parts.length > 1 ? String(parts[1]).padStart(2, '0') : '00';
            const ampm = hh >= 12 ? 'PM' : 'AM';
            const h12 = hh % 12 || 12;
            return `${h12}:${mm} ${ampm}`;
        };
        // Rotating gradient chips for the date badges, echoing the reference
        // design's colourful JUL/11/SUN blocks.
        const badgeColors = [
            ['#6d4de0', '#8e5cf6'],
            ['#2563eb', '#4f8df7'],
            ['#0e9f8a', '#14b8a6'],
            ['#e2711d', '#f59e0b']
        ];

        this.db.events.forEach((e, idx) => {
            const div = document.createElement('div');
            div.className = 'mobile-event-card';
            const rsvped = (e.rsvpMemberIds || []).includes(this.simulatedMemberId());
            const d = new Date(`${e.date}T00:00:00`);
            const month = isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
            const day = isNaN(d.getTime()) ? '' : d.getDate();
            const weekday = isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
            const grad = badgeColors[idx % badgeColors.length];
            div.innerHTML = `
                <div class="mobile-event-badge" style="background:linear-gradient(160deg, ${grad[0]}, ${grad[1]});">
                    <span class="me-month">${esc(month)}</span>
                    <strong class="me-day">${esc(day)}</strong>
                    <span class="me-weekday">${esc(weekday)}</span>
                </div>
                <div class="mobile-event-info">
                    <strong class="mobile-event-title">${esc(e.title)}</strong>
                    <span class="mobile-event-loc">${esc(branchName(e.branchId))}</span>
                    <span class="mobile-event-going">${(e.rsvpMemberIds || []).length} going</span>
                    <div class="mobile-event-bottom">
                        <span class="mobile-event-time"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg> ${esc(fmtTime(e.time))}</span>
                        <button class="mobile-rsvp-btn${rsvped ? ' is-rsvped' : ''}" ${rsvped ? 'disabled' : ''} onclick="ChurchApp.handleMobileRSVP('${esc(e.id)}')">${rsvped ? 'Going' : 'RSVP'}</button>
                    </div>
                </div>
            `;
            eventsContainer.appendChild(div);
        });

        // Recent approved prayer requests (shown when "View all" is tapped).
        const prayerList = document.getElementById('mobile-prayer-list');
        if (prayerList) {
            const requests = (this.db.prayerRequests || []).slice(0, 3);
            prayerList.innerHTML = requests.length ? requests.map(p => `
                <div class="mobile-prayer-item">
                    <strong>${esc(p.memberName || 'Church Member')}</strong>
                    <span>${esc(p.text)}</span>
                </div>
            `).join('') : '';
        }

        this.renderMobileGroups();
        this.renderMobileFamily();
        this.renderMobileAnnouncements();
    },

    // Quick-action tiles on the member home: "Events" and "Groups" scroll to
    // their sections, "Give" and "Sermons" open the matching phone tab.
    mobileQuickAction(action) {
        if (action === 'give' || action === 'sermons') {
            this.switchMobileView(action);
            return;
        }
        if (this.session.simulatedMobileView !== 'home') this.switchMobileView('home');
        const targetId = action === 'events' ? 'mobile-events-head' : 'mobile-groups-head';
        requestAnimationFrame(() => {
            const el = document.getElementById(targetId);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    },

    toggleMobilePrayerList() {
        const list = document.getElementById('mobile-prayer-list');
        if (list) list.style.display = list.style.display === 'none' ? 'flex' : 'none';
    },

    // Simulated member profile card for the phone's Profile tab.
    renderMobileProfile() {
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        const user = this.session.currentUser;
        const firstName = (member && member.firstName) || (user && (user.name || '').trim().split(/\s+/)[0]) || 'Church';
        const lastName = (member && member.lastName) || (user && (user.name || '').trim().split(/\s+/).slice(1).join(' ')) || 'Member';
        const name = `${firstName} ${lastName}`.trim();

        const roleLabels = { hq_admin: 'Administrator', branch_admin: 'Branch Administrator', ministry_leader: 'Ministry Leader', member: 'Member' };
        const role = (member && member.rolePosition) || (user && roleLabels[user.role]) || 'Member';

        const branchId = (member && member.branchId) || (user && user.branchId);
        const branch = (member && member.branchName) || (branchId && (this.db.branches || []).find(b => b.id === branchId))?.name || 'Church Campus';
        const phone = (member && member.phone) || (user && user.phone) || 'Not provided';
        const email = (member && member.email) || (user && user.email) || 'Not provided';

        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        const avatar = document.getElementById('mobile-profile-avatar');
        if (avatar) avatar.textContent = (firstName[0] || '') + (lastName[0] || '');
        setText('mobile-profile-name', name);
        setText('mobile-profile-role', role);
        setText('mobile-profile-branch', branch);
        setText('mobile-profile-phone', phone);
        setText('mobile-profile-email', email);

        // My Pledge: what this individual promised, paid and still owes, plus
        // the means they used to pay.
        const pledgeEl = document.getElementById('mobile-pledge-section');
        if (pledgeEl && member) {
            const p = this.memberPledge(member);
            const payments = (this.db.transactions || []).filter(t => t.memberId === member.id && String(t.category || '').toLowerCase() === 'pledge').sort((a, b) => new Date(a.date) - new Date(b.date));
            pledgeEl.innerHTML = `
                <div class="mobile-pledge-card">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                        <h4 style="font-size:0.8rem; font-family:var(--font-header); color:var(--mob-text); margin:0;">My Pledge</h4>
                        ${p.amount > 0 ? this.pledgeStatusButton(p.amount, p.paid, p.balance, member.id) : ''}
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:8px;">
                        <div style="font-size:0.65rem; color:var(--mob-sub);"><span>Promised</span><br><strong style="font-size:0.85rem; color:var(--mob-text);">${window.money(p.amount)}</strong></div>
                        <div style="font-size:0.65rem; color:var(--mob-sub);"><span>Paid</span><br><strong style="font-size:0.85rem; color:var(--mob-text);">${window.money(p.paid)}</strong></div>
                        <div style="font-size:0.65rem; color:var(--mob-sub);"><span>Balance</span><br><strong style="font-size:0.85rem; color:var(--mmc-gold);">${window.money(p.balance)}</strong></div>
                    </div>
                    ${payments.length ? `<div style="font-size:0.68rem; color:var(--mob-sub); margin-top:8px;">Paid via: ${payments.map(pt => `<span class="category-pill category-pledge" style="margin-right:4px;">${esc(pt.paymentMethod || 'Cash')}</span>`).join('')}</div>` : (p.amount > 0 ? '<div style="font-size:0.68rem; color:var(--mob-sub); margin-top:8px;">No pledge payments yet.</div>' : '<div style="font-size:0.68rem; color:var(--mob-sub); margin-top:8px;">No pledge recorded.</div>')}
                </div>`;
        }
    },

    handleMobileRSVP(eventId) {
        const event = (this.db.events || []).find(e => e.id === eventId);
        if (!event) return;
        const memberId = this.simulatedMemberId();
        event.rsvpMemberIds = event.rsvpMemberIds || [];
        const idx = event.rsvpMemberIds.indexOf(memberId);
        const going = idx < 0;
        if (going) {
            event.rsvpMemberIds.push(memberId);
        } else {
            event.rsvpMemberIds.splice(idx, 1);
        }
        // Keep the session list in sync for any code that still reads it.
        this.session.rsvpedEvents = this.session.rsvpedEvents || [];
        this.session.rsvpedEvents = this.session.rsvpedEvents.filter(x => x !== eventId);
        if (going) this.session.rsvpedEvents.push(eventId);
        this.saveDB();
        this.apiWrite(() => Church2API.rsvpEvent(event.id, memberId, going));
        this.toast(going ? `You're going to ${event.title}! See you there.` : `RSVP cancelled for ${event.title}.`, going ? undefined : 'info');
        this.renderMobileHome();
        // The web Groups tab shows who's going - refresh it if it is open.
        if (this.session.activeTab === 'admin_groups') this.renderGroups();
    },

    // Dashboard "Upcoming Events" card: show/hide the inline form for posting
    // a new event that then appears in the member app's Home tab.
    toggleAddEventForm() {
        const form = document.getElementById('dash-add-event-form');
        if (!form) return;
        if (form.style.display !== 'none') { form.style.display = 'none'; return; }
        const branchOpts = (this.db.branches || []).map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
        const today = new Date();
        const tomorrow = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
        form.innerHTML = `
            <div class="card-glass" style="padding:12px; border:1px solid rgba(124,92,252,0.35);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <strong style="font-size:0.85rem; font-family:var(--font-header); color:var(--text-primary);">Post an Upcoming Event</strong>
                    <button type="button" class="modal-close" aria-label="Close form" onclick="ChurchApp.toggleAddEventForm()">x</button>
                </div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="font-size:0.7rem; color:var(--text-secondary); display:block; margin-bottom:3px;">Event title</label>
                            <input type="text" id="dash-event-title" class="form-control" placeholder="e.g. Youth Praise Night" style="font-size:0.8rem;">
                        </div>
                        <div>
                            <label style="font-size:0.7rem; color:var(--text-secondary); display:block; margin-bottom:3px;">Branch</label>
                            <select id="dash-event-branch" class="select-custom" style="width:100%; font-size:0.8rem; padding:6px;">${branchOpts}</select>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="font-size:0.7rem; color:var(--text-secondary); display:block; margin-bottom:3px;">Date</label>
                            <input type="date" id="dash-event-date" class="form-control" value="${tomorrow}" style="font-size:0.8rem;">
                        </div>
                        <div>
                            <label style="font-size:0.7rem; color:var(--text-secondary); display:block; margin-bottom:3px;">Time</label>
                            <input type="time" id="dash-event-time" class="form-control" value="18:00" style="font-size:0.8rem;">
                        </div>
                    </div>
                    <div>
                        <label style="font-size:0.7rem; color:var(--text-secondary); display:block; margin-bottom:3px;">Description</label>
                        <textarea id="dash-event-description" class="form-control" rows="2" placeholder="What is this event about?" style="font-size:0.8rem; resize:vertical;"></textarea>
                    </div>
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ChurchApp.toggleAddEventForm()">Cancel</button>
                        <button type="button" class="btn btn-primary-gradient btn-sm" onclick="ChurchApp.submitAddEvent()">Post Event</button>
                    </div>
                </div>
            </div>`;
        form.style.display = 'block';
        const branchSel = document.getElementById('dash-event-branch');
        if (branchSel && this.session.currentBranch && this.session.currentBranch !== 'global') branchSel.value = this.session.currentBranch;
    },

    // Save the posted event locally (appears instantly) and push it to the
    // server so it survives a refresh. Members RSVP from the app Home tab.
    submitAddEvent() {
        const title = document.getElementById('dash-event-title').value.trim();
        const date = document.getElementById('dash-event-date').value;
        const time = document.getElementById('dash-event-time').value;
        const branchId = document.getElementById('dash-event-branch').value;
        const description = document.getElementById('dash-event-description').value.trim();
        if (!title) { this.toast('Enter an event title.', 'error'); return; }
        if (!date) { this.toast('Pick an event date.', 'error'); return; }
        const branchObj = this.db.branches.find(b => b.id === branchId);
        const event = {
            id: 'e_' + Date.now(),
            branchId,
            branchName: branchObj ? branchObj.name : branchId,
            title,
            description,
            date,
            time: time || null,
            rolesRequired: [],
            volunteersSignedUp: [],
            rsvpMemberIds: []
        };
        this.db.events = this.db.events || [];
        this.db.events.unshift(event);
        this.saveDB();
        this.apiWrite(() => Church2API.createEvent({ title, date, time: time || null, branchId, description }),
            (srv) => { if (srv && srv.id) event.id = srv.id; });
        this.toast('Event posted - members can now RSVP in the app.');
        this.toggleAddEventForm();
        this.renderDashboard();
        this.renderMobileHome();
    },

    // Simulated logged-in member for the mobile app (consistent with giving).
    simulatedMemberId() {
        return 'm1';
    },

    // "My Family" on the member home: add/edit family members by name.
    renderMobileFamily() {
        const el = document.getElementById('mobile-family-section');
        if (!el) return;
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        if (!member) { el.innerHTML = ''; return; }
        const familyMembers = this.effectiveFamilyMembers(member);
        el.innerHTML = `
            <div class="mobile-family-card">
                <div class="mobile-family-head">
                    <h4 style="font-size:0.8rem; font-family:var(--font-header); color:var(--mob-text);">My Family</h4>
                    <span style="font-size:0.6rem; color:var(--text-secondary);">Gifts are credited to ${esc(member.firstName)} ${esc(member.lastName)}</span>
                </div>
                <div id="mobile-family-list" style="display:flex; flex-direction:column; gap:6px;">
                    ${familyMembers.length ? familyMembers.map((fm, idx) => `
                        <div class="mobile-family-row">
                            <input type="text" class="form-control mobile-family-name" data-idx="${idx}" value="${esc(fm.name)}" placeholder="Family member name" aria-label="Family member name" style="font-size:0.72rem; padding:6px;">
                            <button type="button" class="mobile-rsvp-btn" onclick="ChurchApp.removeMobileFamilyMember(${idx})" style="font-size:0.7rem; padding:6px 10px;">Remove</button>
                        </div>`).join('') : '<p style="font-size:0.72rem; color:var(--text-secondary); margin:4px 0;">No family members yet - add one by name.</p>'}
                </div>
                <div style="display:flex; gap:6px; margin-top:8px;">
                    <input type="text" id="mobile-family-new-name" class="form-control" placeholder="Add family member by name" aria-label="New family member name" style="font-size:0.72rem; padding:6px; flex-grow:1;">
                    <button type="button" class="mobile-rsvp-btn" onclick="ChurchApp.addMobileFamilyMember()" style="font-size:0.72rem;">Add</button>
                </div>
            </div>
        `;
        // Saving a family member is as simple as editing their name.
        el.querySelectorAll('.mobile-family-name').forEach((inp) => {
            inp.addEventListener('change', () => {
                const idx = Number(inp.dataset.idx);
                const list = this.effectiveFamilyMembers(member);
                if (!list[idx]) return;
                const name = inp.value.trim();
                if (!name) return;
                list[idx].name = name;
                member.familyMembers = list;
                this.saveDB();
                this.syncMemberProfile(member);
                this.toast(`Family member updated to ${name}.`);
            });
        });
    },

    addMobileFamilyMember() {
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        if (!member) return;
        const input = document.getElementById('mobile-family-new-name');
        const name = input ? input.value.trim() : '';
        if (!name) { this.toast('Enter a family member name first.', 'error'); return; }
        member.familyMembers = this.effectiveFamilyMembers(member);
        if (member.familyMembers.some((fm) => fm.name.toLowerCase() === name.toLowerCase())) {
            this.toast(`${name} is already in your family.`, 'info');
            return;
        }
        member.familyMembers.push({ name, role: '' });
        this.saveDB();
        this.syncMemberProfile(member);
        this.renderMobileFamily();
        this.toast(`Added ${name} to your family.`);
    },

    removeMobileFamilyMember(index) {
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        if (!member) return;
        member.familyMembers = this.effectiveFamilyMembers(member);
        const removed = member.familyMembers.splice(index, 1)[0];
        this.saveDB();
        this.syncMemberProfile(member);
        this.renderMobileFamily();
        if (removed) this.toast(`Removed ${removed.name} from your family.`);
    },

    renderMobileSermons() {
        const container = document.getElementById('mobile-sermon-list');
        if (!container) return;
        const playerContainer = document.getElementById('mobile-sermon-player-container');
        if (playerContainer) { playerContainer.style.display = 'none'; playerContainer.innerHTML = ''; }

        const isAdmin = ['hq_admin', 'branch_admin', 'platform_admin', 'ministry_leader'].includes(this.session.currentRole);
        const channel = this.churchContactInfo().youtubeChannel || '';
        const brand = window.MMC_BRAND || {};
        const churchName = (this.church && this.church.name) || brand.name || 'Church YouTube';

        container.innerHTML = `
            <div class="yt-channel-banner">
                <div class="yt-avatar">${esc(this._initials(churchName))}</div>
                <div class="yt-channel-meta">
                    <strong class="yt-channel-name">${esc(churchName)}</strong>
                    <span class="yt-channel-sub">Church YouTube Channel${channel ? ' &middot; latest services' : ''}</span>
                </div>
                <div class="yt-channel-actions" id="yt-channel-actions">
                    ${isAdmin ? `<button type="button" class="yt-link-btn" onclick="ChurchApp.promptYoutubeChannel()">Link</button>` : ''}
                </div>
            </div>
            <div class="yt-feed-status" id="yt-feed-status">Loading latest services&hellip;</div>
            <div class="yt-feed" id="yt-feed-list"></div>
        `;

        if (!channel) {
            const status = document.getElementById('yt-feed-status');
            if (status) status.innerHTML = isAdmin
                ? 'No church YouTube channel linked yet. Tap "Link" to add one - every service will appear here.'
                : 'No church YouTube channel linked yet.';
            this._renderLocalSermonFallback(document.getElementById('yt-feed-list'));
            return;
        }

        this._loadYoutubeFeed(channel).then((feed) => {
            const status = document.getElementById('yt-feed-status');
            const list = document.getElementById('yt-feed-list');
            if (!status || !list) return;
            if (!feed || !feed.videos || !feed.videos.length) throw new Error('empty feed');
            status.style.display = 'none';
            list.innerHTML = feed.videos.map((v) => this._ytVideoCard(v)).join('');
            list.querySelectorAll('.yt-video-card').forEach((card) => {
                card.addEventListener('click', () => this.playYoutubeVideo(card.dataset.videoId, card.dataset.title));
            });
            const actions = document.getElementById('yt-channel-actions');
            if (actions && feed.channel && feed.channel.id) {
                const watchBtn = document.createElement('button');
                watchBtn.type = 'button';
                watchBtn.className = 'yt-channel-watch-btn';
                watchBtn.innerHTML = '&#9654; Watch channel';
                watchBtn.onclick = () => this.playYoutubeChannel(feed.channel.id);
                actions.insertBefore(watchBtn, actions.firstChild);
            }
        }).catch(() => {
            const status = document.getElementById('yt-feed-status');
            if (status) status.innerHTML = 'Could not load the live feed right now - showing saved sermons.';
            this._renderLocalSermonFallback(document.getElementById('yt-feed-list'));
        });
    },

    // Open a small prompt so the church (admin) can link its YouTube channel.
    // Works in demo mode (localStorage override) and live mode (church record).
    promptYoutubeChannel() {
        const current = this.churchContactInfo().youtubeChannel || '';
        const url = window.prompt('Paste the church YouTube channel link (e.g. https://youtube.com/@YourChurch):', current);
        if (url === null) return;
        const trimmed = String(url).trim();
        if (!trimmed) return;
        if (!/youtube\.com|youtu\.be|^@/.test(trimmed)) {
            this.toast('That does not look like a YouTube channel link.', 'error');
            return;
        }
        try { localStorage.setItem('church2_youtube_channel', trimmed); } catch (e) { /* private mode */ }
        const church = this.church || (Array.isArray(this.db.churches) && this.db.churches[0]);
        if (church) church.youtubeChannel = trimmed;
        if (this.apiEnabled() && church && window.Church2API) {
            this.apiWrite(() => Church2API.updateChurch(church.id, { youtubeChannel: trimmed }), () => {});
        }
        this.toast('Church YouTube channel linked.');
        this.renderMobileSermons();
    },

    async _loadYoutubeFeed(channelUrl) {
        const cache = this._ytFeedCache || {};
        if (cache.key === channelUrl && cache.at && (Date.now() - cache.at) < 10 * 60 * 1000) return cache.data;
        const res = await fetch('/api/youtube/feed?channel=' + encodeURIComponent(channelUrl));
        if (!res.ok) throw new Error('YouTube feed request failed');
        const data = await res.json();
        this._ytFeedCache = { key: channelUrl, at: Date.now(), data };
        return data;
    },

    _ytVideoCard(v) {
        const title = v.title || 'Untitled service';
        const channelName = (v.channelName || '').trim();
        const when = this._ytRelativeDate(v.published);
        const isNew = v.published && (Date.now() - new Date(v.published).getTime()) < 7 * 24 * 3600 * 1000;
        return `
            <div class="yt-video-card" data-video-id="${esc(v.videoId)}" data-title="${esc(title)}" role="button" tabindex="0" aria-label="Play ${esc(title)}">
                <div class="yt-thumb">
                    <img src="https://i.ytimg.com/vi/${esc(v.videoId)}/hqdefault.jpg" alt="" loading="lazy">
                    <span class="yt-play-overlay">&#9654;</span>
                    ${isNew ? '<span class="yt-new-badge">New</span>' : ''}
                </div>
                <div class="yt-video-meta">
                    <strong class="yt-video-title">${esc(title)}</strong>
                    <span class="yt-video-sub">${esc(channelName)}${when ? ' &middot; ' + esc(when) : ''}</span>
                </div>
            </div>`;
    },

    _ytRelativeDate(iso) {
        if (!iso) return '';
        const then = new Date(iso).getTime();
        if (!Number.isFinite(then)) return '';
        const sec = Math.floor((Date.now() - then) / 1000);
        if (sec < 60) return 'just now';
        const min = Math.floor(sec / 60); if (min < 60) return min + (min === 1 ? ' minute ago' : ' minutes ago');
        const hr = Math.floor(min / 60); if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
        const day = Math.floor(hr / 24); if (day < 7) return day + (day === 1 ? ' day ago' : ' days ago');
        const wk = Math.floor(day / 7); if (wk < 5) return wk + (wk === 1 ? ' week ago' : ' weeks ago');
        const mo = Math.floor(day / 30); if (mo < 12) return mo + (mo === 1 ? ' month ago' : ' months ago');
        const yr = Math.floor(day / 365);
        return yr + (yr === 1 ? ' year ago' : ' years ago');
    },

    _initials(name) {
        const words = String(name || 'C').trim().split(/\s+/).filter(Boolean);
        return (words.slice(0, 2).map((w) => (w[0] || '').toUpperCase()).join('')) || 'CC';
    },

    _renderLocalSermonFallback(list) {
        if (!list) return;
        const sermons = this.db.sermons || [];
        list.innerHTML = sermons.length ? sermons.map((s) => `
            <div class="mobile-sermon-card" onclick="ChurchApp.playMobileSermon('${esc(s.id)}')">
                <div class="mobile-sermon-thumb" style="background: linear-gradient(135deg, #1e1b4b, #311042); display:flex; justify-content:center; align-items:center;">
                    <span style="font-size:1.5rem; color:#fff;">&#9654;</span>
                </div>
                <div style="padding:10px;">
                    <strong style="font-size:0.85rem; color:var(--mob-text); display:block;">${esc(s.title)}</strong>
                    <span style="font-size:0.7rem; color:var(--mob-sub); display:block;">By ${esc(s.preacher)} | ${esc(s.duration)}</span>
                </div>
            </div>`).join('') : '<div class="yt-feed-status">No services yet.</div>';
    },

    playMobileSermon(sermonId) {
        const sermon = this.db.sermons.find(s => s.id === sermonId);
        if (!sermon) return;

        const playerContainer = document.getElementById('mobile-sermon-player-container');
        playerContainer.style.display = 'block';
        playerContainer.innerHTML = `
            <div class="mobile-sermon-player" style="background: var(--mob-card-solid); padding:10px; border-radius:8px; border:1px solid var(--mob-border); margin-bottom:12px;">
                <video src="${encodeURI(sermon.mediaUrl)}" controls autoplay style="width:100%; border-radius:6px; max-height:120px;"></video>
                <div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <div style="min-width:0;">
                        <strong style="font-size:0.85rem; color:var(--mob-text); display:block;">Playing: ${esc(sermon.title)}</strong>
                        <span style="font-size:0.7rem; color:var(--mob-sub);">Branch: ${esc(sermon.branchName)}</span>
                    </div>
                    <button type="button" class="yt-close-player" onclick="document.getElementById('mobile-sermon-player-container').style.display='none'">Close</button>
                </div>
            </div>
        `;
    },

    playYoutubeVideo(videoId, title) {
        const playerContainer = document.getElementById('mobile-sermon-player-container');
        if (!playerContainer) return;
        playerContainer.style.display = 'block';
        playerContainer.innerHTML = `
            <div class="yt-player-wrap">
                <iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0" title="${esc(title || 'Church service video')}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
            </div>
            <div class="yt-player-meta">
                <strong class="yt-video-title">${esc(title || 'Now playing')}</strong>
                <button type="button" class="yt-close-player" onclick="document.getElementById('mobile-sermon-player-container').style.display='none'">Close</button>
            </div>
        `;
        if (playerContainer.scrollIntoView) playerContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    // Browse and watch every upload from the linked church channel inside the
    // simulator - the uploads playlist player never leaves the app.
    playYoutubeChannel(channelId) {
        const playerContainer = document.getElementById('mobile-sermon-player-container');
        if (!playerContainer) return;
        const list = 'UU' + String(channelId || '').replace(/^UC/, '');
        playerContainer.style.display = 'block';
        playerContainer.innerHTML = `
            <div class="yt-player-wrap">
                <iframe src="https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}&rel=0" title="Church YouTube channel - all services" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
            </div>
            <div class="yt-player-meta">
                <strong class="yt-video-title">Church YouTube - all services</strong>
                <button type="button" class="yt-close-player" onclick="document.getElementById('mobile-sermon-player-container').style.display='none'">Close</button>
            </div>
        `;
        if (playerContainer.scrollIntoView) playerContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    // Deterministic Verse of the Day - same verse for everyone on a given date.
    // Uses the real KJV text from js/kjv.json when available, otherwise falls
    // back to a short devotional selection.
    renderVerseOfDay() {
        const el = document.getElementById('verse-of-day');
        if (!el) return;
        const pool = [
            { ref: 'Lamentations 3:22-23', fallback: 'His mercies never come to an end; they are new every morning.' },
            { ref: 'Joshua 1:9', fallback: 'Be strong and courageous. Do not be frightened, for the Lord your God is with you wherever you go.' },
            { ref: 'Psalm 118:24', fallback: 'This is the day that the Lord has made; let us rejoice and be glad in it.' },
            { ref: 'Proverbs 3:5-6', fallback: 'Trust in the Lord with all your heart, and do not lean on your own understanding.' },
            { ref: 'Zephaniah 3:17', fallback: 'The Lord your God is in your midst, a mighty one who will save.' },
            { ref: '2 Corinthians 12:9', fallback: 'My grace is sufficient for you, for my power is made perfect in weakness.' },
            { ref: 'Psalm 46:1', fallback: 'God is our refuge and strength, a very present help in trouble.' }
        ];
        const now = new Date();
        const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
        const v = pool[dayOfYear % pool.length];
        const text = this.kjvChapterText(v.ref) || v.fallback;
        el.innerHTML = `
            <span class="votd-eyebrow"><svg class="badge-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/></svg> Verse of the Day</span>
            <p class="votd-text">"${esc(text)}"</p>
            <span class="votd-ref">- ${esc(v.ref)} (KJV)</span>`;
    },

    _todayStr() { return new Date().toISOString().split('T')[0]; },

    getReadingState() {
        this.db.readingState = this.db.readingState || {};
        if (!this.db.readingState.m1) {
            this.db.readingState.m1 = { streak: 0, lastReadDate: null, plans: {} };
        }
        return this.db.readingState.m1;
    },

    renderReadingPlans() {
        const state = this.getReadingState();
        const streakEl = document.getElementById('reading-streak');
        if (streakEl) {
            streakEl.innerHTML = state.streak > 0 ? `${state.streak}-day streak` : '';
        }

        const container = document.getElementById('reading-plans');
        if (!container) return;
        container.innerHTML = (this.db.readingPlans || []).map(plan => {
            const done = state.plans[plan.id] || [];
            const total = plan.days.length;
            const pct = Math.round((done.length / total) * 100);
            // "Today's reading" = first uncompleted day, else the last day.
            let todayIdx = plan.days.findIndex((_, i) => !done.includes(i));
            if (todayIdx === -1) todayIdx = total - 1;
            const day = plan.days[todayIdx];
            const complete = done.includes(todayIdx);
            const finished = done.length === total;
            return `<div class="reading-plan-card">
                <div class="reading-plan-head">
                    <strong>${esc(plan.emoji)} ${esc(plan.title)}</strong>
                    <span class="reading-plan-progress">${done.length}/${total}</span>
                </div>
                <div class="reading-bar"><div class="reading-bar-fill" style="width:${pct}%;"></div></div>
                ${finished
                    ? `<p class="reading-done">Plan complete - well done!</p>`
                    : `<div class="reading-today">
                        <span class="reading-day-label">Day ${todayIdx + 1}: ${esc(day.ref)}</span>
                        <p class="reading-day-text">"${esc(this.kjvChapterText(day.ref) || day.text)}"</p>
                        <button class="reading-mark-btn${complete ? ' done' : ''}" onclick="ChurchApp.markReadingDay('${esc(plan.id)}', ${todayIdx})">${complete ? 'Completed' : 'Mark as read'}</button>
                    </div>`}
            </div>`;
        }).join('');
    },

    markReadingDay(planId, dayIdx) {
        const state = this.getReadingState();
        state.plans[planId] = state.plans[planId] || [];
        const arr = state.plans[planId];
        if (arr.includes(dayIdx)) return; // already read

        arr.push(dayIdx);

        // Update streak on the first reading of a new calendar day.
        const today = this._todayStr();
        if (state.lastReadDate !== today) {
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            state.streak = (state.lastReadDate === yesterday) ? state.streak + 1 : 1;
            state.lastReadDate = today;
        }

        this.saveDB();
        this.renderReadingPlans();
        this.toast('Reading complete. Keep the streak going!');
    },

    // ---- Bible data (full public-domain King James Version) ----------------
    // The complete KJV ships with the app as js/kjv.json in this shape:
    //   [{ "abbrev": "gn", "name": "Genesis", "chapters": [["In the beginning...", ...]] }, ...]
    // Every reader below falls back to a small mock verse list if the file is
    // missing, so the tab never breaks while the data file is being added.

    _kjvData: null,
    _kjvLoaded: false,
    _kjvPromise: null,
    _bibleSelectsReady: false,

    loadKJV() {
        if (this._kjvLoaded) return Promise.resolve(this._kjvData);
        if (this._kjvPromise) return this._kjvPromise;
        this._kjvPromise = fetch('js/kjv.json', { cache: 'no-store' })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                this._kjvData = (Array.isArray(data) && data.length) ? data : null;
                this._kjvLoaded = true;
                return this._kjvData;
            })
            .catch(() => {
                this._kjvData = null;
                this._kjvLoaded = true;
                return null;
            });
        return this._kjvPromise;
    },

    kjvBook(name) {
        if (!this._kjvData) return null;
        const norm = (n) => String(n).toLowerCase().replace(/s$/, '');
        return this._kjvData.find((b) => norm(b.name || b.book) === norm(name)) || null;
    },

    // Resolve "John 3:16" / "Proverbs 3:5-6" to an array of KJV verse strings.
    kjvPassage(ref) {
        const data = this._kjvData;
        if (!data) return null;
        const match = String(ref).trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
        if (!match) return null;
        const book = this.kjvBook(match[1]);
        if (!book) return null;
        const chapter = Number(match[2]);
        const from = Number(match[3]);
        const to = match[4] ? Number(match[4]) : from;
        const verses = book.chapters[chapter - 1];
        if (!Array.isArray(verses) || from < 1 || to > verses.length || from > to) return null;
        return verses.slice(from - 1, to);
    },

    kjvChapterText(ref) {
        const verses = this.kjvPassage(ref);
        return verses ? this.kjvClean(verses.join(' ')) : null;
    },

    // The KJV dataset marks italicised words as {word} and margin notes as {note: ...}.
    // kjvClean() keeps the italic words and drops margin notes for plain-text
    // lookups; kjvDisplay() renders inline words as italics in the reader.
    kjvClean(text) {
        return String(text)
            .replace(/\{([^}]*:[^}]*)\}/g, " ")
            .replace(/\{([^}]*)\}/g, "$1")
            .replace(/\s{2,}/g, " ")
            .trim();
    },

    kjvDisplay(text) {
        return esc(String(text))
            .replace(/\{([^}]*:[^}]*)\}/g, "")
            .replace(/\{([^}]*)\}/g, "<em>$1</em>")
            .replace(/\s{2,}/g, " ")
            .trim();
    },

    populateBibleChapters(bookName) {
        const book = this.kjvBook(bookName);
        const chapterSel = document.getElementById('mobile-bible-chapter');
        if (!book || !chapterSel) return;
        chapterSel.innerHTML = book.chapters.map((_, i) => `<option value="${i + 1}">Ch. ${i + 1}</option>`).join('');
        const saved = this.session.bibleChapter && Number(this.session.bibleChapter) >= 1 && Number(this.session.bibleChapter) <= book.chapters.length
            ? String(Number(this.session.bibleChapter))
            : '1';
        chapterSel.value = saved;
        this.session.bibleChapter = saved;
    },

    initBibleData() {
        if (this._bibleSelectsReady) return;
        this._bibleSelectsReady = true;
        this.loadKJV().then((data) => {
            if (!data) return;
            const bookSel = document.getElementById('mobile-bible-book');
            if (!bookSel) return;
            bookSel.innerHTML = data.map((b) => `<option value="${esc(b.name || b.book)}">${esc(b.name || b.book)}</option>`).join('');
            const savedBook = this.kjvBook(this.session.bibleBook) ? this.session.bibleBook : 'John';
            bookSel.value = savedBook;
            this.session.bibleBook = savedBook;
            this.populateBibleChapters(savedBook);
            this.renderVerseOfDay();
            this.renderReadingPlans();
            this._renderBibleChapter();
        });
    },

    renderMobileBible() {
        this.renderVerseOfDay();
        this.renderReadingPlans();
        this.initBibleData();
        this._renderBibleChapter();
    },

    // Convert a chapter number to Roman numerals for the book-style heading.
    romanNumeral(n) {
        const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
        let out = '';
        let num = Number(n) || 1;
        for (const [value, sym] of table) {
            while (num >= value) { out += sym; num -= value; }
        }
        return out;
    },

    _renderBibleChapter() {
        const verseContainer = document.getElementById('mobile-bible-verses');
        if (!verseContainer) return;
        const searchInput = document.getElementById('mobile-bible-search').value.trim().toLowerCase();
        const bookSel = document.getElementById('mobile-bible-book');
        const chapterSel = document.getElementById('mobile-bible-chapter');
        const selectedBook = bookSel.value;
        const selectedChapter = chapterSel.value;

        // Real KJV mode - full text from js/kjv.json.
        if (this._kjvData) {
            const book = this.kjvBook(selectedBook);
            const chapter = Number(selectedChapter) || 1;
            const verses = book && book.chapters[chapter - 1];
            if (!book || !Array.isArray(verses)) {
                verseContainer.innerHTML = `<div class="bible-page-empty">Select a book to begin reading.</div>`;
            } else if (searchInput) {
                // Search mode - matching verses shown as bookmark slips.
                let shown = 0;
                const hits = [];
                verses.forEach((text, i) => {
                    const refStr = book.name + ' ' + chapter + ':' + (i + 1);
                    if (!this.kjvClean(text).toLowerCase().includes(searchInput) && !refStr.toLowerCase().includes(searchInput)) return;
                    shown++;
                    hits.push(`<div class="bible-search-hit">
                        <span class="bible-search-ref">${esc(book.name)} ${chapter}:${i + 1}</span>
                        <p class="bible-search-text">"${this.kjvDisplay(text)}"</p>
                    </div>`);
                });
                verseContainer.innerHTML = shown ? hits.join('') : `<div class="bible-page-empty">No verses found matching query.</div>`;
            } else {
                // Reader mode - the chapter laid out like a printed book page
                // with a drop cap and superscript verse numbers.
                const firstClean = this.kjvClean(verses[0]);
                const cap = firstClean.charAt(0);
                const disp0 = this.kjvDisplay(verses[0]);
                const useCap = /^[A-Za-z]/.test(cap) && disp0.startsWith(cap);
                const capHtml = useCap ? `<span class="bible-drop-cap">${esc(cap)}</span>` : '';
                const rest0 = useCap ? disp0.slice(1) : disp0;
                const flow = verses.map((text, i) => {
                    const display = i === 0 ? (capHtml + rest0) : this.kjvDisplay(text);
                    return `<sup class="bible-verse-num">${i + 1}</sup>${display}`;
                }).join(' ');
                verseContainer.innerHTML = `
                    <div class="bible-page">
                        <div class="bible-page-ornament">&#10087;</div>
                        <h2 class="bible-chapter-book">${esc(book.name)}</h2>
                        <div class="bible-chapter-rule"><span>Chapter ${this.romanNumeral(chapter)}</span></div>
                        <p class="bible-verse-flow">${flow}</p>
                    </div>`;
            }
        } else {
            // Mock fallback - used only until js/kjv.json is available.
            const bibleData = [
                { ref: 'Malachi 3:10', text: 'Bring the full tithe into the storehouse, that there may be food in my house. And thereby put me to the test, says the Lord of hosts.' },
                { ref: 'Luke 12:34', text: 'For where your treasure is, there will your heart be also.' },
                { ref: 'Romans 12:1', text: 'I appeal to you therefore, brothers, by the mercies of God, to present your bodies as a living sacrifice, holy and acceptable to God.' },
                { ref: 'Proverbs 11:25', text: 'A generous soul will prosper; he who refreshes others will himself be refreshed.' },
                { ref: 'Hebrews 11:1', text: 'Now faith is the assurance of things hoped for, the conviction of things not seen.' },
                { ref: 'Ephesians 2:8', text: 'For by grace you have been saved through faith. And this is not your own doing; it is the gift of God.' },
                { ref: 'John 3:16', text: 'For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.' },
                { ref: 'Isaiah 40:31', text: 'But they who wait for the Lord shall renew their strength; they shall mount up with wings like eagles; they shall run and not be weary; they shall walk and not faint.' },
                { ref: 'Philippians 4:13', text: 'I can do all things through him who strengthens me.' },
                { ref: 'Hebrews 11:6', text: 'And without faith it is impossible to please him, for whoever would draw near to God must believe that he exists and that he rewards those who seek him.' },
                { ref: '1 Corinthians 13:13', text: 'So now faith, hope, and love abide, these three; but the greatest of these is love.' }
            ];

            const filtered = bibleData.filter((v) => {
                if (selectedBook !== 'all' && !v.ref.toLowerCase().includes(selectedBook.toLowerCase())) return false;
                if (selectedChapter !== 'all') {
                    const parts = v.ref.split(':');
                    if (parts.length > 0) {
                        const chapterPart = parts[0].trim().split(' ').pop();
                        if (chapterPart !== selectedChapter) return false;
                    }
                }
                if (searchInput && !v.ref.toLowerCase().includes(searchInput) && !v.text.toLowerCase().includes(searchInput)) return false;
                return true;
            });
            if (filtered.length === 0) {
                verseContainer.innerHTML = `<div class="bible-page-empty">No verses found matching query.</div>`;
            } else {
                const bookLabel = selectedBook === 'all' ? 'Selected Scriptures' : selectedBook;
                verseContainer.innerHTML = `<div class="bible-page">
                    <div class="bible-page-ornament">&#10087;</div>
                    <h2 class="bible-chapter-book">${esc(bookLabel)}</h2>
                    <div class="bible-chapter-rule"><span>Chapter ${selectedChapter === 'all' ? 'I' : esc(selectedChapter)}</span></div>
                    ${filtered.map((v) => `<p class="bible-verse-flow">${esc(v.text)} <span class="bible-search-ref" style="display:inline;">&#8212; ${esc(v.ref)}</span></p>`).join('')}
                </div>`;
            }
        }

        // Bind events
        document.getElementById('mobile-bible-search').oninput = () => this.renderMobileBible();
        document.getElementById('mobile-bible-book').onchange = (e) => {
            this.session.bibleBook = e.target.value;
            if (this._kjvData) this.populateBibleChapters(e.target.value);
            this.renderMobileBible();
        };
        document.getElementById('mobile-bible-chapter').onchange = (e) => {
            this.session.bibleChapter = e.target.value;
            this.renderMobileBible();
        };
        document.getElementById('mobile-bible-version').onchange = (e) => {
            this.session.bibleVersion = e.target.value;
            this.renderMobileBible();
        };
    },

    // Processing fee model used for the "cover the fees" option (card rate).
    /**
     * Transaction charge for the "cover the charge" option, in shillings.
     * M-Pesa paybill charges are borne by the payer under Safaricom's tariff,
     * so only card carries a percentage fee the church would otherwise absorb.
     */
    givingFee(amount, method) {
        const m = method || (window.MMC_BRAND && MMC_BRAND.giving.defaultMethod) || 'M-Pesa';
        if (m !== 'Card') return 0;
        const f = (window.MMC_BRAND && MMC_BRAND.giving.fees) || { cardPercent: 0.029, cardFlat: 30 };
        return Math.round(amount * f.cardPercent + f.cardFlat);
    },

    renderMobileGive() {
        // Generates dropdown options for giving branches
        const select = document.getElementById('mobile-giving-branch');
        const prevBranch = select.value || this.session.mobileGivingBranch || '';
        select.innerHTML = '';
        this.db.branches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.text = b.name;
            select.appendChild(opt);
        });
        if (prevBranch && [...select.options].some(o => o.value === prevBranch)) {
            select.value = prevBranch;
        }
        // The Financial Summary and ledger follow the branch the member picks.
        select.onchange = () => {
            this.session.mobileGivingBranch = select.value;
            this.renderMobileFinancialSummary(select.value);
            this.renderMobileLedger(select.value);
        };

        // "Giving On Behalf Of" - a family member's gift is credited to the
        // registered member, per the family-by-name model.
        const onBehalfSel = document.getElementById('mobile-giving-onbehalf');
        if (onBehalfSel) {
            const member = this.db.members.find(m => m.id === this.simulatedMemberId());
            const selfLabel = member ? `Myself (${member.firstName} ${member.lastName})` : 'Myself';
            // Editable combobox: pick a family member from the suggestions or
            // type any name. Blank (or "Myself") means the giver themself.
            const onBehalfList = document.getElementById('mobile-giving-onbehalf-list');
            if (onBehalfList) {
                onBehalfList.innerHTML = `<option value="${esc(selfLabel)}"></option>` +
                    (member ? this.effectiveFamilyMembers(member).map((fm) => `<option value="${esc(fm.name)}"></option>`).join('') : '');
            }
            onBehalfSel.placeholder = selfLabel;
        }

        const amountInput = document.getElementById('mobile-giving-amount');
        const feeLabel = document.getElementById('give-fees-amount');
        const coverFees = document.getElementById('mobile-giving-cover-fees');
        const methodSel = document.getElementById('mobile-giving-method');
        const feesRow = document.getElementById('cover-fees-row');
        const mpesaHint = document.getElementById('mpesa-hint');

        // Surface the paybill details from the brand config rather than
        // hardcoding them in markup.
        const brand = window.MMC_BRAND;
        if (brand) {
            const pb = document.getElementById('mpesa-paybill');
            const acc = document.getElementById('mpesa-account');
            if (pb) pb.textContent = brand.giving.mpesa.paybill;
            if (acc) acc.textContent = brand.giving.mpesa.accountName;
        }

        const updateFee = () => {
            const amt = parseFloat(amountInput.value) || 0;
            const method = methodSel ? methodSel.value : 'M-Pesa';
            const fee = this.givingFee(amt, method);
            if (feeLabel) feeLabel.textContent = money(fee);
            // Only card carries a charge the church would absorb, so the
            // cover-the-charge option is meaningless for the other rails.
            if (feesRow) feesRow.style.display = fee > 0 ? '' : 'none';
            if (fee === 0 && coverFees) coverFees.checked = false;
            if (mpesaHint) mpesaHint.style.display = method === 'M-Pesa' ? '' : 'none';
        };
        if (methodSel) methodSel.onchange = updateFee;

        // Quick-amount chips
        document.querySelectorAll('#mobile-give .give-chip').forEach(chip => {
            chip.onclick = () => {
                if (chip.dataset.amount === 'custom') {
                    amountInput.value = '';
                    amountInput.focus();
                } else {
                    amountInput.value = chip.dataset.amount;
                }
                document.querySelectorAll('#mobile-give .give-chip').forEach(c => c.classList.remove('is-active'));
                chip.classList.add('is-active');
                updateFee();
            };
        });
        amountInput.oninput = () => {
            document.querySelectorAll('#mobile-give .give-chip').forEach(c => c.classList.remove('is-active'));
            updateFee();
        };
        if (coverFees) coverFees.onchange = updateFee;
        updateFee();

        // Pledge promise in the Give tab: the member's pledge renders as a
        // button showing the contributed money / balance left, and paying
        // toward "Pledge Target" reduces it. Refresh when the fund changes.
        this.populateMobileGivingFunds();
        this.renderMobilePledgePanel();

        // Mirror the web console Pledges & Giving tab: project/pledge
        // campaigns and the contribution ledger. The Financial Summary sums
        // up the branch selected in the giving form - total given (removed),
        // pledge balance remaining, and what this user has contributed.
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        const givingBranch = select.value || (member && member.branchId) || this.firstBranchId();
        this.renderMobileFinancialSummary(givingBranch);
        this.renderGivingInsights(this.session.currentBranch, document.getElementById('mobile-giving-insights'), true);
        this.renderMobileLedger(givingBranch);
    },

    // "Contribute to My Pledge" in the Give tab: the member records the amount
    // they are contributing (removed from) their pledge, picks the project the
    // pledge is for, and watches the remaining balance shrink until fully paid.
    renderMobilePledgePanel() {
        const panel = document.getElementById('mobile-pledge-panel');
        if (!panel) return;
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        const pledge = this.memberPledge(member);
        const money = (n) => window.money(n, { decimals: 0 });
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set('mobile-pledge-amount', money(pledge.amount));
        set('mobile-pledge-paid', money(pledge.paid));
        set('mobile-pledge-remaining', money(pledge.balance));
        const state = document.getElementById('mobile-pledge-state');
        if (state) state.textContent = pledge.balance <= 0 ? 'Fully paid' : `Balance: ${money(pledge.balance)}`;

        // Project picker: pledge campaigns the payment can be earmarked to.
        const projectSel = document.getElementById('mobile-pledge-project');
        if (projectSel) {
            const branchId = member ? member.branchId : this.session.currentBranch;
            const inScope = (bId) => (!branchId || branchId === 'global' || branchId === 'all') ? true : bId === branchId;
            const allCamps = (this.db.campaigns || []).filter(c => inScope(c.branchId));
            projectSel.innerHTML = '<option value="">General Pledge</option>' + allCamps.map(c => `<option value="${esc(c.id)}">${esc(c.name)}${String(c.fundCategory || '').toLowerCase() === 'pledge' ? ' (Pledge)' : ''}</option>`).join('');
        }

        const submitBtn = document.getElementById('mobile-pledge-submit');
        if (submitBtn) submitBtn.disabled = pledge.amount <= 0 || pledge.balance <= 0;
        const hint = document.getElementById('mobile-pledge-hint');
        if (hint) {
            hint.textContent = pledge.balance <= 0
                ? 'This pledge is fully paid - thank you!'
                : (pledge.amount <= 0
                    ? 'No pledge recorded for you yet - ask the church office to set one up.'
                    : 'Each contribution reduces your remaining balance until the pledge is fully paid.');
        }

        const amountInput = document.getElementById('mobile-pledge-amount-input');
        if (amountInput) amountInput.oninput = () => {
            const entered = parseFloat(amountInput.value) || 0;
            if (hint) {
                if (entered <= 0) hint.textContent = 'Enter the amount you are contributing toward your pledge.';
                else if (entered > pledge.balance) hint.textContent = `Amount exceeds your remaining balance of ${money(pledge.balance)}.`;
                else hint.textContent = `Remaining after this contribution: ${money(pledge.balance - entered)}.`;
            }
        };
    },

    // Record the member's pledge contribution and reduce the pledge balance.
    submitMobilePledgeContribution() {
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        if (!member) return;
        const pledge = this.memberPledge(member);
        if (pledge.amount <= 0) { this.toast('No pledge recorded for you yet.', 'error'); return; }
        if (pledge.balance <= 0) { this.toast('This pledge is fully paid - thank you!', 'info'); return; }
        const amountInput = document.getElementById('mobile-pledge-amount-input');
        const amount = parseFloat(amountInput ? amountInput.value : '') || 0;
        if (!(amount > 0)) { this.toast('Enter a valid contribution amount.', 'error'); return; }
        if (amount > pledge.balance) { this.toast(`Amount exceeds your remaining balance of ${window.money(pledge.balance, { decimals: 0 })}.`, 'error'); return; }
        const projectSel = document.getElementById('mobile-pledge-project');
        const campaignId = projectSel && projectSel.value ? projectSel.value : null;
        const campaign = campaignId ? (this.db.campaigns || []).find(c => c.id === campaignId) : null;
        const methodSel = document.getElementById('mobile-pledge-method');
        const method = methodSel ? methodSel.value : 'M-Pesa';
        const result = this.logPledgePayment(member, amount, method, {
            campaignId: campaign ? campaign.id : null,
            campaignName: campaign ? campaign.name : null
        });
        if (amountInput) amountInput.value = '';
        this.toast(`Contributed ${window.money(amount)} toward your pledge${campaign ? ` for ${campaign.name}` : ''}. Remaining: ${window.money(result.remaining)}.`);
        this.renderMobilePledgePanel();
        this.renderMobileGive();
    },

    // "My Pledge" card in the Give tab - a pledge is money promised, not yet
    // given, so the button face shows the balance left (or "Fully paid"), the
    // card shows promised / contributed / balance, and the means used to pay.
    renderMobileGivePledge() {
        const pledgeEl = document.getElementById('mobile-giving-pledge');
        if (!pledgeEl) return;
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        if (!member) { pledgeEl.innerHTML = ''; return; }
        const p = this.memberPledge(member);
        const categorySel = document.getElementById('mobile-giving-category');
        const isPledgeTarget = categorySel && categorySel.value === 'Pledge';
        const hasPledge = p.amount > 0;
        const note = isPledgeTarget
            ? (hasPledge
                ? (p.balance > 0 ? `Giving now reduces your pledge balance. Balance left: ${window.money(p.balance)}.` : 'This pledge is fully paid - thank you!')
                : 'No pledge recorded for you yet - ask the church office to set one up.')
            : (hasPledge ? '' : 'No pledge recorded for you yet - ask the church office to set one up.');
        pledgeEl.innerHTML = `
            <div class="mobile-pledge-card">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                    <h4 style="font-size:0.8rem; font-family:var(--font-header); color:var(--mob-text); margin:0;">My Pledge</h4>
                    ${hasPledge ? this.pledgeStatusButton(p.amount, p.paid, p.balance, member.id) : '<span class="category-pill category-pledge">Pledge</span>'}
                </div>
                ${hasPledge ? `<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:8px;">
                    <div style="font-size:0.65rem; color:var(--mob-sub);"><span>Promised</span><br><strong style="font-size:0.85rem; color:var(--mob-text);">${window.money(p.amount)}</strong></div>
                    <div style="font-size:0.65rem; color:var(--mob-sub);"><span>Contributed</span><br><strong style="font-size:0.85rem; color:var(--mob-text);">${window.money(p.paid)}</strong></div>
                    <div style="font-size:0.65rem; color:var(--mob-sub);"><span>Balance</span><br><strong style="font-size:0.85rem; color:var(--mmc-gold);">${window.money(p.balance)}</strong></div>
                </div>` : ''}
                ${note ? `<div style="font-size:0.68rem; color:${hasPledge ? 'var(--accent-gold)' : 'var(--mob-sub)'}; margin-top:8px;">${note}</div>` : ''}
            </div>`;
    },

    // Financial Summary in the Give tab: a sum-up for the branch the member
    // selected in the giving form - the total given (removed), the pledge
    // balance still remaining, what this user has contributed, and their own
    // pledge balance.
    renderMobileFinancialSummary(branchId) {
        const el = document.getElementById('mobile-financial-summary');
        if (!el) return;
        const inScope = (bId) => (!branchId || branchId === 'all' || branchId === 'global') ? true : bId === branchId;
        const branchTx = (this.db.transactions || []).filter(t => inScope(t.branchId));
        const money = (n) => window.money(n, { decimals: 0 });

        // Total contributions removed/given for the selected branch.
        const branchTotal = branchTx.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

        // Pledge balance still remaining for the selected branch.
        const pledgeCampaigns = (this.db.campaigns || []).filter(c => inScope(c.branchId) && String(c.fundCategory || '').toLowerCase() === 'pledge');
        const pledgePledged = pledgeCampaigns.reduce((s, c) => s + (parseFloat(c.goal) || 0), 0);
        const pledgePaid = pledgeCampaigns.reduce((s, c) => {
            const raised = (parseFloat(c.raisedOffset) || 0) + this.db.transactions
                .filter(t => (t.campaignId ? t.campaignId === c.id : t.category === c.fundCategory) && inScope(t.branchId))
                .reduce((s2, t) => s2 + (parseFloat(t.amount) || 0), 0);
            return s + raised;
        }, 0);
        const branchRemaining = Math.max(0, pledgePledged - pledgePaid);

        // What this account owner has contributed in the selected branch.
        const myTx = branchTx.filter(t => t.memberId === this.simulatedMemberId());
        const myTotal = myTx.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

        // The owner's own pledge promise and balance left.
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        const myPledge = this.memberPledge(member);

        const branchObj = this.db.branches.find(b => b.id === branchId);
        const branchLabel = branchObj ? branchObj.name : (branchId === 'all' || branchId === 'global' ? 'All Branches' : 'Branch');

        const card = (label, value) => `<div class="card-glass campaign-card summary-stat-card mobile-summary-card">
            <span class="campaign-eyebrow">${esc(label)}</span>
            <div class="stat-value">${value}</div>
        </div>`;

        el.innerHTML = `
            <div class="giving-insights-head mobile-fin-summary-head"><span style="font-family: var(--font-header); font-weight:700; color:var(--text-primary);">Financial Summary &middot; ${esc(branchLabel)}</span></div>
            <div class="mobile-fin-summary-grid">
                ${card('Total Contribution', money(branchTotal))}
                ${card('Balance Remaining', money(branchRemaining))}
                ${card('My Contribution', money(myTotal))}
                ${card('My Pledge Remaining', money(myPledge.balance))}
            </div>`;
    },

    // Web-style contribution ledger inside the Give tab, matching the
    // console Pledges & Giving table (receipt, fund, amount, date, channel).
    renderMobileLedger(branchId) {
        const tbody = document.getElementById('mobile-ledger-tbody');
        if (!tbody) return;
        branchId = branchId || this.session.currentBranch;
        const inScope = (bId) => (!branchId || branchId === 'all' || branchId === 'global') ? true : bId === branchId;
        const tx = (this.db.transactions || [])
            .filter(t => inScope(t.branchId))
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        const money = (n) => window.money(n, { decimals: 0 });
        tbody.innerHTML = tx.slice(0, 8).map(t => `
            <tr>
                <td><span class="receipt-no" style="font-family:monospace; font-weight:bold;">${esc(t.receiptNumber)}</span></td>
                <td>${esc(t.memberName || 'Anonymous')}</td>
                <td>${this.txCategoryCell(t)}</td>
                <td class="amount-cell" style="color:#10b981; font-weight:bold; text-align:right;">${money(parseFloat(t.amount))}</td>
                <td>${esc(t.date)}</td>
                <td>${esc(t.paymentMethod)}</td>
            </tr>`).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary); padding:24px;">No contributions logged yet.</td></tr>';
    },


    // Full giving history for the simulated phone account owner - every
    // transaction the signed-in member has made, newest first.
    renderMobileHistory() {
        const list = document.getElementById('mobile-history-list');
        if (!list) return;
        const memberId = this.simulatedMemberId();
        const tx = (this.db.transactions || [])
            .filter(t => t.memberId === memberId)
            .slice()
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        const money = (n) => window.money(n, { decimals: 0 });
        const total = tx.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

        const summary = document.getElementById('mobile-history-summary');
        if (summary) {
            summary.innerHTML = `
                <div class="mobile-history-stat"><span>Total Given</span><strong>${money(total)}</strong></div>
                <div class="mobile-history-stat"><span>Number of Gifts</span><strong>${tx.length}</strong></div>
                <div class="mobile-history-stat"><span>Last Gift</span><strong>${tx.length ? esc(tx[0].date) : '&mdash;'}</strong></div>
            `;
        }

        list.innerHTML = tx.length ? tx.map(t => {
            const fund = esc(t.campaignName || t.category || 'Contribution');
            const receipt = esc(t.receiptNumber || 'REC-0000');
            const date = esc(t.date || '');
            const method = esc(t.paymentMethod || '');
            return `
                <div class="mobile-history-card">
                    <div class="mobile-history-top">
                        <span class="receipt-no">${receipt}</span>
                        <span class="mobile-history-amount">${money(parseFloat(t.amount))}</span>
                    </div>
                    <div class="mobile-history-mid"><strong>${fund}</strong></div>
                    <div class="mobile-history-bottom">
                        <span>${date}</span>
                        <span>${method}</span>
                    </div>
                </div>`;
        }).join('') : '<div class="mobile-project-empty">No transactions yet - your giving history will appear here.</div>';
    },

    // Give directly to a project from its card in the member app - the giver
    // picks the amount and the payment method they want to use.
    supportProject(campaignId) {
        const campaign = (this.db.campaigns || []).find(c => c.id === campaignId);
        if (!campaign) return;
        const amountInput = document.getElementById('proj-amount-' + campaignId);
        const methodSel = document.getElementById('proj-method-' + campaignId);
        const amount = parseFloat(amountInput ? amountInput.value : '');
        const method = methodSel ? methodSel.value : 'M-Pesa';
        if (isNaN(amount) || amount <= 0) { this.toast('Enter a valid amount greater than Ksh 0.', 'error'); return; }
        const branchObj = this.db.branches.find(b => b.id === campaign.branchId);
        const member = this.db.members.find(m => m.id === this.simulatedMemberId());
        const memberName = member ? member.firstName + ' ' + member.lastName : 'Anonymous';
        const newTx = {
            id: 't_' + Date.now(),
            branchId: campaign.branchId,
            branchName: branchObj ? branchObj.name : campaign.branchId,
            memberId: member ? member.id : null,
            memberName,
            amount,
            category: campaign.fundCategory,
            campaignId: campaign.id,
            campaignName: campaign.name,
            date: new Date().toISOString().split('T')[0],
            paymentMethod: method,
            receiptNumber: 'REC-2026-' + (Math.floor(Math.random() * 90000) + 10000),
            onBehalfOf: null
        };
        this.db.transactions.unshift(newTx);
        this.saveDB();
        this.apiWrite(
            () => Church2API.recordTransaction({ memberId: newTx.memberId, amount, category: newTx.category, paymentMethod: method, date: newTx.date, memberName, branchId: newTx.branchId }),
            (srv) => { if (srv && srv.id) { newTx.id = srv.id; if (srv.receiptNumber) newTx.receiptNumber = srv.receiptNumber; } }
        );
        this.toast('Thank you! ' + window.money(amount) + ' given to ' + campaign.name + ' via ' + method + '. Receipt ' + newTx.receiptNumber + '.');
        this.renderAll();
        this.renderMobileGive();
        this.renderMobileProjects();
    },

    handleMobileGiving() {
        const branchId = document.getElementById('mobile-giving-branch').value;
        let amount = parseFloat(document.getElementById('mobile-giving-amount').value);
        const category = document.getElementById('mobile-giving-category').value;
        const method = document.getElementById('mobile-giving-method').value;
        const frequency = document.getElementById('mobile-giving-frequency').value;
        const coverFees = document.getElementById('mobile-giving-cover-fees').checked;
        const onBehalfRaw = document.getElementById('mobile-giving-onbehalf') ? document.getElementById('mobile-giving-onbehalf').value.trim() : '';

        // A "campaign:<id>" fund means the giver chose a specific church
        // project - carry its fund category and tag the gift with the project.
        const campaign = category.indexOf('campaign:') === 0
            ? (this.db.campaigns || []).find(c => c.id === category.slice('campaign:'.length)) || null
            : null;
        const effectiveCategory = campaign ? campaign.fundCategory : category;

        if (isNaN(amount) || amount <= 0) { this.toast('Enter a valid amount greater than Ksh 0.', 'error'); return; }

        let feeAdded = 0;
        if (coverFees) {
            feeAdded = this.givingFee(amount, method);
            amount = Math.round(amount + feeAdded);
        }

        const branchObj = this.db.branches.find(b => b.id === branchId);

        // Assume logged-in member John Kamau (m1) is doing the giving
        const loggedInMemberId = 'm1';
        const memberObj = this.db.members.find(m => m.id === loggedInMemberId);

        // "Giving On Behalf Of" is an editable name: blank (or "Myself") means
        // the giver themself; anything else is the person the gift is for.
        const selfLabel = memberObj ? `Myself (${memberObj.firstName} ${memberObj.lastName})` : 'Myself';
        const onBehalfOf = (!onBehalfRaw || onBehalfRaw.toLowerCase() === 'myself' || onBehalfRaw === selfLabel) ? null : onBehalfRaw;

        // A pledge is money promised, not yet given - paying toward "Pledge
        // Target" can only go up to the balance still left on the pledge.
        let pledgeBalanceAfter = null;
        if (effectiveCategory === 'Pledge' && !campaign) {
            const pledge = this.memberPledge(memberObj);
            if (pledge.amount <= 0) { this.toast('No pledge recorded for you yet - ask the church office to set one up.', 'error'); return; }
            if (amount > pledge.balance) { this.toast(`Amount exceeds your remaining pledge balance of ${window.money(pledge.balance)}.`, 'error'); return; }
            pledgeBalanceAfter = Math.max(0, pledge.balance - amount);
        }

        const newTx = {
            id: `t_${Date.now()}`,
            branchId,
            branchName: branchObj.name,
            memberId: loggedInMemberId,
            memberName: `${memberObj.firstName} ${memberObj.lastName}`,
            amount,
            category: effectiveCategory,
            campaignId: campaign ? campaign.id : null,
            campaignName: campaign ? campaign.name : null,
            date: new Date().toISOString().split('T')[0],
            paymentMethod: method,
            receiptNumber: `REC-2026-${Math.floor(Math.random() * 90000) + 10000}`,
            onBehalfOf: onBehalfOf || null
        };

        this.db.transactions.unshift(newTx);

        // Recurring schedule
        let recurringNote = '';
        let recurringGift = null;
        if (frequency !== 'once') {
            this.db.recurringGifts = this.db.recurringGifts || [];
            const next = new Date();
            next.setDate(next.getDate() + (frequency === 'weekly' ? 7 : 30));
            recurringGift = {
                id: `rec_${Date.now()}`,
                memberId: loggedInMemberId,
                memberName: `${memberObj.firstName} ${memberObj.lastName}`,
                branchId,
                branchName: branchObj.name,
                amount,
                category: effectiveCategory,
                frequency,
                method,
                nextDate: next.toISOString().split('T')[0],
                active: true
            };
            this.db.recurringGifts.unshift(recurringGift);
            recurringNote = `<p style="font-size:0.7rem; color:#34d399; margin-top:6px;">Recurring ${esc(frequency)} gift scheduled - next on ${esc(next.toISOString().split('T')[0])}.</p>`;
        }

        // Boost engagement index
        memberObj.engagement_score = Math.min(memberObj.engagement_score + 5, 100);
        // A pledge payment reduces what this individual still owes on the pledge.
        if (effectiveCategory === 'Pledge' && !campaign) {
            memberObj.pledgePaid = Math.min(parseFloat(memberObj.pledgeAmount) || 0, (parseFloat(memberObj.pledgePaid) || 0) + amount);
        }
        this.saveDB();
        this.syncMemberProfile(memberObj);
        this.apiWrite(
            () => Church2API.recordTransaction({ memberId: loggedInMemberId, amount, category: effectiveCategory, paymentMethod: method, date: newTx.date, branchId }),
            (srv) => { if (srv && srv.id) { newTx.id = srv.id; if (srv.receiptNumber) newTx.receiptNumber = srv.receiptNumber; } }
        );
        if (recurringGift) {
            this.apiWrite(
                () => Church2API.createRecurringGift({
                    memberId: recurringGift.memberId,
                    memberName: recurringGift.memberName,
                    branchId: recurringGift.branchId,
                    amount: recurringGift.amount,
                    category: recurringGift.category,
                    frequency: recurringGift.frequency,
                    method: recurringGift.method,
                    nextDate: recurringGift.nextDate
                }),
                (srv) => { if (srv && srv.id) { recurringGift.id = srv.id; if (srv.nextDate) recurringGift.nextDate = srv.nextDate; } }
            );
        }

        document.getElementById('mobile-giving-form').reset();

        // Generate simulated mobile success dialog
        const modal = document.getElementById('mobile-giving-success-overlay');
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div style="background: #1c1c2d; padding:20px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); width: 85%; max-width:280px; text-align:center;">
                <span style="font-size:3rem;"></span>
                <h4 style="color:#fff; margin-top:10px;">Giving Successful!</h4>
                <p style="font-size:0.75rem; color:#9ca3af; margin-top:5px;">Thank you for your donation of <strong style="color:#fff;">${money(amount)}</strong> toward ${esc(campaign ? campaign.name : effectiveCategory)}.${feeAdded ? ` <span style="color:#9ca3af;">(includes ${money(feeAdded)} transaction charge)</span>` : ''}</p>
                ${onBehalfOf ? `<p style="font-size:0.7rem; color:#93c5fd; margin-top:4px;">Gift by ${esc(onBehalfOf)} credited to ${esc(memberObj.firstName)} ${esc(memberObj.lastName)}.</p>` : ''}
                <p style="font-size:0.7rem; color:#93c5fd; font-weight:bold; margin-top:8px;">Receipt Generated: ${esc(newTx.receiptNumber)}</p>
                ${pledgeBalanceAfter !== null ? `<p style="font-size:0.7rem; color:#fbbf24; margin-top:4px;">Pledge balance remaining: ${money(pledgeBalanceAfter)}.</p>` : ''}
                ${recurringNote}
                <button class="btn btn-primary-gradient btn-sm" style="margin-top:15px; width:100%;" onclick="document.getElementById('mobile-giving-success-overlay').style.display='none'">Awesome</button>
            </div>
        `;

        this.renderAll();
    },

    renderMobileServe() {
        const openRolesContainer = document.getElementById('mobile-open-serve-roles');
        openRolesContainer.innerHTML = '';

        // "My Serving Assignments" - tasks the admin assigned to this member
        // (including AI Match assignments) appear here in the app.
        const assignmentsContainer = document.getElementById('mobile-my-assignments');
        if (assignmentsContainer) {
            const memberId = this.simulatedMemberId();
            const assignments = [];
            (this.db.events || []).forEach(e => {
                const roster = this.ensureEventRoster(e);
                roster.forEach(entry => {
                    if ((entry.volunteers || []).includes(memberId)) {
                        assignments.push({ role: entry.role, event: e });
                    }
                });
            });
            assignmentsContainer.innerHTML = assignments.length
                ? assignments.map(a => (`
                    <div class="mobile-serve-item-card assigned">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                            <div style="min-width:0;">
                                <strong style="font-size:0.8rem; color:var(--mob-text); display:block;">${esc(a.role)}</strong>
                                <span style="font-size:0.7rem; color:var(--text-secondary); display:block;">Event: ${esc(a.event.title)}</span>
                                <span style="font-size:0.7rem; color:var(--accent-gold); display:block;">Date: ${esc(a.event.date)}</span>
                            </div>
                            <span class="mobile-assigned-pill">Assigned</span>
                        </div>
                    </div>`)).join('')
                : '<div class="empty-state small"><span>No serving assignments yet - tasks assigned by your admin will appear here.</span></div>';
        }

        // Extract list of all open positions in upcoming events
        this.db.events.forEach(e => {
            e.rolesRequired.forEach(role => {
                // Check if someone has signed up
                const isAssigned = e.volunteersSignedUp.some(mId => {
                    const member = this.db.members.find(m => m.id === mId);
                    return member && (member.volunteer_skills || []).includes(role);
                });

                if (!isAssigned) {
                    const div = document.createElement('div');
                    div.className = 'mobile-serve-item-card';
                    div.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                            <div style="min-width:0;">
                                <strong style="font-size:0.8rem; color:var(--text-primary); display:block;">${esc(role)}</strong>
                                <span style="font-size:0.7rem; color:var(--text-secondary); display:block;">Event: ${esc(e.title)}</span>
                                <span style="font-size:0.7rem; color:var(--accent-gold); display:block;">Date: ${esc(e.date)}</span>
                            </div>
                            <button class="mobile-apply-btn" style="flex:0 0 auto;" onclick="ChurchApp.handleMobileServeSignup('${esc(e.id)}', '${esc(role).replace(/'/g, "\\'")}')">Serve</button>
                        </div>
                    `;
                    openRolesContainer.appendChild(div);
                }
            });
        });

        if (openRolesContainer.innerHTML === '') {
            openRolesContainer.innerHTML = `<div class="empty-state small"><span>All volunteer slots are fully rostered. Thank you!</span></div>`;
        }

        // Render current member skills list
        const m1 = this.db.members.find(m => m.id === 'm1');
        const skillsContainer = document.getElementById('mobile-my-skills-list');
        skillsContainer.innerHTML = ((m1 && m1.volunteer_skills) || []).map(s => `<span class="skill-tag">${esc(s)}</span>`).join('');
    },

    handleMobileServeSignup(eventId, role) {
        // Logged-in member John Kamau (m1) registers
        const event = this.db.events.find(e => e.id === eventId);
        const m1 = this.db.members.find(m => m.id === 'm1');
        
        if (event && m1) {
            // Check if member already has this skill, if not add it
            if (!(m1.volunteer_skills || []).includes(role)) {
                m1.volunteer_skills.push(role);
            }

            if (!event.volunteersSignedUp.includes('m1')) {
                event.volunteersSignedUp.push('m1');
            }

            // Boost engagement index
            m1.engagement_score = Math.min(m1.engagement_score + 6, 100);
            this.saveDB();
            this.apiWrite(
                () => Church2API.updateEventVolunteers(eventId, event.volunteersSignedUp),
                (srv) => { if (srv && Array.isArray(srv.volunteersSignedUp)) event.volunteersSignedUp = srv.volunteersSignedUp; }
            );
            this.syncMemberProfile(m1);

            this.toast(`You're serving as ${role} for ${event.title}. Thank you!`);
            this.renderAll();
        }
    },

    handleMobileVolunteerSignup() {
        const input = document.getElementById('new-skill-input');
        if (!input || !input.value.trim()) return;

        const newSkill = input.value.trim();
        const m1 = this.db.members.find(m => m.id === 'm1');
        if (m1) {
            if (!(m1.volunteer_skills || []).includes(newSkill)) {
                m1.volunteer_skills.push(newSkill);
            }
            this.saveDB();
            this.syncMemberProfile(m1);
            input.value = '';
            this.renderMobileServe();
        }
    },

    renderMobileChat() {
        const body = document.getElementById('mobile-chat-body');
        if (!body) return;
        // Talk-to-an-Elder card: members with an issue can call or email the
        // church using the contact details set by the super admin.
        const contact = this.churchContactInfo();
        const contactEl = document.getElementById('mobile-elder-contact');
        if (contactEl) {
            contactEl.innerHTML = (contact.contactPhone || contact.contactEmail) ? `
                <div class="mobile-elder-card">
                    <div class="mobile-elder-head">
                        <span class="mobile-elder-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg></span>
                        <div>
                            <strong>Talk to an Elder</strong>
                            <span>Reach church leadership with any issue</span>
                        </div>
                    </div>
                    <div class="mobile-elder-actions">
                        ${contact.contactPhone ? `<a class="mobile-elder-btn" href="tel:${esc(String(contact.contactPhone).replace(/\s+/g, ''))}">Call ${esc(contact.contactPhone)}</a>` : ''}
                        ${contact.contactEmail ? `<a class="mobile-elder-btn" href="mailto:${esc(contact.contactEmail)}">Email ${esc(contact.contactEmail)}</a>` : ''}
                    </div>
                </div>` : '';
        }
        // Check for a rendered bubble, not for empty innerHTML - the markup ships
        // with an HTML comment placeholder, which is never the empty string.
        if (!body.querySelector('.chat-bubble')) {
            // Seed welcome message
            const first = this.mobileGreetingName();
            body.innerHTML = `
                <div class="chat-bubble bot">
                    <p>${first ? `Hello ${esc(first)}!` : 'Hello!'} I am your <strong>Pastoral Care Assistant</strong>. I can help with service schedules, digital tithing, community cell groups, or volunteering roles - and I am always up for a joke or a friendly chat.</p>
                    <span class="chat-time">${new Date().toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
            `;
        }
        // Posted Church Care messages appear as incoming bubbles so members see
        // them inboxed in their AI Care chat.
        (this.db.careInbox || []).forEach((m) => {
            if (body.querySelector(`.care-msg[data-id="${esc(m.id)}"]`)) return;
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble bot care-msg';
            bubble.setAttribute('data-id', m.id);
            bubble.innerHTML = `
                <p><strong>${esc(m.author || 'Church Care Team')}</strong>${m.title ? ' - ' + esc(m.title) : ''}<br>${esc(m.body)}</p>
                <span class="chat-time">${m.sentAt ? new Date(m.sentAt).toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'}) : ''}</span>
            `;
            body.appendChild(bubble);
        });
    },

    // Ask the intelligent assistant (DeepSeek through the backend when a key is
    // configured and the user is signed in; otherwise the built-in engine).
    // Always resolves to reply text so the chat UI never breaks.
    async askAssistant(system, messages, fallback) {
        try {
            if (window.Church2API && Church2API.isEnabled() && Church2API.getToken() && typeof Church2API.chat === 'function') {
                const r = await Church2API.chat(messages, system);
                const reply = r && (r.reply || r.message || r.content || r.text);
                if (reply && String(reply).trim()) { this._assistantMode = 'deepseek'; return String(reply).trim(); }
            }
        } catch (e) {
            console.warn('AI assistant unavailable - using built-in replies:', e && e.message);
        }
        this._assistantMode = 'builtin';
        return fallback();
    },

    handleMobileChatSend() {
        const input = document.getElementById('mobile-chat-input');
        const text = input.value.trim();
        if (!text) return;

        const body = document.getElementById('mobile-chat-body');

        // Add user bubble
        const userDiv = document.createElement('div');
        userDiv.className = 'chat-bubble user';
        userDiv.innerHTML = `
            <p>${esc(text)}</p>
            <span class="chat-time">${new Date().toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'})}</span>
        `;
        body.appendChild(userDiv);
        input.value = '';

        // Scroll chat
        body.scrollTop = body.scrollHeight;

        // Show a typing indicator while the assistant thinks.
        const typingDiv = document.createElement('div');
        typingDiv.className = 'chat-bubble bot animate-fade-in';
        typingDiv.id = 'ai-chat-typing';
        typingDiv.innerHTML = `<div class="md-body chat-md"><em>Thinking&hellip;</em></div>`;
        body.appendChild(typingDiv);
        body.scrollTop = body.scrollHeight;

        // Ask the intelligent assistant (DeepSeek when configured, built-in
        // engine otherwise) and render its reply with markdown.
        this.askAssistant(
            'You are a warm, friendly and entertaining assistant for Maximum Miracle Centre (ChurchConnect). Welcome ANY question the user types: greetings, small talk, jokes, faith and Bible topics, church services, giving, pledges, projects, small groups, volunteering, prayer, and questions about this website. Answer exactly what the user asked: a real question gets a direct answer - never reply to a question with a greeting, a joke or generic small talk (greet or joke only when the user greets or asks for a joke). When the user only greets you (hi, hello, good morning), reply with a short, simple greeting and nothing more - do not list features or answer anything that was not asked. Use the real church details for services, giving, pledges, projects, groups and staff whenever possible. Always answer directly and helpfully. If you are not sure about a specific church detail, say so and suggest asking the church office. Never end your reply with a question or a prompt like "anything else" - just answer, then let the user lead. Keep replies concise.',
            [{ role: 'user', content: text }],
            () => window.AIEngine.getBotResponse(text)
        ).then((botResponse) => {
            // Parse optional quick-reply buttons and strip those lines from the
            // spoken text so options render only as buttons (not duplicated inline).
            const options = [];
            const textLines = [];
            // Only explicit "[Option]" markers become quick-reply buttons - every
            // other line stays in the answer so the reply is never restructured.
            botResponse.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith('- [Option]')) {
                    options.push(trimmed.substring('- [Option]'.length).trim());
                } else {
                    textLines.push(line);
                }
            });

            let buttonsHtml = '';
            if (options.length > 0) {
                buttonsHtml = `
                    <div class="chat-options-container">
                        ${options.map(opt => `
                            <button class="chat-option-btn" onclick="ChurchApp.handleChatOptionClick('${esc(opt).replace(/'/g, "\\'")}')">${esc(opt)}</button>
                        `).join('')}
                    </div>
                `;
            }

            const modeNote = this._assistantMode === 'builtin'
                ? '<div class="chat-mode-note">Built-in reply &middot; AI mode unavailable (server or key not connected).</div>'
                : '';
            const botDiv = document.createElement('div');
            botDiv.className = 'chat-bubble bot animate-fade-in';
            botDiv.innerHTML = `
                <div class="md-body chat-md">${renderMarkdown(textLines.join('\n'))}</div>
                ${buttonsHtml}
                ${modeNote}
                <span class="chat-time">${new Date().toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'})}</span>
            `;
            if (typingDiv.parentNode) typingDiv.parentNode.removeChild(typingDiv);
            body.appendChild(botDiv);
            body.scrollTop = body.scrollHeight;
        }).catch((err) => {
            console.error('Chat reply failed:', err);
            if (typingDiv.parentNode) typingDiv.parentNode.removeChild(typingDiv);
            const errDiv = document.createElement('div');
            errDiv.className = 'chat-bubble bot animate-fade-in';
            errDiv.innerHTML = '<div class="md-body chat-md"><em>Sorry, I could not answer right now. Please try again.</em></div>';
            body.appendChild(errDiv);
            body.scrollTop = body.scrollHeight;
        });
    },

    handleChatOptionClick(optionValue) {
        const input = document.getElementById('mobile-chat-input');
        if (input) {
            input.value = optionValue;
            this.handleMobileChatSend();
        }
    },

    // ---- AI Software Assistant (learn how to use the software) ----
    toggleAiHelp() {
        const modal = document.getElementById('ai-help-modal');
        if (!modal) return;
        if (modal.style.display === 'flex') {
            this.closeAiHelp();
        } else {
            this.openAiHelp();
        }
    },

    openAiHelp() {
        const modal = document.getElementById('ai-help-modal');
        if (!modal) return;
        if (!modal.getAttribute('data-seeded')) {
            this.seedAiHelp();
            modal.setAttribute('data-seeded', '1');
        }
        this.openModal('ai-help-modal');
        const launcher = document.getElementById('ai-chat-launcher');
        if (launcher) launcher.classList.add('is-open');
        const input = document.getElementById('ai-help-input');
        if (input) input.focus();
    },

    closeAiHelp() {
        this.closeModal('ai-help-modal');
        const launcher = document.getElementById('ai-chat-launcher');
        if (launcher) launcher.classList.remove('is-open');
    },

    seedAiHelp() {
        const modal = document.getElementById('ai-help-modal');
        if (!modal) return;
        const assistant = (window.AIEngine && window.AIEngine.SoftwareAssistant) || null;
        const overview = assistant
            ? assistant.helpOverview()
            : 'I can guide you through Church 2.0 - for example, adding a member or finding the financial report.';
        modal.innerHTML = `
            <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="ai-help-title">
                <div class="ai-chat-header">
                    <div class="ai-chat-avatar">
                        <svg class="ai-robot" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="6.5" r="3" fill="#22d3ee"/><line x1="32" y1="8" x2="32" y2="15" stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round"/><rect x="14" y="17" width="36" height="30" rx="9" fill="#10131a" stroke="#22d3ee" stroke-width="2"/><rect x="7" y="26" width="7" height="12" rx="3" fill="#1b1e26"/><rect x="50" y="26" width="7" height="12" rx="3" fill="#1b1e26"/><circle cx="10.5" cy="32" r="1.8" fill="#22d3ee" opacity="0.8"/><circle cx="53.5" cy="32" r="1.8" fill="#22d3ee" opacity="0.8"/><rect x="22" y="25" width="8" height="9" rx="2.5" fill="#22d3ee"/><rect x="34" y="25" width="8" height="9" rx="2.5" fill="#22d3ee"/><rect x="24" y="39" width="16" height="5" rx="2" fill="#22d3ee" opacity="0.9"/></svg>
                    </div>
                    <div>
                        <div class="ai-chat-title" id="ai-help-title">ChurchConnect Assistant</div>
                        <div class="ai-chat-status"><span class="dot"></span> Online &middot; software help</div>
                    </div>
                    <button class="modal-close ai-chat-close" aria-label="Close assistant" onclick="ChurchApp.closeAiHelp()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="chat-messages-area" id="ai-help-body">
                        <div class="chat-bubble bot animate-fade-in">
                            <div class="md-body chat-md">${renderMarkdown(overview)}</div>
                        </div>
                    </div>
                    <div class="chat-input-row">
                        <input type="text" id="ai-help-input" class="form-control" placeholder="Type anything - services, giving, groups, or a joke...">
                        <button class="mobile-rsvp-btn" id="ai-help-send-btn">Send</button>
                    </div>
                </div>
            </div>
        `;
        const input = document.getElementById('ai-help-input');
        if (input) input.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.handleAiHelpSend(); });
        const sendBtn = document.getElementById('ai-help-send-btn');
        if (sendBtn) sendBtn.addEventListener('click', () => this.handleAiHelpSend());
    },

    handleAiHelpSend() {
        const input = document.getElementById('ai-help-input');
        const text = input ? input.value.trim() : '';
        if (!text) return;
        const body = document.getElementById('ai-help-body');
        if (!body) return;

        const userDiv = document.createElement('div');
        userDiv.className = 'chat-bubble user';
        userDiv.innerHTML = `<p>${esc(text)}</p><span class="chat-time">${new Date().toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'})}</span>`;
        body.appendChild(userDiv);
        input.value = '';
        body.scrollTop = body.scrollHeight;

        const typingDiv = document.createElement('div');
        typingDiv.className = 'chat-bubble bot animate-fade-in';
        typingDiv.id = 'ai-help-typing';
        typingDiv.innerHTML = '<div class="md-body chat-md"><em>Thinking&hellip;</em></div>';
        body.appendChild(typingDiv);
        body.scrollTop = body.scrollHeight;

        const assistant = (window.AIEngine && window.AIEngine.SoftwareAssistant) || null;
        const fallback = () => {
            if (assistant) {
                const softwareAnswer = assistant.askSoftware(text);
                if (softwareAnswer) return softwareAnswer;
            }
            return window.AIEngine ? window.AIEngine.getBotResponse(text) : 'I can guide you through Church 2.0 - for example, adding a member or finding the financial report.';
        };
        this.askAssistant(
            'You are the ChurchConnect assistant helping staff and members use this website: members directory, giving and pledges, projects, staff, announcements, ministry rota tasks, groups, follow-ups, settings and the member mobile app. Also welcome general conversation - greetings, jokes and questions about the website. Answer exactly what the user asked: a real question always gets a direct answer, never a greeting, joke or generic reply. When the user only greets you, reply with a short, simple greeting and nothing more - do not list features or answer anything that was not asked. Answer directly, step by step and concisely, and stay friendly. Never end your reply with a question or a prompt like "anything else" - just answer, then let the user lead.',
            [{ role: 'user', content: text }],
            fallback
        ).then((answer) => {
            const modeNote = this._assistantMode === 'builtin'
                ? '<div class="chat-mode-note">Built-in reply &middot; AI mode unavailable (server or key not connected).</div>'
                : '';
            const botDiv = document.createElement('div');
            botDiv.className = 'chat-bubble bot animate-fade-in';
            botDiv.innerHTML = `<div class="md-body chat-md">${renderMarkdown(answer)}</div>${modeNote}`;
            if (typingDiv.parentNode) typingDiv.parentNode.removeChild(typingDiv);
            body.appendChild(botDiv);
            body.scrollTop = body.scrollHeight;
        }).catch((err) => {
            console.error('Chat reply failed:', err);
            if (typingDiv.parentNode) typingDiv.parentNode.removeChild(typingDiv);
            const errDiv = document.createElement('div');
            errDiv.className = 'chat-bubble bot animate-fade-in';
            errDiv.innerHTML = '<div class="md-body chat-md"><em>Sorry, I could not answer right now. Please try again.</em></div>';
            body.appendChild(errDiv);
            body.scrollTop = body.scrollHeight;
        });
    },

    handleAiHelpChip(question) {
        const input = document.getElementById('ai-help-input');
        if (input) {
            input.value = question;
            this.handleAiHelpSend();
        }
    },

    // UI Helpers
    _lastFocusedBeforeModal: null,

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        this._lastFocusedBeforeModal = document.activeElement;
        modal.style.display = 'flex';
        // Move focus into the dialog for keyboard/screen-reader users.
        const focusTarget = modal.querySelector('.modal-close, [autofocus], button, input, a[href]');
        if (focusTarget) focusTarget.focus();

        // Trap Tab focus within the dialog so keyboard users can't tab into the
        // page behind the overlay.
        this._trapHandler = (e) => {
            if (e.key !== 'Tab') return;
            const focusables = modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
            if (!focusables.length) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        modal.addEventListener('keydown', this._trapHandler);
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            if (this._trapHandler) { modal.removeEventListener('keydown', this._trapHandler); this._trapHandler = null; }
            if (modalId === 'ai-help-modal') {
                const launcher = document.getElementById('ai-chat-launcher');
                if (launcher) launcher.classList.remove('is-open');
            }
        }
        // Restore focus to whatever opened the modal.
        if (this._lastFocusedBeforeModal && typeof this._lastFocusedBeforeModal.focus === 'function') {
            this._lastFocusedBeforeModal.focus();
            this._lastFocusedBeforeModal = null;
        }
    },

    closeAnyOpenModal() {
        ['member-detail-modal', 'staff-edit-modal', 'ai-matcher-modal', 'receipt-modal', 'ai-help-modal'].forEach((id) => {
            const modal = document.getElementById(id);
            if (modal && modal.style.display === 'flex') this.closeModal(id);
        });
    },

    // Non-blocking toast notification - replaces alert() for friendlier feedback.
    toast(message, type = 'success') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('role', 'status');
            document.body.appendChild(container);
        }
        const icon = type === 'error' ? '' : (type === 'info' ? '' : '');
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.innerHTML = `<span class="toast-icon">${icon}</span><span>${esc(message)}</span>`;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('leaving');
            setTimeout(() => el.remove(), 280);
        }, 3600);
    },

    // Direct submit prayer request from mobile app
    submitMobilePrayer() {
        const textarea = document.getElementById('mobile-prayer-textarea');
        const text = textarea.value.trim();
        if (!text) return;

        // Categorize via AI
        const categoryResult = window.AIEngine.categorizePrayerRequest(text);

        const newPrayer = {
            id: `pr_${Date.now()}`,
            memberId: 'm1',
            memberName: 'John Kamau',
            // Derive the branch from the member record rather than hardcoding
            // one, so the prayer routes to the right branch after a rebrand.
            branchName: (this.db.members.find(m => m.id === 'm1') || {}).branchName
                || (this.db.branches[0] && this.db.branches[0].name) || 'Main Branch',
            text: text,
            category: categoryResult.category,
            route: categoryResult.route,
            status: 'Assigned',
            timestamp: new Date().toISOString()
        };

        this.db.prayerRequests.push(newPrayer);
        this.saveDB();
        this.apiWrite(
            () => Church2API.submitPrayer({ memberId: 'm1', memberName: newPrayer.memberName, branchName: newPrayer.branchName, text, category: newPrayer.category, route: newPrayer.route }),
            (srv) => { if (srv && srv.id) newPrayer.id = srv.id; }
        );
        textarea.value = '';

        this.toast(`Prayer received - categorized as "${categoryResult.category}" and routed to ${categoryResult.route}.`, 'info');

        this.renderAll();
    }
};

// Start application
window.onload = () => {
    // Expose BEFORE init so inline handlers and window.ChurchApp stay valid even
    // if init() throws (e.g. a missing dependency mid-render).
    window.ChurchApp = ChurchApp;

    // Close modals on Escape and on backdrop click - expected dialog behavior.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') ChurchApp.closeAnyOpenModal();
    });
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) ChurchApp.closeModal(overlay.id);
        });
    });

    try {
        ChurchApp.init();
    } catch (err) {
        console.error('Church 2.0 failed to initialize:', err);
    }
};
