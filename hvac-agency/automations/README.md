# ClimateFlow AI — Automations Server

Express server + cron workers that power the three HVAC service automations sold by ClimateFlow AI:

| Service              | Price           | What it does                                                                                   |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| Lead Rescue          | $1,500 / month  | Catches missed calls via Twilio forwarding, sends an SMS within seconds, books the callback.   |
| Review Autopilot     | $500 / month    | Triggers a review-request SMS after a job completes; tracks replies.                           |
| Estimate Follow-Up   | $1,000 / month  | Nudges customers who received an estimate but didn't respond. AI-drafted, operator-approved.   |
| **Bundle**           | **$2,500 / mo** | All three, plus the shared onboarding + dashboard.                                             |

## Stack

- **Runtime:** Node 20+, CommonJS, `express@5`
- **Datastore:** Postgres (JSONB). Single generic `records` table with a field-name allowlist. `src/store.js` is the only module that writes SQL.
- **SMS / voice:** Twilio (`sendSMS`, status webhooks, signed payload validation)
- **Calendar:** Google Calendar OAuth (per-client tokens, AES-256-GCM at rest)
- **Email:** SMTP for outbound + Gmail API ingest of a shared `support@climateflow.ai` mailbox
- **AI:** Anthropic Claude (drafting estimate follow-ups, summarizing reviews)
- **Billing:** Stripe (one price per plan, signed webhook)
- **Scheduling:** `node-cron` with a `guardedCron(name, fn)` wrapper that prevents overlapping ticks

## Layout

```
src/
├── server.js              # HTTP entry: Express routes, webhooks, owner UI, cron registration
├── config.js              # Env validation + fail-fast on missing vars
├── store.js               # Postgres access layer. Only place SQL is written.
├── clients.js             # Tenant (business) CRUD. Seeds onboardingTokenNonce per record.
├── onboarding.js          # Forwarding self-test + wizard state transitions
├── signup.html            # /signup page served to prospects
├── signedUrl.js           # HMAC-SHA256 signed URLs with optional per-client nonce binding
├── tokenCrypto.js         # AES-256-GCM envelope with keyVersion for rotation
├── sms.js                 # Thin Twilio wrapper
├── smsRetry.js            # Persistent retry queue w/ exponential backoff + duplicate-send guard
├── gmailIngest.js         # Plus-addressed Gmail → per-client pipelines. Fail-closed routing.
├── email.js               # SMTP outbound (welcome, billing, verification)
├── calendar.js            # Google Calendar booking per client
├── ai.js, aiQuota.js      # Claude draft generation + per-tenant quota
├── dashboardUI.js         # Owner-facing HTML (dashboard, profile, queues)
├── estimatesUI.js         # Paste/queue screens for estimate follow-up
├── review-monitor.js      # Cron: polls for new reviews, enqueues responses
├── stats.js               # Windowing helpers for weekly/monthly reports
├── billing.js             # Stripe customer + subscription flows
├── features.js            # Feature flags
└── pipelines/
    ├── lead-rescue.js       # Missed-call → SMS within seconds
    ├── review-autopilot.js  # Job-complete → review request
    └── estimate-followup.js # AI-drafted reminder after estimate issued

test/
├── security.test.js     # Adversarial-review regressions (see "Security" below)
├── pipelines.test.js    # Pipeline unit tests
├── webhooks.test.js     # Twilio signature validation + webhook routing
├── smoke.test.js        # HTTP surface (health, /signup, /api/plans)
├── stats.test.js        # Date-window correctness
└── e2e/                 # End-to-end flows
```

## Running locally

```bash
cp .env.example .env   # fill in all REQUIRED vars
npm install
npm test               # node:test — no framework. Runs in ~1s with Postgres off.
npm run dev            # requires Doppler for secrets
# or:
npm start              # reads .env, binds PORT
```

Docker-compose spins up a local Postgres for integration work — `postgresql://climateflow:climateflow@localhost:5432/climateflow`.

## Required environment

Every var in `.env.example` marked REQUIRED must be set or the server refuses to start (see `validateRequiredEnv` in `src/config.js`). Highlights:

- `DATABASE_URL` — Postgres
- `ANTHROPIC_API_KEY`, `TWILIO_*`, `STRIPE_*`, `GOOGLE_*`, `SMTP_*` — vendor creds
- `API_KEY` — protects `/api/*` admin endpoints (64 hex chars)
- `URL_SIGNING_SECRET` — HMAC for signed billing/onboarding URLs (≥32 chars)
- `TOKEN_ENCRYPTION_KEY` — 64-hex AES key for OAuth token envelopes
- `TOKEN_ENCRYPTION_KEYS` — optional multi-key registry for rotation (`v2:<hex>,v1:<hex>`)
- `WEBHOOK_BASE_URL` — public base URL used to build Twilio/Stripe callbacks
- `FROM_EMAIL` — also the anchor domain for Gmail plus-address routing

## Key design decisions

### Gmail plus-addressing for per-client ingest

Customers BCC `support+estimates-<businessId>@climateflow.ai` (or `support+reviews-<...>`). One mailbox, one OAuth token. `src/gmailIngest.js` polls unread, parses the plus-suffix, and hands off to a pipeline handler. The parser is anchored on **both** the configured local-part and the platform mailbox domain — a lookalike domain in the `To:` header cannot cross-tenant route.

**Fail-closed guarantees:**
- `pollInbox` refuses to run if either handler isn't wired (`handlers_not_wired`).
- No expected domain → refuses to route (`no_expected_domain`).
- Unroutable mail is **quarantined**: left `UNREAD` so the operator sees it, with a processed record carrying `quarantined: true` so subsequent polls skip without re-fetching. **We never auto-ack mail we couldn't route.**
- Strict ack: handlers must return literal `true`. Anything else leaves the message `UNREAD` for retry.

### SMS retry queue with duplicate-send protection

`src/smsRetry.js` wraps every send in `sendWithFallback(to, body, ...)`. Contract: **never throws.** On Twilio failure it enqueues; on Twilio+DB dual failure it logs CRITICAL and returns `{ dropped: true }`.

The cron-driven `processPending` is split into three steps per row:
1. Stamp a `sendAttemptedAt` pre-send marker under the existing lease.
2. Call Twilio.
3. Persist `status: sent`.

If step 3 fails after step 2 succeeded, the row keeps `sendAttemptedAt` set. On the next tick's stale-lease reclaim, the worker sees the marker and transitions the row to `sent_unknown` — **never re-invokes Twilio.** Twilio's Create Message API has no client-side idempotency key, so this marker is the only way to avoid duplicate sends across worker crashes.

### Signed URLs bound to a client nonce

Onboarding / dashboard / billing links are HMAC-SHA256 tokens with a TTL. Onboarding tokens additionally bind to `client.onboardingTokenNonce`. Rotating the nonce (`POST /onboarding/:businessId/rotate-link`) invalidates every outstanding welcome link for that tenant in one shot. Legacy (pre-rollout) links use an empty-string nonce so they don't break during migration.

### OAuth token encryption with key rotation

`src/tokenCrypto.js` wraps Google Calendar + Gmail tokens in AES-256-GCM envelopes stamped with a `keyVersion`. Multi-key registry `TOKEN_ENCRYPTION_KEYS=v2:<hex>,v1:<hex>` lets you decrypt old envelopes with the old key while minting new envelopes under the new one. Pre-rotation envelopes (no `keyVersion` field) decrypt as `v1`.

### Content-Security-Policy on owner HTML

Every owner-facing HTML route (wizard, dashboard, profile, estimate paste, estimate queue) sets a locked-down CSP: `frame-ancestors 'none'`, `form-action 'self'`, `default-src 'self'`. `'unsafe-inline'` is allowed for script/style because the wizard uses inline `<script>` for the forwarding self-test; no third-party scripts are loaded.

### Rate limits

- `signupLimiter`: 5 signups/hour per IP. In-memory; swap for `rate-limiter-flexible` + Redis when we run >1 instance.
- `FORWARDING_TEST_DAILY_CAP`: 20 self-tests per client per 24h.
- Per-email dedup on `/api/signup` returns 409 for a non-expired unverified pending signup.

## HTTP surface (selected routes)

| Method | Path                                         | Purpose                                              |
| ------ | -------------------------------------------- | ---------------------------------------------------- |
| GET    | `/health`                                    | Liveness + DB probe                                  |
| GET    | `/signup`                                    | Public signup page                                   |
| POST   | `/api/signup`                                | Starts signup + Stripe checkout session              |
| POST   | `/webhooks/voice/status`                     | Twilio call-status webhook (missed-call → Lead Rescue)|
| POST   | `/webhooks/sms`                              | Inbound SMS webhook (replies, opt-outs)              |
| POST   | `/webhooks/stripe`                           | Stripe subscription lifecycle                        |
| GET    | `/api/gmail/callback`                        | Gmail OAuth landing                                  |
| GET    | `/api/calendar/callback`                     | Google Calendar OAuth landing                        |
| GET    | `/onboarding/:businessId/wizard`             | Owner onboarding wizard (signed URL + nonce)         |
| POST   | `/onboarding/:businessId/rotate-link`        | Mint a fresh wizard URL, invalidate outstanding ones |
| GET    | `/dashboard/:businessId`                     | Owner dashboard (signed URL + nonce)                 |

All `/api/*` endpoints (not webhooks) require `x-api-key: $API_KEY`. Twilio and Stripe webhooks validate vendor signatures.

## Testing

```bash
npm test
```

`node:test` (built-in, no jest/mocha). Tests stub vendor modules via `require.cache` injection — see `test/security.test.js` for the pattern. No Postgres needed; most tests run under 10ms each.

`test/security.test.js` is a collection of regressions from adversarial reviews — each test names the vulnerability class it protects against.

## Security posture

This codebase has been through three rounds of `/codex:adversarial-review`. Notable hardening:

- **Gmail routing**: domain-anchored plus-address parser + fail-closed handlers + quarantine (never auto-ack unroutable mail).
- **SMS retries**: pre-send marker prevents duplicate sends across worker crashes.
- **Signed URLs**: per-client nonce binding for instant link revocation.
- **Token storage**: versioned AES-256-GCM envelopes; rotation runbook in `src/tokenCrypto.js`.
- **Webhook auth**: all Twilio/Stripe webhooks require valid vendor signatures; all `/api/*` routes require `x-api-key`.
- **CSP**: locked `frame-ancestors`, `form-action`, `default-src` on every owner HTML route.
- **Rate limits**: per-IP signup, per-client forwarding-test daily cap, per-email pending-signup dedup.

## Deployment

Railway (`railway.toml` + `railway.json`). Postgres plugin auto-provisions `DATABASE_URL`. Webhook base URL is the Railway public domain.

## Domain & mail

- `climateflow.ai` on Cloudflare
- Google Workspace mailbox: `support@climateflow.ai` (shared ingest target)
- Landing page: Netlify + Next.js, separate repo

---

For service-level incidents or marketing claims that may have drifted from product behavior, see user memory — marketing copy must stay honest about real setup time.
