# Twilio A2P 10DLC Application — ClimateFlow AI

Everything needed to register the Brand and Campaign(s) in the Twilio Console
so SMS deliverability is unthrottled for production traffic. A2P 10DLC is
mandatory for any U.S. long-code SMS volume — unregistered traffic will be
heavily filtered or blocked outright by carriers.

> **Start early.** Brand vetting typically clears in 1–5 business days; campaign
> registration adds another 1–7 business days; carrier approval adds 1–2 more.
> Plan for **1–3 weeks** end-to-end before first live SMS can flow at scale.

Console path: **twilio.com → Messaging → Regulatory Compliance → A2P 10DLC.**

---

## 0. Pre-flight checklist

Before submitting anything, these must be **live on the public internet** and
must match the information on the A2P application exactly. Carriers reject
campaigns that reference URLs that 404, redirect, or mismatch the brand name.

- [ ] `https://climateflow.ai/` — marketing homepage live, describes the service
- [ ] `https://climateflow.ai/privacy` — privacy policy live, includes SMS terms (consent, opt-out, HELP, frequency, no mobile data resale)
- [ ] `https://climateflow.ai/terms` — terms of service live
- [ ] Signup form at `https://app.climateflow.ai/signup` (or prod domain) visibly collects SMS consent and links to privacy/terms
- [ ] `support@climateflow.ai` inbox is monitored and replies
- [ ] EIN + legal business entity registered (or the DUNS equivalent for Sole Prop)
- [ ] Credit card on Twilio account with adequate headroom for the $44 one-time registration fee (Low-Volume Standard) plus ~$1.50/month per campaign

---

## 1. Brand Registration

**Twilio Console → A2P 10DLC → Brand → Register a Brand**

### 1a. Business information

| Field | Value |
|---|---|
| Legal business name | *(Your registered entity — must match IRS records)* |
| DBA / Brand name | `ClimateFlow AI` |
| Business type | `Private Profit` *(unless otherwise incorporated)* |
| Business registration type | `EIN` *(or `DUNS` / `LEI` / `CBN` if international)* |
| EIN / Tax ID | *(Your 9-digit EIN — hyphenated or not, Twilio accepts either)* |
| Registration country | `US` |
| Business industry | `Technology` |
| Business regions of operation | `USA` |
| Stock symbol / exchange | *(Leave blank — private)* |
| Website | `https://climateflow.ai` |
| Vertical | `Technology` |

### 1b. Business contact

- **Authorized representative:** *(Your name, as registered with the IRS/state)*
- **Title:** `Owner` or `Founder`
- **Business email:** `support@climateflow.ai`
- **Business phone:** *(A real reachable number — carriers may call to verify)*

### 1c. Brand vetting tier

Choose **Standard Brand** (vetting fee $44 one-time). This is the tier required
for **Standard** campaigns, which gets you the 60–225 MPS (messages per second)
throughput and full T-Mobile/AT&T visibility. Do not choose Low-Volume Standard
unless you're sure you'll stay under 6,000 messages/day across all customers
— the upgrade path later is clunky.

---

## 2. Campaign Registrations

We run **three distinct use cases** on behalf of HVAC business clients. Each
needs its own campaign because the content and consent flows differ. All
three are **Mixed use case = No** (single use case each) and register under
the **Standard** tier.

### 2a. Campaign A — Lead Rescue (AI reply to missed calls)

| Field | Value |
|---|---|
| Use case | `Customer Care` |
| Campaign description | `Automated SMS reply to callers who did not reach an HVAC business. The AI assistant apologizes for the miss, asks what the caller needs, qualifies the lead, and books an appointment by offering calendar slots. Conversations are operator-initiated by the consumer's call to the business.` |
| Number of messages / month (estimated) | Start with `10000`; raise later |
| Message content | See sample messages below |
| Opt-in type | `Verbal` (inbound call constitutes consent to receive a follow-up SMS about the call) — plus standard compliance language in first outbound message |
| Opt-in workflow description | `End user places a call to the HVAC business's dedicated ClimateFlow number. If unanswered, the system sends a single SMS within 60 seconds acknowledging the missed call and offering help. The first message identifies the business, includes STOP instructions, and sets expectations for further messages.` |
| Opt-out keywords | `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT` |
| Opt-out message | See sample below |
| Help keywords | `HELP, INFO` |
| Help message | See sample below |
| Subscriber opt-in? | `Yes` |
| Subscriber opt-out? | `Yes` |
| Subscriber help? | `Yes` |
| Number pooling? | `No` (one dedicated number per business) |
| Direct lending / loan arrangement? | `No` |
| Embedded link? | `No` for this campaign *(appointment links go out by email, not SMS)* |
| Embedded phone number? | `Yes` *(the business's callback number may be referenced)* |
| Affiliate marketing? | `No` |
| Age-gated content? | `No` |

**Sample messages (paste verbatim — carriers scan for compliance boilerplate):**

> Hi, this is the AI assistant for {Business Name}. Sorry we missed your call!
> What can we help with today — repair, install, or maintenance? Reply STOP to
> opt out, HELP for help. Msg&data rates may apply.

> Got it — we can send a tech out. Monday 9am or Tuesday 1pm works. Reply with
> the slot that fits and I'll book it on the calendar.

> Booked! You're confirmed for Tue 1–3 PM. {Business Name} will text a reminder
> the morning of. Questions? Reply here or call {Business Phone}.

---

### 2b. Campaign B — Review Autopilot (post-job review requests)

| Field | Value |
|---|---|
| Use case | `Customer Care` |
| Campaign description | `One-time post-service SMS asking recent HVAC service customers to leave a Google review. Sent only after the business marks the job complete. Includes the business's name and a link to the Google review page. Each recipient can receive at most one review request per completed job.` |
| Number of messages / month (estimated) | `5000` |
| Opt-in type | `Verbal` *(the customer hired the HVAC business and provided their number as part of the service arrangement — service-related communication)* |
| Opt-in workflow description | `Customers provide their phone number when booking HVAC service (in-person, by phone, or at appointment booking). Phone number is added to the business's ClimateFlow CRM. After the technician marks the job complete, a single review-request SMS is sent. Recipient can STOP to opt out of all future SMS.` |
| Opt-out keywords | `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT` |
| Help keywords | `HELP, INFO` |
| Embedded link? | `Yes` *(link to the business's Google review page)* |
| Embedded phone number? | `Yes` |
| Number pooling? | `No` |

**Sample messages:**

> Hi {Customer First Name}, this is {Business Name}. Thanks for letting us take
> care of your HVAC today! If you have 30 seconds, a Google review makes a huge
> difference for our small business: {review-link}. Reply STOP to opt out.

> Thanks so much for the review — it means the world. Reply STOP to opt out,
> HELP for help.

---

### 2c. Campaign C — Estimate Follow-Up

| Field | Value |
|---|---|
| Use case | `Customer Care` |
| Campaign description | `Follow-up SMS for open HVAC estimates that have not yet been accepted. The AI assistant checks in with the customer, answers questions about the estimate, and invites them to schedule. Cadence is capped at 3 follow-ups over 14 days, then stops. Recipient is a customer who requested an estimate from the HVAC business.` |
| Number of messages / month (estimated) | `5000` |
| Opt-in type | `Verbal` *(customer requested a written estimate and provided their number for follow-up)* |
| Opt-in workflow description | `Customer requests an estimate from the HVAC business (phone call, in-home visit, or web form). The business records their phone number with consent to receive estimate-related follow-up SMS. Message cadence is capped and halts on STOP or acceptance.` |
| Opt-out keywords | `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT` |
| Help keywords | `HELP, INFO` |
| Embedded link? | `Yes` *(signed link to view/accept the estimate)* |
| Embedded phone number? | `Yes` |
| Number pooling? | `No` |

**Sample messages:**

> Hi {First Name}, just checking in on your estimate from {Business Name}
> (${Amount} for {Scope}). Any questions? Reply here or tap to view:
> {signed-estimate-link}. Reply STOP to stop. Msg&data rates may apply.

> Great — we can schedule install for Thu or Fri this week. Which works? Reply
> STOP to opt out.

---

## 3. Required compliance messages (all campaigns)

These responses must be implemented in the automation and must match what is
declared in the campaign registration. Our current implementation handles them
in `automations/src/pipelines/lead-rescue.js` (SMS inbound branch).

### 3a. HELP auto-reply

> {Business Name} via ClimateFlow AI: we respond to missed calls, send estimate
> follow-ups, and request reviews. Msg&data rates may apply. Message frequency
> varies. Reply STOP to cancel. Questions? support@climateflow.ai

### 3b. STOP confirmation (sent exactly once, then no further messages)

> You've been unsubscribed from {Business Name} messages. No further messages
> will be sent. Reply START to resume.

### 3c. First outbound message must include

- Business identification (`Hi, this is {Business Name}...` or `{Business Name} via ClimateFlow AI`)
- Purpose of the message
- `Reply STOP to opt out` (or functionally identical — `Text STOP to cancel` is acceptable)
- `Msg&data rates may apply` on the first message of each new conversation

---

## 4. Phone Number → Messaging Service → Campaign

Once the campaign is approved, link each business's dedicated Twilio number
to a Messaging Service that is associated with the campaign:

1. **Messaging → Services → Create Messaging Service**
   - Name: `ClimateFlow — Lead Rescue` (one per campaign)
   - Use case: match the campaign
2. **Sender Pool → Add Senders** — add the dedicated Twilio number(s)
3. **Integration → Incoming Messages** → webhook to `https://<prod-domain>/webhooks/sms` (matches what `provisionPhoneNumber()` already configures)
4. **Campaign Use Case → Link your Campaign** — associates the service with the approved A2P campaign

> Code impact: `provisionPhoneNumber()` in `automations/src/sms.js` currently
> configures the inbound SMS webhook on the number directly. For A2P traffic,
> each new number must also be added to the right Messaging Service's Sender
> Pool. Track this as a follow-up: either extend `provisionPhoneNumber` to
> attach the number to a `TWILIO_MESSAGING_SERVICE_SID_*` per campaign, or do
> it manually in the console during onboarding.

---

## 5. Documentation we may be asked to attach

Carriers sometimes request supporting evidence — prep these in advance:

- [ ] Screenshot of signup form showing the SMS consent line and links to privacy/terms
- [ ] Screenshot of `/privacy` section covering SMS terms (STOP, HELP, frequency, no resale)
- [ ] Screenshot of `/terms` Section 6 (consumer consent responsibility) and Section 4 (SMS messaging terms reference)
- [ ] A sample outbound SMS for each campaign (as shown above)
- [ ] A short written description of the opt-in flow (the **Opt-in workflow description** above is the one you'll paste)

---

## 6. Submission sequence

1. **Register Brand** → wait for `VERIFIED` status (1–5 business days)
2. **Create Messaging Service** for each campaign (can be done in parallel)
3. **Create Campaign** for each use case → link to Brand + Messaging Service
4. **Submit Campaigns** for carrier review → wait for `VERIFIED` / `APPROVED` (1–7 business days each)
5. **Add dedicated number(s) to the Messaging Service Sender Pool**
6. **Send a test SMS** through each service to your personal number and confirm delivery
7. **Flip `TWILIO_MESSAGING_SERVICE_SID_*` values** into Doppler `prd` (if the code is updated to send via Messaging Service rather than From number)

---

## 7. Post-approval ops

- **Monitor rejection rate** weekly at `twilio.com → Messaging → Insights`. Anything over ~5% rejected means carriers are unhappy with content or throughput — revisit before carriers escalate to filtering the whole brand.
- **Do not send anything outside the registered use case** on a registered number. If we want to add (e.g.) marketing SMS later, register a **separate** Marketing campaign. Mixing use cases on one campaign is a fast way to get deregistered.
- **Keep copies of opt-in evidence.** If a carrier complaint comes in, we need to show the HVAC business captured consent from the end user. The ClimateFlow CRM should log: source of phone number, timestamp, and consent language presented.
- **Renew brand vetting** — the Standard Brand fee is one-time, but some carriers may re-vet periodically.

---

## 8. Owner checklist (what Malachi needs to prepare)

- [ ] Legal entity name, EIN, registered address, authorized rep name + title
- [ ] A monitored business phone number for Twilio verification calls (your personal is fine)
- [ ] Confirmation that `support@climateflow.ai` inbox forwards to your real email
- [ ] Credit card on Twilio with ~$100 buffer (covers $44 brand fee + 3× ~$1.50/mo campaigns + minor misc)
- [ ] Double-check all public URLs above are live before hitting **Submit**

---

## Open questions / decisions

- **One brand, three campaigns vs. one campaign with all three use cases?** Going with three. Carriers score campaigns individually and a rejection on one use case would not nuke the others. Costs ~$3 extra per month.
- **Do we need a Sole Proprietor brand path?** Only if operating under personal name with no EIN. Less throughput (1 MPS) — strongly prefer to have an EIN before applying.
- **Double opt-in vs single opt-in?** Twilio/carriers accept single opt-in for Customer Care campaigns with valid prior business relationship (which is our case). No need for a confirm-loop.
