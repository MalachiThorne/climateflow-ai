# Operations Runbook — ClimateFlow AI

Day-to-day operations for the running service. Pairs with:

- `go-live-checklist.md` — one-time pre-launch steps
- `qa-checklist.md` — manual QA pass
- `doppler-setup.md` — secrets management
- `phone-integration.md` — client phone onboarding

This runbook assumes the service is already deployed on Railway with Doppler
wired. If you're pre-launch, finish the go-live checklist first.

---

## 0 — Who to page

| Role              | Person             | Contact             |
|-------------------|--------------------|---------------------|
| Primary on-call   | Malachi            | (fill in)           |
| Backup on-call    | (TBD)              | (fill in)           |
| Billing escalation| Malachi            | (fill in)           |

Page triggers:
- `/health` down for >5 min
- Twilio account suspended / A2P rejected
- Stripe webhook signature failures spiking
- Any CRITICAL log from `smsRetry.js` (`dropped: true`)
- Any client-reported SMS outage

---

## 1 — Daily ops (≤10 min)

Run every weekday morning. Log outcomes in a weekly journal.

### 1.1 Health pulse
```bash
curl -fsSL https://<railway-domain>/health | jq .
```
Expect `{"status":"ok","db":"ok"}`. If DB is down, jump to §5.3.

### 1.2 Error scan
Railway → Logs → filter `level=ERROR OR level=CRITICAL`, last 24h.
- Zero entries: done.
- Any `CRITICAL sms_dropped`: §5.1.
- Any `stripe_signature_failed` >3 in a row: §5.2.
- Any `gmail_ingest_quarantine`: §5.4.

### 1.3 Queue backlog
```sql
-- SMS retry queue depth (should be near zero in steady state)
SELECT status, count(*) FROM records
 WHERE collection='sms_retry' GROUP BY status;

-- Estimate follow-up queue (pending > 48h old = stuck)
SELECT count(*) FROM records
 WHERE collection='estimates'
   AND data->>'status'='awaiting_followup'
   AND (data->>'createdAt')::timestamptz < now() - interval '48 hours';
```
If retry backlog > 20 or estimates stuck > 10: §5.1 / §5.6.

### 1.4 Stripe lifecycle
Stripe Dashboard → Subscriptions → filter `past_due` and `unpaid`.
- Any entries: send dunning nudge (manual email — template in §4.3) and flag
  client record `billing_attention=true`.

### 1.5 New signups
```sql
SELECT id, data->>'name' AS name, data->>'ownerEmail' AS email, created_at
  FROM records WHERE collection='clients'
  AND created_at > now() - interval '24 hours';
```
For each: confirm they hit the dashboard at least once (owner activation). If
signed up >24h ago and never logged in, send the "need help?" email (§4.2).

---

## 2 — Weekly ops (Mondays, ~30 min)

### 2.1 Client activity review
Pull weekly stats per client via `/api/dashboard/:businessId`. Flag:
- Zero missed-call captures in 7 days → forwarding may be off, call the owner.
- SMS reply rate <20% → AI drafts may be off-tone, review last 10 threads.
- Estimate accept rate <15% → review AI follow-up copy.

### 2.2 Twilio cost check
Twilio Console → Usage → Filter last 7 days.
- Per-client SMS cost: budgeted at ≤$100/mo. Flag if any client is on pace
  for >$150/mo — usually a stuck conversation loop.

### 2.3 Anthropic quota check
```sql
SELECT data->>'businessId', data->>'tokensUsed'
  FROM records WHERE collection='ai_quota'
  AND (data->>'periodStart')::timestamptz > now() - interval '7 days';
```
Anyone at >80% of monthly cap: raise cap or reach out — they may be growing.

### 2.4 Backup verify
Railway Postgres → Backups → confirm last backup <24h old and restorable.
One restore drill per month (§3.3).

### 2.5 Gmail ingest audit
Check `support@climateflow.ai` inbox for UNREAD messages older than 24h —
these are quarantined. For each, determine the intended client and either:
- Wire a missing handler, or
- Forward manually and mark read.

---

## 3 — Monthly ops (first Monday)

### 3.1 Key hygiene
Rotate on the first Monday of each month:

| Secret                     | Rotation cadence | Runbook      |
|----------------------------|------------------|--------------|
| `API_KEY`                  | 90 days          | §6.1         |
| `URL_SIGNING_SECRET`       | 90 days          | §6.2         |
| `TOKEN_ENCRYPTION_KEY`     | 180 days (rolling)| §6.3        |
| `STRIPE_WEBHOOK_SECRET`    | on suspicion only| Stripe docs  |
| `TWILIO_AUTH_TOKEN`        | 180 days         | Twilio docs  |
| `ANTHROPIC_API_KEY`        | 180 days         | Anthropic docs|
| `SMTP_PASS`                | 180 days         | Provider docs|

Record each rotation in `docs/rotation-log.md` (create if missing) with
date + operator initials.

### 3.2 Dependency audit
```bash
cd hvac-agency/automations && npm audit --production
cd hvac-agency/landing-page && npm audit --production
cd hvac-agency/outreach     && npm audit --production
```
High/critical CVEs: patch within 7 days. Moderates: batch next release.

### 3.3 Disaster-recovery drill
Once a month, restore the latest Railway Postgres backup into a scratch
database and run:
```bash
DATABASE_URL=<scratch-url> npm test
```
Document restore time; target <30 min end-to-end.

### 3.4 Billing reconciliation
Stripe report (Reports → Balance) vs. `records where collection='clients'`
with active subscription. Any drift >$0: investigate — usually a manual
refund or comped month.

---

## 4 — Client lifecycle

### 4.1 New client onboarding
Triggered automatically by Stripe checkout + email verification. Operator
tasks:
1. Monitor Railway logs for `signup_complete` event.
2. Confirm Twilio number provisioned (check the clients record).
3. ~6 hours later, if the owner has not connected calendar, send the
   nudge email (template below).
4. Within 24 hours, place a test call to confirm forwarding. If no SMS
   triggers, call the owner and walk them through the carrier dial codes
   (see `phone-integration.md`).

### 4.2 Inactivity nudge email
Send if signup complete but no dashboard login in 24h:
> Hey [Name] — noticed you signed up but haven't connected Google Calendar
> yet. That's the last step before we can book appointments for you.
> One-click link: <fresh signed dashboard URL, TTL 72h>
> Reply here if you're stuck — I can jump on a 10-minute call.

### 4.3 Dunning email (past_due)
> Hey [Name] — heads up, Stripe couldn't charge your card on [date]. We'll
> retry automatically for the next 7 days, but if you want to update the
> card now: <stripe customer portal link>
> Your service is still active. Just didn't want it to surprise you.

### 4.4 Cancellation
Owner requests cancel:
1. Stripe Dashboard → Subscription → Cancel at period end (never immediate —
> they've paid for the month).
2. In DB: `UPDATE records SET data = data || '{"status":"cancelling"}'::jsonb
   WHERE collection='clients' AND id='<id>'`.
3. At period end, cron should flip `status=cancelled` and stop routing
   webhooks. If not (confirm this automation exists — otherwise manual):
   - Remove Twilio webhook config for their number.
   - Revoke Gmail/Calendar OAuth tokens (`/api/calendar/disconnect/:id`).
   - Release the Twilio number (30-day grace in case they come back).
4. Send exit survey email. Log churn reason in `rotation-log.md` journal.

### 4.5 Plan change (upgrade/downgrade)
Owner requests switch from Lead Rescue → Bundle:
1. Stripe → update subscription with new price ID, prorate.
2. In DB: update `data->>'plan'` on the client record.
3. Feature flags re-evaluate on next request — no restart needed.

---

## 5 — Incident runbooks

### 5.1 SMS send failures / retry backlog
**Symptoms:** `smsRetry` queue >20, CRITICAL `sms_dropped` in logs, client
reports "no text-back arrived."

1. Twilio Console → Debugger → check for auth or A2P errors on recent
   messages. If auth: `TWILIO_AUTH_TOKEN` was rotated without Doppler update.
   Set it and wait for Railway to pick up the new value (~30s).
2. If A2P rejection: the campaign registration has lapsed. Re-register in
   Twilio Console → Messaging → A2P.
3. If queue is just backed up (Twilio healthy), force a cron tick:
   `curl -X POST -H "x-api-key: $API_KEY" https://<domain>/admin/cron/sms-retry`
   (verify this endpoint exists; if not, restart the service — the cron will
   drain on schedule).
4. For any `sent_unknown` rows: these are post-crash markers — they are
   **not re-sent** by design. Manually verify with the recipient whether
   the text arrived.

### 5.2 Stripe webhook signature failures
**Symptoms:** `stripe_signature_failed` log bursts, customers complain trial
didn't activate.

1. Confirm `STRIPE_WEBHOOK_SECRET` in Doppler matches the secret shown on
   the live webhook endpoint in Stripe Dashboard. If they drifted: paste the
   Stripe value into Doppler.
2. Stripe Dashboard → Webhooks → Resend failed events (up to 30 days).
3. If root cause was IP/TLS (rare with Railway), confirm the custom domain
   cert is valid — `curl -vI https://<domain>/webhooks/stripe`.

### 5.3 Database down / `/health` reports `db: error`
1. Railway → Postgres plugin → confirm status. If crashed, restart via
   Railway UI.
2. If Railway is healthy but app can't connect, check `DATABASE_URL` in
   Doppler hasn't changed (Railway rotates passwords on some plan changes).
3. If corruption suspected: **do not write.** Put app in maintenance by
   scaling to 0 instances, restore from backup (§3.3), scale back up.

### 5.4 Gmail ingest stuck / quarantine pileup
**Symptoms:** unread mail in `support@climateflow.ai` growing, no new
estimate or review records.

1. Check `/api/gmail/status` (if exposed) or logs for `handlers_not_wired`
   — means a recent deploy removed a handler. Revert or re-wire.
2. For `no_expected_domain`: the `FROM_EMAIL` env var changed but the
   ingest parser still expects the old domain. Reconcile.
3. For `quarantined: true`: legitimate routing miss. Manually identify the
   client, forward the content, mark the message read.
4. OAuth token expired: re-run the Gmail OAuth flow for the platform
   account — `/api/gmail/connect` with the platform admin identity.

### 5.5 OAuth token (calendar) expired for a client
Client reports "bookings stopped showing up."
1. Hit `/api/calendar/status/<businessId>` — if `connected: false`, send
   them a fresh Calendar connect link.
2. If `connected: true` but events aren't landing, check `keyVersion`
   on their token envelope:
   ```sql
   SELECT data->'calendar'->>'keyVersion' FROM records
    WHERE collection='clients' AND id='<id>';
   ```
   If it's a retired version (not in `TOKEN_ENCRYPTION_KEYS`), the envelope
   can't decrypt — force reconnect.

### 5.6 Estimate follow-ups not firing
1. Confirm cron is running: Railway logs should show
   `cron_tick name=estimate-followup` every 15 min during 9am–6pm client
   local time.
2. Check AI quota: if a client is over quota, follow-ups are skipped.
3. Check feature flag `estimate_followup_enabled` on the client record.

### 5.7 Runaway AI cost / stuck conversation loop
**Symptoms:** Anthropic spend spiking, one client dominating usage.
1. Query the AI audit log for that client — look for loops where the AI
   responds to its own prior message (missing STOP token, bad prompt
   template).
2. Hit kill switch: set feature flag `ai_enabled=false` on that client
   record. The pipeline falls back to human-operator queue.
3. Fix prompt, re-enable.

---

## 6 — Secret rotation runbooks

### 6.1 `API_KEY` rotation
1. Generate new: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Doppler `prd` → set `API_KEY` to the new value.
3. Railway picks up the change in ~30s. Any script or cron using the old
   key will 401 — update those secrets too (outreach system, internal
   dashboards, etc.).
4. Log rotation in `rotation-log.md`.

### 6.2 `URL_SIGNING_SECRET` rotation
Rotating this invalidates **all outstanding signed URLs** (welcome,
onboarding, dashboard, billing).
1. Before rotating, rotate each client's `onboardingTokenNonce` if you
   need them to revalidate. Otherwise just rotate the global secret.
2. Doppler `prd` → set new value (generate same way as §6.1).
3. Regenerate and resend any active welcome/dashboard links that were in
   flight.

### 6.3 `TOKEN_ENCRYPTION_KEY` rotation (rolling)
Never replace the key outright — use the multi-key registry.
1. Generate `v<N+1>` key (same command as §6.1).
2. Doppler `prd` → set:
   ```
   TOKEN_ENCRYPTION_KEYS=v<N+1>:<new-hex>,v<N>:<old-hex>
   TOKEN_ENCRYPTION_KEY=<new-hex>   # used for new envelopes
   ```
3. Deploy. New envelopes are minted under `v<N+1>`; old envelopes still
   decrypt via `v<N>`.
4. Run migration cron to re-encrypt old envelopes under the new key. When
   zero `v<N>` envelopes remain, drop `v<N>` from the registry.
5. Target: one key active + one retired, no more.

---

## 7 — Backups & disaster recovery

- **Backups:** Railway Postgres automated daily, 7-day retention default.
  Upgrade retention if you cross $10k MRR.
- **Restore target:** RPO 24h, RTO 30 min.
- **What survives a full-app rebuild:** Postgres data, Doppler secrets,
  Twilio numbers (in the Twilio account, not app-local), Stripe
  subscriptions.
- **What you'd rebuild:** Railway service config (in repo: `railway.toml`,
  `Dockerfile`), DNS (Cloudflare), webhook registrations in Stripe and
  Twilio.

DR drill checklist (monthly):
- [ ] Restore latest backup to a scratch DB.
- [ ] Boot app pointed at scratch DB (`DATABASE_URL=<scratch>`).
- [ ] Run `npm test`.
- [ ] `curl /health` → ok.
- [ ] Tear down scratch.

---

## 8 — Access & least privilege

| System         | Admin accounts with full access | Notes                        |
|----------------|---------------------------------|------------------------------|
| Doppler        | Malachi                         | Add backup only when hired   |
| Railway        | Malachi                         |                              |
| Stripe         | Malachi                         | 2FA required                 |
| Twilio         | Malachi                         | 2FA required                 |
| Google Workspace| Malachi                        | 2FA required                 |
| Cloudflare     | Malachi                         | 2FA + hardware key recommended|
| Anthropic      | Malachi                         |                              |

Policy:
- 2FA mandatory on every vendor account.
- No shared logins. Every operator gets their own seat.
- Offboarding: revoke all seats same day, rotate any secret they could
  have copied (API keys, webhook secrets).

---

## 9 — Weekly operator log

Keep `docs/ops-log.md` (create if missing) with one entry per week:

```
## 2026-MM-DD (week of)
- Daily pulse: [n/n days clean, any incidents]
- Clients active: N
- Incidents: [link or summary]
- Rotations: [any keys rotated]
- Next-week focus: [one thing]
```

Short. Historical pattern matters more than detail.

---

## 10 — When this doc is wrong

If a runbook step fails or contradicts the code, **fix the doc in the same
PR as the code change**. A runbook that lies is worse than no runbook.
