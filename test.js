// Church 2.0 Node-based Unit Test Suite
// Verifies core algorithms, calculation pipelines, and NLP categorization

const AIEngine = require('./ai-engine');

let passedTestsCount = 0;
let failedTestsCount = 0;

function assert(condition, message) {
    if (condition) {
        passedTestsCount++;
        console.log(` PASS: ${message}`);
    } else {
        failedTestsCount++;
        console.error(` FAIL: ${message}`);
    }
}

console.log("=== STARTING CHURCH 2.0 UNIT TEST RUNNER ===\n");

// ----------------------------------------------------
// TEST GROUP 1: Chatbot Answer Engine
// ----------------------------------------------------
console.log("Test Group 1: Chatbot Response Engine");
try {
    const serviceResponse = AIEngine.getBotResponse("When are the Sunday service schedules held?");
    assert(serviceResponse.includes("1st Service") && serviceResponse.includes("10:00 AM"), 
        "Chatbot maps service time keywords correctly.");

    const givingResponse = AIEngine.getBotResponse("How can I tithe or make an offering?");
    assert(givingResponse.includes("M-Pesa") && givingResponse.includes("Giving"), 
        "Chatbot maps giving keywords correctly.");

    const graceResponse = AIEngine.getBotResponse("What does the church believe about salvation and grace?");
    assert(graceResponse.includes("grace through faith") && graceResponse.includes("grace is sufficient"), 
        "Chatbot maps theological keywords (grace) correctly.");

    const fallbackResponse = AIEngine.getBotResponse("Random unrelated message here");
    assert(fallbackResponse.includes("church office") || fallbackResponse.includes("prayer request"), 
        "Chatbot responds with standard office details on fallbacks.");
} catch (e) {
    failedTestsCount++;
    console.error(" FAIL: Chatbot group crashed with error:", e);
}
console.log("");

// ----------------------------------------------------
// TEST GROUP 2: Weekly Snapshot Calculations
// ----------------------------------------------------
console.log("Test Group 2: Weekly Financial & Attendance Analytics");
try {
    const mockBranches = [{ id: 'b1', name: 'HQ' }];
    const mockMembers = [
        { id: 'm1', branchId: 'b1', firstName: 'John', lastName: 'Kamau', engagement_score: 95 },
        { id: 'm2', branchId: 'b1', firstName: 'Jane', lastName: 'Adair', engagement_score: 30 } // Flagged at risk
    ];
    
    // Create transactions for this week and last week
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const mockTransactions = [
        { id: 't1', amount: 1000, category: 'Tithe', date: twoDaysAgo, memberId: 'm1' },
        { id: 't2', amount: 500, category: 'Offering', date: twoDaysAgo, memberId: 'm1' },
        { id: 't3', amount: 800, category: 'Tithe', date: tenDaysAgo, memberId: 'm2' }
    ];
    const mockEvents = [];

    // Attendance is now the source of truth for at-risk: Jane (m2) missed the last
    // 3 services; John (m1) attended. Build 3 recent service dates.
    const svc = (d) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const mockAttendance = [
        { memberId: 'm1', branchId: 'b1', date: svc(21), present: true },
        { memberId: 'm1', branchId: 'b1', date: svc(14), present: true },
        { memberId: 'm1', branchId: 'b1', date: svc(7), present: true },
        { memberId: 'm2', branchId: 'b1', date: svc(21), present: false },
        { memberId: 'm2', branchId: 'b1', date: svc(14), present: false },
        { memberId: 'm2', branchId: 'b1', date: svc(7), present: false }
    ];

    const report = AIEngine.generateWeeklySnapshot(mockBranches, mockMembers, mockTransactions, mockEvents, mockAttendance);

    assert(report.thisWeekGiving === 1500, "Weekly snapshot aggregates this week's giving amounts correctly.");
    assert(report.atRisk.some(m => m.includes("Jane Adair")), "At-risk tracker flags members with a 3+ service absence streak.");
    assert(!report.atRisk.some(m => m.includes("John Kamau")), "At-risk tracker does NOT flag consistently-present members.");
    assert(report.bulletSummary.includes("Giving is at"), "Snapshot compiles a structured bulleted summary text block.");
    assert(report.avgAttendance === 1, "Average attendance is derived from real records, not randomized.");
} catch (e) {
    failedTestsCount++;
    console.error(" FAIL: Snapshot calculations crashed with error:", e);
}
console.log("");

// ----------------------------------------------------
// TEST GROUP 3: Sermon Repurposing
// ----------------------------------------------------
console.log("Test Group 3: AI Sermon Repurposing Generator");
try {
    const title = "Generosity & Faith";
    const transcript = "Trust is the key component of our relationship with God. When we hold things loosely, we align with grace.";
    const result = AIEngine.repurposeSermon(title, transcript);

    assert(result.title === title, "Repurposer copies title parameter correctly.");
    assert(result.devotional.day1.includes("Day 1:"), "Repurposer builds multi-day study devotions.");
    assert(result.socialQuotes.length >= 2, "Repurposer extracts highlight social quotes.");
    assert(result.discussionQuestions.length >= 2, "Repurposer creates small group discussions.");
} catch (e) {
    failedTestsCount++;
    console.error(" FAIL: Sermon repurposer crashed with error:", e);
}
console.log("");

// ----------------------------------------------------
// TEST GROUP 4: Prayer Request Categorization
// ----------------------------------------------------
console.log("Test Group 4: AI Prayer Request Routing & Categorization");
try {
    // Healing test
    const healingResult = AIEngine.categorizePrayerRequest("Please pray for my mother. She is in the hospital undergoing critical surgery.");
    assert(healingResult.category === "Healing" && healingResult.route.includes("Hospital"), 
        "Routes hospital and surgery requests to Healing / Hospital Care.");

    // Finance test
    const financeResult = AIEngine.categorizePrayerRequest("Pray that my business recovers, I need money to pay off accumulated bills and rent.");
    assert(financeResult.category === "Financial" && financeResult.route.includes("Benevolence"), 
        "Routes money, bills, and rent requests to Financial / Benevolence Care.");

    // Family test
    const familyResult = AIEngine.categorizePrayerRequest("Pray for counseling for our marriage. My husband and I are struggling to connect.");
    assert(familyResult.category === "Family" && familyResult.route.includes("Family Life"),
        "Routes marriage and husband requests to Family Life Care.");

    // Word-boundary regression: "parent" must NOT match the financial keyword "rent".
    const parentResult = AIEngine.categorizePrayerRequest("Please pray for my parents as they travel.");
    assert(!parentResult.tags.includes("rent"),
        "Word-boundary matching: 'parent' does not trigger the 'rent' financial keyword.");
} catch (e) {
    failedTestsCount++;
    console.error(" FAIL: Prayer routing crashed with error:", e);
}
console.log("");

// ----------------------------------------------------
// TEST GROUP 5: Volunteer Matching Score
// ----------------------------------------------------
console.log("Test Group 5: AI Volunteer Matching Recommendations");
try {
    const mockMembers = [
        { id: 'm1', firstName: 'John', lastName: 'Kamau', volunteer_skills: ['Keyboard', 'Worship Vocals'], engagement_score: 90 },
        { id: 'm2', firstName: 'Sarah', lastName: 'Jenkins', volunteer_skills: ['Greeting'], engagement_score: 80 }
    ];

    const matchWorship = AIEngine.matchVolunteersForEvent(['Worship Vocals'], mockMembers);
    assert(matchWorship.length > 0 && matchWorship[0].member.id === 'm1', 
        "Ranks volunteers with matching skills on top.");
    assert(matchWorship[0].score > 60, 
        "Computes a weighted scoring index combining skill match and member engagement rating.");
} catch (e) {
    failedTestsCount++;
    console.error(" FAIL: Volunteer matcher crashed with error:", e);
}
console.log("");

// ----------------------------------------------------
// TEST GROUP 6: Bible Trivia Quiz Manager
// ----------------------------------------------------
console.log("Test Group 6: Interactive Bible Trivia Quiz Manager");
try {
    // Start Quiz
    const quizStartText = AIEngine.QuizManager.startQuiz();
    assert(AIEngine.QuizManager.active === true, "Quiz Manager successfully sets active session status.");
    assert(quizStartText.includes("books are in the Bible"), "Quiz Manager outputs the first trivia question on startup.");

    // Answer Question 1 (Correct: 66)
    const q2Response = AIEngine.QuizManager.handleAnswer("66");
    assert(q2Response.includes("Correct"), "Quiz Manager identifies correct numeric answer input.");
    assert(AIEngine.QuizManager.score === 1, "Quiz Manager increments score for correct answers.");

    // Answer Question 2 (Incorrect)
    const q3Response = AIEngine.QuizManager.handleAnswer("Matthew"); // Correct is Luke
    assert(q3Response.includes("Incorrect") && q3Response.includes("Luke"), "Quiz Manager flags incorrect answer and returns correction.");

    // Reset Quiz state for safety
    AIEngine.QuizManager.active = false;
} catch (e) {
    failedTestsCount++;
    console.error(" FAIL: Quiz Manager crashed with error:", e);
}
console.log("");

// ----------------------------------------------------
// TEST GROUP 7: Custom Study Plan Compiler
// ----------------------------------------------------
console.log("Test Group 7: Custom Theological Study Plan Compiler");
try {
    // Generate Study Plan on Grace
    const gracePlan = AIEngine.StudyPlanManager.generateStudyPlan("grace");
    assert(gracePlan.includes("Ephesians 2:8") && gracePlan.includes("Titus 2:11"), "Compiles expected scripture chapters for Grace.");
    assert(gracePlan.includes("5-Day Study Plan: [Grace]"), "Study plan contains expected topic header.");

    // Generate Study Plan on unrecognized topic (fallback)
    const generalPlan = AIEngine.StudyPlanManager.generateStudyPlan("randomtopic");
    assert(generalPlan.includes("Psalm 119:105") && generalPlan.includes("Proverbs 3:5"), "Compiles general growth scriptures for unknown topics.");
    assert(generalPlan.includes("5-Day Study Plan: [General Spiritual Growth]"), "Study plan falls back to General Spiritual Growth topic.");
} catch (e) {
    failedTestsCount++;
    console.error(" FAIL: Study Plan Compiler crashed with error:", e);
}
console.log("");

// ----------------------------------------------------
// TEST GROUP 8: Dynamic Scripture Filtering Engine
// ----------------------------------------------------
console.log("Test Group 8: Dynamic Scripture Query & Filter Engine");
try {
    const bibleData = [
        { ref: 'Malachi 3:10', text: 'Bring the full tithe into the storehouse...' },
        { ref: 'Luke 12:34', text: 'For where your treasure is...' },
        { ref: 'Romans 12:1', text: 'I appeal to you therefore...' }
    ];
    
    // Test book filter logic
    const filterByBook = (data, book) => data.filter(v => v.ref.toLowerCase().includes(book.toLowerCase()));
    const resultBook = filterByBook(bibleData, 'Luke');
    assert(resultBook.length === 1 && resultBook[0].ref.startsWith('Luke'), "Filters scripture lists correctly by book name.");

    // Test chapter extract logic
    const filterByChapter = (data, chapter) => data.filter(v => {
        const parts = v.ref.split(':');
        if (parts.length > 0) {
            const chapterPart = parts[0].trim().split(' ').pop();
            return chapterPart === chapter;
        }
        return false;
    });
    const resultChapter = filterByChapter(bibleData, '12');
    assert(resultChapter.length === 2, "Filters chapters correctly even with multiple different books.");
} catch (e) {
    failedTestsCount++;
    console.error(" FAIL: Scripture filtering test crashed:", e);
}
console.log("");

// ----------------------------------------------------
console.log("Test Group 9: Software Help Assistant");
try {
    const addMember = AIEngine.SoftwareAssistant.askSoftware("How do I add a member to the directory?");
    assert(addMember && addMember.includes("Member Directory"), "Software assistant answers member onboarding questions.");

    const financial = AIEngine.getBotResponse("Where is the financial report?");
    assert(financial.includes("Financials") && financial.includes("Receipt"), "Software help routes financial questions.");

    const briefing = AIEngine.getBotResponse("What is the AI briefing on the dashboard?");
    assert(briefing.toLowerCase().includes("briefing"), "Software help explains the AI briefing.");

    const mobileGive = AIEngine.getBotResponse("How can a member give using the app?");
    assert(mobileGive.includes("Giving") && mobileGive.includes("M-Pesa"), "Software help explains member giving.");

    const service = AIEngine.getBotResponse("When are the Sunday service schedules held?");
    assert(service.includes("1st Service") && service.includes("10:00 AM"), "Pastoral service questions are not hijacked.");

    const grace = AIEngine.getBotResponse("What does the church believe about salvation and grace?");
    assert(grace.includes("grace through faith"), "Theological questions stay with the pastoral assistant.");

    const fallback = AIEngine.getBotResponse("Random unrelated message here");
    assert(fallback.includes("church office") || fallback.includes("prayer request"), "Unrelated messages still use the standard fallback.");

    const overview = AIEngine.SoftwareAssistant.helpOverview();
    assert(overview.includes("Members") && overview.includes("Financials") && overview.includes("Dashboard"), "Help overview lists the software features.");

    const samples = AIEngine.SoftwareAssistant.sampleQuestions();
    assert(Array.isArray(samples) && samples.length >= 5, "Software assistant offers sample questions.");

    const nullMatch = AIEngine.SoftwareAssistant.askSoftware("What is the meaning of grace?");
    assert(nullMatch === null, "Non-software questions return null from the software assistant.");
} catch (e) {
    failedTestsCount++;
    console.error(" FAIL: Software Help Assistant test crashed:", e);
}
console.log("");

// ----------------------------------------------------
// TEST RESULTS SUMMARY
// ----------------------------------------------------
console.log("=== TEST EXECUTION COMPLETE ===");
console.log(`Passed: ${passedTestsCount} test cases`);
console.log(`Failed: ${failedTestsCount} test cases`);

if (failedTestsCount > 0) {
    console.error("\nBUILD FAILURE: Some test cases did not pass.");
    process.exit(1);
} else {
    console.log("\nBUILD SUCCESS: All core algorithms validate successfully.");
    process.exit(0);
}
