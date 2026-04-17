# Go-Live Checklist — ClimateFlow AI

Master checklist for flipping from dev/test to production. All items must be
done before onboarding the first paying client. Pairs with `qa-checklist.md`
(which covers the manual test passes referenced in section 5 below).

---

## 1 — Stripe (live mode)

- [ ] Activate Stripe account (business info, bank account, tax ID)
- [ ] Swap `STRIPE_SECRET_KEY` in Doppler `prd` from `sk_test_...` → `sk_live_...`
- [ ] Swap `STRIPE_PUBLISHABLE_KEY` in Doppler `prd` from `pk_test_...` → `pk_live_...`
- [ ] Recreate the 4 products + recurring monthly prices in **live mode**
      (test-mode price IDs don't work with live keys):
  - [ ] Full Bundle — $2,500/mo
  - [ ] Lead Rescue — $1,500/mo
  - [ ] Review Autopilot — $500/mo
  - [ ] Estimate Follow-Up — $1,000/mo
- [ ] Update `STRIPE_PRICE_ID_BUNDLE`, `STRIPE_PRICE_ID_LEAD_RESCUE`,
      `STRIPE_PRICE_ID_REVIEW_AUTOPILOT`, `STRIPE_PRICE_ID_ESTIMATE_FOLLOWUP`
      in Doppler `prd` with the new live price IDs
- [ ] Register prod webhook endpoint at
      `https://<railway-domain>/webhooks/stripe`, subscribed to:
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end`
- [ ] Paste the webhook signing secret into `STRIPE_WEBHOOK_SECRET` in Doppler `prd`

---

## 2 — Doppler `prd` — fill empty secrets

- [ ] `ANTHROPIC_API_KEY` — production Claude API key
- [ ] `API_KEY` — internal API bearer token (generate with
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- [ ] `DATABASE_URL` — Railway Postgres connection string
- [ ] `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` — from Twilio console
- [ ] `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — OAuth client for Calendar
      (must use the prod redirect URI)
- [ ] `SMTP_USER` + `SMTP_PASS` — transactional email credentials
- [ ] `FROM_EMAIL` — verified sending address

---

## 3 — Infrastructure

- [ ] Railway service deployed; `/health` returns `{"status":"ok"}`
- [ ] Doppler → Railway integration active on `prd` config (secrets sync on push)
- [ ] Custom domain configured, HTTPS certificate green
- [ ] `WEBHOOK_BASE_URL` in Doppler `prd` matches the live domain
- [ ] Railway Postgres provisioned, schema migrations applied
- [ ] Twilio A2P 10DLC campaign approved (required for SMS traffic at scale)
- [ ] Google Cloud OAuth consent screen moved from "Testing" to "Published"
      (or submitted for verification if scopes require it)

---

## 4 — Legal / account

- [ ] Stripe, Twilio, Google API terms accepted under the operating entity
- [ ] Privacy policy + Terms of Service live on marketing site
- [ ] Links to policy pages present on the signup form
- [ ] SMS opt-in language meets TCPA requirements on signup + inbound flows

---

## 5 — QA — full `qa-checklist.md` pass against prod

All **[BLOCKER]** items in `hvac-agency/docs/qa-checklist.md` must pass:

- [ ] Signup flow (test card, then real card)
- [ ] Calendar OAuth connect
- [ ] Lead rescue — missed call triggers SMS within 60s
- [ ] Lead rescue — inbound SMS qualifies lead and books appointment
- [ ] Estimate follow-up cron + accept flow
- [ ] Billing — trial end → charge succeeds; then force-fail → graceful handling
- [ ] Review autopilot

---

## 6 — Observability / safety

- [ ] `SENTRY_DSN` set in Doppler `prd` and a test error reaches the Sentry project
- [ ] Sentry alert rules configured (email/Slack on new issues, 5xx spike)
- [ ] Uptime monitor pinging `/health` with paging
- [ ] Stripe webhook signature-verification failures tracked
- [ ] Backups enabled on Railway Postgres
- [ ] Owner SMS alerts verified end-to-end (estimate accepted, negative review)

---

## Sign-off

| Section                     | Owner | Date | Pass/Fail | Notes |
|-----------------------------|-------|------|-----------|-------|
| 1 — Stripe live             |       |      |           |       |
| 2 — Doppler prd secrets     |       |      |           |       |
| 3 — Infrastructure          |       |      |           |       |
| 4 — Legal / account         |       |      |           |       |
| 5 — QA pass                 |       |      |           |       |
| 6 — Observability           |       |      |           |       |

**Ready for first paying client when all sections signed off.**

Once live, ongoing operations move to `ops-runbook.md`.
