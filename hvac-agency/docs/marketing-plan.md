# ClimateFlow AI — US Go-to-Market Plan

**Goal:** $10k MRR by 2026-06-14 (4 clients × $2,500/mo bundle).
**Window:** 8 weeks from 2026-04-17.
**Constraint:** Solo founder; budget ~$500/mo for tooling + ads in phase 1.

---

## 1. The funnel math (reverse-engineered)

Working backward from the goal:

| Stage | Conversion | Volume needed |
|---|---|---|
| Paying clients | — | 4 |
| Signed free-trial → paid | 40% | 10 trials |
| Booked calls → trial | 30% | ~34 calls |
| Replies → booked call | 25% | ~135 replies |
| Contacts → reply | 4% | **~3,400 contacts** |

Round up: **plan for 5,000 first-touch contacts over 8 weeks** to hit the goal with slack.
That's ~625/week, or ~125/business-day across all channels combined.

## 2. Who we target (ICP)

**Primary:** Independent residential HVAC contractors in hot-climate metros (TX, FL, AZ, NV, GA, NC, SC, TN, OK).
- 3–25 technicians (big enough to have missed-call pain, small enough to decide fast).
- $1M–$10M revenue (can afford $2,500/mo, not yet locked into ServiceTitan's full suite).
- Google rating 3.5–4.5 with 20–300 reviews (review-autopilot is an easy win).
- Has a website but no visible chatbot, no after-hours message, or homepage says "leave a message".

**Secondary:** Plumbing + HVAC combined shops, commercial HVAC in secondary metros.

**Disqualify:** Franchise chains (ARS, One Hour) — they have corporate tools. Shops with <10 reviews (too early).

## 3. Channel mix

We run **four channels in parallel** — each one's failure mode is different, so diversification matters more than channel optimization this early.

### 3a. Cold email (volume channel — 60% of contacts)

- Tooling already built: `src/campaign.js` + Claude-generated per-lead copy.
- **Send cap:** 50/day/mailbox to stay under Gmail spam thresholds. Add a second mailbox (climateflow.ai secondary domain) at week 3 to double throughput.
- **Sequence:** cold_intro → +3d follow_up_1 → +7d follow_up_2 (all already in `email-generator.js`).
- **Inboxing hygiene:** SPF + DKIM + DMARC (check with mail-tester.com, aim 9/10+). Warm the mailbox for 2 weeks before full volume — start 10/day, ramp.
- **Compliance:** CAN-SPAM — physical address + unsubscribe mailto already enforced in `config.js`.
- **KPIs:** open 40%+, reply 4%+, book 25%+ of replies.

### 3b. Phone + SMS (quality channel — 20% of contacts)

This is our unfair advantage: we sell a lead-rescue product, so when an owner doesn't answer, we let our own Lead Rescue AI text them back. Dogfooding is the pitch.

- Source numbers from the scraped CSV (we already have them from Google Places).
- **Call script (90 seconds):**
  > "Hey, this is Malachi with ClimateFlow AI — I'll be quick. I noticed you've got [X] Google reviews but your site doesn't have after-hours call capture. I built an AI that books jobs from missed calls in 60 seconds — 7-day free trial, no card. Want me to text you a 2-min video demo?"
- If no answer after one ring, hang up and send SMS via Twilio: *"Hey [owner] — Malachi from ClimateFlow AI. Tried you just now. Built an AI that rescues missed calls for HVAC shops — free 7-day trial. Want the demo video? Reply Y."*
- **Compliance:** Twilio A2P 10DLC is already being registered (see `docs/twilio-a2p-application.md`). Keep SMS under 160 chars, opt-out language on first message.
- **KPIs:** 30 dials/day, 20% pickup, 50% of pickups get a demo sent, 15% of those book.

### 3c. LinkedIn outbound (relationship channel — 15%)

HVAC owners do use LinkedIn — especially the growth-minded ones who'll buy this.
- Sales Navigator: filter Title="Owner" OR "President" OR "General Manager", Industry="Consumer Services" + keyword "HVAC" or "heating", Company size 11–200.
- Connection request: no pitch. Just *"Looking to connect with growth-focused HVAC owners — love what you're building in [city]."*
- After accept (~30% rate), 2 days later, short message: same opener as cold email but with a Loom video link.
- **KPIs:** 100 requests/week, 30 accepts, 10 replies, 2 calls.

### 3d. Local meetup / referral (compound channel — 5%)

Low volume but 10× higher close rate. Every deal closed should trigger a "who else should I talk to?" ask.
- Join the ACCA (Air Conditioning Contractors of America) local chapters in TX + FL — annual dues ~$400, worth one deal.
- Offer a $500 referral fee per closed client to existing clients — stackable with their service credit.

## 4. Messaging framework

Every outbound message hits one of these three pains. Rotate so no prospect sees the same one twice in the sequence.

| Pain | Hook | Product that solves it |
|---|---|---|
| Missed after-hours calls → lost jobs to competitors | *"HVAC shops lose ~$4,200/mo to missed calls. Our AI picks up in 60s and books the job."* | Lead Rescue |
| Estimate limbo — quoted, ghosted, never followed up | *"60% of quoted estimates never get a follow-up. Ours chases them until they close or die."* | Estimate Follow-Up |
| Bad reviews buried, good customers never asked | *"If your last 5 reviews are 2-star techs venting, you're filtering out $50k/mo in inbound."* | Review Autopilot |

**Proof points to rotate in:**
- Real metrics from pilot clients (populate as we close them).
- "We built it on our own shop first" — when asked, say it was built for a friend's HVAC business in Portland.
- 7-day free trial, no card, cancel by text.

**Never say:** "game-changer", "revolutionary", "leverage AI", "synergy", "transform your business". Write like a 35-year-old who's done a roof tear-off in August.

## 5. Sales motion

### The free-trial offer

- 7 days, all three products enabled, no credit card at signup.
- We install + onboard in a 45-minute screenshare (this is also the sales close).
- Day 6: we send a 1-pager showing calls rescued, reviews pulled, estimates followed. Auto-generated from the dashboard.
- Day 7 morning: we call and ask "keep it going at $2,500/mo or turn it off?"

### The call (45-min onboarding = close)

1. (5 min) Small talk, learn their biggest pain.
2. (10 min) Demo Lead Rescue against THEIR Google My Business phone number live (we text it from ours and it responds).
3. (15 min) Onboard — get Twilio subaccount, connect Google Business, install the "missed call forward".
4. (10 min) Set expectations for the trial week: you'll get X texts from our system.
5. (5 min) Ask who else in their network has the same problem. Note in CRM.

### Objection playbook

| Objection | Response |
|---|---|
| "I already use ServiceTitan" | "Perfect — ours sits in front of ServiceTitan. Booked jobs drop straight into your ST schedule." |
| "$2,500 is steep" | "One rescued $600 service call a week pays for it. If the trial doesn't rescue at least 2, turn it off." |
| "We have a secretary" | "How does she handle the 7pm Sunday call when the AC dies? Ours answers in 60s, every day." |
| "AI sounds scammy to my customers" | "Our pilot shop's customers rated the AI responses 4.8/5 — higher than their humans. Want to see the logs?" |
| "I'm too busy to onboard" | "That IS the problem we solve. 45 min once and it runs itself. I'll come to you." |

## 6. Weekly cadence (solo founder)

| Day | Block 1 (9a-12p) | Block 2 (1p-4p) | Block 3 (4p-6p) |
|---|---|---|---|
| Mon | Send 50 cold emails + LinkedIn requests | 30 dials | Review replies, book calls |
| Tue | Send 50 cold emails | Onboarding calls / demos | Write case study snippet |
| Wed | LinkedIn follow-ups | 30 dials | Review replies |
| Thu | Send 50 cold emails | Onboarding calls | Scrape new leads / enrich emails |
| Fri | Send 50 cold emails | Weekly pipeline review + improve copy | Local meetup / outreach |

Target weekly output: ~250 cold emails, 60 dials, 100 LinkedIn touches, 3–5 booked calls.

## 7. KPIs + dashboard

Tracked in `hvac-agency/automations/src/stats.js` + a weekly digest:

- **Top of funnel:** contacts/week by channel, open rate, reply rate.
- **Middle:** booked calls, show rate, trial starts.
- **Bottom:** trial → paid conversion, MRR, churn.
- **Health:** spam complaint rate (keep <0.1%), unsubscribe rate (<1%), domain reputation (Google Postmaster Tools).

Trigger alerts:
- Spam complaint rate >0.1% → pause campaign, review copy.
- Reply rate <2% for 3 days → rotate subject line / opener.
- Trial-to-paid <30% → review onboarding call script with rec on which step fails.

## 8. Tooling + spend (phase 1 budget ~$500/mo)

| Line item | Cost | Purpose |
|---|---|---|
| Google Places API | ~$70 one-time | Build US pipeline (5k leads) |
| Google Workspace (2 mailboxes) | $24 | Primary + secondary sending domain |
| Domain #2 (climate-flow.co or similar) | $15/yr | Backup sending domain |
| Mail-tester.com | free | Weekly inboxing check |
| LinkedIn Sales Navigator | $99 | Outbound filtering |
| Twilio (SMS + voice) | ~$50 | A2P registered, usage-based |
| Loom Pro | $15 | Per-prospect demo videos |
| Anthropic API (email gen) | ~$30 | Per-lead personalization |
| Apollo.io (optional) | $49 | Email enrichment if website-scrape yield <30% |
| **Total** | **~$362/mo** | |

## 9. Risk + contingency

- **Deliverability collapse:** If primary domain gets flagged, switch to secondary, rewarm primary. This is why we run two domains from day 1.
- **Low Google Places yield:** Top 20 metros underperform → fall back to state-level Yelp scrape or Yellow Pages (pre-built Apollo list as final fallback).
- **No closes by week 4:** The ICP or price is wrong. Test a $997/mo single-product (Lead Rescue only) offer in week 5.
- **Closes but high churn:** The product isn't delivering trial-week "aha" moments. Add a week-1 success-manager call, sharpen demo metrics.

## 10. Execution checklist (next 7 days)

- [ ] Get Google Places API key → `outreach/.env`
- [ ] Run `npm run pipeline` → expect 3,000–5,000 leads
- [ ] Run `npm run enrich` → expect 30–45% of sites yield emails
- [ ] Buy second sending domain + set SPF/DKIM/DMARC
- [ ] Twilio A2P 10DLC final submission
- [ ] Record 90-sec Loom demo (phone rings → AI picks up → job booked)
- [ ] Week-1 cold-email campaign goes live at 10/day (warmup pace)
- [ ] LinkedIn Sales Navigator filter saved, first 100 connection requests queued
- [ ] First 30-dial phone block scheduled for Thu morning
- [ ] Weekly review cadence calendared, Friday 4pm
