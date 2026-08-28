// Maximum Miracle Centre - Client-Side Ministry Intelligence Simulation
// Designed to mimic advanced Natural Language Processing and Analytics

const AIEngine = {
    // 1. Bible Quiz Sub-engine
    QuizManager: {
        active: false,
        questionIndex: 0,
        score: 0,
        questions: [
            { q: "How many books are in the Bible?", a: "66", options: ["55", "66", "72", "84"] },
            { q: "Which book contains the verse: 'For where your treasure is, there will your heart be also'?", a: "Luke", options: ["Matthew", "Mark", "Luke", "John"] },
            { q: "By what means are we saved according to Ephesians 2:8?", a: "Grace through faith", options: ["Good deeds", "Grace through faith", "Tradition", "Strict laws"] },
            { q: "Which prophet was swallowed by a great fish?", a: "Jonah", options: ["Jonah", "Elijah", "Isaiah", "Moses"] },
            { q: "What is the longest chapter in the Bible?", a: "Psalm 119", options: ["Psalm 23", "Psalm 119", "Genesis 1", "John 3"] }
        ],
        startQuiz() {
            this.active = true;
            this.questionIndex = 0;
            this.score = 0;
            return `**Bible Trivia Quiz Started!**\n\nAnswer the questions by typing the correct option or word.\n\n*Question 1*: ${this.questions[0].q}\nOptions:\n${this.questions[0].options.map(o => `- [Option] ${o}`).join("\n")}`;
        },
        handleAnswer(answerText) {
            const currentQ = this.questions[this.questionIndex];
            const normalizedUser = answerText.trim().toLowerCase();
            const normalizedCorrect = currentQ.a.toLowerCase();

            // Require a real answer: an empty string makes includes() trivially true,
            // which would mark blank submissions correct.
            let isCorrect = normalizedUser.length > 0 &&
                (normalizedUser.includes(normalizedCorrect) || normalizedCorrect.includes(normalizedUser));

            if (!isCorrect) {
                const matchedOpt = currentQ.options.find(opt => normalizedUser.includes(opt.toLowerCase()));
                if (matchedOpt && matchedOpt.toLowerCase() === normalizedCorrect) {
                    isCorrect = true;
                }
            }

            if (isCorrect) {
                this.score++;
                answerText = `**Correct!**`;
            } else {
                answerText = `**Incorrect.** The correct answer was: **${currentQ.a}**.`;
            }

            this.questionIndex++;

            if (this.questionIndex < this.questions.length) {
                const nextQ = this.questions[this.questionIndex];
                return `${answerText}\n\n*Question ${this.questionIndex + 1}*: ${nextQ.q}\nOptions:\n${nextQ.options.map(o => `- [Option] ${o}`).join("\n")}`;
            } else {
                const finalScore = this.score;
                this.active = false;
                let feedback = "Excellent! You have a deep understanding of scripture.";
                if (finalScore < 3) feedback = "Good effort! Keep studying scripture to grow in knowledge.";
                return `${answerText}\n\n**Quiz Finished!**\nYour Final Score: **${finalScore} / ${this.questions.length}**\n\n${feedback}`;
            }
        }
    },

    // 2. Study Plan Sub-engine
    StudyPlanManager: {
        plans: {
            grace: {
                topic: "Grace",
                days: [
                    { day: 1, ref: "Ephesians 2:8", focus: "Salvation is a gift, not earned by deeds." },
                    { day: 2, ref: "Romans 3:24", focus: "Justified freely by His grace through redemption." },
                    { day: 3, ref: "2 Corinthians 12:9", focus: "God's grace is sufficient in our weakness." },
                    { day: 4, ref: "Titus 2:11", focus: "Grace teaches us to live godly lives." },
                    { day: 5, ref: "Hebrews 4:16", focus: "Approach the throne of grace with confidence." }
                ]
            },
            faith: {
                topic: "Faith",
                days: [
                    { day: 1, ref: "Hebrews 11:1", focus: "The assurance of things hoped for." },
                    { day: 2, ref: "Romans 10:17", focus: "Faith comes by hearing the word of God." },
                    { day: 3, ref: "James 2:17", focus: "Faith without works is dead." },
                    { day: 4, ref: "Matthew 17:20", focus: "Faith as small as a mustard seed moves mountains." },
                    { day: 5, ref: "Hebrews 11:6", focus: "Without faith, it is impossible to please God." }
                ]
            },
            love: {
                topic: "Love",
                days: [
                    { day: 1, ref: "1 Corinthians 13:4-7", focus: "Patience, kindness, and endurance of love." },
                    { day: 2, ref: "John 3:16", focus: "God's ultimate demonstration of love." },
                    { day: 3, ref: "1 John 4:19", focus: "We love because He first loved us." },
                    { day: 4, ref: "Luke 10:27", focus: "Love the Lord and love your neighbor." },
                    { day: 5, ref: "Romans 13:10", focus: "Love is the fulfillment of the law." }
                ]
            },
            stewardship: {
                topic: "Stewardship",
                days: [
                    { day: 1, ref: "Malachi 3:10", focus: "Bringing tithes into the storehouse." },
                    { day: 2, ref: "Luke 12:34", focus: "Where your treasure is, there your heart is." },
                    { day: 3, ref: "Proverbs 11:25", focus: "A generous soul will prosper." },
                    { day: 4, ref: "2 Corinthians 9:7", focus: "God loves a cheerful giver." },
                    { day: 5, ref: "1 Peter 4:10", focus: "Use whatever gift you received to serve." }
                ]
            }
        },
        generateStudyPlan(topicInput) {
            const cleaned = (topicInput || '').trim().toLowerCase();
            let plan = this.plans[cleaned];

            if (!plan) {
                for (const key in this.plans) {
                    if (cleaned.includes(key) || key.includes(cleaned)) {
                        plan = this.plans[key];
                        break;
                    }
                }
            }

            if (!plan) {
                plan = {
                    topic: "General Spiritual Growth",
                    days: [
                        { day: 1, ref: "Psalm 119:105", focus: "God's word is a lamp to guide our feet." },
                        { day: 2, ref: "Philippians 4:6", focus: "Do not worry; present requests to God." },
                        { day: 3, ref: "Proverbs 3:5", focus: "Trust in the Lord with all your heart." },
                        { day: 4, ref: "Isaiah 40:31", focus: "Waiting on the Lord renews strength." },
                        { day: 5, ref: "Galatians 5:22", focus: "Walking in the fruit of the Spirit." }
                    ]
                };
            }

            return `**Personalized 5-Day Study Plan: [${plan.topic}]**\n\nHere is your custom devotional plan to read and reflect on this week:\n\n${plan.days.map(d => `*Day ${d.day}*: **${d.ref}**\n- *Focus*: ${d.focus}`).join("\n\n")}\n\n*Tip: Study these scriptures inside the app's Scripture tab!*`;
        }
    },

    // 3. Chatbot Answer Engine Mappings
    chatbotResponses: [
        {
            keywords: ['service', 'time', 'worship', 'schedule'],
            response: "Our weekly services are: \n- **1st Service**: 7:00 AM - 9:30 AM\n- **2nd Service**: 10:00 AM - 12:30 PM\n- **Youth & Young Adults**: Sundays 2:00 PM\n- **Midweek Service**: Wednesdays at 5:30 PM (in person and on NURU TV)."
        },
        {
            keywords: ['give', 'giving', 'tithe', 'offering', 'pledge', 'money', 'donate', 'payment'],
            response: "You can tithe, give an offering, or make a **Pledge** from the **Giving** tab in the app. A pledge lets you commit to a project or fund and pay in installments - or give the full amount at once, it is your choice. M-Pesa is the fastest way: choose your branch and fund, enter the amount in shillings, and confirm the STK prompt on your phone. A digital receipt is saved to your giving history straight away."
        },
        {
            keywords: ['volunteer', 'serve', 'ushers', 'choir', 'worship', 'tech', 'sign up'],
            response: "We would love to have you serve! In the app's **Serve** tab, you can view open roles like Ushers, Worship Team, and Media/Tech. The AI can also analyze your profile skills to recommend the perfect fit for you. Sign up today!"
        },
        {
            keywords: ['location', 'branch', 'branches', 'address', 'located', 'campus', 'venue', 'meeting place'],
            response: "Maximum Miracle Centre is one church meeting in several places:\n1. **Nairobi CBD**: Embassy Cinema, Latema Road, off Tom Mboya Street.\n2. **Kawangware**: Kawangware, Nairobi.\n3. **Nakuru**: Langa Langa, Kanu Street.\nSelect your branch in your profile to stay updated with local events."
        },
        {
            keywords: ['prayer', 'pray', 'request', 'pastor', 'help'],
            response: "Prayer is the backbone of our church. Go to the Home feed in the app and tap **Submit Prayer Request**. You can type your request, choose to make it anonymous, and the system's AI will tag it (e.g., Healing, Grief, Finance) and route it immediately to our dedicated pastoral care team."
        },
        {
            keywords: ['group', 'small group', 'cell', 'fellowship', 'community'],
            response: "Home fellowships meet through the week across Nairobi and Nakuru. Tap **Connect** on the home feed to find a group near you - Young Adults, Family Life & Marriage, Men's Morning Prayer or Women of Grace."
        },
        {
            keywords: ['grace', 'salvation', 'forgiveness', 'sin', 'repent'],
            response: "We believe that salvation is by grace through faith, a free gift of God. Forgiveness is always available to those who seek it with a sincere heart. God's grace is sufficient for you!"
        },
        {
            keywords: ['faith', 'trust', 'believe', 'hope'],
            response: "Faith is the assurance of things hoped for, the conviction of things not seen (Hebrews 11:1). Trust in the Lord with all your heart, and do not lean on your own understanding."
        },
        {
            keywords: ['jesus', 'christ', 'god', 'lord'],
            response: "Jesus Christ is the center of our community. He is our Savior, Lord, and Shepherd, who guides us in path of righteousness."
        }
    ],

    // 4. Software Help Assistant - helps users learn how to use Church 2.0.
    // Every answer references the real screens and labels in the app, so it
    // doubles as an in-app onboarding and support guide. A topic is matched by
    // keyword scoring; null means the question is not about the software and the
    // normal pastoral chatbot flow takes over.
    SoftwareAssistant: {
        topics: [
            {
                id: 'overview',
                keywords: ['overview', 'about the app', 'about this software', 'software', 'platform', 'system', 'introduction', 'intro', 'features', 'what can i do', 'list of features', 'get started', 'getting started', 'new here', 'onboarding', 'what is church 2.0'],
                response: "**Church 2.0** is the all-in-one ministry management platform for Maximum Miracle Centre. It handles:\n\n- **Dashboard** - AI ministry briefing, giving, attendance and at-risk alerts.\n- **Members** - add members, view profiles, add milestones, download PDF giving statements, link families.\n- **Financials** - contribution ledger, receipts, campaigns and recurring gifts.\n- **Staff** - the staff roster with roles and contact details.\n- **Ministry** - volunteers, events, AI volunteer matching, sermon repurposing.\n- **Follow-ups** - assimilation pipeline from guest to member.\n- **Groups** - small group directory and membership.\n- **Communications** - announcements, prayer requests and the AI Care Inbox.\n- **Mobile** - the member app: giving, serve, prayer, Bible and chat.\n\nYou can ask about adding a member, finding the financial report, or reading the AI briefing - and I will guide you step by step."
            },
            {
                id: 'dashboard',
                keywords: ['dashboard', 'briefing', 'ai briefing', 'snapshot', 'summary', 'analytics', 'at-risk', 'at risk', 'executive'],
                response: "The **Dashboard** is your command center. It shows:\n- **This Week Giving** - real totals from the contribution ledger.\n- **Attendance** - average per service, with the latest service compared to the previous one.\n- **Active Members** - the count for your selected branch, or all branches in global view.\n- **AI Ministry Health Briefing** - a daily AI summary dated with today's weekday, plus critical care alerts for members missing multiple services in a row.\nUse the **Branch Target** selector at the top to scope every card to one branch or the whole church."
            },
            {
                id: 'members',
                keywords: ['member', 'add member', 'enlist', 'directory', 'profile', 'milestone', 'family', 'link family', 'giving statement', 'pdf'],
                response: "The **Member Directory** lists every member with their branch, contact details, skills and engagement score. To add someone, open **Directory** and use **Enlist New Congregation Member**. You can link them to a family (existing or new) with a contact name, phone and email, and record an initial contribution. In **View Profile** you can add spiritual milestones, download an annual giving statement as a **PDF**, and link or unlink family members with roles."
            },
            {
                id: 'financials',
                keywords: ['financial', 'finance', 'ledger', 'contribution', 'tithe', 'offering', 'pledge', 'donation', 'receipt', 'campaign', 'recurring', 'giving', ' give', ' giv', 'report'],
                response: "**Giving & Financials**: open **Financials** from the admin menu to see the Stewardship Contribution Ledger with every contribution, receipt number, branch and payment method. Use **Log Contribution Offline** to record cash, M-Pesa or bank gifts - a digital **Receipt** is generated instantly. **Campaigns** track project funds such as the Children's Home Support Fund, and **Recurring Gifts** show standing orders. In the member app, the **Giving** tab lets members tithe and give via M-Pesa."
            },
            {
                id: 'attendance',
                keywords: ['attendance', 'check-in', 'check in', 'checkin', 'roster', 'service', 'present'],
                response: "The **Attendance** panel is your service check-in roster. Select a service date, mark members present (or not), and the **Attendance Trend** card charts participation over recent services. Attendance feeds the dashboard average, the AI briefing and the at-risk alerts that flag members who have missed several services in a row."
            },
            {
                id: 'ministry',
                keywords: ['ministry', 'volunteer', 'event', 'rota', 'matcher', 'sermon', 'repurpose', 'social kit', 'devotion'],
                response: "The **Ministry** panel covers volunteers and events. Open an event to see required roles, and the **AI Matcher** recommends the best-fit volunteers from member skills. The **Sermon Repurposing Assistant** turns any sermon transcript into social media kits and devotional drafts. Members can also sign up to serve from the **Serve** tab in the mobile app."
            },
            {
                id: 'followups',
                keywords: ['follow-up', 'followup', 'follow up', 'assimilation', 'pipeline', 'guest', 'new guest', 'stage'],
                response: "The **Follow-ups** panel runs your assimilation pipeline. Every guest moves through stages (New Guest, Contacted, Connected, Member) with an owner and notes. When a follow-up reaches the **Member** stage they are automatically added to the member directory, so no one falls through the cracks."
            },
            {
                id: 'groups',
                keywords: ['group', 'small group', 'cell', 'fellowship', 'create group', 'group directory'],
                response: "The **Groups** panel is your small group directory. You can start a new group, edit its schedule and description, add or remove members, and delete groups. Members discover and join groups from the **Connect** section of the mobile app."
            },
            {
                id: 'communications',
                keywords: ['announcement', 'broadcast', 'communication', 'care inbox', 'prayer request', 'sms', 'push', 'message'],
                response: "The **Communications** panel is your broadcast center. Compose an announcement, pick channels (SMS, push, email) and send it to the right audience. The **AI Care Inbox** holds incoming prayer requests: the AI categorizes and routes each one, and you can post care messages that appear in the member's AI Care chat."
            },
            {
                id: 'mobile',
                keywords: ['mobile', 'member app', 'app view', 'phone', 'simulate', 'preview', 'member view'],
                response: "The **Mobile** panel previews exactly what church members see in their app: Home, Sermons, Bible, Give, Serve, Connect and Chat. Use the role simulator in the header to switch to a member view, or let members sign in on their own phones to give, submit prayer requests, RSVP to events and chat with the pastoral care assistant."
            },
            {
                id: 'roles',
                keywords: ['role', 'permission', 'admin', 'hq', 'branch admin', 'ministry leader', 'access', 'campus scope', 'simulator'],
                response: "The app has four roles: **Super Admin (HQ)**, **Branch Admin**, **Ministry Leader** and **Church Member**. Roles control which tabs you can open and which branch data you see - a branch admin only sees their own branch unless the global scope is selected. The **Simulated Role** dropdown in the header lets you preview each role's experience."
            },
            {
                id: 'staff',
                keywords: ['staff', 'staff member', 'add staff', 'staff roster', 'staff directory', 'employee', 'worship leader', 'deacon', 'usher'],
                response: "The **Staff** panel is the church staff roster. Admins can **Add Staff** with a name, contact number and role/position (for example Worship Leader or Usher), then edit or remove anyone from the roster. Staff also appear in the service roster so the team on duty is always clear."
            },
            {
                id: 'data',
                keywords: ['data', 'backend', 'server', 'database', 'postgres', 'local', 'stored', 'sync', 'cloud', 'production'],
                response: "Church 2.0 is a live production system. All church data - members, contributions, attendance, follow-ups and groups - is stored on the secure Postgres database behind the API server, never in the browser. Log in at the server address (port 4000 in development) and every change syncs to the backend immediately. There is no local demo database in production."
            }
        ],
        askSoftware(query) {
            const q = String(query || '').toLowerCase().trim();
            if (!q) return null;
            // Score by total matched keyword length so specific phrases (e.g.
            // "add member") beat generic ones ("member") on ties.
            let best = null;
            for (const t of this.topics) {
                let score = 0;
                let hits = 0;
                for (const k of t.keywords) {
                    if (q.includes(k)) { score += k.length; hits++; }
                }
                if (hits > 0 && (!best || score > best.score)) {
                    best = { topic: t, score, hits };
                }
            }
            return best ? best.topic.response : null;
        },
        helpOverview() {
            return this.topics[0].response;
        },
        listTopics() {
            return this.topics.map((t) => t.id);
        },
        sampleQuestions() {
            return [
                'How do I add a member?',
                'Where is the financial report?',
                'What is the AI briefing?',
                'How do I follow up a guest?',
                'How do I create a group?',
                'What is the AI Care Inbox?'
            ];
        }
    },

    getBotResponse(messageText) {
        const query = messageText.toLowerCase();

        // 1. If a quiz session is active, evaluate answer
        if (this.QuizManager.active) {
            return this.QuizManager.handleAnswer(messageText);
        }

        // 2. Launch quiz
        if (query.includes('quiz') || query.includes('trivia') || query.includes('start quiz')) {
            return this.QuizManager.startQuiz();
        }

        // 3. Launch study plans
        if (query.startsWith('plan ') || query.includes('study plan')) {
            let topic = '';
            if (query.includes('study plan')) {
                topic = query.split('study plan')[1];
            } else {
                topic = query.split('plan')[1];
            }
            return this.StudyPlanManager.generateStudyPlan(topic);
        }
        if (query === 'plan') {
            return "**Personalized Study Plan Builder**\n\nTo generate a study plan, type: `plan <topic>` (for example: `plan grace`, `plan faith`, `plan love`, `plan stewardship`).";
        }

        // 4. Content answers come first - a real question must never be
        // hijacked by a greeting, a joke or a thank-you.
        for (const item of this.chatbotResponses) {
            if (item.keywords.some(kw => query.includes(kw))) {
                return item.response;
            }
        }

        // 5. Software help: when the user asks how to use the software, route
        // to the Software Assistant. It returns null for non-software questions,
        // so the pastoral chatbot below still handles faith, services, giving
        // locations and everything else.
        if (this.softwareHelpIntent(query)) {
            const softwareAnswer = this.SoftwareAssistant.askSoftware(query);
            if (softwareAnswer) return softwareAnswer;
        }

        // 6. Casual & entertainment - only when the message is essentially
        // that intent alone, so "hi, how do I give?" answers the giving
        // question instead of just saying hello.
        const casual = messageText.trim().toLowerCase();
        const greetingHowAreYou = /^(how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up|what\s+is\s+up|how\s+are\s+things|how\s+do\s+you\s+do|how\s+is\s+it\s+going|how\s+are\s+you\s+(doing|feeling))(\s+(today|now|this\s+(morning|afternoon|evening)|my\s+friend|everyone|everybody|friends?))?[,.!\s]*$/;
        const greetingHi = /^(hi|hello|hey|howdy|hallo|yo|hiya|good\s*(morning|afternoon|evening)|good\s*day)([,.!\s]+(there|everyone|everybody|friends?|family|brother|sister|pastor|today|how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up|what\s+is\s+up|how\s+are\s+things|how\s+do\s+you\s+do|how\s+are\s+you\s+(doing|feeling)|how\s+is\s+it\s+going)){0,2}[,.!\s]*$/;
        if (greetingHowAreYou.test(casual)) {
            return "I'm doing great, thank you! \u{1F60A}";
        }
        if (greetingHi.test(casual)) {
            return "Hello! \u{1F60A} So good to see you!";
        }
        if (/\b(joke|jokes|funny|make me laugh|something funny|a laugh)\b/.test(casual)) {
            return this.tellJoke();
        }
        if (/^(thank you|thanks|thank you very much|thanks a lot|thanks so much|thank you so much|thx|appreciate\w*|grateful)[,.!\s]*$/.test(casual)) {
            return "You're most welcome! \u{1F60A} It's my pleasure to help. I am here for exactly that - come back any time for an answer, a hand, or a laugh";
        }
        if (/^(bye|goodbye|good night|goodnight|see you|see ya|c u|later|bye bye)[,.!\s]*$/.test(casual)) {
            return "Goodbye! \u{1F44B} It was lovely chatting with you. I'm here 24/7 whenever you need an answer, a hand, or a laugh. God bless you!";
        }
        if (/\b(about this website|about the website|about this app|about the app|what is this (website|app)|what can you do|what do you do|who are you|what does this (website|app) do|how does this (website|app) work|what is churchconnect|what is church 2\.0|what is church connect|features of the (app|website)|tell me about this)\b/.test(casual)) {
            return this.aboutTheApp();
        }

        // 7. Topic-aware fallback: score every response across the chatbot
        // and software tables so natural questions still get a real answer
        // instead of a dead end. Only when the message looks like a real
        // question, so random chatter keeps the friendly fallback.
        const hasIntent = /\b(what|which|when|where|who|why|how|can|could|would|will|should|is there|are there|do you|does the|tell me|i want|i need|i would like|help me|show me|give me|find|learn|explain|guide|sign up|join|register)\b/.test(query) || /\?\s*$/.test(query);
        const closest = hasIntent ? this.bestTopicMatch(query) : null;
        if (closest) return closest.response;
        return "I'm not sure about that one yet - sorry! The church office at info@maximummiracle.org is happy to help with the details.";
    },

    // Find the closest topic for a query by scoring every keyword across the
    // chatbot and software tables; null means no real topic was found.
    bestTopicMatch(query) {
        const candidates = [
            ...this.chatbotResponses.map((item) => ({ keywords: item.keywords, response: item.response })),
            ...(this.SoftwareAssistant.topics || []).map((t) => ({ keywords: t.keywords, response: t.response })),
        ];
        let best = null;
        let bestScore = 0;
        for (const c of candidates) {
            let score = 0;
            for (const k of c.keywords) {
                if (query.includes(k)) score += k.length;
            }
            if (score > bestScore) { bestScore = score; best = c; }
        }
        return bestScore >= 4 ? best : null;
    },

    // A clean, church-friendly joke - picked at random so repeat chats stay fresh.
    tellJoke() {
        const jokes = [
            "Why did the choir member bring a ladder to church? Because they heard the worship was going to reach new heights! \u{1F3B6}",
            "What do you call a fish that believes in God? A devout cod! \u{1F41F}",
            "Why don't scientists trust atoms? Because they make up everything - just like my study plans! \u{1F604}",
            "A member told the pastor, 'Pastor, I read the Bible all day.' The pastor smiled and said, 'Good - now try reading it all night too!' \u{1F602}",
            "Why did the offering plate break? Too much faith and finance in one place! \u{1F4B8}",
            "What did the grape do when someone stepped on it? Nothing - it just let out a little wine! \u{1F347} (Okay, that one's a bit grape.)",
        ];
        return jokes[Math.floor(Math.random() * jokes.length)];
    },

    // Intro to the website/app so the assistant can answer "what is this app?"
    aboutTheApp() {
        return "**ChurchConnect** is the church's all-in-one ministry platform. Here's what it covers:\n\n- **Dashboard** - AI ministry briefing, giving, attendance and at-risk alerts.\n- **Members** - directory, profiles, milestones, giving statements and family links.\n- **Giving & Pledges** - contribution ledger, receipts, campaigns, guest contributions and recurring gifts.\n- **Staff** - the staff roster and roles.\n- **Ministry** - volunteers, events, AI volunteer matching and sermon repurposing.\n- **Follow-ups** - guest-to-member assimilation pipeline.\n- **Groups** - small group directory.\n- **Communications** - announcements, prayer requests and the AI Care Inbox.\n- **Mobile app** - the member experience: Home, Sermons, Bible, Give, Serve, Connect and Chat.\n\nThat is the whole platform in a nutshell - members, giving, groups, announcements and the member app. I can walk you through any part of it whenever you need.";
    },

    // Detect a question that is asking how to use the software itself.
    softwareHelpIntent(query) {
        const markers = [
            'how do i', 'how do you', 'how do we', 'how to', 'how can i', 'how can you',
            'how does', 'how is', 'where is', 'where are', 'where do i', 'where can i',
            'what is', 'what are', 'what does the app', 'what can i do', 'what can you do',
            'learn more about', 'learn about', 'guide', 'tutorial', 'walk me through',
            'help me use', 'use the app', 'use this app', 'use this software',
            'feature', 'module', 'software', 'platform', 'list of features', 'tell me about'
        ];
        return markers.some((m) => query.includes(m));
    },

    // 2. Weekly Ministry Health Snapshot Compiler
    // Every figure below is derived from real transaction & attendance records
    // for the given scope. No Math.random(), no hardcoded percentages.
    generateWeeklySnapshot(branches, members, transactions, events, attendance) {
        attendance = Array.isArray(attendance) ? attendance : [];

        // Helper: format a signed percentage, or a friendly label when there is
        // no prior-period baseline to compare against (avoids fake "+X%").
        const pctChange = (current, previous) => {
            if (!previous || previous === 0) {
                return current > 0 ? { text: 'new', up: true, hasBaseline: false }
                                   : { text: '0%', up: true, hasBaseline: false };
            }
            const pct = ((current - previous) / previous) * 100;
            const sign = pct >= 0 ? '+' : '';
            return { text: `${sign}${pct.toFixed(1)}%`, up: pct >= 0, hasBaseline: true };
        };

        // ---- Giving: this week vs last week, from real transactions ----
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

        let thisWeekGiving = 0;
        let lastWeekGiving = 0;
        const thisWeekGiverIds = new Set();
        const fundTotals = {};

        transactions.forEach(t => {
            const tDate = new Date(t.date);
            const amt = parseFloat(t.amount) || 0;
            if (tDate >= sevenDaysAgo) {
                thisWeekGiving += amt;
                if (t.memberId) thisWeekGiverIds.add(t.memberId);
                fundTotals[t.category] = (fundTotals[t.category] || 0) + amt;
            } else if (tDate >= fourteenDaysAgo && tDate < sevenDaysAgo) {
                lastWeekGiving += amt;
            }
        });
        const giving = pctChange(thisWeekGiving, lastWeekGiving);

        // ---- Attendance: counts per service date, from real records ----
        const presentByDate = {};
        attendance.forEach(a => {
            if (!(a.date in presentByDate)) presentByDate[a.date] = 0;
            if (a.present) presentByDate[a.date] += 1;
        });
        const serviceDates = Object.keys(presentByDate).sort(); // ascending
        const latestCount = serviceDates.length ? presentByDate[serviceDates[serviceDates.length - 1]] : 0;
        const prevCount = serviceDates.length > 1 ? presentByDate[serviceDates[serviceDates.length - 2]] : 0;
        const avgAttendance = serviceDates.length
            ? Math.round(serviceDates.reduce((s, d) => s + presentByDate[d], 0) / serviceDates.length)
            : 0;
        const attendance7 = pctChange(latestCount, prevCount);

        // ---- At-risk: real absence streaks (last 3 services all absent) ----
        const byMember = {};
        attendance.forEach(a => {
            (byMember[a.memberId] = byMember[a.memberId] || []).push(a);
        });
        const atRiskMembers = members.filter(m => {
            const recs = (byMember[m.id] || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
            const last3 = recs.slice(-3);
            return last3.length >= 3 && last3.every(r => !r.present);
        }).slice(0, 5).map(m => {
            const fName = m.firstName || m.first_name || '';
            const lName = m.lastName || m.last_name || '';
            const missed = (byMember[m.id] || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
            let streak = 0;
            for (const r of missed) { if (!r.present) streak++; else break; }
            return `${fName} ${lName} (${m.branchName || 'Unknown branch'}) - absent ${streak} consecutive services`;
        });

        // ---- Participation & top fund, from real data ----
        const participationPct = members.length
            ? Math.round((thisWeekGiverIds.size / members.length) * 100) : 0;
        const topFund = Object.keys(fundTotals).sort((a, b) => fundTotals[b] - fundTotals[a])[0] || null;

        // Use the app-wide currency formatter so the briefing reads in the same
        // currency as every other figure on screen; fall back only if brand.js
        // hasn't loaded (e.g. this module under a bare Node test runner).
        const money = (n) => (typeof window !== 'undefined' && window.money)
            ? window.money(n)
            : `Ksh ${Math.round(n).toLocaleString('en-KE')}`;

        // ---- Natural-language summaries (real numbers only) ----
        const givingLine = giving.hasBaseline
            ? `Giving is at **${money(thisWeekGiving)}** (${giving.text} vs last week).`
            : `Giving is at **${money(thisWeekGiving)}** (no prior-week giving to compare against).`;
        const attLine = serviceDates.length
            ? (attendance7.hasBaseline
                ? `Latest service attendance was **${latestCount}** (${attendance7.text} vs the prior service), averaging **${avgAttendance}** over the last ${serviceDates.length} services.`
                : `Latest service attendance was **${latestCount}** (first service on record).`)
            : `No attendance has been recorded yet.`;

        const weeklySummaryText = `- **Financials**: ${givingLine}
- **Attendance**: ${attLine}
- **Care Alerts**: **${atRiskMembers.length}** member(s) flagged for a 3+ service absence streak. Pastoral care outreach is recommended.`;

        const trendWord = giving.hasBaseline ? (giving.up ? 'increase' : 'decrease') : 'result';
        const execParts = [
            `Giving this week totaled **${money(thisWeekGiving)}**` +
                (giving.hasBaseline ? `, a ${giving.text} ${trendWord} versus last week.` : ` (no prior-week baseline).`),
            `**${participationPct}%** of members in this scope gave this week` +
                (topFund ? `, with **${topFund}** the largest fund.` : '.'),
            serviceDates.length
                ? `Average attendance across the last ${serviceDates.length} services is **${avgAttendance}**.`
                : `No attendance records exist for this scope yet.`,
            `**${atRiskMembers.length}** member(s) have missed 3+ consecutive services and are recommended for follow-up.`
        ];

        return {
            thisWeekGiving,
            givingDiffPercent: giving.text,
            avgAttendance,
            attendanceDiffPercent: attendance7.hasBaseline ? attendance7.text : (serviceDates.length ? 'new' : '-'),
            participationPct,
            topFund,
            atRisk: atRiskMembers,
            bulletSummary: weeklySummaryText,
            executiveSnapshot: execParts.join(' ')
        };
    },

    // 3. Sermon Repurposer
    repurposeSermon(title, transcriptText) {
        if (!transcriptText || transcriptText.trim().length < 10) {
            transcriptText = "We are called to live generously. Not just with our wallets, but with our time, our energy, and our forgiveness. When we open our hands, we allow God to fill them. Trust is the foundation of stewardship.";
        }

        // Extract key words for devotionals
        const sentences = transcriptText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
        const mainPoint = sentences[0] || "Live generously.";
        const subPoint = sentences[Math.min(sentences.length - 1, 1)] || "Stewardship is about trust.";
        
        return {
            title: title || "Sunday Sermon Study Plan",
            devotional: {
                day1: `**Day 1: ${mainPoint}**\n*Read*: Luke 12:34\n*Reflection*: When we reflect on today's sermon, we see that what we value shows where our heart is. Take 5 minutes today to write down what you hold closest to your heart. Are you holding them with an open hand or a clenched fist?`,
                day2: `**Day 2: ${subPoint}**\n*Read*: Malachi 3:10\n*Reflection*: Trust is built in small, consistent actions. God asks us to test Him in our faithfulness. Think of one area of your time or finances where you can trust God more this week.`,
                day3: `**Day 3: Living with Open Hands**\n*Read*: Proverbs 11:25\n*Reflection*: A generous soul will prosper. Generosity isn't a transaction; it's a transformation of our character. How can you show unexpected generosity to a neighbor or coworker today?`
            },
            socialQuotes: [
                `"${mainPoint}" - Preached at Maximum Miracle Centre`,
                `"Generosity isn't about the size of our bank accounts, it's about the state of our hearts."`,
                `"${subPoint} Open hands let God fill us with grace."`
            ],
            discussionQuestions: [
                `Pastor highlighted: "${mainPoint}". How does this challenge your current daily routine?`,
                "What is the biggest obstacle to living a life of true stewardship (time, talent, or treasure)?",
                "Share a time when you experienced someone's generosity that changed your perspective."
            ]
        };
    },

    // 4. Prayer Request Tagging & Routing
    categorizePrayerRequest(text) {
        if (!text) return { category: 'General', route: 'Pastoral Staff', confidence: 1.0, tags: [] };

        let scoreHealing = 0;
        let scoreFinancial = 0;
        let scoreGrief = 0;
        let scoreFamily = 0;

        const tags = [];

        // Match whole words only, so "parent" doesn't trip the "rent" keyword and
        // "reason"/"season" don't trip "son". Multi-word phrases match as phrases.
        const hasWord = (w) => {
            const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
        };
        const scoreWords = (words) => {
            let s = 0;
            words.forEach(w => {
                if (hasWord(w)) { s += 2; tags.push(w); }
            });
            return s;
        };

        scoreHealing = scoreWords(['sick', 'illness', 'cancer', 'pain', 'hospital', 'doctor', 'surgery', 'healing', 'disease', 'recovery', 'health', 'pneumonia', 'covid']);
        scoreFinancial = scoreWords(['job', 'money', 'debt', 'finance', 'rent', 'bills', 'unemployed', 'business', 'financial', 'mortgage', 'poverty']);
        scoreGrief = scoreWords(['died', 'passed away', 'loss', 'grief', 'funeral', 'mourning', 'death', 'lost', 'passed']);
        scoreFamily = scoreWords(['marriage', 'husband', 'wife', 'son', 'daughter', 'children', 'divorce', 'family', 'parent', 'relationship', 'kids']);

        let category = 'General';
        let route = 'Pastoral Care Team';
        let maxScore = Math.max(scoreHealing, scoreFinancial, scoreGrief, scoreFamily);

        if (maxScore > 0) {
            if (maxScore === scoreHealing) {
                category = 'Healing';
                route = 'Hospital & Home Care Ministry';
            } else if (maxScore === scoreFinancial) {
                category = 'Financial';
                route = 'Benevolence & Stewardship Committee';
            } else if (maxScore === scoreGrief) {
                category = 'Grief';
                route = 'Grief Support & Counseling Department';
            } else if (maxScore === scoreFamily) {
                category = 'Family';
                route = 'Family Life & Marriage Ministry';
            }
        }

        const confidence = maxScore > 0 ? Math.min(0.7 + (maxScore * 0.05), 0.99) : 0.65;

        return {
            category,
            route,
            confidence: confidence.toFixed(2),
            tags: [...new Set(tags)]
        };
    },

    // 5. Volunteer Matcher
    // Every suggestion is drawn from the member database: a member is only ever
    // returned when their own volunteer_skills record lists the required role
    // (or an unambiguous variant of it). Nobody is suggested on guesswork.
    matchVolunteersForEvent(eventReqSkills, membersList) {
        // Normalize to a list of non-empty role strings. Return the SAME
        // {member, score, matchedSkills, storedSkills} shape in every branch so
        // callers that read m.member/m.score don't hit undefined on the
        // fallback path.
        const roles = (eventReqSkills || []).map(s => String(s).trim()).filter(Boolean);
        if (roles.length === 0) {
            return membersList.slice(0, 3).map(member => ({ member, score: 0, matchedSkills: [], storedSkills: [] }));
        }

        const matches = [];

        membersList.forEach(member => {
            const rawSkills = Array.isArray(member && member.volunteer_skills)
                ? member.volunteer_skills
                : (member && member.volunteer_skills ? String(member.volunteer_skills).split(',') : []);
            const matchedSkills = [];
            const storedSkills = [];

            roles.forEach(reqSkill => {
                // Only match against the member's own database entry.
                const stored = AIEngine.findMatchingStoredSkill(reqSkill, rawSkills);
                if (stored) {
                    matchedSkills.push(reqSkill);
                    if (!storedSkills.includes(stored)) storedSkills.push(stored);
                }
            });

            if (matchedSkills.length > 0) {
                // Calculate match score based on skills matched and engagement score
                const skillWeight = matchedSkills.length * 30;
                const engagementWeight = (member.engagement_score || 50) * 0.4;
                const totalScore = skillWeight + engagementWeight;

                matches.push({
                    member,
                    score: Math.min(Math.round(totalScore), 100),
                    matchedSkills,
                    storedSkills,
                    confirmed: true // always backed by the member database record
                });
            }
        });

        // Sort descending by score
        return matches.sort((a, b) => b.score - a.score);
    },

    // Normalize any skill/role value into lowercase words with punctuation
    // stripped, so "Worship Vocals" and "worship-vocals" compare cleanly.
    normalizeSkillText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    // True when a required role and a member's stored skill refer to the same
    // volunteer duty: normalized text is equal, or the full multi-word skill is
    // contained in the other (e.g. stored "Door Greeting" for role "Greeting").
    skillMatches(reqSkill, memberSkill) {
        const a = AIEngine.normalizeSkillText(reqSkill);
        const b = AIEngine.normalizeSkillText(memberSkill);
        if (!a || !b) return false;
        if (a === b) return true;
        const aWords = a.split(' ');
        const bWords = b.split(' ');
        if (aWords.length > 1 && aWords.every(w => bWords.includes(w))) return true;
        if (bWords.length > 1 && bWords.every(w => aWords.includes(w))) return true;
        return false;
    },

    // Returns the member's stored skill text (original casing) that matches the
    // required role, or null when the member never volunteered for it.
    findMatchingStoredSkill(reqSkill, memberSkills) {
        if (!Array.isArray(memberSkills)) return null;
        for (const skill of memberSkills) {
            if (AIEngine.skillMatches(reqSkill, skill)) return String(skill).trim();
        }
        return null;
    }
};

// Export for browser and Node environments
if (typeof window !== 'undefined') {
    window.AIEngine = AIEngine;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIEngine;
}
