# Church 2.0 - Competitive Benchmark & Gap Analysis

**Date:** July 2026
**Version:** 1.0
**Scope:** Benchmarks Church 2.0 against the leading church management (ChMS) and church-engagement platforms of 2025-2026, identifies feature and UX gaps, and defines a prioritized improvement roadmap.

> Competitor facts below were gathered from vendor sites, help centers, press releases, and third-party reviews (Capterra/G2/review blogs). Member-app UX conventions marked *(industry standard)* are well-established patterns observed across multiple platforms rather than single-source claims. Vendor pricing/AI claims are as of mid-2026 and change frequently.

---

## 1. The competitive landscape

| Platform | Positioning | Entry pricing | Signature strength | AI (2024-26) |
|---|---|---|---|---|
| **Planning Center** | Modular suite, pay-per-product | People free; products ~$15/mo each | Services scheduling + Music Stand + Check-Ins depth; free People w/ Workflows | AI list builder (beta), MCP for Claude/ChatGPT |
| **Pushpay / CCB (ChurchStaq)** | Enterprise giving + deep ChMS + analytics | Quote-only (~$199-1,500+/mo) | Donor-development funnel, engagement stages, Insights dashboard | AI People Search, AI Giving Data, Resi Studio AI clips, Genny bot (Dec 2025) |
| **Tithe.ly (incl. Breeze -> Tithely ChM)** | Budget all-in-one, giving-first | Giving free; All-Access $119/mo; Breeze $72/mo flat | Low-cost bundle, free migration, radical simplicity | TithelyAI data assistant (2025->2026), AI in Messaging |
| **Subsplash** | Media/app-first engagement | ~$99/mo + $499 setup (typical $300-800/mo) | Sermon hosting/streaming, TV apps, **Pulpit AI** (sermon -> 20+ assets) | Pulpit AI clipping/transcription/repurposing |
| **Rock RMS** | Free/open-source, developer-extensible | Free (self-host + expertise) | Lava templating, workflow engine, first-class Campus entity | AI prayer moderation, community GPT recipes, AI agents (preview) |
| **FellowshipOne (Ministry Brands)** | Legacy enterprise multi-campus | Quote-only (~$179-1,999/mo) | Check-in suite, background-check-integrated volunteering, deep reporting | None first-party verified |
| **ChurchTrac** | Cheapest all-in-one | Free <=100; ~$7-9/mo; caps ~$105/mo | **Built-in fund accounting** + worship planning at lowest cost | None (verified absent) |
| **Aplos** | Fund-accounting-first | $79-229+/mo | True fund accounting, dimensional budgeting | None verified |
| **Gloo** | Engagement/data/AI layer (not a ChMS) | Free tier; Gloo+ $49/mo | Church-health dashboard, KALLM faith-aligned AI, Faith Assistant | KALLM, Aspen, AI Studio, Faith Assistant |

**Read of the market:**
1. **AI arrived in force in 2025-2026.** Every serious platform now ships (or is piloting) natural-language data queries and/or sermon repurposing. Church 2.0's "AI engine" concept is *on-trend* - but its implementation is heuristic and partly fabricated (see Section 4).
2. **Two UX philosophies win:** Planning Center's *deep, modular power* and Breeze/ChurchTrac's *radical simplicity*. The universal complaint against enterprise tools (FellowshipOne, CCB) is **dated, clunky UI** - which is exactly where a modern, well-designed app can differentiate.
3. **Multi-campus is a real dividing line.** Planning Center, Rock, Pushpay, and Subsplash treat *Campus* as a first-class object with per-campus giving/reporting; Breeze and ChurchTrac fake it with tags/separate accounts and **can't split finances by campus**. Church 2.0's multi-branch model is genuinely differentiated *if* the per-campus data is real.

---

## 2. Table-stakes features (every serious ChMS has these)

Grouped by whether Church 2.0 has them today:

### Have (at least in prototype form)
- People/membership database with families & profiles
- Contribution logging + receipts + CSV export
- Event listing + RSVP
- Volunteer roster / basic scheduling
- Giving by fund/designation
- Member-facing app surface (sermons, giving, scripture, serve)
- Multi-campus switching
- Basic reporting dashboard

### Partial / weak
- **Attendance tracking** - dashboard shows a number, but it's **randomly generated**, not recorded. No check-in.
- **Giving** - no recurring gifts, no pledges/campaigns, no annual tax statements, no payment processing.
- **Communications** - prayer inbox only; **no outbound email/SMS/push**.
- **Reporting** - fixed cards; no custom lists/filters, no per-member giving history export.

### Missing (industry table stakes)
- **Child check-in with security/name-tag printing** *(industry standard; safety-critical)*
- **Annual/quarterly giving statements** for tax (IRS-required donor documentation)
- **Recurring giving** + cover-the-fees option *(industry standard)*
- **Pledge campaigns** with progress tracking
- **Groups** (small-group management, separate from ministries)
- **Follow-up workflows / assimilation pipelines** (new-visitor -> member tracks) - a headline feature of Planning Center, CCB, Breeze
- **Forms / digital connect cards**
- **Background-check tracking** for volunteers
- **Fund accounting** (ChurchTrac/Aplos/Realm differentiator)
- **Authentication & role security** (real, not simulated)

---

## 3. Differentiators worth chasing (where Church 2.0 could stand out)

| Differentiator | Who does it | Opportunity for Church 2.0 |
|---|---|---|
| Natural-language data queries | Planning Center, Pushpay, Tithe.ly | Add an "Ask your data" box that generates real filters over the local DB |
| Sermon -> multi-asset repurposing | Subsplash Pulpit AI, Pushpay Studio AI | Already prototyped - deepen the sermon repurposer output |
| Church-health / engagement scoring | Pushpay Insights, Gloo | Already have engagement score - make it *data-driven* (attendance + giving + serving) |
| Assimilation/follow-up workflows | Planning Center, CCB, Breeze | High-value, low-infra: a visitor->member pipeline board |
| First-class multi-campus finance | Planning Center, Pushpay, Rock | Real per-campus giving/attendance rollups (a Breeze/ChurchTrac weakness) |
| Beautiful, fast, modern UI | (the gap everyone complains about) | **This is Church 2.0's core edge** - keep it |

---

## 4. Gap analysis vs. Church 2.0 (scorecard)

Scale: competitive - partial - missing/broken

| Capability | Best-in-class bar | Church 2.0 | Score |
|---|---|---|---|
| Visual design / UX polish | Modern, fast (PC, Subsplash apps) | Strong, modern, 3 themes | |
| Membership DB | Profiles, households, custom fields, lists | Profiles + families + milestones; no custom fields/lists | |
| **Attendance** | Check-in stations, trends, per-campus | **Randomized number, no records** | |
| Giving - logging | Batch, funds, methods | Manual logging + receipts | |
| Giving - recurring | One-tap recurring, cover fees | None | |
| Giving - pledges/campaigns | Progress bars, per-fund | None | |
| Giving - tax statements | Instant annual/quarterly | None | |
| Volunteer scheduling | Accept/decline, availability, matrix | Assign/remove + AI match | |
| Groups | Small-group mgmt, self-join | None (ministries only) | |
| Communications | Email + SMS + push + templates | Prayer inbox only | |
| Follow-up / assimilation | Workflow pipelines + automations | None | |
| Child check-in / safety | Security codes, name tags, background checks | None | |
| Reporting | Custom lists, exports, per-campus | Fixed cards + CSV | |
| AI - data queries | NL -> filters/insights | Heuristic chatbot | |
| AI - sermon repurposing | 20+ assets (Pulpit AI) | Devotional + quotes + Qs | |
| AI - integrity | Data-derived | **Fabricated stats (random attendance, hardcoded %s)** | |
| Member app - giving | Apple/Google Pay, text-to-give | Form + success screen | |
| Member app - scripture | YouVersion-grade (plans, streaks, VOTD) *(industry standard)* | 11 mock verses, filter | |
| Multi-campus finance | First-class per-campus rollups | Branch switch (data real) | |
| Auth & security | SSO, RBAC, MFA | Simulated role dropdown | |
| Backend / persistence | Cloud DB, sync | localStorage only | |

**Headline finding:** Church 2.0's **design and breadth of surfaces already rival the leaders**, but three things hold it back from credibility: (1) **fabricated data** (random attendance, hardcoded briefing stats) undermines every analytics claim; (2) **giving is a shell** (no recurring/pledges/statements - the features churches actually pay for); (3) **no real backend/auth**. The design lead is real; the substance needs to catch up.

---

## 5. Member-app UX best practices to adopt

*(Synthesized from Church Center, Subsplash, Tithe.ly, Pushpay member experiences and established YouVersion/giving conventions.)*

**Giving UX checklist** *(industry standard)*
- [ ] Quick-amount chips ($25/$50/$100/custom) instead of raw number entry
- [ ] One-tap **recurring** toggle (weekly/monthly) at point of giving
- [ ] **Cover the processing fee** opt-in checkbox
- [ ] Apple Pay / Google Pay / saved methods (real processing = future)
- [ ] Text-to-give keyword flow
- [ ] Self-service **giving history + downloadable statement**
- [ ] Campus + fund selectors (Church 2.0 has these)

**Scripture/devotional (YouVersion patterns)**
- Verse of the Day + shareable verse image
- Reading **plans** with day-by-day progress and **streaks**
- Save/highlight/bookmark verses

**Engagement/assimilation**
- Digital **connect card** for first-time guests
- "**Next steps**" cards (baptism, membership, join a group)
- Push notifications for events, giving reminders, new sermons
- Prayer wall / group chat

---

## 6. Prioritized improvement roadmap

Sequenced for **maximum credibility gain per unit of work**, staying within the app's no-backend constraint (everything runs client-side on the seeded DB) unless noted.

> **Implementation status (July 2026):** Phases 1-4 and the client-side-feasible parts of Phase 5 are **complete** - real attendance/analytics, attendance & check-in, recurring giving + pledges + tax statements, the assimilation pipeline, small groups, broadcast announcements, scripture reading plans/streaks/VOTD, and a login + MFA-mock + RBAC gate. Remaining: a real cloud backend, live payment processing, and production auth (Phase 5's server-side portion), which require infrastructure beyond this client-side app.

### Phase 1 - Integrity (make the analytics honest) <- *doing first*
1. Add real **attendance records** to the DB; derive dashboard attendance & week-over-week change from data (remove `Math.random`).
2. Rewrite the AI weekly briefing to report **only real, computed numbers** (no hardcoded 82% / 8% / 10:30 AM).
3. Fix prayer classifier to use **word-boundary matching** (stop "pa**rent**" -> rent).

### Phase 2 - Attendance & check-in module
4. New **Attendance** admin tab: per-service check-in roster, weekly trend chart, per-campus rollup.
5. Drive **at-risk detection** from real absence streaks feeding the engagement score.

### Phase 3 - Giving that churches pay for
6. **Recurring giving** schedules (member app + admin visibility).
7. **Pledge campaign** with live progress bar toward a goal.
8. **Annual giving statement** - printable, per member, tax-ready.
9. Member giving UX: quick-amount chips + cover-the-fees toggle.

### Phase 4 - Engagement & communications (later)
10. **Follow-up pipeline** board (visitor -> member) - assimilation workflows.
11. **Groups** module (distinct from ministries) with self-join.
12. Broadcast **announcements** surface (email/SMS/push simulation).
13. Scripture **reading plans + streaks**; Verse of the Day.

### Phase 5 - Foundations (requires backend decision)
14. Real **auth + RBAC**, cloud persistence, and payment processing - the jump from prototype to product.

---

## 7. Bottom line

Church 2.0 is a **design-leading prototype** in a market whose incumbents are criticized precisely for *poor* UX. That's a genuine opening. To convert it into a credible product, the priority is not more surfaces - it's making the existing ones **honest and functional**: real attendance, real giving depth (recurring/pledges/statements), and a real backend. Phases 1-3 close the most damaging credibility gaps without leaving the client-side constraint; Phases 4-5 build toward parity and launch.
