# QA Checklist — Pre-Launch

Run this checklist against the live Railway environment before onboarding the
first paying client. Check each item off manually. Items marked **[BLOCKER]**
must pass before any client goes live.

---

## Prerequisites

- [ ] Railway service is deployed and `/health` returns `{"status":"ok"}`
- [ ] Doppler → Railway sync is active (verify in Doppler dashboard)
- [ ] A test Twilio number is provisioned in your account
- [ ] Stripe is in **test mode** for the billing tests, then re-run in live mode
- [ ] Google Calendar OAuth redirect URI matches `GOOGLE_REDIRECT_URI` in Doppler
- [ ] You have two phones available (one to play "customer", one to monitor)

---

## 1 — Signup flow **[BLOCKER]**

**Goal:** New business owner signs up, verifies email, gets a provisioned number,
and receives a working welcome email.

- [ ] Go to `https://your-railway-domain.up.railway.app/signup`
- [ ] Fill out form with test data (use a real email you can check):
  - Business name: `QA Test HVAC`
  - Owner name: your name
  - Area code: your local area code
  - Email: your email
  - Plan: Full Bundle
  - Card: Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC
- [ ] Submit — button should say "Setting up your account…" then show the
  "Check your email" success screen
- [ ] Check email — verification email should arrive within 60s
  - [ ] Email is not in spam
  - [ ] "Verify Email →" link is present
- [ ] Click the verification link
  - [ ] Page shows "Email verified" with the provisioned phone number
  - [ ] Calendar connect button is present
- [ ] Check email again — welcome email should arrive within 60s
  - [ ] Welcome email shows the correct provisioned number
  - [ ] Carrier-specific forwarding instructions are present
  - [ ] "Connect Google Calendar →" button links to the OAuth flow
- [ ] In Stripe test dashboard, confirm:
  - [ ] Customer was created
  - [ ] Trial subscription is active
  - [ ] Trial end date is 7 days out
- [ ] In Postgres, confirm client record was created:
  ```sql
  SELECT id, name, "twilioNumber", "ownerEmail" FROM records
  WHERE collection = 'clients' ORDER BY created_at DESC LIMIT 1;
  ```

---

## 2 — Calendar connect **[BLOCKER]**

**Goal:** Business owner connects Google Calendar so the AI can book appointments.

- [ ] Click "Connect Google Calendar →" from the welcome email or verified page
- [ ] Google OAuth consent screen appears
- [ ] Authorize access
- [ ] Redirected back to the app — confirm success message
- [ ] Hit `/api/calendar/status/{businessId}` with API key — should return
  `{"connected": true}`
- [ ] Hit `/api/calendar/availability/{businessId}` — should return available
  time slots for the next 7 days

---

## 3 — Lead rescue — missed call **[BLOCKER]**

**Goal:** A missed call to the Twilio number triggers an AI text-back within 60s.

Setup: configure call forwarding on a test phone to the provisioned Twilio number
(use the AT&T dial codes in the welcome email), OR call the Twilio number directly
and let it go unanswered.

- [ ] Call the provisioned Twilio number from your "customer" phone and let it
  ring out (do not answer)
- [ ] Within 60 seconds, "customer" phone receives a text from the Twilio number
- [ ] Text message mentions the business name and asks how to help
- [ ] Reply to the text from the "customer" phone
- [ ] AI responds within 30s with a follow-up question or booking offer
- [ ] Continue the conversation until the AI offers to book an appointment
- [ ] Accept the appointment — AI should confirm a time slot from the calendar
- [ ] Check the connected Google Calendar — appointment should appear
- [ ] Check Railway logs — no errors in the lead-rescue pipeline

---

## 4 — Lead rescue — inbound SMS **[BLOCKER]**

**Goal:** A text sent directly to the Twilio number is handled correctly.

- [ ] Text the provisioned Twilio number from your "customer" phone
  (e.g. "Hi, I need my AC fixed")
- [ ] AI responds within 30s
- [ ] Conversation qualifies the lead and offers booking
- [ ] Appointment books to calendar

---

## 5 — Estimate follow-up

**Goal:** An open estimate triggers follow-up texts on the correct schedule.

- [ ] POST a test estimate to `/api/estimate` (use API key):
  ```json
  {
    "businessId": "<your-test-client-id>",
    "customerName": "Test Customer",
    "customerPhone": "<your-customer-phone>",
    "description": "AC unit replacement",
    "amount": 7500
  }
  ```
- [ ] Confirm estimate record created in DB
- [ ] Manually trigger follow-up (or wait for the 9am–6pm cron):
  ```bash
  # Via Railway console or local doppler run:
  node -e "require('./src/pipelines/estimate-followup').processFollowUps(client)"
  ```
- [ ] "Customer" phone receives follow-up text referencing the estimate
- [ ] Reply "yes" or "I'll take it" — AI should reply with confirmation
- [ ] Estimate marked as accepted in DB
- [ ] You (the owner) receive the "estimate accepted" email

---

## 6 — Billing lifecycle

**Goal:** Trial ends, card is charged, failed payment is handled gracefully.

- [ ] In Stripe test dashboard, fast-forward the trial to end (use Stripe's
  "Fast-forward subscription" feature on the test subscription)
- [ ] Stripe charges the test card — payment succeeds
- [ ] In Railway logs, confirm `customer.subscription.updated` webhook received
- [ ] Now update the test subscription's payment method to Stripe's decline card
  `4000 0000 0000 0002`
- [ ] Fast-forward to next billing date
- [ ] Payment fails
- [ ] "Payment failed" email arrives (check inbox, not spam)
- [ ] Service remains active during Stripe's 7-day retry window
- [ ] In Stripe dashboard, mark the invoice as paid manually
- [ ] Service continues normally

---

## 7 — Review autopilot

- [ ] POST a review request to `/api/review/request` with API key and a customer
  phone number
- [ ] "Customer" phone receives review request text with the Google review link
- [ ] Simulate a new Google review appearing (or use `/api/review/incoming`)
- [ ] AI-generated response is logged (actual posting requires Google Business
  API approval — verify the response text is correct)

---

## 8 — Smoke check after all tests

- [ ] `/health` still returns `{"status":"ok"}` (DB connections are healthy)
- [ ] No ERROR-level logs in Railway since testing began
- [ ] Stripe test dashboard shows no unexpected events
- [ ] All test records cleaned up from DB (or noted as test data)

---

## Sign-off

| Area | Tested by | Date | Pass/Fail | Notes |
|------|-----------|------|-----------|-------|
| Signup flow | | | | |
| Calendar connect | | | | |
| Lead rescue (missed call) | | | | |
| Lead rescue (inbound SMS) | | | | |
| Estimate follow-up | | | | |
| Billing lifecycle | | | | |
| Review autopilot | | | | |

**Ready for first client when all BLOCKERs pass.**
