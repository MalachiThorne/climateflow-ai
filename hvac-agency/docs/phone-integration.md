# Phone Integration — Onboarding Playbook

Most HVAC owners already have an established office number (often a landline or
hosted VoIP) and won't change it. ClimateFlow AI works alongside that existing
number — we never require a port unless the customer asks for it.

We offer three integration paths. Default is **Option A**.

---

## Option A — Call forwarding to a ClimateFlow number (default)

**Use when:** The owner wants to go live today and doesn't care which number
text-backs come from.

**How it works:**
1. We provision a Twilio number in the customer's area code at signup.
2. The customer configures their existing office line to forward
   **busy / unanswered** calls to the ClimateFlow number.
3. Our system detects the missed call (Twilio webhook → `lead-rescue`
   pipeline) and texts the caller within 60 seconds from the ClimateFlow
   number.
4. The conversation continues on the ClimateFlow number; bookings land on
   the owner's connected calendar.

**Forwarding setup by carrier (give the customer the right one):**
- **AT&T / most landlines (Conditional Forwarding — recommended):**
  - Forward on no answer: `*92` + ClimateFlow number + `#`
  - Forward on busy: `*90` + ClimateFlow number + `#`
  - Disable: `*93` (no answer), `*91` (busy)
- **Verizon landline:**
  - Forward on no answer: `*71` + ClimateFlow number
  - Disable: `*73`
- **RingCentral / Nextiva / Vonage / hosted VoIP:**
  - Settings → Call Handling → Forwarding → "If unanswered after N rings →
    External number" → paste the ClimateFlow number. We send screenshots in
    the welcome email per provider.
- **Cell phone as office line:**
  - iPhone: Settings → Phone → Call Forwarding (unconditional only — usually
    not what you want)
  - Better: enable carrier conditional forwarding via the dial codes above.

**Pros:** Live in 5 minutes. Zero carrier paperwork. Customer keeps full
ownership of their number.
**Cons:** Outbound texts come from the ClimateFlow number, not the office
number. Most owners stop caring once the first booking lands.

---

## Option B — Text-enable the existing office number (Twilio Hosted SMS)

**Use when:** The customer specifically wants text replies to come from their
*real* office number (common for established brands with the number on trucks,
shirts, yard signs).

**How it works:**
1. Customer signs an LOA (Letter of Authorization) — generated from the
   admin panel, e-signed.
2. We submit the Hosted SMS request to Twilio. Voice stays on their existing
   carrier untouched; only SMS routes through us.
3. Carrier review takes **5–15 business days**.
4. Once approved, the office number appears in our Twilio account as
   SMS-capable. We swap the client's `twilioNumber` in `clients.js` to the
   hosted number and update the forwarding setup (still needed for missed
   *calls*).

**Pros:** Texts come from the customer's real number. Stronger brand
continuity. Higher reply rates in our pilot data.
**Cons:** 1–3 week onboarding delay. LOA paperwork. Not all carriers are
supported (Twilio's eligibility checker:
https://console.twilio.com/us1/develop/phone-numbers/manage/hosted-numbers).

**Operational note:** Run the eligibility check *before* selling Option B to
avoid promising something the carrier won't approve.

---

## Option C — Full port of the office number to Twilio

**Use when:** Almost never. Only if the customer is leaving their existing
voice carrier anyway, or wants ClimateFlow to handle voice routing too.

**How it works:**
1. Customer signs a port-out LOA + provides a recent bill.
2. Twilio submits to losing carrier; takes 2–4 weeks.
3. ClimateFlow becomes the system of record for both voice and SMS on that
   number. We forward voice to wherever the customer wants it answered.

**Pros:** Single number, single system, full feature set including voice
recording and AI voice answer (future).
**Cons:** High disruption risk. If the port fails or stalls, the customer's
phone *can go dark*. Requires hand-holding.

**Decision rule:** Don't propose Option C unless the customer asks for it. If
they do, set expectations: 2–4 week timeline, we coordinate with their
existing carrier, and we run a parallel ClimateFlow number until the port
completes so they're never without coverage.

---

## Onboarding script (operator)

When a new customer signs up:

1. **Provision** their ClimateFlow Twilio number (auto, on email verification).
2. **Send welcome email** with:
   - Their ClimateFlow number
   - Carrier-specific forwarding instructions (Option A)
   - Calendar connect link
   - Mention of Option B as a "want texts from your real number? we can do
     that — adds 1–2 weeks" upgrade
3. **Confirm forwarding works** by placing a test call to the office number,
   letting it ring out, and verifying the auto-text arrives within 60s.
4. **Don't mention Option C** unless asked.
